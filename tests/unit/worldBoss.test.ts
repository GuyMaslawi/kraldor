import { describe, expect, it } from "vitest";
import {
  WORLD_BOSSES,
  WORLD_BOSS_BY_KEY,
  WORLD_BOSS_FLOOR_SHARE,
  WORLD_BOSS_HP_MIN,
  WORLD_BOSS_HP_PER_EMPIRE,
  WORLD_BOSS_MAX_STRIKES,
  WORLD_BOSS_PURSE,
  WORLD_BOSS_STRIKE_TURNS,
  rollWorldBoss,
  strikeDamage,
  worldBossMaxHp,
  worldBossReward,
  worldBossShare,
} from "@/lib/game/worldBoss";
import { MAX_CITIES } from "@/lib/game/constants";

describe("the world boss catalog", () => {
  it("has unique keys", () => {
    const keys = WORLD_BOSSES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(WORLD_BOSS_BY_KEY.size).toBe(WORLD_BOSSES.length);
  });

  it("keeps every toughness inside a band the server can actually clear", () => {
    for (const boss of WORLD_BOSSES) {
      expect(boss.toughness).toBeGreaterThanOrEqual(0.5);
      expect(boss.toughness).toBeLessThanOrEqual(1.5);
    }
  });

  it("offers a real spread of difficulty", () => {
    const values = WORLD_BOSSES.map((b) => b.toughness);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.3);
  });
});

describe("rollWorldBoss", () => {
  it("is a pure function of the week", () => {
    expect(rollWorldBoss(2_900).key).toBe(rollWorldBoss(2_900).key);
  });

  it("moves between weeks and reaches every beast", () => {
    const seen = new Set(
      Array.from({ length: 400 }, (_, i) => rollWorldBoss(i).key)
    );
    expect(seen.size).toBe(WORLD_BOSSES.length);
  });
});

describe("worldBossMaxHp", () => {
  it("scales with the number of empires", () => {
    const boss = WORLD_BOSSES[0];
    expect(worldBossMaxHp(boss, 100)).toBeGreaterThan(worldBossMaxHp(boss, 20));
  });

  it("never falls below the floor, however quiet the server", () => {
    for (const boss of WORLD_BOSSES) {
      expect(worldBossMaxHp(boss, 0)).toBeGreaterThanOrEqual(WORLD_BOSS_HP_MIN);
      expect(worldBossMaxHp(boss, 1)).toBeGreaterThanOrEqual(WORLD_BOSS_HP_MIN);
      expect(worldBossMaxHp(boss, -5)).toBeGreaterThanOrEqual(WORLD_BOSS_HP_MIN);
    }
  });

  it("follows the beast's own toughness", () => {
    const [soft, hard] = [...WORLD_BOSSES].sort(
      (a, b) => a.toughness - b.toughness
    );
    expect(worldBossMaxHp(hard, 200)).toBeGreaterThan(worldBossMaxHp(soft, 200));
  });

  it("is beatable by a server that turns up, and not by one that does not", () => {
    // The calibration that makes the fixture a fixture. 200 empires, each
    // landing their full allowance at a middling power: the pool should be
    // within reach but not trivial.
    const boss = WORLD_BOSSES.find((b) => b.toughness === 1.0) ?? WORLD_BOSSES[0];
    const pool = worldBossMaxHp(boss, 200);
    const perEmpireWeek = strikeDamage(500_000) * WORLD_BOSS_MAX_STRIKES;

    // Everybody showing up clears it comfortably…
    expect(perEmpireWeek * 200).toBeGreaterThan(pool);
    // …and a tenth of the server showing up does not.
    expect(perEmpireWeek * 20).toBeLessThan(pool);
  });
});

describe("strikeDamage", () => {
  it("never returns nothing, even for an empire with no army", () => {
    // A brand-new empire has to be able to move the bar, or the page has no
    // reason to exist for them.
    expect(strikeDamage(0)).toBeGreaterThanOrEqual(1);
    expect(strikeDamage(-100)).toBeGreaterThanOrEqual(1);
  });

  it("rises with power", () => {
    expect(strikeDamage(1_000_000)).toBeGreaterThan(strikeDamage(10_000));
  });

  it("is sub-linear — a hundred times the army is not a hundred times the blow", () => {
    // The whole reason a small empire's contribution stays visible.
    const small = strikeDamage(10_000);
    const large = strikeDamage(1_000_000);
    expect(large / small).toBeGreaterThan(5);
    expect(large / small).toBeLessThan(20);
  });

  it("is a whole number of damage", () => {
    for (const power of [0, 1, 999, 12_345, 9_876_543]) {
      expect(Number.isInteger(strikeDamage(power))).toBe(true);
    }
  });
});

