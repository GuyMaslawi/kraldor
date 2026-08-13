import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { formatGameTime } from "@/lib/game/time";
import { SUPPORT_COOKIE, SUPPORT_ID_MAX } from "@/lib/support";

/**
 * Who a support conversation belongs to — the one question both halves of the
 * channel have to answer the same way.
 *
 * The support chat was written for a visitor with *no account*, so a thread is
 * named by a secret in a cookie. Once the same channel is opened from inside the
 * game that is no longer enough, in both directions:
 *
 *  - a player who wrote to us from their phone and then logs in on a desktop is
 *    the same person with the same problem, and must find the same conversation;
 *  - two players sharing a browser are *not* the same person, and the second one
 *    must not be handed the first one's ticket by a cookie that outlived them.
 *
 * So identity wins wherever there is one: a signed-in caller is resolved by
 * `userId` first, and the cookie is only consulted for a thread that no account
 * has claimed yet (the ordinary "wrote in from the login screen, then got in"
 * case, which `sendSupportMessage` then stamps with the account).
 *
 * Kept out of `actions/support.ts` because a `"use server"` module may only
 * export async actions, and the chat's badge poll needs to read this too —
 * exporting the resolver from there would publish an endpoint per helper.
 */

/** The columns every caller of the resolver needs, in one read. */
const THREAD_SELECT = {
  id: true,
  status: true,
  email: true,
  userId: true,
  visitorReadAt: true,
  lastMessageAt: true,
  notifiedAt: true,
} as const;

export type MySupportThread = {
  id: string;
  status: "OPEN" | "CLOSED";
  email: string | null;
  userId: string | null;
  visitorReadAt: Date | null;
  lastMessageAt: Date;
  notifiedAt: Date | null;
};

/** SHA-256 of a cookie token. The raw value is never stored — see SupportThread. */
export function hashSupportToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * The visitor's token, from their cookie. Never trusted for anything but a
 * hashed lookup: it names a row, it does not assert anything about who is
 * holding it.
 */
export async function readSupportToken(): Promise<string | null> {
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

/** The session behind the request, or null. Swallowed: this channel answers
 *  people whose session is exactly what is broken. */
async function sessionUserId(): Promise<string | null> {
  try {
    return await getSessionUserId();
  } catch {
    return null;
  }
}

/**
 * This caller's support conversation, or null.
 *
 * For a signed-in player that is one indexed read and, in the overwhelmingly
 * common case of a player who has never written to us, one read that finds
 * nothing — which matters, because the chat dock's badge poll runs it.
 */
export async function findMySupportThread(): Promise<MySupportThread | null> {
  const [userId, token] = await Promise.all([sessionUserId(), readSupportToken()]);

  if (userId) {
    const mine = await prisma.supportThread.findFirst({
      where: { userId },
      // Somebody who opened a second ticket is asking about the newest thing.
      orderBy: { lastMessageAt: "desc" },
      select: THREAD_SELECT,
    });
    if (mine) return mine;
    if (!token) return null;
    const cookieThread = await prisma.supportThread.findUnique({
      where: { tokenHash: hashSupportToken(token) },
      select: THREAD_SELECT,
    });
    // Only an unclaimed thread: one that already belongs to another account is
    // that account's, whatever cookie this browser is still carrying.
    return cookieThread && cookieThread.userId === null ? cookieThread : null;
  }

  if (!token) return null;
  return prisma.supportThread.findUnique({
    where: { tokenHash: hashSupportToken(token) },
    select: THREAD_SELECT,
  });
}

/** Staff replies newer than the visitor's last look. The cheap flag first: the
 *  count is only worth a query once something has actually arrived. */
export async function countSupportUnread(
  thread: Pick<MySupportThread, "id" | "visitorReadAt" | "lastMessageAt">
): Promise<number> {
  const unseen =
    thread.visitorReadAt === null ||
    thread.visitorReadAt.getTime() < thread.lastMessageAt.getTime();
  if (!unseen) return 0;
  return prisma.supportMessage.count({
    where: {
      threadId: thread.id,
      fromStaff: true,
      ...(thread.visitorReadAt ? { createdAt: { gt: thread.visitorReadAt } } : {}),
    },
  });
}

/** What the chat dock's pinned "צוות קראלדור" row shows. Null when this player
 *  has never written in — the row still renders, it just has nothing to preview. */
export type SupportSummary = {
  unread: number;
  preview: string;
  at: number;
  time: string;
  closed: boolean;
} | null;

/**
 * The pinned row, in at most three small reads, and one read for the player who
 * has no ticket. Polled from the private tab alongside the thread list.
 */
export async function getSupportSummary(): Promise<SupportSummary> {
  try {
    const thread = await findMySupportThread();
    if (!thread) return null;
    const [unread, last] = await Promise.all([
      countSupportUnread(thread),
      prisma.supportMessage.findFirst({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        select: { body: true, createdAt: true },
      }),
    ]);
    return {
      unread,
      preview: last?.body.slice(0, 120) ?? "",
      at: last?.createdAt.getTime() ?? thread.lastMessageAt.getTime(),
      time: formatGameTime(last?.createdAt ?? thread.lastMessageAt),
      closed: thread.status === "CLOSED",
    };
  } catch {
    // A badge, never an error: a missed round just draws nothing.
    return null;
  }
}

/** Just the badge — what the shut dock's heartbeat asks for. */
export async function getSupportUnread(): Promise<number> {
  try {
    const thread = await findMySupportThread();
    if (!thread) return 0;
    return await countSupportUnread(thread);
  } catch {
    return 0;
  }
}
