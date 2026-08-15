"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { grantCitizens } from "@/lib/game/grants";
import { wheelLuckChance } from "@/lib/game/constants";
import { monumentBonuses } from "@/lib/game/monuments";
import {
  HERO_BAG_CAPACITY,
  HERO_MAX_LEVEL,
  HERO_RESET_CITIZENS,
  HERO_RESET_TURNS,
  HERO_STAT_META,
  RARITY_META,
  SLOT_ORDER,
  atSetCeiling,
  canEquipItem,
  canUpgradeItem,
  heroResetPoints,
  itemDisplayName,
  itemUpgradeCost,
  nextTierLevel,
  rollDiscardWheelSpin,
  tierForLevel,
} from "@/lib/game/hero";
import { shardsForItem } from "@/lib/game/forge";
import { itemSetForLevel } from "@/lib/game/heroSets";
import { forgeDiscountedCost } from "@/lib/game/potions";
import { isPotionActive } from "@/lib/game/potionEffects";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT } from "@/i18n/server";

/**
 * Serialize concurrent hero mutations by taking a row lock on the hero.
 * Equip/unequip do a read-check-write on the item set; under Postgres READ
 * COMMITTED two parallel requests would otherwise both pass their checks and
 * commit — letting several items occupy one slot (stacking bonuses) or the bag
 * overflow its cap. Callers acquire this before mutating item state and must
 * re-read any count they gate on *after* the lock. Mirrors lockEmpire.
 */
async function lockHero(
  tx: Prisma.TransactionClient,
  heroId: string
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Hero" WHERE id = ${heroId} FOR UPDATE`;
}

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban on every action (not just page loads); see getActiveEmpireId.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — each action catches it and returns
  // the translated "something went wrong" instead.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

function revalidateGame() {
  revalidatePath("/game", "layout");
}

/* ------------------------------ allocate points ------------------------------ */

const allocateSchema = z.object({
  stat: z.enum(["attack", "defense", "resources"]),
  amount: z.coerce.number().int().min(1).max(1_000_000),
});

/**
 * Spend unspent hero points on a stat. Each point is a permanent +1% to
 * attack, defense or resource production (points return on a hero reset).
 */
