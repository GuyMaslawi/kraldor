import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { gameWeek } from "@/lib/game/time";
import {
  WORLD_BOSS_KILL_DIAMONDS,
  WORLD_BOSS_MAX_STRIKES,
  WORLD_BOSS_STRIKE_TURNS,
  rollWorldBoss,
} from "@/lib/game/worldBoss";

/**
 * מפלצת העולם — the strike, against a real database.
 *
 * This is the one fixture in the game where a *shared* number is written by
 * everybody at once. Everything else that races is scoped to one empire's own
 * row; the boss's health is one row that the whole server decrements, and the
 * last decrement is worth diamonds. Three things can only be answered here:
 *
 *  1. **Nothing is lost.** N strikes take N blows off the bar and charge N
 *     prices. A read-then-write would let two concurrent strikes both read the
 *     same health and each write `hp − damage`, quietly refunding one blow.
 *  2. **The kill belongs to one striker.** The blow and the stamp are a single
 *     `UPDATE ... WHERE hp > 0`, so of everyone landing the last hit exactly one
 *     matches a row with health left. The rest are refunded — their blow never
 *     landed.
 *  3. **The weekly cap is a cap.** It is the fairness mechanism; without it the
 *     damage board is the power ladder with extra steps.
 *
 * The week's boss row is a live fixture shared with whatever else is in this
 * database, so it is snapshotted and put back — see `beforeAll`/`afterAll`.
 */

/**
 * Who the caller is, per call rather than per file.
 *
 * A plain `let currentEmpireId` is fine while one empire acts at a time and
 * quietly wrong the moment several do: `Promise.all(xs.map(async ...))` runs
 * every closure synchronously up to its first `await`, so the variable holds the
 * *last* writer's id by the time any action reads it — and the five-way race for
 * the killing blow below would silently become one empire swinging five times.
 * An AsyncLocalStorage store follows each call down its own await chain.
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

const { strikeWorldBoss, collectWorldBoss } = await import(
  "@/server/actions/worldBoss"
);

const prisma = new PrismaClient();
const TAG = `wb${Date.now().toString(36)}`;
const WEEK = gameWeek(new Date());

/** The row as it stood before this file touched it, or null if there was none. */
let restore: { hp: number; maxHp: number } | null = null;
let createdHere = false;
let bossId: string;

beforeAll(async () => {
  const existing = await prisma.worldBoss.findUnique({ where: { week: WEEK } });
  if (existing) {
    bossId = existing.id;
    restore = { hp: existing.hp, maxHp: existing.maxHp };
  } else {
    // The week's boss is a pure function of the week, so creating the row the
    // app would have created is not a fiction — it is the same row.
    const created = await prisma.worldBoss.create({
      data: {
        week: WEEK,
        key: rollWorldBoss(WEEK).key,
        maxHp: 1_000_000,
        hp: 1_000_000,
      },
    });
    bossId = created.id;
    createdHere = true;
  }
});

afterAll(async () => {
  // The fixtures' own strike rows go with their empires; the shared row is put
  // back the way it was found.
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  if (createdHere) {
    await prisma.worldBoss.delete({ where: { id: bossId } });
  } else if (restore) {
    await prisma.worldBoss.update({
      where: { id: bossId },
      data: { ...restore, defeatedAt: null, slayerId: null, slayerName: null },
    });
  }
  await prisma.$disconnect();
});

/** Stand the boss back up with a chosen health pool. */
async function standBoss(hp: number) {
  await prisma.worldBoss.update({
    where: { id: bossId },
    data: { hp, maxHp: Math.max(hp, 1), defeatedAt: null, slayerId: null, slayerName: null },
  });
}

beforeEach(async () => {
  // Nobody else's strikes should decide this file's arithmetic.
  await prisma.worldBossStrike.deleteMany({ where: { bossId } });
});

/**
 * A striker with no army at all.
 *
 * `strikeDamage` floors at one point of damage, so a fixture with zero military
 * power lands exactly one damage per blow however the ±25% spread rolls — which
 * turns "did every blow land" into an integer this file can assert on.
 */
async function makeStriker(label: string, turns: number) {
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
      gold: 0,
      turns,
      citizens: 0,
      diamonds: 0,
      militaryPower: 0,
      lastRegularUpdateAt: new Date(),
      lastDailyUpdateAt: new Date(),
      army: { create: { soldiers: 0, spies: 0, mineSlaves: 0 } },
      hero: { create: { level: 1 } },
    },
  });
}

const empireRow = (empireId: string) =>
  prisma.empire.findUniqueOrThrow({
    where: { id: empireId },
    select: { turns: true, diamonds: true },
  });

const bossRow = () =>
  prisma.worldBoss.findUniqueOrThrow({
    where: { id: bossId },
    select: { hp: true, defeatedAt: true, slayerId: true },
  });

