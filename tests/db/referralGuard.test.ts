import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  REFERRAL_BURST_LIMIT,
  REFERRAL_GOAL_CITIES,
  REFERRAL_SEASON_CAP,
} from "@/lib/game/referral";

/**
 * The referral guard, against a real database.
 *
 * הזמנת חבר is the only social act in the game that mints diamonds, and adding
 * a shareable link made being both sides of it very cheap: the second account no
 * longer has to be told anything. What replaces that friction is this file's
 * subject — a set of signals, split into the ones that refuse a link outright
 * and the ones that only hold the purse for a human.
 *
 * The split is the thing worth testing, and it is a *product* decision more than
 * a technical one: a shared IP address is a household, a dorm, an office or a
 * carrier's NAT before it is ever a farm, and brothers inviting each other is
 * the most common real referral there is. So every assertion here about
 * `shared_ip` is an assertion that the game did **not** block. See
 * src/server/referralGuard.ts.
 */

const caller = new AsyncLocalStorage<string>();

/** Act as this empire for the duration of one call. */
const as = <T>(empireId: string, run: () => Promise<T>) => caller.run(empireId, run);

vi.mock("@/lib/auth", () => ({
  getActiveEmpireId: async () => caller.getStore() ?? null,
  getSessionUserId: async () => null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * A client address unique to this run.
 *
 * `nameReferrer` is throttled per IP, and the limiter counts in **Postgres** so
 * that it holds across a serverless fleet — which means its buckets also hold
 * across test runs. Outside a request `clientIp()` returns the `"unknown"`
 * sentinel, so every run of every file would share one bucket and the suite
 * would start failing on its third pass for reasons that have nothing to do with
 * referrals. A fresh synthetic address per run keeps the real limiter in the
 * path while giving it a clean window.
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
const { assessReferral, ensureReferralCode } = await import("@/server/referralGuard");

const prisma = new PrismaClient();
const TAG = `rg${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

let seq = 0;

async function makeEmpire(
  label: string,
  opts: {
    email?: string;
    signupIp?: string | null;
    lastLoginIp?: string | null;
    empire?: Record<string, unknown>;
  } = {}
) {
  const slug = `${label}${seq++}`;
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `${slug}@${TAG}.test`,
      name: `${TAG}-${slug}`,
      passwordHash: "x",
      emailVerified: new Date(),
      signupIp: opts.signupIp ?? null,
      lastLoginIp: opts.lastLoginIp ?? null,
    },
  });
  const empire = await prisma.empire.create({
    data: {
      userId: user.id,
      name: `${TAG}-${slug}`,
      cities: 1,
      gold: 0,
      turns: 0,
      citizens: 0,
      diamonds: 0,
      referralFlags: [],
      lastRegularUpdateAt: new Date(),
      lastDailyUpdateAt: new Date(),
      army: { create: { soldiers: 0, spies: 0, mineSlaves: 0 } },
      hero: { create: { level: 1 } },
      ...opts.empire,
    },
  });
  // `ownerId`, not `userId`: the empire row carries a `userId` of its own, and
  // spreading it second would silently overwrite the one the test wants.
  return { ...empire, ownerId: user.id };
}

function nameForm(value: string) {
  const form = new FormData();
  form.set("name", value);
  return form;
}

function inviteeForm(empireId: string) {
  const form = new FormData();
  form.set("empireId", empireId);
  return form;
}

const linkOf = (empireId: string) =>
  prisma.empire.findUniqueOrThrow({
    where: { id: empireId },
    select: { referredById: true, referralReview: true, referralFlags: true },
  });

const diamondsOf = async (empireId: string) =>
  (
    await prisma.empire.findUniqueOrThrow({
      where: { id: empireId },
      select: { diamonds: true },
    })
  ).diamonds;

/* ------------------------------ the code ------------------------------ */

describe("the invite code", () => {
  it("is minted once and never rotates", async () => {
    // A link that has been posted in a group chat has to keep working, so the
    // mint is guarded on `referralCode IS NULL` rather than being an update.
    const host = await makeEmpire("code");
    const first = await ensureReferralCode(host.ownerId);
    const again = await ensureReferralCode(host.ownerId);
    expect(again).toBe(first);

    // Two tabs asking at once still agree on one code.
    const raced = await Promise.all(
      Array.from({ length: 5 }, () => ensureReferralCode(host.ownerId))
    );
    expect(new Set(raced)).toEqual(new Set([first]));
  });

  it("resolves through the referrals field, so a code works like a name", async () => {
    const host = await makeEmpire("codehost");
    const joiner = await makeEmpire("codejoiner");
    const code = await ensureReferralCode(host.ownerId);

    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(code)))).success
    ).toBeTruthy();
    expect((await linkOf(joiner.id)).referredById).toBe(host.id);
  });

  it("survives being pasted as a whole URL with chat-app junk on it", async () => {
    const host = await makeEmpire("urlhost");
    const joiner = await makeEmpire("urljoiner");
    const code = await ensureReferralCode(host.ownerId);

    expect(
      (
        await as(joiner.id, () =>
          nameReferrer({}, nameForm(`https://kraldor.example/r/${code}/?utm_source=wa`))
        )
      ).success
    ).toBeTruthy();
    expect((await linkOf(joiner.id)).referredById).toBe(host.id);
  });
});

