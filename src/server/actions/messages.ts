"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { notBannedWhere } from "@/lib/ban";
import {
  POLL_LIMIT,
  POLL_WINDOW_MS,
  localRateLimit,
  rateLimit,
} from "@/lib/rateLimit";
import {
  MESSAGE_BODY_MAX,
  MESSAGE_MAX_RECIPIENTS,
  MESSAGE_PAIR_LIMIT,
  MESSAGE_PAIR_WINDOW_MS,
  MESSAGE_RECIPIENT_LIMIT,
  MESSAGE_RECIPIENT_WINDOW_MS,
  MESSAGE_SEARCH_MAX_RESULTS,
  MESSAGE_SEARCH_MIN,
  MESSAGE_SEND_LIMIT,
  MESSAGE_SEND_WINDOW_MS,
  normalizeMailBody,
} from "@/lib/game/messages";
import type { ActionState } from "./game";
import { settleDueAssault, sweepCityBoss } from "@/server/bossSiege";
import { sweepWorldBossSpoils } from "@/server/worldBossSpoils";
import { logError } from "@/server/errorLog";
import { getT, type T } from "@/i18n/server";
import { renderMessageText } from "@/lib/game/messageText";
// The transcript a letter now writes into is the chat's, so the guard against
// saying the same thing twice into it is the chat's too.
import { isRepeat } from "@/lib/game/chat";

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban on every action (not just page loads); see getActiveEmpireId.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the callers catch it and return the
  // translated "not signed in" instead.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

/** One addressee in the composer's picker. Nothing but what draws a row. */
export type MessageRecipient = { id: string; name: string };

/**
 * Look up addressees by empire name for the compose box.
 *
 * This is what replaced shipping the whole player directory to the browser: the
 * picker holds an alphabetical seed (MESSAGE_ROSTER_SEED) and asks here for
 * anything past it, so the payload is bounded by what is on screen rather than
 * by how many people play the game.
 *
 * Deliberately as thin as `searchChatPlayers`, and for the same reason — id and
 * name only. A directory lookup must not become a free scouting report, so no
 * presence, no city, no power: this answers "does an empire by this name exist
 * and may I write to it", and nothing else.
 */
export async function searchMessageRecipients(
  query: string
): Promise<MessageRecipient[]> {
  let empireId: string;
  try {
    empireId = await requireOwnEmpireId();
  } catch {
    return [];
  }

  const q = String(query ?? "").trim();
  if (q.length < MESSAGE_SEARCH_MIN) return [];

  // `contains` is a scan no index serves, and this fires from a keystroke
  // handler. Generous enough that ordinary typing never trips it.
  if (!(await rateLimit(`msg-search:${empireId}`, 40, 60 * 1000))) return [];

  try {
    return await prisma.empire.findMany({
      where: {
        id: { not: empireId },
        name: { contains: q, mode: "insensitive" },
        user: notBannedWhere(),
      },
      orderBy: { name: "asc" },
      take: MESSAGE_SEARCH_MAX_RESULTS,
      select: { id: true, name: true },
    });
  } catch {
    return [];
  }
}

export type LiveAlert = {
  id: string;
  kind: "SYSTEM" | "BATTLE" | "SPY" | "PLAYER" | "ANNOUNCEMENT";
  title: string;
  body: string;
  href: string | null;
  createdAt: number;
};

export type InboxPulse = {
  /**
   * The round told us nothing — refused by the poll ceiling, or the caller is
   * signed out. Explicit, because the alternative reading of an empty pulse is
   * "everything you were waiting for is gone", which would blank both badges
   * and drop the toast stack. The client publishes nothing when it sees this.
   */
  stale?: boolean;
  /** Unread inbox messages — the green badge on the messages pill. */
  unreadMessages: number;
  /**
   * Reports filed *against* me since my last visit to the history page — the
   * red badge. Same rule as the layout's server-rendered count: attacks I
   * defended and enemy spies my defenses caught. My own raids and missions are
   * things I ordered on purpose, so they never light the badge.
   */
  newReports: number;
  /**
   * Newest unread messages, oldest first, for the live toasts. Announcements
   * are deliberately absent — they get the dialog instead, and a message that
   * arrived in both channels would be dismissed twice.
   */
  alerts: LiveAlert[];
  /**
   * Unread admin announcements, oldest first — the ones still owed the dialog.
   *
   * Its own list rather than a filter over `alerts` because the two have
   * opposite failure modes: a toast that scrolls past is a toast nobody needed,
   * while an announcement is the one message the game promised to put in front
   * of the player, and `alerts` holds only the newest eight unread rows. Eight
   * raids overnight would push a patch note out of that window and it would
   * never be shown at all.
   */
  announcements: LiveAlert[];
};

