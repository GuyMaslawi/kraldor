import "server-only";

import { prisma } from "@/lib/prisma";
import { notStaffOrBot } from "@/lib/bot";
import { getSeasonGate } from "@/server/seasonClose";

/**
 * The handful of live numbers the landing page puts in front of a stranger.
 *
 * ## Why the season clock is the whole page
 *
 * Everything a paid visitor needs to be told is a consequence of one fact: the
 * world is wiped every 30 days and the next one starts with everybody on zero.
 * That is the answer to the objection that kills sign-ups for every PvP game —
 * *"it's too late, everyone is stronger than me"* — and it is the only claim on
 * the page that no competitor can copy, because it is a property of the
 * schedule rather than of the marketing.
 *
 * So the page leads with a countdown, and this function's real job is to work
 * out **which** countdown that is. There are three states and they want three
 * different pages:
 *
 *   `preseason`  the game is shut between seasons and the next one is booked.
 *                The strongest possible state to advertise into: the countdown
 *                is to a start line everybody shares. Sign-ups are *closed*,
 *                so the page asks for a Discord follow instead of a click that
 *                would land on a locked door.
 *   `running`    a season is under way. The countdown runs to its end, and the
 *                honest framing is "this world ends in N days, the next one is
 *                the one to start with everybody else".
 *   `open`       no season configured at all (fresh install, dev). No clock.
 *
 * ## The counts are proof, not decoration
 *
 * A stranger's first question is whether anybody is actually here. Three
 * numbers answer it, and all three are deliberately about *this* season rather
 * than all time: an all-time total is the number a dead game quotes.
 *
 * Bots and staff are excluded. A garrison planted so a lone player has someone
 * to raid is a legitimate part of the game and an illegitimate part of a
 * population claim — putting one in this number would make the page a lie in
 * exactly the way that a player discovers on day two.
 */

export type LandingSeason =
  | { phase: "preseason"; name: string | null; startsAt: Date }
  | { phase: "running"; name: string; endsAt: Date }
  | { phase: "open" };

export type LandingData = {
  season: LandingSeason;
  /** Live empires this season, minus staff and garrisons. */
  empires: number;
  /** Guilds with at least one real member. */
  guilds: number;
  /** Battles fought in the last 24 hours — "is anything happening here". */
  battles24h: number;
  /** Server time, for the countdown's clock skew correction. */
  now: number;
};

export async function getLandingData(): Promise<LandingData> {
  const now = new Date();
  const gate = await getSeasonGate();

  // Between seasons: the game is sealed and the only clock that matters is the
  // one to the next opening. Nothing else on this page can be true yet — the
  // world has been wiped — so the counts are not queried at all.
  if (!gate.open) {
    return {
      season: gate.nextStartsAt
        ? { phase: "preseason", name: gate.nextSeasonName, startsAt: gate.nextStartsAt }
        : { phase: "open" },
      empires: 0,
      guilds: 0,
      battles24h: 0,
      now: now.getTime(),
    };
  }

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [active, empires, guilds, battles24h] = await Promise.all([
    prisma.gameSeason.findFirst({
      where: { isActive: true },
      select: { name: true, endsAt: true },
    }),
    prisma.empire.count({ where: notStaffOrBot }),
    // A guild whose every member is a bot is a garrison's guild, not a
    // community — `some` rather than a bare count keeps it out.
    prisma.guild.count({ where: { members: { some: { empire: notStaffOrBot } } } }),
    // Bounded by the index on (createdAt): a rolling day, never the whole table.
    prisma.battleReport.count({ where: { createdAt: { gte: dayAgo } } }),
  ]);

  return {
    season:
      active && active.endsAt > now
        ? { phase: "running", name: active.name, endsAt: active.endsAt }
        : { phase: "open" },
    empires,
    guilds,
    battles24h,
    now: now.getTime(),
  };
}
