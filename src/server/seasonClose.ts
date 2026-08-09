import "server-only";
import { cache } from "react";
import type { Prisma, SeasonBoardKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatGameDateTime, formatWaitDuration } from "@/lib/game/time";
import { announceToDiscord, gameLink } from "@/server/discord";
import { notStaffOrBot } from "@/lib/bot";
import { prizeForRank } from "@/lib/game/prizes";
import { formatNumber } from "@/lib/game/format";
import { getTunables, type GameTunables } from "@/lib/game/config";
import {
  nextSeasonName,
  nextSeasonWindow,
  seasonHeadline,
  seasonLengthMs,
} from "@/lib/game/seasonCycle";
import { restartWorld } from "@/server/seasonRestart";
import { makeT } from "@/i18n/translate";
import { DEFAULT_LOCALE } from "@/i18n/locale";

/**
 * The season cycle: the end of one season, the break, and the start of the next.
 *
 * A season is a fixed window: it starts at `startsAt` and it is over at
 * `endsAt`. When the clock runs out the game does not keep going quietly — the
 * season is sealed, its final standings are archived, and **the whole site
 * shuts** until the next season's `startsAt` arrives. In between, all anyone
 * can reach is `/season`: the recap of what just happened plus a countdown to
 * the next one. (`/game` is shut by `requireEmpire`, everything in front of it
 * by server/seasonGuard.ts.)
 *
 * ## The cycle turns by itself
 *
 * Sealing a season also **books its successor** — `scheduleNextSeason`, inside
 * the closing transaction, from two numbers the admin sets once
 * (`season.breakHours`, `season.lengthDays` in lib/game/config.ts) — and the
 * successor's name is the same name with its number raised by one. When its
 * hour comes, `openSeason` opens it and **restarts the world**: every empire
 * back to the opening bundle with its diamonds, every guild dissolved. So the
 * full loop — play, seal, break, wipe, play again — runs with nobody at the
 * wheel, and an admin who wants a hand in it turns off `autoNext` (stay shut
 * until I say so) or `autoRestart` (open without wiping).
 *
 * ## Why this is lazy, and why that is safe
 *
 * There is no cron in this deployment (see the lazy game clock in
 * lib/game/updates.ts and the lazy war rounds in lib/game/guildWar.ts — same
 * story). So the close runs on whichever request first observes `endsAt` in the
 * past. `getSeasonGate` is called from `requireEmpire` and `getActiveEmpireId`,
 * which between them front every page load and every server action, so the
 * first person to touch the game after the deadline pays for the close and
 * everybody else lands on an already-closed season.
 *
 * That makes the close a race by construction: a hundred requests can cross
 * `endsAt` in the same millisecond. The mutex is the guarded write, exactly as
 * with resource spending (`updateMany` with the precondition in the WHERE — see
 * lib/game/updates.ts):
 *
 *     updateMany({ where: { id, closedAt: null }, data: { closedAt: now } })
 *
 * Exactly one of those reports `count === 1`; that request, and only it, writes
 * the champions and the recap. Everyone else reads the finished archive. The
 * whole thing runs in one transaction so a season can never end up sealed with
 * an empty hall of fame.
 *
 * ## Why nothing here is a join
 *
 * The admin's season reset deletes every Empire and Guild row in the game. A
 * champion of season 1 has to outlive the empire that won it, so the archive is
 * a pure snapshot: names, numbers and a bare (unconstrained) empire id kept
 * only as a breadcrumb. Same for `recap` — it is frozen JSON, not a query the
 * recap page re-runs.
 */

/** Podium places kept per season in היכל התהילה. */
export const PODIUM_SIZE = 3;

/** Rows kept per board of היכל התהילה — כוח כללי, ריגול and הברית החזקה. */
export const HALL_BOARD_SIZE = 5;

/** Rows shown per category on the season recap. */
export const RECAP_BOARD_SIZE = 5;

/* ----------------------------- recap shape ----------------------------- */

export interface RecapRow {
  name: string;
  value: number;
  /** Secondary line — guild, city, whatever the category ranks by context. */
  note?: string;
}

export interface RecapBoard {
  key: string;
  title: string;
  /** Icon name from components/ui/Icon. */
  icon: string;
  rows: RecapRow[];
}

export interface SeasonRecapTotals {
  empires: number;
  guilds: number;
  battles: number;
  goldPlundered: number;
  soldiersLost: number;
  soldiersEnslaved: number;
}

/**
 * The frozen story of a finished season. Versioned because it is stored JSON:
 * a shape change must not make every previously archived season unreadable.
 */
export interface SeasonRecap {
  version: 1;
  totals: SeasonRecapTotals;
  boards: RecapBoard[];
}

/** Narrow stored JSON back to a recap, tolerating anything older or malformed. */
export function readRecap(value: Prisma.JsonValue | null): SeasonRecap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as unknown as SeasonRecap;
  return r.version === 1 && Array.isArray(r.boards) ? r : null;
}

/* ---------------------------- building it ---------------------------- */

export interface ChampionSnapshot {
  rank: number;
  empireId: string;
  empireName: string;
  /**
   * `Empire.title` — the תואר the seat holder is wearing *now*.
   *
   * Live only. It is read here because `buildPodium` is deliberately the one
   * function that ranks a podium (see its note: two queries that merely looked
   * alike would drift on the one night it matters), so the prize screen cannot
   * get its rows anywhere else. It is dropped again at the archive insert —
   * `SeasonChampion` has no column for it, and freezing one would be a schema
   * change in service of a decoration on a board about a finished season.
   */
  title: string | null;
  playerName: string | null;
  guildName: string | null;
  power: number;
  cities: number;
  heroLevel: number;
}

