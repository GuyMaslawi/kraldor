"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { logError } from "@/server/errorLog";
import { applyPendingUpdates } from "@/lib/game/updates";
import { grantCitizens } from "@/lib/game/grants";
import {
  ACHIEVEMENTS,
  isAchievementReached,
  mergeRewards,
  type AchievementDefinition,
  type AchievementRewardKind,
  type AchievementRewardTotal,
} from "@/lib/game/achievements";
import { gatherAchievementStats, getClaimedKeys } from "@/server/achievementState";
import { getT } from "@/i18n/server";

/**
 * No ladder is returned on success: `revalidatePath` re-renders the page from
 * the database, which is the single source of truth the client renders from.
 * What does come back is the payout summary, already merged per resource so
 * the client can render it as icons instead of a sentence.
 */
export interface ClaimAchievementsResult {
  ok: boolean;
  error?: string;
  /** How many achievements were collected in this batch. */
  count?: number;
  /** One entry per resource, summed across the whole batch. */
  totals?: AchievementRewardTotal[];
}

/** Credit one achievement's reward to the empire. */
async function grantReward(
  tx: Prisma.TransactionClient,
  empireId: string,
  a: AchievementDefinition
): Promise<void> {
  const { kind, amount } = a.reward;
  if (kind === "citizens") {
    // Citizens are ceilinged by city count; a raw increment would breach the cap
    // the daily update enforces, and citizens convert into mine slaves — an
    // uncapped citizen faucet is an uncapped resource faucet. See grantCitizens.
    await grantCitizens(tx, empireId, amount);
  } else {
    await tx.empire.update({
      where: { id: empireId },
      data: { [kind]: { increment: amount } },
    });
  }
}

/**
 * Collect unlocked, uncollected achievements — the whole batch, or the single
 * one named by `only`.
 *
 * Conditions are re-evaluated here straight from the database rather than
 * trusted from the caller, so a client cannot claim a reward it has not earned.
 * `only` therefore narrows *which* rewards are considered; it never grants
 * anything the full sweep would not have granted anyway.
 *
 * The receipt row is inserted *before* the payout, and the unique constraint on
 * `(empireId, key)` is what makes a double-submit a no-op: two concurrent
 * claims race on the insert, and the loser sees P2002 and skips the credit
 * entirely. Every reward is a plain resource increment that cannot fail to
 * land, so there is no case where a receipt exists but nothing was paid.
 */
async function runClaim(only: string | null): Promise<ClaimAchievementsResult> {
  const t = await getT();
  try {
    // Enforces the ban/verification gate on the action too, not just page loads.
    const empireId = await getActiveEmpireId();
    if (empireId === null) return { ok: false, error: t("לא מחובר") };

    const result = await prisma.$transaction(async (tx) => {
      // Settle pending updates first, so a milestone the player crossed via an
      // unsettled update (citizens, production) counts on this very claim.
      await applyPendingUpdates(empireId, tx);

      const claimedKeys = await getClaimedKeys(tx, empireId);
      const stats = await gatherAchievementStats(tx, empireId, claimedKeys);
      if (!stats) return { ok: false as const, error: t("האימפריה לא נמצאה") };

      const granted: { kind: AchievementRewardKind; amount: number }[] = [];
      for (const a of ACHIEVEMENTS) {
        if (only !== null && a.key !== only) continue;
        if (claimedKeys.has(a.key)) continue;
        // Positive test on purpose: `progress < goal` would let an absent or
        // NaN stat through, because comparisons against NaN are always false.
        // See achievementProgress.
        if (!isAchievementReached(a, stats)) continue;

        // `createMany(skipDuplicates)` compiles to ON CONFLICT DO NOTHING, so a
        // concurrent claim of the same key comes back as `count: 0` instead of
        // raising P2002.
        //
        // That distinction is the whole point. In Postgres a failed statement
        // aborts the *entire* transaction, and Prisma wraps no savepoint around
        // individual queries — so catching P2002 in JS did not recover the
        // connection. Every later statement returned 25P02 and the enclosing
        // $transaction rolled back, so one raced key destroyed the payout for
        // every other achievement in the same batch and the player saw a bare
        // "שגיאה". (Same hazard `awardSeasonPassXp` upserts to avoid.)
        const receipt = await tx.empireAchievement.createMany({
          data: [{ empireId, key: a.key }],
          skipDuplicates: true,
        });
        // Lost the race with a concurrent claim — it already paid this one out.
        if (receipt.count === 0) continue;
        await grantReward(tx, empireId, a);
        granted.push(a.reward);
      }

      if (granted.length === 0) {
        return {
          ok: false as const,
          error:
            only === null
              ? t("אין הישגים חדשים לאיסוף")
              : t("הפרס הזה כבר נאסף או שעדיין לא נפתח"),
        };
      }
      // One line per resource rather than one per achievement — collecting a
      // whole category at once otherwise prints dozens of fragments.
      return {
        ok: true as const,
        count: granted.length,
        totals: mergeRewards(granted),
      };
    });

    if (result.ok) revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    // Never the raw message: a Prisma failure names models, fields and
    // sometimes the statement itself, and this string is rendered straight into
    // the browser. Logged so the fault is visible in /admin/monitor instead of
    // only in one player's toast.
    await logError("achievements.claimAchievements", err);
    return { ok: false, error: t("אירעה שגיאה, נסה שוב") };
  }
}

/** Collect everything that is unlocked and uncollected, in one sweep. */
export async function claimAchievements(): Promise<ClaimAchievementsResult> {
  return runClaim(null);
}

/**
 * Collect one specific achievement.
 *
 * The key is checked against the ladder before it reaches the transaction —
 * not for safety (an unknown key simply matches nothing) but so a stale client
 * gets a sentence instead of the generic "already collected".
 */
export async function claimAchievement(key: string): Promise<ClaimAchievementsResult> {
  if (typeof key !== "string" || !ACHIEVEMENTS.some((a) => a.key === key)) {
    return { ok: false, error: (await getT())("הישג לא מוכר") };
  }
  return runClaim(key);
}
