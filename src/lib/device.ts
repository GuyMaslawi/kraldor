import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * The browser-profile cookie behind the self-invite check.
 *
 * ## What it is
 *
 * One opaque random value, minted the first time a browser touches a path that
 * can write cookies (an invite link, a sign-in, a registration) and never
 * changed afterwards. Every successful authentication records the pair
 * `(deviceId, userId)` in `DeviceAccount`, which turns the question "are these
 * two accounts one person?" into an indexed lookup.
 *
 * ## Why it exists at all
 *
 * הזמנת חבר pays diamonds for bringing a player in, so the obvious attack is to
 * be both sides of it. The only signal the game had for that was a shared IP
 * address — and an address is a household, a dorm, an office or a mobile
 * carrier's NAT long before it is a farm. Two brothers on one router is the most
 * common *real* referral there is, so a shared address can only ever buy a human
 * look (see src/server/referralGuard.ts).
 *
 * A browser profile is a different claim. Two accounts signed into from the same
 * profile are, in practice, one person with two accounts — the friend who came
 * over to see the game signs in from their own phone, not from your Chrome
 * profile. That is why this is the one automatic refusal in the whole feature.
 *
 * ## What it deliberately is not
 *
 * Not a fingerprint. Nothing is derived from the machine: no canvas, no font
 * probing, no user-agent or screen-size hashing, no third party, and the value
 * is meaningless outside this database. Clearing cookies clears it.
 *
 * That is an honest trade rather than an oversight. A farmer who works in
 * incognito windows defeats it, and the fallbacks are the ones that always
 * carried the weight: the reward needs three cities of real play, the shared-IP
 * hold, the burst limit and the season cap. What a fingerprint would buy is
 * catching that farmer at the price of tracking every honest player across a
 * signal they cannot see or clear, and this game does not need it badly enough.
 *
 * `httpOnly` for the same reason: the value has no use in the browser, so
 * withholding it from page scripts costs nothing and keeps it out of reach of
 * anything injected into the page.
 */

/** Named like the session and the support cookies, so the set is recognisable. */
export const DEVICE_COOKIE = "kraldor_device";

/**
 * Two years. Longer than the session on purpose: the point is to still recognise
 * the browser a player last signed in from months ago, which is exactly the
 * window an alt farm operates over.
 */
const DEVICE_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 730;

/** 128 bits, base64url — an id, not a secret, but not guessable either. */
function mintDeviceId(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Bound on what is accepted from the cookie jar.
 *
 * The value is client-controlled: anybody can send `kraldor_device: <anything>`.
 * Nothing is authorised by it, so a forged value buys only the ability to look
 * like a fresh browser — which deleting the cookie already does. What must not
 * happen is an unbounded string reaching an indexed text column, so the shape is
 * checked before it is ever used as a key.
 */
function isWellFormed(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

/**
 * The current browser's device id, minting and setting one if absent.
 *
 * Only callable where cookies may be written — a Server Function or a Route
 * Handler. The write is wrapped because Next throws if the response has already
 * begun streaming; a device id that could not be persisted still gets returned,
 * so the caller's own bookkeeping succeeds and the next request mints another.
 */
export async function ensureDeviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  if (existing && isWellFormed(existing)) return existing;

  const fresh = mintDeviceId();
  try {
    jar.set(DEVICE_COOKIE, fresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // `lax` rather than `strict`: an invite link is followed from WhatsApp,
      // Discord or a mail client, and a strict cookie would not be sent on that
      // first cross-site navigation — which is the one request that matters.
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE_S,
    });
  } catch {
    // Read-only cookie context. See above.
  }
  return fresh;
}

/**
 * The current browser's device id if it already has one, without minting.
 *
 * For read-only contexts (a page render, a check that runs inside a
 * transaction): a browser with no cookie yet is simply unknown, and treating
 * that as "no match" is correct — nothing has ever been recorded against it.
 */
export async function readDeviceId(): Promise<string | null> {
  try {
    const value = (await cookies()).get(DEVICE_COOKIE)?.value;
    return value && isWellFormed(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Record that this browser was used for `userId`, and return its device id.
 *
 * Called from every path that establishes a session — register, login, Google
 * sign-in. Best-effort by design: a sighting that fails to record must never
 * take sign-in down with it, and the cost of losing one is that a farm is a
 * little harder to see, not that anything breaks.
 *
 * The upsert is on `(deviceId, userId)`, so a player who signs in every evening
 * leaves one row whose `lastSeenAt` moves, not one row per session. A P2002 from
 * two concurrent sign-ins on the same pair is swallowed by the same catch — the
 * row exists either way, which is all the caller wanted.
 */
export async function rememberDevice(userId: string): Promise<string | null> {
  try {
    const deviceId = await ensureDeviceId();
    const now = new Date();
    await prisma.deviceAccount.upsert({
      where: { deviceId_userId: { deviceId, userId } },
      create: { deviceId, userId, firstSeenAt: now, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
    return deviceId;
  } catch (e) {
    console.error("[device] failed to record sighting", e);
    return null;
  }
}

/**
 * Whether these two accounts have ever been signed into from one browser.
 *
 * Symmetric and history-wide: it is not "is the *current* browser theirs" but
 * "has any browser been both", which is the question that actually matters. A
 * farmer who registers the alt in a fresh profile and then signs into it once
 * from their usual one is caught by this and not by a check on the request in
 * hand.
 *
 * One indexed query rather than two: group the pair's rows by device and look
 * for a device that produced two.
 */
export async function shareADevice(
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  if (userIdA === userIdB) return true;
  const shared = await prisma.deviceAccount.groupBy({
    by: ["deviceId"],
    where: { userId: { in: [userIdA, userIdB] } },
    having: { userId: { _count: { gt: 1 } } },
    _count: { userId: true },
    // Prisma requires an `orderBy` alongside `take` on a groupBy. Any stable key
    // does; there is at most a handful of rows and only their existence matters.
    orderBy: { deviceId: "asc" },
    take: 1,
  });
  return shared.length > 0;
}

/**
 * Whether the browser making *this* request has ever been signed into `userId`.
 *
 * The attach-time half of the check above, and the one that catches the case
 * `shareADevice` cannot see: someone opening their own invite link and
 * registering the second account before it has ever been signed into. At that
 * moment the new account has no sighting of its own, but the browser does.
 */
export async function currentDeviceBelongsTo(userId: string): Promise<boolean> {
  const deviceId = await readDeviceId();
  if (!deviceId) return false;
  const seen = await prisma.deviceAccount.findUnique({
    where: { deviceId_userId: { deviceId, userId } },
    select: { id: true },
  });
  return seen !== null;
}
