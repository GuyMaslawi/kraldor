import { describe, expect, it } from "vitest";
import {
  battlePowerLedger,
  type BattlePowerSources,
} from "@/lib/game/battleLedger";
import { bonusMultiplier } from "@/lib/game/hero";

/**
 * The ledger's whole job is to be *the same arithmetic* as `attackEmpire`,
 * decomposed. So the tests do not assert hand-written numbers: they recompute
 * each side with the battle formula itself and demand the ledger's terms sum to
 * it. A change to the battle maths that the report is not taught about fails
 * here rather than shipping a report whose column does not add up.
 */

/**
 * The attacker's half of the formula in server/actions/game.ts. `gear` is the
 * hero's flat item power, which sits *inside* the parenthesis beside soldiers
 * and weapons — every multiplier scales it.
 */
function attackerPower(
  soldiers: number,
  weapons: number,
  heroPct: number,
  guildPct: number,
  aid: number,
  gear = 0
) {
  return (
    (soldiers + weapons + gear) *
      bonusMultiplier(heroPct) *
      bonusMultiplier(guildPct) +
    aid
  );
}

/** The defender's half — identical but for the flat defence multiplier. */
function defenderPower(
  soldiers: number,
  weapons: number,
  defenseBonus: number,
  heroPct: number,
  guildPct: number,
  aid: number,
  gear = 0
) {
  return (
    (soldiers + weapons + gear) *
      defenseBonus *
      bonusMultiplier(heroPct) *
      bonusMultiplier(guildPct) +
    aid
  );
}

/** Everything except the subtotal, which is a running total rather than a term. */
const sumTerms = (side: BattlePowerSources) =>
  battlePowerLedger(side)
    .filter((r) => r.kind !== "subtotal")
    .reduce((n, r) => n + r.value, 0);

const kinds = (side: BattlePowerSources) =>
  battlePowerLedger(side).map((r) => r.kind);

