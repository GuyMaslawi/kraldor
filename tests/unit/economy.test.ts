import { describe, expect, it } from "vitest";
import {
  BANK_DAILY_INTEREST_MAX_LEVEL,
  BANK_INTEREST_MAX_RATE,
  CITIZEN_GROWTH_LEVELS_PER_CITY,
  CITY_COST_TIER_MULTIPLIER,
  EMPIRE_UPGRADE_COST_GROWTH,
  MAX_CITIES,
  MINE_MAX_LEVEL,
  STORAGE_CAPACITY_PER_LEVEL,
  TICKS_PER_DAY,
  TURNS_UPGRADE_MAX_LEVEL,
  WHEEL_LUCK_MAX_LEVEL,
  bankInterestRate,
  bankInterestUpgradeCost,
  cityCost,
  empireUpgradeCost,
  empireUpgradeCostFor,
  mineProductionPerTick,
  mineProductionValue,
  mineUpgradeCost,
  storageCapacityForLevel,
  storageUpgradeCost,
  turnsPerRegularUpdate,
  turnsUpgradeCost,
  wheelLuckBonus,
  wheelLuckUpgradeCost,
} from "@/lib/game/constants";
import {
  SEASON_PASS_DAY1_PEAK,
  SEASON_PASS_FINAL_PEAK,
  SEASON_PASS_PREMIUM_PRICE,
  SEASON_PASS_TIERS,
  SEASON_PASS_TIER_COUNT,
  SEASON_PASS_XP,
  SEASON_PASS_XP_MAX,
  seasonPassDay,
  seasonPassPricing,
  seasonPassRewardAmount,
  seasonPassSpendUnits,
  tierForXp,
  xpForTier,
} from "@/lib/game/seasonPass";
import {
  GUILD_AID_MAX_LEVEL,
  GUILD_CAPACITY_MAX_LEVEL,
  GUILD_SPELL_TYPES,
  aidUpgradeCostGold,
  capacityUpgradeCostGold,
  guildAidPct,
  guildCapacity,
  guildSpellBonusPct,
  guildSpellBuffHours,
  guildSpellMaxLevel,
  spellUpgradeCostDiamonds,
} from "@/lib/game/guild";
import {
  BOOST_MAX_PCT,
  SHIELDS,
  SHIELD_RENEW_COOLDOWN_MS,
  applyShopDiscount,
  discountedAmount,
  shieldMeta,
} from "@/lib/game/diamondShop";
import { shieldFlags } from "@/lib/game/diamondEffects";
import {
  FORGE_DISCOUNT_PCT,
  POTION_STACK_CAP,
  forgeDiscountedCost,
  rollGuaranteedPotion,
  rollPotionDrop,
} from "@/lib/game/potions";
import {
  pickWheelPrizeIndex,
  wheelPrizeAmount,
  wheelClock,
  WHEEL_CITIZEN_BASE,
  WHEEL_CITIZEN_FINAL,
  WHEEL_DIAMOND_BASE,
  WHEEL_DIAMOND_FINAL,
  WHEEL_PRIZES,
  WHEEL_RESOURCE_BASE,
  WHEEL_RESOURCE_FINAL,
} from "@/lib/game/wheel";
import { armyPower, getEmpireMilitaryPower } from "@/lib/game/power";
import {
  MAX_WEAPON_TIER,
  WEAPON_CATEGORIES,
  WEAPON_COST_GROWTH,
  WEAPON_POWER_GROWTH,
  WEAPONS,
  weaponByKey,
  weaponsOfCategory,
  weaponsPower,
} from "@/lib/game/weapons";