export async function allocateHeroPoints(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = allocateSchema.safeParse({
    stat: formData.get("stat"),
    amount: formData.get("amount") ?? 1,
  });
  if (!parsed.success) return { error: t("בחירה לא תקינה") };
  const { stat, amount } = parsed.data;
  const meta = HERO_STAT_META[stat];
  const pointsField = meta.pointsField;
  if (!pointsField) return { error: t("בחירה לא תקינה") }; // item-only stat

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      // Guarded decrement — a concurrent allocation can never overspend.
      const spent = await tx.hero.updateMany({
        where: { id: hero.id, unspentPoints: { gte: amount } },
        data: {
          unspentPoints: { decrement: amount },
          [pointsField]: { increment: amount },
        },
      });
      if (spent.count === 0) return { error: t("אין מספיק נקודות גיבור פנויות") };

      return {
        success: t("+{amount}% {stat} — הנקודות הוקצו!", {
          amount,
          stat: t(meta.label),
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.allocateHeroPoints", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ reset (prestige) ------------------------------ */

/**
 * Level-100 hero reset: the hero returns to level 1, all allocated points
 * are wiped, and the empire receives 3,000 citizens, 6,000 turns and a fresh
 * pool of hero points. The reset counter marks the hero as prestiged — and it
 * is what sizes the grant, since every reset is worth another permanent 30
 * points (see `heroPointPool`): 31 in hand after the first, 61 after the second,
 * and so on, each carried all the way back up to the cap.
 */
export async function resetHero(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      // The new pool is a function of the reset the hero is about to complete,
      // so it has to be computed from a `resets` we can trust — hence the guard
      // below pins that column too, not just the level.
      const resetsAfter = hero.resets + 1;
      const freshPoints = heroResetPoints(resetsAfter);

      // Guarded on level *and* resets — a double-submit can never reset twice,
      // and can never write a point pool computed from a stale reset count.
      const reset = await tx.hero.updateMany({
        where: { id: hero.id, level: { gte: HERO_MAX_LEVEL }, resets: hero.resets },
        data: {
          level: 1,
          xp: 0,
          unspentPoints: freshPoints,
          attackPoints: 0,
          defensePoints: 0,
          resourcePoints: 0,
          resets: resetsAfter,
        },
      });
      if (reset.count === 0) {
        return {
          error: t("איפוס גיבור זמין רק ברמה {level}", { level: HERO_MAX_LEVEL }),
        };
      }

      // The worn set is *grandfathered* through the reset: stripping a
      // level-100 hero down to nine bare sockets is a different game, not a
      // prestige. Whatever sits on the body stays on the body and keeps paying
      // its bonus. The level gate only ever guards the *act* of equipping —
      // `equipHeroItem` still refuses anything above the hero's level — so the
      // moment the player takes a piece off it is locked in the bag until the
      // hero climbs back to its level. Taking gear off after a reset is
      // therefore a one-way door, which is exactly the intended cost.

      // Routed through grantCitizens like every other citizen source — the whole
      // grant lands (there is no population ceiling any more), but going through
      // the one helper is what keeps citizens auditable: `trainUnits` turns each
      // one into a soldier, spy or mine slave, so the safety is in every faucet
      // being rate-limited and accounted for, not in a lid on the pool.
      await grantCitizens(tx, empireId, HERO_RESET_CITIZENS);
      // Turns have no ceiling of their own (they are spent, not stored against a
      // cap), so they are a plain increment on the empire.
      await tx.empire.update({
        where: { id: empireId },
        data: { turns: { increment: HERO_RESET_TURNS } },
      });

      return {
        success: t(
          "הגיבור אופס! קיבלת {citizens} אזרחים, {turns} תורות ו-{points} נקודות גיבור",
          {
            citizens: HERO_RESET_CITIZENS.toLocaleString("en-US"),
            turns: HERO_RESET_TURNS.toLocaleString("en-US"),
            points: freshPoints,
          }
        ),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.resetHero", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ equip / unequip ------------------------------ */

const itemSchema = z.object({ itemId: z.string().min(1) });

export async function equipHeroItem(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = itemSchema.safeParse({ itemId: formData.get("itemId") });
  if (!parsed.success) return { error: t("פריט לא תקין") };
  const { itemId } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      const item = hero.items.find((i) => i.id === itemId);
      if (!item) return { error: t("הפריט לא נמצא בתיק שלך") };
      if (item.equipped) return { error: t("הפריט כבר לבוש") };
      if (!canEquipItem(hero.level, item.level)) {
        return {
          error: t("דרוש גיבור רמה {required} כדי ללבוש את הפריט (אתה ברמה {level})", {
            required: item.level,
            level: hero.level,
          }),
        };
      }

      // Serialize concurrent equips before touching the slot: the unequip-slot
      // updateMany below clears whatever is equipped *under this lock*, so even
      // two racing equips of same-slot items end with exactly one equipped
      // (the second waits, then unequips the first's item before equipping its
      // own). Without this both would set equipped=true and stack the bonus.
      await lockHero(tx, hero.id);

      // Swap: the currently equipped item in that slot returns to the bag.
      await tx.heroItem.updateMany({
        where: { heroId: hero.id, slot: item.slot, equipped: true },
        data: { equipped: false },
      });
      await tx.heroItem.update({
        where: { id: item.id },
        data: { equipped: true },
      });

      return {
        success: t("{item} נלבש!", {
          item: itemDisplayName(t, item.slot, item.level),
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.equipHeroItem", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

export async function unequipHeroItem(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = itemSchema.safeParse({ itemId: formData.get("itemId") });
  if (!parsed.success) return { error: t("פריט לא תקין") };
  const { itemId } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      const item = hero.items.find((i) => i.id === itemId);
      if (!item || !item.equipped) return { error: t("הפריט אינו לבוש") };

      // Serialize with other hero item mutations, then re-count the bag *under
      // the lock* — the snapshot count from applyPendingUpdates was read before
      // the lock, so two racing unequips could both pass a stale check and
      // overflow the cap. The live count reflects any equip/unequip that
      // committed while we waited for the lock.
      await lockHero(tx, hero.id);
      const bagCount = await tx.heroItem.count({
        where: { heroId: hero.id, equipped: false },
      });
      if (bagCount >= HERO_BAG_CAPACITY) {
        return { error: t("התיק מלא — לא ניתן להסיר את הפריט") };
      }

      await tx.heroItem.update({
        where: { id: item.id },
        data: { equipped: false },
      });

      return {
        success: t("{item} הוסר לתיק", {
          item: itemDisplayName(t, item.slot, item.level),
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.unequipHeroItem", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ discard ------------------------------ */

/**
 * Throwing gear away is now *dismantling* it: the piece is still destroyed and
 * still rolls the wheel, and it also yields shards for the forge (see
 * src/lib/game/forge.ts).
 *
 * Bolted onto the existing paths rather than given a second "dismantle" button.
 * They would have been the same action with two names — the item is gone either
 * way — and a bag screen with both would have made players wonder which one
 * loses them something. The wording moved; the mechanic gained a payout.
 *
 * The shard credit rides the *same guard* the spin roll already rides: only an
 * item this transaction actually deleted pays. Two concurrent discards of one
 * item therefore mint one item's worth of shards, not two.
 */

/** Permanently throw away a single owned item (bag or equipped). */
export async function discardHeroItem(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = itemSchema.safeParse({ itemId: formData.get("itemId") });
  if (!parsed.success) return { error: t("פריט לא תקין") };
  const { itemId } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      const item = hero.items.find((i) => i.id === itemId);
      if (!item) return { error: t("הפריט לא נמצא בתיק שלך") };

      // Scope the delete to this hero so a stale id can't touch another's gear.
      // Gate the reward on an *actual* deletion: two concurrent discards of the
      // same item both snapshot it as present, but only one deleteMany removes a
      // row — the loser matches zero rows and must not roll the wheel, else one
      // item prints up to N wheel spins under concurrency.
      const { count: deleted } = await tx.heroItem.deleteMany({
        where: { id: item.id, heroId: hero.id },
      });
      if (deleted === 0) return { error: t("הפריט לא נמצא בתיק שלך") };

      // The fates may reward parting with gear — rarer items pay far more often
      // (אגדי pays 1-in-10), and wheel luck adds up to +25% on top (the upgrade
      // and גלגל השמיים both). The server owns the roll.
      const luckBonus = wheelLuckChance(
        empire.upgrades.find((u) => u.type === "WHEEL_LUCK")?.level ?? 1,
        monumentBonuses(empire.monuments).wheelLuck
      );
      const wonSpin = rollDiscardWheelSpin(item.level, luckBonus);
      if (wonSpin) {
        await tx.empire.update({
          where: { id: empireId },
          data: { wheelSpins: { increment: 1 } },
        });
      }

      // What the pieces are worth at the forge. An increment, never an absolute
      // set: a commission or a temper may commit between this transaction's
      // read of the hero and this write, and `shards: value` would silently
      // undo it.
      const shards = shardsForItem(item.level);
      await tx.hero.update({
        where: { id: hero.id },
        data: { shards: { increment: shards } },
      });

      const name = itemDisplayName(t, item.slot, item.level);
      return {
        success: wonSpin
          ? t("{item} פורק ל-{shards} רסיסים — ומזל טוב! 🎡 זכית בסיבוב גלגל מזל!", {
              item: name,
              shards,
            })
          : t("{item} פורק ל-{shards} רסיסים", { item: name, shards }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.discardHeroItem", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

// The bag holds HERO_BAG_CAPACITY items plus at most one equipped item per
// slot, so no legitimate bulk selection exceeds that. Bounding both the raw
// string and the parsed array matters because the only other limit is the 1 MB
// Server Action body cap — which allows ~40k ids per POST, each of which is
// walked against the hero's items. Ownership was always enforced, so this was
// wasted work rather than a privilege issue, but it is unbounded wasted work.
const MAX_BULK_ITEM_IDS = HERO_BAG_CAPACITY + SLOT_ORDER.length;

const itemIdsSchema = z.object({
  itemIds: z
    .string()
    .min(1)
    .max(MAX_BULK_ITEM_IDS * 40)
    .transform((s) => s.split(",").map((id) => id.trim()).filter(Boolean))
    // i18n-exempt: zod's own message, never surfaced — a failed parse returns
    // the translated "no items selected" below.
    .refine((ids) => ids.length <= MAX_BULK_ITEM_IDS, "נבחרו יותר מדי פריטים"),
});

/** Permanently throw away many owned items at once (bulk from the bag). */
export async function discardHeroItems(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = itemIdsSchema.safeParse({ itemIds: formData.get("itemIds") });
  if (!parsed.success || parsed.data.itemIds.length === 0) {
    return { error: t("לא נבחרו פריטים") };
  }
  const ids = new Set(parsed.data.itemIds);

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      const owned = hero.items.filter((i) => ids.has(i.id));
      if (owned.length === 0) return { error: t("הפריטים לא נמצאו בתיק שלך") };

      // Roll each thrown item independently — rarer gear pays a wheel spin far
      // more often (אגדי pays 1-in-10), and wheel luck adds up to +25% on top of
      // every roll (the upgrade and גלגל השמיים both). The server owns every roll.
      const luckBonus = wheelLuckChance(
        empire.upgrades.find((u) => u.type === "WHEEL_LUCK")?.level ?? 1,
        monumentBonuses(empire.monuments).wheelLuck
      );
      // Delete each item under its own guard and roll only for the ones THIS
      // transaction actually removed. Rolling over the pre-delete `owned`
      // snapshot would let two concurrent bulk discards of the same ids each
      // roll a full set of spins for a single real deletion (spin duplication).
      let count = 0;
      let spinsWon = 0;
      // Accumulated across the loop and credited once. Same guard as the spins:
      // only a piece this transaction actually removed is melted down.
      let shardsWon = 0;
      for (const item of owned) {
        const del = await tx.heroItem.deleteMany({
          where: { id: item.id, heroId: hero.id },
        });
        if (del.count === 0) continue;
        count += del.count;
        shardsWon += shardsForItem(item.level);
        if (rollDiscardWheelSpin(item.level, luckBonus)) spinsWon += 1;
      }
      if (count === 0) return { error: t("הפריטים לא נמצאו בתיק שלך") };
      if (spinsWon > 0) {
        await tx.empire.update({
          where: { id: empireId },
          data: { wheelSpins: { increment: spinsWon } },
        });
      }
      if (shardsWon > 0) {
        await tx.hero.update({
          where: { id: hero.id },
          data: { shards: { increment: shardsWon } },
        });
      }

      return {
        success:
          spinsWon > 0
            ? t(
                "{count} חפצים פורקו ל-{shards} רסיסים — ומזל טוב! 🎡 זכית ב-{spins} סיבובי גלגל מזל!",
                { count, shards: shardsWon, spins: spinsWon }
              )
            : t("{count} חפצים פורקו ל-{shards} רסיסים", {
                count,
                shards: shardsWon,
              }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.discardHeroItems", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ upgrade ------------------------------ */

/** Upgrade a single item to the next tier level, paying the gold cost. */
export async function upgradeHeroItem(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = itemSchema.safeParse({ itemId: formData.get("itemId") });
  if (!parsed.success) return { error: t("פריט לא תקין") };
  const { itemId } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      const item = hero.items.find((i) => i.id === itemId);
      if (!item) return { error: t("הפריט לא נמצא בתיק שלך") };

      const targetLevel = nextTierLevel(item.level);
      // An אגדי closes its set: there is no higher rung inside the decade, and
      // gold never carries a piece into the set above it.
      if (targetLevel === null) {
        return {
          error: atSetCeiling(item.level)
            ? t('אגדי הוא שיא הסט "{set}" — הסט הבא מגיע כשלל בקרב', {
                set: t(itemSetForLevel(item.level).label),
              })
            : t("הפריט כבר ברמה הגבוהה ביותר"),
        };
      }

      // Can't push an item above the hero's own level.
      if (hero.level < targetLevel) {
        return {
          error: t("דרוש גיבור רמה {required} כדי לשדרג (אתה ברמה {level})", {
            required: targetLevel,
            level: hero.level,
          }),
        };
      }

      // שיקוי הנפח halves every upgrade while its half-hour runs.
      const forgeDiscount = await isPotionActive(empireId, "FORGE_DISCOUNT", tx);
      const cost = forgeDiscountedCost(itemUpgradeCost(item.level) ?? 0, forgeDiscount);
      if (empire.gold < cost) {
        return {
          error: t("דרוש {cost} זהב לשדרוג (יש לך {gold})", {
            cost: cost.toLocaleString("en-US"),
            gold: Math.floor(empire.gold).toLocaleString("en-US"),
          }),
        };
      }

      // Guarded decrement — a concurrent spend can never take gold below zero.
      const paid = await tx.empire.updateMany({
        where: { id: empireId, gold: { gte: cost } },
        data: { gold: { decrement: cost } },
      });
      if (paid.count === 0) return { error: t("אין מספיק זהב לשדרוג") };

      // Level drives the item's stats and tier; keep the stored tier in sync.
      // Guard on the level we read and paid for: if a concurrent upgrade already
      // advanced this item, throw to roll back the gold debit above rather than
      // charging twice for a single tier gain.
      const upgraded = await tx.heroItem.updateMany({
        where: { id: item.id, level: item.level },
        data: { level: targetLevel, rarity: tierForLevel(targetLevel) },
      });
      if (upgraded.count === 0) throw new Error("item upgrade conflict");

      return {
        success: t("{item} שודרג לרמה {level} ({rarity})!", {
          item: itemDisplayName(t, item.slot, item.level),
          level: targetLevel,
          rarity: t(RARITY_META[tierForLevel(targetLevel)].label),
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.upgradeHeroItem", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * Upgrade many items at once, cheapest first, until the gold runs out. Items
 * already at the max level are skipped. Reports how many actually upgraded.
 */
export async function upgradeHeroItems(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = itemIdsSchema.safeParse({ itemIds: formData.get("itemIds") });
  if (!parsed.success || parsed.data.itemIds.length === 0) {
    return { error: t("לא נבחרו פריטים") };
  }
  const ids = new Set(parsed.data.itemIds);

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };

      // Only upgradeable items (not at max level, and whose next level the hero
      // is high enough to reach), cheapest first so a limited gold budget buys
      // as many upgrades as possible.
      // שיקוי הנפח halves every upgrade in the batch while its half-hour runs.
      const forgeDiscount = await isPotionActive(empireId, "FORGE_DISCOUNT", tx);
      const upgradeable = hero.items
        .filter((i) => ids.has(i.id) && canUpgradeItem(hero.level, i.level))
        .map((i) => ({
          item: i,
          targetLevel: nextTierLevel(i.level)!,
          cost: forgeDiscountedCost(itemUpgradeCost(i.level) ?? 0, forgeDiscount),
        }))
        .sort((a, b) => a.cost - b.cost);

      if (upgradeable.length === 0) {
        return { error: t("אין פריטים לשדרוג מבין הנבחרים") };
      }

      // First build the upgrade plan WITHOUT mutating anything, so payment can
      // be taken (and verified) before any item level is written. Applying the
      // item updates first and only then paying would commit the upgrades even
      // when the guarded payment fails under a concurrent gold spend.
      let budget = empire.gold;
      let spent = 0;
      const plan: { itemId: string; fromLevel: number; targetLevel: number }[] = [];
      for (const { item, targetLevel, cost } of upgradeable) {
        if (cost > budget) break;
        plan.push({ itemId: item.id, fromLevel: item.level, targetLevel });
        budget -= cost;
        spent += cost;
      }

      if (plan.length === 0) {
        const cheapest = upgradeable[0].cost;
        return {
          error: t("אין מספיק זהב — השדרוג הזול ביותר עולה {cost} זהב", {
            cost: cheapest.toLocaleString("en-US"),
          }),
        };
      }

      // Guarded decrement of the exact total spent — pay before applying.
      const paid = await tx.empire.updateMany({
        where: { id: empireId, gold: { gte: spent } },
        data: { gold: { decrement: spent } },
      });
      if (paid.count === 0) return { error: t("אין מספיק זהב לשדרוג") };

      // Guard each write on the level we read and paid for. If a concurrent
      // upgrade already advanced an item, throw to roll back the whole batch
      // (including the gold debit above) rather than clobbering it with a stale
      // target — mirrors the single-item upgrade guard.
      for (const { itemId, fromLevel, targetLevel } of plan) {
        const res = await tx.heroItem.updateMany({
          where: { id: itemId, level: fromLevel },
          data: { level: targetLevel, rarity: tierForLevel(targetLevel) },
        });
        if (res.count === 0) throw new Error("bulk item upgrade conflict");
      }

      const upgraded = plan.length;
      const skipped = upgradeable.length - upgraded;
      const suffix =
        skipped > 0 ? t(" ({count} לא שודרגו — חסר זהב)", { count: skipped }) : "";
      return {
        success: t("{count} חפצים שודרגו תמורת {gold} זהב{suffix}", {
          count: upgraded,
          gold: spent.toLocaleString("en-US"),
          suffix,
        }),
      };
    });

    revalidateGame();
    return result;
  } catch (err) {
    await logError("hero.upgradeHeroItems", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
