// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { AchievementStats } from "./achievements";
import { HERO_MAX_LEVEL, effectiveHeroLevel } from "./hero";
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

/**
 * How hard an earned title is — the three words the game already uses for the
 * rarity of a hero item, reused here so a player does not have to learn a second
 * vocabulary.
 *
 * The tier is not decoration. It is a *promise about the condition*, and the
 * catalog below is ordered by it: every רגיל is easier than every נדיר, and
 * every נדיר is easier than every אגדי. The shelf used to break that promise —
 * "אפס את הגיבור פעם אחת ואז טפס עד רמה 50" was marked rare while "אפס את
 * הגיבור שלוש פעמים", which is twice as much of the same climb, was not — and a
 * badge that contradicts the requirement beside it is worse than no badge.
 *
 * Where a tier sits against the achievements ladder, since both read the same
 * counters and the two must not collide:
 * - **רגיל** — a rung or two above the middle of the matching achievement chain.
 *   Reachable in the first weeks; there should always be something to wear.
 * - **נדיר** — at the top end of that chain, or on a counter with no chain that
 *   only a settled player moves at all (a legendary drop is 1% of a won attack).
 * - **אגדי** — beyond the whole chain, or a feat with no chain at all.
 */
export type TitleTier = "common" | "rare" | "legendary";

/** Ascending difficulty — the order the shelf is drawn in. */
export const TITLE_TIERS: readonly TitleTier[] = ["common", "rare", "legendary"];

/** The tier as the player reads it. Source strings; run through `t()`. */
export const TIER_LABEL: Record<TitleTier, string> = {
  common: "רגיל",
  rare: "נדיר",
  legendary: "אגדי",
};

/** One line under each tier heading, in the plainest words available. */
export const TIER_BLURB: Record<TitleTier, string> = {
  common: "אפשר להשיג אותם כבר בשבועות הראשונים של המשחק.",
  rare: "צריך לשחק הרבה בשביל אלה. לא לכל אחד יש אותם.",
  legendary: "הכי קשים במשחק. רק מעטים מגיעים אליהם בכל עונה.",
};

export interface TitleDefinition {
  /** Stable key stored in Empire.title / EmpireTitle.key. Never rename one. */
  key: string;
  /** The title itself, as it appears under the name. */
  label: string;
  /** One line saying how it is come by, shown on the selection screen. */
  hint: string;
  /**
   * The sales line — bought titles only, and shown *instead* of the hint on the
   * shop card.
   *
   * A bought title's `hint` is "נקנה בחנות התארים", which is the honest answer
   * to the guide's "איך משיגים" column and completely wasted on the shelf where
   * it is being sold: the card was spending its one line of prose telling the
   * reader where they already are. The flavour is written in the same boastful
   * register as the label — the shop is allowed to be fun about what it sells,
   * as long as it never claims a feat.
   */
  flavor?: string;
  kind: TitleKind;
  /**
   * How hard it is — earned only. A bought title has no tier at all rather than
   * a `common` one: a purchase is not a rung on a difficulty ladder, and giving
   * it the easiest word on that ladder would still be placing it on it.
   */
  tier?: TitleTier;
  /** Accent as an `R G B` triple — the title is drawn in its own colour. */
  accent: string;
  /** Diamonds, for a bought title; 0 for an earned one. */
  price: number;
  /**
   * The condition, for an earned title. Absent on a bought one, which is what
   * `titleUnlocked` tests rather than testing `kind` — a bought title with a
   * condition would be a bug the type system cannot catch, and this way it
   * simply cannot be expressed usefully.
   */
  condition?: (s: AchievementStats) => boolean;
}

/**
 * Every number a condition is measured against, in one place.
 *
 * They are also the `{placeholders}` of the wording (see `TITLE_PARAMS`), so a
 * retune moves the requirement and the sentence describing it together — and,
 * because the Hebrew source string is the translation key, retuning a goal no
 * longer orphans its English line the way a hard-coded "250" did.
 */
export const TITLE_GOALS = {
  /* common */
  wins: 100,
  reports: 150,
  defenses: 75,
  heroLevel: 50,
  /* rare */
  bosses: 5,
  legendaryItems: 5,
  warlordLevel: 50,
  cities: MAX_CITIES,
  /* legendary */
  allBosses: MAX_CITIES,
  resets: 3,
  greatWins: 1_000,
  /* shared wording */
  cap: HERO_MAX_LEVEL,
} as const;

