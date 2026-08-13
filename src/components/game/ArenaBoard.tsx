"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { FormMessage } from "@/components/ui/FormMessage";
import { useAfterFirstPaint } from "@/components/ui/motion";
import { formatCompact } from "@/lib/game/format";
import {
  REWARD_ICON,
  REWARD_LABEL,
  scaleRewards,
  type Reward,
} from "@/lib/game/rewards";
import {
  ARENA_CONSOLATION,
  ARENA_GOLD_PER_WIN,
  ARENA_LUCK,
  ARENA_PODIUM,
  type ArenaState,
} from "@/lib/game/arena";
import { collectArena, enterArena } from "@/server/actions/arena";
import { useT } from "@/i18n/client";

/**
 * /game/arena — the weekly card.
 *
 * The page answers two questions and nothing else: "am I in" and "how did I
 * do". Everything about *how* the duels are decided is stated rather than
 * shown, because a player cannot influence it — there is no tactic here, only
 * whether you entered and what your army looked like when the week turned over.
 *
 * Which is exactly why the screen needed a *building*. A fixture nobody plays
 * has no board to watch and no button to press between the sign-up and the
 * result, so what it has instead is an amphitheatre: the stands, the torches
 * and the sand carry the week that the player is not being asked to fight. The
 * scene is pure CSS (prefix `arn-`, at the end of globals.css) and every
 * decorative position below comes from a fixed table — never Math.random(), so
 * the server and the first client render agree.
 */

/** Crowd in the arch mouths: [left %, top rem]. Fixed, for SSR. */
const CROWD: readonly (readonly [number, number])[] = [
  [6, 0.7], [11, 0.6], [16, 0.75], [22, 0.6], [28, 0.7], [34, 0.62],
  [40, 0.72], [46, 0.6], [52, 0.7], [58, 0.64], [64, 0.72], [70, 0.6],
  [76, 0.7], [82, 0.64], [88, 0.72], [94, 0.6],
  [8, 2.5], [15, 2.6], [23, 2.45], [31, 2.6], [39, 2.5], [47, 2.62],
  [55, 2.48], [63, 2.6], [71, 2.5], [79, 2.6], [87, 2.45], [93, 2.6],
];

/** Dust off the sand: [left %, drift px]. */
const MOTES: readonly (readonly [number, number])[] = [
  [12, -14], [24, 9], [37, -7], [49, 12], [58, -11], [69, 6], [81, -9], [91, 10],
];

/** The podium, in the order it is drawn: silver, gold, bronze. */
const PODIUM_COLUMNS: readonly {
  place: number;
  height: string;
  tone: string;
  icon: IconName;
}[] = [
  { place: 2, height: "1.9rem", tone: "#cbd5e1", icon: "achievements" },
  { place: 1, height: "3.1rem", tone: "var(--gold-bright)", icon: "crown" },
  { place: 3, height: "1.3rem", tone: "#c08457", icon: "achievements" },
];

