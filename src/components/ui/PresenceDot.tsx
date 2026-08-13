"use client";

import { useT } from "@/i18n/client";

/**
 * Whether a player has the game open right now, drawn the same way everywhere.
 *
 * The single source of the *fact* is `Empire.lastSeenAt` run through
 * `isOnline()` — a heartbeat the chat dock's shut-pane pulse stamps every 25
 * seconds from whatever screen the player is on, so it means "a browser had the
 * game open", not "the chat is open". This file is only the mark: a filled green
 * dot with a slow halo for here, a hollow ring for away.
 *
 * It lives in `ui/` rather than beside the chat because presence is read in two
 * very different places — the chat roster, where it answers "will they reply?",
 * and the rankings ladder, where it answers "will they notice me coming?" — and
 * the two must never drift into two different-looking dots.
 *
 * Away is a *filled* red dot rather than the hollow ring it started as: a hollow
 * outline on a dark panel is easy to miss entirely, and on a board read to pick
 * targets "not here" is a real answer, not the absence of one. It is dimmed and
 * never animated, so a roster of sleeping players stays quiet — only the green
 * one pulses.
 *
 * Purely presentational (no hooks), so it renders in a server component as
 * happily as inside the client-side dock.
 */

/** The word the dot says out loud, in the tooltip and in the labelled pill. */
// i18n-keys: read through t() two lines below, where the tooltip is built
const PRESENCE_WORD = { on: "מחובר עכשיו", off: "לא מחובר עכשיו" } as const;

export function PresenceDot({
  online,
  label = false,
}: {
  /** `undefined` = presence is not disclosed here; the dot draws nothing. */
  online?: boolean;
  /** Spell it out in a word beside the dot, for surfaces with no legend. */
  label?: boolean;
}) {
  const t = useT();
  // Undisclosed presence draws nothing. A hollow dot reads as "this player is
  // away", and some callers genuinely do not know — see searchChatPlayers.
  if (online === undefined) return null;

  const word = t(online ? PRESENCE_WORD.on : PRESENCE_WORD.off);
  const dot = (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        online ? "presence-online bg-accent-green" : "bg-accent-red/60"
      }`}
    />
  );

  if (!label) {
    // The title carries the meaning for anyone who cannot read a coloured dot.
    return <span title={word}>{dot}</span>;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-bold ${
        online
          ? "border-accent-green/50 bg-accent-green/10 text-accent-green"
          : "border-accent-red/40 bg-accent-red/10 text-accent-red/80"
      }`}
    >
      {dot}
      {word}
    </span>
  );
}
