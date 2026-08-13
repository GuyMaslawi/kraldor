// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { IconName } from "@/components/ui/Icon";

/**
 * מונומנטים — the things a finished empire builds.
 *
 * The endgame had a gold problem, and it was the shape every accumulation game
 * eventually finds: mines compound, plunder compounds, the bank compounds, and
 * by the last third of a season a serious empire is earning far more gold than
 * anything on the board costs. Weapons cap out, upgrades cap out, and the item
 * ladder — the one deliberately geometric sink in the game — tops out at 700B
 * for a single piece and then stops. After that, gold is a number that goes up.
 *
 * A monument is the answer, and it is the only kind of answer that works
 * permanently: **a sink that pays a percentage.** Because the reward compounds
 * with the income that bought it, a monument is never "finished being worth
 * building" the way a flat reward is — and because the price is geometric at a
 * steeper rate than the payout, it never runs away either.
 *
 * ## Three rules
 *
 * 1. **No monument touches combat.** Not attack, not defence, not spy power.
 *    That is not squeamishness — the battle report itemises every term of the
 *    power calculation (see battleLedger.ts), so a new combat modifier needs a
 *    snapshot column on BattleReport and a row in the ledger, or the report
 *    starts lying about why somebody lost. Monuments buy *income*, and the
 *    honest reading of that is: gold bought you more gold, not a win.
 *
 * 2. **Every monument settles in one place.** All five effects are applied by
 *    `applyPendingUpdates` — the lazy game clock — and nowhere else. One
 *    function reads this catalog, which is what keeps five permanent
 *    multipliers from becoming five different bugs.
 *
 * 3. **The ladder ends.** Twelve levels, and the last one costs 500B — of the
 *    same order as one top-of-the-ladder item upgrade. A monument is a
 *    season-long project, not an infinite one, and an empire that finishes all
 *    five has genuinely spent everything it had.
 */

/* ------------------------------ the catalog ------------------------------ */

/**
 * What a monument multiplies. Each of these names exactly one figure inside
 * `applyPendingUpdates` — see `monumentBonuses`, which is the only reader.
 */
export type MonumentEffect =
  | "mines"
  | "turns"
  | "citizens"
  | "interest"
  | "wheelSpins";

/**
 * The silhouette a monument is drawn with on the build site. Each name maps to
 * one `.vil-<shape>` block in globals.css, which sets the footprint width and
 * the height each level adds — so a column is thin and towering, a hall is wide
 * and squat, and five buildings never read as the same box five times.
 */
export type MonumentShape = "column" | "tower" | "gate" | "hall" | "wheel";

export interface MonumentDefinition {
  /** Stable key persisted in EmpireMonument.key — never reuse or rename one. */
  key: string;
  name: string;
  /** One line of flavour, shown under the name. */
  lore: string;
  /** The plain sentence describing what it does, with `{pct}` filled in. */
  effectLabel: string;
  icon: IconName;
  effect: MonumentEffect;
  /** Accent as an `R G B` triple, so a card can tint from one token. */
  accent: string;
  /** How it is drawn on the build site. */
  shape: MonumentShape;
  /**
   * The top-left tile of its 2×2 plot on the build site grid. The five sit in a
   * quincunx — four corners and the middle — which is the only arrangement that
   * leaves a full ring of road between every pair, so no plot's click target
   * ever overlaps its neighbour's. See VILLAGE_SIZE.
   */
  plot: { c: number; r: number };
}

/**
 * The build site is VILLAGE_SIZE² tiles. Roads run down columns and rows 2 and
 * 5, which is what carves the eight-by-eight into the five plots below plus
 * four grass verges — change either number and that layout stops lining up.
 */
export const VILLAGE_SIZE = 8;

/** Levels a monument can be raised to. The twelfth is the last. */
export const MONUMENT_MAX_LEVEL = 12;

/**
 * Percentage points each level adds. Flat rather than curved: the *price* is
 * the geometric half of this pair, and curving both ends makes a ladder nobody
 * can reason about. Twelve levels is +24% at the top of one monument.
 */
