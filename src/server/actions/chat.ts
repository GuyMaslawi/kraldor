"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { getSessionUser, logAdmin } from "@/lib/admin";
import { notBannedWhere } from "@/lib/ban";
import {
  POLL_LIMIT,
  POLL_WINDOW_MS,
  localRateLimit,
  rateLimit,
} from "@/lib/rateLimit";
import { formatGameTime } from "@/lib/game/time";
import { logError } from "@/server/errorLog";
// The pinned "צוות קראלדור" row is a support thread, not a ChatMessage one —
// the two conversations share a dock, not a table. See server/supportThread.ts.
import {
  getSupportSummary,
  getSupportUnread,
  type SupportSummary,
} from "@/server/supportThread";
import { getT } from "@/i18n/server";
import {
  CHAT_BODY_MAX,
  CHAT_BURST_LIMIT,
  CHAT_BURST_WINDOW_MS,
  CHAT_DIRECT_LIMIT,
  CHAT_DIRECT_WINDOW_MS,
  CHAT_GLOBAL_LIMIT,
  CHAT_GLOBAL_WINDOW_MS,
  CHAT_ID_MAX,
  CHAT_PAGE_SIZE,
  CHAT_PAIR_LIMIT,
  CHAT_PAIR_WINDOW_MS,
  CHAT_ROSTER_MAX,
  CHAT_SEARCH_MAX_RESULTS,
  CHAT_SEARCH_MIN,
  CHAT_THREAD_LIST_MAX,
  CHAT_THREAD_PAGE_SIZE,
  PRESENCE_TOUCH_MS,
  TYPING_LIMIT,
  TYPING_TTL_MS,
  TYPING_WINDOW_MS,
  isOnline,
  isRepeat,
  normalizeChatBody,
  parseSinceMs,
  threadKey,
} from "@/lib/game/chat";

/**
 * The live chat's whole server surface: the public room, private threads, the
 * badge poll, the roster search behind "new conversation", and the admin's
 * broom.
 *
 * Everything here is *polled*, which shapes the whole file. Each read is one
 * indexed query with a hard `take`, none of them writes unless something
 * actually changed, and none of them calls `revalidatePath` — a poll that
 * invalidates the router cache every few seconds would re-render the entire
 * game shell around the pane. The badges chat owns are client state, updated
 * from what these actions return.
 */

export type ChatLine = {
  id: string;
  /** Author's empire, or null once that empire is gone. */
  empireId: string | null;
  name: string;
  body: string;
  /** Epoch ms — the client's dedupe/high-water key. */
  at: number;
  /** Jerusalem wall time (HH:MM), formatted server-side so every player sees
   *  the same clock regardless of their device timezone. */
  time: string;
  mine: boolean;
  /** Marks the game's own staff in the public room. */
  staff: boolean;
};

export type ChatThread = {
  empireId: string;
  name: string;
  /** Last line either side wrote, for the preview row. */
  preview: string;
  at: number;
  time: string;
  unread: number;
  online: boolean;
};

/**
 * A name in the "who can I write to" list.
 *
 * `online` is optional because for some of these it is genuinely unknown to the
 * caller by design — `searchChatPlayers` does not report presence, and a row that
 * says `false` there would be an assertion we are deliberately not making. Undefined
 * means "not disclosed"; the pane draws no dot at all.
 */
export type ChatPlayer = {
  id: string;
  name: string;
  online?: boolean;
};

export type ChatPulse = {
  /** Unread private lines addressed to me. */
  unread: number;
  /** When the public room last spoke — the launcher's "new activity" dot
   *  compares it against the client's own high-water mark. */
  latestGlobalAt: number;
  /**
   * Unanswered replies from the game's staff, in the pinned conversation the
   * private tab opens on.
   *
   * It rides in the same heartbeat as the rest, and it has to: an answer from us
   * that only appears once the player thinks to open the dock is an answer they
   * will read tomorrow. See getSupportUnread for what it costs a player who has
   * never written in — one index probe that finds nothing.
   */
  staffUnread: number;
};

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban and the email gate on every call, not just on page load.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the callers catch it and return the
  // translated "something went wrong" instead.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

