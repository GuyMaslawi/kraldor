import Link from "next/link";
import { notFound } from "next/navigation";
import type { BossBattleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/game/format";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { ItemTile } from "@/components/game/ItemTile";
import { LivingPortrait } from "@/components/game/LivingPortrait";
import { itemDetails, uiRarityForLevel } from "@/components/game/heroItemView";
import {
  HERO_CLASS_META,
  SLOT_META,
  heroClassImage,
  itemDisplayName,
} from "@/lib/game/hero";
import { RESOURCE_META } from "@/lib/game/constants";
import { BOSS_REWARD_RESOURCES, bossByKey, bossImage } from "@/lib/game/bosses";
import {
  BOSS_CASUALTIES,
  BOSS_GRADE_BONUS,
  BOSS_GRADE_LABEL,
  BOSS_GRADE_MIN_DECISIONS,
  BOSS_MOVE_META,
  BOSS_TACTIC_META,
  type BossGrade,
} from "@/lib/game/bossBattle";
import type { BossRoundLogEntry } from "@/server/bossSiege";
import { cityName } from "@/lib/game/cities";
import { getI18n, getT, type T } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("קרב בוס | KRALDOR") };
}

/** Reward columns, paired with the report field that holds each amount. */
const REWARD_FIELDS = {
  gold: "rewardGold",
  wood: "rewardWood",
  iron: "rewardIron",
  stone: "rewardStone",
} as const;

/**
 * How each ending reads. A boss report is not win-or-lose: every outcome pays
 * something, and each one has to explain itself in a sentence, because the player
 * was not necessarily watching when it happened.
 */
const ENDING_META: Record<
  BossBattleStatus,
  // i18n-keys-start: `headline` is a dictionary key, drawn through t(ending.headline)
  { headline: string; tone: string; blurb: (t: T, boss: string) => string }
> = {
  KILLED: {
    headline: "הבוס הופל",
    tone: "text-emerald-400",
    blurb: (t, boss) => t("{boss} נפל. מכלאות המצודה נפתחו והאוצר שלו נלקח.", { boss }),
  },
  ROUTED: {
    headline: "הצבא נשבר",
    tone: "text-red-500",
    blurb: (t, boss) =>
      t("הקו נשבר תחת {boss} והכוחות נסוגו באמצע הקרב. חצי מהשלל שנצבר אבד עם שיירת האספקה.", { boss }),
  },
  SPENT: {
    headline: "הקרב נגמר",
    tone: "text-amber-400",
    blurb: (t, boss) =>
      t("{boss} עוד עומד, אבל פצוע — והפצעים נשארים עד שהוא נופל. תקוף שוב וסיים את העבודה.", { boss }),
  },
  // Kept only so reports written while retreating was a player action still render.
  RETREATED: {
    headline: "נסיגה מסודרת",
    tone: "text-amber-300",
    blurb: (t, boss) => t("הכוחות נסוגו. {boss} נשאר פצוע.", { boss }),
  },
  EXPIRED: {
    headline: "הקרב נסגר",
    tone: "text-zinc-400",
    blurb: (t, boss) =>
      t("{boss} כבר לא היה שם כשהכוחות הגיעו — הוא נפל או קם לתחייה לפני שהקרב הוכרע. השלל שנצבר שולם.", { boss }),
  },
  ACTIVE: {
    headline: "הקרב נמשך",
    tone: "text-gold-bright",
    blurb: (t) => t("הקרב הזה עדיין רץ."),
  },
};
// i18n-keys-end

const GRADE_TONE: Record<BossGrade, string> = {
  S: "border-gold/70 bg-gold/15 text-gold-bright",
  A: "border-emerald-500/60 bg-emerald-950/40 text-emerald-300",
  B: "border-sky-500/60 bg-sky-950/40 text-sky-300",
  C: "border-zinc-600 bg-panel-inset text-zinc-400",
};

