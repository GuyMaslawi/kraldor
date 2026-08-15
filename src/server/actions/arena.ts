"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { gameDay, nextGameDayStart } from "@/lib/game/time";
import { formatNumber } from "@/lib/game/format";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  ARENA_ENTRY_TURNS,
  ARENA_MAX_ENTRANTS,
  ARENA_MIN_ENTRANTS,
  ARENA_PODIUM_MIN_ENTRANTS,
  arenaCardFought,
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
 *  - **Opening.** The day's arena for a tier is created on the first look.
 *    Safe to race — the row's identity is `(day, tier)` and the unique index
 *    drops the loser.
 *  - **Resolving.** The *previous* day's card is fought on the first look
 *    after midnight Jerusalem. Guarded on `resolvedAt IS NULL`, so of two
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

/** Today's arena for a tier, created on the first look. */
async function openArena(day: number, tier: number) {
  const existing = await prisma.arena.findUnique({
    where: { day_tier: { day, tier } },
  });
  if (existing) return existing;
  try {
    return await prisma.arena.create({ data: { day, tier } });
  } catch {
    return prisma.arena.findUniqueOrThrow({ where: { day_tier: { day, tier } } });
  }
}

/* ------------------------------ resolve ------------------------------ */

/**
 * Fight a card whose day has ended.
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
 * an empire that grew during the day fights with the army it actually has.
 */
async function resolvePastArenas(tier: number, currentDay: number): Promise<void> {
  const stale = await prisma.arena.findMany({
    where: { tier, day: { lt: currentDay }, resolvedAt: null },
    select: { id: true },
    // A game that has been quiet for a month has a month of unresolved cards,
    // and a daily card makes that seven times as many rows as the weekly one
    // did; resolving them two per page load keeps any single request cheap and
    // still drains a backlog within a few screens.
    orderBy: { day: "asc" },
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
 * The page deliberately shows the arena the viewer can *act on*: today's while
 * it is open, and the last finished one for as long as its spoils are
 * uncollected. A player who won overnight should not have to remember to look
 * before the table is replaced — which matters more now the table is replaced
 * every midnight rather than every Sunday.
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
  const day = gameDay(now);
  const tier = empire.cities;

  // The viewer's own tier, plus any tier they are still owed a card in.
  //
  // A player's tier is their city count, and founding a city moves them. Left
  // as the current tier alone, a card they entered at three cities and a card
  // nobody in that tier is left to load would both go unresolved forever — and
  // an arena resolves on a page load or not at all. Bounded by the number of
  // tiers one empire can have entered in the last few days, which is small.
  const pendingTiers = await prisma.arenaEntry.findMany({
    where: {
      empireId,
      claimed: false,
      arena: { day: { lt: day }, resolvedAt: null },
    },
    select: { arena: { select: { tier: true } } },
    distinct: ["arenaId"],
    take: 8,
  });
  for (const t of new Set([tier, ...pendingTiers.map((p) => p.arena.tier)])) {
    await resolvePastArenas(t, day);
  }

  const current = await openArena(day, tier);

  // An unclaimed finish from an earlier card outranks today's empty one: the
  // spoils are the thing the player came back for.
  //
  // Deliberately **not** filtered to the viewer's current tier. A finish is
  // owed wherever it was fought, and a player who founded a city between the
  // card resolving and coming back to collect would otherwise be shown their new
  // tier's empty card with no way to reach the purse they had won — `place` and
  // `claimed` live on the entry, and the entry does not move when the empire
  // grows. `collectArena` has always paid across tiers; this is the read side
  // catching up with it.
  const unclaimed = await prisma.arenaEntry.findFirst({
    where: {
      empireId,
      claimed: false,
      place: { gt: 0 },
      arena: { day: { lt: day }, resolvedAt: { not: null } },
    },
    select: { arenaId: true, arena: { select: { day: true, resolvedAt: true } } },
    orderBy: { arena: { day: "desc" } },
  });

  const arenaId = unclaimed?.arenaId ?? current.id;
  const arenaDay = unclaimed?.arena.day ?? current.day;
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
    day: arenaDay,
    cities: empire.cities,
    resolvesAt: nextGameDayStart(now).getTime(),
    serverNow: now.getTime(),

    resolved,
    entered: mine !== null,
    entryTurns: ARENA_ENTRY_TURNS,
    turns: empire.turns,
    entrants,
    maxEntrants: ARENA_MAX_ENTRANTS,
    minEntrants: ARENA_MIN_ENTRANTS,
    cardFought: arenaCardFought(entrants),
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

/** Sign up for today's card. */
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

    const day = gameDay(new Date());
    // Outside the transaction — a transaction must not ask for a second
    // connection while holding one.
    const arena = await openArena(day, empire.cities);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
      await applyPendingUpdates(empireId, tx);

      const existing = await tx.arenaEntry.findUnique({
        where: { arenaId_empireId: { arenaId: arena.id, empireId } },
        select: { id: true },
      });
      if (existing) return { error: t("כבר נרשמת לזירה של היום.") };

      // Counted under the lock, not from a read taken before it: a card at its
      // ceiling is the one thing here two concurrent sign-ups could break.
      const entrants = await tx.arenaEntry.count({ where: { arenaId: arena.id } });
      if (entrants >= ARENA_MAX_ENTRANTS) {
        return {
          error: t("הזירה של היום מלאה ({max} משתתפים).", {
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
        throw new UniqueRaceLost(t("כבר נרשמת לזירה של היום."));
      }

      // Rated as an attack: it buys a card of them, but the player fights none
      // of them by hand, so it should not pay like a boss run.
      await awardSeasonPassXp(tx, empireId, "attack");

      return {
        success: t("נרשמת לזירה של היום. הקרבות ייערכו בחצות."),
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

      // The oldest uncollected finish, so a player returning after a week away
      // works through them one screen at a time rather than losing the older
      // ones — with a daily card that is now up to seven tables deep.
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
      // trusted from the screen. It decides both of the thin-card rules: a tier
      // with one entrant ranks that entrant first by arithmetic alone without a
      // duel being fought, so that card is void and pays the entry back
      // (ARENA_MIN_ENTRANTS), and without the second floor the diamonds would be
      // a standing daily grant to anybody alone in a thin tier
      // (ARENA_PODIUM_MIN_ENTRANTS).
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

      // Nobody else turned up, so no duel was fought and there is no result to
      // dress up as one: the entry comes back and the receipt says why.
      if (!arenaCardFought(entrants)) {
        return {
          success: t(
            "הזירה בוטלה — נרשמת לבד ולא היה נגד מי להילחם. {spoils} הוחזרו לך במלואן.",
            { spoils: describeRewards(t, paid) }
          ),
        };
      }

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
