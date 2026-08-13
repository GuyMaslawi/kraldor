import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CITIZENS_BASE, DEFAULT_CITIZENS_PER_LEVEL } from "@/lib/game/constants";

/**
 * Admin-editable global game balance. These are the *server-authoritative*
 * tunables — values the game logic reads when it actually grants resources,
 * resolves battles, or seeds a new empire. Editing them from the admin panel
 * changes the live game for everyone.
 *
 * Persisted as a JSON overlay in the GameConfig singleton row and merged over
 * these defaults by `getTunables()`. The defaults mirror the historical
 * hard-coded constants so an empty overlay leaves the game unchanged.
 */
export interface GameTunables {
  /** New-empire starting bundle (see newEmpireData). */
  starting: {
    gold: number;
    wood: number;
    iron: number;
    stone: number;
    diamonds: number;
    citizens: number;
    turns: number;
    soldiers: number;
    spies: number;
    mineSlaves: number;
    slavesPerMine: number;
    wheelSpins: number;
  };
  /** Daily-update economy (citizens, diamonds, wheel spins). */
  daily: {
    citizensBase: number;
    citizensPerLevel: number;
    wheelSpins: number;
  };
  /** Battle & spy resolution parameters. */
  battle: {
    defenseBonus: number;
    plunderRate: number;
    enslaveRate: number;
    enslaveMinSoldiers: number;
    attackTurnCost: number;
    spyTurnCost: number;
  };
  /** Global economy scalars applied on top of per-empire bonuses. */
  economy: {
    mineProductionMultiplier: number;
  };
  /**
   * City-boss balance. The shape of the curves lives in game/bosses.ts and the
   * combat in game/bossBattle.ts; these are the global scalars on top of them, so
   * the boss can be softened or sharpened without a deploy.
   */
  boss: {
    powerMultiplier: number;
    rewardMultiplier: number;
    /**
     * Scales only the health pool a boss life carries, not the printed power — the
     * knob for "the boss should take more/fewer assaults to fell" that leaves the
     * number players measure themselves against alone.
     */
    hpMultiplier: number;
    /** 0 closes the boss entirely; 1 opens it. */
    enabled: number;
  };
  /**
   * Hero expeditions. The durations, turn costs and loot odds live in
   * game/heroQuests.ts; this is the global payout scalar plus the kill switch,
   * so the board can be softened — or closed — without a deploy.
   */
  heroQuest: {
    rewardMultiplier: number;
    /** 0 closes the board entirely; 1 opens it. */
    enabled: number;
  };
  /** Diamond store (real-money purchase page) tunables. */
  diamondStore: {
    /** Percent off every diamond package price (0 = full price). */
    purchaseDiscountPct: number;
  };
  /**
   * The season cycle, run without an admin: how long the game stays shut
   * between one season and the next, how long the next one lasts, and whether
   * the world is rebuilt when it opens. See server/seasonClose.ts — the season
   * that closes schedules its own successor from these numbers.
   */
  season: {
    /**
     * Hours between a season closing and the next one opening. The whole game
     * is shut for exactly this long: everyone sees /season and its countdown.
     */
    breakHours: number;
    /** Length, in days, of each automatically scheduled season. */
    lengthDays: number;
    /**
     * 0 stops the cycle: a closed season schedules no successor and the game
     * stays shut until an admin opens one by hand. 1 keeps it running.
     */
    autoNext: number;
    /**
     * 1 = opening the next season rebuilds the world — every empire restarts
     * from the opening bundle (diamonds kept) and every guild is dissolved, so
     * a season really is a fresh race. 0 carries everyone over untouched.
     */
    autoRestart: number;
    /**
     * Bot garrisons standing in the first city when a season opens.
     *
     * The problem is the first hour of a new season: the world has just been
     * wiped, the ladder for the tier everybody starts in holds whoever has
     * logged back in so far, and the first player through the door finds a
     * board with one row on it. A game nobody else appears to be playing is one
     * players leave, and they leave before the others arrive.
     *
     * At ten rows to a page (server/rankingsLadder.ts) the default fills three
     * and a half of them, so the opening ladder is something to scroll and every
     * player has targets to raid from the first minute. 0 turns the seeding off
     * and leaves planting to the admin.
     */
    openBots: number;
  };
}

