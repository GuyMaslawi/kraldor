import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  MONUMENTS,
  MONUMENT_MAX_LEVEL,
  MONUMENT_PCT_PER_LEVEL,
  monumentCost,
} from "@/lib/game/monuments";
import { TITLES } from "@/lib/game/titles";

/**
 * The two purchases that **debit and then write a once-only receipt** —
 * מונומנטים and תארים — against a real database.
 *
 * They share a shape, and the shape has a trap in it that no mock can show you.
 * Both spend first (a guarded `updateMany`) and then insert a row whose unique
 * index is the proof of purchase. The obvious way to handle the losing half of a
 * double-click is to catch the violation and hand the money back inside the same
 * transaction — and that refund **cannot run**, because Postgres has already
 * aborted the transaction by then. server/uniqueRace.ts documents the trap and
 * tests/db/uniqueRace.test.ts pins the database behaviour; this file pins the
 * thing a player actually experiences on top of it:
 *
 *  - a double-click buys **one** monument level and pays for one;
 *  - a double-click buys **one** title and is charged for one;
 *  - and the losing click is told what happened rather than shown "try again".
 *
 * The ceilings are here for the same reason. Both ladders end, and a purchase
 * refused at the top must be refused *before* the money moves, not after.
 */

const caller = new AsyncLocalStorage<string>();

/** Act as this empire for the duration of one call — see the note in
 *  worldBossStrike.test.ts for why a plain variable is not enough. */
const as = <T>(empireId: string, run: () => Promise<T>) =>
  caller.run(empireId, run);

