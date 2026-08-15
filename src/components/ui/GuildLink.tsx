"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";

/**
 * A guild's name, always a door into its hall.
 *
 * The sibling of PlayerLink, and for the same reason: a guild name is not a
 * label, it is the second thing you want to look up after the player wearing
 * it — who else is in it, how big it is, who leads it. The ladder, the war
 * board, the recruitment directory and your own base card all printed it as
 * dead text, so "who are these people" had no answer anywhere in the game.
 * Every one of those now renders through here.
 *
 * `guildId` is nullable on the same terms as PlayerLink's `empireId`: the
 * archived boards (היכל התהילה, the season podium) keep a champion's guild name
 * long after the guild itself was wiped with the season, and those degrade to
 * plain text rather than to a link that 404s. Hook-light and query-free, so a
 * server page and a client table can both render it.
 */
export function GuildLink({
  guildId,
  name,
  className = "",
  title,
}: {
  guildId: string | null | undefined;
  name: string;
  className?: string;
  /** Tooltip; defaults to naming what the link opens. */
  title?: string;
}) {
  const t = useT();

  if (!guildId) return <span className={className}>{name}</span>;

  return (
    <Link
      href={`/game/guild/${guildId}`}
      title={title ?? t("הברית {guild}", { guild: name })}
      className={`underline-offset-4 hover:text-gold-bright hover:underline ${className}`}
    >
      {name}
    </Link>
  );
}
