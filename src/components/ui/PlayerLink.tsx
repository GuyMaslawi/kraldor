"use client";

import Link from "next/link";
import { WornTitle } from "@/components/ui/WornTitle";
import { ShieldBadges, type ShieldState } from "@/components/game/ShieldBadges";
import { useT } from "@/i18n/client";

/**
 * A player's name, always a door into his dossier.
 *
 * The name of another empire is never dead text in this game: it is the thing
 * you click to decide whether to spy, raid, mail or ally. The ladders had that
 * link from the start, but the places you actually *meet* a rival — your inbox,
 * the battle history, the guild roster, the war feed — printed the name flat,
 * so learning who hit you meant going back to the rankings and searching for
 * him by hand. Every one of those now renders through here.
 *
 * `empireId` is nullable on purpose. A sender or a recruiter whose account was
 * deleted keeps his name in the row (the FKs are SetNull, not Cascade) but has
 * no dossier left to open — those degrade to plain text rather than to a link
 * that 404s. It is a plain component with no hooks, so client tables and server
 * pages can both render it.
 */
export function PlayerLink({
  empireId,
  name,
  className = "",
  title,
  titleKey,
  shields,
  staff = false,
}: {
  empireId: string | null | undefined;
  name: string;
  className?: string;
  /** Tooltip; defaults to naming what the link opens. */
  title?: string;
  /**
   * `Empire.title` — the תואר to draw after the name, on the boards that show
   * one. Omitted everywhere else, which is most callers: see WornTitle for which
   * screens earn a title and why the streams deliberately do not.
   *
   * Passed in rather than looked up, for the same reason `staff` is: this
   * component stays query-free so a server page and a client table can both
   * render it, and every caller that shows a title is already selecting the
   * empire row the key sits on.
   */
  titleKey?: string | null;
  /**
   * The paid raid shields this empire is holding right now, if the caller
   * loaded them — `getActiveShields` / `getShieldsForEmpires` in
   * `src/lib/game/diamondEffects.ts` both return exactly this shape.
   *
   * A shield is public knowledge and it is the single fact that decides whether
   * a raid is worth its turns, so it belongs on the name itself rather than on
   * one board that happens to remember it: wherever you meet a rival — the
   * ladder, your inbox, the battle history, his dossier — the badge rides with
   * him. Absent (the default) draws nothing, so a caller with no shield data
   * simply keeps the plain name; passing a map with no live shield draws
   * nothing either.
   */
  shields?: ShieldState | null;
  /**
   * Render as the game's own account: molten gold with a highlight travelling
   * across it (`.staff-name` in globals.css).
   *
   * Off by default and passed explicitly, rather than looked up in here. This
   * component is deliberately hook-free and query-free so client tables and
   * server pages can both render it, and every caller that can actually *show*
   * a staff empire — chat, mail, a guild roster, the dossier itself — already
   * has the flag in the row it is drawing. Everywhere else a staff empire is
   * simply absent (see src/lib/staff.ts), so there is nothing to decorate.
   */
  staff?: boolean;
}) {
  // The gradient fill replaces the colour utilities a caller passes, so the
  // staff class goes last and the two are never both meaningful.
  const t = useT();
  const cls = `${className} ${staff ? "staff-name" : ""}`.trim();
  // A sibling of the name, never a child of it: `className` here is routinely
  // `truncate`, and a title inside the link would be the first thing an ellipsis
  // ate on a narrow row. Outside it, the name gives ground and the title stays
  // whole — which is the right way round, since the name is also a tooltip and
  // a link while the title is only ever the word.
  const worn = <WornTitle titleKey={titleKey} className="ms-1.5 align-middle" />;
  // Same reasoning as the title, and the same place: outside the link, after
  // the word. `empty:hidden` is what keeps the wrapper honest — ShieldBadges
  // renders nothing for an empire holding no shield, and an empty span would
  // otherwise still spend its margin on every unshielded name in a table.
  const guarded = shields ? (
    <span className="ms-1.5 inline-flex items-center gap-1 align-middle empty:hidden">
      <ShieldBadges shields={shields} />
    </span>
  ) : null;

  if (!empireId)
    return (
      <>
        <span className={cls}>{name}</span>
        {worn}
        {guarded}
      </>
    );

  return (
    <>
      <Link
        href={`/game/empires/${empireId}`}
        title={
          title ??
          (staff
            ? t("הנהלת המשחק — {name}", { name })
            : t("הפרופיל של {name}", { name }))
        }
        className={`underline-offset-4 hover:text-gold-bright hover:underline ${cls}`}
      >
        {name}
      </Link>
      {worn}
      {guarded}
    </>
  );
}