export default async function BossFightPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  const me = await requireEmpire();

  const fight = await prisma.bossFight.findUnique({
    where: { id },
    include: { battle: { select: { log: true, correctCounters: true, decisions: true } } },
  });
  // A boss run is a private affair — only the empire that marched can read it.
  if (!fight || fight.empireId !== me.id) notFound();

  const boss = bossByKey(fight.bossKey);
  if (!boss) notFound();

  // Portrait for the attacking side: the class the player picked at signup.
  // Empires predating the hero system fall back to the founding class.
  const myClass = me.hero?.heroClass ?? "WARLORD";
  const myClassMeta = HERO_CLASS_META[myClass];

  const ending = ENDING_META[fight.endedBy ?? (fight.victory ? "KILLED" : "SPENT")];
  const grade = (fight.grade ?? null) as BossGrade | null;
  const log: BossRoundLogEntry[] = Array.isArray(fight.battle?.log)
    ? (fight.battle.log as unknown as BossRoundLogEntry[])
    : [];
  const accuracy =
    fight.battle && fight.battle.decisions > 0
      ? fight.battle.correctCounters / fight.battle.decisions
      : null;

  // Progress against the life's pool, not against a single fight — and since the
  // tyrant became the whole city's that pool is the city's too, so a single
  // report's bar is deliberately a small dent in a large wall. `bossMaxHp` is 0
  // on reports written before the siege rework, which fall back to the old
  // power-versus-power bar.
  const hasPool = fight.bossMaxHp > 0;
  const damagePct = hasPool ? Math.min(100, (fight.damageDealt / fight.bossMaxHp) * 100) : 0;
  const remainingPct = hasPool
    ? Math.max(0, Math.min(100, (fight.bossHpAfter / fight.bossMaxHp) * 100))
    : 0;
  const total = fight.attackerPower + fight.bossPower;
  const myShare = total > 0 ? (fight.attackerPower / total) * 100 : 50;

  const droppedItem =
    fight.droppedItemSlot && fight.droppedItemLevel && fight.droppedItemRarity
      ? {
          slot: fight.droppedItemSlot,
          level: fight.droppedItemLevel,
          rarity: fight.droppedItemRarity,
        }
      : null;
  const paidAnything =
    fight.rewardGold > 0 ||
    fight.rewardWood > 0 ||
    fight.rewardIron > 0 ||
    fight.rewardStone > 0;

  return (
    <div className="space-y-6" style={{ ["--boss-accent" as string]: boss.accent }}>
      {/* -------- actions -------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href="/game/rankings" className="btn btn-gold px-5 py-2 text-sm">
            <Icon name="rankings" size={16} className="inline-block align-middle" />{" "}
            {fight.victory ? t("חזרה לבוס העיר") : t("תקוף שוב")}
          </Link>
          <Link href="/game/base" className="btn btn-ghost px-5 py-2 text-sm">
            <Icon name="base" size={16} className="inline-block align-middle" /> {t("חזרה לבסיס")}
          </Link>
        </div>
        <p className="nums text-xs text-zinc-500" dir="ltr">
          {formatDate(fight.createdAt, locale)}
        </p>
      </div>

      {/* -------- verdict banner -------- */}
      <div className="relative overflow-hidden rounded-2xl border border-[rgb(var(--boss-accent))]/45 bg-[#0a0709] p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_100%_at_15%_0%,rgb(var(--boss-accent)/0.28),transparent_62%)]"
        />
        {/* The verdict is its own row, above the two sides rather than wedged
            between them. A sortie has five endings and their names are sentences
            ("הסבבים נגמרו", "נסיגה מסודרת"), not the one-word ניצחון/תבוסה this
            banner was built for — squeezed into the middle column they ran over
            both portraits' subtitles. */}
        <div className="relative flex flex-col items-center gap-2">
          <p
            className={`text-center text-3xl font-black sm:text-4xl ${ending.tone}`}
            style={{ textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}
          >
            {t(ending.headline)}
          </p>
          {grade && (
            <Tip
              tip={t("דירוג הקרב נקבע לפי כמה מהמהלכים הקצינים קראו נכון (תלוי ברמת הגיבור) ולפי הצבא ששרד — והוא מכפיל את אוצר ההפלה ב־×{bonus}. דירוג S דורש לפחות {min} סבבים של קריאות נכונות, ולכן הפלה במכה אחת לא מגיעה אליו: קרב שהוכרע מהר לא הספיק להוכיח כלום.", { bonus: BOSS_GRADE_BONUS[grade], min: BOSS_GRADE_MIN_DECISIONS })}
            >
              <span
                className={`cursor-help rounded-lg border px-3 py-1 text-sm font-black ${GRADE_TONE[grade]}`}
              >
                {t("דירוג {grade} · {label} ×{bonus}", { grade, label: t(BOSS_GRADE_LABEL[grade]), bonus: BOSS_GRADE_BONUS[grade] })}
              </span>
            </Tip>
          )}
        </div>

        <div className="relative mt-5 flex items-start justify-between gap-3">
          {/* my side */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <div className="relative h-16 w-16 overflow-hidden rounded-xl border-2 border-emerald-500/50 bg-gradient-to-b from-emerald-900/30 to-black shadow-[0_0_30px_-8px_rgba(52,211,153,0.5)] sm:h-20 sm:w-20">
              {/* Same thumbnail treatment as the boss opposite: the attacker's
                  own class portrait, so the banner reads as two faces and not
                  a face against a generic silhouette. */}
              <LivingPortrait
                src={heroClassImage(myClass)}
                alt={t(myClassMeta.label)}
                className="absolute inset-0"
                accent={myClassMeta.accent}
                tilt={3}
                drift={20}
              />
            </div>
            <p className="max-w-full truncate font-black text-emerald-300">{me.name}</p>
            <p className="text-[11px] text-zinc-500">{t(myClassMeta.label)} · {t("תוקף")}</p>
          </div>

          <p className="shrink-0 pt-6 text-xs text-zinc-500">{t("מול")}</p>

          {/* boss side */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <div className="relative h-16 w-16 overflow-hidden rounded-xl border-2 border-[rgb(var(--boss-accent))]/60 bg-gradient-to-b from-[rgb(var(--boss-accent)/0.3)] to-black shadow-[0_0_30px_-8px_rgb(var(--boss-accent)/0.6)] sm:h-20 sm:w-20">
              {/* Thumbnail-sized, so the lean has to stay well inside the
                  artwork's overscan or it would bare the frame's edge. */}
              <LivingPortrait
                src={bossImage(boss.key)}
                alt={t(boss.name)}
                className="absolute inset-0"
                accent={boss.accent}
                tilt={3}
                drift={20}
              />
            </div>
            <p className="max-w-full truncate font-black text-[rgb(var(--boss-accent))]">
              {t(boss.name)}
            </p>
            <p className="text-[11px] text-zinc-500">
              {t(boss.title)} · {t("עיר {city}", { city: cityName(t, fight.cityTier) })}
            </p>
          </div>
        </div>

        {/* Damage against the cycle's pool: how much of the tyrant this sortie
            took off, and how much is still standing for the next one. */}
        <div className="relative mt-6">
          {hasPool ? (
            <>
              <div className="flex h-3 overflow-hidden rounded-full border border-black/60" dir="rtl">
                <span
                  style={{ width: `${damagePct}%` }}
                  className="bg-gradient-to-l from-gold-bright to-gold-deep"
                />
                <span
                  style={{ width: `${remainingPct}%` }}
                  className="bg-gradient-to-r from-[rgb(var(--boss-accent))] to-[rgb(var(--boss-accent)/0.4)]"
                />
                <span className="flex-1 bg-black/60" />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs" dir="rtl">
                <span className="nums font-bold text-gold-bright" dir="ltr">
                  −{formatNumber(Math.round(fight.damageDealt))}
                </span>
                <span className="text-zinc-500">
                  {t("נזק בקרב הזה מתוך המאגר המשותף של העיר")}{" "}
                  <span className="nums" dir="ltr">
                    {formatNumber(fight.bossMaxHp)}
                  </span>
                </span>
                <span className="nums font-bold text-[rgb(var(--boss-accent))]" dir="ltr">
                  {formatNumber(Math.round(fight.bossHpAfter))}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full border border-black/60">
                <span
                  style={{ width: `${myShare}%` }}
                  className="bg-gradient-to-l from-emerald-400 to-emerald-600"
                />
                <span
                  style={{ width: `${100 - myShare}%` }}
                  className="bg-gradient-to-r from-[rgb(var(--boss-accent))] to-[rgb(var(--boss-accent)/0.4)]"
                />
              </div>
              <div className="mt-1.5 flex justify-between text-xs">
                <span className="nums font-bold text-emerald-300" dir="ltr">
                  {formatNumber(fight.attackerPower)}
                </span>
                <span className="text-zinc-500">{t("כוח קרב")}</span>
                <span className="nums font-bold text-[rgb(var(--boss-accent))]" dir="ltr">
                  {formatNumber(fight.bossPower)}
                </span>
              </div>
            </>
          )}
        </div>

        <p className="relative mt-4 text-center text-sm text-zinc-400">
          {ending.blurb(t, boss.name)}
        </p>
      </div>

      {/* -------- spoils, straight under the verdict --------
          The haul is what the sortie was for, and unlike a player raid it pays
          on every ending — so it leads, above the casualty tiles and the
          round-by-round replay that explain how it was earned. */}
      {paidAnything && (
        <div className="panel-gold rounded-xl p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright">
            <Icon name="gold" size={16} className="text-gold-bright" />{" "}
            {fight.victory ? t("אוצר {boss}", { boss: boss.name }) : t("שלל הקרב")}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BOSS_REWARD_RESOURCES.map((res) => (
              <div key={res} className="panel-inset rounded-lg p-3 text-center">
                <p className="text-[11px] text-zinc-400">
                  <Icon
                    name={RESOURCE_ICON[res]}
                    size={14}
                    className={`inline-block align-middle ${RESOURCE_ICON_COLOR[res]}`}
                  />{" "}
                  {RESOURCE_META[res].label}
                </p>
                <p className="nums mt-0.5 font-black text-emerald-400" dir="ltr">
                  +{formatNumber(fight[REWARD_FIELDS[res]])}
                </p>
              </div>
            ))}
          </div>
          {!fight.victory && (
            <p className="mt-2 text-[11px] text-zinc-500">
              {t("שולם לפי הנזק שגרמת מתוך מאגר החיים שלו. אוצר ההפלה עצמו עוד מחכה מעבר לשער.")}
            </p>
          )}
        </div>
      )}

      {/* -------- aftermath --------
          The casualty tile only appears while assaults draw blood; an old report
          from when they did still shows it, so a player reading their history is
          not told a fight that cost them 200 soldiers was free. */}
      <div
        className={`grid gap-4 sm:grid-cols-2 ${
          BOSS_CASUALTIES || fight.soldiersLost > 0 ? "lg:grid-cols-4" : "lg:grid-cols-3"
        }`}
      >
        {(BOSS_CASUALTIES || fight.soldiersLost > 0) && (
          <div className="panel-inset rounded-xl p-4 text-center">
            <p className="text-xs text-zinc-400">{t("אבדות שלך")}</p>
            <p className="nums mt-1 text-xl font-black text-red-400" dir="ltr">
              −{formatNumber(fight.soldiersLost)}{" "}
              <Icon name="army" size={18} className="inline-block align-middle" />
            </p>
          </div>
        )}
        <div className="panel-inset rounded-xl p-4 text-center">
          <p className="text-xs text-zinc-400">{t("סבבים שנלחמו")}</p>
          <p className="nums mt-1 text-xl font-black text-gold" dir="ltr">
            {fight.rounds || log.length}
          </p>
          {accuracy != null && (
            <p className="nums mt-0.5 text-[11px] text-zinc-500">
              <span dir="ltr">{Math.round(accuracy * 100)}%</span> {t("קריאות נכונות")}
            </p>
          )}
        </div>
        <div className="panel-inset rounded-xl p-4 text-center">
          <p className="text-xs text-zinc-400">{t("תורות שנוצלו")}</p>
          <p className="nums mt-1 text-xl font-black text-gold" dir="ltr">
            {formatNumber(fight.turnsSpent)}
          </p>
        </div>
        <div className="panel-inset rounded-xl p-4 text-center">
          <Tip tip={t("שבויים ששוחררו ממכלאות הבוס — מצטרפים למאגר עבדי המכרות הפנוי שלך.")}>
            <p className="cursor-help text-xs text-zinc-400">{t("⛓️ שבויים ששוחררו")}</p>
          </Tip>
          <p className="nums mt-1 text-xl font-black text-emerald-400" dir="ltr">
            +{formatNumber(fight.rewardSlaves)}{" "}
            <Icon name="mine" size={18} className="inline-block align-middle" />
          </p>
        </div>
      </div>

      {/* -------- the replay: what was read right, and what it cost -------- */}
      {log.length > 0 && (
        <div className="panel rounded-xl p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright">
            <Icon name="reports" size={16} className="text-gold" /> {t("סבב אחר סבב")}
          </h3>
          <ul className="space-y-1">
            {log.map((entry) => {
              const moveMeta = BOSS_MOVE_META[entry.move as keyof typeof BOSS_MOVE_META];
              return (
                <li
                  key={entry.round}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg px-2 py-2 text-xs odd:bg-white/[0.03]"
                >
                  <span className="nums w-7 shrink-0 font-bold text-zinc-500" dir="ltr">
                    #{entry.round}
                  </span>
                  <span className="shrink-0" aria-hidden>
                    {moveMeta?.icon}
                  </span>
                  <span className={`shrink-0 font-bold ${moveMeta?.tone ?? "text-zinc-400"}`}>
                    {moveMeta?.label ?? entry.move}
                  </span>
                  <span aria-hidden className="text-zinc-600">
                    ←
                  </span>
                  <span className="shrink-0" aria-hidden>
                    {BOSS_TACTIC_META[entry.tactic]?.icon}
                  </span>
                  <span className="shrink-0 font-bold text-zinc-200">
                    {BOSS_TACTIC_META[entry.tactic]?.label ?? entry.tactic}
                  </span>
                  <span
                    className={`shrink-0 font-bold ${
                      entry.correct ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {entry.correct ? "✔" : "✘"}
                  </span>
                  <span className="nums mr-auto shrink-0 font-bold text-gold-bright" dir="ltr">
                    −{formatNumber(entry.damage)}
                  </span>
                  {(BOSS_CASUALTIES || entry.soldiersLost > 0) && (
                    <span className="nums shrink-0 text-red-300" dir="ltr">
                      −{formatNumber(entry.soldiersLost)}{" "}
                      <Icon name="army" size={12} className="inline-block align-middle" />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* -------- hero -------- */}
      {(fight.heroXp > 0 || droppedItem) && (
        <div className="panel rounded-xl p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright">
            <Icon name="spark" size={18} className="text-crimson-bright" /> {t("הגיבור שלך")}
          </h3>
          <div className="flex flex-wrap items-center gap-4">
            {fight.heroXp > 0 && (
              <Tip tip={t("ניסיון לגיבור מהקרב הזה, על אותה חלוקה כמו השלל: לפי הנזק שנגרם, ובונוס מלא על ההפלה.")}>
                <div className="panel-inset cursor-help rounded-lg p-3 text-center">
                  <p className="text-[11px] text-zinc-400">{t("ניסיון שהתקבל")}</p>
                  <p className="nums mt-0.5 text-xl font-black text-purple-300" dir="ltr">
                    +{formatNumber(fight.heroXp)}
                  </p>
                </div>
              </Tip>
            )}
            {droppedItem && (
              <div className="flex items-center gap-3">
                <div className="w-20">
                  <ItemTile
                    slug={SLOT_META[droppedItem.slot].slug}
                    icon={SLOT_META[droppedItem.slot].icon}
                    level={droppedItem.level}
                    rarity={uiRarityForLevel(droppedItem.level)}
                    details={itemDetails(t, droppedItem, me.hero?.level ?? 1)}
                  />
                </div>
                <div>
                  <p className="text-sm font-black text-gold-bright">
                    <Icon name="gift" size={16} className="inline-block align-middle" /> {t("שלל הבוס:")}{" "}
                    {itemDisplayName(t, droppedItem.slot, droppedItem.level)}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {t("רמת פריט")}{" "}
                    <span className="nums" dir="ltr">
                      {droppedItem.level}
                    </span>{" "}
                    · {t("נוסף לתיק הגיבור")}
                  </p>
                  <Link href="/game/hero" className="btn btn-ghost mt-2 px-3 py-1 text-xs">
                    <Icon name="attack" size={14} className="inline-block align-middle" /> {t("לציוד הגיבור")}

                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
