"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { formatNumber } from "@/lib/game/format";
import { notStaffOrBot } from "@/lib/bot";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  REFERRAL_GOAL_CITIES,
  joinerReward,
  mayNameReferrer,
  referralEarned,
  referrerReward,
  type ReferralInvitee,
  type ReferralState,
} from "@/lib/game/referral";
import { payRewards } from "@/server/rewardGrant";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT, type T } from "@/i18n/server";

/**
 * הזמנת חבר — naming a referrer, and collecting either half.
 *
 * All three actions are guarded the same way the rest of the daily loop is: the
 * write that records the claim is the write that decides whether it happens.
 * `referredById IS NULL` gates the naming; `referralPaidAt IS NULL` and
 * `referrerPaidAt IS NULL` gate the two payouts. Nothing here reads a value and
 * then acts on it.
 */

async function requireOwnEmpireId(): Promise<string> {
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the catch returns a translated line.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

function describeRewards(t: T, rewards: readonly Reward[]): string {
  return rewards
    .filter((r) => r.amount > 0)
    .map((r) =>
      t("{amount} {resource}", {
        amount: formatNumber(r.amount),
        resource: t(REWARD_LABEL[r.kind]),
      })
    )
    .join(", ");
}

/* ------------------------------ read ------------------------------ */

/** Everything the referrals screen renders. */
export async function getReferralState(): Promise<ReferralState | null> {
  const empireId = await getActiveEmpireId();
  if (empireId === null) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: {
      name: true,
      cities: true,
      referredById: true,
      referralPaidAt: true,
      referrerPaidAt: true,
      referredBy: { select: { name: true } },
      // Everyone this player brought in. Bounded in practice by how many people
      // one person can recruit, and served by the index on referredById.
      referred: {
        select: {
          id: true,
          name: true,
          cities: true,
          referrerPaidAt: true,
        },
        orderBy: { cities: "desc" },
      },
    },
  });
  if (!empire) return null;

  const invitees: ReferralInvitee[] = empire.referred.map((row) => ({
    empireId: row.id,
    empireName: row.name,
    cities: row.cities,
    earned: referralEarned(row.cities),
    claimed: row.referrerPaidAt !== null,
  }));

  return {
    code: empire.name,
    invitees,
    collectable: invitees.filter((i) => i.earned && !i.claimed).length,
    referrerReward: referrerReward(empire.cities),

    referrerName: empire.referredBy?.name ?? null,
    mayName: empire.referredById === null && mayNameReferrer(empire.cities),
    joinerClaimable:
      empire.referredById !== null &&
      empire.referralPaidAt === null &&
      referralEarned(empire.cities),
    joinerClaimed: empire.referralPaidAt !== null,
    joinerReward: joinerReward(empire.cities),
    cities: empire.cities,
    goalCities: REFERRAL_GOAL_CITIES,
  };
}

/* ------------------------------ name a referrer ------------------------------ */

const nameSchema = z.object({ name: z.string().trim().min(2).max(30) });

/**
 * Name the empire that brought you in.
 *
 * Every check here is about making the link mean something. In order: it can be
 * done once, only while you are still small, never for yourself, never for a
 * staff account or a garrison bot, and never in a circle — an empire you
 * already brought in cannot turn round and claim to have brought you.
 *
 * The circle check is one level deep on purpose. Longer rings (A→B→C→A) are
 * possible in principle and pointless in practice: every link still has to be
 * played to three cities before anything is paid, so a ring of accounts is
 * simply three accounts' worth of work for three purses — which is the same
 * exchange rate as playing honestly.
 */
