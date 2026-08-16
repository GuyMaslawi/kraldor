import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { announceSuccession, ensureGuildLeader } from "@/server/guildLeadership";
import type { GuildCityOutcome, GuildCityStake } from "@/lib/game/guild";

export type { GuildCityOutcome, GuildCityStake };

/**
 * The guild's second invariant: **every member of a guild holds the same city
 * tier**.
 *
 * A guild is a city's alliance. Everything it does is scoped to one tier —
 * `getGuildAidBonus` reinforces every member with a share of the guild's
 * combined power, the spells buff whoever stands in the same bracket, and the
 * boards a guild competes on are the city ladders. A guild spanning tiers is
 * therefore not a cosmetic oddity: it lets a city-10 empire lend its power to
 * the city-2 bracket it will never be matched against, which is the one thing
 * the aid ladder must not be able to buy.
 *
 * A guild's city is **its leader's city** — no column of its own, so nothing can
 * drift out of step with the roster. Two rules follow, and both live here:
 *
 *  - Recruiting is city-local: `addGuildMember` and `joinGuild` refuse anyone
 *    standing in a different tier.
 *  - A city change re-tests the mover. A plain member (or deputy) who leaves the
 *    tier behind simply leaves the guild. A **leader** who moves takes the
 *    guild's city with him and there is no honest place to put the members he
 *    left behind — the guild is disbanded. He can avoid that by handing the
 *    crown over *before* he climbs, which is exactly the choice the warning on
 *    the city card puts in front of him.
 *
 * Lives outside `actions/guild.ts` for the same reason `guildLeadership.ts`
 * does: that file is `"use server"`, where every export must be an action, and
 * the city change happens in `game.ts`, `diamondEffects.ts` and the admin
 * editor.
 */

/**
 * The city tier a guild recruits in — its leader's.
 *
 * Null for a guild with no members at all (nothing to compare against). A
 * *headless* guild answers too: callers inside a member action have already run
 * `ensureGuildLeader`, and `applyGuildCityRule` runs it itself, so by the time
 * this is asked the crown is seated.
 */
