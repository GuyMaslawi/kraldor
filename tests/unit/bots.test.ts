import { describe, expect, it } from "vitest";
import {
  BOT_MINE_SLAVES,
  BOT_ONLINE_SHARE,
  BOT_NAME_SPACE,
  BOT_SOLDIERS,
  botFallbackName,
  botGarrison,
  botHeroLevel,
  botMineSetup,
  botName,
  botOnline,
  botRealisedPower,
  botWeaponKeys,
  botWeaponTier,
} from "@/lib/game/bots";
import {
  ENSLAVE_MIN_SOLDIERS,
  MAX_CITIES,
  SOLDIER_POWER,
  cityHeroLevelRequired,
} from "@/lib/game/constants";
import { HERO_MAX_LEVEL } from "@/lib/game/hero";
import { weaponByKey, weaponGateStatus } from "@/lib/game/weapons";

/** Every city tier, since almost everything here is "for each of the ten". */
const TIERS = Array.from({ length: MAX_CITIES }, (_, i) => i + 1);

describe("bot hero level", () => {
  it("matches what a player must reach to live in that city", () => {
    for (const tier of TIERS.slice(1)) {
      expect(botHeroLevel(tier)).toBe(cityHeroLevelRequired(tier - 1));
    }
  });

  it("never leaves the legal 1..HERO_MAX_LEVEL range", () => {
    for (const tier of [-5, 0, ...TIERS, 99]) {
      const level = botHeroLevel(tier);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(HERO_MAX_LEVEL);
    }
  });
});

