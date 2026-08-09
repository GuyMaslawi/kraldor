import type { CSSProperties } from "react";
import { requireEmpire } from "@/lib/auth";
import {
  BUILDING_META,
  MINE_MAX_LEVEL,
  PRODUCTION_BUILDING_TYPES,
  RESOURCE_META,
  mineProductionValue,
  mineUpgradeCost,
} from "@/lib/game/constants";
import { formatNumber } from "@/lib/game/format";
import { heroBonuses, resourceProductionPct } from "@/lib/game/hero";
import { getActiveGuildBuffPct } from "@/lib/game/guildBuffs";
import { getActiveResourceBoosts } from "@/lib/game/diamondEffects";
import { monumentBonuses } from "@/lib/game/monuments";
import { mineProductionBreakdown } from "@/lib/game/resources";
import { isVip } from "@/lib/game/vip";
import { MineCard } from "@/components/game/MineCard";
import { MineSlaveQuickActions } from "@/components/game/MineSlaveQuickActions";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("ייצור | קראלדור") };
}

/** Furnace smoke behind the industry banner — fixed table, no randomness. */
const SMOKE = [
  { x: "8%", d: "0s", dur: "7.5s" },
  { x: "23%", d: "2.6s", dur: "8.4s" },
  { x: "72%", d: "1.3s", dur: "9.1s" },
  { x: "88%", d: "4.1s", dur: "7.9s" },
];

/** Sparks off the same furnaces. */
const EMBERS = [
  { x: "14%", d: "0.4s", dur: "4.6s" },
  { x: "34%", d: "2.2s", dur: "5.3s" },
  { x: "56%", d: "3.4s", dur: "4.9s" },
  { x: "79%", d: "1.1s", dur: "5.8s" },
  { x: "94%", d: "3.9s", dur: "5.1s" },
];

export default async function ProductionPage() {
  const t = await getT();
  const empire = await requireEmpire();
  const vip = isVip(empire);

  const mines = PRODUCTION_BUILDING_TYPES.map((type) => {
    const building = empire.buildings.find((b) => b.type === type);
    return {
      type,
      level: building?.level ?? 0,
      assignedSlaves: building?.slavesAssigned ?? 0,
    };
  });

  // Same bonus inputs the game clock uses when settling production, so the
  // breakdown shown on each card matches what actually gets credited.
  const heroBonus = heroBonuses(empire.hero);
  const monuments = monumentBonuses(empire.monuments);
  const [guildResourcesPct, resourceBoosts] = await Promise.all([
    getActiveGuildBuffPct(empire.id, "RESOURCES"),
    getActiveResourceBoosts(empire.id),
  ]);

  const totalSlaves = empire.army?.mineSlaves ?? 0;
  const assignedTotal = mines.reduce((sum, m) => sum + m.assignedSlaves, 0);
  const freeSlaves = Math.max(0, totalSlaves - assignedTotal);

  const summary = [
    { label: t('סה"כ עבדי מכרות'), value: totalSlaves },
    { label: t("עבדי מכרות מוצבים"), value: assignedTotal },
    { label: t("עבדי מכרות פנויים"), value: freeSlaves },
  ];

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("מכונות")}
        ornament={<Icon name="mine" size={22} className="text-crimson" />}
      />

      {/* The industry banner. Everything inside `aria-hidden` is scenery —
          turning gears and furnace smoke behind the three real figures. */}
      <div className="panel-gold forge rounded-xl p-4">
        <span className="forge-gear forge-gear-a" aria-hidden />
        <span className="forge-gear forge-gear-b" aria-hidden />
        <span className="forge-smoke" aria-hidden>
          {SMOKE.map((puff) => (
            <span
              key={puff.x}
              style={{ "--x": puff.x, "--d": puff.d, "--dur": puff.dur } as CSSProperties}
            />
          ))}
        </span>
        <span className="forge-embers" aria-hidden>
          {EMBERS.map((ember) => (
            <span
              key={ember.x}
              style={{ "--x": ember.x, "--d": ember.d, "--dur": ember.dur } as CSSProperties}
            />
          ))}
        </span>

        <div className="forge-body">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="mine" size={20} className="text-crimson-bright forge-cart" />
            {t("מפעלים ותעשייה")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {summary.map(({ label, value }, index) => (
              <div
                key={label}
                className="panel-inset forge-stat rounded-lg p-3 text-center"
                style={{ "--i": index } as CSSProperties}
              >
                <p className="text-xs text-gold-dim">{label}</p>
                <p className="nums mt-0.5 text-lg font-bold text-gold-bright" dir="ltr">
                  {formatNumber(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <MineSlaveQuickActions isVip={vip} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {mines.map((mine) => {
          const meta = BUILDING_META[mine.type];
          const resource = meta.producedResource!;
          const breakdown = mineProductionBreakdown({
            level: mine.level,
            assignedSlaves: mine.assignedSlaves,
            cities: empire.cities,
            heroResourcesPct: resourceProductionPct(heroBonus),
            guildResourcesPct,
            diamondBoostPct: resourceBoosts[resource],
            monumentMinesPct: monuments.mines,
            heroItemFlat: heroBonus.itemsFlatByResource[resource],
          });
          return (
            <MineCard
              key={mine.type}
              resource={resource}
              label={t(meta.label)}
              description={t(meta.description)}
              level={mine.level}
              maxLevel={MINE_MAX_LEVEL}
              assignedSlaves={mine.assignedSlaves}
              freeSlaves={freeSlaves}
              resourceLabel={t(RESOURCE_META[resource].label)}
              productionPerSlave={mineProductionValue(mine.level)}
              breakdown={breakdown}
              upgradeCost={mineUpgradeCost(mine.level, resource)}
              isVip={vip}
            />
          );
        })}
      </div>
    </div>
  );
}
