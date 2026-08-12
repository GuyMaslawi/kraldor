/**
 * להט הקרב — the presence boost.
 *
 * Turns accrue while you sleep, and that is not up for negotiation: a player who
 * misses a day comes back to the whole 1,440-turn backlog, exactly as before.
 * What this adds is a reason to *stay* once you are here — the turns you spend
 * while the meter is hot are worth more than the ones you dump and leave.
 *
 * It boosts the **spend** side, never the accrual side, and that choice is the
 * whole design:
 *
 *   • No new faucet. Plunder is a transfer between two players — zero-sum — so a
 *     multiplier on it cannot inflate the economy the way a multiplier on mines
 *     or turns would. That matters in a game already ceilinged at 999P.
 *   • The occasional player loses nothing he had. He still makes every attack
 *     his turns pay for; he is merely less efficient in them. That is a gap in
 *     efficiency, not in access, and it is the difference between "I'm behind"
 *     and "I'm out".
 *   • It argues against bingeing. A boost to accrual says "log in more"; a boost
 *     that must be *warmed up* says "don't burn the whole bank in ninety
 *     seconds" — which is the behaviour the dead time is made of.
 *
 * Nothing runs on a schedule. Like the daily streak (two integers on Empire, no
 * job) and like Happy Hour (every reader filters on the clock), the meter is two
 * columns and a pure function: points, and the instant those points were true.
 * The decay is *derived* at read time by `fervorNow`. A player away for a week
 * costs the game nothing while he is gone.
 *
 * Everything here is pure. The single guarded UPDATE that advances the meter
 * lives in src/server/fervor.ts.
 */

/**
 * How long one point of fervor survives without being renewed.
 *
 * This is the number that sets the whole rhythm. At two minutes a player must
 * act roughly every other minute to *hold* a tier — enough that a browser left
 * open in a background tab earns nothing, and little enough that reading a
 * battle report or picking a target does not cost a tier.
 */
export const FERVOR_DECAY_MS = 2 * 60 * 1000;

/**
 * Points cannot bank past this. Without a ceiling a player could spend a quiet
 * hour spamming free actions to stockpile 200 points and then coast at ×1.5 for
 * an hour of raiding without touching the meter again — which is banking heat
 * for later, the opposite of "be here now". At 30 the surplus above the top tier
 * is 10 points = 20 minutes of grace, no more.
 */
export const FERVOR_CAP = 30;

/**
 * The ladder, coldest first. `min` is the point count that unlocks the rung.
 *
 * Reaching שריפה from cold takes ~20 net actions — call it thirteen minutes of
 * real play once decay is paid along the way — and holding it takes an action
 * every two minutes. The multipliers are deliberately modest: this rides on top
 * of potions, guild spells and Happy Hour, all of which multiply too, and the
 * plunder rate is clamped at 1 downstream. It is a nudge, not a jackpot.
 */
export const FERVOR_TIERS = [
  { key: "spark", label: "ניצוץ", min: 0, mult: 1 },
  { key: "flame", label: "להבה", min: 4, mult: 1.15 },
  { key: "bonfire", label: "מדורה", min: 10, mult: 1.3 },
  { key: "blaze", label: "שריפה", min: 20, mult: 1.5 },
] as const;

export type FervorTier = (typeof FERVOR_TIERS)[number];
export type FervorTierKey = FervorTier["key"];

/**
 * How many *winning* attacks a day may be paid at the boosted rate.
 *
 * A flat count rather than a percentage, because a flat count scales itself to
 * the player it is capping. The turns upgrade spans 288–1,440 turns a day, which
 * at ATTACK_TURN_COST is 28–144 attacks:
 *
 *   • at level 1 the player makes 28 attacks a day, so 45 never binds — every
 *     one of his raids is hot. That is the floor that keeps a small or
 *     occasional account whole.
 *   • at level 5 the player makes 144, so 45 of them are boosted — a ceiling of
 *     roughly +31% on the day's haul, however many hours he sits here.
 *
 * One integer is therefore both the floor and the ceiling, and it reads as a
 * single line on screen: "34/45 תקיפות לוהטות היום".
 */
export const FERVOR_MAX_HOT_ATTACKS = 45;

/* --------------------------------- reading --------------------------------- */

/**
 * The points a meter is actually worth right now, after decay.
 *
 * `fervorAt` is the instant `points` was true — NOT the last time the player
 * acted (see `bumpedFervor` for why those differ, and why the difference is
 * load-bearing). A null means the meter has never been lit.
 *
 * The elapsed span is floored at zero before it is divided. Without that guard a
 * `fervorAt` in the future — clock skew between web hosts, an admin editing a
 * row, a restored backup — would yield a negative period count, and subtracting
 * a negative *adds* points. A defensive `max` is cheaper than the exploit.
 *
 * All times are epoch milliseconds.
 */
