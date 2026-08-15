import type { PotionKind } from "@prisma/client";
import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { Meter } from "@/components/ui/Meter";
import { Tip } from "@/components/ui/Tip";
import { HeroBag } from "@/components/game/HeroBag";
import { HeroPotions } from "@/components/game/HeroPotions";
import {
  getActivePotionExpiries,
  getPotionCounts,
} from "@/lib/game/potionEffects";
import { HeroPaperdoll } from "@/components/game/HeroPaperdoll";
import { HeroStatsCards } from "@/components/game/HeroStatsCards";
import { HeroPowerSummary } from "@/components/game/HeroPowerSummary";
import { HeroResetButton } from "@/components/game/HeroResetButton";
import type { HeroItemView } from "@/components/game/heroItemView";
import { formatNumber } from "@/lib/game/format";
import { wheelLuckChance } from "@/lib/game/constants";
import { monumentBonuses } from "@/lib/game/monuments";
import {
  HERO_CLASS_META,
  HERO_DAMAGE_PER_LOST_DEFENSE,
  HERO_MAX_HEALTH,
  HERO_MAX_LEVEL,
  HERO_RESET_CITIZENS,
  HERO_RESET_POINTS,
  HERO_RESET_TURNS,
  heroClassBonusLines,
  heroClassImage,
  heroReviveAt,
  isHeroDead,
  rawHeroBonuses,
  tierForLevel,
  xpToNextLevel,
} from "@/lib/game/hero";
import { HeroRevive } from "@/components/game/HeroRevive";
import {
  HeroQuestBoard,
  type ActiveHeroQuest,
} from "@/components/game/HeroQuestBoard";
import { prisma } from "@/lib/prisma";
import { getTunables } from "@/lib/game/config";
import { heroQuestXp } from "@/lib/game/heroQuests";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("גיבור | KRALDOR") };
}

