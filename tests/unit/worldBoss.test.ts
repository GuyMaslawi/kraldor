import { describe, expect, it } from "vitest";
import {
  WORLD_BOSSES,
  WORLD_BOSS_BLOW_BAND,
  WORLD_BOSS_BLOW_META,
  WORLD_BOSS_BY_KEY,
  WORLD_BOSS_FLOOR_SHARE,
  WORLD_BOSS_HP_MIN,
  WORLD_BOSS_HP_PER_EMPIRE,
  WORLD_BOSS_MAX_STRIKES,
  WORLD_BOSS_PHASES,
  WORLD_BOSS_PHASE_BY_KEY,
  WORLD_BOSS_PURSE,
  WORLD_BOSS_STRIKE_TURNS,
  WORLD_BOSS_DAMAGE_SPREAD,
  expectedStrikeDamage,
  rollWorldBoss,
  strikeDamage,
  worldBossBlowGrade,
  worldBossMaxHp,
  worldBossPhase,
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

  it("is a wall priced at the late game, not at a mid-season army", () => {
    // The calibration that makes the fixture a fixture, and the one thing that
    // must move with WORLD_BOSS_HP_PER_EMPIRE whenever it moves. 200 empires,
    // each landing their full allowance: the question is what army it takes.
    const boss = WORLD_BOSSES.find((b) => b.toughness === 1.0) ?? WORLD_BOSSES[0];
    const pool = worldBossMaxHp(boss, 200);
    const week = (power: number) =>
      expectedStrikeDamage(power) * WORLD_BOSS_MAX_STRIKES;

    // A server of mid-season armies does not fell it, and cannot fix that by
    // bringing more people: the pool grows with the head count, so only power
    // ever closes the gap.
    expect(week(500_000) * 200).toBeLessThan(pool);
    // Late-season armies do — break-even sits at roughly 11M military power,
    // which is the whole claim in the note on WORLD_BOSS_HP_PER_EMPIRE.
    expect(week(12_000_000) * 200).toBeGreaterThan(pool);
  });

  it("is still reachable at all — the purse is gated on the kill", () => {
    // Nothing is paid until `defeatedAt` is stamped, so a pool no achievable
    // army can reach is a closed fixture rather than a hard one. One empire's
    // week of strikes must be able to cover one empire's share of the pool.
    const boss = WORLD_BOSSES.find((b) => b.toughness === 1.0) ?? WORLD_BOSSES[0];
    const share = worldBossMaxHp(boss, 200) / 200;
    // The strongest army the game realistically fields late in a season.
    const week = expectedStrikeDamage(50_000_000) * WORLD_BOSS_MAX_STRIKES;
    expect(week).toBeGreaterThan(share);
  });
});

describe("strikeDamage", () => {
  it("never returns nothing, even for an empire with no army", () => {
    // A brand-new empire has to be able to move the bar, or the page has no
    // reason to exist for them. Checked across the whole spread, since the
    // floor has to hold at the unlucky end too.
    for (const roll of [0, 0.5, 1]) {
      expect(strikeDamage(0, () => roll)).toBeGreaterThanOrEqual(1);
      expect(strikeDamage(-100, () => roll)).toBeGreaterThanOrEqual(1);
    }
  });

  it("rises with power", () => {
    expect(expectedStrikeDamage(1_000_000)).toBeGreaterThan(
      expectedStrikeDamage(10_000)
    );
  });

  it("is sub-linear — a hundred times the army is not a hundred times the blow", () => {
    // The whole reason a small empire's contribution stays visible.
    const small = expectedStrikeDamage(10_000);
    const large = expectedStrikeDamage(1_000_000);
    expect(large / small).toBeGreaterThan(5);
    expect(large / small).toBeLessThan(20);
  });

  it("is a whole number of damage", () => {
    for (const power of [0, 1, 999, 12_345, 9_876_543]) {
      expect(Number.isInteger(strikeDamage(power))).toBe(true);
    }
  });
});

