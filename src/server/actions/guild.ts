"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { GuildRole, GuildSpellType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import {
  GUILD_AID_MAX_LEVEL,
  GUILD_CAPACITY_MAX_LEVEL,
  GUILD_CREATION_COST_DIAMONDS,
  GUILD_DONATION_MIN,
  GUILD_INVITE_TTL_HOURS,
  GUILD_INVITE_TTL_MS,
  GUILD_NAME_MAX_LENGTH,
  GUILD_NAME_MIN_LENGTH,
  GUILD_SPELL_META,
  aidUpgradeCostGold,
  capacityUpgradeCostGold,
  guildAidPct,
  guildCapacity,
  guildSpellBonusPct,
  guildSpellBuffMs,
  guildSpellMaxLevel,
  spellCastCostDiamonds,
  spellUpgradeCostDiamonds,
} from "@/lib/game/guild";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT, type T } from "@/i18n/server";
import {
  announceSuccession,
  ensureGuildLeader,
} from "@/server/guildLeadership";

async function requireOwnEmpireId(): Promise<string> {
  // Enforces the ban on every action (not just page loads); see getActiveEmpireId.
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the action shells catch it and
  // return the translated "something went wrong" instead.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

function revalidateGuild() {
  revalidatePath("/game", "layout");
}

/**
 * Spend diamonds inside a transaction. The guarded update means concurrent
 * purchases can never drive the balance negative; returns false when the
 * empire lacks enough diamonds.
 */
async function spendDiamonds(
  tx: Prisma.TransactionClient,
  empireId: string,
  cost: number
): Promise<boolean> {
  const updated = await tx.empire.updateMany({
    where: { id: empireId, diamonds: { gte: cost } },
    data: { diamonds: { decrement: cost } },
  });
  return updated.count > 0;
}

/**
 * Spend the member's own available gold. The guarded update means concurrent
 * spends can never drive the balance negative; returns false when the empire
 * lacks enough gold.
 *
 * Only donations use this now. The guild's own ladders are bought from the
 * treasury — see `spendTreasury`.
 */
async function spendOwnGold(
  tx: Prisma.TransactionClient,
  empireId: string,
  cost: number
): Promise<boolean> {
  const updated = await tx.empire.updateMany({
    where: { id: empireId, gold: { gte: cost } },
    data: { gold: { decrement: cost } },
  });
  return updated.count > 0;
}

/**
 * Spend from the guild's treasury. Same guarded shape as every other debit in
 * this codebase — a concurrent purchase can never overdraw the till, and the
 * caller decides what to do when it returns false.
 */
async function spendTreasury(
  tx: Prisma.TransactionClient,
  guildId: string,
  cost: number
): Promise<boolean> {
  const updated = await tx.guild.updateMany({
    where: { id: guildId, treasury: { gte: cost } },
    data: { treasury: { decrement: cost } },
  });
  return updated.count > 0;
}

type MembershipWithGuild = Prisma.GuildMemberGetPayload<{
  include: { guild: true };
}>;

/**
 * Shared shell for actions that require an existing guild membership:
 * applies pending updates and loads the caller's membership + guild inside
 * one transaction so validation and the mutation are atomic.
 */
async function runMemberAction(
  perform: (
    membership: MembershipWithGuild,
    tx: Prisma.TransactionClient,
    empireId: string,
    /** The reader's translator, resolved once for the whole action. */
    t: T
  ) => Promise<ActionState>
): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await applyPendingUpdates(empireId, tx);
      const membership = await tx.guildMember.findUnique({
        where: { empireId },
        include: { guild: true },
      });
      if (!membership) return { error: t("אינך חבר בברית.") };

      // Seat a leader before the action runs, so a guild left headless can
      // still be governed — every role gate below reads the repaired roster.
      const heir = await ensureGuildLeader(tx, membership.guildId);
      if (heir) {
        await announceSuccession(tx, heir.empireId, membership.guild.name);
        // The caller may be the heir; act on the role they now hold.
        if (heir.id === membership.id) membership.role = "LEADER";
      }

      return perform(membership, tx, empireId, t);
    });

    revalidateGuild();
    return result;
  } catch (err) {
    await logError("guild.unknown", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ create / join / leave ------------------------------ */

const guildNameSchema = z
  .string()
  .trim()
  // The two messages below are surfaced verbatim (see createGuild), so they are
  // keyed through the dictionary at the point they are read rather than here —
  // a zod schema is built once at module load, with no request to read a
  // language from.
  .min(GUILD_NAME_MIN_LENGTH, "שם הברית קצר מדי")
  .max(GUILD_NAME_MAX_LENGTH, "שם הברית ארוך מדי");

export async function createGuild(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = guildNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    return { error: issue ? t(issue) : t("שם ברית לא תקין") };
  }
  const name = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const empire = await applyPendingUpdates(empireId, tx);

      const existingMembership = await tx.guildMember.findUnique({
        where: { empireId },
      });
      if (existingMembership) return { error: t("אתה כבר חבר בברית.") };

      const nameTaken = await tx.guild.findUnique({ where: { name } });
      if (nameTaken) return { error: t("שם הברית כבר תפוס — בחר שם אחר.") };

      const tooPoor = {
        error: t("הקמת ברית עולה {cost} יהלומים — אין לך מספיק.", {
          cost: GUILD_CREATION_COST_DIAMONDS,
        }),
      };
      if (empire.diamonds < GUILD_CREATION_COST_DIAMONDS) return tooPoor;
      if (!(await spendDiamonds(tx, empireId, GUILD_CREATION_COST_DIAMONDS))) {
        return tooPoor;
      }

      // Founder becomes the leader; every spell opens at level 1 (=1%).
      await tx.guild.create({
        data: {
          name,
          members: { create: { empireId, role: "LEADER" } },
          spells: {
            createMany: {
              data: (
                Object.keys(GUILD_SPELL_META) as GuildSpellType[]
              ).map((type) => ({ type })),
            },
          },
        },
      });

      return { success: t('הברית "{guild}" הוקמה — אתה המנהיג!', { guild: name }) };
    });

    revalidateGuild();
    return result;
  } catch (err) {
    await logError("guild.createGuild", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

const guildIdSchema = z.object({ guildId: z.string().min(1) });

/**
 * Accept a standing invitation and take a seat.
 *
 * Invitation-only, and the invitation is the *authorisation*, not a hint: the
 * row in GuildInvite is looked up here and consumed on the way in. Before that,
 * this action asked only for a guild id — which every guildless player was
 * handed for every guild in the game by the browse table on /game/guild — so
 * "joining" was open enrolment and `addGuildMember`'s invitation was a courtesy
 * message with no bearing on anything. A guild could not keep anyone out.
 */
export async function joinGuild(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = guildIdSchema.safeParse({ guildId: formData.get("guildId") });
  if (!parsed.success) return { error: t("ברית לא תקינה") };
  const { guildId } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await applyPendingUpdates(empireId, tx);

      const existingMembership = await tx.guildMember.findUnique({
        where: { empireId },
      });
      if (existingMembership) return { error: t("אתה כבר חבר בברית.") };

      // Lock the guild row so concurrent joins serialize. Under READ COMMITTED
      // two joins into the last seat each insert their own row and neither sees
      // the other's uncommitted insert, so both counts stay within capacity and
      // both commit — overfilling the guild. The FOR UPDATE lock makes the
      // second join wait until the first commits, so its re-count below sees the
      // new member.
      await tx.$queryRaw`SELECT id FROM "Guild" WHERE id = ${guildId} FOR UPDATE`;

      const guild = await tx.guild.findUnique({ where: { id: guildId } });
      if (!guild) return { error: t("הברית לא נמצאה.") };

      // Consume the invitation. deleteMany with the expiry in the WHERE makes
      // the check and the burn one statement, so a doubled click cannot spend
      // one invitation twice; count === 0 means never invited, or lapsed.
      const claimed = await tx.guildInvite.deleteMany({
        where: { guildId, empireId, expiresAt: { gt: new Date() } },
      });
      if (claimed.count === 0) {
        return {
          error: t(
            'הצטרפות ל"{guild}" אפשרית רק בהזמנה — בקש ממנהיג הברית או מסגן להזמין אותך.',
            { guild: guild.name }
          ),
        };
      }

      await tx.guildMember.create({ data: { guildId, empireId } });

      // Re-count after inserting — throwing rolls the join back if a
      // concurrent join filled the last seat.
      const memberCount = await tx.guildMember.count({ where: { guildId } });
      if (memberCount > guildCapacity(guild.capacityLevel)) {
        throw new Error("guild full");
      }

      // Every other guild's invitation is moot now that they have a guild;
      // they would only misfire on the day this player leaves.
      await tx.guildInvite.deleteMany({ where: { empireId } });

      return { success: t('הצטרפת לברית "{guild}"!', { guild: guild.name }) };
    });

    revalidateGuild();
    return result;
  } catch {
    return { error: t("הברית מלאה או שאירעה שגיאה — נסה שוב.") };
  }
}