/* ------------------------------ hard refusals ------------------------------ */

describe("links that are never made", () => {
  it("refuses two addresses that reach one mailbox", async () => {
    // The laziest alt there is: me+alt@gmail.com inviting me@gmail.com. Two
    // distinct values in a UNIQUE column, one inbox.
    const host = await makeEmpire("mail-a", { email: `farm.er@gmail.${TAG}` });
    const alt = await makeEmpire("mail-b", { email: `farm.er+two@gmail.${TAG}` });
    // Same trick on a real Google domain, where dots are ignored too.
    const gHost = await makeEmpire("gmail-a", { email: `${TAG}er@gmail.com` });
    const gAlt = await makeEmpire("gmail-b", { email: `${TAG}.er+alt@gmail.com` });

    // A non-Google domain keeps its dots, so these two are different people and
    // only the `+tag` collapses them — which it does.
    expect(
      (await as(alt.id, () => nameReferrer({}, nameForm(host.name)))).error
    ).toBeTruthy();
    expect((await linkOf(alt.id)).referredById).toBeNull();

    expect(
      (await as(gAlt.id, () => nameReferrer({}, nameForm(gHost.name)))).error
    ).toBeTruthy();
    expect((await linkOf(gAlt.id)).referredById).toBeNull();
  });

  it("refuses two accounts that have shared a browser", async () => {
    // The one signal sharp enough to block on: a browser profile is one person,
    // where an address is a building.
    const host = await makeEmpire("dev-a");
    const alt = await makeEmpire("dev-b");
    const deviceId = `dev-${TAG}`;
    await prisma.deviceAccount.createMany({
      data: [
        { deviceId, userId: host.ownerId },
        { deviceId, userId: alt.ownerId },
      ],
    });

    expect(
      (await as(alt.id, () => nameReferrer({}, nameForm(host.name)))).error
    ).toBeTruthy();
    expect((await linkOf(alt.id)).referredById).toBeNull();

    await prisma.deviceAccount.deleteMany({ where: { deviceId } });
  });

  it("refuses a ring, however long", async () => {
    // A↔B is the cheapest farm; A→B→C→A costs nothing more to arrange, so one
    // hop of checking is not checking.
    const a = await makeEmpire("ring-a");
    const b = await makeEmpire("ring-b");
    const c = await makeEmpire("ring-c");

    expect((await as(b.id, () => nameReferrer({}, nameForm(a.name)))).success).toBeTruthy();
    expect((await as(c.id, () => nameReferrer({}, nameForm(b.name)))).success).toBeTruthy();
    // C was brought in by B, who was brought in by A — so A cannot now claim C.
    expect((await as(a.id, () => nameReferrer({}, nameForm(c.name)))).error).toBeTruthy();
    expect((await linkOf(a.id)).referredById).toBeNull();
  });

  it("refuses a staff account or a garrison bot as a recruiter", async () => {
    const staff = await makeEmpire("staff", { empire: { isStaff: true } });
    const bot = await makeEmpire("bot", { empire: { isBot: true } });
    const joiner = await makeEmpire("joins-staff");

    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(staff.name)))).error
    ).toBeTruthy();
    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(bot.name)))).error
    ).toBeTruthy();
    expect((await linkOf(joiner.id)).referredById).toBeNull();
  });
});

