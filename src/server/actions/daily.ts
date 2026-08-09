"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, MissionScope as PrismaMissionScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { gameDay, gameWeek } from "@/lib/game/time";
import { formatNumber } from "@/lib/game/format";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  streakRung,
  streakRungRewards,
  streakTransition,
} from "@/lib/game/streak";
import {
  MISSION_BY_KEY,
  buildMissionBoard,
  missionBaseline,
  missionGoal,
  missionProgress,
  readBaseline,
  type MissionScope,
} from "@/lib/game/missions";
import {
  GUILD_CONTRACT_BY_KEY,
  guildContractReward,
} from "@/lib/game/guildContract";
import { gatherAchievementStats, getClaimedKeys } from "@/server/achievementState";
import { payRewards } from "@/server/rewardGrant";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT, type T } from "@/i18n/server";

/**
 * לוח היום — signing the muster roll, collecting a mission, taking a share of
 * the guild's contract.
 *
 * Every one of the three is a *claim*, and all three are guarded the same way:
 * the write that records the claim is the same write that decides whether it
 * happens at all, so its `count` — never a read taken beforehand — is what
 * gates the payout. Concretely:
 *
 *  - the roll is an `updateMany` filtered on the day it was last signed;
 *  - a mission appends its key under `NOT (claimed has key)`;
 *  - a contract share appends the empire id under `NOT (paid has id)`.
 *
 * None of the three can pay twice under any amount of double-tapping, and none
 * of them needs a row lock to say so. The empire row is still locked around
 * each, because each also *settles* the empire first (`applyPendingUpdates`),
 * and that is the part that must not interleave.
 */

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban and the verification gate on every action, not just on
  // page loads; see getActiveEmpireId.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the catch returns a translated line.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

/** "80,000 זהב, 200 תורות" — a purse as one readable line. */
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

/** A payout state that carries the itemised purse for the reveal panel. */
export interface ClaimState extends ActionState {
  /** Present only on a successful claim. */
  paid?: Reward[];
}

/* ------------------------------ the muster roll ------------------------------ */

/**
 * Sign today's roll.
 *
 * The guard is `streakDay: <the value we read>`, not `streakDay < today`. Both
 * would stop a double claim, but pinning the exact snapshot also stops the
 * *streak length* from being computed off a stale read: two concurrent claims
 * would otherwise both see yesterday's count and both write `count + 1`, and
 * the second one would silently overwrite the first with the same number —
 * paying twice for one day. Pinning means the loser matches no row.
 */
