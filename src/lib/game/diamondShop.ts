import type { DiamondEffectKind } from "@prisma/client";
import type { StorableResource } from "./constants";

/* ------------------------------ resource boosts ------------------------------ */

/** Each purchase raises a resource's production boost by this much… */
export const BOOST_STEP_PCT = 25;
/** …up to this cap, per resource. */
export const BOOST_MAX_PCT = 200;
/** How long the whole boost stays active; each purchase resets the timer. */
export const BOOST_DURATION_HOURS = 24;
export const BOOST_DURATION_MS = BOOST_DURATION_HOURS * 3_600_000;
/** Diamonds per +25% step (flat). */
export const BOOST_STEP_COST = 40;

/** DiamondEffectKind that stores each resource's boost. */
export const RESOURCE_BOOST_KIND: Record<StorableResource, DiamondEffectKind> = {
  gold: "RESOURCE_BOOST_GOLD",
  wood: "RESOURCE_BOOST_WOOD",
  iron: "RESOURCE_BOOST_IRON",
  stone: "RESOURCE_BOOST_STONE",
};

export const BOOSTABLE_RESOURCES: StorableResource[] = ["gold", "wood", "iron", "stone"];

/* ------------------------------ shop discount ------------------------------ */

export const SHOP_DISCOUNT_PCT = 20;
export const SHOP_DISCOUNT_DURATION_HOURS = 24;
export const SHOP_DISCOUNT_DURATION_MS = SHOP_DISCOUNT_DURATION_HOURS * 3_600_000;
export const SHOP_DISCOUNT_COST = 300;

export interface ResourceCost {
  gold: number;
  wood: number;
  iron: number;
  stone: number;
}

/** Apply the shop discount % to a single amount, rounded up (matches purchase math). */
export function discountedAmount(amount: number, discountPct: number): number {
  if (discountPct <= 0) return amount;
  // Capped at a free item, never a paid one: above 100% the multiplier goes
  // negative and the "cost" becomes a credit. No current write path can set a
  // magnitude that high, which is exactly why it is worth pinning now.
  return Math.ceil(amount * (1 - Math.min(100, discountPct) / 100));
}

/** Apply the shop discount % to a {gold,wood,iron,stone} cost, rounded up. */
export function applyShopDiscount(cost: ResourceCost, discountPct: number): ResourceCost {
  if (discountPct <= 0) return cost;
  const factor = 1 - discountPct / 100;
  return {
    gold: Math.ceil(cost.gold * factor),
    wood: Math.ceil(cost.wood * factor),
    iron: Math.ceil(cost.iron * factor),
    stone: Math.ceil(cost.stone * factor),
  };
}

/* ------------------------------ turn packages ------------------------------ */

export interface TurnPackage {
  turns: number;
  cost: number; // diamonds
  /** How long this package stays on cooldown after buying it. */
  cooldownHours: number;
  /** DiamondEffectKind holding this package's personal cooldown. */
  cooldownKind: DiamondEffectKind;
}

/**
 * Turn packages, cheapest → largest. Each package has its own independent
 * cooldown that grows with the size of the package, so the largest one can only
 * be bought once every 12 hours while small top-ups recharge quickly.
 *
 * **The 100-turn pack is priced below the ladder on purpose (2026-08-13).** It
 * is the first thing a new player can afford, and the competing Hebrew title
 * sells the same 100 turns for 25💎 on a *3-hour* cooldown; at the old 40💎 ours
 * was the one place in the whole catalogue where we asked more for less. 20💎
 * undercuts them outright, and our 1-hour recharge already beat theirs.
 *
 * That does invert the per-turn curve at the bottom — 0.20💎/turn here against
 * 0.25 on the 2,000 pack — and the inversion is the trade we want: the cheap
 * rate is only reachable by coming back 24 times a day, so a player buys it with
 * attention, while the big pack still wins on every session that is worth less
 * than 24 visits. Do not "fix" the monotonicity by raising this back up without
 * lowering the larger packs to match, or the entry price goes back over theirs.
 */
export const TURN_PACKAGES: TurnPackage[] = [
  { turns: 100, cost: 20, cooldownHours: 1, cooldownKind: "TURN_PACK_1" },
  { turns: 300, cost: 100, cooldownHours: 3, cooldownKind: "TURN_PACK_2" },
  { turns: 800, cost: 240, cooldownHours: 6, cooldownKind: "TURN_PACK_3" },
  { turns: 2000, cost: 500, cooldownHours: 12, cooldownKind: "TURN_PACK_4" },
];

export const TURN_PACKAGE_KINDS: DiamondEffectKind[] = TURN_PACKAGES.map(
  (p) => p.cooldownKind
);

/* ------------------------------ hero points reset ------------------------------ */

/** Diamonds to refund all allocated hero points to "unspent" (once/season). */
export const HERO_POINTS_RESET_COST = 2000;

/* ------------------------------ hero revival ------------------------------ */

