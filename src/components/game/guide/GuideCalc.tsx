"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { RichText } from "@/components/ui/RichText";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  BANK_DAILY_INTEREST_MAX_LEVEL,
  DEFENSE_BONUS,
  ENSLAVE_MIN_SOLDIERS,
  ENSLAVE_RATE,
  PLUNDER_RATE,
  SOLDIER_POWER,
  SPY_POWER,
  bankInterestRate,
  intelligencePowerMultiplier,
  mineProductionPerTick,
  REGULAR_TICK_MINUTES,
} from "@/lib/game/constants";
import {
  UPGRADE_LEVELS,
  bonusMultiplier,
  itemPrimaryBonus,
  itemUpgradeCost,
  matchupXpFactor,
  effectiveHeroLevel,
  levelGapXpFactor,
  resetGapXpFactor,
  tierForLevel,
  upgradeStep,
  xpToNextLevel,
  RARITY_META,
  SLOT_META,
  type HeroPercentStat,
} from "@/lib/game/hero";
import { CITY_BOSSES, bossHeroXp, bossPower, bossReward, bossTurnCost } from "@/lib/game/bosses";
import { bossSiegeMaxHp, bossSortiesToKill } from "@/lib/game/bossBattle";
import { formatShort } from "@/lib/game/format";

/* ========================================================================
   Shared calculator chrome
   ======================================================================== */

/** Number field with a slider — the only input shape the calculators use. */
function Field({
  label,
  icon,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
  hint,
}: {
  label: string;
  icon?: IconName;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-bone/85">
          {icon && <Icon name={icon} size={13} className="opacity-70" />}
          {label}
        </span>
        <span className="flex items-baseline gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const raw = Number(e.target.value);
              if (!Number.isFinite(raw)) return;
              onChange(Math.min(max, Math.max(min, raw)));
            }}
            className="w-24 rounded border border-border-subtle bg-black/50 px-1.5 py-0.5 text-left text-xs font-black text-gold-bright nums outline-none focus:border-gold/60"
            dir="ltr"
          />
          {suffix && <span className="text-[10px] text-zinc-500">{suffix}</span>}
        </span>
      </span>
      <input
        type="range"
        className="guide-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      {hint && <span className="mt-0.5 block text-[10px] text-zinc-500">{hint}</span>}
    </label>
  );
}

/** The calculator frame: a gold panel with a titled header. */
function CalcShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="panel-gold rounded-xl p-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-gold-bright">
        <Icon name="upgrades" size={15} />
        {title}
      </p>
      {children}
    </div>
  );
}