describe("mines", () => {
  it("produces nothing without slaves", () => {
    expect(mineProductionPerTick(10, 0)).toBe(0);
  });

  it("scales with level and with slaves", () => {
    expect(mineProductionValue(2)).toBeGreaterThan(mineProductionValue(1));
    expect(mineProductionPerTick(5, 10)).toBeGreaterThan(mineProductionPerTick(5, 1));
  });

  it("never returns a negative or non-finite figure, even off the ends", () => {
    for (const level of [-5, 0, 1, MINE_MAX_LEVEL, MINE_MAX_LEVEL + 100]) {
      const v = mineProductionPerTick(level, 10);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the bank", () => {
  it("caps the interest rate however high the upgrade goes", () => {
    // Legacy rows sit above the level cap (the ladder used to run to 15), so the
    // clamp is what stops them from paying more than the advertised ceiling.
    const capped = bankInterestRate(1e6);
    expect(capped).toBeLessThanOrEqual(BANK_INTEREST_MAX_RATE);
    expect(capped).toBeGreaterThan(0);
    expect(bankInterestRate(BANK_DAILY_INTEREST_MAX_LEVEL)).toBe(BANK_INTEREST_MAX_RATE);
  });

  it("adds exactly one percent per rung, and prices each rung steeply", () => {
    expect(bankInterestRate(4) - bankInterestRate(3)).toBeCloseTo(0.01, 10);
    // The ladder is a real sink: the last rung alone costs more than the tenth
    // city, so 10% cannot be reached early.
    const last = bankInterestUpgradeCost(BANK_DAILY_INTEREST_MAX_LEVEL - 1);
    expect(last.gold).toBeGreaterThan(cityCost(MAX_CITIES - 1).gold);
    expect(empireUpgradeCostFor("BANK_DAILY_INTEREST", 3)).toEqual(bankInterestUpgradeCost(3));
  });

  it("never pays negative interest", () => {
    expect(bankInterestRate(0)).toBeGreaterThanOrEqual(0);
    expect(bankInterestRate(-10)).toBeGreaterThanOrEqual(0);
  });

  it("rewards levelling up, until the cap", () => {
    expect(bankInterestRate(5)).toBeGreaterThan(bankInterestRate(1));
  });
});

describe("storage", () => {
  it("grows with level and is always positive", () => {
    expect(storageCapacityForLevel(2)).toBeGreaterThan(storageCapacityForLevel(1));
    expect(storageCapacityForLevel(1)).toBeGreaterThan(0);
  });

  it("never hands a level less capacity than the old linear curve did", () => {
    // The ladder went geometric to keep pace with an economy that compounds,
    // and the growth factor rides on top of the original `level × 10,000`
    // rather than replacing it — precisely so that no warehouse standing today
    // wakes up smaller than its stored amount.
    for (const level of [1, 2, 5, 10, 25, 50, 100]) {
      expect(storageCapacityForLevel(level)).toBeGreaterThanOrEqual(
        level * STORAGE_CAPACITY_PER_LEVEL
      );
    }
    expect(storageCapacityForLevel(0)).toBe(0);
  });

  it("charges more per unit of capacity as the ladder climbs", () => {
    const cheap = storageUpgradeCost(5).gold / storageCapacityForLevel(6);
    const dear = storageUpgradeCost(60).gold / storageCapacityForLevel(61);
    // Capacity and price carry the same factor, so the ratio holds steady —
    // what must not happen is the price falling behind what it buys.
    expect(dear).toBeGreaterThanOrEqual(cheap * 0.9);
  });
});

describe("the linear ladders that were repriced", () => {
  // Income here is multiplicative — slaves × mine level × cities × ticks — and
  // these three ladders used to be linear in the level. Playtesters read them as
  // free because they were: the whole 100-rung citizen ladder came to 8.4M gold,
  // half a percent of a tenth city. Each test below pins the shape, not a
  // number, so retuning a base stays cheap but going linear again does not.
  const LADDERS = [
    { name: "citizens/intel/bank deposits", cost: (l: number) => empireUpgradeCost(l).gold },
    { name: "warehouses", cost: (l: number) => storageUpgradeCost(l).gold },
    { name: "gold mines", cost: (l: number) => mineUpgradeCost(l, "gold").gold },
  ];

  it.each(LADDERS)("prices $name geometrically, not linearly", ({ cost }) => {
    // A linear ladder has a constant *difference* between rungs; a geometric one
    // has a constant ratio, so its steps keep widening.
    const earlyStep = cost(11) - cost(10);
    const lateStep = cost(51) - cost(50);
    expect(lateStep).toBeGreaterThan(earlyStep * 2);
  });

  it.each(LADDERS)("makes the first rung of $name cost something", ({ cost }) => {
    // A brand-new empire earns on the order of 23K gold a day, and the old
    // opening rungs (1,700 / 640 / 1,500) were a rounding error against that.
    // The floor is an hour of that income rather than a day: warehouses sit
    // right on it deliberately — see STORAGE_UPGRADE_BASE — because level 1 is
    // what protects a newcomer's resources and must stay within reach.
    expect(cost(1)).toBeGreaterThanOrEqual(1_000);
  });

  it("keeps ten citizen rungs in step with one city tier", () => {
    // CITIZEN_GROWTH_LEVELS_PER_CITY unlocks ten rungs per city and each city
    // tier costs CITY_COST_TIER_MULTIPLIER times the last, so the citizen ladder
    // is pinned to the pace at which the game hands it out.
    const tenRungs =
      EMPIRE_UPGRADE_COST_GROWTH ** CITIZEN_GROWTH_LEVELS_PER_CITY;
    expect(tenRungs).toBeGreaterThan(CITY_COST_TIER_MULTIPLIER * 0.9);
    expect(tenRungs).toBeLessThan(CITY_COST_TIER_MULTIPLIER * 1.1);
  });

  it("keeps the mine ladder reachable despite its length", () => {
    // MINE_MAX_LEVEL is 250 rungs. At the ×1.1 the empire upgrades use, the top
    // rung would cost seventeen trillion and the cap would leave the economy;
    // the whole ladder has to stay inside the same order as the tenth city.
    const fullLadder = Array.from({ length: MINE_MAX_LEVEL - 1 }, (_, i) =>
      mineUpgradeCost(i + 1, "gold").gold
    ).reduce((a, b) => a + b, 0);
    expect(fullLadder).toBeGreaterThan(cityCost(MAX_CITIES - 1).gold);
    expect(fullLadder).toBeLessThan(cityCost(MAX_CITIES - 1).gold * 100);
  });

  it("is the curve the purchase actions actually charge", () => {
    expect(empireUpgradeCostFor("CITIZEN_GROWTH", 7)).toEqual(empireUpgradeCost(7));
    expect(empireUpgradeCostFor("INTELLIGENCE", 7)).toEqual(empireUpgradeCost(7));
    expect(empireUpgradeCostFor("BANK_DEPOSIT_COUNT", 7)).toEqual(empireUpgradeCost(7));
  });

  it("charges a mine only in its own resource", () => {
    const cost = mineUpgradeCost(40, "wood");
    expect(cost.wood).toBeGreaterThan(0);
    expect(cost.gold).toBe(0);
    expect(cost.iron).toBe(0);
    expect(cost.stone).toBe(0);
  });
});

describe("season pass", () => {
  it("needs strictly more XP for each tier", () => {
    for (let t = 2; t <= SEASON_PASS_TIER_COUNT; t++) {
      expect(xpForTier(t)).toBeGreaterThan(xpForTier(t - 1));
    }
  });

  it("maps XP back to the tier it bought, and no further", () => {
    expect(tierForXp(0)).toBe(0);
    for (let t = 1; t <= SEASON_PASS_TIER_COUNT; t++) {
      expect(tierForXp(xpForTier(t))).toBe(t);
      expect(tierForXp(xpForTier(t) - 1)).toBe(t - 1);
    }
  });

  it("never reports a tier above the ladder, however much XP is thrown at it", () => {
    expect(tierForXp(SEASON_PASS_XP_MAX * 1000)).toBe(SEASON_PASS_TIER_COUNT);
  });

  it("earns nothing for a sub-threshold spend", () => {
    // The exact farm this closed: 40 purchases of quantity 1 cleared the ladder.
    expect(seasonPassSpendUnits("buyWeapon", 0)).toBe(0);
    expect(seasonPassSpendUnits("buyWeapon", 1)).toBe(0);
  });

  it("earns more for a bigger spend, up to a per-action cap", () => {
    expect(seasonPassSpendUnits("buyWeapon", 100_000)).toBeGreaterThan(
      seasonPassSpendUnits("buyWeapon", 1_000)
    );
    // The cap is what stops one enormous purchase clearing the ladder outright.
    const huge = seasonPassSpendUnits("buyWeapon", 1e15);
    expect(huge).toBe(seasonPassSpendUnits("buyWeapon", 1e18));
    expect(huge).toBeGreaterThan(0);
  });

  it("earns nothing from a nonsense spend", () => {
    expect(seasonPassSpendUnits("buyWeapon", Number.NaN)).toBe(0);
    expect(seasonPassSpendUnits("buyWeapon", -1e9)).toBe(0);
    expect(seasonPassSpendUnits("buyWeapon", Infinity)).toBe(0);
  });

  it("prices premium in diamonds and never pays diamonds back", () => {
    expect(SEASON_PASS_PREMIUM_PRICE).toBeGreaterThan(0);
    expect(Object.keys(SEASON_PASS_XP)).not.toContain("diamonds");
  });

  it("counts season days from one, and never below it", () => {
    const season = {
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    expect(seasonPassDay(season, season.startsAt.getTime())).toBe(1);
    expect(
      seasonPassDay(season, season.startsAt.getTime() - 10 * 86_400_000)
    ).toBeGreaterThanOrEqual(1);
    expect(seasonPassDay(null, Date.now())).toBeGreaterThanOrEqual(1);
  });

  it("pays the day-1 base with no active season, not the season's ceiling", () => {
    // The regression this guards: `days <= 1` used to mean "final day", so every
    // window without an active GameSeason row — a local database, the gap
    // between two seasons — paid the endgame ceiling (1.67B gold on rung one)
    // from the first cycle, twice a day.
    const pricing = seasonPassPricing(null, Date.now());
    // Identical to the opening day of a real season, rung for rung.
    const season = {
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-31T00:00:00.000Z"),
    };
    const day1 = seasonPassPricing(season, season.startsAt.getTime());
    for (const tier of SEASON_PASS_TIERS) {
      expect(seasonPassRewardAmount(tier.free, pricing)).toBe(
        seasonPassRewardAmount(tier.free, day1)
      );
    }
    const top = Math.max(
      ...SEASON_PASS_TIERS.filter((t) => t.free.kind === "gold").map((t) =>
        seasonPassRewardAmount(t.free, pricing)
      )
    );
    expect(top).toBeLessThanOrEqual(SEASON_PASS_DAY1_PEAK.gold);
    expect(top).toBeLessThan(SEASON_PASS_FINAL_PEAK.gold / 1000);
  });

  it("rides from the day-1 base to the final peak, and never backwards", () => {
    const season = {
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-31T00:00:00.000Z"),
    };
    const at = (day: number) =>
      seasonPassPricing(season, season.startsAt.getTime() + (day - 1) * 86_400_000);
    const goldTier = SEASON_PASS_TIERS.filter((t) => t.free.kind === "gold").pop()!;
    const paid = (day: number) => seasonPassRewardAmount(goldTier.free, at(day));

    expect(paid(1)).toBe(goldTier.free.base);
    expect(paid(30)).toBe(SEASON_PASS_FINAL_PEAK.gold);
    for (let day = 2; day <= 30; day++) {
      expect(paid(day)).toBeGreaterThan(paid(day - 1));
    }
    // Past the end the curve stops rather than compounding forever.
    expect(paid(400)).toBe(paid(30));
  });

  it("prices a whole ladder at one instant, so a held claim never grows", () => {
    const season = {
      startsAt: new Date("2026-07-01T19:02:00.000Z"),
      endsAt: new Date("2026-07-31T19:02:00.000Z"),
    };
    // The 19:30 cycle opens at 16:30Z; the season's own day rolls over at
    // 19:02Z, half an hour into it. A claim made at 20:00Z must still be priced
    // at the ladder the player was shown when it opened.
    const cycleStart = new Date("2026-07-10T16:30:00.000Z").getTime();
    const heldUntil = new Date("2026-07-10T20:00:00.000Z").getTime();
    const opened = seasonPassPricing(season, cycleStart);
    expect(seasonPassPricing(season, cycleStart)).toEqual(opened);
    // The rollover is real — pricing at `now` is what used to inflate the claim.
    expect(seasonPassDay(season, heldUntil)).toBe(opened.day + 1);
    const rung = SEASON_PASS_TIERS[49].free;
    expect(
      seasonPassRewardAmount(rung, seasonPassPricing(season, heldUntil))
    ).toBeGreaterThan(seasonPassRewardAmount(rung, opened));
  });
});

describe("guild economy", () => {
  it("charges more for each level of every upgrade", () => {
    for (let l = 1; l < GUILD_CAPACITY_MAX_LEVEL; l++) {
      expect(capacityUpgradeCostGold(l + 1)).toBeGreaterThan(capacityUpgradeCostGold(l));
    }
    for (let l = 1; l < GUILD_AID_MAX_LEVEL; l++) {
      expect(aidUpgradeCostGold(l + 1)).toBeGreaterThan(aidUpgradeCostGold(l));
    }
    for (let l = 1; l < 30; l++) {
      expect(spellUpgradeCostDiamonds(l + 1)).toBeGreaterThan(
        spellUpgradeCostDiamonds(l)
      );
    }
  });

  it("keeps every bonus inside its advertised ceiling", () => {
    expect(guildAidPct(GUILD_AID_MAX_LEVEL)).toBeLessThanOrEqual(GUILD_AID_MAX_LEVEL);
    expect(guildCapacity(GUILD_CAPACITY_MAX_LEVEL)).toBeGreaterThan(guildCapacity(1));
  });

  // Ceilings are per spell, and a row bought before a ceiling was lowered is
  // still in the database at its old level — the clamp is what keeps it from
  // paying out the bonus it was sold at.
  it("clamps every spell to its own ceiling, however high the stored level", () => {
    for (const type of GUILD_SPELL_TYPES) {
      const max = guildSpellMaxLevel(type);
      expect(guildSpellBonusPct(type, max)).toBe(max);
      expect(guildSpellBonusPct(type, max + 25)).toBe(max);
      expect(guildSpellBonusPct(type, -3)).toBe(0);
    }
  });

  it("caps attack, defence and resources at 10% for 6 hours", () => {
    for (const type of ["ATTACK", "DEFENSE", "RESOURCES"] as const) {
      expect(guildSpellMaxLevel(type)).toBe(10);
      expect(guildSpellBuffHours(type)).toBe(6);
    }
  });
});

describe("the diamond shop", () => {
  it("never discounts below zero or above the full price", () => {
    expect(discountedAmount(1000, 0)).toBe(1000);
    expect(discountedAmount(1000, 100)).toBe(0);
    expect(discountedAmount(1000, 200)).toBeGreaterThanOrEqual(0);
    expect(discountedAmount(1000, -50)).toBeLessThanOrEqual(1000);
  });

  it("discounts every line of a resource cost", () => {
    const full = { gold: 1000, wood: 500, iron: 200, stone: 100 };
    const cut = applyShopDiscount(full, 50);
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      expect(cut[key]).toBeLessThanOrEqual(full[key]);
      expect(cut[key]).toBeGreaterThanOrEqual(0);
    }
  });

  it("caps the production boost", () => {
    expect(BOOST_MAX_PCT).toBeGreaterThan(0);
  });

  describe("raid shields", () => {
    it("offers a longer duration at a higher price, per shield", () => {
      for (const shield of SHIELDS) {
        const sorted = [...shield.durations].sort((a, b) => a.hours - b.hours);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].cost).toBeGreaterThan(sorted[i - 1].cost);
        }
      }
    });

    it("prices the longer shield at a discount per hour, but never free", () => {
      for (const shield of SHIELDS) {
        for (const d of shield.durations) {
          expect(d.cost).toBeGreaterThan(0);
          expect(d.hours).toBeGreaterThan(0);
        }
      }
    });

    it("always leaves an exposed window between shields", () => {
      // Back-to-back shields would make a paying player permanently unraidable.
      expect(SHIELD_RENEW_COOLDOWN_MS).toBeGreaterThan(0);
    });

    it("resolves both keys to a distinct effect kind", () => {
      expect(shieldMeta("resources").kind).not.toBe(shieldMeta("soldiers").kind);
    });

    it("badges say a shield is up without saying when it drops", () => {
      // Every badge beside a player's name is handed shieldFlags(), never the
      // expiry map: ShieldBadges is a client component, so anything given to it
      // is serialised into the page payload, and the hour a shield lapses is
      // intel a rival is meant to buy from a spy — not read off the ladder.
      const flags = shieldFlags({
        resources: new Date("2026-08-13T14:30:00.000Z"),
        soldiers: null,
      });
      expect(flags).toEqual({ resources: true, soldiers: false });
      expect(JSON.stringify(flags)).not.toContain("14:30");
    });

    it("draws nothing for an empire with no shields at all", () => {
      // `getShieldsForEmpires` leaves unshielded empires out of its map, so the
      // badge is routinely handed `undefined`.
      expect(shieldFlags(undefined)).toEqual({ resources: false, soldiers: false });
    });
  });
});

