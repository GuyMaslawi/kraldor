// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { IconName } from "@/components/ui/Icon";
import type { TranslateParams } from "@/i18n/translate";
import type { AchievementStats } from "./achievements";
import { effectiveHeroLevel } from "./hero";
import { seededRandom, seededSample } from "./random";
import { clampCities, rewardCityFactor, scaleRewards, type Reward } from "./rewards";

/**
 * לוח המשימות — the daily three and the weekly three.
 *
 * The achievements ladder answers "what have you done ever". It is a fine
 * ladder and a bad reason to open the game on a Tuesday: every rung is either
 * years away or already collected. This board answers "what is worth doing
 * *today*", resets, and is small enough to finish in one sitting.
 *
 * ## The one idea the whole feature rests on
 *
 * **A mission is a difference, not a tally.** Nothing here instruments a
 * gameplay action. `attackEmpire` was not touched, `spyOnEmpire` was not
 * touched, the bank was not touched. Instead the board freezes a snapshot of
 * the empire's lifetime counters when it opens (`MissionBaseline`, the same
 * numbers `gatherAchievementStats` already produces in one query), and a
 * mission's progress is `now − baseline`.
 *
 * That buys three things that a counter-per-action design does not:
 *
 *  - **No write on any hot path.** Attacking stays one transaction. A mission
 *    board that had to be incremented by every action would have put a second
 *    guarded write inside the battle transaction, on the game's busiest path.
 *  - **Adding a mission is a code change.** No migration, no backfill, and no
 *    "this counter has only been collected since Tuesday" gap.
 *  - **It cannot double-count.** There is no increment to fire twice; the
 *    difference of two reads is the difference of two reads however many
 *    requests are in flight.
 *
 * The cost, stated so nobody has to discover it: a board first opened at 22:00
 * baselines at 22:00, so the day's earlier attacks do not count. That is the
 * right trade — the alternative pays out for a morning the player did not spend
 * on the board — and it is why `openMissionBoard` runs on the first *read* of
 * the period rather than on the first claim.
 *
 * ## What may and may not be a mission
 *
 * Every stat a mission reads has to be a **lifetime counter that only rises**.
 * Balances (gold held, soldiers standing) are not: losing a battle would drive
 * a mission's progress backwards, and a bar that goes down because you were
 * raided is a punishment nobody signed up for. `missionProgress` clamps at zero
 * as a backstop, but the catalog is the real guard — see the rejected shapes
 * listed at the bottom of MISSION_SHAPES.
 *
 * A mission must also be something the player can **choose to do**. Repelling a
 * raid and winning a mini-game are both real accomplishments and neither is
 * available on demand: one needs an attacker, the other needs an admin to have
 * released a game. Both are deliberately weekly-only, where a week is long
 * enough for the opportunity to arrive on its own.
 */

/* ------------------------------ the baseline ------------------------------ */

/**
 * Every counter a mission may read, flattened to a plain numeric record so it
 * can be stored as JSON on the board row and read back without a schema.
 *
 * Deliberately a subset of `AchievementStats` rather than a new query: that
 * snapshot is already one round trip against indexed columns, already assembled
 * on every page load for the achievements badge, and already the thing the rest
 * of the game measures itself with.
 */
export const MISSION_STAT_KEYS = [
  "attacksLaunched",
  "attackWins",
  "defenseWins",
  "soldiersSlain",
  "soldiersEnslaved",
  "goldPlundered",
  "spyMissions",
  "spySuccesses",
  "heroLevelEffective",
  "heroItems",
  "epicItems",
  "bankDeposits",
  "bossWins",
  "miniGameWins",
  "messagesSent",
  "distinctWeapons",
  "totalWeapons",
  "maxMineLevel",
  "minStorageLevel",
  "minUpgradeLevel",
  "citizenGrowthLevel",
  "cities",
] as const;

export type MissionStatKey = (typeof MISSION_STAT_KEYS)[number];

