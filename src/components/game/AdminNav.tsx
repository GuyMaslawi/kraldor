"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { getSupportPulse } from "@/server/actions/support";
import { useT, useDir } from "@/i18n/client";

/**
 * The admin control-center entrance, parked in the top command bar next to the
 * inbox pills (see InboxNav) so it is one click away from every screen instead
 * of only from the desktop sidebar. Rendered by the layout for admins only —
 * this component draws no conclusions about permissions on its own.
 *
 * Beside it, and only while somebody is actually waiting, the support alert:
 * a red pill that says a visitor has written in and nobody has answered them.
 */

/** Cadence while the tab is in front of the admin. */
const POLL_VISIBLE_MS = 20_000;
/** A tab left open on a second monitor. Slow, but never silent. */
const POLL_HIDDEN_MS = 120_000;

/**
 * How many support tickets are waiting on us, live.
 *
 * Its own poller rather than a field on the shared inbox pulse (see
 * inboxPulse.ts): that one runs every four seconds for every signed-in player,
 * and this question is only ever asked by the handful of accounts that can
 * answer it. Keeping it here costs the players nothing and lets the interval be
 * an order of magnitude slower.
 *
 * The server-rendered count seeds the first paint; from there the poll owns the
 * number, because the whole point of the badge is that it appears while the
 * admin is standing on a screen they are not about to reload.
 */
function useWaitingSupport(initial: number): number {
  const [waiting, setWaiting] = useState(initial);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      const hidden = document.visibilityState === "hidden";
      timer = setTimeout(() => void tick(), hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    };

    // Chained timeouts, like the inbox pulse: the next round is booked only
    // once this one is back, so a throttled tab cannot queue up a backlog.
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const pulse = await getSupportPulse();
        // A refused round must not blank a red badge — the last good count
        // stands until a real answer arrives.
        if (!stopped && !pulse.stale) setWaiting(pulse.waiting);
      } catch {
        // Best-effort: a dropped round just retries on the next tick.
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const onWake = () => {
      if (document.visibilityState === "visible") void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);

  return waiting;
}

export function AdminNav({ waitingSupport = 0 }: { waitingSupport?: number }) {
  const pathname = usePathname();
  const active = pathname.startsWith("/admin");
  const waiting = useWaitingSupport(waitingSupport);

  const t = useT();
  const dir = useDir();
  return (
    <div dir={dir} className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      {/* Only while the queue is not empty — a permanent pill in an already
          crowded bar is furniture, and furniture is what nobody looks at. */}
      {waiting > 0 && (
        <Tip
          tip={t(
            "פניות תמיכה שממתינות למענה — מישהו שנתקע במסך ההרשמה, בהתחברות או באימות האימייל כתב אלינו ואף אחד עוד לא ענה"
          )}
          side="bottom"
        >
          <Link
            href="/admin/support"
            // Same reasoning as the inbox pills: a prefetch from every game
            // screen would server-render the whole inbox on every page load.
            prefetch={false}
            aria-label={t("תמיכה — {count} ממתינות", { count: waiting })}
            className="res-pill inbox-glow-red relative gap-1.5 px-2 py-1.5 font-bold text-red-300/90 transition-colors hover:text-white sm:px-2.5"
          >
            <Icon name="chat" size={18} className="shrink-0" />
            <span className="hidden text-xs md:inline">{t("תמיכה")}</span>
            <span
              className="absolute -left-1.5 -top-1.5 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-black leading-[1.1rem] text-white nums"
              dir="ltr"
            >
              {waiting > 99 ? "99+" : waiting}
            </span>
          </Link>
        </Tip>
      )}
      <Tip tip={t("מרכז השליטה — ניהול שחקנים, אימפריות, מתנות, איזון והכרזות")} side="bottom">
        <Link
          href="/admin"
          aria-label={t("מרכז שליטה")}
          className={`res-pill gap-1.5 border-gold/50 px-2 py-1.5 font-bold transition-colors sm:px-2.5 ${
            active ? "border-gold/80 text-white" : "text-gold-bright hover:text-white"
          }`}
        >
          <Icon name="shield" size={18} className="shrink-0" />
          <span className="hidden text-xs md:inline">{t("מרכז שליטה")}</span>
        </Link>
      </Tip>
    </div>
  );
}
