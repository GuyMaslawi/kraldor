// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { IconName } from "@/components/ui/Icon";
import { LOCALE_TAG, type Locale } from "@/i18n/locale";
import type { TranslateParams } from "@/i18n/translate";
import {
  GAME_TIMEZONE,
  MAX_CITIES,
  MINE_MAX_LEVEL,
  MINE_START_LEVEL,
  citizenGrowthMaxLevel,
  citizensPerDailyUpdate,
} from "./constants";
import { HERO_MAX_LEVEL, effectiveHeroLevel } from "./hero";
import { MAX_WEAPON_TIER, WEAPONS } from "./weapons";
// The world-record purse is paid through the shared payout vocabulary
// (payRewards), not through the achievement ladder's narrower one — a record is
// not a collected achievement. Aliased because this module already has a
// module-private `Reward` of its own shape.
import type { Reward as PrizeLine } from "./rewards";

/**
 * Achievements: a one-off (never resetting) reward ladder covering the whole
 * arc of an empire, from "you launched your first attack" to "you hold all ten
 * cities and every weapon in the game".
 *
 * Four rules shape the design:
 *
 * 1. **Progress is derived, never stored.** Each entry declares its condition
 *    as a function over an `AchievementStats` snapshot that
 *    `src/server/achievementState.ts` assembles from tables the game already
 *    writes. No gameplay action has to be instrumented to keep a counter in
 *    sync, and a goal can be retuned here without a database migration. The
 *    only row ever written is the claim receipt (`EmpireAchievement`).
 *
 * 2. **Claiming is explicit.** Reaching a goal unlocks the reward; the player
 *    still presses collect. That keeps every payout on one guarded path
 *    (receipt insert + credit in one transaction) instead of firing from a
 *    hundred unrelated call sites.
 *
 * 3. **Ladders, not one-offs.** Most milestones come as a `chain` of tiers
 *    sharing one stat — first attack, 10, 50, 100, 500, 1,000 — so there is
 *    always a next rung in sight and the reward curve can grow with it. The
 *    top rung of a chain is deliberately pinned to the game's real ceiling
 *    (MAX_CITIES, HERO_MAX_LEVEL, MINE_MAX_LEVEL, WEAPON_TOTAL) so "finish the
 *    game" and "finish the ladder" are the same act.
 *
 * 4. **Diamonds are rationed.** The season pass excludes diamonds outright
 *    because it repeats twice a day and would undercut the real-money store
 *    (see seasonPass.ts). Achievements fire once per empire *ever*, so a
 *    budget is affordable — but it is confined to the handful of capstones
 *    below, totalling ACHIEVEMENT_DIAMOND_BUDGET across a 100% run. That is
 *    roughly one premium season pass for completing the entire game.
 */

/* ------------------------------ rewards ------------------------------ */

/** Every resource an achievement may pay out. Keys match RESOURCE_ICON. */
export type AchievementRewardKind =
  | "gold"
  | "wood"
  | "iron"
  | "stone"
  | "diamonds"
  | "citizens"
  | "turns";

export const ACHIEVEMENT_REWARD_LABEL: Record<AchievementRewardKind, string> = {
  gold: "זהב",
  wood: "עץ",
  iron: "ברזל",
  stone: "אבן",
  diamonds: "יהלומים",
  citizens: "אזרחים",
  turns: "תורות",
};

/** Canonical display order for a merged payout — resources, then the specials. */
export const ACHIEVEMENT_REWARD_ORDER: readonly AchievementRewardKind[] = [
  "gold",
  "wood",
  "iron",
  "stone",
  "citizens",
  "turns",
  "diamonds",
];

/** One line of a collect summary: everything of a single kind, added up. */
export interface AchievementRewardTotal {
  kind: AchievementRewardKind;
  amount: number;
}

/**
 * Merge a batch of rewards into one total per resource.
 *
 * Collecting fifty achievements at once otherwise reads as fifty fragments —
 * "5,000 עץ · 40,000 עץ · 80,000 עץ · …" — which is a wall of text that hides
 * the only thing the player wants to know. One line per resource, in a fixed
 * order, says the same thing in a glance.
 */
export function mergeRewards(
  rewards: readonly { kind: AchievementRewardKind; amount: number }[]
): AchievementRewardTotal[] {
  const totals = new Map<AchievementRewardKind, number>();
  for (const r of rewards) {
    totals.set(r.kind, (totals.get(r.kind) ?? 0) + r.amount);
  }
  return ACHIEVEMENT_REWARD_ORDER.filter((k) => totals.has(k)).map((kind) => ({
    kind,
    amount: totals.get(kind)!,
  }));
}

/**
 * Total diamonds the whole ladder can ever pay one empire.
 *
 * Keep this equal to the sum of every `diamonds` reward below — it had drifted
 * to 1,700 against an actual 2,000, and a payout budget nobody can trust is
 * worse than no budget at all. Re-add it up when you add or retune a diamond
 * capstone.
 */
export const ACHIEVEMENT_DIAMOND_BUDGET = 2_000;

/* ------------------------------ categories ------------------------------ */

export type AchievementCategory =
  | "war"
  | "espionage"
  | "hero"
  | "economy"
  | "empire"
  | "legacy";

export const ACHIEVEMENT_CATEGORY_META: Record<
  AchievementCategory,
  { label: string; icon: IconName }
> = {
  war: { label: "מלחמה", icon: "attack" },
  espionage: { label: "ריגול", icon: "spy" },
  hero: { label: "גיבור", icon: "hero" },
  economy: { label: "כלכלה", icon: "gold" },
  empire: { label: "אימפריה", icon: "base" },
  legacy: { label: "תהילה", icon: "crown" },
};

/** Display order of the category filter and of the grouped lists. */
export const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = [
  "war",
  "espionage",
  "hero",
  "economy",
  "empire",
  "legacy",
];

/* ------------------------------ stats ------------------------------ */

/**
 * Everything the catalog can test against, gathered once per request by
 * `gatherAchievementStats`. Counters are lifetime totals for the empire;
 * levels and balances are current values.
 *
 * Adding a field here means adding it to the SQL snapshot in
 * src/server/achievementState.ts — there is no other producer.
 */
export interface AchievementStats {
  /* --- war --- */
  /** Attacks this empire launched, win or lose. */
  attacksLaunched: number;
  /** Attacks this empire launched and won. */
  attackWins: number;
  /** Attacks against this empire that it repelled. */
  defenseWins: number;
  /** Enemy soldiers killed, attacking and defending. */
  soldiersSlain: number;
  /** Enemy soldiers captured into the mine-slave pool by winning attacks. */
  soldiersEnslaved: number;
  /** Gold taken from other empires in won attacks. */
  goldPlundered: number;

  /* --- espionage --- */
  /** Spy missions this empire launched. */
  spyMissions: number;
  /** Spy missions that came back with a report. */
  spySuccesses: number;

  /* --- hero --- */
  /**
   * The hero's raw level, as the column stands right now — it drops back to 1
   * on every prestige. Nothing that has to *stay* earned may read this; use
   * `effectiveHeroLevel(heroLevel, heroResets)` (see the `herolvl` chain).
   */
  heroLevel: number;
  /** Times the hero hit the cap and was reset (prestige). */
  heroResets: number;
  /** Hero items owned, equipped or in the bag. */
  heroItems: number;
  epicItems: number;
  legendaryItems: number;
  /** Items currently equipped — 9 is a full paperdoll. */
  equippedItems: number;

