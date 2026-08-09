import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { notifyPlayer, NOTIFY_COOLDOWN_MS } from "@/server/notify";

/**
 * Who the raid notifier will and will not write to.
 *
 * The gate that matters here is the ban, and it is the house rule stated at the
 * top of lib/ban.ts: **a ban is two columns.** `bannedAt` records that one was
 * handed down; `bannedUntil` says when it lifts. Nothing sweeps the row when
 * that deadline passes, so a gate reading `bannedAt` alone treats a three-day
 * ban served last March as permanent — and this notifier is the one channel
 * that reaches a player who is not looking at the game, so cutting them off
 * silently is the failure nobody would notice.
 *
 * The cooldown claim is tested alongside it because the two share one WHERE
 * clause: the ban filter and the cooldown filter are both disjunctions, and
 * merging them wrongly would let a banned player through on the strength of
 * their cooldown having expired.
 *
 * `isMailLive()` is false with no provider configured, so `sendMail` logs
 * instead of sending and the claim behaves identically either way — which is
 * what makes this runnable at all.
 */

const prisma = new PrismaClient();
const TAG = `nb${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.empire.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.$disconnect();
});

async function makePlayer(
  name: string,
  ban: { bannedAt: Date | null; bannedUntil: Date | null } = {
    bannedAt: null,
    bannedUntil: null,
  }
) {
  const user = await prisma.user.create({
    data: {
      email: `${name}@${TAG}.test`,
      name: `${TAG}-${name}`,
      passwordHash: "x",
      emailVerified: new Date(),
      notifyRaids: true,
      ...ban,
    },
  });
  const empire = await prisma.empire.create({
    data: {
      userId: user.id,
      name: `${TAG}-${name}`,
      gold: 0,
      turns: 0,
      citizens: 0,
    },
  });
  return { user, empire };
}

const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

describe("the raid notifier's ban gate", () => {
  it("writes to a player who has never been banned", async () => {
    const { empire } = await makePlayer("clean");
    expect(await notifyPlayer(empire.id, "raid")).toBe(true);
  });

  it("stays silent while a timed ban is still running", async () => {
    const { empire } = await makePlayer("serving", {
      bannedAt: ago(86_400_000),
      bannedUntil: ahead(86_400_000),
    });
    expect(await notifyPlayer(empire.id, "raid")).toBe(false);
  });

  it("stays silent for a permanent ban", async () => {
    const { empire } = await makePlayer("forever", {
      bannedAt: ago(86_400_000),
      bannedUntil: null,
    });
    expect(await notifyPlayer(empire.id, "raid")).toBe(false);
  });

  it("writes again once a timed ban has lapsed", async () => {
    // The regression. `bannedAt` is still set — it always will be, nothing
    // clears it — but the ban expired yesterday and the player is back.
    const { empire } = await makePlayer("served", {
      bannedAt: ago(7 * 86_400_000),
      bannedUntil: ago(86_400_000),
    });
    expect(await notifyPlayer(empire.id, "raid")).toBe(true);
  });
});

describe("the raid notifier's rationing", () => {
  it("sends once inside the quiet period, however many raids land", async () => {
    const { empire } = await makePlayer("farmed");
    const results = await Promise.all([
      notifyPlayer(empire.id, "raid"),
      notifyPlayer(empire.id, "raid"),
      notifyPlayer(empire.id, "sabotage"),
      notifyPlayer(empire.id, "spy"),
    ]);
    expect(results.filter(Boolean).length).toBe(1);
  });

  it("sends again once the quiet period is behind them", async () => {
    const { user, empire } = await makePlayer("returning");
    expect(await notifyPlayer(empire.id, "raid")).toBe(true);
    await prisma.user.update({
      where: { id: user.id },
      data: { notifiedAt: ago(NOTIFY_COOLDOWN_MS + 60_000) },
    });
    expect(await notifyPlayer(empire.id, "raid")).toBe(true);
  });

  it("never writes to somebody who switched them off", async () => {
    const { user, empire } = await makePlayer("optedout");
    await prisma.user.update({
      where: { id: user.id },
      data: { notifyRaids: false },
    });
    expect(await notifyPlayer(empire.id, "raid")).toBe(false);
  });

  it("never writes to a staff account or a garrison bot", async () => {
    const { empire: staff } = await makePlayer("staff");
    await prisma.empire.update({
      where: { id: staff.id },
      data: { isStaff: true },
    });
    expect(await notifyPlayer(staff.id, "raid")).toBe(false);

    const { empire: bot } = await makePlayer("bot");
    await prisma.empire.update({ where: { id: bot.id }, data: { isBot: true } });
    expect(await notifyPlayer(bot.id, "raid")).toBe(false);
  });
});
