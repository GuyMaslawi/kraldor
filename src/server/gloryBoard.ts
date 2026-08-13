import "server-only";
import { prisma } from "@/lib/prisma";
import {
  GLORY_KEYS,
  GLORY_NAME,
  gloryPrize,
  type AchievementsState,
} from "@/lib/game/achievements";
import { REWARD_LABEL, mergeRewards, type Reward } from "@/lib/game/rewards";
import { formatNumber } from "@/lib/game/format";
import { payRewards } from "@/server/rewardGrant";

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
  /** The winning `EmpireGloryAward` row — the one the purse is stamped on. */
  awardId: string;
  empireId: string;
  empireName: string;
  /** `Empire.title` — the holder's תואר as it stands now, or null for none. */
  title: string | null;
  awardedAt: Date;
  /** When this holder was paid the record's purse; null while it is owed. */
  prizePaidAt: Date | null;
  /**
   * True when *some* row of this key has already been paid — normally the same
   * row, but not necessarily. An admin can stamp an award with a backdated
   * `awardedAt` (see `setGloryAward`), which moves the champion to a row whose
   * own `prizePaidAt` is null; without this flag the capstone would pay a second
   * purse. Read straight from the database rather than derived, so it is true
   * even for a holder this query no longer names.
   */
  prizeTaken: boolean;
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
      award_id: string;
      empire_id: string;
      empire_name: string;
      empire_title: string | null;
      awarded_at: Date;
      prize_paid_at: Date | null;
      prize_taken: boolean;
    }[]
  >`
    SELECT DISTINCT ON (g.key)
      g.key                AS key,
      g.id                 AS award_id,
      g."empireId"         AS empire_id,
      e.name               AS empire_name,
      -- The holder's title, off a join this query was already making for the
      -- name. Live rather than frozen at the award, deliberately: the case says
      -- who holds the record now, and a title is what that player is called now.
      e.title              AS empire_title,
      g."awardedAt"        AS awarded_at,
      g."prizePaidAt"      AS prize_paid_at,
      -- "Has this capstone's purse been paid to anybody?" — normally the same
      -- row, but a backdated admin stamp can move the champion off a paid row.
      -- Cheap: at most one row per key is ever stamped, and the (key, awardedAt)
      -- index answers it without touching the heap for the rest.
      EXISTS (
        SELECT 1 FROM "EmpireGloryAward" p
        WHERE p.key = g.key AND p."prizePaidAt" IS NOT NULL
      )                    AS prize_taken
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
        awardId: r.award_id,
        empireId: r.empire_id,
        empireName: r.empire_name,
        title: r.empire_title,
        awardedAt: r.awarded_at,
        prizePaidAt: r.prize_paid_at,
        prizeTaken: r.prize_taken,
      },
    ])
  );
}

/* ------------------------------ the purse ------------------------------ */

/** One capstone's purse, as it was actually credited. */
export interface GloryPrizePayment {
  key: string;
  rewards: Reward[];
}

/**
 * Pay the world-record purse to the empire currently holding each plaque.
 *
 * Called from the base screen right after `getGloryChampions`, for the *viewer
 * only*. That is not a shortcut, it is the whole design: the same page load
 * that stamps an arrival is the one that reads the records back, so an empire
 * that has just taken a record is paid on that very request — and a record
 * already standing when this shipped is settled the next time its holder opens
 * their base. Nobody else's page load has to do anything, and a purse costs
 * exactly zero extra queries on every load where there is nothing to pay: the
 * champions map already carries the receipt.
 *
 * Paid once per capstone per season. Two guards, in order:
 *
 *  1. `prizeTaken` — some row of this key is already stamped. Covers the case
 *     where the champion moved to an unpaid row (a backdated admin stamp).
 *  2. A guarded `updateMany` on the winning row itself, inside the transaction
 *     and *before* the credit. That is the real lock: two tabs loading the base
 *     screen at once both see an unpaid record and both target the same row, and
 *     `count === 0` is how the loser finds out. Stamping before paying rather
 *     than after means the failure mode is an unpaid record — recoverable, and
 *     visible — instead of a double payout.
 *
 * Returns what was actually paid, so the caller can tell the player. An empty
 * array is the overwhelmingly common answer.
 */
export async function settleGloryPrizes(
  empireId: string,
  champions: ReadonlyMap<string, GloryChampion>
): Promise<GloryPrizePayment[]> {
  const owed = GLORY_KEYS.flatMap((key) => {
    const held = champions.get(key);
    if (!held || held.empireId !== empireId) return [];
    if (held.prizePaidAt || held.prizeTaken) return [];
    const prize = gloryPrize(key);
    if (prize.length === 0) return [];
    return [{ key, awardId: held.awardId, prize }];
  });
  if (owed.length === 0) return [];

  const paid: GloryPrizePayment[] = [];
  for (const { key, awardId, prize } of owed) {
    const now = new Date();
    const payment = await prisma.$transaction(async (tx) => {
      // The receipt first. Whoever wins this update owns the purse; everybody
      // else stops here having paid nothing.
      const claimed = await tx.empireGloryAward.updateMany({
        where: { id: awardId, prizePaidAt: null },
        data: { prizePaidAt: now },
      });
      if (claimed.count === 0) return null;

      const rewards = await payRewards(tx, empireId, prize);

      // The receipt in the winner's own inbox — the payout is silent otherwise,
      // and a purse nobody noticed arriving is a purse players keep asking about.
      // Keys and params, not a finished sentence: the row is written on this
      // player's request but the inbox renders in whatever language they are
      // reading in at the time (see messageText.ts).
      await tx.message.create({
        data: {
          empireId,
          kind: "SYSTEM",
          title: "🏆 שיא עולם על שמך — הפרס שולם",
          body: "{record} — אתה הראשון בעולם שהגיע לשם, והשיא נרשם על שמך לצמיתות. הפרס נכנס לחשבונך אוטומטית: {prize}.",
          bodyParams: {
            record: { key: GLORY_NAME[key] ?? key },
            prize: prizeClause(rewards),
          },
          href: "/game/base",
          // Set explicitly, like every other message the game writes off its own
          // clock: the column default is CURRENT_TIMESTAMP, which lands in the
          // database session's zone rather than Prisma's UTC — three hours out,
          // which is enough to sort a fresh receipt below yesterday's mail.
          createdAt: now,
        },
      });

      return { key, rewards };
    });
    if (payment) paid.push(payment);
  }
  return paid;
}

/**
 * The purse as one translatable clause — "1,000 אזרחים ו-500 תורות".
 *
 * Nested keys rather than a sentence built here: every label is itself a
 * dictionary key, so an English reader gets "1,000 Citizens and 500 Turns" out
 * of a row written while a Hebrew player was being served. See the note on
 * nested params in messageText.ts.
 */
type MessageParam =
  | string
  | number
  | { key: string; params?: Record<string, MessageParam> };

function prizeClause(rewards: readonly Reward[]): MessageParam {
  const lines: MessageParam[] = mergeRewards(rewards).map((r) => ({
    key: "{amount} {kind}",
    params: { amount: formatNumber(r.amount), kind: { key: REWARD_LABEL[r.kind] } },
  }));
  if (lines.length === 0) return "";
  // Folded from the right so the conjunction always joins the last line to
  // everything before it. Every purse is two lines today; the fold is what keeps
  // that from being an assumption a third line would break.
  return lines.reduceRight((acc, line) => ({
    key: "{a} ו-{b}",
    params: { a: line, b: acc },
  }));
}

