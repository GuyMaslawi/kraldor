import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { grantCitizens } from "@/lib/game/grants";
import { DEFENSE_BONUS } from "@/lib/game/constants";
import { bonusMultiplier, heroBonuses } from "@/lib/game/hero";
import {
  armyPower,
  getEmpireMilitaryPower,
} from "@/lib/game/power";
import { weaponsPower } from "@/lib/game/weapons";
import { guildAidPct } from "@/lib/game/guild";
import { secureRandom } from "@/lib/game/random";
import { announceToDiscord, gameLink } from "@/server/discord";
import { notStaff } from "@/lib/staff";
import { makeT } from "@/i18n/translate";
import { DEFAULT_LOCALE } from "@/i18n/locale";
import {
  applySwing,
  GUILD_WAR_DEFENDER_SHIFT,
  GUILD_WAR_MIN_GUILDS,
  GUILD_WAR_RESULTS_LINGER_MS,
  GUILD_WAR_ROUNDS,
  clashPoints,
  liveWarStart,
  memberForRound,
  opponentForRound,
  prizeForRank,
  prizeSummary,
  registrationWarStart,
  roundStartsAt,
  roundsDueBy,
  warEndsAt,
  type GuildWarFeedItem,
  type GuildWarFighterRow,
  type GuildWarLiveState,
  type GuildWarPhase,
  type GuildWarScoreRow,
} from "@/lib/game/guildWar";

/**
 * Server-side guild war: creating the nightly row, **fighting it**, and
 * assembling what the screen renders.
 *
 * The campaign is automatic but the game has no cron, so the war is driven the
 * way every other clock in KRALDOR is — lazily. `advanceWar` materialises
 * whatever minute-rounds have come due since it last ran, and it is called from
 * the page load, from the live poll and from settlement. During the window a
 * poll arrives every few seconds, so in practice rounds appear on time; if
 * nobody is watching at all they are simply fought in one batch by whoever
 * turns up next, with each clash stamped with the minute it belonged to.
 */

/** How many feed entries the board shows. */
const FEED_LIMIT = 40;

/** How many fighters the personal board shows. */
const FIGHTER_LIMIT = 20;

/* ------------------------------ the nightly row ------------------------------ */

/**
 * The war row for the bell at `startsAt`, created if this is the first guild
 * to enrol. Runs on the base client, never inside a caller's transaction: the
 * unique index on `startsAt` is what keeps one war per night, and a P2002
 * raised inside an interactive transaction poisons the whole transaction
 * rather than being catchable as a lost race.
 */
