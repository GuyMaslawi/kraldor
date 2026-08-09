"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId, getSessionUserId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { formatNumber } from "@/lib/game/format";
import { notStaffOrBot } from "@/lib/bot";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  REFERRAL_GOAL_CITIES,
  REFERRAL_SEASON_CAP,
  joinerReward,
  mayNameReferrer,
  normalizeReferralCode,
  referralEarned,
  referralPath,
  referralPayable,
  referralStanding,
  referrerReward,
  type ReferralInvitee,
  type ReferralState,
} from "@/lib/game/referral";
import {
  assessReferral,
  ensureReferralCode,
  referrerPursesPaid,
  resolveReferralCode,
  reviewAfterRederive,
  writeReferralLink,
} from "@/server/referralGuard";
import { payRewards } from "@/server/rewardGrant";
import { appBaseUrl } from "@/server/mailer";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT, type T } from "@/i18n/server";

/**
 * הזמנת חבר — attaching a link, and collecting either half.
 *
 * All three actions are guarded the same way the rest of the daily loop is: the
 * write that records the claim is the write that decides whether it happens.
 * `referredById IS NULL` gates the attach; `referralPaidAt IS NULL` and
 * `referrerPaidAt IS NULL` gate the two payouts. Nothing here reads a value and
 * then acts on it.
 *
 * On top of that, both payouts re-derive the abuse signals for the pair before
 * they pay (see src/server/referralGuard.ts). They have to: the link is made on
 * the newcomer's first evening and collected days later, and everything worth
 * noticing about a farm — the second account being signed into from the first
 * one's browser, the two of them feeding each other through combat — happens in
 * between. A re-derivation can only ever *hold* a referral for an admin, never
 * kill it; see the note on that asymmetry in the guard.
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
  const userId = await getSessionUserId();
  if (userId === null) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: {
      name: true,
      cities: true,
      seasonId: true,
      referredById: true,
      referralPaidAt: true,
      referrerPaidAt: true,
      referralReview: true,
      referredBy: { select: { name: true } },
      // Everyone this player brought in. Bounded in practice by how many people
      // one person can recruit, and served by the index on referredById.
      referred: {
        select: {
          id: true,
          name: true,
          cities: true,
          referrerPaidAt: true,
          referralReview: true,
        },
        orderBy: { cities: "desc" },
      },
    },
  });
  if (!empire) return null;

  // Minted here rather than at registration: a code only has to exist by the
  // time its owner comes looking for their link, and this is that moment. It is
  // also why `/r/<code>` can never resolve a code nobody has fetched.
  const code = await ensureReferralCode(userId);

  const invitees: ReferralInvitee[] = empire.referred.map((row) => ({
    empireId: row.id,
    empireName: row.name,
    cities: row.cities,
    earned: referralEarned(row.cities),
    claimed: row.referrerPaidAt !== null,
    standing: referralStanding(row.referralReview),
  }));

  return {
    code,
    link: `${appBaseUrl()}${referralPath(code)}`,

    invitees,
    collectable: invitees.filter(
      (i) => i.earned && !i.claimed && i.standing === "ok"
    ).length,
    referrerReward: referrerReward(empire.cities),
    paidThisSeason: empire.referred.filter(
      (row) => row.referrerPaidAt !== null
    ).length,
    seasonCap: REFERRAL_SEASON_CAP,

    referrerName: empire.referredBy?.name ?? null,
    standing:
      empire.referredById === null ? "ok" : referralStanding(empire.referralReview),
    mayName: empire.referredById === null && mayNameReferrer(empire.cities),
    joinerClaimable:
      empire.referredById !== null &&
      empire.referralPaidAt === null &&
      referralPayable(empire.referralReview) &&
      referralEarned(empire.cities),
    joinerClaimed: empire.referralPaidAt !== null,
    joinerReward: joinerReward(empire.cities),
    cities: empire.cities,
    goalCities: REFERRAL_GOAL_CITIES,
  };
}

/* ------------------------------ name a referrer ------------------------------ */

const nameSchema = z.object({ name: z.string().trim().min(2).max(64) });

