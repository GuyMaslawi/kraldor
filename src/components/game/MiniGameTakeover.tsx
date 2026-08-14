"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "@/components/ui/scrollLock";
import { CloseButton } from "@/components/ui/CloseButton";
import { MINIGAME_TYPE_META, type MiniGameState } from "@/lib/game/minigame";
import { useT } from "@/i18n/client";

/**
 * The release announcement for a mini-game — the four seconds where the screen
 * belongs to it.
 *
 * Why this exists at all: a released game used to announce itself with a toast
 * in the bottom-right corner, which is the same corner, the same size and
 * roughly the same shape as every other note the game puts there. Happy Hour,
 * released the same way by the same admin, takes the whole screen — so players
 * learned that a golden hour is an event and a mini-game is a notification,
 * which is exactly backwards: the mini-game is the one with a prize, a clock
 * and rivals racing for it. It now interrupts like Happy Hour does.
 *
 * What it is NOT is a copy of that screen. Happy Hour is gold, molten and
 * numeric — one enormous multiplier. A mini-game has no number worth 15rem; it
 * has a *table*. So each type brings its own stage, its own palette and its own
 * motion, and the point is that a player recognises which game was released
 * before reading a single word:
 *
 *   • מצא את הכדור — green felt under a spotlight, three cups weaving over it,
 *     the ball flashing once before it vanishes under one of them.
 *   • פריצת הכספת — cold steel, a vault door with a winding dial, a searchlight
 *     crossing it and digits raining down the screen.
 *
 * Dismissible by anything — the CTA, the close, Escape, a click anywhere, or
 * simply waiting — because it is an announcement, not a decision. The pill in
 * the command bar carries the release for the rest of its window.
 */

/** How long the takeover holds the screen before bowing out on its own. */
const TAKEOVER_MS = 6_000;

/** Matches the fade-out in `.mgt[data-leaving="true"]`. */
const LEAVE_MS = 420;

type Flavour = {
  /** Drives the palette and the background wash — see `.mgt[data-game]`. */
  game: "cups" | "safe" | "map" | "riddle";
  kicker: string;
  tagline: string;
  cta: string;
};

/** Hebrew source text, translated where the takeover is drawn. */
// i18n-keys-start: dictionary keys, drawn through t(flavour.…) in the takeover
const FLAVOUR: Record<MiniGameState["type"], Flavour> = {
  FIND_BALL: {
    game: "cups",
    kicker: "משחק חדש על השולחן",
    tagline: "כוס אחת מסתירה את הכדור. עין חדה, יד מהירה — והפרס שלך.",
    cta: "🥤 קדימה, לשולחן!",
  },
  CRACK_SAFE: {
    game: "safe",
    kicker: "כספת חדשה נפתחה לפריצה",
    tagline: "הקוד ידוע רק לכספת. פענח אותו לפני כולם — וקח את מה שבפנים.",
    cta: "🔓 קדימה, לפריצה!",
  },
  TREASURE_MAP: {
    game: "map",
    kicker: "מפה חדשה הגיעה לנמל",
    tagline: "משהו קבור על הרשת. כל חפירה מספרת כמה קרוב היית — ולא יותר מזה.",
    cta: "🗺️ קדימה, לחפירה!",
  },
  RIDDLE: {
    game: "riddle",
    kicker: "חידה חדשה נתלתה בכיכר",
    tagline: "שאלה אחת, תשובה אחת. מי שיודע — יודע.",
    cta: "❓ קדימה, לחידה!",
  },
};
// i18n-keys-end

/* ---------------------------- the two stages ---------------------------- */

/**
 * Three cups weaving over the felt, with the ball flashing once at the start.
 *
 * The cups are drawn here rather than reused from the board's `.cup` (which is
 * a `<button>` with its own sizing, hover and disabled states): this is scenery
 * at three times the size, and inheriting a clickable component's rules to draw
 * a picture is how a decoration ends up looking focusable.
 */
function CupsStage() {
  return (
    <div className="mgt-stage mgt-stage--cups" aria-hidden>
      <span className="mgt-spot" />
      <div className="mgt-felt" />
      <span className="mgt-ball" />
      {[0, 1, 2].map((i) => (
        <span key={i} className="mgt-cup" style={{ ["--i" as string]: i }}>
          <span className="mgt-cup-body">
            <span className="mgt-cup-shine" />
          </span>
          <span className="mgt-cup-base" />
        </span>
      ))}
    </div>
  );
}

/**
 * The shared stage for the newer games: one large sigil, breathing.
 *
 * Deliberately not two more bespoke animations. The takeover holds the screen
 * for six seconds and then hands over to the pill in the command bar — the
 * palette and the flavour line already say which game arrived, and a scene
 * nobody has time to read is scenery for its own sake.
 */
function SigilStage({ sigil }: { sigil: string }) {
  return (
    <div className="mgt-stage mgt-stage--sigil" aria-hidden>
      <span className="mgt-spot" />
      <span className="mgt-sigil">{sigil}</span>
    </div>
  );
}

/** The vault: a winding dial under a searchlight, over falling digits. */
function SafeStage() {
  return (
    <div className="mgt-stage mgt-stage--safe" aria-hidden>
      {/* A fixed comb rather than random placement: it re-renders identically
          and a designed spread looks less like noise than real randomness. */}
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className="mgt-digit nums"
          style={{
            left: `${(i * 8.5 + 4) % 100}%`,
            animationDuration: `${1.9 + (i % 4) * 0.5}s`,
            animationDelay: `${(i % 6) * 0.28}s`,
          }}
        >
          {(i * 7) % 10}
        </span>
      ))}
      <span className="mgt-sweep" />
      <div className="mgt-door">
        <span className="mgt-rivets" />
        <span className="mgt-dial">
          <span className="mgt-dial-face" />
          <span className="mgt-dial-mark" />
        </span>
        <span className="mgt-handle" />
        <span className="mgt-lock">🔐</span>
      </div>
    </div>
  );
}

