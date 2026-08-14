import type { ReactNode } from "react";
import {
  HERO_CADENCE_META,
  HERO_CADENCE_ORDER,
  HERO_FLAT_CADENCE,
  HERO_STAT_META,
  UPDATES_PER_DAY,
  flatStatPerDay,
  flatStatsWithCadence,
  type HeroBonuses,
  type HeroFlatCadence,
  type HeroFlatStat,
  type HeroPowerStat,
  type HeroStat,
} from "@/lib/game/hero";
import {
  DAILY_UPDATE_TIMES,
  REGULAR_TICK_MINUTES,
  RESOURCE_META,
  type StorableResource,
} from "@/lib/game/constants";
import { formatBonus, formatNumber } from "@/lib/game/format";
import { Tip } from "@/components/ui/Tip";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { getT, type T } from "@/i18n/server";

/**
 * "סך הכל מהגיבור" — the combined yield the player actually gets from the hero,
 * points and equipped items together. Each line reads left-to-right value ↔
 * right-to-left label so the numbers align in a single detailed column.
 *
 * The flat yield is grouped **by when it is actually paid**, not by what it is:
 * one block per cadence, in HERO_CADENCE_ORDER, each headed with the clock it
 * runs on (every 5 minutes / twice a day / inside a battle) and each line
 * carrying what it adds up to over a day. The grouping is read straight off
 * `HERO_FLAT_CADENCE` — the same table `applyPendingUpdates` pays from — so this
 * screen cannot promise a cadence the settlement does not honour. That drift is
 * exactly what happened when turns were paid daily while the tooltips said
 * otherwise, and it is the reason the schedule is derived rather than written.
 */

/** One detailed stat line: icon + label + breakdown note on the right, value on the left. */
function StatRow({
  t,
  stat,
  value,
  suffix,
  note,
  // Percentages carry decimals on low-rung gear (+0.25%), so they go through
  // formatBonus rather than being interpolated raw.
  format = (v) => `+${formatBonus(v)}`,
}: {
  t: T;
  stat: HeroStat;
  value: number;
  /** "%" for percentage stats, unit word for flat stats. */
  suffix?: string;
  note: string;
  format?: (v: number) => string;
}) {
  const meta = HERO_STAT_META[stat];
  const active = value > 0;
  return (
    <Tip className="w-full" tip={<>{t(meta.description)}<br />{note}</>}>
      <div
        className={`flex w-full cursor-help items-center justify-between gap-3 rounded-lg p-2.5 ${
          active ? "panel" : "panel-inset opacity-60"
        }`}
      >
        <div className="min-w-0 text-right">
          <p className="text-sm font-bold text-zinc-200">
            <Icon name={meta.icon} size={14} className="inline align-[-2px]" /> {t(meta.label)}
          </p>
          <p className="text-[11px] leading-tight text-zinc-500">{note}</p>
        </div>
        <p
          className={`nums shrink-0 whitespace-nowrap text-xl font-black ${
            active ? meta.tone : "text-zinc-600"
          }`}
          dir="ltr"
        >
          {format(value)}
          {suffix && <span className="ms-0.5 text-xs font-bold opacity-70">{suffix}</span>}
        </p>
      </div>
    </Tip>
  );
}

/**
 * The resources row is a hybrid: unlike every other stat, its yield comes from
 * two different sources in two different units — a **percentage** from allocated
 * points (which multiplies mine output) and a **flat amount** from the equipped
 * relic (added to specific resources each tick). We show both, each with its own
 * source label, so the player sees exactly where the +59% and the +64 come from
 * (matching the per-resource breakdown on the mines page).
 */
