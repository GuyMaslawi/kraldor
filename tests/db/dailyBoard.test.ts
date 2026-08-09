import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { gameDay } from "@/lib/game/time";
import { MISSION_BY_KEY, missionRewards } from "@/lib/game/missions";
import { STREAK_LADDER, streakRungRewards } from "@/lib/game/streak";
import { GUILD_CONTRACT_BY_KEY, guildContractReward } from "@/lib/game/guildContract";

/**
 * לוח היום — the three claims, against a real database.
 *
 * All three pay from the treasury and all three are reachable from as many tabs
 * as a player cares to open, so the only question worth asking about them is the
 * one a mock cannot answer: **does the guard hold when the calls arrive
 * together.** Each is guarded a different way, and each way is a property of
 * Postgres rather than of our TypeScript:
 *
 *  - the muster roll is an `updateMany` pinned to the exact `(streakDay,
 *    streakCount)` snapshot the payout was computed from;
 *  - a mission appends its key under `NOT (claimed has key)`;
 *  - a contract share appends the empire id under `NOT (paid has id)`, and the
 *    progress that completes it is a single `UPDATE ... RETURNING` whose "did I
 *    cross the line" test is settled by Postgres' own row lock.
 *
 * The roll's guard is the subtle one and the reason this file leads with it. A
 * plain `streakDay < today` filter would also stop a double claim, but two
 * concurrent calls would both read yesterday's count, both compute `count + 1`,
 * and the second would overwrite the first with the same number — one day, two
 * purses, and a streak column that looks perfectly correct afterwards. Pinning
 * the snapshot means the loser matches no row at all.
 */

let currentEmpireId: string | null = null;

vi.mock("@/lib/auth", () => ({
  getActiveEmpireId: async () => currentEmpireId,
}));

// The actions end by revalidating /game, which needs a request context Next
// only builds while serving one.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { claimStreak, claimMission, collectGuildContract } = await import(
  "@/server/actions/daily"
);

const prisma = new PrismaClient();
const TAG = `dl${Date.now().toString(36)}`;
const TODAY = gameDay(new Date());

/** The mission every fixture here finishes. */
const ARSENAL = MISSION_BY_KEY.get("arsenal")!;

afterAll(async () => {
  await prisma.guild.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeEmpire(label: string, data: Record<string, unknown> = {}) {
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
      wood: 0,
      iron: 0,
      stone: 0,
      turns: 0,
      citizens: 0,
      diamonds: 0,
      // No backlog to settle. Every one of these actions runs the game clock
      // first, and a fixture with hours of production waiting would bury the
      // purse this file is measuring.
      lastRegularUpdateAt: new Date(),
      lastDailyUpdateAt: new Date(),
      army: { create: { soldiers: 0, spies: 0, mineSlaves: 0 } },
      hero: { create: { level: 1 } },
      ...data,
    },
  });
}

const purseOf = async (empireId: string) =>
  prisma.empire.findUniqueOrThrow({
    where: { id: empireId },
    select: { turns: true, iron: true, diamonds: true },
  });

/* ------------------------------ the muster roll ------------------------------ */

describe("signing the muster roll", () => {
  it("pays one rung however many tabs sign at once", async () => {
    const empire = await makeEmpire("roll");
    currentEmpireId = empire.id;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimStreak())
    );
    expect(results.filter((r) => r.success).length).toBe(1);

    const row = await prisma.empire.findUniqueOrThrow({
      where: { id: empire.id },
      select: { streakDay: true, streakCount: true, streakBest: true, turns: true },
    });
    expect(row.streakDay).toBe(TODAY);
    expect(row.streakCount).toBe(1);
    expect(row.streakBest).toBe(1);

    // Day one pays turns, and exactly one day one's worth of them — the figure
    // is what separates "the guard held" from "the guard held seven times".
    const dayOne = streakRungRewards(1, 1).find((r) => r.kind === "turns")!;
    expect(row.turns).toBe(dayOne.amount);
  });

  it("continues a run signed yesterday, and never lowers the record", async () => {
    const empire = await makeEmpire("run", {
      streakDay: TODAY - 1,
      streakCount: 4,
      streakBest: 9,
    });
    currentEmpireId = empire.id;

    expect((await claimStreak()).success).toBeTruthy();
    const continued = await prisma.empire.findUniqueOrThrow({
      where: { id: empire.id },
      select: { streakCount: true, streakBest: true },
    });
    expect(continued.streakCount).toBe(5);
    expect(continued.streakBest).toBe(9);
  });

  it("restarts a lapsed run at one and keeps its high-water mark", async () => {
    // Nothing sweeps a dead streak off the row — the next claim is what notices
    // the gap. That is the whole of rule 4, and it is only true if the *claim*
    // reads the gap correctly rather than trusting the stored count.
    const empire = await makeEmpire("lapsed", {
      streakDay: TODAY - 3,
      streakCount: 6,
      streakBest: 6,
    });
    currentEmpireId = empire.id;

    expect((await claimStreak()).success).toBeTruthy();
    const restarted = await prisma.empire.findUniqueOrThrow({
      where: { id: empire.id },
      select: { streakCount: true, streakBest: true },
    });
    expect(restarted.streakCount).toBe(1);
    expect(restarted.streakBest).toBe(6);
  });

  it("pays the seventh day's diamonds exactly once", async () => {
    const empire = await makeEmpire("week", {
      streakDay: TODAY - 1,
      streakCount: 6,
      streakBest: 6,
    });
    currentEmpireId = empire.id;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimStreak())
    );
    expect(results.filter((r) => r.success).length).toBe(1);

    const seventh = STREAK_LADDER[6].rewards.find((r) => r.kind === "diamonds")!;
    const row = await prisma.empire.findUniqueOrThrow({
      where: { id: empire.id },
      select: { diamonds: true, streakCount: true },
    });
    expect(row.streakCount).toBe(7);
    expect(row.diamonds).toBe(seventh.amount);
  });
});

