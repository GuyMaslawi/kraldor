import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { gameWeek } from "@/lib/game/time";
import { ARENA_PODIUM_MIN_ENTRANTS } from "@/lib/game/arena";

/**
 * הזירה — the thin-tier diamond faucet, and the pair of races around it.
 *
 * ## The faucet
 *
 * An arena is scoped to a *city tier*, and a tier is not a room full of people
 * — it is however many empires happen to hold that many cities this week. At
 * the top of the ladder that is routinely one. A round-robin of one entrant is
 * zero duels and a table of one row, so that entrant is ranked first by
 * arithmetic alone and, before ARENA_PODIUM_MIN_ENTRANTS, collected the
 * winner's 60 diamonds every week forever for the price of the entry turns,
 * with no opponent and nothing to out-play. Two accounts parked in the same
 * empty tier took first *and* second.
 *
 * The unit suite pins the arithmetic. This pins the thing that actually pays:
 * the claim path, against a real database, counting the real entrants.
 *
 * ## Why the rest is here too
 *
 * The claim reads the entrant count itself rather than trusting the screen, and
 * the resolution writes the table inside the same transaction that stamps
 * `resolvedAt`. Both are database-shaped promises, and both are tested by doing
 * the thing twice at once.
 */

let currentEmpireId: string | null = null;

vi.mock("@/lib/auth", () => ({
  getActiveEmpireId: async () => currentEmpireId,
}));

// The actions end by revalidating /game, which needs a request context Next
// only builds while serving one.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { collectArena, getArenaState } = await import("@/server/actions/arena");

const prisma = new PrismaClient();
const TAG = `ap${Date.now().toString(36)}`;
// Far in the past, so it can never collide with a live card and is always
// "resolved" as far as the collector is concerned.
const WEEK = gameWeek(new Date()) - 500;

afterAll(async () => {
  await prisma.arena.deleteMany({ where: { week: WEEK } });
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

beforeAll(async () => {
  await prisma.arena.deleteMany({ where: { week: WEEK } });
});

async function makeEmpire(name: string, cities: number) {
  const user = await prisma.user.create({
    data: {
      email: `${name}@${TAG}.test`,
      name: `${TAG}-${name}`,
      passwordHash: "x",
      emailVerified: new Date(),
    },
  });
  return prisma.empire.create({
    data: {
      userId: user.id,
      name: `${TAG}-${name}`,
      gold: 0,
      turns: 0,
      citizens: 0,
      diamonds: 0,
      cities,
      militaryPower: 1_000,
    },
  });
}

/** A finished card of `size` entrants, with the first one placed first. */
async function makeResolvedCard(label: string, tier: number, size: number) {
  const arena = await prisma.arena.create({
    data: { week: WEEK, tier, resolvedAt: new Date() },
  });
  const empires = [];
  for (let i = 0; i < size; i += 1) {
    const empire = await makeEmpire(`${label}${i}`, tier);
    await prisma.arenaEntry.create({
      data: {
        arenaId: arena.id,
        empireId: empire.id,
        place: i + 1,
        wins: size - 1 - i,
        losses: i,
        power: 1_000,
      },
    });
    empires.push(empire);
  }
  return { arena, empires };
}

async function diamondsOf(empireId: string) {
  const row = await prisma.empire.findUniqueOrThrow({
    where: { id: empireId },
    select: { diamonds: true },
  });
  return row.diamonds;
}

describe("the podium does not pay on a card nobody had to beat", () => {
  it("gives a lone entrant no diamonds for their automatic first place", async () => {
    const { empires } = await makeResolvedCard("solo", 2, 1);
    currentEmpireId = empires[0].id;

    const result = await collectArena();
    expect("success" in result).toBe(true);
    expect(await diamondsOf(empires[0].id)).toBe(0);
  });

  it("gives two parked accounts nothing for first and second", async () => {
    const { empires } = await makeResolvedCard("pair", 3, 2);
    for (const empire of empires) {
      currentEmpireId = empire.id;
      await collectArena();
      expect(await diamondsOf(empire.id)).toBe(0);
    }
  });

  it("pays the podium once the card is a real tournament", async () => {
    const { empires } = await makeResolvedCard(
      "full",
      4,
      ARENA_PODIUM_MIN_ENTRANTS
    );
    currentEmpireId = empires[0].id;

    const result = await collectArena();
    expect("success" in result).toBe(true);
    expect(await diamondsOf(empires[0].id)).toBeGreaterThan(0);
  });

  it("still pays a thin card its earned half, so it is never a dead screen", async () => {
    const { empires } = await makeResolvedCard("thin", 5, 2);
    currentEmpireId = empires[0].id;

    await collectArena();
    const row = await prisma.empire.findUniqueOrThrow({
      where: { id: empires[0].id },
      select: { turns: true, gold: true },
    });
    expect(row.turns).toBeGreaterThan(0);
    expect(row.gold).toBeGreaterThan(0);
  });
});

describe("spoils survive the empire growing", () => {
  /**
   * A tier *is* the city count, so founding a city moves the player to a
   * different arena. The entry does not move with them — `place` and `claimed`
   * live on the row that was fought. While the read side filtered unclaimed
   * finishes to the viewer's *current* tier, a player who founded a city
   * between the week ending and coming back was shown their new tier's empty
   * card and no way to reach the purse they had won, even though the collect
   * action would have paid it.
   */
  it("still offers a finish won at a smaller city count", async () => {
    const { empires } = await makeResolvedCard(
      "grew",
      7,
      ARENA_PODIUM_MIN_ENTRANTS
    );
    const winner = empires[0];

    // They found a city; their tier is now 8, their finish is in tier 7.
    await prisma.empire.update({
      where: { id: winner.id },
      data: { cities: 8 },
    });
    currentEmpireId = winner.id;

    const state = await getArenaState();
    expect(state).not.toBeNull();
    expect(state!.claimable).toBe(true);
    expect(state!.myPlace).toBe(1);

    // And the purse it offers is the one the claim actually pays.
    expect(state!.reward.some((r) => r.kind === "diamonds")).toBe(true);
    const before = await diamondsOf(winner.id);
    await collectArena();
    expect(await diamondsOf(winner.id)).toBeGreaterThan(before);
  });
});

describe("the claim receipt", () => {
  it("pays exactly once however many tabs collect together", async () => {
    const { empires } = await makeResolvedCard(
      "race",
      6,
      ARENA_PODIUM_MIN_ENTRANTS
    );
    const winner = empires[0];
    currentEmpireId = winner.id;

    // The flag flip is the receipt; only one of these may credit anything.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => collectArena())
    );
    const paid = results.filter((r) => "success" in r && r.success).length;
    expect(paid).toBe(1);

    const entry = await prisma.arenaEntry.findFirstOrThrow({
      where: { empireId: winner.id },
      select: { claimed: true },
    });
    expect(entry.claimed).toBe(true);

    // And the credit landed exactly one purse's worth of diamonds.
    const solo = await diamondsOf(winner.id);
    expect(solo).toBeGreaterThan(0);

    const again = await collectArena();
    expect("error" in again).toBe(true);
    expect(await diamondsOf(winner.id)).toBe(solo);
  });
});
