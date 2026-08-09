import type { AchievementStats } from "./achievements";
import { effectiveHeroLevel } from "./hero";
import { MAX_CITIES } from "./constants";

/**
 * תארים — the line under a player's name.
 *
 * The one thing the game sold for diamonds that was not a convenience was
 * nothing: VIP buys bulk buttons, the season pass buys a reward track, and both
 * are careful to grant no power (see vip.ts). That is the right instinct and it
 * left an obvious gap — the *only* completely safe thing to sell is something
 * that changes nothing at all, and the game had none of it.
 *
 * A title is that. It appears on the dossier and beside the name in the
 * rankings, it multiplies nothing, and it is the cheapest possible way for a
 * player to be recognisable to the people they are already competing with.
 *
 * ## Two kinds, and the line between them
 *
 * **Earned** titles are gated on a condition over the same lifetime-counters
 * snapshot the achievements ladder and the mission board read. They cannot be
 * bought at any price, and that is the point: a bought title that looked like
 * an earned one would devalue every earned one on the board.
 *
 * **Bought** titles cost diamonds, have no condition, and are deliberately
 * written in a *different register* — they are boasts and jokes rather than
 * feats ("בעל המאה", "האספן"). Nobody reading the rankings should have to
 * wonder which kind they are looking at.
 *
 * The two are also stored differently, and for a reason worth stating: an
 * earned title has **no receipt row**. Its condition is re-derived on every
 * read, exactly as an achievement's is, so there is nothing to backfill when a
 * title is added and nothing to clean up when one is retired. Only a purchase
 * writes a row, because only a purchase is a fact about money rather than a
 * fact about play.
 */

/** How a title is come by. */
export type TitleKind = "earned" | "bought";

export interface TitleDefinition {
  /** Stable key stored in Empire.title / EmpireTitle.key. Never rename one. */
  key: string;
  /** The title itself, as it appears under the name. */
  label: string;
  /** One line saying how it is come by, shown on the selection screen. */
  hint: string;
  kind: TitleKind;
  /** Accent as an `R G B` triple — the title is drawn in its own colour. */
  accent: string;
  /** Diamonds, for a bought title; 0 for an earned one. */
  price: number;
  /**
   * The handful that are allowed to *move* — a slow breath of their own accent
   * wherever the title is drawn (`.title-worn-inline[data-rare="1"]`).
   *
   * Deliberately a flag on three titles rather than a property of `earned`. The
   * game already has exactly one animated name — `.staff-name`, molten gold with
   * a highlight travelling across it — and its whole job is to say "this account
   * is the house". A second animated treatment on eight of fourteen titles would
   * put motion on most of the rankings and take that signal apart. Three, at the
   * far end of the earned shelf, stay rare enough to mean something; the pulse is
   * also a *glow* rather than a metallic sweep and is drawn in the title's own
   * colour, so it never reads as the gold one.
   *
   * Never set on a bought title. That is the line the whole feature rests on: the
   * one thing diamonds must not buy here is the appearance of a feat.
   */
  rare?: boolean;
  /**
   * The condition, for an earned title. Absent on a bought one, which is what
   * `titleUnlocked` tests rather than testing `kind` — a bought title with a
   * condition would be a bug the type system cannot catch, and this way it
   * simply cannot be expressed usefully.
   */
  condition?: (s: AchievementStats) => boolean;
}

/**
 * The catalog. Earned first, in roughly the order a player reaches them, then
 * the bought ones.
 *
 * Earned conditions are deliberately set *above* the equivalent achievement
 * rung: a title should be rarer than the reward ladder, or the rankings turn
 * into a wall of identical epithets.
 */
