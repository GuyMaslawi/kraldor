"use client";

import { useServerNow } from "@/components/game/HeroPotions";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";

/**
 * A live "time left" clock for anything with an expiry stamp — a guild spell,
 * a potion window, a raid shield, a hero expedition.
 *
 * Pinned to the SERVER's clock, not the browser's (see useServerNow): a client
 * two minutes fast would otherwise show a spell as already gone while every
 * calculation on the server still counts it.
 */

/**
 * "3ד 04:12:07" / "04:12:07" / "12:07" — only the units that matter.
 *
 * Takes the translator because the day marker is a letter, not a symbol: "ד"
 * in Hebrew, "d" in English.
 */
export function formatTimeLeft(t: T, ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0)
    return `${t("{days}ד", { days })} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function ExpiryCountdown({
  expiresAt,
  serverNow,
  className = "",
  // i18n-keys: a default the component runs through t() itself, so callers pass Hebrew
  expiredLabel = "פג",
}: {
  /** Epoch ms the effect runs out at. */
  expiresAt: number;
  /** The server's own clock at render time. */
  serverNow: number;
  className?: string;
  expiredLabel?: string;
}) {
  const t = useT();
  const now = useServerNow(serverNow);
  const left = expiresAt - now;

  if (left <= 0) {
    return (
      <span className={`nums text-zinc-500 ${className}`} dir="ltr">
        {t(expiredLabel)}
      </span>
    );
  }
  // Under five minutes the window is about to slam shut — say so in red, since
  // that is exactly the difference between "worth attacking now" and "wait".
  const urgent = left < 5 * 60_000;
  return (
    <span
      className={`nums font-bold ${urgent ? "text-red-400" : ""} ${className}`}
      dir="ltr"
    >
      {formatTimeLeft(t, left)}
    </span>
  );
}
