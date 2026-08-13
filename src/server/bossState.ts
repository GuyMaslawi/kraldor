import "server-only";
import { prisma } from "@/lib/prisma";
import { getTunables } from "@/lib/game/config";
import { seasonPassDay } from "@/lib/game/seasonPass";
import { armyPower } from "@/lib/game/power";
import { weaponsPower } from "@/lib/game/weapons";
import { getActiveGuildBuffPct } from "@/lib/game/guildBuffs";
import { getGuildAidBonus } from "@/lib/game/guildAid";
import { bonusMultiplier, heroBonuses, isHeroDead } from "@/lib/game/hero";
import type { FullEmpire } from "@/lib/game/updates";
import { notStaff } from "@/lib/staff";
import {
  bossForCity,
  bossHeroXp,
  bossPower,
  bossReviveMs,
  bossReward,
  bossTurnCost,
  type BossReward,
  type CityBoss,
} from "@/lib/game/bosses";
import {
  BOSS_SORTIE_ROUNDS,
  bossChipFraction,
  bossExpectedSortieDamage,
  bossExpectedSortieLosses,
  bossLossScale,
  bossPayout,
  bossReadChance,
  bossSiegeMaxHp,
  bossSortiesToKill,
  refitSiegePool,
} from "@/lib/game/bossBattle";
import { getLiveHappyHour, happyHourFactor } from "@/server/happyHour";

/** One empire that has felled the city's boss, for the banner's honour roll. */
export interface BossConqueror {
  empireId: string;
  empireName: string;
  kills: number;
  lastAt: Date;
}

export interface CityBossState {
  boss: CityBoss;
  /** The boss's reference battle power, after the admin multiplier. */
  power: number;
  turnCost: number;
  /** The viewer's real attack power, computed exactly as the assault computes it. */
  myPower: number;
  myTurns: number;

  /** This life's health pool and what is left of it. */
  hp: number;
  maxHp: number;
  /** Assaults launched against this life. */
  sorties: number;

  /** Set while the tyrant is dead: when it returns, in server time. */
  revivesAt: Date | null;
  /** How long a felled boss stays dead, for the countdown's ceiling. */
  reviveMs: number;
  serverNow: number;

  /** The haul this life is worth, before the chip/kill split. */
  lifeHaul: BossReward;
  heroXp: number;

  /** What one assault of this army is expected to take off, and how many it needs. */
  expectedSortieDamage: number;
  sortiesToKill: number;
  roundsPerSortie: number;
  /** How often this hero's officers read the tyrant right, as a fraction. */
  readChance: number;

  /**
   * The trade one assault offers, priced before the turns are paid: soldiers it
   * is expected to cost, against the share of the haul the damage above would
   * earn. Printed together, because half a trade is what made the boss read as a
   * bad deal — the blood was only ever visible in the report, afterwards.
   */
  soldiers: number;
  expectedSortieLosses: number;
  expectedSortieLoot: BossReward;

  /**
   * Every term the attack power is built from, so "how do I hit harder" has an
   * answer on the screen rather than in a wiki. Same decomposition the assault
   * itself computes (see `battlePower` in bossSiege.ts).
   */
  armyPower: number;
  weaponPower: number;
  heroBonusPct: number;
  guildBonusPct: number;
  guildAidPower: number;
  /** The hero, who is the only thing that moves the casualty side of the trade. */
  heroLevel: number;
  heroAlive: boolean;

  /** A running assault, if one is in flight. */
  activeBattleId: string | null;
  activeEndsAt: Date | null;

  /** Everything that must be true before the attack button is live. */
  canAttack: boolean;
  /**
   * This empire is out of the game and may never march — a staff account or a
   * planted garrison. Distinct from the other reasons `canAttack` is false, all
   * of which are temporary: this one never clears, so the banner says so
   * outright instead of offering a countdown that will not come.
   */
  blocked: boolean;
  /** This empire's total victories over this boss, all-time. */
  myKills: number;
  conquerors: BossConqueror[];
}

/** How many conquerors the banner's honour roll lists. */
const CONQUEROR_ROWS = 5;

/**
 * Everything the boss banner renders, for an already-settled empire.
 *
 * Strictly a read: it never opens a boss life and never settles an assault. A
 * player loading the rankings page has not attacked anything, and materialising
 * state for every viewer would write on a GET. Where no life exists yet the pool
 * is reported at full — which is what attacking would create anyway.
 */