export type MissionBaseline = Record<MissionStatKey, number>;

/**
 * Project the achievements snapshot onto the mission vocabulary.
 *
 * `heroLevelEffective` is the one field that is computed rather than copied,
 * and for the reason spelled out at length in achievements.ts: the raw level
 * column drops back to 1 on a prestige, so a mission reading it would go
 * backwards the moment a player used the reward it had just handed them.
 */
export function missionBaseline(stats: AchievementStats): MissionBaseline {
  return {
    attacksLaunched: stats.attacksLaunched,
    attackWins: stats.attackWins,
    defenseWins: stats.defenseWins,
    soldiersSlain: stats.soldiersSlain,
    soldiersEnslaved: stats.soldiersEnslaved,
    goldPlundered: stats.goldPlundered,
    spyMissions: stats.spyMissions,
    spySuccesses: stats.spySuccesses,
    heroLevelEffective: effectiveHeroLevel(stats.heroLevel, stats.heroResets),
    heroItems: stats.heroItems,
    epicItems: stats.epicItems,
    bankDeposits: stats.bankDeposits,
    bossWins: stats.bossWins,
    miniGameWins: stats.miniGameWins,
    messagesSent: stats.messagesSent,
    distinctWeapons: stats.distinctWeapons,
    totalWeapons: stats.totalWeapons,
    maxMineLevel: stats.maxMineLevel,
    minStorageLevel: stats.minStorageLevel,
    minUpgradeLevel: stats.minUpgradeLevel,
    citizenGrowthLevel: stats.citizenGrowthLevel,
    cities: stats.cities,
  };
}

/**
 * Read a stored baseline back, failing to **zero** on anything missing.
 *
 * The direction of that failure matters and is the opposite of the safe-looking
 * one. A key the catalog gained after this row was written has no baseline; if
 * it read as `Infinity` or as the current value the mission would show 0/N
 * forever, and if it threw the whole board would 500. Reading it as 0 makes the
 * mission's progress the empire's *lifetime* total, so a mission added mid-day
 * may complete immediately for a veteran — a one-off overpayment on the day a
 * mission is introduced, which is a far better failure than a dead board.
 */
export function readBaseline(json: unknown): MissionBaseline {
  const source = (json ?? {}) as Record<string, unknown>;
  const out = {} as MissionBaseline;
  for (const key of MISSION_STAT_KEYS) {
    const raw = source[key];
    out[key] = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  }
  return out;
}

/* ------------------------------ purses ------------------------------ */

/**
 * A mission's payout is drawn from one of four purses rather than written per
 * mission. Twenty-six hand-authored reward tables would drift the moment
 * anything was retuned, and the differences between them would be noise —
 * what a player actually reads is "this one pays turns, that one pays gold".
 *
 * Every figure is quoted at **one city**; `scaleRewards` applies the ×2.4 city
 * curve to the resource lines and leaves diamonds, spins and people alone.
 */
export type PurseName = "turns" | "gold" | "war" | "people";

const DAY_PURSE: Record<PurseName, readonly Reward[]> = {
  turns: [{ kind: "turns", amount: 55 }],
  gold: [{ kind: "gold", amount: 22_000 }],
  war: [
    { kind: "iron", amount: 14_000 },
    { kind: "turns", amount: 25 },
  ],
  people: [
    { kind: "citizens", amount: 30 },
    { kind: "wood", amount: 12_000 },
  ],
};

/**
 * The weekly purses. Roughly four times a daily one, not seven: a weekly
 * mission is one of three, it runs alongside seven days of dailies, and paying
 * a full week per mission would make the dailies pointless.
 */
