import { describe, expect, it } from "vitest";
import {
  MONUMENTS,
  MONUMENT_BY_KEY,
  MONUMENT_COST_GROWTH,
  MONUMENT_COST_LEVEL_1,
  MONUMENT_COST_LEVEL_MAX,
  MONUMENT_MAX_LEVEL,
  MONUMENT_PCT_PER_LEVEL,
  buildMonumentsState,
  monumentBonuses,
  monumentCost,
  monumentMultiplier,
  monumentPct,
  monumentTotalCost,
  zeroMonumentBonuses,
} from "@/lib/game/monuments";
import { UPGRADE_COST_AT_LEVEL_100 } from "@/lib/game/hero";

describe("the monument catalog", () => {
  it("has unique keys", () => {
    const keys = MONUMENTS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every effect exactly one monument", () => {
    const effects = MONUMENTS.map((m) => m.effect);
    expect(new Set(effects).size).toBe(effects.length);
  });

  it("names a percentage in every effect line", () => {
    // The label is rendered as t(effectLabel, { pct }); one that forgot the
    // placeholder would print a sentence with no number in it.
    for (const monument of MONUMENTS) {
      expect(monument.effectLabel).toContain("{pct}");
    }
  });

  it("touches no combat figure", () => {
    // The rule the whole feature rests on. The battle report itemises every
    // term of the power calculation, so a combat modifier here would need a
    // snapshot column and a ledger row — see the header of monuments.ts.
    const combat = ["attack", "defense", "spy", "power", "military"];
    for (const monument of MONUMENTS) {
      expect(combat).not.toContain(monument.effect);
    }
    for (const key of Object.keys(zeroMonumentBonuses())) {
      expect(combat).not.toContain(key);
    }
  });
});

describe("monumentCost", () => {
  it("starts and ends on its anchors", () => {
    expect(monumentCost(0)).toBe(MONUMENT_COST_LEVEL_1);
    // Level 11 held is the price of the twelfth and last rung.
    const top = monumentCost(MONUMENT_MAX_LEVEL - 1)!;
    expect(top / MONUMENT_COST_LEVEL_MAX).toBeGreaterThan(0.99);
    expect(top / MONUMENT_COST_LEVEL_MAX).toBeLessThan(1.01);
  });

  it("is null at full height", () => {
    expect(monumentCost(MONUMENT_MAX_LEVEL)).toBeNull();
    expect(monumentCost(MONUMENT_MAX_LEVEL + 5)).toBeNull();
  });

  it("rises strictly, rung by rung", () => {
    let previous = 0;
    for (let level = 0; level < MONUMENT_MAX_LEVEL; level += 1) {
      const cost = monumentCost(level)!;
      expect(cost).toBeGreaterThan(previous);
      previous = cost;
    }
  });

  it("outpaces what it pays back", () => {
    // The price is geometric (~×2 a level) and the payout is linear (+2 points
    // a level). That gap is the only thing stopping the ladder from paying for
    // itself faster than it costs, so it is asserted rather than assumed.
    expect(MONUMENT_COST_GROWTH).toBeGreaterThan(1.5);
    for (let level = 1; level < MONUMENT_MAX_LEVEL; level += 1) {
      const priceRatio = monumentCost(level)! / monumentCost(level - 1)!;
      const payoutRatio = monumentPct(level + 1) / monumentPct(level);
      expect(priceRatio).toBeGreaterThan(payoutRatio);
    }
  });

  it("rounds to something that reads as a price", () => {
    for (let level = 0; level < MONUMENT_MAX_LEVEL; level += 1) {
      const cost = monumentCost(level)!;
      const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(cost)) - 2);
      expect(cost % magnitude).toBe(0);
    }
  });

  it("keeps a full monument in the same league as the gear ladder's top rung", () => {
    // A monument should be a season-long project, not an unreachable one. The
    // most expensive single thing the game already sells is a level-100 item
    // upgrade; the whole five-monument skyline is a small multiple of it.
    const skyline = monumentTotalCost() * MONUMENTS.length;
    expect(skyline).toBeGreaterThan(UPGRADE_COST_AT_LEVEL_100);
    expect(skyline).toBeLessThan(UPGRADE_COST_AT_LEVEL_100 * 20);
  });
});