  /* --- economy --- */
  gold: number;
  wood: number;
  iron: number;
  stone: number;
  diamonds: number;
  turns: number;
  /** Gold sitting in the bank right now. */
  bankBalance: number;
  /** Bank DEPOSIT transactions made. */
  bankDeposits: number;
  /** Bank INTEREST payouts received. */
  interestPayments: number;
  /** Mines raised above MINE_START_LEVEL — every mine starts built at that level. */
  minesBuilt: number;
  /** Lowest level among the four mines: the "all mines at N" measure. */
  minMineLevel: number;
  /** Highest level of any single mine. */
  maxMineLevel: number;
  /** Lowest level among the four warehouses. */
  minStorageLevel: number;

  /* --- empire --- */
  cities: number;
  /** Level of the CITIZEN_GROWTH upgrade (starts at 1). */
  citizenGrowthLevel: number;
  /** Lowest level across all empire upgrades: the "all upgrades at N" measure. */
  minUpgradeLevel: number;
  soldiers: number;
  spies: number;
  mineSlaves: number;
  /** Distinct weapon models owned, per category and overall (max 30 / 90). */
  attackWeapons: number;
  defenseWeapons: number;
  spyWeapons: number;
  distinctWeapons: number;
  /** Total weapon units held across every model. */
  totalWeapons: number;
  /** Lowest unlocked tier across the three categories. */
  minUnlockedTier: number;

  /* --- legacy --- */
  inGuild: boolean;
  isGuildLeader: boolean;
  /** City-boss runs won. */
  bossWins: number;
  /** Distinct city tiers whose boss has been felled (max MAX_CITIES). */
  distinctBossesBeaten: number;
  miniGameWins: number;
  /** Player-to-player letters sent. */
  messagesSent: number;
  /**
   * Rank 1 of the city bucket this empire competes in. Computing it costs an
   * O(bucket) power scan, so the gatherer only fills it in while the rank
   * achievement is still unclaimed — see `needsRankScan`.
   */
  isRankOne: boolean;
}

/* ------------------------------ definitions ------------------------------ */

export interface AchievementDefinition {
  /** Stable id persisted in EmpireAchievement.key — never reuse or rename. */
  key: string;
  category: AchievementCategory;
  /**
   * Translation source for the title. A rung of a chain carries the *pattern*
   * ("{goal} תקיפות"), not the rendered text, so a ladder of seven rungs needs
   * one dictionary entry rather than seven — and the goal itself is filled from
   * `params` at the render site. See src/i18n/translate.ts.
   */
  name: string;
  /** One-line hint telling the player how to earn it — a pattern, like `name`. */
  hint: string;
  /** Fills the `{placeholders}` in both `name` and `hint`. */
  params?: TranslateParams;
  icon: IconName;
  reward: { kind: AchievementRewardKind; amount: number };
  /** Value of `progress` that unlocks the reward. */
  goal: number;
  /** Current standing against `goal`; the view model clamps it for display. */
  progress: (s: AchievementStats) => number;
}

type Reward = [AchievementRewardKind, number];

/** One rung of a chain: the goal, its reward, and the wording for both. */
type Rung = {
  goal: number;
  reward: Reward;
  /** Overrides the generated name — used for the first and last rungs. */
  name?: string;
  hint?: string;
  /** Extra placeholders for an overridden wording, merged over `{goal}`. */
  params?: TranslateParams;
};

/**
 * Build a tiered chain of achievements sharing one stat.
 *
 * Chains are why this file stays readable at ~90 entries: the shape of
 * "do more of X" is declared once and the rungs are just numbers. Keys are
 * `${prefix}_${goal}` so a rung can be retuned without orphaning a claim — the
 * goal is part of the identity, and changing a goal deliberately mints a new
 * achievement rather than silently re-locking a collected one.
 *
 * `label` and `hint` are translation *patterns* rather than functions of the
 * goal: one dictionary entry then covers every rung of the ladder, and the
 * number is substituted from `params` after the language is known.
 */
function chain(
  prefix: string,
  category: AchievementCategory,
  icon: IconName,
  stat: (s: AchievementStats) => number,
  label: string,
  hint: string,
  rungs: readonly Rung[],
  /** Placeholders every rung shares — a game constant quoted in the wording. */
  shared?: TranslateParams
): AchievementDefinition[] {
  return rungs.map((r) => ({
    key: `${prefix}_${r.goal}`,
    category,
    icon,
    name: r.name ?? label,
    hint: r.hint ?? hint,
    params: { goal: num(r.goal), ...shared, ...r.params },
    reward: { kind: r.reward[0], amount: r.reward[1] },
    goal: r.goal,
    progress: stat,
  }));
}

/** A single milestone that has no ladder around it. */
function one(
  key: string,
  category: AchievementCategory,
  icon: IconName,
  name: string,
  hint: string,
  goal: number,
  reward: Reward,
  progress: (s: AchievementStats) => number,
  params?: TranslateParams
): AchievementDefinition {
  return {
    key,
    category,
    icon,
    name,
    hint,
    params,
    goal,
    reward: { kind: reward[0], amount: reward[1] },
    progress,
  };
}

/**
 * Group a goal for display. Both languages the site speaks use Western digits
 * and a comma separator, so this is one function rather than a per-locale one —
 * and a goal baked into `params` at module load has no request to read a
 * language from anyway.
 */
const num = (n: number) => n.toLocaleString("en-US");

/**
 * Total distinct weapon models in the game — `TIERS_PER_CATEGORY × 3`.
 *
 * **Counted, not written down.** This was the literal `90` for as long as the
 * foundry had 30 tiers, and when it grew to 35 the literal stayed behind: the
 * top rung of the `arsenal` chain — and the world record hanging off it — asked
 * for 90 of 105 models, which is rule 3 of this file (a chain's top rung is the
 * game's real ceiling) quietly broken. A count cannot fall behind the catalogue.
 *
 * Retuning it mints a new key (`chain` embeds the goal), which is the intended
 * behaviour here: the ceiling moved, so the old capstone is retired and the new
 * one is open for everybody again — including its world record and purse. Rows
 * already awarded under `arsenal_90` keep their claimed rewards and are simply
 * no longer read.
 */
const WEAPON_TOTAL = WEAPONS.length;

/**
 * The absolute ceiling of the citizen-intake upgrade: 10 levels per city, so
 * only an empire holding all ten cities can reach it. Pays 1,020 a day.
 */
const CITIZEN_GROWTH_CAP = citizenGrowthMaxLevel(MAX_CITIES);

/**
 * The level that first pays a round 500 citizens per daily update — level 48 on
 * the shipped curve, about halfway up the ladder.
 *
 * Derived rather than written as a literal, so it follows when
 * `citizensPerDailyUpdate` is retuned — as it was when each city went from
 * paying 50 citizens a day to 100. Deliberately reads the *default* curve, not
 * the live tunables: an achievement key is `citizenup_<goal>`, so a goal that
 * moved with an admin edit would orphan every row already awarded under the old
 * key. It is well short of the cap — the two are different milestones and the
 * base-screen board deliberately shows this one.
 */
const CITIZEN_GROWTH_500 = (() => {
  for (let level = 1; level <= CITIZEN_GROWTH_CAP; level += 1) {
    if (citizensPerDailyUpdate(level) >= 500) return level;
  }
  return CITIZEN_GROWTH_CAP;
})();