describe("bot weapon tier", () => {
  it("never names a tier the empire's city and hero level have not unlocked", () => {
    for (const tier of TIERS) {
      const heroLevel = botHeroLevel(tier);
      const weaponTier = botWeaponTier(tier, heroLevel);
      expect(weaponGateStatus(weaponTier, tier, heroLevel).met).toBe(true);
    }
  });

  it("is never zero, even for the smallest empire there is", () => {
    // A first-city, level-1 empire has already cleared the opening tiers, so the
    // floor is not reached in practice — but it must exist: tier 0 is not a
    // weapon, and `botWeaponKeys` would hand back three empty strings.
    expect(botWeaponTier(1, 1)).toBeGreaterThanOrEqual(1);
    expect(botWeaponTier(0, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe("bot garrison", () => {
  it("is nineteen soldiers and nothing else, in every city", () => {
    for (const tier of TIERS) {
      const garrison = botGarrison(tier, botHeroLevel(tier));
      expect(garrison.soldiers).toBe(BOT_SOLDIERS);
      expect(garrison.spies).toBe(0);
      expect(garrison.attackWeapons).toBe(0);
      expect(garrison.defenseWeapons).toBe(0);
      expect(garrison.spyWeapons).toBe(0);
    }
  });

  it("stays below the threshold a won attack enslaves from", () => {
    // The whole reason for the number: enslavement fires on a defender holding
    // ENSLAVE_MIN_SOLDIERS or more, and a bot rebuilds itself every hour. One
    // soldier more and a bot is an unlimited supply of mine slaves.
    expect(BOT_SOLDIERS).toBeLessThan(ENSLAVE_MIN_SOLDIERS);
    expect(BOT_SOLDIERS).toBe(19);
  });

  it("fields the bodies and not one point more", () => {
    for (const tier of TIERS) {
      const garrison = botGarrison(tier, botHeroLevel(tier));
      expect(botRealisedPower(garrison)).toBe(BOT_SOLDIERS * SOLDIER_POWER);
    }
  });

  it("is identical for two bots in the same city", () => {
    expect(botGarrison(6, botHeroLevel(6))).toEqual(botGarrison(6, botHeroLevel(6)));
  });

  it("still names a real weapon key in all three categories", () => {
    // The stacks are empty, but the tier is recorded and granted as an unlock —
    // a spy dossier has to read as an empire of this city with a bare armoury.
    for (const tier of TIERS) {
      const garrison = botGarrison(tier, botHeroLevel(tier));
      const keys = botWeaponKeys(garrison.weaponTier);
      expect(weaponByKey(keys.attack)?.category).toBe("ATTACK");
      expect(weaponByKey(keys.defense)?.category).toBe("DEFENSE");
      expect(weaponByKey(keys.spy)?.category).toBe("SPY");
    }
  });
});

describe("bot mines", () => {
  it("scales the level with the tier — the one thing a bot's income follows", () => {
    expect(botMineSetup(MAX_CITIES).level).toBeGreaterThan(botMineSetup(1).level);
  });

  it("staffs every mine the same, whatever the city", () => {
    for (const tier of TIERS) {
      expect(botMineSetup(tier).slavesPerMine).toBe(BOT_MINE_SLAVES);
    }
  });

  it("never leaves a mine unmanned or unbuilt", () => {
    for (const tier of [-5, 0, ...TIERS, 99]) {
      const setup = botMineSetup(tier);
      expect(setup.level).toBeGreaterThanOrEqual(1);
      expect(setup.slavesPerMine).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("bot names", () => {
  it("produces a two-word Hebrew name from the declared space", () => {
    const name = botName(() => 0);
    expect(name.split(" ")).toHaveLength(2);
    expect(name).toMatch(/^[֐-׿]+ [֐-׿]+$/);
  });

  it("covers its whole advertised space and no more", () => {
    const seen = new Set<string>();
    // Exhaustive rather than random: walk every (head, tail) pair by index.
    for (let head = 0; head < BOT_NAME_SPACE; head++) {
      for (let tail = 0; tail < BOT_NAME_SPACE; tail++) {
        let call = 0;
        const name = botName((n) => (call++ === 0 ? head % n : tail % n));
        seen.add(name);
      }
    }
    expect(seen.size).toBe(BOT_NAME_SPACE);
  });

  it("falls back to an ordinal that cannot collide", () => {
    expect(botFallbackName("בני הנחושת", 2)).toBe("בני הנחושת 2");
    expect(botFallbackName("בני הנחושת", 2)).not.toBe(botFallbackName("בני הנחושת", 3));
  });
});

describe("bot presence", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `bot-${i}`);
  const at = (ms: number) => new Date(ms);

  it("is the same answer for the same bot at the same instant", () => {
    // Nothing stores it, so two renders of the same board — two tabs, two
    // servers — agree only because they compute the same thing.
    const now = at(1_770_000_000_000);
    for (const id of ids.slice(0, 20)) {
      expect(botOnline(id, now)).toBe(botOnline(id, now));
    }
  });

  it("lights roughly the declared share of a planted city", () => {
    // Sampled across a day, because the share is an average over the rota and
    // not a promise about any one minute.
    const start = 1_770_000_000_000;
    let lit = 0;
    let seen = 0;
    for (let step = 0; step < 24 * 4; step++) {
      const now = at(start + step * 15 * 60 * 1000);
      for (const id of ids) {
        seen++;
        if (botOnline(id, now)) lit++;
      }
    }
    expect(lit / seen).toBeGreaterThan(BOT_ONLINE_SHARE - 0.08);
    expect(lit / seen).toBeLessThan(BOT_ONLINE_SHARE + 0.08);
  });

  it("never lights all of them and never lights none", () => {
    const start = 1_770_000_000_000;
    for (let step = 0; step < 48; step++) {
      const now = at(start + step * 20 * 60 * 1000);
      const lit = ids.filter((id) => botOnline(id, now)).length;
      expect(lit).toBeGreaterThan(0);
      expect(lit).toBeLessThan(ids.length);
    }
  });

  it("holds a session steady across a refresh of the ladder", () => {
    // The board re-reads every 30 seconds; a dot that flickered between two of
    // those would read as a bug rather than as somebody leaving.
    const start = 1_770_000_000_000;
    let flips = 0;
    for (const id of ids) {
      const before = botOnline(id, at(start));
      if (botOnline(id, at(start + 30_000)) !== before) flips++;
    }
    // A handful of genuine boundary crossings in three hundred, not a shuffle.
    expect(flips).toBeLessThan(ids.length * 0.02);
  });

  it("turns the roster over as the hours pass", () => {
    // The other half of the point: come back later and a different set of names
    // is at the keyboard. The threshold is deliberately strict — most of the
    // roster must have changed after three hours, not one name of it. A rota
    // whose seeds differ only in their last digit is exactly where a weak hash
    // hands back the same set every cycle (see hashUnit), and "not literally
    // identical" would have passed while that bug was live.
    const start = 1_770_000_000_000;
    const now = ids.filter((id) => botOnline(id, at(start)));
    const later = ids.filter((id) => botOnline(id, at(start + 3 * 60 * 60 * 1000)));
    const same = now.filter((id) => later.includes(id)).length;
    expect(same).toBeLessThan(now.length * 0.6);
  });

  it("runs a session past the top of the hour rather than cutting it off", () => {
    // A window that opened at :52 has to survive the cycle boundary — without
    // the previous cycle's test every bot would go dark on the hour.
    const hour = 60 * 60 * 1000;
    const boundary = Math.ceil(1_770_000_000_000 / hour) * hour;
    const before = ids.filter((id) => botOnline(id, at(boundary - 60_000)));
    const after = before.filter((id) => botOnline(id, at(boundary + 60_000)));
    expect(after.length).toBeGreaterThan(0);
  });
});