/* ------------------------------ soft holds ------------------------------ */

describe("a shared address", () => {
  it("makes the link but holds the purse for a human", async () => {
    // The single most important behaviour in this file. Two brothers on one
    // router is the most common REAL referral there is, so the link stands, the
    // progress shows, and only the payout waits.
    const host = await makeEmpire("ip-host", {
      signupIp: "203.0.113.7",
      lastLoginIp: "203.0.113.7",
    });
    const joiner = await makeEmpire("ip-joiner", { signupIp: "203.0.113.7" });

    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(host.name)))).success
    ).toBeTruthy();

    const link = await linkOf(joiner.id);
    expect(link.referredById).toBe(host.id);
    expect(link.referralReview).toBe("HELD");
    expect(link.referralFlags).toContain("shared_ip");

    // Neither half pays while it is held, even at the goal.
    await prisma.empire.update({
      where: { id: joiner.id },
      data: { cities: REFERRAL_GOAL_CITIES },
    });
    expect((await as(joiner.id, () => collectJoinerReward())).error).toBeTruthy();
    expect(
      (await as(host.id, () => collectReferrerReward({}, inviteeForm(joiner.id)))).error
    ).toBeTruthy();
    expect(await diamondsOf(joiner.id)).toBe(0);
    expect(await diamondsOf(host.id)).toBe(0);

    // An admin says it is a real friendship, and both halves pay.
    await prisma.empire.update({
      where: { id: joiner.id },
      data: { referralReview: "APPROVED", referralReviewedAt: new Date() },
    });
    expect((await as(joiner.id, () => collectJoinerReward())).success).toBeTruthy();
    expect(
      (await as(host.id, () => collectReferrerReward({}, inviteeForm(joiner.id)))).success
    ).toBeTruthy();
    expect(await diamondsOf(joiner.id)).toBeGreaterThan(0);
    expect(await diamondsOf(host.id)).toBeGreaterThan(0);
  });

  it("does not match two accounts whose address could not be read", async () => {
    // `clientIpForStorage` writes null rather than a sentinel precisely so that
    // a dev environment does not become one enormous alt ring. Two nulls must
    // never match.
    const host = await makeEmpire("null-host");
    const joiner = await makeEmpire("null-joiner");
    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(host.name)))).success
    ).toBeTruthy();
    const link = await linkOf(joiner.id);
    expect(link.referralReview).toBe("OK");
    expect(link.referralFlags).toEqual([]);
  });
});

describe("a burst of invitees", () => {
  it("holds the ones past the daily limit and leaves the earlier ones alone", async () => {
    const host = await makeEmpire("burst-host");
    const early: string[] = [];
    for (let i = 0; i < REFERRAL_BURST_LIMIT; i++) {
      const joiner = await makeEmpire(`burst-${i}`);
      expect(
        (await as(joiner.id, () => nameReferrer({}, nameForm(host.name)))).success
      ).toBeTruthy();
      early.push(joiner.id);
    }
    for (const id of early) {
      expect((await linkOf(id)).referralReview).toBe("OK");
    }

    const late = await makeEmpire("burst-late");
    expect(
      (await as(late.id, () => nameReferrer({}, nameForm(host.name)))).success
    ).toBeTruthy();
    const link = await linkOf(late.id);
    expect(link.referralReview).toBe("HELD");
    expect(link.referralFlags).toContain("burst");
  });
});

/* --------------------------- re-deriving at claim --------------------------- */