/** Nothing learned this round — see `InboxPulse.stale`. */
const STALE_PULSE: InboxPulse = {
  stale: true,
  unreadMessages: 0,
  newReports: 0,
  alerts: [],
  announcements: [],
};

/**
 * The live heartbeat of the top command bar: both badge counts plus the newest
 * unread messages, in one round trip.
 *
 * Everything the player is meant to learn *without touching the keyboard* —
 * that they were raided, that a spy was caught, that mail arrived — is answered
 * here, because this is the one call that runs on every screen in the game.
 * Badges and toasts deliberately share it: two pollers over the same data would
 * double the load and still disagree with each other for seconds at a time,
 * which is exactly the flicker the live badges exist to remove.
 *
 * It also settles a finished city-boss assault first, and that is deliberate
 * rather than convenient. A boss assault runs for a minute of real time while the
 * player is free to go anywhere in the game, so *something* has to notice it
 * finished no matter which screen they are on — and this poll is the only thing
 * that runs on all of them. The settle writes the very message this call is about
 * to read, so the toast announcing the haul arrives in the same round trip. It is
 * a cheap indexed lookup that finds nothing in the overwhelmingly common case, and
 * it is idempotent under the empire row lock (see `settleDueAssault`).
 *
 * Held to a handful of indexed lookups on purpose: every logged-in player runs
 * this every few seconds, so nothing that scans (the achievements snapshot, the
 * guild-war fixtures, the rankings) may migrate in here. Those ride the far
 * rarer `router.refresh()` that a genuinely new alert triggers.
 *
 * It is also the most expensive polled read in the game — the ban check, the
 * assault settle, the seen-marker and four counts, on a four-second cadence, on
 * every screen — which is why it carries the same free in-process ceiling the
 * chat panes and the boss arena do. Not a security boundary: a caller who gets
 * through is only reading their own inbox again. It exists so a client stuck in
 * a loop cannot multiply the app's hottest query path without bound.
 */
