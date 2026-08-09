"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { HeroItemSlot, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { formatNumber } from "@/lib/game/format";
import {
  HERO_BAG_CAPACITY,
  RARITY_META,
  SLOT_META,
  SLOT_ORDER,
  atSetCeiling,
  itemDisplayName,
  isHeroDead,
  nextTierLevel,
  tierForLevel,
} from "@/lib/game/hero";
import {
  COMMISSION_SHARDS,
  commissionGoldCost,
  heroDecade,
  isHeroSlot,
  rollCommission,
  shardsForItem,
  temperShardCost,
  type ForgeBagItem,
  type ForgeState,
} from "@/lib/game/forge";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT } from "@/i18n/server";

/**
 * נפחיית הגיבור — the two benches.
 *
 * Both actions take the hero's row lock before they read anything they will act
 * on, for the reason `lockHero` in actions/hero.ts spells out: equipping,
 * discarding, upgrading and now forging all do read-check-write over the same
 * item set, and under READ COMMITTED two of them would otherwise both pass
 * their checks. The bag count in particular has to be re-read *after* the lock,
 * or two commissions can each see one free slot and both fill it.
 *
 * Shards are debited with a guarded `updateMany` on `shards: { gte: cost }` —
 * the house rule for every spend in this codebase, and the only thing standing
 * between the forge and a negative pouch under a double tap.
 */

async function requireOwnEmpireId(): Promise<string> {
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the catch returns a translated line.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

/** Serialize against every other hero mutation. Mirrors actions/hero.ts. */
async function lockHero(tx: Prisma.TransactionClient, heroId: string) {
  await tx.$queryRaw`SELECT id FROM "Hero" WHERE id = ${heroId} FOR UPDATE`;
}

/* ------------------------------ read side ------------------------------ */

/**
 * Everything the forge screen renders.
 *
 * A plain read, exported from the actions module because the page is the only
 * caller and the alternative was a one-function server module beside it.
 */
export async function getForgeState(): Promise<ForgeState | null> {
  const empireId = await getActiveEmpireId();
  if (empireId === null) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: {
      gold: true,
      hero: {
        select: {
          id: true,
          level: true,
          shards: true,
          items: {
            select: {
              id: true,
              slot: true,
              level: true,
              rarity: true,
              equipped: true,
            },
          },
        },
      },
    },
  });
  const hero = empire?.hero;
  if (!empire || !hero) return null;

  const bag: ForgeBagItem[] = hero.items
    .filter((i) => !i.equipped)
    .sort((a, b) => b.level - a.level)
    .map((item) => ({
      id: item.id,
      slot: item.slot,
      level: item.level,
      rarity: item.rarity,
      shards: shardsForItem(item.level),
      temperCost: temperShardCost(item.level),
      temperTo: nextTierLevel(item.level),
    }));

  // Counted over *everything* the hero owns, worn included: the question the
  // commission bench answers is "which slot am I short of", and a slot filled
  // by the piece he is wearing is not short.
  const held = new Map<HeroItemSlot, { owned: number; bestLevel: number }>();
  for (const item of hero.items) {
    const entry = held.get(item.slot) ?? { owned: 0, bestLevel: 0 };
    entry.owned += 1;
    entry.bestLevel = Math.max(entry.bestLevel, item.level);
    held.set(item.slot, entry);
  }

  return {
    shards: hero.shards,
    heroLevel: hero.level,
    decade: heroDecade(hero.level) + 1,
    shardCost: COMMISSION_SHARDS,
    goldCost: commissionGoldCost(hero.level),
    gold: empire.gold,
    bagFree: Math.max(0, HERO_BAG_CAPACITY - bag.length),
    slots: SLOT_ORDER.map((slot) => ({
      slot,
      owned: held.get(slot)?.owned ?? 0,
      bestLevel: held.get(slot)?.bestLevel ?? 0,
    })),
    bag,
  };
}

/* ------------------------------ commission ------------------------------ */

const commissionSchema = z.object({
  slot: z.string().refine(isHeroSlot),
});

/**
 * Commission a piece for one slot.
 *
 * The player buys the slot and nothing else: the rarity walks the drop table's
 * own odds and the level rolls around the hero's own decade, exactly as a raid
 * would (see rollCommission). So this cannot produce gear the game would not
 * have given them, and an אגדי out of the forge is as rare as an אגדי off a
 * corpse.
 *
 * Both halves of the price are debited under guards, and the item is only
 * created once both have succeeded — a commission that could not pay its gold
 * must not have already spent its shards.
 */