describe("the killing blow cannot be computed", () => {
  /**
   * The hole this closes. The kill is worth WORLD_BOSS_KILL_DIAMONDS and the
   * arena publishes the boss's exact remaining health. While the blow was a
   * pure function of the striker's own power, taking that prize was arithmetic
   * rather than a race: hold a strike, watch the bar, fire the instant `hp`
   * drops inside your own figure, and collect every week with certainty.
   */
  it("scatters the blow, so no striker knows which one lands the kill", () => {
    const power = 1_000_000;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) seen.add(strikeDamage(power));
    expect(seen.size).toBeGreaterThan(20);
  });

  it("spreads it far enough to straddle a blow's own width", () => {
    // The band has to be wide relative to one blow, or a sniper could still
    // pick a health level that only their own strike can reach.
    const power = 1_000_000;
    const low = strikeDamage(power, () => 0);
    const high = strikeDamage(power, () => 1);
    const mid = expectedStrikeDamage(power);
    expect(low).toBeLessThan(mid);
    expect(high).toBeGreaterThan(mid);
    expect((high - low) / mid).toBeGreaterThan(0.3);
  });

  it("stays inside the declared band in both directions", () => {
    const power = 4_000_000;
    const mid = expectedStrikeDamage(power);
    for (let i = 0; i < 500; i += 1) {
      const hit = strikeDamage(power);
      expect(hit).toBeGreaterThanOrEqual(
        Math.floor(mid * (1 - WORLD_BOSS_DAMAGE_SPREAD)) - 1
      );
      expect(hit).toBeLessThanOrEqual(
        Math.ceil(mid * (1 + WORLD_BOSS_DAMAGE_SPREAD)) + 1
      );
    }
  });

  it("previews without consuming a roll", () => {
    // A preview that spent the roll would either differ from the blow actually
    // landed or hand the player the roll in advance.
    expect(expectedStrikeDamage(1_000_000)).toBe(expectedStrikeDamage(1_000_000));
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

describe("the beast's temper", () => {
  it("orders the phases from full health down to none", () => {
    const froms = WORLD_BOSS_PHASES.map((p) => p.from);
    expect(froms).toEqual([...froms].sort((a, b) => b - a));
    expect(froms.at(-1)).toBe(0);
    expect(new Set(WORLD_BOSS_PHASES.map((p) => p.key)).size).toBe(
      WORLD_BOSS_PHASES.length
    );
    expect(WORLD_BOSS_PHASE_BY_KEY.size).toBe(WORLD_BOSS_PHASES.length);
  });

  it("announces every phase except the one the week opens in", () => {
    expect(WORLD_BOSS_PHASES[0].cry).toBeNull();
    for (const phase of WORLD_BOSS_PHASES.slice(1)) {
      expect(phase.cry).toBeTruthy();
    }
  });

  it("burns hotter as the beast is worn down", () => {
    const heats = WORLD_BOSS_PHASES.map((p) => p.heat);
    expect(heats).toEqual([...heats].sort((a, b) => a - b));
  });

  it("puts a fresh boss in the opening phase and a dead one in the last", () => {
    expect(worldBossPhase(1_000, 1_000).key).toBe(WORLD_BOSS_PHASES[0].key);
    expect(worldBossPhase(0, 1_000).key).toBe(WORLD_BOSS_PHASES.at(-1)!.key);
    // A pool that never existed must still resolve rather than throw.
    expect(worldBossPhase(0, 0).key).toBe(WORLD_BOSS_PHASES.at(-1)!.key);
  });

  it("crosses exactly once per threshold as health drains", () => {
    const seen: string[] = [];
    for (let hp = 1_000; hp >= 0; hp -= 1) {
      const key = worldBossPhase(hp, 1_000).key;
      if (seen.at(-1) !== key) seen.push(key);
    }
    expect(seen).toEqual(WORLD_BOSS_PHASES.map((p) => p.key));
  });

  it("never crosses back up as the fight goes on", () => {
    // The whole point of an announcement is that it happens once, server-wide.
    let index = 0;
    for (let hp = 1_000; hp >= 0; hp -= 7) {
      const at = WORLD_BOSS_PHASES.findIndex(
        (p) => p.key === worldBossPhase(hp, 1_000).key
      );
      expect(at).toBeGreaterThanOrEqual(index);
      index = at;
    }
  });
});

describe("how a blow landed", () => {
  it("calls the middle of the spread solid", () => {
    expect(worldBossBlowGrade(100, 100)).toBe("solid");
  });

  it("grades the ends of the spread", () => {
    expect(worldBossBlowGrade(100 * (1 - WORLD_BOSS_DAMAGE_SPREAD), 100)).toBe(
      "glancing"
    );
    expect(worldBossBlowGrade(100 * (1 + WORLD_BOSS_DAMAGE_SPREAD), 100)).toBe(
      "crushing"
    );
  });

  it("keeps the band inside the spread, so both ends are reachable", () => {
    // A band wider than the roll can reach would make one grade unreachable and
    // the other two the only outcomes.
    expect(WORLD_BOSS_BLOW_BAND).toBeGreaterThan(0);
    expect(WORLD_BOSS_BLOW_BAND).toBeLessThan(WORLD_BOSS_DAMAGE_SPREAD);
  });

  it("leaves the middle band to solid and no more than that", () => {
    expect(worldBossBlowGrade(100 * (1 - WORLD_BOSS_BLOW_BAND * 0.99), 100)).toBe(
      "solid"
    );
    expect(worldBossBlowGrade(100 * (1 + WORLD_BOSS_BLOW_BAND * 0.99), 100)).toBe(
      "solid"
    );
  });

  it("grades a blow with no expectation rather than dividing by zero", () => {
    expect(worldBossBlowGrade(500, 0)).toBe("solid");
  });

  it("has copy for every grade", () => {
    for (const grade of ["glancing", "solid", "crushing"] as const) {
      expect(WORLD_BOSS_BLOW_META[grade].label).toBeTruthy();
      expect(WORLD_BOSS_BLOW_META[grade].line).toBeTruthy();
    }
  });

  it("reaches all three grades over a run of real rolls", () => {
    const grades = new Set<string>();
    let seed = 1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const expected = expectedStrikeDamage(10_000);
    for (let i = 0; i < 400; i++) {
      grades.add(worldBossBlowGrade(strikeDamage(10_000, random), expected));
    }
    expect(grades).toEqual(new Set(["glancing", "solid", "crushing"]));
  });
});

/**
 * The admin dials, added when /admin/bosses was built.
 *
 * All three are trailing optional parameters, so every existing call site keeps
 * the shipped fixture — that is the property the first test here pins, and it is
 * the one that matters: an untouched overlay must leave the week exactly as it
 * was designed.
 */
describe("the admin multipliers", () => {
  it("changes nothing at 1 — the shipped fixture is the default", () => {
    const boss = WORLD_BOSS_BY_KEY.get("deep_leviathan")!;
    expect(worldBossMaxHp(boss, 120, 1)).toBe(worldBossMaxHp(boss, 120));
    expect(expectedStrikeDamage(250_000, 1)).toBe(expectedStrikeDamage(250_000));
    expect(worldBossReward(0.3, 8, 3, 1)).toEqual(worldBossReward(0.3, 8, 3));
  });

  it("scales a new spawn's health pool", () => {
    const boss = WORLD_BOSS_BY_KEY.get("deep_leviathan")!;
    const base = worldBossMaxHp(boss, 200);
    expect(worldBossMaxHp(boss, 200, 2)).toBe(base * 2);
    expect(worldBossMaxHp(boss, 200, 0.5)).toBe(Math.round(base / 2));
  });

  it("never hands back a pool of nothing, however small the dial", () => {
    // A pool of zero would be felled by the first blow of the week — and the
    // bounds in config.ts refuse anything under 0.01 before it ever gets here.
    const boss = WORLD_BOSSES[0];
    expect(worldBossMaxHp(boss, 200, 0)).toBeGreaterThanOrEqual(1);
    expect(worldBossMaxHp(boss, 200, -5)).toBeGreaterThanOrEqual(1);
  });

  it("scales what one blow takes off, expected and rolled alike", () => {
    expect(expectedStrikeDamage(1_000_000, 3)).toBe(
      expectedStrikeDamage(1_000_000) * 3
    );
    const half = strikeDamage(1_000_000, () => 0.5, 0.5);
    expect(half).toBe(Math.round(expectedStrikeDamage(1_000_000) * 0.5));
  });

  it("keeps a blow worth at least one point of damage at any dial", () => {
    expect(strikeDamage(0, () => 0.5, 0.001)).toBeGreaterThanOrEqual(1);
  });

  it("scales the shared purse", () => {
    const base = worldBossReward(0.4, 10, 2);
    const doubled = worldBossReward(0.4, 10, 2, 2);
    for (const [i, line] of base.entries()) {
      expect(doubled[i].kind).toBe(line.kind);
      // Not strictly greater on every line: the smallest (two wheel spins at a
      // quarter share) is already sitting on the per-line floor of one, and a
      // floor is a floor in both directions.
      expect(doubled[i].amount).toBeGreaterThanOrEqual(line.amount);
    }
    const gold = (r: typeof base) => r.find((line) => line.kind === "gold")!.amount;
    expect(gold(doubled)).toBe(gold(base) * 2);
  });

  it("pays nothing at all when the purse is closed, rather than one of each", () => {
    // The per-line `Math.max(1, …)` floor exists so a rounding-error share still
    // pays something. An admin setting the multiplier to zero is saying the
    // opposite, and the floor must not overrule them.
    expect(worldBossReward(1, 1, MAX_CITIES, 0)).toEqual([]);
  });
});