const WEEK_PURSE: Record<PurseName, readonly Reward[]> = {
  turns: [
    { kind: "turns", amount: 220 },
    { kind: "wheelSpins", amount: 2 },
  ],
  gold: [
    { kind: "gold", amount: 90_000 },
    { kind: "turns", amount: 40 },
  ],
  war: [
    { kind: "iron", amount: 55_000 },
    { kind: "stone", amount: 55_000 },
    { kind: "turns", amount: 60 },
  ],
  people: [
    { kind: "citizens", amount: 130 },
    { kind: "wood", amount: 50_000 },
  ],
};

/* ------------------------------ the catalog ------------------------------ */

export type MissionScope = "DAY" | "WEEK";

/**
 * One shape of mission, declared once and offered at two sizes.
 *
 * `day` and `week` are the goals; `null` means the shape is not offered at that
 * scope. Everything else — the wording, the stat, the purse — is shared, which
 * is what keeps this catalog readable at twenty-odd entries and keeps the
 * daily and weekly versions of "raid" from drifting into two different
 * missions with the same name.
 */
export interface MissionShape {
  /** Stable id; the board row stores it. Never reuse or rename one. */
  key: string;
  icon: IconName;
  /** Translation pattern — `{goal}` is filled from the resolved goal. */
  name: string;
  hint: string;
  /** The lifetime counter this mission measures. */
  stat: MissionStatKey;
  /** Goal at one city, per scope. `null` = not offered at that scope. */
  day: number | null;
  week: number | null;
  /**
   * Whether the goal itself rides the city curve. True for the shapes measured
   * in resources or bodies — "plunder 40,000 gold" is a morning's work at city
   * one and a single attack at city eight — and false for the ones counted in
   * discrete acts, where three attacks are three attacks at any size.
   */
  scaledGoal?: boolean;
  purse: PurseName;
  /** Cities the empire must hold for this shape to be dealt at all. */
  minCities?: number;
}

/**
 * The pool. Order is only the order they are declared in; what a player sees is
 * a seeded draw (see `rollMissions`).
 *
 * **Weekly-only shapes** are the ones a player cannot make happen on demand:
 * repelling a raid needs an attacker, a mini-game needs an admin to have
 * released one, and a legendary drop needs luck. Over a week each of those
 * arrives on its own; over a day, dealing one is dealing a blank.
 *
 * **Rejected shapes**, so nobody re-adds them: anything reading a *balance*
 * (gold held, soldiers standing, spies trained) rather than a lifetime counter.
 * All of them go down when a player is raided, and a mission bar that empties
 * because somebody else attacked you is a punishment, not a goal. "Train N
 * soldiers" looks like a counter and is not one — soldiers die.
 */