export async function commissionHeroItem(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = commissionSchema.safeParse({ slot: formData.get("slot") });
  if (!parsed.success) return { error: t("משבצת לא תקינה") };
  const slot = parsed.data.slot as HeroItemSlot;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };
      await lockHero(tx, hero.id);

      // A dead hero grants no bonuses and takes no deliveries. Consistent with
      // the expedition board, which refuses to send him out for the same reason.
      if (isHeroDead(hero)) {
        return { error: t("הגיבור מת — הנפחייה לא עובדת עבורו עד שיקום לתחייה.") };
      }

      // Re-read *after* the lock: the snapshot above predates it, and a
      // concurrent drop landing in between would let this overfill the bag.
      const bagCount = await tx.heroItem.count({
        where: { heroId: hero.id, equipped: false },
      });
      if (bagCount >= HERO_BAG_CAPACITY) {
        return {
          error: t("התיק מלא — פרק או לבש פריט לפני שתזמין חדש."),
        };
      }

      const goldCost = commissionGoldCost(hero.level);
      const notEnough = {
        error: t("הזמנה עולה {shards} רסיסים ו-{gold} זהב.", {
          shards: formatNumber(COMMISSION_SHARDS),
          gold: formatNumber(goldCost),
        }),
      };

      // Shards first: it is the scarcer half and the one the player is most
      // likely to be short of, so failing on it costs no wasted write.
      const paidShards = await tx.hero.updateMany({
        where: { id: hero.id, shards: { gte: COMMISSION_SHARDS } },
        data: { shards: { decrement: COMMISSION_SHARDS } },
      });
      if (paidShards.count === 0) return notEnough;

      const paidGold = await tx.empire.updateMany({
        where: { id: empireId, gold: { gte: goldCost } },
        data: { gold: { decrement: goldCost } },
      });
      if (paidGold.count === 0) {
        // Hand the shards back rather than throwing: the transaction would roll
        // this back anyway, but returning an error *is* a commit in this
        // codebase's action shape, so the refund has to be explicit.
        await tx.hero.update({
          where: { id: hero.id },
          data: { shards: { increment: COMMISSION_SHARDS } },
        });
        return notEnough;
      }

      const rolled = rollCommission(hero.level, slot);
      await tx.heroItem.create({ data: { heroId: hero.id, ...rolled } });

      // Rated as a weapon purchase: it is a gold spend that yields a piece of
      // equipment, which is the closest thing the ladder already prices.
      await awardSeasonPassXp(tx, empireId, "buyWeapon");

      const name = itemDisplayName(t, rolled.slot, rolled.level);
      return {
        success: t("הנפחייה מסרה {item} (רמה {level}, {rarity}).", {
          item: name,
          level: rolled.level,
          rarity: t(RARITY_META[tierForLevel(rolled.level)].label),
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("forge.commissionHeroItem", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ temper ------------------------------ */

const temperSchema = z.object({ itemId: z.string().min(1).max(64) });

/**
 * Walk a piece up one band inside its own decade, paid in shards.
 *
 * The same move the gold upgrade on the hero page makes, through the same
 * `nextTierLevel` — including the stop at an אגדי, which closes its set. The
 * two are interchangeable on purpose: a player with shards and no gold and a
 * player with gold and no shards should both have a road, and neither should be
 * the "right" one.
 *
 * The level write is guarded on the level that was *read*, so two concurrent
 * tempers of one piece cannot each advance it a band for one payment.
 */
export async function temperHeroItem(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = temperSchema.safeParse({ itemId: formData.get("itemId") });
  if (!parsed.success) return { error: t("פריט לא תקין") };
  const { itemId } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);
      const hero = empire.hero;
      if (!hero) return { error: t("הגיבור לא נמצא") };
      await lockHero(tx, hero.id);

      // Read under the lock, not from the settled snapshot above it.
      const item = await tx.heroItem.findFirst({
        where: { id: itemId, heroId: hero.id },
      });
      if (!item) return { error: t("הפריט לא נמצא בתיק שלך") };

      const target = nextTierLevel(item.level);
      const cost = temperShardCost(item.level);
      if (target === null || cost === null) {
        return {
          error: atSetCeiling(item.level)
            ? t("פריט אגדי הוא שיא הסדרה שלו — רק פריט מסדרה גבוהה יותר יעלה עליו.")
            : t("אין לפריט הזה דרגה גבוהה יותר."),
        };
      }

      const paid = await tx.hero.updateMany({
        where: { id: hero.id, shards: { gte: cost } },
        data: { shards: { decrement: cost } },
      });
      if (paid.count === 0) {
        return {
          error: t("ליטוש הפריט הזה עולה {shards} רסיסים.", {
            shards: formatNumber(cost),
          }),
        };
      }

      const raised = await tx.heroItem.updateMany({
        where: { id: item.id, heroId: hero.id, level: item.level },
        data: { level: target, rarity: tierForLevel(target) },
      });
      if (raised.count === 0) {
        // Somebody else moved the piece between the read and the write. Refund
        // rather than silently charging for a band the player did not get.
        await tx.hero.update({
          where: { id: hero.id },
          data: { shards: { increment: cost } },
        });
        return { error: t("הפריט השתנה בינתיים — נסה שוב.") };
      }

      return {
        success: t("{item} לוטש ל{rarity} (רמה {level}).", {
          item: t(SLOT_META[item.slot].label),
          rarity: t(RARITY_META[tierForLevel(target)].label),
          level: target,
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("forge.temperHeroItem", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