export async function ensureWarForStart(startsAt: Date): Promise<string> {
  const existing = await prisma.guildWar.findUnique({
    where: { startsAt },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.guildWar.create({
      data: { startsAt, endsAt: warEndsAt(startsAt) },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Lost the race to a concurrent registration. The unique constraint is the
    // point: the row that now exists is exactly the one we were creating.
    const row = await prisma.guildWar.findUniqueOrThrow({
      where: { startsAt },
      select: { id: true },
    });
    return row.id;
  }
}

/**
 * One guild's combined military power — the sum of what its members can field.
 *
 * Used to seed the scoreboard at enrolment, so a guild deciding whether to turn
 * up can see the field before the bell. From the first round onward `advanceWar`
 * keeps the figure fresh off the rosters it already loaded.
 *
 * Staff members count for nothing — they do not fight the war either (see
 * `loadSides`), so counting their army here would advertise a guild strength
 * that never turns up.
 */
export async function guildMilitaryPower(guildId: string): Promise<number> {
  const members = await prisma.guildMember.findMany({
    where: { guildId, empire: notStaff },
    select: { empire: { select: { army: true, weapons: true } } },
  });
  return Math.round(
    members.reduce(
      (sum, m) => sum + getEmpireMilitaryPower(m.empire.army, m.empire.weapons),
      0
    )
  );
}

/* ------------------------------ fighting the war ------------------------------ */

/** One guild as the simulation sees it: a rotation of fighters plus its aid. */
interface WarSide {
  entryId: string;
  guildId: string;
  guildName: string;
  /**
   * Stable order. The *pairing* a round produces must not depend on when the
   * round was materialised — only the clash's outcome is rolled, and a round is
   * only ever fought once (see resolvedRounds).
   */
  members: {
    empireId: string;
    name: string;
    attackBase: number;
    defenceBase: number;
    heroAttackPct: number;
    heroDefencePct: number;
    attackBuffPct: number;
    defenceBuffPct: number;
  }[];
  /**
   * The guild's combined military power — the one strength figure the board
   * publishes. Per-fighter numbers stay server-side: they are the hero- and
   * spell-multiplied values, which are finer intelligence than the public
   * rankings ladder gives away, and nobody should learn what a rival's hero is
   * worth by watching a war they were not part of.
   */
  totalPower: number;
  /**
   * Flat reinforcement every fighter of this guild brings, drawn from the
   * guild's **average** member power rather than its total.
   *
   * getGuildAidBonus (used by ordinary raids) takes a percentage of the guild's
   * *combined* power, which scales straight with headcount — in an arena that
   * deliberately gives a one-player guild the same number of clashes as a
   * ten-player one, that single term would have handed the war back to whoever
   * recruited hardest. Averaging keeps the aid *upgrade* meaningful, since the
   * percentage is still the level the guild paid for, while making the roster
   * size irrelevant to it.
   */
  aidPower: number;
}

/**
 * Load every enrolled guild's fighters and pre-compute their combat terms once,
 * so a catch-up of up to thirty rounds resolves entirely in memory.
 */
async function loadSides(
  tx: Prisma.TransactionClient,
  entries: { id: string; guildId: string; guildName: string }[],
  now: Date
): Promise<WarSide[]> {
  const guildIds = entries.map((entry) => entry.guildId);

  const members = await tx.guildMember.findMany({
    // Staff never take the field: they cannot be attacked anywhere else in the
    // game, and a fighter nobody can beat would decide the war. Dropping them
    // from the roster also keeps the rotation honest — `memberForRound` cycles
    // over this list, so a skipped member would leave a hole in it.
    where: { guildId: { in: guildIds }, empire: notStaff },
    // Stable ordering is what fixes the rotation: the same roster must field
    // the same member in round N whether it is fought on time or an hour late.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      guildId: true,
      guild: { select: { aidLevel: true } },
      empire: {
        select: {
          id: true,
          name: true,
          army: true,
          weapons: true,
          hero: { include: { items: true } },
        },
      },
    },
  });
  if (members.length === 0) return [];

  // Strongest live ATTACK/DEFENSE buff per empire, in one query rather than one
  // per fighter per round.
  const buffs = await tx.guildSpellBuff.findMany({
    where: {
      empireId: { in: members.map((m) => m.empire.id) },
      type: { in: ["ATTACK", "DEFENSE"] },
      expiresAt: { gt: now },
    },
    select: { empireId: true, type: true, bonusPct: true },
  });
  const buffPct = new Map<string, { attack: number; defence: number }>();
  for (const buff of buffs) {
    const current = buffPct.get(buff.empireId) ?? { attack: 0, defence: 0 };
    if (buff.type === "ATTACK") current.attack = Math.max(current.attack, buff.bonusPct);
    else current.defence = Math.max(current.defence, buff.bonusPct);
    buffPct.set(buff.empireId, current);
  }

  return entries.map((entry) => {
    const roster = members.filter((m) => m.guildId === entry.guildId);
    const aidPct = guildAidPct(roster[0]?.guild.aidLevel ?? 0);
    const totalPower = roster.reduce(
      (sum, m) => sum + getEmpireMilitaryPower(m.empire.army, m.empire.weapons),
      0
    );
    const averagePower = roster.length > 0 ? totalPower / roster.length : 0;

    return {
      entryId: entry.id,
      guildId: entry.guildId,
      guildName: entry.guildName,
      totalPower: Math.round(totalPower),
      aidPower: Math.round((averagePower * aidPct) / 100),
      members: roster.map((m) => {
        const { empire } = m;
        const hero = heroBonuses(empire.hero);
        const buff = buffPct.get(empire.id) ?? { attack: 0, defence: 0 };
        return {
          empireId: empire.id,
          name: empire.name,
          attackBase: armyPower(empire.army) + weaponsPower(empire.weapons, "ATTACK"),
          defenceBase: armyPower(empire.army) + weaponsPower(empire.weapons, "DEFENSE"),
          heroAttackPct: hero.totalPct.attack,
          heroDefencePct: hero.totalPct.defense,
          attackBuffPct: buff.attack,
          defenceBuffPct: buff.defence,
        };
      }),
    };
  });
}

/**
 * Fight every round that has come due. Idempotent and safe under concurrency:
 * the war row is locked for the duration and `resolvedRounds` is the resume
 * point, so two readers arriving in the same second cannot fight one round
 * twice or skip one.
 */
export async function advanceWar(warId: string, now: Date): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      // Serialise catch-ups on this war. Without the lock, two polls both read
      // resolvedRounds = 7, both fight round 7, and the feed doubles.
      await tx.$queryRaw`SELECT id FROM "GuildWar" WHERE id = ${warId} FOR UPDATE`;

      const war = await tx.guildWar.findUnique({
        where: { id: warId },
        select: { startsAt: true, status: true, resolvedRounds: true },
      });
      if (!war || war.status !== "SCHEDULED") return;

      const due = roundsDueBy(war.startsAt, now);
      if (due <= war.resolvedRounds) return;

      const entries = await tx.guildWarEntry.findMany({
        where: { warId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, guildId: true, guildName: true },
      });

      // Not a war. Bank the rounds anyway so every later poll stops re-checking
      // a night that is never going to be fought.
      if (entries.length < GUILD_WAR_MIN_GUILDS) {
        await tx.guildWar.updateMany({
          where: { id: warId, resolvedRounds: war.resolvedRounds },
          data: { resolvedRounds: due },
        });
        return;
      }

      const sides = await loadSides(tx, entries, now);

      const clashes: Prisma.GuildWarClashCreateManyInput[] = [];
      const tally = new Map<string, { score: number; wins: number; losses: number }>();
      const bank = (entryId: string, score: number, won: boolean) => {
        const row = tally.get(entryId) ?? { score: 0, wins: 0, losses: 0 };
        row.score += score;
        if (won) row.wins += 1;
        else row.losses += 1;
        tally.set(entryId, row);
      };

      for (let round = war.resolvedRounds; round < due; round++) {
        const at = roundStartsAt(war.startsAt, round);

        for (let index = 0; index < sides.length; index++) {
          const attackerSide = sides[index];
          const opponent = opponentForRound(sides.length, round, index);
          if (opponent < 0) continue;
          const defenderSide = sides[opponent];

          // A guild that emptied out mid-campaign fields nobody. It keeps the
          // points it already earned and simply stops fighting.
          const attacker =
            attackerSide.members[memberForRound(attackerSide.members.length, round)];
          const defender =
            defenderSide.members[
              memberForRound(defenderSide.members.length, round, GUILD_WAR_DEFENDER_SHIFT)
            ];
          if (!attacker || !defender) continue;

          // The day's swing (see applySwing): without it a guild a few percent
          // stronger sweeps every clash it takes part in, for thirty straight
          // rounds, and its rivals end the night on zero.
          const attackerPower = applySwing(
            attacker.attackBase *
              bonusMultiplier(attacker.heroAttackPct) *
              bonusMultiplier(attacker.attackBuffPct) +
              attackerSide.aidPower,
            secureRandom()
          );
          const defenderPower = applySwing(
            defender.defenceBase *
              DEFENSE_BONUS *
              bonusMultiplier(defender.heroDefencePct) *
              bonusMultiplier(defender.defenceBuffPct) +
              defenderSide.aidPower,
            secureRandom()
          );

          // Ties hold, exactly as in a raid — the defender owns the ground.
          const won = attackerPower > defenderPower;
          const points = clashPoints(won, attackerPower, defenderPower);

          clashes.push({
            warId,
            round,
            attackerGuildId: attackerSide.guildId,
            attackerGuildName: attackerSide.guildName,
            defenderGuildId: defenderSide.guildId,
            defenderGuildName: defenderSide.guildName,
            attackerEmpireId: attacker.empireId,
            attackerName: attacker.name,
            defenderEmpireId: defender.empireId,
            defenderName: defender.name,
            attackerPower,
            defenderPower,
            won,
            points,
            createdAt: at,
          });

          bank(attackerSide.entryId, won ? points : 0, won);
          bank(defenderSide.entryId, won ? 0 : points, !won);
        }
      }

      // Guarded on the counter we read: if another request slipped past the
      // lock boundary and advanced the war first, this whole batch rolls back
      // rather than double-writing the feed.
      const advanced = await tx.guildWar.updateMany({
        where: { id: warId, resolvedRounds: war.resolvedRounds },
        data: { resolvedRounds: due },
      });
      if (advanced.count === 0) throw new Error("guild war advance conflict");

      if (clashes.length > 0) await tx.guildWarClash.createMany({ data: clashes });
      // Every side, not just the ones that banked points this batch: the power
      // figure is what the board shows for a guild whether or not it scored, and
      // this is the only place the numbers are already loaded.
      for (const side of sides) {
        const row = tally.get(side.entryId);
        await tx.guildWarEntry.update({
          where: { id: side.entryId },
          data: {
            power: side.totalPower,
            ...(row
              ? {
                  score: { increment: row.score },
                  wins: { increment: row.wins },
                  losses: { increment: row.losses },
                }
              : {}),
          },
        });
      }
    },
    // A cold catch-up can fight the whole thirty rounds at once.
    { timeout: 30_000, maxWait: 10_000 }
  );
}

