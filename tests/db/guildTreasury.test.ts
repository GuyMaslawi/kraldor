import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  GUILD_AID_MAX_LEVEL,
  GUILD_DONATION_MIN,
  aidUpgradeCostGold,
  capacityUpgradeCostGold,
  guildCapacity,
} from "@/lib/game/guild";

/**
 * אוצר הברית — the shared till, against a real database.
 *
 * A treasury is the first place in this game where **one balance is spent by
 * several people who are not each other**. Everything else that debits is
 * scoped to one empire and serialised by that empire's own row lock; here two
 * officers on two devices can buy two different ladders from the same gold at
 * the same instant, and nothing about their sessions makes them wait for one
 * another.
 *
 * So the till is guarded the way every other spend in this codebase is — an
 * `updateMany` filtered on `treasury >= cost` — and the only question worth
 * asking is whether that guard holds when the spends genuinely overlap. It is
 * a question about Postgres, not about our TypeScript.
 *
 * The donation side has its own invariant and it is a social one: `donated` is
 * the number a guild argues about, so it must count *gold given*, not clicks.
 */

/**
 * Who the caller is, per call rather than per file.
 *
 * The usual `let currentEmpireId` in these suites is fine while one empire acts
 * at a time, and quietly wrong the moment two do. `Promise.all(xs.map(async
 * ...))` starts every closure synchronously up to its first `await`, so a
 * variable assigned inside them holds the *last* writer's value by the time any
 * of the actions gets around to reading it — six donations from three members
 * would all be charged to whoever was assigned last. An AsyncLocalStorage store
 * follows each call through its own await chain instead, which is the only way
 * a test about several members acting at once can be about several members.
 */
const caller = new AsyncLocalStorage<string>();
let currentEmpireId: string | null = null;

/** Act as this empire for the duration of one call. */
const as = <T>(empireId: string, run: () => Promise<T>) =>
  caller.run(empireId, run);

