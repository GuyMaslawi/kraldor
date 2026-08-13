import Link from "next/link";

import { requireEmpire } from "@/lib/auth";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getT } from "@/i18n/server";

/**
 * Where Grow returns a buyer who backed out of the payment page.
 *
 * Deliberately does nothing to the purchase row. An abandoned checkout stays
 * PENDING rather than being marked FAILED here, because "the buyer came back to
 * this URL" is not the same event as "the payment did not happen" — a buyer can
 * pay in one tab and hit cancel in another, and a row failed from this page
 * could no longer be settled by the callback that follows. Abandoned rows age
 * out visibly in /admin/purchases instead, which is the honest record.
 */

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t("הרכישה בוטלה | KRALDOR"),
    robots: { index: false, follow: false },
  };
}

export default async function PurchaseCancelPage() {
  const t = await getT();
  await requireEmpire();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("רכישת יהלומים")}
        ornament={<Icon name="diamond" size={22} className="text-cyan-300" />}
      />

      <div className="panel-inset mx-auto max-w-md space-y-4 rounded-2xl p-6 text-center">
        <span aria-hidden className="block text-6xl">
          🚪
        </span>
        <h2 className="text-xl font-black text-zinc-200">{t("הרכישה בוטלה")}</h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          {t("לא בוצע חיוב. אפשר לחזור ולרכוש בכל רגע — החבילות מחכות.")}
        </p>

        <div className="grid gap-2 pt-2">
          <Link href="/game/diamonds/buy" className="btn btn-gold w-full">
            {t("חזרה לחבילות")}
          </Link>
          <Link href="/game/diamonds" className="btn btn-ghost w-full text-sm">
            {t("לחנות היהלומים")}
          </Link>
        </div>
      </div>
    </div>
  );
}
