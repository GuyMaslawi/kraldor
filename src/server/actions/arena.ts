"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { gameWeek, nextGameWeekStart } from "@/lib/game/time";
import { formatNumber } from "@/lib/game/format";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  ARENA_ENTRY_TURNS,
  ARENA_MAX_ENTRANTS,
  arenaReward,
  rankArena,
  resolveArena,
  type ArenaStanding,
  type ArenaState,
} from "@/lib/game/arena";
import { payRewards } from "@/server/rewardGrant";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT, type T } from "@/i18n/server";

/**
 * הזירה — entering, resolving and collecting.
 *
 * The whole feature runs on the clock with nothing scheduled behind it, the
 * same way the world boss and the mission boards do. Three moments:
 *
 *  - **Opening.** The week's arena for a tier is created on the first look.
 *    Safe to race — the row's identity is `(week, tier)` and the unique index
 *    drops the loser.
 *  - **Resolving.** The *previous* week's card is fought on the first look
 *    after the week turned over. Guarded on `resolvedAt IS NULL`, so of two
 *    players loading the page at the same second exactly one fights the card
 *    and the other reads the table it wrote.
 *  - **Collecting.** A flag flip per entrant, like every other claim here.
 */

async function requireOwnEmpireId(): Promise<string> {
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the catch returns a translated line.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

function describeRewards(t: T, rewards: readonly Reward[]): string {
  return rewards
    .filter((r) => r.amount > 0)
    .map((r) =>
      t("{amount} {resource}", {
        amount: formatNumber(r.amount),
        resource: t(REWARD_LABEL[r.kind]),
      })
    )
    .join(", ");
}

/* ------------------------------ open ------------------------------ */

/** This week's arena for a tier, created on the first look. */
async function openArena(week: number, tier: number) {
  const existing = await prisma.arena.findUnique({
    where: { week_tier: { week, tier } },
  });
  if (existing) return existing;
  try {
    return await prisma.arena.create({ data: { week, tier } });
  } catch {
    return prisma.arena.findUniqueOrThrow({ where: { week_tier: { week, tier } } });
  }
}

/* ------------------------------ resolve ------------------------------ */

/**
 * Fight a card whose week has ended.
 *
 * The claim comes first and does all the work of making this safe: the guarded
 * UPDATE that stamps `resolvedAt` is what decides whether *this* call resolves
 * the arena, so two concurrent page loads cannot both write a table. Everything
 * after it is arithmetic — the duels are pure and seeded (see resolveArena), so
 * the winner of the race produces the only table there ever was.
 *
 * The power figures are read live, at this moment, rather than at registration:
 * an empire that grew during the week fights with the army it actually has.
 */
async function resolvePastArenas(tier: number, currentWeek: number): Promise<void> {
  const stale = await prisma.arena.findMany({
    where: { tier, week: { lt: currentWeek }, resolvedAt: null },
    select: { id: true },
    // A game that has been quiet for a month has a month of unresolved cards;
    // resolving them one page load at a time keeps any single request cheap.
    orderBy: { week: "asc" },
    take: 2,
  });

  for (const arena of stale) {
    const claimed = await prisma.arena.updateMany({
      where: { id: arena.id, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const entries = await prisma.arenaEntry.findMany({
      where: { arenaId: arena.id },
      select: { id: true, empireId: true, empire: { select: { militaryPower: true } } },
      take: ARENA_MAX_ENTRANTS,
    });
    if (entries.length === 0) continue;

    const fighters = entries.map((e) => ({
      id: e.empireId,
      power: e.empire.militaryPower,
    }));
    const powerById = new Map(fighters.map((f) => [f.id, f.power]));
    const ranked = rankArena(resolveArena(arena.id, fighters), powerById);
    const byEmpire = new Map(entries.map((e) => [e.empireId, e.id]));

    // One update per entrant rather than a bulk write: the figures differ per
    // row, and an arena is bounded at ARENA_MAX_ENTRANTS by design.
    await prisma.$transaction(
      ranked.map((result, index) =>
        prisma.arenaEntry.update({
          where: { id: byEmpire.get(result.id)! },
          data: {
            wins: result.wins,
            losses: result.losses,
            place: index + 1,
            power: powerById.get(result.id) ?? 0,
          },
        })
      )
    );
  }
}

/* ------------------------------ read ------------------------------ */

/** Rows shown on the table. Beyond this it is a scroll, not a table. */
const TABLE_SIZE = 40;

/**
 * Everything the arena screen renders — and the only place a card is opened or
 * resolved.
 *
 * The page deliberately shows the arena the viewer can *act on*: this week's
 * while it is open, and last week's for as long as its spoils are uncollected.
 * A player who won on Sunday should not have to remember to look before the
 * table is replaced.
 */
export async function getArenaState(): Promise<ArenaState | null> {
  const empireId = await getActiveEmpireId();
  if (empireId === null) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: { cities: true, turns: true },
  });
  if (!empire) return null;

  const now = new Date();
  const week = gameWeek(now);
  const tier = empire.cities;

  await resolvePastArenas(tier, week);
  const current = await openArena(week, tier);

  // An unclaimed finish from last week outranks this week's empty card: the
  // spoils are the thing the player came back for.
  const unclaimed = await prisma.arenaEntry.findFirst({
    where: {
      empireId,
      claimed: false,
      place: { gt: 0 },
      arena: { tier, week: { lt: week }, resolvedAt: { not: null } },
    },
    select: { arenaId: true, arena: { select: { week: true, resolvedAt: true } } },
    orderBy: { arena: { week: "desc" } },
  });

  const arenaId = unclaimed?.arenaId ?? current.id;
  const arenaWeek = unclaimed?.arena.week ?? current.week;
  const resolved = unclaimed !== null || current.resolvedAt !== null;

  const [entries, entrants, mine] = await Promise.all([
    prisma.arenaEntry.findMany({
      where: { arenaId },
      orderBy: resolved
        ? [{ place: "asc" }]
        : [{ createdAt: "asc" }],
      take: TABLE_SIZE,
      select: {
        empireId: true,
        wins: true,
        losses: true,
        place: true,
        empire: { select: { name: true } },
      },
    }),
    prisma.arenaEntry.count({ where: { arenaId } }),
    prisma.arenaEntry.findUnique({
      where: { arenaId_empireId: { arenaId, empireId } },
      select: { place: true, wins: true, claimed: true },
    }),
  ]);

  const standings: ArenaStanding[] = entries.map((row) => ({
    empireId: row.empireId,
    empireName: row.empire.name,
    wins: row.wins,
    losses: row.losses,
    place: row.place,
    isMe: row.empireId === empireId,
  }));

  return {
    tier,
    week: arenaWeek,
    resolvesAt: nextGameWeekStart(now).getTime(),
    serverNow: now.getTime(),

    resolved,
    entered: mine !== null,
    entryTurns: ARENA_ENTRY_TURNS,
    turns: empire.turns,
    entrants,
    maxEntrants: ARENA_MAX_ENTRANTS,

    standings,
    myPlace: mine?.place ?? 0,
    claimable: resolved && (mine?.place ?? 0) > 0 && !(mine?.claimed ?? false),
    claimed: mine?.claimed ?? false,
    reward: arenaReward(mine?.place ?? 0, mine?.wins ?? 0, empire.cities),
  };
}

/* ------------------------------ enter ------------------------------ */

/** Sign up for this week's card. */
export async function enterArena(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const empire = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { cities: true },
    });
    if (!empire) return { error: t("אירעה שגיאה, נסה שוב") };

    const week = gameWeek(new Date());
    // Outside the transaction — a transaction must not ask for a second
    // connection while holding one.
    const arena = await openArena(week, empire.cities);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
      await applyPendingUpdates(empireId, tx);

      const existing = await tx.arenaEntry.findUnique({
        where: { arenaId_empireId: { arenaId: arena.id, empireId } },
        select: { id: true },
      });
      if (existing) return { error: t("כבר נרשמת לזירה של השבוע.") };

      // Counted under the lock, not from a read taken before it: a card at its
      // ceiling is the one thing here two concurrent sign-ups could break.
      const entrants = await tx.arenaEntry.count({ where: { arenaId: arena.id } });
      if (entrants >= ARENA_MAX_ENTRANTS) {
        return {
          error: t("הזירה של השבוע מלאה ({max} משתתפים).", {
            max: ARENA_MAX_ENTRANTS,
          }),
        };
      }

      const paid = await tx.empire.updateMany({
        where: { id: empireId, turns: { gte: ARENA_ENTRY_TURNS } },
        data: { turns: { decrement: ARENA_ENTRY_TURNS } },
      });
      if (paid.count === 0) {
        return {
          error: t("הרשמה לזירה עולה {turns} תורות.", { turns: ARENA_ENTRY_TURNS }),
        };
      }

      try {
        await tx.arenaEntry.create({ data: { arenaId: arena.id, empireId } });
      } catch {
        // Lost the race with another tab. Caught rather than rethrown: a failed
        // statement poisons a Postgres transaction, so the refund has to happen
        // here.
        await tx.empire.update({
          where: { id: empireId },
          data: { turns: { increment: ARENA_ENTRY_TURNS } },
        });
        return { error: t("כבר נרשמת לזירה של השבוע.") };
      }

      // Rated as an attack: it buys a card of them, but the player fights none
      // of them by hand, so it should not pay like a boss run.
      await awardSeasonPassXp(tx, empireId, "attack");

      return {
        success: t("נרשמת לזירה של השבוע. הקרבות ייערכו כשהשבוע יסתיים."),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("arena.enterArena", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ collect ------------------------------ */

/** Take the spoils of a finished card. */
export async function collectArena(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
      const empire = await applyPendingUpdates(empireId, tx);

      // The oldest uncollected finish, so a player returning after a fortnight
      // works through them rather than losing the older one.
      const entry = await tx.arenaEntry.findFirst({
        where: {
          empireId,
          claimed: false,
          place: { gt: 0 },
          arena: { resolvedAt: { not: null } },
        },
        select: { id: true, place: true, wins: true },
        orderBy: { createdAt: "asc" },
      });
      if (!entry) return { error: t("אין לך שלל זירה לאסוף.") };

      const claimed = await tx.arenaEntry.updateMany({
        where: { id: entry.id, claimed: false },
        data: { claimed: true },
      });
      if (claimed.count === 0) return { error: t("כבר אספת את השלל הזה.") };

      const paid = await payRewards(
        tx,
        empireId,
        arenaReward(entry.place, entry.wins, empire.cities)
      );

      return {
        success: t("מקום {place} בזירה, {wins} ניצחונות. קיבלת {spoils}.", {
          place: entry.place,
          wins: entry.wins,
          spoils: describeRewards(t, paid),
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("arena.collectArena", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