export async function getInboxPulse(): Promise<InboxPulse> {
  try {
    const t = await getT();
    const empireId = await requireOwnEmpireId();
    if (!localRateLimit(`poll:inbox:${empireId}`, POLL_LIMIT, POLL_WINDOW_MS)) {
      return STALE_PULSE;
    }
    if (await settleDueAssault(empireId)) {
      // The haul moved resources, the army and the hero — the resource bar and
      // the boss banner are both stale now.
      revalidatePath("/game", "layout");
    }
    // The other half of the same lazy clock, and since the tyrant became the
    // whole city's it covers three things rather than one: a boss felled an hour
    // ago is back on its feet, a neighbour who closed their tab mid-reveal has an
    // assault nobody has settled, and the kill purse that assault is holding is
    // owed to everyone who wounded the life. Nothing else in the deployment runs
    // at the instant any of those becomes true. Costs one indexed probe that
    // finds nothing on all but a handful of polls a day — see `sweepCityBoss`.
    const me = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { reportsSeenAt: true, cities: true },
    });
    if (!me) return STALE_PULSE;
    if (await sweepCityBoss(me.cities)) {
      // The banner's countdown has run out and its attack button is live again.
      revalidatePath("/game", "layout");
    }
    // The third lazy clock, and the only one here that is not about this player:
    // a world boss pays every contender the moment it falls, and if the request
    // that felled it died mid-fan-out the rest are owed a share nothing else
    // will hand them. Gated to one probe a minute per instance rather than one
    // per poll — see `sweepWorldBossSpoils`, and note it deliberately does not
    // report back, since what it pays out is somebody else's screen.
    await sweepWorldBossSpoils();

    const seenAt = me.reportsSeenAt;

    const ALERT_FIELDS = {
      id: true,
      kind: true,
      title: true,
      titleParams: true,
      body: true,
      bodyParams: true,
      href: true,
      createdAt: true,
    } as const;

    const [messages, announcements, unreadMessages, battleReports, spyReports] =
      await Promise.all([
        prisma.message.findMany({
          // Announcements are excluded here rather than filtered out of the
          // result: they have their own dialog, and leaving them in would let a
          // patch note eat one of the eight slots the toasts are drawn from.
          where: { empireId, readAt: null, kind: { not: "ANNOUNCEMENT" } },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: ALERT_FIELDS,
        }),
        // The announcements still owed the dialog. A second query on the hot
        // path, which this file otherwise guards jealously — it is affordable
        // because it rides the same `[empireId, readAt]` index the count beside
        // it already uses and, on all but a handful of polls a day, finds
        // nothing. Oldest first so a run of patch notes is read in the order it
        // was written; three at a time is a queue, not a wall.
        prisma.message.findMany({
          where: { empireId, readAt: null, kind: "ANNOUNCEMENT" },
          orderBy: { createdAt: "asc" },
          take: 3,
          select: ALERT_FIELDS,
        }),
        prisma.message.count({ where: { empireId, readAt: null } }),
        prisma.battleReport.count({
          where: { defenderEmpireId: empireId, createdAt: { gt: seenAt } },
        }),
        // A successful enemy spy stays invisible to its target; only the ones
        // my defenses caught are news. Mirrors the layout and ReportsTabs.
        prisma.spyReport.count({
          where: {
            defenderEmpireId: empireId,
            success: false,
            createdAt: { gt: seenAt },
          },
        }),
      ]);

    // The stored row is keys plus values — rendered here, in the poller's own
    // language, because whoever wrote it was somebody else. See
    // renderMessageText. (An admin broadcast is the exception the rule survives:
    // it is free text typed once, so it matches no key and renders unchanged.)
    const toAlert = ({
      titleParams,
      bodyParams,
      ...m
    }: (typeof messages)[number]): LiveAlert => ({
      ...m,
      ...renderMessageText(t, { ...m, titleParams, bodyParams }),
      createdAt: m.createdAt.getTime(),
    });

    return {
      unreadMessages,
      newReports: battleReports + spyReports,
      // Oldest first so toasts stack in chronological order.
      alerts: messages.reverse().map(toAlert),
      // Already oldest first — that is the order they are meant to be read in.
      announcements: announcements.map(toAlert),
    };
  } catch {
    // Polling is best-effort — a missed round just retries in a few seconds.
    // Stale, not empty: a signed-out tab or a hiccup must not read as "your
    // inbox is clear" and wipe the badges the last good round put up.
    return STALE_PULSE;
  }
}

/**
 * Mark every unread inbox message as read. Called when the player opens the
 * messages page, so the sidebar badge clears while they're reading.
 */
export async function markMessagesRead(): Promise<void> {
  try {
    const empireId = await requireOwnEmpireId();
    const updated = await prisma.message.updateMany({
      where: { empireId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count > 0) revalidatePath("/game", "layout");
  } catch {
    // Losing a mark-read is harmless — the badge clears on the next visit.
  }
}

/**
 * Acknowledge one admin announcement: the dialog that showed it has been
 * closed, so the message is read and must not stop the player again.
 *
 * Server-side and per-message on purpose. The toast stack remembers what it has
 * already shown in `localStorage`, which is the right call for something that
 * merely scrolled past — but an announcement is a thing the player was made to
 * dismiss, and remembering it per *browser* would show the same patch note again
 * on their phone, and forget it entirely when they cleared their cache. `readAt`
 * is the account's own answer, and it is the same column the inbox already
 * writes, so an announcement read in the dialog is read in the mailbox too.
 *
 * Narrower than `markMessagesRead` in every direction: one row, mine, unread,
 * and an announcement. The `empireId` in the guard is what makes the id in the
 * argument harmless — a stranger's id matches nothing.
 */
export async function dismissAnnouncement(id: string): Promise<void> {
  try {
    if (typeof id !== "string" || id.length === 0 || id.length > 64) return;
    const empireId = await requireOwnEmpireId();
    const updated = await prisma.message.updateMany({
      where: { id, empireId, kind: "ANNOUNCEMENT", readAt: null },
      data: { readAt: new Date() },
    });
    // The messages badge in the command bar is one lower now.
    if (updated.count > 0) revalidatePath("/game", "layout");
  } catch {
    // Best-effort, like every other mark-read here: the dialog has already
    // closed itself locally, and a lost write only means it opens once more.
  }
}

const sendSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
  recipients: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MESSAGE_MAX_RECIPIENTS),
});