/**
 * What every title in the shop costs — one price for the whole shelf.
 *
 * It was a 150/200/300 ladder, which priced the *joke* rather than the thing
 * being sold: all six are the same product (a word beside your name, no power),
 * and a cheaper one only ever read as the lesser word. One price makes the
 * choice about which boast fits you, which is the only question the shelf should
 * be asking.
 *
 * Set to 1000 on 2026-08-15, deliberately at parity with `VIP_COST` rather than
 * under it. The old rule was "well under the headline purchase, so a title never
 * competes with it"; the pitch now is that a title is the *other* thousand-
 * diamond thing you can own — VIP buys convenience for a season, a title is
 * permanent and public. Nothing enforces the relationship between the two
 * numbers, so if VIP is ever repriced, decide this one again on purpose.
 */
export const TITLE_PRICE = 1000;

/** The effective hero level `warlord` really tests: one full climb, then some. */
const WARLORD_EFFECTIVE_LEVEL = HERO_MAX_LEVEL + TITLE_GOALS.warlordLevel;

/**
 * The catalog. Earned first — **ordered by tier, easiest first**, which is the
 * order the shelf and the guide table draw them in — then the bought ones.
 *
 * Earned conditions are deliberately set *above* the equivalent achievement
 * rung: a title should be rarer than the reward ladder, or the rankings turn
 * into a wall of identical epithets.
 *
 * Every condition is also **monotonic** — it reads a lifetime counter or the
 * effective hero level, never a balance that can fall. A title is only re-tested
 * at the moment it is put on, so one that could stop being true would be a word
 * the wearer keeps and the shelf refuses to hand back. (`emperor` reads the city
 * tier, which is climbed and never lost.)
 */
export const TITLES: readonly TitleDefinition[] = [
  /* ---- earned · רגיל: the first weeks ---- */
  {
    key: "raider",
    label: "הפושט",
    hint: "נצח ב-{wins} תקיפות על שחקנים אחרים",
    kind: "earned",
    tier: "common",
    accent: "196 92 48",
    price: 0,
    condition: (s) => s.attackWins >= TITLE_GOALS.wins,
  },
  {
    key: "shadow",
    label: "צל המלך",
    hint: "שלח מרגלים וחזור עם {reports} דוחות ריגול מוצלחים",
    kind: "earned",
    tier: "common",
    accent: "150 96 232",
    price: 0,
    condition: (s) => s.spySuccesses >= TITLE_GOALS.reports,
  },
  {
    key: "wall",
    label: "החומה",
    hint: "הגן על האימפריה שלך ונצח ב-{defenses} תקיפות של אחרים עליך",
    kind: "earned",
    tier: "common",
    accent: "150 168 190",
    price: 0,
    condition: (s) => s.defenseWins >= TITLE_GOALS.defenses,
  },
  {
    key: "veteran",
    label: "הוותיק",
    hint: "העלה את הגיבור שלך לרמה {heroLevel}",
    kind: "earned",
    tier: "common",
    accent: "168 204 112",
    price: 0,
    condition: (s) =>
      effectiveHeroLevel(s.heroLevel, s.heroResets) >= TITLE_GOALS.heroLevel,
  },

  /* ---- earned · נדיר: for players who already know the game ---- */
  {
    key: "boss_hunter",
    label: "צייד הבוסים",
    hint: "נצח את הבוס של {bosses} דרגות ערים שונות",
    kind: "earned",
    tier: "rare",
    accent: "120 200 220",
    price: 0,
    condition: (s) => s.distinctBossesBeaten >= TITLE_GOALS.bosses,
  },
  {
    key: "legend",
    label: "האגדה",
    hint: "אסוף {legendaryItems} פריטים בדרגת אגדי לגיבור שלך",
    kind: "earned",
    tier: "rare",
    accent: "255 176 60",
    price: 0,
    condition: (s) => s.legendaryItems >= TITLE_GOALS.legendaryItems,
  },
  {
    key: "warlord",
    label: "מצביא הדורות",
    hint: "הגע עם הגיבור לרמה {cap}, אפס אותו, וטפס שוב עד רמה {warlordLevel}",
    kind: "earned",
    tier: "rare",
    accent: "62 200 140",
    price: 0,
    condition: (s) =>
      effectiveHeroLevel(s.heroLevel, s.heroResets) >= WARLORD_EFFECTIVE_LEVEL,
  },
  {
    key: "emperor",
    label: "הקיסר",
    hint: "הגע לעיר האחרונה והחזק את כל {cities} הערים",
    kind: "earned",
    tier: "rare",
    accent: "228 195 90",
    price: 0,
    condition: (s) => s.cities >= TITLE_GOALS.cities,
  },

  /* ---- earned · אגדי: a handful of players a season ---- */
  {
    key: "tyrant_slayer",
    label: "מפיל הכתרים",
    hint: "נצח את הבוס של כל {allBosses} דרגות הערים — בלי לפספס אף אחד",
    kind: "earned",
    tier: "legendary",
    accent: "232 82 82",
    price: 0,
    condition: (s) => s.distinctBossesBeaten >= TITLE_GOALS.allBosses,
  },
  {
    key: "reborn",
    label: "בן האלמוות",
    hint: "הגע עם הגיבור לרמה {cap} ואפס אותו — {resets} פעמים",
    kind: "earned",
    tier: "legendary",
    accent: "96 156 224",
    price: 0,
    condition: (s) => s.heroResets >= TITLE_GOALS.resets,
  },
  {
    key: "scourge",
    label: "אימת הממלכות",
    hint: "נצח ב-{greatWins} תקיפות על שחקנים אחרים",
    kind: "earned",
    tier: "legendary",
    accent: "244 96 160",
    price: 0,
    condition: (s) => s.attackWins >= TITLE_GOALS.greatWins,
  },

  /* ---- bought: boasts, not feats ---- */
  {
    key: "rich",
    label: "בעל המאה",
    hint: "נקנה בחנות התארים",
    flavor: "לא כל אחד יכול להרשות לעצמו את התואר הזה. אתה כן.",
    kind: "bought",
    accent: "228 195 90",
    price: TITLE_PRICE,
  },
  {
    key: "collector",
    label: "האספן",
    hint: "נקנה בחנות התארים",
    flavor: "יש לך אחד מכל דבר במשחק. עכשיו יש לך גם את זה.",
    kind: "bought",
    accent: "150 96 232",
    price: TITLE_PRICE,
  },
  {
    key: "gambler",
    label: "המהמר",
    hint: "נקנה בחנות התארים",
    flavor: "הגלגל, הכוסות, הכספת — תמיד עוד סיבוב אחד.",
    kind: "bought",
    accent: "62 200 140",
    price: TITLE_PRICE,
  },
  {
    key: "insomniac",
    label: "מי שלא ישן",
    hint: "נקנה בחנות התארים",
    flavor: "שלוש לפנות בוקר, ואתה עדיין סופר תורות.",
    kind: "bought",
    accent: "96 156 224",
    price: TITLE_PRICE,
  },
  {
    key: "philanthropist",
    label: "הנדיב",
    hint: "נקנה בחנות התארים",
    flavor: "נותן לברית, נותן לחלשים, ונותן לעצמו תואר.",
    kind: "bought",
    accent: "255 150 60",
    price: TITLE_PRICE,
  },
  {
    key: "unhinged",
    label: "המשוגע לדבר",
    hint: "נקנה בחנות התארים",
    flavor: "יש חיים גם מחוץ למשחק. שמעת עליהם פעם.",
    kind: "bought",
    accent: "232 82 82",
    price: TITLE_PRICE,
  },
];

