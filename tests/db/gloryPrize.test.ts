import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { GLORY_KEYS, gloryPrize } from "@/lib/game/achievements";

/**
 * שיאי העולם — the purse for being first, paid exactly once.
 *
 * A world record now pays real diamonds, turns and citizens (GLORY_PRIZE), and
 * it is settled on a *page load*: the base screen reads the records back and
 * pays the holder whatever is still owed. Page loads are not serialised — two
 * tabs, or a tab and a prefetch, hit it at the same moment routinely — so
 * "exactly once" cannot rest on having read `prizePaidAt` a line earlier. The
 * guard is a `updateMany(id, prizePaidAt: null)` inside the transaction and
 * *before* the credit; this is what proves it holds.
 *
 * `settleGloryPrizes` is handed the champions map rather than reading it, which
 * is what makes this testable against a shared database: the fixture declares
 * its own empire the record holder without having to out-date every real award
 * row in the game.
 */

const prisma = new PrismaClient();
const TAG = `gp${Date.now().toString(36)}`;
// The first capstone on the board. Nothing here depends on which one it is —
// only that it is a key `settleGloryPrizes` walks and that it carries a purse.
const KEY = GLORY_KEYS[0];
const PRIZE = gloryPrize(KEY);

const { settleGloryPrizes } = await import("@/server/gloryBoard");

afterAll(async () => {
  // Awards and messages cascade with the empire; the users have to go by hand.
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeHolder(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${label}@${TAG}.test`,
      name: `${TAG}-${label}`,
      passwordHash: "x",
      emailVerified: new Date(),
    },
  });
  const empire = await prisma.empire.create({
    data: {
      userId: user.id,
      name: `${TAG}-${label}`,
      gold: 0,
      turns: 0,
      citizens: 0,
      diamonds: 0,
      cities: 1,
    },
  });
  const award = await prisma.empireGloryAward.create({
    data: { empireId: empire.id, key: KEY },
  });
  return { empire, award };
}

/** The champions map as the base screen would hand it over. */
const championsOf = (empireId: string, awardId: string, over = {}) =>
  new Map([
    [
      KEY,
      {
        awardId,
        empireId,
        empireName: "x",
        title: null,
        awardedAt: new Date(),
        prizePaidAt: null,
        prizeTaken: false,
        ...over,
      },
    ],
  ]);

const balances = (empireId: string) =>
  prisma.empire.findUniqueOrThrow({
    where: { id: empireId },
    select: { diamonds: true, turns: true, citizens: true },
  });

const expected = (kind: "diamonds" | "turns" | "citizens") =>
  PRIZE.find((line) => line.kind === kind)?.amount ?? 0;

describe("the world-record purse", () => {
  it("pays the holder once, and only once, however many loads race for it", async () => {
    const { empire, award } = await makeHolder("race");
    const champions = championsOf(empire.id, award.id);

    // Four base-screen loads at the same instant, all reading the same unpaid
    // record. Exactly one must come back with a payment.
    const runs = await Promise.all(
      Array.from({ length: 4 }, () => settleGloryPrizes(empire.id, champions))
    );
    expect(runs.filter((r) => r.length > 0)).toHaveLength(1);

    const after = await balances(empire.id);
    expect(after.diamonds).toBe(expected("diamonds"));
    expect(Number(after.turns)).toBe(expected("turns"));
    expect(Number(after.citizens)).toBe(expected("citizens"));

    // One receipt in the inbox, not four.
    const messages = await prisma.message.count({ where: { empireId: empire.id } });
    expect(messages).toBe(1);

    // And a later load — the player simply opening their base again tomorrow —
    // pays nothing, because the map it is handed now carries the receipt.
    const fresh = await prisma.empireGloryAward.findUniqueOrThrow({
      where: { id: award.id },
    });
    expect(fresh.prizePaidAt).not.toBeNull();
    expect(
      await settleGloryPrizes(
        empire.id,
        championsOf(empire.id, award.id, { prizePaidAt: fresh.prizePaidAt })
      )
    ).toEqual([]);
    expect((await balances(empire.id)).diamonds).toBe(expected("diamonds"));
  });

  it("pays nobody a second purse for the same capstone", async () => {
    // The case a stale champion creates: an admin backdates an award, the head
    // of the key moves to a row that was never stamped, and the capstone is
    // suddenly payable again to somebody else. `prizeTaken` is read from the
    // database for exactly this, and it is the whole reason the flag exists.
    const { empire, award } = await makeHolder("second");
    const paid = await settleGloryPrizes(
      empire.id,
      championsOf(empire.id, award.id, { prizeTaken: true })
    );
    expect(paid).toEqual([]);
    expect((await balances(empire.id)).diamonds).toBe(0);
  });

  it("pays nothing to an empire that does not hold the record", async () => {
    const holder = await makeHolder("holder");
    const bystander = await makeHolder("bystander");
    const paid = await settleGloryPrizes(
      bystander.empire.id,
      championsOf(holder.empire.id, holder.award.id)
    );
    expect(paid).toEqual([]);
    expect((await balances(bystander.empire.id)).diamonds).toBe(0);
    expect((await balances(holder.empire.id)).diamonds).toBe(0);
  });
});
