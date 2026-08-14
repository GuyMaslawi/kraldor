"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Meter } from "@/components/ui/Meter";
import { Tip } from "@/components/ui/Tip";
import { FormMessage } from "@/components/ui/FormMessage";
import { useServerNow } from "@/components/game/HeroPotions";
import { QuestLock } from "@/components/game/QuestLock";
import { collectHeroQuest, startHeroQuest } from "@/server/actions/heroQuests";
import type { HeroQuestHaul } from "@/server/actions/heroQuests";
import type { ActionState } from "@/server/actions/game";
import { formatNumber } from "@/lib/game/format";
import { RARITY_META } from "@/lib/game/hero";
import { POTION_META } from "@/lib/game/potions";
import { useT } from "@/i18n/client";
import {
  HERO_QUESTS,
  HERO_QUEST_HAUL_LABEL,
  heroQuestByTier,
  heroQuestDurationLabel,
  heroQuestFortuneByKey,
  heroQuestTurnCost,
  heroQuestXp,
  type HeroQuestHaulKind,
} from "@/lib/game/heroQuests";

/**
 * מסעות הגיבור — the expedition board on the hero page.
 *
 * One rung per city the empire holds, and one hero to send up them. The rung
 * he is currently on lifts out of the list into a banner with a live clock;
 * everything else stays a row you can read the price of at a glance.
 *
 * What the board deliberately does *not* show is the payout *in advance*. The
 * rows quote the price in turns, the length of the road and the odds of loot —
 * never the haul. It isn't withheld, it genuinely isn't decided: every run rolls
 * its own fortune on the server (see lib/game/heroQuests.ts), and the number
 * only exists once he walks back through the gate. So no reward ever reaches
 * this component before the collect, which is the only way a hidden number stays
 * hidden in a client bundle.
 *
 * The collect itself is the opposite: it answers with the haul itemised, and
 * HomecomingPanel spends it — a tile per kind, the fortune band that produced
 * it, and whatever fell off the road. A mystery that is never resolved is just a
 * missing number, so the reveal stays on screen until the player dismisses it.
 *
 * All timing runs in SERVER time (`useServerNow`), for the same reason the
 * potion belt does: a browser clock two minutes fast would offer a "collect"
 * button the server then refuses.
 */

/** "3:04:12" over an hour, "04:12" under it — the shape the wait deserves. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface ActiveHeroQuest {
  tier: number;
  /** Epoch ms — Dates don't survive the server/client boundary as Dates. */
  startedAt: number;
  endsAt: number;
  /** The one thing about the outcome that is fixed per rung, so it is shown. */
  xp: number;
}

export interface HeroQuestBoardProps {
  /** Cities the empire holds — the highest quest tier it may send the hero on. */
  cities: number;
  /** Turns in hand, for the affordability hint on each rung. */
  turns: number;
  /** A fallen hero cannot depart (a quest already under way still finishes). */
  heroDead: boolean;
  /** The quest he is on now, finished or not, or null when he is home. */
  active: ActiveHeroQuest | null;
  /** The server's own clock at render time — see useServerNow. */
  serverNow: number;
  /** False when an admin has closed the board (the heroQuest.enabled tunable). */
  open: boolean;
}