/** Turn an invitation down — removes it from the join list for good. */
export async function declineGuildInvite(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = guildIdSchema.safeParse({ guildId: formData.get("guildId") });
  if (!parsed.success) return { error: t("ברית לא תקינה") };
  const { guildId } = parsed.data;

  try {
    const empireId = await requireOwnEmpireId();
    await prisma.guildInvite.deleteMany({ where: { guildId, empireId } });
    revalidateGuild();
    return { success: t("ההזמנה נדחתה.") };
  } catch (err) {
    await logError("guild.declineGuildInvite", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

export async function leaveGuild(): Promise<ActionState> {
  return runMemberAction(async (membership, tx, empireId, t) => {
    const { guild } = membership;

    // Lock the guild row before counting. GuildMember cascades on guild
    // delete, so a join that commits between an unlocked count and the delete
    // is silently destroyed — the newcomer pays nothing but loses the guild
    // they just joined, with no message. joinGuild/addGuildMember already take
    // this lock, so taking it here is what actually makes them serialize.
    await tx.$queryRaw`SELECT id FROM "Guild" WHERE id = ${guild.id} FOR UPDATE`;
    const memberCount = await tx.guildMember.count({
      where: { guildId: guild.id },
    });

    // The last member out disbands the guild, whatever rank they hold. This
    // used to be the leader's privilege alone, so a guild whose crown had been
    // vacated from outside outlived its last member: an empty row nobody could
    // reach, still listed in the recruitment browser and still holding its name
    // against every future founder.
    if (memberCount <= 1) {
      await tx.guild.delete({ where: { id: guild.id } });
      return { success: t('הברית "{guild}" פורקה.', { guild: guild.name }) };
    }

    await tx.guildMember.delete({ where: { empireId } });

    // A leader walking out crowns their successor on the way rather than being
    // told to transfer first — the guild is never left headless.
    if (membership.role === "LEADER") {
      const heir = await ensureGuildLeader(tx, guild.id);
      if (heir) await announceSuccession(tx, heir.empireId, guild.name);
    }

    return { success: t('עזבת את הברית "{guild}".', { guild: guild.name }) };
  });
}

/* ------------------------------ roster: add / kick / roles ------------------------------ */

const addMemberSchema = z.object({
  // Surfaced verbatim by addGuildMember, which translates it there — a schema
  // is built at module load, with no request to read a language from.
  name: z.string().trim().min(1, "הזן שם אימפריה").max(60),
});

/**
 * Leadership recruitment: a leader or deputy **invites** a guildless player by
 * empire name. The invitation lands in their inbox and they join themselves.
 *
 * This used to write the GuildMember row directly — conscription, no consent
 * asked. That was not merely rude: `getGuildAidBonus` reinforces every member in
 * battle with a flat percentage of the guild's *combined* military power, so
 * press-ganging the strongest guildless empires in the city was a straight power
 * multiplier for the whole guild, applied without the conscripts ever opening
 * the game. They could leave, but only after noticing, and the aid was live from
 * the moment the row existed.
 *
 * The invitation is now a GuildInvite row, not just the message: `joinGuild`
 * consumes it, so this is the only door into the guild. Capacity is checked at
 * join time (under the guild lock) rather than reserved here — an invitation is
 * permission to try for a seat, not a seat held open.
 */
export async function addGuildMember(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = addMemberSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    return { error: issue ? t(issue) : t("שם לא תקין") };
  }
  const { name } = parsed.data;

  return runMemberAction(async (membership, tx, empireId, t) => {
    if (membership.role === "MEMBER") {
      return { error: t("רק מנהיג או סגן יכולים לצרף שחקנים לברית.") };
    }

    // Case-insensitive so leaders don't have to match capitalization exactly;
    // empire names are unique, so at most one row can match.
    const target = await tx.empire.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true, guildMembership: { select: { id: true } } },
    });
    if (!target) return { error: t('לא נמצאה אימפריה בשם "{name}".', { name }) };
    if (target.id === empireId) return { error: t("אתה כבר חבר בברית.") };
    if (target.guildMembership) {
      return { error: t("{name} כבר חבר בברית אחרת.", { name: target.name }) };
    }

    const guild = await tx.guild.findUniqueOrThrow({
      where: { id: membership.guildId },
      select: { name: true, capacityLevel: true },
    });
    // Reported as a courtesy so a leader isn't inviting into a guild that has no
    // seat left; the binding check is still the one inside joinGuild, under its
    // row lock.
    const memberCount = await tx.guildMember.count({
      where: { guildId: membership.guildId },
    });
    if (memberCount >= guildCapacity(guild.capacityLevel)) {
      return { error: t("הברית מלאה — הרחב את הקיבולת קודם.") };
    }

    // Upsert so re-inviting refreshes the clock instead of failing on the
    // [guildId, empireId] unique — a recruiter chasing a quiet player should
    // not have to wait out the old invitation.
    const expiresAt = new Date(Date.now() + GUILD_INVITE_TTL_MS);
    await tx.guildInvite.upsert({
      where: { guildId_empireId: { guildId: membership.guildId, empireId: target.id } },
      create: {
        guildId: membership.guildId,
        empireId: target.id,
        invitedById: empireId,
        expiresAt,
      },
      update: { invitedById: empireId, expiresAt },
    });

    await tx.message.create({
      data: {
        empireId: target.id,
        kind: "SYSTEM",
        title: "🏰 הוזמנת לברית",
        body: `${membership.guild.name} מזמינה אותך להצטרף. פתח את מסך הברית כדי לאשר — ההזמנה תקפה ל־${GUILD_INVITE_TTL_HOURS} שעות.`,
        href: "/game/guild",
      },
    });

    return {
      success: t("נשלחה הזמנה ל{name} (תקפה {hours} שעות).", {
        name: target.name,
        hours: GUILD_INVITE_TTL_HOURS,
      }),
    };
  });
}

