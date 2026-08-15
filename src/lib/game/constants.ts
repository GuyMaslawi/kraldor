// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type {
  BuildingType,
  EmpireUpgradeType,
  ResourceStorageType,
} from "@prisma/client";
import type { IconName } from "@/components/ui/Icon";
import type { T, TranslateParams } from "@/i18n/translate";

/**
 * The words for each balance. Deliberately icon-free: a resource's glyph and
 * tint live in `RESOURCE_ICON` / `RESOURCE_ICON_COLOR` (components/ui/Icon), so
 * there is exactly one place that decides what a resource looks like.
 */
export const RESOURCE_META = {
  gold: { label: "זהב" },
  wood: { label: "עץ" },
  iron: { label: "ברזל" },
  stone: { label: "אבן" },
  diamonds: { label: "יהלומים" },
  citizens: { label: "אזרחים" },
  turns: { label: "תורות" },
} as const;

export type ResourceKey = keyof typeof RESOURCE_META;

/** The four storable resources — each has a dedicated warehouse. */
export type StorableResource = "gold" | "wood" | "iron" | "stone";

/**
 * Ceiling on any single counter the game keeps in a Prisma `Int` column — a
 * weapon stack, a unit count in the army.
 *
 * This is the *database's* limit, not a game rule, and it is the only thing
 * that bounds a purchase: buy as many as the treasury can pay for. Postgres
 * stores those columns as int4 (max 2,147,483,647) and rejects anything past it
 * rather than truncating — the statement dies with an out-of-range conversion
 * error, the action falls into its generic catch, and nothing is saved.
 *
 * The value matches ADMIN_INT_MAX (lib/admin.ts) deliberately, so the admin
 * editor can still show and re-save any stack the game itself allows. It is
 * kept here rather than imported from there because `lib/admin` is
 * `server-only` and these bounds are needed in client cards too. The billion of
 * headroom below int4's max is the same headroom ADMIN_INT_MAX leaves, and for
 * the same reason: these counters keep growing after the write.
 */
export const COLUMN_INT_MAX = 1_000_000_000; // 1e9

/**
 * Ceiling on any resource balance the game keeps in a Prisma `Float` column —
 * the five empire balances, the bank, a warehouse, a guild treasury. 999P, the
 * top of the unit ladder `formatNumber` can print (see lib/game/format.ts).
 *
 * Unlike {@link COLUMN_INT_MAX} this is a *game rule*, not a database limit.
 * Postgres `double precision` reaches ~1.8e308, so nothing overflows below it.
 * What does happen is a precision cliff: a double represents whole numbers
 * exactly only up to 2^53 (~9,007T), and at this ceiling consecutive
 * representable values are 131,072 apart. A balance up here is therefore a
 * figure whose bottom six digits are noise — small credits and debits round away
 * entirely. That is acceptable for a ceiling nobody is meant to sit at, and it
 * is the reason the ceiling exists at all rather than being left open.
 *
 * Enforced in the database by a `BEFORE INSERT OR UPDATE` trigger on each table
 * that holds one (migration `20260810000000_resource_ceiling`), not at the ~30
 * call sites that credit a balance. Those are all `{ increment }` expressions
 * evaluated by Postgres, several inside guarded `updateMany` claims whose whole
 * point is that the read and the write are a single statement — clamping in
 * TypeScript would mean reading the balance first, which is exactly the
 * stale-snapshot race those guards exist to close, and any credit site added
 * later would silently opt out. The trigger saturates rather than raising, so a
 * payout landing on the ceiling still commits instead of aborting its
 * transaction. Change this value and the migration has to change with it.
 */
export const RESOURCE_MAX = 999e18; // 999P

/* ------------------------------ update cadence ------------------------------ */

export const GAME_TIMEZONE = "Asia/Jerusalem";

/** Regular production tick length, in minutes. */
export const REGULAR_TICK_MINUTES = 5;
export const REGULAR_TICK_MS = REGULAR_TICK_MINUTES * 60 * 1000;

/**
 * Regular ticks in a day. Anything a tick grants is worth this much per day, so
 * it is the figure that makes a per-tick reward legible — both to a player
 * reading the turns upgrade and to the monitor's turn-burn ceiling.
 */
export const TICKS_PER_DAY = 86_400_000 / REGULAR_TICK_MS;

/** Daily update wall times (Asia/Jerusalem). */
export const DAILY_UPDATE_TIMES: ReadonlyArray<{ hour: number; minute: number }> = [
  { hour: 7, minute: 30 },
  { hour: 19, minute: 30 },
];

/* ------------------------------ buildings ------------------------------ */

export interface BuildingMeta {
  label: string;
  icon: IconName;
  description: string;
  producedResource: StorableResource | null;
  supportsSlaves: boolean;
}

