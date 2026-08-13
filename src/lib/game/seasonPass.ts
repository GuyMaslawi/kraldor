// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { GameSeason } from "@prisma/client";

/**
 * Season pass: a two-track (free / premium) reward ladder that refills on
 * every daily update.
 *
 * Three rules drive the whole design:
 *
 * 1. **It resets every daily update.** DAILY_UPDATE_TIMES fires twice a day
 *    (07:30 and 19:30), so a player gets two full ladders per day and is meant
 *    to be able to clear all fifty tiers inside one ~12h cycle. XP and claimed
 *    tiers reset at each boundary; see `cycleStartOf`.
 * 2. **Payouts scale with the season day**, exactly like the wheel does — the
 *    ladder is worth little on day 1 and a lot on day 60, so a fresh empire is
 *    not handed a game-breaking pile on its first login.
 * 3. **Premium is bought once per season, not once per cycle.** The purchase
 *    lives on the progress row and survives every reset until the season
 *    itself changes.
 *
 * Deliberately absent: diamonds and hero gear. At two cycles a day for a whole
 * season even a 3-diamond tier would pay out hundreds of diamonds, chipping
 * away at the pass price and undercutting the real-money store (see
 * DiamondPurchase); hero items belong to attacks and the hero shop, where
 * rarity gates how often they appear. Resources, turns and citizens carry the
 * ladder instead.
 */

/** Fraction of the base amount added for each day elapsed in the season. */
export const SEASON_PASS_DAILY_GROWTH = 0.25;

/**
 * XP required for each successive tier — tier N unlocks at N × this.
 *
 * The ladder is 50 tiers at 8 XP rather than the original 8 at 50, which is the
 * *same* 400 XP for a full clear. The cycle's difficulty is unchanged; what
 * changed is that it now pays out in many small steps instead of a few large
 * ones, so nearly every action visibly moves the bar and pops a tier or two.
 */
export const SEASON_PASS_XP_PER_TIER = 8;

export const SEASON_PASS_TIER_COUNT = 50;

/** Diamond cost of the premium track. Charged once per season. */
export const SEASON_PASS_PREMIUM_PRICE = 2000;

/* ------------------------------ XP sources ------------------------------ */

/**
 * Every gameplay action worth season-pass XP. The values are tuned so a
 * moderately active player clears the whole ladder (400 XP) within one ~12h
 * cycle: a low-level empire banks ~144 turns per cycle, which is ~14 attacks.
 * At 8 XP per tier that means one attack pops three tiers at a time.
 */
export const SEASON_PASS_XP = {
  attack: 25,
  spy: 10,
  mineUpgrade: 15,
  storageUpgrade: 15,
  empireUpgrade: 20,
  trainUnits: 10,
  buyWeapon: 10,
  bankDeposit: 10,
  wheelSpin: 5,
  miniGame: 20,
  foundCity: 40,
  /**
   * A city-boss run costs 300+ turns — 30 ordinary attacks' worth — so it pays
   * well above `attack`. It stays far short of the 400 XP that clears the whole
   * ladder: the boss is the cycle's centrepiece, not a way to skip the cycle.
   */
  bossFight: 120,
  /**
   * Sending the hero on an expedition. Paid at *departure*, not on collect: the
   * turns are spent then, and paying on collect would let a player bank a
   * finished quest across a cycle boundary to choose which ladder it feeds.
   * Modest — the cheapest run costs 22 turns, about two attacks.
   */
  heroQuest: 20,
} as const;

export type SeasonPassAction = keyof typeof SEASON_PASS_XP;

/**
 * Spend thresholds for the actions whose cost the *caller* chooses.
 *
 * `SEASON_PASS_XP` pays per successful call, which is safe only where the call
 * itself is scarce (attacks cost turns, wheel spins are rationed, a city can be
 * founded once). For `trainUnits`, `buyWeapon` and `bankDeposit` the player
 * picks the quantity, so paying per call made the whole ladder farmable for
 * almost nothing: 40 × `buyWeapon(quantity: 1)` on the cheapest always-unlocked
 * weapon cost ~5,000 resources and cleared all eight tiers, which pay ~21,000
 * back on day 1 and 15.75× that by day 60 — twice a day, forever. The pass was
 * net-positive on its own input.
 *
 * So these actions earn XP per unit of value actually spent, floored. A
 * quantity-1 purchase falls under `per` and earns exactly nothing, which is
 * what kills the farm; `maxUnits` stops one huge transaction from clearing the
 * ladder in a single call. Tune `per` to shift how much real play the pass
 * costs — the exploit is closed by the shape, not by these particular numbers.
 */