/**
 * The final standings, read at closing time.
 *
 * Ranked off the denormalised `Empire.militaryPower` column — the same figure
 * the ladder ranked by all season, so the archive says what players actually
 * saw. Ties break on the hero, matching `getCityLadder`. Global, not per city:
 * "the top of the season" is one podium for the whole game.
 */
async function buildPodium(
  tx: Prisma.TransactionClient
): Promise<ChampionSnapshot[]> {
  const empires = await tx.empire.findMany({
    // Neither staff nor bots are contestants, and neither can take a podium
    // place — see src/lib/staff.ts and src/lib/bot.ts. The podium pays 10,000
    // diamonds for first, so this is a payout filter, not a cosmetic one.
    // Excluded here rather than after the sort, so an admin or a garrison
    // sitting at the top of the power column does not cost the podium a rank.
    where: notStaffOrBot,
    orderBy: { militaryPower: "desc" },
    // Over-read a little so the hero tiebreak has something to reorder.
    take: PODIUM_SIZE * 4,
    select: {
      id: true,
      name: true,
      cities: true,
      title: true,
      militaryPower: true,
      user: { select: { name: true } },
      hero: { select: { level: true, resets: true } },
      guildMembership: { select: { guild: { select: { name: true } } } },
    },
  });

  return empires
    .sort(
      (a, b) =>
        b.militaryPower - a.militaryPower ||
        (b.hero?.level ?? 1) - (a.hero?.level ?? 1) ||
        (b.hero?.resets ?? 0) - (a.hero?.resets ?? 0)
    )
    .slice(0, PODIUM_SIZE)
    .map((e, i) => ({
      rank: i + 1,
      empireId: e.id,
      empireName: e.name,
      title: e.title,
      playerName: e.user?.name ?? null,
      guildName: e.guildMembership?.guild.name ?? null,
      power: Math.floor(e.militaryPower),
      cities: e.cities,
      heroLevel: e.hero?.level ?? 1,
    }));
}

/**
 * The podium **as it stands right now**, outside any transaction.
 *
 * Same function the close runs, deliberately: the prize screen promises
 * diamonds to three specific seats, so it must rank exactly the way the archive
 * will — same power column, same hero tiebreak, same exclusion of staff. Two
 * queries that merely look alike would drift, and the drift would only show up
 * on the one night it matters.
 *
 * Nothing here is cached: a podium seat can change hands with a single attack,
 * and the read is bounded (twelve rows) — see server/rankingsLadder.ts.
 */
export async function getLivePodium(): Promise<ChampionSnapshot[]> {
  return buildPodium(prisma);
}

/** One archived row of one hall board, before it is given its season stamps. */
export interface HallBoardSnapshot {
  kind: SeasonBoardKind;
  rank: number;
  empireId: string | null;
  name: string;
  playerName: string | null;
  note: string | null;
  value: number;
}

/**
 * The three boards of היכל התהילה, read at closing time: כוח כללי, ריגול and
 * הברית החזקה.
 *
 * Deliberately archived rather than derived on read. The hall is the record of
 * *finished* seasons, so its figures must be frozen the moment the season ends —
 * a board recomputed from live tables would silently start reporting the new
 * season the moment the next one opens, which is exactly what this must never
 * do. It also has to survive the season reset that deletes every empire and
 * guild these rows are read from.
 *
 * Ranked off the same denormalised columns the live ladders rank by
 * (`militaryPower`, `spyPower`, and the summed member power the guild board
 * uses), so the archive says what players actually saw all season. The power
 * board carries the podium's hero tiebreak so its first place is the same
 * empire as the season's champion.
 *
 * A row worth zero is dropped: a board nobody competed in is noise, not a
 * ranking — the same rule the recap's `named()` applies.
 */
async function buildHallBoards(
  tx: Prisma.TransactionClient
): Promise<HallBoardSnapshot[]> {
  const [byPower, bySpy, byGuild] = await Promise.all([
    tx.empire.findMany({
      where: notStaffOrBot,
      orderBy: { militaryPower: "desc" },
      // Over-read so the hero tiebreak has something to reorder, as buildPodium does.
      take: HALL_BOARD_SIZE * 4,
      select: {
        id: true,
        name: true,
        cities: true,
        militaryPower: true,
        user: { select: { name: true } },
        hero: { select: { level: true, resets: true } },
      },
    }),
    tx.empire.findMany({
      where: notStaffOrBot,
      orderBy: [{ spyPower: "desc" }, { name: "asc" }],
      take: HALL_BOARD_SIZE,
      select: {
        id: true,
        name: true,
        spyPower: true,
        user: { select: { name: true } },
      },
    }),
    // Guild strength is the sum of its members' power — there is no column for
    // it, so it is aggregated here exactly as the recap's guild board does.
    tx.$queryRaw<{ name: string; members: bigint; power: number | null }[]>`
      SELECT g.name, COUNT(m.id) AS members, SUM(e."militaryPower") AS power
      FROM "Guild" g
      JOIN "GuildMember" m ON m."guildId" = g.id
      -- A staff member inside a guild lends it none of their power (see
      -- src/lib/staff.ts) — the join drops them, so the guild is ranked on
      -- what its actual contestants built.
      JOIN "Empire" e ON e.id = m."empireId" AND e."isStaff" = false AND e."isBot" = false
      GROUP BY g.id, g.name
      ORDER BY power DESC NULLS LAST
      LIMIT ${HALL_BOARD_SIZE}
    `,
  ]);

  const rows: HallBoardSnapshot[] = [];
  const push = (kind: SeasonBoardKind, entries: Omit<HallBoardSnapshot, "kind" | "rank">[]) => {
    entries
      .filter((e) => e.value > 0)
      .forEach((e, i) => rows.push({ ...e, kind, rank: i + 1 }));
  };

  push(
    "POWER",
    byPower
      .sort(
        (a, b) =>
          b.militaryPower - a.militaryPower ||
          (b.hero?.level ?? 1) - (a.hero?.level ?? 1) ||
          (b.hero?.resets ?? 0) - (a.hero?.resets ?? 0)
      )
      .slice(0, HALL_BOARD_SIZE)
      .map((e) => ({
        empireId: e.id,
        name: e.name,
        playerName: e.user?.name ?? null,
        // i18n-exempt: written into an archived SeasonBoardEntry / season recap at
        // closing time and read back verbatim for good — the row is a record of what
        // happened, not a view of it. Same reasoning as a season's name.
        note: `${e.cities} ערים`,
        value: Math.floor(e.militaryPower),
      }))
  );

  push(
    "SPY",
    bySpy.map((e) => ({
      empireId: e.id,
      name: e.name,
      playerName: e.user?.name ?? null,
      note: null,
      value: Math.floor(e.spyPower),
    }))
  );

  push(
    "GUILD",
    byGuild.map((g) => ({
      // A guild has no dossier to open — the name stays flat text in the hall.
      empireId: null,
      name: g.name,
      playerName: null,
      // i18n-exempt: written into an archived SeasonBoardEntry / season recap at
      // closing time and read back verbatim for good — the row is a record of what
      // happened, not a view of it. Same reasoning as a season's name.
      note: `${Number(g.members)} חברים`,
      value: Math.floor(g.power ?? 0),
    }))
  );

  return rows;
}