export const BUILDING_META: Record<BuildingType, BuildingMeta> = {
  GOLD_MINE: {
    label: "מכרה זהב",
    icon: "gold",
    description: "כורה זהב מהאדמה. ככל שרמת המכרה גבוהה יותר ויש יותר עבדי מכרות — התפוקה עולה.",
    producedResource: "gold",
    supportsSlaves: true,
  },
  WOOD_CAMP: {
    label: "מכרה עץ",
    icon: "wood",
    description: "עבדי המכרות כורתים כאן עץ לבנייה ולצבא.",
    producedResource: "wood",
    supportsSlaves: true,
  },
  IRON_MINE: {
    label: "מכרה ברזל",
    icon: "iron",
    description: "ברזל הוא הבסיס לכל כלי הנשק של האימפריה.",
    producedResource: "iron",
    supportsSlaves: true,
  },
  STONE_QUARRY: {
    label: "מחצבת אבן",
    icon: "stone",
    description: "אבן איכותית לחומות, מבנים וביצורים.",
    producedResource: "stone",
    supportsSlaves: true,
  },
  BARRACKS: {
    label: "מחנה אימונים",
    icon: "army",
    description: "כאן מאומנים חיילי האימפריה.",
    producedResource: null,
    supportsSlaves: false,
  },
  SPY_CENTER: {
    label: "מרכז מודיעין",
    icon: "spy",
    description: "מרכז הריגול של האימפריה. נדרש להכשרת מרגלים.",
    producedResource: null,
    supportsSlaves: false,
  },
};

export const BUILDING_TYPES = Object.keys(BUILDING_META) as BuildingType[];

/** The four resource mines, in canonical order (also the remainder order for equal splits). */
export const PRODUCTION_BUILDING_TYPES = [
  "GOLD_MINE",
  "WOOD_CAMP",
  "IRON_MINE",
  "STONE_QUARRY",
] as const satisfies readonly BuildingType[];

export type ProductionBuildingType = (typeof PRODUCTION_BUILDING_TYPES)[number];

export function isProductionBuilding(type: BuildingType): type is ProductionBuildingType {
  return (PRODUCTION_BUILDING_TYPES as readonly BuildingType[]).includes(type);
}

/** Mine for each storable resource, matching PRODUCTION_BUILDING_TYPES order. */
export const RESOURCE_TO_MINE: Record<StorableResource, ProductionBuildingType> = {
  gold: "GOLD_MINE",
  wood: "WOOD_CAMP",
  iron: "IRON_MINE",
  stone: "STONE_QUARRY",
};

/* ------------------------------ pricing ------------------------------ */

/** Round to three significant figures so prices read as prices, not as noise. */
function roundPrice(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 2);
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Every ladder in this file is geometric, and they are all geometric for the
 * same reason: income in this game is *multiplicative* — production is
 * `slaves × mine level × cities × ticks`, and all three of those factors grow at
 * once — while a linear price ladder grows by a constant step. The two curves
 * diverge within days.
 *
 * The linear ladders that used to live here (citizens/intelligence/bank deposits
 * at `1,700 × level`, warehouses at `640 × level`, mines at `750 × tier`) proved
 * it in the field: the whole 100-rung citizen ladder came to 8.4M gold — half a
 * percent of a tenth city, and under a minute of late-game income — and a
 * focused player maxed a mine to level {@link MINE_MAX_LEVEL} inside four days,
 * then sat on billions with nothing to spend them on. Playtesters read the
 * upgrades as free, because they were.
 *
 * The factor is chosen per ladder from its *length*, not by taste: a short
 * ladder needs a steep factor to keep its ceiling far away, a long one needs a
 * gentle factor or the top rung leaves the economy entirely. See each
 * `*_COST_GROWTH` for the reasoning behind its own number.
 *
 * `level` is the empire's *current* level and the price is for the next rung, so
 * the exponent is `level - 1`: a ladder's first purchase pays the base flat.
 */
function geometricCost(base: number, growth: number, level: number): number {
  return roundPrice(base * growth ** Math.max(0, level - 1));
}

/* ------------------------------ mines ------------------------------ */

/**
 * Highest mine level. Yield per slave runs 2, 4, … up to 500, so the top
 * level is 250 (level × 2 = 500).
 */
export const MINE_MAX_LEVEL = 250;

/** Level every mine is created at. Mines are built from the start — see newEmpireData. */
export const MINE_START_LEVEL = 1;

/**
 * Production per assigned mine slave per regular update: level × 2, so the
 * starting level-1 mine already pays 2 per slave and the cap pays 500.
 */
export function mineProductionValue(level: number): number {
  // Floored. Nothing in the game writes a negative mine level today — the
  // upgrade path is monotonic and the admin form clamps — but this figure is
  // multiplied by the slave count and credited straight to the empire, so a
  // negative level would *debit* resources on every tick. Clamping here costs
  // nothing and means the next caller cannot reintroduce it.
  return Math.max(0, level) * 2;
}

/** Production per regular update = assigned mine slaves * production value. */
export function mineProductionPerTick(level: number, assignedSlaves: number): number {
  return assignedSlaves * mineProductionValue(level);
}

/**
 * Price of a mine's *first* upgrade, in the mine's own resource. A day-one
 * empire earns roughly 23K gold a day, so 5,000 is an affordable first purchase
 * that still reads as a purchase.
 */
const MINE_UPGRADE_BASE: Record<StorableResource, number> = {
  gold: 5_000,
  wood: 2_800,
  iron: 2_800,
  stone: 2_300,
};