/**
 * The title the mailbox gives a letter now that nobody writes one.
 *
 * The subject line was a required field above every message, and what it
 * actually collected was either the first words of the body again or a single
 * character to get past the asterisk. It bought nothing: a letter is titled by
 * *who sent it*, which is the one thing the reader wants to know from the
 * unopened row, and which the row already had to look up anyway.
 *
 * Stored as a dictionary key plus the name, not a finished sentence — the
 * sender's language must not decide the reader's. See `renderMessageText`.
 */
// i18n-keys: stored on the row and read through t() when the inbox is opened
const MAIL_TITLE_KEY = "הודעה מאת {name}";

/**
 * Deliver one letter to a list of already-authorised recipients.
 *
 * ## Two rows per addressee, and why
 *
 * A letter is written into **both** tables, and neither one is a copy of the
 * other:
 *
 * - `ChatMessage` (channel DIRECT) is the *transcript* — the single ordered
 *   record of what these two players have said to each other. It is what the
 *   chat dock draws, and it is what the mailbox's own reply view draws, so
 *   there is exactly one history and both doors are looking at it. This is the
 *   whole point: a player who answers from the dock is answering the letter,
 *   and a player who answers from the mailbox sees what was said in the dock.
 * - `Message` (kind PLAYER) is the *notification* — the mailbox badge, the
 *   toast, the row that stays in the 50-message archive, and the only one of
 *   the two that reaches somebody who never opens the chat at all.
 *
 * The reverse direction is deliberately **not** symmetric: a chat line writes
 * no `Message`. A conversation is dozens of lines and the mailbox is a record
 * of events, so mirroring the dock into it would bury a battle report under
 * somebody's small talk and fire a toast per sentence. The dock has its own
 * badge for that, and the transcript is shared either way — which is what the
 * player was promised. Only a letter, which is rate-limited to five an hour per
 * pair, is loud enough to be worth an inbox row.
 *
 * Both writes go in one transaction: a transcript line with no notification is
 * a letter that never announced itself, and a notification with no transcript
 * line is a reply thread with a hole in it.
 */
async function deliverPlayerMail(
  sender: { id: string; name: string },
  targets: { id: string; name: string }[],
  body: string
): Promise<void> {
  // Explicit, never the column default: the database's CURRENT_TIMESTAMP writes
  // local wall time, which lands hours away from every other timestamp the app
  // writes — and this row has to sort against chat lines that were written
  // correctly. See the memory on raw SQL timestamps.
  const now = new Date();
  await prisma.$transaction([
    prisma.message.createMany({
      data: targets.map((target) => ({
        empireId: target.id,
        senderEmpireId: sender.id,
        kind: "PLAYER" as const,
        title: MAIL_TITLE_KEY,
        titleParams: { name: sender.name },
        body,
        createdAt: now,
      })),
    }),
    prisma.chatMessage.createMany({
      data: targets.map((target) => ({
        channel: "DIRECT" as const,
        senderEmpireId: sender.id,
        senderName: sender.name,
        recipientEmpireId: target.id,
        body,
        // What tells the dock it is drawing a letter and not a shout: it may run
        // to MESSAGE_BODY_MAX and keeps its paragraphs.
        viaMail: true,
        createdAt: now,
      })),
    }),
  ]);
}

/**
 * The budgets every outbound letter passes, whatever door it was written at.
 *
 * Returns the addressees that may actually be written to. Throttled ones are
 * *dropped* rather than failing the send, so one over-mailed target does not
 * block the rest of an address list; `error` is only set when nothing at all
 * got through, because that is the only case the sender has to act on.
 */