export async function claimStreak(): Promise<ClaimState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      // Settle first: the roll pays turns and citizens, and a player who was
      // away has a backlog of both waiting. Settling after the credit would
      // make the two writes race for the same columns.
      const empire = await applyPendingUpdates(empireId, tx);
      const today = gameDay(new Date());

      const move = streakTransition(empire.streakDay, empire.streakCount, today);
      if (!move.claimable) {
        return { error: t("כבר חתמת על מפקד היום. חזור מחר.") };
      }

      const rewards = streakRungRewards(
        streakRung(move.nextCount).day,
        empire.cities
      );

      const signed = await tx.empire.updateMany({
        where: {
          id: empireId,
          streakDay: empire.streakDay,
          streakCount: empire.streakCount,
        },
        data: {
          streakDay: today,
          streakCount: move.nextCount,
          // Only ever raised. A broken run must not take the record with it —
          // `max` in JS rather than a SQL GREATEST because the value being
          // compared against is the one this transaction is about to write.
          streakBest: Math.max(empire.streakBest, move.nextCount),
        },
      });
      if (signed.count === 0) {
        return { error: t("כבר חתמת על מפקד היום. חזור מחר.") };
      }

      const paid = await payRewards(tx, empireId, rewards);

      return {
        success: move.broken
          ? t("הרצף נשבר, ומתחיל מחדש. חתמת על יום 1 וקיבלת {spoils}.", {
              spoils: describeRewards(t, paid),
            })
          : t("יום {count} ברצף. קיבלת {spoils}.", {
              count: move.nextCount,
              spoils: describeRewards(t, paid),
            }),
        paid,
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("daily.claimStreak", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ a mission ------------------------------ */

const missionSchema = z.object({
  scope: z.enum(["DAY", "WEEK"]),
  key: z.string().min(1).max(64),
});

/**
 * Collect one finished mission.
 *
 * The completion test is re-run here against a snapshot gathered *inside* the
 * transaction rather than trusting the board the player was looking at. That
 * board was rendered from a read that may be minutes old, and the button it
 * drew is a claim on the treasury — the same reason the achievements claim
 * re-evaluates its condition instead of believing the page.
 *
 * A daily claim also credits the guild's contract. Weekly ones deliberately do
 * not: a contract is a *day's* work by the guild, and letting a weekly count
 * would let one member finish a whole guild's contract with a mission they had
 * been sitting on since Sunday.
 */
export async function claimMission(
  _prev: ActionState,
  formData: FormData
): Promise<ClaimState> {
  const t = await getT();
  const parsed = missionSchema.safeParse({
    scope: formData.get("scope"),
    key: formData.get("key"),
  });
  if (!parsed.success) return { error: t("משימה לא תקינה") };
  const { scope, key } = parsed.data;

  const shape = MISSION_BY_KEY.get(key);
  if (!shape) return { error: t("משימה לא תקינה") };

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      const empire = await applyPendingUpdates(empireId, tx);
      const now = new Date();
      const period = scope === "DAY" ? gameDay(now) : gameWeek(now);

      const board = await tx.missionBoard.findUnique({
        where: {
          empireId_scope_period: {
            empireId,
            scope: scope as PrismaMissionScope,
            period,
          },
        },
      });
      // No board means the player has not opened today's yet — there is nothing
      // to collect, and creating one here would hand them a board whose
      // baseline is *now*, i.e. one they could never have completed.
      if (!board) return { error: t("הלוח של היום עדיין לא נפתח.") };
      if (!board.missions.includes(key)) {
        return { error: t("המשימה הזו לא על הלוח שלך.") };
      }
      if (board.claimed.includes(key)) {
        return { error: t("כבר אספת את המשימה הזו.") };
      }

      const claimedKeys = await getClaimedKeys(tx, empireId);
      const stats = await gatherAchievementStats(tx, empireId, claimedKeys);
      if (!stats) return { error: t("אירעה שגיאה, נסה שוב") };

      const goal = missionGoal(shape, scope as MissionScope, empire.cities);
      const progress = missionProgress(
        shape,
        missionBaseline(stats),
        readBaseline(board.baseline)
      );
      if (goal <= 0 || progress < goal) {
        return { error: t("המשימה עדיין לא הושלמה.") };
      }

      // The append IS the claim: whichever concurrent call adds the key pays
      // out, and the other finds the key already there and pays nothing.
      const claimed = await tx.missionBoard.updateMany({
        where: { id: board.id, NOT: { claimed: { has: key } } },
        data: { claimed: { push: key } },
      });
      if (claimed.count === 0) {
        return { error: t("כבר אספת את המשימה הזו.") };
      }

      const paid = await payRewards(
        tx,
        empireId,
        // Priced at the empire's size *now*, matching the goal that was just
        // tested — a player who founded a city mid-day is measured and paid on
        // the same curve rather than one of each.
        buildMissionBoard(
          scope as MissionScope,
          period,
          0,
          [key],
          [],
          missionBaseline(stats),
          readBaseline(board.baseline),
          empire.cities
        ).missions[0]?.rewards ?? []
      );

      let contractDone = false;
      if (scope === "DAY") {
        contractDone = await creditGuildContract(tx, empireId, gameDay(now));
      }

      return {
        success: contractDone
          ? t('השלמת "{mission}" וקיבלת {spoils}. הברית השלימה את החוזה היומי!', {
              mission: t(shape.name, { goal: formatNumber(goal) }),
              spoils: describeRewards(t, paid),
            })
          : t('השלמת "{mission}" וקיבלת {spoils}.', {
              mission: t(shape.name, { goal: formatNumber(goal) }),
              spoils: describeRewards(t, paid),
            }),
        paid,
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("daily.claimMission", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ the guild contract ------------------------------ */

/**
 * Add one to the guild's contract, and stamp it complete if that was the
 * mission that finished it. Returns whether *this* call completed it.
 *
 * One statement, because the increment and the completion test cannot be two:
 * with a read between them, two members finishing at once would both see
 * `progress < goal` and neither would stamp, or both would. `SET progress =
 * progress + 1` reads the old value and `RETURNING` gives the new one, so
 * "did I cross the line" is `new >= goal AND new - 1 < goal` — exact, and
 * decided by Postgres' own row lock rather than by anything here.
 *
 * `COALESCE` on the stamp is what makes it once-only: an already-completed
 * contract keeps its original instant no matter how many later missions land.
 */
async function creditGuildContract(
  tx: Prisma.TransactionClient,
  empireId: string,
  day: number
): Promise<boolean> {
  const membership = await tx.guildMember.findUnique({
    where: { empireId },
    select: { guildId: true },
  });
  if (!membership) return false;

  // `NOW() AT TIME ZONE 'UTC'`, never a bare `NOW()`. Every DateTime column in
  // this schema is a `TIMESTAMP(3)` *without* a time zone holding UTC, because
  // that is what Prisma writes into one. A bare `NOW()` is a `timestamptz`, and
  // assigning it to such a column converts it through the database session's
  // own zone — so on any server not running in UTC this stamp lands hours away
  // from every other timestamp in the database. `completedAt` is not decoration:
  // it is compared against `GuildMember.createdAt` to decide who was in the
  // guild when the contract closed, and a stamp three hours in the future hands
  // the day's purse to everyone who joined after it.
  const rows = await tx.$queryRaw<{ progress: number; goal: number }[]>`
    UPDATE "GuildContract"
    SET progress = progress + 1,
        "completedAt" = COALESCE(
          "completedAt",
          CASE WHEN progress + 1 >= goal THEN (NOW() AT TIME ZONE 'UTC') ELSE NULL END
        ),
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "guildId" = ${membership.guildId} AND day = ${day}
    RETURNING progress::int AS progress, goal::int AS goal
  `;
  const row = rows[0];
  if (!row) return false;
  return row.progress >= row.goal && row.progress - 1 < row.goal;
}

/**
 * Take your share of a completed contract.
 *
 * The membership check is not decoration. Without it a player could join a
 * guild whose contract had already completed, collect, leave, and repeat down
 * the ladder of every guild that finished today — so the share is owed only to
 * someone who was *already in the guild when it completed*. `createdAt` on the
 * membership row is the join instant, and it is compared against the contract's
 * own `completedAt` rather than against now.
 */
export async function collectGuildContract(): Promise<ClaimState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      const empire = await applyPendingUpdates(empireId, tx);

      const membership = await tx.guildMember.findUnique({
        where: { empireId },
        select: { guildId: true, createdAt: true },
      });
      if (!membership) return { error: t("אינך חבר בברית.") };

      const contract = await tx.guildContract.findUnique({
        where: { guildId_day: { guildId: membership.guildId, day: gameDay(new Date()) } },
      });
      if (!contract || contract.completedAt === null) {
        return { error: t("החוזה של היום עדיין לא הושלם.") };
      }
      if (membership.createdAt > contract.completedAt) {
        return {
          error: t("הצטרפת לברית אחרי שהחוזה הושלם — החלק הזה כבר חולק."),
        };
      }
      if (contract.paid.includes(empireId)) {
        return { error: t("כבר לקחת את חלקך בחוזה של היום.") };
      }

      const definition = GUILD_CONTRACT_BY_KEY.get(contract.key);
      if (!definition) return { error: t("החוזה של היום כבר אינו בתוקף.") };

      // Same shape as a mission claim: the append is the receipt.
      const taken = await tx.guildContract.updateMany({
        where: {
          id: contract.id,
          completedAt: { not: null },
          NOT: { paid: { has: empireId } },
        },
        data: { paid: { push: empireId } },
      });
      if (taken.count === 0) {
        return { error: t("כבר לקחת את חלקך בחוזה של היום.") };
      }

      const paid = await payRewards(
        tx,
        empireId,
        guildContractReward(definition, empire.cities)
      );

      // The contract is a guild fixture the player took part in, so it feeds
      // the season pass the way the other cooperative acts do. Rated as one
      // mission rather than as a boss: the work that earned it was already
      // paid for when each of those missions was claimed.
      await awardSeasonPassXp(tx, empireId, "wheelSpin");

      return {
        success: t('"{contract}" הושלם. חלקך: {spoils}.', {
          contract: t(definition.name),
          spoils: describeRewards(t, paid),
        }),
        paid,
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("daily.collectGuildContract", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