export const DEFAULT_TUNABLES: GameTunables = {
  /**
   * The opening bundle, sized so the first session ends in a *purchase* rather
   * than in waiting. The old one (3,000/2,000/1,500/1,500, 60 citizens, 50
   * turns) did not reach the first rung of any ladder: the cheapest mine
   * upgrade is 5,000 gold / 2,800 wood / 2,800 iron / 2,300 stone
   * (MINE_UPGRADE_BASE), and at the starting five slaves a mine a fresh empire
   * earns 2,880 of a resource a day — so the very first upgrade was almost two
   * days away and nothing but a warehouse level was affordable on day one.
   *
   * Each resource line is now `first mine rung + first warehouse rung + change
   * for weapons`, and the gold line is deliberately capped at the capacity of
   * the level-1 warehouse it ships with (storageCapacityForLevel(1) = 10,000):
   * the whole purse fits under cover, so a newcomer cannot be plundered out of
   * their opening before they have spent it.
   *
   * `soldiers` stays *below* battle.enslaveMinSoldiers (20) for the same reason
   * bots field nineteen — a starter army at or above that floor would make
   * every fresh empire farmable for slaves the moment its 48-hour shield drops.
   * Raise this line and that is what it buys.
   *
   * `diamonds` is the one line that is not derived from a price: 400 buys a
   * genuine first taste of the diamond economy (a 24h raid shield at 350, or
   * ~1,200 turns across the packs) and costs roughly ₪12 at store rates, which
   * is the deliberate trade — a newcomer who has *used* diamonds is the one who
   * later buys them.
   */
  starting: {
    gold: 10_000,
    wood: 6_000,
    iron: 5_000,
    stone: 4_500,
    diamonds: 400,
    citizens: 150,
    turns: 150,
    soldiers: 10,
    spies: 5,
    // 10 a mine rather than 5: doubles day-one output to 5,760 a resource a
    // day, so the mines visibly pay from the first tick and the first upgrade
    // is reachable by income as well as by the purse.
    mineSlaves: 40,
    slavesPerMine: 10,
    wheelSpins: 4,
  },
  daily: {
    // Seeded from constants.ts so the shipped curve has exactly one definition:
    // citizensPerDailyUpdate() and an empty overlay must agree.
    citizensBase: DEFAULT_CITIZENS_BASE,
    citizensPerLevel: DEFAULT_CITIZENS_PER_LEVEL,
    wheelSpins: 3,
  },
  battle: {
    defenseBonus: 1.2,
    plunderRate: 0.1,
    enslaveRate: 0.1,
    enslaveMinSoldiers: 20,
    attackTurnCost: 10,
    spyTurnCost: 5,
  },
  economy: {
    mineProductionMultiplier: 1,
  },
  boss: {
    powerMultiplier: 1,
    rewardMultiplier: 1,
    hpMultiplier: 1,
    enabled: 1,
  },
  heroQuest: {
    rewardMultiplier: 1,
    enabled: 1,
  },
  diamondStore: {
    purchaseDiscountPct: 0,
  },
  season: {
    // A day of downtime: long enough that the end of a season is an event
    // players come back for, short enough that nobody drifts away.
    breakHours: 24,
    lengthDays: 30,
    autoNext: 1,
    autoRestart: 1,
    // Three and a half pages of the opening city ladder.
    openBots: 35,
  },
};

/**
 * Hard bounds for every tunable, enforced on both the write and the read path.
 *
 * These are safety rails, not balance opinions — they only rule out values that
 * break a game invariant outright. The costs in particular must stay >= 1: the
 * spend sites test `if (empire.turns < ATTACK_TURN_COST)` and then decrement by
 * that same figure, so a negative cost passes the affordability check and the
 * decrement *adds* turns, minting them without limit for every player at once.
 * Rates that feed multiplications are kept non-negative so resources can never
 * be driven below zero by a sign flip.
 */