export function ArenaBoard({ state }: { state: ArenaState }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  const run = (action: () => Promise<{ error?: string; success?: string }>) => {
    setMessage({});
    startTransition(async () => {
      const result = await action();
      setMessage({ error: result.error, success: result.success });
    });
  };

  const full = state.entrants >= state.maxEntrants;
  const canEnter =
    !state.resolved && !state.entered && !full && state.turns >= state.entryTurns;
  const fillPercent = Math.min(
    100,
    Math.round((state.entrants / Math.max(1, state.maxEntrants)) * 100)
  );

  return (
    <div className="space-y-4">
      {/* ------------------------------ the amphitheatre ------------------------------ */}
      <section className="arn-stage">
        <div className="arn-scene" aria-hidden>
          <div className="arn-tier arn-tier-far" />
          <div className="arn-tier arn-tier-near" />
          {CROWD.map(([left, top], i) => (
            <span
              key={`${left}-${top}`}
              className="arn-fan"
              style={{ left: `${left}%`, top: `${top}rem`, ["--i" as string]: i % 9 }}
            />
          ))}
          <span className="arn-torch arn-torch-a" />
          <span className="arn-torch arn-torch-b" />
          <div className="arn-sand" />
          {MOTES.map(([left, dx], i) => (
            <span
              key={left}
              className="arn-mote"
              style={{
                left: `${left}%`,
                ["--dx" as string]: `${dx}px`,
                ["--i" as string]: i,
              }}
            />
          ))}
          <div className="arn-sweep" />
        </div>

        <div className="arn-body flex flex-wrap items-center gap-5 p-4 pt-16 pb-8 sm:p-5 sm:pt-20 sm:pb-10">
          {/* A basis rather than `min-w-0 flex-1`: with no floor the copy simply
              squeezes down beside the gauge on a phone instead of wrapping
              above it, and the headline ends up three words to a line. */}
          <div className="flex-[1_1_17rem]">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-[0.2em] text-gold-dim">
              <span>{t("שבוע {week}", { week: state.week })}</span>
              <span className="text-zinc-700">·</span>
              <span>{t("דרגת {tier} ערים", { tier: state.tier })}</span>
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-black tracking-wide text-gold-bright sm:text-xl">
              <Icon name="laurel" size={24} className="text-crimson-bright" />
              {state.resolved ? t("תוצאות הזירה") : t("הזירה של השבוע")}
            </h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-zinc-400">
              {t("טורניר שבועי בין כל מי שנרשם — ואתה לא צריך להיות מחובר. בסוף השבוע המערכת מריצה את כל הדו־קרבות לבד: כל נרשם נגד כל נרשם, בדיוק פעם אחת. אתה משלם תורות, וזהו.")}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <div
              className="arn-gauge"
              style={{ ["--p" as string]: fillPercent }}
              title={t("נרשמו לזירה")}
            >
              <span className="text-center leading-none">
                <span className="block text-xl font-black nums text-gold-bright">
                  {state.entrants}
                </span>
                <span className="block text-[10px] font-bold text-zinc-600 nums" dir="ltr">
                  / {state.maxEntrants}
                </span>
                <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                  {t("נרשמו")}
                </span>
              </span>
            </div>

            {!state.resolved && (
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {t("הקרבות בעוד")}
                </p>
                <WeekCountdown at={state.resolvesAt} serverNow={state.serverNow} />
              </div>
            )}
          </div>
        </div>

        {/* The one action strip, on the sand. */}
        <div className="arn-body border-t border-border-gold bg-black/45 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-3">
            {state.resolved ? (
              state.myPlace > 0 ? (
                <>
                  <span className="flex items-center gap-2 rounded-xl border border-gold/50 bg-black/50 px-4 py-2">
                    <Icon name="laurel" size={16} className="text-crimson-bright" />
                    <span className="font-black text-gold-bright">
                      {t("מקום {place}", { place: state.myPlace })}
                    </span>
                  </span>
                  <PurseChips rewards={state.reward} />
                  {state.claimed ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300">
                      <Icon name="check" size={15} />
                      {t("נאסף")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => run(collectArena)}
                      disabled={pending || !state.claimable}
                      className="btn btn-gold px-4 py-2 text-sm disabled:opacity-60"
                    >
                      {pending ? t("אוסף…") : t("אסוף שלל")}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-zinc-400">{t("לא נרשמת לזירה הזו.")}</p>
              )
            ) : state.entered ? (
              <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-4 py-2 text-sm font-bold text-emerald-300">
                <Icon name="check" size={16} />
                {t("אתה בפנים. הקרבות ייערכו בסוף השבוע.")}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => run(enterArena)}
                  disabled={pending || !canEnter}
                  className="btn btn-gold px-5 py-2 text-sm disabled:opacity-50"
                >
                  {pending ? t("נרשם…") : t("הירשם לזירה")}
                </button>
                <span
                  className={`flex items-center gap-1 text-sm font-bold nums ${
                    state.turns >= state.entryTurns ? "text-gold" : "text-red-400"
                  }`}
                >
                  <Icon name="turns" size={14} />
                  {state.entryTurns}
                </span>
                {state.turns < state.entryTurns && (
                  <span className="text-xs font-bold text-red-400">
                    {t("אין לך מספיק תורות")}
                  </span>
                )}
                {full && (
                  <span className="text-xs font-bold text-amber-400">
                    {t("הזירה מלאה השבוע")}
                  </span>
                )}
              </>
            )}
          </div>
          <FormMessage error={message.error} success={message.success} />
        </div>
      </section>

      {/* ------------------------------ how it works ------------------------------ */}
      <Steps entryTurns={state.entryTurns} />

      {/* ------------------------------ the spoils ------------------------------ */}
      <Spoils state={state} />

      {/* ------------------------------ the table ------------------------------ */}
      <Standings state={state} />
    </div>
  );
}

