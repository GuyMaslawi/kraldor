import type {
  BuildingType,
  DiamondEffectKind,
  EmpireUpgradeType,
  GuildRole,
  GuildSpellType,
  HeroClass,
  HeroItemSlot,
  HeroRarity,
  PotionKind,
  Prisma,
  ResourceStorageType,
  WeaponCategory,
} from "@prisma/client";
import type { FullEmpire } from "./updates";
import { heroReviveAt, rawHeroBonuses, type HeroFlatStat } from "./hero";
import {
  getEmpireAttackPower,
  getEmpireDefensePower,
  getEmpireGeneralPower,
  getEmpireMilitaryPower,
  getEmpireSpyPower,
} from "./power";
import {
  allowedDepositsPerDailyPeriod,
  bankInterestRate,
  storageCapacityForLevel,
} from "./constants";
import { SHIELDS, type ShieldKey } from "./diamondShop";
import { monumentBonuses, monumentMultiplier } from "./monuments";

/**
 * The spy dossier — everything one successful mission brings home.
 *
 * A spy who gets in and out sees the *whole* city, so this is deliberately
 * exhaustive: coffers and vaults, the bank ledger, every weapon in the armoury,
 * the mines and their slaves, the empire upgrades, the hero and his gear, and
 * every timed spell burning down over the target's head with the exact hour it
 * runs out. What the raider does with that is their business — the mission
 * either bought the truth or it bought nothing.
 *
 * It is stored as a JSON snapshot on SpyReport.revealed rather than re-read on
 * view, because a report is a record of what the spy *saw*. Re-opening it
 * tomorrow must not quietly show tomorrow's numbers — that would turn one
 * five-turn mission into a permanent live feed on the target.
 */

/** Bumped whenever the shape changes incompatibly; older payloads are ignored. */
export const SPY_INTEL_VERSION = 1;

export interface SpyIntelResources {
  gold: number;
  wood: number;
  iron: number;
  stone: number;
}

export interface SpyIntelStorage {
  type: ResourceStorageType;
  level: number;
  stored: number;
  capacity: number;
}

export interface SpyIntelBank {
  balance: number;
  depositsUsed: number;
  depositsAllowed: number;
  interestPct: number;
}

export interface SpyIntelPower {
  attack: number;
  defense: number;
  spy: number;
  military: number;
  general: number;
  /** Effective intelligence power — what a counter-spy has to beat. */
  intel: number;
}

export interface SpyIntelWeapon {
  key: string;
  qty: number;
}

export interface SpyIntelHeroItem {
  slot: HeroItemSlot;
  level: number;
  rarity: HeroRarity;
}

export interface SpyIntelHero {
  heroClass: HeroClass;
  level: number;
  xp: number;
  health: number;
  /** ISO stamp of the hour the hero rises again, when he is currently dead. */
  reviveAt: string | null;
  dead: boolean;
  resets: number;
  unspentPoints: number;
  attackPoints: number;
  defensePoints: number;
  resourcePoints: number;
  /**
   * The hero's *raw* percentages — points + gear + class. A dead hero grants
   * none of them until he rises, which `dead`/`reviveAt` say outright; the
   * report shows the sheet and the suspension separately rather than a
   * misleading row of zeroes.
   */
  pct: { attack: number; defense: number; spy: number; resources: number };
  /**
   * Every flat bonus from equipped gear — the per-update yields.
   *
   * Typed as the whole tally rather than a hand-picked list, so a new flat
   * stat reaches the report instead of being silently dropped here. (Reports
   * written before 2026-08-19 also carry the since-removed flat combat powers
   * in this JSON; unknown keys are simply not rendered.)
   */
  flat: Record<HeroFlatStat, number>;
  items: SpyIntelHeroItem[];
  /** The expedition the hero is away on, if any. */
  quest: { tier: number; endsAt: string } | null;
}

/** One timed effect, with the hour it burns out. */
export interface SpyIntelSpell {
  type: GuildSpellType;
  pct: number;
  expiresAt: string;
}

export interface SpyIntelPotion {
  kind: PotionKind;
  expiresAt: string;
}

export interface SpyIntelBoost {
  kind: DiamondEffectKind;
  magnitude: number;
  expiresAt: string;
}