describe("monumentPct", () => {
  it("pays a flat step per level up to the ceiling", () => {
    expect(monumentPct(0)).toBe(0);
    expect(monumentPct(1)).toBe(MONUMENT_PCT_PER_LEVEL);
    expect(monumentPct(MONUMENT_MAX_LEVEL)).toBe(
      MONUMENT_MAX_LEVEL * MONUMENT_PCT_PER_LEVEL
    );
  });

  it("clamps junk rather than paying for it", () => {
    expect(monumentPct(-3)).toBe(0);
    expect(monumentPct(9_999)).toBe(MONUMENT_MAX_LEVEL * MONUMENT_PCT_PER_LEVEL);
    expect(monumentPct(Number.NaN)).toBe(0);
  });
});

describe("monumentBonuses", () => {
  it("is all zeroes for an empire that has built nothing", () => {
    expect(monumentBonuses([])).toEqual(zeroMonumentBonuses());
    expect(monumentBonuses(null)).toEqual(zeroMonumentBonuses());
    expect(monumentBonuses(undefined)).toEqual(zeroMonumentBonuses());
  });

  it("routes each monument to the figure it multiplies", () => {
    const mines = MONUMENTS.find((m) => m.effect === "mines")!;
    const bonuses = monumentBonuses([{ key: mines.key, level: 5 }]);
    expect(bonuses.mines).toBe(5 * MONUMENT_PCT_PER_LEVEL);
    expect(bonuses.turns).toBe(0);
  });

  it("ignores a key that has fallen out of the catalog", () => {
    // Retiring a monument must degrade to no bonus, not throw inside the game
    // clock — which every page load runs.
    const bonuses = monumentBonuses([
      { key: "a_monument_that_was_removed", level: 12 },
    ]);
    expect(bonuses).toEqual(zeroMonumentBonuses());
  });

  it("sums two rows that share an effect, should the catalog ever grow one", () => {
    const mines = MONUMENTS.find((m) => m.effect === "mines")!;
    expect(
      monumentBonuses([
        { key: mines.key, level: 3 },
        { key: mines.key, level: 4 },
      ]).mines
    ).toBe(7 * MONUMENT_PCT_PER_LEVEL);
  });
});

describe("monumentMultiplier", () => {
  it("is 1 at nothing built, and never below it", () => {
    expect(monumentMultiplier(0)).toBe(1);
    expect(monumentMultiplier(-50)).toBe(1);
  });

  it("caps at a multiplier the economy can absorb", () => {
    const full = monumentMultiplier(MONUMENT_MAX_LEVEL * MONUMENT_PCT_PER_LEVEL);
    expect(full).toBeCloseTo(1.24, 5);
    expect(full).toBeLessThan(1.5);
  });
});

describe("buildMonumentsState", () => {
  it("shows an unbuilt monument at level 0 with the founding price", () => {
    const state = buildMonumentsState(0, []);
    expect(state.monuments).toHaveLength(MONUMENTS.length);
    for (const monument of state.monuments) {
      expect(monument.level).toBe(0);
      expect(monument.pct).toBe(0);
      expect(monument.cost).toBe(MONUMENT_COST_LEVEL_1);
      expect(monument.affordable).toBe(false);
    }
    expect(state.built).toBe(0);
    expect(state.total).toBe(MONUMENTS.length * MONUMENT_MAX_LEVEL);
  });

  it("marks a rung affordable only when the gold is actually there", () => {
    const key = MONUMENTS[0].key;
    expect(
      buildMonumentsState(MONUMENT_COST_LEVEL_1, []).monuments[0].affordable
    ).toBe(true);
    expect(
      buildMonumentsState(MONUMENT_COST_LEVEL_1 - 1, []).monuments[0].affordable
    ).toBe(false);
    expect(MONUMENT_BY_KEY.has(key)).toBe(true);
  });

  it("closes a monument at full height", () => {
    const key = MONUMENTS[0].key;
    const state = buildMonumentsState(1e15, [{ key, level: MONUMENT_MAX_LEVEL }]);
    const built = state.monuments.find((m) => m.key === key)!;
    expect(built.cost).toBeNull();
    expect(built.affordable).toBe(false);
    expect(built.pct).toBe(built.nextPct);
  });

  it("clamps a level stored out of range rather than paying for it", () => {
    const key = MONUMENTS[0].key;
    const state = buildMonumentsState(0, [{ key, level: 9_999 }]);
    expect(state.monuments.find((m) => m.key === key)!.level).toBe(
      MONUMENT_MAX_LEVEL
    );
  });

  it("counts the skyline", () => {
    const state = buildMonumentsState(0, [
      { key: MONUMENTS[0].key, level: 3 },
      { key: MONUMENTS[1].key, level: 4 },
    ]);
    expect(state.built).toBe(7);
  });
});
