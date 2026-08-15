// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { IconName } from "@/components/ui/Icon";
import { MAX_CITIES } from "./constants";

/**
 * The payout vocabulary shared by the three loops added around the daily
 * board — the muster roll (streak.ts), the mission board (missions.ts) and the
 * guild contract (guildContract.ts).
 *
 * The achievements ladder deliberately keeps its own, narrower list
 * (`AchievementRewardKind`): it predates this, it has no wheel spins, and its
 * `ACHIEVEMENT_REWARD_ORDER` carries display semantics that only make sense for
 * a screen where fifty rewards are collected at once. Merging the two would
 * have meant changing a shipped payout table to gain nothing.
 *
 * What is deliberately *not* here: hero XP, potions and gear. All three exist
 * as rewards elsewhere in the game, and all three need a hero row, a bag
 * capacity check and a rarity roll — a payout helper that has to reach into the
 * hero to settle a line is not a payout helper. Loops that want to hand over an
 * item do it themselves after calling `payRewards`.
 */

export type RewardKind =
  | "gold"
  | "wood"
  | "iron"
  | "stone"
  | "diamonds"
  | "citizens"
  | "turns"
  | "wheelSpins";

/** One line of a payout. */
export interface Reward {
  kind: RewardKind;
  amount: number;
}

export const REWARD_LABEL: Record<RewardKind, string> = {
  gold: "זהב",
  wood: "עץ",
  iron: "ברזל",
  stone: "אבן",
  diamonds: "יהלומים",
  citizens: "אזרחים",
  turns: "תורות",
  wheelSpins: "סיבובי גלגל",
};

export const REWARD_ICON: Record<RewardKind, IconName> = {
  gold: "gold",
  wood: "wood",
  iron: "iron",
  stone: "stone",
  diamonds: "diamond",
  citizens: "citizens",
  turns: "turns",
  wheelSpins: "wheel",
};

/** Display order for a merged payout — resources, then the specials. */
export const REWARD_ORDER: readonly RewardKind[] = [
  "gold",
  "wood",
  "iron",
  "stone",
  "citizens",
  "turns",
  "wheelSpins",
  "diamonds",
];

/**
 * Merge a batch of rewards into one line per kind, in a fixed order.
 *
 * Collecting three missions at once otherwise reads as nine fragments in
 * whatever order the catalog happened to declare them.
 */
export function mergeRewards(rewards: readonly Reward[]): Reward[] {
  const totals = new Map<RewardKind, number>();
  for (const r of rewards) {
    if (!(r.amount > 0)) continue;
    totals.set(r.kind, (totals.get(r.kind) ?? 0) + r.amount);
  }
  return REWARD_ORDER.filter((k) => totals.has(k)).map((kind) => ({
    kind,
    amount: totals.get(kind)!,
  }));
}

/* ------------------------------ the city curve ------------------------------ */

/**
 * Resource payouts multiply by this per city held — the same ×2.4 the city
 * boss and the hero quests pay on, so a reward written once stays worth
 * something at city ten instead of becoming a rounding error.
 */
export const REWARD_CITY_MULTIPLIER = 2.4;

/**
 * Kinds the city curve deliberately does not touch.
 *
 * Diamonds and wheel spins because they are rationed against the real-money
 * store and a ×5,000 late-game multiplier would turn either into a faucet.
 *
 * Citizens because people are resources one step removed: a citizen becomes a
 * mine slave and a mine slave multiplies with city production, so paying them
 * on the resource curve compounds into the economy twice. heroQuests.ts makes
 * the same call for the same reason, and states it at length.
 *
 * **Turns, since 2026-08-15** — the one that had to be fixed rather than tuned.
 * Turn *income* does not ride the city curve at all: the ladder tops out at
 * `turnsPerRegularUpdate(5)` = 5 a tick, so 1,440 a day is the most an empire can
 * earn at city one and at city ten alike. Paying turn rewards on a ×2.4-per-city
 * curve therefore compared a payout against nothing: the weekly turn mission was
 * 220 turns at city one and **581,198 at city ten** — four hundred days of maximum
 * income from one mission, dealt three at a time, every week. Every board that
 * pays turns went through here, so the missions, the login streak, the arena and
 * the guild contracts were all faucets of the same size.
 *
 * Turns are the currency the whole game is gated on (ATTACK_TURN_COST,
 * SPY_TURN_COST, a boss sortie); a currency that gates actions must stay scarce
 * or nothing else in the economy means anything. seasonPass.ts reached the same
 * conclusion independently and says so at TURNS_FINAL_PEAK — the pass caps a turn
 * rung at 1,000 on the season's last day for exactly this reason. This set is now
 * that rule applied everywhere else.
 */
const UNSCALED: ReadonlySet<RewardKind> = new Set([
  "diamonds",
  "wheelSpins",
  "citizens",
  "turns",
]);

/** Cities clamped onto the board the game actually has. */
export function clampCities(cities: number): number {
  return Math.min(MAX_CITIES, Math.max(1, Math.floor(cities || 1)));
}

/** The city factor an empire's resource rewards are multiplied by. */
export function rewardCityFactor(cities: number): number {
  return Math.pow(REWARD_CITY_MULTIPLIER, clampCities(cities) - 1);
}

/**
 * Apply the city curve to a reward table quoted at one city.
 *
 * The four resources land on round hundreds so a board reads in round numbers;
 * the unscaled kinds — turns included, see UNSCALED — pass through untouched.
 */
export function scaleRewards(
  rewards: readonly Reward[],
  cities: number
): Reward[] {
  const factor = rewardCityFactor(cities);
  return rewards.map(({ kind, amount }) => {
    if (UNSCALED.has(kind)) return { kind, amount };
    return {
      kind,
      amount: Math.max(100, Math.round((amount * factor) / 100) * 100),
    };
  });
}
