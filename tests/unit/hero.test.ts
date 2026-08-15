import { describe, expect, it } from "vitest";
import * as hero from "@/lib/game/hero";
import {
  HERO_BAG_CAPACITY,
  HERO_DAMAGE_PER_LOST_DEFENSE,
  HERO_MAX_HEALTH,
  HERO_MAX_LEVEL,
  HERO_RESET_POINTS,
  HERO_REVIVE_MS,
  EXTRA_WEIGHTS,
  POINTS_PER_LEVEL,
  ITEM_LEVELS,
  PRIMARY_WEIGHT,
  MINOR_EXTRA_WEIGHT,
  HERO_POWER_STATS,
  HERO_PERCENT_STATS,
  HERO_CADENCE_META,
  HERO_CADENCE_ORDER,
  HERO_FLAT_CADENCE,
  HERO_FLAT_STATS,
  HERO_STAT_META,
  UPDATES_PER_DAY,
  flatStatPerDay,
  flatStatsWithCadence,
  POWER_STAT_FOR,
  type HeroStat,
  RARITY_ORDER,
  SLOT_META,
  SLOT_ORDER,
  UPGRADE_COST_AT_LEVEL_10,
  UPGRADE_COST_AT_LEVEL_100,
  MAX_LEVEL_GAP_XP_FACTOR,
  MIN_LEVEL_GAP_XP_FACTOR,
  MAX_MATCHUP_XP_FACTOR,
  MIN_MATCHUP_XP_FACTOR,
  RESET_LEVEL_EQUIV,
  matchupXpFactor,
  applyHeroXp,
  attackWinXp,
  effectiveHeroLevel,
  levelGapXpFactor,
  minAttackWinXp,
  MAX_WINS_PER_LEVEL,
  resetGapXpFactor,
  RESET_GAP_XP_DECAY,
  MIN_RESET_GAP_XP_FACTOR,
  atSetCeiling,
  canEquipItem,
  canUpgradeItem,
  damagedHealth,
  flatCurveGrowth,
  heroPointPool,
  heroPointsHeld,
  heroResetPoints,
  heroReviveAt,
  isHeroDead,
  itemBonusLines,
  itemStatBonus,
  itemUpgradeCost,
  nextTierLevel,
  slotGrants,
  slotStatIsFlat,
  slotPrimaryStat,
  tierForLevel,
  xpToNextLevel,
} from "@/lib/game/hero";
import {
  DAILY_UPDATE_TIMES,
  TICKS_PER_DAY,
  TURNS_UPGRADE_MAX_LEVEL,
} from "@/lib/game/constants";

const alive = { health: HERO_MAX_HEALTH, diedAt: null };

describe("levelling", () => {
  it("needs more XP for each level", () => {
    for (let l = 2; l < HERO_MAX_LEVEL; l++) {
      expect(xpToNextLevel(l)).toBeGreaterThanOrEqual(xpToNextLevel(l - 1));
    }
  });

  it("banks XP without levelling when it is not enough", () => {
    const next = applyHeroXp({ level: 1, xp: 0 }, 1);
    expect(next.level).toBe(1);
    expect(next.xp).toBe(1);
    expect(next.pointsGained).toBe(0);
  });

  it("awards a point per level gained", () => {
    const huge = applyHeroXp({ level: 1, xp: 0 }, 10_000_000);
    expect(huge.level).toBeGreaterThan(1);
    expect(huge.pointsGained).toBe(huge.level - 1);
  });

  it("stops dead at the level cap and never overflows XP past it", () => {
    const capped = applyHeroXp({ level: HERO_MAX_LEVEL, xp: 0 }, 1e12);
    expect(capped.level).toBe(HERO_MAX_LEVEL);
    expect(capped.pointsGained).toBe(0);
  });

  it("ignores a zero or negative award instead of going backwards", () => {
    const zero = applyHeroXp({ level: 5, xp: 10 }, 0);
    expect(zero.level).toBe(5);
    expect(zero.xp).toBe(10);
    const negative = applyHeroXp({ level: 5, xp: 10 }, -100);
    expect(negative.level).toBe(5);
    expect(negative.xp).toBeGreaterThanOrEqual(0);
  });
});