/**
 * The one achievement whose condition costs a full power scan of the city
 * bucket, so the gatherer skips it once collected (see `needsRankScan`).
 */
export const RANK_ONE_KEY = "rank_one";

/* ------------------------------ the ladder ------------------------------ */

const WAR: AchievementDefinition[] = [
  ...chain(
    "attacks",
    "war",
    "attack",
    (s) => s.attacksLaunched,
    "{goal} תקיפות",
    "פתח ב-{goal} תקיפות, בניצחון או בהפסד",
    [
      { goal: 1, reward: ["citizens", 40], name: "תקיפה ראשונה", hint: "תקוף אימפריה אחת מהדירוג" },
      { goal: 10, reward: ["turns", 30] },
      { goal: 50, reward: ["turns", 80] },
      { goal: 100, reward: ["gold", 60_000] },
      { goal: 250, reward: ["turns", 200] },
      { goal: 500, reward: ["gold", 400_000] },
      { goal: 1_000, reward: ["turns", 500], name: "אלף תקיפות", hint: "פתח ב-1,000 תקיפות — מצביא אמיתי" },
    ]
  ),
  ...chain(
    "wins",
    "war",
    "rankings",
    (s) => s.attackWins,
    "{goal} ניצחונות",
    "נצח ב-{goal} תקיפות",
    [
      { goal: 1, reward: ["citizens", 40], name: "ניצחון ראשון", hint: "נצח בתקיפה אחת" },
      { goal: 10, reward: ["turns", 60] },
      { goal: 50, reward: ["gold", 120_000] },
      { goal: 100, reward: ["turns", 250] },
      { goal: 250, reward: ["iron", 500_000] },
      { goal: 500, reward: ["turns", 600] },
    ]
  ),
  ...chain(
    "defense",
    "war",
    "shield",
    (s) => s.defenseWins,
    "{goal} הדיפות",
    "הדוף {goal} תקיפות על האימפריה שלך",
    [
      { goal: 1, reward: ["stone", 8_000], name: "חומה ראשונה", hint: "הדוף תקיפה אחת על האימפריה שלך" },
      { goal: 10, reward: ["stone", 60_000] },
      { goal: 50, reward: ["stone", 300_000] },
      { goal: 150, reward: ["turns", 350] },
    ]
  ),
  ...chain(
    "slain",
    "war",
    "army",
    (s) => s.soldiersSlain,
    "{goal} חיילי אויב",
    "חסל {goal} חיילי אויב בקרב",
    [
      { goal: 100, reward: ["citizens", 50] },
      { goal: 1_000, reward: ["iron", 40_000] },
      { goal: 10_000, reward: ["iron", 250_000] },
      { goal: 100_000, reward: ["turns", 400], name: "קוצר הנשמות", hint: "חסל 100,000 חיילי אויב" },
    ]
  ),
  ...chain(
    "enslaved",
    "war",
    "citizens",
    (s) => s.soldiersEnslaved,
    "{goal} שבויים",
    "שבה {goal} חיילי אויב לעבדות מכרות",
    [
      { goal: 10, reward: ["citizens", 50] },
      { goal: 100, reward: ["citizens", 120] },
      { goal: 1_000, reward: ["gold", 300_000] },
    ]
  ),
  ...chain(
    "plunder",
    "war",
    "gold",
    (s) => s.goldPlundered,
    "שוד {goal} זהב",
    "שדוד {goal} זהב מאימפריות אחרות",
    [
      { goal: 10_000, reward: ["gold", 10_000] },
      { goal: 100_000, reward: ["gold", 80_000] },
      { goal: 1_000_000, reward: ["turns", 200] },
      { goal: 10_000_000, reward: ["turns", 500], name: "מלך השודדים", hint: "שדוד 10,000,000 זהב מאימפריות אחרות" },
    ]
  ),
];

const ESPIONAGE: AchievementDefinition[] = [
  ...chain(
    "spy",
    "espionage",
    "spy",
    (s) => s.spyMissions,
    "{goal} משימות ריגול",
    "שלח {goal} משימות ריגול",
    [
      { goal: 1, reward: ["citizens", 40], name: "ריגול ראשון", hint: "שלח מרגלים לאימפריה אחת" },
      { goal: 10, reward: ["turns", 30] },
      { goal: 50, reward: ["turns", 80] },
      { goal: 200, reward: ["gold", 150_000] },
      { goal: 500, reward: ["turns", 300] },
    ]
  ),
  ...chain(
    "spywin",
    "espionage",
    "reports",
    (s) => s.spySuccesses,
    "{goal} דוחות ריגול",
    "חזור עם {goal} דוחות ריגול מוצלחים",
    [
      { goal: 1, reward: ["citizens", 40], name: "דוח ראשון", hint: "חזור עם דוח ריגול מוצלח אחד" },
      { goal: 25, reward: ["turns", 60] },
      { goal: 100, reward: ["turns", 150] },
      { goal: 300, reward: ["turns", 400], name: "צל האימפריה", hint: "חזור עם 300 דוחות ריגול מוצלחים" },
    ]
  ),
  ...chain(
    "spies",
    "espionage",
    "spy",
    (s) => s.spies,
    "{goal} מרגלים",
    "אמן {goal} מרגלים",
    [
      { goal: 100, reward: ["citizens", 60] },
      { goal: 1_000, reward: ["gold", 200_000] },
      { goal: 5_000, reward: ["turns", 300] },
    ]
  ),
];

const HERO: AchievementDefinition[] = [
  ...chain(
    "herolvl",
    "hero",
    "hero",
    // Effective level, not the raw column. A prestige sends the hero back to
    // level 1, and reading `heroLevel` made every rung of this ladder — up to
    // and including the level-100 capstone and its world record — *un-reach*
    // itself the moment the player used the reward it had just unlocked. A
    // player who climbed to 100 and reset before the base screen next loaded
    // lost the record outright and could never claim rungs 50/75/100 again.
    // The effective level only ever rises (level + resets × HERO_MAX_LEVEL), so
    // "climbed to level N" stays true once it is true — which is what a
    // one-off ladder and a first-to-reach record both require.
    (s) => effectiveHeroLevel(s.heroLevel, s.heroResets),
    "גיבור ברמה {goal}",
    "העלה את הגיבור שלך לרמה {goal}",
    [
      { goal: 5, reward: ["citizens", 50] },
      { goal: 10, reward: ["turns", 60] },
      { goal: 25, reward: ["turns", 120] },
      { goal: 50, reward: ["gold", 250_000] },
      { goal: 75, reward: ["turns", 300] },
      {
        goal: HERO_MAX_LEVEL,
        reward: ["diamonds", 250],
        name: "גיבור בשיא",
        hint: "העלה את הגיבור שלך לרמה {goal} — הרמה המרבית",
      },
    ]
  ),
  ...chain(
    "heroreset",
    "hero",
    "spark",
    (s) => s.heroResets,
    "{goal} איפוסי גיבור",
    "אפס את הגיבור {goal} פעמים לאחר שהגיע לשיא",
    [
      {
        goal: 1,
        reward: ["diamonds", 100],
        name: "לידה מחדש",
        hint: "אפס את הגיבור בפעם הראשונה לאחר שהגיע לשיא",
      },
      { goal: 3, reward: ["turns", 250] },
      { goal: 5, reward: ["turns", 500] },
    ]
  ),
  ...chain(
    "items",
    "hero",
    "shop",
    (s) => s.heroItems,
    "{goal} פריטי ציוד",
    "אסוף {goal} פריטי ציוד לגיבור",
    [
      {
        goal: 1,
        reward: ["diamonds", 50],
        name: "למצוא חפץ ראשון",
        hint: "נצח בתקיפה וזכה בציוד לגיבור",
      },
      { goal: 10, reward: ["iron", 40_000] },
      { goal: 25, reward: ["iron", 150_000] },
      { goal: 50, reward: ["turns", 250] },
    ]
  ),
  ...chain(
    "epic",
    "hero",
    "potion",
    (s) => s.epicItems,
    "{goal} פריטים אפיים",
    "זכה ב-{goal} פריטים בדרגת נדירות אפי",
    [
      { goal: 1, reward: ["turns", 60], name: "חפץ אפי", hint: "זכה בפריט אחד בדרגת נדירות אפי" },
      { goal: 10, reward: ["turns", 200] },
    ]
  ),
  ...chain(
    "legendary",
    "hero",
    "spark",
    (s) => s.legendaryItems,
    "{goal} פריטים אגדיים",
    "זכה ב-{goal} פריטים בדרגת נדירות אגדי",
    [
      {
        goal: 1,
        reward: ["diamonds", 150],
        name: "חפץ אגדי",
        hint: "זכה בפריט אחד בדרגת נדירות אגדי",
      },
      { goal: 5, reward: ["turns", 300] },
      { goal: 10, reward: ["turns", 600] },
    ]
  ),
  one(
    "full_gear",
    "hero",
    "shield",
    "ציוד מלא",
    "צייד את הגיבור בכל תשעת המשבצות בו-זמנית",
    9,
    ["diamonds", 100],
    (s) => s.equippedItems
  ),
];

