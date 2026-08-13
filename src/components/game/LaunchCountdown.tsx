"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/i18n/client";

/**
 * The countdown on the launch screen (/launch).
 *
 * Same clock discipline as `SeasonCountdown`: it counts in **server time**, so
 * a visitor whose laptop runs four minutes fast does not watch the gates open
 * before the server agrees. The offset is measured once against the server
 * timestamp the page was rendered with, and every tick rides it.
 *
 * What it does at zero is the difference. The sealed-gate screen refreshes and
 * lets the server decide; this one is a poster, shown to people who are not
 * signed in yet, so it celebrates and then walks them to the door: confetti,
 * a few seconds to read it, then `/login` — which sends an already-signed-in
 * player straight on to `/game/base`.
 */

/** Seconds of celebration before the page walks the visitor to the door. */
const REDIRECT_SECONDS = 7;

/**
 * Fixed confetti — never Math.random(), or the server and the client render
 * different sparks and React tears the tree down (see the same list on the
 * season-pass card, and the embers on /season).
 */
const CONFETTI = [
  { left: 4, delay: 0, dur: 3.4, tone: "var(--gold-bright)" },
  { left: 11, delay: 0.5, dur: 4.1, tone: "var(--gold)" },
  { left: 19, delay: 1.1, dur: 3.1, tone: "#e8e2d0" },
  { left: 26, delay: 0.2, dur: 4.6, tone: "var(--gold-bright)" },
  { left: 34, delay: 1.6, dur: 3.6, tone: "var(--gold-dim)" },
  { left: 41, delay: 0.8, dur: 4.2, tone: "#e8e2d0" },
  { left: 49, delay: 0.1, dur: 3.3, tone: "var(--gold-bright)" },
  { left: 56, delay: 1.3, dur: 4.4, tone: "var(--gold)" },
  { left: 64, delay: 0.6, dur: 3.8, tone: "#e8e2d0" },
  { left: 71, delay: 1.9, dur: 3.2, tone: "var(--gold-bright)" },
  { left: 79, delay: 0.4, dur: 4.5, tone: "var(--gold-dim)" },
  { left: 86, delay: 1.4, dur: 3.5, tone: "var(--gold)" },
  { left: 93, delay: 0.9, dur: 4.0, tone: "var(--gold-bright)" },
  { left: 97, delay: 2.1, dur: 3.7, tone: "#e8e2d0" },
] as const;

export function LaunchCountdown({
  serverNow,
  startsAt,
}: {
  serverNow: number;
  startsAt: number;
}) {
  const t = useT();
  const router = useRouter();

  const [now, setNow] = useState(serverNow);
  const skewRef = useRef(0);

  /** When *this screen* saw the gates open — see the redirect note below. */
  const arrivedAtRef = useRef<number | null>(null);
  const [redirectIn, setRedirectIn] = useState(REDIRECT_SECONDS);
  const sentRef = useRef(false);

  useEffect(() => {
    skewRef.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const tick = () => {
      const serverTime = Date.now() + skewRef.current;
      setNow(serverTime);

      if (serverTime < startsAt) return;

      // Counted from the moment this screen arrived, not from the deadline:
      // somebody who opens the page an hour after the launch gets the same
      // few seconds of celebration rather than an instant bounce.
      if (arrivedAtRef.current === null) arrivedAtRef.current = serverTime;
      const left = Math.max(
        0,
        REDIRECT_SECONDS -
          Math.floor((serverTime - arrivedAtRef.current) / 1000),
      );
      setRedirectIn(left);

      // replace, not push: Back should not walk into a countdown that is over.
      if (left === 0 && !sentRef.current) {
        sentRef.current = true;
        router.replace("/login");
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startsAt, router]);

  const remaining = startsAt - now;
  const arrived = remaining <= 0;

  if (arrived) {
    return (
      <div className="lnc-open text-center">
        <span aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
          {CONFETTI.map((c, i) => (
            <span
              key={i}
              className="sp-confetti absolute top-[-8%] h-3 w-1.5 rounded-sm"
              style={{
                left: `${c.left}%`,
                background: c.tone,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.dur}s`,
              }}
            />
          ))}
        </span>

        <p className="lnc-open-title text-4xl font-black text-gold-bright sm:text-5xl">
          {t("השערים נפתחו!")}
        </p>
        <p className="mt-3 text-sm text-zinc-400">
          {t("העונה החדשה התחילה. העולם ריק — לכו לתפוס אותו.")}
        </p>
        <p className="mt-6 text-xs font-bold tracking-wide text-gold-dim">
          {redirectIn > 0
            ? t("מעבירים אתכם לכניסה בעוד {seconds}…", { seconds: redirectIn })
            : t("מעבירים אתכם לכניסה…")}
        </p>
        <div className="mx-auto mt-3 h-1 w-40 overflow-hidden rounded-full bg-zinc-800">
          <span
            className="lnc-bar block h-full rounded-full"
            style={{
              width: `${((REDIRECT_SECONDS - redirectIn) / REDIRECT_SECONDS) * 100}%`,
            }}
          />
        </div>

        <LaunchActions arrived />
      </div>
    );
  }

  const total = Math.floor(remaining / 1000);
  const parts = [
    { label: t("ימים"), value: Math.floor(total / 86400) },
    { label: t("שעות"), value: Math.floor((total % 86400) / 3600) },
    { label: t("דקות"), value: Math.floor((total % 3600) / 60) },
    { label: t("שניות"), value: total % 60 },
  ];
  /** The last minute earns a heartbeat. Nothing before it moves. */
  const finalMinute = total < 60;

  return (
    <div>
      <div className="flex items-start justify-center gap-2 sm:gap-4" dir="ltr">
        {parts.map((p, i) => (
          <div
            key={p.label}
            className={`lnc-dial ${finalMinute ? "lnc-dial-final" : ""}`}
            style={{ "--i": i } as React.CSSProperties}
          >
            <span className="nums lnc-dial-value">
              {String(p.value).padStart(2, "0")}
            </span>
            <span className="lnc-dial-label">{p.label}</span>
          </div>
        ))}
      </div>

      {/* No action row under a running clock: the page itself carries the one
          open door (הירשם עכשיו ותפוס את השם, with the line explaining that the
          game opens when the countdown ends), and a second register button
          three rows above it was only the other half of a login button that no
          longer belongs here. */}
    </div>
  );
}

/**
 * The doors — two once the gates are open, one before.
 *
 * Before the clock runs out there is nothing to sign in *to*: `login` refuses
 * every non-admin for as long as the window lasts (see PRELAUNCH_LOGIN_NOTICE),
 * so "כבר יש לי חשבון" was a button whose entire function was to produce a
 * refusal — on the one screen the whole audience lands on. Registration is the
 * only thing open, so it is the only thing offered.
 */
function LaunchActions({ arrived }: { arrived: boolean }) {
  const t = useT();
  return (
    <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
      <Link
        href={arrived ? "/login" : "/register"}
        className="btn btn-gold w-full justify-center px-8 py-3 text-base sm:w-auto"
      >
        {arrived ? t("כניסה למשחק") : t("להרשמה מוקדמת")}
      </Link>
      {arrived && (
        <Link
          href="/register"
          className="btn btn-ghost w-full justify-center px-8 py-3 text-base sm:w-auto"
        >
          {t("יצירת חשבון")}
        </Link>
      )}
    </div>
  );
}
