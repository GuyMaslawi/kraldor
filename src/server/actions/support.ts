"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getSessionUser, logAdmin } from "@/lib/admin";
import { isBanned } from "@/lib/ban";
import {
  POLL_LIMIT,
  POLL_WINDOW_MS,
  clientIp,
  clientIpForStorage,
  localRateLimit,
  rateLimit,
} from "@/lib/rateLimit";
import { formatGameTime } from "@/lib/game/time";
import { logError } from "@/server/errorLog";
import { announceToDiscord } from "@/server/discord";
import { appBaseUrl } from "@/server/mailer";
import { getT } from "@/i18n/server";
import {
  SUPPORT_BODY_MAX,
  SUPPORT_BURST_LIMIT,
  SUPPORT_BURST_WINDOW_MS,
  SUPPORT_COOKIE,
  SUPPORT_COOKIE_MAX_AGE_S,
  SUPPORT_ID_MAX,
  SUPPORT_INBOX_MAX,
  SUPPORT_IP_LIMIT,
  SUPPORT_IP_WINDOW_MS,
  SUPPORT_NEW_LIMIT,
  SUPPORT_NEW_WINDOW_MS,
  SUPPORT_PAGE_SIZE,
  SUPPORT_PING_COOLDOWN_MS,
  SUPPORT_SEND_LIMIT,
  SUPPORT_SEND_WINDOW_MS,
  isSupportRepeat,
  normalizeSupportBody,
  normalizeSupportEmail,
  parseSupportSince,
} from "@/lib/support";

/**
 * The support chat's whole server surface: the visitor's half, which runs in
 * front of the login screen with no session at all, and the staff's half behind
 * `/admin/support`.
 *
 * Everything the visitor can reach is written for a caller who **has no
 * account**, and that shapes the file:
 *
 *  - there is no season gate. The break is when the site is most confusing, and
 *    "the game is shut" is not a reason to stop answering the person asking why;
 *  - there is no ban check either. Arguing a ban is a support request, and a
 *    channel that closes the moment it is needed is not a support channel. What
 *    holds the abuse back is the rate limiting, which is per-thread, per-address
 *    and layered;
 *  - identity is a cookie, and the cookie is a *secret*, so only its hash is
 *    stored. Anyone holding the token reads that conversation and no other; the
 *    database holds nothing that reconstructs it.
 */

/* --------------------------------- shapes -------------------------------- */

export type SupportLine = {
  id: string;
  /** Written by us, not by the visitor. Drives which side of the panel it sits on. */
  fromStaff: boolean;
  name: string;
  body: string;
  /** Epoch ms — the client's dedupe/high-water key. */
  at: number;
  /** Jerusalem wall time (HH:MM), formatted server-side like every other clock. */
  time: string;
};

export type SupportView = {
  /** Whether this visitor has a conversation at all. False before the first send. */
  exists: boolean;
  status: "OPEN" | "CLOSED";
  lines: SupportLine[];
  /** Staff replies this visitor has not seen — the launcher's badge. */
  unread: number;
  /** The reply-to they gave us, echoed back so the form does not ask twice. */
  email: string | null;
};

export type SupportSendResult = { line: SupportLine } | { error: string };

const EMPTY: SupportView = {
  exists: false,
  status: "OPEN",
  lines: [],
  unread: 0,
  email: null,
};

/* -------------------------------- identity ------------------------------- */

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * The visitor's token, from their cookie. Never trusted for anything but a
 * hashed lookup: it names a row, it does not assert anything about who is
 * holding it.
 */
async function readToken(): Promise<string | null> {
  try {
    const store = await cookies();
    const raw = store.get(SUPPORT_COOKIE)?.value;
    if (!raw || raw.length === 0 || raw.length > SUPPORT_ID_MAX) return null;
    return raw;
  } catch {
    // No request in scope (a script, a test). There is no visitor either.
    return null;
  }
}

/** Mint a fresh token and hand it to the browser. 32 random bytes, hex. */
async function issueToken(): Promise<string> {
  const token = randomBytes(24).toString("hex");
  const store = await cookies();
  store.set(SUPPORT_COOKIE, token, {
    // The token is a bearer credential for one conversation: script must not be
    // able to read it, and it must not ride along on cross-site requests.
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SUPPORT_COOKIE_MAX_AGE_S,
  });
  return token;
}

