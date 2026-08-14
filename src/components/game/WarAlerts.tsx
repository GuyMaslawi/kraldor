"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LiveAlert } from "@/server/actions/messages";
import { Icon } from "@/components/ui/Icon";
import { useInboxPulse } from "./inboxPulse";
import { useT } from "@/i18n/client";

const TOAST_MS = 12_000;
const MAX_VISIBLE = 4;
const SEEN_KEY = "kraldor-alerts-seen";
const SEEN_CAP = 200;

type KindStyle = {
  icon: ReactNode;
  tag: string;
  /** rgb triplet for the pulsing glow + accent, e.g. "239 68 68" */
  accent: string;
  tagClass: string;
};

// i18n-keys-start: `tag` stays in Hebrew and is translated where the toast is drawn
const KIND_STYLE: Record<LiveAlert["kind"], KindStyle> = {
  BATTLE: {
    icon: <Icon name="attack" size={22} />,
    tag: "התקפה",
    accent: "239 68 68",
    tagClass: "bg-red-600 text-white",
  },
  SPY: {
    icon: <Icon name="spy" size={22} />,
    tag: "ריגול",
    accent: "168 85 247",
    tagClass: "bg-purple-600 text-white",
  },
  SYSTEM: {
    icon: <Icon name="messages" size={22} />,
    tag: "הודעה",
    accent: "240 205 120",
    tagClass: "bg-amber-500 text-black",
  },
  // Never actually drawn: `getInboxPulse` keeps announcements out of `alerts`
  // entirely, because they are delivered by AnnouncementDialog instead and a
  // message in both channels would have to be dismissed twice. It is here so
  // the map stays exhaustive over the kinds — and so that if a future alert
  // path ever does emit one, it renders as itself rather than crashing.
  ANNOUNCEMENT: {
    icon: <Icon name="messages" size={22} />,
    tag: "הכרזה",
    accent: "251 191 36",
    tagClass: "bg-amber-400 text-black",
  },
  PLAYER: {
    icon: <Icon name="messages" size={22} />,
    tag: "משחקן",
    accent: "16 185 129",
    tagClass: "bg-emerald-500 text-black",
  },
};
// i18n-keys-end

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(
      SEEN_KEY,
      JSON.stringify([...seen].slice(-SEEN_CAP)),
    );
  } catch {
    // localStorage unavailable — alerts may repeat on reload, harmless.
  }
}

/** Short synthesized war-horn — no audio asset needed. Best-effort: the
 *  browser blocks audio until the user has interacted with the page. */
function playHorn(kind: LiveAlert["kind"]) {
  try {
    const ctx = new AudioContext();
    if (ctx.state === "suspended") {
      void ctx.close();
      return;
    }
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = kind === "BATTLE" ? 110 : kind === "SPY" ? 196 : 330;
    osc.type = kind === "BATTLE" ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.7);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.05);
    osc.onended = () => void ctx.close();
  } catch {
    // No audio — the visual alert still fires.
  }
}

/**
 * Live war-room notifications: pops a dramatic toast the moment the player is
 * attacked, spied on, or receives a message. A BATTLE alert also flashes a red
 * vignette across the whole screen so it can't be missed. Dismissing a toast
 * does NOT mark the message read — the inbox badge stays until the player
 * actually opens the messages page.
 *
 * The polling itself lives in the shared inbox pulse, which the command-bar
 * badges read from too, so the toast and the number that jumps behind it are
 * always the same round trip.
 */
export function WarAlerts() {
  const t = useT();
  const router = useRouter();
  const pulse = useInboxPulse();
  const [toasts, setToasts] = useState<LiveAlert[]>([]);
  const [vignetteKey, setVignetteKey] = useState(0);
  const seenRef = useRef<Set<string> | null>(null);
  /**
   * Whether a pulse has already been processed in this mount. The first one is
   * the backlog the player walked in with, so it shows silently: sounding the
   * horn for mail that has been sitting there since yesterday trains people to
   * ignore the horn.
   */
  const bootedRef = useRef(false);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    if (pulse === null) return;
    const initial = !bootedRef.current;
    bootedRef.current = true;

    seenRef.current ??= loadSeen();
    const seen = seenRef.current;
    const fresh = pulse.alerts.filter((alert) => !seen.has(alert.id));
    if (fresh.length === 0) return;

    fresh.forEach((alert) => seen.add(alert.id));
    saveSeen(seen);

    setToasts((prev) => {
      const next = [...prev, ...fresh];
      // Overflowing toasts: drop the oldest, their timers included.
      const dropped = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
      dropped.forEach((toast) => {
        const timer = timersRef.current.get(toast.id);
        if (timer) clearTimeout(timer);
        timersRef.current.delete(toast.id);
      });
      return next.slice(-MAX_VISIBLE);
    });
    fresh.forEach((alert) => {
      timersRef.current.set(
        alert.id,
        setTimeout(() => dismiss(alert.id), TOAST_MS),
      );
    });

    if (fresh.some((alert) => alert.kind === "BATTLE")) {
      setVignetteKey((key) => key + 1);
    }
    if (!initial) {
      playHorn(
        fresh.find((alert) => alert.kind === "BATTLE")?.kind ??
          fresh[fresh.length - 1].kind,
      );
      // The badges update themselves off the same pulse, but a raid also moved
      // resources, soldiers and the hero — the rest of the server-rendered
      // screen is stale now, so this one is worth the full refetch.
      router.refresh();
    }
  }, [pulse, dismiss, router]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <>
      {/* full-screen red flash when an attack lands */}
      {vignetteKey > 0 && (
        <div
          key={vignetteKey}
          aria-hidden
          className="war-vignette pointer-events-none fixed inset-0 z-[110]"
        />
      )}

      <div
        dir="rtl"
        aria-live="assertive"
        className="fixed left-1/2 top-3 z-[120] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2"
      >
        {toasts.map((toast) => {
          const style = KIND_STYLE[toast.kind];
          const inner = (
            <div className="flex items-start gap-3 p-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-xl"
                style={{
                  borderColor: `rgb(${style.accent} / 0.5)`,
                  background: `linear-gradient(to bottom, rgb(${style.accent} / 0.18), rgb(0 0 0 / 0.4))`,
                }}
              >
                {style.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-px text-[10px] font-black uppercase tracking-wider ${style.tagClass}`}
                  >
                    {t(style.tag)}
                  </span>
                  <span className="truncate text-sm font-black text-gold-bright">
                    {toast.title}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-300">
                  {toast.body}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("סגירה")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dismiss(toast.id);
                }}
                className="-m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
          );

          return (
            <div
              key={toast.id}
              className={`war-alert war-alert-in overflow-hidden rounded-lg ${
                toast.kind === "BATTLE" ? "war-alert-shake" : ""
              }`}
              style={{ "--alert-accent": style.accent } as React.CSSProperties}
            >
              {toast.href ? (
                <Link
                  href={toast.href}
                  onClick={() => dismiss(toast.id)}
                  className="block transition-colors hover:bg-white/5"
                >
                  {inner}
                </Link>
              ) : (
                inner
              )}
              {/* auto-dismiss countdown */}
              <div
                className="war-alert-timer h-0.5"
                style={{ animationDuration: `${TOAST_MS}ms` }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