describe("worldBossShare", () => {
  it("pays the floor share evenly among everyone who struck", () => {
    // A player who did a vanishing amount of damage still takes their even cut.
    expect(worldBossShare(0, 10)).toBeCloseTo(WORLD_BOSS_FLOOR_SHARE / 10, 10);
  });

  it("pays a solo slayer the whole purse", () => {
    expect(worldBossShare(1, 1)).toBeCloseTo(1, 10);
  });

  it("sums to the whole purse across a server, never more", () => {
    // The invariant that stops the fixture minting rewards: however the damage
    // is distributed, the shares add up to one purse.
    const shares = [0.5, 0.2, 0.15, 0.1, 0.05];
    const total = shares.reduce(
      (sum, s) => sum + worldBossShare(s, shares.length),
      0
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it("still rewards carrying the fight", () => {
    expect(worldBossShare(0.6, 10)).toBeGreaterThan(worldBossShare(0.05, 10));
  });

  it("clamps a nonsense share rather than paying for it", () => {
    expect(worldBossShare(5, 4)).toBeCloseTo(worldBossShare(1, 4), 10);
    expect(worldBossShare(-1, 4)).toBeCloseTo(worldBossShare(0, 4), 10);
    expect(worldBossShare(0.5, 0)).toBeGreaterThan(0);
  });
});

describe("worldBossReward", () => {
  it("never pays nothing to somebody who turned up", () => {
    // The floor is only meaningful if it survives the rounding.
    const reward = worldBossReward(0, 500, 1);
    expect(reward.length).toBeGreaterThan(0);
    for (const line of reward) expect(line.amount).toBeGreaterThanOrEqual(1);
  });

  it("pays a bigger contributor more", () => {
    const total = (share: number) =>
      worldBossReward(share, 10, 3).reduce((sum, r) => sum + r.amount, 0);
    expect(total(0.7)).toBeGreaterThan(total(0.05));
  });

  it("rides the city curve like every other purse", () => {
    const total = (cities: number) =>
      worldBossReward(0.3, 10, cities).reduce((sum, r) => sum + r.amount, 0);
    expect(total(MAX_CITIES)).toBeGreaterThan(total(1));
  });

  it("pays no diamonds — the kill is the only diamond in the fixture", () => {
    // Shared spoils must not be a diamond faucet; the killing blow is a single,
    // unfarmable payout instead.
    for (const line of WORLD_BOSS_PURSE) expect(line.kind).not.toBe("diamonds");
    for (const line of worldBossReward(1, 1, MAX_CITIES)) {
      expect(line.kind).not.toBe("diamonds");
    }
  });
});

describe("the price of a strike", () => {
  it("costs a real amount of turns", () => {
    // Several ordinary attacks' worth — the fixture has to compete with raiding
    // for the player's attention rather than being free.
    expect(WORLD_BOSS_STRIKE_TURNS).toBeGreaterThanOrEqual(20);
  });

  it("caps a week's participation at a sane number of blows", () => {
    expect(WORLD_BOSS_MAX_STRIKES).toBeGreaterThan(5);
    expect(WORLD_BOSS_MAX_STRIKES).toBeLessThanOrEqual(50);
  });

  it("keeps a full week of strikes within a real turn budget", () => {
    // A player must not have to choose between the world boss and playing the
    // rest of the game: 800 turns is a couple of days' income, not a week's.
    expect(WORLD_BOSS_STRIKE_TURNS * WORLD_BOSS_MAX_STRIKES).toBeLessThan(1_500);
  });

  it("prices health against participation", () => {
    expect(WORLD_BOSS_HP_PER_EMPIRE).toBeGreaterThan(0);
    expect(WORLD_BOSS_HP_MIN).toBeGreaterThan(WORLD_BOSS_HP_PER_EMPIRE);
  });
});
