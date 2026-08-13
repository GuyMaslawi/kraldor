import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { WeaponCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon, resourceIcon, type IconName } from "@/components/ui/Icon";
import { DuelBar, Meter } from "@/components/ui/Meter";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { formatNumber, formatDate } from "@/lib/game/format";
import { getTunables } from "@/lib/game/config";
import { readSpyIntel, type SpyIntel } from "@/lib/game/spyIntel";
import {
  BUILDING_META,
  EMPIRE_UPGRADE_META,
  STORAGE_META,
  UNIT_META,
  type ActiveEmpireUpgradeType,
} from "@/lib/game/constants";
import {
  WEAPON_CATEGORIES,
  WEAPON_CATEGORY_META,
  weaponByKey,
} from "@/lib/game/weapons";
import { GUILD_SPELL_META } from "@/lib/game/guild";
import { POTION_META } from "@/lib/game/potions";
import { shieldMeta } from "@/lib/game/diamondShop";
import {
  HERO_MAX_HEALTH,
  HERO_STAT_META,
  SLOT_META,
  SLOT_ORDER,
  xpToNextLevel,
} from "@/lib/game/hero";
import { ItemTile } from "@/components/game/ItemTile";
import { itemDetails, uiRarityForLevel } from "@/components/game/heroItemView";
import { SpyEffectsBoard, type SpyEffectRow } from "@/components/game/SpyEffectsBoard";
import { ShieldGlyph } from "@/components/game/ShieldBadges";
import { getI18n, getT, type T } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("דוח ריגול | KRALDOR") };
}

/* ============================ presentational atoms ============================ */

