"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNumber, formatCompact } from "@/lib/game/format";
import { REWARD_ICON, REWARD_LABEL } from "@/lib/game/rewards";
import {
  WORLD_BOSS_BLOW_META,
  WORLD_BOSS_KILL_DIAMONDS,
  WORLD_BOSS_MAX_STRIKES,
  WORLD_BOSS_PHASES,
  WORLD_BOSS_PHASE_BY_KEY,
  type WorldBossBlowEntry,
  type WorldBossState,
  type WorldBossStrikeReveal,
} from "@/lib/game/worldBoss";
import {
  collectWorldBoss,
  pollWorldBoss,
  strikeWorldBoss,
} from "@/server/actions/worldBoss";
import { useT } from "@/i18n/client";

/**
 * /game/worldboss — the arena.
 *
 * The health bar is the whole screen. Everything else on it exists to answer
 * one of two questions a player arrives with: "are we going to get it down"
 * (the bar, the countdown, the number of people fighting) and "did I do
 * anything" (my damage, my rank, my share). Nothing here is decoration for its
 * own sake — a fixture the whole server shares only works if a stranger's
 * contribution is legible.
 *
 * ## Why a blow is played rather than printed
 *
 * A strike used to be a button press and a line of text, which is a strange
 * thing for the one enemy the entire server fights: the city boss — a *private*
 * encounter — gets a minute-long animated assault, and the world's did not get
 * a beat. So a blow is now revealed over a couple of seconds: the beast rears,
 * the blow lands with the figure bursting off it, the bar drops, and the army
 * says what happened.
 *
 * It is deliberately **short**, and the reason is arithmetic. The city boss's
 * assault costs 300 turns and is fought a handful of times a cycle, so a minute
 * of ceremony is an event. A strike here costs 40 turns and there are
 * WORLD_BOSS_MAX_STRIKES of them a week — at a minute each that is twenty
 * minutes of watching, which is a chore rather than a ritual. Two seconds is a
 * beat; the longer sequences are saved for the two moments that are actually
 * rare, a phase crossing and the kill.
 *
 * Nothing here is authority. The blow was committed server-side before this
 * component heard about it (see `strikeWorldBoss`), so the reveal can be cut
 * short, missed, or skipped entirely under `prefers-reduced-motion` with no
 * effect on what was dealt.
 *
 * ## Nothing a strike does may move the page
 *
 * A strike used to end in a printed receipt — "you hit it for 10,011, it has
 * 135,112 left" — and the whole card below it jumped every time the line
 * appeared and again when it went. That is a bad trade for a button pressed
 * WORLD_BOSS_MAX_STRIKES times a week, and it was also redundant: the health it
 * quoted is the bar, which is on screen permanently and is the largest thing on
 * it. So the receipt is gone, and everything a blow has to say is said **beside
 * the beast** — the figure thrown off it, the army's account over the lore, and
 * a standing tally of your damage pinned next to the sigil. All of it is
 * absolutely positioned: a strike changes what the card *shows* and never what
 * it measures, so the page under it does not move at all.
 *
 * The one thing still printed is an error, which is the one thing the bar
 * cannot show.
 */

/* ------------------------------ the reveal's clock ------------------------------ */

/** The beast rears back before the blow lands. */
const WINDUP_MS = 500;
/** The blow, the figure and the bar — the beat an ordinary strike ends on. */
const IMPACT_MS = 1_500;
/** The pause after the beast staggers, before the kill takes the screen. */
const KILL_DELAY_MS = 700;
/** How long the felled-beast sequence holds before the page settles. */
const KILL_MS = 4_200;
/** How long a phase announcement sits on screen. Three of these a week. */
const CRY_MS = 2_200;

/**
 * How often the arena re-reads the world.
 *
 * The only screen in the game whose contents change while the viewer does
 * nothing: the bar moves when a stranger strikes. Twelve seconds is slow for a
 * poll and deliberately so — this page can be left open all week, so the client
 * additionally holds off while a reveal is playing and while the tab is hidden,
 * and stops entirely once the beast is down.
 */