/**
 * Who is writing, as far as the app can tell — for the staff reading it later,
 * never as an authorisation.
 *
 * Read straight off the session rather than through `getActiveEmpireId`, because
 * that helper refuses exactly the people this channel exists for: unverified,
 * banned, or writing during a season break. Failures are swallowed; an
 * unidentifiable visitor is the normal case here, not an error.
 */
async function describeVisitor(): Promise<{
  userId: string | null;
  empireName: string | null;
  name: string;
}> {
  const t = await getT();
  const fallback = { userId: null, empireName: null, name: t("אורח") };
  try {
    const userId = await getSessionUserId();
    if (!userId) return fallback;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, empire: { select: { name: true } } },
    });
    if (!user) return fallback;
    return {
      userId,
      empireName: user.empire?.name ?? null,
      name: user.empire?.name ?? user.name,
    };
  } catch {
    return fallback;
  }
}

/**
 * The screen the visitor is on, for the ticket's context line.
 *
 * A server action's request carries no pathname of its own — the action is
 * POSTed to whatever route invoked it — so this reads the referer and keeps only
 * its path. The widget also passes what the browser knows, which is the better
 * source; this is the fallback for when it does not.
 */
async function requestPath(): Promise<string | null> {
  try {
    const referer = (await headers()).get("referer");
    if (!referer) return null;
    // Path only: the full URL adds an origin we already know and any query
    // string the visitor happened to be carrying.
    return new URL(referer).pathname.slice(0, 300);
  } catch {
    return null;
  }
}

async function userAgent(): Promise<string | null> {
  try {
    return (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------- mapping -------------------------------- */

type MessageRow = {
  id: string;
  fromStaff: boolean;
  authorName: string;
  body: string;
  createdAt: Date;
};

const MESSAGE_SELECT = {
  id: true,
  fromStaff: true,
  authorName: true,
  body: true,
  createdAt: true,
} as const;

function toLine(row: MessageRow): SupportLine {
  return {
    id: row.id,
    fromStaff: row.fromStaff,
    name: row.authorName,
    body: row.body,
    at: row.createdAt.getTime(),
    time: formatGameTime(row.createdAt),
  };
}

/* ------------------------------ visitor side ----------------------------- */

/**
 * Whether this browser already has a conversation.
 *
 * Called from the auth shell so the widget knows, at first paint, whether to
 * poll at all. Every visitor to the login page runs this; a visitor with no
 * cookie costs one cookie read and no query, which is the whole point of asking
 * it here rather than letting the widget find out by polling.
 */
export async function hasSupportThread(): Promise<boolean> {
  const token = await readToken();
  if (!token) return false;
  try {
    const found = await prisma.supportThread.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true },
    });
    return found !== null;
  } catch {
    return false;
  }
}

/**
 * The visitor's conversation, or an empty view when they have none.
 *
 * `reading` is the read receipt: the panel is open and the words are on screen,
 * so the unread badge is cleared. A shut panel polls with it false and keeps its
 * badge. The write is conditional on there actually being something newer than
 * the last receipt, so an idle open panel does not issue an UPDATE every six
 * seconds for nothing.
 */