export const MISSION_SHAPES: readonly MissionShape[] = [
  {
    key: "raid",
    icon: "attack",
    name: "{goal} פשיטות",
    hint: "פתח ב-{goal} תקיפות — ניצחון או הפסד, שתיהן נספרות",
    stat: "attacksLaunched",
    day: 3,
    week: 20,
    purse: "turns",
  },
  {
    key: "conquer",
    icon: "rankings",
    name: "{goal} ניצחונות",
    hint: "נצח ב-{goal} תקיפות",
    stat: "attackWins",
    day: 2,
    week: 12,
    purse: "war",
  },
  {
    key: "plunder",
    icon: "gold",
    name: "שוד {goal} זהב",
    hint: "שדוד {goal} זהב מאימפריות אחרות",
    stat: "goldPlundered",
    day: 25_000,
    week: 200_000,
    scaledGoal: true,
    purse: "gold",
  },
  {
    key: "slay",
    icon: "army",
    name: "{goal} חיילי אויב",
    hint: "חסל {goal} חיילי אויב — בתקיפה או בהגנה",
    stat: "soldiersSlain",
    day: 400,
    week: 3_500,
    scaledGoal: true,
    purse: "war",
  },
  {
    key: "enslave",
    icon: "citizens",
    name: "{goal} שבויים",
    hint: "שבה {goal} חיילי אויב לעבדות מכרות",
    stat: "soldiersEnslaved",
    day: 60,
    week: 500,
    scaledGoal: true,
    purse: "people",
  },
  {
    key: "scout",
    icon: "spy",
    name: "{goal} משימות ריגול",
    hint: "שלח {goal} משימות ריגול",
    stat: "spyMissions",
    day: 3,
    week: 20,
    purse: "turns",
  },
  {
    key: "intel",
    icon: "reports",
    name: "{goal} דוחות ריגול",
    hint: "חזור עם {goal} דוחות ריגול מוצלחים",
    stat: "spySuccesses",
    day: 2,
    week: 12,
    purse: "gold",
  },
  {
    key: "vault",
    icon: "bank",
    name: "{goal} הפקדות בבנק",
    hint: "הפקד זהב בבנק {goal} פעמים",
    stat: "bankDeposits",
    day: 1,
    week: 6,
    purse: "gold",
  },
  {
    key: "tyrant",
    icon: "crown",
    name: "{goal} בוסים",
    hint: "הפל את בוס העיר {goal} פעמים",
    stat: "bossWins",
    day: 1,
    week: 5,
    purse: "war",
  },
  {
    key: "armorer",
    icon: "factory",
    name: "{goal} כלי נשק",
    hint: "רכוש {goal} כלי נשק במפעל",
    stat: "totalWeapons",
    day: 40,
    week: 300,
    scaledGoal: true,
    purse: "gold",
  },
  {
    key: "arsenal",
    icon: "upgrades",
    name: "{goal} דגמי נשק חדשים",
    hint: "הוסף {goal} דגמי נשק שלא היו לך למחסן",
    stat: "distinctWeapons",
    day: 1,
    week: 4,
    purse: "war",
  },
  {
    key: "ascend",
    icon: "hero",
    name: "{goal} רמות גיבור",
    hint: "העלה את הגיבור {goal} רמות",
    stat: "heroLevelEffective",
    day: 1,
    week: 5,
    purse: "turns",
  },
  {
    key: "delve",
    icon: "mine",
    name: "{goal} רמות מכרה",
    hint: "שדרג את המכרה המפותח ביותר שלך ב-{goal} רמות",
    stat: "maxMineLevel",
    day: 2,
    week: 12,
    purse: "people",
  },
  {
    key: "granary",
    icon: "storage",
    name: "מחסנים ב-{goal} רמות",
    hint: "העלה את המחסן הנמוך ביותר שלך ב-{goal} רמות",
    stat: "minStorageLevel",
    day: 1,
    week: 4,
    purse: "people",
  },
  {
    key: "decree",
    icon: "achievements",
    name: "{goal} רמות שדרוג",
    hint: "העלה את השדרוג הנמוך ביותר שלך ב-{goal} רמות",
    stat: "minUpgradeLevel",
    day: null,
    week: 2,
    purse: "gold",
  },
  {
    key: "census",
    icon: "citizens",
    name: 'קבלת מגויסים +{goal}',
    hint: 'שדרג את "קבלת מגויסים" ב-{goal} רמות',
    stat: "citizenGrowthLevel",
    day: 1,
    week: 6,
    purse: "people",
  },
  /* ---- weekly only: the opportunity has to come to you ---- */
  {
    key: "bulwark",
    icon: "shield",
    name: "{goal} הדיפות",
    hint: "הדוף {goal} תקיפות על האימפריה שלך — הן מגיעות אליך, לא אתה אליהן",
    stat: "defenseWins",
    day: null,
    week: 3,
    purse: "war",
  },
  {
    key: "relic",
    icon: "shop",
    name: "{goal} פריטי ציוד",
    hint: "אסוף {goal} פריטי ציוד לגיבור — מתקיפות שניצחת וממסעות",
    stat: "heroItems",
    day: null,
    week: 4,
    purse: "war",
  },
  {
    key: "epic",
    icon: "spark",
    name: "פריט אפי",
    hint: "זכה בפריט אחד בדרגת נדירות אפי לפחות",
    stat: "epicItems",
    day: null,
    week: 1,
    purse: "turns",
  },
  {
    key: "gambler",
    icon: "dice",
    name: "{goal} ניצחונות במיני-משחק",
    hint: "נצח {goal} פעמים במיני-משחק — הם משוחררים מדי פעם, שים לב לסרגל העליון",
    stat: "miniGameWins",
    day: null,
    week: 1,
    purse: "turns",
  },
  {
    key: "envoy",
    icon: "messages",
    name: "{goal} מכתבים",
    hint: "שלח {goal} מכתבים לשחקנים אחרים",
    stat: "messagesSent",
    day: null,
    week: 3,
    purse: "people",
  },
  {
    key: "expand",
    icon: "base",
    name: "עיר נוספת",
    hint: "ייסד עיר נוספת לאימפריה",
    stat: "cities",
    day: null,
    week: 1,
    purse: "gold",
    // A one-city empire is still in the tutorial and founding its second city is
    // a milestone the achievements ladder already celebrates; dealing this as a
    // weekly there would be dealing a week-long blank.
    minCities: 2,
  },
];

