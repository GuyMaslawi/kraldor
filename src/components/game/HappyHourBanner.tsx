"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useScrollLock } from "@/components/ui/scrollLock";
import { CloseButton } from "@/components/ui/CloseButton";
import { pollHappyHour, type HappyHourState } from "@/server/actions/happyHour";
import { HAPPY_HOUR_EFFECTS } from "@/lib/game/happyHour";
import { useDir, useT } from "@/i18n/client";

/**
 * Happy Hour, as players meet it.
 *
 * Two things live here, and the split is the whole design:
 *
 *   • The TAKEOVER fires once, the first time a given release is seen. It is
 *     the announcement — a released golden hour is worthless if players finish
 *     their session without noticing it, so this is allowed to stop the game.
 *   • The BANNER then sits above every screen for the rest of the window. It is
 *     the reminder, and it has to be liveable: no layout shift, no re-entry
 *     animation on navigation, and a countdown that is the honest deadline.
 *
 * "Once" is remembered in localStorage, keyed by release id — so the takeover
 * survives navigation (the layout remounts this component on every route change)
 * without ever showing twice, and a *new* release always breaks through.
 */

/** Poll rates. Same reasoning as MiniGameButton: this is mounted on every screen. */
const POLL_LIVE_MS = 20_000;
const POLL_IDLE_MS = 45_000;

/** How long the takeover holds the screen before bowing out on its own. */
const TAKEOVER_MS = 5_200;

const SEEN_KEY = "kraldor.happyHour.seen";

function alreadySeen(id: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === id;
  } catch {
    // Private mode, blocked storage — better a repeated celebration than none.
    return false;
  }
}

function markSeen(id: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* nothing to do: the takeover simply shows again next load */
  }
}

