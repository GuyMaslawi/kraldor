import "server-only";
import { cache } from "react";
import type { MissionScope as PrismaMissionScope, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmpireStats } from "@/server/achievementState";
import {
  gameDay,
  gameWeek,
  nextGameDayStart,
  nextGameWeekStart,
} from "@/lib/game/time";
import {
  buildMissionBoard,
  missionBaseline,
  readBaseline,
  rollMissions,
  type MissionBaseline,
  type MissionBoardState,
  type MissionScope,
} from "@/lib/game/missions";
import {
  GUILD_CONTRACT_BY_KEY,
  guildContractGoal,
  guildContractReward,
  rollGuildContract,
  type GuildContractView,
} from "@/lib/game/guildContract";
import {
  liveStreakCount,
  streakCycleDay,
  streakRungRewards,
  streakTransition,
  STREAK_CYCLE_DAYS,
  STREAK_LADDER,
} from "@/lib/game/streak";
import type { Reward } from "@/lib/game/rewards";

/**
 * Read side of לוח היום — the muster roll, the two mission boards and the
 * guild's contract.
 *
 * Split out of the actions module for the reason the achievements ladder is:
 * the page and the claim path must evaluate "is this owed" through exactly one
 * function, or the button and the payout eventually disagree.
 *
 * ## Where the writes are, and why they are not in the layout
 *
 * Opening a board *inserts a row*. That is a write on what is otherwise a read
 * path, and it is confined to one place on purpose: `getDailyState`, which only
 * the daily screen calls. The nav badge goes through `getDailyBadge`, which
 * reads existing rows and never creates one — so navigating the game costs no
 * writes, and the only cost of never visiting the board is that the badge
 * counts the streak alone until the first visit of the day.
 *
 * That is also why the baseline is frozen on first *read* rather than on first
 * claim: a board opened at 22:00 measures from 22:00, which is the honest
 * reading of "what did you do while this board was up".
 */

/* ------------------------------ the muster roll ------------------------------ */

/** The streak card, as the board renders it. */
export interface StreakState {
  /** The run as it actually stands today — 0 once a gap has killed it. */
  count: number;
  /** The longest run this empire has ever put together. */
  best: number;
  /** Today's roll is unsigned. */
  claimable: boolean;
  /** Position in the seven-day cycle the *next* claim lands on (1..7). */
  nextCycleDay: number;
  /** What that claim pays, at this empire's size. */
  nextRewards: Reward[];
  /** Every rung of the cycle with its payout, for the seven-tile ladder. */
  ladder: { day: number; name: string; rewards: Reward[]; passed: boolean }[];
  /** A run was broken by a gap — the board says so instead of silently resetting. */
  broken: boolean;
  /** Midnight Jerusalem, when the next roll opens (epoch ms). */
  resetsAt: number;
}

/**
 * The streak card from the empire row alone — no query.
 *
 * Every input is a column `requireEmpire` has already loaded, which is what
 * lets the nav badge ask "is there a roll to sign" on every page load for free.
 */
export function buildStreakState(
  empire: { streakDay: number; streakCount: number; streakBest: number; cities: number },
  now: Date
): StreakState {
  const today = gameDay(now);
  const live = liveStreakCount(empire.streakDay, empire.streakCount, today);
  const transition = streakTransition(empire.streakDay, empire.streakCount, today);
  // The rung the *next* claim lands on. For an unsigned day that is the run
  // after this claim; for a day already signed it is the rung just collected,
  // so the card keeps highlighting what today was worth rather than jumping
  // ahead to tomorrow's tile.
  const nextCount = transition.claimable ? transition.nextCount : Math.max(1, live);
  const cycleDay = streakCycleDay(nextCount);

  return {
    count: live,
    best: Math.max(empire.streakBest, live),
    claimable: transition.claimable,
    nextCycleDay: cycleDay,
    nextRewards: streakRungRewards(cycleDay, empire.cities),
    ladder: STREAK_LADDER.map((rung) => ({
      day: rung.day,
      name: rung.name,
      rewards: streakRungRewards(rung.day, empire.cities),
      // "Already collected in this pass through the cycle." The tile for today
      // is deliberately not marked passed while it is still claimable — it is
      // the one the card is pointing at.
      passed: transition.claimable ? rung.day < cycleDay : rung.day <= cycleDay,
    })),
    broken: transition.claimable && transition.broken,
    resetsAt: nextGameDayStart(now).getTime(),
  };
}