const targetMemberSchema = z.object({ targetEmpireId: z.string().min(1) });

async function loadTargetMember(
  tx: Prisma.TransactionClient,
  guildId: string,
  targetEmpireId: string
) {
  return tx.guildMember.findFirst({
    where: { guildId, empireId: targetEmpireId },
    include: { empire: { select: { name: true } } },
  });
}

export async function kickGuildMember(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = targetMemberSchema.safeParse({
    targetEmpireId: formData.get("targetEmpireId"),
  });
  const t = await getT();
  if (!parsed.success) return { error: t("חבר לא תקין") };
  const { targetEmpireId } = parsed.data;

  return runMemberAction(async (membership, tx, _empireId, t) => {
    if (targetEmpireId === membership.empireId) {
      return { error: t("לא ניתן להרחיק את עצמך — השתמש בעזיבת הברית.") };
    }
    const target = await loadTargetMember(tx, membership.guildId, targetEmpireId);
    if (!target) return { error: t("החבר לא נמצא בברית.") };

    // Leaders kick anyone; deputies kick plain members only.
    const mayKick =
      membership.role === "LEADER" ||
      (membership.role === "DEPUTY" && target.role === "MEMBER");
    if (!mayKick) return { error: t("אין לך הרשאה להרחיק את החבר הזה.") };

    await tx.guildMember.delete({ where: { id: target.id } });
    await tx.message.create({
      data: {
        empireId: targetEmpireId,
        kind: "SYSTEM",
        title: "🏰 הורחקת מהברית",
        body: `הורחקת מהברית "${membership.guild.name}".`,
        href: "/game/guild",
      },
    });

    return { success: t("{name} הורחק מהברית.", { name: target.empire.name }) };
  });
}

