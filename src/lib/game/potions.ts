// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { PotionKind } from "@prisma/client";
import type { T } from "@/i18n/translate";
import { secureRandom } from "./random";

/**
 * Potions — the second thing the hero carries, under the bag.
 *
 * Unlike items, a potion is not worn and has no stats: it is a *window of
 * time* in which one rule of the game is bent. Drinking one starts (or extends)
 * that window; everything downstream only ever asks "is this kind active for
 * this empire right now?" — see lib/game/potionEffects.ts. Nothing has to be
 * cleaned up when a window closes, because every reader filters on `expiresAt`.
 *
 * Today they drop from won attacks only (rollPotionDrop, wired into
 * attackEmpire). The catalog is deliberately source-agnostic so a shop, a
 * wheel wedge or a season-pass reward can hand out the same brews later.
 */

/** The bottle silhouettes — one per potion, so a brew is known by shape alone. */
export type PotionShape = "vial" | "orb" | "flask" | "crystal";

export interface PotionMeta {
  label: string;
  /** One line under the name — what it does, in the player's words. */
  tagline: string;
  /** The full effect text shown in the drink dialog. */
  description: string;
  /** How long one dose lasts. */
  durationMs: number;
  shape: PotionShape;
  /** Liquid gradient, light → dark, and the colour its glow throws. */
  liquid: { from: string; to: string; glow: string };
  /** Tailwind text colour for the name, matched to the liquid. */
  tone: string;
  /** Relative odds of this kind when a potion drops (see rollPotionDrop). */
  dropWeight: number;
}

const HOUR = 3_600_000;

/** Display (and drop-table) order — strongest-feeling brew first. */
export const POTION_KINDS: PotionKind[] = [
  "DOUBLE_XP",
  "DOUBLE_RESOURCES",
  "HERO_INVULNERABLE",
  "FORGE_DISCOUNT",
];

export const POTION_META: Record<PotionKind, PotionMeta> = {
  DOUBLE_XP: {
    label: "שיקוי הניסיון",
    tagline: "פי 2 ניסיון גיבור בקרבות",
    description:
      "כל עוד השיקוי פועל, כל נקודת ניסיון שהגיבור שלך מרוויח בקרב נספרת פעמיים — בתקיפות, בהגנות מוצלחות ובקרבות מול שליטי הערים.",
    durationMs: HOUR,
    shape: "vial",
    liquid: { from: "#f9e08a", to: "#a8690f", glow: "#f7dd7a" },
    tone: "text-gold-bright",
    dropWeight: 30,
  },
  DOUBLE_RESOURCES: {
    label: "שיקוי השפע",
    tagline: "פי 2 משאבים — ביזה ותפוקה",
    description:
      "כל עוד השיקוי פועל, הביזה שאתה לוקח מתקיפות מוצלחות מוכפלת, וגם המכרות שלך מייצרים כפול בכל עדכון רגיל.",
    durationMs: HOUR,
    shape: "orb",
    liquid: { from: "#86efac", to: "#065f46", glow: "#6ee7b7" },
    tone: "text-emerald-300",
    dropWeight: 25,
  },
  HERO_INVULNERABLE: {
    label: "שיקוי החסינות",
    tagline: "הגיבור לא סופג נזק",
    description:
      "כל עוד השיקוי פועל, הגיבור שלך לא מאבד חיים — גם אם תוקף פורץ את ההגנה שלך, הוא יוצא מהקרב ללא שריטה. שאר הקרב (ביזה, שבויים) מתנהל כרגיל.",
    durationMs: HOUR,
    shape: "flask",
    liquid: { from: "#fda4af", to: "#881337", glow: "#fb7185" },
    tone: "text-rose-300",
    dropWeight: 25,
  },
  FORGE_DISCOUNT: {
    label: "שיקוי הנפח",
    tagline: "50% הנחה על שדרוג חפצים",
    description:
      "כל עוד השיקוי פועל, כל שדרוג חפץ בתיק או על הגיבור עולה חצי מחיר — גם בשדרוג בודד וגם ב'שדרג הכל'.",
    durationMs: HOUR / 2,
    shape: "crystal",
    liquid: { from: "#c4b5fd", to: "#4c1d95", glow: "#a78bfa" },
    tone: "text-violet-300",
    dropWeight: 20,
  },
};