describe("potions", () => {
  it("halves a forge cost only while the brew is active", () => {
    expect(forgeDiscountedCost(1000, false)).toBe(1000);
    expect(forgeDiscountedCost(1000, true)).toBe(1000 * (1 - FORGE_DISCOUNT_PCT / 100));
  });

  it("drops nothing on a high roll and something on a zero roll", () => {
    expect(rollPotionDrop(() => 0.999999)).toBeNull();
    expect(rollPotionDrop(() => 0)).not.toBeNull();
  });

  it("always names a real brew when one is guaranteed", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999999]) {
      expect(rollGuaranteedPotion(() => roll)).toBeTruthy();
    }
  });

  it("caps a stack", () => {
    expect(POTION_STACK_CAP).toBeGreaterThan(0);
  });
});

describe("the wheel", () => {
  it("always picks a prize inside the table", () => {
    for (const roll of [0, 0.1, 0.5, 0.9, 0.999999]) {
      const index = pickWheelPrizeIndex(() => roll);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(WHEEL_PRIZES.length);
    }
  });

  it("never hands out army weapons — those are earned in the factory", () => {
    expect(WHEEL_PRIZES.map((p) => p.key)).not.toContain("allWeapons");
  });

  it("opens every wedge on its base and closes it on its final amount", () => {
    const season = { cycle: 1, total: 61 };
    const last = { cycle: 61, total: 61 };
    const at = (key: string, clock: { cycle: number; total: number }) =>
      wheelPrizeAmount(WHEEL_PRIZES.find((p) => p.key === key)!, clock);

    for (const key of ["gold", "iron", "stone", "wood"]) {
      expect(at(key, season)).toBe(WHEEL_RESOURCE_BASE);
      expect(at(key, last)).toBe(WHEEL_RESOURCE_FINAL);
    }
    expect(at("diamonds", season)).toBe(WHEEL_DIAMOND_BASE);
    expect(at("diamonds", last)).toBe(WHEEL_DIAMOND_FINAL);
    expect(at("citizens", season)).toBe(WHEEL_CITIZEN_BASE);
    expect(at("citizens", last)).toBe(WHEEL_CITIZEN_FINAL);
  });

  it("lands on the same finish whatever the season's length", () => {
    // The curve is pinned to the season, not to a fixed number of days: a
    // 10-day season simply climbs faster and still closes on the finals.
    for (const total of [3, 21, 61, 181]) {
      for (const prize of WHEEL_PRIZES.filter((p) => p.kind === "amount")) {
        expect(wheelPrizeAmount(prize, { cycle: 1, total })).toBe(prize.base);
        expect(wheelPrizeAmount(prize, { cycle: total, total })).toBe(prize.final);
      }
    }
  });

  it("grows on every single update — never a jump, never a plateau", () => {
    // The whole point of the interpolated curve. Each update must be strictly
    // richer than the one before it (no flat stretch), and no update may more
    // than double the last (no overnight leap the player can feel).
    const total = 61;
    for (const prize of WHEEL_PRIZES.filter((p) => p.kind === "amount")) {
      for (let cycle = 2; cycle <= total; cycle++) {
        const prev = wheelPrizeAmount(prize, { cycle: cycle - 1, total });
        const now = wheelPrizeAmount(prize, { cycle, total });
        expect(now).toBeGreaterThan(prev);
        expect(now).toBeLessThanOrEqual(prev * 2);
      }
    }
  });

  it("holds at the final amount past the end and at the base with no season", () => {
    const gold = WHEEL_PRIZES.find((p) => p.key === "gold")!;
    // wheelClock clamps, but the amount function must not blow past `final`
    // even if handed an out-of-range cycle directly.
    expect(wheelPrizeAmount(gold, { cycle: 900, total: 61 })).toBe(WHEEL_RESOURCE_FINAL);
    // No active season: the clock stands at 1 of 1 and everything pays its base.
    expect(wheelPrizeAmount(gold, wheelClock(null, Date.now()))).toBe(WHEEL_RESOURCE_BASE);
  });

  it("pays the published end-of-season numbers on the last day of a 30-day season", () => {
    const start = new Date("2026-09-01T12:00:00+03:00");
    const end = new Date(start.getTime() + 30 * 86_400_000);
    const clock = wheelClock({ startsAt: start, endsAt: end }, end.getTime());
    const amountOf = (key: string) =>
      wheelPrizeAmount(WHEEL_PRIZES.find((p) => p.key === key)!, clock);

    for (const key of ["gold", "iron", "stone", "wood"]) {
      expect(amountOf(key)).toBe(50_000_000_000);
    }
    expect(amountOf("diamonds")).toBe(150);
    expect(amountOf("citizens")).toBe(500);
  });
});