/**
 * Everything else that happened: five categories and the season's totals.
 *
 * Each board is an indexed `ORDER BY … LIMIT`, and the totals are aggregates —
 * this runs exactly once in the life of a season, so it is allowed to be the
 * one expensive read in the app.
 */
async function buildRecap(
  tx: Prisma.TransactionClient,
  since: Date
): Promise<SeasonRecap> {
  const named = <T extends { name: string }>(
    rows: T[],
    value: (r: T) => number,
    note?: (r: T) => string | undefined
  ): RecapRow[] =>
    rows
      .map((r) => ({ name: r.name, value: Math.floor(value(r)), note: note?.(r) }))
      // A category nobody competed in is noise, not a ranking.
      .filter((r) => r.value > 0);

  const [
    military,
    spies,
    slaves,
    bank,
    guilds,
    raiders,
    empireCount,
    guildCount,
    battleTotals,
  ] = await Promise.all([
    tx.empire.findMany({
      where: notStaffOrBot,
      orderBy: { militaryPower: "desc" },
      take: RECAP_BOARD_SIZE,
      select: { name: true, militaryPower: true, cities: true },
    }),
    tx.empire.findMany({
      where: notStaffOrBot,
      orderBy: { spyPower: "desc" },
      take: RECAP_BOARD_SIZE,
      select: { name: true, spyPower: true },
    }),
    tx.empire.findMany({
      where: notStaffOrBot,
      orderBy: { army: { mineSlaves: "desc" } },
      take: RECAP_BOARD_SIZE,
      select: { name: true, army: { select: { mineSlaves: true } } },
    }),
    tx.empire.findMany({
      where: notStaffOrBot,
      orderBy: { bankAccount: { goldBalance: "desc" } },
      take: RECAP_BOARD_SIZE,
      select: { name: true, bankAccount: { select: { goldBalance: true } } },
    }),
    tx.$queryRaw<{ name: string; members: bigint; power: number | null }[]>`
      SELECT g.name, COUNT(m.id) AS members, SUM(e."militaryPower") AS power
      FROM "Guild" g
      JOIN "GuildMember" m ON m."guildId" = g.id
      -- Staff and bots lend their guild no power — same rule as buildHallBoards.
      JOIN "Empire" e ON e.id = m."empireId" AND e."isStaff" = false AND e."isBot" = false
      GROUP BY g.id, g.name
      ORDER BY power DESC NULLS LAST
      LIMIT ${RECAP_BOARD_SIZE}
    `,
    tx.battleReport.groupBy({
      by: ["attackerEmpireId"],
      where: {
        createdAt: { gte: since },
        stolenGold: { gt: 0 },
        attackerEmpire: notStaffOrBot,
      },
      _sum: { stolenGold: true },
      orderBy: { _sum: { stolenGold: "desc" } },
      take: RECAP_BOARD_SIZE,
    }),
    // "How many played this season" — neither the staff empires nor the bots
    // were playing it.
    tx.empire.count({ where: notStaffOrBot }),
    tx.guild.count(),
    tx.battleReport.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: {
        stolenGold: true,
        attackerSoldiersLost: true,
        defenderSoldiersLost: true,
        enslavedSoldiers: true,
      },
    }),
  ]);

  // The raid board comes back as ids (BattleReport has no name), so resolve
  // just those five rather than every empire in the game.
  const raiderNames = new Map(
    (
      await tx.empire.findMany({
        where: { id: { in: raiders.map((r) => r.attackerEmpireId) } },
        select: { id: true, name: true },
      })
    ).map((e) => [e.id, e.name])
  );

  // i18n-exempt-start: frozen into the season's recap JSON at closing time and
  // reprinted from it forever — a record of the season, not a view of it. The
  // Discord post reads the same rows, and that goes to one channel with many
  // readers.
  const boards: RecapBoard[] = [
    {
      key: "military",
      title: "כוח צבאי",
      icon: "attack",
      rows: named(
        military,
        (e) => e.militaryPower,
        (e) => `${e.cities} ערים`
      ),
    },
    {
      key: "guilds",
      title: "בריתות",
      icon: "guild",
      rows: named(
        guilds.map((g) => ({ name: g.name, power: g.power ?? 0, members: Number(g.members) })),
        (g) => g.power,
        (g) => `${g.members} חברים`
      ),
    },
    {
      key: "raid",
      title: "שוד זהב",
      icon: "gold",
      rows: named(
        raiders.map((r) => ({
          name: raiderNames.get(r.attackerEmpireId) ?? "אימפריה",
          gold: r._sum.stolenGold ?? 0,
        })),
        (r) => r.gold
      ),
    },
    {
      key: "spy",
      title: "מודיעין",
      icon: "spy",
      rows: named(spies, (e) => e.spyPower),
    },
    {
      key: "slaves",
      title: "עבדי מכרה",
      icon: "citizens",
      rows: named(slaves, (e) => e.army?.mineSlaves ?? 0),
    },
    {
      key: "bank",
      title: "הון בבנק",
      icon: "bank",
      rows: named(bank, (e) => e.bankAccount?.goldBalance ?? 0),
    },
  ].filter((b) => b.rows.length > 0); // i18n-exempt-end

  return {
    version: 1,
    totals: {
      empires: empireCount,
      guilds: guildCount,
      battles: battleTotals._count._all,
      goldPlundered: Math.floor(battleTotals._sum.stolenGold ?? 0),
      soldiersLost:
        (battleTotals._sum.attackerSoldiersLost ?? 0) +
        (battleTotals._sum.defenderSoldiersLost ?? 0),
      soldiersEnslaved: battleTotals._sum.enslavedSoldiers ?? 0,
    },
    boards,
  };
}

