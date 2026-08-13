import "server-only";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notStaffOrBot } from "@/lib/bot";
import { newEmpireData } from "@/lib/game/createEmpire";
import { getTunables, type GameTunables } from "@/lib/game/config";
import { BUILDING_TYPES, isProductionBuilding } from "@/lib/game/constants";
import { WEAPON_CATEGORIES } from "@/lib/game/weapons";
import { computePower } from "@/server/empirePower";
import {
  BOT_RESTORE_MS,
  botFallbackName,
  botGarrison,
  botHeroLevel,
  botMineSetup,
  botName,
  botRealisedPower,
  botWeaponKeys,
  type BotGarrison,
} from "@/lib/game/bots";

/**
 * Planting and refilling bot empires.
 *
 * A bot is a whole empire, built through the same `newEmpireData` every
 * registration goes through and then armed: nothing downstream — the battle
 * resolver, the spy dossier, the lazy clock, the ladder — knows or needs to know
 * that no one is behind it. That is deliberate. The alternative, a synthetic
 * defender assembled at attack time, would have meant a second implementation of
 * every rule in the game and a second set of bugs; here a bot loses soldiers to
 * enslavement, produces from its mines and gets settled by the same code that
 * does it for a player.
 *
 * The arithmetic — names, the fixed garrison, the mines — lives in
 * src/lib/game/bots.ts, which is pure and tested. This module is the I/O.
 */

/**
 * Where bot accounts live. A real, unique, syntactically-valid address on a
 * domain that cannot receive mail: the `User` row needs one (it is unique and
 * NOT NULL), and nothing must ever be deliverable to it.
 *
 * `.invalid` is reserved by RFC 2606 precisely for this — it is guaranteed never
 * to be delegated, so a stray verification or broadcast mail cannot escape to a
 * real inbox belonging to someone else.
 */
const BOT_EMAIL_DOMAIN = "bots.kraldor.invalid";

/** Attempts to find a free generated name before falling back to an ordinal. */
const NAME_ATTEMPTS = 12;

/**
 * How long the unattended seeding is allowed to spend planting.
 *
 * The season opening is a page load like any other — one player's, whoever
 * happened to arrive first — and it has already paid for the world rebuild by
 * the time it gets here. Thirty-five garrisons is a few seconds of small
 * transactions; the budget is there so a slow database costs the field its tail
 * rather than costing that player an error page on the first screen of the
 * season.
 */
const BOT_SEED_BUDGET_MS = 20_000;

export interface BotPlan {
  /** City tier this bot is planted in (`Empire.cities`). */
  cities: number;
  name: string;
  heroLevel: number;
  /** Military power actually fielded — what lands in `Empire.militaryPower`. */
  power: number;
  garrison: BotGarrison;
}

/**
 * A free empire name for a bot.
 *
 * Empire names are unique, and the generator's space is a few hundred wide, so
 * collisions are ordinary rather than exceptional once a game has bots in it.
 * The taken set is passed in (not re-queried per name) so planting twenty bots
 * in one submit is one read, and it is updated by the caller as names are handed
 * out — two bots created in the same batch must not both take "בני הנחושת".
 */
