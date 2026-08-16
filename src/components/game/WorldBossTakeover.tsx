"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "@/components/ui/scrollLock";
import { CloseButton } from "@/components/ui/CloseButton";
import { formatNumber } from "@/lib/game/format";
import type { WorldBossHeraldState } from "@/server/actions/worldBoss";
import { useT } from "@/i18n/client";

/**
 * "המפלצת חזרה לחיים" — the six seconds where the screen belongs to the beast.
 *
 * ## Why the boss gets a takeover at all
 *
 * מפלצת העולם turns over every 24 hours now, and a fixture that renews daily is
 * only a daily fixture if players find out on the day. The three heralds it
 * already sends (chat, inbox, Discord) each reach somebody — but not the player
 * who is *in the game right now*, staring at their own city: a chat line
 * scrolls past behind a collapsed dock, and an inbox badge is one more number
 * next to four others. The mini-game release solved exactly this problem by
 * taking the whole screen (see MiniGameTakeover), and a world boss is a larger
 * event than a mini-game by every measure the game has — it is the only thing
 * the entire server fights at once.
 *
 * So this is deliberately the same *rung* as that announcement and deliberately
 * not the same *picture*. A released mini-game is an invitation to a table; this
 * is a thing that has walked out of the dark. The stage is the beast's sigil
 * rising out of a horizon glow with its own accent tint, the health bar filling
 * to full underneath it — the one image that says "back on its feet" rather than
 * "here is a page you could visit".
 *
 * Dismissible by anything — the CTA, the close, Escape, a click anywhere, or
 * simply waiting — because it is an announcement, not a decision. The arena
 * carries the fight for the rest of the day; this only has to be seen once.
 */

/** How long the takeover holds the screen before bowing out on its own. */
const TAKEOVER_MS = 6_000;

/** Matches the fade-out in `.wbt[data-leaving="true"]`. */
const LEAVE_MS = 420;

/** The hour the beast's day is up, as "עוד 7 שעות" rather than a clock. */
function hoursLeft(endsAt: number, serverNow: number): number {
  return Math.max(0, Math.floor((endsAt - serverNow) / 3_600_000));
}

