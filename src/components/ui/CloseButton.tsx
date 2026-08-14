"use client";

import { useT } from "@/i18n/client";

/**
 * The way out of an overlay, drawn the same way everywhere.
 *
 * This exists because of a phone bug report, and both halves of that bug are
 * things a desktop review cannot see:
 *
 *  1. The ✕ was hand-rolled per dialog at whatever size fitted the header —
 *     h-6, h-7, h-8, h-9 — which is 24 to 36 CSS px. A finger needs ~44px, so
 *     on a phone the game's close controls ranged from "fiddly" to "you will
 *     miss it". The visible disc here stays small (a ✕ the size of a real
 *     button would dominate a dialog header) and the tap target is pushed out
 *     to 44px by making the *button* 44px and the disc a span inside it — see
 *     `.close-x` in globals.css for why it is two elements and not one.
 *  2. When the ✕ was the last item in a `flex-wrap` header, a narrow screen
 *     squeezed it: on the mini-game board at 320px it was still in the DOM,
 *     still "visible" to a test that only asks for a bounding box, and 20px
 *     wide with its glyph clipped. `shrink-0` is not decoration here.
 *
 * Every overlay in the game routes through this, so there is one place to fix
 * the next thing a phone turns out to disagree with.
 */
export function CloseButton({
  onClick,
  label,
  className = "",
  tone = "default",
}: {
  onClick: () => void;
  /** Overrides the default "סגור" for screen readers, e.g. "סגור את הגלגל". */
  label?: string;
  className?: string;
  /**
   * "onDark" is for the two full-screen takeovers, which have no panel behind
   * the button — it needs its own plate there or it sits on raw artwork.
   */
  tone?: "default" | "onDark";
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? t("סגור")}
      className={`close-x ${tone === "onDark" ? "close-x--on-dark" : ""} ${className}`}
    >
      <span className="close-x-face" aria-hidden>
        ✕
      </span>
    </button>
  );
}
