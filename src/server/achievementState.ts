import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmpireMilitaryPower } from "@/lib/game/power";
import { notStaff } from "@/lib/staff";
import { MINE_START_LEVEL, PRODUCTION_BUILDING_TYPES } from "@/lib/game/constants";
import {
  ACHIEVEMENTS,
  buildAchievementsState,
  needsRankScan,
  type AchievementsState,
  type AchievementStats,
} from "@/lib/game/achievements";

/**
 * Read side of the achievements ladder.
 *
 * Split out of the server action so the page can call it directly and so the
 * claim path and the render path evaluate conditions through exactly one code
 * path. See src/lib/game/achievements.ts for the catalog itself.
 */

/* ------------------------------ the snapshot ------------------------------ */

/**
 * Shape returned by the snapshot query — one row, all counters, snake_case as
 * SQL produced them.
 *
 * Every column is cast to `int` or `double precision` on purpose: Postgres
 * returns `bigint` from `count()` and from `sum()` over integer columns, and
 * Prisma surfaces those as JavaScript `BigInt`, which then fails every
 * comparison against the plain numbers in the catalog.
 */
interface SnapshotRow {
  cities: number;
  gold: number;
  wood: number;
  iron: number;
  stone: number;
  diamonds: number;
  turns: number;
  soldiers: number;
  spies: number;
  mine_slaves: number;
  hero_level: number;
  hero_resets: number;
  bank_balance: number;
  attacks_launched: number;
  attack_wins: number;
  defense_wins: number;
  soldiers_slain: number;
  soldiers_enslaved: number;
  gold_plundered: number;
  spy_missions: number;
  spy_successes: number;
  hero_items: number;
  epic_items: number;
  legendary_items: number;
  equipped_items: number;
  bank_deposits: number;
  interest_payments: number;
  mines_built: number;
  min_mine_level: number;
  max_mine_level: number;
  min_storage_level: number;
  citizen_growth_level: number;
  min_upgrade_level: number;
  attack_weapons: number;
  defense_weapons: number;
  spy_weapons: number;
  distinct_weapons: number;
  total_weapons: number;
  min_unlocked_tier: number;
  guild_memberships: number;
  guild_leaderships: number;
  boss_wins: number;
  distinct_bosses: number;
  minigame_wins: number;
  messages_sent: number;
}

/** The four mines, as SQL literals, straight from the game constants. */
const MINE_TYPES = Prisma.join(
  PRODUCTION_BUILDING_TYPES.map((t) => Prisma.sql`${t}`)
);

/**
 * Every counter the catalog tests against, in a single round trip.
 *
 * This is deliberately one raw query rather than a `findUnique` with eight
 * `include`s plus a dozen `count`s. Prisma issues a separate statement per
 * relation and per aggregate, which came to roughly twenty statements — and
 * the game layout asks for this on *every* screen to render the "rewards
 * waiting" badge, so twenty statements per navigation is not affordable. As
 * scalar subqueries against indexed columns it is one statement on one
 * connection.
 *
 * Weapon keys are `${CATEGORY}_T${tier}` (see lib/game/weapons.ts), so
 * `split_part(key, '_T', 1)` is the category. That avoids `LIKE 'ATTACK\_%'`,
 * where the underscore is a wildcard and the escaping has to survive both the
 * JavaScript and the SQL string layer.
 */