function freeName(taken: Set<string>): string {
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
    const candidate = botName((n) => randomInt(n));
    if (!taken.has(candidate)) return candidate;
  }
  // Every roll landed on a taken name. Walk an ordinal off the last candidate
  // until something is free — this always terminates, and produces a name that
  // still reads as a dynasty rather than as a database counter.
  const base = botName((n) => randomInt(n));
  for (let ordinal = 2; ; ordinal++) {
    const candidate = botFallbackName(base, ordinal);
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * What a batch of bots would look like, without writing anything. The admin page
 * uses it to preview, and `createBots` uses it to build.
 */
export async function planBots(params: {
  cities: number[];
  perCity: number;
}): Promise<BotPlan[]> {
  const taken = new Set(
    (await prisma.empire.findMany({ select: { name: true } })).map((e) => e.name)
  );

  const plans: BotPlan[] = [];
  for (const cities of params.cities) {
    const heroLevel = botHeroLevel(cities);
    for (let i = 0; i < params.perCity; i++) {
      const name = freeName(taken);
      taken.add(name);
      // Every bot in every city gets the same garrison; only the name, the city
      // and the hero level differ. See BOT_SOLDIERS for why there is nothing to
      // size any more.
      const garrison = botGarrison(cities, heroLevel);
      plans.push({
        cities,
        name,
        heroLevel,
        power: botRealisedPower(garrison),
        garrison,
      });
    }
  }
  return plans;
}

/* ------------------------------ planting ------------------------------ */

/**
 * Create one bot empire from a plan, inside the caller's transaction.
 *
 * Built on `newEmpireData` — the same starter empire a registration gets — and
 * then edited into a resident of its city: the city tier, the garrison, the
 * hero, and mines sized to feed it. Three fields of that starter deliberately do
 * NOT survive:
 *
 *   - `protectedUntil`, the new-player shield, which would make the target
 *     unattackable for its first couple of hours — the one thing a bot must never be;
 *   - `diamonds`, because a bot that can be gifted or spied for a diamond
 *     balance is a bot that looks like it might spend one;
 *   - the welcome message, which is addressed to a person.
 */
async function plantBot(
  tx: Prisma.TransactionClient,
  plan: BotPlan,
  seasonId: string | undefined,
  starting: GameTunables["starting"]
): Promise<string> {
  const user = await tx.user.create({
    data: {
      // `User.email` is unique, so it has to be built rather than derived from
      // anything about the bot: 12 random digits plus the millisecond, which
      // cannot collide even between two bots planted in the same batch.
      email: `bot.${randomInt(1e12)}.${Date.now().toString(36)}@${BOT_EMAIL_DOMAIN}`,
      name: plan.name,
      // No password and no verified address: there is no way to sign in as a
      // bot, by design. `login` refuses a row whose `passwordHash` is null
      // outright — it still runs the bcrypt compare against a dummy so the
      // timing stays flat, but the result is not allowed to grant a session —
      // and every gameplay entry point gates on `emailVerified` besides.
      passwordHash: null,
      emailVerified: null,
    },
    select: { id: true },
  });

  const data = newEmpireData(user.id, plan.name, seasonId, starting);
  data.cities = plan.cities;
  data.diamonds = 0;
  data.protectedUntil = null;
  delete data.messages;

  // Mines sized to the tier the bot lives in — this is where every resource a
  // raider ever takes off it comes from.
  const mines = botMineSetup(plan.cities);
  data.buildings = {
    create: BUILDING_TYPES.map((type) => ({
      type,
      level: isProductionBuilding(type) ? mines.level : 1,
      slavesAssigned: isProductionBuilding(type) ? mines.slavesPerMine : 0,
    })),
  };

  data.army = {
    create: {
      soldiers: plan.garrison.soldiers,
      spies: plan.garrison.spies,
      // `mineSlaves` is the *total* the empire owns and `slavesAssigned` is how
      // many of them stand in each mine — `applyAssignments` refuses any split
      // whose sum exceeds it. So the pool has to cover what was just assigned
      // above, or the bot is an empire holding fewer slaves than it employs.
      mineSlaves: mines.slavesPerMine * BUILDING_TYPES.filter(isProductionBuilding).length,
    },
  };

  const keys = botWeaponKeys(plan.garrison.weaponTier);
  data.weapons = {
    create: [
      { weaponKey: keys.attack, quantity: plan.garrison.attackWeapons },
      { weaponKey: keys.defense, quantity: plan.garrison.defenseWeapons },
      { weaponKey: keys.spy, quantity: plan.garrison.spyWeapons },
    ].filter((w) => w.weaponKey && w.quantity > 0),
  };
  // The unlocks are granted in all three categories even though every stack is
  // empty — so a spy dossier reads as an empire of this city with a bare
  // armoury, rather than as one that never reached the weapons it plainly could.
  data.weaponUnlocks = {
    create: WEAPON_CATEGORIES.map((category) => ({
      category,
      unlockedTier: plan.garrison.weaponTier,
    })),
  };

  const empire = await tx.empire.create({
    data: { ...data, isBot: true },
    select: { id: true },
  });

  // The hero comes out of newEmpireData at level 1. Its level is what the city
  // ladder breaks ties on and what a profile shows, so it is set to the tier's;
  // its points are left unspent on purpose — an allocated point is +1% attack or
  // defence, and a bot must fight at exactly the power printed beside it.
  await tx.hero.updateMany({
    where: { empireId: empire.id },
    data: { level: plan.heroLevel },
  });

  await tx.empireBot.create({
    data: {
      empireId: empire.id,
      targetPower: plan.power,
      soldiers: plan.garrison.soldiers,
      spies: plan.garrison.spies,
      weaponTier: plan.garrison.weaponTier,
      attackWeapons: plan.garrison.attackWeapons,
      defenseWeapons: plan.garrison.defenseWeapons,
      spyWeapons: plan.garrison.spyWeapons,
    },
  });

  // The denormalised figures every board and the ladder read. Written here for
  // the same reason every other army write does it — see server/empirePower.ts.
  const figures = computePower(
    { soldiers: plan.garrison.soldiers, spies: plan.garrison.spies },
    [
      { weaponKey: keys.attack, quantity: plan.garrison.attackWeapons },
      { weaponKey: keys.defense, quantity: plan.garrison.defenseWeapons },
      { weaponKey: keys.spy, quantity: plan.garrison.spyWeapons },
    ]
  );
  await tx.empire.updateMany({ where: { id: empire.id }, data: figures });

  return empire.id;
}

/**
 * Plant a batch of bots. Each bot is its own transaction rather than one
 * transaction for the batch: a name that collided with a registration that
 * landed between the plan and the write must cost that one bot, not the other
 * nineteen — and a batch of fifty in a single transaction would hold locks
 * across fifty empire creations while the game is being played around it.
 */
export async function createBots(
  plans: BotPlan[],
  budgetMs?: number
): Promise<{ created: number; failed: number; skipped: number; reason?: string }> {
  const { starting } = await getTunables();
  const season = await prisma.gameSeason.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  // A wall-clock budget for callers that are not an admin waiting on a form —
  // the season opening plants its field inside the page load that opened the
  // season, and that request must come back. Untimed by default: the admin's
  // own batch is bounded by BOT_BATCH_MAX and is allowed to take what it takes.
  const deadline = budgetMs === undefined ? Infinity : Date.now() + budgetMs;

  let created = 0;
  let failed = 0;
  let skipped = 0;
  let reason: string | undefined;
  for (const plan of plans) {
    if (Date.now() >= deadline) {
      // Not a failure: a short field is a playable field, and `ensureCityBots`
      // plants the rest the next time it is asked for them.
      skipped++;
      continue;
    }
    try {
      await prisma.$transaction((tx) => plantBot(tx, plan, season?.id, starting));
      created++;
    } catch (e) {
      // A unique-constraint clash on the name is the expected failure and is not
      // worth aborting the batch for; anything else is worth the log line.
      console.error("[bots] failed to plant", plan.name, e);
      failed++;
      // Kept for the admin, because "try again" is the wrong advice for most of
      // these: a batch that fails on every bot fails for a reason that will not
      // change on a retry, and the admin had no way to see it. First failure
      // only — fifty copies of one message is not more informative than one.
      reason ??= e instanceof Error ? e.message.split("\n").slice(-1)[0].trim() : String(e);
    }
  }
  return { created, failed, skipped, reason };
}

/**
 * Bring a city tier up to a standing number of garrisons, planting only the
 * shortfall — the opening field of a new season.
 *
 * Written as "make it so" rather than "plant thirty-five" because it runs
 * unattended, after the transaction that opened the season has already
 * committed. If the request that ran it dies halfway through, the world is left
 * with fewer bots and not with none, and calling it again tops the tier up
 * instead of doubling it. That is also what makes it safe on the carry-over
 * path, where last season's garrisons are still standing: they are counted, and
 * nothing is planted on top of them.
 *
 * Not a mutex. Two callers racing it would each plant the shortfall and
 * overshoot, which is why the one caller is inside the season-open claim (see
 * server/seasonClose.ts) — the only writer at that moment, by construction.
 */
export async function ensureCityBots(
  cities: number,
  target: number,
  budgetMs = BOT_SEED_BUDGET_MS
): Promise<{ created: number; failed: number; skipped: number; standing: number }> {
  const wanted = Math.max(0, Math.floor(target));
  const standing = await prisma.empire.count({ where: { isBot: true, cities } });
  const missing = wanted - standing;
  if (missing <= 0) return { created: 0, failed: 0, skipped: 0, standing };

  const plans = await planBots({ cities: [cities], perCity: missing });
  const result = await createBots(plans, budgetMs);
  return { ...result, standing: standing + result.created };
}

/* ------------------------------ refilling ------------------------------ */

/** The three arsenal rows a garrison is stored as. */
function garrisonWeapons(bot: {
  weaponTier: number;
  attackWeapons: number;
  defenseWeapons: number;
  spyWeapons: number;
}): { weaponKey: string; quantity: number }[] {
  const keys = botWeaponKeys(bot.weaponTier);
  return [
    { weaponKey: keys.attack, quantity: bot.attackWeapons },
    { weaponKey: keys.defense, quantity: bot.defenseWeapons },
    { weaponKey: keys.spy, quantity: bot.spyWeapons },
  ].filter((w) => w.weaponKey);
}

/**
 * Set a bot's army and arsenal back to the garrison it was built with, at most
 * once per {@link BOT_RESTORE_MS}.
 *
 * Called from `applyPendingUpdates` — the lazy clock — which is exactly where it
 * belongs: a bot is loaded and settled at the moment somebody looks at it as a
 * target, so it is rebuilt just before it is fought and never on a timer nobody
 * is waiting on. There is no scheduler in this game and this feature does not
 * introduce one.
 *
 * Returns whether it actually wrote, so the caller can re-read the empire it is
 * about to fight with: `attackEmpire` resolves the battle off `defender.army`
 * and `defender.weapons`, and a refill the battle could not see would be a
 * refill that arrives one raid late.
 *
 * The claim on `restoredAt` is the whole concurrency story. It is guarded on the
 * exact timestamp that was read, so of two raiders arriving together only one
 * rebuilds — the other reads the rebuilt row. Resources are pointedly not
 * touched: a bot's purse is what its own mines have produced since it was last
 * robbed, never a stipend paid on a clock.
 */
export async function restoreBotGarrison(
  tx: Prisma.TransactionClient,
  empireId: string,
  now: Date
): Promise<boolean> {
  const bot = await tx.empireBot.findUnique({ where: { empireId } });
  // No row is not an error: an empire can carry the flag without a garrison if
  // an admin set it by hand. Nothing to restore it to, so nothing to do.
  if (!bot) return false;
  if (now.getTime() - bot.restoredAt.getTime() < BOT_RESTORE_MS) return false;

  const claimed = await tx.empireBot.updateMany({
    where: { empireId, restoredAt: bot.restoredAt },
    data: { restoredAt: now },
  });
  if (claimed.count === 0) return false;

  const weapons = garrisonWeapons(bot);
  await tx.army.updateMany({
    where: { empireId },
    data: { soldiers: bot.soldiers, spies: bot.spies },
  });
  for (const weapon of weapons) {
    await tx.empireWeapon.upsert({
      where: { empireId_weaponKey: { empireId, weaponKey: weapon.weaponKey } },
      create: { empireId, ...weapon },
      update: { quantity: weapon.quantity },
    });
  }

  // The columns the ladder ranks by, brought up to what was just written — the
  // same rule every other army write follows (see server/empirePower.ts).
  await tx.empire.updateMany({
    where: { id: empireId },
    data: computePower({ soldiers: bot.soldiers, spies: bot.spies }, weapons),
  });
  return true;
}

/**
 * Rebuild a bot's garrison now, ignoring the clock — the admin list's "re-arm"
 * button, for a bot that was farmed flat and is wanted back immediately.
 */
export async function rearmBot(empireId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const empire = await tx.empire.findUnique({
      where: { id: empireId },
      select: { isBot: true },
    });
    if (!empire?.isBot) return false;
    // Backdated past the cooldown so the refill below is unconditional, while
    // still going through the one code path that knows how to do it.
    await tx.empireBot.updateMany({
      where: { empireId },
      data: { restoredAt: new Date(0) },
    });
    return restoreBotGarrison(tx, empireId, new Date());
  });
}