export async function getSupportChat(input?: {
  sinceMs?: number;
  reading?: boolean;
}): Promise<SupportView> {
  try {
    const token = await readToken();
    if (!token) return EMPTY;
    const tokenHash = hashToken(token);

    const thread = await prisma.supportThread.findUnique({
      where: { tokenHash },
      select: { id: true, status: true, email: true, visitorReadAt: true },
    });
    if (!thread) return EMPTY;

    // Free, per-instance ceiling on a polled read — see localRateLimit. A
    // refused round returns the empty view and the panel simply asks again.
    if (!localRateLimit(`poll:support:${thread.id}`, POLL_LIMIT, POLL_WINDOW_MS)) {
      return EMPTY;
    }

    const since = parseSupportSince(input?.sinceMs);
    const rows = await prisma.supportMessage.findMany({
      where: {
        threadId: thread.id,
        // `gte`, not `gt`: two lines can share a millisecond and a strict cursor
        // would drop the second forever. The overlap is a duplicate id, which
        // the client already filters.
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: SUPPORT_PAGE_SIZE,
      select: MESSAGE_SELECT,
    });

    const unread = await prisma.supportMessage.count({
      where: {
        threadId: thread.id,
        fromStaff: true,
        ...(thread.visitorReadAt ? { createdAt: { gt: thread.visitorReadAt } } : {}),
      },
    });

    if (input?.reading && unread > 0) {
      await prisma.supportThread.update({
        where: { id: thread.id },
        data: { visitorReadAt: new Date() },
      });
    }

    return {
      exists: true,
      status: thread.status,
      // Oldest first: the panel renders top-to-bottom and appends at the end.
      lines: rows.reverse().map(toLine),
      unread: input?.reading ? 0 : unread,
      email: thread.email,
    };
  } catch (err) {
    await logError("support.getSupportChat", err);
    return EMPTY;
  }
}

/**
 * Say something to the staff — and open the conversation if this is the first
 * line.
 *
 * The written line comes back so the sender sees it land immediately instead of
 * waiting out a poll interval. Everything else is re-derived here: the body is
 * normalized and re-validated, the address is re-parsed, and the context (path,
 * agent, session) is read off the request rather than taken from the client,
 * because a server action is reachable by direct POST.
 */
export async function sendSupportMessage(input: {
  body: string;
  email?: string | null;
  /** The screen the widget was open on, when the browser knows it better than
   *  the referer does. Advisory only — bounded before it is stored. */
  path?: string | null;
}): Promise<SupportSendResult> {
  const t = await getT();

  const body = normalizeSupportBody(String(input?.body ?? ""));
  if (body.length === 0) {
    return { error: t("כתוב הודעה (עד {max} תווים)", { max: SUPPORT_BODY_MAX }) };
  }

  const ip = await clientIp();

  // Burst first: the cheapest refusal, and the one a paste loop trips.
  if (
    !(await rateLimit(
      `support-burst:${ip}`,
      SUPPORT_BURST_LIMIT,
      SUPPORT_BURST_WINDOW_MS
    ))
  ) {
    return { error: t("לאט יותר — המתן רגע לפני ההודעה הבאה") };
  }

  // The backstop the per-thread budgets cannot be: a thread is named by a cookie
  // the client controls, so deleting it hands out a fresh bucket. The address
  // behind it gets its own ceiling, counted across every thread it opens.
  if (!(await rateLimit(`support-ip:${ip}`, SUPPORT_IP_LIMIT, SUPPORT_IP_WINDOW_MS))) {
    return { error: t("נשלחו יותר מדי הודעות מהכתובת הזו. נסה שוב בעוד שעה.") };
  }

  try {
    const token = await readToken();
    const existing = token
      ? await prisma.supportThread.findUnique({
          where: { tokenHash: hashToken(token) },
          select: { id: true, email: true, status: true, notifiedAt: true },
        })
      : null;

    const email = normalizeSupportEmail(input?.email);
    const visitor = await describeVisitor();
    const now = new Date();

    let threadId: string;
    let firstMessage = false;
    let notifiedAt: Date | null = null;

    if (existing) {
      threadId = existing.id;
      notifiedAt = existing.notifiedAt;

      // Per-conversation volume budget.
      if (
        !(await rateLimit(
          `support-send:${threadId}`,
          SUPPORT_SEND_LIMIT,
          SUPPORT_SEND_WINDOW_MS
        ))
      ) {
        return { error: t("שלחת יותר מדי הודעות — המתן כמה דקות") };
      }

      // "Did I just say this?" — the spam shape no per-minute budget sees.
      const previous = await prisma.supportMessage.findFirst({
        where: { threadId, fromStaff: false },
        orderBy: { createdAt: "desc" },
        select: { body: true, createdAt: true },
      });
      if (isSupportRepeat(body, previous, now)) {
        return { error: t("כבר כתבת את זה") };
      }

      await prisma.supportThread.update({
        where: { id: threadId },
        data: {
          // A visitor writing into a closed ticket reopens it. "Closed" is our
          // opinion about their problem, and they are entitled to disagree.
          status: "OPEN",
          lastMessageAt: now,
          // They are looking at the panel they just wrote into.
          visitorReadAt: now,
          // Only ever fills a blank: an address given once is not silently
          // dropped because a later message left the field empty.
          ...(email && !existing.email ? { email } : {}),
          ...(visitor.userId ? { userId: visitor.userId } : {}),
          ...(visitor.empireName ? { empireName: visitor.empireName } : {}),
        },
      });
    } else {
      // Opening a conversation is the expensive half — a row, and a Discord
      // ping. Budgeted by address, because there is no thread to budget by yet.
      if (
        !(await rateLimit(
          `support-new:${ip}`,
          SUPPORT_NEW_LIMIT,
          SUPPORT_NEW_WINDOW_MS
        ))
      ) {
        return { error: t("נפתחו יותר מדי פניות מהכתובת הזו. נסה שוב מאוחר יותר.") };
      }

      // Minted only now, so a visitor who never writes never gets a cookie —
      // the widget must not be a tracker for people who only read the page.
      //
      // Always a fresh token, never the one that arrived. A cookie the browser
      // presents but no thread matches is either stale (its thread was deleted)
      // or planted — and a planted one would let whoever planted it read the
      // conversation the victim is about to start. Minting our own costs
      // nothing and closes that.
      const fresh = await issueToken();
      const path =
        (typeof input?.path === "string" && input.path.length > 0
          ? input.path.slice(0, 300)
          : null) ?? (await requestPath());

      const created = await prisma.supportThread.create({
        data: {
          tokenHash: hashToken(fresh),
          email,
          userId: visitor.userId,
          empireName: visitor.empireName,
          path,
          userAgent: await userAgent(),
          ip: await clientIpForStorage(),
          lastMessageAt: now,
          visitorReadAt: now,
        },
        select: { id: true },
      });
      threadId = created.id;
      firstMessage = true;
    }

    const row = await prisma.supportMessage.create({
      data: {
        threadId,
        fromStaff: false,
        authorName: visitor.name,
        body,
        // Explicit, never the column default: the database's CURRENT_TIMESTAMP
        // writes local wall time, three hours off every other stamp we write.
        createdAt: now,
      },
      select: MESSAGE_SELECT,
    });

    // Outside every transaction and never awaited for its outcome — see
    // announceToDiscord. A quiet channel must not cost the visitor their message.
    await pingStaff({
      threadId,
      firstMessage,
      notifiedAt,
      body,
      who: visitor.empireName ?? visitor.name,
      email: email ?? existing?.email ?? null,
      now,
    });

    return { line: toLine(row) };
  } catch (err) {
    await logError("support.sendSupportMessage", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * Tell whoever is on duty that somebody is waiting.
 *
 * Cooldown-guarded rather than fired per message: a person describing a problem
 * writes in bursts, and one notification per burst is the signal — one per line
 * is what makes a team mute the channel. The first message of a new thread always
 * pings, whatever the cooldown says, because that is the one that means "a new
 * person is stuck".
 */
async function pingStaff(args: {
  threadId: string;
  firstMessage: boolean;
  notifiedAt: Date | null;
  body: string;
  who: string;
  email: string | null;
  now: Date;
}): Promise<void> {
  const { threadId, firstMessage, notifiedAt, body, who, email, now } = args;
  const cooled =
    notifiedAt === null ||
    now.getTime() - notifiedAt.getTime() > SUPPORT_PING_COOLDOWN_MS;
  if (!firstMessage && !cooled) return;

  try {
    const posted = await announceToDiscord({
      kind: "support",
      channel: "support",
      // i18n-exempt: staff-facing, posted into the team's own room.
      title: firstMessage ? `פנייה חדשה — ${who}` : `הודעה נוספת — ${who}`,
      body: email ? `${body}\n\n📧 ${email}` : body,
      url: `${appBaseUrl()}/admin/support?thread=${threadId}`,
    });
    // Stamped only on a post that actually went out, so a misconfigured webhook
    // does not silence the next hour of tickets.
    if (posted) {
      await prisma.supportThread.update({
        where: { id: threadId },
        data: { notifiedAt: now },
      });
    }
  } catch (err) {
    await logError("support.pingStaff", err);
  }
}

/* ------------------------------- staff side ------------------------------ */

export type SupportInboxRow = {
  id: string;
  status: "OPEN" | "CLOSED";
  /** Who wrote in: their empire, their account name, or "אורח". */
  who: string;
  email: string | null;
  path: string | null;
  /** Last line either side wrote. */
  preview: string;
  /** Whether that last line was theirs — i.e. the ball is in our court. */
  waiting: boolean;
  at: number;
  time: string;
  /**
   * Something has arrived since the ticket was last opened.
   *
   * A flag rather than a count on purpose: an exact per-thread count cannot come
   * out of one grouped query (each thread has its own read receipt), so it would
   * cost one query per listed row — sixty queries to draw sixty badges that all
   * say the same thing, which is "look at this one".
   */
  unseen: boolean;
};

export type SupportThreadView = {
  id: string;
  status: "OPEN" | "CLOSED";
  who: string;
  email: string | null;
  path: string | null;
  userAgent: string | null;
  ip: string | null;
  userId: string | null;
  openedAt: number;
  lines: SupportLine[];
};

/** An admin session, or null. Actions answer with a refusal, never a redirect. */
async function requireStaff() {
  const admin = await getSessionUser();
  if (!admin || admin.role !== "ADMIN" || isBanned(admin)) return null;
  return admin;
}

/**
 * The inbox: newest activity first, bounded, and it is *the* polled read on the
 * admin screen — so it is one query and one query only, whatever it is showing.
 */
export async function getSupportInbox(
  filter: "open" | "all" = "open"
): Promise<SupportInboxRow[]> {
  const admin = await requireStaff();
  if (!admin) return [];
  try {
    if (!localRateLimit(`poll:support-inbox:${admin.id}`, POLL_LIMIT, POLL_WINDOW_MS)) {
      return [];
    }
    const threads = await prisma.supportThread.findMany({
      where: filter === "open" ? { status: "OPEN" } : {},
      orderBy: { lastMessageAt: "desc" },
      take: SUPPORT_INBOX_MAX,
      select: {
        id: true,
        status: true,
        email: true,
        empireName: true,
        path: true,
        staffReadAt: true,
        lastMessageAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, fromStaff: true, authorName: true },
        },
      },
    });

    return threads.map((thread) => {
      const last = thread.messages[0];
      return {
        id: thread.id,
        status: thread.status,
        // i18n-exempt: the admin inbox is Hebrew-only, like the rest of /admin.
        who: thread.empireName ?? last?.authorName ?? "אורח",
        email: thread.email,
        path: thread.path,
        preview: last?.body.slice(0, 160) ?? "",
        waiting: last ? !last.fromStaff : true,
        at: thread.lastMessageAt.getTime(),
        time: formatGameTime(thread.lastMessageAt),
        unseen:
          thread.staffReadAt === null ||
          thread.staffReadAt.getTime() < thread.lastMessageAt.getTime(),
      };
    });
  } catch (err) {
    await logError("support.getSupportInbox", err);
    return [];
  }
}

/**
 * The work queue, as a `where`.
 *
 * "Waiting" is deliberately not "open": a thread we have already answered is
 * open until somebody closes it, and counting those would leave a permanent red
 * number that nobody can clear. This is the ones whose newest line is theirs.
 *
 * A function rather than a constant because it closes over a Prisma field
 * reference, which must be read off the client after it has been constructed.
 */
function waitingWhere() {
  return {
    status: "OPEN" as const,
    OR: [
      { staffReadAt: null },
      { staffReadAt: { lt: prisma.supportThread.fields.lastMessageAt } },
    ],
  };
}

/** How many tickets are waiting on us — the badge in the admin nav. */
export async function countWaitingSupport(): Promise<number> {
  const admin = await requireStaff();
  if (!admin) return 0;
  try {
    return await prisma.supportThread.count({ where: waitingWhere() });
  } catch (err) {
    await logError("support.countWaitingSupport", err);
    return 0;
  }
}

export type SupportPulse = {
  /** Tickets whose newest line is the visitor's. */
  waiting: number;
  /**
   * This round learned nothing — throttled, not staff, or a hiccup. Same
   * contract as the player's inbox pulse: the caller keeps its last good count
   * rather than letting a refused round read as "nothing is waiting".
   */
  stale: boolean;
};

const STALE_SUPPORT_PULSE: SupportPulse = { waiting: 0, stale: true };

/**
 * The same count, polled from the game's command bar so an admin who is playing
 * finds out that somebody is stuck without walking into `/admin`.
 *
 * This is the alert of last resort, and the only one that always works: the
 * Discord ping needs `DISCORD_WEBHOOK_URL_SUPPORT` to be configured, and the
 * badge in the admin nav is only visible to somebody who is already looking at
 * the control centre. A person who cannot get past the login screen has no
 * other way to reach us, so noticing them must not depend on either.
 */
export async function getSupportPulse(): Promise<SupportPulse> {
  try {
    const admin = await requireStaff();
    if (!admin) return STALE_SUPPORT_PULSE;
    if (!localRateLimit(`poll:support-pulse:${admin.id}`, POLL_LIMIT, POLL_WINDOW_MS)) {
      return STALE_SUPPORT_PULSE;
    }
    const waiting = await prisma.supportThread.count({ where: waitingWhere() });
    return { waiting, stale: false };
  } catch (err) {
    await logError("support.getSupportPulse", err);
    return STALE_SUPPORT_PULSE;
  }
}

/** One ticket, in full, and the read receipt for it. */
export async function getSupportThread(
  threadId: string,
  sinceMs?: number
): Promise<SupportThreadView | null> {
  const admin = await requireStaff();
  if (!admin) return null;
  if (typeof threadId !== "string" || threadId.length === 0 || threadId.length > SUPPORT_ID_MAX) {
    return null;
  }
  try {
    if (!localRateLimit(`poll:support-admin:${admin.id}`, POLL_LIMIT, POLL_WINDOW_MS)) {
      return null;
    }
    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        status: true,
        email: true,
        empireName: true,
        path: true,
        userAgent: true,
        ip: true,
        userId: true,
        createdAt: true,
        lastMessageAt: true,
        staffReadAt: true,
      },
    });
    if (!thread) return null;

    const since = parseSupportSince(sinceMs);
    const rows = await prisma.supportMessage.findMany({
      where: {
        threadId: thread.id,
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: SUPPORT_PAGE_SIZE,
      select: MESSAGE_SELECT,
    });

    // Opening a ticket is what marks it read — conditional, so a ticket left
    // open on a second monitor does not write every poll.
    if (
      !thread.staffReadAt ||
      thread.staffReadAt.getTime() < thread.lastMessageAt.getTime()
    ) {
      await prisma.supportThread.update({
        where: { id: thread.id },
        data: { staffReadAt: new Date() },
      });
    }

    return {
      id: thread.id,
      status: thread.status,
      who: thread.empireName ?? rows.find((row) => !row.fromStaff)?.authorName ?? "אורח",
      email: thread.email,
      path: thread.path,
      userAgent: thread.userAgent,
      ip: thread.ip,
      userId: thread.userId,
      openedAt: thread.createdAt.getTime(),
      lines: rows.reverse().map(toLine),
    };
  } catch (err) {
    await logError("support.getSupportThread", err);
    return null;
  }
}

