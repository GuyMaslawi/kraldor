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
  MESSAGE_TITLE_MAX,
} from "@/lib/game/messages";
import type { ActionState } from "./game";
import { settleDueAssault, sweepCityBoss } from "@/server/bossSiege";
import { sweepWorldBossSpoils } from "@/server/worldBossSpoils";
import { logError } from "@/server/errorLog";
import { getT } from "@/i18n/server";
import { renderMessageText } from "@/lib/game/messageText";

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
  title: z.string().trim().min(1).max(MESSAGE_TITLE_MAX),
  body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
  recipients: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MESSAGE_MAX_RECIPIENTS),
});

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
    title: formData.get("title"),
    body: formData.get("body"),
    // Dedup: the same id twice must not deliver (or bill against the cap) twice.
    recipients: [...new Set(formData.getAll("recipients").map(String))],
  });
  if (!parsed.success) {
    return {
      error: t(
        "בחר עד {recipients} נמענים ומלא נושא (עד {title} תווים) ותוכן (עד {body} תווים)",
        {
          recipients: MESSAGE_MAX_RECIPIENTS,
          title: MESSAGE_TITLE_MAX,
          body: MESSAGE_BODY_MAX,
        }
      ),
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
    // window to be aimed at one player, which is the harassment case. Throttled
    // addressees are dropped from this send rather than failing it, so one
    // over-mailed target does not block the rest of the list.
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

    await prisma.message.createMany({
      data: allowed.map((target) => ({
        empireId: target.id,
        senderEmpireId: empireId,
        kind: "PLAYER" as const,
        title: parsed.data.title,
        body: parsed.data.body,
      })),
    });

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