/**
 * Fight every war currently inside its window. Called from the page and the
 * live poll — the lazy clock in place of a cron.
 */
export async function advanceLiveWars(now: Date = new Date()): Promise<void> {
  const start = liveWarStart(now);
  if (!start) return;
  const war = await prisma.guildWar.findUnique({
    where: { startsAt: start },
    select: { id: true, status: true, resolvedRounds: true },
  });
  if (!war || war.status !== "SCHEDULED") return;
  if (roundsDueBy(start, now) <= war.resolvedRounds) return;
  try {
    await advanceWar(war.id, now);
  } catch (error) {
    console.error(`[guild-war] advance failed for ${war.id}`, error);
  }
}

/* ------------------------------ settlement ------------------------------ */

async function messageMembers(
  tx: Prisma.TransactionClient,
  empireIds: string[],
  message: { title: string; body: string }
): Promise<void> {
  if (empireIds.length === 0) return;
  await tx.message.createMany({
    data: empireIds.map((empireId) => ({
      empireId,
      kind: "SYSTEM" as const,
      title: message.title,
      body: message.body,
      href: "/game/war",
    })),
  });
}

/**
 * Rank one finished war and pay it out. Idempotent: the status flip is a
 * guarded update, so of two readers arriving together at 20:00 exactly one
 * settles and the other finds nothing to do.
 *
 * The Discord post is built inside the transaction and sent *after* it commits.
 * A network call inside a transaction holds a database connection open for the
 * length of somebody else's outage — and only the reader that actually won the
 * settlement race builds a podium, so the channel gets exactly one post per
 * war however many players happen to open the arena at 20:00.
 */