/* --------------------------- announcements --------------------------- */

/**
 * The line that introduces the podium in the channel.
 *
 * Counted rather than hardcoded at three: a season can close with a single
 * empire on the podium (an early season, a game that was just reset), and
 * "לזוכים" over one name is the kind of small lie players notice.
 */
function podiumIntro(count: number): string {
  // i18n-exempt: a stored Message row / a Discord post. Both go out once for
  // every reader, so there is no single reader whose language to resolve —
  // see the note in `attackEmpire`.
  return count === 1 ? "ברכות לזוכה 👑" : "ברכות לזוכים 👑";
}

/**
 * A season **opening**, announced in the channel.
 *
 * The mirror image of the podium post below: a season is the game's longest
 * arc, and both of its ends are news. The open is the more useful of the two —
 * it is the only place a player is told the new deadline they are now racing,
 * and the season pass everyone has to climb again starts the moment it fires.
 * That is why it is posted from every path that can flip a season live, not
 * only from the admin's own click.
 *
 * It says the world was restarted **only when it was**. An automatic opening
 * wipes it (see `openSeason`); an admin activating a season by hand carries
 * every empire over untouched. Announcing the wrong one of those two is how a
 * player finds out their empire is gone from a Discord post that told them it
 * would not be.
 *
 * Fires **after** the activation has committed, and cannot fail it —
 * `announceToDiscord` swallows everything. Callers must have won whatever guard
 * makes them the single activator, or the channel gets one post per racing
 * request.
 *
 * The deadline goes in as Jerusalem wall time: the announcer runs on a server
 * set to UTC, and a season end announced three hours early is simply wrong.
 */
export async function announceSeasonStart(
  season: { name: string; endsAt: Date },
  { restarted = false }: { restarted?: boolean } = {}
): Promise<void> {
  await announceToDiscord({
    kind: "season",
    channel: "events",
    // i18n-exempt-start: a Discord post — one channel, many readers, so there is
    // no single reader whose language to resolve. See the note in `attackEmpire`.
    title: `🚀 ${seasonHeadline(season.name)} נפתחה!`,
    body:
      "בהצלחה לכולם! 🔥\n\n" +
      (restarted
        ? "העולם אופס — כל אימפריה מתחילה מאפס והגילדות התפרקו. רק היהלומים נשארים איתכם. 💎\n"
        : "") +
      `⏳ נגמרת ב-${formatGameDateTime(season.endsAt)}`, // i18n-exempt-end
    url: gameLink("/game/base"),
  });
}

/* ---------------------------- the next one ---------------------------- */

/**
 * Line up the season that follows the one just sealed.
 *
 * This is what makes the cycle turn on its own. A season closing is the only
 * moment at which the next one's dates are actually knowable — they are counted
 * from the close, not from the calendar — so the successor is created right
 * here, inside the closing transaction, and the countdown on `/season` has
 * something true to count towards from the very first page load after the
 * deadline.
 *
 * Both numbers are admin-tunable (`season.breakHours`, `season.lengthDays` — see
 * lib/game/config.ts), so the length of the shutdown and the length of the next
 * season are set once in the panel and never touched again.
 *
 * Three things it refuses to do:
 *  - **Schedule on top of the admin.** If any unclosed season is already booked
 *    to start at or after this one's end, that is the successor; a second row
 *    would either steal its slot or sit unopened forever.
 *  - **Run at all with `autoNext` off.** That switch is the whole point of
 *    having one: it stops the game reopening by itself while someone is fixing
 *    something, and leaves the break running until an admin opens a season.
 *  - **Start before the close.** `startsAt` is counted from the moment the
 *    season actually ended (`closedAt`, which is ≥ `endsAt` — a season shortened
 *    into the past closes later than it "ended"), so a zero-hour break opens the
 *    next season now rather than in the past.
 */
async function scheduleNextSeason(
  tx: Prisma.TransactionClient,
  season: { id: string; name: string; endsAt: Date },
  tunables: GameTunables,
  closedAt: Date
): Promise<{ id: string; name: string; startsAt: Date; endsAt: Date } | null> {
  if (tunables.season.autoNext < 1) return null;

  const existing = await tx.gameSeason.findFirst({
    where: { id: { not: season.id }, closedAt: null, startsAt: { gte: season.endsAt } },
    select: { id: true },
  });
  if (existing) return null;

  const window = nextSeasonWindow({ endsAt: season.endsAt, closedAt }, tunables.season);
  const seasonCount = await tx.gameSeason.count();

  return tx.gameSeason.create({
    data: { name: nextSeasonName(season.name, seasonCount), ...window },
    select: { id: true, name: true, startsAt: true, endsAt: true },
  });
}