function ResourcesRow({
  t,
  pointsPct,
  classPct = 0,
  itemPct = 0,
  itemFlat,
  itemNote,
}: {
  t: T;
  /** % from allocated resource points — multiplies mine production. */
  pointsPct: number;
  /** % from the chosen hero class (הסוחר) — multiplies mine production too. */
  classPct?: number;
  /** % from the percent-paying resource items (חרב, מגן) — multiplies mines. */
  itemPct?: number;
  /** Flat resource units the flat resource items conjure each regular tick. */
  itemFlat: number;
  /** Which resources the flat items feed (or a hint when none equipped). */
  itemNote: ReactNode;
}) {
  const meta = HERO_STAT_META.resources;
  const totalPctValue = pointsPct + classPct + itemPct;
  const active = totalPctValue > 0 || itemFlat > 0;
  return (
    <Tip
      className="w-full"
      tip={
        <>
          {t(meta.description)}
          <br />
          {t("האחוזים מכפילים את תפוקת המכרות; הכמות הקבועה נוספת מעליה בכל עדכון רגיל.")}
        </>
      }
    >
      <div
        className={`flex w-full cursor-help items-center justify-between gap-3 rounded-lg p-2.5 ${
          active ? "panel" : "panel-inset opacity-60"
        }`}
      >
        <div className="min-w-0 text-right">
          <p className="text-sm font-bold text-zinc-200">
            <Icon name={meta.icon} size={14} className="inline align-[-2px]" /> {t(meta.label)}
          </p>
          <div className="nums mt-0.5 space-y-0.5 text-[11px] leading-tight text-zinc-500">
            {pointsPct > 0 && (
              <p>{t("נקודות +{pct}% — מכפיל תפוקת מכרות", { pct: pointsPct })}</p>
            )}
            {classPct > 0 && <p>{t("דמות +{pct}% — יתרון הסוחר", { pct: classPct })}</p>}
            {itemPct > 0 && (
              <p>{t("חרב ומגן +{pct}% — מכפיל תפוקת מכרות", { pct: itemPct })}</p>
            )}
            {itemFlat > 0 ? (
              <p>
                {t("כמות קבועה +{flat} —", { flat: formatNumber(itemFlat) })} {itemNote}
              </p>
            ) : (
              totalPctValue === 0 && <p>{itemNote}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-left" dir="ltr">
          {totalPctValue > 0 && (
            <p className={`nums whitespace-nowrap text-xl font-black ${meta.tone}`}>
              +{totalPctValue}
              <span className="ms-0.5 text-xs font-bold opacity-70">%</span>
            </p>
          )}
          {itemFlat > 0 && (
            <p
              className={`nums whitespace-nowrap font-black ${
                totalPctValue > 0 ? "text-sm" : "text-xl"
              } ${meta.tone}`}
            >
              +{formatNumber(itemFlat)}
            </p>
          )}
          {!active && <p className="nums text-xl font-black text-zinc-600">+0</p>}
        </div>
      </div>
    </Tip>
  );
}

function SectionLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  /** The clock this group runs on — the whole point of the grouping. */
  hint?: React.ReactNode;
}) {
  return (
    <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[10px] font-bold uppercase tracking-widest text-gold-dim">
      {children}
      {hint && (
        <span className="normal-case tracking-normal text-zinc-500">{hint}</span>
      )}
    </p>
  );
}

