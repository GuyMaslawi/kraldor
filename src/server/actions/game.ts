"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type {
  BuildingType,
  PotionKind,
  Prisma,
  ResourceStorageType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { isBanned } from "@/lib/ban";
import { isStaffEmpire, staffTargetRefusal } from "@/lib/staff";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import { captureSpyIntel } from "@/server/spyIntelCapture";
import { seasonPassSpendUnits } from "@/lib/game/seasonPass";
import { secureRandom } from "@/lib/game/random";
import { formatNumber } from "@/lib/game/format";
import {
  BUILDING_META,
  cityHeroLevelRequired,
  COLUMN_INT_MAX,
  EMPIRE_UPGRADE_META,
  EMPIRE_UPGRADE_TYPES,
  empireUpgradeMaxLevel,
  MAX_CITIES,
  MINE_MAX_LEVEL,
  PRODUCTION_BUILDING_TYPES,
  RESOURCE_META,
  RESOURCE_TO_MINE,
  STORAGE_META,
  UNIT_META,
  cityCost,
  empireUpgradeCostFor,
  mineUpgradeCost,
  storageCapacityForLevel,
  storageUpgradeCost,
  wheelLuckChance,
  type StorableResource,
  type UnitKey,
} from "@/lib/game/constants";
import { monumentBonuses } from "@/lib/game/monuments";
import { getTunables } from "@/lib/game/config";
import { applyPendingUpdates, type FullEmpire } from "@/lib/game/updates";
import { vipRequiredError, isVip } from "@/lib/game/vip";
import { grantCitizens } from "@/lib/game/grants";
import { getActiveGuildBuffPct } from "@/lib/game/guildBuffs";
import { getGuildAidBonus } from "@/lib/game/guildAid";
import { sharedGuild } from "@/lib/game/guildAllies";
import { guildCityNote } from "@/lib/game/guild";
import { applyGuildCityRule } from "@/server/guildCity";
import { getActiveShields, getShopDiscountPct } from "@/lib/game/diamondEffects";
import {
  BURNABLE,
  SABOTAGE_BY_KIND,
  isSabotageKind,
  sabotageAmount,
  sabotageSucceeds,
} from "@/lib/game/sabotage";
import { applyShopDiscount } from "@/lib/game/diamondShop";
import { getActivePotionKinds, grantPotion } from "@/lib/game/potionEffects";
import { POTION_DOUBLE, rollPotionDrop } from "@/lib/game/potions";
import { getLiveHappyHour, happyHourFactor } from "@/server/happyHour";
import { livePoints } from "@/server/fervor";
import { fervorMultiplier, hotAttackDecision } from "@/lib/game/fervor";
import { gameDay } from "@/lib/game/time";
import { armyPower, getEmpireIntelPower } from "@/lib/game/power";
import {
  CITIZENS_PER_LEVEL,
  HERO_BAG_CAPACITY,
  HERO_DAMAGE_PER_LOST_DEFENSE,
  applyHeroXp,
  classXpMultiplier,
  attackWinXp,
  bonusMultiplier,
  damagedHealth,
  heroBonuses,
  heroPowerBonus,
  rollItemDrop,
} from "@/lib/game/hero";
import {
  INITIAL_WEAPON_UNLOCKED_TIER,
  MAX_WEAPON_TIER,
  WEAPON_CATEGORIES,
  weaponByKey,
  weaponGateStatus,
  weaponTierUnlockCost,
  weaponsPower,
} from "@/lib/game/weapons";
import type { ActiveEmpireUpgradeType } from "@/lib/game/constants";
import { getT, type T } from "@/i18n/server";
import { logError } from "@/server/errorLog";
import { notifyPlayerInBackground } from "@/server/notify";
import { syncEmpirePower } from "@/server/empirePower";

export interface ActionState {
  error?: string;
  success?: string;
}

/**
 * Error for a failed cost check: if any lacking resource has protected
 * stock in its warehouse, point the player at withdrawing it.
 */
function insufficientResourcesError(
  t: T,
  empire: FullEmpire,
  cost: Record<StorableResource, number>,
  fallback: string
): string {
  const canWithdrawToCover = empire.storages.some((storage) => {
    const key = STORAGE_META[storage.resourceType].resourceKey;
    return empire[key] < cost[key] && storage.storedAmount > 0;
  });
  return canWithdrawToCover
    ? t("אין מספיק משאבים זמינים. ניתן למשוך משאבים מהמחסן.")
    : fallback;
}

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban on every action (not just page loads); see getActiveEmpireId.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, caught by the action wrapper and replaced with a
  // translated message — never rendered. Same as the ~15 sibling actions.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

function revalidateGame() {
  revalidatePath("/game", "layout");
}

/* ------------------------------ upgrade mine ------------------------------ */

const resourceSchema = z.enum(["gold", "wood", "iron", "stone"]);

