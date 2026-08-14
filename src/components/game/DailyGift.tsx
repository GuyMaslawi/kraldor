"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useScrollLock } from "@/components/ui/scrollLock";
import { formatNumber } from "@/lib/game/format";
import { REWARD_ICON, REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import { STREAK_CYCLE_DAYS } from "@/lib/game/streak";
import type { StreakState } from "@/server/dailyState";
import { claimStreak } from "@/server/actions/daily";
import { useT } from "@/i18n/client";

/**
 * מתנת הכניסה — the daily reward, brought to the player instead of waiting for
 * the player to come to it.
 *
 * The muster roll has always been on /game/daily, and the nav badge has always
 * said it was waiting. Both are passive: a returning player lands on the base,
 * plays, and leaves without ever collecting the one thing the game gives away
 * for showing up. So the chest comes to the first screen of the day, once.
 *
 * Three rules, and each of them is what keeps a login popup from becoming a
 * nuisance:
 *
 * 1. **It only ever appears when there is something to take.** `claimable` is
 *    the same field the board's own button is drawn from (`buildStreakState`),
 *    computed on the layout's already-loaded empire row — no query, and no way
 *    for the popup and the board to disagree.
 * 2. **Once it is answered it is gone for the day.** Claiming makes the server
 *    say `claimable: false` on the next render, which is what really hides it;
 *    the localStorage stamp below covers the other case — a player who closed
 *    it without claiming should not meet it again on every navigation. Both are
 *    keyed to the *game day*, so both expire at midnight Jerusalem, which is
 *    exactly when the next roll opens.
 * 3. **Not on the board itself.** Opening a modal over the card it duplicates
 *    is noise; there the card is the feature.
 *
 * The claim goes through the same server action the board uses, so everything
 * that already follows a claim — the resource bar, the nav badge, the streak
 * card — follows this one too.
 */

/** One stamp per game day; the value is that day's index. */
const SEEN_KEY = "kraldor.dailyGift.seen";

type Phase = "sealed" | "opening" | "spoils";

/** How long the lid takes to fly open before the haul is revealed. */
const OPEN_MS = 900;

export function DailyGift({
  streak,
  today,
  serverNow,
}: {
  streak: StreakState;
  /** The game-day index this render was built against — the stamp's value. */
  today: number;
  /** The server's clock at render, epoch ms (for the midnight countdown). */
  serverNow: number;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("sealed");
  const [paid, setPaid] = useState<Reward[]>([]);
  /**
   * The run's length after this claim, captured *before* the action fires.
   *
   * The claim revalidates the layout, so `streak` is re-rendered from the
   * signed row while this modal is still open — by the time the haul is on
   * screen the prop already counts today, and reading "+1" off it there would
   * announce a day the player has not lived yet.
   */
  const [earned, setEarned] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  useScrollLock(open);

  const stamp = useCallback(() => {
    try {
      window.localStorage.setItem(SEEN_KEY, String(today));
    } catch {
      // Private mode, or storage full. The popup showing once more is a far
      // smaller failure than a crash on the way into the game.
    }
  }, [today]);

  // The decision to open is deliberately an effect and not part of render:
  // localStorage does not exist on the server, and reading it while rendering
  // would hydrate one tree and paint another.
  useEffect(() => {
    if (!streak.claimable) return;
    if (pathname === "/game/daily") return;
    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(SEEN_KEY);
    } catch {
      seen = null;
    }
    if (seen === String(today)) return;
    // A beat after the screen has painted: arriving *into* a modal reads as a
    // failed navigation, arriving and then being handed something reads as a
    // gift.
    const id = setTimeout(() => setOpen(true), 550);
    return () => clearTimeout(id);
  }, [streak.claimable, pathname, today]);

  const close = useCallback(() => {
    stamp();
    setOpen(false);
  }, [stamp]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const claim = () => {
    setError(undefined);
    // The live count is 0 exactly when the gap has killed the run, so +1 is the
    // new length in both cases — a continued run and one restarting at day 1.
    setEarned(streak.count + 1);
    startTransition(async () => {
      const result = await claimStreak();
      // The stamp goes down on any answer, success or refusal: a second tab
      // that already signed today produces the "come back tomorrow" error, and
      // that is still an answered chest.
      stamp();
      if (result.error) {
        setError(result.error);
        return;
      }
      setPaid(result.paid ?? []);
      setPhase("opening");
      setTimeout(() => setPhase("spoils"), OPEN_MS);
    });
  };

  if (!open || typeof document === "undefined") return null;

  const rung = streak.nextCycleDay;
  const crown = rung === STREAK_CYCLE_DAYS;

  return createPortal(
    <div
      // `h-[100dvh]`, never `inset-0`: a fixed overlay is laid out against the
      // large viewport, so on a phone the card would centre against a box that
      // runs under the browser chrome. See Dialog.
      className="gift-overlay fixed inset-x-0 top-0 z-[120] flex h-[100dvh] items-center justify-center p-4"
      // A backdrop tap dismisses only once the haul is on screen: while the
      // chest is sealed the ✕ is the way out (a stray tap should not throw the
      // day's reward away), and while it is opening there is nothing to answer
      // yet.
      onClick={phase === "spoils" ? close : undefined}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-gift-title"
        dir="rtl"
        className="gift-card panel-gold relative z-10 max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center shadow-[0_24px_70px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="gift-rays" aria-hidden />

        <CloseButton onClick={close} className="absolute left-3 top-3 z-20" />

        <div className="relative">
          <p className="text-[11px] font-black tracking-[0.2em] text-gold-dim">
            {t("מתנת הכניסה היומית")}
          </p>
          <h2
            id="daily-gift-title"
            className="mt-1 flex items-center justify-center gap-2 text-xl font-black text-gold-bright"
          >
            <Icon name="laurel" size={22} className="text-crimson-bright" />
            {phase === "spoils"
              ? t("יום {day} — נחתם!", { day: rung })
              : crown
                ? t("יום {day} — תיבת הנאמנים", { day: rung })
                : t("יום {day} ברצף", { day: rung })}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {phase === "spoils"
              ? t("הרצף שלך: {count} ימים. חזור מחר ותקבל יותר.", {
                  count: earned,
                })
              : streak.broken
                ? t("פספסת יום — הרצף מתחיל מחדש. פתח את התיבה ונתחיל מיום 1.")
                : t("חתמת על המפקד? עוד לא. התיבה של היום מחכה לך.")}
          </p>
        </div>

        {/* ---- the chest ---- */}
        <div className="gift-stage relative mx-auto mt-4 h-40 w-full max-w-[15rem]">
          <Chest phase={phase} crown={crown} />
          {phase !== "sealed" && (
            <>
              <span className="gift-flash" aria-hidden />
              {Array.from({ length: 12 }, (_, i) => (
                <i
                  key={i}
                  className="gift-spark"
                  style={
                    {
                      "--a": `${i * 30}deg`,
                      "--d": `${i * 24}ms`,
                    } as CSSProperties
                  }
                  aria-hidden
                />
              ))}
            </>
          )}
        </div>

        {/* ---- what came out of it ---- */}
        {phase === "spoils" ? (
          <ul className="relative mt-2 flex flex-wrap items-center justify-center gap-2">
            {paid.map((reward, i) => (
              <li
                key={reward.kind}
                style={{ "--i": i } as CSSProperties}
                className="gift-reward flex items-center gap-1.5 rounded-xl border border-gold/60 bg-gold/12 px-3 py-1.5"
              >
                <Icon
                  name={REWARD_ICON[reward.kind]}
                  size={18}
                  className="text-gold-bright"
                />
                <span className="text-sm font-black nums text-bone" dir="ltr">
                  {formatNumber(reward.amount)}
                </span>
                <span className="text-[10px] font-bold text-zinc-400">
                  {t(REWARD_LABEL[reward.kind])}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="relative mt-2 flex flex-wrap items-center justify-center gap-2">
            {streak.nextRewards.map((reward) => (
              <li
                key={reward.kind}
                className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-black/35 px-2.5 py-1"
              >
                <Icon
                  name={REWARD_ICON[reward.kind]}
                  size={15}
                  className="text-gold-dim"
                />
                <span className="text-xs font-bold nums text-bone/80" dir="ltr">
                  {formatNumber(reward.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* ---- the week, so the seventh day reads as a destination ---- */}
        <ol className="relative mt-4 grid grid-cols-7 gap-1">
          {streak.ladder.map((step) => (
            <li
              key={step.day}
              style={{ "--i": step.day } as CSSProperties}
              className={`gift-step rounded-md border py-1 text-center ${
                step.day === rung
                  ? "border-gold bg-gold/15"
                  : step.passed
                    ? "border-emerald-700/50 bg-emerald-950/40"
                    : "border-border-subtle bg-black/30"
              }`}
            >
              <span
                className={`block text-[10px] font-black nums ${
                  step.day === STREAK_CYCLE_DAYS
                    ? "text-crimson-bright"
                    : step.day === rung
                      ? "text-gold-bright"
                      : "text-zinc-500"
                }`}
              >
                {step.day}
              </span>
              {step.passed ? (
                <Icon name="check" size={10} className="mx-auto text-emerald-400" />
              ) : (
                <Icon
                  name={step.day === STREAK_CYCLE_DAYS ? "crown" : "gift"}
                  size={10}
                  className={`mx-auto ${
                    step.day === rung ? "text-gold-bright" : "text-zinc-600"
                  }`}
                />
              )}
            </li>
          ))}
        </ol>

        {/* ---- the one button ---- */}
        <div className="relative mt-4">
          {phase === "sealed" ? (
            // `w-full` on the wrapper as well as the button: .gleam-wrap is
            // inline-flex, so without it the button shrinks to its text and
            // stops matching the one the spoils step draws in its place.
            <span className="gleam-wrap w-full">
              <button
                type="button"
                onClick={claim}
                disabled={pending}
                className={`btn btn-gold w-full justify-center px-5 py-2.5 text-sm disabled:opacity-60${
                  pending ? "" : " btn-gleam"
                }`}
              >
                {pending ? (
                  t("פותח…")
                ) : (
                  <>
                    <Icon name="gift" size={16} />
                    {t("פתח את התיבה")}
                  </>
                )}
              </button>
              {!pending && (
                <>
                  <i className="gleam-spark gleam-spark-a" aria-hidden />
                  <i className="gleam-spark gleam-spark-b" aria-hidden />
                </>
              )}
            </span>
          ) : (
            // Held disabled through the lid animation: the same box in the same
            // place, so nothing under the player's thumb moves, but the reveal
            // cannot be tapped away before it has happened.
            <button
              type="button"
              onClick={close}
              disabled={phase === "opening"}
              className="btn btn-gold w-full justify-center px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {phase === "opening" ? t("פותח…") : t("קדימה, לשלטון")}
            </button>
          )}

          {error && (
            <p className="mt-2 text-xs font-bold text-amber-300">{error}</p>
          )}

          <p className="mt-2 text-[10px] text-zinc-500">
            {t("המתנה הבאה נפתחת בחצות — בעוד {left}", {
              left: untilMidnight(t, streak.resetsAt, serverNow),
            })}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** "5ש 20ד" — the wait to midnight Jerusalem, from the server's own clock. */
function untilMidnight(
  t: ReturnType<typeof useT>,
  at: number,
  serverNow: number
): string {
  const left = Math.max(0, at - serverNow);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return hours > 0
    ? t("{h}ש {m}ד", { h: hours, m: minutes })
    : t("{m}ד", { m: Math.max(1, minutes) });
}

/**
 * The chest, drawn rather than imported.
 *
 * An SVG and not one of the game's PNGs because the lid has to *move*: it is
 * its own group, hinged on the back edge of the body, so opening is one
 * transform on one node — no sprite sheet, no second asset to keep in sync with
 * the palette, and it stays sharp on any screen. The crown variant is the same
 * chest with the seventh day's trim.
 */
function Chest({ phase, crown }: { phase: Phase; crown: boolean }) {
  return (
    <svg
      // The 44 units of headroom above the chest are the *lid's* room: hinged
      // on its back-left corner it swings a long way up, and without that space
      // inside the drawing it flies out of the stage and over the line of text
      // above it.
      viewBox="0 -44 160 164"
      className={`gift-chest absolute inset-0 m-auto h-full w-full ${
        phase === "sealed" ? "gift-chest-sealed" : "gift-chest-open"
      }`}
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id="gift-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a4526" />
          <stop offset="100%" stopColor="#2a1f10" />
        </linearGradient>
        <linearGradient id="gift-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e4c35a" />
          <stop offset="100%" stopColor="#8f7a45" />
        </linearGradient>
        <radialGradient id="gift-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe9a8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffe9a8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the light inside, only visible once the lid is up */}
      <ellipse
        className="gift-inner-glow"
        cx="80"
        cy="66"
        rx="52"
        ry="30"
        fill="url(#gift-glow)"
      />

      {/* body */}
      <g className="gift-chest-body">
        <rect x="24" y="62" width="112" height="44" rx="6" fill="url(#gift-wood)" />
        <rect
          x="24"
          y="62"
          width="112"
          height="44"
          rx="6"
          fill="none"
          stroke="url(#gift-band)"
          strokeWidth="3"
        />
        <rect x="70" y="62" width="20" height="44" fill="url(#gift-band)" opacity="0.85" />
        <rect x="24" y="96" width="112" height="6" fill="#1a1309" opacity="0.6" />
      </g>

      {/* lid — hinged on the back-left of the body, so it swings up and away */}
      <g className="gift-chest-lid">
        <path
          d="M24 62 A56 40 0 0 1 136 62 Z"
          fill="url(#gift-wood)"
          stroke="url(#gift-band)"
          strokeWidth="3"
        />
        <path d="M70 33 L90 33 L90 62 L70 62 Z" fill="url(#gift-band)" opacity="0.85" />
        {crown && (
          <path
            d="M80 20 L86 30 L74 30 Z"
            fill="#e4c35a"
            className="gift-chest-jewel"
          />
        )}
      </g>

      {/* the lock plate, which pops off when it opens */}
      <g className="gift-chest-lock">
        <rect x="71" y="56" width="18" height="16" rx="3" fill="url(#gift-band)" />
        <circle cx="80" cy="63" r="3" fill="#2a1f10" />
      </g>
    </svg>
  );
}