/**
 * Each mine level multiplies the previous level's price by this.
 *
 * The gentlest factor in the file, because this is by far the longest ladder:
 * {@link MINE_MAX_LEVEL} is 250 rungs, and at the ×1.1 used for the empire
 * upgrades the top rung would cost seventeen *trillion* — off the economy
 * entirely. At ×1.05 the ladder totals ~18.9B across its 249 purchases, and a
 * simulated all-in player (everything into slaves, citizen rungs and this
 * ladder) reaches level 113 by day 7, 241 by day 30 and the cap around day 45 —
 * a month and a half instead of the four days the old linear `750 × tier`
 * allowed. Shorten the ladder and this factor has to rise.
 *
 * That same simulation shows what this change does *not* fix: past the cap the
 * player banks hundreds of billions with nothing to spend them on. The endgame
 * needs a gold sink of its own; repricing the climb only buys time.
 */
export const MINE_UPGRADE_COST_GROWTH = 1.05;

/**
 * Cost to upgrade a mine from `level` to `level + 1`. Each mine is
 * upgraded with its own resource only — a gold mine costs gold, a wood
 * camp costs wood, and so on; the other three resources are always 0.
 */
export function mineUpgradeCost(level: number, resource: StorableResource) {
  return {
    gold: 0,
    wood: 0,
    iron: 0,
    stone: 0,
    [resource]: geometricCost(
      MINE_UPGRADE_BASE[resource],
      MINE_UPGRADE_COST_GROWTH,
      level
    ),
  };
}

/* ------------------------------ units ------------------------------ */

export interface UnitMeta {
  label: string;
  labelPlural: string;
  icon: IconName;
  description: string;
  /** Training is free of resources — each unit converts one citizen. */
  citizenCost: number;
  power: number;
}

export const UNIT_META = {
  soldiers: {
    label: "חייל",
    labelPlural: "חיילים",
    icon: "army",
    description: "כוח הלחימה המרכזי של האימפריה.",
    citizenCost: 1,
    power: 10,
  },
  spies: {
    label: "מרגל",
    labelPlural: "מרגלים",
    icon: "spy",
    description: "חושפים מידע על אימפריות יריבות.",
    citizenCost: 1,
    power: 0,
  },
  mineSlaves: {
    label: "עבד מכרות",
    labelPlural: "עבדי מכרות",
    icon: "mine",
    description: "מוצבים במכרות ומגדילים את תפוקת המשאבים.",
    citizenCost: 1,
    power: 0,
  },
} as const satisfies Record<string, UnitMeta>;

export type UnitKey = keyof typeof UNIT_META;
export const UNIT_KEYS = Object.keys(UNIT_META) as UnitKey[];

/** Only soldiers contribute to military power. */
export const SOLDIER_POWER = UNIT_META.soldiers.power;

/**
 * Intelligence rating per spy. A readable player stat only — spy mission
 * success is still driven by the intelligence upgrade + spy weapons.
 */
export const SPY_POWER = 10;

/* ------------------------------ resource storages ------------------------------ */

export interface StorageMeta {
  label: string;
  icon: IconName;
  resourceKey: StorableResource;
}

export const STORAGE_META: Record<ResourceStorageType, StorageMeta> = {
  GOLD: { label: "מחסן זהב", icon: "gold", resourceKey: "gold" },
  WOOD: { label: "מחסן עץ", icon: "wood", resourceKey: "wood" },
  IRON: { label: "מחסן ברזל", icon: "iron", resourceKey: "iron" },
  STONE: { label: "מחסן אבן", icon: "stone", resourceKey: "stone" },
};

export const STORAGE_TYPES = Object.keys(STORAGE_META) as ResourceStorageType[];

/** Warehouse capacity granted by the first level, per resource. */
export const STORAGE_CAPACITY_PER_LEVEL = 10_000;

/**
 * Both warehouse capacity and its price carry this factor per level.
 *
 * Capacity grows with the price on purpose. A warehouse is the only thing that
 * protects resources from plunder, and its capacity is an *absolute* number
 * while everything it defends against is multiplicative — a flat 10,000 per
 * level meant a level-50 warehouse guarded 500K against an empire earning tens
 * of millions a day. Repricing the ladder without rescaling what it buys would
 * not have made warehouses expensive, it would have retired them. Carrying the
 * same factor on both sides holds the gold-per-unit-stored ratio where it has
 * always been, and keeps the linear term so no existing warehouse ever loses
 * capacity under the new curve (the factor is ≥ 1 at every level).
 */
export const STORAGE_GROWTH = 1.05;

export function storageCapacityForLevel(level: number): number {
  if (level <= 0) return 0;
  return Math.round(
    level * STORAGE_CAPACITY_PER_LEVEL * STORAGE_GROWTH ** (level - 1)
  );
}

/**
 * Price of a warehouse's *first* upgrade. Deliberately the gentlest opening
 * rung in the file: a warehouse is what keeps a new empire's resources out of a
 * raider's hands, so the level nobody should be priced out of is level 1. Three
 * times the old `640` puts the first purchase at a few hours of a day-one
 * empire's income — a real decision, not a wall.
 */
const STORAGE_UPGRADE_BASE = {
  gold: 1_200 * 1.6,
  wood: 900 * 1.6,
  iron: 750 * 1.6,
  stone: 750 * 1.6,
} as const;