export async function guildCityTier(
  tx: Prisma.TransactionClient,
  guildId: string
): Promise<number | null> {
  const leader = await tx.guildMember.findFirst({
    where: { guildId, role: "LEADER" },
    select: { empire: { select: { cities: true } } },
  });
  if (leader) return leader.empire.cities;
  // No crown seated (the caller did not repair first, or the guild is empty).
  // The oldest member is who `ensureGuildLeader` would crown, so answering from
  // them keeps the two helpers agreeing rather than letting a headless guild
  // recruit from every tier at once.
  const senior = await tx.guildMember.findFirst({
    where: { guildId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { empire: { select: { cities: true } } },
  });
  return senior?.empire.cities ?? null;
}

/**
 * Re-test one empire's membership after its city tier moved, and enforce the
 * rule above. Safe to call when the empire has no guild, or did not actually
 * move — it returns null and writes nothing.
 *
 * Must be called *after* the `cities` write, inside the same transaction: the
 * comparison reads the new tier back from the row, so a rolled-back city change
 * takes the disband with it.
 *
 * `previousCities` is what the empire held *before* the write, and it is not a
 * courtesy — it is what makes the call safe to bolt onto a panel that writes
 * the column without necessarily changing it. The admin vitals form posts
 * `cities` on every save; without this guard, an admin topping up a guild
 * leader's gold would disband his guild.
 */
export async function applyGuildCityRule(
  tx: Prisma.TransactionClient,
  empireId: string,
  previousCities: number
): Promise<GuildCityOutcome | null> {
  const membership = await tx.guildMember.findUnique({
    where: { empireId },
    select: {
      id: true,
      role: true,
      guildId: true,
      guild: { select: { name: true } },
      empire: { select: { name: true, cities: true } },
    },
  });
  if (!membership) return null;
  // The tier did not move: whatever else the caller wrote is none of this
  // rule's business.
  if (membership.empire.cities === previousCities) return null;

  // Lock the guild before deciding. Disbanding races the same window
  // `leaveGuild` documents: a join that commits between an unlocked read and the
  // delete is destroyed by the cascade, with the newcomer never told. The lock
  // is taken in the same order every other path takes it (Empire first — the
  // caller has just written the row — then Guild), so it adds no deadlock edge.
  await tx.$queryRaw`SELECT id FROM "Guild" WHERE id = ${membership.guildId} FOR UPDATE`;

  // A headless guild has no city, so seat the heir before asking for one. This
  // is also the only chance to crown them: if the mover is the last member with
  // a claim, the branches below are about to remove them.
  const heir = await ensureGuildLeader(tx, membership.guildId);
  if (heir) {
    await announceSuccession(tx, heir.empireId, membership.guild.name);
    if (heir.id === membership.id) membership.role = "LEADER";
  }

  const guildName = membership.guild.name;

  if (membership.role === "LEADER") {
    const others = await tx.guildMember.findMany({
      where: { guildId: membership.guildId, NOT: { empireId } },
      select: { empireId: true },
    });

    // A one-man guild moves with its owner. Nobody was left behind in the old
    // tier, so there is no mixed roster to break up — disbanding here would
    // burn the founding fee to enforce an invariant that is already held. Every
    // guild with a second member takes the branch below.
    if (others.length === 0) return null;

    await tx.guild.delete({ where: { id: membership.guildId } });
    for (const other of others) {
      await tx.message.create({
        data: {
          empireId: other.empireId,
          kind: "SYSTEM",
          // i18n-exempt-start: a stored Message row, written on somebody else's
          // request — `getT()` here would resolve the mover's language, not the
          // reader's. Same arrangement as announceSuccession.
          title: "🏰 הברית פורקה",
          body: `מנהיג הברית "${guildName}", ${membership.empire.name}, עבר עיר — ברית מאחדת שחקנים מאותה העיר בלבד, ולכן הברית פורקה. אוצר הברית והשדרוגים ירדו איתה.`,
          // i18n-exempt-end
          href: "/game/guild",
        },
      });
    }
    return { kind: "disbanded", guildName };
  }

  const guildCity = await guildCityTier(tx, membership.guildId);
  if (guildCity === null || guildCity === membership.empire.cities) return null;

  await tx.guildMember.delete({ where: { id: membership.id } });
  await tx.message.create({
    data: {
      empireId,
      kind: "SYSTEM",
      // i18n-exempt-start: a stored Message row — see above. This one does reach
      // the player who acted, but the admin editor writes it too, and then
      // nobody with a language is present at all.
      title: "🏰 עזבת את הברית",
      body: `שינית עיר, וברית מאחדת שחקנים מאותה העיר בלבד — לכן פרשת מ"${guildName}" (עיר ${guildCity}).`,
      // i18n-exempt-end
      href: "/game/guild",
    },
  });
  return { kind: "left", guildName, guildCity };
}

/**
 * The warning the city cards print: what `applyGuildCityRule` *would* do if this
 * empire changed tier right now, or null when it would do nothing.
 *
 * Deliberately derived from the same two facts the rule itself branches on
 * (role, and whether anyone else is seated), so the warning cannot promise one
 * thing and the button do another — the solo-leader carve-out included.
 */
export async function guildCityStake(
  empireId: string
): Promise<GuildCityStake | null> {
  const membership = await prisma.guildMember.findUnique({
    where: { empireId },
    select: { role: true, guildId: true, guild: { select: { name: true } } },
  });
  if (!membership) return null;
  if (membership.role !== "LEADER") {
    return { guildName: membership.guild.name, effect: "leave" };
  }
  const others = await prisma.guildMember.count({
    where: { guildId: membership.guildId, NOT: { empireId } },
  });
  if (others === 0) return null;
  return { guildName: membership.guild.name, effect: "disband" };
}
