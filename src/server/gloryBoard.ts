import "server-only";
import { prisma } from "@/lib/prisma";
import { GLORY_KEYS, type AchievementsState } from "@/lib/game/achievements";

/**
 * The capstone board on /game/base: automatic decorations, plus the world
 * record for each.
 *
 * **Automatic, not collected.** The achievements ladder is a reward system —
 * reaching a goal unlocks a button and the payout happens when the player
 * presses it. These seven are decorations: they light up the moment the empire
 * meets the condition and there is nothing to press. That is why the arrival
 * stamp lives in its own table (`EmpireGloryAward`) rather than reusing the
 * claim receipt. Reusing it would have shown a player who hit a ceiling and
 * left the reward sitting as not having done it, and handed the world record to
 * whoever clicked first rather than whoever arrived first.
 *
 * Two halves, in order:
 *  1. `stampGloryAwards` — writes a row for every capstone this empire now
 *     meets and has not been stamped for. Idempotent; the unique constraint
 *     makes the first stamp the one that survives.
 *  2. `getGloryChampions` — the earliest stamp per key, across every empire.
 *
 * "First" therefore means first *observed*, to the nearest base-screen load.
 * That is the honest cost of deriving conditions instead of instrumenting every
 * gameplay path with a timestamp write, and it is the same rule for everybody.
 */

export interface GloryChampion {
  empireId: string;
  empireName: string;
  /** `Empire.title` — the holder's תואר as it stands now, or null for none. */
  title: string | null;
  awardedAt: Date;
}

/**
 * Stamp every capstone this empire now qualifies for.
 *
 * `unlocked` on the built ladder is already the derived condition — no claim
 * required — so this reads the same flag the board draws, and the decoration
 * can never disagree with the medal beside it.
 *
 * Returns the keys stamped for the first time, so the caller can tell the player
 * what they just earned.
 */
export async function stampGloryAwards(
  empireId: string,
  state: AchievementsState
): Promise<string[]> {
  const gloryKeys = new Set(GLORY_KEYS);
  const earned = state.items
    .filter((i) => gloryKeys.has(i.key) && i.unlocked)
    .map((i) => i.key);
  if (earned.length === 0) return [];

  // Read first so the common case — a returning player whose decorations are
  // all already stamped — costs one indexed read and no write at all.
  const existing = await prisma.empireGloryAward.findMany({
    where: { empireId, key: { in: earned } },
    select: { key: true },
  });
  const have = new Set(existing.map((r) => r.key));
  const fresh = earned.filter((k) => !have.has(k));
  if (fresh.length === 0) return [];

  // `skipDuplicates` rather than a guarded insert: two tabs loading the base
  // screen at once both see the same gap, and the unique constraint is what
  // decides between them. Losing the race is not an error here.
  await prisma.empireGloryAward.createMany({
    data: fresh.map((key) => ({ empireId, key })),
    skipDuplicates: true,
  });
  return fresh;
}

/**
 * The record holder for each capstone, keyed by GLORY_KEYS entry. A key absent
 * from the map has never been reached by anyone — that record is still open.
 *
 * Live, like every other board in the game. It used to sit behind a two-minute
 * TTL with an explicit invalidation on the stamping path, which was sound as far
 * as one server went — but the cache is per-instance, so a record set on one
 * instance stayed invisible on the others until their own TTL ran out. Being
 * first is the entire content of this board; it is not the place to be two
 * minutes behind. What makes live cheap is the query: `DISTINCT ON` off the
 * `(key, awardedAt)` index returns one row per capstone — seven rows, however
 * many players the game has.
 */
export async function getGloryChampions(): Promise<Map<string, GloryChampion>> {
  // DISTINCT ON is the whole query: order by key then awardedAt and Postgres
  // hands back the first row of each key group, straight off the
  // (key, awardedAt) index. The Prisma-shaped alternative — a findFirst per
  // key, or one findMany over every award followed by a JS reduce — is either
  // seven round trips or a scan proportional to the playerbase.
  const rows = await prisma.$queryRaw<
    {
      key: string;
      empire_id: string;
      empire_name: string;
      empire_title: string | null;
      awarded_at: Date;
    }[]
  >`
    SELECT DISTINCT ON (g.key)
      g.key                AS key,
      g."empireId"         AS empire_id,
      e.name               AS empire_name,
      -- The holder's title, off a join this query was already making for the
      -- name. Live rather than frozen at the award, deliberately: the case says
      -- who holds the record now, and a title is what that player is called now.
      e.title              AS empire_title,
      g."awardedAt"        AS awarded_at
    FROM "EmpireGloryAward" g
    JOIN "Empire" e ON e.id = g."empireId"
    WHERE g.key = ANY(${GLORY_KEYS as string[]})
      -- Neither staff nor bots hold world records (src/lib/staff.ts,
      -- src/lib/bot.ts). Excluded on read rather than by refusing to stamp: the
      -- stamps of an account promoted to staff mid-season have to disappear
      -- too, and a read filter is the only thing that covers rows already
      -- written. A bot planted at the top of a tier would otherwise take "first
      -- to reach" off the player who actually got there.
      AND e."isStaff" = false
      AND e."isBot" = false
    ORDER BY g.key, g."awardedAt" ASC
  `;

  return new Map(
    rows.map((r) => [
      r.key,
      {
        empireId: r.empire_id,
        empireName: r.empire_name,
        title: r.empire_title,
        awardedAt: r.awarded_at,
      },
    ])
  );
}