async function settleWar(warId: string, now: Date): Promise<void> {
  const podium = await prisma.$transaction(
    async (tx) => {
      const war = await tx.guildWar.findUnique({
        where: { id: warId },
        select: { startsAt: true },
      });
      if (!war) return null;

      // Entries are frozen the moment the bell rings — registration always
      // targets the *next* window (see registrationWarStart) — so reading them
      // before claiming the war is safe, and we need the count to know whether
      // this was a war at all.
      const entries = await tx.guildWarEntry.findMany({
        where: { warId },
        orderBy: [{ score: "desc" }, { wins: "desc" }, { createdAt: "asc" }],
      });
      const valid = entries.length >= GUILD_WAR_MIN_GUILDS;

      const claimed = await tx.guildWar.updateMany({
        where: { id: warId, status: "SCHEDULED" },
        data: { status: valid ? "SETTLED" : "CANCELLED", settledAt: now },
      });
      // Someone else settled it while we were counting — their prizes stand,
      // and their reader owns the announcement too.
      if (claimed.count === 0) return null;

      /**
       * Who the war pays: the roster the guild *enrolled*, not the roster it
       * happens to hold when the prizes are handed out.
       *
       * Paying the live roster was a straight steal. `joinGuild` is open to
       * anyone holding a guild id, the live scoreboard hands every viewer the
       * guild ids of the leaders, and settlement is lazy — it happens whenever
       * the next reader turns up, which can be well after 20:00. So the play was:
       * watch the board, leave your own guild at 19:59, join whoever is winning,
       * and collect 500 citizens + 300 turns + 5 spins for a campaign you were
       * not in — every night, from a guild that never agreed to carry you and
       * cannot refuse. Then hop back out.
       *
       * Pinning the payout to `createdAt <= startsAt` closes it: the guild is
       * paid for the war it turned up to. Someone who joins mid-campaign still
       * *fights* — loadSides reads the roster live, so they rotate into the
       * clashes and help their new guild score — they simply collect from the
       * next bell rather than from one that had already rung. That asymmetry is
       * the point: fighting is free, and the prize is what has to be earned.
       */
      const rosterAt = { createdAt: { lte: war.startsAt } };

      if (!valid) {
        // One guild answering the call is not a war. Whoever showed up is told
        // so plainly — silence here would read as a broken feature — and is
        // paid nothing at all.
        for (const entry of entries) {
          const members = await tx.guildMember.findMany({
            where: { guildId: entry.guildId, ...rosterAt },
            select: { empireId: true },
          });
          await messageMembers(
            tx,
            members.map((m) => m.empireId),
            {
              // i18n-exempt-start: stored Message rows, written by whichever
              // player happens to trigger the lazy settle — never the reader.
              // See the note in `attackEmpire`.
              title: "🏳️ מלחמת הבריתות בוטלה",
              body: `רק ברית אחת נרשמה למלחמה, ולכן היא לא התקיימה. אין מנצחת ואין פרסים. הירשמו שוב למחר — צריך לפחות ${GUILD_WAR_MIN_GUILDS} בריתות כדי שהקרב ייצא לדרך.`,
            }
          );
        }
        // Nothing to announce: "one guild signed up and went home" is news to
        // the guild it happened to, not to the channel.
        return null;
      }

      const guildCount = entries.length;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const rank = i + 1;
        const prize = prizeForRank(rank, guildCount);

        await tx.guildWarEntry.update({
          where: { id: entry.id },
          data: { rank, rewardLabel: prize ? prizeSummary(makeT(DEFAULT_LOCALE), prize) : null },
        });

        const members = await tx.guildMember.findMany({
          where: { guildId: entry.guildId, ...rosterAt },
          select: { empireId: true },
        });
        const memberIds = members.map((m) => m.empireId);
        // A guild whose entire enrolled roster has since left (or disbanded)
        // still gets its rank written above — the night happened — but there is
        // nobody left to pay or tell.
        if (memberIds.length === 0) continue;

        if (!prize) {
          await messageMembers(tx, memberIds, {
            title: "⚔️ מלחמת הבריתות הסתיימה",
            body: `${entry.guildName} סיימה במקום ${rank} מתוך ${guildCount} עם ${entry.score.toLocaleString("he-IL")} נקודות. אין פרס למקום הזה — נתראה מחר בזירה.`,
          });
          continue;
        }

        // updateMany, not a loop of update(): a member whose empire was
        // deleted between the last clash and settlement must not abort the
        // payout for the rest of the guild.
        await tx.empire.updateMany({
          where: { id: { in: memberIds } },
          data: {
            turns: { increment: prize.turns },
            wheelSpins: { increment: prize.wheelSpins },
          },
        });
        // Citizens are the one balance no caller may increment directly: every
        // source of them has to come through grantCitizens, because that helper
        // is the single choke point keeping the population faucet — and the
        // resource faucet one step downstream, via mine slaves — accounted for.
        // See src/lib/game/grants.ts.
        for (const memberId of memberIds) {
          await grantCitizens(tx, memberId, prize.citizens);
        }
        await messageMembers(tx, memberIds, {
          title: rank === 1 ? "👑 הברית שלך ניצחה במלחמה!" : "🥈 הברית שלך עלתה לפודיום!",
          body: `${entry.guildName} — ${prize.label} עם ${entry.score.toLocaleString("he-IL")} נקודות מתוך ${guildCount} בריתות. הפרס נכנס לאוצר שלך: ${prizeSummary(makeT(DEFAULT_LOCALE), prize)}.`,
        });
      }

      // No individual purse on top: nobody played the war, so there is no
      // personal performance to single out. The guild places, the guild is
      // paid, and every member is paid the same.

      return {
        guildCount,
        top: entries.slice(0, 3).map((entry, i) => ({
          rank: i + 1,
          name: entry.guildName,
          score: entry.score,
        })),
      };
    },
    // Settlement writes one row plus a message batch per guild; the default
    // 5s interactive budget is too tight for a full field.
    { timeout: 20_000, maxWait: 10_000 }
  );

  if (!podium) return;

  const medals = ["🥇", "🥈", "🥉"];
  await announceToDiscord({
    kind: "war",
    channel: "events",
    title: "⚔️ נגמרה המלחמה — הנה הטבלה",
    body:
      podium.top
        .map(
          (row) =>
            `${medals[row.rank - 1]} **${row.name}** — ${row.score.toLocaleString("he-IL")} נק׳`
        )
        .join("\n") +
      `\n\n${podium.guildCount} בריתות ירדו לזירה הערב. ריוונץ׳ מחר ב-19:30. ⏰`, // i18n-exempt-end
    url: gameLink("/game/war"),
  });
}

