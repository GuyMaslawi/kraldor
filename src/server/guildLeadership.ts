import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Guild succession — the one place that enforces the guild's central invariant:
 * **a guild with members has exactly one leader**.
 *
 * The invariant used to be merely *assumed*. `createGuild` seats a LEADER and
 * `transferGuildLeadership` moves the crown atomically, so the only way to empty
 * the office was from outside the guild screen: an admin removing or demoting
 * the leader (`setGuildMembership` / `setGuildMemberRole`), or the leader's
 * Empire row being deleted, which cascades the membership away. The result was a
 * guild nobody could govern — `setGuildRole` and `transferGuildLeadership` both
 * demand LEADER, so no survivor could ever hand the crown to themselves, and
 * there was no admin-free way back.
 *
 * This lives outside `actions/guild.ts` because that file is `"use server"`,
 * where every export must be an action; the admin actions need the same helper.
 */

/** A promoted heir, or null when the guild already had a leader (or is empty). */
export interface Succession {
  id: string;
  empireId: string;
}

/**
 * Promote the longest-serving deputy — or failing that the longest-serving
 * member — whenever the crown is vacant.
 *
 * The first count runs unlocked so the ordinary case (a guild that has its
 * leader) costs one index probe and nothing else. Only a vacant crown pays for
 * the row lock, which is what makes two survivors acting at once agree on a
 * single heir instead of crowning one each.
 */
export async function ensureGuildLeader(
  tx: Prisma.TransactionClient,
  guildId: string
): Promise<Succession | null> {
  const seated = await tx.guildMember.count({
    where: { guildId, role: "LEADER" },
  });
  if (seated > 0) return null;

  await tx.$queryRaw`SELECT id FROM "Guild" WHERE id = ${guildId} FOR UPDATE`;
  // Re-check under the lock: this transaction may have been queued behind the
  // one that just crowned someone.
  const leaders = await tx.guildMember.count({
    where: { guildId, role: "LEADER" },
  });
  if (leaders > 0) return null;

  // GuildRole is declared LEADER, DEPUTY, MEMBER, so ascending enum order is
  // rank order: deputies outrank plain members. Within a rank, seniority wins.
  const heir = await tx.guildMember.findFirst({
    where: { guildId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, empireId: true, role: true },
  });
  if (!heir) return null;

  // Guarded on the role we read, so a concurrent transfer or kick cannot be
  // clobbered by this promotion.
  const promoted = await tx.guildMember.updateMany({
    where: { id: heir.id, role: heir.role },
    data: { role: "LEADER" },
  });
  if (promoted.count === 0) return null;
  return { id: heir.id, empireId: heir.empireId };
}

/** Tell the accidental heir they are now in charge. */
export async function announceSuccession(
  tx: Prisma.TransactionClient,
  empireId: string,
  guildName: string
) {
  await tx.message.create({
    data: {
      empireId,
      kind: "SYSTEM",
      // i18n-exempt-start: a stored Message row. `getT()` here would resolve
      // whoever happened to trigger the repair — usually somebody else entirely —
      // so it stays in the source language until Message carries its own
      // template. See the note in `attackEmpire`.
      title: "👑 מונית למנהיג הברית",
      body: `הברית "${guildName}" נותרה ללא מנהיג ואתה הוותיק ביותר בה — ההנהגה עברה אליך.`,
      // i18n-exempt-end
      href: "/game/guild",
    },
  });
}

/**
 * Repair one guild's leadership in its own transaction, announcing the heir.
 * For callers outside a transaction — chiefly the admin actions, which edit
 * memberships one statement at a time.
 *
 * `guildId` may be null (nothing to repair) so callers can pass a lookup result
 * straight through.
 */
export async function repairGuildLeadership(guildId: string | null | undefined) {
  if (!guildId) return;
  await prisma.$transaction(async (tx) => {
    const guild = await tx.guild.findUnique({
      where: { id: guildId },
      select: { name: true },
    });
    if (!guild) return;
    const heir = await ensureGuildLeader(tx, guildId);
    if (heir) await announceSuccession(tx, heir.empireId, guild.name);
  });
}
