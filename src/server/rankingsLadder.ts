import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isOnline } from "@/lib/game/chat";
import { notStaffOrBot } from "@/lib/bot";
import { getT } from "@/i18n/server";

/**
 * Staff empires are not contestants and are absent from every board in this
 * file — see src/lib/staff.ts. The raw-SQL city ladder cannot spread a Prisma
 * fragment, so it carries the same predicate written out; the two must stay in
 * step.
 *
 * **Bots are the exception, and only here.** A bot is planted in a city tier
 * precisely so the players living there have someone to raid, and a target
 * absent from the one board that lists your own city is a target nobody can
 * find. So the city ladder counts and ranks them like any resident, while every
 * *global* board below — power, spy, slaves, bank, theft — filters them out
 * with `notStaffOrBot`, because those decide who is winning the game and a
 * garrison is not playing it. See src/lib/bot.ts.
 */
const NOT_STAFF_SQL = Prisma.sql`e."isStaff" = false`;

/**
 * The city ladder: every empire in one city tier, ranked by military power.
 *
 * **Nothing here is cached.** This is a game where an attack lands, an army is
 * trained and a rank changes between one breath and the next, so a board that is
 * twenty seconds behind is a board that lies — and it lies worst about the
 * viewer's own row, right after they acted, which reads as a lost action rather
 * than as a stale cache.
 *
 * What makes live affordable is that every read below is **bounded**: ranked,
 * counted and cut *in SQL*, off the denormalised `Empire.militaryPower` column
 * and its `[cities, militaryPower]` index, returning the ten rows the page draws
 * instead of the bucket. It used to be the opposite — power was computed in JS
 * from the army *and every row of the arsenal*, so the page loaded the whole city
 * bucket (and because `Empire.cities` defaults to 1, for the whole early game
 * that bucket was the entire table), sorted it in memory and threw away all but
 * the visible rows. That is what needed a cache in front of it: with AutoRefresh
 * re-running twice a minute per open tab, ten idle spectators cost twenty full
 * scans a minute. A bounded query does not need protecting from spectators.
 *
 * See server/empirePower.ts for what keeps `militaryPower` true.
 */

export interface LadderRow {
  id: string;
  name: string;
  gold: number;
  army: { soldiers: number } | null;
  hero: { level: number; resets: number } | null;
  power: number;
  /**
   * `Empire.title` — the תואר this player is wearing, or null for none.
   *
   * A bare key, resolved against the catalog at render time by WornTitle, never
   * a label or a colour. That is what lets a title be retired by deleting it
   * from src/lib/game/titles.ts: the key stops resolving and quietly disappears
   * from every ladder, with nothing to backfill.
   */
  title: string | null;
  /**
   * Whether this player had the game open in the last few minutes.
   *
   * A boolean, never the timestamp behind it. `Empire.lastSeenAt` is the same
   * heartbeat the chat presence dot reads, and shipping the raw hour of it would
   * hand every reader a free activity log of everyone in their city — when a
   * target sleeps, and therefore when they cannot answer a raid. The dot answers
   * "now or not now" and that is all the ladder needs.
   */
  online: boolean;
}

/** Ranked rows per page. */
export const PAGE_SIZE = 10;

export interface CityLadderPage {
  /** The rows of the page actually served, in rank order. */
  rows: LadderRow[];
  /** Every empire in the tier. */
  total: number;
  /** The viewer's exact rank against the whole tier, 1-based. */
  myRank: number;
  /** The page served — the request clamped to what exists. */
  page: number;
  pageCount: number;
  /** The page holding the viewer's own row. */
  myPage: number;
  /** Rank of `rows[0]`, so the table can number rows by ladder position. */
  firstRank: number;
}

/**
 * The ladder's total order, as one SQL fragment, so the ranking count and the
 * row query can never disagree about it.
 *
 * Ties on raw military power break on the hero — his level, then how many times
 * he has run the curve to 100 — and finally on `id`, which is arbitrary but
 * *stable*: without it, empires tied on all three (every empire in the game at
 * season start, all sitting at zero power) would come back in whatever order
 * Postgres felt like and shuffle between refreshes. A heroless empire counts as
 * level 1, reset 0, matching what the page shows for one.
 *
 * `empire.level` was the old tiebreak — a column gameplay never writes, so it
 * was 1 for everyone and broke nothing.
 */
const LADDER_ORDER = Prisma.sql`
  e."militaryPower" DESC,
  COALESCE(h.level, 1) DESC,
  COALESCE(h.resets, 0) DESC,
  e.id ASC
`;