/* ------------------------------ closing ------------------------------ */

/** A season row, as everything below needs to see it. */
type ArchivableSeason = {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  recap: Prisma.JsonValue | null;
};

/**
 * Write a season's podium into היכל התהילה and freeze its recap.
 *
 * **First archive wins.** The champions go in with `skipDuplicates` against
 * `@@unique([seasonId, rank])`, and the recap is only written if the row does
 * not already have one. A season can be archived from two directions — the
 * admin ticking "save the standings" before a manual reset, and the clock
 * running out later — and re-running this must never rewrite history that has
 * already been published to the hall.
 *
 * Every column written here is a snapshot, the season's own name and dates
 * included, so the record survives both the empire wipe and the deletion of the
 * GameSeason row itself.
 */
async function archiveSeason(
  tx: Prisma.TransactionClient,
  season: ArchivableSeason
): Promise<number> {
  const [podium, boards, recap] = await Promise.all([
    buildPodium(tx),
    buildHallBoards(tx),
    buildRecap(tx, season.startsAt),
  ]);

  // Every archived row carries the season's own name and dates, so the hall can
  // be read without the GameSeason row ever being touched.
  const stamp = {
    seasonId: season.id,
    seasonName: season.name,
    seasonStartsAt: season.startsAt,
    seasonEndsAt: season.endsAt,
  };

  let written = 0;
  if (podium.length > 0) {
    const result = await tx.seasonChampion.createMany({
      // `title` is destructured off rather than spread: it is the one field on a
      // ChampionSnapshot the archive has no column for, and it is live data on a
      // row that must be frozen. See the note on ChampionSnapshot.title.
      data: podium.map(({ title: _title, ...c }) => ({ ...stamp, ...c })),
      skipDuplicates: true,
    });
    written = result.count;
  }

  // The three hall boards, under the same first-archive-wins rule as the podium:
  // `skipDuplicates` against @@unique([seasonId, kind, rank]) means a second
  // archiving pass (admin first, clock later) reads as a no-op instead of
  // rewriting a hall players have already seen.
  if (boards.length > 0) {
    await tx.seasonBoardEntry.createMany({
      data: boards.map((b) => ({ ...stamp, ...b })),
      skipDuplicates: true,
    });
  }

  if (!season.recap) {
    await tx.gameSeason.update({
      where: { id: season.id },
      data: { recap: recap as unknown as Prisma.InputJsonValue },
    });
  }

  return written;
}

/** One champion who was actually paid, for the announcement afterwards. */
export interface PrizePayment {
  rank: number;
  empireId: string;
  empireName: string;
  diamonds: number;
}

/**
 * Credit the podium its diamonds — the season's prizes, paid by the game.
 *
 * Runs inside the closing transaction, so the three facts are one fact: the
 * season is sealed, the podium is in the hall, and the winners have been paid.
 * There is no cron and no admin step in the middle; the first request to cross
 * `endsAt` pays for all of it, exactly like the archive above.
 *
 * Idempotent twice over. The close is already behind the `closedAt` mutex, so
 * this normally runs once per season; on top of that every credit is a guarded
 * `updateMany` on `prizePaidAt: null`, so a champion cannot be paid twice even
 * if a future path calls this again.
 *
 * Three deliberate choices:
 *  - It reads the **archived rows**, not `buildPodium`'s return value. Those
 *    rows are what the hall publishes (a season the admin archived early keeps
 *    its original podium under `skipDuplicates`), and paying anyone else would
 *    mean the game pays a player it does not name as champion.
 *  - The credit is `updateMany`, not `update`: a champion whose empire was
 *    deleted between archiving and paying must be a no-op, not a P2025 that
 *    rolls back the entire close and leaves the game unsealed.
 *  - The amount is written onto the champion row. `SEASON_PRIZES` is a balance
 *    constant that will change; what a past champion was actually paid must not
 *    change with it.
 */
async function payPodiumPrizes(
  tx: Prisma.TransactionClient,
  seasonId: string,
  seasonName: string,
  now: Date
): Promise<PrizePayment[]> {
  const champions = await tx.seasonChampion.findMany({
    where: { seasonId, prizePaidAt: null, empireId: { not: null } },
    orderBy: { rank: "asc" },
    select: { id: true, rank: true, empireId: true, empireName: true },
  });

  const paid: PrizePayment[] = [];
  for (const champ of champions) {
    const diamonds = prizeForRank(champ.rank);
    // A podium deeper than the prize table pays nothing — the rank is still a
    // record, it simply carries no purse.
    if (diamonds <= 0 || !champ.empireId) continue;

    const credited = await tx.empire.updateMany({
      where: { id: champ.empireId },
      data: { diamonds: { increment: diamonds } },
    });
    // The empire is gone. Leave the row unpaid rather than stamping it: the
    // record then tells the truth about what happened, and an admin who
    // restores the account can still settle it.
    if (credited.count === 0) continue;

    const claimed = await tx.seasonChampion.updateMany({
      where: { id: champ.id, prizePaidAt: null },
      data: { prizeDiamonds: diamonds, prizePaidAt: now },
    });
    if (claimed.count === 0) continue;

    // The receipt, in the winner's own inbox. `createdAt` is set explicitly —
    // the column default writes local time, three hours off Prisma's UTC (see
    // the note on Message in the schema).
    await tx.message.create({
      data: {
        empireId: champ.empireId,
        kind: "SYSTEM",
        // i18n-exempt-start: a stored Message row, written off the season's own
        // clock with nobody's request to read a language from — see the note in
        // `attackEmpire`.
        title: `🏆 פרס העונה — מקום ${champ.rank}`,
        body:
          `סיימת את ${seasonName} במקום ${champ.rank}. ` +
          `${formatNumber(diamonds)} יהלומים נכנסו לחשבונך אוטומטית. כל הכבוד!`, // i18n-exempt-end
        href: "/game/prizes",
        createdAt: now,
      },
    });

    paid.push({
      rank: champ.rank,
      empireId: champ.empireId,
      empireName: champ.empireName,
      diamonds,
    });
  }

  return paid;
}