const ECONOMY: AchievementDefinition[] = [
  ...chain(
    "mines",
    "economy",
    "mine",
    (s) => s.minesBuilt,
    "{goal} מכרות",
    "שדרג {goal} מכרות מעל רמה {start}",
    [
      {
        goal: 1,
        reward: ["wood", 5_000],
        name: "לשדרג מכרה",
        hint: "שדרג מכרה אחד מעל רמה {start}",
      },
      {
        goal: 4,
        reward: ["wood", 40_000],
        name: "לשדרג את כל המכרות",
        hint: "שדרג את ארבעת המכרות מעל רמה {start}",
      },
    ],
    { start: num(MINE_START_LEVEL) }
  ),
  ...chain(
    "minelvl",
    "economy",
    "factory",
    (s) => s.minMineLevel,
    "כל המכרות ברמה {goal}",
    "שדרג את ארבעת המכרות לרמה {goal} ומעלה",
    [
      { goal: 10, reward: ["wood", 80_000] },
      { goal: 25, reward: ["wood", 300_000] },
      { goal: 50, reward: ["turns", 250] },
      { goal: 100, reward: ["turns", 500] },
      {
        goal: MINE_MAX_LEVEL,
        reward: ["diamonds", 150],
        name: "תעשייה בשיא",
        hint: "שדרג את ארבעת המכרות לרמה {goal} — הרמה המרבית",
      },
    ]
  ),
  ...chain(
    "storage",
    "economy",
    "storage",
    (s) => s.minStorageLevel,
    "כל המחסנים ברמה {goal}",
    "שדרג את ארבעת המחסנים לרמה {goal} ומעלה",
    [
      { goal: 5, reward: ["stone", 40_000] },
      { goal: 10, reward: ["stone", 150_000] },
      { goal: 25, reward: ["turns", 300] },
    ]
  ),
  ...chain(
    "gold",
    "economy",
    "gold",
    (s) => s.gold,
    "{goal} זהב",
    "החזק {goal} זהב בבת אחת",
    [
      { goal: 1_000_000, reward: ["turns", 150], name: "מיליונר ראשון", hint: "החזק 1,000,000 זהב בבת אחת" },
      { goal: 10_000_000, reward: ["turns", 300] },
      { goal: 100_000_000, reward: ["turns", 600], name: "הון עתק", hint: "החזק 100,000,000 זהב בבת אחת" },
    ]
  ),
  ...chain(
    "deposits",
    "economy",
    "bank",
    (s) => s.bankDeposits,
    "{goal} הפקדות",
    "בצע {goal} הפקדות בבנק",
    [
      { goal: 1, reward: ["gold", 10_000], name: "הפקדה ראשונה בבנק", hint: "הפקד זהב בבנק פעם אחת" },
      { goal: 25, reward: ["gold", 80_000] },
      { goal: 100, reward: ["gold", 400_000] },
    ]
  ),
  ...chain(
    "bankbal",
    "economy",
    "bank",
    (s) => s.bankBalance,
    "{goal} זהב בבנק",
    "החזק {goal} זהב בחשבון הבנק",
    [
      { goal: 100_000, reward: ["gold", 25_000] },
      { goal: 1_000_000, reward: ["turns", 150] },
      { goal: 10_000_000, reward: ["turns", 400] },
    ]
  ),
  ...chain(
    "interest",
    "economy",
    "bank",
    (s) => s.interestPayments,
    "{goal} תשלומי ריבית",
    "קבל {goal} תשלומי ריבית מהבנק",
    [
      { goal: 1, reward: ["gold", 15_000], name: "ריבית ראשונה", hint: "קבל תשלום ריבית אחד מהבנק" },
      { goal: 30, reward: ["gold", 200_000] },
    ]
  ),
  one(
    "hoarder",
    "economy",
    "storage",
    "מחסנים מלאים",
    "החזק מיליון עץ, מיליון ברזל ומיליון אבן בו-זמנית",
    3,
    ["turns", 350],
    (s) =>
      (s.wood >= 1_000_000 ? 1 : 0) +
      (s.iron >= 1_000_000 ? 1 : 0) +
      (s.stone >= 1_000_000 ? 1 : 0)
  ),
];

