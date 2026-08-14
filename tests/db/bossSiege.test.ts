import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { startBossAssault, settleDueAssault } from "@/server/bossSiege";
import { bossReward } from "@/lib/game/bosses";
import { seasonPassDay } from "@/lib/game/seasonPass";
import {
  BOSS_CASUALTIES,
  BOSS_CHIP_SHARE,
  BOSS_GRADE_BONUS,
  BOSS_KILL_SHARE,
  bossGrade,
} from "@/lib/game/bossBattle";

/**
 * The city-boss siege's economic bounds, against a real database.
 *
 * The siege traded the old one-victory-per-cycle cap for an arithmetic one: both
 * halves of the payout are pro-rata against **one empire's share** of the life's
 * pool, so an empire can take at most one haul out of a life however many marches
 * it spends — and a life takes an hour to return. These are the tests that hold
 * that bound down, plus the concurrency invariants (a march and a settle each
 * happen exactly once, and a city opens exactly one life) that only a real
 * Postgres can answer.
 *
 * Written during the 2026-07-30 pentest; the grade test is the one that found a
 * live exploit.
 *
 * **This suite wounds the live tier-1 tyrant.** Since 2026-08-14 a city boss is
 * one shared row per tier rather than a private copy per player, so the marches
 * below land on the same fixture the tier's real players are fighting, and the
 * empires it creates are counted into the head count of any life that spawns
 * while it runs. That is the price of testing a shared fixture against the
 * database it actually lives in; the tyrant revives within the hour either way.
 */