/**
 * Settle every war whose window has closed, fighting any rounds that were
 * never materialised first — a war nobody watched must still be a full thirty
 * rounds before it is ranked. Bounded, and per-war failures are contained so
 * one bad night cannot take the screen down with it.
 */
export async function settleDueWars(now: Date = new Date()): Promise<void> {
  const due = await prisma.guildWar.findMany({
    where: { status: "SCHEDULED", endsAt: { lte: now } },
    orderBy: { endsAt: "asc" },
    select: { id: true, resolvedRounds: true },
    take: 5,
  });
  for (const war of due) {
    try {
      if (war.resolvedRounds < GUILD_WAR_ROUNDS) await advanceWar(war.id, now);
      await settleWar(war.id, now);
    } catch (error) {
      console.error(`[guild-war] settlement failed for ${war.id}`, error);
    }
  }
  // Only after a war was actually claimed for settlement — which is once a
  // night, by whichever reader gets there first. This sweep is called from the
  // six-second live poll, and hanging an extra query off every one of those to
  // delete something that appears once a day is the kind of cost that only
  // shows up under load.
  if (due.length > 0) await purgeOldWars(now);
}

/**
 * Delete wars that are no longer news.
 *
 * A finished campaign is readable for exactly GUILD_WAR_RESULTS_LINGER_MS —
 * that is the whole window `getFocusWar` looks back over — and after it nothing
 * in the game can reach the row again: no ranking, medal, world record or
 * profile is derived from a war, and every prize was banked into the empires
 * themselves at settlement. What would be left behind is a nightly pile of
 * thirty rounds × entrants clash rows, kept forever for a screen with no way to
 * open it. So the history is not archived, it is dropped.
 *
 * Runs on the same lazy clock as the rest of the war (there is no cron), and
 * only over wars that are genuinely finished — a SCHEDULED window past its end
 * has not been paid out yet and belongs to settleWar above, not here.
 */