const EMPIRE: AchievementDefinition[] = [
  ...chain(
    "cities",
    "empire",
    "base",
    (s) => s.cities,
    "{goal} ערים",
    "ייסד אימפריה בת {goal} ערים",
    [
      { goal: 2, reward: ["gold", 50_000], name: "לעלות עיר", hint: "ייסד עיר שנייה" },
      { goal: 3, reward: ["gold", 150_000] },
      { goal: 5, reward: ["turns", 250] },
      { goal: 7, reward: ["turns", 400] },
      {
        goal: MAX_CITIES,
        reward: ["diamonds", 300],
        name: "קיסרות",
        hint: "החזק את כל {goal} הערים — האימפריה המלאה",
      },
    ]
  ),
  ...chain(
    "citizenup",
    "empire",
    "citizens",
    (s) => s.citizenGrowthLevel,
    "קבלת מגויסים {goal}",
    'שדרג את "קבלת מגויסים" לרמה {goal}',
    [
      { goal: 2, reward: ["citizens", 60], name: "לשדרג קבלת מגויסים", hint: 'שדרג את "קבלת מגויסים" לרמה 2' },
      { goal: 5, reward: ["citizens", 150] },
      { goal: 10, reward: ["citizens", 300] },
      // The round number the design aims at, and the rung the base-screen board
      // draws (see GLORY_KEYS). 500 a day is level 48, not the cap — the cap is
      // level 100 and pays 1,020.
      {
        goal: CITIZEN_GROWTH_500,
        reward: ["citizens", 1_000],
        name: "500 אזרחים ביום",
        hint: 'שדרג את "קבלת מגויסים" לרמה {goal} — 500 אזרחים בכל עדכון יומי',
      },
      // Rule 3: a chain's top rung is pinned to the real ceiling. This one
      // stopped at 10 while the upgrade actually runs to 10 levels *per city*,
      // so the ladder ended a tenth of the way up. The cap needs all ten cities,
      // which makes it one of the last things in the game to finish.
      {
        goal: CITIZEN_GROWTH_CAP,
        reward: ["citizens", 1_500],
        name: "עיר שוקקת",
        hint: 'שדרג את "קבלת מגויסים" לרמה {goal} — {citizens} אזרחים בכל עדכון יומי',
        params: { citizens: num(citizensPerDailyUpdate(CITIZEN_GROWTH_CAP)) },
      },
    ]
  ),
  ...chain(
    "upgrades",
    "empire",
    "upgrades",
    (s) => s.minUpgradeLevel,
    "כל השדרוגים ברמה {goal}",
    "העלה כל אחד משדרוגי האימפריה לרמה {goal} ומעלה",
    [
      { goal: 2, reward: ["gold", 60_000] },
      { goal: 3, reward: ["gold", 250_000] },
      {
        goal: 5,
        reward: ["diamonds", 150],
        name: "אימפריה משודרגת",
        hint: "העלה כל אחד משדרוגי האימפריה לרמה 5 ומעלה",
      },
    ]
  ),
  ...chain(
    "army",
    "empire",
    "army",
    (s) => s.soldiers,
    "צבא של {goal}",
    "אמן {goal} חיילים",
    [
      { goal: 1_000, reward: ["turns", 100] },
      { goal: 10_000, reward: ["iron", 300_000] },
      { goal: 50_000, reward: ["turns", 350] },
      { goal: 100_000, reward: ["turns", 700], name: "צבא אין-סופי", hint: "אמן 100,000 חיילים" },
    ]
  ),
  ...chain(
    "slaves",
    "empire",
    "mine",
    (s) => s.mineSlaves,
    "{goal} עבדי מכרות",
    "החזק {goal} עבדי מכרות",
    [
      { goal: 100, reward: ["wood", 30_000] },
      { goal: 1_000, reward: ["wood", 200_000] },
      { goal: 10_000, reward: ["turns", 400] },
    ]
  ),
  one(
    "attack_weapon",
    "empire",
    "attack",
    "לקנות נשק התקפה",
    "רכוש כלי נשק אחד מקטגוריית התקפה",
    1,
    ["turns", 25],
    (s) => s.attackWeapons
  ),
  one(
    "defense_weapon",
    "empire",
    "shield",
    "לקנות נשק הגנה",
    "רכוש כלי נשק אחד מקטגוריית הגנה",
    1,
    ["turns", 25],
    (s) => s.defenseWeapons
  ),
  one(
    "spy_weapon",
    "empire",
    "spy",
    "לקנות נשק ריגול",
    "רכוש כלי נשק אחד מקטגוריית ריגול",
    1,
    ["turns", 25],
    (s) => s.spyWeapons
  ),
  ...chain(
    "arsenal",
    "empire",
    "factory",
    (s) => s.distinctWeapons,
    "{goal} דגמי נשק",
    "החזק {goal} דגמי נשק שונים",
    [
      { goal: 10, reward: ["iron", 50_000] },
      { goal: 30, reward: ["iron", 250_000] },
      { goal: 60, reward: ["turns", 400] },
      {
        goal: WEAPON_TOTAL,
        reward: ["diamonds", 200],
        name: "נשקייה מושלמת",
        hint: "החזק את כל {goal} דגמי הנשק במשחק",
      },
    ]
  ),
  ...chain(
    "stockpile",
    "empire",
    "factory",
    (s) => s.totalWeapons,
    "{goal} כלי נשק",
    "החזק {goal} כלי נשק בסך הכל",
    [
      { goal: 100, reward: ["iron", 30_000] },
      { goal: 1_000, reward: ["iron", 200_000] },
      { goal: 10_000, reward: ["turns", 450] },
    ]
  ),
  ...chain(
    "unlocks",
    "empire",
    "upgrades",
    (s) => s.minUnlockedTier,
    "דרגת נשק {goal} בכל הקטגוריות",
    "פתח את דרגה {goal} בשלוש קטגוריות הנשק",
    [
      { goal: 10, reward: ["iron", 80_000] },
      { goal: 20, reward: ["turns", 250] },
      // Rung 30 used to be the top, and used to be called "כל הדרגות פתוחות" —
      // true when the foundry had 30 tiers, and quietly false from the day it
      // grew to 35. It keeps its reward and its key (nobody's claim is voided);
      // it just goes back to being an ordinary rung with the ladder's own name,
      // and the ceiling below is the real one.
      { goal: 30, reward: ["turns", 600] },
      {
        // Rule 3: the top rung is the game's ceiling, counted rather than
        // written — MAX_WEAPON_TIER is TIERS_PER_CATEGORY, so growing the
        // foundry moves this rung with it instead of stranding it.
        goal: MAX_WEAPON_TIER,
        reward: ["turns", 800],
        name: "כל הדרגות פתוחות",
        hint: "פתח את דרגה {goal} — הדרגה האחרונה — בשלוש קטגוריות הנשק",
      },
    ]
  ),
];

const LEGACY: AchievementDefinition[] = [
  one(
    "guild_member",
    "legacy",
    "guild",
    "להצטרף לגילדה",
    "הצטרף לגילדה קיימת או הקם אחת",
    1,
    ["stone", 15_000],
    (s) => (s.inGuild ? 1 : 0)
  ),
  one(
    "guild_leader",
    "legacy",
    "crown",
    "מנהיג גילדה",
    "הקם גילדה משלך והובל אותה",
    1,
    ["stone", 60_000],
    (s) => (s.isGuildLeader ? 1 : 0)
  ),
  ...chain(
    "boss",
    "legacy",
    "crown",
    (s) => s.bossWins,
    "{goal} ניצחונות על בוסים",
    "נצח את בוס העיר {goal} פעמים",
    [
      { goal: 1, reward: ["iron", 30_000], name: "להביס את בוס העיר", hint: "נצח את הבוס של העיר שלך" },
      { goal: 5, reward: ["iron", 120_000] },
      { goal: 25, reward: ["turns", 300] },
      { goal: 100, reward: ["turns", 700] },
    ]
  ),
  one(
    "all_bosses",
    "legacy",
    "crown",
    "צייד העריצים",
    "הבס את הבוסים של כל {cities} דרגות הערים",
    MAX_CITIES,
    ["diamonds", 250],
    (s) => s.distinctBossesBeaten,
    { cities: num(MAX_CITIES) }
  ),
  ...chain(
    "minigame",
    "legacy",
    "dice",
    (s) => s.miniGameWins,
    "{goal} ניצחונות במיני-משחק",
    "נצח {goal} פעמים במיני-משחק",
    [
      { goal: 1, reward: ["citizens", 50], name: "ניצחון ראשון במיני-משחק", hint: "נצח פעם אחת במיני-משחק" },
      { goal: 10, reward: ["turns", 120] },
      { goal: 50, reward: ["turns", 400] },
    ]
  ),
  ...chain(
    "letters",
    "legacy",
    "messages",
    (s) => s.messagesSent,
    "{goal} מכתבים",
    "שלח {goal} מכתבים לשחקנים אחרים",
    [
      { goal: 1, reward: ["citizens", 30], name: "מכתב ראשון", hint: "שלח מכתב לשחקן אחר" },
      { goal: 25, reward: ["turns", 100] },
    ]
  ),
  one(
    RANK_ONE_KEY,
    "legacy",
    "crown",
    "לכבוש מקום ראשון בדירוג",
    "היה מספר 1 בדירוג העיר שלך",
    1,
    ["diamonds", 300],
    (s) => (s.isRankOne ? 1 : 0)
  ),
];

