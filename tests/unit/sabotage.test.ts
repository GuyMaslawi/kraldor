import { describe, expect, it } from "vitest";
import {
  BURNABLE,
  SABOTAGE_BY_KIND,
  SABOTAGE_INTEL_MARGIN,
  SABOTAGE_MISSIONS,
  isSabotageKind,
  sabotageAmount,
  sabotageSucceeds,
} from "@/lib/game/sabotage";

describe("the sabotage catalog", () => {
  it("has one entry per kind", () => {
    const kinds = SABOTAGE_MISSIONS.map((m) => m.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(SABOTAGE_BY_KIND.size).toBe(SABOTAGE_MISSIONS.length);
  });

  it("keeps every mission economic — never soldiers, weapons or power", () => {
    // The rule the whole feature rests on. Missions are identified by kind, and
    // the three that exist take stores, gold and mine slaves; a fourth that
    // touched an army would have to be added here deliberately.
    expect(SABOTAGE_MISSIONS.map((m) => m.kind).sort()).toEqual([
      "BURN_STORES",
      "SPIKE_WELLS",
      "STEAL_PLANS",
    ]);
  });

  it("takes a modest share, so espionage never out-raids raiding", () => {
    for (const mission of SABOTAGE_MISSIONS) {
      expect(mission.share).toBeGreaterThan(0);
      expect(mission.share).toBeLessThanOrEqual(0.15);
    }
  });

  it("charges real spies and real turns", () => {
    for (const mission of SABOTAGE_MISSIONS) {
      expect(mission.spies).toBeGreaterThan(1);
      expect(mission.turns).toBeGreaterThan(0);
    }
  });

  it("names a shield each mission honours", () => {
    // A player who bought protection has bought it against every way of losing
    // the thing protected, or the purchase is a lie.
    for (const mission of SABOTAGE_MISSIONS) {
      expect(["resources", "soldiers"]).toContain(mission.shield);
    }
    expect(SABOTAGE_BY_KIND.get("SPIKE_WELLS")!.shield).toBe("soldiers");
    expect(SABOTAGE_BY_KIND.get("BURN_STORES")!.shield).toBe("resources");
  });

  it("prices the harshest mission highest", () => {
    const burn = SABOTAGE_BY_KIND.get("BURN_STORES")!;
    const wells = SABOTAGE_BY_KIND.get("SPIKE_WELLS")!;
    expect(wells.spies).toBeGreaterThan(burn.spies);
    expect(wells.turns).toBeGreaterThan(burn.turns);
  });

  it("never burns gold — that is the other mission's job", () => {
    // Two missions that both hit gold would be one mission with two names.
    // Burning takes protected stores; stealing takes the available balance.
    expect(BURNABLE).not.toContain("gold");
    expect([...BURNABLE].sort()).toEqual(["iron", "stone", "wood"]);
  });
});

describe("sabotageSucceeds", () => {
  it("needs a clear margin, not a bare win", () => {
    // A plain scouting mission succeeds on strictly-greater. Destroying
    // property on a hair's-breadth advantage would make every marginal spy lead
    // a licence to strip a rival.
    expect(sabotageSucceeds(101, 100)).toBe(false);
    expect(sabotageSucceeds(100 * SABOTAGE_INTEL_MARGIN + 1, 100)).toBe(true);
  });

  it("fails on an exact margin — the bar is strictly above it", () => {
    expect(sabotageSucceeds(100 * SABOTAGE_INTEL_MARGIN, 100)).toBe(false);
  });

  it("fails a weaker attacker", () => {
    expect(sabotageSucceeds(50, 100)).toBe(false);
  });

  it("lets any intelligence through against a target with none", () => {
    expect(sabotageSucceeds(1, 0)).toBe(true);
    // …and nothing through when the attacker has none either.
    expect(sabotageSucceeds(0, 0)).toBe(false);
  });

  it("asks for a genuinely meaningful margin", () => {
    expect(SABOTAGE_INTEL_MARGIN).toBeGreaterThan(1.1);
    expect(SABOTAGE_INTEL_MARGIN).toBeLessThan(2);
  });
});

describe("sabotageAmount", () => {
  it("takes the share, floored", () => {
    expect(sabotageAmount(1_000, 0.12)).toBe(120);
    expect(sabotageAmount(9, 0.12)).toBe(1);
  });

  it("rounds in the defender's favour", () => {
    // This is somebody else's property; a share of 12% on 9 units takes one,
    // not two.
    expect(sabotageAmount(9, 0.12)).toBeLessThan(9 * 0.12 + 1);
    expect(sabotageAmount(1, 0.5)).toBe(0);
  });

  it("never takes more than is there", () => {
    expect(sabotageAmount(10, 5)).toBe(10);
    expect(sabotageAmount(0, 0.5)).toBe(0);
    expect(sabotageAmount(-100, 0.5)).toBe(0);
  });

  it("returns whole units", () => {
    for (const held of [7.4, 999.99, 1_234.5]) {
      expect(Number.isInteger(sabotageAmount(held, 0.12))).toBe(true);
    }
  });
});

describe("isSabotageKind", () => {
  it("accepts every real mission", () => {
    for (const mission of SABOTAGE_MISSIONS) {
      expect(isSabotageKind(mission.kind)).toBe(true);
    }
  });

  it("rejects anything else a form could post", () => {
    expect(isSabotageKind("BURN_EVERYTHING")).toBe(false);
    expect(isSabotageKind("")).toBe(false);
    expect(isSabotageKind(null)).toBe(false);
    expect(isSabotageKind(3)).toBe(false);
    expect(isSabotageKind({ kind: "BURN_STORES" })).toBe(false);
  });
});