/** Time left on the window, ticking in server time; fires `onExpire` at zero. */
function Countdown({
  endsAt,
  serverNow,
  onExpire,
}: {
  endsAt: number;
  serverNow: number;
  onExpire: () => void;
}) {
  // Seeded from the server's clock and offset from it, so a client whose clock
  // is minutes off still counts down to the deadline the server will enforce —
  // and the first client render matches the server's HTML exactly.
  const [now, setNow] = useState(serverNow);
  const skewRef = useRef(0);
  const fired = useRef(false);

  useEffect(() => {
    skewRef.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    return () => clearInterval(id);
  }, []);

  const left = endsAt - now;

  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    onExpire();
  }, [left, onExpire]);

  const total = Math.max(0, Math.floor(left / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return (
    <span className="nums tabular-nums" dir="ltr">
      {h > 0 ? `${String(h).padStart(2, "0")}:` : ""}
      {m}:{s}
    </span>
  );
}

/**
 * The boosted rules, as chips.
 *
 * `compact` is the banner's version: one word per rule and no multiplier, because
 * the multiplier is already the largest thing on the same line — three chips each
 * repeating "×2" next to a 60px "×2" is noise, and at the width the banner
 * actually gets they wrapped onto a second row. The takeover, which has a whole
 * screen and one job, spells them out.
 */
function EffectChips({
  state,
  compact = false,
  className = "",
}: {
  state: HappyHourState;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {HAPPY_HOUR_EFFECTS.filter((effect) => state[effect.key]).map((effect) => (
        <span key={effect.key} className="hh-chip">
          <span aria-hidden>{effect.icon}</span>
          {compact ? effect.short : effect.label}
          {!compact && (
            <span className="nums font-black text-amber-200" dir="ltr">
              {state.multiplierLabel}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * The four-second interruption. Deliberately dismissible by anything — click,
 * Escape, or just waiting — because it is an announcement, not a decision.
 */
function Takeover({ state, onDone }: { state: HappyHourState; onDone: () => void }) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const closed = useRef(false);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    // Let the fade finish before the node goes; the timer is the only thing
    // keeping it mounted, so a missed frame here costs nothing.
    setTimeout(onDone, 450);
  }, [onDone]);

  useEffect(() => {
    const timer = setTimeout(close, TAKEOVER_MS);
    const onKey = () => close();
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [close]);

  // Refcounted — see ui/scrollLock. This lands unannounced, so it can and does
  // arrive on top of whatever overlay the player already had open.
  useScrollLock(true);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="hh-takeover"
      data-leaving={leaving}
      onClick={close}
      role="alertdialog"
      aria-label={t("{title} — {multiplier}", {
        title: t(state.title),
        multiplier: state.multiplierLabel,
      })}
      dir="rtl"
    >
      <div className="hh-rays" aria-hidden />
      <div className="hh-shock" aria-hidden />
      <div className="hh-shock hh-shock--second" aria-hidden />

      {/* Same reasoning as the mini-game takeover's: a tap anywhere always
          closed this, but nothing on screen said so, and the CTA is the only
          marked control. Fixed to the viewport corner (see `.hh-close`). */}
      <CloseButton onClick={close} tone="onDark" label={t("סגור את ההודעה")} className="hh-close" />
      {/* Deterministic spread rather than random: a fixed comb of embers looks
          like a designed rain, and re-renders identically. */}
      {Array.from({ length: 14 }).map((_, i) => (
        <span
          key={i}
          className="hh-spark"
          aria-hidden
          style={{
            left: `${(i * 7.3 + 3) % 100}%`,
            animationDuration: `${2.6 + (i % 5) * 0.45}s`,
            animationDelay: `${(i % 7) * 0.32}s`,
          }}
        />
      ))}

      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-4 text-center">
        {/* The kicker carries the moment, not the name — the name is the big
            line under the number, and printing it twice would waste the one
            second the player is actually looking here. */}
        <p
          className="hh-rise text-sm font-black tracking-[0.4em] text-amber-300"
          style={{ ["--hh-delay" as string]: "0.15s" }}
        >
          {t("נפתח עכשיו לכל השחקנים")}
        </p>

        <p className="hh-takeover-mult nums" dir="ltr">
          {state.multiplierLabel}
        </p>

        <h2
          className="hh-rise text-4xl font-black tracking-wide text-gold-bright sm:text-5xl"
          style={{ ["--hh-delay" as string]: "0.5s" }}
        >
          {t(state.title)}
        </h2>

        <div className="hh-rise" style={{ ["--hh-delay" as string]: "0.7s" }}>
          <EffectChips state={state} className="justify-center" />
        </div>

        <p
          className="hh-rise max-w-md text-base font-bold text-amber-100/90"
          style={{ ["--hh-delay" as string]: "0.85s" }}
        >
          {state.endsAt != null ? (
            <>
              {t("נגמרת בעוד")}{" "}
              <span className="text-gold-bright">
                <Countdown
                  endsAt={state.endsAt}
                  serverNow={state.serverNow}
                  onExpire={close}
                />
              </span>{" "}
              {t("— כל תקיפה עכשיו שווה כפליים.")}
            </>
          ) : (
            t("רצה עד להודעה חדשה — כל תקיפה עכשיו שווה כפליים.")
          )}
        </p>

        <button
          type="button"
          onClick={close}
          className="hh-rise btn btn-gold px-8 py-3 text-base"
          style={{ ["--hh-delay" as string]: "1s" }}
        >
          {t("⚔️ קדימה, לניצול!")}
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * Mounted in the game layout, above everything. Renders nothing at all when no
 * window is running — which is almost always — so the cost on a normal screen
 * is one idle poll.
 */
export function HappyHourBanner({ initial }: { initial: HappyHourState | null }) {
  const t = useT();
  const dir = useDir();
  const router = useRouter();
  const [state, setState] = useState<HappyHourState | null>(initial);
  const [takeoverId, setTakeoverId] = useState<string | null>(null);

  // localStorage is not readable while rendering on the server, so the decision
  // to celebrate is made after mount — which also means the takeover can never
  // differ between the server's HTML and the client's first paint.
  //
  // The beat of delay is deliberate as well as what keeps this off the render
  // path: the page finishes painting, the player's eye settles, and *then* the
  // screen is taken. Slamming it into the same frame as the navigation reads as
  // a loading state rather than an event.
  useEffect(() => {
    if (!state || alreadySeen(state.id)) return;
    const id = state.id;
    const timer = setTimeout(() => {
      markSeen(id);
      setTakeoverId(id);
    }, 250);
    return () => clearTimeout(timer);
  }, [state]);

  const refresh = useCallback(async () => {
    // `retry` means the round learned nothing (throttled, or a signed-out tab);
    // leaving the banner exactly as it is beats tearing a live window off the
    // screen because one poll came back empty-handed.
    const { state: next, retry } = await pollHappyHour();
    if (retry) return;
    setState(next ?? null);
    // The layout rendered the first copy server-side; when the window closes,
    // re-render the page so nothing else is quoting boosted numbers either.
    if (!next) router.refresh();
  }, [router]);

  const live = state !== null;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      const { state: next, retry } = await pollHappyHour();
      if (alive && !retry) setState(next ?? null);
    };
    const id = setInterval(tick, live ? POLL_LIVE_MS : POLL_IDLE_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [live]);

  if (!state) return null;

  return (
    <>
      {takeoverId === state.id && (
        <Takeover state={state} onDone={() => setTakeoverId(null)} />
      )}

      <section
        dir={dir}
        className="hh-banner mb-5 p-4"
        aria-label={t("Happy Hour פעיל — {multiplier}", {
          multiplier: state.multiplierLabel,
        })}
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className="hh-ember"
            aria-hidden
            style={{
              left: `${(i * 11 + 5) % 100}%`,
              animationDuration: `${3.2 + (i % 4) * 0.6}s`,
              animationDelay: `${(i % 5) * 0.7}s`,
            }}
          />
        ))}

        {/* The chips take the slack so the multiplier and the clock — the two
            things worth glancing at — stay on one line for as long as the width
            allows, instead of the clock being the piece that wraps away. */}
        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex shrink-0 items-center gap-3">
            <span className="hh-mult nums text-5xl sm:text-6xl" dir="ltr">
              {state.multiplierLabel}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-lg font-black leading-tight text-gold-bright sm:text-xl">
                <span aria-hidden>🔥</span>
                <span className="truncate">{t(state.title)}</span>
              </p>
              <p className="text-xs font-bold text-amber-100">
                {t("כל השחקנים · עכשיו · אל תבזבז את זה")}
              </p>
            </div>
          </div>

          {/* Chips and clock travel together: on a phone they drop to their own
              full-width row under the headline rather than each finding its own
              line, which left the chips stacked in a column beside a hole. */}
          <div className="flex min-w-0 basis-full items-center justify-between gap-3 sm:flex-1 sm:basis-auto">
            <EffectChips state={state} compact className="min-w-0" />

            {state.endsAt != null ? (
              <span className="flex shrink-0 items-center gap-2 rounded-lg border border-gold/60 bg-black/45 px-3 py-1.5 text-base font-black text-gold-bright shadow-[0_0_18px_-6px_var(--gold)]">
                <span aria-hidden>⏳</span>
                <Countdown
                  key={state.endsAt}
                  endsAt={state.endsAt}
                  serverNow={state.serverNow}
                  onExpire={refresh}
                />
              </span>
            ) : (
              <span className="shrink-0 rounded-lg border border-gold/60 bg-black/45 px-3 py-1.5 text-sm font-black text-gold-bright">
                {t("∞ עד להודעה חדשה")}
              </span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
