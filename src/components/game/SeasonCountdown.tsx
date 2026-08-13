"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";

/**
 * The countdown to the next season, on the sealed-season screen.
 *
 * Counts in **server time**, like `UpdateTimers`: the whole page exists because
 * a server-side deadline passed, so a client clock running four minutes fast
 * must not show the gates opening before the server agrees. The offset is
 * measured once against the freshest server timestamp and every tick rides it.
 *
 * When it reaches zero the page refreshes rather than unlocking anything
 * itself — the gate is a server decision (`getSeasonGate` activates the next
 * season lazily), and the refresh is just how this screen asks. It keeps
 * retrying, because the first request after the deadline is the one that pays
 * for the swap and may take a moment.
 */
export function SeasonCountdown({
  serverNow,
  startsAt,
  // i18n-keys: a default the component runs through t() itself, so callers pass Hebrew
  arrivedLabel = "השערים נפתחים…",
}: {
  serverNow: number;
  startsAt: number;
  /**
   * What to say once the deadline passes. The default is the sealed-gate
   * screen's line; the prize hall counts the other way — down to a season
   * *closing* — and must not promise gates opening.
   */
  arrivedLabel?: string;
}) {
  const router = useRouter();
  const [now, setNow] = useState(serverNow);
  const skewRef = useRef(0);

  useEffect(() => {
    skewRef.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const tick = () => setNow(Date.now() + skewRef.current);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const remaining = startsAt - now;
  const arrived = remaining <= 0;

  useEffect(() => {
    if (!arrived) return;
    const first = setTimeout(() => router.refresh(), 800);
    const retry = setInterval(() => router.refresh(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(retry);
    };
  }, [arrived, router]);

  const t = useT();

  if (arrived) {
    return (
      <p className="ssn-opening text-sm font-bold text-gold-bright">
        {t(arrivedLabel)}
      </p>
    );
  }

  const total = Math.floor(remaining / 1000);
  const parts = [
    { label: t("ימים"), value: Math.floor(total / 86400) },
    { label: t("שעות"), value: Math.floor((total % 86400) / 3600) },
    { label: t("דקות"), value: Math.floor((total % 3600) / 60) },
    { label: t("שניות"), value: total % 60 },
  ];

  return (
    <div className="flex items-start justify-center gap-2 sm:gap-3" dir="ltr">
      {parts.map((p, i) => (
        <div key={p.label} className="ssn-dial" style={{ "--i": i } as React.CSSProperties}>
          <span className="nums ssn-dial-value">{String(p.value).padStart(2, "0")}</span>
          <span className="ssn-dial-label">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