async function querySnapshot(
  tx: Prisma.TransactionClient,
  empireId: string
): Promise<SnapshotRow | null> {
  const rows = await tx.$queryRaw<SnapshotRow[]>`
    SELECT
      e.cities::int                                AS cities,
      e.gold                                       AS gold,
      e.wood                                       AS wood,
      e.iron                                       AS iron,
      e.stone                                      AS stone,
      e.diamonds                                   AS diamonds,
      e.turns::int                                 AS turns,
      COALESCE(a.soldiers, 0)::int                 AS soldiers,
      COALESCE(a.spies, 0)::int                    AS spies,
      COALESCE(a."mineSlaves", 0)::int             AS mine_slaves,
      COALESCE(h.level, 1)::int                    AS hero_level,
      COALESCE(h.resets, 0)::int                   AS hero_resets,
      COALESCE(ba."goldBalance", 0)                AS bank_balance,

      (SELECT count(*) FROM "BattleReport" b
        WHERE b."attackerEmpireId" = e.id)::int    AS attacks_launched,
      (SELECT count(*) FROM "BattleReport" b
        WHERE b."attackerEmpireId" = e.id
          AND b."winnerEmpireId" = e.id)::int      AS attack_wins,
      (SELECT count(*) FROM "BattleReport" b
        WHERE b."defenderEmpireId" = e.id
          AND b."winnerEmpireId" = e.id)::int      AS defense_wins,
      (
        (SELECT COALESCE(SUM(b."defenderSoldiersLost"), 0) FROM "BattleReport" b
          WHERE b."attackerEmpireId" = e.id)
        +
        (SELECT COALESCE(SUM(b."attackerSoldiersLost"), 0) FROM "BattleReport" b
          WHERE b."defenderEmpireId" = e.id)
      )::double precision                          AS soldiers_slain,
      (SELECT COALESCE(SUM(b."enslavedSoldiers"), 0) FROM "BattleReport" b
        WHERE b."attackerEmpireId" = e.id)::double precision
                                                   AS soldiers_enslaved,
      (SELECT COALESCE(SUM(b."stolenGold"), 0) FROM "BattleReport" b
        WHERE b."attackerEmpireId" = e.id
          AND b."winnerEmpireId" = e.id)::double precision
                                                   AS gold_plundered,

      (SELECT count(*) FROM "SpyReport" s
        WHERE s."attackerEmpireId" = e.id)::int    AS spy_missions,
      (SELECT count(*) FROM "SpyReport" s
        WHERE s."attackerEmpireId" = e.id
          AND s.success)::int                      AS spy_successes,

      (SELECT count(*) FROM "HeroItem" i
        WHERE i."heroId" = h.id)::int              AS hero_items,
      (SELECT count(*) FROM "HeroItem" i
        WHERE i."heroId" = h.id AND i.rarity = 'EPIC')::int
                                                   AS epic_items,
      (SELECT count(*) FROM "HeroItem" i
        WHERE i."heroId" = h.id AND i.rarity = 'LEGENDARY')::int
                                                   AS legendary_items,
      (SELECT count(*) FROM "HeroItem" i
        WHERE i."heroId" = h.id AND i.equipped)::int
                                                   AS equipped_items,

      (SELECT count(*) FROM "BankTransaction" t
        WHERE t."empireId" = e.id AND t.type = 'DEPOSIT')::int
                                                   AS bank_deposits,
      (SELECT count(*) FROM "BankTransaction" t
        WHERE t."empireId" = e.id AND t.type = 'INTEREST')::int
                                                   AS interest_payments,

      -- Mines are created at MINE_START_LEVEL, so only a mine raised *above*
      -- that counts as one the player developed.
      (SELECT count(*) FROM "Building" bd
        WHERE bd."empireId" = e.id
          AND bd.type::text IN (${MINE_TYPES})
          AND bd.level > ${MINE_START_LEVEL})::int AS mines_built,
      (SELECT COALESCE(MIN(bd.level), 0) FROM "Building" bd
        WHERE bd."empireId" = e.id
          AND bd.type::text IN (${MINE_TYPES}))::int
                                                   AS min_mine_level,
      (SELECT COALESCE(MAX(bd.level), 0) FROM "Building" bd
        WHERE bd."empireId" = e.id
          AND bd.type::text IN (${MINE_TYPES}))::int
                                                   AS max_mine_level,
      (SELECT COALESCE(MIN(st.level), 0) FROM "ResourceStorage" st
        WHERE st."empireId" = e.id)::int           AS min_storage_level,

      -- Upgrades are created at level 1, so level 2 is the first real upgrade.
      (SELECT COALESCE(MAX(u.level), 0) FROM "EmpireUpgrade" u
        WHERE u."empireId" = e.id
          AND u.type::text = 'CITIZEN_GROWTH')::int
                                                   AS citizen_growth_level,
      (SELECT COALESCE(MIN(u.level), 0) FROM "EmpireUpgrade" u
        WHERE u."empireId" = e.id)::int            AS min_upgrade_level,

      (SELECT count(*) FROM "EmpireWeapon" w
        WHERE w."empireId" = e.id AND w.quantity > 0
          AND split_part(w."weaponKey", '_T', 1) = 'ATTACK')::int
                                                   AS attack_weapons,
      (SELECT count(*) FROM "EmpireWeapon" w
        WHERE w."empireId" = e.id AND w.quantity > 0
          AND split_part(w."weaponKey", '_T', 1) = 'DEFENSE')::int
                                                   AS defense_weapons,
      (SELECT count(*) FROM "EmpireWeapon" w
        WHERE w."empireId" = e.id AND w.quantity > 0
          AND split_part(w."weaponKey", '_T', 1) = 'SPY')::int
                                                   AS spy_weapons,
      (SELECT count(*) FROM "EmpireWeapon" w
        WHERE w."empireId" = e.id AND w.quantity > 0)::int
                                                   AS distinct_weapons,
      (SELECT COALESCE(SUM(w.quantity), 0) FROM "EmpireWeapon" w
        WHERE w."empireId" = e.id)::double precision
                                                   AS total_weapons,
      (SELECT COALESCE(MIN(wu."unlockedTier"), 0) FROM "EmpireWeaponUnlock" wu
        WHERE wu."empireId" = e.id)::int           AS min_unlocked_tier,

      (SELECT count(*) FROM "GuildMember" gm
        WHERE gm."empireId" = e.id)::int           AS guild_memberships,
      (SELECT count(*) FROM "GuildMember" gm
        WHERE gm."empireId" = e.id
          AND gm.role::text = 'LEADER')::int       AS guild_leaderships,

      (SELECT count(*) FROM "BossFight" bf
        WHERE bf."empireId" = e.id AND bf.victory)::int
                                                   AS boss_wins,
      (SELECT count(DISTINCT bf."cityTier") FROM "BossFight" bf
        WHERE bf."empireId" = e.id AND bf.victory)::int
                                                   AS distinct_bosses,

      (SELECT count(*) FROM "MiniGameEntry" me
        WHERE me."empireId" = e.id AND me.won)::int
                                                   AS minigame_wins,
      (SELECT count(*) FROM "Message" m
        WHERE m."senderEmpireId" = e.id
          AND m.kind::text = 'PLAYER')::int        AS messages_sent
    FROM "Empire" e
    LEFT JOIN "Army" a         ON a."empireId"  = e.id
    LEFT JOIN "Hero" h         ON h."empireId"  = e.id
    LEFT JOIN "BankAccount" ba ON ba."empireId" = e.id
    WHERE e.id = ${empireId}
  `;
  return rows[0] ?? null;
}