/**
 * Ceiling on one polled read, per player. Free (see `localRateLimit`) — an allowed
 * poll costs nothing, so this is not paid for by the honest client it protects.
 *
 * Every read below is a poll, and none of them had an upper bound on frequency:
 * the pane asks every 5-8 seconds, and nothing stopped a client asking 50 times a
 * second instead. `getChatThread` is 5-6 indexed queries a call, which makes a
 * loop over it the cheapest way to put load on the database in the whole app — no
 * bug required, just a patient client.
 */
function pollAllowed(what: string, empireId: string): boolean {
  return localRateLimit(`poll:${what}:${empireId}`, POLL_LIMIT, POLL_WINDOW_MS);
}

/**
 * Stamp the caller as here, at most once every PRESENCE_TOUCH_MS.
 *
 * The throttle is the WHERE clause rather than a timer: `lastSeenAt` older than
 * the window (or never set) is the only thing that matches, so the poll that
 * runs every few seconds costs an index probe and the row is really written
 * about once a minute and a half. Failures are swallowed — a missed heartbeat
 * costs a dot, and must never break the read it rode in on.
 */
async function touchPresence(empireId: string): Promise<void> {
  try {
    const now = new Date();
    await prisma.empire.updateMany({
      where: {
        id: empireId,
        OR: [
          { lastSeenAt: null },
          { lastSeenAt: { lt: new Date(now.getTime() - PRESENCE_TOUCH_MS) } },
        ],
      },
      data: { lastSeenAt: now },
    });
  } catch {
    // Presence is decoration; the chat works without it.
  }
}

/** Row shape every read path selects, so `toLine` has one input. */
const LINE_SELECT = {
  id: true,
  senderEmpireId: true,
  senderName: true,
  body: true,
  createdAt: true,
  // `isStaff` rather than the owner's role: it is a column on the row already
  // being read, where the role costs a join to User on every line of every
  // poll. The two are kept in step by syncStaffFlag (see src/lib/staff.ts).
  sender: { select: { isStaff: true } },
} as const;

type LineRow = {
  id: string;
  senderEmpireId: string | null;
  senderName: string;
  body: string;
  createdAt: Date;
  sender: { isStaff: boolean } | null;
};

function toLine(row: LineRow, meId: string): ChatLine {
  return {
    id: row.id,
    empireId: row.senderEmpireId,
    name: row.senderName,
    body: row.body,
    at: row.createdAt.getTime(),
    time: formatGameTime(row.createdAt),
    mine: row.senderEmpireId === meId,
    staff: row.sender?.isStaff ?? false,
  };
}

/**
 * The cheap poll that runs while the pane is shut: one count and one lookup.
 * Everything heavier is only fetched once something is actually open.
 */
