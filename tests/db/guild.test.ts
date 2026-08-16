import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ensureGuildLeader, repairGuildLeadership } from "@/server/guildLeadership";
import { applyGuildCityRule, guildCityTier } from "@/server/guildCity";
import { sharedGuild } from "@/lib/game/guildAllies";

/**
 * The two guild invariants that have no other place to be tested.
 *
 * Both are database-shaped. Succession is a read-decide-write under a row lock,
 * so an in-memory fake would be testing the fake — the whole question is whether
 * two survivors acting at once crown one leader or two. And the invitation gate
 * is a `deleteMany` whose WHERE clause *is* the authorisation check: the test
 * that matters is that a doubled claim burns one row, which only Postgres can
 * answer.
 */

const prisma = new PrismaClient();
const TAG = `gd${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.guild.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeEmpire(name: string, cities = 1) {
  const user = await prisma.user.create({
    data: {
      email: `${name}@${TAG}.test`,
      name,
      passwordHash: "x",
      emailVerified: new Date(),
    },
  });
  return prisma.empire.create({
    data: {
      userId: user.id,
      name: `${TAG}-${name}`,
      gold: 0,
      turns: 100,
      citizens: 0,
      cities,
    },
  });
}

/** A guild with the given roles, seated oldest-first in argument order. */
async function makeGuild(
  label: string,
  roles: ("LEADER" | "DEPUTY" | "MEMBER")[]
) {
  const guild = await prisma.guild.create({
    data: { name: `${TAG}-${label}`, capacityLevel: 9 },
  });
  const empires = [];
  for (const [i, role] of roles.entries()) {
    const empire = await makeEmpire(`${label}${i}`);
    await prisma.guildMember.create({
      data: { guildId: guild.id, empireId: empire.id, role },
    });
    empires.push(empire);
  }
  return { guild, empires };
}

const rolesIn = (guildId: string) =>
  prisma.guildMember.findMany({
    where: { guildId },
    select: { empireId: true, role: true },
    orderBy: { createdAt: "asc" },
  });

describe("guild succession", () => {
  it("crowns the longest-serving deputy when the crown is vacant", async () => {
    // The state the live database was actually found in: a guild whose only
    // members were a deputy and a plain member, which no player could govern —
    // setGuildRole and transferGuildLeadership both demand a LEADER.
    const { guild, empires } = await makeGuild("vacant", ["DEPUTY", "MEMBER"]);

    await repairGuildLeadership(guild.id);

    const roles = await rolesIn(guild.id);
    expect(roles.map((r) => r.role)).toEqual(["LEADER", "MEMBER"]);
    expect(roles[0]!.empireId).toBe(empires[0]!.id);
  });

  it("falls back to the longest-serving plain member when there is no deputy", async () => {
    const { guild, empires } = await makeGuild("plain", ["MEMBER", "MEMBER"]);

    await repairGuildLeadership(guild.id);

    const roles = await rolesIn(guild.id);
    expect(roles.map((r) => r.role)).toEqual(["LEADER", "MEMBER"]);
    expect(roles[0]!.empireId).toBe(empires[0]!.id);
  });

  it("prefers a junior deputy over a senior plain member", async () => {
    // Rank first, seniority only as the tiebreak — a deputy was already trusted
    // with the roster, however recently.
    const { guild, empires } = await makeGuild("rank", ["MEMBER", "DEPUTY"]);

    await repairGuildLeadership(guild.id);

    const roles = await rolesIn(guild.id);
    const crowned = roles.find((r) => r.role === "LEADER");
    expect(crowned!.empireId).toBe(empires[1]!.id);
  });

  it("leaves a seated leader alone", async () => {
    const { guild, empires } = await makeGuild("seated", ["LEADER", "DEPUTY"]);

    await repairGuildLeadership(guild.id);

    const roles = await rolesIn(guild.id);
    expect(roles.map((r) => r.role)).toEqual(["LEADER", "DEPUTY"]);
    expect(roles[0]!.empireId).toBe(empires[0]!.id);
  });

  it("crowns exactly one leader when survivors act concurrently", async () => {
    // The reason ensureGuildLeader takes the guild row lock: without it, two
    // members loading the guild screen at the same moment each read "no leader"
    // and each promote their own candidate, leaving two leaders who can kick
    // one another.
    const { guild } = await makeGuild("race", ["DEPUTY", "DEPUTY", "MEMBER"]);

    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) => ensureGuildLeader(tx, guild.id))
      )
    );

    const roles = await rolesIn(guild.id);
    expect(roles.filter((r) => r.role === "LEADER")).toHaveLength(1);
  });

  it("does nothing to a guild with no members left", async () => {
    const guild = await prisma.guild.create({
      data: { name: `${TAG}-empty`, capacityLevel: 1 },
    });
    await expect(repairGuildLeadership(guild.id)).resolves.toBeUndefined();
    expect(await rolesIn(guild.id)).toHaveLength(0);
  });
});

describe("guild invitations", () => {
  it("can be claimed exactly once under a doubled click", async () => {
    // joinGuild consumes the invitation with the expiry in the WHERE clause, so
    // the check and the burn are one statement. Two parallel claims must not
    // both succeed — that is what turns "invitation-only" into a real gate
    // rather than a hint the join path ignores.
    const { guild } = await makeGuild("invite", ["LEADER"]);
    const newcomer = await makeEmpire("newcomer");
    await prisma.guildInvite.create({
      data: {
        guildId: guild.id,
        empireId: newcomer.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.guildInvite.deleteMany({
          where: {
            guildId: guild.id,
            empireId: newcomer.id,
            expiresAt: { gt: new Date() },
          },
        })
      )
    );

    expect(claims.reduce((n, c) => n + c.count, 0)).toBe(1);
  });

  it("is not claimable once it has lapsed", async () => {
    const { guild } = await makeGuild("lapsed", ["LEADER"]);
    const latecomer = await makeEmpire("latecomer");
    await prisma.guildInvite.create({
      data: {
        guildId: guild.id,
        empireId: latecomer.id,
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const claimed = await prisma.guildInvite.deleteMany({
      where: {
        guildId: guild.id,
        empireId: latecomer.id,
        expiresAt: { gt: new Date() },
      },
    });

    expect(claimed.count).toBe(0);
  });

  it("holds one standing invitation per guild per player", async () => {
    // Re-inviting refreshes the clock rather than failing on the unique — a
    // recruiter chasing a quiet player should not have to wait one out.
    const { guild } = await makeGuild("resend", ["LEADER"]);
    const target = await makeEmpire("target");
    const first = new Date(Date.now() + 60_000);
    const second = new Date(Date.now() + 120_000);

    for (const expiresAt of [first, second]) {
      await prisma.guildInvite.upsert({
        where: { guildId_empireId: { guildId: guild.id, empireId: target.id } },
        create: { guildId: guild.id, empireId: target.id, expiresAt },
        update: { expiresAt },
      });
    }

    const invites = await prisma.guildInvite.findMany({
      where: { empireId: target.id },
    });
    expect(invites).toHaveLength(1);
    expect(invites[0]!.expiresAt.getTime()).toBe(second.getTime());
  });
});

describe("guildmates", () => {
  it("are recognised as allies in both directions", async () => {
    const { guild, empires } = await makeGuild("allies", ["LEADER", "MEMBER"]);
    const [a, b] = empires;

    await expect(sharedGuild(a!.id, b!.id, prisma)).resolves.toMatchObject({
      id: guild.id,
    });
    await expect(sharedGuild(b!.id, a!.id, prisma)).resolves.toMatchObject({
      id: guild.id,
    });
  });

  it("are not allies across two guilds, or when one is guildless", async () => {
    const { empires: red } = await makeGuild("red", ["LEADER"]);
    const { empires: blue } = await makeGuild("blue", ["LEADER"]);
    const loner = await makeEmpire("loner");

    expect(await sharedGuild(red[0]!.id, blue[0]!.id, prisma)).toBeNull();
    expect(await sharedGuild(red[0]!.id, loner.id, prisma)).toBeNull();
    // An empire is never its own ally — the self-attack guard owns that case.
    expect(await sharedGuild(red[0]!.id, red[0]!.id, prisma)).toBeNull();
  });

  it("stop being allies the moment one leaves", async () => {
    const { empires } = await makeGuild("parting", ["LEADER", "MEMBER"]);
    const [leader, quitter] = empires;

    await prisma.guildMember.delete({ where: { empireId: quitter!.id } });

    expect(await sharedGuild(leader!.id, quitter!.id, prisma)).toBeNull();
  });
});

/**
 * The same-city rule (src/server/guildCity.ts). Database-shaped for the same
 * reason succession is: the decision is a read of the roster followed by a
 * delete of it, taken under a row lock, and the interesting cases are the ones
 * where the row being read is the row about to go.
 */
describe("one guild, one city", () => {
  /** Move an empire between tiers exactly the way the game does, rule included. */
  const moveTo = (empireId: string, cities: number) =>
    prisma.$transaction(async (tx) => {
      const before = await tx.empire.findUniqueOrThrow({
        where: { id: empireId },
        select: { cities: true },
      });
      await tx.empire.update({ where: { id: empireId }, data: { cities } });
      return applyGuildCityRule(tx, empireId, before.cities);
    });

  it("reads the guild's city off its leader", async () => {
    const { guild, empires } = await makeGuild("tier", ["LEADER", "MEMBER"]);
    await prisma.empire.update({
      where: { id: empires[0]!.id },
      data: { cities: 4 },
    });

    expect(await guildCityTier(prisma, guild.id)).toBe(4);
  });

  it("drops a plain member who leaves the guild's city", async () => {
    const { guild, empires } = await makeGuild("stray", ["LEADER", "MEMBER"]);
    const [leader, mover] = empires;

    const outcome = await moveTo(mover!.id, 2);

    expect(outcome).toMatchObject({ kind: "left", guildCity: 1 });
    const left = await prisma.guildMember.findMany({ where: { guildId: guild.id } });
    expect(left.map((m) => m.empireId)).toEqual([leader!.id]);
    // Told why, in the inbox — the admin editor moves players who are not here
    // to read a toast.
    const notice = await prisma.message.findFirst({
      where: { empireId: mover!.id, title: "🏰 עזבת את הברית" },
    });
    expect(notice).not.toBeNull();
  });

  it("leaves a member who moves *into* the guild's city alone", async () => {
    // The rule compares tiers; it does not fire on movement as such. A roster
    // repaired by the mover is a roster that keeps him.
    const { guild, empires } = await makeGuild("rejoin", ["LEADER", "MEMBER"]);
    await prisma.empire.update({
      where: { id: empires[0]!.id },
      data: { cities: 3 },
    });

    expect(await moveTo(empires[1]!.id, 3)).toBeNull();
    expect(await prisma.guildMember.count({ where: { guildId: guild.id } })).toBe(2);
  });

  it("disbands the guild when the leader moves", async () => {
    const { guild, empires } = await makeGuild("crown", ["LEADER", "DEPUTY", "MEMBER"]);
    const [leader, deputy, member] = empires;

    const outcome = await moveTo(leader!.id, 2);

    expect(outcome).toMatchObject({ kind: "disbanded" });
    expect(await prisma.guild.findUnique({ where: { id: guild.id } })).toBeNull();
    expect(await prisma.guildMember.count({ where: { guildId: guild.id } })).toBe(0);
    // Everyone left behind is told; the mover already has the toast.
    for (const left of [deputy, member]) {
      const notice = await prisma.message.findFirst({
        where: { empireId: left!.id, title: "🏰 הברית פורקה" },
      });
      expect(notice).not.toBeNull();
    }
  });

  it("does nothing when the tier did not actually move", async () => {
    // The admin vitals panel posts `cities` on every save. A leader whose gold
    // is topped up must not lose his guild to it.
    const { guild, empires } = await makeGuild("still", ["LEADER", "MEMBER"]);

    expect(await moveTo(empires[0]!.id, 1)).toBeNull();
    expect(await prisma.guild.findUnique({ where: { id: guild.id } })).not.toBeNull();
  });

  it("keeps a one-man guild — it moves with its owner", async () => {
    const { guild, empires } = await makeGuild("solo", ["LEADER"]);

    expect(await moveTo(empires[0]!.id, 5)).toBeNull();
    expect(await prisma.guild.findUnique({ where: { id: guild.id } })).not.toBeNull();
    expect(await guildCityTier(prisma, guild.id)).toBe(5);
  });

  it("crowns the heir before deciding, so a headless guild is not decided by a stray", async () => {
    // No LEADER row: the deputy is about to be crowned, which makes *him* the
    // guild's city — and the plain member the one who has to leave.
    const { guild, empires } = await makeGuild("headless", ["DEPUTY", "MEMBER"]);
    const [deputy, member] = empires;

    const outcome = await moveTo(member!.id, 2);

    expect(outcome).toMatchObject({ kind: "left" });
    const roles = await rolesIn(guild.id);
    expect(roles).toEqual([{ empireId: deputy!.id, role: "LEADER" }]);
  });

  it("takes the guild down with a rolled-back city change, or not at all", async () => {
    const { guild, empires } = await makeGuild("atomic", ["LEADER", "MEMBER"]);

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.empire.update({
          where: { id: empires[0]!.id },
          data: { cities: 2 },
        });
        await applyGuildCityRule(tx, empires[0]!.id, 1);
        throw new Error("rolled back");
      })
    ).rejects.toThrow("rolled back");

    expect(await prisma.guild.findUnique({ where: { id: guild.id } })).not.toBeNull();
    expect(await prisma.empire.findUnique({
      where: { id: empires[0]!.id },
      select: { cities: true },
    })).toMatchObject({ cities: 1 });
  });
});
