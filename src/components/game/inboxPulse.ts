"use client";

import { useSyncExternalStore } from "react";
import {
  getInboxPulse,
  type InboxPulse,
  type LiveAlert,
} from "@/server/actions/messages";

/**
 * One poller for the whole command bar.
 *
 * The badges (InboxNav) and the toasts (WarAlerts) are two views of the same
 * question — "has anything happened to me?" — so they share a single module
 * singleton rather than each running their own interval. That keeps the server
 * cost at one round trip per player per tick no matter how many components
 * care, and it guarantees the badge and the toast announcing the same attack
 * can never appear a poll apart.
 *
 * Why polling and not a socket: the game runs on serverless functions in front
 * of a pooled Postgres, where a push channel means holding one live connection
 * open per signed-in player for as long as they play. A four-second poll of
 * four indexed counts buys the same felt latency for a fraction of that, and
 * degrades into "slightly stale" rather than "silently disconnected".
 */

/** Cadence while the tab is actually in front of the player. */
const VISIBLE_MS = 4_000;
/**
 * Background tabs keep ticking, slowly. Not for the player — they aren't
 * looking — but so a tab left open for an hour has something to show in the
 * instant before the wake-up poll lands.
 */
const HIDDEN_MS = 60_000;

let snapshot: InboxPulse | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

function emit() {
  listeners.forEach((listener) => listener());
}

/**
 * Whether a freshly polled pulse says anything the current one doesn't.
 *
 * The overwhelmingly common poll result is "nothing changed", and publishing a
 * new object for it would re-render the toast stack and both badges every four
 * seconds forever. Alert ids are compared positionally because the server
 * returns them in a stable order.
 */
function unchanged(prev: InboxPulse | null, next: InboxPulse): boolean {
  return (
    prev !== null &&
    prev.unreadMessages === next.unreadMessages &&
    prev.newReports === next.newReports &&
    sameIds(prev.alerts, next.alerts) &&
    // Compared for the same reason the alerts are, and it is not redundant with
    // `unreadMessages`: dismissing an announcement drops that count by one, so
    // an arriving announcement and a message read elsewhere in the same four
    // seconds would cancel out and the dialog would never open.
    sameIds(prev.announcements, next.announcements)
  );
}

/** Positional id comparison — the server returns both lists in a stable order. */
function sameIds(prev: LiveAlert[], next: LiveAlert[]): boolean {
  return (
    prev.length === next.length && prev.every((a, i) => a.id === next[i]!.id)
  );
}

async function poll(): Promise<void> {
  // A slow round trip must not stack a second one behind it.
  if (inFlight) return;
  inFlight = true;
  try {
    const next = await getInboxPulse();
    // The round learned nothing (throttled, signed out, a hiccup). Publishing
    // its zeros would blank both badges and drop the toast stack, so the last
    // good snapshot stands until a real answer arrives.
    if (next.stale) return;
    if (!unchanged(snapshot, next)) {
      snapshot = next;
      emit();
    }
  } catch {
    // Best-effort: a dropped round just retries on the next tick.
  } finally {
    inFlight = false;
  }
}

function schedule() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (listeners.size === 0) return;
  const hidden = document.visibilityState === "hidden";
  timer = setTimeout(() => void tick(), hidden ? HIDDEN_MS : VISIBLE_MS);
}

/**
 * Chained timeouts rather than setInterval: the next tick is only booked once
 * the previous one has come back, so a browser that throttled the tab (or a
 * server having a slow minute) can never queue up a backlog of polls that all
 * fire at once when it recovers.
 */
async function tick(): Promise<void> {
  await poll();
  schedule();
}

/** Poll right now and restart the cadence from this moment. */
export function refreshInboxPulse(): void {
  void tick();
}

const onWake = () => {
  if (document.visibilityState === "visible") refreshInboxPulse();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    void tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
  };
}

function getSnapshot(): InboxPulse | null {
  return snapshot;
}

/**
 * Null on the server and through hydration, so the first paint is whatever the
 * server rendered and React never sees a mismatch. Consumers fall back to their
 * server-rendered props until the first poll answers.
 */
function getServerSnapshot(): InboxPulse | null {
  return null;
}

/** The live pulse, or null until the first poll comes back. */
export function useInboxPulse(): InboxPulse | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Put a badge out locally, ahead of the server.
 *
 * Opening the history or messages page marks its content seen in a server
 * action that runs *after* the page paints, so without this the player sits
 * inside the inbox watching "3 new" pulse at them until the next poll catches
 * up. The optimistic zero is safe because the very same page load is what makes
 * it true; if the write somehow failed, the next poll simply puts the count
 * back.
 */
export function clearInboxCount(kind: "reports" | "messages"): void {
  if (snapshot === null) return;
  const key = kind === "reports" ? "newReports" : "unreadMessages";
  if (snapshot[key] === 0) return;
  snapshot = { ...snapshot, [key]: 0 };
  emit();
}