export async function HeroPowerSummary({ bonuses }: { bonuses: HeroBonuses }) {
  const t = await getT();
  const { points, itemsPct, itemsResourcePct, itemsFlat, itemsFlatByResource, classPct, totalPct } =
    bonuses;

  /**
   * The breakdown note lists only the sources that actually pay out — a
   * "חפצים +0%" term is noise the player has to read past, so zero terms are
   * dropped. When nothing contributes at all the row falls back to a hint about
   * where the bonus would come from.
   */
  const bonusNote = (parts: [string, number][], empty: string) => {
    const paying = parts.filter(([, pct]) => pct > 0);
    return paying.length > 0
      ? paying.map(([label, pct]) => `${label} +${formatBonus(pct)}%`).join(" · ")
      : empty;
  };

  // A flat resource item (פרי שטן, מכנסיים, נעליים) feeds only the specific
  // resources its tier covers — one for a פשוט piece, up to all four for an
  // אגדי. Name exactly those, so the flat "resources" line never overstates its
  // reach as "every resource". (חרב and מגן pay a percentage instead and
  // multiply every mine, so they never appear here — see SlotStatWeight.)
  const coveredResources = (["gold", "wood", "iron", "stone"] as StorableResource[]).filter(
    (r) => itemsFlatByResource[r] > 0
  );
  const resourcesNote =
    coveredResources.length > 0 ? (
      <>
        {coveredResources.map((r, i) => (
          <span key={r} className="inline-flex items-center gap-1">
            {i > 0 && <span className="mx-0.5">·</span>}
            <Icon
              name={RESOURCE_ICON[r]}
              size={11}
              className={RESOURCE_ICON_COLOR[r]}
            />
            {t(RESOURCE_META[r].label)}
          </span>
        ))}{" "}
        {t("— בכל עדכון רגיל")}
      </>
    ) : (
      t("מפרי שטן, מכנסיים או נעליים — המשאבים לפי דרגת החפץ")
    );

  // התקפה/הגנה = נקודות + חפצים; ריגול מגיע מחפצים בלבד.
  const percentRows: { stat: HeroStat; value: number; note: string }[] = [
    {
      stat: "attack",
      value: totalPct.attack,
      note: bonusNote(
        [
          [t("נקודות"), points.attack],
          [t("חפצים"), itemsPct.attack],
          [t("דמות"), classPct.attack],
        ],
        t("מנקודות התקפה ומחפצים לבושים")
      ),
    },
    {
      stat: "defense",
      value: totalPct.defense,
      note: bonusNote(
        [
          [t("נקודות"), points.defense],
          [t("חפצים"), itemsPct.defense],
          [t("דמות"), classPct.defense],
        ],
        t("מנקודות הגנה ומחפצים לבושים")
      ),
    },
    {
      stat: "spy",
      value: totalPct.spy,
      note: bonusNote(
        [
          [t("חפצים"), itemsPct.spy],
          [t("דמות"), classPct.spy],
        ],
        t("מחפצי ריגול לבושים בלבד")
      ),
    },
  ];

  /* -------- the flat yield, grouped by the clock it arrives on --------

     Two clocks and a battle. The headings say which is which, and every line on
     a clock states what it comes to over a day — the only figure that makes 5
     turns per tick and 450 citizens per daily update comparable numbers. */

  const hoursBetweenDailies = 24 / DAILY_UPDATE_TIMES.length;
  const cadenceHint = (cadence: HeroFlatCadence) =>
    cadence === "regular"
      ? t("כל {minutes} דקות", { minutes: REGULAR_TICK_MINUTES })
      : cadence === "daily"
        ? t("פעמיים ביום — כל {hours} שעות", { hours: hoursBetweenDailies })
        : t("לא על השעון");

  // What a line on a clock is worth over a day. A stat the hero does not carry
  // yet falls back to the plain cadence note, so the row still says when it
  // *would* arrive rather than advertising "0 ביום".
  const cadenceNote = (stat: HeroFlatStat, value: number): string => {
    const cadence = HERO_FLAT_CADENCE[stat];
    const perDay = flatStatPerDay(stat, value);
    if (perDay === null || value <= 0) return t(HERO_CADENCE_META[cadence].note);
    return t("×{updates} עדכונים = {perDay} ביום", {
      updates: formatNumber(UPDATES_PER_DAY[cadence]),
      perDay: formatNumber(perDay),
    });
  };

  // The three power stats never touch a clock: they are counted inside the fight,
  // beside the soldiers and the weapons, so every percentage above them in this
  // panel multiplies them too.
  const BATTLE_NOTE: Record<HeroPowerStat, string> = {
    attackPower: t("נספר עם החיילים והנשקים בתקיפה"),
    defensePower: t("נספר עם החיילים והנשקים בהגנה"),
    spyPower: t("נספר עם המרגלים בכל משימת ריגול"),
  };

  const flatRow = (stat: HeroFlatStat): { stat: HeroStat; value: number; note: string } => ({
    stat,
    value: itemsFlat[stat],
    note:
      HERO_FLAT_CADENCE[stat] === "battle"
        ? BATTLE_NOTE[stat as HeroPowerStat]
        : cadenceNote(stat, itemsFlat[stat]),
  });

  // Resources are the one stat with two instruments (a % that multiplies the
  // mines and a flat amount added over it), so their row is bespoke — it takes
  // the place of the plain `resources` line inside its own cadence group.
  const cadenceRows = HERO_CADENCE_ORDER.map((cadence) => ({
    cadence,
    rows: flatStatsWithCadence(cadence)
      .filter((stat) => stat !== "resources")
      .map(flatRow),
    resources: flatStatsWithCadence(cadence).includes("resources"),
  }));

  return (
    <div className="panel-gold rounded-2xl p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-bold tracking-wide text-gold-bright">
          {t("סך הכל מהגיבור")}
        </h3>
      </div>
      <div className="rule-gold my-3" />
      <p className="mb-4 text-[11px] leading-relaxed text-zinc-500">
        {t("מה שאתה מקבל בפועל מהנקודות והחפצים יחד. שורות מודגשות פעילות; שורות עמומות ממתינות לחפץ מתאים. התשואה מסודרת לפי מתי היא מגיעה: משאבים ותורות בכל עדכון רגיל, אזרחים ויהלומים בעדכון היומי, וכוח הקרב בקרב עצמו.")}
      </p>

      {/* Three labelled groups. The panel only owns half the row from xl up
          (it sits beside the quest board), so the columns go the other way
          there: two abreast while the panel is full-width, one column once it
          is halved and a three-way split would squeeze every value. */}
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-1">
        {/* battle percentages: attack / defense / spy */}
        <section>
          <SectionLabel>{t("בונוסי קרב · באחוזים")}</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {percentRows.map(({ stat, value, note }) => (
              <StatRow key={stat} t={t} stat={stat} value={value} suffix="%" note={note} />
            ))}
          </div>
        </section>

        {/* One block per cadence, fastest clock first, then the battle stats.
            The dividers the three-column layout used to carry are gone: with
            two-then-one columns the section labels already separate the groups,
            and a rule down a two-column split reads as a page seam. */}
        {cadenceRows.map(({ cadence, rows, resources }) => (
          <section key={cadence}>
            <SectionLabel hint={cadenceHint(cadence)}>
              {t(HERO_CADENCE_META[cadence].label)}
            </SectionLabel>
            <div className="flex flex-col gap-1.5">
              {/* The hybrid resources row leads its group: it is the one stat
                  paid in two units at once (% over the mines + a flat amount). */}
              {resources && (
                <ResourcesRow
                  t={t}
                  pointsPct={points.resources}
                  classPct={classPct.resources}
                  itemPct={itemsResourcePct}
                  itemFlat={itemsFlat.resources}
                  itemNote={resourcesNote}
                />
              )}
              {rows.map(({ stat, value, note }) => (
                <StatRow
                  key={stat}
                  t={t}
                  stat={stat}
                  value={value}
                  note={note}
                  format={(v) => `+${formatNumber(v)}`}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