/**
 * Archive a season's standings **without ending it** — the admin path.
 *
 * `resetSeason` and `deleteSeason` are about to destroy the data these figures
 * are derived from, so the admin is offered the chance to preserve them first.
 * Deliberately does not touch `closedAt`: saving a record is not the same as
 * declaring the season over, and a reset button must not lock every player out
 * of the game as a side effect.
 *
 * Returns how many podium rows were newly written.
 */
export async function archiveSeasonStandings(seasonId: string): Promise<number> {
  const season = await prisma.gameSeason.findUnique({
    where: { id: seasonId },
    select: { id: true, name: true, startsAt: true, endsAt: true, recap: true },
  });
  if (!season) return 0;

  const written = await prisma.$transaction((tx) => archiveSeason(tx, season), {
    timeout: 30_000,
  });
  return written;
}

/**
 * Seal a season: archive its final standings, then stamp `closedAt` — which is
 * what actually shuts the game.
 *
 * Idempotent, and safe under any number of concurrent callers. The guarded
 * `updateMany` is the mutex: the precondition lives in the WHERE, not in an
 * `if` above it, because two requests that both read `closedAt: null` a
 * microsecond apart would both pass a read-then-write check and both go on to
 * archive. The loser does no work and returns `false`.
 *
 * Archiving *and paying the podium* happen inside the same transaction as the
 * stamp, so a season can never end up sealed with an empty hall of fame, nor
 * with a published podium whose winners were never paid. The next season is
 * booked in the same breath (`scheduleNextSeason`), so the game is never sealed
 * without a date on which it reopens.
 *
 * `scheduleNext: false` is for the one caller that is choosing the successor
 * itself — the admin activating a specific season, which force-closes the
 * outgoing one on the way. Booking another one behind its back would leave a
 * season nobody asked for sitting in the schedule.
 *
 * Returns whether *this* call was the one that closed it.
 */
export async function closeSeason(
  seasonId: string,
  now: Date = new Date(),
  { scheduleNext = true }: { scheduleNext?: boolean } = {}
): Promise<boolean> {
  // Read before the transaction: it is a database round trip of its own, and it
  // is the same for every racing caller.
  const tunables = await getTunables();

  const closed = await prisma.$transaction(
    async (tx) => {
      const season = await tx.gameSeason.findUnique({
        where: { id: seasonId },
        select: { id: true, name: true, startsAt: true, endsAt: true, recap: true, closedAt: true },
      });
      if (!season || season.closedAt) return null;

      const claimed = await tx.gameSeason.updateMany({
        where: { id: seasonId, closedAt: null },
        data: { closedAt: now },
      });
      if (claimed.count === 0) return null;

      await archiveSeason(tx, season);
      // The prizes, in the same breath as the seal — see payPodiumPrizes.
      await payPodiumPrizes(tx, season.id, season.name, now);
      // And the date the game comes back. Inside the same transaction as the
      // seal, so "shut" and "reopens then" are one fact, never two.
      const next = scheduleNext
        ? await scheduleNextSeason(tx, season, tunables, now)
        : null;
      return { name: season.name, next };
    },
    { timeout: 30_000 }
  );

  // Announced by the single caller that won the race above, and only after the
  // hall has actually been written — so the post can never advertise a podium
  // that a rolled-back transaction never archived. Read back rather than
  // returned from inside: `archiveSeason` writes with `skipDuplicates`, so the
  // rows in the hall are the truth, including for a season the admin archived
  // manually before the clock ran out. Never inside the transaction: this is a
  // network call.
  if (closed !== null) {
    const podium = await prisma.seasonChampion.findMany({
      where: { seasonId },
      orderBy: { rank: "asc" },
      take: 3,
      select: { rank: true, empireName: true, playerName: true, prizeDiamonds: true },
    });
    const medals = ["🥇", "🥈", "🥉"];
    await announceToDiscord({
      kind: "season",
      channel: "events",
      // i18n-exempt-start: a Discord post — one channel, many readers.
      title: `🏆 ${seasonHeadline(closed.name)} הסתיימה!`,
      body:
        (podium.length > 0
          ? `${podiumIntro(podium.length)}\n\n` +
            podium
              .map(
                (row) =>
                  `${medals[row.rank - 1] ?? ""} **${row.empireName}**` +
                  (row.playerName ? ` (${row.playerName})` : "") +
                  // Only if it was actually credited — an unpaid row (a deleted
                  // empire) must not be announced as having collected.
                  (row.prizeDiamonds > 0
                    ? ` — ${formatNumber(row.prizeDiamonds)} 💎`
                    : "")
              )
              .join("\n")
          : "הסיזן נגמר בלי זוכים.") +
        "\n\n" +
        // "When are we back?" is the only other thing this post has to answer —
        // it is the last thing players read before the game shuts. As a wait
        // rather than a date ("בעוד יום", "בעוד 3 שעות"): the break is measured
        // in hours from this very moment, so that is the shape it is understood
        // in, and the exact time is on /season for anyone who wants it.
        (closed.next
          ? `ניפגש בעונה הבאה בעוד ${formatWaitDuration(makeT(DEFAULT_LOCALE), closed.next.startsAt.getTime() - now.getTime())} 🔄`
          : "ניפגש בעונה הבאה בקרוב 🔄"), // i18n-exempt-end
      url: gameLink("/game/rankings"),
    });
  }

  return closed !== null;
}