/**
 * LADDER_ORDER again, spelled as a predicate: does the joined empire sort
 * strictly ahead of `me`? Counting the rows that satisfy it gives the viewer's
 * rank, minus one.
 *
 * The `me` row is the viewer's own, read by the same query rather than passed in
 * by the caller. That is deliberate: the count and the row query must compare the
 * *same* figures, and a caller handing over its own idea of the viewer's power —
 * a settled snapshot, a recomputed total — is exactly how the two would come to
 * disagree and print "rank 5" above a row sitting sixth.
 */
const AHEAD_OF_ME = Prisma.sql`
  e."militaryPower" > me.power
  OR (e."militaryPower" = me.power AND (
    COALESCE(h.level, 1) > me.level
    OR (COALESCE(h.level, 1) = me.level AND (
      COALESCE(h.resets, 0) > me.resets
      OR (COALESCE(h.resets, 0) = me.resets AND e.id < me.id)
    ))
  ))
`;

/**
 * One page of the live city ladder, plus the tier's size and the viewer's exact
 * rank in it.
 *
 * Two bounded round trips, and they must be in this order: the page to serve
 * depends on the rank (asked for no page, you land on your own), and the rank
 * comes from the count. Neither ships more than ten rows.
 *
 * `requestedPage` may be NaN — that is the "no page asked for" case, not an
 * error.
 *
 * A staff viewer is counted out of the tier like everyone else, so they will
 * not find their own row on any page. `myRank` still comes back — it is where
 * they *would* stand — because the caller uses it to pick a default page and a
 * zero there would land them on nothing.
 */
export async function getCityLadderPage(
  cities: number,
  viewerId: string,
  requestedPage: number
): Promise<CityLadderPage> {
  // One pass over the tier that returns two integers: no rows cross the wire.
  // The viewer never counts as ahead of themselves — their own row ties on all
  // four terms — so `ahead + 1` is exactly their rank.
  const [counts] = await prisma.$queryRaw<{ total: bigint; ahead: bigint }[]>`
    WITH me AS (
      SELECT e."militaryPower" AS power,
             COALESCE(h.level, 1) AS level,
             COALESCE(h.resets, 0) AS resets,
             e.id AS id
      FROM "Empire" e
      LEFT JOIN "Hero" h ON h."empireId" = e.id
      WHERE e.id = ${viewerId}
    )
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE ${AHEAD_OF_ME}) AS ahead
    FROM "Empire" e
    LEFT JOIN "Hero" h ON h."empireId" = e.id
    -- LEFT, not CROSS: an unknown viewer must still be counted a tier, not
    -- collapse it to nothing. Their comparisons go NULL and rank falls out as 1.
    LEFT JOIN me ON TRUE
    WHERE e.cities = ${cities} AND ${NOT_STAFF_SQL}
  `;
  const total = Number(counts?.total ?? 0);
  const myRank = Number(counts?.ahead ?? 0) + 1;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Land on the page holding your own row when none was asked for, so the
  // default view answers "where am I" without paging to find out.
  const myPage = Math.min(pageCount, Math.ceil(myRank / PAGE_SIZE));
  const page = Number.isInteger(requestedPage)
    ? Math.min(pageCount, Math.max(1, requestedPage))
    : myPage;
  const firstRank = (page - 1) * PAGE_SIZE + 1;

  // An index scan down [cities, militaryPower], stopping at the page's end. The
  // arsenal is not read at all — it was the bulk of the old query.
  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string;
      gold: number;
      power: number;
      soldiers: number | null;
      level: number | null;
      resets: number | null;
      lastSeenAt: Date | null;
      isBot: boolean;
      title: string | null;
    }[]
  >`
    SELECT e.id, e.name, e.gold, e."militaryPower" AS power,
           e."lastSeenAt", e."isBot", e.title, a.soldiers, h.level, h.resets
    FROM "Empire" e
    LEFT JOIN "Army" a ON a."empireId" = e.id
    LEFT JOIN "Hero" h ON h."empireId" = e.id
    WHERE e.cities = ${cities} AND ${NOT_STAFF_SQL}
    ORDER BY ${LADDER_ORDER}
    LIMIT ${PAGE_SIZE} OFFSET ${firstRank - 1}
  `;

  // One clock for the whole page, so ten rows read against the same instant
  // rather than each against its own — two players last seen the same second
  // must not come back one online and one not.
  const now = new Date();

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      gold: r.gold,
      power: r.power,
      army: r.soldiers === null ? null : { soldiers: r.soldiers },
      title: r.title,
      hero: r.level === null ? null : { level: r.level, resets: r.resets ?? 0 },
      // The viewer is here by definition — they are reading this. Their own
      // heartbeat is stamped by the chat dock's poll, which on a fresh tab has
      // not run yet, so trusting the column alone would draw "לא מחובר" on the
      // one row whose reader knows better.
      online: r.id === viewerId || isOnline(r, now),
    })),
    total,
    myRank,
    page,
    pageCount,
    myPage,
    firstRank,
  };
}