const setRoleSchema = z.object({
  targetEmpireId: z.string().min(1),
  role: z.enum(["DEPUTY", "MEMBER"]),
});

export async function setGuildRole(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = setRoleSchema.safeParse({
    targetEmpireId: formData.get("targetEmpireId"),
    role: formData.get("role"),
  });
  const t = await getT();
  if (!parsed.success) return { error: t("בקשה לא תקינה") };
  const { targetEmpireId, role } = parsed.data;

  return runMemberAction(async (membership, tx, _empireId, t) => {
    if (membership.role !== "LEADER") {
      return { error: t("רק המנהיג יכול לשנות תפקידים.") };
    }
    if (targetEmpireId === membership.empireId) {
      return { error: t("לא ניתן לשנות את התפקיד של עצמך.") };
    }
    const target = await loadTargetMember(tx, membership.guildId, targetEmpireId);
    if (!target) return { error: t("החבר לא נמצא בברית.") };

    await tx.guildMember.update({
      where: { id: target.id },
      data: { role: role as GuildRole },
    });

    return {
      success:
        role === "DEPUTY"
          ? t("{name} מונה לסגן.", { name: target.empire.name })
          : t("{name} הורד לחבר מן השורה.", { name: target.empire.name }),
    };
  });
}

export async function transferGuildLeadership(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = targetMemberSchema.safeParse({
    targetEmpireId: formData.get("targetEmpireId"),
  });
  const t = await getT();
  if (!parsed.success) return { error: t("חבר לא תקין") };
  const { targetEmpireId } = parsed.data;

  return runMemberAction(async (membership, tx, _empireId, t) => {
    if (membership.role !== "LEADER") {
      return { error: t("רק המנהיג יכול להעביר את ההנהגה.") };
    }
    if (targetEmpireId === membership.empireId) {
      return { error: t("אתה כבר מנהיג הברית.") };
    }
    const target = await loadTargetMember(tx, membership.guildId, targetEmpireId);
    if (!target) return { error: t("החבר לא נמצא בברית.") };

    // Step down first, guarded on still holding the crown. Two concurrent
    // transfers by the same leader (to different members) both read role=LEADER
    // from their own snapshot, both demoted the leader, and each promoted its
    // own target — leaving the guild with two LEADERs, either of whom could then
    // kick the other. The guard means only one transfer can consume the office.
    const steppedDown = await tx.guildMember.updateMany({
      where: { id: membership.id, role: "LEADER" },
      data: { role: "DEPUTY" },
    });
    if (steppedDown.count === 0) {
      return { error: t("רק המנהיג יכול להעביר את ההנהגה.") };
    }
    // Guarded on the role we read, so the promotion cannot clobber a concurrent
    // kick/role change of the target; throwing rolls the step-down back.
    const promoted = await tx.guildMember.updateMany({
      where: { id: target.id, role: target.role },
      data: { role: "LEADER" },
    });
    if (promoted.count === 0) throw new Error("leadership transfer conflict");
    await tx.message.create({
      data: {
        empireId: targetEmpireId,
        kind: "SYSTEM",
        title: "👑 מונית למנהיג הברית",
        body: `קיבלת את הנהגת הברית "${membership.guild.name}".`,
        href: "/game/guild",
      },
    });

    return {
      success: t("{name} הוא מנהיג הברית החדש.", { name: target.empire.name }),
    };
  });
}