/** Answer a ticket. The visitor sees it on their next poll, wherever they are. */
export async function replyToSupport(input: {
  threadId: string;
  body: string;
}): Promise<SupportSendResult> {
  const t = await getT();
  const admin = await requireStaff();
  if (!admin) return { error: t("אין הרשאה") };

  const body = normalizeSupportBody(String(input?.body ?? ""));
  if (body.length === 0) {
    return { error: t("כתוב הודעה (עד {max} תווים)", { max: SUPPORT_BODY_MAX }) };
  }
  const threadId = String(input?.threadId ?? "");
  if (threadId.length === 0 || threadId.length > SUPPORT_ID_MAX) {
    return { error: t("הפנייה לא נמצאה") };
  }

  try {
    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      select: { id: true },
    });
    if (!thread) return { error: t("הפנייה לא נמצאה") };

    const now = new Date();
    const row = await prisma.supportMessage.create({
      data: {
        threadId: thread.id,
        fromStaff: true,
        staffId: admin.id,
        // The team speaks with one voice, not with an admin's personal name: a
        // player writing to "the game" should be answered by it. Which admin
        // actually typed it is on the row, for us.
        authorName: "צוות קראלדור",
        body,
        createdAt: now,
      },
      select: MESSAGE_SELECT,
    });
    await prisma.supportThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: now, staffReadAt: now, status: "OPEN" },
    });
    return { line: toLine(row) };
  } catch (err) {
    await logError("support.replyToSupport", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * Close a ticket, or reopen one. Closing is a filing decision, not a lock: the
 * visitor keeps the whole transcript and writing again reopens it.
 */
export async function setSupportStatus(input: {
  threadId: string;
  status: "OPEN" | "CLOSED";
}): Promise<{ ok: true } | { error: string }> {
  const t = await getT();
  const admin = await requireStaff();
  if (!admin) return { error: t("אין הרשאה") };

  const threadId = String(input?.threadId ?? "");
  const status = input?.status === "CLOSED" ? "CLOSED" : "OPEN";
  if (threadId.length === 0 || threadId.length > SUPPORT_ID_MAX) {
    return { error: t("הפנייה לא נמצאה") };
  }

  try {
    const changed = await prisma.supportThread.updateMany({
      where: { id: threadId, status: status === "CLOSED" ? "OPEN" : "CLOSED" },
      data: { status, staffReadAt: new Date() },
    });
    if (changed.count === 0) return { error: t("הפנייה כבר במצב הזה") };

    await logAdmin(admin, {
      action: status === "CLOSED" ? "support.close" : "support.reopen",
      targetType: "SupportThread",
      targetId: threadId,
      // i18n-exempt: an admin audit-log line, read only in the control centre.
      summary: status === "CLOSED" ? "סגר פניית תמיכה" : "פתח מחדש פניית תמיכה",
    });
    return { ok: true };
  } catch (err) {
    await logError("support.setSupportStatus", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