vi.mock("@/lib/auth", () => ({
  getActiveEmpireId: async () => caller.getStore() ?? currentEmpireId,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { donateToGuild, upgradeGuildAid, upgradeGuildCapacity } = await import(
  "@/server/actions/guild"
);

const prisma = new PrismaClient();
const TAG = `gt${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.guild.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeEmpire(label: string, gold: number) {
  const user = await prisma.user.create({
    data: {
      email: `${label}@${TAG}.test`,
      name: `${TAG}-${label}`,
      passwordHash: "x",
      emailVerified: new Date(),
    },
  });
  return prisma.empire.create({
    data: {
      userId: user.id,
      name: `${TAG}-${label}`,
      cities: 1,
      gold,
      turns: 0,
      citizens: 0,
      // No backlog: the guild actions settle the empire first, and a fixture
      // with hours of mine production waiting would move the gold under the
      // arithmetic below.
      lastRegularUpdateAt: new Date(),
      lastDailyUpdateAt: new Date(),
      army: { create: { soldiers: 0, spies: 0, mineSlaves: 0 } },
      hero: { create: { level: 1 } },
    },
  });
}

/** A guild whose roster is `roles`, with a treasury already standing. */
async function makeGuild(
  label: string,
  roles: ("LEADER" | "DEPUTY" | "MEMBER")[],
  treasury: number,
  memberGold = 0
) {
  const guild = await prisma.guild.create({
    data: { name: `${TAG}-${label}`, capacityLevel: 1, treasury },
  });
  const empires = [];
  for (const [i, role] of roles.entries()) {
    const empire = await makeEmpire(`${label}${i}`, memberGold);
    await prisma.guildMember.create({
      data: { guildId: guild.id, empireId: empire.id, role },
    });
    empires.push(empire);
  }
  return { guild, empires };
}

const tillOf = async (guildId: string) =>
  (
    await prisma.guild.findUniqueOrThrow({
      where: { id: guildId },
      select: { treasury: true },
    })
  ).treasury;

/** The three numbers a purchase can move. */
const guildLedgers = (guildId: string) =>
  prisma.guild.findUniqueOrThrow({
    where: { id: guildId },
    select: { treasury: true, aidLevel: true, capacityLevel: true },
  });

const goldOf = async (empireId: string) =>
  (
    await prisma.empire.findUniqueOrThrow({
      where: { id: empireId },
      select: { gold: true },
    })
  ).gold;

function donation(amount: number) {
  const form = new FormData();
  form.set("amount", String(amount));
  return form;
}

/* ------------------------------ paying in ------------------------------ */

describe("donating", () => {
  it("moves the gold exactly once per donation, from several members at once", async () => {
    const { guild, empires } = await makeGuild(
      "pool",
      ["LEADER", "MEMBER", "MEMBER"],
      0,
      GUILD_DONATION_MIN * 4
    );

    // Every member gives twice, and all six donations are in flight together.
    const results = await Promise.all(
      empires.flatMap((empire) =>
        [0, 1].map(() =>
          as(empire.id, () => donateToGuild({}, donation(GUILD_DONATION_MIN)))
        )
      )
    );
    expect(results.filter((r) => r.success).length).toBe(6);

    // Both columns are incremented rather than set, so nothing is lost when the
    // writes overlap: six donations in, six donations recorded.
    expect(await tillOf(guild.id)).toBe(GUILD_DONATION_MIN * 6);
    const roll = await prisma.guildMember.findMany({
      where: { guildId: guild.id },
      select: { empireId: true, donated: true },
    });
    expect(roll.every((m) => m.donated === GUILD_DONATION_MIN * 2)).toBe(true);

    for (const empire of empires) {
      expect(await goldOf(empire.id)).toBe(GUILD_DONATION_MIN * 2);
    }
  });

  it("never lets a member give gold they do not have", async () => {
    // Two donations of the whole balance, sent together. The debit is guarded on
    // the member's own gold, so exactly one may clear — a treasury credited
    // before the payment cleared would be minting gold out of a double-click.
    const { guild, empires } = await makeGuild(
      "overdraw",
      ["LEADER"],
      0,
      GUILD_DONATION_MIN
    );
    currentEmpireId = empires[0].id;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => donateToGuild({}, donation(GUILD_DONATION_MIN)))
    );
    expect(results.filter((r) => r.success).length).toBe(1);
    expect(await goldOf(empires[0].id)).toBe(0);
    expect(await tillOf(guild.id)).toBe(GUILD_DONATION_MIN);
  });

  it("refuses a donation below the floor", async () => {
    // Without a floor the contribution board measures clicking rather than
    // giving, and the number a guild reads as "who carried us" stops meaning
    // anything.
    const { guild, empires } = await makeGuild("dust", ["LEADER"], 0, 10_000);
    currentEmpireId = empires[0].id;

    expect((await donateToGuild({}, donation(1))).error).toBeTruthy();
    expect(await tillOf(guild.id)).toBe(0);
    expect(await goldOf(empires[0].id)).toBe(10_000);
  });
});

/* ------------------------------ paying out ------------------------------ */

describe("spending the till", () => {
  it("cannot be overdrawn by two officers buying at the same instant", async () => {
    // Enough for one ladder and not for two, with a leader and a deputy each
    // buying a different one. The guarded debit is the only thing standing
    // between this and a guild that bought both for the price of one.
    const aid = aidUpgradeCostGold(0);
    const seat = capacityUpgradeCostGold(1);
    const { guild, empires } = await makeGuild(
      "race",
      ["LEADER", "DEPUTY"],
      Math.max(aid, seat)
    );

    const [aidResult, seatResult] = await Promise.all([
      as(empires[0].id, () => upgradeGuildAid()),
      as(empires[1].id, () => upgradeGuildCapacity()),
    ]);

    const bought = [aidResult, seatResult].filter((r) => r.success).length;
    expect(bought).toBe(1);

    const row = await guildLedgers(guild.id);
    expect(row.treasury).toBeGreaterThanOrEqual(0);
    // Exactly one ladder moved, and the till paid for exactly that one.
    expect(row.aidLevel + (row.capacityLevel - 1)).toBe(1);
    expect(row.treasury).toBe(
      Math.max(aid, seat) - (row.aidLevel === 1 ? aid : seat)
    );
  });

  it("pays for the ladder it actually moved", async () => {
    const cost = aidUpgradeCostGold(0);
    const { guild, empires } = await makeGuild("aid", ["LEADER"], cost);
    currentEmpireId = empires[0].id;

    expect((await upgradeGuildAid()).success).toBeTruthy();
    const row = await guildLedgers(guild.id);
    expect(row.aidLevel).toBe(1);
    expect(row.treasury).toBe(0);

    // And with an empty till the next rung is simply unaffordable — no level, no
    // negative balance.
    expect((await upgradeGuildAid()).error).toBeTruthy();
    expect((await guildLedgers(guild.id)).aidLevel).toBe(1);
  });

  it("is a leadership decision, not a member's", async () => {
    // The role gate is what a shared till makes necessary: one member spending
    // everybody's donations on a ladder nobody agreed to is the failure mode.
    const cost = aidUpgradeCostGold(0);
    const { guild, empires } = await makeGuild(
      "rank",
      ["LEADER", "MEMBER"],
      cost
    );
    currentEmpireId = empires[1].id;

    expect((await upgradeGuildAid()).error).toBeTruthy();
    expect((await upgradeGuildCapacity()).error).toBeTruthy();
    expect(await tillOf(guild.id)).toBe(cost);
  });

  it("stops at the ceiling of each ladder", async () => {
    const { guild, empires } = await makeGuild(
      "ceiling",
      ["LEADER"],
      1_000_000_000
    );
    currentEmpireId = empires[0].id;

    await prisma.guild.update({
      where: { id: guild.id },
      data: { aidLevel: GUILD_AID_MAX_LEVEL, capacityLevel: 9 },
    });
    const before = await tillOf(guild.id);

    expect((await upgradeGuildAid()).error).toBeTruthy();
    expect((await upgradeGuildCapacity()).error).toBeTruthy();
    // A refused purchase is not a paid one.
    expect(await tillOf(guild.id)).toBe(before);
    expect(guildCapacity(9)).toBe(10);
  });
});
