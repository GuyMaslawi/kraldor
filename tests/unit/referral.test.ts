import { describe, expect, it } from "vitest";
import {
  REFERRAL_GOAL_CITIES,
  REFERRAL_JOINER_PURSE,
  REFERRAL_NAME_MAX_CITIES,
  REFERRAL_REFERRER_PURSE,
  joinerReward,
  mayNameReferrer,
  referralEarned,
  referrerReward,
} from "@/lib/game/referral";
import { MAX_CITIES } from "@/lib/game/constants";
import { STREAK_WEEK_DIAMONDS } from "@/lib/game/streak";

describe("the referral deal", () => {
  it("pays for real play, not for a signup", () => {
    // The whole design. One city is registration; the goal has to be somewhere
    // a bot would not casually arrive.
    expect(REFERRAL_GOAL_CITIES).toBeGreaterThan(2);
    expect(referralEarned(1)).toBe(false);
    expect(referralEarned(REFERRAL_GOAL_CITIES - 1)).toBe(false);
    expect(referralEarned(REFERRAL_GOAL_CITIES)).toBe(true);
    expect(referralEarned(MAX_CITIES)).toBe(true);
  });

  it("treats junk city counts as not earned", () => {
    expect(referralEarned(0)).toBe(false);
    expect(referralEarned(-4)).toBe(false);
  });

  it("closes the naming window before the goal is reached", () => {
    // The window has to shut before the reward is due, or a player could shop
    // their loyalty around after the fact.
    expect(REFERRAL_NAME_MAX_CITIES).toBeLessThan(REFERRAL_GOAL_CITIES);
    expect(mayNameReferrer(1)).toBe(true);
    expect(mayNameReferrer(REFERRAL_NAME_MAX_CITIES)).toBe(true);
    expect(mayNameReferrer(REFERRAL_NAME_MAX_CITIES + 1)).toBe(false);
    expect(mayNameReferrer(MAX_CITIES)).toBe(false);
  });
});

describe("the purses", () => {
  it("pays the referrer more diamonds than the newcomer", () => {
    const diamonds = (purse: readonly { kind: string; amount: number }[]) =>
      purse.find((r) => r.kind === "diamonds")?.amount ?? 0;
    expect(diamonds(REFERRAL_REFERRER_PURSE)).toBeGreaterThan(
      diamonds(REFERRAL_JOINER_PURSE)
    );
  });

  it("gives the newcomer what a young empire actually needs", () => {
    const kinds = REFERRAL_JOINER_PURSE.map((r) => r.kind);
    expect(kinds).toContain("turns");
    expect(kinds).toContain("citizens");
  });

  it("keeps the diamond payout in the same league as the weekly muster", () => {
    // A referral has to be worth chasing without becoming the cheapest route to
    // the store's own goods. Both halves are within a few weeks of the roll.
    const diamonds = (purse: readonly { kind: string; amount: number }[]) =>
      purse.find((r) => r.kind === "diamonds")?.amount ?? 0;
    for (const purse of [REFERRAL_REFERRER_PURSE, REFERRAL_JOINER_PURSE]) {
      expect(diamonds(purse)).toBeGreaterThan(STREAK_WEEK_DIAMONDS);
      expect(diamonds(purse)).toBeLessThan(STREAK_WEEK_DIAMONDS * 5);
    }
  });

  it("leaves diamonds off the city curve on both halves", () => {
    // A late-game referrer must not be paid a fortune in diamonds for the same
    // act a new one is paid 75 for.
    const diamonds = (rewards: ReturnType<typeof referrerReward>) =>
      rewards.find((r) => r.kind === "diamonds")!.amount;
    expect(diamonds(referrerReward(MAX_CITIES))).toBe(
      diamonds(referrerReward(1))
    );
    expect(diamonds(joinerReward(MAX_CITIES))).toBe(diamonds(joinerReward(1)));
  });

  it("scales the resource half with the claimer's own empire", () => {
    const gold = (rewards: ReturnType<typeof referrerReward>) =>
      rewards.find((r) => r.kind === "gold")?.amount ?? 0;
    expect(gold(referrerReward(MAX_CITIES))).toBeGreaterThan(
      gold(referrerReward(1))
    );
  });

  it("pays both halves something at every empire size", () => {
    for (let cities = 1; cities <= MAX_CITIES; cities += 1) {
      for (const rewards of [referrerReward(cities), joinerReward(cities)]) {
        expect(rewards.length).toBeGreaterThan(0);
        for (const line of rewards) expect(line.amount).toBeGreaterThan(0);
      }
    }
  });
});