export const TITLE_BY_KEY = new Map(TITLES.map((t) => [t.key, t]));

/**
 * Placeholders shared by the wording of the earned conditions — every goal,
 * already grouped ("1,000" rather than "1000"). Grouping happens here and not in
 * `TITLE_GOALS` because a condition compares numbers and a sentence prints
 * digits, and the achievements ladder writes its goals the same way.
 */
export const TITLE_PARAMS: Record<string, string> = Object.fromEntries(
  Object.entries(TITLE_GOALS).map(([name, goal]) => [
    name,
    goal.toLocaleString("en-US"),
  ])
);

/**
 * Which tier is allowed to *move* — a slow breath of its own accent wherever
 * the title is drawn (`[data-tier="legendary"]` in globals.css).
 *
 * The game already has exactly one animated name — `.staff-name`, molten gold
 * with a highlight travelling across it — and its whole job is to say "this
 * account is the house". Motion on most of the shelf would take that signal
 * apart, so it stops at the three אגדי titles; the pulse is also a *glow* rather
 * than a metallic sweep and is drawn in the title's own colour, so it never
 * reads as the gold one.
 *
 * Never reachable by a bought title, which carries no tier at all. That is the
 * line the whole feature rests on: the one thing diamonds must not buy here is
 * the appearance of a feat.
 */
export const ANIMATED_TIER: TitleTier = "legendary";

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
  /** The shop's sales line — bought only, drawn instead of `hint` on the card. */
  flavor: string | null;
  kind: TitleKind;
  /** Earned only — null on a bought title, which sits on no difficulty ladder. */
  tier: TitleTier | null;
  accent: string;
  price: number;
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
      flavor: definition.flavor ?? null,
      kind: definition.kind,
      tier: definition.tier ?? null,
      accent: definition.accent,
      price: definition.price,
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