describe("wheel luck", () => {
  it("tops out at +15% and never climbs past it", () => {
    expect(wheelLuckBonus(WHEEL_LUCK_MAX_LEVEL)).toBeCloseTo(0.15);
    expect(wheelLuckBonus(WHEEL_LUCK_MAX_LEVEL + 40)).toBeCloseTo(0.15);
  });

  it("costs a fortune from the very first purchase", () => {
    // The premise of the upgrade: level 1 → 2 already outprices a second city
    // many times over, and the top of the ladder is a multi-billion sink.
    expect(wheelLuckUpgradeCost(1).gold).toBeGreaterThanOrEqual(30_000_000);
    expect(
      wheelLuckUpgradeCost(WHEEL_LUCK_MAX_LEVEL - 1).gold
    ).toBeGreaterThanOrEqual(5_000_000_000);
  });

  it("compounds — every level costs strictly more than the one below", () => {
    for (let level = 1; level < WHEEL_LUCK_MAX_LEVEL - 1; level++) {
      expect(wheelLuckUpgradeCost(level + 1).gold).toBeGreaterThan(
        wheelLuckUpgradeCost(level).gold
      );
    }
  });

  it("is the curve the purchase action actually charges", () => {
    // empireUpgradeCostFor is what both the page and the server action price
    // against; a missed branch there would silently sell 15% at generic prices.
    expect(empireUpgradeCostFor("WHEEL_LUCK", 9)).toEqual(wheelLuckUpgradeCost(9));
  });
});