/* -------------------------------- the screen ------------------------------- */

export function MiniGameTakeover({
  state,
  onPlay,
  onDone,
}: {
  state: MiniGameState;
  /** The player took the invitation — open this release's board. */
  onPlay: () => void;
  /** The takeover is finished with the screen; drop it. */
  onDone: () => void;
}) {
  const meta = MINIGAME_TYPE_META[state.type];
  const t = useT();
  const flavour = FLAVOUR[state.type];
  const [leaving, setLeaving] = useState(false);
  const closed = useRef(false);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    setTimeout(onDone, LEAVE_MS);
  }, [onDone]);

  // The CTA leaves at once rather than fading: the board is opening behind it,
  // and both screens lock body scroll — a takeover still unmounting half a
  // second later restores the scroll position the *modal* had just taken.
  const play = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onDone();
    onPlay();
  }, [onDone, onPlay]);

  useEffect(() => {
    const timer = setTimeout(close, TAKEOVER_MS);
    const onKey = () => close();
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [close]);

  // Refcounted (see ui/scrollLock) — this overlay hands straight over to the
  // mini-game board, so the two are briefly on screen together and the naive
  // save/restore left the page locked once both had gone.
  useScrollLock(true);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="mgt"
      data-game={flavour.game}
      data-leaving={leaving}
      onClick={close}
      role="alertdialog"
      aria-label={t("{game} — {title}", { game: t(meta.label), title: state.title })}
      dir="rtl"
    >
      <div className="mgt-rays" aria-hidden />
      <div className="mgt-shock" aria-hidden />
      <div className="mgt-shock mgt-shock--second" aria-hidden />

      {/* Dismissible by a tap anywhere was true from the start and is invisible
          from the outside: a player who does not know that sees a screen that
          took over their game with no marked way back. Pinned to the corner of
          the viewport rather than placed in the column below, so it does not
          scroll away with the stage on a short phone. No stopPropagation: the
          click reaching the backdrop calls the same `close`, which is guarded
          against running twice. */}
      <CloseButton
        onClick={close}
        tone="onDark"
        label={t("סגור את ההודעה")}
        className="mgt-close"
      />

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-3 text-center">
        <p className="mgt-rise mgt-kicker" style={{ ["--mgt-delay" as string]: "0.1s" }}>
          {t(flavour.kicker)}
        </p>

        {/* The stage lands first and hardest — it is the part that says which
            game this is, before the title has been read. */}
        <div className="mgt-stage-wrap">
          {state.type === "CRACK_SAFE" ? (
            <SafeStage />
          ) : state.type === "FIND_BALL" ? (
            <CupsStage />
          ) : (
            // The two newer games share one sigil stage. A six-second
            // announcement does not need a bespoke animation each — the flavour
            // text and the palette already say which game arrived.
            <SigilStage sigil={state.type === "TREASURE_MAP" ? "🗺️" : "❓"} />
          )}
        </div>

        <h2 className="mgt-title mgt-rise" style={{ ["--mgt-delay" as string]: "0.45s" }}>
          {state.title}
        </h2>

        <p
          className="mgt-rise text-sm font-bold text-white/70"
          style={{ ["--mgt-delay" as string]: "0.55s" }}
        >
          <span aria-hidden>{meta.icon}</span> {t(meta.label)} · {t(flavour.tagline)}
        </p>

        <div
          className="mgt-rise flex flex-wrap items-center justify-center gap-2"
          style={{ ["--mgt-delay" as string]: "0.7s" }}
        >
          <span className="mgt-chip mgt-chip--prize">
            <span aria-hidden>🎁</span> {t("פרס:")}{" "}
            <span className="nums font-black" dir="ltr">
              {state.prizeText}
            </span>
          </span>
          <span className="mgt-chip">
            <span aria-hidden>🎯</span>{" "}
            <span className="nums font-black" dir="ltr">
              {state.maxAttempts}
            </span>{" "}
            {t("ניסיונות")}
          </span>
          {state.maxWinners > 0 && (
            <span className="mgt-chip">
              <span aria-hidden>🏆</span>{" "}
              <span className="nums font-black" dir="ltr">
                {state.maxWinners}
              </span>{" "}
              {state.maxWinners === 1 ? t("זוכה בלבד") : t("זוכים")}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            play();
          }}
          className="mgt-rise btn btn-gold mt-1 px-8 py-3 text-base"
          style={{ ["--mgt-delay" as string]: "0.85s" }}
        >
          {t(flavour.cta)}
        </button>

        {/* Was a bare 16px-tall text link in 45%-white — legible on a desk,
            not a target a thumb can hit. It is one of only two marked ways off
            this screen, so it is a button with a real hit area. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          className="mgt-rise rounded-lg border border-white/20 px-5 py-2.5 text-xs font-bold text-white/60 transition-colors hover:border-white/40 hover:bg-white/5 hover:text-white/90"
          style={{ ["--mgt-delay" as string]: "0.95s" }}
        >
          {t("אחר כך — הכפתור למעלה שומר לי אותו")}
        </button>
      </div>
    </div>,
    document.body
  );
}
