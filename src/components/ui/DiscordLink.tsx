"use client";

import { Icon } from "@/components/ui/Icon";
import { useT } from "@/i18n/client";

/**
 * The one way the site links out to the community channel.
 *
 * Every surface that offers Discord — the sidebar, the auth screens, the chat
 * dock, the guide, the community page — renders this, so the invite is opened
 * the same way everywhere: a new tab, `rel="noreferrer"` (a game screen's URL
 * can carry a report id; there is no reason to hand it to Discord), and nothing
 * at all when the channel has not been configured yet.
 *
 * `url` is a prop rather than an environment read on purpose: the value lives in
 * a server-only module (see server/discord.ts), and each caller passes what it
 * was given. A component that read the env itself would render an empty link in
 * client bundles and nobody would notice.
 */
export function DiscordLink({
  url,
  variant = "inline",
  // i18n-keys: a default the component runs through t() itself, so callers pass Hebrew
  label = "קהילת קראלדור בדיסקורד",
  className = "",
}: {
  url: string | null;
  /**
   * `button` — a gold CTA, for a page that is asking you to join.
   * `pill`   — a bordered chip in Discord's own blurple, for a footer.
   * `strip`  — a full-width bar, for docking under a panel header.
   * `topbar` — the command-bar pill: sized like the inbox pills it sits beside,
   *            and the only variant that moves (see .discord-pill).
   * `inline` — a quiet text link, for a paragraph or a nav row.
   *
   * Each one carries its *whole* look, including hover: variants that shared a
   * base and were patched by the caller's className collided on colour, and two
   * equally specific utility rules are settled by stylesheet order rather than
   * by which one was passed last.
   */
  variant?: "button" | "pill" | "strip" | "topbar" | "inline";
  label?: string;
  /** Layout only — margins and sizing. Colour belongs to the variant. */
  className?: string;
}) {
  const t = useT();
  if (!url) return null;

  const base =
    variant === "button"
      ? "btn btn-gold inline-flex items-center gap-2 px-5 py-2 text-sm"
      : variant === "pill"
        ? "inline-flex items-center gap-2 rounded-lg border border-[#5865F2]/45 bg-[#5865F2]/12 px-4 py-2 text-xs font-bold text-[#c7ccff] transition-colors hover:border-[#5865F2] hover:bg-[#5865F2]/25 hover:text-white"
        : variant === "strip"
          ? "flex items-center justify-center gap-2 border-b border-[#5865F2]/30 bg-[#5865F2]/12 px-2.5 py-1.5 text-[11px] font-bold text-[#c7ccff] transition-colors hover:bg-[#5865F2]/22 hover:text-white"
          : variant === "topbar"
            ? // Same geometry as the inbox pills next to it (see InboxNav) —
              // everything that isn't geometry lives in .discord-pill.
              "res-pill discord-pill relative gap-1.5 px-2 py-1.5 text-xs font-bold sm:px-2.5"
            : "inline-flex items-center gap-1.5 transition-colors hover:text-gold";

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={`${base} ${className}`}
    >
      <Icon
        name="discord"
        size={
          variant === "button" ? 18 : variant === "topbar" ? 18 : variant === "pill" ? 16 : 14
        }
        // The mark is what animates in the command bar; everywhere else the
        // class is inert.
        className={`shrink-0${variant === "topbar" ? " discord-mark" : ""}`}
      />
      {variant === "topbar" ? (
        // The label is a desktop luxury, exactly as on the inbox pills: below
        // md the bar is already carrying the hamburger, the pills and the
        // emblem, and the mark alone is unmistakable.
        <span className="hidden md:inline">{t(label)}</span>
      ) : (
        t(label)
      )}
    </a>
  );
}
