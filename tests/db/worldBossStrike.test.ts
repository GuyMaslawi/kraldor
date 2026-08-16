import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { gameDay } from "@/lib/game/time";
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
 *  3. **The daily cap is a cap.** It is the fairness mechanism; without it the
 *     damage board is the power ladder with extra steps.
 *
 * The day's boss row is a live fixture shared with whatever else is in this
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
const { settleWorldBossSpoils } = await import("@/server/worldBossSpoils");

const prisma = new PrismaClient();
const TAG = `wb${Date.now().toString(36)}`;
const DAY = gameDay(new Date());

/** The row as it stood before this file touched it, or null if there was none. */
let restore: { hp: number; maxHp: number } | null = null;
let createdHere = false;
let bossId: string;

beforeAll(async () => {
  const existing = await prisma.worldBoss.findUnique({ where: { day: DAY } });
  if (existing) {
    bossId = existing.id;
    restore = { hp: existing.hp, maxHp: existing.maxHp };
  } else {
    // The day's boss is a pure function of the day, so creating the row the
    // app would have created is not a fiction — it is the same row.
    const created = await prisma.worldBoss.create({
      data: {
        day: DAY,
        key: rollWorldBoss(DAY).key,
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
      data: {
        ...restore,
        defeatedAt: null,
        slayerId: null,
        slayerName: null,
        spoilsSettledAt: null,
        defeatAnnouncedAt: null,
      },
    });
  }
  await prisma.$disconnect();
});

/** Stand the boss back up with a chosen health pool. */
async function standBoss(hp: number) {
  await prisma.worldBoss.update({
    where: { id: bossId },
    data: {
      hp,
      maxHp: Math.max(hp, 1),
      defeatedAt: null,
      slayerId: null,
      slayerName: null,
      // A live beast has not paid anybody. Left stamped from the previous case's
      // kill, the fan-out would find no unsettled boss and the next kill would
      // pay nothing — the tests would then be asserting the old bug back.
      spoilsSettledAt: null,
      defeatAnnouncedAt: null,
    },
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
    // `reveal`, not `success`: an ordinary blow says nothing in words any more —
    // the health bar the arena already draws says it — so the reveal is what a
    // landed blow returns and the only thing that separates it from a refusal.
    expect(results.filter((r) => r.reveal).length).toBe(blows);

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

  it("stops at the daily cap even with turns to spare", async () => {
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
      if ((await strikeWorldBoss()).reveal) landed += 1;
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
    // And the slayer is one of the five, not a stale name from another day.
    expect(strikers.map((s) => s.id)).toContain(boss.slayerId);
  });
});

/**
 * The spoils, which used to be a button and are now a payout.
 *
 * The bug these were rewritten for: a share sat unpaid until its owner opened
 * the arena and pressed "collect", and the arena only ever renders the *current*
 * period's boss — so a purse nobody took before it turned over became
 * unreachable, permanently. Everyone who struck and did not come back got
 * nothing, which from the player's side is indistinguishable from the fixture
 * being broken — and on a daily fixture the window to miss is a day wide.
 *
 * So the kill pays everybody, and these are the three properties that has to
 * have: it pays without being asked, it pays each contender exactly once however
 * many payers reach them, and a debt it failed to pay is still payable later —
 * including from a day that has already turned over.
 */
describe("the spoils", () => {
  it("pays every contender at the kill, without anyone pressing anything", async () => {
    await standBoss(3);
    const [alpha, beta] = await Promise.all([
      makeStriker("share-a", WORLD_BOSS_STRIKE_TURNS * 2),
      makeStriker("share-b", WORLD_BOSS_STRIKE_TURNS),
    ]);

    currentEmpireId = alpha.id;
    await strikeWorldBoss();
    await strikeWorldBoss();
    // Beta lands the kill, so alpha — who did two thirds of the damage and is
    // not here — is the one the old code would have left holding an IOU.
    currentEmpireId = beta.id;
    await strikeWorldBoss();
    expect((await bossRow()).defeatedAt).not.toBeNull();

    const claims = await prisma.worldBossStrike.findMany({
      where: { bossId, empireId: { in: [alpha.id, beta.id] } },
      select: { empireId: true, claimed: true, damage: true },
    });
    expect(claims.every((c) => c.claimed)).toBe(true);
    // Two thirds of the damage against one third, so the shares must differ —
    // the floor half is even, the other half is earned.
    expect(claims.find((c) => c.empireId === alpha.id)!.damage).toBe(2);
    expect(claims.find((c) => c.empireId === beta.id)!.damage).toBe(1);

    // Paid, not merely marked: the purse pays turns, and both struck with
    // exactly enough to swing and nothing left over.
    const [alphaRow, betaRow] = await Promise.all([
      empireRow(alpha.id),
      empireRow(beta.id),
    ]);
    expect(alphaRow.turns).toBeGreaterThan(0);
    expect(betaRow.turns).toBeGreaterThan(0);
    // And each was told what they got, in their own inbox. Matched on the title
    // key rather than counting SYSTEM rows: the kill also fires the herald,
    // which puts its own row in every inbox in the game — including these two.
    expect(
      await prisma.message.count({
        where: {
          empireId: { in: [alpha.id, beta.id] },
          title: "🏆 חלקך בשלל {boss}",
        },
      })
    ).toBe(2);

    // The button is spent by the time the arena can draw it.
    currentEmpireId = alpha.id;
    expect((await collectWorldBoss()).error).toBeTruthy();

    const bystander = await makeStriker("bystander", 0);
    currentEmpireId = bystander.id;
    expect((await collectWorldBoss()).error).toBeTruthy();
    expect((await empireRow(bystander.id)).turns).toBe(0);
  });

  it("pays a share once, whichever payer reaches it first", async () => {
    await standBoss(1);
    const striker = await makeStriker("once", WORLD_BOSS_STRIKE_TURNS);
    currentEmpireId = striker.id;
    await strikeWorldBoss();

    const afterKill = await empireRow(striker.id);

    // The fan-out again, six times over, racing the button from six tabs. Every
    // one of them takes the share with the same guarded flip, so none of them
    // may pay a second time.
    await Promise.all([
      ...Array.from({ length: 6 }, () => settleWorldBossSpoils(bossId)),
      ...Array.from({ length: 6 }, () => collectWorldBoss()),
    ]);

    const afterStorm = await empireRow(striker.id);
    expect(afterStorm.turns).toBe(afterKill.turns);
    expect(afterStorm.diamonds).toBe(afterKill.diamonds);
  });

  it("settles a debt left behind by a day that has already turned over", async () => {
    // The old bug, staged exactly: a boss felled on a day gone by, with a share
    // still unpaid. No screen in the game can reach it — the arena renders
    // today — so the sweep is the only thing that can, and it must.
    const staleDay = DAY - 900;
    const stale = await prisma.worldBoss.create({
      data: {
        day: staleDay,
        key: rollWorldBoss(staleDay).key,
        maxHp: 100,
        hp: 0,
        defeatedAt: new Date(),
      },
    });
    try {
      const striker = await makeStriker("stale", 0);
      await prisma.worldBossStrike.create({
        data: { bossId: stale.id, empireId: striker.id, damage: 100, hits: 4 },
      });
      const before = await empireRow(striker.id);

      const result = await settleWorldBossSpoils(stale.id);
      expect(result?.paid).toBe(1);
      expect(result?.complete).toBe(true);

      expect((await empireRow(striker.id)).turns).toBeGreaterThan(before.turns);
      expect(
        (
          await prisma.worldBossStrike.findFirstOrThrow({
            where: { bossId: stale.id, empireId: striker.id },
            select: { claimed: true },
          })
        ).claimed
      ).toBe(true);
      // The marker is stamped only once the pass found nothing left, which is
      // what stops the sweep re-walking a settled boss for ever.
      expect(
        (
          await prisma.worldBoss.findUniqueOrThrow({
            where: { id: stale.id },
            select: { spoilsSettledAt: true },
          })
        ).spoilsSettledAt
      ).not.toBeNull();
    } finally {
      await prisma.worldBoss.delete({ where: { id: stale.id } });
    }
  });
});