/**
 * Is this empire top of its city bucket?
 *
 * Mirrors /game/rankings exactly — same bucket, same power figure, same
 * tie-break — because "first in the ranking" has to mean the row the player
 * sees at the top of that page. That includes the staff exclusion: an admin
 * empire is absent from the ladder, so it must be absent here too, or a player
 * standing visibly first on the page would be told they are not. It is also the
 * only O(bucket) query here, which is why `needsRankScan` gates it: once the
 * reward is collected the question never has to be asked again.
 */
async function computeIsRankOne(
  tx: Prisma.TransactionClient,
  empireId: string,
  cities: number
): Promise<boolean> {
  const bucket = await tx.empire.findMany({
    where: { ...notStaff, cities },
    select: {
      id: true,
      army: { select: { soldiers: true } },
      weapons: { select: { weaponKey: true, quantity: true } },
      hero: { select: { level: true, resets: true } },
    },
  });
  if (bucket.length === 0) return false;

  const top = bucket
    .map((e) => ({ ...e, power: getEmpireMilitaryPower(e.army, e.weapons) }))
    .sort(
      (a, b) =>
        b.power - a.power ||
        (b.hero?.level ?? 1) - (a.hero?.level ?? 1) ||
        (b.hero?.resets ?? 0) - (a.hero?.resets ?? 0)
    )[0];
  return top.id === empireId;
}