export function storageUpgradeCost(level: number) {
  // Linear × geometric, matching storageCapacityForLevel exactly, so the price
  // per unit of protected resource is the same at every rung of the ladder.
  const mult = level * STORAGE_GROWTH ** Math.max(0, level - 1);
  return {
    gold: roundPrice(STORAGE_UPGRADE_BASE.gold * mult),
    wood: roundPrice(STORAGE_UPGRADE_BASE.wood * mult),
    iron: roundPrice(STORAGE_UPGRADE_BASE.iron * mult),
    stone: roundPrice(STORAGE_UPGRADE_BASE.stone * mult),
  };
}

/* ------------------------------ empire upgrades ------------------------------ */

export interface EmpireUpgradeMeta {
  label: string;
  icon: IconName;
  /** Translation source; `{placeholders}` are filled from `descriptionParams`. */
  description: string;
  /** The ceilings and growth factors the description quotes. */
  descriptionParams?: TranslateParams;
  /**
   * Human-readable effect for a given level.
   *
   * Takes the translator rather than returning a source string, because the
   * sentence is assembled around a number that only exists at this level — the
   * pattern is the translatable part and the arithmetic stays here.
   *
   * `rate` is only read by CITIZEN_GROWTH, whose effect is admin-tunable; every
   * other upgrade derives its label from deploy-time constants and ignores it.
   */
  effectLabel: (t: T, level: number, rate?: CitizenRate) => string;
  /** Highest reachable level; undefined means uncapped. */
  maxLevel?: number;
}

/**
 * The citizen-intake rate: a flat base plus a per-level step. Lives here rather
 * than in config.ts so client code can render the curve, and so `DEFAULT_TUNABLES`
 * and this function can never drift apart — config.ts seeds its defaults from
 * these two constants.
 */
export const DEFAULT_CITIZENS_BASE = 20;
export const DEFAULT_CITIZENS_PER_LEVEL = 10;

/** The live half of `GameTunables["daily"]` that shapes the citizen curve. */
export interface CitizenRate {
  citizensBase: number;
  citizensPerLevel: number;
}

const DEFAULT_CITIZEN_RATE: CitizenRate = {
  citizensBase: DEFAULT_CITIZENS_BASE,
  citizensPerLevel: DEFAULT_CITIZENS_PER_LEVEL,
};

/**
 * Citizens received on each daily update.
 *
 * `rate` is the live `daily` tunables — pass them anywhere the number is shown
 * to a player, or an admin edit to the balance config will silently change what
 * lands in the treasury while every screen keeps printing the old figure. The
 * default is only for derived, deploy-time ladders (achievement goals), which
 * must stay pinned to the shipped curve rather than move under a live edit.
 */
export function citizensPerDailyUpdate(
  citizenGrowthLevel: number,
  rate: CitizenRate = DEFAULT_CITIZEN_RATE
): number {
  return rate.citizensBase + citizenGrowthLevel * rate.citizensPerLevel;
}

/**
 * Citizen-intake upgrade levels unlocked per city. At the default step of
 * {@link DEFAULT_CITIZENS_PER_LEVEL} that makes each city worth 100 citizens
 * per daily update.
 */
export const CITIZEN_GROWTH_LEVELS_PER_CITY = 10;

/**
 * Highest CITIZEN_GROWTH level for an empire holding `cities` cities: 10 levels
 * per city. The upgrade locks once it reaches this ceiling and founding a new
 * city unlocks another 10 levels — so growth resumes after each city upgrade.
 */
export function citizenGrowthMaxLevel(cities: number): number {
  return cities * CITIZEN_GROWTH_LEVELS_PER_CITY;
}

/** Top level of the intelligence upgrade. */
export const INTELLIGENCE_MAX_LEVEL = 15;

/**
 * The intelligence upgrade multiplies an empire's raw spy power (spies + spy
 * weapons) by +10% per level. Spy missions are resolved deterministically by
 * comparing the attacker's intelligence power against the defender's — no dice
 * roll — so every level directly widens the gap in your favour.
 */
export function intelligencePowerMultiplier(intelligenceLevel: number): number {
  return 1 + intelligenceLevel * 0.1;
}

/** Top level of the wheel-luck upgrade — each level adds 1%, capped at 15%. */
export const WHEEL_LUCK_MAX_LEVEL = 15;

/**
 * Extra chance (as a fraction, e.g. 0.1 = +10%) the wheel-luck upgrade adds to
 * winning a wheel-of-fortune spin — both from throwing away an item and from a
 * winning attack. +1% per level, capped at +15% at level 15.
 */
export function wheelLuckBonus(level: number): number {
  return Math.min(WHEEL_LUCK_MAX_LEVEL, level) * 0.01;
}

/**
 * The whole of an empire's wheel luck, as the fraction the server rolls
 * against: the WHEEL_LUCK upgrade plus גלגל השמיים, the monument that buys the
 * same thing. Two sources, one number, so no caller can quietly honour one of
 * them and forget the other — which is exactly what happened while the monument
 * only touched the daily grant.
 *
 * `monumentPct` is `monumentBonuses(empire.monuments).wheelLuck` — passed in
 * rather than imported so this module stays free of the monument catalog.
 * Together they top out at +25% (15 from the upgrade, 10 from the monument).
 */
export function wheelLuckChance(
  upgradeLevel: number,
  monumentPct: number
): number {
  return wheelLuckBonus(upgradeLevel) + Math.max(0, monumentPct) / 100;
}