describe("the turns upgrade", () => {
  it("prices a level against what a level is worth per day", () => {
    // Each level is +1 turn on every tick — 288 turns a day, permanently. The
    // ladder was linear off a 1,500-gold base once, which sold all five levels
    // for ~27K gold; the first rung alone must now cost a city.
    expect(turnsPerRegularUpdate(1) * TICKS_PER_DAY).toBe(288);
    expect(turnsUpgradeCost(1).gold).toBeGreaterThanOrEqual(cityCost(1).gold / 4);
  });

  it("compounds — every level costs strictly more than the one below", () => {
    for (let level = 1; level < TURNS_UPGRADE_MAX_LEVEL - 1; level++) {
      expect(turnsUpgradeCost(level + 1).gold).toBeGreaterThan(
        turnsUpgradeCost(level).gold
      );
    }
  });

  it("charges millions, not thousands, for the whole ladder", () => {
    let gold = 0;
    for (let level = 1; level < TURNS_UPGRADE_MAX_LEVEL; level++) {
      gold += turnsUpgradeCost(level).gold;
    }
    expect(gold).toBeGreaterThan(5_000_000);
  });

  it("is the curve the purchase action actually charges", () => {
    expect(empireUpgradeCostFor("TURNS_PER_REGULAR_UPDATE", 3)).toEqual(
      turnsUpgradeCost(3)
    );
  });
});

