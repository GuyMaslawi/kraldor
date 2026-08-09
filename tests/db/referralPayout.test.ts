import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  REFERRAL_GOAL_CITIES,
  REFERRAL_NAME_MAX_CITIES,
  joinerReward,
  referrerReward,
} from "@/lib/game/referral";

/**
 * הזמנת חבר — the two halves of the purse, against a real database.
 *
 * This is the only feature in the game that *mints* diamonds on a social act, so
 * it is also the only one where a duplicate payout is a duplicate currency. Both
 * halves are guarded by stamping a timestamp under a `NULL` filter, and both
 * receipts deliberately live on the **newcomer's** row:
 *
 *  - `referralPaidAt` — the newcomer's own half;
 *  - `referrerPaidAt` — what the referrer is owed for that newcomer.
 *
 * Putting the referrer's receipt on the invitee rather than on the referrer is
 * what makes one referrer's many invitees independent of each other, and it is
 * the arrangement this file leans on: several invitees collected at once must
 * pay several purses, while several tabs collecting the *same* invitee must pay
 * one.
 *
 * The goal is checked against the newcomer's **live** city count rather than a
 * stamp, so a referral is never owed for an account abandoned on the way there.
 */

const caller = new AsyncLocalStorage<string>();

/** Act as this empire for the duration of one call. */
const as = <T>(empireId: string, run: () => Promise<T>) =>
  caller.run(empireId, run);

vi.mock("@/lib/auth", () => ({
  getActiveEmpireId: async () => caller.getStore() ?? null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * A client address unique to this run — `nameReferrer` is throttled per IP, and
 * the limiter counts in Postgres, so its buckets outlive the test run. See the
 * longer note in tests/db/referralGuard.test.ts.
 */
const { RUN_IP } = vi.hoisted(() => ({
  RUN_IP: `test-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...real, clientIp: async () => RUN_IP };
});

const { collectJoinerReward, collectReferrerReward, nameReferrer } = await import(
  "@/server/actions/referral"
);

const prisma = new PrismaClient();
const TAG = `rf${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makeEmpire(
  label: string,
  data: Record<string, unknown> = {}
) {
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
      turns: 0,
      citizens: 0,
      diamonds: 0,
      lastRegularUpdateAt: new Date(),
      lastDailyUpdateAt: new Date(),
      army: { create: { soldiers: 0, spies: 0, mineSlaves: 0 } },
      hero: { create: { level: 1 } },
      ...data,
    },
  });
}

const purseOf = (empireId: string) =>
  prisma.empire.findUniqueOrThrow({
    where: { id: empireId },
    select: { diamonds: true, turns: true, citizens: true },
  });

function nameForm(name: string) {
  const form = new FormData();
  form.set("name", name);
  return form;
}

function inviteeForm(empireId: string) {
  const form = new FormData();
  form.set("empireId", empireId);
  return form;
}

/* ------------------------------ naming ------------------------------ */

describe("naming a referrer", () => {
  it("is a one-time act inside the newcomer's first cities", async () => {
    const host = await makeEmpire("host");
    const joiner = await makeEmpire("joiner");

    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(host.name)))).success
    ).toBeTruthy();
    expect(
      (
        await prisma.empire.findUniqueOrThrow({
          where: { id: joiner.id },
          select: { referredById: true },
        })
      ).referredById
    ).toBe(host.id);

    // Named once, and no shopping around afterwards.
    const other = await makeEmpire("other");
    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(other.name)))).error
    ).toBeTruthy();
  });

  it("closes once the newcomer has outgrown the window", async () => {
    const host = await makeEmpire("host2");
    const established = await makeEmpire("established", {
      cities: REFERRAL_NAME_MAX_CITIES + 1,
    });

    expect(
      (await as(established.id, () => nameReferrer({}, nameForm(host.name)))).error
    ).toBeTruthy();
    expect(
      (
        await prisma.empire.findUniqueOrThrow({
          where: { id: established.id },
          select: { referredById: true },
        })
      ).referredById
    ).toBeNull();
  });

  it("refuses a circle", async () => {
    // A ↔ B naming each other is the cheapest possible farm, and the only one
    // that costs nothing at all to set up.
    const a = await makeEmpire("circle-a");
    const b = await makeEmpire("circle-b");

    expect((await as(b.id, () => nameReferrer({}, nameForm(a.name)))).success).toBeTruthy();
    expect((await as(a.id, () => nameReferrer({}, nameForm(b.name)))).error).toBeTruthy();
  });
});