/* ------------------------------ steps ------------------------------ */

/**
 * The four beats of a week, said in order.
 *
 * A player who opens this screen has never fought a duel here and has nothing
 * to press but one button, so the first thing owed to them is what happens
 * *after* they press it — the arena is the only fixture in the game that
 * resolves days later, while they are asleep.
 */
function Steps({ entryTurns }: { entryTurns: number }) {
  const t = useT();
  const steps: { icon: IconName; title: string; body: string }[] = [
    {
      icon: "turns",
      title: t("נרשמים"),
      body: t("כניסה עולה {turns} תורות, פעם אחת בשבוע. אין מה עוד לעשות — מרגע ההרשמה אתה בטבלה.", {
        turns: entryTurns,
      }),
    },
    {
      icon: "base",
      title: t("נלחמים בדרגה שלך"),
      body: t("יש זירה נפרדת לכל דרגת ערים, כמו בכל קרב אחר במשחק. אתה אף פעם לא פוגש אימפריה מליגה אחרת."),
    },
    {
      icon: "attack",
      title: t("כולם נגד כולם"),
      body: t("כשהשבוע מתהפך המערכת מריצה את כל הדו־קרבות בבת אחת: כל נרשם נגד כל נרשם בדיוק פעם אחת. לא צריך להיות מחובר."),
    },
    {
      icon: "gift",
      title: t("אוספים שלל"),
      body: t("הטבלה הסופית נשארת פה עד שתאסוף — גם אם חזרת רק אחרי כמה ימים. שלל שלא נאסף לא הולך לאיבוד."),
    },
  ];

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="quest" size={18} className="text-crimson-bright" />
        {t("איך הזירה עובדת")}
      </h3>
      <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title} className="panel-inset rounded-xl p-3">
            <p className="flex items-center gap-2 text-sm font-bold text-gold-bright">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-black/40 text-[10px] font-black nums text-gold">
                {i + 1}
              </span>
              <Icon name={step.icon} size={15} className="text-crimson" />
              {step.title}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{step.body}</p>
          </li>
        ))}
      </ol>

      {/* The one number that decides every duel, and the only reason a smaller
          empire has a reason to be here at all. */}
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-purple-500/25 bg-purple-500/5 px-3 py-2 text-xs leading-relaxed text-purple-200/90">
        <Icon name="dice" size={14} className="shrink-0 text-purple-300" />
        <span>
          {t("דו־קרב נקבע לפי כוח צבאי, אבל {luck}% מהתוצאה הם מזל — ואת הכוח משווים בשורש, כך שאימפריה עם חצי מהכוח עדיין לוקחת בערך קרב אחד מכל חמישה. גם מהמקום האחרון בטבלה שווה להיכנס.", {
            luck: Math.round(ARENA_LUCK * 100),
          })}
        </span>
      </p>
    </section>
  );
}

/* ------------------------------ spoils ------------------------------ */

/**
 * What a finish is worth, quoted at the viewer's own city curve.
 *
 * Every purse in `arena.ts` is written at one city and scaled on payout, so a
 * table printed at its literal figures would be wrong for everybody past the
 * first city — and wrong downwards, by a factor that reaches four digits. The
 * screen therefore runs the same `scaleRewards` the claim runs.
 */