/* ------------------------------ guild shop ------------------------------ */

const spellTypeSchema = z.object({
  type: z.enum(["ATTACK", "DEFENSE", "RESOURCES"]),
});

export async function upgradeGuildSpell(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = spellTypeSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) return { error: t("קסם לא תקין") };
  const type = parsed.data.type as GuildSpellType;

  return runMemberAction(async (membership, tx, empireId, t) => {
    const spell = await tx.guildSpell.findUnique({
      where: { guildId_type: { guildId: membership.guildId, type } },
    });
    if (!spell) return { error: t("הקסם לא נמצא.") };
    // Every spell has its own ceiling — attack, defence and resources stop at
    // 10%, spying still runs to 30%.
    const maxLevel = guildSpellMaxLevel(type);
    if (spell.level >= maxLevel) {
      return { error: t("הקסם כבר ברמה המקסימלית ({max}%).", { max: maxLevel }) };
    }

    const cost = spellUpgradeCostDiamonds(spell.level);
    if (!(await spendDiamonds(tx, empireId, cost))) {
      return { error: t("השדרוג עולה {cost} יהלומים — אין לך מספיק.", { cost }) };
    }

    // Guarded on the current level so two concurrent upgrades can't both
    // pay for the same level; throwing rolls the diamonds back.
    const upgraded = await tx.guildSpell.updateMany({
      where: { id: spell.id, level: spell.level },
      data: { level: { increment: 1 } },
    });
    if (upgraded.count === 0) throw new Error("spell upgrade conflict");

    const meta = GUILD_SPELL_META[type];
    return {
      success: t("{spell} שודרג ל־{pct}% עבור כל הברית!", {
        spell: t(meta.label),
        pct: guildSpellBonusPct(type, spell.level + 1),
      }),
    };
  });
}