/**
 * Wheel luck is the one upgrade priced as a luxury: free spins are the scarcest
 * currency in the game, so every percent has to hurt. The curve is geometric,
 * not linear like the other upgrades — the *first* purchase already costs 30M
 * gold, and the last one (14 → 15) lands near 9B. All 14 purchases together run
 * to roughly 25B gold, the largest single sink in the game.
 *
 * The ladder was multiplied by ten on 2026-08-13: at the old 3M opener the whole
 * 15-level climb was paid off long before a season's economy peaked, which made
 * the cap the default state rather than a luxury. The wheel's own resource
 * wedges pay 5.24B a spin from day 21 on, so a sink priced in single-digit
 * millions was never going to hold.
 *
 * Declared here rather than beside the other cost functions further down because
 * EMPIRE_UPGRADE_META prints the growth factor in its description, and that
 * object literal is evaluated at module init — a `const` below it would be in
 * its temporal dead zone.
 */
const WHEEL_LUCK_BASE_COST = {
  gold: 30_000_000,
  wood: 15_000_000,
  iron: 15_000_000,
  stone: 10_000_000,
} as const;

/** Each wheel-luck level multiplies the previous level's price by this. */
export const WHEEL_LUCK_COST_GROWTH = 1.55;

/** Cost to take wheel luck from `level` to `level + 1`. */
export function wheelLuckUpgradeCost(level: number) {
  const g = WHEEL_LUCK_COST_GROWTH;
  return {
    gold: geometricCost(WHEEL_LUCK_BASE_COST.gold, g, level),
    wood: geometricCost(WHEEL_LUCK_BASE_COST.wood, g, level),
    iron: geometricCost(WHEEL_LUCK_BASE_COST.iron, g, level),
    stone: geometricCost(WHEEL_LUCK_BASE_COST.stone, g, level),
  };
}

/** Highest number of deposits the upgrade can reach. */
export const BANK_DEPOSIT_MAX = 10;
/** Top level of the deposit-count upgrade — level 9 reaches the 10-deposit cap. */
export const BANK_DEPOSIT_COUNT_MAX_LEVEL = 9;

/** Bank deposits allowed between one daily update and the next (capped at 10). */
export function allowedDepositsPerDailyPeriod(level: number): number {
  return Math.min(BANK_DEPOSIT_MAX, 1 + level);
}

/** Top level of the interest upgrade — 6 levels, 1% each, capped at 6%. */
export const BANK_DAILY_INTEREST_MAX_LEVEL = 6;

/** Interest added per upgrade level, and the ceiling the ladder reaches. */
export const BANK_INTEREST_PER_LEVEL = 0.01;
export const BANK_INTEREST_MAX_RATE = 0.06;

/**
 * Bank interest per daily update: 1% per upgrade level, capped at 6% (reached at
 * level 6). The upgrade is also blocked once it hits
 * `BANK_DAILY_INTEREST_MAX_LEVEL`, so the rate never plateaus with wasted upgrades.
 *
 * The rate is still large: interest lands twice a day and compounds on gold
 * `attackEmpire` cannot plunder, so at the ceiling the bank returns 12.4% a day.
 * What holds it in check is the *price* of the ladder, not the rate —
 * `bankInterestUpgradeCost` is geometric and the last rung costs more than three
 * tenth-cities, so 6% is a late-season trophy rather than something an empire
 * walks into. Every rung below it is a real decision between interest and
 * expansion.
 */
export function bankInterestRate(level: number): number {
  // Clamped at both ends: the ceiling is the fix for 15%-per-update compounding
  // on plunder-immune gold, and the floor stops a negative level from quietly
  // charging a player interest on their own savings.
  return Math.min(
    BANK_INTEREST_MAX_RATE,
    Math.max(0, level) * BANK_INTEREST_PER_LEVEL
  );
}

/**
 * Interest is the strongest compounding effect in the game, so its ladder is
 * priced like wheel luck rather than like the generic linear upgrades: the first
 * purchase (1 → 2) already costs twenty times a second city, and the last one
 * (5 → 6) lands past 5B. All five purchases together run to roughly 6.8B gold —
 * an endgame sink no empire clears in its first weeks.
 *
 * The growth factor is steep (×4) precisely *because* the ladder is short: with
 * only five rungs a gentler curve would make 6% a mid-season formality. Shorten
 * the ladder further and this factor has to rise again to keep the ceiling far.
 *
 * Declared above `EMPIRE_UPGRADE_META` because that object literal prints the
 * growth factor in its description and is evaluated at module init.
 */
const BANK_INTEREST_BASE_COST = {
  gold: 20_000_000,
  wood: 10_000_000,
  iron: 10_000_000,
  stone: 7_000_000,
} as const;

/** Each interest level multiplies the previous level's price by this. */
export const BANK_INTEREST_COST_GROWTH = 4;

/** Cost to take bank interest from `level` to `level + 1`. */
export function bankInterestUpgradeCost(level: number) {
  const g = BANK_INTEREST_COST_GROWTH;
  return {
    gold: geometricCost(BANK_INTEREST_BASE_COST.gold, g, level),
    wood: geometricCost(BANK_INTEREST_BASE_COST.wood, g, level),
    iron: geometricCost(BANK_INTEREST_BASE_COST.iron, g, level),
    stone: geometricCost(BANK_INTEREST_BASE_COST.stone, g, level),
  };
}

