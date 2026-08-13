// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import { scaleRewards, type Reward } from "./rewards";

/**
 * רצף הכניסה — the muster roll.
 *
 * The game had no mechanical reason to open it on a day you did not feel like
 * playing. Turns accrue whether you are there or not, mines settle lazily, and
 * the season pass repeats twice a day — so a player who skipped Tuesday lost
 * nothing they could point at. This is the one loop that makes a *visit* worth
 * something, and it is deliberately the cheapest thing in the game to complete:
 * open the board, press the button, done.
 *
 * Four rules:
 *
 * 1. **A day is a Jerusalem calendar day**, not a daily-update boundary — see
 *    `gameDay` in time.ts. A player who signs in at 23:00 and again at 08:00 has
 *    come back on two days even though only one 07:30 bell rang between them,
 *    and counting on the game clock would break the streak of everyone whose
 *    habit is late nights.
 * 2. **The ladder is a seven-day cycle that repeats.** Day 7 is the prize, and
 *    then it starts again at day 1. A ladder that kept climbing forever would be
 *    unreachable for anyone joining in week six of a season; one that ended at
 *    day 7 would stop mattering the moment it was finished.
 * 3. **A missed day costs the run, never the record.** `streakCount` goes back
 *    to 1 and `streakBest` keeps the high-water mark. There is deliberately no
 *    way to buy the gap back: a streak you can pay to repair is not a reason to
 *    come back tomorrow, it is a reason to come back on payday.
 * 4. **Nothing runs while the player is away.** No job clears a dead streak —
 *    the *next* claim sees the gap and starts the count again, and the board
 *    asks `streakAlive` rather than printing the stored number. That is what
 *    keeps the whole feature two integers on the empire row.
 */

/* ------------------------------ the cycle ------------------------------ */

/** One rung of the seven-day cycle. */
export interface StreakRung {
  /** 1..7 — position in the cycle, not the length of the streak. */
  day: number;
  /** What the rung is called on the board. */
  name: string;
  /** Payout quoted at **one city**; `streakRungRewards` applies the curve. */
  rewards: readonly Reward[];
}

export const STREAK_CYCLE_DAYS = 7;

/**
 * The diamond payout at the top of every week.
 *
 * 25 is small on purpose, and the number was picked against the store rather
 * than against the ladder: a player who never misses a day earns 25 a week,
 * roughly 215 across a full season — a fifth of חותם המלוכה, and a tenth of what
 * the achievement ladder pays across a 100% run. Enough to make the seventh day
 * feel like the seventh day, nowhere near enough to be a way of buying
 * anything. The season pass excludes diamonds outright for this reason (see
 * seasonPass.ts); a once-a-week trickle is the most a repeating loop can carry.
 */
export const STREAK_WEEK_DIAMONDS = 25;

/**
 * The ladder, quoted at one city. Read it as the shape of a week rather than as
 * figures: the first three days are small and different from each other (turns,
 * then gold, then spins), four and five step up, six is the resource day, and
 * seven is the one people come back for.
 */
export const STREAK_LADDER: readonly StreakRung[] = [
  {
    day: 1,
    name: "יום ראשון ברצף",
    rewards: [
      { kind: "turns", amount: 40 },
      { kind: "gold", amount: 8_000 },
    ],
  },
  {
    day: 2,
    name: "יום שני ברצף",
    rewards: [
      { kind: "gold", amount: 18_000 },
      { kind: "citizens", amount: 25 },
    ],
  },
  {
    day: 3,
    name: "יום שלישי ברצף",
    rewards: [
      { kind: "turns", amount: 70 },
      { kind: "wheelSpins", amount: 2 },
    ],
  },
  {
    day: 4,
    name: "יום רביעי ברצף",
    rewards: [
      { kind: "wood", amount: 22_000 },
      { kind: "iron", amount: 22_000 },
      { kind: "stone", amount: 22_000 },
    ],
  },
  {
    day: 5,
    name: "יום חמישי ברצף",
    rewards: [
      { kind: "turns", amount: 110 },
      { kind: "citizens", amount: 45 },
    ],
  },
  {
    day: 6,
    name: "יום שישי ברצף",
    rewards: [
      { kind: "gold", amount: 45_000 },
      { kind: "iron", amount: 35_000 },
    ],
  },
  {
    day: 7,
    name: "שבוע שלם — מפקד הנאמנים",
    rewards: [
      { kind: "diamonds", amount: STREAK_WEEK_DIAMONDS },
      { kind: "turns", amount: 200 },
      { kind: "gold", amount: 70_000 },
      { kind: "wheelSpins", amount: 3 },
    ],
  },
];

/** Where in the seven-day cycle a streak of `count` days stands (1..7). */
export function streakCycleDay(count: number): number {
  if (!Number.isFinite(count) || count < 1) return 1;
  return ((Math.floor(count) - 1) % STREAK_CYCLE_DAYS) + 1;
}

/** The rung a streak of `count` days is standing on. */
export function streakRung(count: number): StreakRung {
  return STREAK_LADDER[streakCycleDay(count) - 1];
}

/** What a rung actually pays an empire holding `cities` cities. */
export function streakRungRewards(day: number, cities: number): Reward[] {
  const index = Math.min(STREAK_CYCLE_DAYS, Math.max(1, Math.floor(day) || 1)) - 1;
  return scaleRewards(STREAK_LADDER[index].rewards, cities);
}

/* ------------------------------ the transition ------------------------------ */

/**
 * What signing today's roll does to a streak. Pure, and separate from the
 * action, because this is the one piece of the feature with a rule worth
 * testing on its own: yesterday continues the run, *any* older gap starts a new
 * one, and today cannot be signed twice.
 *
 * `lastDay` is `Empire.streakDay` — 0 for an empire that has never claimed,
 * which is 1970-01-01 and so is always a gap.
 */
export interface StreakTransition {
  /** False when the roll for `today` is already signed. */
  claimable: boolean;
  /** The streak length after claiming — 1 when the run restarts. */
  nextCount: number;
  /** True when a previous run was broken by the gap. */
  broken: boolean;
}

export function streakTransition(
  lastDay: number,
  count: number,
  today: number
): StreakTransition {
  if (lastDay >= today) {
    return { claimable: false, nextCount: Math.max(1, count), broken: false };
  }
  const continues = lastDay === today - 1 && count > 0;
  return {
    claimable: true,
    nextCount: continues ? count + 1 : 1,
    broken: !continues && count > 0,
  };
}

/**
 * Whether a *stored* streak is still alive at `today`.
 *
 * A streak last signed the day before yesterday is already dead, but nothing
 * has run to say so — no job clears the column, by design (rule 4). The board
 * therefore has to ask this rather than print `streakCount`, or a player
 * returning after a week is shown the twelve-day run they no longer have and
 * then watches it silently become 1 the moment they claim.
 */
export function streakAlive(lastDay: number, count: number, today: number): boolean {
  return count > 0 && lastDay >= today - 1;
}

/** The run as the board should print it: 0 once the gap has killed it. */
export function liveStreakCount(lastDay: number, count: number, today: number): number {
  return streakAlive(lastDay, count, today) ? count : 0;
}