/**
 * Remove a bot: the user row goes, and the empire and its garrison cascade off
 * it. Deleting the account rather than just the empire is the point — a bot's
 * `User` exists only to satisfy `Empire.userId`, and leaving orphans behind
 * would inflate every player count in the admin.
 */
export async function deleteBot(empireId: string): Promise<boolean> {
  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: { userId: true, isBot: true },
  });
  if (!empire?.isBot) return false;
  await prisma.user.delete({ where: { id: empire.userId } });
  return true;
}

/** Every bot, newest first, with the garrison it is rebuilt to. */
export async function listBots() {
  return prisma.empireBot.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      empire: {
        select: {
          id: true,
          name: true,
          cities: true,
          militaryPower: true,
          gold: true,
          army: { select: { soldiers: true, spies: true } },
          hero: { select: { level: true } },
        },
      },
    },
  });
}

/** How many bots stand in each city tier — the admin page's "where are they" row. */
export async function botsPerCity(): Promise<Map<number, number>> {
  const rows = await prisma.empire.groupBy({
    by: ["cities"],
    where: { isBot: true },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.cities, r._count._all]));
}

/** Real residents per city tier, so the admin can see which cities are lonely. */
export async function playersPerCity(): Promise<Map<number, number>> {
  const rows = await prisma.empire.groupBy({
    by: ["cities"],
    where: notStaffOrBot,
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.cities, r._count._all]));
}