/** The keys this empire has already collected. */
export async function getClaimedKeys(
  tx: Prisma.TransactionClient,
  empireId: string
): Promise<Set<string>> {
  const rows = await tx.empireAchievement.findMany({
    where: { empireId },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
}

/** Assemble the snapshot the catalog is evaluated against. */
export async function gatherAchievementStats(
  tx: Prisma.TransactionClient,
  empireId: string,
  claimedKeys: ReadonlySet<string>
): Promise<AchievementStats | null> {
  const r = await querySnapshot(tx, empireId);
  if (!r) return null;

  const isRankOne = needsRankScan(claimedKeys)
    ? await computeIsRankOne(tx, empireId, r.cities)
    : false;

  return {
    attacksLaunched: r.attacks_launched,
    attackWins: r.attack_wins,
    defenseWins: r.defense_wins,
    soldiersSlain: r.soldiers_slain,
    soldiersEnslaved: r.soldiers_enslaved,
    goldPlundered: r.gold_plundered,

    spyMissions: r.spy_missions,
    spySuccesses: r.spy_successes,

    heroLevel: r.hero_level,
    heroResets: r.hero_resets,
    heroItems: r.hero_items,
    epicItems: r.epic_items,
    legendaryItems: r.legendary_items,
    equippedItems: r.equipped_items,

    gold: r.gold,
    wood: r.wood,
    iron: r.iron,
    stone: r.stone,
    diamonds: r.diamonds,
    turns: r.turns,
    bankBalance: r.bank_balance,
    bankDeposits: r.bank_deposits,
    interestPayments: r.interest_payments,
    minesBuilt: r.mines_built,
    minMineLevel: r.min_mine_level,
    maxMineLevel: r.max_mine_level,
    minStorageLevel: r.min_storage_level,

    cities: r.cities,
    citizenGrowthLevel: r.citizen_growth_level,
    minUpgradeLevel: r.min_upgrade_level,
    soldiers: r.soldiers,
    spies: r.spies,
    mineSlaves: r.mine_slaves,
    attackWeapons: r.attack_weapons,
    defenseWeapons: r.defense_weapons,
    spyWeapons: r.spy_weapons,
    distinctWeapons: r.distinct_weapons,
    totalWeapons: r.total_weapons,
    minUnlockedTier: r.min_unlocked_tier,

    inGuild: r.guild_memberships > 0,
    isGuildLeader: r.guild_leaderships > 0,
    bossWins: r.boss_wins,
    distinctBossesBeaten: r.distinct_bosses,
    miniGameWins: r.minigame_wins,
    messagesSent: r.messages_sent,

    isRankOne,
  };
}

/**
 * Stand-in used when every achievement is already collected. Legitimate,
 * because `buildAchievementsState` never consults a stat for a collected
 * entry — it renders those complete from the receipt alone.
 */
const NO_STATS: AchievementStats = {
  attacksLaunched: 0,
  attackWins: 0,
  defenseWins: 0,
  soldiersSlain: 0,
  soldiersEnslaved: 0,
  goldPlundered: 0,
  spyMissions: 0,
  spySuccesses: 0,
  heroLevel: 0,
  heroResets: 0,
  heroItems: 0,
  epicItems: 0,
  legendaryItems: 0,
  equippedItems: 0,
  gold: 0,
  wood: 0,
  iron: 0,
  stone: 0,
  diamonds: 0,
  turns: 0,
  bankBalance: 0,
  bankDeposits: 0,
  interestPayments: 0,
  minesBuilt: 0,
  minMineLevel: 0,
  maxMineLevel: 0,
  minStorageLevel: 0,
  cities: 0,
  citizenGrowthLevel: 0,
  minUpgradeLevel: 0,
  soldiers: 0,
  spies: 0,
  mineSlaves: 0,
  attackWeapons: 0,
  defenseWeapons: 0,
  spyWeapons: 0,
  distinctWeapons: 0,
  totalWeapons: 0,
  minUnlockedTier: 0,
  inGuild: false,
  isGuildLeader: false,
  bossWins: 0,
  distinctBossesBeaten: 0,
  miniGameWins: 0,
  messagesSent: 0,
  isRankOne: false,
};

/** The collected keys for one empire, memoised per request. */
const getClaimedKeysCached = cache((empireId: string) =>
  getClaimedKeys(prisma, empireId)
);

/**
 * The counters snapshot for one empire, memoised per request.
 *
 * Exported because the achievements ladder is no longer its only reader: the
 * mission board measures its goals as differences against this same snapshot
 * (see lib/game/missions.ts), and on the daily screen both land in one request.
 * Memoising here is what keeps that one query rather than two of the heaviest
 * reads in the app.
 *
 * Callers must have already authorised access to `empireId` — this does no auth
 * of its own.
 */
export const getEmpireStats = cache(
  async (empireId: string): Promise<AchievementStats | null> =>
    gatherAchievementStats(prisma, empireId, await getClaimedKeysCached(empireId))
);

/**
 * The full ladder for one empire. Callers must have already authorised access
 * to `empireId` — this does no auth of its own.
 *
 * Wrapped in React's `cache` because the game layout asks for the collectable
 * count on *every* screen while the achievements page asks for the whole
 * ladder: on that page both land in the same request and must not gather twice.
 */
export const getAchievementsState = cache(
  async (empireId: string): Promise<AchievementsState | null> => {
    const claimedKeys = await getClaimedKeysCached(empireId);

    // Nothing left to earn — skip the snapshot entirely. This is the steady
    // state for a finished account, so it is worth the branch. Note this is a
    // short-circuit on *this* ladder only: a daily board in the same request
    // still asks getEmpireStats for the snapshot it needs.
    if (claimedKeys.size >= ACHIEVEMENTS.length) {
      return buildAchievementsState(NO_STATS, claimedKeys);
    }

    const stats = await getEmpireStats(empireId);
    if (!stats) return null;
    return buildAchievementsState(stats, claimedKeys);
  }
);

/**
 * How many rewards are sitting unclaimed — the number behind the badge the
 * command bar and sidebar show on every screen.
 */
export async function getCollectableAchievements(empireId: string): Promise<number> {
  const state = await getAchievementsState(empireId);
  return state?.collectable ?? 0;
}
