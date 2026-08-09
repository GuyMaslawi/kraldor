import "server-only";
import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma, ReferralReview } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isBanned } from "@/lib/ban";
import { currentDeviceBelongsTo, shareADevice } from "@/lib/device";
import {
  REFERRAL_BURST_LIMIT,
  REFERRAL_BURST_WINDOW_MS,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  isHardReferralFlag,
  normalizeMailbox,
  type ReferralFlag,
} from "@/lib/game/referral";

/**
 * The referral guard — who is allowed to have invited whom, and whether it pays.
 *
 * See src/lib/game/referral.ts for the deal itself and the catalog of signals.
 * This file owns three things: minting and resolving invite codes, deciding what
 * fires on a given pair, and the cookie that carries a code from the link a
 * player clicked to the empire they eventually found.
 *
 * ## The one rule worth stating twice
 *
 * A hard signal refuses the link **at attach time only**. Every later
 * re-derivation — and the flags are re-derived on every payout attempt, because
 * a pair's circumstances change long after they met — can do nothing worse than
 * hold the referral for a human.
 *
 * That asymmetry is deliberate and it is the difference between a check and a
 * trap. Consider the device signal, the sharpest one here: it fires when two
 * accounts have shared a browser profile. Before the link is made, that is
 * conclusive. Six weeks later it is also what happens when a player signs into
 * their own account once on their friend's laptop to show them something. If a
 * re-derivation could reject, that afternoon would silently destroy a referral
 * both of them earned, with no error anyone would ever see. So the late verdict
 * is always "an admin should look", never "no".
 *
 * The same reasoning is why nothing here bans, mutes or otherwise touches an
 * account. The worst outcome of every signal in this file is an unpaid purse.
 * A referral is also the one thing in the game a *third party* can force onto
 * you — anybody may click your link — so a rule that punished the referrer for
 * what their invitees look like would be a griefing tool, not a defence.
 */

/* ------------------------------ the code ------------------------------ */

/** One code's worth of CSPRNG draws from the alphabet. */
function mintCode(): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * This account's invite code, minting one on first use.
 *
 * Lazy rather than backfilled: the column arrived on a live table, and a code
 * only has to exist by the time its owner opens the referrals screen. The retry
 * loop is for the unique constraint — at 60 bits a collision is not going to
 * happen, but a `P2002` that surfaced as "an error occurred" on the one screen
 * whose whole content is the code would be a miserable way to find that out.
 *
 * Concurrent calls for the same user (two tabs) can both mint; the second write
 * loses the race, so the read-back inside the loop returns whichever landed and
 * both callers see one stable code.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintCode();
    try {
      // Guarded on `referralCode: null`, so a code is never rotated: a link
      // already handed out has to keep working forever.
      const claimed = await prisma.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: code },
      });
      if (claimed.count > 0) return code;
      const now = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (now?.referralCode) return now.referralCode;
    } catch (e) {
      if (!(e && typeof e === "object" && (e as { code?: string }).code === "P2002")) {
        throw e;
      }
    }
  }
  throw new Error("could not mint a referral code");
}

/**
 * Who a code belongs to, or null.
 *
 * Null covers every way this can fail to name a recruiter — an unknown code, an
 * account between seasons with no empire yet, a staff account, a garrison bot —
 * and the callers all treat those the same. Nothing they render distinguishes
 * them either: `/r/<code>` redirects identically whatever this returns.
 *
 * Staff and bots are excluded *here* rather than only at attach time so that the
 * sign-up form never greets a visitor with "you were invited by X" for a link
 * that could not have paid them anything.
 */
export async function resolveReferralCode(code: string): Promise<{
  userId: string;
  empireId: string;
  empireName: string;
} | null> {
  const owner = await prisma.user.findUnique({
    where: { referralCode: code },
    select: {
      id: true,
      empire: { select: { id: true, name: true, isStaff: true, isBot: true } },
    },
  });
  if (!owner?.empire || owner.empire.isStaff || owner.empire.isBot) return null;
  return {
    userId: owner.id,
    empireId: owner.empire.id,
    empireName: owner.empire.name,
  };
}

/* --------------------------- the pending cookie --------------------------- */

