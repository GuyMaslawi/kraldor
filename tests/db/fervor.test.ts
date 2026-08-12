import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bumpFervor, livePoints } from "@/server/fervor";
import {
  FERVOR_CAP,
  FERVOR_DECAY_MS,
  bumpedFervor,
  type FervorState,
} from "@/lib/game/fervor";

/**
 * `bumpFervor` is the SQL twin of the pure `bumpedFervor`, and the whole point
 * of this file is to prove the two agree — because the SQL makes a claim about
 * Postgres that TypeScript cannot check:
 *
 *   • `EXTRACT(EPOCH FROM ts)` on a zoneless `TIMESTAMP(3)` reads it as UTC
 *   • `TIMESTAMP 'epoch' + n * INTERVAL '1 millisecond'` puts it back unchanged
 *
 * Both must hold **whatever the session's TimeZone is** — and it is not UTC
 * here. That is the trap that has already bitten the guild contract, the world
 * boss and the rate limiter, and a unit test cannot see it: it only appears when
 * a real server converts a real timestamp. The first test therefore asserts the
 * session zone is *not* UTC, so this file can never silently stop testing the
 * thing it exists for.
 */

const prisma = new PrismaClient();
const TAG = `fv${Date.now().toString(36)}`;
const D = FERVOR_DECAY_MS;

async function makeEmpire(label: string, fervor?: Partial<FervorState>) {
  const user = await prisma.user.create({
    data: {
      email: `${label}@${TAG}.test`,
      name: label,
      passwordHash: "x",
      emailVerified: new Date(),
    },
  });
  return prisma.empire.create({
    data: {
      userId: user.id,
      name: `${TAG}-${label}`,
      fervorPoints: fervor?.points ?? 0,
      fervorAt: fervor?.at != null ? new Date(fervor.at) : null,
    },
  });
}

async function readMeter(id: string): Promise<FervorState> {
  const row = await prisma.empire.findUniqueOrThrow({
    where: { id },
    select: { fervorPoints: true, fervorAt: true },
  });
  return { points: row.fervorPoints, at: row.fervorAt?.getTime() ?? null };
}

afterAll(async () => {
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

describe("the timestamp claim the SQL rests on", () => {
  it("runs in a session whose zone is not UTC", async () => {
    // If this ever fails, the rest of the file stops being evidence: converting
    // through a UTC session zone is correct by accident.
    const [{ tz }] = await prisma.$queryRaw<{ tz: string }[]>`
      SELECT current_setting('TimeZone') AS tz
    `;
    expect(tz).not.toBe("UTC");
  });

  it("round-trips an instant through epoch arithmetic unchanged", async () => {
    const instant = new Date("2026-08-10T21:30:00.000Z");
    const empire = await makeEmpire("roundtrip", { points: 5, at: instant.getTime() });
    const [{ back }] = await prisma.$queryRaw<{ back: bigint }[]>`
      SELECT (EXTRACT(EPOCH FROM "fervorAt") * 1000)::bigint AS back
      FROM "Empire" WHERE id = ${empire.id}
    `;
    expect(Number(back)).toBe(instant.getTime());
  });
});

describe("bumpFervor matches bumpedFervor", () => {
  it("lights a cold meter at the caller's instant", async () => {
    const empire = await makeEmpire("cold");
    const now = new Date("2026-08-10T12:00:00.000Z");
    await bumpFervor(prisma, empire.id, now);

    expect(await readMeter(empire.id)).toEqual(
      bumpedFervor({ points: 0, at: null }, now.getTime())
    );
  });

  it("leaves the clock alone inside a decay period", async () => {
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("within", { points: 5, at: base });
    const now = new Date(base + D - 1);
    await bumpFervor(prisma, empire.id, now);

    // The remainder is still owed, so `fervorAt` must NOT have moved. This is
    // the 1:59 exploit, asserted against the database rather than the model.
    expect(await readMeter(empire.id)).toEqual(
      bumpedFervor({ points: 5, at: base }, now.getTime())
    );
  });

  it("pays the decay it owes before crediting the action", async () => {
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("decayed", { points: 8, at: base });
    const now = new Date(base + 3 * D + 45_000);
    await bumpFervor(prisma, empire.id, now);

    const expected = bumpedFervor({ points: 8, at: base }, now.getTime());
    expect(await readMeter(empire.id)).toEqual(expected);
    // …and the carried remainder is real: the clock landed on a whole period,
    // 45 seconds behind `now`.
    expect(now.getTime() - (expected.at ?? 0)).toBe(45_000);
  });

  it("re-lights a meter that had fully decayed", async () => {
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("relit", { points: 3, at: base });
    const now = new Date(base + 50 * D);
    await bumpFervor(prisma, empire.id, now);

    expect(await readMeter(empire.id)).toEqual(
      bumpedFervor({ points: 3, at: base }, now.getTime())
    );
  });

  it("cannot climb past the cap", async () => {
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("capped", { points: FERVOR_CAP, at: base });
    await bumpFervor(prisma, empire.id, new Date(base));
    expect((await readMeter(empire.id)).points).toBe(FERVOR_CAP);
  });

  it("clamps a row stored above the cap instead of building on it", async () => {
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("overfull", { points: 500, at: base });
    await bumpFervor(prisma, empire.id, new Date(base));
    expect((await readMeter(empire.id)).points).toBe(FERVOR_CAP);
  });

  it("does not gain points from a timestamp in the future", async () => {
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("skewed", { points: 10, at: base + 100 * D });
    const now = new Date(base);
    await bumpFervor(prisma, empire.id, now);

    // FLOOR of a negative span would *add* points without the GREATEST(0) guard.
    expect((await readMeter(empire.id)).points).toBe(11);
  });

  /**
   * The exploit, walked end to end through the database: 200 actions two
   * seconds inside the decay period. The naive `fervorAt = now` pins the meter
   * at its cap; carrying the remainder holds it near the floor.
   */
  it("does not let a sub-period cadence dodge decay forever", async () => {
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("cadence");
    let model: FervorState = { points: 0, at: null };
    let now = base;

    for (let i = 0; i < 200; i += 1) {
      await bumpFervor(prisma, empire.id, new Date(now));
      model = bumpedFervor(model, now);
      now += D - 1_000;
    }

    const stored = await readMeter(empire.id);
    expect(stored).toEqual(model);
    expect(livePoints(
      { fervorPoints: stored.points, fervorAt: new Date(stored.at ?? 0) },
      new Date(now)
    )).toBeLessThan(10);
  });
});

describe("concurrency", () => {
  it("cannot be raced past the cap", async () => {
    // The race is allowed to *under*-credit — two actions landing together may
    // cost the player a point — but no interleaving may put the meter above the
    // ceiling, because that is the only thing here worth farming.
    const base = Date.UTC(2026, 7, 10, 12, 0, 0);
    const empire = await makeEmpire("burst", { points: FERVOR_CAP - 2, at: base });

    await Promise.all(
      Array.from({ length: 30 }, () =>
        bumpFervor(prisma, empire.id, new Date(base))
      )
    );

    const stored = await readMeter(empire.id);
    expect(stored.points).toBeLessThanOrEqual(FERVOR_CAP);
    expect(stored.points).toBeGreaterThanOrEqual(FERVOR_CAP - 2);
  });
});