export function HeroQuestBoard({
  cities,
  turns,
  heroDead,
  active,
  serverNow,
  open,
}: HeroQuestBoardProps) {
  const t = useT();
  const router = useRouter();
  const now = useServerNow(serverNow);
  const [msg, setMsg] = useState<ActionState>({});
  const [haul, setHaul] = useState<HeroQuestHaul | null>(null);
  const [pending, startTransition] = useTransition();

  const done = active !== null && active.endsAt <= now;

  // The moment the hero is due home, let the server re-render: the row is
  // collectable now, and only a fresh render can say so with authority.
  useEffect(() => {
    if (!done) return;
    const timeout = setTimeout(() => router.refresh(), 1000);
    return () => clearTimeout(timeout);
  }, [done, router]);

  const send = (tier: number) => {
    const fd = new FormData();
    fd.set("tier", String(tier));
    // The previous run's spoils belong to the previous run: sending him out
    // again clears the panel rather than leaving it above a fresh countdown.
    setHaul(null);
    startTransition(async () => setMsg(await startHeroQuest({}, fd)));
  };
  const collect = () => {
    startTransition(async () => {
      const res = await collectHeroQuest();
      setHaul(res.haul ?? null);
      // The panel *is* the confirmation, so don't also print the sentence the
      // action returns for callers that can only render a line.
      setMsg(res.haul ? {} : res);
    });
  };

  return (
    <section className="panel rounded-2xl border border-border-gold-strong p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Tip tip={t("הגיבור יוצא למסע אחד בכל פעם. כל עיר שאתה מקים פותחת מסע ארוך יותר — והשלל של כל המסעות גדל עם מספר הערים שלך ועם התקדמות העונה.")}>
          <h2 className="flex cursor-help items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <span aria-hidden>🧭</span> {t("מסעות הגיבור")}
          </h2>
        </Tip>
        <span className="text-[11px] text-zinc-500">
          {t("נפתחו {open} מתוך {total}", {
            open: Math.min(cities, HERO_QUESTS.length),
            total: HERO_QUESTS.length,
          })}
        </span>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
        <b className="text-zinc-300">{t("אף אחד לא יודע מה יחזור מהדרך.")}</b>{" "}
        {t("כל מסע מגלגל את מזלו שלו — לפעמים הגיבור חוזר חבול ועם מעט, ולפעמים נגררת אחריו עגלה שלמה. מה שכן בטוח: השלל גדל עם מספר הערים שלך ועם התקדמות העונה, וכל מסע משלם אותו ממוצע")}{" "}
        <b className="text-zinc-300">{t("לכל שעה")}</b>
        {t(". המסעות הארוכים קונים מחיר תורות נמוך יותר לשעה וסיכויי שלל גבוהים בהרבה; הקצרים קונים חפצים לשעה ואת החופש להגיב. הגיבור ממשיך להעניק את כל הבונוסים שלו גם בזמן שהוא בדרכים.")}
      </p>

      {!open && (
        <p className="mt-3 rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-xs text-zinc-400">
          {t("לוח המסעות סגור כרגע.")}
        </p>
      )}

      {haul && (
        // Keyed on the run so a second collect re-plays the drop-in animation
        // instead of swapping numbers inside a panel that is already still.
        <HomecomingPanel
          key={`${haul.tier}:${haul.fortune}:${haul.entries.map((e) => e.amount).join()}`}
          haul={haul}
          onDismiss={() => setHaul(null)}
        />
      )}

      {active && (
        <ActiveQuestBanner
          active={active}
          now={now}
          pending={pending}
          onCollect={collect}
        />
      )}

      <ul className="mt-3 space-y-2">
        {HERO_QUESTS.map((quest) => (
          <QuestRow
            key={quest.key}
            tier={quest.tier}
            cities={cities}
            unlocked={quest.tier <= cities}
            turns={turns}
            busy={active !== null}
            heroDead={heroDead}
            disabled={pending || !open}
            onSend={() => send(quest.tier)}
          />
        ))}
      </ul>

      {(msg.error || msg.success) && (
        <div className="mt-3">
          <FormMessage error={msg.error} success={msg.success} />
        </div>
      )}
    </section>
  );
}

/* ------------------------------ the running quest ------------------------------ */

