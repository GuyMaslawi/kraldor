"use client";

import { useEffect, useRef } from "react";

/**
 * Fires the one conversion event the campaign optimises against.
 *
 * ## Why this has to exist at all
 *
 * A Meta campaign with the Conversions objective needs an event to aim at.
 * Without `CompleteRegistration` coming back, the only thing that can be bought
 * is clicks — and a click-optimised campaign spends its budget on the people
 * most likely to *tap an ad*, which is a different and much cheaper population
 * than the people likely to found an empire. This component is the difference
 * between the two.
 *
 * ## Mounted only where a registration has just happened
 *
 * Both signup paths end somewhere specific — the password path on
 * `/verify-email`, the Google path on the first game screen after `/onboarding`
 * — and both are pages a player also revisits later. So the flag that mounts
 * this is a **query parameter set by the redirect that follows a successful
 * create**, not the page itself. A player who bookmarks `/verify-email` and
 * comes back tomorrow does not re-fire the event.
 *
 * The ref guards the second half of that: React may mount an effect twice in
 * development's strict mode, and a doubled conversion would quietly halve every
 * cost-per-signup the campaign reports.
 *
 * Renders nothing, and does nothing at all when no pixel is configured — the
 * globals it calls simply do not exist, which is what the `typeof` checks are
 * for rather than a config read.
 */
export function RegistrationPixel() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const w = window as typeof window & {
      fbq?: (...args: unknown[]) => void;
      ttq?: { track: (...args: unknown[]) => void };
    };

    if (typeof w.fbq === "function") w.fbq("track", "CompleteRegistration");
    if (w.ttq && typeof w.ttq.track === "function") w.ttq.track("CompleteRegistration");
  }, []);

  return null;
}