/* ------------------------------ cities ------------------------------ */

/** Highest number of cities a single empire can hold. */
export const MAX_CITIES = 10;

/** Hero levels demanded per city tier: the 2nd city needs 10, 3rd needs 20… */
export const CITY_HERO_LEVEL_PER_TIER = 10;

/**
 * Hero level the empire must reach before founding its next city. Scales with
 * how many cities it already holds: 10 for the 2nd city, 20 for the 3rd, and so
 * on (`cities` is the current count — 1 for the 2nd city, up to 9 for the 10th).
 */
export function cityHeroLevelRequired(cities: number): number {
  return cities * CITY_HERO_LEVEL_PER_TIER;
}

/**
 * Mine-production multiplier granted by the empire's cities: output scales
 * linearly with the current city count (×1 at one city, ×10 at ten). Because it
 * is derived from the live `cities` value on every tick, losing a city lowers
 * production automatically.
 */
export function cityProductionMultiplier(cities: number): number {
  return cities;
}

/** Every city tier above the first multiplies the previous tier's cost by this. */
export const CITY_COST_TIER_MULTIPLIER = 2.5;

/**
 * The garrison each city demands — one entry per tier, from the 2nd city to the
 * 10th, and the one soldier figure in the game that is *written* rather than
 * computed.
 *
 * Soldiers used to share {@link CITY_COST_TIER_MULTIPLIER}, which put the tenth
 * city at 305,176 — a ×1,526 jump from the second. Resources can carry that
 * shape because mine output is itself multiplied by the city count (see
 * {@link cityProductionMultiplier}) and by mine levels on top, so income grows
 * with the price. An army does not: soldiers are trained one purse at a time and
 * are *lost in battle*, so a requirement growing at 2.5× a tier stopped being a
 * garrison and became a wall only a player who never fought could clear.
 *
 * The ladder runs 200 → 8,000 (×40 over eight rungs, ≈1.59 a tier), but it is a
 * table and not an exponent because this is the one number a player is asked to
 * hold in their head while they train: it sits on the city card for days, gets
 * compared against a live army count, and gets quoted to guildmates. A derived
 * curve pays out 317 / 503 / 1,265 / 5,045 — arithmetically even and impossible
 * to remember. The 1-2-3-5-8 rungs below track the same curve to within a few
 * percent and every one of them is a number you can say out loud.
 *
 * Indexed by tier: index 0 is the 2nd city, index 8 the 10th, so the array has
 * MAX_CITIES - 1 entries and `cityCost` can read it without arithmetic.
 */
export const CITY_SOLDIERS: readonly number[] = [
  200, // 2nd
  300, // 3rd
  500, // 4th
  800, // 5th
  1_200, // 6th
  2_000, // 7th
  3_000, // 8th
  5_000, // 9th
  8_000, // 10th
];

/**
 * Cost to upgrade to the next city, going from `cities` → `cities + 1`. Upgrading
 * to the 2nd city costs 1M gold + 500K of each other resource and a garrison of
 * 200 soldiers; every tier past that multiplies the resource bill by 2.5, while
 * the garrison walks up {@link CITY_SOLDIERS} to 8,000. Soldiers are a
 * requirement the empire must field, not a currency it spends.
 * `cities` is the current count — 1 for the second city, up to 9 for the tenth.
 */
export function cityCost(cities: number) {
  const tier = cities - 1; // 0 for the 2nd city … 8 for the 10th
  const mult = Math.pow(CITY_COST_TIER_MULTIPLIER, tier);
  return {
    gold: Math.round(1_000_000 * mult),
    wood: Math.round(500_000 * mult),
    iron: Math.round(500_000 * mult),
    stone: Math.round(500_000 * mult),
    soldiers:
      CITY_SOLDIERS[Math.min(CITY_SOLDIERS.length - 1, Math.max(0, tier))],
  };
}

/* ------------------------------ turns ------------------------------ */

/** Turns spent per attack. */
export const ATTACK_TURN_COST = 10;

/** Turns spent per spy mission. */
export const SPY_TURN_COST = 5;

/**
 * New-player protection window: a fresh empire can't be attacked or spied for
 * this long after registration, so newcomers aren't farmed the moment they join.
 * It ends early the instant the player launches their own first attack/spy —
 * you can't hide behind the shield while acting aggressively.
 */
export const NEWBIE_PROTECTION_MS = 2 * 60 * 60 * 1000; // 2 hours

export const TURNS_UPGRADE_MAX_LEVEL = 5;

/** Turns gained per regular update from the upgrade alone. */
export function turnsPerRegularUpdate(turnsUpgradeLevel: number): number {
  return turnsUpgradeLevel;
}

/**
 * A turns level is worth far more than its five rungs suggest: ticks fire every
 * {@link REGULAR_TICK_MINUTES} minutes, so each level is +288 turns a day, for
 * good — roughly 29 more attacks a day at {@link ATTACK_TURN_COST} turns each.
 * The ladder used to be linear off a 1,500-gold base, which put all four
 * purchases at ~27K gold in total: less than one mid-level mine upgrade for the
 * fuel to play the game four times over. It is geometric now, like interest and
 * wheel luck, sized so the first rung is a second city's worth of gold and the
 * last is a real mid-game decision (~7.6M gold for the whole ladder).
 *
 * Declared above `EMPIRE_UPGRADE_META` because that object literal prints the
 * growth factor in its description and is evaluated at module init.
 */