/** A titled dossier section. Every block on this page is one of these. */
function Card({
  icon,
  title,
  hint,
  aside,
  gold = false,
  children,
}: {
  icon: IconName;
  title: string;
  hint?: ReactNode;
  aside?: ReactNode;
  gold?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`${gold ? "panel-gold" : "panel"} rounded-xl p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
          <Icon name={icon} size={20} className="text-crimson-bright" />
          {title}
        </h3>
        {aside}
      </div>
      {hint && <p className="mb-3 text-xs text-zinc-500">{hint}</p>}
      {children}
    </div>
  );
}

/** One number in a box — the page's unit of intel. */
function Tile({
  icon,
  iconClass,
  label,
  value,
  tone = "text-zinc-100",
  sub,
}: {
  icon?: IconName;
  iconClass?: string;
  label: string;
  value: ReactNode;
  tone?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="panel-inset rounded-lg p-3 text-center">
      <p className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
        {icon && <Icon name={icon} size={14} className={iconClass} />}
        {label}
      </p>
      {/* These take Hebrew phrases as often as bare digits ("שלל צפוי 1.2M"),
          so they must NOT force LTR — a bare number renders correctly in the
          RTL flow anyway, but a forced LTR run throws the digits to the far
          side of their Hebrew label. */}
      <p className={`nums mt-0.5 text-lg font-black ${tone}`}>
        {value}
      </p>
      {sub && <p className="nums mt-0.5 text-[10px] text-zinc-500">{sub}</p>}
    </div>
  );
}

/** A label→value line inside a card. */
function Line({
  label,
  value,
  tone = "text-zinc-100",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle pb-2 last:border-0">
      <dt className="text-zinc-400">{label}</dt>
      <dd className={`nums font-bold ${tone}`}>
        {value}
      </dd>
    </div>
  );
}

// i18n-keys-start: dictionary keys, read through t() where the intel is drawn
const RESOURCE_LABEL: Record<string, string> = {
  gold: "זהב",
  wood: "עץ",
  iron: "ברזל",
  stone: "אבן",
};

/** Display names for the diamond-shop buffs that aren't shields. */
const BOOST_META: Partial<
  Record<string, { icon: IconName; label: string; effect: (t: T, pct: number) => string }>
> = {
  RESOURCE_BOOST_GOLD: {
    icon: "gold",
    label: "האצת מכרה זהב",
    effect: (t, p) => t("+{pct}% תפוקת זהב", { pct: p }),
  },
  RESOURCE_BOOST_WOOD: {
    icon: "wood",
    label: "האצת מכרה עץ",
    effect: (t, p) => t("+{pct}% תפוקת עץ", { pct: p }),
  },
  RESOURCE_BOOST_IRON: {
    icon: "iron",
    label: "האצת מכרה ברזל",
    effect: (t, p) => t("+{pct}% תפוקת ברזל", { pct: p }),
  },
  RESOURCE_BOOST_STONE: {
    icon: "stone",
    label: "האצת מחצבת אבן",
    effect: (t, p) => t("+{pct}% תפוקת אבן", { pct: p }),
  },
  SHOP_DISCOUNT: {
    icon: "shop",
    label: "הנחת חנות",
    effect: (t, p) => t("{pct}% הנחה על רכישות", { pct: p }),
  },
};
// i18n-keys-end

/* ============================ the active-effects board ============================ */

/**
 * One timed thing burning down over the target's head. Whether it is a guild
 * spell, a brew, a paid shield or a dead hero's hour in the ground, a raider
 * reads all of them the same way: what it does, and how long is left of it.
 */
interface EffectRow extends SpyEffectRow {
  /** Effects that decide whether raiding is worth a turn lead the board. */
  critical?: boolean;
}

function collectEffects(t: T, intel: SpyIntel, now: number): EffectRow[] {
  const rows: EffectRow[] = [];

  // The new-player shield outranks everything: while it holds, there is no
  // attack to plan at all.
  if (intel.protectedUntil) {
    rows.push({
      id: "protection",
      icon: "shield",
      label: t("חסינות שחקן חדש"),
      effect: t("לא ניתן לתקוף או לרגל אותו כלל"),
      expiresAt: Date.parse(intel.protectedUntil),
      tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      critical: true,
    });
  }

  for (const shield of intel.shields) {
    const meta = shieldMeta(shield.key);
    rows.push({
      id: `shield-${shield.key}`,
      icon: "shield",
      glyph: <ShieldGlyph shieldKey={shield.key} size={13} />,
      label: t(meta.label),
      effect:
        shield.key === "resources"
          ? t("ניצחון עליו לא יניב שלל")
          : t("ניצחון עליו לא ישעבד חיילים"),
      expiresAt: Date.parse(shield.expiresAt),
      tone: "border-gold/40 bg-gold/10 text-gold-bright",
      critical: true,
    });
  }

  // A hero in the ground grants his owner nothing — not points, not gear, not
  // his class bonus. The hour he rises is the single most actionable line here.
  if (intel.hero?.dead && intel.hero.reviveAt) {
    rows.push({
      id: "hero-dead",
      icon: "heart",
      label: t("הגיבור מת"),
      effect: t("כל בונוסי הגיבור מנוטרלים עד שיקום"),
      expiresAt: Date.parse(intel.hero.reviveAt),
      tone: "border-red-500/40 bg-red-500/10 text-red-400",
      critical: true,
    });
  }

  for (const spell of intel.spells) {
    // Reports are frozen snapshots, so one written before a spell was retired
    // still names it — the spy spell, deleted on 2026-08-03, is the case that
    // exists. An unknown type has no meta to draw, so drop the row rather than
    // crash the whole dossier on it.
    const meta = GUILD_SPELL_META[spell.type];
    if (!meta) continue;
    rows.push({
      id: `spell-${spell.type}`,
      icon: meta.icon,
      label: t(meta.label),
      effect: meta.effectLabel(t, Math.round(spell.pct)),
      expiresAt: Date.parse(spell.expiresAt),
      tone: "border-violet-400/40 bg-violet-500/10 text-violet-300",
      critical: spell.type === "DEFENSE",
    });
  }

  for (const potion of intel.potions) {
    const meta = POTION_META[potion.kind];
    rows.push({
      id: `potion-${potion.kind}`,
      icon: "potion",
      label: t(meta.label),
      effect: t(meta.tagline),
      expiresAt: Date.parse(potion.expiresAt),
      tone: "border-rose-400/40 bg-rose-500/10 text-rose-300",
      critical: potion.kind === "HERO_INVULNERABLE",
    });
  }

  for (const boost of intel.boosts) {
    const meta = BOOST_META[boost.kind];
    if (!meta) continue;
    rows.push({
      id: `boost-${boost.kind}`,
      icon: meta.icon,
      label: t(meta.label),
      effect: meta.effect(t, Math.round(boost.magnitude)),
      expiresAt: Date.parse(boost.expiresAt),
      tone: "border-cyan-400/40 bg-cyan-500/10 text-cyan-300",
    });
  }

  if (intel.hero?.quest) {
    rows.push({
      id: "hero-quest",
      icon: "quest",
      label: t("מסע הגיבור · דרגה {tier}", { tier: intel.hero.quest.tier }),
      effect: t("הגיבור בדרכים — שלל צפוי לחזור אליו"),
      expiresAt: Date.parse(intel.hero.quest.endsAt),
      tone: "border-sky-400/40 bg-sky-500/10 text-sky-300",
    });
  }

  // The snapshot keeps whatever was running when the spies walked in; by the
  // time the report is read, some of it has burned out. A raider only cares
  // about what still stands in his way, so anything already expired is dropped.
  return rows
    .filter((row) => Number.isFinite(row.expiresAt) && row.expiresAt > now)
    // Critical first (they change whether to spend the turn), then soonest to end.
    .sort(
      (a, b) =>
        Number(Boolean(b.critical)) - Number(Boolean(a.critical)) ||
        a.expiresAt - b.expiresAt
    );
}

/* ============================ page ============================ */

export default async function SpyResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  const me = await requireEmpire();

  const report = await prisma.spyReport.findUnique({
    where: { id },
    include: { defenderEmpire: { select: { id: true, name: true } } },
  });
  if (!report) notFound();
  // Only the spymaster who ran the mission may read its report.
  if (report.attackerEmpireId !== me.id) notFound();

  const foe = report.defenderEmpire;
  const intel = readSpyIntel(report.revealed);
  const serverNow = new Date().getTime();
  const { plunderRate, enslaveRate, enslaveMinSoldiers } = (await getTunables()).battle;

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("דוח ריגול")}
        subtitle={<PlayerLink empireId={foe.id} name={foe.name} />}
        ornament={<Icon name="spy" size={22} className="text-crimson" />}
      />

      <Verdict report={report} foeName={foe.name} t={t} />

      {report.success &&
        (intel ? (
          <FullDossier
            intel={intel}
            serverNow={serverNow}
            plunderRate={plunderRate}
            enslaveRate={enslaveRate}
            enslaveMinSoldiers={enslaveMinSoldiers}
            t={t}
          />
        ) : (
          <LegacyDossier report={report} t={t} />
        ))}

      {/* ------------------------------ actions ------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="nums text-xs text-zinc-500">
          <Icon name="turns" size={13} className="inline-block align-middle" />{" "}
          <span dir="ltr">{formatDate(report.createdAt, locale)}</span> ·{" "}
          {t("{turns} תורות", { turns: report.turnsSpent })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/game/empires/${foe.id}`} className="btn btn-gold px-5 py-2 text-sm">
            <Icon name="attack" size={16} className="inline-block align-middle" />{" "}
            {t("תקוף את {foe}", { foe: foe.name })}
          </Link>
          <Link href="/game/base" className="btn btn-ghost px-5 py-2 text-sm">
            <Icon name="base" size={16} className="inline-block align-middle" />{" "}
            {t("חזרה לבסיס")}
          </Link>
          <Link href="/game/reports" className="btn btn-ghost px-5 py-2 text-sm">
            <Icon name="reports" size={16} className="inline-block align-middle" />{" "}
            {t("היסטוריה")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ verdict banner ------------------------------ */

function Verdict({
  report,
  foeName,
  t,
}: {
  t: T;
  report: {
    success: boolean;
    attackerIntel: number | null;
    defenderIntel: number | null;
    guildBonus: number | null;
  };
  foeName: string;
}) {
  const mine = report.attackerIntel ?? 0;
  const theirs = report.defenderIntel ?? 0;
  const total = mine + theirs;
  const myShare = total > 0 ? (mine / total) * 100 : 50;

  return (
    <div
      className={`rounded-xl border p-5 text-center ${
        report.success
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-red-500/40 bg-red-500/10"
      }`}
    >
      <p className={`text-xl font-black ${report.success ? "text-emerald-300" : "text-red-400"}`}>
        {report.success
          ? t("הריגול על {foe} הצליח! ✅", { foe: foeName })
          : t("המרגל נתפס! המשימה נכשלה 🚨")}
      </p>
      <p className="mt-1 text-sm text-zinc-400">
        {report.success
          ? t("כח המודיעין שלך גבר על היעד — התיק המלא לפניך.")
          : t("כח המודיעין של היעד גבר — המרגל אבד. שדרג מודיעין, גייס מרגלים או נשקי ריגול.")}
      </p>

      {report.attackerIntel != null && report.defenderIntel != null && (
        <div className="mx-auto mt-4 max-w-md">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-red-400">
              <Icon name="spy" size={14} className="inline-block align-middle" />{" "}
              {t("המודיעין שלך")}{" "}
              <span className="nums font-bold" dir="ltr">
                {formatNumber(Math.round(mine))}
              </span>
            </span>
            <span className="text-sky-300">
              <span className="nums font-bold" dir="ltr">
                {formatNumber(Math.round(theirs))}
              </span>{" "}
              {t("המודיעין שלו")}{" "}
              <Icon name="shield" size={14} className="inline-block align-middle" />
            </span>
          </div>
          <DuelBar leftPct={myShare} />
          {report.guildBonus ? (
            <p className="nums mt-2 text-[11px] text-violet-300">
              {t("קסם ברית")} <span dir="ltr">+{Math.round(report.guildBonus)}%</span>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ legacy fallback ------------------------------ */

/**
 * Reports written before the full dossier existed only carry the seven flat
 * `revealed*` columns. They still open — with exactly what they hold.
 */
function LegacyDossier({
  report,
  t,
}: {
  t: T;
  report: {
    revealedGold: number | null;
    revealedWood: number | null;
    revealedIron: number | null;
    revealedStone: number | null;
    revealedSoldiers: number | null;
    revealedSpies: number | null;
    revealedMineSlaves: number | null;
  };
}) {
  return (
    <>
      <Card icon="citizens" title={t("אוכלוסייה")} gold>
        <div className="grid grid-cols-3 gap-3">
          <Tile icon="army" label={t("חיילים")} value={formatNumber(report.revealedSoldiers ?? 0)} />
          <Tile icon="spy" label={t("מרגלים")} value={formatNumber(report.revealedSpies ?? 0)} />
          <Tile
            icon="mine"
            label={t("עבדי מכרות")}
            value={formatNumber(report.revealedMineSlaves ?? 0)}
          />
        </div>
      </Card>
      <Card
        icon="gold"
        title={t("משאבים זמינים")}
        gold
        hint={t("משאבים אלה זמינים לביזה — משאבים במחסן מוגנים מפני תקיפה.")}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile icon="gold" iconClass="text-gold-bright" label={t("זהב")} value={formatNumber(report.revealedGold ?? 0)} tone="text-gold-bright" />
          <Tile icon="wood" iconClass="text-amber-600" label={t("עץ")} value={formatNumber(report.revealedWood ?? 0)} tone="text-gold-bright" />
          <Tile icon="iron" iconClass="text-slate-300" label={t("ברזל")} value={formatNumber(report.revealedIron ?? 0)} tone="text-gold-bright" />
          <Tile icon="stone" iconClass="text-stone-400" label={t("אבן")} value={formatNumber(report.revealedStone ?? 0)} tone="text-gold-bright" />
        </div>
      </Card>
      <p className="text-center text-xs text-zinc-600">
        {t("דוח ישן — נאסף לפני שהמרגלים למדו להביא את התיק המלא. רגל שוב כדי לקבל דוח מלא.")}
      </p>
    </>
  );
}

/* ------------------------------ the full dossier ------------------------------ */

function FullDossier({
  intel,
  serverNow,
  plunderRate,
  enslaveRate,
  enslaveMinSoldiers,
  t,
}: {
  intel: SpyIntel;
  serverNow: number;
  plunderRate: number;
  enslaveRate: number;
  enslaveMinSoldiers: number;
  t: T;
}) {
  const effects = collectEffects(t, intel, serverNow);
  const resourceKeys = ["gold", "wood", "iron", "stone"] as const;
  const shieldedResources = intel.shields.some((s) => s.key === "resources");
  const shieldedSoldiers = intel.shields.some((s) => s.key === "soldiers");

  const totalStored = intel.storages.reduce((sum, s) => sum + s.stored, 0);
  const equippedBySlot = new Map((intel.hero?.items ?? []).map((i) => [i.slot, i]));

  return (
    <>
      {/* ---------------- active magic & timers ----------------
          A side note, not a section: only what is still burning, in a narrow
          panel tucked against the left margin so it never eats the dossier. */}
      <div className="flex justify-end">
        <SpyEffectsBoard rows={effects} serverNow={serverNow} />
      </div>

      {/* ---------------- population & stock ---------------- */}
      <Card icon="citizens" title={t("אוכלוסייה ומלאי")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Tile icon="citizens" label={t("אזרחים")} value={formatNumber(intel.citizens)} />
          <Tile icon="army" label={t(UNIT_META.soldiers.labelPlural)} value={formatNumber(intel.army.soldiers)} />
          <Tile icon="spy" label={t(UNIT_META.spies.labelPlural)} value={formatNumber(intel.army.spies)} />
          <Tile icon="mine" label={t(UNIT_META.mineSlaves.labelPlural)} value={formatNumber(intel.army.mineSlaves)} />
          <Tile icon="turns" iconClass="text-emerald-400" label={t("תורות")} value={formatNumber(intel.turns)} tone="text-emerald-400" />
          <Tile icon="diamond" iconClass="text-cyan-300" label={t("יהלומים")} value={formatNumber(intel.diamonds)} tone="text-cyan-300" />
          <Tile icon="wheel" label={t("סיבובי גלגל")} value={formatNumber(intel.wheelSpins)} />
        </div>
      </Card>

      {/* ---------------- treasury: exposed vs vaulted ---------------- */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card
          icon="gold"
          title={t("אוצר גלוי — זמין לביזה")}
          gold
          hint={t("רק המשאבים שמחוץ למחסן נלקחים בקרב — {pct}% מהם לתוקף המנצח.", {
            pct: Math.round(plunderRate * 100),
          })}
        >
          <div className="grid grid-cols-2 gap-3">
            {resourceKeys.map((key) => {
              const ico = resourceIcon(key);
              const amount = intel.resources[key];
              return (
                <Tile
                  key={key}
                  icon={ico.name}
                  iconClass={ico.className}
                  label={t(RESOURCE_LABEL[key])}
                  value={formatNumber(amount)}
                  tone="text-gold-bright"
                  sub={
                    shieldedResources
                      ? t("מוגן במגן משאבים")
                      : t("שלל צפוי {amount}", {
                          amount: formatNumber(Math.floor(amount * plunderRate)),
                        })
                  }
                />
              );
            })}
          </div>
        </Card>

        <Card
          icon="storage"
          title={t("מחסנים — מחוץ להישג יד")}
          hint={t("מה שנמצא במחסן לא נבזז לעולם. הרמה קובעת את הקיבולת — מחסן מלא מסמן שהיעד עומד לגלוש החוצה.")}
          aside={
            <span className="nums text-xs font-bold text-zinc-400">
              {t("סה״כ")} <span dir="ltr">{formatNumber(totalStored)}</span>
            </span>
          }
        >
          <div className="space-y-3">
            {intel.storages.length === 0 && (
              <p className="text-sm text-zinc-500">{t("אין ליעד מחסנים.")}</p>
            )}
            {intel.storages.map((storage) => {
              const meta = STORAGE_META[storage.type];
              const pct = storage.capacity > 0 ? (storage.stored / storage.capacity) * 100 : 0;
              return (
                <div key={storage.type}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <Icon name={meta.icon} size={15} className={resourceIcon(meta.resourceKey).className} />
                      {t(meta.label)}
                      <span className="nums text-zinc-500">
                        {t("רמה")} <span dir="ltr">{storage.level}</span>
                      </span>
                    </span>
                    <span className="nums font-bold text-zinc-200" dir="ltr">
                      {formatNumber(storage.stored)} / {formatNumber(storage.capacity)}
                    </span>
                  </div>
                  <Meter value={pct} tone="xp" />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ---------------- bank ---------------- */}
      {intel.bank && (
        <Card
          icon="bank"
          title={t("חשבון הבנק")}
          hint={t("זהב בבנק חסין מביזה לחלוטין — אבל הוא מגלה כמה שווה היעד באמת, וכמה הפקדות נשארו לו עד העדכון היומי הבא.")}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile
              icon="gold"
              iconClass="text-gold-bright"
              label={t("יתרה בבנק")}
              value={formatNumber(intel.bank.balance)}
              tone="text-gold-bright"
            />
            <Tile
              icon="bank"
              label={t("הפקדות שנוצלו")}
              value={`${intel.bank.depositsUsed} / ${intel.bank.depositsAllowed}`}
              sub={t("נותרו {count}", {
                count: Math.max(0, intel.bank.depositsAllowed - intel.bank.depositsUsed),
              })}
            />
            {/* One decimal: בית הגנזים multiplies the ladder's whole percent
                into a fraction, and rounding it away hides the monument. */}
            <Tile
              icon="upgrades"
              label={t("ריבית יומית")}
              value={`${Number(intel.bank.interestPct.toFixed(1))}%`}
              tone="text-emerald-400"
            />
          </div>
        </Card>
      )}

      {/* ---------------- army & power ---------------- */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card icon="spark" title={t("כוח האימפריה")} gold>
          <dl className="space-y-2.5 text-sm">
            <Line
              label={<><Icon name="attack" size={15} className="inline-block align-middle text-red-400" /> {t("כוח התקפה")}</>}
              value={formatNumber(intel.power.attack)}
              tone="text-red-400"
            />
            <Line
              label={<><Icon name="shield" size={15} className="inline-block align-middle text-sky-300" /> {t("כוח הגנה")}</>}
              value={formatNumber(intel.power.defense)}
              tone="text-sky-300"
            />
            <Line
              label={<><Icon name="spy" size={15} className="inline-block align-middle text-gold" /> {t("כוח ריגול")}</>}
              value={formatNumber(intel.power.spy)}
              tone="text-gold"
            />
            <Line
              label={<><Icon name="army" size={15} className="inline-block align-middle" /> {t("כוח צבאי")}</>}
              value={formatNumber(intel.power.military)}
            />
            <Line
              label={<><Icon name="crown" size={15} className="inline-block align-middle text-gold-bright" /> {t("כוח כללי")}</>}
              value={formatNumber(intel.power.general)}
              tone="text-gold-bright"
            />
            <Line
              label={<><Icon name="spy" size={15} className="inline-block align-middle text-violet-300" /> {t("מודיעין אפקטיבי")}</>}
              value={formatNumber(Math.round(intel.power.intel))}
              tone="text-violet-300"
            />
          </dl>
          <p className="mt-3 text-[11px] text-zinc-500">
            {t("״מודיעין אפקטיבי״ הוא מה שריגול נגדי צריך לעבור — כוח הריגול שלו כפול שדרוג המודיעין.")}
          </p>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-red-400">
                <Icon name="attack" size={14} className="inline-block align-middle" /> {t("התקפה")}
              </span>
              <span className="text-sky-300">
                {t("הגנה")} <Icon name="shield" size={14} className="inline-block align-middle" />
              </span>
            </div>
            <DuelBar
              leftPct={
                intel.power.attack + intel.power.defense > 0
                  ? (intel.power.attack / (intel.power.attack + intel.power.defense)) * 100
                  : 50
              }
            />
          </div>
        </Card>

        <Card
          icon="army"
          title={t("מה יש להרוויח")}
          hint={t("הערכה לפי הכללים הנוכחיים, בהנחת ניצחון בקרב. מגנים בתוקף מאפסים את הרלוונטי מהם.")}
        >
          <dl className="space-y-2.5 text-sm">
            {resourceKeys.map((key) => {
              const ico = resourceIcon(key);
              return (
                <Line
                  key={key}
                  label={
                    <>
                      <Icon name={ico.name} size={15} className={`inline-block align-middle ${ico.className}`} />{" "}
                      {t(RESOURCE_LABEL[key])}
                    </>
                  }
                  value={
                    shieldedResources
                      ? t("0 — מוגן")
                      : formatNumber(Math.floor(intel.resources[key] * plunderRate))
                  }
                  tone={shieldedResources ? "text-zinc-500" : "text-gold-bright"}
                />
              );
            })}
            <Line
              label={<><Icon name="army" size={15} className="inline-block align-middle" /> {t("חיילים לשבי")}</>}
              value={
                shieldedSoldiers
                  ? t("0 — מוגן")
                  : intel.army.soldiers < enslaveMinSoldiers
                    ? t("0 — פחות מ־{min} חיילים", { min: enslaveMinSoldiers })
                    : formatNumber(Math.floor(intel.army.soldiers * enslaveRate))
              }
              tone={shieldedSoldiers ? "text-zinc-500" : "text-zinc-100"}
            />
          </dl>
        </Card>
      </div>

      {/* ---------------- arsenal ---------------- */}
      <Card
        icon="factory"
        title={t("מחסן הנשק")}
        gold
        hint={t("כל פריט נשק שנמצא במחסני היעד — כמות, דרגה וכוח. סכום הכוח לפי קטגוריה הוא בדיוק מה שיעמוד מולך בקרב.")}
      >
        <div className="space-y-4">
          {WEAPON_CATEGORIES.map((category) => (
            <ArsenalCategory key={category} category={category} intel={intel} t={t} />
          ))}
        </div>
      </Card>

      {/* ---------------- buildings & upgrades ---------------- */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card
          icon="mine"
          title={t("מבנים ומכרות")}
          hint={t("רמת המבנה ומספר העבדים שהוצבו בו — יחד הם התפוקה שלו בכל עדכון רגיל.")}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {intel.buildings.map((building) => {
              const meta = BUILDING_META[building.type];
              return (
                <div key={building.type} className="panel-inset flex items-center justify-between gap-2 rounded-lg p-2.5">
                  <span className="flex items-center gap-2 text-sm text-zinc-300">
                    <Icon
                      name={meta.icon}
                      size={16}
                      className={
                        meta.producedResource ? resourceIcon(meta.producedResource).className : undefined
                      }
                    />
                    {t(meta.label)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="nums rounded-md border border-gold/40 bg-gold/10 px-1.5 text-xs font-bold text-gold-bright">
                      {t("רמה")} <span dir="ltr">{building.level}</span>
                    </span>
                    {meta.supportsSlaves && (
                      <span className="nums inline-flex items-center gap-1 text-xs text-zinc-400" dir="ltr">
                        <Icon name="mine" size={13} /> {formatNumber(building.slaves)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {intel.buildings.length === 0 && (
              <p className="text-sm text-zinc-500">{t("לא נמצאו מבנים.")}</p>
            )}
          </div>
        </Card>

        <Card
          icon="upgrades"
          title={t("שדרוגי אימפריה")}
          hint={t("הרמות שהיעד קנה — מודיעין גבוה מסביר ריגול נגדי מוצלח, ותורות גבוהות מסבירות כמה תקיפות הוא יכול לספוג ולהחזיר.")}
        >
          <dl className="space-y-2 text-sm">
            {intel.upgrades
              .filter((u): u is { type: ActiveEmpireUpgradeType; level: number } =>
                u.type in EMPIRE_UPGRADE_META
              )
              .map((upgrade) => {
                const meta = EMPIRE_UPGRADE_META[upgrade.type];
                return (
                  <Line
                    key={upgrade.type}
                    label={
                      <span className="flex flex-col">
                        <span className="flex items-center gap-1.5 text-zinc-300">
                          <Icon name={meta.icon} size={15} /> {t(meta.label)}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {meta.effectLabel(t, upgrade.level)}
                        </span>
                      </span>
                    }
                    value={t("רמה {level}", { level: upgrade.level })}
                    tone="text-gold-bright"
                  />
                );
              })}
          </dl>
        </Card>
      </div>

      {/* ---------------- hero ---------------- */}
      {intel.hero && (
        <Card
          icon="hero"
          title={t("הגיבור")}
          gold
          aside={
            <span className="nums inline-flex items-center gap-1 rounded-full border border-gold/40 bg-panel-inset px-2.5 py-0.5 text-xs font-bold text-gold">
              {t("רמה")} <span dir="ltr">{intel.hero.level}</span>
              {intel.hero.resets > 0 && (
                <span className="text-purple-300" dir="ltr">↻×{intel.hero.resets}</span>
              )}
            </span>
          }
        >
          {intel.hero.dead && (
            <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <Icon name="heart" size={14} className="inline-block align-middle" />{" "}
              {t("הגיבור מוטל מת — כל הבונוסים שלו מנוטרלים, כולל אחוזי ההגנה. זה החלון לתקוף.")}

            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">
                    <Icon name="heart" size={14} className="inline-block align-middle text-red-400" />{" "}
                    {t("חיים")}
                  </span>
                  <span className="nums font-bold text-red-400" dir="ltr">
                    {intel.hero.health} / {HERO_MAX_HEALTH}
                  </span>
                </div>
                <Meter value={intel.hero.health} max={HERO_MAX_HEALTH} tone="health" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">
                    <Icon name="spark" size={14} className="inline-block align-middle" />{" "}
                    {t("ניסיון")}
                  </span>
                  <span className="nums font-bold text-gold" dir="ltr">
                    {formatNumber(intel.hero.xp)} / {formatNumber(xpToNextLevel(intel.hero.level))}
                  </span>
                </div>
                <Meter value={intel.hero.xp} max={xpToNextLevel(intel.hero.level)} tone="xp" />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label={t("נק׳ התקפה")} value={formatNumber(intel.hero.attackPoints)} tone="text-red-400" />
                <Tile label={t("נק׳ הגנה")} value={formatNumber(intel.hero.defensePoints)} tone="text-sky-300" />
                <Tile label={t("נק׳ משאבים")} value={formatNumber(intel.hero.resourcePoints)} tone="text-emerald-400" />
                <Tile label={t("לא הושקעו")} value={formatNumber(intel.hero.unspentPoints)} tone="text-zinc-400" />
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-bold tracking-wide text-gold">
                {t("בונוסים מלאים")}{" "}
                {intel.hero.dead && (
                  <span className="text-red-400">{t("(מושהים — הגיבור מת)")}</span>
                )}
              </h4>
              <dl className="space-y-2 text-sm">
                <Line
                  label={<><Icon name={HERO_STAT_META.attack.icon} size={15} className="inline-block align-middle" /> {t(HERO_STAT_META.attack.label)}</>}
                  value={`+${Math.round(intel.hero.pct.attack)}%`}
                  tone="text-red-400"
                />
                <Line
                  label={<><Icon name={HERO_STAT_META.defense.icon} size={15} className="inline-block align-middle" /> {t(HERO_STAT_META.defense.label)}</>}
                  value={`+${Math.round(intel.hero.pct.defense)}%`}
                  tone="text-sky-300"
                />
                <Line
                  label={<><Icon name={HERO_STAT_META.spy.icon} size={15} className="inline-block align-middle" /> {t(HERO_STAT_META.spy.label)}</>}
                  value={`+${Math.round(intel.hero.pct.spy)}%`}
                  tone="text-gold"
                />
                <Line
                  label={<><Icon name="mine" size={15} className="inline-block align-middle" /> {t("תפוקת מכרות")}</>}
                  value={`+${Math.round(intel.hero.pct.resources)}%`}
                  tone="text-emerald-400"
                />
                <Line
                  label={<><Icon name="turns" size={15} className="inline-block align-middle text-emerald-400" /> {t("תורות מציוד")}</>}
                  value={`+${formatNumber(intel.hero.flat.turns)}`}
                />
                <Line
                  label={<><Icon name="citizens" size={15} className="inline-block align-middle" /> {t("אזרחים מציוד")}</>}
                  value={`+${formatNumber(intel.hero.flat.citizens)}`}
                />
              </dl>
            </div>
          </div>

          <h4 className="mb-2 mt-4 text-xs font-bold tracking-wide text-gold">{t("ציוד לבוש")}</h4>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-9">
            {SLOT_ORDER.map((slot) => {
              const meta = SLOT_META[slot];
              const item = equippedBySlot.get(slot);
              if (!item) {
                return (
                  <div key={slot} className="flex flex-col items-center gap-1">
                    <div className="panel-inset flex aspect-square w-full items-center justify-center rounded-xl">
                      <span aria-hidden className="text-3xl opacity-25 grayscale">
                        {meta.icon}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-600">{t(meta.label)}</span>
                  </div>
                );
              }
              return (
                <ItemTile
                  key={slot}
                  slug={meta.slug}
                  icon={meta.icon}
                  level={item.level}
                  name={t(meta.label)}
                  rarity={uiRarityForLevel(item.level)}
                  details={itemDetails(t, item, intel.hero!.level, { worn: true })}
                />
              );
            })}
          </div>
          {equippedBySlot.size === 0 && (
            <p className="mt-3 text-xs text-zinc-600">{t("הגיבור של היעד אינו לובש ציוד כלל.")}</p>
          )}
        </Card>
      )}
    </>
  );
}

/* ------------------------------ arsenal ------------------------------ */

function ArsenalCategory({
  category,
  intel,
  t,
}: {
  category: WeaponCategory;
  intel: SpyIntel;
  t: T;
}) {
  const meta = WEAPON_CATEGORY_META[category];
  const rows = intel.weapons
    .map((w) => ({ def: weaponByKey(w.key), qty: w.qty }))
    .filter((r) => r.def && r.def.category === category)
    .map((r) => ({ def: r.def!, qty: r.qty, power: r.def!.power * r.qty }))
    .sort((a, b) => b.def.tier - a.def.tier);

  const totalPower = rows.reduce((sum, r) => sum + r.power, 0);
  const totalCount = rows.reduce((sum, r) => sum + r.qty, 0);
  const unlockedTier =
    intel.weaponUnlocks.find((u) => u.category === category)?.unlockedTier ?? 1;

  return (
    <div className="panel-inset rounded-lg p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-gold">
          <span aria-hidden>{meta.icon}</span> {t(meta.label)}
          <span className="nums text-xs font-normal text-zinc-500">
            <span dir="ltr">{formatNumber(totalCount)}</span> {t("פריטים · דרגה פתוחה")}{" "}
            <span dir="ltr">{unlockedTier}</span>
          </span>
        </h4>
        <span className="nums text-sm font-black text-gold-bright">
          {t(meta.powerLabel)} <span dir="ltr">{formatNumber(totalPower)}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">{t("אין ליעד ולו נשק אחד בקטגוריה הזו.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-start text-xs">
            <thead className="text-zinc-500">
              <tr className="border-b border-border-subtle">
                <th className="pb-1.5 font-medium">{t("נשק")}</th>
                <th className="pb-1.5 font-medium">{t("דרגה")}</th>
                <th className="pb-1.5 font-medium">{t("כמות")}</th>
                <th className="pb-1.5 font-medium">{t("כוח ליחידה")}</th>
                <th className="pb-1.5 font-medium">{t("כוח כולל")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.def.key} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-1.5 font-medium text-zinc-200">{t(row.def.name)}</td>
                  <td className="nums py-1.5 text-zinc-400" dir="ltr">{row.def.tier}</td>
                  <td className="nums py-1.5 font-bold text-zinc-100" dir="ltr">
                    {formatNumber(row.qty)}
                  </td>
                  <td className="nums py-1.5 text-zinc-400" dir="ltr">{formatNumber(row.def.power)}</td>
                  <td className="nums py-1.5 font-bold text-gold-bright" dir="ltr">
                    {formatNumber(row.power)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