const POLL_MS = 12_000;

/** Which beat of the reveal is on screen. */
type Beat = "windup" | "impact" | "cry" | "kill";

interface Playing {
  reveal: WorldBossStrikeReveal;
  beat: Beat;
}

/**
 * The blow this reader last landed, kept after the reveal has finished.
 *
 * The float over the beast lasts a second and a half; this is what remains, and
 * it is the reason the printed receipt could be dropped without the player
 * losing the figure. `seq` only exists to re-key the element so the pop plays
 * again on a blow that happened to deal exactly the same damage as the last.
 */
interface LastBlow {
  seq: number;
  reveal: WorldBossStrikeReveal;
  /**
   * The running total this blow brought the striker to.
   *
   * `state.myDamage` is only refreshed by the poll that follows the reveal, so
   * for the second in between it is still the figure from *before* this blow —
   * and a tally that fell back to the old total and then jumped would be worse
   * than no tally. Taken here from the state at the instant the button was
   * pressed, and read as a floor, so the number only ever climbs.
   */
  total: number;
}

export function WorldBossArena({ state: initial }: { state: WorldBossState }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<WorldBossState>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [lastBlow, setLastBlow] = useState<LastBlow | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Read by the poll, which must not overwrite the state out from under a
  // running reveal — the bar would jump to the polled health mid-animation.
  // Mirrored into a ref in an effect rather than assigned during render, so the
  // interval's closure can read it without being torn down and rebuilt on every
  // beat of the reveal.
  const busy = useRef(false);
  useEffect(() => {
    busy.current = playing !== null || pending;
  }, [playing, pending]);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /* ------------------------------ polling ------------------------------ */

  useEffect(() => {
    if (state.defeated) return;
    const id = setInterval(() => {
      if (busy.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void pollWorldBoss().then((result) => {
        // `retry` and a missing state both mean "nothing was learned" — never
        // "the fixture is gone". The screen keeps what it has.
        if (result.state && !busy.current) setState(result.state);
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [state.defeated]);

  /* ------------------------------ striking ------------------------------ */

  const finish = useCallback(
    (result: { error?: string; success?: string }) => {
      setPlaying(null);
      setMessage(result);
      // Re-read rather than lean on the refresh below. `state` is seeded from a
      // prop and then owned here, so a server re-render hands this component a
      // new `initial` it will never look at — without this, the damage board,
      // the strike allowance and the feed would all sit a blow out of date
      // until the next poll came round.
      void pollWorldBoss().then((polled) => {
        if (polled.state) setState(polled.state);
      });
      // The strike moved turns, and on a kill diamonds too — both of which live
      // in the layout's resource bar, which this component does not own.
      router.refresh();
    },
    [router]
  );

  /**
   * The kill is the one blow that still says something in words, because it is
   * the one blow the bar cannot express: the beast is at zero either way, and
   * only the line says the diamonds are yours. Every other blow is silent —
   * see the note at the head of this file.
   */
  const play = useCallback(
    (reveal: WorldBossStrikeReveal, receipt: { success?: string }) => {
      const at = (ms: number, run: () => void) => {
        timers.current.push(setTimeout(run, ms));
      };

      setPlaying({ reveal, beat: "windup" });
      at(WINDUP_MS, () => setPlaying({ reveal, beat: "impact" }));

      if (reveal.slain) {
        at(WINDUP_MS + KILL_DELAY_MS, () => setPlaying({ reveal, beat: "kill" }));
        at(WINDUP_MS + KILL_DELAY_MS + KILL_MS, () => finish(receipt));
        return;
      }

      // A crossing is worth stopping for; an ordinary blow is not.
      if (reveal.phaseAfter !== reveal.phaseBefore) {
        at(WINDUP_MS + IMPACT_MS, () => setPlaying({ reveal, beat: "cry" }));
        at(WINDUP_MS + IMPACT_MS + CRY_MS, () => finish({}));
        return;
      }

      at(WINDUP_MS + IMPACT_MS, () => finish({}));
    },
    [finish]
  );

  const strike = () => {
    clearTimers();
    setPlaying(null);
    setMessage({});
    startTransition(async () => {
      const result = await strikeWorldBoss();
      // Set before the reveal plays and kept after it ends, so the figure is on
      // screen for a reader who skipped the animation entirely as well as for
      // one who watched it.
      if (result.reveal) {
        const reveal = result.reveal;
        const total = state.myDamage + reveal.damage;
        setLastBlow((prev) => ({ seq: (prev?.seq ?? 0) + 1, reveal, total }));
      }
      // A reader who has asked for less motion is handed the same standing
      // tally with no sequence in front of it — the blow has already landed
      // either way.
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (result.reveal && !reduced) {
        play(result.reveal, { success: result.success });
      } else {
        finish({
          error: result.error,
          success: result.reveal?.slain ? result.success : undefined,
        });
      }
    });
  };

  const collect = () => {
    setMessage({});
    startTransition(async () => {
      const result = await collectWorldBoss();
      setMessage({ error: result.error, success: result.success });
      router.refresh();
    });
  };

  /* ------------------------------ what the screen shows ------------------------------ */

  // During the wind-up the bar is still at the health the blow found; from the
  // impact on it shows what the blow left. Outside a reveal it is simply the
  // world's, which the poll keeps current.
  const hp = playing
    ? playing.beat === "windup"
      ? playing.reveal.hpBefore
      : playing.reveal.hpAfter
    : state.hp;
  const maxHp = playing ? playing.reveal.maxHp : state.maxHp;
  const pct = maxHp > 0 ? (hp / maxHp) * 100 : 0;

  const phaseKey =
    playing && playing.beat !== "windup" ? playing.reveal.phaseAfter : state.phase;
  const phase = WORLD_BOSS_PHASE_BY_KEY.get(phaseKey) ?? WORLD_BOSS_PHASES[0];

  const slain = state.defeated || playing?.beat === "kill";
  const canStrike =
    !state.defeated && state.strikesLeft > 0 && state.turns >= state.strikeTurns;
  const blow = playing ? WORLD_BOSS_BLOW_META[playing.reveal.grade] : null;

  return (
    <div
      style={
        {
          "--accent": state.accent,
          "--heat": phase.heat,
        } as CSSProperties
      }
      className="space-y-5"
    >
      {/* -------- the beast -------- */}
      <section
        className={`wb-scene panel-gold rounded-2xl p-4 sm:p-6${
          playing && playing.beat !== "windup" ? " wb-scene-hit" : ""
        }`}
        data-phase={phase.key}
      >
        <span className="wb-aura" aria-hidden />
        {playing && playing.beat !== "windup" && (
          <span className="wb-shock" aria-hidden />
        )}

        <div className="relative text-center">
          {/* Your standing in the fight, pinned to the beast itself. This is
              where the old receipt's figure went: the running total is the
              number that actually decides your share of the spoils, and the
              blow beside it is the one you just landed. Absolute, so it can
              appear on the first strike of the week without moving the card. */}
          {(state.myDamage > 0 || lastBlow) && (
            <div className="wb-tally">
              <span className="wb-tally-label">{t("הנזק שלך")}</span>
              <span className="wb-tally-total nums" dir="ltr">
                {formatCompact(Math.max(state.myDamage, lastBlow?.total ?? 0))}
              </span>
              {lastBlow && (
                <span
                  key={lastBlow.seq}
                  className={`wb-tally-blow nums ${
                    WORLD_BOSS_BLOW_META[lastBlow.reveal.grade].tone
                  }`}
                  dir="ltr"
                >
                  −{formatCompact(lastBlow.reveal.damage)}
                </span>
              )}
            </div>
          )}

          <span
            className={`wb-sigil block text-6xl sm:text-7xl ${
              slain
                ? "wb-sigil-slain"
                : playing?.beat === "windup"
                  ? "wb-sigil-windup"
                  : playing
                    ? "wb-sigil-struck"
                    : ""
            }`}
            aria-hidden
          >
            {state.sigil}
          </span>

          {/* The figure the blow took off, thrown clear of the beast. */}
          {playing && playing.beat !== "windup" && blow && (
            <span
              className={`wb-damage nums ${blow.tone}`}
              dir="ltr"
              aria-hidden
            >
              −{formatNumber(playing.reveal.damage)}
            </span>
          )}

          <h2 className="mt-2 text-xl font-black tracking-wide text-gold-bright sm:text-2xl">
            {t(state.name)}
          </h2>
          {/* The lore steps aside for the blow rather than being pushed down by
              it — one element's opacity instead of two elements' heights. The
              account is absolute *within this box* rather than within the whole
              header, so a two-line account over a one-line lore spreads about
              the lore's own centre instead of climbing over the beast's name. */}
          <div className="relative mt-1.5">
            <p
              className={`mx-auto max-w-2xl text-sm leading-relaxed text-bone/80 transition-opacity duration-200 ${
                playing && playing.beat !== "windup" ? "opacity-0" : "opacity-100"
              }`}
            >
              {t(state.lore)}
            </p>

            {/* What the army says about the blow, over the lore it replaced. */}
            {playing && playing.beat !== "windup" && blow && !playing.reveal.slain && (
              <div className="wb-account" role="status">
                <p className={`text-sm font-black ${blow.tone}`}>{t(blow.label)}</p>
                <p className="mt-0.5 text-xs text-bone/70">{t(blow.line)}</p>
              </div>
            )}
          </div>
        </div>

        {/* The bar. Deliberately the largest thing on the page. */}
        <div className="relative mt-5">
          <div className="wb-bar" aria-hidden>
            <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="flex items-baseline gap-2">
              <span className="font-black nums text-bone" dir="ltr">
                {formatNumber(Math.round(hp))} / {formatNumber(Math.round(maxHp))}
              </span>
              {!slain && (
                <Tip tip={t("מצב המפלצת משתנה ככל שהיא נשחקת — כל השרת חוצה אותו יחד")}>
                  <span className="wb-phase-chip">{t(phase.label)}</span>
                </Tip>
              )}
            </span>
            <span className="flex items-center gap-3 text-zinc-500">
              <span>{t("{count} נלחמים", { count: state.participants })}</span>
              <WeekCountdown at={state.endsAt} serverNow={state.serverNow} />
            </span>
          </div>
        </div>

        {/* -------- the beast turns -------- */}
        {playing?.beat === "cry" && (
          <div className="wb-cry relative mt-4" role="status">
            <p className="text-center text-sm font-black text-crimson-bright">
              {t(
                WORLD_BOSS_PHASE_BY_KEY.get(playing.reveal.phaseAfter)?.cry ??
                  "המפלצת משתנה."
              )}
            </p>
          </div>
        )}

        {/* -------- the one control -------- */}
        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-3">
          {slain ? (
            <div className={`text-center${playing?.beat === "kill" ? " wb-kill" : ""}`}>
              <p className="text-lg font-black text-emerald-300">
                {t("המפלצת הופלה!")}
              </p>
              {playing?.beat === "kill" ? (
                <p className="mt-0.5 inline-flex items-center gap-1 text-sm font-bold text-cyan-300">
                  <Icon name="diamond" size={14} />
                  {t("המכה האחרונה שלך. {diamonds} יהלומים.", {
                    diamonds: playing.reveal.diamonds,
                  })}
                </p>
              ) : (
                state.slayerName && (
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {t("המכה האחרונה: {name}", { name: state.slayerName })}
                  </p>
                )
              )}
            </div>
          ) : (
            <span className="gleam-wrap">
              <button
                type="button"
                onClick={strike}
                disabled={pending || playing !== null || !canStrike}
                className={`btn btn-gold px-6 py-2.5 text-base disabled:opacity-50${
                  pending || playing !== null || !canStrike ? "" : " btn-gleam"
                }`}
              >
                {pending || playing ? (
                  t("מכה…")
                ) : (
                  <>
                    <Icon name="attack" size={18} />
                    {t("הכה")}
                  </>
                )}
              </button>
              {!pending && !playing && canStrike && (
                <>
                  <i className="gleam-spark gleam-spark-a" aria-hidden />
                  <i className="gleam-spark gleam-spark-b" aria-hidden />
                </>
              )}
            </span>
          )}

          {/* `slain` rather than `state.defeated`: during the kill sequence the
              polled state has not caught up yet, and leaving the turn cost and
              the strike allowance beside "the beast is down" undercuts the one
              moment in the fixture that belongs to somebody. */}
          {!slain && (
            <span className="flex flex-wrap items-center gap-3 text-xs">
              <Tip tip={t("כל מכה עולה תורות")}>
                <span
                  className={`flex items-center gap-1 font-bold nums ${
                    state.turns >= state.strikeTurns ? "text-gold" : "text-red-400"
                  }`}
                >
                  <Icon name="turns" size={13} />
                  {state.strikeTurns}
                </span>
              </Tip>
              <Tip tip={t("הנזק נפרש סביב המספר הזה — אף אחד לא יודע איזו מכה תפיל אותה")}>
                <span className="flex items-center gap-1 font-bold nums text-crimson-bright" dir="ltr">
                  ~{formatCompact(state.expectedDamage)}
                </span>
              </Tip>
              <Tip
                tip={t("מספר המכות מוגבל כדי שלוח הנזק לא יהיה עותק של דירוג הכוח")}
              >
                <span className="font-bold nums text-zinc-400">
                  {t("{left}/{max} מכות", {
                    left: state.strikesLeft,
                    max: WORLD_BOSS_MAX_STRIKES,
                  })}
                </span>
              </Tip>
            </span>
          )}
        </div>

        {/* -------- the spoils --------
            Shown while the beast is still standing, not only over its body. The
            purse is the answer to "what do I get for this", and a player asks
            that *before* spending forty turns — quoting it only after the kill
            answered the question for everybody except the person deciding. It
            is the live figure: `state.reward` is computed from the damage and
            the head count as they stand this second, so it moves as the week
            fills up, which is exactly what a player needs to understand about
            how the split works. */}
        {(state.defeated || state.myDamage > 0) && (
          <div className="relative mt-4 flex flex-col items-center gap-2">
            <p className="text-[11px] font-bold tracking-wide text-zinc-400">
              {state.defeated ? (
                t("חלקך בשלל")
              ) : (
                <Tip
                  tip={t(
                    "אומדן חי — החלק השווה קטן ככל שמצטרפים עוד שחקנים, וחלק הנזק גדל עם כל מכה שלך"
                  )}
                >
                  <span>{t("החלק שלך אם היא תיפול עכשיו")}</span>
                </Tip>
              )}
            </p>
            <span className="flex flex-wrap items-center justify-center gap-1.5">
              {state.reward.map((r) => (
                <Tip key={r.kind} tip={t(REWARD_LABEL[r.kind])}>
                  <span
                    className="inline-flex items-center gap-1 rounded border border-border-subtle bg-black/30 px-2 py-0.5 text-xs font-bold nums text-bone/90"
                    dir="ltr"
                  >
                    <Icon name={REWARD_ICON[r.kind]} size={12} />
                    {formatCompact(r.amount)}
                  </span>
                </Tip>
              ))}
            </span>
            {state.claimed ? (
              <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-300">
                <Icon name="check" size={16} />
                {t("אספת את חלקך.")}
              </p>
            ) : state.claimable ? (
              <button
                type="button"
                onClick={collect}
                disabled={pending}
                className="btn btn-gold px-5 py-2 text-sm disabled:opacity-60"
              >
                {pending ? t("אוסף…") : t("קח את חלקך")}
              </button>
            ) : state.defeated ? (
              <p className="text-xs text-zinc-500">
                {t("לא הכית את המפלצת השבוע — אין חלק בשלל.")}
              </p>
            ) : (
              // Standing beast, and this reader has struck it: the purse above
              // is a quote, and the button that pays it opens the moment it
              // falls. Saying so is what stops the quote from reading as
              // something already banked.
              <p className="text-[11px] text-zinc-500">
                {t("ייאסף בכפתור כאן ברגע שהיא תיפול — גם אם לא אתה תפיל אותה.")}
              </p>
            )}
          </div>
        )}

        {/* The receipt, once the reveal has had its beat. */}
        {!playing && (
          <div className="relative mt-3">
            <FormMessage error={message.error} success={message.success} />
          </div>
        )}
      </section>

      {/* -------- the fight, as it happens -------- */}
      <BlowFeed feed={state.feed} serverNow={state.serverNow} />

      {/* -------- the damage board -------- */}
      <section className="panel rounded-2xl p-4 sm:p-5">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-black tracking-wide text-gold-bright">
          <Icon name="rankings" size={19} className="text-crimson-bright" />
          {t("לוח הנזק")}
          {state.myDamage > 0 && (
            <span className="rounded bg-black/40 px-2 py-0.5 text-[11px] font-bold nums text-zinc-400">
              {t("הנזק שלך: {damage}", {
                damage: formatCompact(state.myDamage),
              })}
            </span>
          )}
        </h3>
        {/* The four questions a player actually arrives with, in the order they
            ask them. The one line this replaced stated the formula correctly
            and answered none of them: it never said that striking once is
            enough, never said what happens when the server is crowded, and
            never said that the fight does not run in the background — which is
            the thing a player assumes, because every other boss in this game
            does. A fixture the whole server shares is only shared if the rules
            are legible to somebody who has not read the code. */}
        <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-zinc-400">
          <li>
            {t("מכה אחת מספיקה כדי לקבל חלק בשלל — לא חייבים להפיל אותה, וגם לא להיות בין המובילים.")}
          </li>
          <li>
            {t("חצי מהשלל מתחלק שווה בשווה בין כל {count} המכים, וחצי לפי אחוז הנזק שלך. ככל שפחות שחקנים משתתפים, החלק השווה של כל אחד גדול יותר.", {
              count: Math.max(1, state.participants),
            })}
          </li>
          <li>
            {t("רק מי שמנחית את המכה האחרונה מקבל {diamonds} יהלומים לעצמו. אי אפשר לתכנן אותה — הנזק נפרש, אז אף אחד לא יודע איזו מכה תסיים.", {
              diamonds: WORLD_BOSS_KILL_DIAMONDS,
            })}
          </li>
          <li>
            {t("כל מכה מסתיימת מיד ונרשמת בו במקום. אין כאן קרב שממשיך ברקע, ואפשר להכות גם בזמן שמצור על בוס העיר רץ.")}
          </li>
        </ul>

        {state.board.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border-subtle bg-black/25 px-3 py-3 text-sm text-zinc-500">
            {t("אף אחד עדיין לא הכה. תהיה הראשון.")}
          </p>
        ) : (
          <ol className="mt-3 space-y-1">
            {state.board.map((striker, index) => (
              <li
                key={striker.empireId}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  striker.isMe
                    ? "border border-gold/40 bg-gold/8"
                    : "border border-transparent bg-black/20"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-center font-black nums text-zinc-600">
                    {index + 1}
                  </span>
                  <PlayerLink
                    empireId={striker.empireId}
                    name={striker.empireName}
                    titleKey={striker.title}
                    className="truncate font-bold"
                  />
                  <span className="shrink-0 text-[10px] nums text-zinc-600">
                    {t("×{hits}", { hits: striker.hits })}
                  </span>
                </span>
                <span className="shrink-0 font-bold nums text-crimson-bright" dir="ltr">
                  {formatCompact(striker.damage)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ the live feed ------------------------------ */

/**
 * The last blows anybody landed.
 *
 * The damage board is standings, and standings look the same whether they were
 * earned an hour ago or on Monday. This is the part of the arena that is other
 * people: it is how a player who opens the page on Thursday can tell whether
 * the server is still fighting or has given up on the week.
 *
 * Rows that arrived since the last read slide in, so a blow landing while
 * somebody is reading is *seen* rather than merely present on the next scroll.
 */
function BlowFeed({
  feed,
  serverNow,
}: {
  feed: WorldBossBlowEntry[];
  serverNow: number;
}) {
  const t = useT();
  const seen = useRef<Set<string>>(new Set(feed.map((b) => b.id)));
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const arrived = feed.filter((b) => !seen.current.has(b.id)).map((b) => b.id);
    for (const blow of feed) seen.current.add(blow.id);
    if (arrived.length > 0) setFresh(new Set(arrived));
  }, [feed]);

  if (feed.length === 0) return null;

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="attack" size={18} className="text-crimson-bright" />
        {t("המכות האחרונות")}
      </h3>

      <ul className="mt-3 space-y-1">
        {feed.map((blow) => (
          <li
            key={blow.id}
            className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
              blow.slaying
                ? "border border-emerald-500/40 bg-emerald-500/8"
                : blow.isMe
                  ? "border border-gold/40 bg-gold/8"
                  : "border border-transparent bg-black/20"
            }${fresh.has(blow.id) ? " wb-feed-new" : ""}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <PlayerLink
                empireId={blow.empireId}
                name={blow.empireName}
                titleKey={blow.title}
                className="truncate font-bold"
              />
              {blow.slaying && (
                <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-black text-emerald-300">
                  {t("המכה האחרונה")}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {/* "−29.6K → 96.4K": what the blow took and what it left. Without
                  the arrow the two figures read as one number twice. */}
              <span className="flex items-center gap-1 nums" dir="ltr">
                <span className="font-bold text-crimson-bright">
                  −{formatCompact(blow.damage)}
                </span>
                <span className="text-[10px] text-zinc-600">
                  → {formatCompact(blow.hpAfter)}
                </span>
              </span>
              <Ago at={blow.at} serverNow={serverNow} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "לפני 3 דק׳" — measured against the server's clock, like every other age here. */
function Ago({ at, serverNow }: { at: number; serverNow: number }) {
  const t = useT();
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const skew = Date.now() - serverNow;
    const tick = () => setNow(Date.now() - skew);
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [serverNow]);

  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  const label =
    minutes < 1
      ? t("עכשיו")
      : minutes < 60
        ? t("לפני {m} דק׳", { m: minutes })
        : t("לפני {h} ש׳", { h: Math.floor(minutes / 60) });

  return <span className="w-14 shrink-0 text-end text-[10px] text-zinc-600">{label}</span>;
}

/**
 * The wait until the week's fixture closes, ticking in the browser.
 *
 * `serverNow` rather than the reader's own clock, for the reason the daily
 * board's countdown states: the boundary that matters is the server's, and a
 * device an hour fast would otherwise show a fight that has already ended.
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

  if (left <= 0) return <span>{t("השבוע נגמר")}</span>;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  return (
    <span className="nums" dir="ltr">
      {days > 0 ? t("{d}י {h}ש", { d: days, h: hours }) : t("{h}ש", { h: hours })}
    </span>
  );
}
