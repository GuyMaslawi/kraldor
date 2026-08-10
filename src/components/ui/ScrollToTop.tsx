"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Every navigation starts at the top of the new screen.
 *
 * This is not what Next does on its own, and the default is easy to mistake for
 * a bug: `<Link>` *maintains* scroll position and only jumps to the top when the
 * new page element is out of the viewport. Every game screen is a tall page
 * inside the same shared layout, so a player who scrolled to the bottom of
 * מכונות and tapped מחסנים landed halfway down a screen he had never seen —
 * the new page was still "visible", so nothing scrolled.
 *
 * Mounted once in the root layout, so it holds for the game, the admin center
 * and the public pages alike.
 *
 * Two things it deliberately does NOT do:
 * - It never fires on the first render. A fresh load is already at the top, and
 *   a page opened at an anchor (#section links in the guide) would be yanked
 *   away from it.
 * - It leaves back/forward alone. The browser restores where you were when you
 *   press back, and that is the one navigation where the old position is the
 *   right answer — so a popstate marks the next pathname change as "not ours".
 *
 * Only the pathname is watched: a query-string change (a tab, a board's page)
 * is a move *within* a screen, and resetting the scroll there would throw the
 * player away from the control they just clicked.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const first = useRef(true);
  const popped = useRef(false);

  useEffect(() => {
    const onPop = () => {
      popped.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (popped.current) {
      popped.current = false;
      return;
    }
    // Not `behavior: "smooth"`: this is the first frame of a screen the player
    // has not seen yet, and animating it looks like the page moved under him.
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
