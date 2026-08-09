import { describe, expect, it } from "vitest";
import {
  gameDay,
  gameWeek,
  nextGameDayStart,
  nextGameWeekStart,
} from "@/lib/game/time";
import {
  STREAK_CYCLE_DAYS,
  STREAK_LADDER,
  liveStreakCount,
  streakAlive,
  streakCycleDay,
  streakRung,
  streakRungRewards,
  streakTransition,
} from "@/lib/game/streak";
import {
  MISSIONS_PER_BOARD,
  MISSION_BY_KEY,
  MISSION_SHAPES,
  MISSION_STAT_KEYS,
  buildMissionBoard,
  missionGoal,
  missionPool,
  missionProgress,
  missionRewards,
  readBaseline,
  rollMissions,
  type MissionBaseline,
} from "@/lib/game/missions";
import {
  GUILD_CONTRACTS,
  GUILD_CONTRACT_MAX_PER_MEMBER,
  GUILD_CONTRACT_MIN_GOAL,
  guildContractGoal,
  guildContractReward,
  rollGuildContract,
} from "@/lib/game/guildContract";
import { mergeRewards, scaleRewards } from "@/lib/game/rewards";
import { seededRandom, seededSample } from "@/lib/game/random";
import { MAX_CITIES } from "@/lib/game/constants";

/** A baseline with every counter at `value` — the shape, not the numbers. */
function flat(value: number): MissionBaseline {
  return Object.fromEntries(
    MISSION_STAT_KEYS.map((k) => [k, value])
  ) as MissionBaseline;
}

/* ------------------------------ the calendar ------------------------------ */

