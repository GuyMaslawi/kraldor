"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/admin";
import { rateLimit } from "@/lib/rateLimit";
import { getPaymentProvider, type PaymentDocument } from "@/server/payments";
import { getT } from "@/i18n/server";

/**
 * Fetching the tax document a payment produced.
 *
 * A gateway does not hand us the receipt at settlement time — its invoicing
 * company generates it asynchronously and the gateway reports it afterwards,
 * behind a **signed, expiring link**. So nothing is stored: the document is
 * looked up when a buyer (or an admin) asks for it, and the link they get is
 * fresh.
 *
 * That makes this a network call triggered by a click, which is why it is a
 * server action rather than part of any page's render. A receipt that has not
 * been issued yet must never be the reason a purchase page hangs.
 *
 * **Grow does not implement the lookup.** `fetchDocuments` is optional on the
 * provider seam and `GrowProvider` leaves it out, so every call here currently
 * answers `none` — "no document issued yet" — rather than a link. That is the
 * honest answer while Grow's invoicing reporting is unverified, and it is a
 * `none` rather than an `error` on purpose: nothing is broken, there is simply
 * nothing to fetch. Wiring Grow's invoice API turns the button on with no change
 * on this side.
 */

export type ReceiptResult =
  /** Documents exist. Possibly several — a sale plus a later credit note. */
  | { status: "ok"; documents: PaymentDocument[] }
  /** The lookup worked and the invoicing company has issued nothing (yet). */
  | { status: "none" }
  /** Buyer-facing message; the operator-facing detail never reaches here. */
  | { status: "error"; message: string };

/**
 * The documents issued for one purchase.
 *
 * Who may ask: the buyer, for their own purchase, or any admin. The row is
 * resolved and *then* checked, before the gateway is touched — same reasoning as
 * `settleOrder`: probing a stranger's purchase against the gateway would turn this
 * into an oracle for whether someone else's payment settled, and the answer
 * would be true even though the caller is told nothing.
 */
export async function getPurchaseReceipt(purchaseId: string): Promise<ReceiptResult> {
  const t = await getT();
  const user = await getSessionUser();
  if (!user) return { status: "error", message: t("יש להתחבר") };

  // Every call is a round trip to the gateway, so it is throttled per user rather
  // than per purchase: a loop over one row and a loop over a hundred cost the
  // gateway the same, and only the first is what a limiter keyed by row would
  // catch.
  if (!(await rateLimit(`receipt:${user.id}`, 30, 5 * 60 * 1000))) {
    return { status: "error", message: t("יותר מדי בקשות. נסה שוב בעוד כמה דקות.") };
  }

  if (!purchaseId) return { status: "error", message: t("לא נמצאה רכישה") };

  const purchase = await prisma.diamondPurchase.findUnique({
    where: { id: purchaseId },
    select: { userId: true, status: true, provider: true, captureRef: true, paidAt: true },
  });
  if (!purchase) return { status: "error", message: t("לא נמצאה רכישה") };

  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && purchase.userId !== user.id) {
    // Deliberately the same answer as a purchase that does not exist.
    return { status: "error", message: t("לא נמצאה רכישה") };
  }

  // A document is issued against money that actually moved. Asking about a
  // PENDING or FAILED row is not an error worth explaining — there is simply
  // nothing to find, and saying so is the honest answer.
  if (purchase.status !== "PAID" && purchase.status !== "REFUNDED") return { status: "none" };
  if (!purchase.captureRef) return { status: "none" };

  const provider = getPaymentProvider();
  // Scoped to the gateway that took the money: credentials for the *current*
  // provider cannot look up a transaction booked by a previous one, and asking
  // would produce a confusing error instead of an empty answer.
  if (provider.kind !== "order" || provider.name !== purchase.provider) {
    return { status: "none" };
  }
  if (!provider.fetchDocuments) return { status: "none" };

  const result = await provider.fetchDocuments({
    captureId: purchase.captureRef,
    paidAt: purchase.paidAt,
  });
  if (!result.ok) {
    // The gateway's own wording is English and operational — it stays on the
    // server side of this boundary, exactly as it does in `startDiamondCheckout`.
    return {
      status: "error",
      message: t("לא הצלחנו לשלוף את המסמך כרגע. נסה שוב מאוחר יותר."),
    };
  }

  return result.documents.length > 0
    ? { status: "ok", documents: result.documents }
    : { status: "none" };
}
