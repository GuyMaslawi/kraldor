"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  WHEEL_PRIZES,
  wheelPrizeAmount,
  wheelPrizeByKey,
  type WheelClock,
  type WheelPrizeDef,
} from "@/lib/game/wheel";
import { spinWheel } from "@/server/actions/wheel";
import { formatCompact, formatNumber } from "@/lib/game/format";
import { Icon, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { useScrollLock } from "@/components/ui/scrollLock";
import { useDir, useT } from "@/i18n/client";

/**
 * One line in a batch reveal: a prize totalled across the whole batch.
 * `count` is how many times this prize came up (shown as ×N when repeated).
 */
type HaulEntry = { prize: WheelPrizeDef; total: number; count: number };

const SEG = 360 / WHEEL_PRIZES.length;

/**
 * The spin is two movements, because a real wheel does not simply stop.
 * It coasts down to a hair past its resting angle (OVERSHOOT), the pawl catches
 * the peg it just cleared, and the wheel is pushed back into the detent. That
 * settle is the difference between "an element finished a CSS transition" and
 * "a heavy thing came to rest".
 */
const SPIN_MS = 4600;
const SETTLE_MS = 620;
const OVERSHOOT = 5.5;

const SOUND_KEY = "kraldor-wheel-sound";

/* --- face geometry, in the SVG's own 200×200 user space --- */
const CX = 100;
const CY = 100;
const RIM = 100;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** Wedge i is CENTRED on i*SEG (12 o'clock is the pointer) — see the rest angle
 *  maths in `spin()`, which lands `360 - idx*SEG` under the pawl. */
function wedgePath(i: number): string {
  const [x1, y1] = polar(RIM, i * SEG - SEG / 2);
  const [x2, y2] = polar(RIM, i * SEG + SEG / 2);
  return `M${CX} ${CY} L${x1.toFixed(2)} ${y1.toFixed(2)} A${RIM} ${RIM} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

type Spark = { id: number; dx: string; dy: string; rot: string; delay: string; scale: number };

/** A burst of struck gold dust off the hub — sized and angled per particle so
 *  no two read as the same sprite. */
function makeSparks(): Spark[] {
  return Array.from({ length: 26 }, (_, i) => {
    const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 105 + Math.random() * 120;
    return {
      id: i,
      dx: `${(Math.cos(angle) * dist).toFixed(0)}px`,
      dy: `${(Math.sin(angle) * dist - 55).toFixed(0)}px`,
      rot: `${(Math.random() * 620 - 310).toFixed(0)}deg`,
      delay: `${(Math.random() * 0.18).toFixed(2)}s`,
      scale: 0.65 + Math.random() * 0.85,
    };
  });
}

/** Live rotation of the face, read off the composited transform. */
function readAngle(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  try {
    const m = new DOMMatrixReadOnly(t);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  } catch {
    return 0;
  }
}

export function WheelOfFortune({
  spinsAvailable,
  clock,
  onClose,
}: {
  spinsAvailable: number;
  /** Where the season stands — prize amounts are interpolated from it. */
  clock: WheelClock;
  onClose: () => void;
}) {
  const t = useT();
  const dir = useDir();
  // The wheel is the only overlay in the game that never locked the page behind
  // it, so on a phone a spin gesture that missed the wheel scrolled the base
  // screen underneath instead.
  useScrollLock(true);

  const [rotation, setRotation] = useState(0);
  /** "spin" is the long coast, "settle" the short push back into the detent. */
  const [phase, setPhase] = useState<"idle" | "spin" | "settle">("idle");
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{
    prize: WheelPrizeDef;
    index: number;
    message: string;
    /** Present for a batch spin — every prize won, totalled by exact amount. */
    haul?: HaulEntry[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spinsLeft, setSpinsLeft] = useState(spinsAvailable);
  const [sparks, setSparks] = useState<Spark[]>([]);
  // Read straight out of storage: the modal only ever mounts on a click, so
  // there is no server render of it to mismatch against.
  const [sound, setSound] = useState(() => {
    try {
      return window.localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  });

  const faceRef = useRef<HTMLDivElement | null>(null);
  const pawlRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  /** Mirror of `sound` the audio callbacks can read without re-binding. */
  const soundRef = useRef(sound);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const after = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioRef.current?.close().catch(() => {});
    };
  }, [clearTimers]);

  /* ------------------------------------------------------------------ audio */

  /** One shared context, opened on the click that starts a spin (browsers
   *  refuse audio before a gesture). Best-effort throughout. */
  function ensureAudio() {
    if (!soundRef.current) return;
    try {
      audioRef.current ??= new AudioContext();
      if (audioRef.current.state === "suspended") void audioRef.current.resume();
    } catch {
      audioRef.current = null;
    }
  }

  /** The pawl striking a peg: a short wooden knock, pitched by how fast the
   *  wheel is going, so the whole spin audibly slows down. */
  function playTick(strength: number) {
    const ctx = audioRef.current;
    if (!soundRef.current || !ctx || ctx.state !== "running") return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const band = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(900 + strength * 900, t);
      osc.frequency.exponentialRampToValueAtTime(280, t + 0.05);
      band.type = "bandpass";
      band.frequency.value = 1800;
      band.Q.value = 1.2;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.02 + strength * 0.03, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      osc.connect(band).connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch {
      // silence is fine — the wheel still ticks visually.
    }
  }

  /** Two struck notes when the wheel locks — a small reward flourish. */
  function playChime() {
    const ctx = audioRef.current;
    if (!soundRef.current || !ctx || ctx.state !== "running") return;
    try {
      const t = ctx.currentTime;
      for (const [i, freq] of [523.25, 783.99].entries()) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t + i * 0.11);
        gain.gain.setValueAtTime(0.0001, t + i * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.09, t + i * 0.11 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.75);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + i * 0.11);
        osc.stop(t + i * 0.11 + 0.8);
      }
    } catch {
      // no audio — the visual reveal carries it.
    }
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    soundRef.current = next;
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // preference just won't persist.
    }
  }

  /* ------------------------------------------------------------- the pawl */

  /**
   * The pointer is not on a loop animation — it is driven off the wheel's real
   * position. Every frame we read how far through the current wedge the face
   * is, deflect the pawl by that much (scaled by speed) and let it snap back
   * the instant the peg clears. That single detail is most of what makes the
   * spin read as mechanical rather than decorative.
   */
  function trackPawl() {
    const face = faceRef.current;
    const pawl = pawlRef.current;
    if (!face || !pawl) return;
    pawl.style.transition = "none";

    let prevAngle = readAngle(face);
    let prevT = performance.now();
    let travelled = 0;
    let lastPeg = 0;
    let lastTickAt = 0;

    const step = (t: number) => {
      const angle = readAngle(face);
      let d = angle - prevAngle;
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      prevAngle = angle;
      travelled += d;

      const dt = Math.max(t - prevT, 1);
      prevT = t;
      const speed = (Math.abs(d) / dt) * 1000; // deg/s

      const amp = Math.min(speed / 240, 1) * 15;
      const frac = ((((travelled % SEG) + SEG) % SEG) / SEG);
      pawl.style.transform = `translateX(-50%) rotate(${(-amp * frac).toFixed(2)}deg)`;

      const peg = Math.floor(travelled / SEG);
      if (peg !== lastPeg) {
        lastPeg = peg;
        // Above ~25 ticks a second the ear hears a buzz, not a ratchet.
        if (speed > 15 && t - lastTickAt > 40) {
          lastTickAt = t;
          playTick(Math.min(speed / 800, 1));
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function releasePawl() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const pawl = pawlRef.current;
    if (!pawl) return;
    pawl.style.transition = "transform 420ms cubic-bezier(0.34, 1.5, 0.5, 1)";
    pawl.style.transform = "translateX(-50%) rotate(0deg)";
  }

  /* ------------------------------------------------------------ the motion */

  /** Coast to `target`, overshoot, settle back, then reveal. */
  function launch(target: number, reveal: () => void) {
    setPhase("spin");
    setRotation(target + OVERSHOOT);
    requestAnimationFrame(trackPawl);

    after(SPIN_MS, () => {
      setPhase("settle");
      setRotation(target);
    });
    after(SPIN_MS + SETTLE_MS, () => {
      releasePawl();
      setPhase("idle");
      setSpinning(false);
      setSparks(makeSparks());
      playChime();
      reveal();
    });
  }

  /** Where the face must come to rest for wedge `idx` to sit under the pawl,
   *  as an absolute rotation ahead of where it is now. */
  function restingRotation(idx: number): number {
    // A little jitter inside the wedge so it never stops dead-centre twice.
    const jitter = (Math.random() - 0.5) * SEG * 0.5;
    const rest = 360 - idx * SEG + jitter;
    return rotation - (rotation % 360) + 360 * 6 + rest;
  }

  async function spin() {
    if (spinning || spinsLeft <= 0) return;
    ensureAudio();
    clearTimers();
    setSpinning(true);
    setResult(null);
    setError(null);
    setSparks([]);

    // The server owns the roll and the payout — we only animate to its result.
    const outcome = await spinWheel();
    if (!outcome.ok) {
      setSpinning(false);
      setError(outcome.error);
      return;
    }

    const idx = outcome.prizeIndex;
    setSpinsLeft(outcome.spinsLeft);
    launch(restingRotation(idx), () =>
      setResult({ prize: WHEEL_PRIZES[idx], index: idx, message: outcome.message })
    );
  }

  // Spin the whole available batch at once (up to 10), reusing the single-spin
  // server action (which owns the guarded consume + payout), then reveal a
  // combined result. When the player has fewer than 10 spins this runs through
  // all of them instead of forcing one-by-one spins.
  async function spinBatch() {
    const batch = Math.min(spinsLeft, 10);
    if (spinning || batch < 2) return;
    ensureAudio();
    clearTimers();
    setSpinning(true);
    setResult(null);
    setError(null);
    setSparks([]);

    let left = spinsLeft;
    let lastIdx = 0;
    let done = 0;
    // Every prize won, totalled by exact granted amount, in first-seen order.
    // Keyed by the *grant* key (so a loot pack lands on gold/wood/iron/stone
    // and a bag-full "item" that paid gold lands on gold) — this is exactly
    // what the player received, not just which wedge the wheel stopped on.
    const haul: HaulEntry[] = [];
    for (let i = 0; i < batch; i++) {
      const outcome = await spinWheel();
      if (!outcome.ok) {
        setSpinsLeft(left);
        if (done === 0) {
          setSpinning(false);
          setError(outcome.error);
          return;
        }
        break; // partial batch succeeded — reveal what we won so far
      }
      done += 1;
      left = outcome.spinsLeft;
      lastIdx = outcome.prizeIndex;
      for (const grant of outcome.grants) {
        const prize = wheelPrizeByKey(grant.key);
        if (!prize) continue;
        const existing = haul.find((h) => h.prize.key === prize.key);
        if (existing) {
          existing.total += grant.amount;
          existing.count += 1;
        } else {
          haul.push({ prize, total: grant.amount, count: 1 });
        }
      }
    }
    setSpinsLeft(left);

    const spun = done;
    launch(restingRotation(lastIdx), () =>
      setResult({
        prize: WHEEL_PRIZES[lastIdx],
        index: lastIdx,
        message: t("הושלמו {count} סיבובים — הנה מה שזכית בו:", { count: spun }),
        haul,
      })
    );
  }

  // No motion blur: the wedge labels ride this same element, and any filter on
  // it left them soft to read for the whole spin. The face stays pin-sharp.
  const faceTransition =
    phase === "spin"
      ? `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.72, 0.12, 1)`
      : phase === "settle"
        ? `transform ${SETTLE_MS}ms cubic-bezier(0.36, 1.32, 0.5, 1)`
        : "none";

  return (
    <div
      // The overlay is the scroller here (the wheel itself must not be cropped),
      // so it is sized in dvh: at `inset-0` its bottom ran under the phone's
      // toolbar and the last stretch of a tall result panel was unreachable.
      className="fixed inset-x-0 top-0 z-[100] flex h-[100dvh] items-start justify-center overflow-y-auto overscroll-contain bg-black/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      onClick={onClose}
    >
      <div
        // This covers the screen and takes every click, so it owes a screen
        // reader the same announcement the other modals make — and it is what
        // an overlay sweep queries for. It had neither.
        role="dialog"
        aria-modal="true"
        aria-label={t("גלגל המזל")}
        dir={dir}
        onClick={(e) => e.stopPropagation()}
        className="ornate-shell relative my-6 w-full max-w-lg rounded-xl p-4 text-center sm:p-6"
      >
        <div className="absolute left-4 top-4 flex items-center gap-2">
          <button
            onClick={onClose}
            aria-label={t("סגור")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle text-zinc-400 transition-colors hover:border-gold/50 hover:text-white"
          >
            ✕
          </button>
          <button
            onClick={toggleSound}
            aria-label={sound ? t("כבה צלילים") : t("הפעל צלילים")}
            title={sound ? t("כבה צלילים") : t("הפעל צלילים")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle text-zinc-400 transition-colors hover:border-gold/50 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" fill="currentColor" stroke="none" />
              {sound ? (
                <>
                  <path d="M15.6 9a4 4 0 0 1 0 6" />
                  <path d="M18.2 6.6a7.5 7.5 0 0 1 0 10.8" />
                </>
              ) : (
                <path d="M16 9.5l5 5m0-5l-5 5" />
              )}
            </svg>
          </button>
        </div>

        <h2 className="text-3xl font-black text-gold-bright">{t("גלגל המזל")}</h2>
        <div className="rule-gold mx-auto mt-2 w-40" />

        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-panel-inset px-4 py-1 text-sm shadow-[inset_0_1px_0_rgba(228,195,90,0.12)]">
          <Icon name="wheel" size={14} className="text-gold" />
          <span className="text-zinc-400">{t("סיבובים זמינים")}</span>
          <span className="nums font-black text-gold-bright" dir="ltr">{spinsLeft}</span>
        </div>
        <p className="nums mt-3 text-xs font-semibold text-gold">
          {t("מחזור {cycle} מתוך {total} לעונה — הפרסים גדלים בכל עדכון יומי!", {
            cycle: clock.cycle,
            total: clock.total,
          })}
        </p>
        <p className="mt-1 text-xs font-semibold text-zinc-400">
          {t("פרס ״חפץ״ דורש לפחות מקום פנוי אחד בתיק הגיבור.")}
        </p>

        {/* wheel — fixed 340px geometry, scaled down to fit narrow phones */}
        <div className="mx-auto mt-6 flex h-[288px] w-[288px] items-center justify-center sm:h-[344px] sm:w-[344px]">
          <div
            className={`wheel-stage shrink-0 scale-[0.847] sm:scale-100 ${spinning ? "is-spinning" : ""}`}
          >
            {/* pawl — a sprung blade the pegs kick past (angle driven in JS) */}
            <div
              ref={pawlRef}
              className="wheel-pawl absolute left-1/2 top-[-9px] z-30 origin-[50%_14%]"
              style={{ transform: "translateX(-50%)" }}
            >
              <svg width="46" height="62" viewBox="0 0 46 62" aria-hidden>
                <defs>
                  <linearGradient id="wf-pawl" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#6a5219" />
                    <stop offset="30%" stopColor="#f8ecbc" />
                    <stop offset="52%" stopColor="#c9a63f" />
                    <stop offset="78%" stopColor="#8a6c22" />
                    <stop offset="100%" stopColor="#4c3a10" />
                  </linearGradient>
                </defs>
                {/* mount plate + pivot screw */}
                <rect x="5" y="0.8" width="36" height="15" rx="4.5" fill="url(#wf-pawl)" stroke="#2b2107" strokeWidth="1.2" />
                <circle cx="23" cy="8.2" r="3.4" fill="#1d1605" stroke="#efd88f" strokeWidth="1" />
                {/* the blade the pegs strike */}
                <path d="M13.5 14 H32.5 L23 57 Z" fill="url(#wf-pawl)" stroke="#2b2107" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M23 18 V52" stroke="rgba(255,248,220,0.55)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>

            <div className="wheel-bezel" />
            <div className="wheel-sheen" />
            <div className="wheel-groove" />

            {/* rivets — two per wedge, on the wedge centre and on its boundary */}
            {Array.from({ length: WHEEL_PRIZES.length * 2 }, (_, i) => (
              <div
                key={`rivet-${i}`}
                className="absolute left-1/2 top-1/2"
                style={{ transform: `translate(-50%, -50%) rotate(${(i * SEG) / 2}deg) translateY(-162px)` }}
              >
                <div className="wheel-rivet" />
              </div>
            ))}

            {/* the face */}
            <div
              ref={faceRef}
              className="wheel-face"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: faceTransition,
              }}
            >
              <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden>
                <defs>
                  <radialGradient id="wf-face-base" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#1a1922" />
                    <stop offset="70%" stopColor="#101017" />
                    <stop offset="100%" stopColor="#06060a" />
                  </radialGradient>
                  {WHEEL_PRIZES.map((p, i) => (
                    <radialGradient key={p.key} id={`wf-tint-${i}`} cx="50%" cy="50%" r="50%">
                      <stop offset="38%" stopColor={p.color} stopOpacity="0" />
                      <stop offset="88%" stopColor={p.color} stopOpacity="0.3" />
                      <stop offset="100%" stopColor={p.color} stopOpacity="0.46" />
                    </radialGradient>
                  ))}
                </defs>

                <circle cx={CX} cy={CY} r={RIM} fill="url(#wf-face-base)" />
                {WHEEL_PRIZES.map((p, i) => (
                  <g key={p.key}>
                    {/* alternating obsidian tones keep the seven wedges apart
                        without colouring them in */}
                    <path d={wedgePath(i)} fill={i % 2 === 0 ? "#14131b" : "#0a0910"} />
                    <path d={wedgePath(i)} fill={`url(#wf-tint-${i})`} />
                  </g>
                ))}
                {/* engraved divider between every wedge */}
                {WHEEL_PRIZES.map((p, i) => {
                  const [x, y] = polar(RIM, i * SEG - SEG / 2);
                  return (
                    <line
                      key={`div-${p.key}`}
                      x1={CX}
                      y1={CY}
                      x2={x.toFixed(2)}
                      y2={y.toFixed(2)}
                      stroke="rgba(233,210,144,0.3)"
                      strokeWidth="0.7"
                    />
                  );
                })}
                <circle cx={CX} cy={CY} r="99.3" fill="none" stroke="rgba(233,210,144,0.4)" strokeWidth="1.2" />
                <circle
                  cx={CX}
                  cy={CY}
                  r="90"
                  fill="none"
                  stroke="rgba(233,210,144,0.16)"
                  strokeWidth="0.6"
                  strokeDasharray="1 2.6"
                />
                <circle cx={CX} cy={CY} r="27" fill="rgba(5,5,8,0.9)" stroke="rgba(233,210,144,0.22)" strokeWidth="0.7" />
              </svg>

              {/* wedge faces: icon, name and what it actually pays this cycle.
                  The final counter-rotation cancels the face's own rotation as
                  well as the wedge angle, so a label rides its wedge around the
                  wheel but never tips over — a wheel that comes to rest at 143°
                  must not leave the player reading sideways. Both rotations run
                  on the identical transition, so they cancel frame for frame
                  through the whole spin. */}
              {WHEEL_PRIZES.map((p, i) => {
                const angle = i * SEG;
                const amount = p.kind === "amount" ? wheelPrizeAmount(p, clock) : null;
                return (
                  <div
                    key={p.key}
                    className="absolute left-1/2 top-1/2 flex flex-col items-center gap-[3px]"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-94px) rotate(${-angle - rotation}deg)`,
                      transition: faceTransition,
                    }}
                  >
                    <Icon
                      name={p.icon}
                      size={26}
                      className={`drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] ${RESOURCE_ICON_COLOR[p.key] ?? "text-violet-300"}`}
                    />
                    <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wide text-bone drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                      {p.label}
                    </span>
                    {amount !== null && (
                      <span
                        className="nums whitespace-nowrap rounded-sm bg-black/55 px-1 text-[9px] font-black text-gold-bright shadow-[inset_0_0_0_1px_rgba(196,160,50,0.25)]"
                        dir="ltr"
                      >
                        {formatCompact(amount)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* the winning wedge lit from below, held while the result shows */}
            {result && (
              <div
                className="wheel-beam"
                style={{
                  background: `conic-gradient(from -${SEG / 2}deg, rgba(255,238,180,0.6) 0deg, rgba(255,230,160,0.28) ${SEG * 0.68}deg, transparent ${SEG}deg 360deg)`,
                }}
              />
            )}
            {result && <div className="wheel-shock" />}

            {/* the dome */}
            <div className="wheel-glass" />

            {/* hub */}
            <div className={`wheel-hub z-20 ${result ? "wheel-pop" : ""}`}>
              <div className="wheel-hub-face">
                <Icon name="crown" size={26} className="text-gold-bright drop-shadow-[0_0_6px_rgba(228,195,90,0.5)]" />
              </div>
            </div>

            {/* gold dust */}
            {sparks.map((s) => (
              <span
                key={s.id}
                className="wheel-spark z-30"
                style={
                  {
                    "--dx": s.dx,
                    "--dy": s.dy,
                    "--rot": s.rot,
                    animationDelay: s.delay,
                    height: `${(11 * s.scale).toFixed(1)}px`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        </div>

        {/* result */}
        {result && (
          <div className="wheel-pop mt-5 rounded-lg border border-gold/40 bg-gradient-to-b from-gold/12 to-transparent px-3 py-2.5 shadow-[inset_0_1px_0_rgba(228,195,90,0.15)]">
            <p className="text-sm font-bold text-gold-bright">{result.message}</p>
            {result.haul ? (
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {result.haul.map((h) => (
                  <span
                    key={h.prize.key}
                    className="inline-flex items-center gap-1 rounded-full border border-gold/35 bg-black/45 px-2.5 py-1 text-xs font-bold text-bone"
                  >
                    <Icon
                      name={h.prize.icon}
                      size={14}
                      className={RESOURCE_ICON_COLOR[h.prize.key] ?? "text-violet-300"}
                    />
                    {h.prize.label}
                    {/* Unit prizes grant exactly one thing per win, so ×count and
                        the total are the same number — showing both read as two
                        different multipliers. One badge with the total only. */}
                    {h.prize.kind !== "unit" && h.count >= 2 && (
                      <span className="nums rounded bg-gold/25 px-1 text-[10px] font-black text-gold-bright" dir="ltr">
                        ×{h.count}
                      </span>
                    )}
                    <span className="nums rounded bg-gold/20 px-1 text-[10px] font-black text-gold-bright" dir="ltr">
                      {h.prize.kind === "unit" ? `×${h.total}` : `+${formatNumber(h.total)}`}
                    </span>
                  </span>
                ))}
                {/* Unit prizes need their note here too — in a batch reveal the
                    single-spin note below is never shown, so "כל הנשק" arrived
                    with no explanation of what those 24 pieces were. */}
                {result.haul
                  .filter((h) => h.prize.kind === "unit" && h.prize.note)
                  .map((h) => (
                    <p key={`note-${h.prize.key}`} className="w-full text-[11px] text-bone-dim">
                      {h.prize.label}: {h.prize.note}
                    </p>
                  ))}
              </div>
            ) : (
              result.prize.note && (
                <p className="mt-0.5 text-[11px] text-bone-dim">{result.prize.note}</p>
              )
            )}
          </div>
        )}
        {error && (
          <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
            <p className="text-sm font-bold text-red-300">{error}</p>
          </div>
        )}

        {/* actions */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={spinBatch}
            disabled={spinning || spinsLeft < 2}
            className="btn btn-ghost px-5 py-3 text-sm font-black"
            title={t("סובב את כל הסיבובים הזמינים בבת אחת (עד 10)")}
          >
            <span className="nums" dir="ltr">×{Math.min(spinsLeft, 10)}</span>{" "}
            {t("סיבובים")}
          </button>
          <button
            onClick={spin}
            disabled={spinning || spinsLeft <= 0}
            className="btn btn-gold px-5 py-3 text-base"
          >
            <Icon name="wheel" size={18} /> {spinning ? t("מסתובב…") : t("סובב")}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-bone-dim">
          {t("כפתור הבאטץ׳ מסובב את כל הסיבובים הזמינים בבת אחת (עד 10).")}
        </p>
      </div>
    </div>
  );
}