/**
 * Attach the empire that brought you in, from a code, a pasted link, or an
 * empire name.
 *
 * The link (`/r/<code>`) attaches itself at registration and is the path almost
 * everybody takes. This is the manual one, kept for the friend who was told
 * about the game in person before anybody thought to send a URL, and for the
 * player who clicked a link while already signed in.
 *
 * All three inputs land here because they are the same act. A code is tried
 * first — it is unambiguous and survives a rename — and an empire name is the
 * fallback, which is what the field used to take and what the older players
 * still know.
 *
 * Whether the link is *allowed* is not decided in this function: `assessReferral`
 * owns that, and it owns it for the registration path too, so the two entrances
 * cannot drift apart. What is decided here is the shape of the refusal — a hard
 * signal is refused out loud, because somebody typed something and deserves an
 * answer, while a soft one attaches quietly and waits for review.
 */
export async function nameReferrer(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: t("קוד או שם אימפריה לא תקינים") };
  const { name } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    // This field takes an invite code, so it is a lookup oracle in a way the
    // empire-name field never was: names are public and enumerable already,
    // codes are not. Sixty bits cannot be brute-forced through a throttled
    // form in any case — the ceiling is what makes that statement true rather
    // than merely likely, and it costs an honest player nothing, since they get
    // exactly one successful attach either way.
    const ip = await clientIp();
    if (!(await rateLimit(`referral-name:${empireId}`, 12, 60 * 60 * 1000))) {
      return { error: t("יותר מדי נסיונות. נסה שוב מאוחר יותר.") };
    }
    if (!(await rateLimit(`referral-name-ip:${ip}`, 40, 60 * 60 * 1000))) {
      return { error: t("יותר מדי נסיונות. נסה שוב מאוחר יותר.") };
    }

    const mine = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { cities: true, referredById: true },
    });
    if (!mine) return { error: t("אירעה שגיאה, נסה שוב") };
    if (mine.referredById !== null) {
      return { error: t("כבר ציינת מי הזמין אותך.") };
    }
    if (!mayNameReferrer(mine.cities)) {
      return {
        error: t("אפשר לציין מזמין רק בתחילת הדרך, עד {max} ערים.", { max: 2 }),
      };
    }

    // A code first — unambiguous, and it survives the referrer renaming their
    // empire. Then the name, which is what this field always took.
    const code = normalizeReferralCode(name);
    const byCode = code ? await resolveReferralCode(code) : null;
    const referrer = byCode
      ? await prisma.empire.findFirst({
          // Staff and garrison bots are not players and cannot recruit — the
          // same exclusion every ranked and paying surface in the game applies.
          where: { id: byCode.empireId, ...notStaffOrBot },
          select: { id: true, name: true },
        })
      : await prisma.empire.findFirst({
          where: { name, ...notStaffOrBot },
          select: { id: true, name: true },
        });
    if (!referrer) return { error: t("לא נמצאה אימפריה עם הקוד או השם הזה.") };

    const verdict = await assessReferral(empireId, referrer.id, "attach");
    if (verdict.hard.length > 0) {
      // Deliberately one message for every hard signal rather than a diagnosis.
      // Naming which check fired turns this field into a tester for the checks,
      // and the honest player who trips one is in no position to act on the
      // detail anyway.
      return { error: t("אי אפשר לקשר את שני החשבונות האלה.") };
    }

    const attached = await writeReferralLink(
      prisma,
      empireId,
      referrer.id,
      "name",
      verdict
    );
    if (!attached) return { error: t("כבר ציינת מי הזמין אותך.") };

    revalidatePath("/game", "layout");
    return {
      success: t(
        "{referrer} רשום כמי שהזמין אותך. שניכם תקבלו פרס כשתגיע ל-{goal} ערים.",
        { referrer: referrer.name, goal: REFERRAL_GOAL_CITIES }
      ),
    };
  } catch (err) {
    await logError("referral.nameReferrer", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ the review gate ------------------------------ */

/**
 * Re-derive the pair's signals and persist the verdict, returning whether the
 * purse may be paid.
 *
 * Shared by both halves so they can never disagree — a referral held for the
 * newcomer but paid for the referrer would be the worst of both worlds.
 *
 * Runs *outside* the payout transaction on purpose. It issues half a dozen
 * reads across four tables, and holding a `FOR UPDATE` lock on the empire while
 * they run would serialise every collector behind the slowest one for no
 * benefit: the decision it produces is advisory, and the thing that actually
 * prevents a double payout is the `IS NULL` filter on the receipt inside the
 * transaction.
 */
async function settleReview(
  joinerEmpireId: string,
  referrerEmpireId: string,
  referredAt: Date | null
): Promise<boolean> {
  const current = await prisma.empire.findUnique({
    where: { id: joinerEmpireId },
    select: { referralReview: true },
  });
  if (!current) return false;

  const verdict = await assessReferral(
    joinerEmpireId,
    referrerEmpireId,
    "claim",
    referredAt
  );
  const next = reviewAfterRederive(current.referralReview, verdict);

  // Compare-and-set on the state this decision was computed from. An admin may
  // be deciding the very same case in the next tab, and their verdict is final
  // — a re-derivation that landed a moment later must not quietly overwrite it
  // with `HELD`. If the row moved, this call simply does not persist; the payout
  // below reads the review again under the lock and honours whatever won.
  await prisma.empire.updateMany({
    where: { id: joinerEmpireId, referralReview: current.referralReview },
    data: { referralReview: next, referralFlags: verdict.flags },
  });
  return referralPayable(next);
}

/** The one line both halves show when the review is holding a purse. */
function heldNotice(t: T): string {
  // No detail, for the same reason the attach refusal carries none. What the
  // player needs to know is that it is not lost and not their move.
  return t("ההזמנה הזו ממתינה לבדיקה של הצוות. הפרס יישמר עד שתאושר.");
}

/* ------------------------------ the newcomer's half ------------------------------ */

/** Collect your own half, once you have reached the goal. */
export async function collectJoinerReward(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const mine = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { referredById: true, referredAt: true, referralPaidAt: true },
    });
    if (!mine) return { error: t("אירעה שגיאה, נסה שוב") };
    if (mine.referredById === null) {
      return { error: t("לא ציינת מי הזמין אותך.") };
    }
    if (mine.referralPaidAt !== null) {
      return { error: t("כבר אספת את הפרס הזה.") };
    }
    if (!(await settleReview(empireId, mine.referredById, mine.referredAt))) {
      return { error: heldNotice(t) };
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
      const empire = await applyPendingUpdates(empireId, tx);

      if (!referralEarned(empire.cities)) {
        return {
          error: t("הפרס נפתח ב-{goal} ערים.", { goal: REFERRAL_GOAL_CITIES }),
        };
      }
      // Re-read under the lock: the review could have been rejected by an admin
      // between the check above and here, and the whole point of the column is
      // that nothing pays past it.
      const gate = await tx.empire.findUniqueOrThrow({
        where: { id: empireId },
        select: { referralReview: true, referralPaidAt: true },
      });
      if (gate.referralPaidAt !== null) return { error: t("כבר אספת את הפרס הזה.") };
      if (!referralPayable(gate.referralReview)) return { error: heldNotice(t) };

      const claimed = await tx.empire.updateMany({
        where: { id: empireId, referralPaidAt: null },
        data: { referralPaidAt: new Date() },
      });
      if (claimed.count === 0) return { error: t("כבר אספת את הפרס הזה.") };

      const paid = await payRewards(tx, empireId, joinerReward(empire.cities));
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

    const invitee = await prisma.empire.findUnique({
      where: { id: inviteeId },
      select: {
        name: true,
        cities: true,
        referredById: true,
        referredAt: true,
        referrerPaidAt: true,
      },
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
    if (!(await settleReview(inviteeId, empireId, invitee.referredAt))) {
      return { error: heldNotice(t) };
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
      const mine = await applyPendingUpdates(empireId, tx);

      // The ceiling every other defence falls back on. Counted inside the lock
      // so two invitees collected in the same instant cannot both see the last
      // free slot — without that, the cap would be advisory rather than a cap.
      const alreadyPaid = await referrerPursesPaid(tx, empireId, mine.seasonId);
      if (alreadyPaid >= REFERRAL_SEASON_CAP) {
        return {
          error: t("הגעת לתקרת ההזמנות לעונה הזו ({cap}).", {
            cap: REFERRAL_SEASON_CAP,
          }),
        };
      }

      const gate = await tx.empire.findUniqueOrThrow({
        where: { id: inviteeId },
        select: { referralReview: true, referrerPaidAt: true },
      });
      if (gate.referrerPaidAt !== null) {
        return { error: t("כבר אספת את הפרס על {name}.", { name: invitee.name }) };
      }
      if (!referralPayable(gate.referralReview)) return { error: heldNotice(t) };

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
