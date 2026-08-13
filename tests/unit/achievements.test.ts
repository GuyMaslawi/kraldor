import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  GLORY_KEYS,
  GLORY_PRIZE,
  type AchievementStats,
  buildAchievementsState,
  gloryPrize,
  isAchievementReached,
} from "@/lib/game/achievements";
import { REWARD_LABEL } from "@/lib/game/rewards";
import { HERO_MAX_LEVEL } from "@/lib/game/hero";
import { MAX_WEAPON_TIER, WEAPONS } from "@/lib/game/weapons";

/**
 * Only the fields a case cares about. Everything else reads as zero through
 * `achievementProgress`, which fails closed on an absent stat.
 */
const stats = (over: Partial<AchievementStats>) => over as AchievementStats;

const byKey = (key: string) => {
  const a = ACHIEVEMENTS.find((x) => x.key === key);
  if (!a) throw new Error(`no achievement ${key}`);
  return a;
};

describe("hero level ladder", () => {
  const hero100 = byKey(`herolvl_${HERO_MAX_LEVEL}`);

  it("unlocks at the cap", () => {
    expect(isAchievementReached(hero100, stats({ heroLevel: HERO_MAX_LEVEL, heroResets: 0 }))).toBe(true);
    expect(isAchievementReached(hero100, stats({ heroLevel: HERO_MAX_LEVEL - 1, heroResets: 0 }))).toBe(false);
  });

  it("survives a prestige — the reset must not un-reach what was reached", () => {
    // The reported bug: a player climbed to 100, reset (which writes level back
    // to 1), and both the reward and the world record vanished — the condition
    // read the raw column, so it was no longer true and could never be made
    // true again short of a second full climb.
    const afterReset = stats({ heroLevel: 1, heroResets: 1 });
    expect(isAchievementReached(hero100, afterReset)).toBe(true);
    for (const goal of [5, 10, 25, 50, 75]) {
      expect(isAchievementReached(byKey(`herolvl_${goal}`), afterReset)).toBe(true);
    }
  });

  it("shows the ladder as complete after a reset instead of back at 1/100", () => {
    const state = buildAchievementsState(
      stats({ heroLevel: 1, heroResets: 2 }),
      new Set<string>()
    );
    const item = state.items.find((i) => i.key === hero100.key)!;
    expect(item.unlocked).toBe(true);
    expect(item.progress).toBe(item.goal);
  });
});

describe("world-record capstones", () => {
  it("names only conditions that exist in the ladder", () => {
    for (const key of GLORY_KEYS) expect(() => byKey(key)).not.toThrow();
  });

  it("is built on conditions that can never be lost once met", () => {
    // A capstone that stops being true is a world record that disappears from
    // the board (see src/server/gloryBoard.ts — the stamp is only written when
    // the condition holds at page load). Every key here must therefore rest on
    // a stat that only ever rises. The hero one is the trap: `heroLevel` drops
    // on prestige, so it has to read the effective level.
    const peak = stats({
      cities: 10,
      citizenGrowthLevel: 100,
      heroLevel: HERO_MAX_LEVEL,
      heroResets: 0,
      maxMineLevel: 250,
      minMineLevel: 250,
      // Counted, not written: the foundry grew from 30 tiers to 35 and a
      // hard-coded 90 here would have quietly stopped being "peak".
      distinctWeapons: WEAPONS.length,
      totalWeapons: WEAPONS.length,
      // The weapon capstone reads the tier ladder, not the model count. It is
      // monotonic in play — the unlock write is guarded `lt: targetTier` (see
      // src/server/actions/game.ts) — which is what qualifies it for this board.
      minUnlockedTier: MAX_WEAPON_TIER,
    });
    const afterPrestige = { ...peak, heroLevel: 1, heroResets: 1 };
    for (const key of GLORY_KEYS) {
      expect(isAchievementReached(byKey(key), peak), key).toBe(true);
      expect(isAchievementReached(byKey(key), afterPrestige), key).toBe(true);
    }
  });
});

describe("the world-record purse", () => {
  it("asks for every weapon tier the foundry actually has", () => {
    // The regression: the foundry grew from 30 tiers to 35 while both weapon
    // ladders kept their old literals, so the `unlocks` chain called tier 30
    // "כל הדרגות פתוחות" and the world record asked for 90 of 105 models. Both
    // ceilings are counted now — and the record is the tier ladder, because 35
    // is the figure the player meets in the foundry and 105 is not.
    expect(GLORY_KEYS).toContain(`unlocks_${MAX_WEAPON_TIER}`);
    expect(byKey(`arsenal_${WEAPONS.length}`).goal).toBe(WEAPONS.length);
  });

  it("pays every capstone on the board", () => {
    // A capstone with no purse draws a plaque with no prize band — legal (see
    // `gloryPrize`), but not something to arrive at by forgetting a line.
    for (const key of GLORY_KEYS) expect(gloryPrize(key).length, key).toBeGreaterThan(0);
  });

  it("prices nothing the board does not show", () => {
    // A purse on a key that fell off GLORY_KEYS is money nobody can win, and it
    // would never be noticed: `settleGloryPrizes` only walks GLORY_KEYS.
    for (const key of Object.keys(GLORY_PRIZE)) expect(GLORY_KEYS, key).toContain(key);
  });

  it("names one amount per reward kind, all positive", () => {
    for (const key of GLORY_KEYS) {
      const lines = gloryPrize(key);
      const kinds = lines.map((l) => l.kind);
      expect(new Set(kinds).size, key).toBe(kinds.length);
      for (const line of lines) {
        expect(line.amount, `${key}/${line.kind}`).toBeGreaterThan(0);
        // The label is a dictionary key the inbox receipt renders through t().
        expect(REWARD_LABEL[line.kind], `${key}/${line.kind}`).toBeTruthy();
      }
    }
  });

  it("rises with how hard the record is to take first", () => {
    // GLORY_PRIZE is declared in the order the five are expected to fall — which
    // is deliberately NOT the order GLORY_KEYS draws them in (that one is the
    // arc of a run). Diamonds are the rationed half of a purse, so they are the
    // half the ladder is checked on: an easier record paying more of them than a
    // harder one is the mistake this catches.
    const diamonds = Object.keys(GLORY_PRIZE).map(
      (key) => gloryPrize(key).find((l) => l.kind === "diamonds")?.amount ?? 0
    );
    const order = Object.keys(GLORY_PRIZE);
    for (let i = 1; i < diamonds.length; i += 1) {
      expect(diamonds[i], order[i]).toBeGreaterThan(diamonds[i - 1]);
    }
  });
});