export const MISSION_BY_KEY = new Map(MISSION_SHAPES.map((m) => [m.key, m]));

/** How many missions a board deals. Three is a board you can read at a glance. */
export const MISSIONS_PER_BOARD = 3;

/* ------------------------------ goals and purses ------------------------------ */

/**
 * A shape's goal at this scope for an empire of this size.
 *
 * The scaled goals round to something a player would say out loud: hundreds
 * below ten thousand, then thousands. An unrounded 47,382 gold reads as a bug
 * even when it is exactly right.
 */
export function missionGoal(
  shape: MissionShape,
  scope: MissionScope,
  cities: number
): number {
  const base = scope === "DAY" ? shape.day : shape.week;
  if (base == null) return 0;
  if (!shape.scaledGoal) return base;
  const raw = base * rewardCityFactor(cities);
  if (raw < 1_000) return Math.max(1, Math.round(raw / 10) * 10);
  if (raw < 10_000) return Math.round(raw / 100) * 100;
  return Math.round(raw / 1_000) * 1_000;
}

/** What completing a mission pays an empire of this size. */
export function missionRewards(
  shape: MissionShape,
  scope: MissionScope,
  cities: number
): Reward[] {
  const table = scope === "DAY" ? DAY_PURSE : WEEK_PURSE;
  return scaleRewards(table[shape.purse], cities);
}

/* ------------------------------ the draw ------------------------------ */

/**
 * The shapes that may be dealt to an empire of this size at this scope.
 *
 * Both filters matter. A shape with no goal at the scope is not offered there
 * at all (see the weekly-only block above), and `minCities` keeps a mission
 * that a small empire physically cannot do off its board.
 */
export function missionPool(
  scope: MissionScope,
  cities: number
): MissionShape[] {
  const held = clampCities(cities);
  return MISSION_SHAPES.filter(
    (s) =>
      (scope === "DAY" ? s.day : s.week) != null && held >= (s.minCities ?? 1)
  );
}

/**
 * Today's (or this week's) missions for one empire, as catalog keys.
 *
 * Seeded from the empire, the scope and the period — never from a clock or a
 * secure source. Two requests that race to open the same board therefore deal
 * the *same* three missions, so the unique index on
 * `(empireId, scope, period)` can drop whichever insert loses without a player
 * ever watching their board change under them. It also means the board is a
 * pure function of the row's key: a board row that is somehow lost can be
 * re-created identically, and a test can assert on a real draw without stubbing
 * randomness.
 *
 * The seed deliberately includes a version tag. Retuning the pool changes what
 * a given seed deals, which would swap a player's missions mid-period; bumping
 * the tag instead makes that an intentional, uniform reroll for everybody.
 */
