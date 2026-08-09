"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAdmin, requireAdmin } from "@/lib/admin";
import type { AdminActionState } from "./admin";

/**
 * /admin/referrals — clearing or killing a flagged referral.
 *
 * The only place in the game where a human overrides the referral guard, and
 * deliberately the *only* thing an admin can do here: approve, or reject. There
 * is no "pay it now" button and no way to edit the purse. A cleared referral
 * goes back to being an ordinary one and the players collect it themselves from
 * their own screens, which keeps a single payout path — the guarded
 * `IS NULL` claim in src/server/actions/referral.ts — rather than a second one
 * that only admins can reach and only admins can get wrong.
 *
 * Both verdicts are final as far as the automatic checks are concerned: a later
 * re-derivation never overturns them (see `reviewAfterRederive`). Only another
 * admin decision moves a case again, which is why both directions are offered on
 * every case, decided ones included.
 */

const decisionSchema = z.object({
  empireId: z.string().min(1).max(64),
  verdict: z.enum(["APPROVED", "REJECTED"]),
});

/**
 * Approve or reject one referral, keyed on the **newcomer's** empire — the row
 * both receipts and the review state live on.
 */
export async function decideReferral(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const parsed = decisionSchema.safeParse({
      empireId: formData.get("empireId"),
      verdict: formData.get("verdict"),
    });
    if (!parsed.success) return { error: "בקשה לא תקינה" };
    const { empireId, verdict } = parsed.data;

    const target = await prisma.empire.findUnique({
      where: { id: empireId },
      select: {
        name: true,
        referredById: true,
        referrerPaidAt: true,
        referralPaidAt: true,
        referredBy: { select: { name: true } },
      },
    });
    if (!target || !target.referredById) {
      return { error: "לא נמצאה הזמנה עבור האימפריה הזו" };
    }

    await prisma.empire.update({
      where: { id: empireId },
      data: {
        referralReview: verdict,
        referralReviewedAt: new Date(),
        referralReviewedBy: admin.id,
      },
    });

    await logAdmin(admin, {
      action: verdict === "APPROVED" ? "referral.approve" : "referral.reject",
      targetType: "empire",
      targetId: empireId,
      summary: `${verdict === "APPROVED" ? "אושרה" : "נדחתה"} הזמנה: ${
        target.referredBy?.name ?? "?"
      } → ${target.name}`,
      details: {
        joinerPaid: target.referralPaidAt !== null,
        referrerPaid: target.referrerPaidAt !== null,
      },
    });

    // Both players' referral screens read this, and the badge in the admin nav
    // counts it.
    revalidatePath("/admin/referrals");
    revalidatePath("/game", "layout");

    // Said out loud rather than hidden, because it is the one thing a reject
    // cannot undo: a purse already collected stays collected. Clawing it back
    // would mean debiting an empire that has since spent it, which is how a
    // player ends up with negative diamonds.
    const alreadyPaid = target.referralPaidAt !== null || target.referrerPaidAt !== null;
    if (verdict === "REJECTED" && alreadyPaid) {
      return {
        success:
          "ההזמנה נדחתה. שים לב: חלק מהפרס כבר נאסף ולא נגבה בחזרה — אם צריך, תקן ידנית בעורך השחקן.",
      };
    }
    return {
      success:
        verdict === "APPROVED"
          ? "ההזמנה אושרה. שני הצדדים יכולים לאסוף מהמסך שלהם."
          : "ההזמנה נדחתה. שום צד לא יקבל פרס עליה.",
    };
  } catch (e) {
    console.error("[admin referral]", e);
    return { error: "אירעה שגיאה, נסה שוב" };
  }
}