/**
 * Display order is progression order: the opening tutorial beats first, the
 * long grinds last. Within a category the chains stay in the order declared.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  ...WAR,
  ...ESPIONAGE,
  ...HERO,
  ...ECONOMY,
  ...EMPIRE,
  ...LEGACY,
];

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

/**
 * Whether the caller still has to run the expensive rank scan: only when the
 * rank-1 achievement exists in the catalog and has not been collected yet.
 * Once collected it stays collected, so the scan is pure waste.
 */
export function needsRankScan(claimedKeys: ReadonlySet<string>): boolean {
  return ACHIEVEMENT_BY_KEY.has(RANK_ONE_KEY) && !claimedKeys.has(RANK_ONE_KEY);
}

/* ------------------------------ view model ------------------------------ */

/** One row as the achievements screen renders it. */
export interface AchievementView {
  key: string;
  category: AchievementCategory;
  /** Translation source — render as `t(name, params)`. */
  name: string;
  /** Translation source — render as `t(hint, params)`. */
  hint: string;
  /** Fills the `{placeholders}` in `name` and `hint`. */
  params?: TranslateParams;
  icon: IconName;
  rewardKind: AchievementRewardKind;
  rewardAmount: number;
  goal: number;
  /** Clamped to `goal`, so a 5,000,000-gold player still reads 1,000,000. */
  progress: number;
  unlocked: boolean;
  claimed: boolean;
}

export interface AchievementsState {
  items: AchievementView[];
  /** Unlocked and not yet collected — drives the collect button and badges. */
  collectable: number;
  claimed: number;
  total: number;
}

/* ------------------------------ hall of glory ------------------------------ */

/**
 * The capstones — five conditions pinned to the game's actual ceilings, shown
 * as decorations on the base screen.
 *
 * **These are not collected.** The ladder above is a reward system: reaching a
 * goal unlocks a button, and pressing it pays out. A capstone here is a
 * decoration — it lights up the moment the empire meets the condition, with
 * nothing to press and nothing to pay. `AchievementView.unlocked` is already
 * the derived condition (`claimed || raw >= goal`), which is why the board can
 * borrow this catalog for its *conditions* while `EmpireGloryAward` — not the
 * claim receipt — records when each empire arrived. See src/server/gloryBoard.ts.
 *
 * The conditions are picked out by key rather than re-declared so they cannot
 * drift from the ones the game already evaluates, and so no new stat has to be
 * gathered. The strip this replaced was gated on `empire.level` — a column
 * gameplay never writes — so all five of its milestones were locked forever.
 *
 * Order is the arc of a run: your first empire-wide ceiling, then the grinds,
 * then the two that require beating other people.
 */
export const GLORY_KEYS: readonly string[] = [
  "cities_10",
  `citizenup_${CITIZEN_GROWTH_500}`,
  "herolvl_100",
  "minelvl_250",
  `unlocks_${MAX_WEAPON_TIER}`,
];

/**
 * Three capstones were deliberately left off this board.
 *
 * `rank_one` is the important one: rank 1 of a city bucket is occupied from the
 * moment the second player registers, so a "world record" for it would be set
 * on day one by whoever happened to be ahead and would say nothing about
 * reaching the end of anything. It is a *standing*, not a ceiling — the
 * rankings page is where it belongs.
 *
 * `heroreset_1` and `all_bosses` are real ceilings but repeatable ones, and the
 * board reads best at five. All three remain in the reward ladder above; only
 * the decoration board is opinionated about them.
 */

/**
 * What each capstone is *called on the board*, overriding the catalog name.
 *
 * The board names a goal to reach ("להגיע לעיר 10"); the reward ladder names an
 * accolade earned ("קיסרות"). Both readings are right for their own screen, and
 * one map keeps the two from having to agree.
 */
export const GLORY_NAME: Record<string, string> = {
  cities_10: "להגיע לעיר 10",
  [`citizenup_${CITIZEN_GROWTH_500}`]: "להגיע לשדרוג של 500 אזרחים בעדכון יומי",
  herolvl_100: "גיבור הגיע לרמה 100",
  minelvl_250: "להגיע למקסימום מכרות",
  [`unlocks_${MAX_WEAPON_TIER}`]: "לפתוח את כל דרגות הנשק",
};

/** The line under each name — the concrete mechanic, never a repeat of it. */
export const GLORY_TAGLINE: Record<string, string> = {
  cities_10: "האימפריה המלאה, כל עשר הערים",
  [`citizenup_${CITIZEN_GROWTH_500}`]: 'שדרוג "קבלת מגויסים" עד 500 אזרחים בכל עדכון',
  herolvl_100: "הרמה האחרונה של הגיבור",
  minelvl_250: "ארבעת המכרות ברמה {mines}",
  [`unlocks_${MAX_WEAPON_TIER}`]: "כל {tiers} הדרגות פתוחות בשלושת הסוגים",
};

/**
 * The noun engraved under each capstone's figure on the records hall.
 *
 * The hall draws a capstone as a number and a unit — **10 ערים**, **250 רמת
 * מכרה** — with the sentence in GLORY_NAME kept for the hover caption and the
 * screen reader. The figure itself is never written here: it is
 * `formatCompact(goal)`, so retuning a ceiling moves the engraving with it and
 * only the noun is a string anyone has to maintain.
 */
export const GLORY_UNIT: Record<string, string> = {
  cities_10: "ערים",
  [`citizenup_${CITIZEN_GROWTH_500}`]: "אזרחים ביום",
  herolvl_100: "רמת גיבור",
  minelvl_250: "רמת מכרה",
  [`unlocks_${MAX_WEAPON_TIER}`]: "דרגות נשק",
};

/**
 * Where the hall wants a different relic than the reward ladder.
 *
 * The ladder can afford to reuse an icon — its rows are read as a list, with
 * the name right there. In the hall the relic is most of what a niche says, so
 * the mine capstone and the weapon capstone sharing an icon with the catalog
 * (the anvil, then the upgrade chevrons) made two of the five alcoves look like
 * the same record twice. A sword for the foundry, an ore cart for the mines.
 */
export const GLORY_ICON: Partial<Record<string, IconName>> = {
  minelvl_250: "mine",
  [`unlocks_${MAX_WEAPON_TIER}`]: "attack",
};