/**
 * Diamonds to raise a fallen hero back to full health on the spot, instead of
 * waiting out the hour (HERO_REVIVE_HOURS). Deliberately steep: the alternative
 * is free, it just costs patience.
 */
export const HERO_REVIVE_COST = 500;

/* ------------------------------ raid shields ------------------------------ */

/**
 * The two paid raid shields. Neither stops an attack from landing — the battle
 * still resolves, the hero still takes the blow and the attacker still earns XP
 * and loot rolls. What a shield protects is the *property*: the resource shield
 * zeroes the plunder, the soldier shield blocks enslavement. That split is
 * deliberate — a shield that made you unattackable would let a paying player
 * farm the city from behind a wall, which is exactly what the free new-player
 * protection (dropped the moment you attack) is careful not to allow.
 */
export type ShieldKey = "resources" | "soldiers";

export interface ShieldDuration {
  hours: number;
  cost: number; // diamonds
}

export interface ShieldMeta {
  key: ShieldKey;
  kind: DiamondEffectKind;
  label: string;
  /** Short line for the shop card. */
  desc: string;
  /** What the badge says wherever the shield is shown to other players. */
  badge: string;
  durations: ShieldDuration[];
}

export const SHIELDS: ShieldMeta[] = [
  {
    key: "resources",
    kind: "SHIELD_RESOURCES",
    label: "מגן משאבים",
    desc: "תוקף שמנצח אותך לא לוקח ולו משאב אחד — הזהב, העץ, הברזל והאבן שלך נשארים אצלך.",
    badge: "מגן משאבים פעיל — לא ניתן לבזוז ממנו משאבים",
    durations: [
      { hours: 24, cost: 360 },
      { hours: 48, cost: 600 },
    ],
  },
  {
    key: "soldiers",
    kind: "SHIELD_SOLDIERS",
    label: "מגן חיילים",
    desc: "תוקף שמנצח אותך לא משעבד אף חייל — הצבא שלך יוצא מהקרב בגודלו המלא.",
    badge: "מגן חיילים פעיל — לא ניתן לשעבד את חייליו",
    // Cut from 500/840 on 2026-08-13. The soldier shield used to be the pricier
    // of the two on the theory that an army is worth more than a warehouse, but
    // the competing title sells both of its shields at one flat 400/800 — which
    // left ours the only shield in either game charging above the other's. Now
    // it undercuts them at both durations, like the resource shield already did.
    durations: [
      { hours: 24, cost: 350 },
      { hours: 48, cost: 580 },
    ],
  },
];

export const SHIELD_KINDS: DiamondEffectKind[] = SHIELDS.map((s) => s.kind);

export function shieldMeta(key: ShieldKey): ShieldMeta {
  return SHIELDS.find((s) => s.key === key)!;
}

/**
 * A shield must run out before it can be bought again — no renewing, and no
 * extending, while one is up. On top of that, the shield stays unavailable for
 * these ten minutes after it expires.
 *
 * That gap is the whole point: back-to-back shields would make a paying player
 * permanently unraidable, so every shield is followed by a guaranteed window in
 * which the city can hit back. The cooldown lives in the effect row's `readyAt`,
 * set to `activeUntil + this` at purchase.
 */
export const SHIELD_RENEW_COOLDOWN_MINUTES = 10;
export const SHIELD_RENEW_COOLDOWN_MS = SHIELD_RENEW_COOLDOWN_MINUTES * 60_000;

/* ------------------------------ bank interest spell ------------------------------ */

export const BANK_INTEREST_SPELL_COST = 700;
export const BANK_INTEREST_COOLDOWN_HOURS = 24;
export const BANK_INTEREST_COOLDOWN_MS = BANK_INTEREST_COOLDOWN_HOURS * 3_600_000;

/* ------------------------------ city downgrade spell ------------------------------ */

/**
 * The one spell in the shop that takes something away: it gives up **exactly
 * one** city tier (`Empire.cities` − 1), never more, and it is refused outright
 * below {@link CITY_DOWNGRADE_MIN_CITIES} — the first city is the empire itself
 * and cannot be surrendered.
 *
 * Nothing is refunded. A city is bought with resources (`cityCost`) and gated on
 * hero level, so a refund would turn the pair of spells into a resource pump;
 * what the player buys here is the *tier*, with everything that hangs off it —
 * mine multiplier, population ceiling and the bracket he is matched in — and the
 * way back up is the ordinary price of founding the city again.
 */
export const CITY_DOWNGRADE_COST = 400;

/** Below this city count the spell is refused: you cannot give up your last city. */
export const CITY_DOWNGRADE_MIN_CITIES = 2;

/** One cast per hour, so a tier cannot be shed in a burst of parallel clicks. */
export const CITY_DOWNGRADE_COOLDOWN_HOURS = 1;
export const CITY_DOWNGRADE_COOLDOWN_MS = CITY_DOWNGRADE_COOLDOWN_HOURS * 3_600_000;