/* ------------------------------ global boards ------------------------------ */

export interface BoardRow {
  empireId: string;
  name: string;
  value: number;
  /**
   * Whether that player has the game open right now — same boolean, same rule
   * and same dot as the city ladder's `LadderRow.online`. A leaderboard is read
   * to pick a target as much as to admire a number, so the top ten say which of
   * them are at the keyboard. Never the timestamp behind it: see the note on
   * LadderRow.online.
   */
  online: boolean;
  /** `Empire.title`, on the same terms as `LadderRow.title`. */
  title: string | null;
  /**
   * The city tier this empire holds (`Empire.cities`), so the board can name the
   * place each row lives in.
   *
   * These boards are global — the one thing they do *not* say, unlike the city
   * ladder where every row shares the viewer's city, is where the leader
   * actually is. That decides whether the reader can do anything about him:
   * spying and attacking are confined to your own city tier.
   *
   * `null` only on the theft board, for a raider whose empire row is gone — the
   * name resolves to a placeholder there and inventing a city for it would be a
   * lie.
   */
  cities: number | null;
}

export type BoardKey = "slaves" | "bank" | "spy" | "power";

export interface GlobalBoards {
  slaves: BoardRow[];
  bank: BoardRow[];
  spy: BoardRow[];
  power: BoardRow[];
  /** Every empire's display name, for boards resolved by id (the theft board). */
  names: Map<string, string>;
}

/**
 * Rows each global board shows.
 *
 * Five, not ten. Six boards share this page and every one of them is a *global*
 * board — the whole game competing for the same handful of lines — so a long tail
 * says nothing a reader can use: past the top few the names are interchangeable
 * and the page turns into five hundred pixels of scrolling. The city ladder is
 * where a player finds their own neighbourhood, and that still pages ten at a
 * time (PAGE_SIZE); this page is the podium.
 */
const BOARD_SIZE = 5;

/**
 * The four cross-game boards, top five each — four indexed `ORDER BY … LIMIT 5`
 * queries, live.
 *
 * This was the worst query in the app: **global**, not one city bucket, it
 * loaded every empire in the game with its army, arsenal and bank account,
 * mapped the lot, and threw away all but forty rows — on every page load and
 * again every thirty seconds per open tab, with no rate limit on RSC GETs. The
 * old comment said it plainly: the cheapest way for any logged-in player to put
 * the database under sustained full-scan load. That is what the TTL that used to
 * sit here was defending.
 *
 * Two of the four boards (`slaves`, `bank`) could always have been ordered in
 * SQL; the other two could not, because `spy` and `power` were computed in JS.
 * Now that those live on indexed columns all four are, twenty rows come back
 * instead of the table, and there is nothing left to defend — so the boards move
 * the moment the game does.
 */
export async function getGlobalBoards(): Promise<GlobalBoards> {
  // One `now` for all four boards, so a player who happens to sit on two of them
  // cannot come back online on one and away on the other.
  const now = new Date();

  const top = async (
    orderBy: Prisma.EmpireOrderByWithRelationInput,
    pick: (e: {
      id: string;
      name: string;
      generalPower: number;
      spyPower: number;
      army: { mineSlaves: number } | null;
      bankAccount: { goldBalance: number } | null;
    }) => number
  ): Promise<BoardRow[]> => {
    const rows = await prisma.empire.findMany({
      where: notStaffOrBot,
      orderBy,
      take: BOARD_SIZE,
      select: {
        id: true,
        name: true,
        cities: true,
        title: true,
        generalPower: true,
        spyPower: true,
        lastSeenAt: true,
        // Never true here — the board filters bots out — but presence is read
        // off the row as a whole, one rule everywhere (see isOnline).
        isBot: true,
        army: { select: { mineSlaves: true } },
        bankAccount: { select: { goldBalance: true } },
      },
    });
    return rows
      .map((e) => ({
        empireId: e.id,
        name: e.name,
        value: Math.floor(pick(e)),
        // The heartbeat is collapsed to a boolean here and the Date is dropped:
        // what ships to the browser must not be the timestamp itself.
        online: isOnline(e, now),
        title: e.title,
        // Public knowledge — the city ladder already names every empire in your
        // own tier, and the boss banner names the tier itself.
        cities: e.cities,
      }))
      // A board of empires with nothing to show is noise, not a ranking.
      .filter((r) => r.value > 0);
  };

  const [slaves, bank, spy, power] = await Promise.all([
    top({ army: { mineSlaves: "desc" } }, (e) => e.army?.mineSlaves ?? 0),
    top({ bankAccount: { goldBalance: "desc" } }, (e) => e.bankAccount?.goldBalance ?? 0),
    top({ spyPower: "desc" }, (e) => e.spyPower),
    top({ generalPower: "desc" }, (e) => e.generalPower),
  ]);

  // Names for the theft board, which is aggregated off BattleReport and comes
  // back as ids. Scoped to the ids that board can actually produce rather than
  // every empire in the game.
  const names = new Map(
    [...slaves, ...bank, ...spy, ...power].map((r) => [r.empireId, r.name])
  );

  return { slaves, bank, spy, power, names };
}