describe("landing blows", () => {
  it("charges once and lands once per blow, however many arrive together", async () => {
    await standBoss(1_000);
    const blows = 6;
    const striker = await makeStriker("burst", WORLD_BOSS_STRIKE_TURNS * blows);
    currentEmpireId = striker.id;

    const results = await Promise.all(
      Array.from({ length: blows }, () => strikeWorldBoss())
    );
    expect(results.filter((r) => r.success).length).toBe(blows);

    const mine = await prisma.worldBossStrike.findUniqueOrThrow({
      where: { bossId_empireId: { bossId, empireId: striker.id } },
      select: { hits: true, damage: true },
    });
    expect(mine.hits).toBe(blows);
    expect(mine.damage).toBe(blows);

    // The bar moved by exactly what was recorded — no blow was overwritten by a
    // concurrent one, which is the whole point of decrementing in the database.
    expect((await bossRow()).hp).toBe(1_000 - blows);
    // And every one of them was paid for.
    expect((await empireRow(striker.id)).turns).toBe(0);
  });

  it("refuses a blow the striker cannot pay for", async () => {
    await standBoss(1_000);
    const striker = await makeStriker("broke", WORLD_BOSS_STRIKE_TURNS - 1);
    currentEmpireId = striker.id;

    expect((await strikeWorldBoss()).error).toBeTruthy();
    expect((await empireRow(striker.id)).turns).toBe(WORLD_BOSS_STRIKE_TURNS - 1);
    expect((await bossRow()).hp).toBe(1_000);
  });

  it("stops at the weekly cap even with turns to spare", async () => {
    await standBoss(10_000);
    const attempts = WORLD_BOSS_MAX_STRIKES + 5;
    const striker = await makeStriker(
      "capped",
      WORLD_BOSS_STRIKE_TURNS * attempts
    );
    currentEmpireId = striker.id;

    // Serially rather than at once: the cap is read inside the transaction under
    // the empire's own lock, so this asks the honest question — can a player who
    // simply keeps clicking get past it.
    let landed = 0;
    for (let i = 0; i < attempts; i += 1) {
      if ((await strikeWorldBoss()).success) landed += 1;
    }
    expect(landed).toBe(WORLD_BOSS_MAX_STRIKES);

    const mine = await prisma.worldBossStrike.findUniqueOrThrow({
      where: { bossId_empireId: { bossId, empireId: striker.id } },
      select: { hits: true },
    });
    expect(mine.hits).toBe(WORLD_BOSS_MAX_STRIKES);
    // The five refused blows cost nothing.
    expect((await empireRow(striker.id)).turns).toBe(
      WORLD_BOSS_STRIKE_TURNS * 5
    );
  });
});

describe("the killing blow", () => {
  it("belongs to exactly one striker, and refunds everyone else", async () => {
    // One point of health and five strikers swinging at once: this is the race
    // the prize is meant to be, and the one a read-then-write would pay twice.
    await standBoss(1);
    const strikers = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => makeStriker(`kill${i}`, WORLD_BOSS_STRIKE_TURNS))
    );

    const results = await Promise.all(
      strikers.map((striker) => as(striker.id, () => strikeWorldBoss()))
    );
    // Serialised by the empire lock they each take, so exactly one blow finds
    // health left; the rest find a corpse.
    expect(results.filter((r) => r.success).length).toBe(1);

    const boss = await bossRow();
    expect(boss.hp).toBe(0);
    expect(boss.defeatedAt).not.toBeNull();
    expect(boss.slayerId).not.toBeNull();

    const rows = await Promise.all(strikers.map((s) => empireRow(s.id)));
    const paid = rows.filter((r) => r.diamonds === WORLD_BOSS_KILL_DIAMONDS);
    expect(paid).toHaveLength(1);
    expect(rows.filter((r) => r.diamonds === 0)).toHaveLength(4);

    // The four whose blow never landed keep their turns — a refused strike is
    // not a spent one.
    expect(rows.filter((r) => r.turns === WORLD_BOSS_STRIKE_TURNS)).toHaveLength(4);
    // And the slayer is one of the five, not a stale name from another week.
    expect(strikers.map((s) => s.id)).toContain(boss.slayerId);
  });
});

describe("collecting a share", () => {
  it("pays each striker once, and nothing to anyone who never swung", async () => {
    await standBoss(3);
    const [alpha, beta] = await Promise.all([
      makeStriker("share-a", WORLD_BOSS_STRIKE_TURNS * 2),
      makeStriker("share-b", WORLD_BOSS_STRIKE_TURNS),
    ]);

    currentEmpireId = alpha.id;
    await strikeWorldBoss();
    await strikeWorldBoss();
    currentEmpireId = beta.id;
    await strikeWorldBoss();
    expect((await bossRow()).defeatedAt).not.toBeNull();

    // Alpha collects from six tabs at once.
    currentEmpireId = alpha.id;
    const alphaResults = await Promise.all(
      Array.from({ length: 6 }, () => collectWorldBoss())
    );
    expect(alphaResults.filter((r) => r.success).length).toBe(1);

    currentEmpireId = beta.id;
    expect((await collectWorldBoss()).success).toBeTruthy();
    expect((await collectWorldBoss()).error).toBeTruthy();

    const claims = await prisma.worldBossStrike.findMany({
      where: { bossId, empireId: { in: [alpha.id, beta.id] } },
      select: { empireId: true, claimed: true, damage: true },
    });
    expect(claims.every((c) => c.claimed)).toBe(true);
    // Two thirds of the damage against one third, so the shares must differ —
    // the floor half is even, the other half is earned.
    const alphaDamage = claims.find((c) => c.empireId === alpha.id)!.damage;
    const betaDamage = claims.find((c) => c.empireId === beta.id)!.damage;
    expect(alphaDamage).toBe(2);
    expect(betaDamage).toBe(1);

    const bystander = await makeStriker("bystander", 0);
    currentEmpireId = bystander.id;
    expect((await collectWorldBoss()).error).toBeTruthy();
    expect((await empireRow(bystander.id)).turns).toBe(0);
  });
});