/* ------------------------------ mission boards ------------------------------ */

/** The period index and reset instant for a scope. */
function periodOf(scope: MissionScope, now: Date): { period: number; resetsAt: number } {
  return scope === "DAY"
    ? { period: gameDay(now), resetsAt: nextGameDayStart(now).getTime() }
    : { period: gameWeek(now), resetsAt: nextGameWeekStart(now).getTime() };
}

/**
 * The board row for this period, creating it if this is the first look.
 *
 * The create is safe to race. Both the mission draw and the period key are pure
 * functions of `(empireId, scope, period)`, so two concurrent first-loads
 * compute the identical row; the unique index rejects the loser, and the
 * `catch` re-reads what the winner wrote. That is why this is a plain create
 * with a fallback read rather than an upsert — an upsert would have to name an
 * update branch, and there is nothing here that should ever be updated on read.
 *
 * The baseline is the caller's already-gathered snapshot, so opening a board
 * costs one INSERT and no extra query.
 */
async function openMissionBoard(
  empireId: string,
  scope: MissionScope,
  period: number,
  cities: number,
  stats: MissionBaseline
) {
  const existing = await prisma.missionBoard.findUnique({
    where: {
      empireId_scope_period: {
        empireId,
        scope: scope as PrismaMissionScope,
        period,
      },
    },
  });
  if (existing) return existing;

  try {
    return await prisma.missionBoard.create({
      data: {
        empireId,
        scope: scope as PrismaMissionScope,
        period,
        missions: rollMissions(empireId, scope, period, cities),
        claimed: [],
        baseline: stats as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Lost the race. The winner wrote the same missions and a baseline taken
    // milliseconds apart, so re-reading is not a compromise — it is the same
    // board.
    return prisma.missionBoard.findUniqueOrThrow({
      where: {
        empireId_scope_period: {
          empireId,
          scope: scope as PrismaMissionScope,
          period,
        },
      },
    });
  }
}

/* ------------------------------ the guild contract ------------------------------ */

/**
 * The guild's contract for today, creating it on first look — same racing
 * argument as a mission board, with the member count frozen into `goal`.
 *
 * Returns null for a guildless empire, which is most of the reason this is a
 * separate function: the daily screen renders for everybody and the contract
 * panel simply is not there for a player with no guild.
 */
async function openGuildContract(guildId: string, day: number) {
  const existing = await prisma.guildContract.findUnique({
    where: { guildId_day: { guildId, day } },
  });
  if (existing) return existing;

  const contract = rollGuildContract(guildId, day);
  const members = await prisma.guildMember.count({ where: { guildId } });

  try {
    return await prisma.guildContract.create({
      data: {
        guildId,
        day,
        key: contract.key,
        goal: guildContractGoal(contract, members),
        paid: [],
      },
    });
  } catch {
    return prisma.guildContract.findUniqueOrThrow({
      where: { guildId_day: { guildId, day } },
    });
  }
}

/** Project a contract row into the viewer's own view of it. */
function buildContractView(
  row: {
    key: string;
    goal: number;
    progress: number;
    completedAt: Date | null;
    paid: string[];
  },
  viewerEmpireId: string,
  viewerCities: number,
  members: number
): GuildContractView | null {
  const contract = GUILD_CONTRACT_BY_KEY.get(row.key);
  // A retired contract key degrades to no panel rather than a crash — the same
  // rule the glory board follows for a retuned capstone.
  if (!contract) return null;
  return {
    key: contract.key,
    name: contract.name,
    lore: contract.lore,
    icon: contract.icon,
    goal: row.goal,
    progress: Math.min(row.goal, Math.max(0, row.progress)),
    complete: row.completedAt !== null,
    collected: row.paid.includes(viewerEmpireId),
    reward: guildContractReward(contract, viewerCities),
    members,
  };
}

/* ------------------------------ the whole screen ------------------------------ */

export interface DailyState {
  /**
   * The clock every `resetsAt` on this object was computed against.
   *
   * Handed to the client rather than letting it read its own: the countdowns
   * have to agree with the boundary the *server* will enforce, and a reader
   * whose device is an hour fast would otherwise decide the board had expired
   * and reload in a loop.
   */
  serverNow: number;
  streak: StreakState;
  day: MissionBoardState;
  week: MissionBoardState;
  /** Null for a player with no guild. */
  contract: GuildContractView | null;
  /** Everything waiting to be collected across all three panels. */
  collectable: number;
}

/**
 * Everything the daily screen renders, in one place — and the only function in
 * the app that opens a board.
 *
 * Memoised per request because the page reads it and the claim actions
 * re-render through it; without that the two boards would be opened twice on
 * the first load of a day.
 */
export const getDailyState = cache(
  async (empireId: string): Promise<DailyState | null> => {
    const empire = await prisma.empire.findUnique({
      where: { id: empireId },
      select: {
        id: true,
        cities: true,
        streakDay: true,
        streakCount: true,
        streakBest: true,
        guildMembership: { select: { guildId: true } },
      },
    });
    if (!empire) return null;

    const stats = await getEmpireStats(empireId);
    if (!stats) return null;
    const nowStats = missionBaseline(stats);

    const now = new Date();
    const dayPeriod = periodOf("DAY", now);
    const weekPeriod = periodOf("WEEK", now);

    const [dayRow, weekRow] = await Promise.all([
      openMissionBoard(empireId, "DAY", dayPeriod.period, empire.cities, nowStats),
      openMissionBoard(empireId, "WEEK", weekPeriod.period, empire.cities, nowStats),
    ]);

    const day = buildMissionBoard(
      "DAY",
      dayPeriod.period,
      dayPeriod.resetsAt,
      dayRow.missions,
      dayRow.claimed,
      nowStats,
      readBaseline(dayRow.baseline),
      empire.cities
    );
    const week = buildMissionBoard(
      "WEEK",
      weekPeriod.period,
      weekPeriod.resetsAt,
      weekRow.missions,
      weekRow.claimed,
      nowStats,
      readBaseline(weekRow.baseline),
      empire.cities
    );

    let contract: GuildContractView | null = null;
    const guildId = empire.guildMembership?.guildId;
    if (guildId) {
      const row = await openGuildContract(guildId, dayPeriod.period);
      const members = await prisma.guildMember.count({ where: { guildId } });
      contract = buildContractView(row, empireId, empire.cities, members);
    }

    const streak = buildStreakState(empire, now);

    return {
      serverNow: now.getTime(),
      streak,
      day,
      week,
      contract,
      collectable:
        (streak.claimable ? 1 : 0) +
        day.collectable +
        week.collectable +
        (contract?.complete && !contract.collected ? 1 : 0),
    };
  }
);

/* ------------------------------ the nav badge ------------------------------ */

/**
 * How many things on the daily board are waiting — the number behind the nav
 * badge, asked for on every screen.
 *
 * Deliberately a *cheaper and slightly less complete* answer than
 * `getDailyState`: it never opens a board and never counts a guild contract.
 * The streak comes free from the empire row the layout already holds, and the
 * mission count is one indexed read of whatever boards already exist plus the
 * counters snapshot the layout is gathering anyway for the achievements badge.
 *
 * The consequence: on the first page load of a day, before the board has been
 * opened, the badge counts the roll alone. That is the right trade — the
 * alternative is two INSERTs on every navigation in the game.
 */
export async function getDailyBadge(
  empire: {
    id: string;
    cities: number;
    streakDay: number;
    streakCount: number;
    streakBest: number;
  },
  now: Date
): Promise<number> {
  const streak = buildStreakState(empire, now);
  let waiting = streak.claimable ? 1 : 0;

  const rows = await prisma.missionBoard.findMany({
    where: {
      empireId: empire.id,
      OR: [
        { scope: "DAY", period: gameDay(now) },
        { scope: "WEEK", period: gameWeek(now) },
      ],
    },
    select: { scope: true, period: true, missions: true, claimed: true, baseline: true },
  });
  if (rows.length === 0) return waiting;

  const stats = await getEmpireStats(empire.id);
  if (!stats) return waiting;
  const nowStats = missionBaseline(stats);

  for (const row of rows) {
    waiting += buildMissionBoard(
      row.scope as MissionScope,
      row.period,
      0,
      row.missions,
      row.claimed,
      nowStats,
      readBaseline(row.baseline),
      empire.cities
    ).collectable;
  }
  return waiting;
}

/** Re-exported so the page can label the cycle without importing the catalog. */
export { STREAK_CYCLE_DAYS };