export const MONUMENT_PCT_PER_LEVEL = 2;

/**
 * The five, and the whole design in one table. Note what each of them is: a
 * multiplier on a figure the daily clock already computes. Nothing here is a
 * new mechanic — a monument makes the empire the player already has produce
 * more, which is exactly what a monument should do.
 */
export const MONUMENTS: readonly MonumentDefinition[] = [
  {
    key: "workers_column",
    name: "עמוד הפועלים",
    lore: "עמוד בזלת בן ארבעים מטר, ועליו חקוקים שמותיהם של אלה שחפרו את המכרות הראשונים.",
    effectLabel: "+{pct}% לתפוקת המכרות",
    icon: "mine",
    effect: "mines",
    accent: "196 120 60",
    shape: "column",
    plot: { c: 0, r: 0 },
  },
  {
    key: "clock_tower",
    name: "מגדל השעון הגדול",
    lore: "פעמון אחד לכל שעה, ונשמע עד קצה הנחלה. מאז שהוקם, איש בבירה לא איחר.",
    effectLabel: "+{pct}% לתורות שנצברות",
    icon: "turns",
    effect: "turns",
    accent: "150 168 224",
    shape: "tower",
    plot: { c: 6, r: 0 },
  },
  {
    key: "victory_gate",
    name: "שער הניצחון",
    lore: "כל צבא שחוזר עובר תחתיו, וכל נער בעיר רואה אותו. הגיוס מאז לא היה בעיה.",
    effectLabel: "+{pct}% לאזרחים בכל עדכון יומי",
    icon: "citizens",
    effect: "citizens",
    accent: "205 150 70",
    shape: "gate",
    plot: { c: 3, r: 3 },
  },
  {
    key: "vault_hall",
    name: "בית הגנזים",
    lore: "שמונה קומות מתחת לאדמה, ובהן ספרי החשבונות של האימפריה מאז ייסודה.",
    effectLabel: "+{pct}% לריבית הבנק",
    icon: "bank",
    effect: "interest",
    accent: "228 195 90",
    shape: "hall",
    plot: { c: 0, r: 6 },
  },
  {
    key: "sky_wheel",
    name: "גלגל השמיים",
    lore: "מבנה שאיש אינו יודע להסביר, שממשיך להסתובב גם כשאין רוח. העם מייחס לו מזל.",
    effectLabel: "+{pct}% לסיבובי גלגל המזל היומיים",
    icon: "wheel",
    effect: "wheelSpins",
    accent: "150 96 232",
    shape: "wheel",
    plot: { c: 6, r: 6 },
  },
];

export const MONUMENT_BY_KEY = new Map(MONUMENTS.map((m) => [m.key, m]));

/* ------------------------------ the price ------------------------------ */

/**
 * The two anchors of the cost curve. Level 1 is priced at roughly what a
 * mid-game empire can raise in a session; level 12 at the order of a single
 * top-of-the-ladder item upgrade, which is the most expensive thing the game
 * already sells.
 *
 * The ratio across eleven steps is ×2,500, or **×2.04 per level** — steeper
 * than the +2 percentage points each level pays back, which is what stops the
 * ladder from ever paying for itself faster than it costs.
 */
export const MONUMENT_COST_LEVEL_1 = 200_000_000;
export const MONUMENT_COST_LEVEL_MAX = 500_000_000_000;

export const MONUMENT_COST_GROWTH = Math.pow(
  MONUMENT_COST_LEVEL_MAX / MONUMENT_COST_LEVEL_1,
  1 / (MONUMENT_MAX_LEVEL - 1)
);

/**
 * Round to three significant figures — 200M, 408M, 833M, 500B, never
 * 407,982,331. Same treatment the gear ladder gives its prices, and for the
 * same reason: these are read as prices, not as measurements.
 */
function roundSignificant(value: number): number {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 2);
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Gold to raise a monument from `level` to `level + 1`, or null when it stands
 * at its final height.
 *
 * `level` is the level currently *held* — 0 for a monument not yet founded, so
 * the first rung is `MONUMENT_COST_LEVEL_1`.
 */
