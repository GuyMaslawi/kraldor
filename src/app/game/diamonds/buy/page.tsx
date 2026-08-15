import { requireEmpire } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { getTunables } from "@/lib/game/config";
import { clampDiscountPct } from "@/lib/game/diamondStore";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { getCheckoutConfig } from "@/server/payments";
import { DiamondStore } from "@/components/game/DiamondStore";
import { DiamondsHeader } from "@/components/game/DiamondsHeader";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("רכישת יהלומים | KRALDOR") };
}

export default async function BuyDiamondsPage() {
  const t = await getT();
  const empire = await requireEmpire();
  const diamonds = Math.floor(empire.diamonds);
  const { diamondStore } = await getTunables();
  const discountPct = clampDiscountPct(diamondStore.purchaseDiscountPct);

  const checkout = getCheckoutConfig();
  // Before go-live only admins may actually pay, so only they get a working
  // checkout. Everyone else gets the store chained shut — the packages stay on
  // display, but the seal says so up front instead of letting a click travel all
  // the way to a "coming soon" modal.
  const admin = await isAdmin();
  const canPay = checkout.live || admin;
  // …which is exactly why an admin needs to be told *why* it is shut: their own
  // checkout works, so nothing on this screen would otherwise reveal that every
  // player is looking at a locked store.
  const blockers = admin && !checkout.live ? checkout.blockers : [];

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("רכישת יהלומים")}
        ornament={<Icon name="diamond" size={22} className="text-cyan-300" />}
      />

      <DiamondsHeader
        diamonds={diamonds}
        active="buy"
        note={t(
          "יהלומים פותחים האצות ייצור, קסמי חנות, חבילות תורות ועוד. ככל שהחבילה גדולה יותר — כך מקבלים יותר יהלומים לכל שקל."
        )}
      />

      {blockers.length > 0 && (
        <div className="panel-inset rounded-xl border-amber-500/40 p-4 text-sm">
          <p className="font-bold text-amber-300">
            {t("🔒 החנות סגורה לשחקנים (אתה רואה אותה כאדמין)")}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            {blockers.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span aria-hidden className="mt-[0.4rem] size-1.5 shrink-0 rounded-full bg-amber-400/70" />
                <span dir="auto">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DiamondStore
        discountPct={discountPct}
        purchasesLive={checkout.live}
        locked={!canPay}
        testMode={checkout.testMode}
        checkoutKind={checkout.kind}
      />
    </div>
  );
}