export function WorldBossTakeover({
  state,
  onEnter,
  onDone,
}: {
  state: WorldBossHeraldState;
  /** The player took the invitation — go to the arena. */
  onEnter: () => void;
  /** The takeover is finished with the screen; drop it. */
  onDone: () => void;
}) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const closed = useRef(false);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    setTimeout(onDone, LEAVE_MS);
  }, [onDone]);

  // The CTA leaves at once rather than fading: a navigation is starting behind
  // it, and an overlay still unmounting half a second into the new page
  // restores a scroll position that page never had. Same reasoning as the
  // mini-game takeover's `play`.
  const enter = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onDone();
    onEnter();
  }, [onDone, onEnter]);

  useEffect(() => {
    const timer = setTimeout(close, TAKEOVER_MS);
    const onKey = () => close();
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [close]);

  // Refcounted (see ui/scrollLock) — this lands unannounced, so it can and does
  // arrive on top of whatever overlay the player already had open.
  useScrollLock(true);

  if (typeof document === "undefined") return null;

  const hours = hoursLeft(state.endsAt, state.serverNow);

  return createPortal(
    <div
      className="wbt"
      data-leaving={leaving}
      // The beast's own accent, as the `R G B` triple the arena tints from — one
      // token drives the beams, the ring, the bar and the glow, so a new entry
      // in WORLD_BOSSES gets its own announcement for free.
      style={{ ["--wbt-accent" as string]: state.accent }}
      onClick={close}
      role="alertdialog"
      aria-label={t("{boss} עלתה על העולם", { boss: t(state.name) })}
      dir="rtl"
    >
      {/* Clipped scenery layer — see the note on `.takeover-scenery`: these are
          absolute children of the scroller, and unclipped they hand a phone a
          screenful of empty black to flick into under the announcement. */}
      <div className="takeover-scenery" aria-hidden>
        <div className="wbt-rays" />
        <div className="wbt-shock" />
        <div className="wbt-shock wbt-shock--second" />
      </div>

      {/* Fixed to the viewport corner, like the other two takeovers: a stage
          taller than a short phone must not scroll the only marked way out off
          the screen. No stopPropagation — the click reaching the backdrop calls
          the same guarded `close`. */}
      <CloseButton
        onClick={close}
        tone="onDark"
        label={t("סגור את ההודעה")}
        className="wbt-close"
      />

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-3 text-center">
        <p className="wbt-rise wbt-kicker" style={{ ["--wbt-delay" as string]: "0.1s" }}>
          {t("מפלצת העולם חזרה לחיים")}
        </p>

        {/* The stage lands first and hardest — it is the part that says which
            beast this is, before the name has been read. */}
        <div className="wbt-stage" aria-hidden>
          <span className="wbt-glow" />
          <span className="wbt-horizon" />
          <span className="wbt-sigil">{state.sigil}</span>
          {/* Six eyes opening in the dark behind it. A fixed comb rather than
              random placement: it re-renders identically, and a designed spread
              reads as a horde while real randomness reads as dirt. */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="wbt-eye"
              style={{
                left: `${12 + i * 15}%`,
                top: `${58 + (i % 3) * 9}%`,
                animationDelay: `${0.8 + (i % 4) * 0.35}s`,
              }}
            />
          ))}
        </div>

        <h2 className="wbt-title wbt-rise" style={{ ["--wbt-delay" as string]: "0.45s" }}>
          {t(state.name)}
        </h2>

        {/* The pool, filling to full. The bar is the arena's own image and the
            single clearest way to say "it is standing again" — a number alone
            would be a statistic. */}
        <div
          className="wbt-rise w-full max-w-md"
          style={{ ["--wbt-delay" as string]: "0.55s" }}
        >
          <div className="wbt-bar" aria-hidden>
            <span />
          </div>
          <p className="mt-1.5 text-sm font-black text-white/80">
            <span className="nums" dir="ltr">
              {formatNumber(Math.round(state.maxHp))}
            </span>{" "}
            {t("נקודות חיים — והיא נופלת רק אם כל השרת יכה בה")}
          </p>
        </div>

        <p
          className="wbt-rise max-w-md text-sm font-bold text-white/60"
          style={{ ["--wbt-delay" as string]: "0.65s" }}
        >
          {t(state.lore)}
        </p>

        <div
          className="wbt-rise flex flex-wrap items-center justify-center gap-2"
          style={{ ["--wbt-delay" as string]: "0.8s" }}
        >
          <span className="wbt-chip wbt-chip--strikes">
            <span aria-hidden>⚔️</span>{" "}
            <span className="nums font-black" dir="ltr">
              {state.maxStrikes}
            </span>{" "}
            {t("מכות מחכות לך")}
          </span>
          <span className="wbt-chip">
            <span aria-hidden>⏳</span>{" "}
            {hours > 0
              ? t("נעלמת בעוד {h} שעות", { h: hours })
              : t("נעלמת בחצות")}
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            enter();
          }}
          className="wbt-rise btn btn-gold mt-1 px-8 py-3 text-base"
          style={{ ["--wbt-delay" as string]: "0.95s" }}
        >
          {t("⚔️ קדימה, לזירה!")}
        </button>

        {/* A real button with a real hit area rather than a text link — it is
            one of only two marked ways off this screen. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          className="wbt-rise rounded-lg border border-white/20 px-5 py-2.5 text-xs font-bold text-white/60 transition-colors hover:border-white/40 hover:bg-white/5 hover:text-white/90"
          style={{ ["--wbt-delay" as string]: "1.05s" }}
        >
          {t("אחר כך — היא עומדת עד חצות")}
        </button>
      </div>
    </div>,
    document.body
  );
}