describe("gameDay / gameWeek", () => {
  it("counts a Jerusalem calendar day, not a 24h window from the epoch", () => {
    // 22:00 UTC on 8 Aug is already 01:00 on 9 Aug in Jerusalem (UTC+3), so the
    // two instants below are the *same* Jerusalem day even though they straddle
    // a UTC midnight — this is the whole reason the helper exists.
    const lateUtc = new Date("2026-08-08T22:00:00Z");
    const nextMorning = new Date("2026-08-09T05:00:00Z");
    expect(gameDay(lateUtc)).toBe(gameDay(nextMorning));
  });

  it("advances by exactly one across a Jerusalem midnight", () => {
    const before = new Date("2026-08-08T20:30:00Z"); // 23:30 local
    const after = new Date("2026-08-08T21:30:00Z"); // 00:30 local, next day
    expect(gameDay(after) - gameDay(before)).toBe(1);
  });

  it("survives the DST boundary — every day steps by one", () => {
    // Israel's autumn fall-back is in late October; walk a fortnight around it
    // an hour at a time and assert the index never skips or repeats a day.
    let previous = gameDay(new Date("2026-10-20T00:00:00Z"));
    for (let hour = 1; hour <= 24 * 14; hour += 1) {
      const at = new Date(Date.UTC(2026, 9, 20, hour));
      const day = gameDay(at);
      expect(day - previous).toBeGreaterThanOrEqual(0);
      expect(day - previous).toBeLessThanOrEqual(1);
      previous = day;
    }
  });

  it("starts a week on Sunday", () => {
    // 2026-08-09 is a Sunday; the Saturday before it must be the previous week.
    const sunday = new Date("2026-08-09T09:00:00Z");
    const saturday = new Date("2026-08-08T09:00:00Z");
    const monday = new Date("2026-08-10T09:00:00Z");
    expect(gameWeek(sunday)).toBe(gameWeek(monday));
    expect(gameWeek(sunday) - gameWeek(saturday)).toBe(1);
  });

  it("resets land in the future and inside a day / a week", () => {
    const at = new Date("2026-08-11T14:00:00Z");
    const nextDay = nextGameDayStart(at);
    const nextWeek = nextGameWeekStart(at);
    expect(nextDay.getTime()).toBeGreaterThan(at.getTime());
    expect(nextDay.getTime() - at.getTime()).toBeLessThanOrEqual(86_400_000);
    expect(nextWeek.getTime()).toBeGreaterThan(at.getTime());
    expect(nextWeek.getTime() - at.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    // The instant a day opens is itself the start of a new day.
    expect(gameDay(new Date(nextDay.getTime() + 1))).toBe(gameDay(at) + 1);
    // And the instant a week opens is a Sunday, i.e. a new week index.
    expect(gameWeek(new Date(nextWeek.getTime() + 1))).toBe(gameWeek(at) + 1);
  });
});

/* ------------------------------ the muster roll ------------------------------ */

describe("streakTransition", () => {
  it("starts a run at 1 for an empire that has never signed", () => {
    expect(streakTransition(0, 0, 20_000)).toEqual({
      claimable: true,
      nextCount: 1,
      broken: false,
    });
  });

  it("continues a run signed yesterday", () => {
    expect(streakTransition(19_999, 12, 20_000)).toEqual({
      claimable: true,
      nextCount: 13,
      broken: false,
    });
  });

  it("breaks a run after any gap, and says so", () => {
    expect(streakTransition(19_998, 12, 20_000)).toEqual({
      claimable: true,
      nextCount: 1,
      broken: true,
    });
  });

  it("refuses a second signature on the same day", () => {
    expect(streakTransition(20_000, 5, 20_000).claimable).toBe(false);
  });

  it("refuses a signature from a clock that has gone backwards", () => {
    // Not reachable through the UI, but the guard is a `>=` for a reason: a
    // stored day ahead of today must not hand out a free claim.
    expect(streakTransition(20_001, 5, 20_000).claimable).toBe(false);
  });
});

describe("streakAlive / liveStreakCount", () => {
  it("keeps a run alive on the day after it was signed", () => {
    expect(streakAlive(19_999, 4, 20_000)).toBe(true);
    expect(liveStreakCount(19_999, 4, 20_000)).toBe(4);
  });

  it("shows a dead run as zero without anything having cleared the column", () => {
    expect(streakAlive(19_990, 40, 20_000)).toBe(false);
    expect(liveStreakCount(19_990, 40, 20_000)).toBe(0);
  });
});

describe("the seven-day cycle", () => {
  it("has exactly one rung per day, numbered in order", () => {
    expect(STREAK_LADDER).toHaveLength(STREAK_CYCLE_DAYS);
    STREAK_LADDER.forEach((rung, index) => expect(rung.day).toBe(index + 1));
  });

  it("wraps: day 8 of a run is rung 1 again", () => {
    expect(streakCycleDay(1)).toBe(1);
    expect(streakCycleDay(7)).toBe(7);
    expect(streakCycleDay(8)).toBe(1);
    expect(streakCycleDay(15)).toBe(1);
    expect(streakRung(14).day).toBe(7);
  });

  it("pays diamonds on the seventh day and only there", () => {
    const withDiamonds = STREAK_LADDER.filter((r) =>
      r.rewards.some((w) => w.kind === "diamonds")
    );
    expect(withDiamonds.map((r) => r.day)).toEqual([STREAK_CYCLE_DAYS]);
  });

  it("scales resources with cities but never diamonds or spins", () => {
    const small = streakRungRewards(7, 1);
    const large = streakRungRewards(7, MAX_CITIES);
    const gold = (r: typeof small) => r.find((x) => x.kind === "gold")!.amount;
    const diamonds = (r: typeof small) =>
      r.find((x) => x.kind === "diamonds")!.amount;
    const spins = (r: typeof small) =>
      r.find((x) => x.kind === "wheelSpins")!.amount;

    expect(gold(large)).toBeGreaterThan(gold(small));
    expect(diamonds(large)).toBe(diamonds(small));
    expect(spins(large)).toBe(spins(small));
  });
});

/* ------------------------------ rewards ------------------------------ */

describe("rewards", () => {
  it("merges repeated kinds into one line, in the canonical order", () => {
    const merged = mergeRewards([
      { kind: "turns", amount: 10 },
      { kind: "gold", amount: 100 },
      { kind: "turns", amount: 5 },
      { kind: "diamonds", amount: 3 },
    ]);
    expect(merged).toEqual([
      { kind: "gold", amount: 100 },
      { kind: "turns", amount: 15 },
      { kind: "diamonds", amount: 3 },
    ]);
  });

  it("drops empty lines rather than paying zero of something", () => {
    expect(mergeRewards([{ kind: "gold", amount: 0 }])).toEqual([]);
  });

  it("leaves citizens off the city curve", () => {
    const table = [
      { kind: "citizens" as const, amount: 30 },
      { kind: "wood" as const, amount: 10_000 },
    ];
    const scaled = scaleRewards(table, MAX_CITIES);
    expect(scaled.find((r) => r.kind === "citizens")!.amount).toBe(30);
    expect(scaled.find((r) => r.kind === "wood")!.amount).toBeGreaterThan(10_000);
  });
});

/* ------------------------------ missions ------------------------------ */

describe("the mission catalog", () => {
  it("has unique keys", () => {
    const keys = MISSION_SHAPES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("offers every shape at at least one scope", () => {
    for (const shape of MISSION_SHAPES) {
      expect(shape.day != null || shape.week != null).toBe(true);
    }
  });

  it("only reads counters the baseline actually carries", () => {
    for (const shape of MISSION_SHAPES) {
      expect(MISSION_STAT_KEYS).toContain(shape.stat);
    }
  });

  it("never sets a weekly goal below its daily one", () => {
    for (const shape of MISSION_SHAPES) {
      if (shape.day != null && shape.week != null) {
        expect(shape.week).toBeGreaterThanOrEqual(shape.day);
      }
    }
  });

  it("can fill a board at every scope and every empire size", () => {
    for (const scope of ["DAY", "WEEK"] as const) {
      for (let cities = 1; cities <= MAX_CITIES; cities += 1) {
        expect(missionPool(scope, cities).length).toBeGreaterThanOrEqual(
          MISSIONS_PER_BOARD
        );
      }
    }
  });

  it("withholds a shape until its city requirement is met", () => {
    const gated = MISSION_SHAPES.filter((s) => (s.minCities ?? 1) > 1);
    expect(gated.length).toBeGreaterThan(0);
    for (const shape of gated) {
      const scope = shape.day != null ? "DAY" : "WEEK";
      expect(missionPool(scope, 1)).not.toContain(shape);
      expect(missionPool(scope, shape.minCities!)).toContain(shape);
    }
  });
});

describe("rollMissions", () => {
  it("is stable for the same empire, scope and period", () => {
    const a = rollMissions("empire-a", "DAY", 20_100, 5);
    const b = rollMissions("empire-a", "DAY", 20_100, 5);
    expect(a).toEqual(b);
  });

  it("deals a full board of distinct missions", () => {
    const rolled = rollMissions("empire-a", "DAY", 20_100, 5);
    expect(rolled).toHaveLength(MISSIONS_PER_BOARD);
    expect(new Set(rolled).size).toBe(rolled.length);
  });

  it("deals only missions the scope and size allow", () => {
    for (let cities = 1; cities <= MAX_CITIES; cities += 1) {
      for (const scope of ["DAY", "WEEK"] as const) {
        for (const key of rollMissions(`e${cities}`, scope, 20_100, cities)) {
          const shape = MISSION_BY_KEY.get(key)!;
          expect(shape).toBeDefined();
          expect(scope === "DAY" ? shape.day : shape.week).not.toBeNull();
          expect(cities).toBeGreaterThanOrEqual(shape.minCities ?? 1);
        }
      }
    }
  });

  it("differs across periods and across empires", () => {
    const days = new Set(
      Array.from({ length: 30 }, (_, i) =>
        rollMissions("empire-a", "DAY", 20_100 + i, 8).join(",")
      )
    );
    const empires = new Set(
      Array.from({ length: 30 }, (_, i) =>
        rollMissions(`empire-${i}`, "DAY", 20_100, 8).join(",")
      )
    );
    // Not "all different" — a seeded draw from a small pool repeats — but a
    // draw that produced one answer for everybody would be a broken seed.
    expect(days.size).toBeGreaterThan(5);
    expect(empires.size).toBeGreaterThan(5);
  });
});

describe("missionProgress", () => {
  const shape = MISSION_BY_KEY.get("raid")!;

  it("measures the difference since the board opened", () => {
    const base = flat(10);
    const now = { ...base, attacksLaunched: 14 };
    expect(missionProgress(shape, now, base)).toBe(4);
  });

  it("floors at zero rather than showing a negative bar", () => {
    const base = flat(10);
    const now = { ...base, attacksLaunched: 4 };
    expect(missionProgress(shape, now, base)).toBe(0);
  });

  it("counts a lifetime total when the baseline predates the mission", () => {
    // readBaseline fails missing keys to 0 on purpose — see its note. A stat
    // added after a board was written therefore reads as the whole lifetime
    // figure rather than throwing or freezing the mission at 0/N.
    const base = readBaseline({ attacksLaunched: undefined });
    expect(base.attacksLaunched).toBe(0);
    expect(missionProgress(shape, flat(7), base)).toBe(7);
  });

  it("ignores junk in a stored baseline", () => {
    const base = readBaseline({ attacksLaunched: "12", spyMissions: NaN });
    expect(base.attacksLaunched).toBe(0);
    expect(base.spyMissions).toBe(0);
  });
});

describe("missionGoal", () => {
  it("leaves a goal counted in acts alone at every size", () => {
    const raid = MISSION_BY_KEY.get("raid")!;
    expect(missionGoal(raid, "DAY", 1)).toBe(raid.day);
    expect(missionGoal(raid, "DAY", MAX_CITIES)).toBe(raid.day);
  });

  it("scales a goal counted in resources with the empire", () => {
    const plunder = MISSION_BY_KEY.get("plunder")!;
    expect(missionGoal(plunder, "DAY", MAX_CITIES)).toBeGreaterThan(
      missionGoal(plunder, "DAY", 1)
    );
  });

  it("rounds a scaled goal to something a player would say out loud", () => {
    const plunder = MISSION_BY_KEY.get("plunder")!;
    for (let cities = 1; cities <= MAX_CITIES; cities += 1) {
      const goal = missionGoal(plunder, "WEEK", cities);
      expect(goal % 1_000).toBe(0);
    }
  });

  it("is zero for a scope the shape is not offered at", () => {
    const weeklyOnly = MISSION_SHAPES.find((s) => s.day === null)!;
    expect(missionGoal(weeklyOnly, "DAY", 5)).toBe(0);
  });
});

describe("buildMissionBoard", () => {
  const base = flat(0);

  it("marks a finished mission collectable and a collected one done", () => {
    const now = { ...base, attacksLaunched: 99, spyMissions: 99 };
    const board = buildMissionBoard(
      "DAY",
      20_100,
      0,
      ["raid", "scout"],
      ["scout"],
      now,
      base,
      3
    );
    expect(board.missions.map((m) => m.key)).toEqual(["raid", "scout"]);
    expect(board.missions[0].done).toBe(true);
    expect(board.missions[0].claimed).toBe(false);
    expect(board.missions[1].claimed).toBe(true);
    expect(board.collectable).toBe(1);
  });

  it("clamps a runaway counter to the goal for display", () => {
    const now = { ...base, attacksLaunched: 10_000 };
    const board = buildMissionBoard("DAY", 20_100, 0, ["raid"], [], now, base, 3);
    expect(board.missions[0].progress).toBe(board.missions[0].goal);
  });

  it("drops a retired key instead of throwing", () => {
    const board = buildMissionBoard(
      "DAY",
      20_100,
      0,
      ["raid", "a-mission-that-no-longer-exists"],
      [],
      base,
      base,
      3
    );
    expect(board.missions).toHaveLength(1);
  });

  it("drops a mission offered at the other scope only", () => {
    const weeklyOnly = MISSION_SHAPES.find((s) => s.day === null)!;
    const board = buildMissionBoard(
      "DAY",
      20_100,
      0,
      [weeklyOnly.key],
      [],
      base,
      base,
      MAX_CITIES
    );
    expect(board.missions).toHaveLength(0);
  });
});

describe("mission purses", () => {
  it("pays more for a weekly than for the same shape daily", () => {
    const total = (r: ReturnType<typeof missionRewards>) =>
      r.reduce((sum, x) => sum + x.amount, 0);
    for (const shape of MISSION_SHAPES) {
      if (shape.day == null || shape.week == null) continue;
      expect(total(missionRewards(shape, "WEEK", 4))).toBeGreaterThan(
        total(missionRewards(shape, "DAY", 4))
      );
    }
  });

  it("never pays diamonds — the daily loop's only diamond faucet is the roll", () => {
    for (const shape of MISSION_SHAPES) {
      for (const scope of ["DAY", "WEEK"] as const) {
        expect(
          missionRewards(shape, scope, 5).some((r) => r.kind === "diamonds")
        ).toBe(false);
      }
    }
  });
});

/* ------------------------------ the guild contract ------------------------------ */

describe("guild contracts", () => {
  it("has unique keys", () => {
    const keys = GUILD_CONTRACTS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is stable for a guild on a day, and moves between days", () => {
    expect(rollGuildContract("guild-a", 20_100).key).toBe(
      rollGuildContract("guild-a", 20_100).key
    );
    const keys = new Set(
      Array.from({ length: 40 }, (_, i) => rollGuildContract("guild-a", i).key)
    );
    expect(keys.size).toBeGreaterThan(1);
  });

  it("never asks less than the floor, however small the guild", () => {
    for (const contract of GUILD_CONTRACTS) {
      expect(guildContractGoal(contract, 1)).toBeGreaterThanOrEqual(
        GUILD_CONTRACT_MIN_GOAL
      );
      expect(guildContractGoal(contract, 0)).toBeGreaterThanOrEqual(
        GUILD_CONTRACT_MIN_GOAL
      );
    }
  });

  it("stays inside what the members' boards can actually supply", () => {
    // Three daily missions per member is the hard ceiling on supply, so a goal
    // above `members × 3` would be unmeetable by construction.
    for (const contract of GUILD_CONTRACTS) {
      for (let members = 1; members <= 40; members += 1) {
        const goal = guildContractGoal(contract, members);
        expect(goal).toBeLessThanOrEqual(
          Math.max(GUILD_CONTRACT_MIN_GOAL, members * MISSIONS_PER_BOARD)
        );
        expect(goal / members).toBeLessThanOrEqual(
          Math.max(GUILD_CONTRACT_MAX_PER_MEMBER, GUILD_CONTRACT_MIN_GOAL)
        );
      }
    }
  });

  it("grows the goal with the guild", () => {
    for (const contract of GUILD_CONTRACTS) {
      expect(guildContractGoal(contract, 12)).toBeGreaterThan(
        guildContractGoal(contract, 2)
      );
    }
  });

  it("pays each member on their own city curve", () => {
    const contract = GUILD_CONTRACTS[0];
    const total = (cities: number) =>
      guildContractReward(contract, cities).reduce((s, r) => s + r.amount, 0);
    expect(total(MAX_CITIES)).toBeGreaterThan(total(1));
  });
});

/* ------------------------------ the seeded stream ------------------------------ */

describe("seededRandom / seededSample", () => {
  it("returns the same stream for the same seed", () => {
    const a = seededRandom("abc");
    const b = seededRandom("abc");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("stays inside [0, 1)", () => {
    const random = seededRandom("bounds");
    for (let i = 0; i < 2_000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("samples without replacement and never overdraws", () => {
    const pool = [1, 2, 3, 4, 5];
    const drawn = seededSample(pool, 3, seededRandom("s"));
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn).size).toBe(3);
    expect(seededSample(pool, 99, seededRandom("s"))).toHaveLength(pool.length);
    expect(seededSample(pool, 0, seededRandom("s"))).toEqual([]);
  });

  it("covers the whole pool across many seeds", () => {
    const pool = ["a", "b", "c", "d", "e"];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      for (const item of seededSample(pool, 2, seededRandom(`seed-${i}`))) {
        seen.add(item);
      }
    }
    expect(seen.size).toBe(pool.length);
  });
});