export function monumentCost(level: number): number | null {
  const held = Math.max(0, Math.floor(level) || 0);
  if (held >= MONUMENT_MAX_LEVEL) return null;
  return roundSignificant(MONUMENT_COST_LEVEL_1 * MONUMENT_COST_GROWTH ** held);
}

/** Total gold to take a monument from nothing to its full height. */
export function monumentTotalCost(): number {
  let total = 0;
  for (let level = 0; level < MONUMENT_MAX_LEVEL; level += 1) {
    total += monumentCost(level) ?? 0;
  }
  return total;
}

/** The percentage a monument at `level` pays. */
export function monumentPct(level: number): number {
  return Math.max(0, Math.min(MONUMENT_MAX_LEVEL, Math.floor(level) || 0)) *
    MONUMENT_PCT_PER_LEVEL;
}

/* ------------------------------ the bonuses ------------------------------ */

/** Every effect as a percentage, keyed by what it multiplies. */
export type MonumentBonuses = Record<MonumentEffect, number>;

export function zeroMonumentBonuses(): MonumentBonuses {
  return { mines: 0, turns: 0, citizens: 0, interest: 0, wheelSpins: 0 };
}

/**
 * Fold an empire's monuments into the five percentages the game clock reads.
 *
 * The only consumer is `applyPendingUpdates` (rule 2). Rows whose key has
 * fallen out of the catalog are ignored rather than thrown on — the same rule
 * every other keyed table in this codebase follows, and the one that lets a
 * monument be retired without a migration.
 */
export function monumentBonuses(
  rows: readonly { key: string; level: number }[] | null | undefined
): MonumentBonuses {
  const bonuses = zeroMonumentBonuses();
  for (const row of rows ?? []) {
    const definition = MONUMENT_BY_KEY.get(row.key);
    if (!definition) continue;
    bonuses[definition.effect] += monumentPct(row.level);
  }
  return bonuses;
}

/**
 * A percentage as the multiplier the clock applies. Mirrors `bonusMultiplier`
 * in hero.ts rather than importing it, so this module stays free of the hero.
 */
export function monumentMultiplier(pct: number): number {
  return 1 + Math.max(0, pct) / 100;
}

/* ------------------------------ view model ------------------------------ */

/** One monument card, as the screen renders it. */
export interface MonumentView {
  key: string;
  name: string;
  lore: string;
  effectLabel: string;
  icon: IconName;
  accent: string;
  shape: MonumentShape;
  plot: { c: number; r: number };
  level: number;
  maxLevel: number;
  /** The percentage it pays right now. */
  pct: number;
  /** What it would pay after the next level, or the same at full height. */
  nextPct: number;
  /** Gold for the next level, or null at full height. */
  cost: number | null;
  affordable: boolean;
}

export interface MonumentsState {
  gold: number;
  monuments: MonumentView[];
  /** Levels raised across all five, out of the total on offer. */
  built: number;
  total: number;
}

/** Project an empire's rows into the board. */
export function buildMonumentsState(
  gold: number,
  rows: readonly { key: string; level: number }[]
): MonumentsState {
  const byKey = new Map(rows.map((r) => [r.key, r.level]));
  const monuments = MONUMENTS.map((definition) => {
    const level = Math.max(
      0,
      Math.min(MONUMENT_MAX_LEVEL, byKey.get(definition.key) ?? 0)
    );
    const cost = monumentCost(level);
    return {
      key: definition.key,
      name: definition.name,
      lore: definition.lore,
      effectLabel: definition.effectLabel,
      icon: definition.icon,
      accent: definition.accent,
      shape: definition.shape,
      plot: definition.plot,
      level,
      maxLevel: MONUMENT_MAX_LEVEL,
      pct: monumentPct(level),
      nextPct: monumentPct(Math.min(MONUMENT_MAX_LEVEL, level + 1)),
      cost,
      affordable: cost !== null && gold >= cost,
    };
  });

  return {
    gold,
    monuments,
    built: monuments.reduce((sum, m) => sum + m.level, 0),
    total: MONUMENTS.length * MONUMENT_MAX_LEVEL,
  };
}