function Spoils({ state }: { state: ArenaState }) {
  const t = useT();
  const consolation = scaleRewards(ARENA_CONSOLATION, state.cities);
  const perWin = scaleRewards(
    [{ kind: "gold", amount: ARENA_GOLD_PER_WIN }],
    state.cities
  );

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
          <Icon name="rankings" size={18} className="text-crimson-bright" />
          {t("השלל")}
        </h3>
        <span className="text-[11px] font-bold text-zinc-500">
          {t("מחושב לפי {cities} הערים שלך", { cities: state.cities })}
        </span>
      </div>

      <div className="arn-podium grid grid-cols-3 items-end gap-2 sm:gap-3">
        {PODIUM_COLUMNS.map((column, i) => (
          <div key={column.place} className="arn-column" style={{ ["--i" as string]: i }}>
            <div
              className={`arn-purse p-2.5 sm:p-3 ${column.place === 1 ? "is-first" : ""} ${
                state.podiumPays ? "" : "is-locked"
              }`}
            >
              <p
                className="flex items-center justify-center gap-1.5 text-[11px] font-black sm:text-xs"
                style={{ color: column.tone }}
              >
                <Icon name={column.icon} size={14} />
                {t("מקום {place}", { place: column.place })}
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-1">
                {scaleRewards(ARENA_PODIUM[column.place - 1], state.cities).map((r) => (
                  <RewardChip key={r.kind} reward={r} />
                ))}
              </div>
            </div>
            <div
              className="arn-plinth text-sm text-gold-dim"
              style={{ height: column.height }}
            >
              <span className="nums">{column.place}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <div className="panel-inset rounded-xl p-3">
          <p className="flex items-center gap-2 text-sm font-bold text-bone">
            <Icon name="citizens" size={15} className="text-gold-dim" />
            {t("כל השאר")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {t("פרס השתתפות, גם אם הפסדת הכל — שווה יותר מהתורות שהכניסה עלתה.")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {consolation.map((r) => (
              <RewardChip key={r.kind} reward={r} />
            ))}
          </div>
        </div>

        <div className="panel-inset rounded-xl p-3">
          <p className="flex items-center gap-2 text-sm font-bold text-bone">
            <Icon name="attack" size={15} className="text-gold-dim" />
            {t("ובנוסף, על כל ניצחון")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {t("זהב על כל דו־קרב שלקחת. שבוע חזק של שלושים ניצחונות שווה יותר זהב מהפודיום עצמו.")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {perWin.map((r) => (
              <RewardChip key={r.kind} reward={r} />
            ))}
          </div>
        </div>
      </div>

      {/* Said up front rather than discovered at the payout. A thin tier still
          runs its card and still pays the participation purse and the per-win
          gold — only the diamonds wait for there to be a tournament to win.
          See ARENA_PODIUM_MIN_ENTRANTS. */}
      {!state.podiumPays && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
          <Icon name="lock" size={14} className="shrink-0" />
          <span>
            {t("פרסי הפודיום נעולים עד שיירשמו {min} משתתפים ({have} עד כה). מתחת לזה הזירה עדיין נלחמת ועדיין משלמת — פרס השתתפות וזהב לכל ניצחון — אבל בלי יהלומים.", {
              min: state.podiumMinEntrants,
              have: state.entrants,
            })}
          </span>
        </p>
      )}
    </section>
  );
}

function RewardChip({ reward }: { reward: Reward }) {
  const t = useT();
  return (
    <Tip tip={t(REWARD_LABEL[reward.kind])}>
      <span
        className="inline-flex items-center gap-1 rounded border border-border-subtle bg-black/35 px-1.5 py-0.5 text-[11px] font-bold nums text-bone/90"
        dir="ltr"
      >
        <Icon name={REWARD_ICON[reward.kind]} size={11} />
        {formatCompact(reward.amount)}
      </span>
    </Tip>
  );
}

function PurseChips({ rewards }: { rewards: readonly Reward[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {rewards.map((r) => (
        <RewardChip key={r.kind} reward={r} />
      ))}
    </span>
  );
}

/* ------------------------------ standings ------------------------------ */

function Standings({ state }: { state: ArenaState }) {
  const t = useT();
  const painted = useAfterFirstPaint();
  const duels = Math.max(1, state.entrants - 1);

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
          <Icon name="rankings" size={19} className="text-crimson-bright" />
          {state.resolved ? t("הטבלה הסופית") : t("מי נרשם")}
        </h3>
        {state.resolved && (
          <span className="text-[11px] font-bold text-zinc-500" dir="ltr">
            {t("ניצחונות–הפסדים")}
          </span>
        )}
      </div>

      {state.standings.length === 0 ? (
        <p className="rounded-lg border border-border-subtle bg-black/25 px-3 py-4 text-center text-sm text-zinc-500">
          {t("עדיין אף אחד לא נרשם. היה הראשון.")}
        </p>
      ) : (
        <ol className="space-y-1">
          {state.standings.map((row, index) => {
            const place = state.resolved ? row.place || index + 1 : index + 1;
            const share = state.resolved
              ? Math.round((row.wins / duels) * 100)
              : 0;
            return (
              <li
                key={row.empireId}
                className={`arn-row flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  row.isMe
                    ? "border border-gold/40 bg-gold/8"
                    : "border border-transparent bg-black/20"
                }`}
              >
                {state.resolved && (
                  <span
                    className="arn-winbar"
                    aria-hidden
                    style={{ ["--w" as string]: painted ? share : 0 }}
                  />
                )}
                <span className="flex min-w-0 items-center gap-2">
                  <PlaceMark place={place} resolved={state.resolved} />
                  <PlayerLink
                    empireId={row.empireId}
                    name={row.empireName}
                    titleKey={row.title}
                    className="truncate font-bold"
                  />
                </span>
                {state.resolved && (
                  <span className="shrink-0 font-bold nums" dir="ltr">
                    <span className="text-emerald-300">{row.wins}</span>
                    <span className="text-zinc-600">–</span>
                    <span className="text-red-400">{row.losses}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * The place column. A medal for the podium once the card is fought, and a bare
 * number before it — the order of an unresolved card is the order people signed
 * up in, and dressing that as a ranking would be a lie the table tells.
 */
function PlaceMark({ place, resolved }: { place: number; resolved: boolean }) {
  const medal =
    resolved && place <= 3
      ? ["var(--gold-bright)", "#cbd5e1", "#c08457"][place - 1]
      : null;

  if (!medal) {
    return (
      <span className="w-5 shrink-0 text-center font-black nums text-zinc-600">
        {place}
      </span>
    );
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-black nums"
      style={{ color: medal, borderColor: medal, background: "rgba(0,0,0,0.45)" }}
    >
      {place}
    </span>
  );
}

/**
 * The wait until the card is fought. `serverNow` rather than the reader's own
 * clock, for the reason every countdown in this codebase gives: the boundary
 * that matters is the server's.
 */
function WeekCountdown({ at, serverNow }: { at: number; serverNow: number }) {
  const t = useT();
  const [left, setLeft] = useState(() => at - serverNow);

  useEffect(() => {
    const skew = Date.now() - serverNow;
    const tick = () => setLeft(at - (Date.now() - skew));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [at, serverNow]);

  if (left <= 0)
    return <span className="text-sm font-black text-gold-bright">{t("עוד רגע")}</span>;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  // Deliberately *not* dir="ltr". The label is Hebrew letters glued to Latin
  // digits, so forcing the run left-to-right reorders "3י 5ש" into nonsense —
  // the bidi algorithm already lays this out correctly in an RTL paragraph.
  return (
    <span className="block text-lg font-black nums text-gold-bright">
      {days > 0 ? t("{d}י {h}ש", { d: days, h: hours }) : t("{h}ש", { h: hours })}
    </span>
  );
}
