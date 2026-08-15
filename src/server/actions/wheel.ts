"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { grantCitizens } from "@/lib/game/grants";
import {
  WHEEL_PRIZES,
  pickWheelPrizeIndex,
  wheelClock,
  wheelPrizeAmount,
  type WheelClock,
  type WheelGrant,
  type WheelPrizeDef,
} from "@/lib/game/wheel";
import { awardSeasonPassXp } from "../seasonPassXp";
import type { FullEmpire } from "@/lib/game/updates";
import { getT, type T } from "@/i18n/server";

/** What a spin returns to the client so it can animate to the right wedge. */
export type SpinResult =
  | {
      ok: true;
      prizeIndex: number;
      message: string;
      /** Exactly what was granted, so a batch can total each prize precisely. */
      grants: WheelGrant[];
      spinsLeft: number;
    }
  | { ok: false; error: string };

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban on every action (not just page loads); see getActiveEmpireId.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — spinWheel catches it and returns the
  // translated "something went wrong" instead.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

const num = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Grant a won prize to the empire and return the reveal message. Every branch
 * writes to the DB — the wheel actually pays out. Amount prizes are read off the
 * season clock; the one unit prize (a hero item) is a concrete grant.
 */
async function grantPrize(
  tx: Prisma.TransactionClient,
  empire: FullEmpire,
  prize: WheelPrizeDef,
  clock: WheelClock,
  t: T
): Promise<{ message: string; grants: WheelGrant[] }> {
  const empireId = empire.id;
  const amount = wheelPrizeAmount(prize, clock);

  switch (prize.key) {
    case "diamonds":
      await tx.empire.update({ where: { id: empireId }, data: { diamonds: { increment: amount } } });
      return {
        message: t("זכית ב־{amount} יהלומים!", { amount: num(amount) }),
        grants: [{ key: "diamonds", amount }],
      };
    case "gold":
      await tx.empire.update({ where: { id: empireId }, data: { gold: { increment: amount } } });
      return {
        message: t("זכית ב־{amount} זהב!", { amount: num(amount) }),
        grants: [{ key: "gold", amount }],
      };
    case "iron":
      await tx.empire.update({ where: { id: empireId }, data: { iron: { increment: amount } } });
      return {
        message: t("זכית ב־{amount} ברזל!", { amount: num(amount) }),
        grants: [{ key: "iron", amount }],
      };
    case "stone":
      await tx.empire.update({ where: { id: empireId }, data: { stone: { increment: amount } } });
      return {
        message: t("זכית ב־{amount} אבן!", { amount: num(amount) }),
        grants: [{ key: "stone", amount }],
      };
    case "wood":
      await tx.empire.update({ where: { id: empireId }, data: { wood: { increment: amount } } });
      return {
        message: t("זכית ב־{amount} עץ!", { amount: num(amount) }),
        grants: [{ key: "wood", amount }],
      };
    case "citizens":
      // Always through grantCitizens, never a raw increment — see the note there
      // on why the spin rate, not a population lid, is what keeps this safe.
      await grantCitizens(tx, empireId, amount);
      return {
        message: t("זכית ב־{amount} אזרחים!", { amount: num(amount) }),
        grants: [{ key: "citizens", amount }],
      };
    // The hero-item wedge was removed on 2026-08-15 (see WHEEL_PRIZES) and with
    // it this function's only failure path: a bag-full/no-hero gold consolation
    // and the hero-row lock that stopped two concurrent spins overflowing
    // HERO_BAG_CAPACITY. Every wedge left pays a plain balance increment.
    default:
      return { message: t("זכית בפרס!"), grants: [] };
  }
}

/** Spin the wheel: consume one spin, roll a prize server-side, and pay it out. */
export async function spinWheel(): Promise<SpinResult> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();
    const result = await prisma.$transaction(async (tx): Promise<SpinResult> => {
      const empire = await applyPendingUpdates(empireId, tx);

      // Guarded consume — can never drive spins negative under concurrency.
      const consumed = await tx.empire.updateMany({
        where: { id: empireId, wheelSpins: { gte: 1 } },
        data: { wheelSpins: { decrement: 1 } },
      });
      if (consumed.count === 0) {
        return { ok: false, error: t("אין סיבובים זמינים") };
      }

      const season = empire.seasonId
        ? await tx.gameSeason.findUnique({ where: { id: empire.seasonId } })
        : null;
      const clock = wheelClock(season, Date.now());

      const prizeIndex = pickWheelPrizeIndex();
      const { message, grants } = await grantPrize(
        tx,
        empire,
        WHEEL_PRIZES[prizeIndex],
        clock,
        t
      );
      await awardSeasonPassXp(tx, empireId, "wheelSpin");

      return { ok: true, prizeIndex, message, grants, spinsLeft: empire.wheelSpins - 1 };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch {
    return { ok: false, error: t("אירעה שגיאה, נסה שוב") };
  }
}
