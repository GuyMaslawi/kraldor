"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { HeroItemSlot, HeroRarity, PotionKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { getTunables } from "@/lib/game/config";
import { seasonPassDay } from "@/lib/game/seasonPass";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import { grantCitizens } from "@/lib/game/grants";
import { grantPotion } from "@/lib/game/potionEffects";
import { rollGuaranteedPotion, POTION_META } from "@/lib/game/potions";
import { secureRandom } from "@/lib/game/random";
import { formatNumber } from "@/lib/game/format";
import { MAX_CITIES } from "@/lib/game/constants";
import {
  HERO_BAG_CAPACITY,
  CITIZENS_PER_LEVEL,
  applyHeroXp,
  classXpMultiplier,
  isHeroDead,
  itemDisplayName,
  rollGuaranteedItem,
} from "@/lib/game/hero";
import {
  HERO_QUEST_HAUL_LABEL,
  heroQuestByTier,
  heroQuestDurationMs,
  heroQuestDurationLabel,
  heroQuestFortuneByKey,
  heroQuestTurnCost,
  heroQuestUnlocked,
  heroQuestXp,
  rollHeroQuestReward,
  type HeroQuestHaulKind,
} from "@/lib/game/heroQuests";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT } from "@/i18n/server";
import { syncEmpirePower } from "@/server/empirePower";

/**
 * The hero's expedition board — sending him out and bringing him home.
 * Catalog and balance: src/lib/game/heroQuests.ts.
 *
 * Both actions serialize on the empire row (`SELECT … FOR UPDATE`) exactly like
 * the boss run does, because both read a snapshot and then write from it. What
 * makes them *correct* rather than merely serialized is narrower, though, and
 * worth stating once:
 *
 *  - Departing spends turns through a guarded `updateMany` (the house rule for
 *    every debit in this codebase) and creates a row behind a unique index on
 *    `empireId`. Two taps cannot buy two quests.
 *  - Collecting *deletes* the row under a guard on `endsAt`, and treats the
 *    delete — not the read before it — as the claim. Two taps cannot pay twice.
 */

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban and the verification gate on every action, not just on
  // page loads; see getActiveEmpireId.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — each action catches it and returns
  // the translated "something went wrong" instead.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

const startSchema = z.object({
  tier: z.coerce.number().int().min(1).max(MAX_CITIES),
});

/* ------------------------------ depart ------------------------------ */

/**
 * Send the hero on the expedition of `tier`.
 *
 * The haul is *rolled* here — fortune band and all — and stored on the row. Two
 * reasons it happens at departure rather than on the way home: the empire the
 * player was running when they spent the turns is the empire that should be
 * paid (a city founded or lost while he is away cannot move the goalposts in
 * either direction), and a haul that already exists cannot be rerolled by a
 * player who retries the collect. Nothing leaks: the row is server-side only
 * and the board is never told what is coming — see lib/game/heroQuests.ts.
 *
 * The *loot* roll is still deliberately not made here: it needs the hero's level
 * at the moment he comes home.
 */