/* ------------------------------ a mission ------------------------------ */

/**
 * A board holding one finished mission.
 *
 * "Finished" is not a flag anywhere — it is *the counters having moved since the
 * board opened*. `arsenal` is the cheapest honest way to say that: its stat is
 * the number of distinct weapon models held, so one `EmpireWeapon` row against a
 * baseline of zero is a mission done exactly once over.
 */
async function boardWithFinishedMission(empireId: string, baseline = 0) {
  await prisma.empireWeapon.upsert({
    where: { empireId_weaponKey: { empireId, weaponKey: "ATTACK_T1" } },
    create: { empireId, weaponKey: "ATTACK_T1", quantity: 5 },
    update: { quantity: 5 },
  });
  return prisma.missionBoard.create({
    data: {
      empireId,
      scope: "DAY",
      period: TODAY,
      missions: [ARSENAL.key],
      claimed: [],
      // Every other key is absent on purpose: `readBaseline` reads a missing key
      // as zero, and this row is the fixture that says so out loud.
      baseline: { distinctWeapons: baseline },
    },
  });
}

function missionForm(key: string, scope: "DAY" | "WEEK" = "DAY") {
  const form = new FormData();
  form.set("scope", scope);
  form.set("key", key);
  return form;
}

describe("collecting a mission", () => {
  it("pays one purse however many tabs collect together", async () => {
    const empire = await makeEmpire("mission");
    await boardWithFinishedMission(empire.id);
    currentEmpireId = empire.id;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimMission({}, missionForm(ARSENAL.key)))
    );
    expect(results.filter((r) => r.success).length).toBe(1);

    const board = await prisma.missionBoard.findFirstOrThrow({
      where: { empireId: empire.id, scope: "DAY", period: TODAY },
      select: { claimed: true },
    });
    // Appended once rather than eight times: `claimed` is the receipt, and a
    // duplicate inside it is what a second payout would have looked like.
    expect(board.claimed).toEqual([ARSENAL.key]);

    const expected = missionRewards(ARSENAL, "DAY", 1);
    const paid = await purseOf(empire.id);
    expect(paid.turns).toBe(expected.find((r) => r.kind === "turns")!.amount);
    expect(paid.iron).toBe(expected.find((r) => r.kind === "iron")!.amount);

    // And nothing more is payable afterwards.
    expect((await claimMission({}, missionForm(ARSENAL.key))).error).toBeTruthy();
    expect((await purseOf(empire.id)).turns).toBe(paid.turns);
  });

  it("refuses a mission this board was never dealt", async () => {
    const empire = await makeEmpire("wrongmission");
    await boardWithFinishedMission(empire.id);
    currentEmpireId = empire.id;

    expect((await claimMission({}, missionForm("raid"))).error).toBeTruthy();
    expect((await purseOf(empire.id)).turns).toBe(0);
  });

  it("refuses a mission whose counters have not moved since the board opened", async () => {
    // The lifetime total is well past the goal; the *difference* is not. This is
    // the case the whole difference-not-tally design exists to get right, and
    // the one a counter-per-action design would have paid out on.
    const empire = await makeEmpire("unfinished");
    await boardWithFinishedMission(empire.id, 5);
    currentEmpireId = empire.id;

    expect((await claimMission({}, missionForm(ARSENAL.key))).error).toBeTruthy();
    expect((await purseOf(empire.id)).turns).toBe(0);
  });

  it("refuses to collect before the day's board has been opened", async () => {
    // No board row at all. Creating one here would hand the player a board whose
    // baseline is *now* — one they could never have completed, and one that
    // would silently replace the morning they actually played.
    const empire = await makeEmpire("noboard");
    currentEmpireId = empire.id;

    expect((await claimMission({}, missionForm(ARSENAL.key))).error).toBeTruthy();
    expect((await purseOf(empire.id)).turns).toBe(0);
  });
});

