import type { ReactNode } from "react";
import { HERO_STAT_META, type HeroBonuses, type HeroStat } from "@/lib/game/hero";
import { RESOURCE_META, type StorableResource } from "@/lib/game/constants";
import { formatBonus, formatNumber } from "@/lib/game/format";
import { Tip } from "@/components/ui/Tip";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { getT, type T } from "@/i18n/server";

/**
 * "סך הכל מהגיבור" — the combined yield the player actually gets from the hero,
 * points and equipped items together. It is laid out as two clearly labelled
 * blocks: the battle percentages (attack/defense/spy — points and item % folded
 * in) and the flat yield the equipped items grant (turns,
 * citizens, resources). Each line reads left-to-right value ↔ right-to-left
 * label so the numbers align in a single detailed column.
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gold-dim">
      {children}
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

  // כמויות קבועות מהחפצים, לא באחוזים. משאבים מטופלים בנפרד כי הם ניזונים משני
  // מקורות שונים: אחוז מהנקודות (מכפיל מכרות) + כמות מהחפץ.
  //
  // שלוש שורות הכוח הן החלק שנכנס לקרב עצמו: הן נספרות יחד עם החיילים והנשקים,
  // ולכן כל האחוזים שמעליהן ברשימה מוכפלים גם עליהן.
  const flatRows: { stat: HeroStat; value: number; note: string }[] = [
    {
      stat: "attackPower",
      value: itemsFlat.attackPower,
      note: t("נספר עם החיילים והנשקים בתקיפה"),
    },
    {
      stat: "defensePower",
      value: itemsFlat.defensePower,
      note: t("נספר עם החיילים והנשקים בהגנה"),
    },
    {
      stat: "spyPower",
      value: itemsFlat.spyPower,
      note: t("נספר עם המרגלים בכל משימת ריגול"),
    },
    { stat: "turns", value: itemsFlat.turns, note: t("נוסף בכל עדכון יומי") },
    { stat: "citizens", value: itemsFlat.citizens, note: t("נוסף בכל עדכון יומי") },
    { stat: "diamonds", value: itemsFlat.diamonds, note: t("מזוקק מהמכנסיים בלבד") },
  ];

  return (
    <div className="panel-gold rounded-2xl p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-bold tracking-wide text-gold-bright">
          {t("סך הכל מהגיבור")}
        </h3>
      </div>
      <div className="rule-gold my-3" />
      <p className="mb-4 text-[11px] leading-relaxed text-zinc-500">
        {t("מה שאתה מקבל בפועל מהנקודות והחפצים יחד. שורות מודגשות פעילות; שורות עמומות ממתינות לחפץ מתאים.")}
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

        {/* flat from items: combat power, then the per-update yield */}
        {/* The dividers the three-column layout used to carry are gone: with
            two-then-one columns the section labels already separate the groups,
            and a rule down a two-column split reads as a page seam. */}
        <section>
          <SectionLabel>{t("תשואה קבועה מחפצים · בכמויות")}</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {flatRows.map(({ stat, value, note }) => (
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

        {/* resources: hybrid — % from points (mines) + flat from the relic */}
        <section>
          <SectionLabel>{t("תפוקת משאבים · אחוזים + כמות")}</SectionLabel>
          <ResourcesRow
            t={t}
            pointsPct={points.resources}
            classPct={classPct.resources}
            itemPct={itemsResourcePct}
            itemFlat={itemsFlat.resources}
            itemNote={resourcesNote}
          />
        </section>
      </div>
    </div>
  );
}