export async function getChatPulse(): Promise<ChatPulse> {
  try {
    const empireId = await requireOwnEmpireId();
    if (!pollAllowed("pulse", empireId)) return EMPTY_PULSE;
    // The shut dock is the heartbeat that matters: it is the only poll a player
    // who never opens the chat still runs, and presence has to be true for them.
    await touchPresence(empireId);
    const [unread, latest, staffUnread] = await Promise.all([
      countUnread(empireId),
      prisma.chatMessage.findFirst({
        where: { channel: "GLOBAL", hiddenAt: null },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      getSupportUnread(),
    ]);
    return {
      unread,
      latestGlobalAt: latest?.createdAt.getTime() ?? 0,
      staffUnread,
    };
  } catch {
    // A missed round just retries — never surface a polling failure as an error.
    return EMPTY_PULSE;
  }
}

const EMPTY_PULSE: ChatPulse = { unread: 0, latestGlobalAt: 0, staffUnread: 0 };

/** How many private lines are waiting for this empire. */
function countUnread(empireId: string): Promise<number> {
  return prisma.chatMessage.count({
    where: {
      channel: "DIRECT",
      recipientEmpireId: empireId,
      readAt: null,
      hiddenAt: null,
    },
  });
}

export type ChatRoomView = {
  lines: ChatLine[];
  unread: number;
  /** Names currently typing into the room, mine excluded. */
  typing: string[];
};

/**
 * Who is typing into `toEmpireId` (null = the public room) right now, other than
 * me. One indexed read over a table with at most one row per player, filtered by
 * the TTL rather than by a sweep — a stale marker is already false.
 */
async function typingNames(
  meId: string,
  toEmpireId: string | null
): Promise<string[]> {
  try {
    const rows = await prisma.chatTyping.findMany({
      where: {
        toEmpireId,
        empireId: { not: meId },
        updatedAt: { gt: new Date(Date.now() - TYPING_TTL_MS) },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { name: true },
    });
    return rows.map((row) => row.name);
  } catch {
    return [];
  }
}

/**
 * Say "I am typing" — or, with `toEmpireId`, "I am typing to you".
 *
 * Called from the composer at most once every TYPING_PING_MS, and the row is
 * overwritten in place, so a player hammering the keyboard costs one upsert
 * every three seconds. Best-effort throughout: a typing indicator is the least
 * important thing on the screen and must never surface an error over the
 * message someone is in the middle of writing.
 */
export async function setTyping(toEmpireId?: string | null): Promise<void> {
  try {
    const empireId = await requireOwnEmpireId();

    // Budgeted like every other write. This was the one path in the chat with no
    // limit on it at all: two queries a call, called as fast as a client cared to.
    // Refusing silently is right for an indicator — the caller has nothing to do
    // with the answer, and the marker simply does not refresh this round.
    if (!(await rateLimit(`chat-typing:${empireId}`, TYPING_LIMIT, TYPING_WINDOW_MS))) {
      return;
    }

    // The addressee is client-supplied and `ChatTyping.toEmpireId` has no foreign
    // key behind it, so without this an arbitrary 4KB string was stored verbatim
    // as "who I am typing to". Anything that is not a plausible id is treated as
    // the public room, which is the safe reading of a malformed marker.
    const raw = typeof toEmpireId === "string" ? toEmpireId : null;
    const to = raw !== null && raw.length > 0 && raw.length <= CHAT_ID_MAX ? raw : null;

    const me = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { name: true },
    });
    if (!me) return;
    const now = new Date();
    await prisma.chatTyping.upsert({
      where: { empireId },
      create: { empireId, name: me.name, toEmpireId: to, updatedAt: now },
      update: { name: me.name, toEmpireId: to, updatedAt: now },
    });
  } catch {
    // Nothing to report: the indicator simply does not appear.
  }
}

/** Drop my marker the moment the line is sent, so the indicator does not hang
 *  around for its whole TTL after the message it announced has arrived. */
async function clearTyping(empireId: string): Promise<void> {
  try {
    await prisma.chatTyping.deleteMany({ where: { empireId } });
  } catch {
    // The TTL clears it a few seconds later anyway.
  }
}

/**
 * The public room. Without `sinceMs` this is the tail the pane opens on; with
 * it, only what has been said since — which is what every subsequent poll asks
 * for, so a quiet room costs an empty result set.
 *
 * `gte`, not `gt`: two lines can land in the same millisecond, and a strict
 * cursor would drop the second one forever. The overlap it creates is a
 * duplicate id, which the client already filters.
 *
 * The private-mail badge rides along. It is one more indexed count, and folding
 * it in here is what stops the open pane from making a second round trip every
 * five seconds just to keep a number on a tab up to date.
 */
export async function getGlobalChat(sinceMs?: number): Promise<ChatRoomView> {
  try {
    const empireId = await requireOwnEmpireId();
    if (!pollAllowed("room", empireId)) return { lines: [], unread: 0, typing: [] };
    await touchPresence(empireId);
    // The cursor comes from the client; an unparseable one falls back to the tail
    // rather than reaching `new Date()` and failing the query (see parseSinceMs).
    const since = parseSinceMs(sinceMs);
    const [rows, unread, typing] = await Promise.all([
      prisma.chatMessage.findMany({
        where: {
          channel: "GLOBAL",
          hiddenAt: null,
          ...(since ? { createdAt: { gte: new Date(since) } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: CHAT_PAGE_SIZE,
        select: LINE_SELECT,
      }),
      countUnread(empireId),
      typingNames(empireId, null),
    ]);
    // Oldest first: the pane renders top-to-bottom and appends at the end.
    return {
      lines: rows.reverse().map((row) => toLine(row, empireId)),
      unread,
      typing,
    };
  } catch {
    return { lines: [], unread: 0, typing: [] };
  }
}

/**
 * Every private conversation I am part of, newest first, with its last line and
 * my unread count.
 *
 * The head of each thread comes from a `DISTINCT ON` rather than N queries or a
 * "load my last 200 lines and group in JS" pass: grouping in JS reports the
 * wrong list the moment one busy thread fills the window, and it grows without
 * bound as the game does. `partner` is computed inside the subquery so one index
 * scan covers both directions of the conversation.
 */
export async function getChatThreads(): Promise<ChatThread[]> {
  try {
    const empireId = await requireOwnEmpireId();
    if (!pollAllowed("threads", empireId)) return [];
    await touchPresence(empireId);

    // The `ORDER BY … LIMIT` sits in an outer query rather than in JS: DISTINCT ON
    // dictates its own ORDER BY, so the newest-first cut has to be taken one level
    // up. Doing it here and not after the fact matters because *anyone* can add a
    // row to this scan — a conversation appears the moment someone writes to you,
    // there is no way to leave one, and there is no block. Sorting 30 rows out of
    // however many strangers have written to you belongs in the database.
    const top = await prisma.$queryRaw<
      { partner: string; body: string; createdAt: Date }[]
    >`
      SELECT h."partner", h."body", h."createdAt"
      FROM (
        SELECT DISTINCT ON (t."partner") t."partner", t."body", t."createdAt"
        FROM (
          SELECT
            CASE WHEN c."senderEmpireId" = ${empireId}
                 THEN c."recipientEmpireId" ELSE c."senderEmpireId" END AS "partner",
            c."body", c."createdAt"
          FROM "ChatMessage" c
          WHERE c."channel" = 'DIRECT'
            AND c."hiddenAt" IS NULL
            AND (c."senderEmpireId" = ${empireId} OR c."recipientEmpireId" = ${empireId})
        ) t
        WHERE t."partner" IS NOT NULL
        ORDER BY t."partner", t."createdAt" DESC
      ) h
      ORDER BY h."createdAt" DESC
      LIMIT ${CHAT_THREAD_LIST_MAX}
    `;

    if (top.length === 0) return [];
    const partnerIds = top.map((h) => h.partner);

    const [partners, unread] = await Promise.all([
      prisma.empire.findMany({
        where: { id: { in: partnerIds } },
        select: { id: true, name: true, lastSeenAt: true, isBot: true },
      }),
      prisma.chatMessage.groupBy({
        by: ["senderEmpireId"],
        where: {
          // Narrowed to the threads actually being rendered. Ungrouped it spanned
          // every stranger with an unread line waiting, which is a set anyone can
          // grow — and the other keys were thrown away on read anyway.
          senderEmpireId: { in: partnerIds },
          channel: "DIRECT",
          recipientEmpireId: empireId,
          readAt: null,
          hiddenAt: null,
        },
        _count: { _all: true },
      }),
    ]);

    const now = new Date();
    const byId = new Map(partners.map((p) => [p.id, p]));
    const unreadById = new Map(
      unread.map((u) => [u.senderEmpireId ?? "", u._count._all])
    );

    return top
      // A partner whose empire is gone drops off the list: there is nobody left
      // to write to, and the row would have no name to show.
      .filter((h) => byId.has(h.partner))
      .map((h) => ({
        empireId: h.partner,
        name: byId.get(h.partner)!.name,
        preview: h.body,
        at: h.createdAt.getTime(),
        time: formatGameTime(h.createdAt),
        unread: unreadById.get(h.partner) ?? 0,
        online: isOnline(byId.get(h.partner)!, now),
      }));
  } catch (err) {
    await logError("chat.getChatThreads", err);
    return [];
  }
}

export type ChatThreadView = {
  partner: ChatPlayer | null;
  lines: ChatLine[];
  /** Unread private lines left *elsewhere* — this thread has just been read, so
   *  the tab badge has to be recomputed after the receipt, not before it. */
  unread: number;
  /** Whether the partner is typing into this conversation right now. */
  typing: boolean;
};

/**
 * One private conversation, and the read receipt for it.
 *
 * Opening a thread is what marks it read, and this is the call the open thread
 * polls — so the write is conditional on there actually being an unread inbound
 * line in what we just loaded. Otherwise every idle thread would issue an
 * `updateMany` every few seconds for nothing.
 */
export async function getChatThread(
  partnerId: string,
  sinceMs?: number
): Promise<ChatThreadView> {
  try {
    const empireId = await requireOwnEmpireId();
    // Bounded before it reaches a query: the partner id is client-supplied, and an
    // unbounded string has no business in a WHERE clause even when it cannot match.
    if (
      typeof partnerId !== "string" ||
      partnerId.length === 0 ||
      partnerId.length > CHAT_ID_MAX ||
      partnerId === empireId
    ) {
      return { partner: null, lines: [], unread: 0, typing: false };
    }
    if (!pollAllowed("thread", empireId))
      return { partner: null, lines: [], unread: 0, typing: false };
    await touchPresence(empireId);

    const row = await prisma.empire.findFirst({
      where: { id: partnerId, user: notBannedWhere() },
      select: { id: true, name: true, lastSeenAt: true, isBot: true },
    });
    if (!row) return { partner: null, lines: [], unread: 0, typing: false };
    const partner: ChatPlayer = {
      id: row.id,
      name: row.name,
      online: isOnline(row),
    };

    const between = [
      { senderEmpireId: empireId, recipientEmpireId: partnerId },
      { senderEmpireId: partnerId, recipientEmpireId: empireId },
    ];

    const since = parseSinceMs(sinceMs);
    const rows = await prisma.chatMessage.findMany({
      where: {
        channel: "DIRECT",
        hiddenAt: null,
        OR: between,
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: CHAT_THREAD_PAGE_SIZE,
      select: { ...LINE_SELECT, readAt: true },
    });

    const inboundUnread = rows.some(
      (row) => row.senderEmpireId === partnerId && row.readAt === null
    );
    if (inboundUnread) {
      await prisma.chatMessage.updateMany({
        where: {
          channel: "DIRECT",
          senderEmpireId: partnerId,
          recipientEmpireId: empireId,
          readAt: null,
        },
        data: { readAt: new Date() },
      });
    }

    const [unread, typing] = await Promise.all([
      countUnread(empireId),
      // Both halves of the conversation are pinned: the marker must be *this
      // partner's*, aimed at *me*. Anything looser lights this thread up when
      // they are typing in the room, or when somebody else is writing to me.
      prisma.chatTyping
        .count({
          where: {
            empireId: partnerId,
            toEmpireId: empireId,
            updatedAt: { gt: new Date(Date.now() - TYPING_TTL_MS) },
          },
        })
        .then((count) => count > 0),
    ]);

    return {
      partner,
      lines: rows.reverse().map((row) => toLine(row, empireId)),
      unread,
      typing,
    };
  } catch (err) {
    await logError("chat.getChatThread", err);
    return { partner: null, lines: [], unread: 0, typing: false };
  }
}

export type ChatSendResult = { line: ChatLine } | { error: string };

const sendSchema = z.object({
  // Length is counted in characters, not UTF-16 units, to match the clamp in
  // normalizeChatBody — a line of 300 emoji is 600 units long and is not
  // over-long by any measure a player would recognise.
  body: z
    .string()
    .trim()
    .min(1)
    .refine((value) => [...value].length <= CHAT_BODY_MAX),
  toEmpireId: z.string().min(1).max(64).nullable(),
});

/**
 * Say something — in the room when `toEmpireId` is null, to one player when it
 * is not.
 *
 * The written line comes back so the sender sees it land immediately instead of
 * waiting out a poll interval. Nothing else about the send is optimistic: the
 * body is normalized and re-validated here, and the addressee is re-checked
 * against the live roster, because a Server Action is reachable by direct POST
 * and the picker in the UI is a convenience, never the authorization.
 */
export async function sendChat(input: {
  body: string;
  toEmpireId?: string | null;
}): Promise<ChatSendResult> {
  const t = await getT();
  let empireId: string;
  try {
    empireId = await requireOwnEmpireId();
  } catch {
    return { error: t("לא מחובר") };
  }

  const parsed = sendSchema.safeParse({
    body: normalizeChatBody(String(input.body ?? "")),
    toEmpireId: input.toEmpireId ?? null,
  });
  if (!parsed.success) {
    return { error: t("כתוב הודעה (עד {max} תווים)", { max: CHAT_BODY_MAX }) };
  }
  const { body, toEmpireId } = parsed.data;

  // Burst first: it is the cheapest refusal and the one a paste loop trips.
  if (
    !(await rateLimit(
      `chat-burst:${empireId}`,
      CHAT_BURST_LIMIT,
      CHAT_BURST_WINDOW_MS
    ))
  ) {
    return { error: t("לאט יותר — המתן רגע לפני ההודעה הבאה") };
  }

  try {
    const me = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { name: true },
    });
    if (!me) return { error: t("לא מחובר") };

    let recipient: { id: string; name: string } | null = null;
    if (toEmpireId !== null) {
      if (toEmpireId === empireId) {
        return { error: t("אי אפשר לשלוח הודעה לעצמך") };
      }
      recipient = await prisma.empire.findFirst({
        where: { id: toEmpireId, user: notBannedWhere() },
        select: { id: true, name: true },
      });
      if (!recipient) return { error: t("השחקן לא נמצא") };
    }

    // Volume budget. The room and private conversations get separate ones: a
    // long private conversation must not use up somebody's right to speak in
    // the room, and drowning the room must not be reachable by DMing instead.
    const allowed = recipient
      ? await rateLimit(
          `chat-direct:${empireId}`,
          CHAT_DIRECT_LIMIT,
          CHAT_DIRECT_WINDOW_MS
        )
      : await rateLimit(
          `chat-global:${empireId}`,
          CHAT_GLOBAL_LIMIT,
          CHAT_GLOBAL_WINDOW_MS
        );
    if (!allowed) {
      return { error: t("שלחת יותר מדי הודעות — המתן דקה") };
    }

    // Per-conversation budget: the volume cap above still allows a whole minute
    // aimed at one player. Keyed on the unordered pair so it cannot be reset by
    // swapping who writes first.
    if (
      recipient &&
      !(await rateLimit(
        `chat-pair:${threadKey(empireId, recipient.id)}`,
        CHAT_PAIR_LIMIT,
        CHAT_PAIR_WINDOW_MS
      ))
    ) {
      return { error: t("יותר מדי הודעות בשיחה הזו — המתן דקה") };
    }

    // "Did I just say this?" — the one spam shape a per-minute budget cannot
    // see. Scoped to the same destination, so the same words in the room and in
    // a conversation are two different statements.
    const previous = await prisma.chatMessage.findFirst({
      where: {
        senderEmpireId: empireId,
        channel: recipient ? "DIRECT" : "GLOBAL",
        recipientEmpireId: recipient ? recipient.id : null,
      },
      orderBy: { createdAt: "desc" },
      select: { body: true, createdAt: true },
    });
    const now = new Date();
    if (isRepeat(body, previous, now)) {
      return { error: t("כבר כתבת את זה") };
    }

    const row = await prisma.chatMessage.create({
      data: {
        channel: recipient ? "DIRECT" : "GLOBAL",
        senderEmpireId: empireId,
        senderName: me.name,
        recipientEmpireId: recipient?.id ?? null,
        body,
        // Explicit, never the column default: the database's CURRENT_TIMESTAMP
        // writes local wall time, which lands three hours ahead of every other
        // timestamp the app writes.
        createdAt: now,
      },
      select: LINE_SELECT,
    });

    await clearTyping(empireId);
    return { line: toLine(row, empireId) };
  } catch (err) {
    await logError("chat.sendChat", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * The standing roster the private tab opens on: who else is in the game, the
 * ones who are here right now first.
 *
 * Ordered by the heartbeat rather than by name, because "who can I actually
 * talk to" is the question the list is answering — online players sort to the
 * top by construction, and the tail reads as "was here recently". Bounded: past
 * CHAT_ROSTER_MAX the search box is the way through, so the list can never
 * become a full directory scan on every poll.
 */
export async function getChatRoster(): Promise<ChatPlayer[]> {
  try {
    const empireId = await requireOwnEmpireId();
    if (!pollAllowed("roster", empireId)) return [];
    await touchPresence(empireId);

    const rows = await prisma.empire.findMany({
      where: { id: { not: empireId }, user: notBannedWhere() },
      orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      take: CHAT_ROSTER_MAX,
      select: { id: true, name: true, lastSeenAt: true, isBot: true },
    });
    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      online: isOnline(row, now),
    }));
  } catch {
    return [];
  }
}

export type ChatDirectory = {
  threads: ChatThread[];
  roster: ChatPlayer[];
  /** The pinned conversation with the game's staff, or null when the player has
   *  never opened one. The row is drawn either way — see ChatDock. */
  staff: SupportSummary;
};

/**
 * Everything the private tab shows, in one round trip: the conversations you
 * already have, and the players you could start one with. They are polled
 * together and rendered together, so they travel together — two actions here
 * would be two requests every eight seconds for one screen.
 */
export async function getChatDirectory(): Promise<ChatDirectory> {
  const [threads, roster, staff] = await Promise.all([
    getChatThreads(),
    getChatRoster(),
    getSupportSummary(),
  ]);
  return { threads, roster, staff };
}

/**
 * Name search, for reaching someone past the end of the roster. A prefix of two
 * characters is enough to find a player you already know of.
 *
 * **Deliberately does not report presence.** Search is a lookup *by name*, which
 * makes it a targeted question — "is this particular empire at the keyboard right
 * now?" — asked for free, without limit, about anybody in the game. That is real
 * intelligence in a game where the whole point of knowing a rival is away is that
 * their gold is not in the bank and they will not re-shield. Everywhere else the
 * game charges turns for a look at another empire (see spyOnEmpire), and this was
 * a sharper answer than a spy mission for nothing.
 *
 * The roster and the thread list still carry the dot, and should: there the
 * question is "who can I talk to", asked of a bounded list you did not choose,
 * which is what a presence indicator is for. Search answers "where is *he*", and
 * that one it does not answer.
 */
export async function searchChatPlayers(query: string): Promise<ChatPlayer[]> {
  try {
    const empireId = await requireOwnEmpireId();
    const q = String(query ?? "").trim();
    if (q.length < CHAT_SEARCH_MIN) return [];
    // `contains` is a scan the index cannot serve, so this one is worth a ceiling
    // even though a human types it.
    if (!pollAllowed("search", empireId)) return [];

    const rows = await prisma.empire.findMany({
      where: {
        id: { not: empireId },
        name: { contains: q, mode: "insensitive" },
        user: notBannedWhere(),
      },
      orderBy: { name: "asc" },
      take: CHAT_SEARCH_MAX_RESULTS,
      // No lastSeenAt: it must not be possible to derive it from what ships.
      select: { id: true, name: true },
    });
    // `online` left undefined — not false. See ChatPlayer.
    return rows.map((row) => ({ id: row.id, name: row.name }));
  } catch {
    return [];
  }
}

/**
 * Moderation: take a line out of the room. Hidden rather than deleted, so the
 * audit row points at something that still exists and a mistake can be undone
 * with a single UPDATE.
 */
export async function hideChatMessage(
  messageId: string
): Promise<{ ok: true } | { error: string }> {
  const t = await getT();
  try {
    const admin = await getSessionUser();
    // getSessionUser, not requireAdmin: this is an action, not a route, so a
    // non-admin caller gets a refusal rather than a redirect.
    if (!admin || admin.role !== "ADMIN") return { error: t("אין הרשאה") };

    const hidden = await prisma.chatMessage.updateMany({
      where: { id: String(messageId), hiddenAt: null },
      data: { hiddenAt: new Date(), hiddenById: admin.id },
    });
    if (hidden.count === 0) return { error: t("ההודעה כבר הוסרה") };

    await logAdmin(admin, {
      action: "chat.hide",
      targetType: "ChatMessage",
      targetId: String(messageId),
      // i18n-exempt: an admin audit-log line, read only in the control centre.
      summary: "הסתיר הודעת צ׳אט",
    });
    return { ok: true };
  } catch (err) {
    await logError("chat.hideChatMessage", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
