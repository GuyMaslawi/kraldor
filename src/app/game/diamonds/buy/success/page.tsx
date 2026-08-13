import Link from "next/link";

import { getSessionUserId, requireEmpire } from "@/lib/auth";
import { Icon } from "@/components/ui/Icon";
import { ReceiptButton } from "@/components/ui/ReceiptButton";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatNumber } from "@/lib/game/format";
import { settleOrderReturn, type OrderReturnStatus } from "@/server/orderSettle";
import { getT } from "@/i18n/server";

/**
 * Where the gateway returns the buyer after a successful payment.
 *
 * The page settles as a *convenience*, not as the mechanism: it asks the gateway
 * what the buyer's newest open order is worth and credits it, so the diamonds
 * are already in the balance by the time this paints. If anything about that is
 * slow, down, or merely out of order, the gateway's callback settles the same
 * purchase moments later through the same guard — which is why nothing here
 * treats "not confirmed yet" as a failure.
 *
 * Nothing in the URL is read. The return carries no field worth trusting, so the
 * order is found by session instead. See `@/server/orderSettle`.
 */

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t("התשלום התקבל | KRALDOR"),
    // A payment confirmation has no business in a search index, and the URL is
    // reachable by anyone who guesses it (it just shows them nothing).
    robots: { index: false, follow: false },
  };
}

// Settlement is a write. Never prerender, never cache.
export const dynamic = "force-dynamic";

// i18n-keys-start: dictionary keys, drawn through t(view.title) / t(view.body)
const VIEWS: Record<
  OrderReturnStatus,
  { emoji: string; title: string; tone: string; body: string }
> = {
  // Nothing here promises a receipt *arrived*. The document is issued by the
  // gateway's invoicing company moments after the charge, and telling a buyer to
  // go and look in an inbox that has nothing in it yet is how a working payment
  // reads as a broken one. The button below fetches the real thing when it
  // exists, and says so plainly when it does not.
  credited: {
    emoji: "✅",
    title: "התשלום בוצע!",
    tone: "text-emerald-300",
    body: "היהלומים נזקפו לחשבונך. הקבלה נשלחת לכתובת האימייל שלך ואפשר גם להציג אותה כאן.",
  },
  already: {
    emoji: "✅",
    title: "התשלום בוצע!",
    tone: "text-emerald-300",
    body: "היהלומים כבר נזקפו לחשבונך. הקבלה נשלחת לכתובת האימייל שלך ואפשר גם להציג אותה כאן.",
  },
  pending: {
    emoji: "⏳",
    title: "התשלום בבדיקה",
    tone: "text-amber-300",
    body: "קיבלנו את התשלום והוא ממתין לאישור סופי מחברת הסליקה. היהלומים ייזקפו אוטומטית תוך דקות ספורות — אין צורך לשלם שוב.",
  },
  none: {
    emoji: "🔎",
    title: "לא נמצאה רכישה פתוחה",
    tone: "text-zinc-300",
    body: "לא מצאנו רכישה שממתינה לאישור בחשבון הזה. אם חויבת ולא קיבלת יהלומים, פנה אלינו ונטפל בזה מיד.",
  },
};
// i18n-keys-end

export default async function PurchaseSuccessPage() {
  const t = await getT();
  const empire = await requireEmpire();
  const userId = await getSessionUserId();
  const result = userId
    ? await settleOrderReturn(userId)
    : ({ status: "none", diamonds: 0, purchaseId: null } as const);

  const view = VIEWS[result.status];

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("רכישת יהלומים")}
        ornament={<Icon name="diamond" size={22} className="text-cyan-300" />}
      />

      <div className="panel-inset mx-auto max-w-md space-y-4 rounded-2xl p-6 text-center">
        <span aria-hidden className="block text-6xl">
          {view.emoji}
        </span>
        <h2 className={`text-xl font-black ${view.tone}`}>{t(view.title)}</h2>

        {result.diamonds > 0 && (
          <p className="flex items-center justify-center gap-2 text-lg">
            <Icon name="diamond" size={22} className="text-cyan-300" />
            <span className="nums font-black text-sky-200" dir="ltr">
              +{formatNumber(result.diamonds)}
            </span>
          </p>
        )}

        <p className="text-sm leading-relaxed text-zinc-400">{t(view.body)}</p>

        {/* Only once the money is booked: a PENDING row has no capture to look
            a document up by, so the button would only ever say "not yet". */}
        {result.purchaseId &&
          (result.status === "credited" || result.status === "already") && (
            <ReceiptButton purchaseId={result.purchaseId} />
          )}

        <p className="text-sm text-zinc-500">
          {t("יתרה נוכחית:")}{" "}
          <span className="nums font-black text-sky-300" dir="ltr">
            {formatNumber(Math.floor(empire.diamonds))}
          </span>{" "}
          {t("יהלומים")}
        </p>

        <div className="grid gap-2 pt-2">
          <Link href="/game/diamonds" className="btn btn-gold w-full">
            {t("לחנות היהלומים")}
          </Link>
          <Link href="/game/diamonds/buy" className="btn btn-ghost w-full text-sm">
            {t("חזרה לרכישה")}
          </Link>
        </div>
      </div>
    </div>
  );
}