export function fervorNow(
  points: number,
  fervorAt: number | null,
  now: number
): number {
  if (fervorAt == null || points <= 0) return 0;
  const periods = Math.max(0, Math.floor((now - fervorAt) / FERVOR_DECAY_MS));
  return Math.max(0, Math.min(FERVOR_CAP, points) - periods);
}

/** The rung a point count sits on. Never null — ניצוץ is the cold floor. */
export function fervorTier(points: number): FervorTier {
  let tier: FervorTier = FERVOR_TIERS[0];
  for (const candidate of FERVOR_TIERS) {
    if (points >= candidate.min) tier = candidate;
  }
  return tier;
}

/** What a point count multiplies a boosted gain by. */
export function fervorMultiplier(points: number): number {
  return fervorTier(points).mult;
}

/**
 * The next rung up and how many points away it is, or null on שריפה.
 * Drives the "→ שריפה בעוד 4 פעולות" hint under the gauge.
 */
export function fervorNextTier(
  points: number
): { tier: FervorTier; pointsAway: number } | null {
  const next = FERVOR_TIERS.find((candidate) => points < candidate.min);
  return next ? { tier: next, pointsAway: next.min - points } : null;
}

/**
 * The multiplier as players read it — "×1.3", "×1.5". Trailing zeros trimmed,
 * matching `multiplierLabel` in happyHour.ts so the two boosts print alike.
 */
export function fervorLabel(points: number): string {
  return `×${Number(fervorMultiplier(points).toFixed(2))}`;
}

/**
 * How full the current rung is, 0–1 — the gauge's fill.
 *
 * Measured across the span of the rung the player is standing on, so each tier
 * fills from empty to full and the bar restarts on promotion. On שריפה it reads
 * 1: there is nothing left to fill toward.
 */
export function fervorProgress(points: number): number {
  const next = fervorNextTier(points);
  if (!next) return 1;
  const floor = fervorTier(points).min;
  return Math.min(1, Math.max(0, (points - floor) / (next.tier.min - floor)));
}

/* --------------------------------- writing --------------------------------- */

/** The meter's two columns, as the write and the read both see them. */
export interface FervorState {
  points: number;
  /** Epoch ms, or null for a meter that has never been lit. */
  at: number | null;
}

/**
 * The meter after one action lands. This is the arithmetic the server's UPDATE
 * performs, kept here so it can be tested without a database.
 *
 * The subtle part — and the reason this is a named function rather than three
 * lines at the call site — is that **`at` advances only by whole decay periods,
 * never to `now`**.
 *
 * The naive version stamps `at = now` on every action, and it is broken. Decay
 * is floored, so a player acting every 1:59 pays `floor(0.99) = 0` points of
 * decay *forever*: each action resets the clock before a period completes, and
 * the remainder is thrown away every time. He climbs to the cap and stays there
 * on a cadence that was supposed to hold him one rung below. Advancing `at` by
 * `periods × FERVOR_DECAY_MS` instead carries that remainder forward, so decay
 * accrues on an absolute clock and the cadence means what it says.
 *
 * The consequence is that `at` is not "when you last acted" — it is the instant
 * the stored `points` was last exactly true, which is what `fervorNow` needs and
 * the only thing this column should ever be read as.
 */
export function bumpedFervor(
  state: FervorState,
  now: number,
  amount = 1
): FervorState {
  if (state.at == null) {
    return { points: Math.min(FERVOR_CAP, Math.max(0, amount)), at: now };
  }
  const periods = Math.max(0, Math.floor((now - state.at) / FERVOR_DECAY_MS));
  const decayed = Math.max(0, Math.min(FERVOR_CAP, state.points) - periods);
  return {
    points: Math.min(FERVOR_CAP, decayed + Math.max(0, amount)),
    // Carries the sub-period remainder forward. See above — this is the whole
    // reason the function exists.
    at: state.at + periods * FERVOR_DECAY_MS,
  };
}

/* ------------------------------ the daily cap ------------------------------ */

/**
 * Whether a winning attack may be paid at the boosted rate, and what the day's
 * counter becomes if it is.
 *
 * `storedDay`/`storedHot` are the empire's two counter columns; `today` is
 * `gameDay(now)` (Jerusalem, see lib/game/time.ts). A stored day that is not
 * today is read as zero rather than reset on a schedule — same trick as the
 * streak columns, and the same reason: nothing may run while the player is away.
 *
 * A cold meter never consumes a slot. Burning the day's allowance on ×1 raids
 * would punish exactly the player the cap is meant to leave alone.
 */
export function hotAttackDecision(
  storedDay: number,
  storedHot: number,
  today: number,
  points: number
): { hot: boolean; usedToday: number; nextHot: number } {
  const usedToday = storedDay === today ? storedHot : 0;
  const hot =
    fervorMultiplier(points) > 1 && usedToday < FERVOR_MAX_HOT_ATTACKS;
  return { hot, usedToday, nextHot: hot ? usedToday + 1 : usedToday };
}