export default async function HeroPage() {
  const t = await getT();
  const empire = await requireEmpire();
  const hero = empire.hero;
  if (!hero) return null; // applyPendingUpdates always creates the hero

  const atCap = hero.level >= HERO_MAX_LEVEL;
  const xpMax = atCap ? 0 : xpToNextLevel(hero.level);
  const xpPct = atCap ? 100 : Math.round((hero.xp / xpMax) * 100);

  // The character sheet shows what the hero is *worth* — the raw numbers — even
  // while he is dead and none of them are in force. The banner says so plainly;
  // silently zeroing his own page would read as "my points are gone".
  const bonuses = rawHeroBonuses(hero);
  const dead = isHeroDead(hero);
  const reviveAt = heroReviveAt(hero);
  // The revival countdown ticks in server time — see HeroRevive.
  const serverNow = new Date();
  const classMeta = HERO_CLASS_META[hero.heroClass];
  const classLines = heroClassBonusLines(hero.heroClass);
  // The tier ("rarity") is always derived from level, so two items of the same
  // slot+level look and perform identically regardless of what's stored.
  const toView = (items: typeof hero.items): HeroItemView[] =>
    items.map(({ id, slot, level }) => ({ id, slot, level, rarity: tierForLevel(level) }));
  const bagItems = toView(hero.items.filter((i) => !i.equipped));
  const equippedItems = toView(hero.items.filter((i) => i.equipped));
  // Wheel luck raises the chance a thrown item pays a wheel spin. Both halves
  // of it: the upgrade and גלגל השמיים. Quoting only the upgrade here would be
  // the "the effect is real and the readout says it isn't" bug that the
  // monuments test file pins — a monument that reads as doing nothing.
  const wheelSpinBonus = wheelLuckChance(
    empire.upgrades.find((u) => u.type === "WHEEL_LUCK")?.level ?? 1,
    monumentBonuses(empire.monuments).wheelLuck
  );

  // The belt: what is in hand, and what is already running. Expiries cross to
  // the client as epoch ms — Dates don't survive the boundary as Dates.
  const [potionCounts, potionExpiries] = await Promise.all([
    getPotionCounts(empire.id),
    getActivePotionExpiries(empire.id, undefined, serverNow),
  ]);
  const potionActiveUntil = Object.fromEntries(
    Object.entries(potionExpiries).map(([kind, at]) => [kind, at.getTime()])
  ) as Partial<Record<PotionKind, number>>;
  // The forge brew halves every upgrade price the item dialogs quote, so the
  // preview has to know about it or it would advertise the wrong number.
  const forgeDiscount = potionExpiries.FORGE_DISCOUNT !== undefined;

  /* -------- the expedition board --------
     Note what is *not* selected out of the quest row: the haul. It was rolled
     and frozen at departure and it stays on the server until he is home — a
     reward serialized into this page's payload would be readable in the network
     tab, and the whole point of the board is that nobody knows yet. */
  const [tunables, questRow] = await Promise.all([
    getTunables(),
    prisma.heroQuest.findUnique({
      where: { empireId: empire.id },
      select: { tier: true, startedAt: true, endsAt: true, rewardXp: true },
    }),
  ]);
  const activeQuest: ActiveHeroQuest | null = questRow
    ? {
        tier: questRow.tier,
        startedAt: questRow.startedAt.getTime(),
        endsAt: questRow.endsAt.getTime(),
        xp: questRow.rewardXp || heroQuestXp(questRow.tier),
      }
    : null;

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("גיבור")}
        ornament={<Icon name="attack" size={22} className="text-crimson" />}
      />

      {/* A fallen hero is the first thing on the page — nothing else here
          matters until he is back on his feet. */}
      {dead && reviveAt && (
        <HeroRevive
          serverNow={serverNow.getTime()}
          reviveAt={reviveAt.getTime()}
          diamonds={Math.floor(empire.diamonds)}
        />
      )}

      {/* -------- character showcase: the hero wearing his own gear --------
          Three columns on a wide screen, right to left: the figure with his
          gear, then his bars and points, then the bag. Keeping the bag in the
          same panel fills the blank half the meters used to leave behind, and
          puts loot one glance away from the sockets it goes into. */}
      <div className="panel relative rounded-2xl border border-border-gold-strong">
        {/* The bag column (15 sockets + the belt) is the tallest thing in this
            row, so the figure is sized to reach it — a 13/19 portrait at 26rem
            lands within a hair of the bag's height instead of stopping a third
            of the way up and leaving dead panel under it.

            That three-column form needs 26rem + 25rem + something to live in
            between, and it used to open at `xl` — where the shell's own nav rail
            leaves the page barely 930px. The middle column came out about 40px
            wide and the bars and the class name wrapped one word per line. It
            waits for `2xl` now; the two-column form covers every laptop under
            it, with the bag full width beneath the pair. */}
        <div className="grid md:grid-cols-[minmax(0,290px)_1fr] 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)_25rem]">
          {/* paperdoll (right in RTL) — the 9 pieces sit on the figure itself.
              Capped and centred on a phone: at the full 390px of a handset the
              13/19 frame stands 570px tall, which is two thirds of the viewport
              spent on one picture before a single number is visible. Held to
              16rem it is a figure you take in at a glance, and the bars, the
              points and the bag all move up into the first screen. The cap
              lifts at md, where the grid gives the column its own width. */}
          <div className="relative mx-auto w-full max-w-[16rem] sm:max-w-[18rem] md:max-w-none">
            <HeroPaperdoll
              portrait={heroClassImage(hero.heroClass)}
              portraitAlt={t(classMeta.label)}
              portraitAccent={classMeta.accent}
              equipped={equippedItems}
              bag={bagItems}
              heroLevel={hero.level}
              gold={empire.gold}
              wheelSpinBonus={wheelSpinBonus}
              forgeDiscount={forgeDiscount}
            />

            {/* level + resets badge */}
            <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <Tip tip={t("רמת הגיבור — עולה מניסיון שנצבר בקרבות")}>
                <span className="rounded-md border border-gold/60 bg-black/80 px-2 py-0.5 text-xs font-black text-gold-bright nums">
              {t("רמה {level}", { level: hero.level })}
                </span>
              </Tip>
              {hero.resets > 0 && (
                <Tip
              tip={t("תג איפוס: הגיבור הגיע לרמה {max} ואופס {times}. כל איפוס העניק {citizens} אזרחים, {turns} תורות ו-{points} נקודות פתיחה נוספות לצמיתות.", {
                max: HERO_MAX_LEVEL,
                times:
                  hero.resets === 1
                    ? t("פעם אחת")
                    : t("{count} פעמים", { count: hero.resets }),
                citizens: formatNumber(HERO_RESET_CITIZENS),
                turns: formatNumber(HERO_RESET_TURNS),
                points: HERO_RESET_POINTS,
              })}
                >
                  <span className="rounded-md border border-purple-400/60 bg-purple-950/80 px-1.5 py-0.5 text-xs font-black text-purple-300">
                    ↻ ×{hero.resets}
                  </span>
                </Tip>
              )}
            </div>

            {/* health */}
            <div className="absolute left-3 top-3">
              <Tip
                tip={
                  dead
                ? t("הגיבור מת — כל הבונוסים שלו מושבתים עד שיקום לתחייה")
                : t("חיי הגיבור — כל תקיפה שפורצת את ההגנה שלך מורידה {damage} נקודות. באפס הגיבור מת.", { damage: HERO_DAMAGE_PER_LOST_DEFENSE })
                }
              >
                <span
                  className={`flex items-center gap-1 rounded-md border bg-black/80 px-2 py-0.5 text-xs font-bold ${
                    dead
                      ? "border-red-500 text-red-300"
                      : "border-red-500/40 text-red-400"
                  }`}
                >
                  {dead ? <span aria-hidden>💀</span> : <Icon name="heart" size={14} />}
                  <span className="nums" dir="ltr">
                    {hero.health}%
                  </span>
                </span>
              </Tip>
            </div>
          </div>

          {/* identity + class bonuses + xp + point allocation (left in RTL).
              Whatever height the row settles on, the bars-and-points block
              takes the slack (`flex-1`) rather than leaving it under the
              buttons. */}
          <div className="flex flex-col gap-3.5 p-4 md:p-5">
            {/* identity — one compact line; the long class blurb is a tooltip */}
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <p className="text-xl font-black text-gold-bright">{t(classMeta.label)}</p>
              <Tip tip={t(classMeta.description)}>
                <span className="cursor-help text-xs text-zinc-500 underline decoration-dotted underline-offset-2">
                {t("על המחלקה")}
                </span>
              </Tip>
            </div>
            <p className="-mt-2 text-xs text-zinc-400">{t(classMeta.tagline)}</p>

            {/* permanent class bonuses */}
            <div className="flex flex-wrap gap-1.5">
              {classLines.map((line) => (
              <Tip key={line.label} tip={t("יתרון המחלקה — בונוס קבוע שנבחר בעת ההרשמה")}>
                  <span className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-2 py-0.5 text-xs font-bold text-emerald-300">
                    <span aria-hidden>{line.icon}</span>
                    {t(line.label)}
                    <span className="nums" dir="ltr">+{line.pct}%</span>
                  </span>
                </Tip>
              ))}
            </div>

            {/* -------- bars, then the points right under them --------
                One narrow column: health and xp on top, the three stat rows
                below them, with the bag filling the space to their left. */}
            <div className="grid flex-1 content-center gap-3 md:grid-cols-2 2xl:grid-cols-1">
              {/* the two bars that move between battles */}
              <div className="flex flex-col justify-center gap-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="nums" dir="ltr">
                      {hero.health}/{HERO_MAX_HEALTH}
                    </span>
                    <Tip
              tip={t("חיי הגיבור. כל תקיפה שפורצת את ההגנה שלך מורידה {damage} נקודות; באפס הגיבור מת וכל הבונוסים שלו מושבתים.", { damage: HERO_DAMAGE_PER_LOST_DEFENSE })}
                    >
              <span className="cursor-help text-red-400">{t("חיים")}</span>
                    </Tip>
                  </div>
                  <Meter tone="health" value={hero.health} max={HERO_MAX_HEALTH} />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="nums" dir="ltr">
            {atCap ? t("שיא") : `${formatNumber(hero.xp)}/${formatNumber(xpMax)}`}
                    </span>
            <Tip tip={t("ניסיון מצטבר מקרבות — ניצחון בתקיפה מעניק הכי הרבה, וגם הגנה מוצלחת מזכה. כל עליית רמה מעניקה נקודת גיבור.")}>
                      <span className="nums cursor-help text-gold" dir="ltr">
                        {xpPct}%
                      </span>
                    </Tip>
                  </div>
                  <Meter tone="xp" value={atCap ? 1 : hero.xp} max={atCap ? 1 : xpMax} />
                </div>
              </div>

              {/* point allocation: the page's one recurring action */}
              <div className="panel-inset rounded-xl p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
            <Tip tip={t("שלוש התכונות שנקודות הגיבור מחזקות. חפצי הגיבור אינם משנים אחוזים אלה — התרומה שלהם מרוכזת ב״סך הכל מהגיבור״ שלמטה.")}>
                    <h2 className="cursor-help text-sm font-bold tracking-wide text-gold-bright">
                {t("נקודות גיבור")}
                    </h2>
                  </Tip>
            <Tip tip={t("נקודות גיבור שטרם הוקצו — מתקבלת נקודה בכל עליית רמה. כל נקודה = ‎+1% לצמיתות.")}>
                    <span
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
                        hero.unspentPoints > 0
                          ? "border-gold/50 bg-gold/10 text-gold-bright"
                          : "border-border-subtle bg-panel-inset text-zinc-400"
                      }`}
                    >
                {t("פנויות")}
                      <span className="nums" dir="ltr">{hero.unspentPoints}</span>
                    </span>
                  </Tip>
                </div>
                {/* stat rows + point allocation (points only — items excluded) */}
                <HeroStatsCards points={bonuses.points} unspentPoints={hero.unspentPoints} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {atCap && <HeroResetButton resets={hero.resets} />}
          <Tip tip={t("חנות פריטים וחיזוקים לגיבור — בקרוב")} side="bottom">
                <button className="btn btn-ghost px-3 py-1.5 text-xs">
            <Icon name="shop" size={14} className="inline align-[-2px]" /> {t("חנות גיבור")}
                </button>
              </Tip>
            </div>
          </div>

          {/* -------- the bag (left in RTL) -------- */}
          <div className="border-t border-border-subtle p-4 md:col-span-2 md:p-5 2xl:col-span-1 2xl:border-s 2xl:border-t-0 2xl:p-4">
            <HeroBag
              items={bagItems}
              heroLevel={hero.level}
              gold={empire.gold}
              wheelSpinBonus={wheelSpinBonus}
              forgeDiscount={forgeDiscount}
            />

            {/* the belt sits directly under the bag: same column, same width —
                loot from the same battles, one glance apart */}
            <HeroPotions
              counts={potionCounts}
              activeUntil={potionActiveUntil}
              serverNow={serverNow.getTime()}
            />
          </div>
        </div>
      </div>

      {/* The footer row: what the hero *does* (the quest board, right in RTL)
          beside what he is *worth* (the totals, left). Half and half on a wide
          screen — the summary used to run the full width under a full-width
          board, and neither block needed that much room. They stack back up
          under xl, and `items-start` keeps the shorter panel from stretching to
          the taller one's height. */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <HeroQuestBoard
          cities={empire.cities}
          turns={empire.turns}
          heroDead={dead}
          active={activeQuest}
          serverNow={serverNow.getTime()}
          open={tunables.heroQuest.enabled >= 1}
        />

        <HeroPowerSummary bonuses={bonuses} />
      </div>
    </div>
  );
}
