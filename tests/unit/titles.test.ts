import { describe, expect, it } from "vitest";
import {
  TITLES,
  TITLE_BY_KEY,
  TITLE_PRICE,
  buildTitlesState,
  titleUnlocked,
  wornTitle,
} from "@/lib/game/titles";
import type { AchievementStats } from "@/lib/game/achievements";
import { MAX_CITIES } from "@/lib/game/constants";

/** A stats snapshot with everything at zero — nothing earned. */
const NOTHING: AchievementStats = {
  attacksLaunched: 0,
  attackWins: 0,
  defenseWins: 0,
  soldiersSlain: 0,
  soldiersEnslaved: 0,
  goldPlundered: 0,
  spyMissions: 0,
  spySuccesses: 0,
  heroLevel: 1,
  heroResets: 0,
  heroItems: 0,
  epicItems: 0,
  legendaryItems: 0,
  equippedItems: 0,
  gold: 0,
  wood: 0,
  iron: 0,
  stone: 0,
  diamonds: 0,
  turns: 0,
  bankBalance: 0,
  bankDeposits: 0,
  interestPayments: 0,
  minesBuilt: 0,
  minMineLevel: 0,
  maxMineLevel: 0,
  minStorageLevel: 0,
  cities: 1,
  citizenGrowthLevel: 1,
  minUpgradeLevel: 1,
  soldiers: 0,
  spies: 0,
  mineSlaves: 0,
  attackWeapons: 0,
  defenseWeapons: 0,
  spyWeapons: 0,
  distinctWeapons: 0,
  totalWeapons: 0,
  minUnlockedTier: 0,
  inGuild: false,
  isGuildLeader: false,
  bossWins: 0,
  distinctBossesBeaten: 0,
  miniGameWins: 0,
  messagesSent: 0,
  isRankOne: false,
};

/** A snapshot that clears every earned condition in the catalog. */
const EVERYTHING: AchievementStats = {
  ...NOTHING,
  attackWins: 10_000,
  spySuccesses: 10_000,
  defenseWins: 10_000,
  distinctBossesBeaten: MAX_CITIES,
  cities: MAX_CITIES,
  heroResets: 10,
  legendaryItems: 20,
  heroLevel: 100,
};

const NONE = new Set<string>();

describe("the title catalog", () => {
  it("has unique keys and labels", () => {
    const keys = TITLES.map((x) => x.key);
    const labels = TITLES.map((x) => x.label);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps the two kinds strictly apart", () => {
    // The line the whole feature rests on: an earned title must never be
    // obtainable for money, and a bought one must never carry a condition that
    // could make it look earned.
    for (const title of TITLES) {
      if (title.kind === "earned") {
        expect(title.price).toBe(0);
        expect(title.condition).toBeTypeOf("function");
      } else {
        expect(title.price).toBeGreaterThan(0);
        expect(title.condition).toBeUndefined();
      }
    }
  });

  it("offers a real shelf of each kind", () => {
    expect(TITLES.filter((x) => x.kind === "earned").length).toBeGreaterThanOrEqual(5);
    expect(TITLES.filter((x) => x.kind === "bought").length).toBeGreaterThanOrEqual(4);
  });

  it("prices the whole shop shelf the same", () => {
    // Was "well under the VIP seal", on the reasoning that a title is the cheap
    // cosmetic tier and must not compete with the headline purchase. Replaced
    // 2026-08-15 by one flat TITLE_PRICE at parity with VIP_COST — see the note
    // over the constant. What still has to hold is that no bought title drifts
    // off it: a shelf of identical products at different prices only teaches
    // players that the cheap one is the lesser word.
    for (const title of TITLES.filter((x) => x.kind === "bought")) {
      expect(title.price).toBe(TITLE_PRICE);
    }
  });
});

