import { requireEmpire } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { getShopDiscountPct } from "@/lib/game/diamondEffects";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { WeaponsTabs, type WeaponsTabData } from "@/components/game/WeaponsTabs";
import {
  INITIAL_WEAPON_UNLOCKED_TIER,
  MAX_WEAPON_TIER,
  WEAPON_CATEGORIES,
  WEAPON_CATEGORY_META,
  weaponGateStatus,
  weaponsOfCategory,
  weaponsPower,
  weaponTierUnlockCost,
} from "@/lib/game/weapons";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("נשקים | קראלדור") };
}

// i18n-keys-start: dictionary keys, read through t(TAB_POWER_LABELS[category])
const TAB_POWER_LABELS = {
  ATTACK: "כוח התקפה כולל מנשקים",
  DEFENSE: "כוח הגנה כולל מנשקים",
  SPY: "כוח ריגול כולל מנשקים",
} as const;
// i18n-keys-end

const TAB_PARAM_TO_CATEGORY: Record<string, "ATTACK" | "DEFENSE" | "SPY"> = {
  attack: "ATTACK",
  defense: "DEFENSE",
  spy: "SPY",
};

export default async function WeaponsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const empire = await requireEmpire();
  const t = await getT();
  const { tab } = await searchParams;
  // `Object.hasOwn` guard, not a bare index: TAB_PARAM_TO_CATEGORY is a plain
  // object literal, so `?tab=constructor` (or toString / valueOf / hasOwnProperty)
  // resolved off Object.prototype and yielded a *function*. That value was then
  // handed to <WeaponsTabs>, a client component, and RSC serialisation threw
  // "Functions cannot be passed directly to Client Components" — a 500 any
  // visitor could trigger from the query string.
  const initialCategory =
    typeof tab === "string" && Object.hasOwn(TAB_PARAM_TO_CATEGORY, tab)
      ? TAB_PARAM_TO_CATEGORY[tab]
      : undefined;

  const ownedByKey = new Map(
    empire.weapons.map((w) => [w.weaponKey, w.quantity])
  );

  // Unlocking is cross-cutting — a single shared tier across all categories.
  const sharedTier = empire.weaponUnlocks.reduce(
    (max, u) => Math.max(max, u.unlockedTier),
    INITIAL_WEAPON_UNLOCKED_TIER
  );

  const tabs: WeaponsTabData[] = WEAPON_CATEGORIES.map((category) => {
    const meta = WEAPON_CATEGORY_META[category];
    return {
      category,
      label: t(meta.label),
      icon: meta.icon,
      totalPowerLabel: t(TAB_POWER_LABELS[category]),
      totalPower: weaponsPower(empire.weapons, category),
      unlockedTier: sharedTier,
      maxTier: MAX_WEAPON_TIER,
      unlockCost: weaponTierUnlockCost(sharedTier),
      weapons: weaponsOfCategory(category).map((weapon) => ({
        weapon,
        owned: ownedByKey.get(weapon.key) ?? 0,
      })),
    };
  });

  // Active shop-discount spell — reflected on every weapon price below.
  const discountPct = await getShopDiscountPct(empire.id);

  // Requirements for the next (shared) tier: cities + hero level.
  const heroLevel = empire.hero?.level ?? 0;
  const nextTier = Math.min(sharedTier + 1, MAX_WEAPON_TIER);
  const gate = weaponGateStatus(nextTier, empire.cities, heroLevel);

  const available = {
    gold: Math.floor(empire.gold),
    wood: Math.floor(empire.wood),
    iron: Math.floor(empire.iron),
    stone: Math.floor(empire.stone),
  };

  return (
    <div className="space-y-6">
      <SectionHeading title={t("חנות נשקים")} ornament="🛍️" />

      <WeaponsTabs
        tabs={tabs}
        available={available}
        initialCategory={initialCategory}
        gate={gate}
        cities={empire.cities}
        heroLevel={heroLevel}
        discountPct={discountPct}
      />
    </div>
  );
}