export async function getCityBossState(empire: FullEmpire): Promise<CityBossState> {
  const now = new Date();
  const boss = bossForCity(empire.cities);
  const tunables = await getTunables();
  // Read once and used both as the button's gate and as the banner's reason —
  // the same predicate `startBossAssault` refuses on, so the screen can never
  // offer a march the action will turn away.
  const blocked = empire.isStaff || empire.isBot;

  const [
    guildBonusPct,
    guildAid,
    season,
    life,
    activeBattle,
    myKills,
    recent,
    happyHour,
  ] = await Promise.all([
      getActiveGuildBuffPct(empire.id, "ATTACK", prisma, now),
      getGuildAidBonus(empire.id),
      prisma.gameSeason.findFirst({
        where: { isActive: true },
        select: { startsAt: true, endsAt: true },
      }),
      // The newest life of this tier's boss — alive, or counting down to its
      // return. See `currentLife` in bossSiege.ts for the same rule on the write
      // path.
      prisma.bossSiege.findFirst({
        where: { empireId: empire.id, cityTier: empire.cities },
        orderBy: { createdAt: "desc" },
      }),
      prisma.bossBattle.findFirst({
        where: { empireId: empire.id, status: "ACTIVE" },
        orderBy: { startedAt: "desc" },
        select: { id: true, endsAt: true },
      }),
      prisma.bossFight.count({
        where: { empireId: empire.id, victory: true, cityTier: empire.cities },
      }),
      // Newest victories in this city tier. Grouping in SQL would lose the
      // empire names, so we take a bounded recent window and fold it in JS.
      // Staff kills are left out — the conquerors list is a ranking, and they
      // are not in the running (src/lib/staff.ts).
      prisma.bossFight.findMany({
        where: { victory: true, cityTier: empire.cities, empire: notStaff },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          empireId: true,
          createdAt: true,
          empire: { select: { name: true } },
        },
      }),
      getLiveHappyHour(prisma, now),
    ]);

  const heroBonusPct = heroBonuses(empire.hero).totalPct.attack;
  const rawArmyPower = armyPower(empire.army);
  const rawWeaponPower = weaponsPower(empire.weapons, "ATTACK");
  const myPower =
    (rawArmyPower + rawWeaponPower) *
      bonusMultiplier(heroBonusPct) *
      bonusMultiplier(guildBonusPct) +
    guildAid.power;

  const power = bossPower(empire.cities, tunables.boss.powerMultiplier);
  const turnCost = bossTurnCost(empire.cities);
  const fullHp = bossSiegeMaxHp(
    empire.cities,
    tunables.boss.powerMultiplier,
    tunables.boss.hpMultiplier
  );

  // Dead and still counting down: the pool shown is the *next* life's, at full.
  const dead = life?.revivesAt != null && life.revivesAt > now;
  const alive = life != null && life.killedAt == null && life.hp > 0;
  // A life stamped before the curve last moved is quoted at today's pool, at the
  // share of it the player has already taken off — the same fit the next march
  // will write (see `refitSiegePool`). Computed rather than persisted on purpose:
  // this runs on every rankings render, and a write on a read path that hot is
  // exactly the finding the 2026-08-01 audit raised.
  const pool = alive
    ? refitSiegePool(life.hp, life.maxHp, fullHp)
    : { hp: fullHp, maxHp: fullHp };
  const maxHp = pool.maxHp;
  const hp = pool.hp;

  const heroLevel = empire.hero?.level ?? 1;
  const heroAlive = empire.hero != null && !isHeroDead(empire.hero);
  const soldiers = empire.army?.soldiers ?? 0;
  const expectedDamage = bossExpectedSortieDamage(myPower, heroLevel, heroAlive);
  // Everything this banner quotes — the tyrant's full haul, the XP, the loot a
  // single sortie expects — is quoted *including* a live Happy Hour, because it is
  // the number the settle will pay. Advertising the un-boosted figure during the
  // one hour the game is shouting about a bonus would be the worst possible
  // moment to be off.
  const happyPlunder = happyHourFactor(happyHour, "boostPlunder");
  const cycleHaul = bossPayout(
    bossReward(
      empire.cities,
      seasonPassDay(season, now.getTime()),
      tunables.boss.rewardMultiplier,
      tunables.boss.slaveMultiplier
    ),
    1,
    happyPlunder
  );

  const byEmpire = new Map<string, BossConqueror>();
  for (const row of recent) {
    const entry = byEmpire.get(row.empireId);
    if (entry) entry.kills += 1;
    else
      byEmpire.set(row.empireId, {
        empireId: row.empireId,
        empireName: row.empire.name,
        kills: 1,
        lastAt: row.createdAt,
      });
  }
  const conquerors = [...byEmpire.values()]
    .sort((a, b) => b.kills - a.kills || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, CONQUEROR_ROWS);

  return {
    boss,
    power,
    turnCost,
    myPower,
    myTurns: empire.turns,

    hp,
    maxHp,
    sorties: alive ? life.sorties : 0,

    revivesAt: dead ? life.revivesAt : null,
    reviveMs: bossReviveMs(tunables.boss.reviveMinutes),
    serverNow: now.getTime(),

    lifeHaul: cycleHaul,
    heroXp: Math.round(
      bossHeroXp(empire.cities, tunables.boss.heroXpMultiplier) *
        happyHourFactor(happyHour, "boostXp")
    ),

    expectedSortieDamage: expectedDamage,
    sortiesToKill: bossSortiesToKill(myPower, hp, heroLevel, heroAlive),
    roundsPerSortie: BOSS_SORTIE_ROUNDS,
    readChance: bossReadChance(heroLevel, heroAlive),

    soldiers,
    expectedSortieLosses: bossExpectedSortieLosses(
      soldiers,
      heroLevel,
      heroAlive,
      // Same scale the simulation charges, so the price on the banner is the
      // price paid — an army under the wall is quoted its reduced share.
      bossLossScale(myPower, power)
    ),
    // Priced against the same pool the settle pays from, so the projection and
    // the payout cannot drift: the chip share of the haul, for the damage this
    // assault expects to land.
    expectedSortieLoot: bossPayout(cycleHaul, bossChipFraction(expectedDamage, maxHp)),

    armyPower: rawArmyPower,
    weaponPower: rawWeaponPower,
    heroBonusPct,
    guildBonusPct,
    guildAidPower: guildAid.power,
    heroLevel,
    heroAlive,

    activeBattleId: activeBattle?.id ?? null,
    activeEndsAt: activeBattle?.endsAt ?? null,

    canAttack:
      tunables.boss.enabled >= 1 &&
      !blocked &&
      !dead &&
      activeBattle == null &&
      empire.turns >= turnCost &&
      (empire.army?.soldiers ?? 0) > 0,
    blocked,
    myKills,
    conquerors,
  };
}
