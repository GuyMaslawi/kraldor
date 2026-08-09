import "server-only";
import type { ReferralReview } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isBanned } from "@/lib/ban";
import {
  referralEarned,
  type ReferralCase,
  type ReferralFlag,
  type ReferralParty,
} from "@/lib/game/referral";

/**
 * The referral review queue — what /admin/referrals reads.
 *
 * Small by construction: only a referral that tripped a signal ever lands here,
 * and the honest majority never do. That is what makes it affordable to show
 * every piece of evidence per case rather than a score — the admin is judging
 * two accounts, and the useful question ("do these look like one person?") is
 * answered by their addresses, their emails and their history side by side, not
 * by a number the checks produced.
 *
 * Decided cases are kept in the same list rather than disappearing, so a
 * decision can be revisited and so the queue doubles as the record of what has
 * been judged. `HELD` sorts first because it is the only state anybody is
 * waiting on.
 */

/** Rows to load. Far above any plausible queue depth; a bound, not a page size. */
const QUEUE_LIMIT = 200;

const PARTY_SELECT = {
  id: true,
  name: true,
  cities: true,
  createdAt: true,
  user: {
    select: {
      email: true,
      signupIp: true,
      lastLoginIp: true,
      bannedAt: true,
      bannedUntil: true,
    },
  },
} as const;

type PartyRow = {
  id: string;
  name: string;
  cities: number;
  createdAt: Date;
  user: {
    email: string;
    signupIp: string | null;
    lastLoginIp: string | null;
    bannedAt: Date | null;
    bannedUntil: Date | null;
  };
};

function toParty(row: PartyRow): ReferralParty {
  return {
    empireId: row.id,
    empireName: row.name,
    cities: row.cities,
    email: row.user.email,
    signupIp: row.user.signupIp,
    lastLoginIp: row.user.lastLoginIp,
    joinedAt: row.createdAt,
    banned: isBanned(row.user),
  };
}

/** How many referrals are waiting on a human — the nav badge. */
export async function countHeldReferrals(): Promise<number> {
  return prisma.empire.count({ where: { referralReview: "HELD" } });
}

/**
 * Every referral that has been flagged or decided, held ones first.
 *
 * Two queries rather than a join on the self-relation: Prisma can load the
 * referrer through `referredBy` in one, and the second is only the fallback for
 * a row whose referrer vanished — which `ON DELETE SET NULL` makes impossible in
 * practice, but a queue that crashed on it would be a bad way to find out.
 */
export async function listReferralCases(): Promise<ReferralCase[]> {
  const rows = await prisma.empire.findMany({
    where: {
      referredById: { not: null },
      referralReview: { not: "OK" },
    },
    select: {
      ...PARTY_SELECT,
      referralFlags: true,
      referralVia: true,
      referredAt: true,
      referralReview: true,
      referralReviewedAt: true,
      referralPaidAt: true,
      referrerPaidAt: true,
      referredBy: { select: PARTY_SELECT },
    },
    // HELD ('HELD' sorts after 'APPROVED' alphabetically, so the order is set in
    // JS below rather than in SQL) — this only fixes the secondary key.
    orderBy: { referredAt: "desc" },
    take: QUEUE_LIMIT,
  });

  const cases: ReferralCase[] = [];
  for (const row of rows) {
    if (!row.referredBy) continue;
    cases.push({
      joiner: toParty(row),
      referrer: toParty(row.referredBy),
      flags: row.referralFlags as ReferralFlag[],
      via: row.referralVia,
      referredAt: row.referredAt,
      review: row.referralReview,
      reviewedAt: row.referralReviewedAt,
      joinerPaid: row.referralPaidAt !== null,
      referrerPaid: row.referrerPaidAt !== null,
      earned: referralEarned(row.cities),
    });
  }

  // Waiting first, then decided. Inside each group the newest referral leads,
  // which the SQL already arranged.
  const rank: Record<ReferralReview, number> = {
    HELD: 0,
    OK: 1,
    APPROVED: 2,
    REJECTED: 3,
  };
  return cases.sort((a, b) => rank[a.review] - rank[b.review]);
}