describe("re-deriving the signals when the purse is collected", () => {
  it("holds a link that has gone bad since it was made, and never kills it", async () => {
    // The link is made on the newcomer's first evening and collected days later.
    // Everything worth noticing about a farm happens in between — but a late
    // verdict must be "an admin should look", never "no", or an afternoon spent
    // signing in on a friend's laptop silently destroys a referral both of them
    // earned. See the note on that asymmetry in referralGuard.ts.
    const host = await makeEmpire("late-host");
    const joiner = await makeEmpire("late-joiner", {
      empire: { cities: REFERRAL_GOAL_CITIES },
    });
    // Attached while still small.
    await prisma.empire.update({ where: { id: joiner.id }, data: { cities: 1 } });
    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(host.name)))).success
    ).toBeTruthy();
    expect((await linkOf(joiner.id)).referralReview).toBe("OK");

    // Days pass: they reach the goal, and they have been fighting each other —
    // which is how resources move between two accounts of one person.
    await prisma.empire.update({
      where: { id: joiner.id },
      data: { cities: REFERRAL_GOAL_CITIES },
    });
    await prisma.spyReport.create({
      data: { attackerEmpireId: host.id, defenderEmpireId: joiner.id, success: true },
    });

    expect((await as(joiner.id, () => collectJoinerReward())).error).toBeTruthy();
    const link = await linkOf(joiner.id);
    // Held, not rejected — a human decides.
    expect(link.referralReview).toBe("HELD");
    expect(link.referralFlags).toContain("combat");
    expect(await diamondsOf(joiner.id)).toBe(0);
  });

  it("releases a hold whose cause has gone away", async () => {
    // A queue nobody gets to must not strand an honest pair forever, so a hold
    // caused by a shared carrier address resolves itself once they move off it.
    const host = await makeEmpire("moved-host", { signupIp: "198.51.100.4" });
    const joiner = await makeEmpire("moved-joiner", { signupIp: "198.51.100.4" });
    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(host.name)))).success
    ).toBeTruthy();
    expect((await linkOf(joiner.id)).referralReview).toBe("HELD");

    await prisma.user.update({
      where: { id: joiner.ownerId },
      data: { signupIp: "198.51.100.90", lastLoginIp: "198.51.100.90" },
    });
    await prisma.empire.update({
      where: { id: joiner.id },
      data: { cities: REFERRAL_GOAL_CITIES },
    });

    expect((await as(joiner.id, () => collectJoinerReward())).success).toBeTruthy();
    expect((await linkOf(joiner.id)).referralReview).toBe("OK");
  });

  it("never re-opens what an admin rejected", async () => {
    const host = await makeEmpire("killed-host");
    const joiner = await makeEmpire("killed-joiner");
    expect(
      (await as(joiner.id, () => nameReferrer({}, nameForm(host.name)))).success
    ).toBeTruthy();
    await prisma.empire.update({
      where: { id: joiner.id },
      data: { referralReview: "REJECTED", cities: REFERRAL_GOAL_CITIES },
    });

    // The pair look perfectly clean on re-derivation, and it changes nothing.
    const verdict = await assessReferral(joiner.id, host.id, "claim");
    expect(verdict.flags).toEqual([]);
    expect((await as(joiner.id, () => collectJoinerReward())).error).toBeTruthy();
    expect((await linkOf(joiner.id)).referralReview).toBe("REJECTED");
    expect(await diamondsOf(joiner.id)).toBe(0);
  });
});

/* ------------------------------ the season cap ------------------------------ */

describe("the season cap", () => {
  it("stops paying a referrer past the ceiling", async () => {
    // The bound that survives every other check failing: no undetected scheme,
    // however clever, mints diamonds without limit.
    const host = await makeEmpire("cap-host");
    const day = 24 * 60 * 60 * 1000;

    // Spread the attachments apart so the burst window sees no siblings — this
    // test is about the cap, not about the burst.
    for (let i = 0; i < REFERRAL_SEASON_CAP; i++) {
      const paid = await makeEmpire(`cap-${i}`, {
        empire: { cities: REFERRAL_GOAL_CITIES },
      });
      await prisma.empire.update({
        where: { id: paid.id },
        data: {
          referredById: host.id,
          referredAt: new Date(Date.now() - (i + 2) * 2 * day),
          referrerPaidAt: new Date(),
        },
      });
    }

    const extra = await makeEmpire("cap-extra", {
      empire: { cities: REFERRAL_GOAL_CITIES },
    });
    await prisma.empire.update({
      where: { id: extra.id },
      data: { referredById: host.id, referredAt: new Date() },
    });

    const before = await diamondsOf(host.id);
    expect(
      (await as(host.id, () => collectReferrerReward({}, inviteeForm(extra.id)))).error
    ).toBeTruthy();
    expect(await diamondsOf(host.id)).toBe(before);
    // And the invitee's own half is untouched by the referrer's ceiling — it is
    // not the newcomer's fault that somebody else ran out of slots.
    expect((await as(extra.id, () => collectJoinerReward())).success).toBeTruthy();
  });
});
