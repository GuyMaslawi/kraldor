// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import { REGULAR_TICK_MS } from "./constants";

/**
 * Happy Hour — the global boost window.
 *
 * One admin-chosen bonus, paid to every player at once, for a fixed stretch of
 * wall-clock time. It bends exactly three rules, each of which can be switched
 * off independently:
 *
 *   • boostXp      — hero XP from battles (raids, defences, city bosses)
 *   • boostPlunder — resources taken from a beaten empire and from a boss haul
 *   • boostMines    — raw mine output on the 5-minute production tick
 *
 * It is deliberately *not* a tunable (lib/game/config.ts): a tunable is a
 * permanent balance dial with no clock and no announcement, while this is an
 * event — it starts, it screams, it ends. It stacks multiplicatively with
 * everything already in play (potions, guild spells, diamond boosts, the global
 * mine multiplier), because a window that quietly cancelled a player's own buffs
 * would feel like a punishment rather than a gift.
 *
 * Everything here is pure. The reads and the window arithmetic against the
 * database live in src/server/happyHour.ts.
 */

/** The window as gameplay code needs it — the row, minus its bookkeeping. */
export interface HappyHourWindow {
  id: string;
  title: string;
  bonusPct: number;
  boostXp: boolean;
  boostPlunder: boolean;
  boostMines: boolean;
  startsAt: Date;
  /** null = open-ended: it runs until an admin stops it. */
  endsAt: Date | null;
}

/**
 * Bounds on the bonus. The floor is 1 rather than 0 because a window that pays
 * nothing is not an event, and releasing one would light up every screen in the
 * game to promise a bonus of ×1. The ceiling is ×10, which is already absurd —
 * at that rate a single raid pays a day of mining.
 */
export const HAPPY_HOUR_MIN_PCT = 1;
export const HAPPY_HOUR_MAX_PCT = 900;

/** Upper bound on a release, in minutes: one week. */
export const HAPPY_HOUR_MAX_MINUTES = 7 * 24 * 60;

/** Default title when the admin leaves the field empty. */
export const HAPPY_HOUR_DEFAULT_TITLE = "Happy Hour";

/** One-click bonuses for the launcher, strongest last. */
export const HAPPY_HOUR_PRESETS = [50, 100, 200, 400, 900] as const;

/** One-click durations for the launcher, in minutes. */
export const HAPPY_HOUR_DURATIONS = [15, 30, 60, 120, 180, 360, 720, 1440] as const;

/** What a bonus percent multiplies a gain by: 100% more = ×2. */
export function happyHourMultiplier(bonusPct: number): number {
  return 1 + Math.max(0, bonusPct) / 100;
}

/**
 * The multiplier as players read it — "×2", "×2.5", "×1.5". Trailing zeros are
 * trimmed so the round numbers, which is what most releases will be, stay short.
 */
export function multiplierLabel(bonusPct: number): string {
  const mult = happyHourMultiplier(bonusPct);
  return `×${Number(mult.toFixed(2))}`;
}

/** The three rules a window can bend, for the banner and the admin screen. */
export const HAPPY_HOUR_EFFECTS = [
  {
    key: "boostXp" as const,
    label: "ניסיון בקרבות",
    short: "ניסיון",
    icon: "⚔️",
    detail: "כל נקודת ניסיון שהגיבור מרוויח בתקיפה, בהגנה ומול שליטי הערים",
  },
  {
    key: "boostPlunder" as const,
    label: "ביזה מאויבים ומבוסים",
    short: "ביזה",
    icon: "💰",
    detail: "המשאבים שאתה לוקח מאימפריה מובסת ומהשלל של שליט העיר",
  },
  {
    key: "boostMines" as const,
    label: "תפוקת מכרות",
    short: "מכרות",
    icon: "⛏️",
    detail: "כל עדכון רגיל — המכרות שלך מייצרים בקצב המוגבר",
  },
];

export type HappyHourEffectKey = (typeof HAPPY_HOUR_EFFECTS)[number]["key"];

/** Which of the three are on, in display order — what the banner lists. */
export function activeEffects(
  window: Pick<HappyHourWindow, "boostXp" | "boostPlunder" | "boostMines">
) {
  return HAPPY_HOUR_EFFECTS.filter((effect) => window[effect.key]);
}

/* ------------------------------ the mine backlog ------------------------------ */

/**
 * How many of the production ticks being settled now fell inside a window.
 *
 * The mine clock is lazy: a player who was away for a night settles the whole
 * backlog on their next page load. Multiplying *that* by the live bonus would
 * pay a golden hour on ticks that ticked long before it opened — and worse,
 * would reward staying logged out until a window opened, which is the opposite
 * of what an event is for.
 *
 * So the boost is priced per tick instead. Ticks are global 5-minute boundaries
 * (see elapsedRegularTicks), identified by `floor(t / REGULAR_TICK_MS)`; the
 * backlog being settled is every index in `(floor(last), floor(now)]`, and the
 * window claims the same half-open shape over the same axis: a tick is boosted
 * when its boundary falls in `(startsAt, endsAt]`. An open-ended window
 * (`endsAt = null`) runs to the end of the backlog.
 *
 * The half-open shape is what makes the arithmetic come out whole. A tick landing
 * at boundary `b` pays for the production of `(b - TICK, b]`, so a window opened
 * *on* a boundary starts paying at the next one — the tick that just landed was
 * mined before the announcement — and a window closing on a boundary pays that
 * last tick in full. A release that runs a round twelve ticks therefore pays
 * exactly twelve, and two back-to-back windows split a backlog with no tick
 * counted twice and none dropped between them.
 *
 * All times are epoch milliseconds.
 */
export function boostedTickCount(
  lastRegularUpdateAt: number,
  now: number,
  startsAt: number,
  endsAt: number | null
): number {
  const firstIdx = Math.floor(lastRegularUpdateAt / REGULAR_TICK_MS) + 1;
  const lastIdx = Math.floor(now / REGULAR_TICK_MS);
  if (lastIdx < firstIdx) return 0;

  const windowFirst = Math.floor(startsAt / REGULAR_TICK_MS) + 1;
  const windowLast =
    endsAt == null ? lastIdx : Math.floor(endsAt / REGULAR_TICK_MS);

  return Math.max(
    0,
    Math.min(windowLast, lastIdx) - Math.max(windowFirst, firstIdx) + 1
  );
}

/**
 * The backlog's *effective* tick count once every overlapping window has been
 * paid — plain `ticks`, plus the extra each boosted tick is worth.
 *
 * Expressed as a tick count rather than a multiplier so the caller can keep
 * multiplying one figure: production is `perTick × effectiveTicks × bonuses`,
 * and a backlog that was half inside a ×2 window settles at 1.5× without the
 * mine loop needing to know a window existed.
 */
export function effectiveMineTicks(
  ticks: number,
  lastRegularUpdateAt: number,
  now: number,
  windows: readonly Pick<HappyHourWindow, "bonusPct" | "startsAt" | "endsAt">[]
): number {
  let extra = 0;
  for (const window of windows) {
    const boosted = boostedTickCount(
      lastRegularUpdateAt,
      now,
      window.startsAt.getTime(),
      window.endsAt?.getTime() ?? null
    );
    extra += boosted * (happyHourMultiplier(window.bonusPct) - 1);
  }
  return ticks + extra;
}
