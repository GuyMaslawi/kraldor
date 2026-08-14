"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "@/components/ui/scrollLock";

/**
 * A lightweight centered modal. Renders into a portal on <body>, closes on
 * Escape or a backdrop click, and locks background scroll while open. Styling
 * matches the game's dark + gold panel language.
 *
 * Sized in `dvh`, not `vh`. On a phone `100vh` is the *large* viewport — the
 * height the page would have if the browser's toolbar were collapsed — so a
 * `max-h-[90vh]` card is routinely taller than what is actually on screen, and
 * its last rows (which on this game's dialogs is where the buttons live) sit
 * behind the URL bar with no way to reach them: the card's own scroller has
 * already hit its end.
 */
export function Dialog({
  open,
  onClose,
  children,
  labelledBy,
  size = "sm",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** id of the heading that names the dialog, for aria-labelledby. */
  labelledBy?: string;
  /**
   * "lg" for content that needs room (e.g. a player picker + message form),
   * "xl" for the rare dialog that is the whole screen's business rather than a
   * control on it — the herald's announcement.
   */
  size?: "sm" | "lg" | "xl";
}) {
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      // `h-[100dvh]` rather than `inset-0`: a fixed overlay is laid out against
      // the large viewport, so centring inside `inset-0` on a phone centres the
      // card against a box that runs under the browser chrome and pushes it low.
      className="fixed inset-x-0 top-0 z-[100] flex h-[100dvh] items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        dir="rtl"
        className={`panel-gold relative z-10 max-h-full w-full overflow-y-auto overscroll-contain rounded-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_20px_60px_rgba(0,0,0,0.85)] ${
          size === "xl" ? "max-w-2xl" : size === "lg" ? "max-w-xl" : "max-w-sm"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
