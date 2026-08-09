import type { HeroItemSlot, HeroRarity } from "@prisma/client";
import {
  HERO_MAX_LEVEL,
  ITEM_DROP_CHANCE,
  ITEM_DROP_CHANCE_BY_RARITY,
  RARITY_ORDER,
  SLOT_ORDER,
  itemLevelForRarity,
  itemUpgradeCost,
  nextTierLevel,
  tierForLevel,
} from "./hero";
import { secureRandom } from "./random";

/**
 * נפחיית הגיבור — the forge.
 *
 * Gear only ever came from winning attacks and from expeditions, and both hand
 * out a *random slot*. The result is the complaint the drop table guarantees: a
 * player with nine swords and no boots, whose only lever is to attack more and
 * hope. Every duplicate they throw away is progress they earned and cannot use.
 *
 * The forge is the exchange rate between those two facts. It does exactly one
 * thing: **it turns breadth into aim.** Nothing here makes gear the game would
 * not otherwise have given you.
 *
 * ## The rule that shapes everything below
 *
 * `nextTierLevel` in hero.ts states the gear economy's core law, and it is worth
 * repeating because the forge is the most likely place to break it:
 *
 * > An אגדי is the ceiling of its set. No amount of gold carries a piece across
 * > into the set above it. The only way into the next set is to *find* a piece
 * > of it.
 *
 * So a commissioned piece rolls its level through **exactly the same function a
 * natural drop does** (`itemLevelForRarity`, around the hero's own level) and
 * its rarity through **exactly the same table** (`ITEM_DROP_CHANCE_BY_RARITY`,
 * renormalised the way a guaranteed drop is). The only thing the player buys is
 * the *slot*. An אגדי from the forge is as rare as an אגדי from a raid, and a
 * level-90 piece is as unreachable at hero level 20 as it always was.
 *
 * Tempering obeys the same law from the other side: it walks a piece up its own
 * decade through `nextTierLevel` and stops dead at an אגדי, exactly as the gold
 * upgrade does.
 *
 * ## Why shard values are flat
 *
 * The obvious design scales shard yield and shard prices with the item's decade.
 * It is also the one with an exploit in it: any scheme where the *yield* of a
 * low decade and the *price* at a high one are denominated in the same currency
 * invites farming the cheap end to buy the expensive one, and the only defence
 * is a multiplier steep enough to be silly.
 *
 * Flat values have no such seam. A פשוט is worth one shard whether it came from
 * decade one or decade ten, a commission costs the same number of shards at
 * every stage, and the *item you get* is capped at your own decade regardless —
 * so the exchange rate is "about four drops for one aimed drop" at every point
 * in the game, forever, and there is nothing to arbitrage.
 *
 * The scaling sink lives on the gold side instead (see `commissionGoldCost`),
 * where the game already has a curve and an appetite for one.
 */

/* ------------------------------ shards ------------------------------ */

/**
 * What dismantling a piece yields, by its tier.
 *
 * Flat in the item's decade — see the header. The spread between the rungs is
 * steep on purpose: it mirrors the drop table almost exactly (12 / 5 / 1.5 /
 * 0.5 per winning attack), so a shard is worth roughly the same number of
 * *attacks* whichever rarity it was melted out of, and nobody is ever punished
 * for melting the wrong thing.
 */
export const SHARDS_BY_RARITY: Record<HeroRarity, number> = {
  COMMON: 1,
  RARE: 3,
  EPIC: 10,
  LEGENDARY: 30,
};

/** Shards yielded by dismantling an item of this level. */
export function shardsForItem(level: number): number {
  return SHARDS_BY_RARITY[tierForLevel(level)];
}

/**
 * The average shard yield of one natural drop.
 *
 * Derived from the drop table rather than written down, so retuning the odds
 * moves the forge's exchange rate with them instead of silently making the
 * forge cheap. Works out at ~3.1 shards per drop on the shipped table.
 */
export const SHARDS_PER_DROP = RARITY_ORDER.reduce(
  (sum, rarity) =>
    sum +
    (ITEM_DROP_CHANCE_BY_RARITY[rarity] / ITEM_DROP_CHANCE) *
      SHARDS_BY_RARITY[rarity],
  0
);

/* ------------------------------ commissioning ------------------------------ */

/**
 * Drops a commission is worth. Four, so the forge is a real conversion and not
 * a shortcut: melting four pieces you cannot use to aim one is a trade a player
 * will take, and melting one to get one would make the drop table pointless.
 */
export const COMMISSION_DROPS = 4;

/**
 * Shards to commission a piece — the exchange rate above, rounded to a figure a
 * player can hold in their head.
 */
export const COMMISSION_SHARDS = Math.round(SHARDS_PER_DROP * COMMISSION_DROPS);