/* ------------------------------ the treasury ------------------------------ */

const donationSchema = z.object({
  amount: z.coerce.number().finite().int().min(GUILD_DONATION_MIN),
});

/**
 * Put gold into the guild's treasury.
 *
 * Open to every member, including the newest: donating is the one guild action
 * that cannot be abused by someone who joined an hour ago, and gating it would
 * defeat the point of having a shared till.
 *
 * There is deliberately **no withdrawal**. Gold that goes in belongs to the
 * guild, and a treasury a leader can empty into their own balance is a trap
 * laid for every member who trusts them — the leadership decides what it *buys*,
 * not who gets it back. That also removes any laundering angle, since gold can
 * only ever leave the till by turning into a guild upgrade.
 */
export async function donateToGuild(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = donationSchema.safeParse({ amount: formData.get("amount") });

  return runMemberAction(async (membership, tx, empireId, t) => {
    if (!parsed.success) {
      return {
        error: t("תרומה מינימלית היא {min} זהב.", {
          min: GUILD_DONATION_MIN.toLocaleString("en-US"),
        }),
      };
    }
    const { amount } = parsed.data;

    // Guarded debit first: the member's gold is the half that can fail, and a
    // treasury credited before the payment cleared would be minting gold.
    if (!(await spendOwnGold(tx, empireId, amount))) {
      return {
        error: t("אין לך {amount} זהב זמין לתרומה.", {
          amount: amount.toLocaleString("en-US"),
        }),
      };
    }

    // Two increments rather than absolute sets: donations from several members
    // land concurrently, and either column written absolutely would lose one of
    // them.
    await tx.guild.update({
      where: { id: membership.guildId },
      data: { treasury: { increment: amount } },
    });
    await tx.guildMember.update({
      where: { id: membership.id },
      data: { donated: { increment: amount } },
    });

    return {
      success: t("תרמת {amount} זהב לאוצר {guild}.", {
        amount: amount.toLocaleString("en-US"),
        guild: membership.guild.name,
      }),
    };
  });
}

export async function upgradeGuildCapacity(): Promise<ActionState> {
  return runMemberAction(async (membership, tx, empireId, t) => {
    const { guild } = membership;
    // Roster size is a leadership call, so only a leader or deputy may buy a
    // seat — and it is now bought with the guild's money rather than theirs.
    if (membership.role === "MEMBER") {
      return { error: t("רק מנהיג או סגן יכולים להרחיב את הברית.") };
    }
    if (guild.capacityLevel >= GUILD_CAPACITY_MAX_LEVEL) {
      return {
        error: t("הברית כבר בקיבולת המקסימלית ({max} חברים).", {
          max: guildCapacity(GUILD_CAPACITY_MAX_LEVEL),
        }),
      };
    }

    // Paid from the treasury with a guarded debit, so concurrent spends can
    // never overdraw; the level guard below then rolls it back if another
    // officer bought the same level first.
    const cost = capacityUpgradeCostGold(guild.capacityLevel);
    if (!(await spendTreasury(tx, guild.id, cost))) {
      return {
        error: t("ההרחבה עולה {cost} זהב מאוצר הברית — אין מספיק באוצר.", {
          cost: cost.toLocaleString("en-US"),
        }),
      };
    }

    const upgraded = await tx.guild.updateMany({
      where: { id: guild.id, capacityLevel: guild.capacityLevel },
      data: { capacityLevel: { increment: 1 } },
    });
    if (upgraded.count === 0) throw new Error("capacity upgrade conflict");

    return {
      success: t("הברית הורחבה ל־{max} חברים!", {
        max: guildCapacity(guild.capacityLevel + 1),
      }),
    };
  });
}