export async function nameReferrer(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: t("שם אימפריה לא תקין") };
  const { name } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const mine = await applyPendingUpdates(empireId, tx);

      if (mine.referredById !== null) {
        return { error: t("כבר ציינת מי הזמין אותך.") };
      }
      if (!mayNameReferrer(mine.cities)) {
        return {
          error: t("אפשר לציין מזמין רק בתחילת הדרך, עד {max} ערים.", {
            max: 2,
          }),
        };
      }
      if (name === mine.name) {
        return { error: t("אי אפשר להזמין את עצמך.") };
      }

      // Staff and garrison bots are not players and cannot recruit — the same
      // exclusion every ranked and paying surface in the game applies.
      const referrer = await tx.empire.findFirst({
        where: { name, ...notStaffOrBot },
        select: { id: true, name: true, referredById: true },
      });
      if (!referrer) return { error: t("לא נמצאה אימפריה בשם הזה.") };
      if (referrer.referredById === empireId) {
        return { error: t("אי אפשר להזמין זה את זה.") };
      }

      // The write IS the guard: `referredById: null` in the WHERE means a second
      // concurrent submission matches nothing.
      const named = await tx.empire.updateMany({
        where: { id: empireId, referredById: null },
        data: { referredById: referrer.id },
      });
      if (named.count === 0) {
        return { error: t("כבר ציינת מי הזמין אותך.") };
      }

      return {
        success: t("{referrer} רשום כמי שהזמין אותך. שניכם תקבלו פרס כשתגיע ל-{goal} ערים.", {
          referrer: referrer.name,
          goal: REFERRAL_GOAL_CITIES,
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("referral.nameReferrer", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ the newcomer's half ------------------------------ */

/** Collect your own half, once you have reached the goal. */
export async function collectJoinerReward(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
      const mine = await applyPendingUpdates(empireId, tx);

      if (mine.referredById === null) {
        return { error: t("לא ציינת מי הזמין אותך.") };
      }
      if (!referralEarned(mine.cities)) {
        return {
          error: t("הפרס נפתח ב-{goal} ערים.", { goal: REFERRAL_GOAL_CITIES }),
        };
      }
      if (mine.referralPaidAt !== null) {
        return { error: t("כבר אספת את הפרס הזה.") };
      }

      const claimed = await tx.empire.updateMany({
        where: { id: empireId, referralPaidAt: null },
        data: { referralPaidAt: new Date() },
      });
      if (claimed.count === 0) return { error: t("כבר אספת את הפרס הזה.") };

      const paid = await payRewards(tx, empireId, joinerReward(mine.cities));
      return {
        success: t("קיבלת {spoils} על ההצטרפות דרך חבר.", {
          spoils: describeRewards(t, paid),
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("referral.collectJoinerReward", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ the referrer's half ------------------------------ */

const inviteeSchema = z.object({ empireId: z.string().min(1).max(64) });

/**
 * Collect for one empire you brought in.
 *
 * The goal is checked against the invitee's **live** city count rather than a
 * stamp, so a referral is never owed for an account that was abandoned on the
 * way there — and the receipt lives on the invitee's row, which is what makes
 * one referrer's many invitees independent of each other.
 */
export async function collectReferrerReward(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = inviteeSchema.safeParse({ empireId: formData.get("empireId") });
  if (!parsed.success) return { error: t("אימפריה לא תקינה") };
  const inviteeId = parsed.data.empireId;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
      const mine = await applyPendingUpdates(empireId, tx);

      const invitee = await tx.empire.findUnique({
        where: { id: inviteeId },
        select: { name: true, cities: true, referredById: true, referrerPaidAt: true },
      });
      // Scoped to *this* referrer, so a stale or guessed id can never collect
      // against somebody else's invitee.
      if (!invitee || invitee.referredById !== empireId) {
        return { error: t("לא הזמנת את האימפריה הזו.") };
      }
      if (!referralEarned(invitee.cities)) {
        return {
          error: t("{name} עדיין לא הגיע ל-{goal} ערים.", {
            name: invitee.name,
            goal: REFERRAL_GOAL_CITIES,
          }),
        };
      }
      if (invitee.referrerPaidAt !== null) {
        return { error: t("כבר אספת את הפרס על {name}.", { name: invitee.name }) };
      }

      const claimed = await tx.empire.updateMany({
        where: { id: inviteeId, referredById: empireId, referrerPaidAt: null },
        data: { referrerPaidAt: new Date() },
      });
      if (claimed.count === 0) {
        return { error: t("כבר אספת את הפרס על {name}.", { name: invitee.name }) };
      }

      const paid = await payRewards(tx, empireId, referrerReward(mine.cities));
      return {
        success: t("קיבלת {spoils} על שהבאת את {name}.", {
          spoils: describeRewards(t, paid),
          name: invitee.name,
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("referral.collectReferrerReward", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