async function mailBudget(
  t: T,
  empireId: string,
  targets: { id: string; name: string }[]
): Promise<
  | { error: string }
  | { allowed: { id: string; name: string }[]; throttled: { id: string; name: string }[] }
> {
  // Volume budget, charged per addressee — one send to ten players costs ten.
  // Checked against the resolved targets rather than the submitted ids, so a
  // list padded with dead ones does not bill for deliveries never made.
  if (
    !(await rateLimit(
      `msg-recipients:${empireId}`,
      MESSAGE_RECIPIENT_LIMIT,
      MESSAGE_RECIPIENT_WINDOW_MS,
      targets.length
    ))
  ) {
    return {
      error: t("שלחת הודעות ליותר מדי שחקנים בזמן קצר — נסה שוב בעוד כמה דקות"),
    };
  }

  // Per sender→recipient budget: the volume cap above still allows a whole
  // window to be aimed at one player, which is the harassment case.
  const verdicts = await Promise.all(
    targets.map((target) =>
      rateLimit(
        `msg-pair:${empireId}:${target.id}`,
        MESSAGE_PAIR_LIMIT,
        MESSAGE_PAIR_WINDOW_MS
      )
    )
  );
  const allowed = targets.filter((_, i) => verdicts[i]);
  const throttled = targets.filter((_, i) => !verdicts[i]);
  if (allowed.length === 0) {
    return {
      error:
        targets.length === 1
          ? t("שלחת לאחרונה כמה הודעות אל {name} — המתן לפני שתשלח שוב", {
              name: targets[0]!.name,
            })
          : t("שלחת לאחרונה כמה הודעות אל השחקנים האלה — המתן לפני שתשלח שוב"),
    };
  }
  return { allowed, throttled };
}

/**
 * Player-to-player mail. Recipients arrive as empire ids picked from the closed
 * roster the compose form renders, but the ids are still re-checked here — a
 * Server Action is reachable by direct POST, so the list in the UI is a
 * convenience, never the authorization.
 */
