import { describe, expect, it } from "vitest";
import {
  HERO_QUESTS,
  HERO_QUEST_FORTUNES,
  HERO_QUEST_HOURS,
  HERO_QUEST_REWARD_RESOURCES,
  heroQuestByTier,
  heroQuestDurationMs,
  heroQuestFortuneByKey,
  heroQuestHours,
  heroQuestCityCostFactor,
  heroQuestTurnCost,
  heroQuestUnlocked,
  heroQuestXp,
  heroQuestReward,
  rollHeroQuestFortune,
  rollHeroQuestReward,
} from "@/lib/game/heroQuests";
import { MAX_CITIES } from "@/lib/game/constants";

/** A deterministic stand-in for the CSPRNG, cycling a fixed sequence. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("catalog", () => {
  it("has one quest per city tier", () => {
    expect(HERO_QUESTS).toHaveLength(MAX_CITIES);
    expect(HERO_QUEST_HOURS).toHaveLength(MAX_CITIES);
    HERO_QUESTS.forEach((q, i) => expect(q.tier).toBe(i + 1));
  });

  it("uses unique keys — they are React keys and copy anchors", () => {
    expect(new Set(HERO_QUESTS.map((q) => q.key)).size).toBe(HERO_QUESTS.length);
  });

  it("rejects tiers outside the catalog instead of clamping them", () => {
    // startHeroQuest trusts this to reject a hand-rolled POST, so an
    // out-of-range tier must be undefined, not the nearest quest.
    expect(heroQuestByTier(0)).toBeUndefined();
    expect(heroQuestByTier(MAX_CITIES + 1)).toBeUndefined();
    expect(heroQuestByTier(-3)).toBeUndefined();
    expect(heroQuestByTier(Number.NaN)).toBeUndefined();
    expect(heroQuestByTier(Infinity)).toBeUndefined();
    expect(heroQuestByTier(1)).toBeDefined();
    expect(heroQuestByTier(MAX_CITIES)).toBeDefined();
  });

  it("gates each tier behind that many cities", () => {
    expect(heroQuestUnlocked(1, 1)).toBe(true);
    expect(heroQuestUnlocked(5, 4)).toBe(false);
    expect(heroQuestUnlocked(5, 5)).toBe(true);
    expect(heroQuestUnlocked(MAX_CITIES, MAX_CITIES)).toBe(true);
  });

  it("runs longer the higher the tier", () => {
    for (let t = 2; t <= MAX_CITIES; t++) {
      expect(heroQuestHours(t)).toBeGreaterThan(heroQuestHours(t - 1));
    }
    expect(heroQuestDurationMs(1)).toBe(3_600_000);
  });

  it("climbs in item and potion odds with the tier", () => {
    for (let i = 1; i < HERO_QUESTS.length; i++) {
      expect(HERO_QUESTS[i].itemChance).toBeGreaterThan(HERO_QUESTS[i - 1].itemChance);
      expect(HERO_QUESTS[i].potionChance).toBeGreaterThan(HERO_QUESTS[i - 1].potionChance);
    }
    HERO_QUESTS.forEach((q) => {
      expect(q.itemChance).toBeLessThanOrEqual(1);
      expect(q.potionChance).toBeLessThanOrEqual(1);
    });
  });
});

describe("turn cost", () => {
  it("charges more per hour for a short run than a long one", () => {
    // The whole reason to unlock the long rungs: turn efficiency.
    const perHour = (t: number) => heroQuestTurnCost(t) / heroQuestHours(t);
    for (let t = 2; t <= MAX_CITIES; t++) {
      expect(perHour(t)).toBeLessThan(perHour(t - 1));
    }
  });

  it("always costs at least one turn", () => {
    for (let t = 1; t <= MAX_CITIES; t++) {
      expect(heroQuestTurnCost(t)).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(heroQuestTurnCost(t))).toBe(true);
    }
  });

  it("still costs more in absolute turns for a longer run", () => {
    for (let t = 2; t <= MAX_CITIES; t++) {
      expect(heroQuestTurnCost(t)).toBeGreaterThan(heroQuestTurnCost(t - 1));
    }
  });

  it("leaves a one-city empire's board exactly where it was", () => {
    // The 2026-08-14 surcharge is aimed at the late game, where the haul has
    // grown ×2,642 against a price that had not moved at all. A beginner's board
    // is untouched, and that is deliberate: at one city the boss already
    // out-earns the quest several times over per turn.
    expect(heroQuestCityCostFactor(1)).toBe(1);
    for (let t = 1; t <= MAX_CITIES; t++) {
      expect(heroQuestTurnCost(t, 1)).toBe(heroQuestTurnCost(t));
    }
  });

  it("prices a quest against the empire sending it, not the rung alone", () => {
    // The structural fix: the haul is keyed to the city count, so the price has
    // to be too, exactly as the boss's turn cost is (BOSS_TURN_COST_PER_CITY).
    for (let cities = 2; cities <= MAX_CITIES; cities++) {
      expect(heroQuestCityCostFactor(cities)).toBeGreaterThan(
        heroQuestCityCostFactor(cities - 1)
      );
      expect(heroQuestTurnCost(1, cities)).toBeGreaterThan(
        heroQuestTurnCost(1, cities - 1)
      );
    }
    // A ten-city empire pays several times over for the same errand.
    expect(heroQuestTurnCost(MAX_CITIES, MAX_CITIES)).toBeGreaterThan(
      heroQuestTurnCost(MAX_CITIES) * 5
    );
  });

  it("keeps the long rungs the turn-efficient ones at every city count", () => {
    // The surcharge is a flat factor, so rule 3 in the header survives it: what
    // unlocking a long run buys is still turns per hour, at one city and at ten.
    for (const cities of [1, 5, MAX_CITIES]) {
      const perHour = (t: number) => heroQuestTurnCost(t, cities) / heroQuestHours(t);
      for (let t = 2; t <= MAX_CITIES; t++) {
        expect(perHour(t)).toBeLessThan(perHour(t - 1));
      }
    }
  });
});

describe("hero XP", () => {
  it("climbs with the tier, unlike the resource haul", () => {
    for (let t = 2; t <= MAX_CITIES; t++) {
      expect(heroQuestXp(t)).toBeGreaterThan(heroQuestXp(t - 1));
    }
  });
});

describe("the fortune table", () => {
  it("has strictly increasing, non-overlapping bands", () => {
    for (const f of HERO_QUEST_FORTUNES) {
      expect(f.min).toBeLessThan(f.max);
      expect(f.weight).toBeGreaterThan(0);
    }
    for (let i = 1; i < HERO_QUEST_FORTUNES.length; i++) {
      expect(HERO_QUEST_FORTUNES[i].min).toBeGreaterThan(HERO_QUEST_FORTUNES[i - 1].max);
    }
  });

  it("keeps an expected value near the ~1.24 the payouts were tuned from", () => {
    // Changing a weight silently changes the game's whole quest income. This is
    // the guard rail on that.
    const total = HERO_QUEST_FORTUNES.reduce((s, f) => s + f.weight, 0);
    const ev = HERO_QUEST_FORTUNES.reduce(
      (s, f) => s + (f.weight / total) * ((f.min + f.max) / 2),
      0
    );
    expect(ev).toBeGreaterThan(1.15);
    expect(ev).toBeLessThan(1.35);
  });

  it("draws the first band on a zero roll and the last on a roll near one", () => {
    expect(rollHeroQuestFortune(seeded([0, 0])).fortune.key).toBe(
      HERO_QUEST_FORTUNES[0].key
    );
    expect(rollHeroQuestFortune(seeded([0.999999, 0])).fortune.key).toBe(
      HERO_QUEST_FORTUNES[HERO_QUEST_FORTUNES.length - 1].key
    );
  });

  it("always returns a multiplier inside the band it drew", () => {
    for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const { fortune, multiplier } = rollHeroQuestFortune(seeded([roll, 0.5]));
      expect(multiplier).toBeGreaterThanOrEqual(fortune.min);
      expect(multiplier).toBeLessThanOrEqual(fortune.max);
    }
  });

  it("falls back to the plain band for an unknown stored key", () => {
    // Old rows and hand-edited data must not crash the homecoming line.
    expect(heroQuestFortuneByKey("nonsense").key).toBe("plain");
    expect(heroQuestFortuneByKey("legend").key).toBe("legend");
  });
});

describe("the haul", () => {
  it("pays the same per hour whichever rung you picked", () => {
    // Rule 3 of the feature: the tier buys turn efficiency and loot odds, never
    // a better rate. A one-hour run must not become obsolete.
    const perHour = (t: number) => heroQuestReward(t, 5, 1).gold / heroQuestHours(t);
    const first = perHour(1);
    for (let t = 2; t <= MAX_CITIES; t++) {
      // Relative, not absolute: the haul is rounded to whole hundreds, so a
      // one-hour run carries up to 50 gold of rounding on its own per-hour rate.
      expect(Math.abs(perHour(t) - first) / first).toBeLessThan(0.01);
    }
  });

  it("scales with the empire's cities", () => {
    expect(heroQuestReward(1, 2, 1).gold).toBeGreaterThan(heroQuestReward(1, 1, 1).gold);
  });

  it("grows with the season day for resources but not for people", () => {
    const day1 = heroQuestReward(3, 3, 1);
    const day60 = heroQuestReward(3, 3, 60);
    expect(day60.gold).toBeGreaterThan(day1.gold);
    // People are resources one step removed (a citizen becomes a mine slave), so
    // the seasonal factor deliberately does not touch them.
    expect(day60.citizens).toBe(day1.citizens);
    expect(day60.slaves).toBe(day1.slaves);
  });

  it("never pays diamonds — that would undercut the store", () => {
    expect(Object.keys(heroQuestReward(10, 10, 60))).not.toContain("diamonds");
  });

  it("honours the admin multiplier, including a zero kill switch", () => {
    const base = heroQuestReward(4, 4, 10, 1);
    expect(heroQuestReward(4, 4, 10, 2).gold).toBeGreaterThan(base.gold);
    expect(heroQuestReward(4, 4, 10, 0).gold).toBe(0);
  });

  it("never returns a negative amount", () => {
    const roll = rollHeroQuestReward(1, 1, 1, 0, seeded([0, 0, 0, 0, 0, 0, 0, 0]));
    for (const key of HERO_QUEST_REWARD_RESOURCES) {
      expect(roll.reward[key]).toBeGreaterThanOrEqual(0);
    }
    expect(roll.reward.citizens).toBeGreaterThanOrEqual(0);
    expect(roll.reward.slaves).toBeGreaterThanOrEqual(0);
  });

  it("never marks the same resource as both the rich and the lean slot", () => {
    // `lean` is drawn out of the remaining slots; if that ever collapsed, one
    // resource would silently get both multipliers.
    for (let a = 0; a < 20; a++) {
      for (let b = 0; b < 20; b++) {
        const random = seeded([0.5, 0.5, a / 20, b / 20, 0.5, 0.5, 0.5, 0.5]);
        const roll = rollHeroQuestReward(5, 5, 5, 1, random);
        const values = HERO_QUEST_REWARD_RESOURCES.map((k) => roll.reward[k]);
        // With every wobble pinned at 0.5 the rich slot is the max and the lean
        // the min, so they can only coincide if the picks collided.
        expect(Math.max(...values)).toBeGreaterThan(Math.min(...values));
      }
    }
  });

  it("pays a legendary run several times a grim one", () => {
    const grim = rollHeroQuestReward(5, 5, 5, 1, seeded([0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
    const legend = rollHeroQuestReward(
      5,
      5,
      5,
      1,
      seeded([0.999999, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
    );
    expect(legend.fortune.key).toBe("legend");
    expect(grim.fortune.key).toBe("grim");
    expect(legend.reward.gold).toBeGreaterThan(grim.reward.gold * 2);
  });

  it("damps luck on people — a legendary run must not be the way to grow a city", () => {
    const grim = rollHeroQuestReward(5, 5, 5, 1, seeded([0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
    const legend = rollHeroQuestReward(
      5,
      5,
      5,
      1,
      seeded([0.999999, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
    );
    const goldRatio = legend.reward.gold / grim.reward.gold;
    const peopleRatio = legend.reward.citizens / grim.reward.citizens;
    expect(peopleRatio).toBeLessThan(goldRatio);
  });
});
