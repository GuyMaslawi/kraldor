import Link from "next/link";
import type { ReactNode } from "react";
import type { Army } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { weaponsPower, type WeaponQuantityRow } from "@/lib/game/weapons";
import {
  armyPower,
  spiesPower,
  getEmpireAttackPower,
  getEmpireDefensePower,
  getEmpireSpyPower,
  getEmpireGeneralPower,
  type CombatPowerBreakdown,
} from "@/lib/game/power";
import { formatNumber } from "@/lib/game/format";
import { getT, type T } from "@/i18n/server";

/**
 * Turn a base decomposition plus a bonus breakdown into PowerCard rows.
 *
 * A line with no percentage behind it — gear power, which is a flat term inside
 * the base rather than a multiplier of it — prints its label alone. "(+0%)"
 * would be a false statement about the only line on the card that is not one.
 */
function bonusRows(t: T, breakdown: CombatPowerBreakdown | undefined) {
  if (!breakdown) return [];
  return breakdown.lines.map((line) => ({
    label: line.pct
      ? t("{label} (+{pct}%)", { label: t(line.label), pct: line.pct })
      : t(line.label),
    value: Math.round(line.amount),
  }));
}

interface PowerLink {
  href: string;
  label: string;
}

function PowerCard({
  t,
  icon,
  title,
  value,
  breakdown,
  helper,
  links,
  highlight = false,
}: {
  t: T;
  icon: ReactNode;
  title: string;
  value: number;
  breakdown: { label: string; value: number }[] | string;
  helper?: string;
  links?: PowerLink[];
  highlight?: boolean;
}) {
  return (
    <Card
      className={`flex flex-col !p-4 ${highlight ? "border-gold/40 bg-gold/5" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-2xl">{icon}</span>
        <h3 className="text-sm font-bold text-zinc-300">{title}</h3>
      </div>
      <p className="mt-2 text-3xl font-black tabular-nums text-gold">
        {formatNumber(value)}
      </p>
      {typeof breakdown === "string" ? (
        <p className="mt-2 text-xs text-zinc-400">{breakdown}</p>
      ) : (
        // The breakdown floats over the card on hover so a longer list of
        // active bonuses never stretches the card — the tile stays compact.
        <Tip
          side="bottom"
          focusable
          maxWidth={256}
          className="mt-2 w-fit cursor-help items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-gold"
          tipClassName="min-w-[10rem]"
          tip={
            <dl className="space-y-1 text-xs">
              {breakdown.map((row) => (
                <div key={row.label} className="flex justify-between gap-4">
                  <dt className="font-normal text-zinc-400">{row.label}</dt>
                  <dd className="font-semibold tabular-nums text-zinc-200">
                    {formatNumber(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          }
        >
          {t("מהרכב הכוח")}
          <span aria-hidden className="text-[9px] leading-none">▾</span>
        </Tip>
      )}
      {helper && <p className="mt-2 text-[11px] leading-snug text-zinc-500">{helper}</p>}
      {links && links.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-3 text-xs">
          {links.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              className="font-semibold text-gold hover:text-gold-bright"
            >
              {link.label} ←
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

export async function PowerSummary({
  army,
  weapons,
  attackBreakdown,
  defenseBreakdown,
}: {
  army: Pick<Army, "soldiers" | "spies"> | null;
  weapons: readonly WeaponQuantityRow[];
  /** When given, the attack card shows real battle power with active bonuses. */
  attackBreakdown?: CombatPowerBreakdown;
  /** When given, the defense card shows real battle power (incl. +20%). */
  defenseBreakdown?: CombatPowerBreakdown;
}) {
  const t = await getT();
  const soldiersPower = armyPower(army);
  const spyUnitsPower = spiesPower(army);
  const attackWeaponsPower = weaponsPower(weapons, "ATTACK");
  const defenseWeaponsPower = weaponsPower(weapons, "DEFENSE");
  const spyWeaponsPower = weaponsPower(weapons, "SPY");

  const attackValue = attackBreakdown?.total ?? getEmpireAttackPower(army, weapons);
  const defenseValue = defenseBreakdown?.total ?? getEmpireDefensePower(army, weapons);

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-gold">
        <Icon name="spark" size={20} className="text-crimson-bright" />
        {t("כוח האימפריה")}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PowerCard
          t={t}
          icon={<Icon name="attack" size={28} className="text-red-400" />}
          title={t("כוח התקפה")}
          value={attackValue}
          breakdown={[
            { label: t("חיילים"), value: soldiersPower },
            { label: t("נשקי התקפה"), value: attackWeaponsPower },
            ...bonusRows(t, attackBreakdown),
          ]}
          helper={
            attackBreakdown && attackBreakdown.lines.length > 0
              ? t("כולל בונוסים פעילים (גיבור / קסם / עזרת ברית).")
              : undefined
          }
          links={[
            { href: "/game/weapons", label: t("ניהול נשקים") },
            { href: "/game/army", label: t("אימון צבא") },
          ]}
        />
        <PowerCard
          t={t}
          icon={<Icon name="shield" size={28} className="text-sky-300" />}
          title={t("כוח הגנה")}
          value={defenseValue}
          breakdown={[
            { label: t("חיילים"), value: soldiersPower },
            { label: t("נשקי הגנה"), value: defenseWeaponsPower },
            ...bonusRows(t, defenseBreakdown),
          ]}
          helper={
            defenseBreakdown
              ? t("כוח ההגנה בפועל בקרב, כולל בונוס מגן ובונוסים פעילים.")
              : t("בקרב הגנה מתקבל בונוס הגנה של 20%.")
          }
          links={[
            { href: "/game/weapons", label: t("ניהול נשקים") },
            { href: "/game/army", label: t("אימון צבא") },
          ]}
        />
        <PowerCard
          t={t}
          icon={<Icon name="spy" size={28} className="text-gold" />}
          title={t("כוח מודיעין")}
          value={getEmpireSpyPower(army, weapons)}
          breakdown={[
            { label: t("מרגלים"), value: spyUnitsPower },
            { label: t("נשקי ריגול"), value: spyWeaponsPower },
          ]}
          helper={t("שדרוג מודיעין מכפיל אותו — ריגול מצליח כשהוא גדול מזה של היעד.")}
          links={[
            { href: "/game/weapons?tab=spy", label: t("ניהול נשקי ריגול") },
            { href: "/game/army", label: t("אימון מרגלים") },
          ]}
        />
        <PowerCard
          t={t}
          icon={<Icon name="crown" size={28} className="text-gold-bright" />}
          title={t("כוח כללי")}
          value={getEmpireGeneralPower(army, weapons)}
          breakdown={t("התקפה + הגנה + מודיעין")}
          highlight
        />
      </div>
    </section>
  );
}