/**
 * Where a clicked invite code waits until there is an empire to attach it to.
 *
 * `/r/<code>` cannot do the attaching itself — the visitor has no account yet —
 * so the code rides a cookie through the sign-up form, the verification mail and
 * (for Google) the onboarding screen, and is consumed the moment an empire
 * exists. Thirty days because "I'll sign up tonight" is real, and because a
 * Google sign-up bounces through a second screen.
 *
 * `httpOnly` even though it holds nothing secret: page scripts have no use for
 * it, and the value decides who gets paid.
 */
const PENDING_COOKIE = "kraldor_ref";
const PENDING_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

export async function stashPendingReferral(code: string): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_COOKIE, code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // The invite link is followed from WhatsApp, Discord or a mail client, so
    // the cookie has to survive a cross-site navigation. See lib/device.ts.
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_COOKIE_MAX_AGE_S,
  });
}

/** The code the visitor arrived on, if any. Shape-checked, never trusted. */
export async function readPendingReferral(): Promise<string | null> {
  try {
    const raw = (await cookies()).get(PENDING_COOKIE)?.value;
    if (!raw) return null;
    // The jar is client-controlled; only the exact code shape reaches a query.
    const re = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);
    return re.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function clearPendingReferral(): Promise<void> {
  try {
    (await cookies()).delete(PENDING_COOKIE);
  } catch {
    // Read-only cookie context — the next attach attempt is a no-op anyway,
    // because the link can only be set once.
  }
}

/* ------------------------------ the verdict ------------------------------ */

export interface ReferralVerdict {
  /** Everything that fired, hard and soft together, in catalog order. */
  flags: ReferralFlag[];
  /** The subset that would refuse the link outright at attach time. */
  hard: ReferralFlag[];
}

interface Party {
  empireId: string;
  userId: string;
  email: string;
  signupIp: string | null;
  lastLoginIp: string | null;
  isStaff: boolean;
  isBot: boolean;
  banned: boolean;
}

async function loadParty(empireId: string): Promise<Party | null> {
  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: {
      id: true,
      isStaff: true,
      isBot: true,
      user: {
        select: {
          id: true,
          email: true,
          signupIp: true,
          lastLoginIp: true,
          bannedAt: true,
          bannedUntil: true,
        },
      },
    },
  });
  if (!empire) return null;
  return {
    empireId: empire.id,
    userId: empire.user.id,
    email: empire.user.email,
    signupIp: empire.user.signupIp,
    lastLoginIp: empire.user.lastLoginIp,
    isStaff: empire.isStaff,
    isBot: empire.isBot,
    banned: isBanned(empire.user),
  };
}

/**
 * Is `referrerEmpireId` downstream of `joinerEmpireId` — i.e. would attaching
 * this link close a ring?
 *
 * Walks the referrer's ancestors rather than checking one hop, because A→B→C→A
 * is exactly as farmable as A↔B and costs nothing more to set up. Bounded at
 * MAX_RING_HOPS: the chain is a tree in practice, the bound is there so a cycle
 * already in the data (which this function is what prevents, but belt and
 * braces) cannot spin forever.
 */
const MAX_RING_HOPS = 12;