describe("power", () => {
  it("treats a missing army as no power rather than throwing", () => {
    expect(armyPower(null)).toBe(0);
    expect(getEmpireMilitaryPower(null, [])).toBe(0);
  });

  it("grows with soldiers", () => {
    expect(armyPower({ soldiers: 100 })).toBeGreaterThan(armyPower({ soldiers: 1 }));
  });

  it("counts only the weapons of the category asked for", () => {
    const key = Object.keys(
      Object.fromEntries([[weaponByKey("" as never)?.key ?? "", 0]])
    );
    expect(key).toBeDefined(); // guard: weaponByKey tolerates an unknown key
    expect(weaponsPower([], "ATTACK")).toBe(0);
  });

  it("rejects an unknown weapon key instead of inventing one", () => {
    expect(weaponByKey("no_such_weapon")).toBeUndefined();
  });

  it("has a finite top tier", () => {
    expect(MAX_WEAPON_TIER).toBeGreaterThan(0);
  });
});

describe("weapon tier curve", () => {
  // The whole point of the tier ladder: a tier costs twice the one below it but
  // is worth 2.5x its power, so buying up is always better than buying wide.
  for (const category of WEAPON_CATEGORIES) {
    it(`doubles the cost and multiplies power by ${WEAPON_POWER_GROWTH} every tier — ${category}`, () => {
      const tiers = weaponsOfCategory(category);
      expect(tiers).toHaveLength(MAX_WEAPON_TIER);

      const base = tiers[0]!.power;
      for (let i = 1; i < tiers.length; i++) {
        const prev = tiers[i - 1]!;
        const cur = tiers[i]!;

        expect(cur.cost.gold).toBe(prev.cost.gold * WEAPON_COST_GROWTH);
        expect(cur.cost.wood).toBe(prev.cost.wood * WEAPON_COST_GROWTH);
        expect(cur.cost.iron).toBe(prev.cost.iron * WEAPON_COST_GROWTH);
        expect(cur.cost.stone).toBe(prev.cost.stone * WEAPON_COST_GROWTH);

        // Power is the exact geometric curve, rounded to a whole number — so
        // the ratio between two neighbours is 2.5 up to that rounding, which
        // only shows on the tiny early tiers (195 -> 488, not 487.5).
        expect(cur.power).toBe(Math.round(base * WEAPON_POWER_GROWTH ** i));
        const ratio = cur.power / prev.power;
        expect(ratio).toBeGreaterThan(WEAPON_POWER_GROWTH - 0.15);
        expect(ratio).toBeLessThan(WEAPON_POWER_GROWTH + 0.15);
      }
    });

    it(`makes every tier worth more power per gold than the one below — ${category}`, () => {
      const tiers = weaponsOfCategory(category);
      for (let i = 1; i < tiers.length; i++) {
        const prev = tiers[i - 1]!;
        const cur = tiers[i]!;
        expect(cur.power / cur.cost.gold).toBeGreaterThan(prev.power / prev.cost.gold);
      }
    });
  }

  it("keeps a stacked top tier precise enough for a Float power column", () => {
    // Power lands in Float columns and is summed across an arsenal. Past tier
    // 30 the ladder outgrows exact-integer range — a stockpile of 1,000 top
    // weapons is ~1.7e17, well over 2^53 — so exactness is no longer the bar.
    // What still has to hold is relative precision: power is only ever ratioed,
    // compared and displayed, never spent against a guarded balance, so a
    // double's ~1e-16 relative error is invisible. Guard that, and guard that
    // the sum stays a finite number instead of overflowing to Infinity.
    const top = Math.max(...WEAPONS.map((w) => w.power));
    const stack = 1_000;
    const summed = top * stack;
    expect(Number.isFinite(summed)).toBe(true);

    // Exact value in BigInt, so the comparison is against real arithmetic and
    // not against another double carrying the same error.
    const exact = BigInt(top) * BigInt(stack);
    const relativeError = Math.abs(summed - Number(exact)) / Number(exact);
    expect(relativeError).toBeLessThan(1e-9);
  });
});
