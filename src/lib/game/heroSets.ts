// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

/**
 * Hero gear **sets** — one per decade of item level.
 *
 * An item's level (1–100) already drives its bonuses; this is what makes the
 * ladder *visible*. Every piece is redrawn each time it crosses a decade, so a
 * level-9 sword and a level-11 sword are not the same picture with a different
 * number on it — they are different swords. The ten sets climb a materials
 * ladder first (leather → iron → steel), then wealth and craft (silver → gold →
 * obsidian), then the elements (magma → storm → void), and end on the divine
 * set no player sees until the last decade of the game.
 *
 * The rarity bands (פשוט/מתקדם/אליט/אגדי) still cycle *inside* each decade, so
 * a set has four grades of the same look; see `tierForLevel` in `hero.ts`.
 */

/** Levels per set — the sets are exactly the decades of the 1–100 ladder. */
export const ITEM_SET_SPAN = 10;

export interface HeroItemSet {
  /** 1–10, ascending. */
  index: number;
  /** Directory the art lives in: `/hero/sets/set<NN>/<slot slug>.webp`. */
  dir: string;
  /** In-game name of the set. */
  label: string;
  /** First and last item level this set covers, inclusive. */
  from: number;
  to: number;
}

const SET_NAMES: { dir: string; label: string }[] = [
  { dir: "set01", label: "מסע הנווד" },
  { dir: "set02", label: "ברזל הלגיון" },
  { dir: "set03", label: "פלדת האביר" },
  { dir: "set04", label: "כפור הספיר" },
  { dir: "set05", label: "זהב המלוכה" },
  { dir: "set06", label: "אובסידיאן הדם" },
  { dir: "set07", label: "להט המאגמה" },
  { dir: "set08", label: "זעם הסערה" },
  { dir: "set09", label: "תהום האינסוף" },
  { dir: "set10", label: "זוהר האלים" },
];

export const HERO_ITEM_SETS: HeroItemSet[] = SET_NAMES.map((s, i) => ({
  index: i + 1,
  dir: s.dir,
  label: s.label,
  from: i * ITEM_SET_SPAN + 1,
  to: (i + 1) * ITEM_SET_SPAN,
}));

/** The set a piece of this level belongs to. Levels outside 1–100 clamp. */
export function itemSetForLevel(level: number): HeroItemSet {
  const i = Math.ceil(Math.max(1, level) / ITEM_SET_SPAN);
  return HERO_ITEM_SETS[Math.min(HERO_ITEM_SETS.length, Math.max(1, i)) - 1];
}

/**
 * Art for one piece. `slug` is `SLOT_META[slot].slug`.
 *
 * Without a level there is no set to draw from, so this falls back to the
 * original single-look art at `/hero/<slug>.png` — which is also what the
 * `<img>` fallback in `ItemTile` lands on if a set file is ever missing.
 */
export function heroItemArtPath(slug: string, level?: number): string {
  if (level == null) return `/hero/${slug}.png`;
  return `/hero/sets/${itemSetForLevel(level).dir}/${slug}.webp`;
}