/* ------------------------------ the guild contract ------------------------------ */

describe("the guild's daily contract", () => {
  let guildId: string;
  let members: { id: string }[];

  beforeAll(async () => {
    const leader = await makeEmpire("gleader");
    const second = await makeEmpire("gsecond");
    members = [leader, second];

    const guild = await prisma.guild.create({
      data: { name: `${TAG}-guild`, capacityLevel: 9 },
    });
    guildId = guild.id;
    await prisma.guildMember.createMany({
      data: [
        { guildId, empireId: leader.id, role: "LEADER" },
        { guildId, empireId: second.id, role: "MEMBER" },
      ],
    });
  });

  it("stamps completion once, on the mission that crossed the line", async () => {
    const contract = GUILD_CONTRACT_BY_KEY.get("supply")!;
    // A goal of one, so a single member's mission completes it: what is under
    // test is the transition, not the arithmetic — that is the unit suite's.
    await prisma.guildContract.create({
      // `paid: []` is not decoration. Prisma emits scalar lists as a bare
      // `TEXT[]` with no default, so a row inserted without it holds SQL NULL —
      // and `NOT (paid @> ARRAY[id])`, which is how the claim guards itself,
      // evaluates to NULL rather than true against one. The row would read back
      // as an empty array in every UI and be permanently uncollectable. The app
      // writes the empty array explicitly (see openGuildContract); so does this.
      data: { guildId, day: TODAY, key: contract.key, goal: 1, progress: 0, paid: [] },
    });

    await boardWithFinishedMission(members[0].id);
    currentEmpireId = members[0].id;
    expect((await claimMission({}, missionForm(ARSENAL.key))).success).toBeTruthy();

    const row = await prisma.guildContract.findUniqueOrThrow({
      where: { guildId_day: { guildId, day: TODAY } },
    });
    expect(row.progress).toBe(1);
    expect(row.completedAt).not.toBeNull();
    const stampedAt = row.completedAt!;

    // A later mission raises progress and must leave the stamp alone: the payout
    // window is decided by when the contract *completed*, not by the last member
    // to file something.
    await boardWithFinishedMission(members[1].id);
    currentEmpireId = members[1].id;
    expect((await claimMission({}, missionForm(ARSENAL.key))).success).toBeTruthy();

    const later = await prisma.guildContract.findUniqueOrThrow({
      where: { guildId_day: { guildId, day: TODAY } },
    });
    expect(later.progress).toBe(2);
    expect(later.completedAt!.getTime()).toBe(stampedAt.getTime());
  });

  it("pays each member one share however many tabs collect", async () => {
    const contract = GUILD_CONTRACT_BY_KEY.get("supply")!;
    const expected = guildContractReward(contract, 1);

    for (const member of members) {
      currentEmpireId = member.id;
      const before = await purseOf(member.id);

      const results = await Promise.all(
        Array.from({ length: 6 }, () => collectGuildContract())
      );
      expect(results.filter((r) => r.success).length).toBe(1);

      const after = await purseOf(member.id);
      const share = expected.find((r) => r.kind === "turns")!.amount;
      expect(after.turns - before.turns).toBe(share);
    }

    const row = await prisma.guildContract.findUniqueOrThrow({
      where: { guildId_day: { guildId, day: TODAY } },
      select: { paid: true },
    });
    // One receipt per member, with nothing left behind by the losing calls.
    expect([...row.paid].sort()).toEqual(members.map((m) => m.id).sort());
  });

  it("owes nothing to a member who joined after it completed", async () => {
    // Without this the contract is a ladder: join a guild that finished today,
    // collect, leave, repeat down every guild on the server.
    //
    // This is also the test that caught the stamp being written in the database
    // session's own zone rather than in UTC — see the note on `NOW() AT TIME
    // ZONE 'UTC'` in creditGuildContract. A `completedAt` three hours ahead of
    // every other timestamp in the database made every latecomer look early,
    // and the guard below passed anybody who joined inside that window.
    const latecomer = await makeEmpire("late");
    await prisma.guildMember.create({
      data: { guildId, empireId: latecomer.id, role: "MEMBER" },
    });
    currentEmpireId = latecomer.id;

    expect((await collectGuildContract()).error).toBeTruthy();
    expect((await purseOf(latecomer.id)).turns).toBe(0);
  });
});
