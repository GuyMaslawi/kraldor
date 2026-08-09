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
  ARENA_PODIUM_MIN_ENTRANTS,
  arenaPodiumPays,
  arenaReward,
  rankArena,
  resolveArena,
  type ArenaStanding,
  type ArenaState,
} from "@/lib/game/arena";
import { payRewards } from "@/server/rewardGrant";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import { UniqueRaceLost, uniqueRaceMessage } from "@/server/uniqueRace";
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
 * The stamp and the table are **one transaction**, and that is the whole
 * safety story. The guarded UPDATE on `resolvedAt IS NULL` decides whether
 * *this* call resolves the arena, so two concurrent page loads cannot both
 * write a table; wrapping the entrant rows in with it means a request that dies
 * between the two — a cold Vercel function hitting its ceiling mid-resolution —
 * rolls the stamp back rather than leaving the card marked resolved with every
 * `place` still 0, which would make its spoils permanently unclaimable. There
 * is no scheduler behind this to repair such a card.
 *
 * The duels themselves are pure and seeded (see resolveArena), so the winner of
 * the race produces the only table there ever was.
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
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.arena.updateMany({
        where: { id: arena.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
      if (claimed.count === 0) return;

      const entries = await tx.arenaEntry.findMany({
        where: { arenaId: arena.id },
        select: { id: true, empireId: true, empire: { select: { militaryPower: true } } },
        take: ARENA_MAX_ENTRANTS,
      });
      if (entries.length === 0) return;

      const fighters = entries.map((e) => ({
        id: e.empireId,
        power: e.empire.militaryPower,
      }));
      const powerById = new Map(fighters.map((f) => [f.id, f.power]));
      const ranked = rankArena(resolveArena(arena.id, fighters), powerById);
      const byEmpire = new Map(entries.map((e) => [e.empireId, e.id]));

      // One update per entrant rather than a bulk write: the figures differ per
      // row, and an arena is bounded at ARENA_MAX_ENTRANTS by design.
      for (const [index, result] of ranked.entries()) {
        await tx.arenaEntry.update({
          where: { id: byEmpire.get(result.id)! },
          data: {
            wins: result.wins,
            losses: result.losses,
            place: index + 1,
            power: powerById.get(result.id) ?? 0,
          },
        });
      }
    });
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

  // The viewer's own tier, plus any tier they are still owed a card in.
  //
  // A player's tier is their city count, and founding a city moves them. Left
  // as the current tier alone, a card they entered at three cities and a card
  // nobody in that tier is left to load would both go unresolved forever — and
  // an arena resolves on a page load or not at all. Bounded by the number of
  // tiers one empire can have entered in the last few weeks, which is small.
  const pendingTiers = await prisma.arenaEntry.findMany({
    where: {
      empireId,
      claimed: false,
      arena: { week: { lt: week }, resolvedAt: null },
    },
    select: { arena: { select: { tier: true } } },
    distinct: ["arenaId"],
    take: 8,
  });
  for (const t of new Set([tier, ...pendingTiers.map((p) => p.arena.tier)])) {
    await resolvePastArenas(t, week);
  }

  const current = await openArena(week, tier);

  // An unclaimed finish from last week outranks this week's empty card: the
  // spoils are the thing the player came back for.
  //
  // Deliberately **not** filtered to the viewer's current tier. A finish is
  // owed wherever it was fought, and a player who founded a city between the
  // week ending and coming back to collect would otherwise be shown their new
  // tier's empty card with no way to reach the purse they had won — `place` and
  // `claimed` live on the entry, and the entry does not move when the empire
  // grows. `collectArena` has always paid across tiers; this is the read side
  // catching up with it.
  const unclaimed = await prisma.arenaEntry.findFirst({
    where: {
      empireId,
      claimed: false,
      place: { gt: 0 },
      arena: { week: { lt: week }, resolvedAt: { not: null } },
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
        empire: { select: { name: true, title: true } },
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
    title: row.empire.title,
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
    podiumMinEntrants: ARENA_PODIUM_MIN_ENTRANTS,
    podiumPays: arenaPodiumPays(entrants),

    standings,
    myPlace: mine?.place ?? 0,
    claimable: resolved && (mine?.place ?? 0) > 0 && !(mine?.claimed ?? false),
    claimed: mine?.claimed ?? false,
    // Priced against the count of *this* card — the same figure the claim will
    // read — so a thin tier's preview never promises a podium it will not pay.
    reward: arenaReward(mine?.place ?? 0, mine?.wins ?? 0, empire.cities, entrants),
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
      select: { cities: true, isStaff: true, isBot: true },
    });
    if (!empire) return { error: t("אירעה שגיאה, נסה שוב") };

    // Staff accounts are out of the game — untargetable and unranked — and the
    // arena is a ranked board with a purse. A staff entry would both occupy a
    // seat and appear on a table it has no business being on. See
    // Empire.isStaff.
    if (empire.isStaff || empire.isBot) {
      return { error: t("חשבונות הנהלה אינם משתתפים בזירה.") };
    }

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
        // Lost the race with another tab. The turns are given back by the
        // rollback this throw causes — a refund written here would be dead
        // code, because the violation has already aborted the transaction. See
        // server/uniqueRace.ts.
        throw new UniqueRaceLost(t("כבר נרשמת לזירה של השבוע."));
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
    // A lost sign-up race is an outcome, not a fault: the rollback has already
    // returned the turns, and there is nothing here worth logging.
    const raced = uniqueRaceMessage(err);
    if (raced) return { error: raced };
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
        select: { id: true, arenaId: true, place: true, wins: true },
        orderBy: { createdAt: "asc" },
      });
      if (!entry) return { error: t("אין לך שלל זירה לאסוף.") };

      // The size of the card that was actually fought, counted here rather than
      // trusted from the screen. This is what decides whether a placing is worth
      // a podium purse: a tier with one entrant ranks that entrant first by
      // arithmetic alone, and without this the diamonds would be a standing
      // weekly grant to anybody alone in a thin tier. See
      // ARENA_PODIUM_MIN_ENTRANTS.
      const entrants = await tx.arenaEntry.count({
        where: { arenaId: entry.arenaId },
      });

      const claimed = await tx.arenaEntry.updateMany({
        where: { id: entry.id, claimed: false },
        data: { claimed: true },
      });
      if (claimed.count === 0) return { error: t("כבר אספת את השלל הזה.") };

      const paid = await payRewards(
        tx,
        empireId,
        arenaReward(entry.place, entry.wins, empire.cities, entrants)
      );

      const podium = entry.place <= 3 && arenaPodiumPays(entrants);
      return {
        success: podium || entry.place > 3
          ? t("מקום {place} בזירה, {wins} ניצחונות. קיבלת {spoils}.", {
              place: entry.place,
              wins: entry.wins,
              spoils: describeRewards(t, paid),
            })
          : // A podium finish on a card too small to pay one. Said plainly
            // rather than silently paying less than the table promised.
            t(
              "מקום {place} בזירה, {wins} ניצחונות. קיבלת {spoils} — פרסי הפודיום נפתחים מ-{min} משתתפים.",
              {
                place: entry.place,
                wins: entry.wins,
                spoils: describeRewards(t, paid),
                min: ARENA_PODIUM_MIN_ENTRANTS,
              }
            ),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("arena.collectArena", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