describe("the battle power ledger", () => {
  it("reproduces the attacker's total from its terms", () => {
    const total = attackerPower(5_000, 1_200, 18, 7, 940);
    const rows = battlePowerLedger({
      soldiers: 5_000,
      weapons: 1_200,
      heroPower: 0,
      heroBonusPct: 18,
      guildBonusPct: 7,
      guildAidPct: 4,
      guildAidPower: 940,
      defenseBonusPct: null,
      total,
    });

    const summed = rows
      .filter((r) => r.kind !== "subtotal")
      .reduce((n, r) => n + r.value, 0);
    expect(summed).toBeCloseTo(total, 6);
    // No residual row means every term was accounted for.
    expect(rows.some((r) => r.kind === "residual")).toBe(false);
  });

  it("reproduces the defender's total, including the flat defence bonus", () => {
    // The term the report never used to mention at all.
    const total = defenderPower(5_000, 1_200, 1.2, 18, 7, 940);
    const side: BattlePowerSources = {
      soldiers: 5_000,
      weapons: 1_200,
      heroPower: 0,
      heroBonusPct: 18,
      guildBonusPct: 7,
      guildAidPct: 4,
      guildAidPower: 940,
      defenseBonusPct: 20,
      total,
    };

    expect(sumTerms(side)).toBeCloseTo(total, 6);
    expect(kinds(side)).toEqual([
      "soldiers",
      "weapons",
      "subtotal",
      "defense",
      "hero",
      "guildSpell",
      "guildAid",
    ]);
  });

  it("applies the multipliers in the order the battle applies them", () => {
    // Compounding is the reason order matters: the hero bonus is a percentage
    // of a subtotal that already includes the defence bonus, so listing the two
    // in the wrong order changes both numbers even though the total survives.
    const rows = battlePowerLedger({
      soldiers: 1_000,
      weapons: 0,
      heroPower: 0,
      heroBonusPct: 50,
      guildBonusPct: null,
      guildAidPct: null,
      guildAidPower: null,
      defenseBonusPct: 20,
      total: defenderPower(1_000, 0, 1.2, 50, 0, 0),
    });

    expect(rows.find((r) => r.kind === "defense")!.value).toBeCloseTo(200, 6);
    // 50% of 1200, not of 1000.
    expect(rows.find((r) => r.kind === "hero")!.value).toBeCloseTo(600, 6);
  });

  it("keeps a fractional defence tunable exact", () => {
    // defenseBonusPct is stored unrounded for exactly this case; the display
    // rounds it, the arithmetic must not.
    const total = defenderPower(3_000, 500, 1.234, 0, 0, 0);
    const side: BattlePowerSources = {
      soldiers: 3_000,
      weapons: 500,
      heroPower: 0,
      heroBonusPct: null,
      guildBonusPct: null,
      guildAidPct: null,
      guildAidPower: null,
      defenseBonusPct: 23.4,
      total,
    };

    expect(sumTerms(side)).toBeCloseTo(total, 6);
    expect(side.total - sumTerms(side)).toBeLessThan(1);
  });

  it("omits terms that contributed nothing", () => {
    // A guildless hero-less empire should not read a column of zeroes.
    const total = attackerPower(800, 0, 0, 0, 0);
    expect(
      kinds({
        soldiers: 800,
        weapons: 0,
        heroPower: 0,
        heroBonusPct: 0,
        guildBonusPct: 0,
        guildAidPct: 0,
        guildAidPower: 0,
        defenseBonusPct: null,
        total,
      })
    ).toEqual(["soldiers", "weapons", "subtotal"]);
  });

  it("names the gap on a report written before the columns existed", () => {
    // Legacy rows carry the total but not the defence bonus or the aid, so the
    // terms cannot reach it. Better to say so than to print a column that is
    // quietly short.
    const total = defenderPower(5_000, 1_200, 1.2, 18, 0, 0);
    const rows = battlePowerLedger({
      soldiers: 5_000,
      weapons: 1_200,
      heroPower: 0,
      heroBonusPct: 18,
      guildBonusPct: null,
      guildAidPct: null,
      guildAidPower: null,
      defenseBonusPct: null, // never recorded
      total,
    });

    const residual = rows.find((r) => r.kind === "residual");
    expect(residual).toBeDefined();
    expect(
      rows.filter((r) => r.kind !== "subtotal").reduce((n, r) => n + r.value, 0)
    ).toBeCloseTo(total, 6);
  });

  it("counts gear power inside the base, so the multipliers scale it", () => {
    // The whole reason the term lives above the subtotal. 1,000 soldiers plus
    // 500 gear power, at +50%, is 2,250 — not 1,500 + 500.
    const total = defenderPower(1_000, 0, 1, 50, 0, 0, 500);
    const rows = battlePowerLedger({
      soldiers: 1_000,
      weapons: 0,
      heroPower: 500,
      heroBonusPct: 50,
      guildBonusPct: null,
      guildAidPct: null,
      guildAidPower: null,
      defenseBonusPct: 0,
      total,
    });

    expect(rows.find((r) => r.kind === "subtotal")!.value).toBeCloseTo(1_500, 6);
    // 50% of 1,500, which is only true if the gear joined the base.
    expect(rows.find((r) => r.kind === "hero")!.value).toBeCloseTo(750, 6);
    expect(
      rows.filter((r) => r.kind !== "subtotal").reduce((n, r) => n + r.value, 0)
    ).toBeCloseTo(total, 6);
    expect(rows.some((r) => r.kind === "residual")).toBe(false);
  });

  it("omits the gear row for a hero wearing nothing, and for an old report", () => {
    const bare = {
      soldiers: 800,
      weapons: 0,
      heroBonusPct: 0,
      guildBonusPct: 0,
      guildAidPct: 0,
      guildAidPower: 0,
      defenseBonusPct: null,
      total: attackerPower(800, 0, 0, 0, 0),
    };
    // Nothing equipped, and a report written before the column existed: both
    // read as "no gear line", and neither invents a residual.
    expect(kinds({ ...bare, heroPower: 0 })).not.toContain("heroPower");
    expect(kinds({ ...bare, heroPower: null })).not.toContain("heroPower");
    expect(kinds({ ...bare, heroPower: null })).not.toContain("residual");
  });

  it("does not invent a residual row for floating-point noise", () => {
    const total = attackerPower(5_000, 1_200, 18, 7, 940) + 0.4;
    expect(
      kinds({
        soldiers: 5_000,
        weapons: 1_200,
        heroPower: 0,
        heroBonusPct: 18,
        guildBonusPct: 7,
        guildAidPct: 4,
        guildAidPower: 940,
        defenseBonusPct: null,
        total,
      })
    ).not.toContain("residual");
  });
});