export const SEASON_PASS_SPEND_XP = {
  /** Total gold+wood+iron+stone handed over. */
  buyWeapon: { per: 2_000, maxUnits: 3 },
  /** Citizens converted into units. */
  trainUnits: { per: 25, maxUnits: 3 },
  /** Gold moved into the bank. */
  bankDeposit: { per: 5_000, maxUnits: 3 },
} as const;

export type SeasonPassSpendAction = keyof typeof SEASON_PASS_SPEND_XP;

/**
 * How many XP units a spend-based action earned. Returns 0 — meaning no XP at
 * all — for any outlay below one threshold.
 */
export function seasonPassSpendUnits(
  action: SeasonPassSpendAction,
  spend: number
): number {
  const { per, maxUnits } = SEASON_PASS_SPEND_XP[action];
  if (!Number.isFinite(spend) || spend <= 0) return 0;
  return Math.min(maxUnits, Math.floor(spend / per));
}

/** Total XP needed to have unlocked `tier` (1-based). */
export function xpForTier(tier: number): number {
  return Math.max(1, tier) * SEASON_PASS_XP_PER_TIER;
}

/** Highest tier unlocked by `xp`, clamped to the ladder length. */
export function tierForXp(xp: number): number {
  return Math.min(
    SEASON_PASS_TIER_COUNT,
    Math.floor(Math.max(0, xp) / SEASON_PASS_XP_PER_TIER)
  );
}

/** XP that clears the whole ladder — the per-cycle goal shown in the UI. */
export const SEASON_PASS_XP_MAX = xpForTier(SEASON_PASS_TIER_COUNT);

/* ------------------------------ reward table ------------------------------ */

/** Every reward kind the ladder can pay. All of them scale with the season day. */
export type SeasonPassRewardKind =
  | "gold"
  | "wood"
  | "iron"
  | "stone"
  | "turns"
  | "citizens";

export interface SeasonPassReward {
  /**
   * Also picks the icon: the ladder renders through `RESOURCE_ICON[kind]`, so a
   * reward can never drift to a glyph the rest of the game doesn't use.
   */
  kind: SeasonPassRewardKind;
  /** Day-1 quantity. */
  base: number;
  /** Round the grown amount to a clean, readable step. */
  step: number;
}

export interface SeasonPassTier {
  tier: number;
  free: SeasonPassReward;
  premium: SeasonPassReward;
}

/** What the premium track multiplies the free track by. The upsell copy reads this. */
export const SEASON_PASS_PREMIUM_MULTIPLIER = 3;

/**
 * Total the **free** track pays across a whole cycle, per kind, at day 1.
 *
 * This is the balance knob — and it is deliberately the *same* total the old
 * 8-tier ladder paid. Lengthening the ladder to 50 tiers must not multiply the
 * payout by six: XP per clear is unchanged (400), so a bigger total would be
 * pure inflation, and this pass has already had to be retuned once for being
 * net-positive against its own inputs (see SEASON_PASS_SPEND_XP). Fifty tiers
 * is a pacing change, not an economy change. Raise these numbers only if you
 * mean to make the pass more generous.
 */
const CYCLE_BUDGET: Record<SeasonPassRewardKind, number> = {
  gold: 9_000,
  wood: 7_000,
  iron: 2_500,
  stone: 2_500,
  turns: 40,
  citizens: 25,
};

/** Rounding step per kind, so amounts read as clean numbers. */
const REWARD_STEP: Record<SeasonPassRewardKind, number> = {
  gold: 10,
  wood: 10,
  iron: 10,
  stone: 10,
  turns: 1,
  citizens: 1,
};

/**
 * Which kind each tier pays, cycling every 10 tiers. Two tiers each of the four
 * resources plus one of turns and one of citizens per block, so over 50 tiers
 * every kind appears at a rate matching its share of the budget — and the round
 * tiers (10, 20, 30, 40, 50) all land on gold, so each block ends on the
 * headline resource.
 */
const KIND_CYCLE: SeasonPassRewardKind[] = [
  "gold",
  "wood",
  "iron",
  "turns",
  "stone",
  "wood",
  "citizens",
  "iron",
  "stone",
  "gold",
];

