"use client";

import type { CSSProperties } from "react";
import { wornTitle } from "@/lib/game/titles";
import { useT } from "@/i18n/client";

/**
 * The תואר a player is wearing, drawn beside their name.
 *
 * The single interpreter of a title's `accent`. Before this the dossier held
 * the only copy of the markup — a span, an inline `--accent`, a class — and
 * every ladder that wanted to show a title would have grown its own, which is
 * how two places end up disagreeing about what a title looks like the first
 * time one of them is restyled.
 *
 * ## Where it is drawn, and where it deliberately is not
 *
 * A title goes wherever players are *compared*: the dossier, the city ladder and
 * the global boards, the guild roster, the arena and war tables, the season
 * podium, the world-records case. In all of those the reader is sizing up
 * rivals, which is the only moment a title is worth anything.
 *
 * It is absent from the dense streams — chat, mail, the battle and spy history,
 * the war feed. Three reasons, in order of weight: a coloured word on every line
 * of a scrolling feed stops being a distinction and becomes wallpaper; those
 * rows carry a denormalised name and no empire join, so a title there would put
 * a lookup on the hot path; and on a phone the name already shares its row with
 * a guild tag and a city tier, and this is what would push it to wrap.
 *
 * ## Not a live check
 *
 * Resolution goes through `wornTitle`, which reads the catalog and nothing else
 * — no condition is re-tested here. Testing one would need the full stats
 * snapshot of the empire being *looked at*, i.e. a query per row on a board that
 * draws ten. The condition is enforced where it is put on (see `wearTitle`), and
 * every earned condition is monotonic, so a title once earned stays true. A key
 * the catalog no longer has renders nothing at all rather than a raw key, which
 * is what makes retiring a title a one-line edit with no migration.
 *
 * Hook-free apart from the translator, so server pages and client tables can
 * both render it — the same rule as PlayerLink, which is its main caller.
 */
export function WornTitle({
  titleKey,
  className = "",
}: {
  /** `Empire.title` — null, absent, or a key the catalog may no longer have. */
  titleKey: string | null | undefined;
  className?: string;
}) {
  const t = useT();
  const title = wornTitle(titleKey);
  if (!title) return null;

  return (
    <span
      // `data-kind` is the whole earned/bought distinction as the *reader* sees
      // it. On the shop the two are separate shelves, but nothing followed the
      // title out of that page, so beside a name the only clue was the register
      // of the wording — "מפיל הכתרים" against "המהמר" — which a new player
      // cannot decode. An earned title now carries its own light and a bought
      // one is flat colour: quiet enough not to shame a purchase, decisive
      // enough that the rankings never lie about which is which.
      data-kind={title.kind}
      // The difficulty tier, which only an earned title carries: נדיר burns a
      // little brighter than רגיל and אגדי breathes. See ANIMATED_TIER for why
      // the motion stops there.
      data-tier={title.tier}
      style={{ "--accent": title.accent } as CSSProperties}
      className={`title-worn-inline shrink-0 text-xs font-black ${className}`}
    >
      {t(title.label)}
    </span>
  );
}