export async function sendPlayerMessage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  let empireId: string;
  try {
    empireId = await requireOwnEmpireId();
  } catch {
    return { error: t("לא מחובר") };
  }

  // How often the composer may fire. The budget that bounds actual delivery
  // volume is charged per addressee further down, once the recipients are
  // known — see MESSAGE_RECIPIENT_LIMIT.
  if (!(await rateLimit(`msg-send:${empireId}`, MESSAGE_SEND_LIMIT, MESSAGE_SEND_WINDOW_MS))) {
    return { error: t("שלחת יותר מדי הודעות — נסה שוב בעוד כמה דקות") };
  }

  const parsed = sendSchema.safeParse({
    // Normalized before it is measured, so the length the player is judged on is
    // the length that gets stored — and so a wall of blank lines cannot be used
    // to scroll the shared transcript clean. See normalizeMailBody.
    body: normalizeMailBody(String(formData.get("body") ?? "")),
    // Dedup: the same id twice must not deliver (or bill against the cap) twice.
    recipients: [...new Set(formData.getAll("recipients").map(String))],
  });
  if (!parsed.success) {
    return {
      error: t("בחר עד {recipients} נמענים וכתוב הודעה (עד {body} תווים)", {
        recipients: MESSAGE_MAX_RECIPIENTS,
        body: MESSAGE_BODY_MAX,
      }),
    };
  }

  try {
    const me = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { name: true },
    });
    if (!me) return { error: t("לא מחובר") };

    // Only real, unbanned empires — and never yourself.
    const targets = await prisma.empire.findMany({
      where: {
        id: { in: parsed.data.recipients.filter((id) => id !== empireId) },
        user: notBannedWhere(),
      },
      select: { id: true, name: true },
    });
    if (targets.length === 0) {
      return { error: t("לא נבחרו נמענים תקינים") };
    }

    const budget = await mailBudget(t, empireId, targets);
    if ("error" in budget) return { error: budget.error };
    const { allowed, throttled } = budget;

    await deliverPlayerMail({ id: empireId, name: me.name }, allowed, parsed.data.body);

    revalidatePath("/game", "layout");
    // A silent partial send would read as a full one, so the skipped names are
    // named.
    const skipped =
      throttled.length > 0
        ? t(" (לא נשלחה אל {names} — יותר מדי הודעות אליהם לאחרונה)", {
            names: throttled.map((target) => target.name).join(", "),
          })
        : "";
    return {
      success:
        (allowed.length === 1
          ? t("ההודעה נשלחה אל {name}", { name: allowed[0]!.name })
          : t("ההודעה נשלחה אל {count} שחקנים", { count: allowed.length })) + skipped,
    };
  } catch (err) {
    await logError("messages.sendPlayerMessage", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * Answer a letter, from the conversation view in the mailbox or on a profile.
 *
 * The same delivery and the same budgets as `sendPlayerMessage` — this is a
 * letter, not a chat line, and it rings the other side's mailbox exactly as one
 * written from the composer does. What is different is the shape: one
 * addressee, a plain argument instead of a `FormData`, and no `revalidatePath`.
 * The reply view is a dialog over a page that is already rendered and it reloads
 * the transcript itself; re-rendering the whole game shell underneath it would
 * cost far more than the badge it would refresh, and the badge is polled anyway
 * (see getInboxPulse).
 */
export async function replyToPlayer(input: {
  toEmpireId: string;
  body: string;
}): Promise<{ ok: true } | { error: string }> {
  const t = await getT();
  let empireId: string;
  try {
    empireId = await requireOwnEmpireId();
  } catch {
    return { error: t("לא מחובר") };
  }

  if (!(await rateLimit(`msg-send:${empireId}`, MESSAGE_SEND_LIMIT, MESSAGE_SEND_WINDOW_MS))) {
    return { error: t("שלחת יותר מדי הודעות — נסה שוב בעוד כמה דקות") };
  }

  const parsed = z
    .object({
      toEmpireId: z.string().min(1).max(64),
      body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
    })
    .safeParse({
      toEmpireId: String(input?.toEmpireId ?? ""),
      body: normalizeMailBody(String(input?.body ?? "")),
    });
  if (!parsed.success) {
    return { error: t("כתוב הודעה (עד {max} תווים)", { max: MESSAGE_BODY_MAX }) };
  }
  if (parsed.data.toEmpireId === empireId) {
    return { error: t("אי אפשר לשלוח הודעה לעצמך") };
  }

  try {
    const [me, target] = await Promise.all([
      prisma.empire.findUnique({ where: { id: empireId }, select: { name: true } }),
      prisma.empire.findFirst({
        where: { id: parsed.data.toEmpireId, user: notBannedWhere() },
        select: { id: true, name: true },
      }),
    ]);
    if (!me) return { error: t("לא מחובר") };
    if (!target) return { error: t("השחקן לא נמצא") };

    // "Did I just say this?" — the one spam shape no per-hour budget catches,
    // and the guard the chat has always had on this same transcript (see
    // `isRepeat`). It belongs on the reply door in particular: this is the
    // conversation shape, where a stalled request or a second tab turns one
    // sentence into two identical lines in a transcript both sides read. The
    // composer is left without it on purpose — the same letter to ten people is
    // one deliberate send, not a repeat.
    const previous = await prisma.chatMessage.findFirst({
      where: {
        senderEmpireId: empireId,
        channel: "DIRECT",
        recipientEmpireId: target.id,
      },
      orderBy: { createdAt: "desc" },
      select: { body: true, createdAt: true },
    });
    if (isRepeat(parsed.data.body, previous, new Date())) {
      return { error: t("כבר כתבת את זה") };
    }

    const budget = await mailBudget(t, empireId, [target]);
    if ("error" in budget) return { error: budget.error };

    await deliverPlayerMail({ id: empireId, name: me.name }, budget.allowed, parsed.data.body);
    return { ok: true };
  } catch (err) {
    await logError("messages.replyToPlayer", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * Stamp the reports page as seen. Called when the player opens the reports
 * page, so the sidebar "new reports" badge clears.
 */
export async function markReportsSeen(): Promise<void> {
  try {
    const empireId = await requireOwnEmpireId();
    await prisma.empire.update({
      where: { id: empireId },
      data: { reportsSeenAt: new Date() },
    });
    revalidatePath("/game", "layout");
  } catch {
    // Losing a mark-seen is harmless — the badge clears on the next visit.
  }
}