/** How much more a late tier pays than tier 1, before the season-day growth. */
const TIER_RAMP = 3;

/**
 * Build the ladder: 50 tiers, premium paying 3× the free track — which is
 * exactly what the upsell in the modal promises ("פי 3 שלל").
 *
 * Amounts are *derived* from `CYCLE_BUDGET` rather than hand-written, because
 * with fifty rows a hand-written table is impossible to keep balanced — one
 * edited row silently shifts what a full clear is worth. Each tier's share of
 * its kind's budget is proportional to a weight that ramps from 1× at tier 1 to
 * TIER_RAMP× at tier 50, so climbing feels like it pays more while the cycle
 * total stays put.
 *
 * No hero gear here on purpose. Hero items are meant to be won by fighting (a
 * captured drop from a won attack) or bought in the hero shop; handing a
 * guaranteed one out twice a day for clearing a ladder made the rarest tier
 * routine and undercut both sources.
 */
function buildLadder(): SeasonPassTier[] {
  const n = SEASON_PASS_TIER_COUNT;
  const kindOf = (tier: number) => KIND_CYCLE[(tier - 1) % KIND_CYCLE.length];
  const weight = (tier: number) =>
    1 + (TIER_RAMP - 1) * ((tier - 1) / Math.max(1, n - 1));

  // Total weight sitting on each kind, so each kind's shares sum to its budget.
  const weightPerKind = new Map<SeasonPassRewardKind, number>();
  for (let tier = 1; tier <= n; tier++) {
    const kind = kindOf(tier);
    weightPerKind.set(kind, (weightPerKind.get(kind) ?? 0) + weight(tier));
  }

  const tiers: SeasonPassTier[] = [];
  for (let tier = 1; tier <= n; tier++) {
    const kind = kindOf(tier);
    const step = REWARD_STEP[kind];
    const share = (CYCLE_BUDGET[kind] * weight(tier)) / weightPerKind.get(kind)!;
    const base = Math.max(step, Math.round(share / step) * step);
    tiers.push({
      tier,
      free: { kind, base, step },
      premium: { kind, base: base * SEASON_PASS_PREMIUM_MULTIPLIER, step },
    });
  }
  return tiers;
}

export const SEASON_PASS_TIERS: SeasonPassTier[] = buildLadder();

/**
 * Canonical display order for any per-kind reward summary — a claim's haul, the
 * ladder's cycle total, the premium upsell. Shared so two summaries rendered
 * side by side never list the same six kinds in two different orders.
 */
export const SEASON_PASS_HAUL_ORDER: SeasonPassRewardKind[] = [
  "gold",
  "wood",
  "iron",
  "stone",
  "turns",
  "citizens",
];

/** Hebrew label for a reward kind, used by both the UI and the claim toast. */
export const SEASON_PASS_REWARD_LABEL: Record<SeasonPassRewardKind, string> = {
  gold: "זהב",
  wood: "עץ",
  iron: "ברזל",
  stone: "אבן",
  turns: "תורות",
  citizens: "אזרחים",
};

/**
 * Current day of the season (1-based), clamped to the season's length so an
 * expired season keeps paying its final-day amounts rather than growing
 * forever. Without an active season everything falls back to day 1.
 *
 * Note this is a *day*, not the wheel's per-daily-update `seasonCycle`: the
 * pass refreshes twice a day but its payouts are priced once per day, so both
 * of a day's ladders are worth the same.
 */
export function seasonPassDay(
  season: Pick<GameSeason, "startsAt" | "endsAt"> | null | undefined,
  now: number
): number {
  if (!season) return 1;
  const dayMs = 86_400_000;
  const elapsed = Math.floor((now - season.startsAt.getTime()) / dayMs) + 1;
  const total = Math.max(
    1,
    Math.ceil((season.endsAt.getTime() - season.startsAt.getTime()) / dayMs)
  );
  return Math.min(Math.max(elapsed, 1), total);
}

/** Quantity a reward pays on a given season day. */
export function seasonPassRewardAmount(
  reward: SeasonPassReward,
  day: number
): number {
  const grown =
    reward.base * (1 + SEASON_PASS_DAILY_GROWTH * (Math.max(day, 1) - 1));
  return Math.max(reward.step, Math.round(grown / reward.step) * reward.step);
}