describe("battle XP", () => {
  const even = { level: 30, resets: 0 };
  // An even fight on both axes: same standing, same power.
  const evenXp = attackWinXp(even, even, 100_000, 100_000);

  it("pays more the higher above you the target stands", () => {
    const below = attackWinXp(even, { level: 10, resets: 0 }, 100_000, 100_000);
    const above = attackWinXp(even, { level: 60, resets: 0 }, 100_000, 100_000);
    expect(below).toBeLessThan(evenXp);
    expect(evenXp).toBeLessThan(above);
  });

  it("pays a small floor rather than nothing for stomping a beginner", () => {
    const beginner = attackWinXp(even, { level: 1, resets: 0 }, 100_000, 1_000);
    expect(beginner).toBeGreaterThan(0);
    expect(beginner).toBeLessThan(evenXp / 2);
  });

  it("pays a reset level-1 foe like the veteran he is", () => {
    const rookie = { level: 1, resets: 0 };
    const prestiged = { level: 1, resets: 1 };
    const power = 100_000;
    expect(attackWinXp(even, prestiged, power, power)).toBeGreaterThan(
      attackWinXp(even, rookie, power, power) * 4
    );
    // …and better than an evenly-matched foe of your own standing.
    expect(attackWinXp(even, prestiged, power, power)).toBeGreaterThan(evenXp);
  });

  it("counts every reset on both sides through the effective level", () => {
    expect(effectiveHeroLevel(1, 1)).toBe(1 + RESET_LEVEL_EQUIV);
    expect(effectiveHeroLevel(50, 2)).toBe(50 + 2 * RESET_LEVEL_EQUIV);
    // Your own prestige raises the bar: the same target is worth less to a
    // hero who has already climbed the ladder twice.
    const target = { level: 40, resets: 0 };
    const veteran = { level: 40, resets: 2 };
    expect(attackWinXp(veteran, target, 100_000, 100_000)).toBeLessThan(
      attackWinXp(target, target, 100_000, 100_000)
    );
  });

  it("keeps the gap factor inside its band, ×1 at equal standing", () => {
    expect(levelGapXpFactor(50, 50)).toBeCloseTo(1);
    expect(levelGapXpFactor(50, 1)).toBeGreaterThanOrEqual(MIN_LEVEL_GAP_XP_FACTOR);
    expect(levelGapXpFactor(1, 5_000)).toBe(MAX_LEVEL_GAP_XP_FACTOR);
    expect(levelGapXpFactor(0, 50)).toBe(MIN_LEVEL_GAP_XP_FACTOR);
  });

  it("keeps the matchup factor inside its band, ×1.7 at equal power", () => {
    expect(matchupXpFactor(100_000, 100_000)).toBeCloseTo(1.7);
    expect(matchupXpFactor(100_000, 0)).toBe(MIN_MATCHUP_XP_FACTOR);
    expect(matchupXpFactor(0, 100_000)).toBe(MIN_MATCHUP_XP_FACTOR);
    expect(matchupXpFactor(100_000, 100_000_000)).toBe(MAX_MATCHUP_XP_FACTOR);
    // Monotonic: a tougher opponent never pays less.
    for (const r of [1e-6, 1e-3, 0.05, 0.3, 0.8]) {
      expect(matchupXpFactor(1e9, r * 1e9)).toBeLessThan(matchupXpFactor(1e9, r * 2e9));
    }
  });

  it("reads the power gap by orders of magnitude, not as a percentage", () => {
    // The whole point of the cube root: power is spread geometrically, so the
    // ratios real battles actually produce (~0.015 at the median win) used to
    // land on the floor and every fight paid the same minimum.
    expect(matchupXpFactor(1e9, 0.015 * 1e9)).toBeGreaterThan(2 * MIN_MATCHUP_XP_FACTOR);
    // A genuinely helpless target — a bot garrison, or an empire with no army
    // left — still pays close to the floor, so farming one is not a ladder.
    expect(matchupXpFactor(1e13, 5e5)).toBeLessThan(MIN_MATCHUP_XP_FACTOR * 1.2);
  });

  it("lets a low-level attacker earn a real share of a level off a stronger foe", () => {
    // The reported bug: level 30 beats level 70 and the XP was a rounding
    // error. The level gap pays ×2 there — that must not be cancelled by a
    // floored matchup term just because the win required an army advantage.
    const me = { level: 30, resets: 0 };
    const bigger = { level: 70, resets: 0 };
    const gain = attackWinXp(me, bigger, 1e9, 0.015 * 1e9);
    expect(xpToNextLevel(30) / gain).toBeLessThan(4);
    // …and still strictly more than the same fight against your own level.
    expect(gain).toBeGreaterThan(attackWinXp(me, me, 1e9, 0.015 * 1e9));
  });

  it("pays a prestiged hero in full only against his own weight class", () => {
    // The rule as a player reads it: as many resets as you, or more, is full pay.
    expect(resetGapXpFactor(0, 0)).toBe(1);
    expect(resetGapXpFactor(2, 2)).toBe(1);
    expect(resetGapXpFactor(1, 3)).toBe(1);
    // Every reset you stand above him halves it, down to the floor.
    expect(resetGapXpFactor(1, 0)).toBeCloseTo(RESET_GAP_XP_DECAY);
    expect(resetGapXpFactor(2, 0)).toBeCloseTo(RESET_GAP_XP_DECAY ** 2);
    expect(resetGapXpFactor(9, 0)).toBe(MIN_RESET_GAP_XP_FACTOR);
    // Never zero: a win is always worth something.
    expect(resetGapXpFactor(50, 0)).toBeGreaterThan(0);
  });

  it("makes farming un-reset players a poor ladder after a reset", () => {
    const rookie = { level: 40, resets: 0 };
    const power = 100_000;
    // A hero fresh off a reset, pointing his kept army at someone who has
    // never prestiged: the same fight pays a fraction of what it pays a peer.
    const prestiged = { level: 1, resets: 1 };
    const peer = { level: 1, resets: 0 };
    expect(attackWinXp(prestiged, rookie, power, power)).toBeLessThan(
      attackWinXp(peer, rookie, power, power) / 2
    );
    // …and a second reset cuts it again.
    expect(attackWinXp({ level: 1, resets: 2 }, rookie, power, power)).toBeLessThan(
      attackWinXp(prestiged, rookie, power, power)
    );
  });

  it("never pays a winning attack nothing, at any level or reset count", () => {
    // The reported bug: a player reached reset 4 and stopped gaining XP
    // entirely. Four factors, each on its own floor, multiplied out to 0.247
    // raw XP — and `Math.round` made that a literal zero, which the attack path
    // treats as "no XP write at all". At five resets a level-1 hero could not
    // leave level 1 against *any* target. The floor is over the product, so no
    // combination of the four can ever produce it again.
    for (const resets of [0, 1, 2, 3, 4, 5, 9, 20]) {
      for (const level of [1, 2, 5, 20, 50, 99]) {
        for (const foe of [
          { level: 1, resets: 0 },
          { level: 40, resets: 0 },
          { level: 100, resets: 0 },
        ]) {
          // A genuinely helpless target: the worst every factor can do at once.
          const gain = attackWinXp({ level, resets }, foe, 1e13, 5e5);
          expect(gain).toBeGreaterThan(0);
          // And worth a real share of the level, not a rounding error.
          expect(xpToNextLevel(level) / gain).toBeLessThanOrEqual(MAX_WINS_PER_LEVEL);
        }
      }
    }
  });

  it("scales the floor with the level it is filling, and only binds at the bottom", () => {
    // A flat floor would be a dent at level 1 and invisible at level 99, so it
    // is read off the same curve the level costs.
    expect(minAttackWinXp(1)).toBeLessThan(minAttackWinXp(99));
    for (const level of [1, 30, 60, 99]) {
      expect(minAttackWinXp(level)).toBe(Math.ceil(xpToNextLevel(level) / MAX_WINS_PER_LEVEL));
    }
    // Out-of-range levels are clamped rather than producing nonsense.
    expect(minAttackWinXp(0)).toBe(minAttackWinXp(1));
    expect(minAttackWinXp(500)).toBe(minAttackWinXp(HERO_MAX_LEVEL));
    // It must not disturb ordinary play: an even fight pays many times it, so
    // "pick a better target, earn more" still holds everywhere above the floor.
    const even = { level: 30, resets: 0 };
    expect(attackWinXp(even, even, 100_000, 100_000)).toBeGreaterThan(
      minAttackWinXp(30) * 10
    );
  });

  it("leaves a fight against equal prestige exactly where it was", () => {
    // The gate must not tax the fights it is meant to push players toward: two
    // heroes of the same standing pay each other the same at every reset count.
    const power = 100_000;
    const zero = attackWinXp(
      { level: 30, resets: 0 },
      { level: 30, resets: 0 },
      power,
      power
    );
    for (const resets of [1, 2, 5]) {
      const me = { level: 30, resets };
      expect(attackWinXp(me, me, power, power)).toBe(zero);
    }
  });

  it("has no defence counterpart — repelling a raid pays nothing", () => {
    // Defending is rewarded by keeping what you have, not by hero progress, so
    // a winning attack is the only XP-bearing outcome of a player battle.
    expect(hero).not.toHaveProperty("defenseWinXp");
  });

  it("keeps one win worth a comparable slice of a level all the way up", () => {
    for (const level of [5, 30, 60, 95]) {
      const me = { level, resets: 0 };
      const wins = xpToNextLevel(level) / attackWinXp(me, me, 100_000, 100_000);
      expect(wins).toBeGreaterThan(1.5);
      expect(wins).toBeLessThan(5);
    }
  });
});