export const MISSION_ROLL_VERSION = "v1";

export function rollMissions(
  empireId: string,
  scope: MissionScope,
  period: number,
  cities: number
): string[] {
  const pool = missionPool(scope, cities);
  const random = seededRandom(
    `${MISSION_ROLL_VERSION}:${empireId}:${scope}:${period}`
  );
  return seededSample(pool, MISSIONS_PER_BOARD, random).map((s) => s.key);
}

/* ------------------------------ progress ------------------------------ */

/**
 * How far along a mission is: the counter now, less what it was when the board
 * opened, floored at zero.
 *
 * The floor is a backstop rather than the design. Every stat in the catalog is
 * chosen to be monotonic (see the header), but two of them can dip in edge
 * cases the catalog cannot forbid — `heroItems` falls when a player discards
 * from a full bag, and `cities` falls when a city is lost to a siege. Neither
 * should ever show a negative bar, and neither should let a later re-gain count
 * twice: after a dip, the mission simply has further to climb.
 */
export function missionProgress(
  shape: MissionShape,
  now: MissionBaseline,
  base: MissionBaseline
): number {
  const delta = (now[shape.stat] ?? 0) - (base[shape.stat] ?? 0);
  return delta > 0 ? Math.floor(delta) : 0;
}

/* ------------------------------ view model ------------------------------ */

/** One row of the board, as the screen renders it. */
export interface MissionView {
  key: string;
  scope: MissionScope;
  icon: IconName;
  /** Translation source — render as `t(name, params)`. */
  name: string;
  hint: string;
  params: TranslateParams;
  goal: number;
  /** Clamped to `goal` for display. */
  progress: number;
  rewards: Reward[];
  done: boolean;
  claimed: boolean;
}

export interface MissionBoardState {
  scope: MissionScope;
  /** Jerusalem day (DAY) or week (WEEK) index this board belongs to. */
  period: number;
  /** When the board is swept and re-dealt, as an epoch millisecond. */
  resetsAt: number;
  missions: MissionView[];
  /** Completed and not yet collected — the badge count. */
  collectable: number;
}

/** Group a goal the way the rest of the game prints one. */
const num = (n: number) => n.toLocaleString("en-US");

/**
 * Project a board row into the view model. Pure, so the page and the claim
 * action agree on what "done" means without either re-deriving it.
 *
 * Keys with no catalog entry are dropped rather than thrown on: retiring a
 * mission shape must degrade a live board to two rows, not 500 it. Same rule
 * the glory board follows for a retuned capstone.
 */
export function buildMissionBoard(
  scope: MissionScope,
  period: number,
  resetsAt: number,
  keys: readonly string[],
  claimedKeys: readonly string[],
  now: MissionBaseline,
  base: MissionBaseline,
  cities: number
): MissionBoardState {
  const claimed = new Set(claimedKeys);
  const missions = keys.flatMap<MissionView>((key) => {
    const shape = MISSION_BY_KEY.get(key);
    if (!shape) return [];
    const goal = missionGoal(shape, scope, cities);
    if (goal <= 0) return [];
    const raw = missionProgress(shape, now, base);
    const isClaimed = claimed.has(key);
    return [
      {
        key,
        scope,
        icon: shape.icon,
        name: shape.name,
        hint: shape.hint,
        params: { goal: num(goal) },
        goal,
        // A collected mission always reads full. Its counter cannot fall, so
        // this is belt and braces — but it also means a mission claimed and
        // then affected by a `heroItems` discard still reads as done, which is
        // what the receipt says happened.
        progress: isClaimed ? goal : Math.min(goal, raw),
        rewards: missionRewards(shape, scope, cities),
        done: isClaimed || raw >= goal,
        claimed: isClaimed,
      },
    ];
  });

  return {
    scope,
    period,
    resetsAt,
    missions,
    collectable: missions.filter((m) => m.done && !m.claimed).length,
  };
}
