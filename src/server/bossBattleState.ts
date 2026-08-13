import "server-only";
import { prisma } from "@/lib/prisma";
import { getTunables } from "@/lib/game/config";
import { seasonPassDay } from "@/lib/game/seasonPass";
import { isHeroDead } from "@/lib/game/hero";
import { bossForCity, bossReward, type BossReward, type CityBoss } from "@/lib/game/bosses";
import {
  BOSS_FURY_MAX,
  BOSS_ROUT_LOSS_FRACTION,
  bossChipFraction,
  bossPayout,
  bossReadChance,
  type BossRound,
} from "@/lib/game/bossBattle";
import { getLiveHappyHour, happyHourFactor } from "@/server/happyHour";

/**
 * Read model for the arena — the screen an assault plays out on.
 *
 * The one rule here is that **un-elapsed rounds never leave the server**. The whole
 * battle is decided at launch, so shipping the full plan to the client would hand
 * it the ending and reduce the minute to a progress bar with spoilers. `rounds` is
 * therefore filtered to what the clock has already revealed, and the client's only
 * job is to re-read as time passes.
 */
export interface BossArenaState {
  battleId: string;
  boss: CityBoss;
  cityTier: number;

  /** Rounds the plan contains, and how many have been revealed so far. */
  totalRounds: number;
  revealed: BossRound[];
  /** Rounds the officers read right so far — the live half of the grade. */
  correctSoFar: number;

  /** Server clock and deadline, so the countdown never depends on the device's. */
  serverNow: number;
  startedAt: number;
  endsAt: number;
  /**
   * When the next round lands, absolute — or null once the last one has.
   *
   * Only the *timing* of the coming round leaves the server, never its content:
   * the cadence is a published constant (`BOSS_ROUND_REVEAL_MS`), so this spoils
   * nothing, and it is what lets the arena say "the next clash is in 4s" instead
   * of leaving the player staring at a bar that moves for no stated reason.
   */
  nextRoundAt: number | null;
  /** True once the clock has run out and the settle is the next thing to happen. */
  finished: boolean;

  /** The officers' chance to read a move right — what the hero contributes. */
  readChance: number;

  attackPower: number;
  soldiersAtStart: number;
  /** Casualties among the revealed rounds — not yet applied to the army. */
  soldiersLostSoFar: number;

  /** The boss's health, as of the last revealed round. */
  bossHp: number;
  bossMaxHp: number;
  bossHpAtStart: number;
  damageSoFar: number;

  /** Fury meter as of the last revealed round. */
  fury: number;
  furyMax: number;
  routLine: number;

  /** Chip loot the revealed damage has earned so far, for the running readout. */
  earned: BossReward;
}

/**
 * How recently a sortie must have settled for the arena to still consider its
 * report "the thing the player is waiting for".
 *
 * It exists because the settle is a race by design: the arena's poll, the inbox
 * poll and the banner all call `settleDueAssault`, and only the one that wins the
 * lock is handed the fight id. The losers see an empire with no running assault —
 * which used to read as "nothing to watch" and bounce the player to the ladder,
 * one second after the report they were owed had rendered. Every caller resolves
 * that ambiguity the same way: look for a report that has just been written.
 */
export const BOSS_JUST_SETTLED_MS = 3 * 60 * 1000;

/** The report of an assault that settled moments ago, whoever settled it. */
export async function recentBossFightId(empireId: string): Promise<string | null> {
  const cutoff = new Date(Date.now() - BOSS_JUST_SETTLED_MS);
  const fight = await prisma.bossFight.findFirst({
    where: { empireId, createdAt: { gt: cutoff } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return fight?.id ?? null;
}

/** The running assault for `empireId`, or null when there is none to watch. */
export async function getBossArenaState(empireId: string): Promise<BossArenaState | null> {
  const now = new Date();

  const battle = await prisma.bossBattle.findFirst({
    where: { empireId, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    include: { siege: true },
  });
  if (!battle) return null;

  const [tunables, season, hero, happyHour] = await Promise.all([
    getTunables(),
    prisma.gameSeason.findFirst({
      where: { isActive: true },
      select: { startsAt: true, endsAt: true },
    }),
    // The read chance is the one number that explains *why* the rounds go the way
    // they do, so the arena states it out loud rather than leaving the officers'
    // hit rate looking like unexplained luck.
    prisma.hero.findUnique({
      where: { empireId },
      select: { level: true, health: true, diedAt: true },
    }),
    // The running tally below is what the settle will actually pay, so a live
    // Happy Hour has to be in it — otherwise the arena counts up one number and
    // the report hands over a bigger one.
    getLiveHappyHour(undefined, now),
  ]);

  const plan = Array.isArray(battle.log) ? (battle.log as unknown as BossRound[]) : [];
  const elapsed = now.getTime() - battle.startedAt.getTime();
  const revealed = plan.filter((r) => r.at <= elapsed);
  const last = revealed.at(-1);

  const damageSoFar = revealed.reduce((sum, r) => sum + r.damage, 0);
  const lifeHaul = bossReward(
    battle.siege.cityTier,
    seasonPassDay(season, now.getTime()),
    tunables.boss.rewardMultiplier,
    tunables.boss.slaveMultiplier
  );

  return {
    battleId: battle.id,
    boss: bossForCity(battle.siege.cityTier),
    cityTier: battle.siege.cityTier,

    totalRounds: plan.length,
    revealed,
    correctSoFar: revealed.filter((r) => r.correct).length,

    serverNow: now.getTime(),
    startedAt: battle.startedAt.getTime(),
    endsAt: battle.endsAt.getTime(),
    nextRoundAt: plan[revealed.length]
      ? battle.startedAt.getTime() + plan[revealed.length].at
      : null,
    finished: battle.endsAt <= now,

    readChance: bossReadChance(hero?.level ?? 1, hero != null && !isHeroDead(hero)),

    attackPower: battle.attackPower,
    soldiersAtStart: battle.soldiersAtStart,
    soldiersLostSoFar: revealed.reduce((sum, r) => sum + r.soldiersLost, 0),

    // Falls back to the pre-assault health before the first round lands, so the
    // bar starts where the banner left it rather than at zero.
    bossHp: last ? last.bossHpAfter : battle.hpAtStart,
    bossMaxHp: battle.siege.maxHp,
    bossHpAtStart: battle.hpAtStart,
    damageSoFar,

    fury: last ? last.fury : 0,
    furyMax: BOSS_FURY_MAX,
    routLine: BOSS_ROUT_LOSS_FRACTION,

    earned: bossPayout(
      lifeHaul,
      bossChipFraction(Math.min(damageSoFar, battle.hpAtStart), battle.siege.maxHp),
      happyHourFactor(happyHour, "boostPlunder")
    ),
  };
}