function ActiveQuestBanner({
  active,
  now,
  pending,
  onCollect,
}: {
  active: ActiveHeroQuest;
  now: number;
  pending: boolean;
  onCollect: () => void;
}) {
  const t = useT();
  const quest = heroQuestByTier(active.tier);
  if (!quest) return null;

  const total = Math.max(1, active.endsAt - active.startedAt);
  const elapsed = Math.min(total, Math.max(0, now - active.startedAt));
  const done = active.endsAt <= now;

  return (
    <div
      className="mt-3 rounded-xl border p-3.5"
      style={{
        borderColor: `rgb(${quest.accent} / 0.55)`,
        background: `linear-gradient(to bottom, rgb(${quest.accent} / 0.12), transparent)`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="flex items-center gap-2 text-sm font-black text-bone">
          <span aria-hidden className="text-lg">
            {quest.sigil}
          </span>
          {t(quest.name)}
        </h3>
        <span
          className="nums flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1 text-xs font-bold"
          style={{ color: `rgb(${quest.accent})` }}
          dir="ltr"
        >
          {done ? t("חזר!") : formatCountdown(active.endsAt - now)}
        </span>
      </div>

      <Meter className="mt-2.5" value={elapsed} max={total} />

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <MysteryChip
          done={done}
          tip={
            done
              ? t("לחץ כדי לראות מה הוא הביא — השלל, המזל שליווה אותו, וכל מה שנפל בדרך.")
              : t("השלל נקבע ברגע שהוא יצא לדרך, אבל אף אחד בעיר עוד לא יודע מה יש בשק. הוא ייספר כשיחזור.")
          }
        />
        <XpChip xp={active.xp} />
      </div>

      <button
        type="button"
        onClick={onCollect}
        disabled={!done || pending}
        className={`btn mt-3 w-full py-2 text-sm ${done ? "btn-gold" : "btn-ghost"}`}
      >
        {pending
          ? t("אוסף…")
          : done
            ? t("קבל את פני הגיבור ואסוף את השלל")
            : t("הגיבור בדרכים…")}
      </button>
    </div>
  );
}

/* ------------------------------ the homecoming ------------------------------ */

/** Icon and tint for each kind a haul can contain. */
const HAUL_TILE: Record<HeroQuestHaulKind, { icon: IconName; tone: string }> = {
  gold: { icon: "gold", tone: "text-gold-bright" },
  wood: { icon: "wood", tone: "text-amber-600" },
  iron: { icon: "iron", tone: "text-slate-300" },
  stone: { icon: "stone", tone: "text-stone-400" },
  citizens: { icon: "citizens", tone: "text-bone" },
  slaves: { icon: "mine", tone: "text-orange-300" },
  xp: { icon: "spark", tone: "text-gold-bright" },
};

/**
 * How loud the panel is allowed to be. The fortune band is the whole story of
 * the run, so a legendary haul gets a gold frame that carries across the room
 * and a grim one gets a muted grey — the player should know how it went before
 * reading a single digit. Purely presentational, which is why it lives here and
 * not beside the band table in lib.
 */
const FORTUNE_TONE: Record<
  string,
  { frame: string; head: string; glow: string }
> = {
  grim: {
    frame: "border-zinc-600/50 from-zinc-900/70",
    head: "text-zinc-300",
    glow: "",
  },
  plain: {
    frame: "border-sky-500/40 from-sky-950/60",
    head: "text-sky-200",
    glow: "",
  },
  good: {
    frame: "border-emerald-500/50 from-emerald-950/70",
    head: "text-emerald-300",
    glow: "shadow-[0_0_28px_-10px_rgba(16,185,129,0.8)]",
  },
  rich: {
    frame: "border-violet-400/60 from-violet-950/70",
    head: "text-violet-200",
    glow: "shadow-[0_0_34px_-8px_rgba(167,139,250,0.85)]",
  },
  legend: {
    frame: "border-gold/70 from-amber-950/70",
    head: "text-gold-bright",
    glow: "shadow-[0_0_40px_-6px_rgba(212,175,55,0.95)]",
  },
};

/**
 * What he brought back, spelled out. This replaces the old one-line success
 * message, which was printed below ten quest rows — far off screen from the
 * button that produced it, so the haul may as well not have been reported.
 */
function HomecomingPanel({
  haul,
  onDismiss,
}: {
  haul: HeroQuestHaul;
  onDismiss: () => void;
}) {
  const t = useT();
  const quest = heroQuestByTier(haul.tier);
  const fortune = heroQuestFortuneByKey(haul.fortune);
  const tone = FORTUNE_TONE[fortune.key] ?? FORTUNE_TONE.plain!;

  return (
    <div
      className={`haul-panel mt-3 overflow-hidden rounded-xl border bg-gradient-to-b via-black/60 to-black/70 p-3.5 ${tone.frame} ${tone.glow}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`flex items-center gap-2 text-base font-black ${tone.head}`}>
            <span aria-hidden className="text-lg">
              {quest?.sigil ?? "🧭"}
            </span>
            {t(fortune.label)}!
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {t("הגיבור חזר מ”{quest}”", {
              quest: quest ? t(quest.name) : t("המסע"),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("סגור את סיכום המסע")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-[11px] text-zinc-400 transition hover:bg-white/10 hover:text-bone"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {haul.entries.map((entry, i) => {
          const tile = HAUL_TILE[entry.kind];
          return (
            <div
              key={entry.kind}
              style={{ animationDelay: `${i * 70}ms` }}
              className="haul-tile flex flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-black/50 p-2 text-center"
            >
              <Icon name={tile.icon} size={24} className={tile.tone} />
              <span className="nums text-sm font-black text-bone" dir="ltr">
                +{formatNumber(entry.amount)}
              </span>
              <span className="text-[10px] font-bold leading-none text-zinc-400">
                {t(HERO_QUEST_HAUL_LABEL[entry.kind])}
              </span>
            </div>
          );
        })}
      </div>

      {(haul.levelsGained > 0 || haul.item || haul.potion) && (
        <ul className="mt-2 space-y-1.5">
          {haul.levelsGained > 0 && (
            <li className="flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-xs font-bold text-gold-bright">
              <span aria-hidden>⬆️</span>
              {haul.levelsGained > 1
                ? t("הגיבור עלה {count} דרגות!", { count: haul.levelsGained })
                : t("הגיבור עלה דרגה!")}
            </li>
          )}
          {haul.item && (
            <li
              className={`flex items-center gap-2 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1.5 text-xs font-bold ${RARITY_META[haul.item.rarity].tone}`}
            >
              <span aria-hidden>🎁</span>
              {t("נמצא בדרך:")} {haul.item.label}
              <span className="text-[10px] font-normal text-zinc-500">
                — {t("מחכה בתרמיל")}
              </span>
            </li>
          )}
          {haul.potion && (
            <li
              className={`flex items-center gap-2 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1.5 text-xs font-bold ${POTION_META[haul.potion].tone}`}
            >
              <Icon name="potion" size={14} />
              {t(POTION_META[haul.potion].label)}
              <span className="text-[10px] font-normal text-zinc-500">
                — {t(POTION_META[haul.potion].tagline)}
              </span>
            </li>
          )}
        </ul>
      )}

      <p className="mt-2.5 text-[11px] italic leading-relaxed text-zinc-400">
        {t(fortune.lore)}
      </p>
    </div>
  );
}

/* ------------------------------ one rung ------------------------------ */

function QuestRow({
  tier,
  cities,
  unlocked,
  turns,
  busy,
  heroDead,
  disabled,
  onSend,
}: {
  tier: number;
  cities: number;
  unlocked: boolean;
  turns: number;
  busy: boolean;
  heroDead: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  const t = useT();
  const quest = heroQuestByTier(tier);
  if (!quest) return null;

  // The empire's own price, not the rung's — the board must quote what the
  // server will actually charge (see heroQuestTurnCost).
  const cost = heroQuestTurnCost(tier, cities);
  const affordable = turns >= cost;
  // Every reason the button can be dead, most specific first — the row states
  // exactly one of them rather than greying out silently.
  const blocked = !unlocked
    ? t("נפתח עם העיר ה-{tier}", { tier })
    : heroDead
      ? t("הגיבור מת")
      : busy
        ? t("הגיבור כבר במסע")
        : !affordable
          ? t("חסרות {turns} תורות", { turns: formatNumber(cost - turns) })
          : null;

  return (
    <li
      // A locked rung is an advertisement, not a control, and on a phone nine of
      // them in a row were 1,900px of scroll between the hero and everything
      // under him. So below `sm` a sealed rung keeps only what an advertisement
      // needs — the name, the length, the odds — and drops the lore and the
      // action column it cannot use anyway (the plate on the chains already
      // names the price, and the button under them is unclickable). The floor is
      // what the padlock rig needs to hang without being clipped.
      className={`panel-inset rounded-xl p-3 transition ${
        unlocked ? "" : "quest-row-locked min-h-[7.5rem] sm:min-h-0"
      }`}
      // A 3px stripe in the quest's own colour down the leading edge — the one
      // thing that keeps ten near-identical rows from reading as a wall.
      style={
        unlocked
          ? {
              borderInlineStartColor: `rgb(${quest.accent} / 0.75)`,
              borderInlineStartWidth: "3px",
            }
          : undefined
      }
    >
      {/* A rung he cannot be sent on yet is chained shut rather than greyed out:
          the seal states its own price and rattles when pulled. See QuestLock. */}
      {!unlocked && (
        <QuestLock
          label={t("{quest} — מסע נעול", { quest: t(quest.name) })}
          hint={t("נפתח עם העיר ה-{tier}", { tier })}
        />
      )}

      <div
        className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-2 ${
          unlocked ? "" : "quest-row-body"
        }`}
      >
        <div className="min-w-[13rem] flex-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-bone">
            <span aria-hidden>{quest.sigil}</span>
            {t(quest.name)}
            <span className="rounded-md border border-border-subtle px-1.5 py-px text-[10px] font-bold text-zinc-400">
              {heroQuestDurationLabel(t, tier)}
            </span>
          </h3>
          <p
            className={`mt-1 text-[11px] leading-relaxed text-zinc-500 ${
              unlocked ? "" : "hidden sm:block"
            }`}
          >
            {t(quest.lore)}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <MysteryChip tip={t("השלל של המסע הזה לא ידוע מראש: כל יציאה מגלגלת את מזלה שלה — לפעמים מעט, לפעמים עגלה שלמה. הגודל הממוצע נגזר ממספר הערים שלך ומיום העונה, ואותו לכל שעת מסע בכל הדרגות.")} />
            <XpChip xp={heroQuestXp(tier)} />
            <Tip
              tip={t(
                "סיכוי לחפץ גיבור בסיום המסע: {item}% · סיכוי לשיקוי: {potion}% — שתי הגרלות נפרדות, ומסע יכול להחזיר את שניהם.",
                {
                  item: Math.round(quest.itemChance * 100),
                  potion: Math.round(quest.potionChance * 100),
                }
              )}
            >
              <span className="nums flex cursor-help items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-950/30 px-1.5 py-0.5 text-[11px] font-bold text-violet-300">
                <span aria-hidden>🎁</span>
                <span dir="ltr">
                  {Math.round(quest.itemChance * 100)}% / {Math.round(quest.potionChance * 100)}%
                </span>
              </span>
            </Tip>
          </div>
        </div>

        <div
          className={`shrink-0 flex-col items-stretch gap-1.5 ${
            unlocked ? "flex" : "hidden sm:flex"
          }`}
        >
          <Tip
            tip={t("עלות שליחה: {cost} תורות — {perHour} לכל שעת מסע.", {
              cost: formatNumber(cost),
              perHour: (cost / (quest.hours || 1)).toFixed(1),
            })}
          >
            <span
              className={`nums flex cursor-help items-center justify-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
                affordable
                  ? "border-emerald-400/30 bg-emerald-950/30 text-emerald-300"
                  : "border-red-500/30 bg-red-950/30 text-red-300"
              }`}
            >
              <Icon name="turns" size={12} />
              <span dir="ltr">{formatNumber(cost)}</span>
            </span>
          </Tip>
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || blocked !== null}
            title={blocked ?? undefined}
            className="btn btn-ghost min-w-[7.5rem] px-3 py-1.5 text-xs"
          >
            {/* A locked rung says nothing here: the chained plate over the row
                already names the price, and on a phone the row is tall enough
                that the two labels sit far apart and read as a duplicate. */}
            {unlocked ? blocked ?? t("שלח למסע") : t("שלח למסע")}
          </button>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------ shared bits ------------------------------ */

/**
 * Where the payout used to be printed. It stands in for four resource chips and
 * two people chips, and it is the whole feature: an unread number keeps the
 * player coming back to the page, a read one turns the quest into arithmetic.
 *
 * The icons are the six things a quest *can* bring home — the player still knows
 * what kind of haul to expect, just never how big.
 */
function MysteryChip({ tip, done = false }: { tip: string; done?: boolean }) {
  const t = useT();
  return (
    <Tip tip={tip}>
      <span
        className={`flex cursor-help items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
          done
            ? "border-gold/50 bg-gold/15 text-gold-bright"
            : "border-border-subtle bg-black/30 text-zinc-400"
        }`}
      >
        <span className="flex items-center gap-0.5 opacity-70" aria-hidden>
          <Icon name="gold" size={12} />
          <Icon name="wood" size={12} />
          <Icon name="iron" size={12} />
          <Icon name="stone" size={12} />
        </span>
        <span dir="ltr" className="tracking-[0.2em]">
          ???
        </span>
        <span>{done ? t("מחכה בשער") : t("שלל לא ידוע")}</span>
      </span>
    </Tip>
  );
}

/** XP is the one payout that *is* fixed per rung, so it stays on the row. */
function XpChip({ xp }: { xp: number }) {
  const t = useT();
  return (
    <Tip tip={t("ניסיון לגיבור — הדבר היחיד במסע שידוע מראש: הוא נקבע לפי דרגת המסע בלבד ולא מושפע ממזל.")}>
      <span
        className="nums flex cursor-help items-center gap-1 rounded-lg border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[11px] font-bold text-gold-bright"
        dir="ltr"
      >
        <span aria-hidden>✦</span>
        {formatNumber(xp)}
      </span>
    </Tip>
  );
}
