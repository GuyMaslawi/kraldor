import { describe, expect, it } from "vitest";
import { DEFAULT_TUNABLES, mergeTunables } from "@/lib/game/config";

/**
 * The tunables are the one place where a value typed into the admin console
 * flows straight into combat and economy maths. They are bounded for a reason
 * that is worth restating: a *negative* attack turn cost passed the
 * affordability check and then the decrement *added* turns — an infinite turn
 * faucet reachable from a text box. Everything here guards that clamp.
 */

describe("mergeTunables", () => {
  it("returns the defaults for junk input", () => {
    for (const junk of [null, undefined, 0, "", "nope", [], true]) {
      expect(mergeTunables(junk)).toEqual(DEFAULT_TUNABLES);
    }
  });

  it("keeps a value that is inside its bounds", () => {
    const merged = mergeTunables({ heroQuest: { rewardMultiplier: 2 } });
    expect(merged.heroQuest.rewardMultiplier).toBe(2);
  });

  it("clamps a value above its ceiling instead of trusting it", () => {
    const merged = mergeTunables({ heroQuest: { rewardMultiplier: 1e9 } });
    expect(merged.heroQuest.rewardMultiplier).toBeLessThanOrEqual(1e3);
  });

  it("clamps a negative value to its floor", () => {
    const merged = mergeTunables({ heroQuest: { rewardMultiplier: -50 } });
    expect(merged.heroQuest.rewardMultiplier).toBeGreaterThanOrEqual(0);
  });

  it("never lets a turn cost reach zero or below", () => {
    // The exact CVE-shaped bug: cost <= 0 made every action free, and a negative
    // one paid the attacker turns for attacking.
    for (const bad of [0, -1, -1000]) {
      const merged = mergeTunables({ battle: { attackTurnCost: bad, spyTurnCost: bad } });
      expect(merged.battle.attackTurnCost).toBeGreaterThanOrEqual(1);
      expect(merged.battle.spyTurnCost).toBeGreaterThanOrEqual(1);
    }
  });

  it("ignores non-numeric values rather than producing NaN", () => {
    const merged = mergeTunables({
      heroQuest: { rewardMultiplier: "lots" },
      battle: { attackTurnCost: null },
    });
    expect(Number.isFinite(merged.heroQuest.rewardMultiplier)).toBe(true);
    expect(Number.isFinite(merged.battle.attackTurnCost)).toBe(true);
  });

  it("rejects NaN and Infinity", () => {
    const merged = mergeTunables({
      heroQuest: { rewardMultiplier: Number.NaN },
      boss: { powerMultiplier: Infinity },
    });
    expect(Number.isFinite(merged.heroQuest.rewardMultiplier)).toBe(true);
    expect(Number.isFinite(merged.boss.powerMultiplier)).toBe(true);
  });

  it("ignores unknown groups and unknown fields", () => {
    const merged = mergeTunables({
      nonsense: { whatever: 1 },
      heroQuest: { notAField: 99 },
    });
    expect(merged).toHaveProperty("heroQuest");
    expect((merged.heroQuest as Record<string, unknown>).notAField).toBeUndefined();
  });

  it("leaves every other group at its default when one is overridden", () => {
    const merged = mergeTunables({ heroQuest: { rewardMultiplier: 3 } });
    expect(merged.battle).toEqual(DEFAULT_TUNABLES.battle);
    expect(merged.starting).toEqual(DEFAULT_TUNABLES.starting);
  });

  it("keeps the hero-quest kill switch a clean 0 or 1", () => {
    expect(mergeTunables({ heroQuest: { enabled: 5 } }).heroQuest.enabled).toBeLessThanOrEqual(1);
    expect(mergeTunables({ heroQuest: { enabled: -1 } }).heroQuest.enabled).toBeGreaterThanOrEqual(0);
  });

  it("never lets a world-boss strike become free, or pay turns to strike", () => {
    // Same shape as the attack-turn-cost bug above: the debit is a guarded
    // `gte` decrement, so a cost of -40 passes the affordability check and then
    // *credits* 40 turns — an infinite turn faucet reachable from a text box.
    for (const bad of [0, -1, -40]) {
      expect(mergeTunables({ worldBoss: { strikeTurns: bad } }).worldBoss.strikeTurns)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it("leaves at least one strike a week and a pool that is not empty", () => {
    expect(mergeTunables({ worldBoss: { maxStrikes: 0 } }).worldBoss.maxStrikes)
      .toBeGreaterThanOrEqual(1);
    expect(mergeTunables({ worldBoss: { hpMultiplier: 0 } }).worldBoss.hpMultiplier)
      .toBeGreaterThan(0);
    expect(
      mergeTunables({ worldBoss: { damageMultiplier: 0 } }).worldBoss.damageMultiplier
    ).toBeGreaterThan(0);
  });

  it("allows an instant boss revive but not a negative one", () => {
    expect(mergeTunables({ boss: { reviveMinutes: 0 } }).boss.reviveMinutes).toBe(0);
    expect(
      mergeTunables({ boss: { reviveMinutes: -30 } }).boss.reviveMinutes
    ).toBeGreaterThanOrEqual(0);
  });

  it("lets the captive and XP dials close entirely — zero is a real answer", () => {
    const merged = mergeTunables({
      boss: { slaveMultiplier: 0, heroXpMultiplier: 0 },
      worldBoss: { rewardMultiplier: 0, killDiamonds: 0 },
    });
    expect(merged.boss.slaveMultiplier).toBe(0);
    expect(merged.boss.heroXpMultiplier).toBe(0);
    expect(merged.worldBoss.rewardMultiplier).toBe(0);
    expect(merged.worldBoss.killDiamonds).toBe(0);
  });

  it("bounds the store discount to a real percentage", () => {
    expect(
      mergeTunables({ diamondStore: { purchaseDiscountPct: 900 } }).diamondStore
        .purchaseDiscountPct
    ).toBeLessThanOrEqual(100);
    expect(
      mergeTunables({ diamondStore: { purchaseDiscountPct: -900 } }).diamondStore
        .purchaseDiscountPct
    ).toBeGreaterThanOrEqual(0);
  });
});