/* ------------------------------ opening ------------------------------ */

/** What an opening actually did, for the log line and the announcement. */
export interface SeasonOpened {
  seasonId: string;
  seasonName: string;
  /** Empires rebuilt from scratch — 0 when the world was carried over. */
  empiresRebuilt: number;
  botsRemoved: number;
  /** Whether the world was wiped (`season.autoRestart`). */
  restarted: boolean;
}

/**
 * Open a scheduled season — the moment the game comes back.
 *
 * This is the other half of `closeSeason`, and it runs the same way: lazily, on
 * whichever request first sees `startsAt` in the past, with a guarded
 * `updateMany` as the mutex. Exactly one of a hundred simultaneous page loads
 * flips `isActive` and does the work; the rest simply find the game open.
 *
 * **It restarts the world**, unless `season.autoRestart` is turned off. A season
 * is a race, and a race everybody starts halfway through is not one — so every
 * empire goes back to the opening bundle (keeping its diamonds) and every guild
 * is dissolved, exactly as the admin's reset button does it, through the same
 * `restartWorld`. The season pass resets itself: `loadCycle` clears premium and
 * the ladder the first time it sees a different active season.
 *
 * All of it — the flag, the wipe and the rebuild — is one transaction, because
 * every intermediate state is a broken game: an active season whose players
 * still hold last season's armies, or worse, a world deleted under a season
 * that never became active. If the request dies halfway the whole thing rolls
 * back and the next page load runs it again from the start.
 *
 * A season whose own `endsAt` has already passed when its turn comes (the server
 * was down for a month, an admin scheduled it and forgot) is **pushed forward**
 * rather than opened into its own grave — opening it unchanged would seal the
 * game again on the very next page load, and the cycle would stop for good.
 *
 * Returns null when this caller was not the one that opened it.
 */
export async function openSeason(
  season: { id: string; name: string; endsAt: Date },
  now: Date = new Date()
): Promise<SeasonOpened | null> {
  const tunables = await getTunables();
  const restart = tunables.season.autoRestart >= 1;
  // Its clock ran out before it ever started: give it its full length from now.
  const revised =
    season.endsAt <= now
      ? {
          startsAt: now,
          endsAt: new Date(now.getTime() + seasonLengthMs(tunables.season.lengthDays)),
        }
      : {};

  const opened = await prisma.$transaction(
    async (tx) => {
      // The mutex. The precondition lives in the WHERE, so two requests that
      // both read `isActive: false` cannot both proceed: the second blocks on
      // the row until the first commits, then re-evaluates it and matches
      // nothing. Everything below therefore runs exactly once.
      const claimed = await tx.gameSeason.updateMany({
        where: { id: season.id, isActive: false },
        data: { isActive: true, ...revised },
      });
      if (claimed.count === 0) return null;

      await tx.gameSeason.updateMany({
        where: { isActive: true, id: { not: season.id } },
        data: { isActive: false },
      });

      if (restart) {
        const { empiresRebuilt, botsRemoved } = await restartWorld(tx, season.id, tunables);
        return { empiresRebuilt, botsRemoved };
      }
      // Carried over instead: every empire still has to be re-homed onto the
      // season it is actually being played in — `Empire.seasonId` drives the
      // admin's broadcast and ban targeting and the counts on the seasons page.
      await tx.empire.updateMany({ data: { seasonId: season.id } });
      return { empiresRebuilt: 0, botsRemoved: 0 };
    },
    // The rebuild writes one empire per player. Given the same headroom the
    // admin's reset runs with, since it is the very same work.
    { timeout: 120_000 }
  );

  if (!opened) return null;

  // After the commit, and only by the caller that won the claim — the same rule
  // the close follows. `announceToDiscord` swallows its own failures, so a
  // Discord outage can never undo a season that has already opened.
  await announceSeasonStart(
    { name: season.name, endsAt: revised.endsAt ?? season.endsAt },
    { restarted: restart }
  );

  return {
    seasonId: season.id,
    seasonName: season.name,
    restarted: restart,
    ...opened,
  };
}

/* -------------------------------- gate -------------------------------- */

export type SeasonGate =
  | { open: true }
  | {
      open: false;
      seasonId: string;
      seasonName: string;
      closedAt: Date;
      /** When the next season opens — null if the admin has not scheduled one. */
      nextStartsAt: Date | null;
      nextSeasonName: string | null;
    };

/**
 * Is the game open right now?
 *
 * Closed means: there is an active season, its clock has run out, and the next
 * one has not started yet. Everything else is open — including "no active
 * season at all", which is what a fresh install and every local dev database
 * look like. A game with no seasons configured must not lock itself out.
 *
 * Three things happen here, in order, and all of them are lazy:
 *  1. an active season past `endsAt` is closed (archived) on the spot, and the
 *     next one is booked from the admin's break length in the same transaction;
 *  2. a scheduled successor whose `startsAt` has arrived is opened, which
 *     restarts the world and reopens the game by itself — the countdown on
 *     /season is a promise the server has to keep without an admin awake at 3am;
 *  3. whatever is left is reported as open or shut.
 *
 * Between them those three steps are the whole season cycle, turning with
 * nobody at the wheel: play, seal, break, wipe, play again. Every knob it uses
 * is in the admin panel (lib/game/config.ts, `season`), including the two that
 * stop it — `autoNext` (book no successor) and `autoRestart` (open without
 * wiping).
 *
 * `cache`d per request: it is called from `requireEmpire` *and*
 * `getActiveEmpireId`, and a page load hits both.
 */
