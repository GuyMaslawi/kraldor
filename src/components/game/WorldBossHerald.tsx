"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  pollWorldBossHerald,
  type WorldBossHeraldState,
} from "@/server/actions/worldBoss";
import { WorldBossTakeover } from "./WorldBossTakeover";

/**
 * The world boss, announced on whatever screen the player happens to be on.
 *
 * Mounted in the game layout and renders **nothing** in the ordinary case: it is
 * a poll and a memory, and the only thing it can put on screen is the once-per-
 * beast takeover. The arena itself is still the only page that draws the fight.
 *
 * ## It is also what makes the fixture automatic
 *
 * There is no cron in this deployment, so a clock fixture exists from the moment
 * something asks for it. `getWorldBossHerald` (which both the layout's first
 * render and this poll call) is that ask, and it opens the day's row if the day
 * has turned over — so the beast is standing within a minute of midnight
 * whether or not a single player has opened /game/worldboss. Before this the
 * daily boss would have appeared whenever somebody happened to wander into the
 * arena, which on a quiet morning is not "every 24 hours" at all.
 *
 * ## Once per beast, and it has to survive navigation
 *
 * The layout remounts this component on every route change, so "have I already
 * announced this one" cannot live in React state — it is the boss row's id in
 * localStorage, exactly as Happy Hour remembers its release. A new beast always
 * breaks through; the same beast never announces twice, in any tab.
 */

/**
 * Poll rates. The answer changes at most twice a day (the beast rises, the
 * server fells it), so this is deliberately the slowest poll in the layout —
 * the reason it exists at all is to catch the midnight rollover for a player
 * who is already sitting on a screen, and a minute of lag on that is nothing.
 */
const POLL_LIVE_MS = 60_000;
const POLL_IDLE_MS = 120_000;

/** Where the CTA sends the player. */
const ARENA_HREF = "/game/worldboss";

const SEEN_KEY = "kraldor.worldboss.seen";

function alreadySeen(id: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === id;
  } catch {
    // Private mode, blocked storage — better a repeated announcement than none.
    return false;
  }
}

function markSeen(id: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* nothing to do: the announcement simply shows again next load */
  }
}

export function WorldBossHerald({
  initial,
}: {
  initial: WorldBossHeraldState | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<WorldBossHeraldState | null>(initial);
  const [takeoverId, setTakeoverId] = useState<string | null>(null);

  // The arena draws the beast at full size; announcing it over its own page
  // would be a screen telling the player to go where they already are. Marked
  // seen all the same — they have *seen* it, which is the whole question the
  // memory answers.
  const inArena = pathname === ARENA_HREF;

  /**
   * A felled beast is not news.
   *
   * The takeover says "it is back", so it only ever fires for one that is
   * standing. A player whose first screen of the day comes after the server has
   * already killed it gets nothing here — and correctly: the kill has its own
   * herald, in the chat and in their inbox.
   */
  const announce = state !== null && !state.defeated ? state.id : null;

  // localStorage is not readable while rendering on the server, so the decision
  // is made after mount — which also means the takeover can never differ
  // between the server's HTML and the client's first paint. The beat of delay
  // is deliberate as well: the page finishes painting, the player's eye
  // settles, and *then* the screen is taken. Slamming it into the same frame as
  // a navigation reads as a loading state rather than as an event.
  useEffect(() => {
    if (announce === null || alreadySeen(announce)) return;
    if (inArena) {
      markSeen(announce);
      return;
    }
    const timer = setTimeout(() => {
      markSeen(announce);
      setTakeoverId(announce);
    }, 600);
    return () => clearTimeout(timer);
  }, [announce, inArena]);

  /**
   * The other two takeovers get the screen first.
   *
   * Happy Hour and a mini-game release are both fired by an admin, and an admin
   * opening a golden hour at one minute past midnight is three announcements to
   * the same player inside a second. Rather than couple the components, this
   * watches for the others in the DOM and waits: both leave on their own, and
   * an announcement that is a minute late is still an announcement.
   */
  const [blocked, setBlocked] = useState(false);
  const waiting = takeoverId !== null;
  useEffect(() => {
    if (!waiting) return;
    const check = () => {
      // Any of them, including one already fading: crossing a screen that is on
      // its way out is the same collision, half-transparent.
      setBlocked(
        document.querySelector(".hh-takeover") !== null ||
          document.querySelector(".mgt") !== null
      );
    };
    check();
    const id = setInterval(check, 400);
    return () => clearInterval(id);
  }, [waiting]);

  const live = state !== null && !state.defeated;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      // `retry` means the round learned nothing (throttled, or a signed-out
      // tab); leaving the state exactly as it is beats forgetting a beast
      // because one poll came back empty-handed.
      const { state: next, retry } = await pollWorldBossHerald();
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

  const enter = useCallback(() => router.push(ARENA_HREF), [router]);

  if (state === null || takeoverId !== state.id || blocked) return null;

  return (
    <WorldBossTakeover
      state={state}
      onEnter={enter}
      onDone={() => setTakeoverId(null)}
    />
  );
}