/**
 * The purse for taking a capstone **first in the world**.
 *
 * The board used to be decoration only, and the question players kept asking
 * about it was the one it did not answer: *what do I get?* A record is the only
 * thing in the game that exactly one player can ever hold — five of them per
 * season, gone the moment somebody arrives — so it is the one place a purse
 * cannot be farmed, repeated or bought back. It is paid **once per capstone per
 * season**, automatically, to the holder of the plaque; see
 * `settleGloryPrizes` in src/server/gloryBoard.ts.
 *
 * ## How the ladder was sized
 *
 * By how hard it is to get there *first*, which is not the same as how hard the
 * condition is — a capstone that everyone reaches on their own schedule is a
 * race nobody has to win. The order below is the order the five are expected to
 * fall in a season, and the purse rises with it:
 *
 * 1. **500 אזרחים ביום** — level {@link CITIZEN_GROWTH_500} of the intake
 *    upgrade. Ten rungs per city, so it needs five cities and a lot of gold and
 *    nothing else. The first of the five to be taken, every season.
 * 2. **עשר ערים** — gold-gated too, but the whole game races for it: the weapon
 *    tier gates hang off the city count, so everyone is buying it anyway.
 * 3. **מכרות ברמה {@link MINE_MAX_LEVEL}** — all four at the cap, ~18.9B of
 *    each resource across 249 rungs (see MINE_UPGRADE_COST_GROWTH: an all-in
 *    simulated player reaches the cap around day 45). A pure grind with no gate
 *    on it, which is why it sits below the two that are gated.
 * 4. **כל {@link MAX_WEAPON_TIER} דרגות הנשק** — the foundry finished. Two walls
 *    now, not one: `weaponTierUnlockCost` prices each unlock at the weapon it
 *    opens, so the ladder totals ~1.7T gold with the last rung alone at 859B;
 *    and the gate on that tier is **nine cities and hero level 80**
 *    (`weaponTierGate`), so it cannot be finished until most of the other four
 *    are.
 * 5. **גיבור ברמה {@link HERO_MAX_LEVEL}** — last, and the only ceiling the
 *    resource economy cannot buy at all: hero XP comes only from battles, quests
 *    and bosses, so it is bounded by turns and by opponents rather than by
 *    income. It also contains #4 — you cannot reach 100 without passing the 80
 *    that opens the last weapon tier.
 *
 * ## Why the weapon record counts tiers and not models
 *
 * It used to be `arsenal` — hold one of every model in the game — which reads
 * as a bigger feat and is one: the last three models cost 859B gold apiece. It
 * was replaced because of the *number on the wall*. The hall draws a capstone as
 * one figure and one noun, and that figure was **105**, a count the player never
 * meets anywhere: what they actually do is buy **35 tier unlocks**, each of
 * which advances attack, defence and spy together. A wall that says 105 while
 * the foundry says 35 makes the reader stop and do arithmetic to find out
 * whether they are behind. `arsenal` is still in the ladder above, still pays
 * its 200💎 — it is simply not the thing with a plaque.
 *
 * ## How big
 *
 * These are the largest one-off purses in the game after the season podium
 * itself, on purpose: a record is not a milestone that everyone eventually
 * reaches, it is a race with exactly one winner and no second place, and a purse
 * that reads like an achievement reward makes the race look optional. Priced off
 * the store, where the game's own exchange rates live — the 2,000-turn package
 * costs 500💎 (0.25💎 a turn), so the last line below is worth about 4,000💎 all
 * in, against the 10,000💎 that winning the entire season pays (prizes.ts). Beat
 * everyone in the world to one ceiling and you have earned a good fraction of
 * what beating them to all of them is worth.
 *
 * **Exactly two lines each, and the same two shapes throughout**: one kind that
 * is spent back into playing, plus diamonds. That is not a layout convenience —
 * a purse that is diamonds all the way down is a discount on the store that pays
 * for the game, and one with no diamonds at all does not read as a prize. The
 * uniform shape is also what lets the hall draw five purses that line up.
 *
 * Lines are declared in REWARD_ORDER so a board renders them in the same order
 * everything else in the game does.
 */
export const GLORY_PRIZE: Record<string, readonly PrizeLine[]> = {
  [`citizenup_${CITIZEN_GROWTH_500}`]: [
    { kind: "citizens", amount: 2_500 },
    { kind: "diamonds", amount: 150 },
  ],
  cities_10: [
    { kind: "turns", amount: 3_000 },
    { kind: "diamonds", amount: 300 },
  ],
  minelvl_250: [
    { kind: "citizens", amount: 5_000 },
    { kind: "diamonds", amount: 500 },
  ],
  [`unlocks_${MAX_WEAPON_TIER}`]: [
    { kind: "turns", amount: 5_000 },
    { kind: "diamonds", amount: 750 },
  ],
  herolvl_100: [
    { kind: "turns", amount: 10_000 },
    { kind: "diamonds", amount: 1_500 },
  ],
};

/**
 * The purse behind a capstone, or an empty list for one that carries none.
 *
 * Empty rather than undefined so every caller — the board, the payout, the
 * receipt — can iterate without a null check, and so a capstone added to
 * GLORY_KEYS without a purse degrades to a plaque with no prize band instead of
 * throwing on the base screen.
 */
export function gloryPrize(key: string): readonly PrizeLine[] {
  return GLORY_PRIZE[key] ?? [];
}

/**
 * Placeholders for the two taglines that quote a game ceiling.
 *
 * Kept beside the wording rather than baked into it so retuning MINE_MAX_LEVEL
 * or the weapon count does not silently orphan a dictionary key — the English
 * entry is keyed on "ארבעת המכרות ברמה {mines}", which never changes.
 */
const GLORY_PARAMS: Record<string, TranslateParams> = {
  minelvl_250: { mines: num(MINE_MAX_LEVEL) },
  [`unlocks_${MAX_WEAPON_TIER}`]: { tiers: num(MAX_WEAPON_TIER) },
};

/**
 * Capstones whose *condition* is measured in one unit and whose *meaning* is in
 * another, with the translation between the two.
 *
 * The citizen capstone is the only one so far. Its condition has to be the
 * upgrade level, because that is the stat the game stores — but level 48 is an
 * implementation detail of `citizensPerDailyUpdate` (20 + 10×level), not
 * something the player ever thinks in. The record is "500 citizens on every
 * daily update", so the ring, the bar and the counter all read in citizens per
 * update and the level is never shown.
 *
 * Only the *display* is remapped; `unlocked` and the record itself still come
 * from the level condition, so nothing about who holds the record changes.
 */
const GLORY_DISPLAY: Record<
  string,
  { progress: (raw: number) => number; goal: number }
> = {
  [`citizenup_${CITIZEN_GROWTH_500}`]: {
    progress: citizensPerDailyUpdate,
    goal: 500,
  },
};

/** Who holds a capstone's world record, as the board renders it. */
export interface GloryRecord {
  empireId: string;
  empireName: string;
  /** `Empire.title` — the holder's תואר, drawn beside their name on the case. */
  title: string | null;
  /**
   * "12.07.26", formatted here rather than in the board.
   *
   * The board is a client component, and a date formatted on both sides of
   * hydration is formatted in two different time zones — the server's and the
   * reader's. Doing it once, on the server, makes the string authoritative.
   */
  awardedLabel: string;
  /** True when the record holder is the empire currently looking at the board. */
  isMe: boolean;
}

/**
 * Short date in the reader's language. Built per call rather than once at
 * module load because the language is a per-request cookie — dd.MM.yy for a
 * Hebrew reader, MM/DD/YY for an English one, and neither is a good default for
 * the other.
 */
const gloryDate = (locale: Locale) =>
  new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    // The zone is the game's, not the reader's: a record set at 01:00 Israel is
    // engraved with that day, and would otherwise be dated to the one before by
    // the UTC server that renders the board.
    timeZone: GAME_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });

/** One capstone as the showcase renders it. */
export interface GloryView extends AchievementView {
  /** The short epithet from GLORY_TAGLINE, falling back to the full hint. */
  tagline: string;
  /** The noun engraved under the figure — "ערים", "רמת גיבור". See GLORY_UNIT. */
  unit: string;
  /** First empire in the game to reach it; null while the record is open. */
  record: GloryRecord | null;
  /**
   * What being first pays — the bounty while the plaque is blank, and what the
   * holder was paid once it is engraved. Same list either way: the prize is a
   * property of the record, not of who holds it. Empty for a capstone with no
   * purse. See GLORY_PRIZE.
   */
  prize: readonly PrizeLine[];
}

/**
 * Pull the capstones out of a built ladder, in GLORY_KEYS order, and attach the
 * world record for each.
 *
 * Silently skips a key with no catalog entry, so retuning a condition (which
 * mints a new key — see `chain`) degrades to a shorter board instead of
 * throwing on the base screen, which every player loads.
 */
export function selectGlory(
  state: AchievementsState,
  records: ReadonlyMap<
    string,
    // Structural rather than an import of GloryChampion: this module is pure and
    // server/gloryBoard.ts is "server-only", so naming its type here would drag
    // the import into the test suite's pure bundle.
    { empireId: string; empireName: string; title: string | null; awardedAt: Date }
  >,
  viewerEmpireId: string,
  locale: Locale
): GloryView[] {
  const byKey = new Map(state.items.map((i) => [i.key, i]));
  const date = gloryDate(locale);
  return GLORY_KEYS.flatMap((key) => {
    const item = byKey.get(key);
    if (!item) return [];
    const held = records.get(key);
    const display = GLORY_DISPLAY[key];
    return [
      {
        ...item,
        ...(display
          ? {
              progress: Math.min(display.goal, display.progress(item.progress)),
              goal: display.goal,
            }
          : null),
        name: GLORY_NAME[key] ?? item.name,
        tagline: GLORY_TAGLINE[key] ?? item.hint,
        unit: GLORY_UNIT[key] ?? "",
        icon: GLORY_ICON[key] ?? item.icon,
        params: { ...item.params, ...GLORY_PARAMS[key] },
        prize: gloryPrize(key),
        record: held
          ? {
              empireId: held.empireId,
              empireName: held.empireName,
              title: held.title,
              awardedLabel: date.format(held.awardedAt),
              isMe: held.empireId === viewerEmpireId,
            }
          : null,
      },
    ];
  });
}

/* ------------------------------ world records worn ------------------------------ */

/**
 * שיאי עולם — the world records an empire holds, worn at the top of its dossier.
 *
 * This case used to be a wall of eleven "medals of honour": every capstone the
 * empire had reached. It read as a decoration and worked as wallpaper — ten
 * cities, hero 100, every weapon model and the rest are all things a serious
 * empire simply *has* by the late game, and rank 1 of a city bucket is occupied
 * from the moment the second player registers (which is exactly why it never
 * reached the records board either — see the note above GLORY_NAME). A row
 * every decorated dossier wears tells a visitor nothing about the one in front
 * of them.
 *
 * What is left is the one thing on a profile that is about this empire's place
 * among all the others: being the **first in the game** to reach a capstone.
 * There are five to hold, most players hold none, and a dossier that shows one
 * is worth stopping on.
 *
 * The name comes from the catalog rather than GLORY_NAME, and the two are
 * different on purpose: the records board names an open goal to reach
 * ("להגיע לעיר 10"), which is the wrong tense for a record already taken. The
 * one override below is the citizen capstone, which the catalog names after an
 * upgrade level nobody thinks in.
 */
const MEDAL_NAME: Record<string, string> = {
  [`citizenup_${CITIZEN_GROWTH_500}`]: "500 אזרחים ביום",
};

/** One record held, ready to render. */
export interface MedalView {
  key: string;
  /** Translation source — render as `t(name, params)`. */
  name: string;
  /** The one-line feat, short enough for a narrow column. */
  tagline: string;
  /** Fills the `{placeholders}` in `name` and `tagline`. */
  params?: TranslateParams;
  icon: IconName;
  /** "12.07.26" — when this empire got there first. */
  earnedLabel: string;
}

/**
 * The subset of the records board this empire holds, in GLORY_KEYS order.
 *
 * Takes the champions map whole rather than an empire-scoped query: it is five
 * rows for the entire game (see getGloryChampions), so "which of these are his"
 * is a lookup rather than a read. Keys with no catalog entry are dropped the
 * way `selectGlory` drops them — retuning a goal mints a new key (see `chain`),
 * and a dossier is not the place to throw over a stale record.
 */
export function selectWorldMedals(
  champions: ReadonlyMap<string, { empireId: string; awardedAt: Date }>,
  empireId: string,
  locale: Locale
): MedalView[] {
  const date = gloryDate(locale);
  return GLORY_KEYS.flatMap((key) => {
    const held = champions.get(key);
    if (!held || held.empireId !== empireId) return [];
    const item = ACHIEVEMENT_BY_KEY.get(key);
    if (!item) return [];
    return [
      {
        key,
        name: MEDAL_NAME[key] ?? item.name,
        tagline: GLORY_TAGLINE[key] ?? item.hint,
        params: { ...item.params, ...GLORY_PARAMS[key] },
        // Same override as the hall: these are the same five records, and a
        // dossier plate should carry the relic the wall carries.
        icon: GLORY_ICON[key] ?? item.icon,
        earnedLabel: date.format(held.awardedAt),
      },
    ];
  });
}

/**
 * Read one achievement's progress, failing closed.
 *
 * The clamp to a finite number is load-bearing, not defensive dressing. The
 * natural way to write the claim guard is `if (progress < goal) continue`, and
 * if `progress` is `undefined` or `NaN` — a stat the snapshot did not
 * populate — that comparison is `false`, so the guard does NOT skip and the
 * reward is paid for a milestone nobody reached. Every read goes through here
 * so an absent stat reads as zero progress in both the UI and the payout.
 */
export function achievementProgress(
  a: AchievementDefinition,
  stats: AchievementStats
): number {
  const raw = a.progress(stats);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/** Whether this achievement's condition is currently satisfied. */
export function isAchievementReached(
  a: AchievementDefinition,
  stats: AchievementStats
): boolean {
  return achievementProgress(a, stats) >= a.goal;
}

/**
 * Project a stats snapshot + the set of collected keys into the view model.
 * Pure, so the server action and the page share one definition of "unlocked".
 */
export function buildAchievementsState(
  stats: AchievementStats,
  claimedKeys: ReadonlySet<string>
): AchievementsState {
  const items = ACHIEVEMENTS.map((a) => {
    const claimed = claimedKeys.has(a.key);
    const raw = achievementProgress(a, stats);
    // A collected achievement always shows full: its condition may since have
    // lapsed (gold spent, soldiers lost, rank taken) but the reward is banked,
    // and watching it slide back to 3/10 would read as a bug.
    const progress = claimed ? a.goal : Math.max(0, Math.min(a.goal, raw));
    return {
      key: a.key,
      category: a.category,
      name: a.name,
      hint: a.hint,
      params: a.params,
      icon: a.icon,
      rewardKind: a.reward.kind,
      rewardAmount: a.reward.amount,
      goal: a.goal,
      progress,
      unlocked: claimed || raw >= a.goal,
      claimed,
    };
  });

  return {
    items,
    collectable: items.filter((i) => i.unlocked && !i.claimed).length,
    claimed: items.filter((i) => i.claimed).length,
    total: items.length,
  };
}