export interface SpyIntelShield {
  key: ShieldKey;
  expiresAt: string;
}

export interface SpyIntel {
  v: number;
  capturedAt: string;

  /* ---- who ---- */
  ruler: string | null;
  level: number;
  cities: number;
  foundedAt: string;
  seasonName: string | null;
  guild: { name: string; role: GuildRole; aidLevel: number } | null;
  /** New-player shield expiry, when one is still running. */
  protectedUntil: string | null;

  /* ---- what he holds ---- */
  citizens: number;
  turns: number;
  diamonds: number;
  wheelSpins: number;
  resources: SpyIntelResources;
  storages: SpyIntelStorage[];
  bank: SpyIntelBank | null;

  /* ---- what he can field ---- */
  army: { soldiers: number; spies: number; mineSlaves: number };
  power: SpyIntelPower;
  weapons: SpyIntelWeapon[];
  weaponUnlocks: { category: WeaponCategory; unlockedTier: number }[];
  buildings: { type: BuildingType; level: number; slaves: number }[];
  upgrades: { type: EmpireUpgradeType; level: number }[];
  hero: SpyIntelHero | null;

  /* ---- what is burning down over his head ---- */
  spells: SpyIntelSpell[];
  potions: SpyIntelPotion[];
  boosts: SpyIntelBoost[];
  shields: SpyIntelShield[];
}

/**
 * The rows that don't ride along on `FullEmpire` and have to be fetched
 * separately at capture time. All of them are cheap, and all are only read
 * when the mission actually succeeded.
 */
export interface SpyIntelExtras {
  rulerName: string | null;
  seasonName: string | null;
  guild: { name: string; role: GuildRole; aidLevel: number } | null;
  spellBuffs: { type: GuildSpellType; bonusPct: number; expiresAt: Date }[];
  potionEffects: { kind: PotionKind; expiresAt: Date }[];
  diamondEffects: {
    kind: DiamondEffectKind;
    magnitude: number;
    activeUntil: Date | null;
  }[];
  heroQuest: { tier: number; endsAt: Date } | null;
  /** Effective intelligence power, as already computed to resolve the mission. */
  intelPower: number;
}

const SHIELD_KIND_TO_KEY = new Map<DiamondEffectKind, ShieldKey>(
  SHIELDS.map((s) => [s.kind, s.key])
);