export const TITLES: readonly TitleDefinition[] = [
  /* ---- earned ---- */
  {
    key: "raider",
    label: "הפושט",
    hint: "נצח ב-250 תקיפות",
    kind: "earned",
    accent: "196 92 48",
    price: 0,
    condition: (s) => s.attackWins >= 250,
  },
  {
    key: "shadow",
    label: "צל המלך",
    hint: "חזור עם 200 דוחות ריגול מוצלחים",
    kind: "earned",
    accent: "150 96 232",
    price: 0,
    condition: (s) => s.spySuccesses >= 200,
  },
  {
    key: "wall",
    label: "החומה",
    hint: "הדוף 100 תקיפות על האימפריה שלך",
    kind: "earned",
    accent: "150 168 190",
    price: 0,
    condition: (s) => s.defenseWins >= 100,
  },
  {
    key: "tyrant_slayer",
    label: "מפיל הכתרים",
    hint: "הפל את הבוסים של כל {cities} דרגות הערים",
    kind: "earned",
    accent: "232 82 82",
    price: 0,
    rare: true,
    condition: (s) => s.distinctBossesBeaten >= MAX_CITIES,
  },
  {
    key: "emperor",
    label: "הקיסר",
    hint: "החזק את כל {cities} הערים בו-זמנית",
    kind: "earned",
    accent: "228 195 90",
    price: 0,
    rare: true,
    condition: (s) => s.cities >= MAX_CITIES,
  },
  {
    key: "reborn",
    label: "בן האלמוות",
    hint: "אפס את הגיבור שלוש פעמים לאחר שהגיע לשיא",
    kind: "earned",
    accent: "96 156 224",
    price: 0,
    condition: (s) => s.heroResets >= 3,
  },
  {
    key: "legend",
    label: "האגדה",
    hint: "זכה בחמישה פריטים בדרגת נדירות אגדי",
    kind: "earned",
    accent: "255 176 60",
    price: 0,
    condition: (s) => s.legendaryItems >= 5,
  },
  {
    key: "warlord",
    label: "מצביא הדורות",
    hint: "העלה את הגיבור לרמה אפקטיבית 150 ומעלה",
    kind: "earned",
    accent: "62 200 140",
    price: 0,
    rare: true,
    condition: (s) => effectiveHeroLevel(s.heroLevel, s.heroResets) >= 150,
  },

  /* ---- bought: boasts, not feats ---- */
  {
    key: "rich",
    label: "בעל המאה",
    hint: "נקנה בחנות התארים",
    kind: "bought",
    accent: "228 195 90",
    price: 150,
  },
  {
    key: "collector",
    label: "האספן",
    hint: "נקנה בחנות התארים",
    kind: "bought",
    accent: "150 96 232",
    price: 150,
  },
  {
    key: "gambler",
    label: "המהמר",
    hint: "נקנה בחנות התארים",
    kind: "bought",
    accent: "62 200 140",
    price: 150,
  },
  {
    key: "insomniac",
    label: "מי שלא ישן",
    hint: "נקנה בחנות התארים",
    kind: "bought",
    accent: "96 156 224",
    price: 200,
  },
  {
    key: "philanthropist",
    label: "הנדיב",
    hint: "נקנה בחנות התארים",
    kind: "bought",
    accent: "255 150 60",
    price: 200,
  },
  {
    key: "unhinged",
    label: "המשוגע לדבר",
    hint: "נקנה בחנות התארים",
    kind: "bought",
    accent: "232 82 82",
    price: 300,
  },
];

export const TITLE_BY_KEY = new Map(TITLES.map((t) => [t.key, t]));

/** Placeholders shared by the wording of the earned conditions. */
export const TITLE_PARAMS = { cities: MAX_CITIES } as const;

/**
 * Whether an empire may currently wear a title.
 *
 * An earned title asks its condition; a bought one asks whether a receipt
 * exists. Nothing else is consulted, which is what makes this safe to call from
 * both the selection screen and the guarded write that sets `Empire.title` — the
 * two must never disagree about who may wear what.
 */
export function titleUnlocked(
  definition: TitleDefinition,
  stats: AchievementStats | null,
  ownedKeys: ReadonlySet<string>
): boolean {
  if (definition.condition) return stats !== null && definition.condition(stats);
  return ownedKeys.has(definition.key);
}

/** One row of the title screen. */
export interface TitleView {
  key: string;
  label: string;
  hint: string;
  kind: TitleKind;
  accent: string;
  price: number;
  rare: boolean;
  unlocked: boolean;
  /** Bought and owned — the shop shows it as owned rather than for sale. */
  owned: boolean;
  /** Currently worn. */
  worn: boolean;
}

export interface TitlesState {
  titles: TitleView[];
  /** The key currently worn, or null for a player wearing none. */
  worn: string | null;
  diamonds: number;
  earnedCount: number;
  ownedCount: number;
}

export function buildTitlesState(
  stats: AchievementStats | null,
  ownedKeys: ReadonlySet<string>,
  worn: string | null,
  diamonds: number
): TitlesState {
  const titles = TITLES.map((definition) => {
    const unlocked = titleUnlocked(definition, stats, ownedKeys);
    return {
      key: definition.key,
      label: definition.label,
      hint: definition.hint,
      kind: definition.kind,
      accent: definition.accent,
      price: definition.price,
      rare: definition.rare === true,
      unlocked,
      owned: definition.kind === "bought" && ownedKeys.has(definition.key),
      worn: worn === definition.key,
    };
  });

  return {
    titles,
    // A worn title whose key has fallen out of the catalog reads as none, the
    // same way `wornTitle` resolves it — the two must agree or the screen would
    // show nothing selected while the dossier still printed something.
    worn: worn !== null && TITLE_BY_KEY.has(worn) ? worn : null,
    diamonds,
    earnedCount: titles.filter((t) => t.kind === "earned" && t.unlocked).length,
    ownedCount: titles.filter((t) => t.owned).length,
  };
}

/**
 * The title an empire is *displaying*, resolved for a reader.
 *
 * Returns null for a key the catalog no longer has, so retiring a title quietly
 * removes it from every dossier and every ladder rather than printing a raw key.
 * Deliberately does **not** re-check the condition: that would need the full
 * stats snapshot of whichever empire is being *looked at*, which is a query per
 * row on the rankings page. The condition is enforced where it matters — at the
 * moment the title is put on (see wearTitle) — and an earned title's condition
 * is monotonic anyway, so a title once earned stays true.
 */
export function wornTitle(
  key: string | null | undefined
): TitleDefinition | null {
  if (!key) return null;
  return TITLE_BY_KEY.get(key) ?? null;
}
