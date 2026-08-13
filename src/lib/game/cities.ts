// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { T } from "@/i18n/translate";
import { MAX_CITIES } from "./constants";

/**
 * The ten cities — one per city tier (`Empire.cities`, 1..MAX_CITIES).
 *
 * A city used to be a bare number: the ladder said "עיר 3", the boss slab said
 * "עיר 3", and the rankings header carried a stray prototype name ("ואלקריה")
 * that belonged to nothing. A number tells a player where they stand but gives
 * them nothing to say about it — "עליתי לתדמור" is a story, "עליתי לעיר 6" is a
 * counter.
 *
 * So each tier gets a name and an epithet, escalating from a border outpost to
 * the seat of the broken crown. The names are *places*, deliberately distinct
 * from the boss catalog (`CITY_BOSSES`), which names the tyrant who rules each
 * one — the pair reads "ורקוס, שובר השערים, שליט אשמורן".
 *
 * The tier is derived from the array position, exactly like the boss table, so
 * the two can never drift apart or out of sync with MAX_CITIES.
 */
export interface CityName {
  /** City tier this name belongs to (1..MAX_CITIES). */
  tier: number;
  /** The city itself — what the UI prints beside "עיר". */
  name: string;
  /** One-line epithet, for tooltips and the guide's city table. */
  epithet: string;
}

export const CITY_NAMES: readonly CityName[] = [
  { name: "אשמורן", epithet: "משמר הגבול" },
  { name: "תרשיש", epithet: "נמל האניות השבורות" },
  { name: "כרכמיש", epithet: "המעבר שמעבר לנהר" },
  { name: "ארגוב", epithet: "מבצר הבזלת" },
  { name: "אופיר", epithet: "אוצר המדבר" },
  { name: "תדמור", epithet: "נווה העמודים" },
  { name: "מגידו", epithet: "שדה הקרב האחרון" },
  { name: "פתרוס", epithet: "עיר הכבשנים" },
  { name: "בבל", epithet: "צל המגדל" },
  { name: "קראלדור", epithet: "כס הכתר השבור" },
].map((city, index) => ({ ...city, tier: index + 1 }));

/** The city at a given tier; clamped to the catalog's ends. */
export function cityAt(cities: number): CityName {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  return CITY_NAMES[tier - 1];
}

/**
 * "אשמורן (1)" — the name with its tier, the common case at a call site.
 *
 * The name alone is a story but not a position: a player reading "תדמור" on a
 * leaderboard row cannot tell whether that empire is above or below him without
 * knowing the catalog by heart. The tier rides along in parentheses everywhere
 * the name is printed, so the ladder stays readable to someone who has only
 * seen two of the ten cities. Call sites that need the bare name (because they
 * already print the number themselves, like the guide's city table) reach for
 * `cityAt(n).name`.
 */
export function cityName(t: T, cities: number): string {
  const city = cityAt(cities);
  return t("{city} ({tier})", { city: t(city.name), tier: city.tier });
}

/** "אשמורן (1) · משמר הגבול" — for tooltips that have room for the whole title. */
export function cityFullName(t: T, cities: number): string {
  return t("{city} · {epithet}", {
    city: cityName(t, cities),
    epithet: t(cityAt(cities).epithet),
  });
}