/** Freeze everything the spy saw into the shape stored on the report. */
export function buildSpyIntel(
  empire: FullEmpire,
  extras: SpyIntelExtras,
  now: Date
): Prisma.InputJsonValue {
  const army = empire.army;
  const bonuses = rawHeroBonuses(empire.hero);
  const hero = empire.hero;

  const intel: SpyIntel = {
    v: SPY_INTEL_VERSION,
    capturedAt: now.toISOString(),

    ruler: extras.rulerName,
    level: empire.level,
    cities: empire.cities,
    foundedAt: empire.createdAt.toISOString(),
    seasonName: extras.seasonName,
    guild: extras.guild,
    protectedUntil:
      empire.protectedUntil && empire.protectedUntil > now
        ? empire.protectedUntil.toISOString()
        : null,

    citizens: empire.citizens,
    turns: empire.turns,
    diamonds: Math.floor(empire.diamonds),
    wheelSpins: empire.wheelSpins,
    resources: {
      gold: Math.floor(empire.gold),
      wood: Math.floor(empire.wood),
      iron: Math.floor(empire.iron),
      stone: Math.floor(empire.stone),
    },
    storages: empire.storages.map((s) => ({
      type: s.resourceType,
      level: s.level,
      stored: Math.floor(s.storedAmount),
      capacity: storageCapacityForLevel(s.level),
    })),
    bank: empire.bankAccount
      ? {
          balance: Math.floor(empire.bankAccount.goldBalance),
          depositsUsed: empire.bankAccount.depositsUsedInCurrentPeriod,
          depositsAllowed: allowedDepositsPerDailyPeriod(
            empire.upgrades.find((u) => u.type === "BANK_DEPOSIT_COUNT")?.level ?? 1
          ),
          // The rate the target's clock actually compounds at — בית הגנזים
          // included. A report is a claim about what the spy saw, so quoting
          // the bare upgrade ladder would understate an empire that built the
          // monument, in the one place a rival looks to size up its economy.
          interestPct:
            bankInterestRate(
              empire.upgrades.find((u) => u.type === "BANK_DAILY_INTEREST")?.level ?? 1
            ) *
            monumentMultiplier(monumentBonuses(empire.monuments).interest) *
            100,
        }
      : null,

    army: {
      soldiers: army?.soldiers ?? 0,
      spies: army?.spies ?? 0,
      mineSlaves: army?.mineSlaves ?? 0,
    },
    power: {
      attack: getEmpireAttackPower(army, empire.weapons),
      defense: getEmpireDefensePower(army, empire.weapons),
      spy: getEmpireSpyPower(army, empire.weapons),
      military: getEmpireMilitaryPower(army, empire.weapons),
      general: getEmpireGeneralPower(army, empire.weapons),
      intel: extras.intelPower,
    },
    // Zero-quantity rows exist for anything ever bought and sold off — they say
    // nothing about the target's arsenal, so they don't travel home.
    weapons: empire.weapons
      .filter((w) => w.quantity > 0)
      .map((w) => ({ key: w.weaponKey, qty: w.quantity })),
    weaponUnlocks: empire.weaponUnlocks.map((u) => ({
      category: u.category,
      unlockedTier: u.unlockedTier,
    })),
    buildings: empire.buildings.map((b) => ({
      type: b.type,
      level: b.level,
      slaves: b.slavesAssigned,
    })),
    upgrades: empire.upgrades.map((u) => ({ type: u.type, level: u.level })),

    hero: hero
      ? {
          heroClass: hero.heroClass,
          level: hero.level,
          xp: hero.xp,
          health: hero.health,
          reviveAt: heroReviveAt(hero)?.toISOString() ?? null,
          dead: hero.diedAt !== null,
          resets: hero.resets,
          unspentPoints: hero.unspentPoints,
          attackPoints: hero.attackPoints,
          defensePoints: hero.defensePoints,
          resourcePoints: hero.resourcePoints,
          pct: {
            ...bonuses.totalPct,
            resources: bonuses.points.resources + bonuses.classPct.resources,
          },
          flat: { ...bonuses.itemsFlat },
          items: hero.items
            .filter((i) => i.equipped)
            .map((i) => ({ slot: i.slot, level: i.level, rarity: i.rarity })),
          quest: extras.heroQuest
            ? {
                tier: extras.heroQuest.tier,
                endsAt: extras.heroQuest.endsAt.toISOString(),
              }
            : null,
        }
      : null,

    spells: extras.spellBuffs
      .filter((b) => b.expiresAt > now)
      .map((b) => ({
        type: b.type,
        pct: b.bonusPct,
        expiresAt: b.expiresAt.toISOString(),
      })),
    potions: extras.potionEffects
      .filter((p) => p.expiresAt > now)
      .map((p) => ({ kind: p.kind, expiresAt: p.expiresAt.toISOString() })),
    // Raid shields are pulled out of the diamond effects into their own list —
    // they're the one effect that changes whether raiding is worth a turn.
    boosts: extras.diamondEffects
      .filter(
        (e) =>
          e.activeUntil !== null &&
          e.activeUntil > now &&
          !SHIELD_KIND_TO_KEY.has(e.kind)
      )
      .map((e) => ({
        kind: e.kind,
        magnitude: e.magnitude,
        expiresAt: e.activeUntil!.toISOString(),
      })),
    shields: extras.diamondEffects
      .filter(
        (e) =>
          e.activeUntil !== null &&
          e.activeUntil > now &&
          SHIELD_KIND_TO_KEY.has(e.kind)
      )
      .map((e) => ({
        key: SHIELD_KIND_TO_KEY.get(e.kind)!,
        expiresAt: e.activeUntil!.toISOString(),
      })),
  };

  return intel as unknown as Prisma.InputJsonValue;
}

/**
 * Read a stored dossier back. Returns null for a failed mission, for reports
 * written before the column existed, and for any payload from a future/other
 * shape — every caller falls back to the flat `revealed*` columns.
 */
export function readSpyIntel(value: unknown): SpyIntel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const intel = value as SpyIntel;
  if (intel.v !== SPY_INTEL_VERSION) return null;
  return intel;
}