const TURNS_UPGRADE_BASE_COST = {
  gold: 300_000,
  wood: 150_000,
  iron: 150_000,
  stone: 100_000,
} as const;

/** Each turns level multiplies the previous level's price by this. */
export const TURNS_UPGRADE_COST_GROWTH = 2.5;

// DIAMOND_YIELD is a retired upgrade: the enum value is kept in the DB for
// existing rows, but it is no longer offered on the upgrades page or granted on
// daily updates, so it is excluded from the metadata that drives the UI.
export type ActiveEmpireUpgradeType = Exclude<EmpireUpgradeType, "DIAMOND_YIELD">;

export const EMPIRE_UPGRADE_META: Record<
  ActiveEmpireUpgradeType,
  EmpireUpgradeMeta
> = {
  CITIZEN_GROWTH: {
    label: "קבלת אזרחים",
    icon: "citizens",
    description: "מגדיל את כמות האזרחים שמתקבלת בכל עדכון יומי.",
    effectLabel: (t, level, rate) =>
      t("{citizens} אזרחים בכל עדכון יומי", {
        citizens: citizensPerDailyUpdate(level, rate),
      }),
  },
  INTELLIGENCE: {
    label: "מודיעין",
    icon: "spy",
    description:
      "מגדיל את כח המודיעין שלך. ריגול מצליח כשכח המודיעין שלך גדול מזה של היעד — בלי הגרלה.",
    effectLabel: (t, level) =>
      t("+{pct}% כח מודיעין", {
        pct: Math.round((intelligencePowerMultiplier(level) - 1) * 100),
      }),
    maxLevel: INTELLIGENCE_MAX_LEVEL,
  },
  BANK_DEPOSIT_COUNT: {
    label: "כמות הפקדות בבנק",
    icon: "bank",
    description: "מגדיל את מספר ההפקדות שניתן לבצע בבנק בין עדכון יומי לעדכון יומי.",
    effectLabel: (t, level) =>
      t("{count} הפקדות בין עדכון יומי לעדכון יומי", {
        count: allowedDepositsPerDailyPeriod(level).toLocaleString("en-US"),
      }),
    maxLevel: BANK_DEPOSIT_COUNT_MAX_LEVEL,
  },
  BANK_DAILY_INTEREST: {
    label: "ריבית בנק",
    icon: "gold",
    description:
      "מוסיף 1% לריבית שמתקבלת בבנק בכל עדכון יומי — עד {max}% ברמה {maxLevel}. הריבית מצטברת פעמיים ביום על זהב שאי אפשר לבזוז, ולכן הסולם יקר: כל רמה עולה פי {growth} מקודמתה.",
    descriptionParams: {
      max: Math.round(BANK_INTEREST_MAX_RATE * 100),
      maxLevel: BANK_DAILY_INTEREST_MAX_LEVEL,
      growth: BANK_INTEREST_COST_GROWTH,
    },
    effectLabel: (t, level) =>
      t("{pct}% ריבית בכל עדכון יומי", {
        pct: Math.round(bankInterestRate(level) * 100),
      }),
    maxLevel: BANK_DAILY_INTEREST_MAX_LEVEL,
  },
  TURNS_PER_REGULAR_UPDATE: {
    label: "קבלת תורות",
    icon: "turns",
    description:
      "מוסיף תור אחד לכל עדכון רגיל — כלומר {perDay} תורות נוספות ביום, לתמיד. לכן הסולם יקר: כל רמה עולה פי {growth} מקודמתה.",
    descriptionParams: {
      perDay: TICKS_PER_DAY,
      growth: TURNS_UPGRADE_COST_GROWTH,
    },
    effectLabel: (t, level) =>
      t("+{turns} תורות לעדכון רגיל ({perDay} ביום)", {
        turns: turnsPerRegularUpdate(level),
        perDay: (turnsPerRegularUpdate(level) * TICKS_PER_DAY).toLocaleString("en-US"),
      }),
    maxLevel: TURNS_UPGRADE_MAX_LEVEL,
  },
  WHEEL_LUCK: {
    label: "מזל הגלגל",
    icon: "wheel",
    description:
      "מוסיף 1% לסיכוי לזכות בסיבוב גלגל מזל — מזריקת חפץ ומתקיפה מנצחת — עד {max}% ברמה המקסימלית. השדרוג היקר במשחק: כל רמה עולה פי {growth} מקודמתה.",
    descriptionParams: {
      max: WHEEL_LUCK_MAX_LEVEL,
      growth: WHEEL_LUCK_COST_GROWTH,
    },
    effectLabel: (t, level) =>
      t("+{pct}% סיכוי לסיבוב גלגל מזל", {
        pct: Math.round(wheelLuckBonus(level) * 100),
      }),
    maxLevel: WHEEL_LUCK_MAX_LEVEL,
  },
};

export const EMPIRE_UPGRADE_TYPES = Object.keys(
  EMPIRE_UPGRADE_META
) as ActiveEmpireUpgradeType[];

/**
 * Effective max level for an upgrade given the empire's city count. Most upgrades
 * use the static `maxLevel` in their metadata; CITIZEN_GROWTH is capped
 * dynamically at 10 levels per city, so founding a new city unlocks 10 more.
 * Returns `undefined` for uncapped upgrades.
 */
