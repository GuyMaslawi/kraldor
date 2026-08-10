import { requireEmpire } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { bankInterestRate } from "@/lib/game/constants";
import { monumentBonuses, monumentMultiplier } from "@/lib/game/monuments";
import { DiamondShop } from "@/components/game/DiamondShop";
import { DiamondsHeader } from "@/components/game/DiamondsHeader";
import { VipCard } from "@/components/game/VipCard";
import { getT } from "@/i18n/server";
import {
  BOOSTABLE_RESOURCES,
  RESOURCE_BOOST_KIND,
  SHIELDS,
  TURN_PACKAGES,
  type ShieldKey,
} from "@/lib/game/diamondShop";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("יהלומים | KRALDOR") };
}

export default async function DiamondsPage() {
  const t = await getT();
  const empire = await requireEmpire();
  const now = new Date();
  const diamonds = Math.floor(empire.diamonds);

  // Diamond effects for this empire (timed boosts + cooldowns).
  const effects = await prisma.diamondEffect.findMany({
    where: { empireId: empire.id },
  });
  const byKind = new Map(effects.map((e) => [e.kind, e]));

  const boosts = BOOSTABLE_RESOURCES.map((resource) => {
    const e = byKind.get(RESOURCE_BOOST_KIND[resource]);
    const active = e?.activeUntil != null && e.activeUntil > now;
    return {
      resource,
      pct: active ? e!.magnitude : 0,
      activeUntil: active ? e!.activeUntil!.toISOString() : null,
    };
  });

  // Per-package turn cooldowns: each package recharges independently.
  const turnReadyAt = TURN_PACKAGES.map((pkg) => {
    const e = byKind.get(pkg.cooldownKind);
    return e?.readyAt != null && e.readyAt > now ? e.readyAt.toISOString() : null;
  });

  const discountEffect = byKind.get("SHOP_DISCOUNT");
  const discountActiveUntil =
    discountEffect?.activeUntil != null && discountEffect.activeUntil > now
      ? discountEffect.activeUntil.toISOString()
      : null;

  // Raid shields — one DiamondEffect row each, carrying both the protection
  // window (activeUntil) and the renewal cooldown that follows it (readyAt).
  const shields = Object.fromEntries(
    SHIELDS.map((s) => {
      const e = byKind.get(s.kind);
      const active = e?.activeUntil != null && e.activeUntil > now;
      const cooling = !active && e?.readyAt != null && e.readyAt > now;
      return [
        s.key,
        {
          activeUntil: active ? e!.activeUntil!.toISOString() : null,
          readyAt: cooling ? e!.readyAt!.toISOString() : null,
        },
      ];
    })
  ) as Record<ShieldKey, { activeUntil: string | null; readyAt: string | null }>;

  const hero = empire.hero;
  const allocatedPoints =
    (hero?.attackPoints ?? 0) + (hero?.defensePoints ?? 0) + (hero?.resourcePoints ?? 0);
  const activeSeason = await prisma.gameSeason.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const pointsResetUsed = hero?.pointsResetSeasonId === (activeSeason?.id ?? "none");

  const bankBalance = empire.bankAccount?.goldBalance ?? 0;
  const interestLevel =
    empire.upgrades.find((u) => u.type === "BANK_DAILY_INTEREST")?.level ?? 1;
  // Same product `castBankInterest` pays — בית הגנזים included, or the card
  // quotes one number and the spell credits a bigger one.
  const interestPreview = Math.floor(
    bankBalance *
      bankInterestRate(interestLevel) *
      monumentMultiplier(monumentBonuses(empire.monuments).interest)
  );
  const bankEffect = byKind.get("BANK_INTEREST");
  const bankReadyAt =
    bankEffect?.readyAt != null && bankEffect.readyAt > now
      ? bankEffect.readyAt.toISOString()
      : null;

  const downgradeEffect = byKind.get("CITY_DOWNGRADE");
  const cityDowngradeReadyAt =
    downgradeEffect?.readyAt != null && downgradeEffect.readyAt > now
      ? downgradeEffect.readyAt.toISOString()
      : null;

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("יהלומים")}
        ornament={<Icon name="diamond" size={22} className="text-cyan-300" />}
      />

      <DiamondsHeader
        diamonds={diamonds}
        active="spend"
        note={t("הוצא יהלומים על האצות ייצור, מגני תקיפה, חבילות תורות וקסמים — כל רכישה משפיעה מיידית על האימפריה.")}
      />

      {/* Above the shop grid on purpose: it is the one permanent purchase on
          the page, and it changes how every other screen is operated rather
          than what it produces. One row, though — the pitch lives in the dialog
          it opens, not on this screen. */}
      <VipCard vipSince={empire.vipSince?.toISOString() ?? null} />

      <DiamondShop
        diamonds={diamonds}
        boosts={boosts}
        turnReadyAt={turnReadyAt}
        discountActiveUntil={discountActiveUntil}
        allocatedPoints={allocatedPoints}
        pointsResetUsed={pointsResetUsed}
        interestPreview={interestPreview}
        bankReadyAt={bankReadyAt}
        cities={empire.cities}
        cityDowngradeReadyAt={cityDowngradeReadyAt}
        shields={shields}
      />
    </div>
  );
}
