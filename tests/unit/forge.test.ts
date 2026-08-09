import { describe, expect, it } from "vitest";
import {
  COMMISSION_DROPS,
  COMMISSION_SHARDS,
  SHARDS_BY_RARITY,
  SHARDS_PER_DROP,
  TEMPER_SHARDS,
  commissionGoldCost,
  heroDecade,
  isHeroSlot,
  rollCommission,
  shardsForItem,
  temperShardCost,
} from "@/lib/game/forge";
import {
  HERO_MAX_LEVEL,
  ITEM_DROP_CHANCE,
  ITEM_DROP_CHANCE_BY_RARITY,
  RARITY_ORDER,
  SLOT_ORDER,
  UPGRADE_LEVELS,
  atSetCeiling,
  itemUpgradeCost,
  nextTierLevel,
  tierForLevel,
} from "@/lib/game/hero";

/** A deterministic stand-in for the CSPRNG, cycling a fixed sequence. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("shard values", () => {
  it("rises with rarity", () => {
    let previous = 0;
    for (const rarity of RARITY_ORDER) {
      expect(SHARDS_BY_RARITY[rarity]).toBeGreaterThan(previous);
      previous = SHARDS_BY_RARITY[rarity];
    }
  });

  it("is flat in the decade — a פשוט is one shard wherever it came from", () => {
    // The arbitrage the forge is built to avoid: if a low decade's yield and a
    // high decade's price shared a currency with different scales, farming the
    // cheap end would buy the expensive one. Assert the invariant directly.
    for (let decade = 0; decade < HERO_MAX_LEVEL / 10; decade += 1) {
      expect(shardsForItem(decade * 10 + 1)).toBe(SHARDS_BY_RARITY.COMMON);
      expect(shardsForItem(decade * 10 + 10)).toBe(SHARDS_BY_RARITY.LEGENDARY);
    }
  });

  it("agrees with the tier the level actually belongs to", () => {
    for (const level of UPGRADE_LEVELS) {
      expect(shardsForItem(level)).toBe(SHARDS_BY_RARITY[tierForLevel(level)]);
    }
  });
});

describe("the exchange rate", () => {
  it("derives the per-drop average from the live drop table", () => {
    const expected = RARITY_ORDER.reduce(
      (sum, r) =>
        sum +
        (ITEM_DROP_CHANCE_BY_RARITY[r] / ITEM_DROP_CHANCE) * SHARDS_BY_RARITY[r],
      0
    );
    expect(SHARDS_PER_DROP).toBeCloseTo(expected, 10);
  });

  it("prices a commission at several drops, never at one", () => {
    // One-for-one would make the drop table pointless; this is the line that
    // keeps the forge a conversion rather than a shortcut.
    expect(COMMISSION_DROPS).toBeGreaterThanOrEqual(3);
    expect(COMMISSION_SHARDS).toBeGreaterThan(SHARDS_PER_DROP * 2);
    expect(COMMISSION_SHARDS).toBe(Math.round(SHARDS_PER_DROP * COMMISSION_DROPS));
  });

  it("cannot be milked: a commission costs more than its result melts for", () => {
    // The forge must not be a loop. The most a commission can ever yield back
    // is a LEGENDARY, and even that is only worth a fraction of what several
    // are — but the *expected* yield is what matters, and it must be well under
    // the price or a patient player prints shards.
    expect(SHARDS_PER_DROP).toBeLessThan(COMMISSION_SHARDS);
    expect(SHARDS_PER_DROP * 2).toBeLessThan(COMMISSION_SHARDS);
  });
});

describe("commissionGoldCost", () => {
  it("borrows the gear economy's own curve", () => {
    for (let level = 1; level <= HERO_MAX_LEVEL; level += 7) {
      const decadeFloor = heroDecade(level) * 10 + 1;
      expect(commissionGoldCost(level)).toBe(itemUpgradeCost(decadeFloor));
    }
  });

  it("climbs with the hero and never falls", () => {
    let previous = 0;
    for (let level = 1; level <= HERO_MAX_LEVEL; level += 1) {
      const cost = commissionGoldCost(level);
      expect(cost).toBeGreaterThanOrEqual(previous);
      previous = cost;
    }
    expect(commissionGoldCost(HERO_MAX_LEVEL)).toBeGreaterThan(
      commissionGoldCost(1) * 100
    );
  });

  it("stays cheaper than finishing a piece you already hold", () => {
    // Aiming a drop should cost less than perfecting one — the decade's floor
    // rather than its ceiling. Compared against the top rung of the same decade.
    for (let decade = 0; decade < HERO_MAX_LEVEL / 10; decade += 1) {
      const level = decade * 10 + 5;
      const topRungCost = itemUpgradeCost(decade * 10 + 8);
      expect(commissionGoldCost(level)).toBeLessThan(topRungCost!);
    }
  });
});

describe("heroDecade", () => {
  it("maps a level onto the decade its gear sits in", () => {
    expect(heroDecade(1)).toBe(0);
    expect(heroDecade(10)).toBe(0);
    expect(heroDecade(11)).toBe(1);
    expect(heroDecade(100)).toBe(9);
  });

  it("clamps junk rather than producing a negative or runaway decade", () => {
    expect(heroDecade(0)).toBe(0);
    expect(heroDecade(-5)).toBe(0);
    expect(heroDecade(10_000)).toBe(9);
  });
});

describe("rollCommission", () => {
  it("always returns the slot that was paid for", () => {
    for (const slot of SLOT_ORDER) {
      const rolled = rollCommission(45, slot, seeded([0.9, 0.5, 0.5]));
      expect(rolled.slot).toBe(slot);
    }
  });

  it("agrees with itself: the rolled rarity is the level's own tier", () => {
    // Drops land exactly on a band-start level, which is what makes the rolled
    // rarity and tierForLevel agree by construction. A commission must keep
    // that property or an item's icon and its stats would disagree.
    for (let i = 0; i < 200; i += 1) {
      const rolled = rollCommission(50, "SWORD", seeded([i / 200, 0.5, 0.5]));
      expect(tierForLevel(rolled.level)).toBe(rolled.rarity);
    }
  });

  it("keeps the drop table's relative odds — a legendary stays rare", () => {
    let legendary = 0;
    const samples = 20_000;
    for (let i = 0; i < samples; i += 1) {
      // A uniform sweep across the renormalised rarity walk.
      const roll = (i + 0.5) / samples;
      const rolled = rollCommission(50, "SWORD", seeded([roll, 0.5, 0.5]));
      if (rolled.rarity === "LEGENDARY") legendary += 1;
    }
    const share = legendary / samples;
    const expected = ITEM_DROP_CHANCE_BY_RARITY.LEGENDARY / ITEM_DROP_CHANCE;
    expect(share).toBeCloseTo(expected, 2);
  });

  it("never produces gear past the game's ceiling", () => {
    for (let i = 0; i < 300; i += 1) {
      const rolled = rollCommission(HERO_MAX_LEVEL, "RELIC", seeded([
        i / 300,
        (i * 7) % 100 / 100,
        0.99,
      ]));
      expect(rolled.level).toBeGreaterThanOrEqual(1);
      expect(rolled.level).toBeLessThanOrEqual(HERO_MAX_LEVEL);
    }
  });

  it("stays near the hero's own decade, as a natural drop does", () => {
    // One decade either side is the drop table's own jitter; the forge must not
    // widen it, or a commission would be a way to reach gear a raid could not.
    for (let i = 0; i < 300; i += 1) {
      const rolled = rollCommission(55, "BOOTS", seeded([i / 300, i / 300, 0.5]));
      const decade = Math.floor((rolled.level - 1) / 10);
      expect(Math.abs(decade - heroDecade(55))).toBeLessThanOrEqual(1);
    }
  });
});

describe("temperShardCost", () => {
  it("prices every band that has somewhere to climb", () => {
    for (const level of UPGRADE_LEVELS) {
      const cost = temperShardCost(level);
      if (nextTierLevel(level) === null) {
        expect(cost).toBeNull();
      } else {
        expect(cost).toBe(TEMPER_SHARDS[tierForLevel(level) as keyof typeof TEMPER_SHARDS]);
      }
    }
  });

  it("stops dead at an אגדי — a set's ceiling is a ceiling here too", () => {
    for (let decade = 0; decade < HERO_MAX_LEVEL / 10; decade += 1) {
      const legendary = decade * 10 + 10;
      expect(tierForLevel(legendary)).toBe("LEGENDARY");
      expect(temperShardCost(legendary)).toBeNull();
      // And the game agrees for the right reason: the set is finished, not the
      // ladder (except at the very top, where both are).
      if (legendary < HERO_MAX_LEVEL) expect(atSetCeiling(legendary)).toBe(true);
    }
  });

  it("rises with the band being left", () => {
    expect(TEMPER_SHARDS.COMMON).toBeLessThan(TEMPER_SHARDS.RARE);
    expect(TEMPER_SHARDS.RARE).toBeLessThan(TEMPER_SHARDS.EPIC);
  });

  it("costs more to walk a piece up than to commission a fresh one", () => {
    // The gold upgrade already sells this rung; tempering must not undercut it
    // at every step or the gold path stops existing.
    const fullWalk =
      TEMPER_SHARDS.COMMON + TEMPER_SHARDS.RARE + TEMPER_SHARDS.EPIC;
    expect(fullWalk).toBeGreaterThan(COMMISSION_SHARDS * COMMISSION_DROPS);
  });
});

describe("isHeroSlot", () => {
  it("accepts every real slot", () => {
    for (const slot of SLOT_ORDER) expect(isHeroSlot(slot)).toBe(true);
  });

  it("rejects anything else, including junk from a form", () => {
    expect(isHeroSlot("SWORD; DROP TABLE")).toBe(false);
    expect(isHeroSlot("")).toBe(false);
    expect(isHeroSlot(null)).toBe(false);
    expect(isHeroSlot(7)).toBe(false);
    expect(isHeroSlot({ slot: "SWORD" })).toBe(false);
  });
});