export async function startHeroQuest(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = startSchema.safeParse({ tier: formData.get("tier") });
  const t = await getT();
  if (!parsed.success) return { error: t("משימה לא תקינה") };
  const { tier } = parsed.data;

  const quest = heroQuestByTier(tier);
  if (!quest) return { error: t("משימה לא תקינה") };

  try {
    const empireId = await requireOwnEmpireId();

    // Outside the transaction: see the note in game.ts's spyOnEmpire for why a
    // transaction must not ask for a second connection while holding one.
    const tunables = await getTunables();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      if (tunables.heroQuest.enabled < 1) {
        return { error: t("לוח המסעות סגור כרגע.") };
      }

      // Settle first: the turn cost is paid out of the *current* balance, and a
      // player who was away has ticks of turns waiting to be credited.
      const empire = await applyPendingUpdates(empireId, tx);
      const now = new Date();

      if (!heroQuestUnlocked(quest.tier, empire.cities)) {
        return {
          error: t('"{quest}" נפתחת עם העיר ה-{tier} שלך.', {
            quest: t(quest.name),
            tier: quest.tier,
          }),
        };
      }

      const hero = empire.hero;
      if (!hero) return { error: t("אין לך גיבור") };
      if (isHeroDead(hero)) {
        return {
          error: t("הגיבור מת — אי אפשר לשלוח אותו למסע עד שיקום לתחייה."),
        };
      }

      // One hero, one place. The unique index below would catch this too, but a
      // constraint violation inside a transaction poisons the whole transaction
      // in Postgres, so the readable refusal has to come first.
      const running = await tx.heroQuest.findUnique({
        where: { empireId },
        select: { id: true },
      });
      if (running) {
        return { error: t("הגיבור כבר במסע — הוא יוצא רק לאחד בכל פעם.") };
      }

      // Priced against the empire that is sending him, not against the rung
      // alone: the haul scales with `empire.cities` and so must the price (see
      // HERO_QUEST_TURNS_PER_CITY). Read off the settled row inside the lock, so
      // a city founded a moment ago is already paid for.
      const turnCost = heroQuestTurnCost(quest.tier, empire.cities);
      const notEnoughTurns = {
        error: t('נדרשות {turns} תורות כדי לשלוח את הגיבור ל"{quest}".', {
          turns: turnCost.toLocaleString("en-US"),
          quest: t(quest.name),
        }),
      };
      if (empire.turns < turnCost) return notEnoughTurns;

      // Guarded debit: a concurrent action can never drive turns negative.
      const paid = await tx.empire.updateMany({
        where: { id: empireId, turns: { gte: turnCost } },
        data: { turns: { decrement: turnCost } },
      });
      if (paid.count === 0) return notEnoughTurns;

      // The haul tracks the season's progress, exactly like the boss's — and
      // then the road has its say.
      const season = await tx.gameSeason.findFirst({
        where: { isActive: true },
        select: { startsAt: true, endsAt: true },
      });
      const { reward, fortune } = rollHeroQuestReward(
        quest.tier,
        empire.cities,
        seasonPassDay(season, now.getTime()),
        tunables.heroQuest.rewardMultiplier
      );

      await tx.heroQuest.create({
        data: {
          empireId,
          tier: quest.tier,
          startedAt: now,
          endsAt: new Date(now.getTime() + heroQuestDurationMs(quest.tier)),
          turnsSpent: turnCost,
          fortune: fortune.key,
          rewardGold: reward.gold,
          rewardWood: reward.wood,
          rewardIron: reward.iron,
          rewardStone: reward.stone,
          rewardCitizens: reward.citizens,
          rewardSlaves: reward.slaves,
          rewardXp: heroQuestXp(quest.tier),
        },
      });

      // Paid for departing, not for collecting — see SEASON_PASS_XP.heroQuest.
      await awardSeasonPassXp(tx, empireId, "heroQuest");

      return {
        success: t('הגיבור יצא ל"{quest}". הוא יחזור בעוד {duration}.', {
          quest: t(quest.name),
          duration: heroQuestDurationLabel(t, quest.tier),
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("heroQuests.startHeroQuest", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ collect ------------------------------ */

/** One line of the homecoming table — a kind the board knows how to draw. */
export interface HeroQuestHaulEntry {
  kind: HeroQuestHaulKind;
  amount: number;
}

/**
 * Everything the run turned out to be worth, itemised.
 *
 * This is the *only* moment the haul is ever named, so it goes back as data
 * rather than a sentence: the board draws a tile per kind, and a player who
 * looked away for a second can still read what arrived. Quest name, sigil,
 * colour and the fortune's flavour are all derivable from `tier` and `fortune`
 * through pure lookups the client already imports — no need to ship them twice.
 */
export interface HeroQuestHaul {
  tier: number;
  /** Fortune band key; the board resolves label + lore via heroQuestFortuneByKey. */
  fortune: string;
  entries: HeroQuestHaulEntry[];
  /** Hero levels the trip bought, for the line under the XP tile. */
  levelsGained: number;
  item: { label: string; rarity: HeroRarity } | null;
  potion: PotionKind | null;
}

export interface HeroQuestCollectState extends ActionState {
  /** Present only on a successful claim — the reveal panel's whole content. */
  haul?: HeroQuestHaul;
}

/**
 * Bring the hero home and pay out the quest he finished.
 *
 * Everything except the loot was decided at departure, so this is mostly a
 * transfer. The two rolls that happen here — gear and a potion, independent of
 * each other — use the hero's level *now*, which is the level the board's odds
 * were always going to be read against.
 */
export async function collectHeroQuest(): Promise<HeroQuestCollectState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      const empire = await applyPendingUpdates(empireId, tx);
      const now = new Date();

      const quest = await tx.heroQuest.findUnique({ where: { empireId } });
      if (!quest) return { error: t("הגיבור אינו במסע.") };

      const meta = heroQuestByTier(quest.tier);
      if (quest.endsAt > now) {
        return {
          error: t("{quest} עדיין בעיצומו.", {
            quest: meta ? t(meta.name) : t("המסע"),
          }),
        };
      }

      // The delete IS the claim: whichever concurrent call removes the row pays
      // out, and the other finds nothing to remove and pays nothing. Guarding on
      // `endsAt` as well keeps a clock skew from cashing a running quest.
      const claimed = await tx.heroQuest.deleteMany({
        where: { id: quest.id, endsAt: { lte: now } },
      });
      if (claimed.count === 0) return { error: t("המסע כבר נאסף.") };

      /* ---- the frozen haul ---- */
      await tx.empire.update({
        where: { id: empireId },
        data: {
          gold: { increment: quest.rewardGold },
          wood: { increment: quest.rewardWood },
          iron: { increment: quest.rewardIron },
          stone: { increment: quest.rewardStone },
        },
      });
      if (quest.rewardCitizens > 0) {
        await grantCitizens(tx, empireId, quest.rewardCitizens);
      }
      if (quest.rewardSlaves > 0) {
        // Captives dragged home arrive unassigned, exactly as from the boss.
        // upsert, not update: an empire with no Army row yet (nothing in this
        // flow requires one — unlike a boss run, questing needs no soldiers)
        // would otherwise throw and roll back a haul the player has earned.
        await tx.army.upsert({
          where: { empireId },
          create: { empireId, mineSlaves: quest.rewardSlaves },
          update: { mineSlaves: { increment: quest.rewardSlaves } },
        });
        // Mine slaves carry no power, so this cannot move a figure — synced
        // anyway so the rule has no exceptions a later reader has to know.
        await syncEmpirePower(tx, empireId);
      }

      /* ---- the hero: what the road taught him, and what he found ---- */
      const hero = empire.hero;
      let droppedItem: { slot: HeroItemSlot; level: number; rarity: HeroRarity } | null =
        null;
      let droppedPotion: PotionKind | null = null;
      let xpGained = 0;
      let levelsGained = 0;

      if (hero) {
        // XP is paid even to a hero who fell while he was away: he earned it on
        // the road, and his corpse still knows what it learned. (A dead hero
        // simply grants no bonuses until he rises — see heroBonuses.)
        // The class multiplier is part of what he brought home, so the reveal
        // quotes the XP actually banked rather than the rung's base figure.
        xpGained = Math.round(quest.rewardXp * classXpMultiplier(hero));
        const next = applyHeroXp(hero, xpGained);
        await tx.hero.update({
          where: { id: hero.id },
          data: {
            level: next.level,
            xp: next.xp,
            unspentPoints: { increment: next.pointsGained },
          },
        });
        levelsGained = next.level - hero.level;
        if (levelsGained > 0) {
          await grantCitizens(tx, empireId, levelsGained * CITIZENS_PER_LEVEL);
        }

        if (meta && secureRandom() < meta.itemChance) {
          // Counted live rather than off the empire snapshot, which predates
          // this transaction's lock — a drop that landed in between would
          // otherwise be missed and push the bag past its capacity.
          const bagCount = await tx.heroItem.count({
            where: { heroId: hero.id, equipped: false },
          });
          if (bagCount < HERO_BAG_CAPACITY) {
            droppedItem = rollGuaranteedItem(next.level);
            await tx.heroItem.create({ data: { heroId: hero.id, ...droppedItem } });
          }
        }
      }

      if (meta && secureRandom() < meta.potionChance) {
        // The quest's own odds already decided *that* a brew came back, so only
        // the weighted pick of which one is left — see rollGuaranteedPotion.
        const kind = rollGuaranteedPotion();
        if (await grantPotion(tx, empireId, kind)) {
          droppedPotion = kind;
        }
      }

      /* ---- the homecoming ---- */
      // The one moment the haul is ever named — and the only place the run's
      // luck is revealed, which is what makes the wait worth anything. It goes
      // back itemised (see HeroQuestHaul); the sentence below is the fallback
      // for anywhere that can only render a line.
      const entries: HeroQuestHaulEntry[] = (
        [
          { kind: "gold", amount: quest.rewardGold },
          { kind: "wood", amount: quest.rewardWood },
          { kind: "iron", amount: quest.rewardIron },
          { kind: "stone", amount: quest.rewardStone },
          { kind: "citizens", amount: quest.rewardCitizens },
          { kind: "slaves", amount: quest.rewardSlaves },
          { kind: "xp", amount: xpGained },
        ] as const
      )
        .filter((e) => e.amount > 0)
        .map((e) => ({ kind: e.kind, amount: e.amount }));

      const fortune = heroQuestFortuneByKey(quest.fortune);
      const spoils = [
        ...entries.map((e) =>
          t("{amount} {resource}", {
            amount: formatNumber(e.amount),
            resource: t(HERO_QUEST_HAUL_LABEL[e.kind]),
          })
        ),
        droppedItem ? itemDisplayName(t, droppedItem.slot, droppedItem.level) : null,
        droppedPotion ? t(POTION_META[droppedPotion].label) : null,
      ].filter(Boolean);

      return {
        success: t('{fortune}! הגיבור חזר מ"{quest}" עם {spoils}. {lore}', {
          fortune: t(fortune.label),
          quest: meta ? t(meta.name) : t("המסע"),
          spoils: spoils.join(", "),
          lore: t(fortune.lore),
        }),
        haul: {
          tier: quest.tier,
          fortune: quest.fortune,
          entries,
          levelsGained,
          item: droppedItem
            ? {
                label: itemDisplayName(t, droppedItem.slot, droppedItem.level),
                rarity: droppedItem.rarity,
              }
            : null,
          potion: droppedPotion,
        },
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("heroQuests.collectHeroQuest", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
