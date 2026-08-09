import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rateLimit } from "@/lib/rateLimit";

/**
 * The concurrency invariants — the bug class that has recurred in every audit of
 * this codebase.
 *
 * Every exploit found so far had the same shape: read a value, decide from it,
 * write back. Under one user clicking twice, or a script firing twenty parallel
 * requests, the decision is made from a snapshot that is already stale. The
 * fixes are all database-level (guarded `updateMany`, `ON CONFLICT`, row locks),
 * so these are the tests that can only be written against a real database.
 */

const prisma = new PrismaClient();
const TAG = `t${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeEmpire(name: string, gold: number) {
  const user = await prisma.user.create({
    data: {
      email: `${name}@${TAG}.test`,
      name,
      passwordHash: "x",
      emailVerified: new Date(),
    },
  });
  return prisma.empire.create({
    data: { userId: user.id, name: `${TAG}-${name}`, gold, turns: 100, citizens: 0 },
  });
}

describe("the shared rate limiter", () => {
  it("lets exactly `limit` requests through a concurrent burst", async () => {
    // The whole reason the counter moved into Postgres. Twenty parallel logins
    // against an in-process Map on a serverless fleet all saw a fresh counter.
    const key = `${TAG}:burst`;
    const results = await Promise.all(
      Array.from({ length: 30 }, () => rateLimit(key, 10, 60_000))
    );
    expect(results.filter(Boolean)).toHaveLength(10);
  });

  it("counts each key separately", async () => {
    expect(await rateLimit(`${TAG}:a`, 1, 60_000)).toBe(true);
    expect(await rateLimit(`${TAG}:b`, 1, 60_000)).toBe(true);
    expect(await rateLimit(`${TAG}:a`, 1, 60_000)).toBe(false);
  });

  it("reopens the window once it has rolled over", async () => {
    const key = `${TAG}:rollover`;
    expect(await rateLimit(key, 1, 700)).toBe(true);
    expect(await rateLimit(key, 1, 700)).toBe(false);
    await new Promise((r) => setTimeout(r, 900));
    expect(await rateLimit(key, 1, 60_000)).toBe(true);
  });

  it("stores the counter where every instance can see it", async () => {
    const key = `${TAG}:shared`;
    await rateLimit(key, 5, 60_000);
    const row = await prisma.rateLimitBucket.findUnique({ where: { key } });
    expect(row?.count).toBe(1);
  });

  it("stores the window's end in the same time the rest of the app keeps", async () => {
    /**
     * The bug this pins was invisible because it was two bugs.
     *
     * `resetAt` is a `TIMESTAMP(3)` without a zone. A JS Date bound into a *raw*
     * query arrives as a `timestamptz` and is converted through the database
     * session's own zone on the way in, so on a session east of UTC the stored
     * instant was hours off. The rollover test then compared it against a bare
     * `NOW()` — also a `timestamptz` — which converted the column back the same
     * way, and the two errors cancelled. The limiter behaved correctly while
     * storing a value nothing else in the application could read: `sweepShared`
     * compares this column against a JS Date through the Prisma API, and saw
     * every expired bucket as hours in the future.
     *
     * So the assertion is deliberately made from *outside* the raw statement —
     * one Prisma read against one JS clock, which is the pair that has to agree.
     */
    const key = `${TAG}:clock`;
    const windowMs = 60_000;
    const before = Date.now();
    await rateLimit(key, 5, windowMs);
    const row = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key } });

    const drift = row.resetAt.getTime() - (before + windowMs);
    // Seconds of slack for the round trip; an offset bug is measured in hours.
    expect(Math.abs(drift)).toBeLessThan(10_000);
  });
});

describe("guarded debits", () => {
  it("cannot be raced below zero", async () => {
    // The house rule: never `decrement` on a snapshot, always
    // `updateMany({ where: { gte: cost } })`. Ten parallel spends of 100 against
    // a balance of 550 must settle at exactly five.
    const empire = await makeEmpire("debit", 550);
    const spend = () =>
      prisma.empire.updateMany({
        where: { id: empire.id, gold: { gte: 100 } },
        data: { gold: { decrement: 100 } },
      });

    const results = await Promise.all(Array.from({ length: 10 }, spend));
    const succeeded = results.filter((r) => r.count > 0).length;
    const after = await prisma.empire.findUniqueOrThrow({ where: { id: empire.id } });

    expect(succeeded).toBe(5);
    expect(after.gold).toBe(50);
    expect(after.gold).toBeGreaterThanOrEqual(0);
  });

  it("shows why the naive version is wrong", async () => {
    // Not a test of our code — a demonstration of the bug the rule prevents, so
    // that anyone tempted to "simplify" a debit can see the failure first.
    const empire = await makeEmpire("naive", 550);
    const naiveSpend = async () => {
      const row = await prisma.empire.findUniqueOrThrow({ where: { id: empire.id } });
      if (row.gold < 100) return false;
      await prisma.empire.update({
        where: { id: empire.id },
        data: { gold: { decrement: 100 } },
      });
      return true;
    };

    await Promise.all(Array.from({ length: 10 }, naiveSpend));
    const after = await prisma.empire.findUniqueOrThrow({ where: { id: empire.id } });
    // Every caller read 550 before any of them wrote, so all ten passed the
    // check and the balance went negative.
    expect(after.gold).toBeLessThan(0);
  });
});

describe("claim-once payouts", () => {
  it("pays a level-up exactly once under a double submit", async () => {
    // The `upgradeEmpireUpgrade` shape: pin the level you priced in the WHERE,
    // so a racer that finds a different level matches zero rows.
    const empire = await makeEmpire("levels", 1_000_000);
    await prisma.empireUpgrade.create({
      data: { empireId: empire.id, type: "CITIZEN_GROWTH", level: 1 },
    });

    const buyLevelTwo = () =>
      prisma.empireUpgrade.updateMany({
        where: { empireId: empire.id, type: "CITIZEN_GROWTH", level: 1 },
        data: { level: { increment: 1 } },
      });

    const results = await Promise.all(Array.from({ length: 8 }, buyLevelTwo));
    const applied = results.filter((r) => r.count > 0).length;
    const row = await prisma.empireUpgrade.findFirstOrThrow({
      where: { empireId: empire.id, type: "CITIZEN_GROWTH" },
    });

    expect(applied).toBe(1);
    expect(row.level).toBe(2);
  });

  it("lets a unique index settle a create race without poisoning a transaction", async () => {
    // `createMany({ skipDuplicates })` compiles to ON CONFLICT DO NOTHING and
    // reports `count: 0` for the loser. A bare `create` would raise P2002, which
    // inside `$transaction` aborts every later statement with 25P02.
    const empire = await makeEmpire("achv", 0);
    const claim = () =>
      prisma.empireAchievement.createMany({
        data: [{ empireId: empire.id, key: "test-key" }],
        skipDuplicates: true,
      });

    const results = await Promise.all(Array.from({ length: 6 }, claim));
    expect(results.filter((r) => r.count > 0)).toHaveLength(1);
    expect(
      await prisma.empireAchievement.count({ where: { empireId: empire.id } })
    ).toBe(1);
  });
});