const prisma = new PrismaClient();
const TAG = `bs${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeWarlord(name: string, soldiers: number, turns = 20_000) {
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
      cities: 1,
      turns,
      gold: 0,
      wood: 0,
      iron: 0,
      stone: 0,
      citizens: 0,
      army: { create: { soldiers, spies: 0, mineSlaves: 0 } },
      hero: { create: { level: 40 } },
    },
  });
}

/**
 * Finish a running assault without waiting out its minute: rewind the deadline and
 * settle. The outcome was decided at launch, so nothing about the result depends
 * on the clock — which is exactly the property that makes this safe to do.
 */
async function finishAssault(empireId: string) {
  await prisma.bossBattle.updateMany({
    where: { empireId, status: "ACTIVE" },
    data: { endsAt: new Date(Date.now() - 1_000) },
  });
  return settleDueAssault(empireId);
}

/** The haul one life of the tier-1 boss is worth right now. */
async function oneLifeHaul() {
  const season = await prisma.gameSeason.findFirst({
    where: { isActive: true },
    select: { startsAt: true, endsAt: true },
  });
  return bossReward(1, seasonPassDay(season, Date.now()), 1);
}

describe("the per-life loot budget", () => {
  it("cannot be farmed past one life's haul, however many sorties are thrown at it", async () => {
    // Twenty marches at an army far over the wall, against however deep the tier's
    // shared pool happens to be. The bound does not care: chip loot and the kill
    // purse are both pro-rata against ONE empire's share of the pool, so twenty
    // marches into a pool ten people are emptying pay this empire no more than
    // felling a private tyrant alone ever did.
    const me = await makeWarlord("budget", 400_000);
    const before = await prisma.empire.findUniqueOrThrow({ where: { id: me.id } });

    let launched = 0;
    for (let i = 0; i < 20; i++) {
      const out = await startBossAssault(me.id);
      if ("error" in out) continue;
      launched++;
      await finishAssault(me.id);
    }

    const after = await prisma.empire.findUniqueOrThrow({ where: { id: me.id } });
    const haul = await oneLifeHaul();
    const ceiling = BOSS_CHIP_SHARE + BOSS_KILL_SHARE * BOSS_GRADE_BONUS.S;

    expect(launched).toBeGreaterThan(0);
    // Payouts round to hundreds, so allow a little over the arithmetic ceiling.
    expect(after.gold - before.gold).toBeLessThanOrEqual(
      Math.ceil(haul.gold * ceiling * 1.01)
    );
  });
});

describe("the shared tyrant", () => {
  it("takes every besieger's damage into one pool, with nothing lost between them", async () => {
    // The invariant sharing the fixture introduced. Two empires march on the same
    // life at the same instant: both read the health, both roll a fight against
    // it, and both write a wound. Without the tier lock in `startBossAssault` the
    // second read would be stale and one of the two wounds would vanish — the
    // classic lost update, and here it would also let both of them roll the same
    // killing blow.
    const [a, b] = await Promise.all([
      makeWarlord("sharedA", 30_000),
      makeWarlord("sharedB", 30_000),
    ]);

    await Promise.all([startBossAssault(a.id), startBossAssault(b.id)]);

    const battles = await prisma.bossBattle.findMany({
      where: { empireId: { in: [a.id, b.id] } },
      select: { siegeId: true, empireId: true, damageDealt: true, hpAtStart: true },
    });
    expect(battles).toHaveLength(2);
    // One life, not two: the city shares its tyrant.
    expect(new Set(battles.map((x) => x.siegeId)).size).toBe(1);

    const siege = await prisma.bossSiege.findUniqueOrThrow({
      where: { id: battles[0].siegeId },
    });
    const strikes = await prisma.bossSiegeStrike.findMany({
      where: { siegeId: siege.id, empireId: { in: [a.id, b.id] } },
    });
    expect(strikes).toHaveLength(2);

    // Each wound is what its own plan actually landed, capped at the health that
    // was standing when it launched…
    for (const battle of battles) {
      const mine = strikes.find((s) => s.empireId === battle.empireId);
      expect(mine?.damage).toBeCloseTo(
        Math.min(battle.damageDealt, battle.hpAtStart),
        6
      );
    }
    // …and the pool carries the sum of everything anybody has done to it.
    expect(siege.damageDealt).toBeCloseTo(siege.maxHp - siege.hp, 6);
  });
});

describe("racing the boss", () => {
  it("turns twenty concurrent marches into one battle and one turn debit", async () => {
    const me = await makeWarlord("racelaunch", 50_000);
    const before = await prisma.empire.findUniqueOrThrow({ where: { id: me.id } });

    await Promise.all(Array.from({ length: 20 }, () => startBossAssault(me.id)));

    const after = await prisma.empire.findUniqueOrThrow({ where: { id: me.id } });
    expect(await prisma.bossBattle.count({ where: { empireId: me.id } })).toBe(1);
    // And the city still has exactly one living tyrant. Opening a life is the one
    // write two empires can genuinely race now, so twenty marches arriving at an
    // empty tier must produce one row, not twenty — the tier advisory lock and the
    // (cityTier, life) unique key under it.
    expect(
      await prisma.bossSiege.count({
        where: { cityTier: 1, killedAt: null, hp: { gt: 0 } },
      })
    ).toBe(1);
    // One march paid for, not twenty. The empire row lock is what does this.
    expect(before.turns - after.turns).toBe(300);
  });

  it("pays a finished assault exactly once under twenty concurrent settles", async () => {
    const me = await makeWarlord("racesettle", 50_000);
    await startBossAssault(me.id);
    await prisma.bossBattle.updateMany({
      where: { empireId: me.id, status: "ACTIVE" },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => settleDueAssault(me.id))
    );

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await prisma.bossFight.count({ where: { empireId: me.id } })).toBe(1);
    // One report, one inbox notice — a doubled toast would mean a doubled payout.
    expect(
      await prisma.message.count({ where: { empireId: me.id, kind: "BATTLE" } })
    ).toBe(1);
  });
});

describe("the grade is scored on the battle that was fought", () => {
  it("cannot be bought by making the army disappear mid-assault", async () => {
    // The 2026-07-30 exploit. Casualties are clamped at the settle to what is
    // actually standing (you cannot lose soldiers you no longer have), and the
    // grade used to read that clamped figure — so an army that vanished during the
    // minute scored *better* than one that stood and fought. Measured before the
    // fix: casualties 938 -> 0, grade C -> S, haul 150,000 -> 183,800 gold.
    //
    // The only thing that reduces Army.soldiers in play is losing a defence, so an
    // alt attacking you inside your own assault window bought the grade — and kept
    // the soldiers it took. Setting the row to zero here stands in for that.
    // Comparing two empires would only compare two different dice rolls, so this
    // pins the invariant instead: the grade must be exactly the function of the
    // stored plan, and must not move when the live army does.
    const dodger = await makeWarlord("dodger", 20_000);
    await startBossAssault(dodger.id);

    const plan = await prisma.bossBattle.findFirstOrThrow({
      where: { empireId: dodger.id, status: "ACTIVE" },
    });
    const fromPlan = bossGrade(
      plan.correctCounters,
      plan.decisions,
      plan.soldiersLost / plan.soldiersAtStart
    );

    // The army walks away with the fight already rolled and a minute left to run.
    await prisma.army.update({
      where: { empireId: dodger.id },
      data: { soldiers: 0 },
    });
    await finishAssault(dodger.id);

    const report = await prisma.bossFight.findFirstOrThrow({
      where: { empireId: dodger.id },
    });

    // The clamp still protects the army row: no soldiers are taken from an empty
    // one, and the row never goes negative.
    expect(report.soldiersLost).toBe(0);
    const army = await prisma.army.findUniqueOrThrow({
      where: { empireId: dodger.id },
    });
    expect(army.soldiers).toBe(0);

    // …but it buys nothing. The grade is the plan's grade, scored on the casualties
    // the battle actually inflicted, not on the empty army the settle found.
    if (report.victory) {
      expect(report.grade).toBe(fromPlan);
      // While the tyrant draws no blood (BOSS_ROUND_LOSS_BASE is 0 — see the note
      // on it) every plan records zero casualties, so "there WAS blood to score"
      // is vacuous rather than false, and asserting it would fail on a deliberate
      // design decision. The invariant above is the one that caught the exploit
      // and it stands either way: the grade comes from the stored plan, not from
      // the live army. Gated on the same switch every screen reads, so restoring
      // casualties restores this assertion on the same deploy.
      if (BOSS_CASUALTIES) expect(plan.soldiersLost).toBeGreaterThan(0);
    }
  });
});