export async function upgradeMine(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = resourceSchema.safeParse(formData.get("resource"));
  if (!parsed.success) return { error: t("סוג משאב לא תקין") };
  const type: BuildingType = RESOURCE_TO_MINE[parsed.data];

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const building = empire.buildings.find((b) => b.type === type);
      if (!building) return { error: t("המכרה לא נמצא") };
      if (building.level >= MINE_MAX_LEVEL) {
        return { error: t("המכרה כבר ברמה המקסימלית") };
      }

      const discountPct = await getShopDiscountPct(empireId, tx);
      const cost = applyShopDiscount(
        mineUpgradeCost(building.level, parsed.data),
        discountPct
      );
      if (
        empire.gold < cost.gold ||
        empire.wood < cost.wood ||
        empire.iron < cost.iron ||
        empire.stone < cost.stone
      ) {
        return {
          error: insufficientResourcesError(t, empire, cost, t("אין מספיק משאבים לשדרוג")),
        };
      }

      // Guarded debit: the `gte` conditions make the decrement atomic so two
      // concurrent upgrades can never drive resources negative or double-apply.
      const paid = await tx.empire.updateMany({
        where: {
          id: empireId,
          gold: { gte: cost.gold },
          wood: { gte: cost.wood },
          iron: { gte: cost.iron },
          stone: { gte: cost.stone },
        },
        data: {
          gold: { decrement: cost.gold },
          wood: { decrement: cost.wood },
          iron: { decrement: cost.iron },
          stone: { decrement: cost.stone },
        },
      });
      if (paid.count === 0) {
        return {
          error: insufficientResourcesError(t, empire, cost, t("אין מספיק משאבים לשדרוג")),
        };
      }
      // Guarded on the exact level the price was quoted from, so two concurrent
      // upgrades cannot both buy the same level; throwing rolls the payment back.
      //
      // The resource debit above only serialises racers on the Empire row — it
      // does not stop each of them applying an unconditional `increment: 1`
      // here. Because mineUpgradeCost rises with the level, N concurrent calls
      // used to buy N levels at the snapshot price (50 racers took a mine from
      // level 0 to 50 for 37.5k gold instead of 956k), and the `MINE_MAX_LEVEL`
      // check above — read from the same snapshot — could be raced straight
      // past. Nothing downstream clamps `mineProductionValue`, so overshooting
      // the cap was a permanent uncapped resource faucet.
      const upgraded = await tx.building.updateMany({
        where: {
          id: building.id,
          level: building.level,
        },
        data: { level: { increment: 1 } },
      });
      if (upgraded.count === 0) throw new Error("mine upgrade conflict");
      await awardSeasonPassXp(tx, empireId, "mineUpgrade");

      return {
        success: t("{building} שודרג לרמה {level}!", {
          building: t(BUILDING_META[type].label),
          level: building.level + 1,
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.upgradeMine", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* --------------------------- upgrade mine to max --------------------------- */

/**
 * VIP: every level the treasury can carry, in one press. The free path to the
 * exact same mine is `upgradeMine`, pressed once per level at the same prices —
 * this buys the presses, not the levels.
 */
export async function upgradeMineToMax(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = resourceSchema.safeParse(formData.get("resource"));
  if (!parsed.success) return { error: t("סוג משאב לא תקין") };
  const type: BuildingType = RESOURCE_TO_MINE[parsed.data];

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const building = empire.buildings.find((b) => b.type === type);
      if (!building) return { error: t("המכרה לא נמצא") };
      if (building.level >= MINE_MAX_LEVEL) {
        return { error: t("המכרה כבר ברמה המקסימלית") };
      }
      if (!isVip(empire)) return { error: vipRequiredError(t) };

      const discountPct = await getShopDiscountPct(empireId, tx);

      // Walk from the current level upward, accumulating the cost of each
      // affordable level until the empire runs out of any resource or hits the
      // cap. We debit the summed cost and bump the level in a single write so
      // the whole "upgrade to max" is one atomic, guarded transaction.
      let levels = 0;
      const total = { gold: 0, wood: 0, iron: 0, stone: 0 };
      let gold = empire.gold;
      let wood = empire.wood;
      let iron = empire.iron;
      let stone = empire.stone;
      for (let lvl = building.level; lvl < MINE_MAX_LEVEL; lvl++) {
        const cost = applyShopDiscount(
          mineUpgradeCost(lvl, parsed.data),
          discountPct
        );
        if (
          gold < cost.gold ||
          wood < cost.wood ||
          iron < cost.iron ||
          stone < cost.stone
        ) {
          break;
        }
        gold -= cost.gold;
        wood -= cost.wood;
        iron -= cost.iron;
        stone -= cost.stone;
        total.gold += cost.gold;
        total.wood += cost.wood;
        total.iron += cost.iron;
        total.stone += cost.stone;
        levels++;
      }

      if (levels === 0) {
        const cost = applyShopDiscount(
          mineUpgradeCost(building.level, parsed.data),
          discountPct
        );
        return {
          error: insufficientResourcesError(t, empire, cost, t("אין מספיק משאבים לשדרוג")),
        };
      }

      // Guarded debit: the `gte` conditions keep the summed decrement atomic so
      // concurrent upgrades can never drive resources negative or double-apply.
      const paid = await tx.empire.updateMany({
        where: {
          id: empireId,
          gold: { gte: total.gold },
          wood: { gte: total.wood },
          iron: { gte: total.iron },
          stone: { gte: total.stone },
        },
        data: {
          gold: { decrement: total.gold },
          wood: { decrement: total.wood },
          iron: { decrement: total.iron },
          stone: { decrement: total.stone },
        },
      });
      if (paid.count === 0) {
        const cost = applyShopDiscount(
          mineUpgradeCost(building.level, parsed.data),
          discountPct
        );
        return {
          error: insufficientResourcesError(t, empire, cost, t("אין מספיק משאבים לשדרוג")),
        };
      }
      // Guarded on the level the whole plan was costed from — see upgradeMine
      // for why the resource debit alone is not enough. Throwing rolls back the
      // payment so a losing racer is charged nothing.
      const upgraded = await tx.building.updateMany({
        where: {
          id: building.id,
          level: building.level,
        },
        data: { level: { increment: levels } },
      });
      if (upgraded.count === 0) throw new Error("mine upgrade conflict");
      // Pay per level so bulk-upgrading isn't worse than clicking one at a
      // time, but cap it — an unbounded run to MINE_MAX_LEVEL would clear the
      // whole season-pass ladder in a single click.
      await awardSeasonPassXp(tx, empireId, "mineUpgrade", Math.min(levels, 5));

      return {
        success: t("{building} שודרג לרמה {level}!", {
          building: t(BUILDING_META[type].label),
          level: building.level + levels,
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.upgradeMineToMax", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ assign mine slaves ------------------------------ */

/**
 * Write a full assignment map (mine type -> slaves) inside a transaction,
 * after validating it against the empire's total mine slaves.
 *
 * `compute` also receives the settled empire, which is what lets the two
 * crew-wide shortcuts check the VIP pass against the same read the assignment
 * is validated against, inside the same transaction.
 */
async function applyAssignments(
  empireId: string,
  compute: (
    totalSlaves: number,
    current: Map<BuildingType, number>,
    empire: FullEmpire
  ) => Map<BuildingType, number> | { error: string }
): Promise<ActionState & { assigned?: Map<BuildingType, number> }> {
  // getT() is React-cached per request, so an internal helper resolving the
  // translator itself is free — and it beats threading `t` through every
  // caller's signature.
  const t = await getT();
  return prisma.$transaction(async (tx) => {
    // Serialize concurrent assignments for this empire. Each mine's slave count
    // is read here and written unguarded below; a single-mine assignment keeps
    // the *stale* read of the other three mines. Without this lock, two
    // overlapping assignments to different mines each validate sum≤total against
    // stale siblings and both commit — leaving sum(slavesAssigned) > mineSlaves,
    // i.e. permanent free production. The row lock forces the second to re-read
    // fresh values after the first commits (mirrors attackEmpire's lock).
    await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

    const empire = await applyPendingUpdates(empireId, tx);
    const totalSlaves = empire.army?.mineSlaves ?? 0;

    const mines = empire.buildings.filter((b) =>
      (PRODUCTION_BUILDING_TYPES as readonly BuildingType[]).includes(b.type)
    );
    const current = new Map<BuildingType, number>(
      mines.map((b) => [b.type, b.slavesAssigned])
    );

    const next = compute(totalSlaves, current, empire);
    if (!(next instanceof Map)) return next;

    let sum = 0;
    for (const amount of next.values()) {
      if (amount < 0 || !Number.isInteger(amount)) {
        return { error: t("כמות עבדי מכרות לא תקינה") };
      }
      sum += amount;
    }
    if (sum > totalSlaves) {
      return {
        error: t('אין מספיק עבדי מכרות (סה"כ עבדי מכרות: {total})', {
          total: totalSlaves,
        }),
      };
    }

    for (const mine of mines) {
      const amount = next.get(mine.type);
      if (amount === undefined || amount === mine.slavesAssigned) continue;
      await tx.building.update({
        where: { id: mine.id },
        data: { slavesAssigned: amount },
      });
    }

    return { assigned: next };
  });
}

/**
 * The number in a mine's crew box is a *delta*, not the mine's new total: "10"
 * on a mine already running 100 puts 110 down the shaft. It used to be read as
 * the new total, which quietly released 90 slaves the player never meant to
 * pull off — the field even came pre-filled with the current crew, so typing
 * the number he wanted to add was exactly the wrong move.
 *
 * The mine's crew is re-read inside applyAssignments' row lock, so the delta is
 * applied to the settled figure rather than to whatever the page was rendered
 * with — two quick submits both land.
 */
export async function assignMineSlavesToResource(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = z
    .object({
      resource: resourceSchema,
      amount: z.coerce.number().int().min(1).max(COLUMN_INT_MAX),
      mode: z.enum(["add", "remove"]).default("add"),
    })
    .safeParse({
      resource: formData.get("resource"),
      amount: formData.get("amount"),
      mode: formData.get("mode") ?? undefined,
    });
  if (!parsed.success) return { error: t("כמות עבדי מכרות לא תקינה") };
  const { resource, amount, mode } = parsed.data;
  const mineType = RESOURCE_TO_MINE[resource];

  try {
    const empireId = await requireOwnEmpireId();
    // Filled in by `compute` so the message can quote figures taken from the
    // same locked read the write was validated against.
    let moved = 0;
    let crew = 0;
    const result = await applyAssignments(empireId, (totalSlaves, current) => {
      const before = current.get(mineType) ?? 0;
      let assignedElsewhere = 0;
      for (const [type, value] of current) {
        if (type !== mineType) assignedElsewhere += value;
      }

      if (mode === "remove") {
        // Asking to pull more men off than are standing there empties the mine
        // rather than failing — "remove everything" is the obvious intent.
        crew = Math.max(0, before - amount);
        moved = before - crew;
        if (moved === 0) return { error: t("אין עובדים במכרה הזה") };
      } else {
        const free = Math.max(0, totalSlaves - assignedElsewhere - before);
        if (amount > free) {
          return {
            error: t("אין מספיק עבדי מכרות פנויים (ניתן להוסיף כאן עד {max})", {
              max: free,
            }),
          };
        }
        crew = before + amount;
        moved = amount;
      }

      const next = new Map(current);
      next.set(mineType, crew);
      return next;
    });
    if (result.error) return { error: result.error };

    revalidateGame();
    const mine = t(BUILDING_META[mineType].label);
    return {
      success:
        mode === "remove"
          ? t("הוסרו {count} עבדי מכרות מ{mine} — נשארו {crew}", {
              count: moved,
              mine,
              crew,
            })
          : t("נוספו {count} עבדי מכרות ל{mine} — כעת {crew} במכרה", {
              count: moved,
              mine,
              crew,
            }),
    };
  } catch (err) {
    await logError("game.assignMineSlavesToResource", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * VIP: the whole crew onto one mine. Free players reach the same layout with
 * `assignMineSlavesToResource`, typing the number into each of the four cards.
 */
export async function assignAllMineSlavesToResource(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = resourceSchema.safeParse(formData.get("resource"));
  if (!parsed.success) return { error: t("סוג משאב לא תקין") };
  const resource: StorableResource = parsed.data;
  const mineType = RESOURCE_TO_MINE[resource];

  try {
    const empireId = await requireOwnEmpireId();
    let total = 0;
    const result = await applyAssignments(empireId, (totalSlaves, _current, empire) => {
      if (!isVip(empire)) return { error: vipRequiredError(t) };
      total = totalSlaves;
      const next = new Map<BuildingType, number>(
        PRODUCTION_BUILDING_TYPES.map((type) => [type, 0])
      );
      next.set(mineType, totalSlaves);
      return next;
    });
    if (result.error) return { error: result.error };

    revalidateGame();
    return {
      success: t("כל {total} עבדי המכרות הוצבו ב{resource}", {
        total,
        resource: t(RESOURCE_META[resource].label),
      }),
    };
  } catch (err) {
    await logError("game.assignAllMineSlavesToResource", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/** VIP: an even four-way split. See assignAllMineSlavesToResource. */
export async function splitMineSlavesEqually(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();
    const result = await applyAssignments(empireId, (totalSlaves, _current, empire) => {
      if (!isVip(empire)) return { error: vipRequiredError(t) };
      const base = Math.floor(totalSlaves / PRODUCTION_BUILDING_TYPES.length);
      let remainder = totalSlaves % PRODUCTION_BUILDING_TYPES.length;
      const next = new Map<BuildingType, number>();
      // Remainder goes to GOLD, WOOD, IRON, STONE — in that order.
      for (const type of PRODUCTION_BUILDING_TYPES) {
        next.set(type, base + (remainder > 0 ? 1 : 0));
        remainder--;
      }
      return next;
    });
    if (result.error) return { error: result.error };

    revalidateGame();
    return { success: t("עבדי המכרות חולקו שווה בשווה בין ארבעת המשאבים") };
  } catch (err) {
    await logError("game.splitMineSlavesEqually", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

export async function clearMineSlaveAssignments(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();
    const result = await applyAssignments(empireId, () => {
      return new Map<BuildingType, number>(
        PRODUCTION_BUILDING_TYPES.map((type) => [type, 0])
      );
    });
    if (result.error) return { error: result.error };

    revalidateGame();
    return { success: t("החלוקה נוקתה — כל עבדי המכרות פנויים") };
  } catch (err) {
    await logError("game.clearMineSlaveAssignments", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ train units ------------------------------ */

/**
 * Like a weapons order, an army order is bounded only by what pays for it —
 * here, free citizens. The 100,000 that used to sit here was well under what a
 * grown empire holds, so "train everything" simply failed. See COLUMN_INT_MAX.
 */
const trainSchema = z.object({
  unit: z.enum(["soldiers", "spies", "mineSlaves"]),
  quantity: z.coerce.number().int().min(1).max(COLUMN_INT_MAX),
});

export async function trainUnits(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();

  const parsed = trainSchema.safeParse({
    unit: formData.get("unit"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: t("כמות לא תקינה") };
  const unit: UnitKey = parsed.data.unit;
  const quantity = parsed.data.quantity;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const meta = UNIT_META[unit];

      if (unit === "spies") {
        const spyCenter = empire.buildings.find((b) => b.type === "SPY_CENTER");
        if (!spyCenter || spyCenter.level < 1) {
          return { error: t("נדרש מרכז מודיעין כדי להכשיר מרגלים") };
        }
      }

      // Checked before the debit: an error returned from the callback commits
      // the transaction, so citizens taken here would never come back.
      const held = empire.army?.[unit] ?? 0;
      if (held + quantity > COLUMN_INT_MAX) {
        return {
          error: t("לא ניתן להחזיק יותר מ-{max} {unit} — יש לך כבר {owned}", {
            max: formatNumber(COLUMN_INT_MAX),
            unit: t(meta.labelPlural),
            owned: formatNumber(held),
          }),
        };
      }

      // Training is free of resources — each unit converts one citizen.
      // The guarded update means a concurrent training action can never
      // drive the citizen count negative.
      const citizensNeeded = meta.citizenCost * quantity;
      const debited = await tx.empire.updateMany({
        where: { id: empireId, citizens: { gte: citizensNeeded } },
        data: { citizens: { decrement: citizensNeeded } },
      });
      if (debited.count === 0) {
        return { error: t("אין מספיק אזרחים פנויים לאימון") };
      }
      // Guarded increment for the same reason the weapons order uses one: the
      // ceiling check above read a snapshot, and two orders settling together
      // must not push the column past int4. A conflict throws, which rolls the
      // citizens back with it.
      const mustered = await tx.army.updateMany({
        where: { empireId, [unit]: { lte: COLUMN_INT_MAX - quantity } },
        data: { [unit]: { increment: quantity } },
      });
      if (mustered.count === 0) {
        if (empire.army) throw new Error("army stack ceiling conflict");
        await tx.army.create({ data: { empireId, [unit]: quantity } });
      }
      await syncEmpirePower(tx, empireId);
      await awardSeasonPassXp(
        tx,
        empireId,
        "trainUnits",
        seasonPassSpendUnits("trainUnits", citizensNeeded)
      );

      return {
        success: t("אומנו {count} {unit} בהצלחה!", {
          count: formatNumber(quantity),
          unit: t(meta.labelPlural),
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.trainUnits", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ spy ------------------------------ */

const targetSchema = z.object({ targetEmpireId: z.string().min(1) });

/**
 * Deduct the turn cost of an aggressive action inside its transaction.
 * The guarded update means a concurrent action can never drive turns
 * negative; returns false when the empire lacks enough turns.
 */
async function spendTurns(
  tx: Prisma.TransactionClient,
  empireId: string,
  cost: number
): Promise<boolean> {
  const updated = await tx.empire.updateMany({
    where: { id: empireId, turns: { gte: cost } },
    data: { turns: { decrement: cost } },
  });
  return updated.count > 0;
}

/**
 * Why a target may not be attacked or spied: it belongs to the game's staff, it
 * still holds a new-player shield, or its owner is banned (a banned/dormant
 * account must not be farmable). Returns a user-facing reason, or null when the
 * target is fair game.
 *
 * This is the single choke point both offensive actions pass through, which is
 * why the staff check lives here and not in each of them.
 */
async function targetBlockedReason(
  tx: Prisma.TransactionClient,
  target: { id: string; protectedUntil: Date | null; isStaff: boolean },
  now: Date,
  t: T
): Promise<string | null> {
  if (isStaffEmpire(target)) return staffTargetRefusal(t);
  if (target.protectedUntil && target.protectedUntil > now) {
    return t("האימפריה הזו מוגנת (שחקן חדש) — לא ניתן לתקוף או לרגל אותה עדיין.");
  }
  const owner = await tx.empire.findUnique({
    where: { id: target.id },
    select: { user: { select: { bannedAt: true, bannedUntil: true } } },
  });
  if (owner && isBanned(owner.user, now)) return t("האימפריה הזו אינה זמינה.");
  return null;
}

/**
 * Launching an offensive action (attack or spy) ends the actor's own new-player
 * shield — you can't scout or raid from behind protection. No-op once expired.
 */
async function dropOwnShield(
  tx: Prisma.TransactionClient,
  empireId: string,
  attacker: { protectedUntil: Date | null },
  now: Date
): Promise<void> {
  if (attacker.protectedUntil && attacker.protectedUntil > now) {
    await tx.empire.update({
      where: { id: empireId },
      data: { protectedUntil: null },
    });
  }
}

export async function spyOnEmpire(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = targetSchema.safeParse({
    targetEmpireId: formData.get("targetEmpireId"),
  });
  if (!parsed.success) return { error: t("יעד לא תקין") };
  const { targetEmpireId } = parsed.data;

  // `caught` rides along so the notification below fires only for a mission
  // the defender can actually see — see the note where it is read.
  let outcome: { error: string } | { reportId: string; caught: boolean };
  try {
    const empireId = await requireOwnEmpireId();
    if (empireId === targetEmpireId) {
      return { error: t("לא ניתן לרגל אחרי האימפריה שלך") };
    }

    // Read before the transaction opens. `getTunables` goes to the database on a
    // connection of its own, so asking for it *inside* a transaction means one
    // caller holding a connection while waiting for a second — and on a serverless
    // fleet with a small pool, a burst can end up with every connection held by a
    // transaction waiting for one that will never be freed. It is React-cached per
    // request, so hoisting it costs nothing.
    const { spyTurnCost: SPY_TURN_COST } = (await getTunables()).battle;

    outcome = await prisma.$transaction(async (tx) => {
      const attacker = await applyPendingUpdates(empireId, tx);
      if (!attacker.army || attacker.army.spies < 1) {
        return { error: t("נדרש לפחות מרגל אחד למשימת ריגול") };
      }
      if (attacker.turns < SPY_TURN_COST) {
        return { error: t("אין לך מספיק תורות לביצוע ריגול.") };
      }

      const defender = await applyPendingUpdates(targetEmpireId, tx).catch(
        () => null
      );
      if (!defender) return { error: t("האימפריה המבוקשת לא נמצאה") };

      // You may only operate against empires in your own city — an empire is
      // "in your city" when it holds the same number of cities as you.
      if (defender.cities !== attacker.cities) {
        return { error: t("לא ניתן לרגל אחר אימפריה שאינה בעיר שלך.") };
      }

      // Shielded newcomers and banned accounts are off-limits.
      const now = new Date();
      const blocked = await targetBlockedReason(tx, defender, now, t);
      if (blocked) return { error: blocked };

      // All validations passed — the mission launches, so it costs turns
      // whether the spy succeeds or fails.
      if (!(await spendTurns(tx, empireId, SPY_TURN_COST))) {
        return { error: t("אין לך מספיק תורות לביצוע ריגול.") };
      }
      // Acting aggressively drops your own new-player shield.
      await dropOwnShield(tx, empireId, attacker, now);

      // Spy missions resolve deterministically: the attacker's intelligence
      // power against the defender's. Both sides scale their raw spy power
      // (spies + spy weapons) by their own intelligence upgrade (+10%/level),
      // and the attacker adds its hero spy % on top. Strictly-greater wins —
      // a tie fails.
      //
      // The guild spy spell used to add a flat percentage here and was deleted
      // on 2026-08-03: it made the mission a question of what the guild had
      // bought rather than of intelligence power. `SpyReport.guildBonus` is
      // kept so old reports still itemise the bonus they were decided by; new
      // ones leave it null.
      const attackerIntelLevel =
        attacker.upgrades.find((u) => u.type === "INTELLIGENCE")?.level ?? 1;
      const defenderIntelLevel =
        defender.upgrades.find((u) => u.type === "INTELLIGENCE")?.level ?? 1;
      const heroSpyBonusPct = heroBonuses(attacker.hero).totalPct.spy;
      // Gear spy power is a *base* term — it sits with the spies and the spy
      // weapons — so both sides bring theirs. Only the percentage stays the
      // attacker's, which is the asymmetry this mission has always had.
      const attackerIntel = getEmpireIntelPower(
        attacker.army,
        attacker.weapons,
        attackerIntelLevel,
        heroSpyBonusPct,
        heroPowerBonus(heroBonuses(attacker.hero), "spy")
      );
      const defenderIntel = getEmpireIntelPower(
        defender.army,
        defender.weapons,
        defenderIntelLevel,
        0,
        heroPowerBonus(heroBonuses(defender.hero), "spy")
      );
      const success = attackerIntel > defenderIntel;

      // A spy who gets out brings back the whole city, not a headline: coffers,
      // vaults, the bank ledger, the arsenal, the mines, the upgrades, the hero
      // and every timed spell with the hour it runs out. Captured as a frozen
      // snapshot on the report (see lib/game/spyIntel.ts) so re-opening the
      // report tomorrow shows what the spy saw, not today's live numbers.
      const revealed = success
        ? await captureSpyIntel(tx, defender, now, defenderIntel)
        : undefined;

      const report = await tx.spyReport.create({
        data: {
          attackerEmpireId: empireId,
          defenderEmpireId: targetEmpireId,
          success,
          attackerIntel,
          defenderIntel,
          turnsSpent: SPY_TURN_COST,
          ...(success
            ? {
                // The flat columns stay the report's index: the reports table
                // and the profile card read them without parsing the dossier.
                revealedGold: Math.floor(defender.gold),
                revealedWood: Math.floor(defender.wood),
                revealedIron: Math.floor(defender.iron),
                revealedStone: Math.floor(defender.stone),
                revealedSoldiers: defender.army?.soldiers ?? 0,
                revealedSpies: defender.army?.spies ?? 0,
                revealedMineSlaves: defender.army?.mineSlaves ?? 0,
                revealed,
              }
            : {}),
        },
      });

      if (!success) {
        // A failed mission costs the captured spy. Guarded so a concurrent
        // failure can never drive the spy count negative.
        await tx.army.updateMany({
          where: { empireId, spies: { gte: 1 } },
          data: { spies: { decrement: 1 } },
        });
        await syncEmpirePower(tx, empireId);
        // A caught spy blows the operation — the defender gets an alert.
        await tx.message.create({
          data: {
            empireId: targetEmpireId,
            kind: "SPY",
            // i18n-keys-start: keys plus values, not a rendered sentence — this
            // row is written on the attacker's request and read by the
            // defender. See `renderMessageText`.
            title: "🕵️ מרגל נתפס בשטחך!",
            body: "כוחות הביטחון שלך תפסו מרגל של {attacker} לפני שהספיק לאסוף מידע.",
            bodyParams: { attacker: attacker.name },
            // i18n-keys-end
          },
        });
      }

      // The mission ran — go to the full result page whether it succeeded
      // or the spy was caught. Either way it cost turns, so it earns pass XP.
      await awardSeasonPassXp(tx, empireId, "spy");
      return { reportId: report.id, caught: !success };
    });

    revalidateGame();
    // Only a *caught* spy. A successful mission stays invisible to its target
    // by design (see ReportsTabs), and emailing about one would hand over the
    // one fact the whole mechanic is built to withhold.
    if (!("error" in outcome) && outcome.caught) {
      notifyPlayerInBackground(targetEmpireId, "spy");
    }
  } catch (err) {
    await logError("game.spyOnEmpire", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }

  if ("error" in outcome) return outcome;
  // redirect() throws NEXT_REDIRECT — must run outside the try/catch above.
  redirect(`/game/spy/${outcome.reportId}`);
}

/* ------------------------------ sabotage ------------------------------ */

const sabotageSchema = z.object({
  targetEmpireId: z.string().min(1),
  kind: z.string().refine(isSabotageKind),
});

/**
 * חבלה — a spy mission that breaks something instead of looking at it.
 *
 * Deliberately written here rather than in a module of its own, and reusing
 * `spendTurns`, `targetBlockedReason` and `dropOwnShield` directly. Those three
 * are the single choke point every offensive action in the game passes through
 * — staff, new-player shields and bans are enforced in exactly one place — and
 * a second offensive action that reimplemented them would be a second place for
 * that enforcement to drift. They are not exported for the same reason: this is
 * a `"use server"` module, so an exported async function is a public endpoint.
 *
 * What makes this a *different* action rather than a flag on `spyOnEmpire`:
 *
 *  - it resolves on a **margin** rather than a bare win (SABOTAGE_INTEL_MARGIN),
 *    because destroying property on a hair's-breadth advantage would make every
 *    marginal spy lead a licence to strip a rival;
 *  - it honours the **paid shields**, which a scouting mission has no reason to;
 *  - it commits several spies and loses all of them on failure, where a scout
 *    loses one.
 *
 * And the rule it must never break, stated at length in lib/game/sabotage.ts:
 * it touches stores, gold and mine slaves, and never soldiers, weapons or
 * power. `syncEmpirePower` is still called after a slave kill — mine slaves
 * carry no power, so it can never move a figure, and calling it anyway means
 * the house rule ("every army mutation re-syncs") has no exceptions a later
 * reader has to know about.
 */
export async function sabotageEmpire(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = sabotageSchema.safeParse({
    targetEmpireId: formData.get("targetEmpireId"),
    kind: formData.get("kind"),
  });
  if (!parsed.success) return { error: t("משימת חבלה לא תקינה") };
  const { targetEmpireId } = parsed.data;
  const mission = SABOTAGE_BY_KIND.get(parsed.data.kind)!;

  try {
    const empireId = await requireOwnEmpireId();
    if (empireId === targetEmpireId) {
      return { error: t("לא ניתן לחבל באימפריה שלך") };
    }

    const result = await prisma.$transaction(async (tx) => {
      const attacker = await applyPendingUpdates(empireId, tx);
      const notEnoughSpies = {
        error: t("נדרשים {count} מרגלים למשימה הזו.", { count: mission.spies }),
      };
      if (!attacker.army || attacker.army.spies < mission.spies) {
        return notEnoughSpies;
      }
      if (attacker.turns < mission.turns) {
        return {
          error: t("המשימה עולה {turns} תורות.", { turns: mission.turns }),
        };
      }

      const defender = await applyPendingUpdates(targetEmpireId, tx).catch(
        () => null
      );
      if (!defender) return { error: t("האימפריה המבוקשת לא נמצאה") };

      // Same city tier only — the rule every offensive action in the game keeps.
      if (defender.cities !== attacker.cities) {
        return { error: t("לא ניתן לחבל באימפריה שאינה בעיר שלך.") };
      }

      const now = new Date();
      const blocked = await targetBlockedReason(tx, defender, now, t);
      if (blocked) return { error: blocked };

      // The paid shields block sabotage exactly as they block plunder. A player
      // who bought protection for their resources has bought it against every
      // way of losing them, or the purchase is a lie. Checked *before* the turns
      // are spent: unlike an intelligence failure, this is not a mission that
      // went wrong — it is one that was never possible, and the player could not
      // have known.
      const shields = await getActiveShields(targetEmpireId, tx, now);
      if (shields[mission.shield]) {
        return {
          error: t("על {target} יש מגן פעיל — המשימה הזו לא תעבור.", {
            target: defender.name,
          }),
        };
      }

      // Everything is possible — the mission launches, so it costs turns
      // whether it succeeds or the cell is caught.
      if (!(await spendTurns(tx, empireId, mission.turns))) {
        return {
          error: t("המשימה עולה {turns} תורות.", { turns: mission.turns }),
        };
      }
      await dropOwnShield(tx, empireId, attacker, now);

      // The same intelligence comparison a scouting mission runs, against a
      // higher bar. Nothing new is invented here: sabotage is the existing spy
      // system with a different verb.
      const attackerIntelLevel =
        attacker.upgrades.find((u) => u.type === "INTELLIGENCE")?.level ?? 1;
      const defenderIntelLevel =
        defender.upgrades.find((u) => u.type === "INTELLIGENCE")?.level ?? 1;
      const attackerIntel = getEmpireIntelPower(
        attacker.army,
        attacker.weapons,
        attackerIntelLevel,
        heroBonuses(attacker.hero).totalPct.spy,
        heroPowerBonus(heroBonuses(attacker.hero), "spy")
      );
      const defenderIntel = getEmpireIntelPower(
        defender.army,
        defender.weapons,
        defenderIntelLevel,
        0,
        heroPowerBonus(heroBonuses(defender.hero), "spy")
      );
      const success = sabotageSucceeds(attackerIntel, defenderIntel);

      const taken = {
        goldTaken: 0,
        woodBurned: 0,
        ironBurned: 0,
        stoneBurned: 0,
        slavesKilled: 0,
      };

      if (success) {
        if (mission.kind === "STEAL_PLANS") {
          // Guarded on the exact amount: the defender's balance may have moved
          // since the snapshot above, and a decrement that is not covered would
          // drive them negative. Nothing is credited unless something was taken.
          const amount = sabotageAmount(defender.gold, mission.share);
          if (amount > 0) {
            const robbed = await tx.empire.updateMany({
              where: { id: targetEmpireId, gold: { gte: amount } },
              data: { gold: { decrement: amount } },
            });
            if (robbed.count > 0) {
              await tx.empire.update({
                where: { id: empireId },
                data: { gold: { increment: amount } },
              });
              taken.goldTaken = amount;
            }
          }
        } else if (mission.kind === "BURN_STORES") {
          // The *protected* stock in the warehouses — the pool plunder cannot
          // reach, which is the whole point of the mission. Gold is deliberately
          // not burnable: STEAL_PLANS already covers gold, from the available
          // balance, and two missions that both hit gold would be one mission.
          for (const resource of BURNABLE) {
            // The warehouse enum is the resource key in upper case; asserted
            // rather than inferred so a new StorableResource that has no
            // warehouse fails to compile instead of silently never matching.
            const type = resource.toUpperCase() as ResourceStorageType;
            const store = defender.storages.find((row) => row.resourceType === type);
            if (!store) continue;
            const amount = sabotageAmount(store.storedAmount, mission.share);
            if (amount <= 0) continue;
            const burned = await tx.resourceStorage.updateMany({
              where: { id: store.id, storedAmount: { gte: amount } },
              data: { storedAmount: { decrement: amount } },
            });
            if (burned.count === 0) continue;
            if (resource === "wood") taken.woodBurned = amount;
            if (resource === "iron") taken.ironBurned = amount;
            if (resource === "stone") taken.stoneBurned = amount;
          }
        } else {
          // Mine slaves, not soldiers. They carry no combat power, so this
          // slows the target's mines without touching the ladder — see the
          // header of lib/game/sabotage.ts.
          const amount = sabotageAmount(
            defender.army?.mineSlaves ?? 0,
            mission.share
          );
          if (amount > 0) {
            const killed = await tx.army.updateMany({
              where: { empireId: targetEmpireId, mineSlaves: { gte: amount } },
              data: { mineSlaves: { decrement: amount } },
            });
            if (killed.count > 0) {
              taken.slavesKilled = amount;
              // Cannot move a figure — mine slaves carry no power — but the
              // house rule has no exceptions.
              await syncEmpirePower(tx, targetEmpireId);
            }
          }
        }
      }

      // A failed mission loses the whole cell. Guarded so concurrent failures
      // can never drive the spy count negative, and the report records what was
      // actually lost rather than what was committed.
      let spiesLost = 0;
      if (!success) {
        const lost = await tx.army.updateMany({
          where: { empireId, spies: { gte: mission.spies } },
          data: { spies: { decrement: mission.spies } },
        });
        if (lost.count > 0) {
          spiesLost = mission.spies;
          await syncEmpirePower(tx, empireId);
        }
      }

      const report = await tx.sabotageReport.create({
        data: {
          attackerEmpireId: empireId,
          defenderEmpireId: targetEmpireId,
          kind: mission.kind,
          success,
          attackerIntel,
          defenderIntel,
          turnsSpent: mission.turns,
          spiesSpent: mission.spies,
          spiesLost,
          ...taken,
        },
      });

      // The defender always hears about it. A successful scout stays invisible
      // to its target on purpose; a mission that *destroyed* something cannot,
      // or a player would watch their warehouses empty with no explanation.
      await tx.message.create({
        data: {
          empireId: targetEmpireId,
          kind: "SPY",
          // i18n-keys-start: keys plus values, rendered by renderMessageText
          title: success ? "💥 חבלה בשטחך!" : "🕵️ תא חבלה נתפס בשטחך!",
          body: success
            ? '{attacker} ביצע "{mission}" נגדך. בדוק את ההיסטוריה לפרטים.'
            : "כוחות הביטחון שלך תפסו תא חבלה של {attacker} לפני שהספיק לפעול.",
          // The mission name is itself a key, so it travels as one: the reader's
          // t() resolves it inside the sentence at read time.
          bodyParams: success
            ? { attacker: attacker.name, mission: { key: mission.name } }
            : { attacker: attacker.name },
          // i18n-keys-end
        },
      });

      await awardSeasonPassXp(tx, empireId, "spy");

      return {
        reportId: report.id,
        success: success
          ? t('"{mission}" הצליחה נגד {target}.', {
              mission: t(mission.name),
              target: defender.name,
            })
          : t('"{mission}" נכשלה — התא נתפס ו-{spies} מרגלים אבדו.', {
              mission: t(mission.name),
              spies: spiesLost,
            }),
      };
    });

    revalidateGame();
    // Same shape as the raid notification: outside the transaction, never
    // awaited. Fired whether the cell got in or was caught — both are somebody
    // taking an interest in you, and the defender is told about both in-game.
    if (!("error" in result)) {
      notifyPlayerInBackground(targetEmpireId, "sabotage");
    }
    return result;
  } catch (err) {
    await logError("game.sabotageEmpire", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ attack ------------------------------ */

export async function attackEmpire(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = targetSchema.safeParse({
    targetEmpireId: formData.get("targetEmpireId"),
  });
  if (!parsed.success) return { error: t("יעד לא תקין") };
  const { targetEmpireId } = parsed.data;

  // `breached` rides along so the notification below can fire only for a
  // defence that actually fell — see the note where it is read.
  let outcome: { error: string } | { reportId: string; breached: boolean };
  try {
    const empireId = await requireOwnEmpireId();
    if (empireId === targetEmpireId) {
      return { error: t("לא ניתן לתקוף את האימפריה שלך") };
    }

    // Hoisted above the transaction for the reason spelled out in spyOnEmpire —
    // and it matters most here, because this transaction holds locks on *two*
    // empire rows. A caller blocked waiting for a second connection while sitting
    // on two row locks is the worst version of that stall: it takes other players'
    // battles down with it, not just its own.
    const {
      attackTurnCost: ATTACK_TURN_COST,
      defenseBonus: DEFENSE_BONUS,
      plunderRate: PLUNDER_RATE,
      enslaveRate: ENSLAVE_RATE,
      enslaveMinSoldiers: ENSLAVE_MIN_SOLDIERS,
    } = (await getTunables()).battle;

    outcome = await prisma.$transaction(async (tx) => {
      // Serialize concurrent battles that involve either empire. The army
      // decrements and hero level-up / citizen grants below read a snapshot and
      // then apply unguarded increments/decrements, so without this two
      // simultaneous attacks on the same defender could drive its soldiers
      // negative or double-credit level-up citizens/XP. Locking both empire rows
      // up front — ordered by id so A→B and B→A can't deadlock — forces the
      // second attack to re-read fresh values after the first commits.
      const [lockLo, lockHi] = [empireId, targetEmpireId].sort();
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id IN (${lockLo}, ${lockHi}) FOR UPDATE`;

      const attacker = await applyPendingUpdates(empireId, tx);
      if (attacker.turns < ATTACK_TURN_COST) {
        return { error: t("אין לך מספיק תורות לביצוע תקיפה.") };
      }

      const defender = await applyPendingUpdates(targetEmpireId, tx).catch(
        () => null
      );
      if (!defender) return { error: t("האימפריה המבוקשת לא נמצאה") };

      // Allies don't raid each other. Checked before the city gate so a
      // guildmate hears the real reason, and inside the transaction so leaving
      // the guild and swinging can't both count.
      const allied = await sharedGuild(empireId, targetEmpireId, tx);
      if (allied) {
        return {
          error: t("לא ניתן לתקוף חבר לברית — שניכם בברית {guild}.", {
            guild: allied.name,
          }),
        };
      }

      // Combat is confined to your own city — an empire is "in your city" when
      // it holds the same number of cities as you.
      if (defender.cities !== attacker.cities) {
        return { error: t("לא ניתן לתקוף אימפריה שאינה בעיר שלך.") };
      }

      // Shielded newcomers and banned accounts can't be attacked.
      const now = new Date();
      const blocked = await targetBlockedReason(tx, defender, now, t);
      if (blocked) return { error: blocked };

      // Potions in force on either side. Each is an hour in which one rule of
      // the battle is bent: the attacker's XP or plunder doubled, or the
      // defender's hero walking away from a breach without a scratch. Read once
      // here, after both empire rows are locked, so the whole battle resolves
      // against one consistent view of who is buffed.
      const attackerPotions = await getActivePotionKinds(empireId, tx, now);
      const defenderPotions = await getActivePotionKinds(targetEmpireId, tx, now);

      // Happy Hour — the same window, for everyone on the map at once. Read here
      // alongside the potions and applied the same way: a multiplier on the XP
      // and on the plunder rate, stacking with whatever the two sides already
      // had running rather than replacing it.
      const happyHour = await getLiveHappyHour(tx, now);

      // להט הקרב — the attacker's own presence meter, read here for the same
      // reason as the two above: one consistent view of every multiplier before
      // the battle resolves. Unlike Happy Hour this one is personal, and unlike
      // a potion it was earned in the last few minutes rather than bought.
      //
      // Read from the locked `attacker` row rather than re-queried: the FOR
      // UPDATE at the top of this transaction is what makes it current, and a
      // second read would only widen the window this lock exists to close.
      //
      // Crucially this is read *before* the bump at the end of the battle, so an
      // attack never feeds its own multiplier.
      const attackerFervor = livePoints(attacker, now);
      const fervor = hotAttackDecision(
        attacker.fervorDay,
        attacker.fervorHotAttacks,
        gameDay(now),
        attackerFervor
      );

      // Paid raid shields, read under the same locks for the same reason. They
      // don't stop the raid — the battle resolves, the hero takes his blow and
      // the attacker still earns XP and loot rolls — they only put the
      // defender's property out of reach: no plunder, no enslavement.
      const defenderShields = await getActiveShields(targetEmpireId, tx, now);
      const resourceShielded = defenderShields.resources !== null;
      const soldierShielded = defenderShields.soldiers !== null;

      const attackerArmy = attacker.army;
      const defenderArmy = defender.army;

      if (!attackerArmy || attackerArmy.soldiers === 0) {
        return { error: t("אין לך צבא לתקיפה — אמן חיילים קודם") };
      }

      // All validations passed — the attack launches, so it costs turns
      // whether the attacker wins or loses.
      if (!(await spendTurns(tx, empireId, ATTACK_TURN_COST))) {
        return { error: t("אין לך מספיק תורות לביצוע תקיפה.") };
      }
      // Acting aggressively drops your own new-player shield.
      await dropOwnShield(tx, empireId, attacker, now);

      // Soldiers plus weapons fight: attack weapons boost the attacker,
      // defense weapons boost the defender, and the defender still gets
      // +20% on top of everything. Each hero then multiplies its side by
      // its attack/defense bonus (1 point / item % = +1%), and an active
      // guild spell (attack for the attacker, defense for the defender)
      // multiplies it once more.
      const attackerHero = attacker.hero;
      const defenderHero = defender.hero;
      const attackerBonuses = heroBonuses(attackerHero);
      const defenderBonuses = heroBonuses(defenderHero);
      const attackerHeroBonusPct = attackerBonuses.totalPct.attack;
      const defenderHeroBonusPct = defenderBonuses.totalPct.defense;
      // Flat power from equipped gear. It joins the base beside soldiers and
      // weapons, so the percentages below multiply it too — and a fallen hero
      // contributes none of it, because `heroBonuses` has already zeroed the
      // whole tally he carries.
      const attackerHeroPower = heroPowerBonus(attackerBonuses, "attack");
      const defenderHeroPower = heroPowerBonus(defenderBonuses, "defense");
      const attackerGuildBonusPct = await getActiveGuildBuffPct(
        empireId,
        "ATTACK",
        tx
      );
      const defenderGuildBonusPct = await getActiveGuildBuffPct(
        targetEmpireId,
        "DEFENSE",
        tx
      );
      // Passive guild aid: each side's guild reinforces the fighter with a
      // flat power equal to a % of the guild's total power, added after every
      // own-troop multiplier.
      const attackerGuildAid = await getGuildAidBonus(empireId, tx);
      const defenderGuildAid = await getGuildAidBonus(targetEmpireId, tx);
      const attackerSoldiersPower = armyPower(attackerArmy);
      const attackerWeaponsPower = weaponsPower(attacker.weapons, "ATTACK");
      const defenderSoldiersPower = armyPower(defenderArmy);
      const defenderWeaponsPower = weaponsPower(defender.weapons, "DEFENSE");
      const attackerPower =
        (attackerSoldiersPower + attackerWeaponsPower + attackerHeroPower) *
          bonusMultiplier(attackerHeroBonusPct) *
          bonusMultiplier(attackerGuildBonusPct) +
        attackerGuildAid.power;
      const defenderPower =
        (defenderSoldiersPower + defenderWeaponsPower + defenderHeroPower) *
          DEFENSE_BONUS *
          bonusMultiplier(defenderHeroBonusPct) *
          bonusMultiplier(defenderGuildBonusPct) +
        defenderGuildAid.power;
      const attackerWins = attackerPower > defenderPower;
      const winnerEmpireId = attackerWins ? attacker.id : defender.id;

      // Player-vs-player battles cost no lives: neither side loses soldiers,
      // win or lose. Nothing in the game kills soldiers any more — the city
      // boss stopped drawing blood too (see BOSS_ROUND_LOSS_BASE) — so the
      // whole risk of a raid is the turns, and for the defender the plunder and
      // the enslavement below. Enslaved soldiers are not casualties: they leave
      // the defender's army and arrive alive in the attacker's slave pool.
      const attackerSoldiersLost = 0;
      const defenderSoldiersLost = 0;

      // Enslavement: a winning attack against a defender fielding 20+
      // soldiers captures a share of them. The haul scales with the
      // defender's army size and joins the attacker's free mine-slave pool
      // (not citizens).
      // …unless מגן חיילים is up, in which case not one of them changes hands.
      const enslavedSoldiers =
        attackerWins &&
        !soldierShielded &&
        defenderArmy &&
        defenderArmy.soldiers >= ENSLAVE_MIN_SOLDIERS
          ? Math.min(
              defenderArmy.soldiers,
              Math.max(1, Math.floor(defenderArmy.soldiers * ENSLAVE_RATE))
            )
          : 0;

      // Plunder touches only the defender's available balances — resources
      // deposited in warehouses (storedAmount) are protected from attacks.
      // שיקוי השפע doubles the attacker's share; the live clamp below still
      // caps the haul at what the defender actually holds.
      // Happy Hour multiplies it further, for everyone at once. Capped at 1: with
      // a ×10 window and a potion up the raw rate runs past 100%, and a haul
      // that claims to take more than the defender owns is a lie the clamp
      // below silently corrects — better to say "everything" and mean it.
      // להט הקרב rides here too, and only here — the meter boosts what a turn is
      // *worth*, never how fast turns arrive. Plunder is a transfer between two
      // players, so a multiplier on it moves resources around the map without
      // minting any: the one boost in the game that cannot inflate an economy
      // already ceilinged at 999P.
      //
      // A slot is spent only on a raid that actually pays. A loss takes nothing
      // and a resource-shielded defender hands over nothing, and burning the
      // day's allowance on a haul of zero would punish exactly the player the
      // allowance exists to protect.
      const fervorHot = attackerWins && !resourceShielded && fervor.hot;
      const fervorPlunder = fervorHot ? fervorMultiplier(attackerFervor) : 1;
      // Whether the boost is *charged* for is decided further down, against the
      // haul that was actually taken — a rate applied to an empty treasury is
      // still a rate of nothing, and a slot spent on it would be a slot stolen
      // from the player for no benefit. See `fervorPaid`.
      const plunderRate = Math.min(
        1,
        PLUNDER_RATE *
          (attackerPotions.has("DOUBLE_RESOURCES") ? POTION_DOUBLE : 1) *
          happyHourFactor(happyHour, "boostPlunder") *
          fervorPlunder
      );
      // מגן משאבים zeroes the haul outright — the raid is won, the vaults hold.
      const stolen =
        attackerWins && !resourceShielded
          ? {
              gold: Math.floor(defender.gold * plunderRate),
              wood: Math.floor(defender.wood * plunderRate),
              iron: Math.floor(defender.iron * plunderRate),
              stone: Math.floor(defender.stone * plunderRate),
            }
          : { gold: 0, wood: 0, iron: 0, stone: 0 };

      // Only the enslaved change hands — no casualties to write on either side.
      if (enslavedSoldiers > 0) {
        await tx.army.update({
          where: { empireId },
          // Captured defenders arrive as unassigned mine slaves.
          data: { mineSlaves: { increment: enslavedSoldiers } },
        });
        await tx.army.update({
          where: { empireId: targetEmpireId },
          data: { soldiers: { decrement: enslavedSoldiers } },
        });
        // Only the defender's fighting strength moved — the attacker gained
        // mine slaves, which no power figure counts — but both are synced so
        // the rule stays "any army write re-syncs", with no exceptions to
        // remember.
        await syncEmpirePower(tx, empireId);
        await syncEmpirePower(tx, targetEmpireId);
      }

      // A shielded defender skips the whole transfer — with every figure at
      // zero there is nothing to clamp, debit or credit.
      if (attackerWins && !resourceShielded) {
        // Re-read the defender's live balances inside the transaction and clamp
        // the plunder to what is actually available, so overlapping attacks on
        // the same defender can never drive it negative or mint resources for
        // the attacker that were not truly removed.
        const live = await tx.empire.findUnique({
          where: { id: targetEmpireId },
          select: { gold: true, wood: true, iron: true, stone: true },
        });
        stolen.gold = Math.min(stolen.gold, Math.max(0, Math.floor(live?.gold ?? 0)));
        stolen.wood = Math.min(stolen.wood, Math.max(0, Math.floor(live?.wood ?? 0)));
        stolen.iron = Math.min(stolen.iron, Math.max(0, Math.floor(live?.iron ?? 0)));
        stolen.stone = Math.min(stolen.stone, Math.max(0, Math.floor(live?.stone ?? 0)));

        // Guarded debit: only remove what is still present at write time; if a
        // concurrent attack already drained it, `count === 0` and we credit
        // nothing rather than duplicating resources.
        const looted = await tx.empire.updateMany({
          where: {
            id: targetEmpireId,
            gold: { gte: stolen.gold },
            wood: { gte: stolen.wood },
            iron: { gte: stolen.iron },
            stone: { gte: stolen.stone },
          },
          data: {
            gold: { decrement: stolen.gold },
            wood: { decrement: stolen.wood },
            iron: { decrement: stolen.iron },
            stone: { decrement: stolen.stone },
          },
        });
        if (looted.count === 0) {
          stolen.gold = 0;
          stolen.wood = 0;
          stolen.iron = 0;
          stolen.stone = 0;
        }
        await tx.empire.update({
          where: { id: empireId },
          data: {
            gold: { increment: stolen.gold },
            wood: { increment: stolen.wood },
            iron: { increment: stolen.iron },
            stone: { increment: stolen.stone },
          },
        });
      }

      /* ---- the defending hero takes the blow ---- */
      // Only a breach wounds him: repel the raid and your hero is untouched.
      // At zero health he falls, and a fallen hero stops granting *every*
      // bonus he carries — points, gear and class alike (see heroBonuses) —
      // until he rises an hour later or his owner pays to raise him at once.
      // …unless שיקוי החסינות is running, in which case the blow lands on the
      // empire but never on the hero: he keeps every point of health, and with
      // it every bonus he carries.
      let defenderHeroDamage = 0;
      let defenderHeroHealth = defenderHero?.health ?? 0;
      let defenderHeroFell = false;
      const defenderHeroShielded =
        attackerWins &&
        defenderHero != null &&
        defenderHero.health > 0 &&
        defenderPotions.has("HERO_INVULNERABLE");
      if (
        attackerWins &&
        defenderHero &&
        defenderHero.health > 0 &&
        !defenderHeroShielded
      ) {
        const nextHealth = damagedHealth(
          defenderHero.health,
          HERO_DAMAGE_PER_LOST_DEFENSE
        );
        // Guarded on the health we read. Both empire rows are locked above, so
        // no second battle can be in here — but a diamond revival that slipped
        // in must not be clobbered back down to a wounded (or dead) hero.
        const wounded = await tx.hero.updateMany({
          where: { id: defenderHero.id, health: defenderHero.health },
          data: {
            health: nextHealth,
            // The hour starts at the blow that felled him; a hero already down
            // keeps his original timer (he takes no further damage at 0).
            ...(nextHealth === 0 ? { diedAt: now } : {}),
          },
        });
        if (wounded.count > 0) {
          defenderHeroDamage = defenderHero.health - nextHealth;
          defenderHeroHealth = nextHealth;
          defenderHeroFell = nextHealth === 0;
        }
      }

      /* ---- heroes: battle XP + level-ups (1 stat point per level) ---- */
      // A winning attack is the only thing here that pays XP: a repelled
      // attacker earns nothing, and neither does the defender who repelled him
      // (see `attackWinXp` for why defending is deliberately unpaid).
      // שיקוי הניסיון doubles the winner's haul of XP. Folded in here rather
      // than at the hero write, so the battle report shows the XP that was
      // really earned instead of the un-doubled base. Happy Hour multiplies on
      // top of it.
      const attackerXpMultiplier =
        (attackerPotions.has("DOUBLE_XP") ? POTION_DOUBLE : 1) *
        happyHourFactor(happyHour, "boostXp");
      // Both standings feed the formula: the XP is a comparison (see
      // `levelGapXpFactor`), so a heroless side is read as a level-1 rookie.
      const attackerStanding = {
        level: attackerHero?.level ?? 1,
        resets: attackerHero?.resets ?? 0,
      };
      const defenderStanding = {
        level: defenderHero?.level ?? 1,
        resets: defenderHero?.resets ?? 0,
      };
      const attackerHeroXp = attackerWins
        ? Math.round(
            attackWinXp(
              attackerStanding,
              defenderStanding,
              attackerPower,
              defenderPower
            ) * attackerXpMultiplier
          )
        : 0;

      if (attackerHero && attackerHeroXp > 0) {
        // The class XP bonus (הצל) scales every battle-XP gain.
        const next = applyHeroXp(
          attackerHero,
          Math.round(attackerHeroXp * classXpMultiplier(attackerHero))
        );
        await tx.hero.update({
          where: { id: attackerHero.id },
          data: {
            level: next.level,
            xp: next.xp,
            unspentPoints: { increment: next.pointsGained },
          },
        });
        // Each hero level gained hands the empire fresh citizens — through
        // grantCitizens so the city ceiling holds, since a raw increment here
        // minted citizens rather than moving them: farming a controlled alt was
        // a net population faucet.
        const levelsGained = next.level - attackerHero.level;
        if (levelsGained > 0) {
          await grantCitizens(tx, empireId, levelsGained * CITIZENS_PER_LEVEL);
        }
      }
      /* ---- item capture: winning attacks can loot a hero item ---- */
      let droppedItem: ReturnType<typeof rollItemDrop> = null;
      if (attackerWins && attackerHero) {
        // Count the bag live, not off `attackerHero.items`: that snapshot was
        // read before this tx took the empire locks, so a drop that landed in
        // between would be invisible and the bag could overflow its capacity.
        const bagCount = await tx.heroItem.count({
          where: { heroId: attackerHero.id, equipped: false },
        });
        if (bagCount < HERO_BAG_CAPACITY) {
          // Loot rolls near the attacker's hero level — usable soon, not
          // trivially high/low because of who the target happened to be.
          droppedItem = rollItemDrop(attackerHero.level);
          if (droppedItem) {
            await tx.heroItem.create({
              data: { heroId: attackerHero.id, ...droppedItem },
            });
          }
        }
      }

      /* ---- potion capture: winning attacks can also yield a brew ---- */
      // Potions stack by count rather than by slot, so there is no bag to check
      // — only the (very high) per-kind cap, which grantPotion reports on.
      let droppedPotion: PotionKind | null = null;
      if (attackerWins) {
        const rolled = rollPotionDrop();
        if (rolled && (await grantPotion(tx, empireId, rolled))) {
          droppedPotion = rolled;
        }
      }

      /* ---- wheel-of-fortune spin: a winning attack has a wheel-luck chance ---- */
      let wonWheelSpin = false;
      if (attackerWins) {
        const wheelLuckLevel =
          attacker.upgrades.find((u) => u.type === "WHEEL_LUCK")?.level ?? 1;
        // גלגל השמיים rides on the same roll as the upgrade — the monument buys
        // luck, and this is one of the two places luck is spent.
        wonWheelSpin =
          secureRandom() <
          wheelLuckChance(
            wheelLuckLevel,
            monumentBonuses(attacker.monuments).wheelLuck
          );
        if (wonWheelSpin) {
          await tx.empire.update({
            where: { id: empireId },
            data: { wheelSpins: { increment: 1 } },
          });
        }
      }

      /* ---- להט הקרב: spend the day's slot, then credit the action ---- */
      // A slot is charged only for a raid the boost actually paid for. Winning
      // and unshielded is not enough: a defender who has already been drained
      // to nothing hands over nothing, and `stolen` is clamped to his live
      // balances a few lines above precisely because that is common. Charging
      // the day's allowance for a haul of zero would take the boost away from
      // the player without ever giving it to him — and the small, frequently
      // raided pockets of the map are exactly where that would happen most.
      //
      // Read off the clamped figures, not the pre-clamp ones, so what was
      // charged for is what was truly taken.
      const fervorPaid =
        fervorHot &&
        stolen.gold + stolen.wood + stolen.iron + stolen.stone > 0;
      // The day is stamped alongside the counter so a stale `fervorDay` rolls
      // over here rather than in something that has to be running at midnight —
      // the same trick the daily streak uses.
      if (fervorPaid) {
        await tx.empire.update({
          where: { id: empireId },
          data: { fervorDay: gameDay(now), fervorHotAttacks: fervor.nextHot },
        });
      }
      // The meter itself is heated further down by `awardSeasonPassXp`, which is
      // where every tracked action in the game feeds it — see the note on that
      // function. It runs well after `attackerFervor` was read at the top of
      // this transaction, so an attack never feeds its own multiplier.

      const report = await tx.battleReport.create({
        data: {
          attackerEmpireId: empireId,
          defenderEmpireId: targetEmpireId,
          attackerPower,
          defenderPower,
          attackerSoldiersPower,
          attackerWeaponsPower,
          defenderSoldiersPower,
          defenderWeaponsPower,
          winnerEmpireId,
          attackerSoldiersLost,
          defenderSoldiersLost,
          enslavedSoldiers,
          stolenGold: stolen.gold,
          stolenWood: stolen.wood,
          stolenIron: stolen.iron,
          stolenStone: stolen.stone,
          turnsSpent: ATTACK_TURN_COST,
          attackerHeroBonusPct,
          defenderHeroBonusPct,
          attackerHeroPower,
          defenderHeroPower,
          attackerGuildBonusPct,
          defenderGuildBonusPct,
          // Every remaining term of the two power formulas above, so the battle
          // report can itemise a total instead of asserting one.
          attackerGuildAidPct: attackerGuildAid.pct,
          attackerGuildAidPower: attackerGuildAid.power,
          defenderGuildAidPct: defenderGuildAid.pct,
          defenderGuildAidPower: defenderGuildAid.power,
          // Unrounded, so the report's ledger reproduces the battle exactly
          // even on a fractional tunable; the display rounds it.
          defenseBonusPct: (DEFENSE_BONUS - 1) * 100,
          attackerHeroXp,
          // Always 0 now — defending pays no XP. The column stays so reports
          // written while it did still read back honestly.
          defenderHeroXp: 0,
          wonWheelSpin,
          // Recorded on a win only: on a repelled raid nothing was at stake, so
          // flagging the shields would credit them with a save they never made.
          defenderResourceShielded: attackerWins && resourceShielded,
          defenderSoldierShielded: attackerWins && soldierShielded,
          // Null unless the meter actually moved this haul — see the column's
          // note. `fervorPaid` already carries "won, unshielded, inside the
          // day's allowance and took something", so there is nothing left to
          // re-check here.
          attackerFervorPct: fervorPaid
            ? Math.round((fervorPlunder - 1) * 100)
            : null,
          ...(droppedItem
            ? {
                droppedItemSlot: droppedItem.slot,
                droppedItemLevel: droppedItem.level,
                droppedItemRarity: droppedItem.rarity,
              }
            : {}),
          ...(droppedPotion ? { droppedPotionKind: droppedPotion } : {}),
        },
      });

      // The defender wasn't in the room — drop the battle alert in their inbox.
      //
      // Stored as dictionary keys plus their values rather than as a finished
      // sentence, and that is the whole point here: `getT()` resolves the
      // language of whoever is making the request — the *attacker* — while the
      // only person who will ever read this row is the defender. Rendering it
      // now would freeze the message in a language chosen by their enemy.
      // `renderMessageText` assembles it when the inbox is opened instead.
      //
      // The body is composed from three clauses (enslavement, plunder, the
      // defender's hero), each a key of its own with its own numbers, because
      // any of them may be absent. See the note on the clause spacing there.
      // i18n-keys-start: every string in the clauses and the message below is a
      // dictionary key, resolved by renderMessageText when the defender opens
      // their inbox.
      const enslavementClause = soldierShielded
        ? { key: "🛡️ מגן החיילים שלך מנע שעבוד — אף חייל לא נלקח." }
        : enslavedSoldiers > 0
          ? {
              key: "{count} חיילים נלקחו לעבדות.",
              params: { count: enslavedSoldiers },
            }
          : "";
      const plunderClause = resourceShielded
        ? { key: "🛡️ מגן המשאבים שלך חסם את הביזה — לא נלקח ממך ולו משאב אחד." }
        : {
            key: "נבזזו ממך {gold} זהב, {wood} עץ, {iron} ברזל ו־{stone} אבן.",
            params: {
              gold: stolen.gold,
              wood: stolen.wood,
              iron: stolen.iron,
              stone: stolen.stone,
            },
          };
      const heroClause = defenderHeroShielded
        ? { key: "🧪 שיקוי החסינות הגן על הגיבור שלך — הוא יצא מהקרב ללא פגע." }
        : defenderHeroFell
          ? {
              key: "💀 הגיבור שלך נפל בקרב! כל הנקודות והבונוסים שלו מושבתים עד שיקום לתחייה.",
            }
          : defenderHeroDamage > 0
            ? {
                key: "הגיבור שלך ספג {damage} נזק — נותרו לו {health}% חיים.",
                params: { damage: defenderHeroDamage, health: defenderHeroHealth },
              }
            : "";

      await tx.message.create({
        data: {
          empireId: targetEmpireId,
          kind: "BATTLE",
          title: attackerWins
            ? "⚔️ הותקפת על ידי {attacker} — ההגנה נפרצה"
            : "🛡️ הדפת התקפה של {attacker}!",
          titleParams: { attacker: attacker.name },
          body: attackerWins
            ? "{enslavement} {plunder} צבאך לא ספג אבדות. {hero}"
            : "צבאך עמד איתן מול ההתקפה — לא איבדת חיילים או משאבים.",
          bodyParams: attackerWins
            ? {
                enslavement: enslavementClause,
                plunder: plunderClause,
                hero: heroClause,
              }
            : undefined,
          href: `/game/battle/${report.id}`,
        },
      });
      // i18n-keys-end

      // The battle resolved — go to the full WIN/LOSE result page either way.
      // XP is paid for launching the attack, win or lose; the turns are spent
      // regardless and the pass should not punish a failed raid.
      await awardSeasonPassXp(tx, empireId, "attack");
      return { reportId: report.id, breached: attackerWins };
    });

    revalidateGame();
    // Outside the transaction, and deliberately not awaited: the battle has
    // already committed, and a mail provider having a bad minute must not cost
    // the attacker their raid. Only a *breach* is worth an email — a defence
    // that held is good news the player can find at their leisure. See
    // server/notify.ts for the cooldown that keeps a farmed player from
    // receiving twenty of these.
    if (!("error" in outcome) && outcome.breached) {
      notifyPlayerInBackground(targetEmpireId, "raid");
    }
  } catch (err) {
    await logError("game.attackEmpire", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }

  if ("error" in outcome) return outcome;
  // redirect() throws NEXT_REDIRECT — must run outside the try/catch above.
  redirect(`/game/battle/${outcome.reportId}`);
}

/* ------------------------------ upgrade storage ------------------------------ */

const storageTypeSchema = z.enum(["GOLD", "WOOD", "IRON", "STONE"]);

export async function upgradeStorage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = storageTypeSchema.safeParse(formData.get("resourceType"));
  if (!parsed.success) return { error: t("סוג מחסן לא תקין") };
  const resourceType = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const storage = empire.storages.find((s) => s.resourceType === resourceType);
      if (!storage) return { error: t("המחסן לא נמצא") };

      const discountPct = await getShopDiscountPct(empireId, tx);
      const cost = applyShopDiscount(storageUpgradeCost(storage.level), discountPct);
      if (
        empire.gold < cost.gold ||
        empire.wood < cost.wood ||
        empire.iron < cost.iron ||
        empire.stone < cost.stone
      ) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים לשדרוג המחסן")
          ),
        };
      }

      // Guarded debit (atomic) — prevents concurrent upgrades from going negative.
      const paid = await tx.empire.updateMany({
        where: {
          id: empireId,
          gold: { gte: cost.gold },
          wood: { gte: cost.wood },
          iron: { gte: cost.iron },
          stone: { gte: cost.stone },
        },
        data: {
          gold: { decrement: cost.gold },
          wood: { decrement: cost.wood },
          iron: { decrement: cost.iron },
          stone: { decrement: cost.stone },
        },
      });
      if (paid.count === 0) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים לשדרוג המחסן")
          ),
        };
      }
      // Guarded on the level the price came from — see upgradeMine. Storage
      // capacity is the pool attackEmpire cannot plunder, so buying levels at a
      // stale price converted directly into plunder immunity.
      const upgraded = await tx.resourceStorage.updateMany({
        where: {
          id: storage.id,
          level: storage.level,
        },
        data: { level: { increment: 1 } },
      });
      if (upgraded.count === 0) throw new Error("storage upgrade conflict");

      await awardSeasonPassXp(tx, empireId, "storageUpgrade");

      const newCapacity = storageCapacityForLevel(storage.level + 1);
      return {
        success: t("{storage} שודרג לרמה {level} (קיבולת: {capacity})", {
          storage: t(STORAGE_META[resourceType].label),
          level: storage.level + 1,
          capacity: formatNumber(newCapacity),
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.upgradeStorage", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ deposit / withdraw ------------------------------ */

const storageTransferSchema = z.object({
  resourceType: storageTypeSchema,
  amount: z.coerce.number().int().min(1).max(1_000_000_000),
});

interface StorageTransferContext {
  storage: FullEmpire["storages"][number];
  resourceKey: StorableResource;
  resourceLabel: string;
  capacity: number;
  /** Whole units available outside the warehouse. */
  available: number;
  /** Whole units of free space left in the warehouse. */
  freeSpace: number;
  /** Whole units currently protected inside the warehouse. */
  storedAmount: number;
  /** Gates the two "all" transfers — the typed-amount ones are free. */
  isVip: boolean;
}

/**
 * Shared shell for the four deposit/withdraw actions: applies pending
 * updates, locates the warehouse and computes its balances — all inside
 * one transaction so validation and the transfer are atomic.
 */
async function runStorageTransfer(
  resourceType: ResourceStorageType,
  perform: (
    ctx: StorageTransferContext,
    tx: Prisma.TransactionClient,
    empireId: string
  ) => Promise<ActionState>
): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const storage = empire.storages.find(
        (s) => s.resourceType === resourceType
      );
      if (!storage) return { error: t("המחסן לא נמצא") };

      const resourceKey = STORAGE_META[resourceType].resourceKey;
      const capacity = storageCapacityForLevel(storage.level);
      const ctx: StorageTransferContext = {
        storage,
        resourceKey,
        resourceLabel: RESOURCE_META[resourceKey].label,
        capacity,
        available: Math.floor(empire[resourceKey]),
        freeSpace: Math.max(0, Math.floor(capacity - storage.storedAmount)),
        storedAmount: Math.floor(storage.storedAmount),
        isVip: isVip(empire),
      };
      return perform(ctx, tx, empireId);
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.upgradeStorage", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

async function transferToStorage(
  ctx: StorageTransferContext,
  tx: Prisma.TransactionClient,
  empireId: string,
  amount: number
): Promise<ActionState> {
  const t = await getT();
  // Conditional updates so a concurrent transfer can never drive the
  // available balance negative or push the warehouse past capacity.
  const debited = await tx.empire.updateMany({
    where: { id: empireId, [ctx.resourceKey]: { gte: amount } },
    data: { [ctx.resourceKey]: { decrement: amount } },
  });
  if (debited.count === 0) {
    return { error: t("אין מספיק משאבים זמינים לאחסון") };
  }
  const stored = await tx.resourceStorage.updateMany({
    where: {
      id: ctx.storage.id,
      storedAmount: { lte: ctx.capacity - amount },
    },
    data: { storedAmount: { increment: amount } },
  });
  // Throw (instead of returning an error) so the debit above rolls back.
  if (stored.count === 0) throw new Error("storage capacity exceeded");
  return {
    success: t("אוחסנו {amount} {resource} במחסן", {
      amount: formatNumber(amount),
      resource: t(ctx.resourceLabel),
    }),
  };
}

async function transferFromStorage(
  ctx: StorageTransferContext,
  tx: Prisma.TransactionClient,
  empireId: string,
  amount: number
): Promise<ActionState> {
  const t = await getT();
  const withdrawn = await tx.resourceStorage.updateMany({
    where: { id: ctx.storage.id, storedAmount: { gte: amount } },
    data: { storedAmount: { decrement: amount } },
  });
  if (withdrawn.count === 0) {
    return { error: t("אין מספיק משאבים במחסן") };
  }
  await tx.empire.update({
    where: { id: empireId },
    data: { [ctx.resourceKey]: { increment: amount } },
  });
  return {
    success: t("נמשכו {amount} {resource} מהמחסן", {
      amount: formatNumber(amount),
      resource: t(ctx.resourceLabel),
    }),
  };
}

export async function depositToStorage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = storageTransferSchema.safeParse({
    resourceType: formData.get("resourceType"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { error: t("כמות לא תקינה") };
  const { resourceType, amount } = parsed.data;

  return runStorageTransfer(resourceType, async (ctx, tx, empireId) => {
    if (amount > ctx.available) {
      return { error: t("אין מספיק משאבים זמינים לאחסון") };
    }
    if (amount > ctx.freeSpace) {
      return {
        error: t("אין מספיק מקום במחסן (מקום פנוי: {free})", {
          free: formatNumber(ctx.freeSpace),
        }),
      };
    }
    return transferToStorage(ctx, tx, empireId, amount);
  });
}

export async function withdrawFromStorage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = storageTransferSchema.safeParse({
    resourceType: formData.get("resourceType"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { error: t("כמות לא תקינה") };
  const { resourceType, amount } = parsed.data;

  return runStorageTransfer(resourceType, async (ctx, tx, empireId) => {
    if (amount > ctx.storedAmount) {
      return {
        error: t("אין מספיק משאבים במחסן (מאוחסן: {stored})", {
          stored: formatNumber(ctx.storedAmount),
        }),
      };
    }
    return transferFromStorage(ctx, tx, empireId, amount);
  });
}

/**
 * VIP: the same deposit with the amount read off the empire instead of typed
 * into the card's box. The gate lives here, not in StorageCard: a button that
 * is not rendered is still an action anyone can post to.
 */
export async function depositAllToStorage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = storageTypeSchema.safeParse(formData.get("resourceType"));
  if (!parsed.success) return { error: t("סוג מחסן לא תקין") };

  return runStorageTransfer(parsed.data, async (ctx, tx, empireId) => {
    if (!ctx.isVip) return { error: vipRequiredError(t) };
    if (ctx.freeSpace < 1) return { error: t("המחסן מלא — שדרג אותו כדי לאחסן עוד") };
    const amount = Math.min(ctx.available, ctx.freeSpace);
    if (amount < 1) return { error: t("אין משאבים זמינים לאחסון") };
    return transferToStorage(ctx, tx, empireId, amount);
  });
}

/** VIP: the whole warehouse out in one press. See depositAllToStorage. */
export async function withdrawAllFromStorage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = storageTypeSchema.safeParse(formData.get("resourceType"));
  if (!parsed.success) return { error: t("סוג מחסן לא תקין") };

  return runStorageTransfer(parsed.data, async (ctx, tx, empireId) => {
    if (!ctx.isVip) return { error: vipRequiredError(t) };
    if (ctx.storedAmount < 1) return { error: t("המחסן ריק") };
    return transferFromStorage(ctx, tx, empireId, ctx.storedAmount);
  });
}

/* ------------------------------ empire upgrades ------------------------------ */

// Derived from EMPIRE_UPGRADE_TYPES rather than hand-listed.
//
// The hand-written list silently went stale when WHEEL_LUCK was added: the
// upgrades page renders one card per EMPIRE_UPGRADE_TYPES entry, so the card was
// there, priced and clickable — and every click died on "סוג שדרוג לא תקין"
// because the schema had never heard of the type. Deriving both from the same
// constant means a new upgrade is buyable the moment it is defined.
const empireUpgradeTypeSchema = z.enum(
  EMPIRE_UPGRADE_TYPES as [ActiveEmpireUpgradeType, ...ActiveEmpireUpgradeType[]]
);

export async function upgradeEmpireUpgrade(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = empireUpgradeTypeSchema.safeParse(formData.get("upgradeType"));
  if (!parsed.success) return { error: t("סוג שדרוג לא תקין") };
  const upgradeType = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      // A missing row (e.g. an empire predating this upgrade) starts at level 1.
      const upgrade =
        empire.upgrades.find((u) => u.type === upgradeType) ??
        (await tx.empireUpgrade.create({
          data: { empireId, type: upgradeType, level: 1 },
        }));

      const maxLevel = empireUpgradeMaxLevel(upgradeType, empire.cities);
      if (maxLevel !== undefined && upgrade.level >= maxLevel) {
        return { error: t("רמה מקסימלית") };
      }

      const discountPct = await getShopDiscountPct(empireId, tx);
      const cost = applyShopDiscount(
        empireUpgradeCostFor(upgradeType, upgrade.level),
        discountPct
      );
      if (
        empire.gold < cost.gold ||
        empire.wood < cost.wood ||
        empire.iron < cost.iron ||
        empire.stone < cost.stone
      ) {
        return {
          error: insufficientResourcesError(t, empire, cost, t("אין מספיק משאבים לשדרוג")),
        };
      }

      // Guarded debit (atomic) — prevents concurrent upgrades from going negative.
      const paid = await tx.empire.updateMany({
        where: {
          id: empireId,
          gold: { gte: cost.gold },
          wood: { gte: cost.wood },
          iron: { gte: cost.iron },
          stone: { gte: cost.stone },
        },
        data: {
          gold: { decrement: cost.gold },
          wood: { decrement: cost.wood },
          iron: { decrement: cost.iron },
          stone: { decrement: cost.stone },
        },
      });
      if (paid.count === 0) {
        return {
          error: insufficientResourcesError(t, empire, cost, t("אין מספיק משאבים לשדרוג")),
        };
      }
      // Guarded on the level that was both max-checked and priced above.
      //
      // Without the pin the `maxLevel` check was a stale read and the increment
      // unconditional, so N concurrent calls pushed the level N past its cap at
      // the snapshot price. On TURNS_PER_REGULAR_UPDATE (cap 5) that was the
      // worst exploit in the game after foundCity: 20 parallel POSTs at level 1
      // cost ~54k gold and produced level 21, i.e. +21 turns every 5-minute tick
      // (6,048/day against a designed 1,440). Turns are the only rate limit on
      // attacking, and attacks are the source of plunder, hero XP, item drops
      // and wheel spins — so uncapping them uncapped the whole PvP economy.
      // INTELLIGENCE (cap 15) was equally raceable into guaranteed spy success.
      const upgraded = await tx.empireUpgrade.updateMany({
        where: {
          id: upgrade.id,
          level: upgrade.level,
        },
        data: { level: { increment: 1 } },
      });
      if (upgraded.count === 0) throw new Error("empire upgrade conflict");
      await awardSeasonPassXp(tx, empireId, "empireUpgrade");

      return {
        success: t("{upgrade} שודרג לרמה {level}!", {
          upgrade: t(EMPIRE_UPGRADE_META[upgradeType].label),
          level: upgrade.level + 1,
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.upgradeEmpireUpgrade", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ found city ------------------------------ */

/**
 * Upgrade to the next city. Requires the hero to have reached the level demanded
 * for this city tier (10 for the 2nd, 20 for the 3rd…) and a standing garrison of
 * soldiers — the soldiers are only a *gate*, never consumed. Resources are spent
 * and the debit is guarded (gte) so concurrent calls can never over-spend or
 * push the empire past MAX_CITIES. Each city also multiplies mine production, so
 * upgrading immediately raises resource output.
 */
export async function foundCity(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);

      if (empire.cities >= MAX_CITIES) {
        return { error: t("הגעת לרמת העיר המרבית ({max}).", { max: MAX_CITIES }) };
      }
      const heroRequired = cityHeroLevelRequired(empire.cities);
      if ((empire.hero?.level ?? 1) < heroRequired) {
        return {
          error: t("נדרש גיבור ברמה {level} כדי לעלות עיר.", { level: heroRequired }),
        };
      }

      const cost = cityCost(empire.cities);
      if (
        empire.gold < cost.gold ||
        empire.wood < cost.wood ||
        empire.iron < cost.iron ||
        empire.stone < cost.stone
      ) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים כדי לעלות עיר.")
          ),
        };
      }
      // Soldiers are only a requirement — the empire must field a garrison of
      // this size, but upgrading the city never consumes it.
      if ((empire.army?.soldiers ?? 0) < cost.soldiers) {
        return {
          error: t("נדרשים {soldiers} חיילים בצבא כדי לעלות עיר.", {
            soldiers: formatNumber(cost.soldiers),
          }),
        };
      }

      // Guarded resource debit + city increment, atomic against concurrent calls.
      //
      // `cities: empire.cities` pins the tier the price was quoted from, and is
      // the load-bearing part of this guard. Guarding only the balances (plus a
      // loose `cities: { lt: MAX_CITIES }`) let N concurrent calls each pay the
      // price of the *snapshot* tier while each incrementing `cities`: since
      // cityCost is 1M × 2.5^(cities-1), racing 9 requests from one city bought
      // cities 2..10 at the city-2 price — ~9M gold instead of ~2.54B, a ~280×
      // discount — and every racer also cleared the hero-level gate at the
      // tier-1 requirement of 10 instead of 90. `cities` is the game's top-line
      // multiplier (mine output, population ceiling, PvP bracket), so this was
      // the single highest-value exploit in the economy. Pinning the exact value
      // means only one racer can win per tier; the losers match zero rows.
      const paid = await tx.empire.updateMany({
        where: {
          id: empireId,
          cities: empire.cities,
          gold: { gte: cost.gold },
          wood: { gte: cost.wood },
          iron: { gte: cost.iron },
          stone: { gte: cost.stone },
        },
        data: {
          gold: { decrement: cost.gold },
          wood: { decrement: cost.wood },
          iron: { decrement: cost.iron },
          stone: { decrement: cost.stone },
          cities: { increment: 1 },
        },
      });
      if (paid.count === 0) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים כדי לעלות עיר.")
          ),
        };
      }

      // Soldiers are a gate, not a currency — the garrison is left untouched.
      await awardSeasonPassXp(tx, empireId, "foundCity");

      // A guild lives in one city (see server/guildCity.ts): climbing out of it
      // costs the climber their seat, and costs a leader the whole guild. Run
      // inside the same transaction as the increment, so the two can never
      // commit apart.
      const guild = await applyGuildCityRule(tx, empireId, empire.cities);

      return {
        success:
          t("עלית לעיר {city}! התפוקה שלך גדלה בהתאם.", {
            city: empire.cities + 1,
          }) + guildCityNote(t, guild),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.foundCity", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ weapons ------------------------------ */

/**
 * The highest weapon tier this empire may buy. Progression is **shared** across
 * all three categories — a tier unlocked anywhere counts everywhere — so this is
 * the maximum unlocked tier over the empire's unlock rows. Empires created
 * before the weapons system have no rows and default to the initial two tiers.
 */
function sharedUnlockedTier(empire: FullEmpire): number {
  return empire.weaponUnlocks.reduce(
    (max, u) => Math.max(max, u.unlockedTier),
    INITIAL_WEAPON_UNLOCKED_TIER
  );
}

/**
 * Nothing caps a weapons order but the treasury — the bound below is the int4
 * ceiling of `EmpireWeapon.quantity`, not a game rule. See COLUMN_INT_MAX.
 *
 * It used to be a flat 1,000,000, which a late-game treasury clears easily: the
 * order was rejected outright ("כמות לא תקינה"), and pressing "הכל" with more
 * than a million affordable filled the box with a number the server would not
 * take, so the button appeared to do nothing at all.
 */
const buyWeaponSchema = z.object({
  weaponKey: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(COLUMN_INT_MAX),
});

export async function buyWeapon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Every message this action can answer with is written in the reader's
  // language — an action's `error` lands in a FormMessage on the same screen
  // whose labels are already translated, so a Hebrew sentence there would be
  // the one untranslated thing on an English page.
  const t = await getT();

  const parsed = buyWeaponSchema.safeParse({
    weaponKey: formData.get("weaponKey"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: t("כמות לא תקינה") };
  const { weaponKey, quantity } = parsed.data;

  const weapon = weaponByKey(weaponKey);
  if (!weapon) return { error: t("נשק לא מוכר") };

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);

      if (weapon.tier > sharedUnlockedTier(empire)) {
        return { error: t("הנשק נעול — פתח נשק מתקדם כדי לקנות אותו") };
      }

      // The stack itself has to stay inside its column, and this check runs
      // *before* the debit: an error returned from the callback commits the
      // transaction, so a payment taken here would never be given back.
      const owned =
        empire.weapons.find((w) => w.weaponKey === weaponKey)?.quantity ?? 0;
      if (owned + quantity > COLUMN_INT_MAX) {
        return {
          error: t(
            "לא ניתן להחזיק יותר מ-{max} יחידות מאותו נשק — יש לך כבר {owned}",
            { max: formatNumber(COLUMN_INT_MAX), owned: formatNumber(owned) }
          ),
        };
      }

      // Buying uses only available balances — warehouse stock is protected.
      const discountPct = await getShopDiscountPct(empireId, tx);
      const cost = applyShopDiscount(
        {
          gold: weapon.cost.gold * quantity,
          wood: weapon.cost.wood * quantity,
          iron: weapon.cost.iron * quantity,
          stone: weapon.cost.stone * quantity,
        },
        discountPct
      );
      if (
        empire.gold < cost.gold ||
        empire.wood < cost.wood ||
        empire.iron < cost.iron ||
        empire.stone < cost.stone
      ) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים זמינים לקנייה.")
          ),
        };
      }

      // Guarded debit (atomic) — prevents concurrent buys from going negative.
      const paid = await tx.empire.updateMany({
        where: {
          id: empireId,
          gold: { gte: cost.gold },
          wood: { gte: cost.wood },
          iron: { gte: cost.iron },
          stone: { gte: cost.stone },
        },
        data: {
          gold: { decrement: cost.gold },
          wood: { decrement: cost.wood },
          iron: { decrement: cost.iron },
          stone: { decrement: cost.stone },
        },
      });
      if (paid.count === 0) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים זמינים לקנייה.")
          ),
        };
      }
      // Guarded increment, so the ceiling holds against a concurrent buy too —
      // the check above read a snapshot. Count 0 means either there is no row
      // yet (the create below) or a parallel order got in first and took the
      // stack past the ceiling, which throws and rolls the payment back.
      const stacked = await tx.empireWeapon.updateMany({
        where: {
          empireId,
          weaponKey,
          quantity: { lte: COLUMN_INT_MAX - quantity },
        },
        data: { quantity: { increment: quantity } },
      });
      if (stacked.count === 0) {
        if (owned > 0) throw new Error("weapon stack ceiling conflict");
        await tx.empireWeapon.create({ data: { empireId, weaponKey, quantity } });
      }
      await syncEmpirePower(tx, empireId);
      await awardSeasonPassXp(
        tx,
        empireId,
        "buyWeapon",
        seasonPassSpendUnits(
          "buyWeapon",
          cost.gold + cost.wood + cost.iron + cost.stone
        )
      );

      return {
        success: t("נקנו {count} {weapon} בהצלחה!", {
          count: formatNumber(quantity),
          weapon: t(weapon.name),
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.buyWeapon", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

export async function unlockNextWeaponTier(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);

      // Unlocking is cross-cutting: the shared tier is the highest tier over
      // all categories, and advancing it opens the next weapon in all three.
      const currentTier = sharedUnlockedTier(empire);
      if (currentTier >= MAX_WEAPON_TIER) {
        return { error: t("כל הנשקים פתוחים.") };
      }
      const targetTier = currentTier + 1;

      // Every few tiers demands a founded city and a hero level — so weapons,
      // hero and cities advance together.
      const heroLevel = empire.hero?.level ?? 0;
      const gate = weaponGateStatus(targetTier, empire.cities, heroLevel);
      if (!gate.met) {
        const needs: string[] = [];
        if (!gate.citiesMet) {
          needs.push(
            t("{required} ערים (יש לך {current})", {
              required: gate.cities,
              current: empire.cities,
            })
          );
        }
        if (!gate.heroLevelMet) {
          needs.push(
            t("גיבור ברמה {required} (הגיבור שלך ברמה {current})", {
              required: gate.heroLevel,
              current: heroLevel,
            })
          );
        }
        return {
          error: t("כדי לפתוח רמה {tier} צריך {needs}.", {
            tier: targetTier,
            needs: needs.join(t(" ו-")),
          }),
        };
      }

      const discountPct = await getShopDiscountPct(empireId, tx);
      const cost = applyShopDiscount(weaponTierUnlockCost(currentTier), discountPct);
      if (
        empire.gold < cost.gold ||
        empire.wood < cost.wood ||
        empire.iron < cost.iron ||
        empire.stone < cost.stone
      ) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים לפתיחת הנשק הבא")
          ),
        };
      }

      // Guarded debit (atomic) — prevents concurrent unlocks from going negative.
      const paid = await tx.empire.updateMany({
        where: {
          id: empireId,
          gold: { gte: cost.gold },
          wood: { gte: cost.wood },
          iron: { gte: cost.iron },
          stone: { gte: cost.stone },
        },
        data: {
          gold: { decrement: cost.gold },
          wood: { decrement: cost.wood },
          iron: { decrement: cost.iron },
          stone: { decrement: cost.stone },
        },
      });
      if (paid.count === 0) {
        return {
          error: insufficientResourcesError(
            t,
            empire,
            cost,
            t("אין מספיק משאבים לפתיחת הנשק הבא")
          ),
        };
      }
      // Advance every category together — the unlock is cross-cutting.
      //
      // Guarded and monotonic. The old unconditional `update: { unlockedTier:
      // targetTier }` was an absolute write off a snapshot, which broke two ways
      // at once: two concurrent unlocks both passed the (guarded) payment, both
      // wrote the same tier, and the player paid twice for one tier; and a slow
      // request that had read an older tier clobbered a newer one on commit,
      // *removing* a tier that had already been bought. `lt: targetTier` fixes
      // both — a racer that finds nothing below the target matches zero rows.
      let advanced = 0;
      for (const cat of WEAPON_CATEGORIES) {
        const bumped = await tx.empireWeaponUnlock.updateMany({
          where: { empireId, category: cat, unlockedTier: { lt: targetTier } },
          data: { unlockedTier: targetTier },
        });
        advanced += bumped.count;
      }
      // Empires predating the weapons system carry no unlock rows at all — seed
      // the missing ones. `skipDuplicates` (ON CONFLICT DO NOTHING) rather than
      // create: a failed INSERT aborts the whole transaction in Postgres, and
      // catching it in JS does not recover the connection.
      const seeded = await tx.empireWeaponUnlock.createMany({
        data: WEAPON_CATEGORIES.map((category) => ({
          empireId,
          category,
          unlockedTier: targetTier,
        })),
        skipDuplicates: true,
      });
      advanced += seeded.count;
      // Nothing moved: a concurrent unlock already bought this tier. Throw so
      // the payment above rolls back rather than charging twice for one tier.
      if (advanced === 0) throw new Error("weapon tier unlock conflict");

      return {
        success: t("נפתחה רמה {tier} לכל הנשקים — התקפה, הגנה וריגול!", {
          tier: targetTier,
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("game.unlockNextWeaponTier", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ settings ------------------------------ */

/**
 * Empire names are locked for the duration of the season.
 * The action is kept so any old client form gets a clear rejection.
 */
export async function renameEmpire(): Promise<ActionState> {
  const t = await getT();
  return { error: t("שם האימפריה נעול למשך העונה ולא ניתן לשינוי.") };
}