export async function purgeOldWars(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - GUILD_WAR_RESULTS_LINGER_MS);
  try {
    // Bounded like the settlement sweep: this runs on a page load, and a
    // one-off backlog is better cleared a few nights at a time than in one
    // cascade nobody asked for.
    const stale = await prisma.guildWar.findMany({
      where: { status: { in: ["SETTLED", "CANCELLED"] }, endsAt: { lt: cutoff } },
      orderBy: { endsAt: "asc" },
      select: { id: true },
      take: 10,
    });
    if (stale.length === 0) return;
    // Entries and clashes go with it — both cascade on warId.
    await prisma.guildWar.deleteMany({
      where: { id: { in: stale.map((war) => war.id) } },
    });
  } catch (error) {
    // Housekeeping must never take the arena down with it.
    console.error("[guild-war] purge failed", error);
  }
}

/* ------------------------------ reading the war ------------------------------ */

const WAR_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  resolvedRounds: true,
} satisfies Prisma.GuildWarSelect;

type WarRow = Prisma.GuildWarGetPayload<{ select: typeof WAR_SELECT }>;

function phaseOf(war: WarRow, now: Date): GuildWarPhase {
  if (war.status === "CANCELLED") return "CANCELLED";
  if (war.status === "SETTLED") return "SETTLED";
  if (now < war.startsAt) return "REGISTRATION";
  if (now < war.endsAt) return "LIVE";
  return "SETTLING";
}