describe("the point pool", () => {
  it("is one point per level the hero stands at", () => {
    expect(heroPointPool(1, 0)).toBe(1);
    expect(heroPointPool(16, 0)).toBe(16);
    expect(heroPointPool(HERO_MAX_LEVEL, 0)).toBe(HERO_MAX_LEVEL);
  });

  it("grows by exactly one with every level gained", () => {
    for (let l = 2; l <= HERO_MAX_LEVEL; l++) {
      expect(heroPointPool(l, 0) - heroPointPool(l - 1, 0)).toBe(POINTS_PER_LEVEL);
    }
  });

  it("keeps the grant of every reset, not just the last one", () => {
    for (let r = 0; r <= 4; r++) {
      expect(heroPointPool(1, r)).toBe(1 + r * HERO_RESET_POINTS);
      expect(heroPointPool(HERO_MAX_LEVEL, r)).toBe(
        HERO_MAX_LEVEL + r * HERO_RESET_POINTS
      );
    }
    // The figure the reset screen promises: 130 at the cap on the first reset.
    expect(heroPointPool(HERO_MAX_LEVEL, 1)).toBe(130);
  });

  it("hands a reset hero his whole new pool as unspent points", () => {
    expect(heroResetPoints(1)).toBe(heroPointPool(1, 1));
    expect(heroResetPoints(2) - heroResetPoints(1)).toBe(HERO_RESET_POINTS);
  });

  it("matches what levelling actually pays out, from birth to the cap", () => {
    // A newborn hero holds the level-1 point; every level after that adds one,
    // so the running total never drifts from the pool. This is the invariant
    // applyPendingUpdates reconciles rows against.
    let held = heroPointPool(1, 0);
    let hero = { level: 1, xp: 0 };
    while (hero.level < HERO_MAX_LEVEL) {
      const next = applyHeroXp(hero, xpToNextLevel(hero.level));
      held += next.pointsGained;
      hero = { level: next.level, xp: next.xp };
      expect(held).toBe(heroPointPool(hero.level, 0));
    }
    expect(held).toBe(HERO_MAX_LEVEL);
  });

  it("clamps a level out of range instead of paying for it", () => {
    expect(heroPointPool(0, 0)).toBe(1);
    expect(heroPointPool(HERO_MAX_LEVEL + 50, 0)).toBe(HERO_MAX_LEVEL);
    expect(heroPointPool(10, -3)).toBe(10);
  });

  it("sums the four columns a hero's points live in", () => {
    expect(
      heroPointsHeld({
        unspentPoints: 4,
        attackPoints: 9,
        defensePoints: 2,
        resourcePoints: 1,
      })
    ).toBe(16);
  });
});