vi.mock("@/lib/auth", () => ({
  getActiveEmpireId: async () => caller.getStore() ?? null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { raiseMonument } = await import("@/server/actions/monuments");
const { buyTitle, wearTitle } = await import("@/server/actions/titles");

const prisma = new PrismaClient();
const TAG = `gs${Date.now().toString(36)}`;

const MONUMENT = MONUMENTS[0];
const FOR_SALE = TITLES.find((title) => title.kind === "bought")!;
const EARNED = TITLES.find((title) => title.kind === "earned")!;

afterAll(async () => {
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeEmpire(label: string, purse: { gold?: number; diamonds?: number }) {
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
      gold: purse.gold ?? 0,
      diamonds: purse.diamonds ?? 0,
      turns: 0,
      citizens: 0,
      // Monument prices are hundreds of millions, so a fixture with a settled
      // backlog of mine production would move the balance under the assertions.
      lastRegularUpdateAt: new Date(),
      lastDailyUpdateAt: new Date(),
      army: { create: { soldiers: 0, spies: 0, mineSlaves: 0 } },
      hero: { create: { level: 1 } },
    },
  });
}

const purseOf = (empireId: string) =>
  prisma.empire.findUniqueOrThrow({
    where: { id: empireId },
    select: { gold: true, diamonds: true, title: true },
  });

function keyForm(key: string) {
  const form = new FormData();
  form.set("key", key);
  return form;
}

/* ------------------------------ monuments ------------------------------ */

/** What the ladder costs to reach `level` from nothing. */
const ladderTo = (level: number) =>
  Array.from({ length: level }, (_, held) => monumentCost(held) ?? 0).reduce(
    (sum, rung) => sum + rung,
    0
  );

describe("raising a monument", () => {
  /**
   * A monument is not a once-only claim — five clicks with the gold for five
   * rungs *should* buy five, and a test that demanded "exactly one succeeds"
   * would be describing a different feature. What must hold under any amount of
   * concurrency is the thing a player would notice going wrong:
   *
   * > **Gold charged equals levels standing.** Never a level nobody paid for,
   * > never a payment that bought nothing.
   *
   * Both directions are live risks in this action. A lost founding race that
   * refunded inside the transaction would be the second (the refund cannot run —
   * see server/uniqueRace.ts); an unpinned level bump would be the first.
   */
  it("charges exactly what it built, however many tabs click at once", async () => {
    const budget = ladderTo(3);
    const empire = await makeEmpire("found", { gold: budget });

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        as(empire.id, () => raiseMonument({}, keyForm(MONUMENT.key)))
      )
    );
    const bought = results.filter((r) => r.success).length;
    expect(bought).toBeGreaterThanOrEqual(1);
    // Six clicks cannot buy more than the purse holds, whatever order they land
    // in — the guarded debit is the only thing enforcing that.
    expect(bought).toBeLessThanOrEqual(3);

    // One row, not one per losing insert.
    const rows = await prisma.empireMonument.findMany({
      where: { empireId: empire.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(bought);
    expect((await purseOf(empire.id)).gold).toBe(budget - ladderTo(bought));

    // And every refused click said something a player can act on, rather than
    // the generic fault a mis-handled rollback would have produced.
    expect(results.filter((r) => r.error).every((r) => (r.error ?? "").length > 0)).toBe(
      true
    );
  });

  it("raises a standing monument one level per click, at that rung's price", async () => {
    const empire = await makeEmpire("raise", { gold: ladderTo(2) });

    expect(
      (await as(empire.id, () => raiseMonument({}, keyForm(MONUMENT.key)))).success
    ).toBeTruthy();
    expect((await purseOf(empire.id)).gold).toBe(ladderTo(2) - monumentCost(0)!);

    expect(
      (await as(empire.id, () => raiseMonument({}, keyForm(MONUMENT.key)))).success
    ).toBeTruthy();
    const row = await prisma.empireMonument.findFirstOrThrow({
      where: { empireId: empire.id, key: MONUMENT.key },
    });
    expect(row.level).toBe(2);
    expect((await purseOf(empire.id)).gold).toBe(0);

    // The purse is empty and the third rung costs more than the second, so the
    // next click has to be refused outright — with the level left alone.
    expect(
      (await as(empire.id, () => raiseMonument({}, keyForm(MONUMENT.key)))).error
    ).toBeTruthy();
    expect(
      (
        await prisma.empireMonument.findFirstOrThrow({
          where: { empireId: empire.id, key: MONUMENT.key },
        })
      ).level
    ).toBe(2);
  });

  it("refuses a level the empire cannot afford, and takes nothing", async () => {
    const price = monumentCost(0)!;
    const empire = await makeEmpire("poor", { gold: price - 1 });

    expect(
      (await as(empire.id, () => raiseMonument({}, keyForm(MONUMENT.key)))).error
    ).toBeTruthy();
    expect(await prisma.empireMonument.count({ where: { empireId: empire.id } })).toBe(0);
    expect((await purseOf(empire.id)).gold).toBe(price - 1);
  });

  it("stops at the top of the ladder without charging", async () => {
    const empire = await makeEmpire("topped", { gold: 1_000_000_000_000 });
    await prisma.empireMonument.create({
      data: { empireId: empire.id, key: MONUMENT.key, level: MONUMENT_MAX_LEVEL },
    });
    const before = (await purseOf(empire.id)).gold;

    expect(
      (await as(empire.id, () => raiseMonument({}, keyForm(MONUMENT.key)))).error
    ).toBeTruthy();
    expect((await purseOf(empire.id)).gold).toBe(before);
    expect(monumentCost(MONUMENT_MAX_LEVEL)).toBeNull();
    // The ladder's ceiling in the one number a player reads.
    expect(MONUMENT_PCT_PER_LEVEL * MONUMENT_MAX_LEVEL).toBe(24);
  });

  it("refuses a key the catalog does not have", async () => {
    const empire = await makeEmpire("bogus", { gold: 1_000_000_000 });
    expect(
      (await as(empire.id, () => raiseMonument({}, keyForm("not_a_monument")))).error
    ).toBeTruthy();
    expect(await prisma.empireMonument.count({ where: { empireId: empire.id } })).toBe(0);
    expect((await purseOf(empire.id)).gold).toBe(1_000_000_000);
  });
});

/* ------------------------------ titles ------------------------------ */

describe("buying a title", () => {
  it("charges once however many tabs buy together", async () => {
    const empire = await makeEmpire("title", { diamonds: FOR_SALE.price * 3 });

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        as(empire.id, () => buyTitle({}, keyForm(FOR_SALE.key)))
      )
    );
    expect(results.filter((r) => r.success).length).toBe(1);

    const owned = await prisma.empireTitle.findMany({
      where: { empireId: empire.id },
    });
    expect(owned).toHaveLength(1);
    // Two purchases' worth left from three: the five losing clicks are free, and
    // the rollback is what returns their diamonds.
    expect((await purseOf(empire.id)).diamonds).toBe(FOR_SALE.price * 2);
  });

  it("refuses a purse that cannot cover it", async () => {
    const empire = await makeEmpire("cheapskate", { diamonds: FOR_SALE.price - 1 });
    expect(
      (await as(empire.id, () => buyTitle({}, keyForm(FOR_SALE.key)))).error
    ).toBeTruthy();
    expect(await prisma.empireTitle.count({ where: { empireId: empire.id } })).toBe(0);
    expect((await purseOf(empire.id)).diamonds).toBe(FOR_SALE.price - 1);
  });

  it("will not sell an earned title at any price", async () => {
    // The line that keeps the two kinds from collapsing into one. A bought title
    // that looked like an earned one would devalue every earned one on the board.
    const empire = await makeEmpire("shortcut", { diamonds: 100_000 });
    expect(
      (await as(empire.id, () => buyTitle({}, keyForm(EARNED.key)))).error
    ).toBeTruthy();
    expect(await prisma.empireTitle.count({ where: { empireId: empire.id } })).toBe(0);
    expect((await purseOf(empire.id)).diamonds).toBe(100_000);
  });

  it("only lets a title be worn once it is genuinely held", async () => {
    const empire = await makeEmpire("wear", { diamonds: FOR_SALE.price });

    // Not bought yet.
    expect(
      (await as(empire.id, () => wearTitle({}, keyForm(FOR_SALE.key)))).error
    ).toBeTruthy();
    expect((await purseOf(empire.id)).title).toBeNull();

    expect(
      (await as(empire.id, () => buyTitle({}, keyForm(FOR_SALE.key)))).success
    ).toBeTruthy();
    expect(
      (await as(empire.id, () => wearTitle({}, keyForm(FOR_SALE.key)))).success
    ).toBeTruthy();
    expect((await purseOf(empire.id)).title).toBe(FOR_SALE.key);

    // And an earned title whose condition is nowhere near met stays off.
    expect(
      (await as(empire.id, () => wearTitle({}, keyForm(EARNED.key)))).error
    ).toBeTruthy();
    expect((await purseOf(empire.id)).title).toBe(FOR_SALE.key);
  });
});