/**
 * The war the screen should be showing, in priority order: the one being
 * fought right now, then one that finished recently enough that its result is
 * still the news, then the one open for registration. Null when no guild has
 * enrolled for tonight yet.
 */
export async function getFocusWar(now: Date): Promise<WarRow | null> {
  const liveStart = liveWarStart(now);
  if (liveStart) {
    const live = await prisma.guildWar.findUnique({
      where: { startsAt: liveStart },
      select: WAR_SELECT,
    });
    if (live) return live;
  }

  const recent = await prisma.guildWar.findFirst({
    where: {
      endsAt: {
        lte: now,
        gt: new Date(now.getTime() - GUILD_WAR_RESULTS_LINGER_MS),
      },
    },
    orderBy: { endsAt: "desc" },
    select: WAR_SELECT,
  });
  if (recent) return recent;

  return prisma.guildWar.findUnique({
    where: { startsAt: registrationWarStart(now) },
    select: WAR_SELECT,
  });
}

/**
 * The live board: scoreboard, feed and fighter table for `war`, from the point
 * of view of `empireId`.
 */
export async function buildLiveState(params: {
  empireId: string;
  myGuildId: string | null;
  war: WarRow | null;
  now: Date;
}): Promise<GuildWarLiveState> {
  const { empireId, myGuildId, war, now } = params;

  if (!war) {
    const startsAt = registrationWarStart(now);
    return {
      warId: null,
      phase: "REGISTRATION",
      startsAt: startsAt.getTime(),
      endsAt: warEndsAt(startsAt).getTime(),
      serverNow: now.getTime(),
      round: 0,
      guildCount: 0,
      valid: false,
      scoreboard: [],
      feed: [],
      fighters: [],
      myGuildId: null,
      myGuildName: null,
    };
  }

  const phase = phaseOf(war, now);

  const entries = await prisma.guildWarEntry.findMany({
    where: { warId: war.id },
    orderBy: [{ score: "desc" }, { wins: "desc" }, { createdAt: "asc" }],
  });

  const myEntry = myGuildId
    ? entries.find((entry) => entry.guildId === myGuildId) ?? null
    : null;

  const scoreboard: GuildWarScoreRow[] = entries.map((entry, index) => ({
    guildId: entry.guildId,
    guildName: entry.guildName,
    power: entry.power,
    score: entry.score,
    wins: entry.wins,
    losses: entry.losses,
    // Settled wars keep the rank they were paid on; a running war ranks live.
    rank: entry.rank ?? index + 1,
    rewardLabel: entry.rewardLabel,
    mine: entry.guildId === myGuildId,
  }));

  const clashes = await prisma.guildWarClash.findMany({
    where: { warId: war.id },
    orderBy: [{ round: "desc" }, { createdAt: "desc" }],
    take: FEED_LIMIT,
  });

  const feed: GuildWarFeedItem[] = clashes.map((clash) => ({
    id: clash.id,
    round: clash.round,
    attackerName: clash.attackerName,
    attackerEmpireId: clash.attackerEmpireId,
    attackerGuildName: clash.attackerGuildName,
    attackerGuildId: clash.attackerGuildId,
    defenderName: clash.defenderName,
    defenderEmpireId: clash.defenderEmpireId,
    defenderGuildName: clash.defenderGuildName,
    defenderGuildId: clash.defenderGuildId,
    won: clash.won,
    points: clash.points,
    at: clash.createdAt.getTime(),
    mine:
      myGuildId != null &&
      (clash.attackerGuildId === myGuildId || clash.defenderGuildId === myGuildId),
  }));

  /* ---- fighter board: points belong to whoever earned them ---- */
  // Run in sequence, not Promise.all: an interactive transaction is a single
  // connection, and these two reads follow the same discipline.
  const byAttack = await prisma.guildWarClash.groupBy({
    by: ["attackerEmpireId", "attackerName", "attackerGuildName"],
    where: { warId: war.id, won: true },
    _sum: { points: true },
    _count: { _all: true },
  });
  const byDefence = await prisma.guildWarClash.groupBy({
    by: ["defenderEmpireId", "defenderName", "defenderGuildName"],
    where: { warId: war.id, won: false },
    _sum: { points: true },
    _count: { _all: true },
  });

  const tally = new Map<string, GuildWarFighterRow>();
  for (const row of byAttack) {
    tally.set(row.attackerEmpireId, {
      empireId: row.attackerEmpireId,
      name: row.attackerName,
      title: null,
      guildName: row.attackerGuildName,
      points: row._sum.points ?? 0,
      wins: row._count._all,
      holds: 0,
      me: row.attackerEmpireId === empireId,
    });
  }
  for (const row of byDefence) {
    const prev = tally.get(row.defenderEmpireId);
    tally.set(row.defenderEmpireId, {
      empireId: row.defenderEmpireId,
      name: prev?.name ?? row.defenderName,
      title: null,
      guildName: prev?.guildName ?? row.defenderGuildName,
      points: (prev?.points ?? 0) + (row._sum.points ?? 0),
      wins: prev?.wins ?? 0,
      holds: row._count._all,
      me: row.defenderEmpireId === empireId,
    });
  }

  const fighters = [...tally.values()]
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, FIGHTER_LIMIT);

  // Titles for the fighter board, and only for it. The clash rows carry
  // denormalised names and no empire join, so this is a genuinely extra read —
  // affordable because it is taken *after* the cut: at most FIGHTER_LIMIT ids,
  // looked up by primary key, however many thousands of clashes the war
  // produced. The feed above is deliberately left alone; it is a stream, it can
  // run to hundreds of lines in one bell, and a coloured word on every one of
  // them would be wallpaper rather than a distinction (see WornTitle).
  const titles = fighters.length
    ? await prisma.empire.findMany({
        where: { id: { in: fighters.map((f) => f.empireId) } },
        select: { id: true, title: true },
      })
    : [];
  const titleById = new Map(titles.map((e) => [e.id, e.title]));
  for (const fighter of fighters) fighter.title = titleById.get(fighter.empireId) ?? null;

  return {
    warId: war.id,
    phase,
    startsAt: war.startsAt.getTime(),
    endsAt: war.endsAt.getTime(),
    serverNow: now.getTime(),
    round: war.resolvedRounds,
    guildCount: entries.length,
    valid: entries.length >= GUILD_WAR_MIN_GUILDS,
    scoreboard,
    feed,
    fighters,
    myGuildId: myEntry?.guildId ?? null,
    myGuildName: myEntry?.guildName ?? null,
  };
}