describe("health and death", () => {
  it("defaults to one lost defence's worth of damage", () => {
    // The second argument is the damage itself, not a count of lost points —
    // the per-loss figure is the default.
    expect(damagedHealth(HERO_MAX_HEALTH)).toBe(
      HERO_MAX_HEALTH - HERO_DAMAGE_PER_LOST_DEFENSE
    );
    expect(damagedHealth(HERO_MAX_HEALTH, HERO_DAMAGE_PER_LOST_DEFENSE * 3)).toBe(
      HERO_MAX_HEALTH - HERO_DAMAGE_PER_LOST_DEFENSE * 3
    );
  });

  it("floors at zero rather than going negative", () => {
    expect(damagedHealth(5, 99)).toBe(0);
  });

  it("never heals: a health above the cap is clamped down, and damage never adds", () => {
    expect(damagedHealth(HERO_MAX_HEALTH + 500, 10)).toBe(HERO_MAX_HEALTH - 10);
    expect(damagedHealth(50, -100)).toBe(50);
  });

  it("calls a hero at zero health dead, and one above it alive", () => {
    expect(isHeroDead({ health: 0, diedAt: new Date() })).toBe(true);
    expect(isHeroDead(alive)).toBe(false);
    expect(isHeroDead(null)).toBe(false);
    expect(isHeroDead(undefined)).toBe(false);
  });

  it("schedules the free revival exactly one window after the fall", () => {
    const diedAt = new Date("2026-07-30T10:00:00.000Z");
    const at = heroReviveAt({ health: 0, diedAt });
    expect(at?.getTime()).toBe(diedAt.getTime() + HERO_REVIVE_MS);
  });

  it("gives a living hero no revival time", () => {
    expect(heroReviveAt(alive)).toBeNull();
  });
});

describe("item tiers and upgrades", () => {
  it("cycles rarity within each decade rather than climbing forever", () => {
    // Rarity is the item's position inside its decade, not its absolute power:
    // a level-11 פשוט is stronger than a level-10 אגדי. The band therefore
    // resets every ten levels, and that is deliberate.
    expect(tierForLevel(1)).toBe("COMMON");
    expect(tierForLevel(10)).toBe("LEGENDARY");
    expect(tierForLevel(11)).toBe("COMMON");
    expect(tierForLevel(20)).toBe("LEGENDARY");
    for (let level = 1; level <= 100; level++) {
      expect(tierForLevel(level)).toBe(tierForLevel(level + 10));
    }
  });

  it("returns a known rarity for every rung, including nonsense input", () => {
    for (const level of [...ITEM_LEVELS, 0, -5]) {
      expect(RARITY_ORDER).toContain(tierForLevel(level));
    }
  });

  it("stops offering an upgrade at the top rung", () => {
    expect(nextTierLevel(ITEM_LEVELS[ITEM_LEVELS.length - 1])).toBeNull();
    expect(itemUpgradeCost(ITEM_LEVELS[ITEM_LEVELS.length - 1])).toBeNull();
  });

  it("ends every set at its אגדי — gold never crosses a decade", () => {
    // Each set has a maximum of its own: upgrading walks 1 → 3 → 8 → 10 inside
    // the decade and stops. Level 11 exists, but only as loot.
    for (let decade = 0; decade < 10; decade++) {
      const legendary = decade * 10 + 10;
      expect(tierForLevel(legendary)).toBe("LEGENDARY");
      expect(nextTierLevel(legendary)).toBeNull();
      expect(itemUpgradeCost(legendary)).toBeNull();
      expect(canUpgradeItem(HERO_MAX_LEVEL, legendary)).toBe(false);
      // ...and no upgrade anywhere on the ladder targets the next set.
      expect(nextTierLevel(decade * 10 + 9)).toBe(legendary);
    }
    // The distinction the UI draws: a set ceiling is not the game's ceiling.
    expect(atSetCeiling(10)).toBe(true);
    expect(atSetCeiling(90)).toBe(true);
    expect(atSetCeiling(HERO_MAX_LEVEL)).toBe(false);
    expect(atSetCeiling(9)).toBe(false);
  });

  it("never targets a level outside the item's own decade", () => {
    for (let level = 1; level < HERO_MAX_LEVEL; level++) {
      const target = nextTierLevel(level);
      if (target === null) continue;
      expect(Math.ceil(target / 10)).toBe(Math.ceil(level / 10));
    }
  });

  it("prices an upgrade by the level it lands on, anchored at 10 and 100", () => {
    // The cost is a function of the TARGET rung, not the current one.
    const intoTen = ITEM_LEVELS.filter((l) => nextTierLevel(l) === 10);
    expect(intoTen.length).toBeGreaterThan(0);
    for (const from of intoTen) {
      expect(itemUpgradeCost(from)).toBeCloseTo(UPGRADE_COST_AT_LEVEL_10, -4);
    }
    const intoHundred = ITEM_LEVELS.filter((l) => nextTierLevel(l) === 100);
    for (const from of intoHundred) {
      // Rounded for display, so compare within a percent of the anchor.
      const cost = itemUpgradeCost(from)!;
      expect(Math.abs(cost - UPGRADE_COST_AT_LEVEL_100) / UPGRADE_COST_AT_LEVEL_100)
        .toBeLessThan(0.01);
    }
  });

  it("never gets cheaper as the item climbs", () => {
    let prev = 0;
    for (const level of ITEM_LEVELS) {
      const cost = itemUpgradeCost(level);
      if (cost === null) continue;
      expect(cost).toBeGreaterThanOrEqual(prev);
      prev = cost;
    }
  });

  it("gates equipping and upgrading on the hero's own level", () => {
    expect(canEquipItem(1, 1)).toBe(true);
    expect(canEquipItem(1, 20)).toBe(false);
    expect(canEquipItem(50, 20)).toBe(true);
    // An upgrade needs the hero to already be at the *target* level.
    expect(canUpgradeItem(1, 1)).toBe(false);
  });
});

