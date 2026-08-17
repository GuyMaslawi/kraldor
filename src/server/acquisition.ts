import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The acquisition report — what an advertising campaign actually bought.
 *
 * ## The number this exists to produce
 *
 * Meta's own dashboard reports cost per signup, and cost per signup is a
 * misleading number to steer a campaign by: the cheapest creative is reliably
 * the one that attracts people who tap ads, and people who tap ads are not the
 * same population as people who found an empire and are still logging in a week
 * later. Only this database knows which of the two a campaign delivered, and
 * `d7` below is the column the budget decision is actually made on.
 *
 * ## Retention is measured against an *eligible* cohort
 *
 * A player who signed up two days ago has not failed to reach day 7 — they have
 * not had the chance. Counting them in the denominator would make every
 * still-running campaign look like it was collapsing, and would make the number
 * improve on its own as the campaign aged, which is worse than useless. So each
 * retention rate carries its own denominator: only accounts old enough for the
 * question to have an answer. `d7Eligible` is reported alongside `d7` so a rate
 * computed over four accounts is visibly a rate computed over four accounts.
 *
 * ## Bots and staff are excluded by construction, not by filter
 *
 * Seeded bot garrisons and admin accounts are created by scripts that never
 * touch a browser and therefore never carry a `kr_attr` cookie — they land in
 * the untagged bucket, which is the one bucket whose absolute number nobody
 * steers by. They are dropped anyway, so the organic row stays honest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** One campaign's row in the report. */
export type AcquisitionRow = {
  /** `utm_source / utm_medium / utm_campaign`, or null for untagged traffic. */
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** Accounts created in the window. */
  signups: number;
  /** …that proved their address. Everything downstream is gated on this. */
  verified: number;
  /** …that got as far as naming an empire. */
  founded: number;
  /** Came back the day after signing up, over those old enough to have. */
  d1: number;
  d1Eligible: number;
  /** Still there a week later — the number the budget decision is made on. */
  d7: number;
  d7Eligible: number;
  /** Seen in the last 72h, regardless of when they joined. */
  active: number;
};

export type AcquisitionReport = {
  since: Date;
  rows: AcquisitionRow[];
  /** Every row summed — the funnel for the whole window. */
  totals: Omit<AcquisitionRow, "source" | "medium" | "campaign">;
  /** True when the window hit the row cap and the report is partial. */
  truncated: boolean;
};

/**
 * How many accounts one window may pull.
 *
 * The report groups in JS rather than SQL because the buckets are a
 * three-column tuple with nulls in it, and `GROUP BY` over nullable columns
 * needs care that a page this small does not earn. That trade is only safe with
 * a ceiling on it — hence this, and the `truncated` flag that says out loud when
 * it was hit rather than silently reporting a slice as if it were the whole.
 */
const MAX_ROWS = 20_000;

export async function getAcquisitionReport(days: number): Promise<AcquisitionReport> {
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);

  const rows = await prisma.user.findMany({
    where: { createdAt: { gte: since } },
    select: {
      createdAt: true,
      emailVerified: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      empire: { select: { lastSeenAt: true, isBot: true, isStaff: true } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });

  const buckets = new Map<string, AcquisitionRow>();

  for (const u of rows) {
    if (u.empire?.isBot || u.empire?.isStaff) continue;

    const key = `${u.utmSource ?? ""}|${u.utmMedium ?? ""}|${u.utmCampaign ?? ""}`;
    let row = buckets.get(key);
    if (!row) {
      row = {
        source: u.utmSource,
        medium: u.utmMedium,
        campaign: u.utmCampaign,
        signups: 0,
        verified: 0,
        founded: 0,
        d1: 0,
        d1Eligible: 0,
        d7: 0,
        d7Eligible: 0,
        active: 0,
      };
      buckets.set(key, row);
    }

    row.signups++;
    if (u.emailVerified) row.verified++;
    if (u.empire) row.founded++;

    const age = now.getTime() - u.createdAt.getTime();
    const seen = u.empire?.lastSeenAt?.getTime() ?? 0;

    // "Came back on day N" is `lastSeenAt` past the day-N boundary — not a visit
    // *on* that day. lastSeenAt only moves forward, so a player still here on
    // day 30 satisfies day 1 and day 7 too, which is the intended reading:
    // retention is "did we keep them", not "did they log in that Tuesday".
    if (age >= DAY_MS) {
      row.d1Eligible++;
      if (seen >= u.createdAt.getTime() + DAY_MS) row.d1++;
    }
    if (age >= 7 * DAY_MS) {
      row.d7Eligible++;
      if (seen >= u.createdAt.getTime() + 7 * DAY_MS) row.d7++;
    }
    if (seen >= now.getTime() - 3 * DAY_MS) row.active++;
  }

  const list = [...buckets.values()].sort((a, b) => b.signups - a.signups);

  const totals = list.reduce(
    (acc, r) => ({
      signups: acc.signups + r.signups,
      verified: acc.verified + r.verified,
      founded: acc.founded + r.founded,
      d1: acc.d1 + r.d1,
      d1Eligible: acc.d1Eligible + r.d1Eligible,
      d7: acc.d7 + r.d7,
      d7Eligible: acc.d7Eligible + r.d7Eligible,
      active: acc.active + r.active,
    }),
    {
      signups: 0,
      verified: 0,
      founded: 0,
      d1: 0,
      d1Eligible: 0,
      d7: 0,
      d7Eligible: 0,
      active: 0,
    }
  );

  return { since, rows: list, totals, truncated: rows.length >= MAX_ROWS };
}

/**
 * Which creative produced the signups — `utm_content`, one level below campaign.
 *
 * Kept as a second, separate query rather than a third grouping column on the
 * main table because the two answer different questions and are read at
 * different moments: the campaign table decides whether to keep spending at all,
 * and this decides which of the three images to put the remaining budget behind.
 * Merging them would produce a table with a row per (campaign × creative), which
 * is where a small report stops being readable.
 */
export async function getCreativeBreakdown(days: number) {
  const since = new Date(Date.now() - days * DAY_MS);

  const grouped = await prisma.user.groupBy({
    by: ["utmContent"],
    where: { createdAt: { gte: since }, utmContent: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { utmContent: "desc" } },
    take: 40,
  });

  return grouped.map((g) => ({
    content: g.utmContent as string,
    signups: g._count._all,
  }));
}