/* ------------------------------ effect magnitudes ------------------------------ */

/** What שיקוי הניסיון / השפע multiply their gain by — "100% more" = ×2. */
export const POTION_DOUBLE = 2;

/** Percent off item upgrades while שיקוי הנפח is active. */
export const FORGE_DISCOUNT_PCT = 50;

/**
 * An item-upgrade price with the forge potion applied. Rounded *up*, matching
 * the diamond shop discount, so the discounted price is never free by rounding.
 */
export function forgeDiscountedCost(cost: number, active: boolean): number {
  if (!active) return cost;
  return Math.ceil(cost * (1 - FORGE_DISCOUNT_PCT / 100));
}

/* ------------------------------ drops ------------------------------ */

/**
 * Chance a won attack also yields a potion. Kept far below the item-drop rate
 * (19%) *on purpose*: an hour of a bent rule is the most valuable thing a raid
 * can hand out, and at one-in-a-few-raids (the old 8%) every player simply had
 * a permanent belt of them — the window stopped being an event. At 2% a brew is
 * a windfall you save for the raid that matters, and the hero quest board (see
 * lib/game/heroQuests.ts) stays the *reliable* way to go looking for one.
 */
export const POTION_DROP_CHANCE = 0.02;

/** How many of one kind the belt will hold — a deep but not infinite stash. */
export const POTION_STACK_CAP = 99;

const TOTAL_DROP_WEIGHT = POTION_KINDS.reduce(
  (sum, kind) => sum + POTION_META[kind].dropWeight,
  0
);

/**
 * Roll a potion for a won battle, or null for the usual nothing. One roll
 * decides *whether* a potion drops, a second walks the weights to decide which
 * — so retuning one brew's weight can never change the overall drop rate.
 */
export function rollPotionDrop(random: () => number = secureRandom): PotionKind | null {
  if (random() >= POTION_DROP_CHANCE) return null;
  return rollGuaranteedPotion(random);
}

/**
 * Pick *which* brew, for a source that has already decided one is coming — a
 * hero quest rolls its own, far higher, odds before it gets here. Keeping this
 * separate is what stops such a caller from having to fake a roll through
 * `rollPotionDrop`'s gate, which would skew the weights.
 */
export function rollGuaranteedPotion(
  random: () => number = secureRandom
): PotionKind {
  let roll = random() * TOTAL_DROP_WEIGHT;
  for (const kind of POTION_KINDS) {
    roll -= POTION_META[kind].dropWeight;
    if (roll < 0) return kind;
  }
  return POTION_KINDS[POTION_KINDS.length - 1];
}

/* ------------------------------ timing ------------------------------ */

/**
 * When a freshly drunk potion of `kind` wears off. Drinking one whose window is
 * already open *extends* it instead of restarting it — a second bottle is never
 * wasted, and the player is never punished for drinking early.
 */
export function potionExpiryAfterDrink(
  kind: PotionKind,
  now: Date,
  currentExpiry: Date | null | undefined
): Date {
  const base =
    currentExpiry && currentExpiry > now ? currentExpiry.getTime() : now.getTime();
  return new Date(base + POTION_META[kind].durationMs);
}

/**
 * "שעה" / "חצי שעה" / "2 שעות" — the duration as a player reads it.
 *
 * Takes the translator rather than returning a source string: Hebrew names one
 * hour and half an hour without a number at all, so which sentence to reach for
 * is a decision the language makes, not the dictionary.
 */
export function potionDurationLabel(t: T, kind: PotionKind): string {
  const ms = POTION_META[kind].durationMs;
  if (ms === HOUR) return t("שעה");
  if (ms === HOUR / 2) return t("חצי שעה");
  const hours = ms / HOUR;
  return Number.isInteger(hours)
    ? t("{count} שעות", { count: hours })
    : t("{count} דקות", { count: Math.round(ms / 60_000) });
}