describe("item stats", () => {
  it("gives every slot exactly one primary stat", () => {
    for (const slot of SLOT_ORDER) {
      const primary = slotPrimaryStat(slot);
      expect(slotGrants(slot, primary)).toBe(true);
    }
  });

  it("grants nothing for a stat the slot does not carry", () => {
    for (const slot of SLOT_ORDER) {
      for (const stat of ["attack", "defense", "spy", "resources", "turns", "citizens"] as const) {
        if (!slotGrants(slot, stat)) expect(itemStatBonus(slot, 100, stat)).toBe(0);
      }
    }
  });

  it("never prints a granted stat as +0", () => {
    for (const slot of SLOT_ORDER) {
      for (const stat of ["attack", "defense", "spy", "resources", "turns", "citizens"] as const) {
        if (slotGrants(slot, stat)) {
          expect(itemStatBonus(slot, 1, stat)).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never lets an upgrade lower a stat", () => {
    for (const slot of SLOT_ORDER) {
      const stat = slotPrimaryStat(slot);
      let prev = 0;
      for (const level of ITEM_LEVELS) {
        const value = itemStatBonus(slot, level, stat);
        expect(value).toBeGreaterThanOrEqual(prev);
        prev = value;
      }
    }
  });

  it("moves something on every single rung — no upgrade is ever a no-op", () => {
    // The invariant is about the *item*, not any one line of it. Turns and
    // citizens climb with a power of the rung, so their first few rungs all
    // round to +1 and those lines stand still — the price of not paying a
    // beginner 90 citizens for a level-3 boot. What must never happen is an
    // upgrade that costs gold and changes nothing, so every rung has to move at
    // least one line: the percentage extras advance on each rung, the resource
    // line advances on each rung, and a resource item also widens its coverage
    // with every tier.
    for (const slot of SLOT_ORDER) {
      for (let i = 1; i < ITEM_LEVELS.length; i++) {
        const before = itemBonusLines(slot, ITEM_LEVELS[i - 1]);
        const after = itemBonusLines(slot, ITEM_LEVELS[i]);
        const moved =
          after.length !== before.length ||
          after.some(
            (line, j) =>
              line.label !== before[j].label || line.value !== before[j].value
          );
        expect(
          moved,
          `${slot} ${ITEM_LEVELS[i - 1]} → ${ITEM_LEVELS[i]} changes nothing`
        ).toBe(true);
      }
    }
  });

  it("pays a level-1 resource item enough to notice", () => {
    // The bug this replaced: the first six rungs paid +1, +5, +11, +20, +31,
    // +45 resources per regular update. Holding a constant *share* of mine
    // output sounded principled and played as nothing at all, because a share of
    // an economy that is itself near zero is near zero. A first-rung item now
    // out-produces a first-city empire's mine, which is the point of finding it.
    for (const slot of SLOT_ORDER) {
      if (!slotGrants(slot, "resources") || !slotStatIsFlat(slot, "resources")) continue;
      // Even the shallowest extra (נעליים, weight 0.25) clears a mine's own tick.
      expect(itemStatBonus(slot, 1, "resources")).toBeGreaterThan(300);
    }
    expect(itemStatBonus("RELIC", 1, "resources")).toBe(1500);
  });

  it("keeps citizens and turns small at level 1 — their base does not grow", () => {
    // These two are measured against a *fixed* base rather than against the
    // economy — the growth building pays 20 + 10·level per daily update (capped),
    // and the turns upgrade pays its level per regular update (capped at 5) — so
    // gear that started large would retire the thing that exists for the job.
    // They keep the accelerating power curve and the deliberately low ceiling.
    for (const slot of SLOT_ORDER) {
      for (const stat of ["turns", "citizens"] as const) {
        if (!slotGrants(slot, stat)) continue;
        expect(itemStatBonus(slot, 1, stat)).toBe(1);
      }
    }
    // The whole first series (levels 1–10) stays in single digits.
    expect(itemStatBonus("BOOTS", 10, "citizens")).toBeLessThan(10);
    // …and the ladder never out-pays the growth building at ten cities (1,020).
    expect(itemStatBonus("BOOTS", 100, "citizens")).toBeLessThan(1020);
  });

  it("never lets a turn item out-pay the upgrade that exists for turns", () => {
    // Turns are quoted per *regular* update, in the same unit as
    // TURNS_PER_REGULAR_UPDATE, and the whole ladder tops out at exactly that
    // upgrade's ceiling: a maxed 🪽 is worth the whole upgrade, never more. This
    // is the assertion that keeps the one metered currency in the game from being
    // minted by gear — the old bug paid 40 a *tick*, eight upgrade ladders a day.
    for (const slot of SLOT_ORDER) {
      if (!slotGrants(slot, "turns")) continue;
      expect(itemStatBonus(slot, 100, "turns")).toBeLessThanOrEqual(
        TURNS_UPGRADE_MAX_LEVEL
      );
    }
    expect(itemStatBonus("WINGS", 100, "turns")).toBe(TURNS_UPGRADE_MAX_LEVEL);
    expect(flatStatPerDay("turns", itemStatBonus("WINGS", 100, "turns"))).toBe(
      TURNS_UPGRADE_MAX_LEVEL * TICKS_PER_DAY
    );
  });

  it("grows flat stats faster than linearly, so late gear is worth its price", () => {
    // Upgrade prices are geometric (×3.95 per series). A linear bonus curve
    // meant every rung bought less than the one before it, all the way up.
    for (const slot of SLOT_ORDER) {
      const stat = slotPrimaryStat(slot);
      if (!["resources", "turns", "citizens"].includes(stat)) continue;
      const quarter = itemStatBonus(slot, ITEM_LEVELS[9], stat); // rung 10
      const full = itemStatBonus(slot, 100, stat); // rung 40
      if (stat === "turns") {
        // Turns are the one exception, and the cadence is why: paid per 5-minute
        // tick in the upgrade's own unit, the entire line is five integers wide
        // (1→5, floored at 1 because whole units on a 288-a-day clock cannot go
        // lower). It cannot be convex over 40 rungs, and it is not what a wing's
        // upgrade is bought for — its spy and power lines are geometric and carry
        // the price. What must still hold is that the top out-pays the middle.
        expect(full).toBeGreaterThan(quarter);
        continue;
      }
      // Four times the rung is far more than four times the bonus.
      expect(full).toBeGreaterThan(quarter * 8);
    }
  });

  it("makes every resource upgrade worth the same relative jump", () => {
    // The geometric curve's whole claim: one upgrade means the same thing on
    // rung 1 as on rung 39, so gold buys constant value against a price curve
    // that is itself geometric. Rounding to three significant figures moves each
    // ratio by a fraction of a percent, hence the band rather than an equality.
    const growth = flatCurveGrowth("resources")!;
    expect(flatCurveGrowth("citizens")).toBeNull();
    for (let i = 1; i < ITEM_LEVELS.length; i++) {
      const ratio =
        itemStatBonus("RELIC", ITEM_LEVELS[i], "resources") /
        itemStatBonus("RELIC", ITEM_LEVELS[i - 1], "resources");
      expect(ratio).toBeGreaterThan(growth * 0.99);
      expect(ratio).toBeLessThan(growth * 1.01);
    }
  });

  it("pays a stat less where it is an extra than where it is the primary", () => {
    // The comparison has to be stat-by-stat: units differ wildly between stats
    // (a turn is not a citizen), so a slot's own primary and extra are not
    // comparable numbers. What must hold is that the SAME stat is worth less as
    // somebody else's extra.
    for (const w of EXTRA_WEIGHTS) expect(w).toBeLessThan(PRIMARY_WEIGHT);
    const STATS = ["attack", "defense", "spy", "resources", "turns", "citizens"] as const;
    for (const stat of STATS) {
      const asPrimary = SLOT_ORDER.filter((s) => slotPrimaryStat(s) === stat);
      const asExtra = SLOT_ORDER.filter(
        (s) => slotGrants(s, stat) && slotPrimaryStat(s) !== stat
      );
      if (asPrimary.length === 0 || asExtra.length === 0) continue;
      const best = Math.max(...asPrimary.map((s) => itemStatBonus(s, 100, stat)));
      for (const slot of asExtra) {
        expect(itemStatBonus(slot, 100, stat)).toBeLessThan(best);
      }
    }
  });

  it("spends a comparable budget on every slot", () => {
    // Slots differ in *shape*, not in total worth: a specialist pours its whole
    // extra budget into one stat, a generalist splits it between two. What must
    // not happen is a slot that is simply weaker than the rest — כפפות and שריון
    // were exactly that (1.25 against everyone else's 1.5) for as long as an
    // extra was worth a flat quarter.
    //
    // Measured over the *percentage/economy* budget only. The flat power twins
    // are a parallel budget with its own rule (the mirror test below), and
    // diamonds are a deliberate single-slot outlier — folding either in would
    // make this assertion say nothing about the thing it exists to protect.
    const economy = (slot: (typeof SLOT_ORDER)[number]) =>
      SLOT_META[slot].stats.filter(
        (s) =>
          !(HERO_POWER_STATS as readonly string[]).includes(s.stat) &&
          s.stat !== "diamonds"
      );
    const budgets = SLOT_ORDER.map((slot) =>
      economy(slot).reduce((sum, s) => sum + s.weight, 0)
    );
    const spread = Math.max(...budgets) - Math.min(...budgets);
    expect(spread).toBeLessThan(0.15);
    for (const slot of SLOT_ORDER) {
      // The headline stat always outweighs everything riding along with it.
      const [head, ...extras] = economy(slot);
      expect(head.weight).toBeGreaterThanOrEqual(
        extras.reduce((sum, s) => sum + s.weight, 0)
      );
    }
  });

  it("mirrors every combat percentage with a flat power line of equal weight", () => {
    // The rule that keeps a slot's combat identity from drifting between its
    // two instruments: a slot that pays attack% pays attackPower at exactly the
    // same weight, and pays a power stat for nothing else. 🥾 is the one slot
    // with no combat stat at all, and so must carry no power line either.
    for (const slot of SLOT_ORDER) {
      const weightOf = (stat: string) =>
        SLOT_META[slot].stats.find((s) => s.stat === stat)?.weight ?? 0;
      for (const pct of HERO_PERCENT_STATS) {
        expect(weightOf(POWER_STAT_FOR[pct])).toBe(weightOf(pct));
      }
    }
    // …and the mirror is not vacuous: the slots that fight do carry it.
    expect(SLOT_ORDER.filter((s) => slotGrants(s, "attackPower"))).toContain("SWORD");
    expect(SLOT_ORDER.filter((s) => slotGrants(s, "defensePower"))).toContain("ARMOR");
    for (const stat of HERO_POWER_STATS) {
      expect(slotGrants("BOOTS", stat)).toBe(false);
    }
  });

  it("climbs the power ladder on every single rung", () => {
    // A geometric curve over 40 rungs, rounded to three significant figures,
    // must still strictly increase — the rounding that made a level-based bonus
    // pay +17 → +17 is the reason bonuses are keyed to the rung at all.
    for (const stat of HERO_POWER_STATS) {
      const armed = SLOT_ORDER.find((s) => slotGrants(s, stat))!;
      let previous = 0;
      for (const level of ITEM_LEVELS) {
        const value = itemStatBonus(armed, level, stat);
        expect(value).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });

  it("gives each flat resource slot its own resource to lead with", () => {
    // A פשוט piece covers one resource. Which one is the slot's identity — it is
    // what makes an early מכנסיים and an early פרי שטן a real choice rather than
    // the same gold faucet in two shapes. Only the flat slots have an identity
    // to carry: a percentage multiplies every mine at once, so there is nothing
    // to lead with.
    const flatSlots = SLOT_ORDER.filter(
      (slot) => slotGrants(slot, "resources") && slotStatIsFlat(slot, "resources")
    );
    const leads = flatSlots.map(
      (slot) => itemBonusLines(slot, 1).find((l) => l.resource)?.resource
    );
    expect(flatSlots.length).toBeGreaterThanOrEqual(3);
    expect(leads.every(Boolean)).toBe(true);
    // Every one of them distinct — no two flat slots are the same faucet.
    expect(new Set(leads).size).toBe(leads.length);
  });

  it("pays resources as a percentage on exactly the slots that opt into it", () => {
    // The percent slots carry the late game (a rung-40 extra is +14% of a
    // multiplicative economy) and are deliberately tiny early, so they must not
    // also emit per-resource lines — a percentage multiplies every mine at once.
    const pctSlots = SLOT_ORDER.filter(
      (slot) => slotGrants(slot, "resources") && !slotStatIsFlat(slot, "resources")
    );
    expect(pctSlots).toEqual(["SHIELD", "SWORD"]);
    for (const slot of pctSlots) {
      const lines = itemBonusLines(slot, 100).filter((l) => l.stat === "resources");
      expect(lines).toHaveLength(1);
      expect(lines[0].flat).toBe(false);
      expect(lines[0].resource).toBeUndefined();
      // Small at the start, meaningful at the end — the whole point of the mode.
      expect(itemStatBonus(slot, 13, "resources")).toBeLessThan(3);
      expect(itemStatBonus(slot, 100, "resources")).toBeGreaterThan(10);
    }
  });

  it("fences the diamond faucet to one slot and a trickle", () => {
    // Gear mints the real-money currency again, and this is the assertion that
    // keeps it from becoming an income the way it was before (a maxed 👖 paid
    // +80 a day, forever). Exactly one slot, as its *minor* extra, and a ceiling
    // small enough that a full season of it does not add up to a package.
    const minting = SLOT_ORDER.filter((slot) => slotGrants(slot, "diamonds"));
    expect(minting).toEqual(["PANTS"]);
    expect(
      SLOT_META.PANTS.stats.find((s) => s.stat === "diamonds")!.weight
    ).toBe(MINOR_EXTRA_WEIGHT);
    expect(slotPrimaryStat("PANTS")).not.toBe("diamonds");
    // The whole ladder: a trickle at the bottom, a trophy at the top.
    expect(itemStatBonus("PANTS", 1, "diamonds")).toBe(1);
    expect(itemStatBonus("PANTS", 100, "diamonds")).toBeLessThanOrEqual(25);
    // Still nothing at all from the other eight, however they are re-tuned.
    for (const slot of SLOT_ORDER) {
      if (slot === "PANTS") continue;
      expect(itemStatBonus(slot, 100, "diamonds")).toBe(0);
    }
  });
});

describe("when a flat bonus is paid", () => {
  // The cadence table is what `applyPendingUpdates` pays from and what the hero
  // page groups its yield lines by. These are the assertions that keep the two
  // ends honest — the bug they exist for is a stat paid on one clock while every
  // label in the game named the other.

  it("gives every flat stat exactly one cadence", () => {
    for (const stat of HERO_FLAT_STATS) {
      expect(HERO_CADENCE_ORDER).toContain(HERO_FLAT_CADENCE[stat]);
    }
    // …and the three groups partition the flat stats: nothing paid twice, nothing
    // left with no clock at all.
    const grouped = HERO_CADENCE_ORDER.flatMap((c) => flatStatsWithCadence(c));
    expect(grouped.sort()).toEqual([...HERO_FLAT_STATS].sort());
  });

  it("pays gear on the 5-minute tick, and only citizens and diamonds daily", () => {
    // The rule, stated once: everything an item conjures arrives on the regular
    // update, except the two stats whose base is itself daily.
    expect(flatStatsWithCadence("regular").sort()).toEqual(["resources", "turns"]);
    expect(flatStatsWithCadence("daily").sort()).toEqual(["citizens", "diamonds"]);
    // The three power stats are on no clock at all — they are counted inside the
    // fight, which is why a settlement pays them nothing.
    expect(flatStatsWithCadence("battle").sort()).toEqual(
      [...HERO_POWER_STATS].sort()
    );
  });

  it("names its own cadence in every label the player reads", () => {
    // This is the drift check. A stat's `itemLabel` is what an item tile prints
    // ("תורות לעדכון רגיל"), and it used to disagree with the code that paid it.
    const CADENCE_WORD: Record<"regular" | "daily", string> = {
      regular: "עדכון רגיל",
      daily: "עדכון יומי",
    };
    for (const stat of HERO_FLAT_STATS) {
      const cadence = HERO_FLAT_CADENCE[stat];
      if (cadence === "battle") continue;
      const meta = HERO_STAT_META[stat];
      const word = CADENCE_WORD[cadence];
      const other = CADENCE_WORD[cadence === "regular" ? "daily" : "regular"];
      // resources is the one stat with two instruments, so its own label is the
      // generic one and the per-resource lines carry the cadence (see
      // itemBonusLines); every other flat stat states it in its item label.
      const text = `${meta.itemLabel} ${meta.description}`;
      expect(text, `${stat} never says "${word}"`).toContain(word);
      expect(text, `${stat} still claims "${other}"`).not.toContain(other);
    }
    // The per-resource lines an item splits into carry it too.
    for (const line of itemBonusLines("RELIC", 10)) {
      if (line.resource) expect(line.label).toContain("עדכון רגיל");
    }
  });

  it("counts a day's worth of each clock", () => {
    expect(UPDATES_PER_DAY.regular).toBe(TICKS_PER_DAY);
    expect(UPDATES_PER_DAY.daily).toBe(DAILY_UPDATE_TIMES.length);
    // A battle stat has no clock, so it has no daily total either — null, not 0,
    // which would read as "it pays nothing".
    expect(UPDATES_PER_DAY.battle).toBe(0);
    for (const stat of HERO_POWER_STATS) {
      expect(flatStatPerDay(stat, 1_000)).toBeNull();
    }
    // The two figures the hero page prints beside each other.
    expect(flatStatPerDay("citizens", 450)).toBe(900);
    expect(flatStatPerDay("turns", 5)).toBe(1_440);
  });

  it("gives every cadence a heading and a note to render", () => {
    for (const cadence of HERO_CADENCE_ORDER) {
      const meta = HERO_CADENCE_META[cadence];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.note.length).toBeGreaterThan(0);
    }
  });
});

describe("the bag", () => {
  it("has a positive, finite capacity", () => {
    expect(HERO_BAG_CAPACITY).toBeGreaterThan(0);
    expect(Number.isInteger(HERO_BAG_CAPACITY)).toBe(true);
  });
});
