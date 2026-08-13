"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";

/**
 * How long the pointer has to rest on a link before it counts as intent. A
 * cursor crossing the nav grid on its way somewhere else passes over a tile in
 * well under this; a cursor that has arrived stays put for longer.
 */
const INTENT_MS = 90;

/**
 * The "this link is working on it" hint. It has to be a *descendant* of the
 * <Link> — that is the only place useLinkStatus reads anything — so it is
 * rendered as a child rather than as a class on the anchor itself.
 *
 * Always rendered, absolutely positioned and starting fully transparent: an
 * indicator that appears in the flow would shift the tile's layout the instant
 * it is clicked, and the CSS delays it past a fast navigation entirely (see
 * .link-pending in globals.css).
 */
function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden className={`link-pending${pending ? " is-pending" : ""}`} />
  );
}

/**
 * A <Link> for the game's navigation surfaces: the sidebar's command board, the
 * command-bar pills, and the handful of cross-links between screens.
 *
 * ## Why this exists
 *
 * Every one of those links used to be a plain `prefetch={false}` <Link>, and
 * for a good reason: they are on screen on *every* page of the game, so Next's
 * default viewport prefetching asked the server to render fifteen-odd extra
 * routes per page view — 2,106 of one player's 2,328 requests in an evening
 * were speculative renders, enough to trip Vercel's per-IP ceiling and hand him
 * a 429 on the battle report he had just earned.
 *
 * But `prefetch={false}` is not free either, and what it costs is exactly the
 * bug this component fixes. From the Next docs (03-api-reference/components/
 * link): "`false`: Disable prefetching on both viewport and hover." So a click
 * has *nothing* cached to swap in — not even the destination's `loading.tsx`
 * skeleton, which only exists inside the RSC payload the router has yet to
 * fetch. Until the first bytes come back the screen is completely unchanged:
 * no skeleton, no spinner, no pressed state. The player reads that as a dead
 * link and clicks again.
 *
 * Clicking again actively makes it worse. A navigation takes priority over any
 * action already in flight and marks it discarded (see Next's
 * app-router-instance: "Navigations (including back/forward) take priority over
 * any pending actions"), so the second click throws away the round trip the
 * first one had already half-finished and starts over.
 *
 * ## What it does instead
 *
 * Two halves, both straight out of 02-guides/prefetching.md:
 *
 * 1. **Prefetch on intent, not on sight.** `prefetch={null}` restores Next's
 *    default the moment the player hovers, touches or tabs to a link — so the
 *    one route they are about to open is warm, while the twenty they are not
 *    stay untouched. The arming resets on every navigation, so a long session
 *    spent sweeping the mouse over the board cannot drift back into the storm.
 *
 * 2. **Say something immediately.** `useLinkStatus` drives the hint above, so
 *    even a cold, slow navigation gives the click an answer within a frame.
 */
export function NavLink({
  className,
  children,
  onPointerEnter,
  onPointerDown,
  onPointerLeave,
  onPointerCancel,
  onFocus,
  ...rest
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const pathname = usePathname();
  // Armed *as of a screen*, not armed full stop — which is why this holds a
  // pathname rather than a boolean, and why nothing has to reset it in an
  // effect. Arming is deliberately sticky while the player stands on one
  // screen (a warm route stays warm, so re-arming the same tile buys nothing),
  // but it must not accumulate across a session: an armed link is a default
  // link, and Next re-prefetches those whenever it suspects the cache has gone
  // stale — which, with this game's refresh-on-a-timer components, is often.
  // Comparing against the live pathname bounds it to the one or two links the
  // player has actually reached for since they last arrived somewhere.
  const [armedOn, setArmedOn] = useState<string | null>(null);
  const armed = armedOn === pathname;
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDwell = useCallback(() => {
    if (dwell.current === null) return;
    clearTimeout(dwell.current);
    dwell.current = null;
  }, []);

  useEffect(() => cancelDwell, [cancelDwell]);

  return (
    <Link
      {...rest}
      // `null` is not "off" — it is Next's default (see LinkProps: "auto",
      // null, undefined"). Only `false` disables prefetching.
      prefetch={armed ? null : false}
      // The hint below is positioned against the anchor. Harmless where the
      // caller already sets it; the pills and the nav tiles both do.
      className={className === undefined ? "relative" : `relative ${className}`}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        // Touch has no hover: a "pointer enter" there is already the tap
        // landing, and onPointerDown below has it covered.
        if (armed || e.pointerType === "touch") return;
        cancelDwell();
        dwell.current = setTimeout(() => setArmedOn(pathname), INTENT_MS);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        // The press itself is the strongest possible signal of intent, and on
        // a mouse it still lands a beat before the click.
        cancelDwell();
        setArmedOn(pathname);
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        cancelDwell();
      }}
      onPointerCancel={(e) => {
        onPointerCancel?.(e);
        cancelDwell();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        setArmedOn(pathname);
      }}
    >
      {children}
      <PendingHint />
    </Link>
  );
}
