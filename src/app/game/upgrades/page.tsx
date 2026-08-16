import { requireEmpire } from "@/lib/auth";
import { getTunables } from "@/lib/game/config";
import {
  EMPIRE_UPGRADE_META,
  EMPIRE_UPGRADE_TYPES,
  empireUpgradeCostFor,
  empireUpgradeMaxLevel,
  cityHeroLevelRequired,
  MAX_CITIES,
  cityCost,
} from "@/lib/game/constants";
import { UpgradeCard } from "@/components/game/UpgradeCard";
import { CityFoundCard } from "@/components/game/CityFoundCard";
import { CitySkyline } from "@/components/game/CitySkyline";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card, CardTitle } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { formatNumber } from "@/lib/game/format";
import { guildCityStake } from "@/server/guildCity";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("שדרוגים | קראלדור") };
}

export default async function UpgradesPage() {
  const empire = await requireEmpire();
  const t = await getT();
  // The citizen-intake effect is admin-tunable, so the card must print the live
  // rate rather than the shipped default.
  const tunables = await getTunables();

  const available = {
    gold: Math.floor(empire.gold),
    wood: Math.floor(empire.wood),
    iron: Math.floor(empire.iron),
    stone: Math.floor(empire.stone),
  };

  const cities = empire.cities;
  const citizens = empire.citizens;
  // A guild holds one city, so עליית עיר is also a resignation from it — and
  // for a leader, the end of the guild. See server/guildCity.ts.
  const guildStake = await guildCityStake(empire.id);

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("שדרוגים")}
        ornament={<Icon name="upgrades" size={22} className="text-crimson" />}
      />

      {/* -------- cities (עליית עיר) -------- */}
      <section className="space-y-4">
        <p className="panel-inset rounded-xl p-4 text-center text-sm text-zinc-400">
          {t("כל עלייה בעיר מכפילה את תפוקת המכרות (×מספר העיר) ופותחת עוד רמות לשדרוג קבלת האזרחים — עד")}{" "}
          <span className="font-bold text-gold-bright nums" dir="ltr">
            ×{MAX_CITIES}
          </span>{" "}
          {t("תפוקה ברמת עיר {max}. אין תקרה לכמות האזרחים שאפשר לצבור.", {
            max: MAX_CITIES,
          })}
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* overview */}
          <Card variant="gold">
            <CardTitle>
              <Icon name="base" size={20} className="text-crimson-bright" />
              {t("הממלכה שלך")}
            </CardTitle>

            <div className="mb-4">
              <CitySkyline cities={cities} maxCities={MAX_CITIES} />
            </div>

            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                <dt className="text-zinc-400">{t("ערים")}</dt>
                <dd className="text-lg font-black text-gold nums" dir="ltr">
                  {cities} / {MAX_CITIES}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-400">
                  <Icon name="citizens" size={14} className="inline align-[-2px] text-bone" /> {t("אזרחים")}
                </dt>
                <dd className="font-bold text-zinc-100 nums" dir="ltr">
                  {formatNumber(citizens)}
                </dd>
              </div>
            </dl>
          </Card>

          {/* upgrade to the next city */}
          <CityFoundCard
            cities={cities}
            maxCities={MAX_CITIES}
            heroLevel={empire.hero?.level ?? 1}
            heroRequired={cityHeroLevelRequired(cities)}
            cost={cityCost(cities)}
            available={available}
            soldiersAvailable={empire.army?.soldiers ?? 0}
            guildStake={guildStake}
          />
        </div>
      </section>

      {/* -------- empire upgrades -------- */}
      <p className="panel-inset rounded-xl p-4 text-center text-sm text-zinc-400">
        {t("שדרוגי אימפריה קבועים שמשפרים אזרחים, מודיעין, בנקאות וקבלת תורות.")}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EMPIRE_UPGRADE_TYPES.map((type) => {
          const meta = EMPIRE_UPGRADE_META[type];
          const upgrade = empire.upgrades.find((u) => u.type === type);
          const level = upgrade?.level ?? 1;
          const maxLevel = empireUpgradeMaxLevel(type, cities);
          const isMaxLevel = maxLevel !== undefined && level >= maxLevel;
          return (
            <UpgradeCard
              key={type}
              upgradeType={type}
              label={t(meta.label)}
              icon={meta.icon}
              description={t(meta.description, meta.descriptionParams)}
              level={level}
              currentEffect={meta.effectLabel(t, level, tunables.daily)}
              nextEffect={meta.effectLabel(t, level + 1, tunables.daily)}
              upgradeCost={empireUpgradeCostFor(type, level)}
              available={available}
              isMaxLevel={isMaxLevel}
            />
          );
        })}
      </div>
    </div>
  );
}