/**
 * The decade a hero's gear sits in (0-based), which is the decade a commission
 * rolls around. Kept here rather than inlined so the price, the preview and the
 * roll all read it the same way.
 */
export function heroDecade(heroLevel: number): number {
  return Math.floor((Math.max(1, Math.min(HERO_MAX_LEVEL, heroLevel)) - 1) / 10);
}

/**
 * Gold to commission a piece: the price of the *cheapest* upgrade inside the
 * hero's own decade.
 *
 * Deliberately borrowed from `itemUpgradeCost` rather than invented. That curve
 * is the gear economy's price of a rung — geometric, ×3.95 per decade, tuned so
 * late-game gold has something to buy — and a forge with its own curve would
 * drift out of step with it the first time either was retuned. Taking the
 * decade's floor rather than its ceiling keeps a commission cheaper than
 * finishing a piece you already hold, which is the right order: aiming a drop
 * should cost less than perfecting one.
 */
export function commissionGoldCost(heroLevel: number): number {
  return itemUpgradeCost(heroDecade(heroLevel) * 10 + 1) ?? 0;
}

/**
 * Roll a commissioned piece: the caller's slot, everything else exactly as a
 * natural drop.
 *
 * The rarity walk is `rollGuaranteedItem`'s — the commission has already decided
 * that *something* arrives, so only the relative split matters and it is
 * renormalised rather than re-rolled. Copied here rather than called because
 * that helper also picks a slot, and the slot is the one thing the player is
 * paying to decide.
 */
export function rollCommission(
  heroLevel: number,
  slot: HeroItemSlot,
  random: () => number = secureRandom
): { slot: HeroItemSlot; level: number; rarity: HeroRarity } {
  const roll = random() * ITEM_DROP_CHANCE;
  let acc = 0;
  let rarity: HeroRarity = "COMMON";
  for (const candidate of RARITY_ORDER) {
    acc += ITEM_DROP_CHANCE_BY_RARITY[candidate];
    if (roll < acc) {
      rarity = candidate;
      break;
    }
  }
  return { slot, level: itemLevelForRarity(heroLevel, rarity, random), rarity };
}

/** Whether a slot id from a form is one the game actually has. */
export function isHeroSlot(value: unknown): value is HeroItemSlot {
  return (
    typeof value === "string" && (SLOT_ORDER as string[]).includes(value)
  );
}

/* ------------------------------ tempering ------------------------------ */

/**
 * Shards to temper a piece up one band, by the band it is *leaving*.
 *
 * Tempering is the forge's answer to the player who has shards and no gold —
 * the gold upgrade on the hero page does the same thing and the two are
 * deliberately interchangeable, so neither is the "right" way. The prices are
 * steep against the commission (a full פשוט → אגדי walk costs 78 shards, more
 * than four commissions) because the gold path already exists and this one must
 * not undercut it at every rung.
 *
 * LEGENDARY has no entry: an אגדי closes its set, and `temperShardCost` returns
 * null there exactly as `itemUpgradeCost` does.
 */
export const TEMPER_SHARDS: Record<Exclude<HeroRarity, "LEGENDARY">, number> = {
  COMMON: 8,
  RARE: 20,
  EPIC: 50,
};

/**
 * Shards to temper an item of this level to its next band, or null when there
 * is nothing to temper into — an אגדי, which is its set's ceiling.
 */
export function temperShardCost(level: number): number | null {
  if (nextTierLevel(level) === null) return null;
  const tier = tierForLevel(level);
  if (tier === "LEGENDARY") return null;
  return TEMPER_SHARDS[tier];
}

/* ------------------------------ view model ------------------------------ */

/** One slot on the commission bench. */
export interface CommissionOption {
  slot: HeroItemSlot;
  /** How many of this slot are already in the bag or worn. */
  owned: number;
  /** The best level held in this slot, or 0 when the slot is empty. */
  bestLevel: number;
}

/** Everything the forge screen renders. */
export interface ForgeState {
  shards: number;
  heroLevel: number;
  /** The decade a commission rolls around, 1-based for display. */
  decade: number;
  shardCost: number;
  goldCost: number;
  /** The empire's gold right now — the button needs both halves of the price. */
  gold: number;
  /** Bag slots free; a commission with a full bag is refused. */
  bagFree: number;
  slots: CommissionOption[];
  /** Everything in the bag, with what melting or tempering it would do. */
  bag: ForgeBagItem[];
}

/** One bag row, priced for both benches. */
export interface ForgeBagItem {
  id: string;
  slot: HeroItemSlot;
  level: number;
  rarity: HeroRarity;
  /** Shards dismantling it would yield. */
  shards: number;
  /** Shards to temper it up a band, or null at a set's ceiling. */
  temperCost: number | null;
  /** The level tempering would take it to, or null. */
  temperTo: number | null;
}