export function empireUpgradeMaxLevel(
  type: ActiveEmpireUpgradeType,
  cities: number
): number | undefined {
  if (type === "CITIZEN_GROWTH") return citizenGrowthMaxLevel(cities);
  return EMPIRE_UPGRADE_META[type].maxLevel;
}

/**
 * The generic ladder — CITIZEN_GROWTH, INTELLIGENCE and BANK_DEPOSIT_COUNT all
 * price against it, citizens through the ×
 * {@link CITIZEN_UPGRADE_COST_MULTIPLIER} of their own. The base is a full day
 * of a brand-new empire's gold income, so the very first rung costs something;
 * the old `1,700 × level` opened at 7% of a day and was the purchase
 * playtesters described as free.
 */
const EMPIRE_UPGRADE_BASE_COST = {
  gold: 25_000,
  wood: 13_000,
  iron: 13_000,
  stone: 9_000,
} as const;

/**
 * Each generic-upgrade level multiplies the previous level's price by this.
 *
 * ×1.1 is not arbitrary: {@link CITIZEN_GROWTH_LEVELS_PER_CITY} unlocks ten
 * rungs per city and {@link CITY_COST_TIER_MULTIPLIER} raises the price of a
 * city by 2.5 per tier — and 1.1¹⁰ ≈ 2.59. So ten citizen rungs cost about what
 * one city tier costs, and the ladder stays pinned to the pace at which the game
 * unlocks it however far an empire gets. The full 100-rung citizen ladder now
 * totals ~31B — ~3.1B on the shared base, times
 * {@link CITIZEN_UPGRADE_COST_MULTIPLIER} — against ~8.4M before.
 *
 * The two short ladders that share this curve land where they should as a
 * side effect: all 14 intelligence rungs come to ~700K, all 8 bank-deposit
 * rungs to ~286K.
 */
export const EMPIRE_UPGRADE_COST_GROWTH = 1.1;

export function empireUpgradeCost(level: number) {
  const g = EMPIRE_UPGRADE_COST_GROWTH;
  return {
    gold: geometricCost(EMPIRE_UPGRADE_BASE_COST.gold, g, level),
    wood: geometricCost(EMPIRE_UPGRADE_BASE_COST.wood, g, level),
    iron: geometricCost(EMPIRE_UPGRADE_BASE_COST.iron, g, level),
    stone: geometricCost(EMPIRE_UPGRADE_BASE_COST.stone, g, level),
  };
}

/**
 * Citizens ride on the same ×1.1 curve as intelligence and bank deposits, but
 * off a base ten times higher. The shape is right — ten rungs still cost about
 * one city tier, see {@link EMPIRE_UPGRADE_COST_GROWTH} — the *level* was not:
 * citizens are the raw material of every soldier, the ladder is by far the
 * longest of the three (ten rungs per city, so 100 at {@link MAX_CITIES}), and
 * at 25K opening gold it read as free in play. The other two ladders are short
 * and capped, so they keep the plain base.
 */
export const CITIZEN_UPGRADE_COST_MULTIPLIER = 10;

/** Cost to take citizen intake from `level` to `level + 1`. */
export function citizenGrowthUpgradeCost(level: number) {
  const base = empireUpgradeCost(level);
  const m = CITIZEN_UPGRADE_COST_MULTIPLIER;
  return {
    gold: base.gold * m,
    wood: base.wood * m,
    iron: base.iron * m,
    stone: base.stone * m,
  };
}

/** Cost to take the turns gain from `level` to `level + 1`. */
export function turnsUpgradeCost(level: number) {
  const g = TURNS_UPGRADE_COST_GROWTH;
  return {
    gold: geometricCost(TURNS_UPGRADE_BASE_COST.gold, g, level),
    wood: geometricCost(TURNS_UPGRADE_BASE_COST.wood, g, level),
    iron: geometricCost(TURNS_UPGRADE_BASE_COST.iron, g, level),
    stone: geometricCost(TURNS_UPGRADE_BASE_COST.stone, g, level),
  };
}

/** Cost to upgrade the given empire upgrade from `level` to `level + 1`. */
export function empireUpgradeCostFor(type: EmpireUpgradeType, level: number) {
  if (type === "CITIZEN_GROWTH") return citizenGrowthUpgradeCost(level);
  if (type === "TURNS_PER_REGULAR_UPDATE") return turnsUpgradeCost(level);
  if (type === "WHEEL_LUCK") return wheelLuckUpgradeCost(level);
  if (type === "BANK_DAILY_INTEREST") return bankInterestUpgradeCost(level);
  return empireUpgradeCost(level);
}

/* ------------------------------ battle ------------------------------ */

/** Defender bonus in battle (20%). */
export const DEFENSE_BONUS = 1.2;

/** Winner steals up to 10% of defender resources. */
export const PLUNDER_RATE = 0.1;

/**
 * Enslavement: a winning attack enslaves part of the defender's soldiers when
 * the defender has more than 19 of them. The haul scales with the defender's
 * army size and lands in the attacker's free mine-slave pool (not citizens).
 */
export const ENSLAVE_MIN_SOLDIERS = 20;
export const ENSLAVE_RATE = 0.1;
