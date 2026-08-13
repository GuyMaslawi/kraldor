// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

/**
 * What the top of the season is actually playing for.
 *
 * The ladder has always ranked players; this is the first thing that puts a
 * price on the rank. Three seats, paid in diamonds, decided by the **final**
 * standing the season close seals into the archive (`buildPodium` in
 * server/seasonClose.ts) — not by whoever happens to lead on any given evening.
 *
 * The table lives here, in a pure module, rather than inline in the page,
 * because two other things have to be able to read it without importing a
 * screen: the guide, when it explains the season, and whatever hands the
 * diamonds over when the season is sealed.
 */

export interface SeasonPrize {
  /** Podium place, 1-based — matches `SeasonChampion.rank`. */
  rank: number;
  /** Diamonds paid to that place. */
  diamonds: number;
  /** Hebrew name of the place, for headings. */
  label: string;
}

/**
 * The prize ladder, first place first.
 *
 * Its length is the podium: keep it in step with `PODIUM_SIZE` in
 * server/seasonClose.ts — that constant decides how many champions the close
 * archives, and a prize for a rank nobody archives would never be paid.
 */
export const SEASON_PRIZES: readonly SeasonPrize[] = [
  { rank: 1, diamonds: 10_000, label: "מקום ראשון" },
  { rank: 2, diamonds: 6_000, label: "מקום שני" },
  { rank: 3, diamonds: 3_000, label: "מקום שלישי" },
];

/** Everything paid out at the end of a season. */
export const PRIZE_POOL = SEASON_PRIZES.reduce((sum, p) => sum + p.diamonds, 0);

/** The diamonds a given final rank is worth — 0 for anything off the podium. */
export function prizeForRank(rank: number): number {
  return SEASON_PRIZES.find((p) => p.rank === rank)?.diamonds ?? 0;
}