/** One line of the derivation shown under a calculator. */
function Step({
  label,
  value,
  tone = "text-zinc-300",
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 border-b border-white/5 py-1 last:border-0 ${
        strong ? "text-sm" : "text-xs"
      }`}
    >
      <span className={strong ? "font-black text-bone-bright" : "text-zinc-400"}>{label}</span>
      <span className={`nums ${strong ? "text-base font-black" : "font-bold"} ${tone}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}

/** The single headline number a calculator exists to produce. */
function Result({
  label,
  value,
  sub,
  tone = "text-gold-bright",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="panel-inset rounded-xl px-4 py-3 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold-dim">{label}</p>
      <p className={`text-2xl font-black nums ${tone}`} dir="ltr">
        {value}
      </p>
      {sub && <p className="text-[11px] text-zinc-400">{sub}</p>}
    </div>
  );
}

const int = (v: number) => Math.floor(v).toLocaleString("he-IL");

/* ========================================================================
   1. Mine production
   ======================================================================== */

/**
 * Mirrors `applyPendingUpdates` + `mineProductionBreakdown`: the raw per-slave
 * yield times the city count, then the multiplicative bonuses in the same order
 * the game clock applies them, and finally the relic's flat amount on top.
 */
export function ProductionCalc({ globalMultiplier = 1 }: { globalMultiplier?: number }) {
  const t = useT();
  const [level, setLevel] = useState(40);
  const [slaves, setSlaves] = useState(60);
  const [cities, setCities] = useState(3);
  const [heroPct, setHeroPct] = useState(20);
  const [guildPct, setGuildPct] = useState(0);
  const [flat, setFlat] = useState(0);
  const [potion, setPotion] = useState(false);

  // Same order the game clock uses in applyPendingUpdates: raw yield → cities →
  // hero → guild → potion → the global admin scalar, then the relic's flat add.
  const base = mineProductionPerTick(level, slaves);
  const afterCities = base * cities;
  const afterHero = afterCities * bonusMultiplier(heroPct);
  const afterGuild = afterHero * bonusMultiplier(guildPct);
  const afterPotion = afterGuild * (potion ? 2 : 1);
  const afterGlobal = afterPotion * globalMultiplier;
  const total = afterGlobal + flat;

  return (
    <CalcShell title={t("מחשבון תפוקת מכרה")}>
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label={t("רמת המכרה")} icon="mine" value={level} onChange={setLevel} max={250}
          hint={t("כל עבד מפיק {p0} יחידות בעדכון", { p0: level * 2 })} />
        <Field label={t("עבדי מכרות משובצים")} icon="army" value={slaves} onChange={setSlaves} max={5000} />
        <Field label={t("מספר ערים")} icon="base" value={cities} onChange={setCities} min={1} max={10}
          hint={t("מכפיל ×{p0}", { p0: cities })} />
        <Field label={t("בונוס גיבור (משאבים)")} icon="hero" value={heroPct} onChange={setHeroPct} max={200} suffix="%" />
        <Field label={t("קסם ברית — משאבים")} icon="guild" value={guildPct} onChange={setGuildPct} max={30} suffix="%" />
        <Field label={t("חפץ פרי־שטן (קבוע לעדכון)")} icon="spark" value={flat} onChange={setFlat} max={200} />
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-bold text-emerald-300">
        <input
          type="checkbox"
          checked={potion}
          onChange={(e) => setPotion(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
        <Icon name="potion" size={14} /> {t("שיקוי השפע פעיל (×2)")}
      </label>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="panel-inset rounded-xl px-3 py-2">
          <Step label={t("בסיס — עבדים × (רמה × 2)")} value={int(base)} />
          <Step label={t("ערים ×{p0}", { p0: cities })} value={`+ ${int(afterCities - base)}`} tone="text-sky-300" />
          <Step label={t("גיבור +{p0}%", { p0: heroPct })} value={`+ ${int(afterHero - afterCities)}`} tone="text-purple-300" />
          <Step label={t("ברית +{p0}%", { p0: guildPct })} value={`+ ${int(afterGuild - afterHero)}`} tone="text-emerald-300" />
          {potion && (
            <Step label={t("שיקוי השפע ×2")} value={`+ ${int(afterPotion - afterGuild)}`} tone="text-emerald-300" />
          )}
          {globalMultiplier !== 1 && (
            <Step
              label={t("מכפיל שרת גלובלי ×{p0}", { p0: globalMultiplier })}
              value={`+ ${int(afterGlobal - afterPotion)}`}
              tone="text-gold"
            />
          )}
          <Step label={t("חפץ — תוספת קבועה")} value={`+ ${int(flat)}`} tone="text-gold" />
          <Step label={t("סה״כ לעדכון רגיל")} value={int(total)} strong tone="text-gold-bright" />
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:w-56 lg:grid-cols-1">
          <Result label={t("כל {p0} דקות", { p0: REGULAR_TICK_MINUTES })} value={formatShort(total)} />
          <Result label={t("לשעה")} value={formatShort(total * 12)} tone="text-bone-bright" />
          <Result label={t("ליממה")} value={formatShort(total * 288)} tone="text-emerald-300" />
        </div>
      </div>
    </CalcShell>
  );
}

/* ========================================================================
   2. Battle
   ======================================================================== */

/**
 * Mirrors the resolution in `attackEmpire` exactly: both sides multiply their
 * own troops, the defender additionally by the flat +20% wall bonus, and guild
 * aid is added after every multiplier. Strictly-greater attack power wins.
 */
export function BattleCalc({
  defenseBonus = DEFENSE_BONUS,
  plunderRate = PLUNDER_RATE,
  enslaveRate = ENSLAVE_RATE,
  enslaveMin = ENSLAVE_MIN_SOLDIERS,
}: {
  defenseBonus?: number;
  plunderRate?: number;
  enslaveRate?: number;
  enslaveMin?: number;
}) {
  const t = useT();
  // Defaults deliberately land on a win, so the spoils row below demonstrates
  // plunder and enslavement instead of showing three zeros on first render.
  const [aSoldiers, setASoldiers] = useState(2000);
  const [aWeapons, setAWeapons] = useState(55000);
  const [aHero, setAHero] = useState(25);
  const [aGuild, setAGuild] = useState(0);
  const [aAid, setAAid] = useState(0);

  const [dSoldiers, setDSoldiers] = useState(1800);
  const [dWeapons, setDWeapons] = useState(35000);
  const [dHero, setDHero] = useState(20);
  const [dGuild, setDGuild] = useState(0);
  const [dAid, setDAid] = useState(0);

  const [dGold, setDGold] = useState(500_000);

  const aBase = aSoldiers * SOLDIER_POWER + aWeapons;
  const aAfterHero = aBase * bonusMultiplier(aHero);
  const aAfterGuild = aAfterHero * bonusMultiplier(aGuild);
  const aTotal = aAfterGuild + aAid;

  const dBase = dSoldiers * SOLDIER_POWER + dWeapons;
  const dAfterWall = dBase * defenseBonus;
  const dAfterHero = dAfterWall * bonusMultiplier(dHero);
  const dAfterGuild = dAfterHero * bonusMultiplier(dGuild);
  const dTotal = dAfterGuild + dAid;

  const win = aTotal > dTotal;
  const share = aTotal + dTotal > 0 ? (aTotal / (aTotal + dTotal)) * 100 : 50;
  const plunder = win ? Math.floor(dGold * plunderRate) : 0;
  const enslaved =
    win && dSoldiers >= enslaveMin
      ? Math.min(dSoldiers, Math.max(1, Math.floor(dSoldiers * enslaveRate)))
      : 0;

  return (
    <CalcShell title={t("מחשבון קרב")}>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* attacker */}
        <div className="rounded-xl border border-red-500/25 bg-red-950/15 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-black text-red-300">
            <Icon name="attack" size={15} /> {t("התוקף")}
          </p>
          <div className="grid gap-3">
            <Field label={t("חיילים")} icon="army" value={aSoldiers} onChange={setASoldiers} max={100000} step={10}
              hint={t("{p0} כוח ({p1} לחייל)", { p0: int(aSoldiers * SOLDIER_POWER), p1: SOLDIER_POWER })} />
            <Field label={t("כוח נשקי התקפה")} icon="factory" value={aWeapons} onChange={setAWeapons} max={5_000_000} step={1000} />
            <Field label={t("בונוס גיבור — התקפה")} icon="hero" value={aHero} onChange={setAHero} max={300} suffix="%" />
            <Field label={t("קסם ברית — התקפה")} icon="guild" value={aGuild} onChange={setAGuild} max={30} suffix="%" />
            <Field label={t("עזרת ברית (כוח קבוע)")} icon="shield" value={aAid} onChange={setAAid} max={1_000_000} step={1000} />
          </div>
        </div>

        {/* defender */}
        <div className="rounded-xl border border-sky-500/25 bg-sky-950/15 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-black text-sky-300">
            <Icon name="shield" size={15} /> {t("המגן")}
          </p>
          <div className="grid gap-3">
            <Field label={t("חיילים")} icon="army" value={dSoldiers} onChange={setDSoldiers} max={100000} step={10}
              hint={t("{p0} כוח ({p1} לחייל)", { p0: int(dSoldiers * SOLDIER_POWER), p1: SOLDIER_POWER })} />
            <Field label={t("כוח נשקי הגנה")} icon="factory" value={dWeapons} onChange={setDWeapons} max={5_000_000} step={1000} />
            <Field label={t("בונוס גיבור — הגנה")} icon="hero" value={dHero} onChange={setDHero} max={300} suffix="%" />
            <Field label={t("קסם ברית — הגנה")} icon="guild" value={dGuild} onChange={setDGuild} max={30} suffix="%" />
            <Field label={t("עזרת ברית (כוח קבוע)")} icon="shield" value={dAid} onChange={setDAid} max={1_000_000} step={1000} />
          </div>
        </div>
      </div>

      {/* the two derivations, side by side */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="panel-inset rounded-xl px-3 py-2">
          <Step label={t("חיילים + נשקי התקפה")} value={int(aBase)} />
          <Step label={t("גיבור +{p0}%", { p0: aHero })} value={`+ ${int(aAfterHero - aBase)}`} tone="text-purple-300" />
          <Step label={t("ברית +{p0}%", { p0: aGuild })} value={`+ ${int(aAfterGuild - aAfterHero)}`} tone="text-emerald-300" />
          <Step label={t("עזרת ברית")} value={`+ ${int(aAid)}`} tone="text-emerald-300" />
          <Step label={t("כוח התקפה סופי")} value={int(aTotal)} strong tone="text-red-300" />
        </div>
        <div className="panel-inset rounded-xl px-3 py-2">
          <Step label={t("חיילים + נשקי הגנה")} value={int(dBase)} />
          <Step
            label={t("בונוס מגן +{p0}%", { p0: Math.round((defenseBonus - 1) * 100) })}
            value={`+ ${int(dAfterWall - dBase)}`}
            tone="text-sky-300"
          />
          <Step label={t("גיבור +{p0}%", { p0: dHero })} value={`+ ${int(dAfterHero - dAfterWall)}`} tone="text-purple-300" />
          <Step label={t("ברית +{p0}%", { p0: dGuild })} value={`+ ${int(dAfterGuild - dAfterHero)}`} tone="text-emerald-300" />
          <Step label={t("עזרת ברית")} value={`+ ${int(dAid)}`} tone="text-emerald-300" />
          <Step label={t("כוח הגנה סופי")} value={int(dTotal)} strong tone="text-sky-300" />
        </div>
      </div>

      {/* the duel bar + verdict */}
      <div className="mt-4">
        <div className="flex h-3 overflow-hidden rounded-full border border-border-subtle bg-black/60">
          <span className="bg-gradient-to-l from-red-500 to-red-700" style={{ width: `${share}%` }} />
          <span className="flex-1 bg-gradient-to-r from-sky-500 to-sky-700" />
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-bold">
          <span className="text-red-300">
            {t("תוקף {pct}%", { pct: share.toFixed(1) })}
          </span>
          <span className="text-sky-300">
            {t("מגן {pct}%", { pct: (100 - share).toFixed(1) })}
          </span>
        </div>
      </div>

      <div
        className={`mt-3 rounded-xl border px-4 py-3 text-center text-sm font-black ${
          win
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-red-500/40 bg-red-500/10 text-red-300"
        }`}
      >
        {win ? t("התקיפה מצליחה — ההגנה נפרצת") : t("התקיפה נהדפת — המגן מחזיק")}
        <span className="mx-2 text-zinc-500">|</span>
        <span className="nums" dir="ltr">
          {int(aTotal)} {win ? ">" : "≤"} {int(dTotal)}
        </span>
      </div>

      {/* spoils */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <Field label={t("זהב זמין אצל המגן")} icon="gold" value={dGold} onChange={setDGold} max={100_000_000} step={10_000}
            hint={t("מה שבמחסן מוגן ולא נבזז")} />
        </div>
        <Result
          label={t("ביזת זהב ({p0}%)", { p0: Math.round(plunderRate * 100) })}
          value={formatShort(plunder)}
          sub={win ? t("מכל משאב בנפרד") : t("אין ביזה בהפסד")}
        />
        <Result
          label={t("חיילים שנשבים")}
          value={int(enslaved)}
          sub={
            dSoldiers < enslaveMin
              ? t("דורש {min}+ חיילים למגן", { min: enslaveMin })
              : t("מצטרפים כעבדי מכרות")
          }
          tone="text-bone-bright"
        />
      </div>
    </CalcShell>
  );
}

/* ========================================================================
   3. Spy
   ======================================================================== */

/** Mirrors `spyOnEmpire`: a deterministic comparison of intelligence power. */
export function SpyCalc() {
  const t = useT();
  const [aSpies, setASpies] = useState(300);
  const [aWeapons, setAWeapons] = useState(8000);
  const [aIntel, setAIntel] = useState(8);
  const [aHero, setAHero] = useState(15);
  const [aGuild, setAGuild] = useState(0);

  const [dSpies, setDSpies] = useState(250);
  const [dWeapons, setDWeapons] = useState(6000);
  const [dIntel, setDIntel] = useState(6);

  const aRaw = aSpies * SPY_POWER + aWeapons;
  const aMult = intelligencePowerMultiplier(aIntel) + (aHero + aGuild) / 100;
  const aTotal = aRaw * aMult;

  const dRaw = dSpies * SPY_POWER + dWeapons;
  const dMult = intelligencePowerMultiplier(dIntel);
  const dTotal = dRaw * dMult;

  const success = aTotal > dTotal;

  return (
    <CalcShell title={t("מחשבון ריגול")}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-purple-500/25 bg-purple-950/15 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-black text-purple-300">
            <Icon name="spy" size={15} /> {t("המרגל")}
          </p>
          <div className="grid gap-3">
            <Field label={t("מרגלים")} icon="spy" value={aSpies} onChange={setASpies} max={50000} step={5}
              hint={t("{p0} כוח ({p1} למרגל)", { p0: int(aSpies * SPY_POWER), p1: SPY_POWER })} />
            <Field label={t("כוח נשקי ריגול")} icon="factory" value={aWeapons} onChange={setAWeapons} max={2_000_000} step={500} />
            <Field label={t("רמת שדרוג מודיעין")} icon="upgrades" value={aIntel} onChange={setAIntel} max={15}
              hint={t("מכפיל ×{p0}", { p0: intelligencePowerMultiplier(aIntel).toFixed(1) })} />
            <Field label={t("בונוס גיבור — ריגול")} icon="hero" value={aHero} onChange={setAHero} max={200} suffix="%" />
            <Field label={t("קסם ברית — ריגול")} icon="guild" value={aGuild} onChange={setAGuild} max={30} suffix="%" />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-500/25 bg-zinc-900/30 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-black text-zinc-300">
            <Icon name="shield" size={15} /> {t("היעד")}
          </p>
          <div className="grid gap-3">
            <Field label={t("מרגלים")} icon="spy" value={dSpies} onChange={setDSpies} max={50000} step={5} />
            <Field label={t("כוח נשקי ריגול")} icon="factory" value={dWeapons} onChange={setDWeapons} max={2_000_000} step={500} />
            <Field label={t("רמת שדרוג מודיעין")} icon="upgrades" value={dIntel} onChange={setDIntel} max={15}
              hint={t("מכפיל ×{p0}", { p0: intelligencePowerMultiplier(dIntel).toFixed(1) })} />
          </div>
          <p className="mt-3 rounded-lg bg-black/40 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-500">
            {t(
              "ליעד אין בונוס גיבור או קסם בהגנה מפני ריגול — רק מרגלים, נשקי ריגול ושדרוג המודיעין שלו."
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="panel-inset rounded-xl px-3 py-2">
          <Step label={t("מרגלים + נשקי ריגול")} value={int(aRaw)} />
          <Step label={t("מכפיל: 1 + {p0}×0.1 + {p1}%", { p0: aIntel, p1: aHero + aGuild })} value={`×${aMult.toFixed(2)}`} tone="text-purple-300" />
          <Step label={t("כוח מודיעין תוקף")} value={int(aTotal)} strong tone="text-purple-300" />
        </div>
        <div className="panel-inset rounded-xl px-3 py-2">
          <Step label={t("מרגלים + נשקי ריגול")} value={int(dRaw)} />
          <Step label={t("מכפיל: 1 + {p0}×0.1", { p0: dIntel })} value={`×${dMult.toFixed(2)}`} tone="text-zinc-300" />
          <Step label={t("כוח מודיעין יעד")} value={int(dTotal)} strong tone="text-zinc-300" />
        </div>
      </div>

      <div
        className={`mt-3 rounded-xl border px-4 py-3 text-center text-sm font-black ${
          success
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-red-500/40 bg-red-500/10 text-red-300"
        }`}
      >
        {success ? t("המשימה מצליחה — הדוח נפתח") : t("המרגל נתפס — היעד מקבל התראה")}
        <span className="mx-2 text-zinc-500">|</span>
        <span className="nums" dir="ltr">
          {int(aTotal)} {success ? ">" : "≤"} {int(dTotal)}
        </span>
      </div>
    </CalcShell>
  );
}

/* ========================================================================
   4. Bank
   ======================================================================== */

/** Mirrors the interest loop in `applyPendingUpdates` — floored, compounding. */
export function BankCalc() {
  const t = useT();
  const [balance, setBalance] = useState(1_000_000);
  const [level, setLevel] = useState(10);
  const [days, setDays] = useState(7);

  const rate = bankInterestRate(level);
  const updates = days * 2;
  const { final, history } = useMemo(() => {
    let b = balance;
    const points: number[] = [b];
    for (let i = 0; i < updates; i++) {
      b += Math.floor(b * rate);
      points.push(b);
    }
    return { final: b, history: points };
  }, [balance, rate, updates]);

  const max = history[history.length - 1] || 1;

  return (
    <CalcShell title={t("מחשבון ריבית בנק")}>
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
        <Field label={t("זהב מופקד")} icon="bank" value={balance} onChange={setBalance} max={1_000_000_000} step={10_000} />
        <Field label={t("רמת שדרוג ריבית")} icon="upgrades" value={level} onChange={setLevel} max={BANK_DAILY_INTEREST_MAX_LEVEL}
          hint={t("{p0}% בכל עדכון יומי", { p0: Math.round(rate * 100) })} />
        <Field label={t("ימים")} icon="turns" value={days} onChange={setDays} min={1} max={60}
          hint={t("{p0} עדכונים יומיים (2 ליום)", { p0: updates })} />
      </div>

      {/* compounding curve */}
      <div className="mt-4 flex h-24 items-end gap-[2px] rounded-xl bg-black/40 p-2">
        {history.map((v, i) => (
          <span
            key={i}
            className="flex-1 rounded-t bg-gradient-to-t from-gold-deep to-gold-bright"
            style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
            title={t("עדכון {p0}: {p1}", { p0: i, p1: int(v) })}
          />
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Result label={t("יתרה בסוף התקופה")} value={formatShort(final)} />
        <Result label={t("רווח מריבית")} value={`+${formatShort(final - balance)}`} tone="text-emerald-300" />
        <Result
          label={t("גידול")}
          value={`×${(final / Math.max(1, balance)).toFixed(2)}`}
          sub={t("{p0}% × {p1} עדכונים, בריבית דריבית", { p0: Math.round(rate * 100), p1: updates })}
          tone="text-bone-bright"
        />
      </div>
    </CalcShell>
  );
}

/* ========================================================================
   5. Hero XP
   ======================================================================== */

/** Mirrors `attackWinXp` + `applyHeroXp`, including the class and potion multipliers. */
export function HeroXpCalc() {
  const t = useT();
  const [level, setLevel] = useState(20);
  const [resets, setResets] = useState(0);
  const [foeLevel, setFoeLevel] = useState(25);
  const [foeResets, setFoeResets] = useState(0);
  const [ownPower, setOwnPower] = useState(120_000);
  const [foePower, setFoePower] = useState(90_000);
  const [shadow, setShadow] = useState(false);
  const [potion, setPotion] = useState(false);

  const ownEff = effectiveHeroLevel(level, resets);
  const foeEff = effectiveHeroLevel(foeLevel, foeResets);
  const base = 40 + level * 10;
  const gap = levelGapXpFactor(ownEff, foeEff);
  const resetGap = resetGapXpFactor(resets, foeResets);
  const matchup = matchupXpFactor(ownPower, foePower);
  const raw = Math.round(base * gap * resetGap * matchup);
  const withClass = Math.round(raw * (shadow ? 1.1 : 1));
  const gain = withClass * (potion ? 2 : 1);

  const need = xpToNextLevel(level);
  const wins = gain > 0 ? Math.ceil(need / gain) : 0;

  return (
    <CalcShell title={t("מחשבון ניסיון גיבור")}>
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label={t("רמת הגיבור שלך")} icon="hero" value={level} onChange={setLevel} min={1} max={99}
          hint={t("דרושות {p0} נק׳ ניסיון לרמה הבאה", { p0: int(need) })} />
        <Field label={t("האיפוסים שלך (↻)")} icon="crown" value={resets} onChange={setResets} max={20}
          hint={t("רמה אפקטיבית {p0}", { p0: int(ownEff) })} />
        <Field label={t("רמת גיבור היריב")} icon="hero" value={foeLevel} onChange={setFoeLevel} min={1} max={100} />
        <Field label={t("איפוסי היריב (↻)")} icon="crown" value={foeResets} onChange={setFoeResets} max={20}
          hint={
            resetGap < 1
              ? t("רמה אפקטיבית {p0} — פער ×{p1}, פער איפוסים ×{p2}", { p0: int(foeEff), p1: gap.toFixed(2), p2: resetGap.toFixed(2) })
              : t("רמה אפקטיבית {p0} — פער ×{p1}, איפוסים מלאים", { p0: int(foeEff), p1: gap.toFixed(2) })
          } />
        <Field label={t("כוח התקפה שלך")} icon="attack" value={ownPower} onChange={setOwnPower} max={50_000_000} step={5000} />
        <Field label={t("כוח הגנת היריב")} icon="shield" value={foePower} onChange={setFoePower} max={50_000_000} step={5000}
          hint={t("יחס קרב ×{p0}", { p0: matchup.toFixed(2) })} />
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-purple-300">
          <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} className="h-4 w-4 accent-purple-500" />
          {t("מקצוע הצל (+10% ניסיון)")}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-gold-bright">
          <input type="checkbox" checked={potion} onChange={(e) => setPotion(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          <Icon name="potion" size={14} /> {t("שיקוי הניסיון (×2)")}
        </label>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="panel-inset rounded-xl px-3 py-2">
          <Step label={t("בסיס — 40 + {p0}×10", { p0: level })} value={int(base)} />
          <Step label={t("פער רמות ×{p0}", { p0: gap.toFixed(2) })} value={`= ${int(base * gap)}`} tone="text-purple-300" />
          {resetGap < 1 && (
            <Step label={t("פער איפוסים ×{p0}", { p0: resetGap.toFixed(2) })} value={`= ${int(base * gap * resetGap)}`} tone="text-red-300" />
          )}
          <Step label={t("יחס קרב ×{p0}", { p0: matchup.toFixed(2) })} value={`= ${int(raw)}`} tone="text-sky-300" />
          {shadow && <Step label={t("מקצוע הצל ×1.1")} value={`= ${int(withClass)}`} tone="text-purple-300" />}
          {potion && <Step label={t("שיקוי הניסיון ×2")} value={`= ${int(gain)}`} tone="text-gold" />}
          <Step label={t("ניסיון לניצחון אחד")} value={int(gain)} strong tone="text-gold-bright" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:w-56 lg:grid-cols-1">
          <Result label={t("ניסיון לניצחון")} value={int(gain)} />
          <Result label={t("ניצחונות לרמה הבאה")} value={int(wins)} tone="text-emerald-300" sub={t("{p0} נק׳ ניסיון", { p0: int(need) })} />
        </div>
      </div>
      {/* One key, not nine fragments around eight <span>s: the formulas move
          around inside the English sentence, and a fragment on its own cannot
          be translated. The spans come back through RichText's `**…**`. */}
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        <RichText
          text={t(
            "פער הרמות נגזר מ־**0.25 + (רמה אפקטיבית של היריב ÷ שלך) × 0.75** ונחסם בטווח **0.25–2.5**. רמה אפקטיבית = רמה + איפוסים × **100**, ולכן יריב ברמה 1 אחרי איפוס אחד נחשב רמה **101** ומשלם בהתאם. פער האיפוסים הוא שער נפרד: יריב עם מספר האיפוסים שלך או יותר משלם מלא, וכל איפוס שאתה מעליו חותך את הניסיון בחצי עד רצפה של **0.05** — אחרי איפוס מטפסים מחדש מול בני המשקל שלך. יחס הקרב נגזר מ־**0.3 + ∛(כוח היריב ÷ כוחך) × 1.4** ונחסם בטווח **0.3–2.0** — לרמוס יריב חלש משתלם פחות מלנצח יריב שקול, וניצחון על חזק ממך משלם הכי הרבה. השורש נמצא שם כי הכוח במשחק גדל בקפיצות מסדרי גודל: בלעדיו כמעט כל קרב אמיתי נפל על רצפת ה־**0.3**."
          )}
          strong="nums font-semibold text-zinc-400"
        />
      </p>
    </CalcShell>
  );
}

/* ========================================================================
   6. Item upgrade ladder
   ======================================================================== */

// i18n-keys-start: dictionary keys, drawn through t(PERCENT_SLOTS.attack) below
const PERCENT_SLOTS: Record<HeroPercentStat, string> = {
  attack: "התקפה",
  defense: "הגנה",
  spy: "ריגול",
};
// i18n-keys-end

/** Mirrors `itemUpgradeCost` — the geometric ladder from 3M to 700B. */
export function ItemUpgradeCalc() {
  const t = useT();
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(19);

  const from = UPGRADE_LEVELS[Math.min(fromIdx, UPGRADE_LEVELS.length - 1)];
  const to = UPGRADE_LEVELS[Math.max(toIdx, fromIdx)];

  // Gold only buys the rungs *inside* a set. An אגדי has nothing to upgrade
  // into, so a range that crosses a decade is not a price at all — it is a price
  // plus that many pieces of loot, and the calculator says so rather than
  // quietly charging for a step no player can buy.
  const { total, steps, setJumps } = useMemo(() => {
    let sum = 0;
    let count = 0;
    let jumps = 0;
    for (const lvl of UPGRADE_LEVELS) {
      if (lvl < from || lvl >= to) continue;
      const cost = itemUpgradeCost(lvl);
      if (cost === null) jumps += 1;
      else {
        sum += cost;
        count += 1;
      }
    }
    return { total: sum, steps: count, setJumps: jumps };
  }, [from, to]);

  const nextCost = itemUpgradeCost(from);
  const rarity = tierForLevel(to);
  const swordBonus = itemPrimaryBonus("SWORD", to).value;
  const relicBonus = itemPrimaryBonus("RELIC", to).value;
  const bootsBonus = itemPrimaryBonus("BOOTS", to).value;

  return (
    <CalcShell title={t("מחשבון שדרוג חפצים")}>
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field
          label={t("מרמת חפץ")}
          icon="spark"
          value={fromIdx}
          onChange={(v) => {
            setFromIdx(v);
            if (v > toIdx) setToIdx(v);
          }}
          max={UPGRADE_LEVELS.length - 1}
          hint={t("רמה {p0} · {p1} · דרגה {p2}/40", { p0: from, p1: RARITY_META[tierForLevel(from)].label, p2: upgradeStep(from) })}
        />
        <Field
          label={t("עד רמת חפץ")}
          icon="spark"
          value={toIdx}
          onChange={(v) => setToIdx(Math.max(v, fromIdx))}
          min={0}
          max={UPGRADE_LEVELS.length - 1}
          hint={t("רמה {p0} · {p1} · דרגה {p2}/40", { p0: to, p1: RARITY_META[rarity].label, p2: upgradeStep(to) })}
        />
      </div>

      {setJumps > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-amber-300/90">
          <RichText
            text={t(
              "⚠ המסלול חוצה **{jumps}** מעברי סט. אגדי הוא שיא הסט שלו ואי אפשר לשדרג אותו — החפץ של הסט הבא נופל כשלל בקרב. העלות למטה היא רק של השדרוגים שאפשר לקנות בזהב.",
              { jumps: setJumps }
            )}
            strong="nums font-bold text-amber-200"
          />
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Result
          label={t("מחיר השדרוג הבא")}
          value={nextCost ? formatShort(nextCost) : "—"}
          sub={nextCost ? t("זהב") : t("אגדי — שיא הסט")}
        />
        <Result label={t("עלות כוללת ({p0} שדרוגים)", { p0: steps })} value={formatShort(total)} sub={t("זהב")} tone="text-bone-bright" />
        <Result
          label={t("הבונוס ברמה {p0}", { p0: to })}
          value={`+${swordBonus}%`}
          sub={t("חרב · {slot}", { slot: t(PERCENT_SLOTS.attack) })}
          tone="text-emerald-300"
        />
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="panel-inset rounded-lg px-3 py-2">
          <p className="text-[10px] text-zinc-500">
            {t("{slot} (משאבים — ראשי)", { slot: t(SLOT_META.RELIC.label) })}
          </p>
          <p className="font-black text-gold-bright nums" dir="ltr">+{relicBonus}</p>
          <p className="text-[10px] text-zinc-500">{t("משאבים בכל עדכון רגיל")}</p>
        </div>
        <div className="panel-inset rounded-lg px-3 py-2">
          <p className="text-[10px] text-zinc-500">
            {t("{slot} (אזרחים — ראשי)", { slot: t(SLOT_META.BOOTS.label) })}
          </p>
          <p className="font-black text-gold-bright nums" dir="ltr">+{bootsBonus}</p>
          <p className="text-[10px] text-zinc-500">{t("אזרחים בכל עדכון יומי")}</p>
        </div>
        <div className="panel-inset rounded-lg px-3 py-2">
          <p className="text-[10px] text-zinc-500">
            {t("{slot} (תורות — ראשי)", { slot: t(SLOT_META.WINGS.label) })}
          </p>
          <p className="font-black text-gold-bright nums" dir="ltr">
            +{itemPrimaryBonus("WINGS", to).value}
          </p>
          <p className="text-[10px] text-zinc-500">{t("תורות בכל עדכון יומי")}</p>
        </div>
      </div>
    </CalcShell>
  );
}

/* ========================================================================
   7. City-boss ladder
   ======================================================================== */

/** The ten bosses, with rewards recomputed live for a chosen season day. */
export function BossLadder({
  powerMultiplier = 1,
  rewardMultiplier = 1,
  hpMultiplier = 1,
  slaveMultiplier = 1,
  heroXpMultiplier = 1,
}: {
  powerMultiplier?: number;
  rewardMultiplier?: number;
  hpMultiplier?: number;
  slaveMultiplier?: number;
  heroXpMultiplier?: number;
}) {
  const t = useT();
  const [day, setDay] = useState(1);
  // The second field turns the ladder from a table into an answer: type in your
  // own attack power and every row says how many sorties that army needs.
  const [myPower, setMyPower] = useState(12_000);

  return (
    <div className="space-y-3">
      <div className="panel-gold grid gap-3 rounded-xl p-4 sm:grid-cols-2">
        <Field
          label={t("יום בעונה")}
          icon="turns"
          value={day}
          onChange={setDay}
          min={1}
          max={90}
          hint={t("השלל גדל ב־20% מהבסיס בכל יום שעובר בעונה")}
        />
        <Field
          label={t("כוח התקיפה שלך")}
          icon="attack"
          value={myPower}
          onChange={setMyPower}
          min={0}
          max={1e12}
          hint={t("חיילים + נשקי תקיפה, אחרי בונוסי גיבור וברית")}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
        {CITY_BOSSES.map((boss) => {
          const reward = bossReward(boss.tier, day, rewardMultiplier, slaveMultiplier);
          const maxHp = bossSiegeMaxHp(boss.tier, powerMultiplier, hpMultiplier);
          const sorties = bossSortiesToKill(myPower, maxHp);
          return (
            <article
              key={boss.key}
              className="relative overflow-hidden rounded-xl border p-3"
              style={{
                borderColor: `rgb(${boss.accent} / 0.35)`,
                background: `linear-gradient(270deg, rgb(${boss.accent} / 0.10), rgba(10,9,12,0.85) 60%)`,
              }}
            >
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/boss/${boss.key}.jpg`}
                  alt={t(boss.name)}
                  loading="lazy"
                  className="h-24 w-20 shrink-0 rounded-lg object-cover"
                  style={{ boxShadow: `0 0 24px -8px rgb(${boss.accent} / 0.9)` }}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5">
                    <span className="rounded bg-black/50 px-1.5 text-[10px] font-black text-bone nums">
                      {t("עיר {tier}", { tier: boss.tier })}
                    </span>
                    <span className="truncate font-black" style={{ color: `rgb(${boss.accent})` }}>
                      {t(boss.name)}
                    </span>
                  </p>
                  <p className="text-[11px] text-zinc-400">{t(boss.title)}</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                    <span className="flex items-center gap-1 text-red-300">
                      <Icon name="attack" size={12} /> {t("כוח")}
                      <b className="nums" dir="ltr">{formatShort(bossPower(boss.tier, powerMultiplier))}</b>
                    </span>
                    <span className="flex items-center gap-1 text-emerald-300">
                      <Icon name="turns" size={12} /> {t("תורות")}
                      <b className="nums" dir="ltr">{int(bossTurnCost(boss.tier))}</b>
                    </span>
                    <span className="flex items-center gap-1 text-gold-bright">
                      <Icon name="gold" size={12} /> {t("שלל למנה")}
                      <b className="nums" dir="ltr">{formatShort(reward.gold)}</b>
                    </span>
                    <span className="flex items-center gap-1 text-bone-bright">
                      <Icon name="heart" size={12} /> {t("מנה לשחקן")}
                      <b className="nums" dir="ltr">{formatShort(maxHp)}</b>
                    </span>
                    <span className="flex items-center gap-1 text-sky-300">
                      <Icon name="army" size={12} /> {t("יציאות למנה")}
                      <b className="nums" dir="ltr">
                        {Number.isFinite(sorties) ? sorties : "—"}
                      </b>
                    </span>
                    <span className="flex items-center gap-1 text-purple-300">
                      <Icon name="spark" size={12} /> {t("ניסיון")}
                      <b className="nums" dir="ltr">{int(bossHeroXp(boss.tier, heroXpMultiplier))}</b>
                    </span>
                  </div>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{t(boss.lore)}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