/* ------------------------------ collecting ------------------------------ */

describe("the newcomer's half", () => {
  it("is owed nothing before the goal and paid once after it", async () => {
    const host = await makeEmpire("host3");
    const joiner = await makeEmpire("joiner3", {
      referredById: host.id,
      cities: REFERRAL_GOAL_CITIES - 1,
    });

    expect((await as(joiner.id, () => collectJoinerReward())).error).toBeTruthy();
    expect((await purseOf(joiner.id)).diamonds).toBe(0);

    await prisma.empire.update({
      where: { id: joiner.id },
      data: { cities: REFERRAL_GOAL_CITIES },
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => as(joiner.id, () => collectJoinerReward()))
    );
    expect(results.filter((r) => r.success).length).toBe(1);

    const expected = joinerReward(REFERRAL_GOAL_CITIES);
    const paid = await purseOf(joiner.id);
    expect(paid.diamonds).toBe(expected.find((r) => r.kind === "diamonds")!.amount);
    expect(paid.citizens).toBe(expected.find((r) => r.kind === "citizens")!.amount);

    expect((await as(joiner.id, () => collectJoinerReward())).error).toBeTruthy();
    expect((await purseOf(joiner.id)).diamonds).toBe(paid.diamonds);
  });

  it("is owed nothing by a newcomer who named nobody", async () => {
    const alone = await makeEmpire("alone", { cities: REFERRAL_GOAL_CITIES });
    expect((await as(alone.id, () => collectJoinerReward())).error).toBeTruthy();
    expect((await purseOf(alone.id)).diamonds).toBe(0);
  });
});

describe("the referrer's half", () => {
  it("pays one purse per invitee, however many tabs collect", async () => {
    const host = await makeEmpire("host4");
    const [first, second] = await Promise.all([
      makeEmpire("inv1", { referredById: host.id, cities: REFERRAL_GOAL_CITIES }),
      makeEmpire("inv2", { referredById: host.id, cities: REFERRAL_GOAL_CITIES }),
    ]);

    // Six tabs on the *same* invitee: one purse.
    const raced = await Promise.all(
      Array.from({ length: 6 }, () =>
        as(host.id, () => collectReferrerReward({}, inviteeForm(first.id)))
      )
    );
    expect(raced.filter((r) => r.success).length).toBe(1);

    const one = referrerReward(1).find((r) => r.kind === "diamonds")!.amount;
    expect((await purseOf(host.id)).diamonds).toBe(one);

    // A different invitee is a different receipt, so it pays again.
    expect(
      (await as(host.id, () => collectReferrerReward({}, inviteeForm(second.id)))).success
    ).toBeTruthy();
    expect((await purseOf(host.id)).diamonds).toBe(one * 2);
  });

  it("cannot be collected against somebody else's invitee", async () => {
    // The claim is scoped to *this* referrer, so a guessed or stale id reaches
    // nothing — without that scope the invitee id is a bearer token.
    const host = await makeEmpire("host5");
    const stranger = await makeEmpire("stranger");
    const theirs = await makeEmpire("theirs", {
      referredById: stranger.id,
      cities: REFERRAL_GOAL_CITIES,
    });

    expect(
      (await as(host.id, () => collectReferrerReward({}, inviteeForm(theirs.id)))).error
    ).toBeTruthy();
    expect((await purseOf(host.id)).diamonds).toBe(0);
    // And the real referrer's claim is untouched by the attempt.
    expect(
      (await as(stranger.id, () => collectReferrerReward({}, inviteeForm(theirs.id))))
        .success
    ).toBeTruthy();
  });

  it("owes nothing for an invitee who stopped short of the goal", async () => {
    const host = await makeEmpire("host6");
    const quitter = await makeEmpire("quitter", {
      referredById: host.id,
      cities: REFERRAL_GOAL_CITIES - 1,
    });

    expect(
      (await as(host.id, () => collectReferrerReward({}, inviteeForm(quitter.id)))).error
    ).toBeTruthy();
    expect((await purseOf(host.id)).diamonds).toBe(0);
  });
});
