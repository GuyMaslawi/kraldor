import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The trap that `server/uniqueRace.ts` exists to close, pinned against the real
 * database.
 *
 * Several actions debit a resource and then insert a row whose unique index is
 * the once-only receipt — a title purchase, a monument's founding row, an arena
 * entry. Three of them were written to catch the violation and hand the money
 * back inside the same transaction. **That refund cannot run.** Postgres aborts
 * a transaction the moment any statement in it fails, and Prisma does not wrap
 * individual queries in savepoints, so every statement after the violation
 * fails too.
 *
 * This is exactly the class of assumption the DB suite exists for: it is a
 * property of Postgres, not of our TypeScript, and mocking it would have meant
 * asserting that the mock behaves the way we guessed — which is how the refund
 * came to be written in the first place.
 *
 * Two things are proven here, and both matter:
 *
 *  1. the refund statement really does fail, so the pattern is dead code;
 *  2. the rollback really does undo the debit, so the player was never charged
 *     — which is *why* it is safe to throw and let the rollback be the refund.
 */

const prisma = new PrismaClient();
const TAG = `ur${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeEmpire(name: string, diamonds: number) {
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
      diamonds,
    },
  });
}

describe("a unique violation inside an interactive transaction", () => {
  it("poisons every later statement, so an in-transaction refund is dead code", async () => {
    const empire = await makeEmpire("poison", 1_000);
    const KEY = "audit_probe";
    await prisma.empireTitle.create({
      data: { empireId: empire.id, key: KEY, paid: 300 },
    });

    let refundRan = false;
    let refundError: string | null = null;

    await prisma
      .$transaction(async (tx) => {
        // The debit, exactly as buyTitle does it.
        const paid = await tx.empire.updateMany({
          where: { id: empire.id, diamonds: { gte: 300 } },
          data: { diamonds: { decrement: 300 } },
        });
        expect(paid.count).toBe(1);

        try {
          // The receipt insert — loses to the row already there.
          await tx.empireTitle.create({
            data: { empireId: empire.id, key: KEY, paid: 300 },
          });
        } catch {
          try {
            // The refund the old code wrote. It cannot run.
            await tx.empire.update({
              where: { id: empire.id },
              data: { diamonds: { increment: 300 } },
            });
            refundRan = true;
          } catch (err) {
            refundError = (err as Error).message;
          }
        }
      })
      .catch(() => {
        /* the aborted transaction surfaces here */
      });

    expect(refundRan).toBe(false);
    expect(refundError).not.toBeNull();

    // And the reason it is nonetheless safe to throw: the rollback undid the
    // debit, so the diamonds are still there.
    const after = await prisma.empire.findUniqueOrThrow({
      where: { id: empire.id },
      select: { diamonds: true },
    });
    expect(after.diamonds).toBe(1_000);
  });

  it("leaves the balance whole when the throw replaces the refund", async () => {
    // The shape the fixed actions now use: throw on the violation and let the
    // rollback be the refund. Nothing is charged and nothing is granted.
    const empire = await makeEmpire("throw", 500);
    const KEY = "audit_probe_two";
    await prisma.empireTitle.create({
      data: { empireId: empire.id, key: KEY, paid: 150 },
    });

    class Raced extends Error {}
    let raced = false;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.empire.updateMany({
          where: { id: empire.id, diamonds: { gte: 150 } },
          data: { diamonds: { decrement: 150 } },
        });
        try {
          await tx.empireTitle.create({
            data: { empireId: empire.id, key: KEY, paid: 150 },
          });
        } catch {
          throw new Raced("already owned");
        }
      });
    } catch (err) {
      raced = err instanceof Raced;
    }

    expect(raced).toBe(true);
    const after = await prisma.empire.findUniqueOrThrow({
      where: { id: empire.id },
      select: { diamonds: true },
    });
    expect(after.diamonds).toBe(500);
    // Exactly one receipt — the double-click bought nothing extra.
    expect(
      await prisma.empireTitle.count({ where: { empireId: empire.id, key: KEY } })
    ).toBe(1);
  });
});