/**
 * Puts names, presence and cities on rows that came back from an aggregate as
 * bare empire ids.
 *
 * The raid boards below are grouped off `BattleReport`, which knows only the
 * attacker's id. Resolving them here rather than through `GlobalBoards.names` is
 * deliberate: that map only covers empires that made one of the four standing
 * boards, and a raider need not be on any of them.
 */
async function nameRaidRows(
  sums: { attackerEmpireId: string; total: number }[]
): Promise<BoardRow[]> {
  const t = await getT();
  const named = await prisma.empire.findMany({
    where: { id: { in: sums.map((s) => s.attackerEmpireId) } },
    select: { id: true, name: true, cities: true, title: true, lastSeenAt: true, isBot: true },
  });
  const byId = new Map(named.map((e) => [e.id, e]));
  // One clock for the board, as everywhere else here.
  const now = new Date();
  return sums.map((row) => ({
    empireId: row.attackerEmpireId,
    name: byId.get(row.attackerEmpireId)?.name ?? t("אימפריה"),
    value: Math.floor(row.total),
    // A raider whose empire row has since been deleted reads as away, which is
    // the truthful answer for a name that is no longer anybody — and holds no
    // city at all, rather than a made-up one.
    online: isOnline(byId.get(row.attackerEmpireId), now),
    // A deleted raider has no row and therefore no title, which is the honest
    // answer — the name already degrades to a placeholder here.
    title: byId.get(row.attackerEmpireId)?.title ?? null,
    cities: byId.get(row.attackerEmpireId)?.cities ?? null,
  }));
}

/**
 * Staff raids are excluded at the source rather than filtered out of the top
 * five afterwards: dropping a row after `take` would silently serve a four-row
 * board. Bots never attack anyone, so they cost these boards nothing — they are
 * in the filter only so the rule stays one rule.
 */
const RAIDER_WHERE = { attackerEmpire: notStaffOrBot } as const;

/**
 * Biggest thefts since `cutoff` — total gold plundered in winning attacks.
 *
 * Aggregated and cut in SQL off `BattleReport(createdAt)`, so a raid shows up on
 * the board as soon as it is fought.
 */
export async function getTheftBoard(cutoff: Date): Promise<BoardRow[]> {
  const sums = await prisma.battleReport.groupBy({
    by: ["attackerEmpireId"],
    where: { createdAt: { gte: cutoff }, stolenGold: { gt: 0 }, ...RAIDER_WHERE },
    _sum: { stolenGold: true },
    orderBy: { _sum: { stolenGold: "desc" } },
    take: BOARD_SIZE,
  });
  return nameRaidRows(
    sums.map((r) => ({ attackerEmpireId: r.attackerEmpireId, total: r._sum.stolenGold ?? 0 }))
  );
}

/**
 * Biggest enslavements since `cutoff` — defenders' soldiers taken prisoner in
 * winning attacks and put to work in the mines.
 *
 * The sibling of the theft board, and deliberately not of the `slaves` board
 * above: that one ranks the *stock* a player is sitting on, most of which was
 * bought, while this ranks what they took off other players in the window. Same
 * shape, same source, same period toggle — a raid pays in gold and in bodies,
 * and the page now says who is collecting each.
 */
export async function getEnslavementBoard(cutoff: Date): Promise<BoardRow[]> {
  const sums = await prisma.battleReport.groupBy({
    by: ["attackerEmpireId"],
    where: { createdAt: { gte: cutoff }, enslavedSoldiers: { gt: 0 }, ...RAIDER_WHERE },
    _sum: { enslavedSoldiers: true },
    orderBy: { _sum: { enslavedSoldiers: "desc" } },
    take: BOARD_SIZE,
  });
  return nameRaidRows(
    sums.map((r) => ({ attackerEmpireId: r.attackerEmpireId, total: r._sum.enslavedSoldiers ?? 0 }))
  );
}