export const getSeasonGate = cache(async (): Promise<SeasonGate> => {
  const now = new Date();

  const active = await prisma.gameSeason.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, endsAt: true, closedAt: true },
  });
  if (!active) return { open: true };
  if (active.endsAt > now) return { open: true };

  let closedAt = active.closedAt;
  if (!closedAt) {
    await closeSeason(active.id, now);
    const reread = await prisma.gameSeason.findUnique({
      where: { id: active.id },
      select: { closedAt: true },
    });
    closedAt = reread?.closedAt ?? now;
  }

  // The next season is the earliest unclosed one scheduled to start at or after
  // this one ended. `gte`, not `gt`: with the break set to zero hours the
  // successor starts on the very instant its predecessor ended, and a `gt` here
  // would leave it invisible forever.
  const next = await prisma.gameSeason.findFirst({
    where: { id: { not: active.id }, closedAt: null, startsAt: { gte: active.endsAt } },
    orderBy: { startsAt: "asc" },
    select: { id: true, name: true, startsAt: true, endsAt: true },
  });

  // Its hour has come — see openSeason for the mutex and the restart.
  if (next && next.startsAt <= now) {
    await openSeason(next, now);
    return { open: true };
  }

  return {
    open: false,
    seasonId: active.id,
    seasonName: active.name,
    closedAt,
    nextStartsAt: next?.startsAt ?? null,
    nextSeasonName: next?.name ?? null,
  };
});

/* ------------------------------ the hall ------------------------------ */

export interface HallRow {
  rank: number;
  /**
   * The empire's dossier, when it is still in the game. Null on guild rows,
   * on rows archived without one, and on an empire that has since been wiped —
   * the hall links only ids it has just seen exist, so an archived name never
   * leads to a 404.
   */
  empireId: string | null;
  name: string;
  playerName: string | null;
  note: string | null;
  value: number;
}

export interface HallBoard {
  kind: SeasonBoardKind;
  title: string;
  /** Icon name from components/ui/Icon. */
  icon: string;
  /** What the numbers column means, for the board's sub-line. */
  unit: string;
  rows: HallRow[];
}

/** היכל התהילה: the three boards of the last season that actually finished. */
export interface HallOfFame {
  seasonId: string;
  seasonName: string;
  endsAt: Date;
  boards: HallBoard[];
}

/** The three boards, in the order the hall draws them. */
const HALL_BOARD_META: Record<
  SeasonBoardKind,
  { title: string; icon: string; unit: string }
> = {
  // Translation sources: the hall renders these live from the catalog, unlike
  // the recap above, which is frozen into a row.
  POWER: { title: "כוח כללי", icon: "attack", unit: "כוח צבאי" },
  SPY: { title: "ריגול", icon: "spy", unit: "כוח מודיעין" },
  GUILD: { title: "הברית החזקה", icon: "guild", unit: "כוח חברי הברית" },
};

const HALL_BOARD_ORDER: SeasonBoardKind[] = ["POWER", "SPY", "GUILD"];

/**
 * היכל התהילה — כוח כללי, ריגול and הברית החזקה, as they stood when the last
 * season ended.
 *
 * **The running season is not in here, by construction.** Every figure is read
 * off `SeasonBoardEntry`, which is written once at closing time and never
 * updated, and the query takes only seasons whose `seasonEndsAt` is already in
 * the past. That second condition is what keeps the *current* season out even
 * when its standings have been archived early: the admin can archive a running
 * season before a reset (see `archiveSeasonStandings`), and those rows carry a
 * deadline that has not arrived yet, so the hall ignores them until it has.
 * Nothing here reads a live Empire or Guild table for a number.
 *
 * Only the newest finished season is shown — the hall is "how last season
 * ended", not a scrollable archive of all of them. Older seasons keep their
 * rows in the table and their podium on the season recap page.
 *
 * Read live, like every other board in the game (see [[no-cached-boards]]):
 * fifteen rows off a unique index, a handful of times a year, is not worth the
 * question "is this stale?".
 */
export async function getHallOfFame(): Promise<HallOfFame | null> {
  const now = new Date();

  // Newest *finished* season that has an archived hall. One row off the
  // seasonEndsAt index, and it names the season the boards below belong to.
  const newest = await prisma.seasonBoardEntry.findFirst({
    where: { seasonEndsAt: { lte: now } },
    orderBy: { seasonEndsAt: "desc" },
    select: { seasonId: true, seasonName: true, seasonEndsAt: true },
  });
  if (!newest) return null;

  const rows = await prisma.seasonBoardEntry.findMany({
    where: { seasonId: newest.seasonId },
    orderBy: [{ kind: "asc" }, { rank: "asc" }],
    select: {
      kind: true,
      rank: true,
      empireId: true,
      name: true,
      playerName: true,
      note: true,
      value: true,
    },
  });

  // Which of the archived empires still have a dossier to open. The archive is
  // deliberately unconstrained — it outlives the season *and* the empires it
  // names — so an id here can point at a row a wipe has since removed. At most
  // ten ids, looked up once on the primary key.
  const archivedIds = [
    ...new Set(rows.map((r) => r.empireId).filter((id): id is string => id !== null)),
  ];
  const alive = new Set(
    archivedIds.length === 0
      ? []
      : (
          await prisma.empire.findMany({
            where: { id: { in: archivedIds } },
            select: { id: true },
          })
        ).map((e) => e.id)
  );

  const boards: HallBoard[] = HALL_BOARD_ORDER.map((kind) => ({
    kind,
    ...HALL_BOARD_META[kind],
    rows: rows
      .filter((r) => r.kind === kind)
      .map((r) => ({
        rank: r.rank,
        empireId: r.empireId && alive.has(r.empireId) ? r.empireId : null,
        name: r.name,
        playerName: r.playerName,
        note: r.note,
        value: r.value,
      })),
  })).filter((b) => b.rows.length > 0);

  if (boards.length === 0) return null;

  return {
    seasonId: newest.seasonId,
    seasonName: newest.seasonName,
    endsAt: newest.seasonEndsAt,
    boards,
  };
}