async function closesARing(
  joinerEmpireId: string,
  referrerEmpireId: string
): Promise<boolean> {
  let cursor: string | null = referrerEmpireId;
  const seen = new Set<string>();
  for (let hop = 0; hop < MAX_RING_HOPS && cursor; hop++) {
    if (cursor === joinerEmpireId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const up: { referredById: string | null } | null = await prisma.empire.findUnique({
      where: { id: cursor },
      select: { referredById: true },
    });
    cursor = up?.referredById ?? null;
  }
  return false;
}

/** Have the two ever attacked, spied on or sabotaged each other? */
async function haveFought(a: string, b: string): Promise<boolean> {
  const pair = { OR: [
    { attackerEmpireId: a, defenderEmpireId: b },
    { attackerEmpireId: b, defenderEmpireId: a },
  ] };
  const [battle, spy, sabotage] = await Promise.all([
    prisma.battleReport.findFirst({ where: pair, select: { id: true } }),
    prisma.spyReport.findFirst({ where: pair, select: { id: true } }),
    prisma.sabotageReport.findFirst({ where: pair, select: { id: true } }),
  ]);
  return battle !== null || spy !== null || sabotage !== null;
}

/**
 * How many invitees attached to this referrer in the day leading up to `anchor`.
 *
 * Anchored on the invitee's own `referredAt` rather than on "now" so the answer
 * is the same every time it is asked. A burst is a fact about the evening it
 * happened; re-deriving it against a moving window would quietly un-flag a farm
 * a day later, and un-flagging is the one direction this must never drift in on
 * its own.
 */
async function burstAround(
  referrerEmpireId: string,
  anchor: Date,
  excludeEmpireId: string | null
): Promise<number> {
  return prisma.empire.count({
    where: {
      referredById: referrerEmpireId,
      referredAt: {
        gt: new Date(anchor.getTime() - REFERRAL_BURST_WINDOW_MS),
        lte: anchor,
      },
      ...(excludeEmpireId ? { id: { not: excludeEmpireId } } : {}),
    },
  });
}

/**
 * Everything the game can tell about this pair right now.
 *
 * `phase` changes nothing about *what* is checked — the point of re-deriving is
 * that the same questions get honest current answers — only how the caller is
 * expected to act on it, and one detail: at attach time the invitee has no
 * `referredAt` yet, so the burst window is anchored on the clock instead.
 *
 * Reads outside any transaction the caller may hold. That is correct here: this
 * is advisory evidence gathered before a decision, not the guard on the write.
 * The guard on the write is the `IS NULL` filter on the update that records it.
 */
export async function assessReferral(
  joinerEmpireId: string,
  referrerEmpireId: string,
  phase: "attach" | "claim",
  attachedAt?: Date | null
): Promise<ReferralVerdict> {
  const flags: ReferralFlag[] = [];

  const [joiner, referrer] = await Promise.all([
    loadParty(joinerEmpireId),
    loadParty(referrerEmpireId),
  ]);
  // A missing party is not a clean bill of health — it is a referral that
  // cannot be evaluated, and the only safe reading of that is "not payable".
  if (!joiner || !referrer) return { flags: ["ineligible"], hard: ["ineligible"] };

  if (joiner.userId === referrer.userId || joiner.empireId === referrer.empireId) {
    // Nothing else is worth asking once this is true.
    return { flags: ["self"], hard: ["self"] };
  }

  if (referrer.isStaff || referrer.isBot || referrer.banned) flags.push("ineligible");

  if (await closesARing(joiner.empireId, referrer.empireId)) flags.push("cycle");

  // Two hits on the device question, because they answer different halves of
  // it: `shareADevice` is history-wide across both accounts, while the current
  // browser may not have been recorded against the newcomer yet — which is
  // exactly the state a self-invite is in at the moment it attaches.
  const [historicDevice, thisDevice] = await Promise.all([
    shareADevice(joiner.userId, referrer.userId),
    phase === "attach"
      ? currentDeviceBelongsTo(referrer.userId)
      : Promise.resolve(false),
  ]);
  if (historicDevice || thisDevice) flags.push("device");

  const joinerMailbox = normalizeMailbox(joiner.email);
  if (joinerMailbox !== null && joinerMailbox === normalizeMailbox(referrer.email)) {
    flags.push("mailbox");
  }

  // Nulls never match. `clientIpForStorage` writes null rather than a sentinel
  // precisely so that accounts whose address could not be read do not all
  // cluster together — see the note on User.signupIp.
  const referrerIps = new Set(
    [referrer.signupIp, referrer.lastLoginIp].filter((ip): ip is string => ip !== null)
  );
  const sharesIp = [joiner.signupIp, joiner.lastLoginIp].some(
    (ip) => ip !== null && referrerIps.has(ip)
  );
  if (sharesIp) flags.push("shared_ip");

  const anchor = attachedAt ?? new Date();
  const siblings = await burstAround(
    referrer.empireId,
    anchor,
    phase === "claim" ? joiner.empireId : null
  );
  if (siblings >= REFERRAL_BURST_LIMIT) flags.push("burst");

  if (await haveFought(joiner.empireId, referrer.empireId)) flags.push("combat");

  return { flags, hard: flags.filter(isHardReferralFlag) };
}

/**
 * The review state a freshly attached referral starts in.
 *
 * Only ever called once the caller has established that `verdict.hard` is empty
 * — a hard signal means no link is made at all, so there is no row to review.
 */
export function initialReview(verdict: ReferralVerdict): ReferralReview {
  return verdict.flags.length > 0 ? "HELD" : "OK";
}

/**
 * Re-derive the flags for an existing referral and settle whether it may pay.
 *
 * Returns the review state to persist alongside the fresh flags. The two rules
 * it encodes:
 *
 *  - `APPROVED` is final. An admin has already looked at this pair and said yes;
 *    a signal that fires afterwards (they finally attacked each other, they
 *    travelled and shared a hotel's IP) must not overturn a human decision.
 *  - `REJECTED` is equally final, and only an admin re-opens it. Re-deriving a
 *    clean sweep must not hand a farm its purse back on the day it happens to
 *    look innocent.
 *
 * Everything else follows the flags: any flag at all holds, none clears. Note
 * that this can move a referral *out* of `HELD` on its own — a hold caused by a
 * shared carrier address the player has since moved off resolves itself, which
 * is the right default for a queue nobody may get to.
 */
export function reviewAfterRederive(
  current: ReferralReview,
  verdict: ReferralVerdict
): ReferralReview {
  if (current === "APPROVED" || current === "REJECTED") return current;
  return verdict.flags.length > 0 ? "HELD" : "OK";
}

/**
 * Record the link, with its verdict, on the newcomer's row.
 *
 * The write **is** the guard: `referredById: null` in the WHERE means a second
 * concurrent attempt — two tabs, a double-submitted form, a registration racing
 * the referrals screen — matches nothing and changes nothing. Returns whether
 * this call is the one that made the link.
 */
export async function writeReferralLink(
  tx: Prisma.TransactionClient,
  joinerEmpireId: string,
  referrerEmpireId: string,
  via: "link" | "name",
  verdict: ReferralVerdict
): Promise<boolean> {
  const attached = await tx.empire.updateMany({
    where: { id: joinerEmpireId, referredById: null },
    data: {
      referredById: referrerEmpireId,
      referredAt: new Date(),
      referralVia: via,
      referralReview: initialReview(verdict),
      referralFlags: verdict.flags,
    },
  });
  return attached.count > 0;
}

/**
 * Attach the code the newcomer arrived on, if there is one and it holds up.
 *
 * Called immediately after an empire is founded, from both registration paths.
 * Everything about it is best-effort: a referral that cannot be attached is a
 * missing bonus, and it must never be able to fail a registration that has
 * already created an account. The cookie is cleared either way — a code that was
 * refused should not follow the player around waiting for a second chance at a
 * screen where it would be refused again.
 */
export async function consumePendingReferral(joinerEmpireId: string): Promise<void> {
  try {
    const code = await readPendingReferral();
    if (!code) return;
    await clearPendingReferral();

    const referrer = await resolveReferralCode(code);
    if (!referrer) return;

    const verdict = await assessReferral(joinerEmpireId, referrer.empireId, "attach");
    if (verdict.hard.length > 0) return;

    await writeReferralLink(prisma, joinerEmpireId, referrer.empireId, "link", verdict);
  } catch (e) {
    console.error("[referral] failed to attach a pending invite", e);
  }
}

/**
 * Purses this referrer has already been paid in the current season, against
 * REFERRAL_SEASON_CAP.
 *
 * Scoped by the invitee's season rather than the referrer's, because the
 * receipt lives on the invitee's row and it is that row the cap is counting.
 * Empires from a wiped season are gone entirely, so in practice this is "this
 * world" either way — the filter is what keeps it true if that ever changes.
 */
export async function referrerPursesPaid(
  tx: Prisma.TransactionClient,
  referrerEmpireId: string,
  seasonId: string | null
): Promise<number> {
  return tx.empire.count({
    where: {
      referredById: referrerEmpireId,
      referrerPaidAt: { not: null },
      ...(seasonId ? { seasonId } : {}),
    },
  });
}