describe("titleUnlocked", () => {
  it("locks every earned title for a fresh empire", () => {
    for (const title of TITLES.filter((x) => x.kind === "earned")) {
      expect(titleUnlocked(title, NOTHING, NONE)).toBe(false);
    }
  });

  it("unlocks every earned title for an empire that has done it all", () => {
    for (const title of TITLES.filter((x) => x.kind === "earned")) {
      expect(titleUnlocked(title, EVERYTHING, NONE)).toBe(true);
    }
  });

  it("locks an earned title when the snapshot is missing entirely", () => {
    // getEmpireStats returns null for an empire it cannot read. Failing closed
    // matters: the alternative hands out every earned title on a bad query.
    for (const title of TITLES.filter((x) => x.kind === "earned")) {
      expect(titleUnlocked(title, null, NONE)).toBe(false);
    }
  });

  it("gates a bought title on its receipt, never on play", () => {
    const bought = TITLES.find((x) => x.kind === "bought")!;
    expect(titleUnlocked(bought, EVERYTHING, NONE)).toBe(false);
    expect(titleUnlocked(bought, null, new Set([bought.key]))).toBe(true);
  });

  it("does not let owning one bought title unlock another", () => {
    const [first, second] = TITLES.filter((x) => x.kind === "bought");
    expect(titleUnlocked(second, null, new Set([first.key]))).toBe(false);
  });
});

describe("wornTitle", () => {
  it("resolves a live key", () => {
    expect(wornTitle(TITLES[0].key)?.label).toBe(TITLES[0].label);
  });

  it("resolves nothing at all for absent, empty or retired keys", () => {
    // A raw key printed on a dossier would be the visible failure mode; null is
    // the invisible one, which is the right choice for a cosmetic.
    expect(wornTitle(null)).toBeNull();
    expect(wornTitle(undefined)).toBeNull();
    expect(wornTitle("")).toBeNull();
    expect(wornTitle("a_title_that_was_retired")).toBeNull();
  });
});

describe("buildTitlesState", () => {
  it("shows a fresh empire everything locked and nothing worn", () => {
    const state = buildTitlesState(NOTHING, NONE, null, 0);
    expect(state.titles).toHaveLength(TITLES.length);
    expect(state.titles.every((x) => !x.unlocked)).toBe(true);
    expect(state.worn).toBeNull();
    expect(state.earnedCount).toBe(0);
    expect(state.ownedCount).toBe(0);
  });

  it("counts earned and owned separately", () => {
    const bought = TITLES.find((x) => x.kind === "bought")!;
    const state = buildTitlesState(EVERYTHING, new Set([bought.key]), null, 500);
    expect(state.earnedCount).toBe(
      TITLES.filter((x) => x.kind === "earned").length
    );
    expect(state.ownedCount).toBe(1);
  });

  it("marks the worn title, and only it", () => {
    const key = TITLES[0].key;
    const state = buildTitlesState(EVERYTHING, NONE, key, 0);
    expect(state.worn).toBe(key);
    expect(state.titles.filter((x) => x.worn).map((x) => x.key)).toEqual([key]);
  });

  it("reads a retired worn key as nothing worn", () => {
    // Must agree with wornTitle, or the screen would show nothing selected
    // while the dossier still printed something.
    const state = buildTitlesState(EVERYTHING, NONE, "a_title_that_was_retired", 0);
    expect(state.worn).toBeNull();
    expect(state.titles.some((x) => x.worn)).toBe(false);
    expect(wornTitle("a_title_that_was_retired")).toBeNull();
  });

  it("never marks an earned title as owned", () => {
    // `owned` drives the shop's "you have this" state; an earned title showing
    // as owned would put a price and a purchase button on a feat.
    const state = buildTitlesState(EVERYTHING, NONE, null, 0);
    for (const view of state.titles.filter((x) => x.kind === "earned")) {
      expect(view.owned).toBe(false);
    }
    expect(TITLE_BY_KEY.size).toBe(TITLES.length);
  });
});