export async function upgradeGuildAid(): Promise<ActionState> {
  return runMemberAction(async (membership, tx, empireId, t) => {
    const { guild } = membership;
    // Now that there IS a treasury to drain, this needs the role gate the
    // capacity ladder always had: an upgrade paid from everyone's donations is
    // a leadership decision, and one member spending the guild's savings on a
    // ladder nobody agreed to is exactly what a shared till makes possible.
    if (membership.role === "MEMBER") {
      return { error: t("רק מנהיג או סגן יכולים לשדרג את עזרת הברית.") };
    }
    if (guild.aidLevel >= GUILD_AID_MAX_LEVEL) {
      return {
        error: t("עזרת הברית כבר ברמה המקסימלית ({max}%).", {
          max: GUILD_AID_MAX_LEVEL,
        }),
      };
    }

    const cost = aidUpgradeCostGold(guild.aidLevel);
    if (!(await spendTreasury(tx, guild.id, cost))) {
      return {
        error: t("השדרוג עולה {cost} זהב מאוצר הברית — אין מספיק באוצר.", {
          cost: cost.toLocaleString("en-US"),
        }),
      };
    }

    const upgraded = await tx.guild.updateMany({
      where: { id: guild.id, aidLevel: guild.aidLevel },
      data: { aidLevel: { increment: 1 } },
    });
    if (upgraded.count === 0) throw new Error("aid upgrade conflict");

    return {
      success: t("עזרת הברית שודרגה ל־{pct}% מהכוח הכולל של הברית!", {
        pct: guildAidPct(guild.aidLevel + 1),
      }),
    };
  });
}

export async function castGuildSpell(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = spellTypeSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) return { error: t("קסם לא תקין") };
  const type = parsed.data.type as GuildSpellType;

  return runMemberAction(async (membership, tx, empireId, t) => {
    const spell = await tx.guildSpell.findUnique({
      where: { guildId_type: { guildId: membership.guildId, type } },
    });
    if (!spell) return { error: t("הקסם לא נמצא.") };

    // Serialize this player's own casts before the "already active" check.
    // Read-check-write under READ COMMITTED let two taps on the button both see
    // no live buff, both spend the diamonds, and both insert a buff row —
    // charging twice for one window (getActiveGuildBuffPct takes the strongest
    // row, so the second cast bought literally nothing). Mirrors lockEmpire in
    // diamondShop.ts, which exists for exactly this class of double-charge.
    await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

    const now = new Date();
    const active = await tx.guildSpellBuff.findFirst({
      where: { empireId, type, expiresAt: { gt: now } },
    });
    if (active) return { error: t("הקסם הזה כבר פעיל עליך.") };

    const cost = spellCastCostDiamonds(type, spell.level);
    if (!(await spendDiamonds(tx, empireId, cost))) {
      return { error: t("הקסם עולה {cost} יהלומים — אין לך מספיק.", { cost }) };
    }

    // Expired rows of this type are dead weight — clean them as we cast.
    await tx.guildSpellBuff.deleteMany({
      where: { empireId, type, expiresAt: { lte: now } },
    });
    await tx.guildSpellBuff.create({
      data: {
        empireId,
        type,
        bonusPct: guildSpellBonusPct(type, spell.level),
        expiresAt: new Date(now.getTime() + guildSpellBuffMs(type)),
      },
    });

    const meta = GUILD_SPELL_META[type];
    return {
      success: t("{icon} {spell} הופעל — {effect}!", {
        icon: meta.icon,
        spell: t(meta.label),
        effect: meta.effectLabel(t, guildSpellBonusPct(type, spell.level)),
      }),
    };
  });
}