const TUNABLE_BOUNDS: {
  [G in keyof GameTunables]: { [F in keyof GameTunables[G]]: [number, number] };
} = {
  starting: {
    gold: [0, 1e12],
    wood: [0, 1e12],
    iron: [0, 1e12],
    stone: [0, 1e12],
    diamonds: [0, 1e9],
    citizens: [0, 1e9],
    turns: [0, 1e9],
    soldiers: [0, 1e9],
    spies: [0, 1e9],
    mineSlaves: [0, 1e9],
    slavesPerMine: [0, 1e6],
    wheelSpins: [0, 1e4],
  },
  daily: {
    citizensBase: [0, 1e6],
    citizensPerLevel: [0, 1e6],
    wheelSpins: [0, 1e4],
  },
  battle: {
    defenseBonus: [0, 1e3],
    plunderRate: [0, 1],
    enslaveRate: [0, 1],
    enslaveMinSoldiers: [0, 1e9],
    // Must be >= 1 — see the note above; 0 would also make attacks free.
    attackTurnCost: [1, 1e6],
    spyTurnCost: [1, 1e6],
  },
  economy: {
    mineProductionMultiplier: [0, 1e3],
  },
  boss: {
    // A zero power multiplier would make every boss free to farm; keep a floor.
    powerMultiplier: [0.01, 1e3],
    rewardMultiplier: [0, 1e3],
    // Likewise a zero HP pool: the first round would fell every tyrant.
    hpMultiplier: [0.01, 1e3],
    // As on heroQuest.enabled, the read path tests `>= 1`, so a stray 0.5
    // closes the boss rather than half-opening something with no half state.
    enabled: [0, 1],
  },
  heroQuest: {
    rewardMultiplier: [0, 1e3],
    // Anything but 0 opens the board — the read path tests `>= 1`, so a stray
    // 0.5 closes it rather than half-opening something that has no half state.
    enabled: [0, 1],
  },
  diamondStore: {
    purchaseDiscountPct: [0, 100],
  },
  season: {
    // Zero is a legitimate answer ("open the next one immediately"), a year is
    // the ceiling — beyond that the countdown stops being a promise.
    breakHours: [0, 8760],
    // Never zero: a season whose end is its own start would be closed by the
    // gate on the page load that opened it, shutting the game in a loop.
    lengthDays: [1, 3650],
    // Read as `>= 1`, like every other switch here, so a stray 0.5 is "off".
    autoNext: [0, 1],
    autoRestart: [0, 1],
    // Planted one empire at a time, in the request that opens the season, so
    // the ceiling is a time budget as much as a balance one: a hundred is
    // already a ten-page ladder and about as much work as that request can
    // carry (see ensureCityBots).
    openBots: [0, 100],
  },
};

function mergeGroup<T extends Record<string, number>>(
  base: T,
  overlay: unknown,
  bounds: Record<string, [number, number]>
): T {
  if (!overlay || typeof overlay !== "object") return { ...base };
  const result = { ...base };
  for (const key of Object.keys(base) as (keyof T)[]) {
    const value = (overlay as Record<string, unknown>)[key as string];
    if (typeof value === "number" && Number.isFinite(value)) {
      const [min, max] = bounds[key as string] ?? [-Infinity, Infinity];
      result[key] = Math.min(max, Math.max(min, value)) as T[keyof T];
    }
  }
  return result;
}

/** Merge a persisted overlay over the defaults, keeping only known numeric fields. */
export function mergeTunables(overlay: unknown): GameTunables {
  const o = (overlay ?? {}) as Record<string, unknown>;
  return {
    starting: mergeGroup(DEFAULT_TUNABLES.starting, o.starting, TUNABLE_BOUNDS.starting),
    daily: mergeGroup(DEFAULT_TUNABLES.daily, o.daily, TUNABLE_BOUNDS.daily),
    battle: mergeGroup(DEFAULT_TUNABLES.battle, o.battle, TUNABLE_BOUNDS.battle),
    economy: mergeGroup(DEFAULT_TUNABLES.economy, o.economy, TUNABLE_BOUNDS.economy),
    boss: mergeGroup(DEFAULT_TUNABLES.boss, o.boss, TUNABLE_BOUNDS.boss),
    heroQuest: mergeGroup(
      DEFAULT_TUNABLES.heroQuest,
      o.heroQuest,
      TUNABLE_BOUNDS.heroQuest
    ),
    diamondStore: mergeGroup(
      DEFAULT_TUNABLES.diamondStore,
      o.diamondStore,
      TUNABLE_BOUNDS.diamondStore
    ),
    season: mergeGroup(DEFAULT_TUNABLES.season, o.season, TUNABLE_BOUNDS.season),
  };
}

/**
 * The live, merged game tunables. React-cached per request so the many
 * callers within a single request/transaction share one DB read.
 */
export const getTunables = cache(async (): Promise<GameTunables> => {
  const row = await prisma.gameConfig.findUnique({ where: { id: "singleton" } });
  return mergeTunables(row?.data);
});
