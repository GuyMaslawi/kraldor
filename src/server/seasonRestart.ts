import "server-only";
import type { Prisma } from "@prisma/client";
import { notBot } from "@/lib/bot";
import { newEmpireData } from "@/lib/game/createEmpire";
import type { GameTunables } from "@/lib/game/config";

/**
 * Rebuilding the world — the wipe that makes a new season a new race.
 *
 * Every empire is deleted and recreated from the opening bundle (buildings,
 * army, upgrades, storages, weapons, hero, bank), and every guild is dissolved.
 *
 * **The diamond balance is the only thing a player carries across.** That is the
 * whole rule, and it is deliberately absolute: a season is a clean race, and
 * anything else that survived would be an advantage one player has and a new
 * one cannot get. VIP (`vipSince`), the community welcome purse
 * (`discordJoinedAt`) and the profile `bio` are all reset with everything else —
 * so חותם המלוכה is bought again each season, and the purse can be collected
 * again each season. Diamonds are the exception because they are bought with
 * real money: taking them would be taking something the player paid for.
 *
 * Besides the diamonds, three things simply are not the empire's to lose:
 *   • user accounts, roles and bans — `User` rows are never touched;
 *   • `isStaff`, which is not a game asset but a statement about whether the
 *     account competes at all (see lib/staff.ts) — defaulting it to false here
 *     would quietly put an admin back into the competition, on every board and
 *     every podium;
 *   • the real-money purchase trail (DiamondPurchase detaches, SetNull).
 * Everything else cascades away with the empire it belonged to.
 *
 * Extracted here because two callers must do *exactly* the same thing: the
 * admin's confirmed reset button and the automatic restart when a new season
 * opens (server/seasonClose.ts). Two copies of this would drift, and the drift
 * would only be discovered on the one night of the year it runs by itself.
 *
 * **Takes a transaction client and reads inside it.** The reads are not a
 * prelude to the wipe, they are part of it: a registration landing between a
 * read outside and the `deleteMany` inside would be deleted without ever being
 * rebuilt, costing that player their account's empire entirely.
 */
export interface WorldRestart {
  /** Players whose empire was rebuilt from scratch. */
  empiresRebuilt: number;
  /** Bot garrisons removed — they are not rebuilt. See the note below. */
  botsRemoved: number;
}

export async function restartWorld(
  tx: Prisma.TransactionClient,
  seasonId: string | undefined,
  tunables: GameTunables
): Promise<WorldRestart> {
  // Bots do not survive a world restart, and are removed rather than rebuilt.
  //
  // Rebuilding one here is not an option: `newEmpireData` produces a starter
  // empire with no garrison and no `EmpireBot` row (the old one cascades away
  // with the empire), so the loop below would leave a flagged husk that the
  // refill can never repair. They are *replanted* instead, from scratch and
  // after this transaction commits — `ensureCityBots` fills the first city back
  // up to `season.openBots` (see server/seasonClose.ts and the admin's reset).
  // That is not the same as carrying them over: a new season's garrisons are
  // new empires with fresh names and full garrisons, not last season's husks.
  //
  // Deleting the *user* is what takes the empire with it (cascade), and it also
  // keeps the restart from leaving accounts behind that inflate every player
  // count in the admin.
  const botUsers = await tx.empire.findMany({
    where: { isBot: true },
    select: { userId: true },
  });

  const empires = await tx.empire.findMany({
    where: notBot,
    select: {
      userId: true,
      name: true,
      diamonds: true,
      isStaff: true,
      // The muster roll carries over — see the note at the assignment below.
      streakDay: true,
      streakCount: true,
      streakBest: true,
    },
  });

  // Guilds first: members, spells and treasury transactions cascade off.
  await tx.guild.deleteMany({});
  if (botUsers.length > 0) {
    await tx.user.deleteMany({ where: { id: { in: botUsers.map((b) => b.userId) } } });
  }
  await tx.empire.deleteMany({});

  for (const e of empires) {
    const data = newEmpireData(
      e.userId,
      e.name,
      seasonId,
      tunables.starting,
      undefined,
      e.isStaff
    );
    // The carry-overs. Everything else on the rebuilt row is whatever
    // `newEmpireData` gives a brand-new registration — including `vipSince` and
    // `discordJoinedAt`, which are null again on purpose (see above).
    data.diamonds = e.diamonds;
    // The muster roll survives the restart, and it is the one thing here that
    // is *not* about the world. A streak is a record of the player's habit —
    // how many days in a row they have opened the game — and the world being
    // wiped is not something they did. Breaking a forty-day run because an
    // admin scheduled a new season would punish exactly the players the loop
    // exists to keep, and on a day they did nothing wrong.
    //
    // It also cannot be exploited: the columns only ever gate *tomorrow's*
    // claim (see streakTransition), and the day they encode is a calendar day,
    // so carrying them forward hands out nothing on the day of the restart.
    data.streakDay = e.streakDay;
    data.streakCount = e.streakCount;
    data.streakBest = e.streakBest;
    // No new-player shield on a restart: everyone starts equal and may compete
    // immediately. The shield is only for a genuine mid-season registration
    // joining among established players.
    data.protectedUntil = null;
    await tx.empire.create({ data });
  }

  return { empiresRebuilt: empires.length, botsRemoved: botUsers.length };
}
