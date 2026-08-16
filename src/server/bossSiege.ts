import "server-only";
import type {
  BossBattle,
  BossBattleStatus,
  BossSiege,
  HeroItemSlot,
  HeroRarity,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyPendingUpdates } from "@/lib/game/updates";
import { getTunables, type GameTunables } from "@/lib/game/config";
import { lastDailyUpdate } from "@/lib/game/time";
import { seasonPassDay } from "@/lib/game/seasonPass";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import { armyPower } from "@/lib/game/power";
import { weaponsPower } from "@/lib/game/weapons";
import { getActiveGuildBuffPct } from "@/lib/game/guildBuffs";
import { getGuildAidBonus } from "@/lib/game/guildAid";
import {
  HERO_BAG_CAPACITY,
  RARITY_ORDER,
  applyHeroXp,
  bonusMultiplier,
  classXpMultiplier,
  heroBonuses,
  isHeroDead,
  itemLevelForRarity,
  rollGuaranteedItem,
  CITIZENS_PER_LEVEL,
} from "@/lib/game/hero";
import { grantCitizens } from "@/lib/game/grants";
import { getActivePotionKinds } from "@/lib/game/potionEffects";
import { POTION_DOUBLE } from "@/lib/game/potions";
import { getLiveHappyHour, happyHourFactor } from "@/server/happyHour";
import { syncEmpirePower } from "@/server/empirePower";
import { heraldChat, heraldParams, type HeraldValue } from "@/server/herald";
import { logError } from "@/server/errorLog";
import { localRateLimit } from "@/lib/rateLimit";
import { notStaff } from "@/lib/staff";
import { notBot } from "@/lib/bot";
import { cityAt } from "@/lib/game/cities";
import { formatNumber } from "@/lib/game/format";
import { GAME_TIMEZONE, RESOURCE_META } from "@/lib/game/constants";
import { getI18n, getT, type T } from "@/i18n/server";
import { LOCALE_TAG } from "@/i18n/locale";
import {
  BOSS_ITEM_RARITY_FLOOR,
  BOSS_REWARD_RESOURCES,
  bossForCity,
  bossHeroXp,
  bossPower,
  bossReviveMs,
  bossReward,
  bossTurnCost,
  type BossReward,
} from "@/lib/game/bosses";
import {
  BOSS_SORTIE_ROUNDS,
  BOSS_ROUT_LOOT_PENALTY,
  bossAssaultDuration,
  bossChipFraction,
  bossGrade,
  bossKillShareFraction,
  bossPayout,
  bossSharedMaxHp,
  refitSiegePool,
  simulateBossSortie,
  type BossGrade,
  type BossRound,
} from "@/lib/game/bossBattle";

/**
 * Resolution for the city-boss siege — the tyrant a whole city tier shares.
 *
 * Three entry points:
 *
 *   `startBossAssault`  pays the turns, rolls the whole battle, *applies its
 *                       damage to the shared tyrant*, and sets the reveal's
 *                       deadline
 *   `settleDueAssault`  pays a finished battle's owner and writes their report
 *   `sweepCityBoss`     the lazy clock for everything that is the city's rather
 *                       than one player's: settling somebody else's finished
 *                       assault, sharing out the kill purse, announcing a revival
 *
 * ## Why the damage lands at launch and the loot at the settle
 *
 * The battle is decided the moment the player presses attack — that has always
 * been true — but while every empire fought a private copy of the boss it did not
 * matter *when* the wounds were written, so they were written at the settle with
 * everything else. On a shared tyrant it matters enormously:
 *
 *  - Two empires marching in the same minute would both read the same health,
 *    both roll a kill, and both be paid for felling it once.
 *  - An empire whose 300 turns bought a full assault would get nothing at all
 *    because somebody else's blow landed during its sixty-second reveal.
 *
 * So `hp` moves under the tier's lock at launch, and the reveal is exactly what
 * it always was: a decided fight, played out. What the settle still owns is the
 * *player's* half — the loot, the hero, the report, the message — because that is
 * what the minute is for. See `WorldBossStrike` for the same split.
 *
 * ## Locks, in this order, always
 *
 *   1. `pg_advisory_xact_lock(BOSS_TIER_LOCK, cityTier)` — the whole city
 *   2. `SELECT … FOR UPDATE` on each empire row it will write
 *   3. the siege row
 *
 * The advisory lock is what makes "read the tyrant's health, decide the fight,
 * write the wound" atomic across empires, and it is also what makes opening a new
 * life race-free. Taking it first everywhere is what keeps the kill purse (which
 * writes many empires) from deadlocking against an assault (which writes one
 * empire and the siege). Nothing here may take an empire row before the tier.
 */

/* ------------------------------ shared shapes ------------------------------ */

/** One resolved round as stored on the battle row. Re-exported for the UI. */
export type BossRoundLogEntry = BossRound;

export type BossSortieOutcome = { error: string } | { battleId: string; endsAt: number };

/** What a settle produced, or null when there was nothing due. */
export interface BossSettleResult {
  fightId: string;
  status: Exclude<BossBattleStatus, "ACTIVE">;
  /** The life it was fought against — the kill purse is claimed off this. */
  siegeId: string;
  cityTier: number;
}

/**
 * The hero columns a settle needs: the XP award reads level/xp, the class
 * multiplier reads heroClass, and both are zeroed for a dead hero — which is why
 * the vitals come along (see `classXpMultiplier`).
 */
const SETTLE_HERO_SELECT = {
  id: true,
  level: true,
  xp: true,
  heroClass: true,
  health: true,
  diedAt: true,
} as const;

/* ------------------------------ the tier lock ------------------------------ */

/**
 * Lock class for the city-boss advisory lock. An arbitrary constant; it only has
 * to be one nothing else in the schema uses, since Postgres advisory locks share
 * one global namespace.
 */
const BOSS_TIER_LOCK = 823_117;

/**
 * How often one instance runs the parts of the sweep that are somebody else's
 * business. A minute: the two things it repairs are already done by the request
 * that caused them in every case but a crash, so this is a safety net rather
 * than a schedule.
 */
const BOSS_SWEEP_EVERY_MS = 60_000;

/**
 * Serialise everything that happens to one city's tyrant.
 *
 * A transaction-scoped advisory lock rather than a row lock, because the row it
 * would protect does not exist yet on the path that matters most: two empires
 * opening the first life of a tier at the same instant. It is released on commit
 * or rollback with no cleanup, and it is held for the few milliseconds an assault
 * takes — a city is at most a handful of marches an hour.
 */
async function lockTier(tx: Prisma.TransactionClient, cityTier: number): Promise<void> {
  // `$executeRaw`, not `$queryRaw`: the function returns `void`, and Prisma cannot
  // deserialize a void column — `$queryRaw` throws "Failed to deserialize column of
  // type 'void'" and takes the whole assault down with it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOSS_TIER_LOCK}::int, ${cityTier}::int)`;
}

/** Lock one empire's row. Always after `lockTier`, never before. */
async function lockEmpire(tx: Prisma.TransactionClient, empireId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
}

/* ------------------------------ the tyrant's current life ------------------------------ */

/**
 * How long since an empire was last seen for it still to count as living in its
 * city.
 *
 * The pool is deep in proportion to the head count, so who is counted decides
 * whether the tyrant can be felled at all. Counting *every* empire ever
 * registered in a tier is the failure mode: a season that has passed two hundred
 * players through its first city would meet a seventy-million-point pool held up
 * by a dozen people who still play, nobody would ever land a killing blow, and
 * the kill purse — 45% of everybody's haul — would quietly stop being paid.
 *
 * A week is long enough that a player on holiday is still counted as a citizen
 * of their city, and short enough that abandoned accounts stop making the fight
 * heavier for the people who turned up. `lastSeenAt` is a genuine presence
 * heartbeat rather than a write marker (see the column note), which is exactly
 * what this needs.
 */
const BOSS_HEAD_COUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The empires a new life's pool is sized against: everyone living in the city
 * who could conceivably march on it.
 *
 * Staff are out of the game and a bot garrison is refused at the gate, so
 * counting either would deepen the pool for players who cannot help empty it.
 * Exported because the banner quotes the same figure before the first life of a
 * tier exists, and the two must never disagree about what a city is.
 *
 * Counted once, at spawn — see `bossSharedMaxHp` for why it is then frozen.
 */
export async function cityHeadCount(
  client: Prisma.TransactionClient | typeof prisma,
  cityTier: number,
  now: Date = new Date()
): Promise<number> {
  const heads = await client.empire.count({
    where: {
      cities: cityTier,
      ...notStaff,
      ...notBot,
      lastSeenAt: { gte: new Date(now.getTime() - BOSS_HEAD_COUNT_WINDOW_MS) },
    },
  });
  return Math.max(1, heads);
}

/**
 * The living tyrant of a city tier, or the clock until it returns.
 *
 * A siege row is one *life*, shared by the whole city. It never resets while it
 * is alive — wounds accumulate across everybody's assaults for as long as it
 * takes — and when it dies it carries `revivesAt`, after which the next assault
 * opens a fresh life at full health.
 *
 * The caller must already hold the tier lock: this reads the newest life and may
 * create one, and both halves have to be atomic against every other empire in
 * the city.
 */
async function currentLife(
  tx: Prisma.TransactionClient,
  cityTier: number,
  now: Date,
  powerMultiplier: number,
  hpMultiplier: number
): Promise<{ siege: BossSiege } | { revivesAt: Date }> {
  const boss = bossForCity(cityTier);
  const newest = await tx.bossSiege.findFirst({
    where: { cityTier },
    orderBy: { life: "desc" },
  });

  if (newest && newest.killedAt == null && newest.hp > 0) {
    // The curve may have moved under a life already in progress — a deploy that
    // retunes the pool, or an admin turning `boss.hpMultiplier`. Fit it to today's
    // pool at the share of health it has left, or the loot (priced against
    // `maxHp / participants` at every settle) and the fight stop describing the
    // same tyrant. The head count is *not* recomputed: it is what the city
    // committed to when the life opened. See `refitSiegePool`.
    const target = bossSharedMaxHp(
      cityTier,
      newest.participants,
      powerMultiplier,
      hpMultiplier
    );
    if (newest.maxHp !== target) {
      const refit = refitSiegePool(newest.hp, newest.maxHp, target);
      return {
        siege: await tx.bossSiege.update({ where: { id: newest.id }, data: refit }),
      };
    }
    return { siege: newest };
  }
  if (newest?.revivesAt && newest.revivesAt > now) return { revivesAt: newest.revivesAt };

  const participants = await cityHeadCount(tx, cityTier, now);
  const maxHp = bossSharedMaxHp(cityTier, participants, powerMultiplier, hpMultiplier);
  return {
    siege: await tx.bossSiege.create({
      data: {
        cityTier,
        bossKey: boss.key,
        life: (newest?.life ?? 0) + 1,
        participants,
        maxHp,
        hp: maxHp,
      },
    }),
  };
}

/**
 * One empire's share of a life's pool — the denominator every payout is priced
 * against.
 *
 * Never `maxHp`. A shared pool is the city's problem; the loot is the player's,
 * and dividing it by the head count is the one mistake that would turn this
 * fixture into a wage. See `bossChipFraction`.
 */
function lootShare(siege: Pick<BossSiege, "maxHp" | "participants">): number {
  return siege.maxHp / Math.max(1, siege.participants);
}

/** The empire's battle power, built from exactly the terms the banner shows. */
async function battlePower(
  tx: Prisma.TransactionClient,
  empireId: string,
  empire: Awaited<ReturnType<typeof applyPendingUpdates>>
): Promise<{ power: number; heroBonusPct: number; guildBonusPct: number }> {
  const heroBonusPct = heroBonuses(empire.hero).totalPct.attack;
  const guildBonusPct = await getActiveGuildBuffPct(empireId, "ATTACK", tx);
  const guildAid = await getGuildAidBonus(empireId, tx);
  return {
    power:
      (armyPower(empire.army) + weaponsPower(empire.weapons, "ATTACK")) *
        bonusMultiplier(heroBonusPct) *
        bonusMultiplier(guildBonusPct) +
      guildAid.power,
    heroBonusPct,
    guildBonusPct,
  };
}

/* ------------------------------ launching an assault ------------------------------ */

/**
 * Send the army at the tyrant of this empire's city.
 *
 * Pays the turns, rolls the entire battle, writes its wounds to the shared boss,
 * and stores the plan with a deadline. The player is not asked for anything else
 * — see `simulateBossSortie` for why the outcome is decided here rather than a
 * round at a time, and the note at the head of this file for why the wound lands
 * now while the loot waits for the reveal.
 */
export async function startBossAssault(empireId: string): Promise<BossSortieOutcome> {
  const { t, locale } = await getI18n();
  // Read outside the transaction, on purpose. `getTunables` goes to the database
  // on its own connection; asking for one while already holding a transaction (and
  // therefore a connection) means two per caller, and on a serverless fleet with a
  // small pool a burst of concurrent assaults can have every connection held by a
  // transaction waiting for a connection that will never come. It is React-cached
  // per request, so callers who already loaded it pay nothing here either.
  const tunables = await getTunables();

  // The tier has to be known *before* the transaction opens, because the tier lock
  // is the first thing taken inside it (see the lock order at the head of this
  // file) and it is keyed on the tier. This read is not authority: the empire is
  // re-read under its own lock below and the tier confirmed there.
  const scout = await prisma.empire.findUnique({
    where: { id: empireId },
    select: { cities: true },
  });
  if (!scout) return { error: t("לא מחובר") };
  const cityTier = scout.cities;

  return prisma.$transaction(async (tx) => {
    await lockTier(tx, cityTier);
    await lockEmpire(tx, empireId);

    if (tunables.boss.enabled < 1) {
      return { error: t("בוס העיר אינו זמין כרגע.") };
    }

    const empire = await applyPendingUpdates(empireId, tx);

    // Staff accounts are out of the game (src/lib/staff.ts), and the boss is a
    // public fixture: the conquerors' roll on the banner carries the name of
    // whoever felled it, and an admin's empire can be handed any army it likes.
    // A bot is refused for the same reason it is refused the arena — a planted
    // garrison marches on nothing.
    if (empire.isStaff || empire.isBot) {
      return { error: t("חשבונות הנהלה אינם תוקפים את שליט העיר.") };
    }
    // The city was founded between the scout read and the lock. Vanishingly rare,
    // and the honest answer is to ask again: the tier lock we are holding is the
    // wrong one, so marching now would write to the old city's tyrant.
    if (empire.cities !== cityTier) {
      return { error: t("האימפריה שלך בדיוק גדלה — נסה שוב") };
    }

    const now = new Date();
    const boss = bossForCity(cityTier);
    const turnCost = bossTurnCost(cityTier);

    // A running assault is never duplicated — the player is sent back to watch
    // the one they already launched. A finished one settles first, so pressing
    // attack twice in a row does the obvious thing instead of stacking.
    const open = await tx.bossBattle.findFirst({
      where: { empireId, status: "ACTIVE" },
      orderBy: { startedAt: "desc" },
    });
    if (open) {
      if (open.endsAt > now) return { battleId: open.id, endsAt: open.endsAt.getTime() };
      await settleBattle(tx, open, empireId, now, tunables);
    }

    const life = await currentLife(
      tx,
      cityTier,
      now,
      tunables.boss.powerMultiplier,
      tunables.boss.hpMultiplier
    );
    if ("revivesAt" in life) {
      return {
        error: t("{boss} מת — הוא קם לתחייה ב־{time}.", {
          boss: t(boss.name),
          time: life.revivesAt.toLocaleTimeString(LOCALE_TAG[locale], {
            // The server's clock is UTC in production; the hour a player is
            // told to come back on has to be theirs.
            timeZone: GAME_TIMEZONE,
            hour: "2-digit",
            minute: "2-digit",
          }),
        }),
      };
    }
    const siege = life.siege;

    const army = empire.army;
    if (!army || army.soldiers === 0) {
      return { error: t("אין לך צבא לתקיפה — אמן חיילים קודם") };
    }
    const tooFewTurns = {
      error: t("נדרשות {turns} תורות כדי לצאת לקרב מול {boss}.", {
        turns: turnCost.toLocaleString("en-US"),
        boss: t(boss.name),
      }),
    };
    if (empire.turns < turnCost) return tooFewTurns;

    // Guarded debit: a concurrent action can never drive turns negative.
    const paid = await tx.empire.updateMany({
      where: { id: empireId, turns: { gte: turnCost } },
      data: { turns: { decrement: turnCost } },
    });
    if (paid.count === 0) return tooFewTurns;

    const { power, heroBonusPct, guildBonusPct } = await battlePower(tx, empireId, empire);
    const heroAlive = empire.hero != null && !isHeroDead(empire.hero);

    const plan = simulateBossSortie({
      attackPower: power,
      soldiers: army.soldiers,
      bossHp: siege.hp,
      // The wall, not the pool: casualties are charged as a share of it, so an
      // army under the wall bleeds in the same proportion it loots. Passing the
      // tunable-scaled power keeps a softened boss cheap in blood too.
      bossPower: bossPower(cityTier, tunables.boss.powerMultiplier),
      heroLevel: empire.hero?.level ?? 1,
      heroAlive,
    });

    // Credited, not swung: a killing blow overshoots, often wildly (an army at ten
    // times the wall deals millions into what is left of the pool). Capping at what
    // was standing keeps the tyrant's health, the report's number and the payout
    // the same number — and it is recomputed identically at the settle.
    const credited = Math.min(plan.damageDealt, siege.hp);
    const killed = plan.outcome === "KILLED";

    await tx.bossSiege.update({
      where: { id: siege.id },
      data: {
        hp: Math.max(0, siege.hp - credited),
        damageDealt: { increment: credited },
        sorties: { increment: 1 },
        ...(killed
          ? {
              killedAt: now,
              revivesAt: new Date(now.getTime() + bossReviveMs(tunables.boss.reviveMinutes)),
              slayerId: empireId,
              slayerName: empire.name,
            }
          : {}),
      },
    });

    // The contribution board, and the list the kill purse is shared out over. Safe
    // as an upsert despite the P2002-inside-a-transaction trap: the tier lock means
    // there is no concurrent writer for this (siege, empire) pair.
    await tx.bossSiegeStrike.upsert({
      where: { siegeId_empireId: { siegeId: siege.id, empireId } },
      create: {
        siegeId: siege.id,
        empireId,
        empireName: empire.name,
        damage: credited,
        sorties: 1,
      },
      update: {
        empireName: empire.name,
        damage: { increment: credited },
        sorties: { increment: 1 },
      },
    });

    // The clock is sized to the plan, so a fight that ended on the first blow does
    // not leave the player watching a settled battle for another fifty seconds.
    const endsAt = new Date(now.getTime() + bossAssaultDuration(plan.rounds.length));
    const battle = await tx.bossBattle.create({
      data: {
        siegeId: siege.id,
        empireId,
        round: plan.rounds.length,
        maxRounds: BOSS_SORTIE_ROUNDS,
        outcome: plan.outcome,
        attackPower: power,
        heroBonusPct,
        guildBonusPct,
        soldiersAtStart: army.soldiers,
        soldiersLost: plan.soldiersLost,
        damageDealt: plan.damageDealt,
        hpAtStart: siege.hp,
        correctCounters: plan.correctCounters,
        decisions: plan.rounds.length,
        turnsSpent: turnCost,
        log: plan.rounds as unknown as Prisma.InputJsonValue,
        endsAt,
      },
    });

    // The pass pays for marching on the boss, once per daily cycle. Per assault it
    // would be farmable: the boss now revives hourly, so a player with banked
    // turns could buy the whole ladder in an afternoon (turn gain is uncapped —
    // see the note in bosses.ts).
    const paidToday = await tx.bossFight.count({
      where: { empireId, createdAt: { gte: lastDailyUpdate(now) } },
    });
    if (paidToday === 0) await awardSeasonPassXp(tx, empireId, "bossFight");

    return { battleId: battle.id, endsAt: endsAt.getTime() };
  });
}

/* ------------------------------ settling ------------------------------ */

/**
 * Apply a finished assault to its owner and write the report.
 *
 * The payout rules, in one place because they are the whole economy of the
 * feature:
 *
 *  - Every ending pays chip loot pro-rata to the damage dealt, out of one
 *    empire's share of the pool (`lootShare`) — never out of the shared pool, so
 *    what a march earns does not depend on how many neighbours turned up. A rout
 *    pays it at `BOSS_ROUT_LOOT_PENALTY` — reduced, not voided: the army chose
 *    none of this, and confiscating the whole haul for an unlucky roll would read
 *    as a bug rather than a risk.
 *  - The kill share is **not** paid here. It belongs to the city and is shared out
 *    over everyone who wounded the life, once, by `payKillSpoils` — which this
 *    settle's caller triggers when the assault was the closing one.
 *  - The killing blow does take the gear the tyrant leaves behind, and the grade
 *    it earned multiplies the purse everybody else collects.
 */
async function settleBattle(
  tx: Prisma.TransactionClient,
  battle: BossBattle,
  empireId: string,
  now: Date,
  // Passed in rather than read here: this runs inside a transaction, and see the
  // note at the head of `startBossAssault` for why a second connection must not be
  // asked for while one is held.
  tunables: GameTunables
): Promise<BossSettleResult> {
  const t = await getT();
  const siege = await tx.bossSiege.findUnique({ where: { id: battle.siegeId } });
  const hero = await tx.hero.findUnique({
    where: { empireId },
    select: SETTLE_HERO_SELECT,
  });

  const rounds = Array.isArray(battle.log) ? (battle.log as unknown as BossRound[]) : [];
  const cities = siege?.cityTier ?? 1;

  // The life is gone entirely — an admin cleared it, or a season restart wiped the
  // world under a running assault. Nothing to pay against; the turns were spent
  // and the report says so. (Unlike before this fixture was shared, a *dead* life
  // is not stale: this assault's damage was applied to it at launch and its loot
  // is owed either way.)
  const stale = siege == null;
  // `outcome` is written by the simulation, which only ever produces a terminal
  // status; ACTIVE in that column would be a data bug, and settling it as EXPIRED
  // pays the chip loot rather than crashing the poll that found it.
  const status: Exclude<BossBattleStatus, "ACTIVE"> =
    stale || battle.outcome === "ACTIVE" ? "EXPIRED" : battle.outcome;
  const killed = status === "KILLED";
  const routed = status === "ROUTED";

  // Recomputed exactly as `startBossAssault` computed it when it wrote the wound,
  // so the health the tyrant lost and the loot this player is paid are one number.
  const credited = stale ? 0 : Math.min(battle.damageDealt, battle.hpAtStart);

  /* ---- the army ---- */
  // Clamped to what is actually standing: the army may have been plundered or
  // enslaved during the minute the assault was running.
  const army = await tx.army.findUnique({ where: { empireId }, select: { soldiers: true } });
  const soldiersLost = stale ? 0 : Math.min(army?.soldiers ?? 0, battle.soldiersLost);
  if (soldiersLost > 0) {
    await tx.army.update({
      where: { empireId },
      data: { soldiers: { decrement: soldiersLost } },
    });
  }

  /* ---- the loot ---- */
  // Graded on the battle that was *fought*, not on what happened to be standing
  // when the settle ran — `battle.soldiersLost` / `battle.soldiersAtStart`, both
  // from the plan, never the clamped figure above.
  //
  // Using the clamp here was a live exploit. The clamp exists to protect the army
  // row (you cannot lose soldiers you no longer have), but the grade multiplies
  // the kill share, so routing it through the clamp meant an army that vanished
  // during the minute scored a *better* grade than one that stood and fought.
  // Measured: identical 78,000-damage sorties, one with the army dropped to zero
  // mid-assault — casualties 938 → 0, grade C → S, haul 150,000 → 183,800 gold
  // (+22.5%, and the same on every other resource, the pens and the hero XP).
  //
  // Reachable in play: the only thing that reduces `Army.soldiers` is losing a
  // defence (see the enslavement branch in game.ts), so an alt attacking you
  // inside your own assault window bought the grade — and the soldiers it took
  // went to the alt rather than being lost. It also made being raided mid-sortie
  // *improve* the reward, which is backwards on its own.
  const lossFraction =
    battle.soldiersAtStart > 0 ? battle.soldiersLost / battle.soldiersAtStart : 1;
  const grade: BossGrade | null = killed
    ? bossGrade(battle.correctCounters, battle.decisions, lossFraction)
    : null;

  const season = await tx.gameSeason.findFirst({
    where: { isActive: true },
    select: { startsAt: true, endsAt: true },
  });
  const lifeHaul = bossReward(
    cities,
    seasonPassDay(season, now.getTime()),
    tunables.boss.rewardMultiplier,
    tunables.boss.slaveMultiplier
  );

  const fraction =
    bossChipFraction(credited, siege ? lootShare(siege) : 0) *
    (routed ? BOSS_ROUT_LOOT_PENALTY : 1);
  // Happy Hour, read once for both halves of the payout below. The window
  // multiplies the *resources* the tyrant gives up and the hero's XP; the
  // captives it frees are deliberately left alone, because a slave is a
  // permanent addition to the production engine while a haul is spent.
  const happyHour = await getLiveHappyHour(tx, now);
  const reward: BossReward = bossPayout(
    lifeHaul,
    fraction,
    happyHourFactor(happyHour, "boostPlunder")
  );

  if (reward.gold > 0 || reward.wood > 0 || reward.iron > 0 || reward.stone > 0) {
    await tx.empire.update({
      where: { id: empireId },
      data: {
        gold: { increment: reward.gold },
        wood: { increment: reward.wood },
        iron: { increment: reward.iron },
        stone: { increment: reward.stone },
      },
    });
  }
  if (reward.slaves > 0) {
    // Captives dragged home from the boss's pens arrive unassigned.
    await tx.army.update({
      where: { empireId },
      data: { mineSlaves: { increment: reward.slaves } },
    });
  }
  if (soldiersLost > 0 || reward.slaves > 0) await syncEmpirePower(tx, empireId);

  /* ---- hero: XP on the same split as the loot, gear only on the kill ---- */
  const xpMultiplier =
    ((await getActivePotionKinds(empireId, tx, now)).has("DOUBLE_XP")
      ? POTION_DOUBLE
      : 1) * happyHourFactor(happyHour, "boostXp");
  const heroXp = Math.round(
    bossHeroXp(cities, tunables.boss.heroXpMultiplier) * fraction * xpMultiplier
  );
  let droppedItem: { slot: HeroItemSlot; level: number; rarity: HeroRarity } | null = null;

  if (hero && (heroXp > 0 || killed)) {
    const next = applyHeroXp(hero, Math.round(heroXp * classXpMultiplier(hero)));
    await tx.hero.update({
      where: { id: hero.id },
      data: {
        level: next.level,
        xp: next.xp,
        unspentPoints: { increment: next.pointsGained },
      },
    });
    // Level-up citizens go through grantCitizens so the city ceiling holds.
    const levelsGained = next.level - hero.level;
    if (levelsGained > 0) {
      await grantCitizens(tx, empireId, levelsGained * CITIZENS_PER_LEVEL);
    }

    // A felled boss always leaves gear behind, and never junk: the roll keeps the
    // normal rarity odds, but anything under the floor is re-rolled *as a level*
    // in the floor's band, so the worst boss drop is a מתקדם. An S grade lifts the
    // floor one rung.
    //
    // This is the one thing the killing blow keeps for itself. The purse it opens
    // is the city's (see `payKillSpoils`), but a piece of the tyrant's own gear
    // cannot be divided into tenths, and a shared fixture still needs a moment
    // that belongs to somebody.
    //
    // Raising `rarity` alone would not work: everywhere else in the game the tier
    // is derived from the level (`tierForLevel`), and the stored `rarity` column is
    // only a denormalised copy. A COMMON level tagged RARE would still display and
    // perform as COMMON — a lying row, not a floor.
    if (killed) {
      const bagCount = await tx.heroItem.count({
        where: { heroId: hero.id, equipped: false },
      });
      if (bagCount < HERO_BAG_CAPACITY) {
        const floorIndex = Math.min(
          RARITY_ORDER.length - 1,
          RARITY_ORDER.indexOf(BOSS_ITEM_RARITY_FLOOR) + (grade === "S" ? 1 : 0)
        );
        const floor = RARITY_ORDER[floorIndex];
        const rolled = rollGuaranteedItem(next.level);
        const belowFloor = RARITY_ORDER.indexOf(rolled.rarity) < floorIndex;
        droppedItem = belowFloor
          ? { slot: rolled.slot, level: itemLevelForRarity(next.level, floor), rarity: floor }
          : rolled;
        await tx.heroItem.create({ data: { heroId: hero.id, ...droppedItem } });
      }
    }
  }

  /* ---- close the battle and write the report ---- */
  await tx.bossBattle.update({
    where: { id: battle.id },
    data: { status, endedAt: now },
  });

  const boss = bossForCity(cities);
  const fight = await tx.bossFight.create({
    data: {
      empireId,
      battleId: battle.id,
      endedBy: status,
      cityTier: cities,
      bossKey: siege?.bossKey ?? boss.key,
      victory: killed,
      attackerPower: battle.attackPower,
      bossPower: bossPower(cities, tunables.boss.powerMultiplier),
      bossMaxHp: siege?.maxHp ?? 0,
      bossHpAfter: Math.max(0, battle.hpAtStart - credited),
      damageDealt: credited,
      rounds: rounds.length,
      grade,
      soldiersLost,
      turnsSpent: battle.turnsSpent,
      rewardGold: reward.gold,
      rewardWood: reward.wood,
      rewardIron: reward.iron,
      rewardStone: reward.stone,
      rewardSlaves: reward.slaves,
      heroBonusPct: battle.heroBonusPct,
      guildBonusPct: battle.guildBonusPct,
      heroXp,
      ...(droppedItem
        ? {
            droppedItemSlot: droppedItem.slot,
            droppedItemLevel: droppedItem.level,
            droppedItemRarity: droppedItem.rarity,
          }
        : {}),
    },
  });

  /* ---- tell the player ---- */
  // The whole point of a fight that runs without you: it has to come find you.
  // An unread Message is both the live toast (WarAlerts polls it) and the inbox
  // badge, and its href is the full report — so "what did I get and how much" is
  // answered in the toast itself and one click away in full.
  await tx.message.create({
    data: {
      empireId,
      kind: "BATTLE",
      // The reader is the player who sent the army — the same person whose
      // request settled it — so the request's own language is theirs. (Unlike
      // the mail an attack sends to its *victim*; see the note in `attackEmpire`.)
      title: killed
        ? t("👑 {boss} הופל!", { boss: t(boss.name) })
        : status === "ROUTED"
          ? t("💥 הצבא נשבר מול {boss}", { boss: t(boss.name) })
          : status === "EXPIRED"
            ? t("⚔️ הקרב מול {boss} נסגר", { boss: t(boss.name) })
            : t("🩸 {boss} נפצע אבל שרד", { boss: t(boss.name) }),
      body: settleSummary(
        t,
        t(boss.name),
        status,
        reward,
        heroXp,
        siege,
        battle.hpAtStart - credited,
        soldiersLost
      ),
      href: `/game/boss/${fight.id}`,
    },
  });

  return { fightId: fight.id, status, siegeId: battle.siegeId, cityTier: cities };
}

/** The one-paragraph "what you got and how much" that lands in the inbox. */
function settleSummary(
  t: T,
  bossName: string,
  status: Exclude<BossBattleStatus, "ACTIVE">,
  reward: BossReward,
  heroXp: number,
  siege: BossSiege | null,
  /** The tyrant's health the instant this assault's own damage was applied. */
  hpAfter: number,
  soldiersLost: number
): string {
  const spoils = BOSS_REWARD_RESOURCES.filter((res) => reward[res] > 0).map((res) =>
    t("{resource} {amount}", {
      resource: t(RESOURCE_META[res].label),
      amount: formatNumber(reward[res]),
    })
  );
  if (reward.slaves > 0) {
    spoils.push(t("{count} עבדים", { count: formatNumber(reward.slaves) }));
  }
  if (heroXp > 0) {
    spoils.push(t("{amount} ניסיון לגיבור", { amount: formatNumber(heroXp) }));
  }

  const haul =
    spoils.length > 0
      ? t("שלל: {spoils}.", { spoils: spoils.join(" · ") })
      : t("בלי שלל.");
  const cost =
    soldiersLost > 0
      ? t(" אבדות: {count} חיילים.", { count: formatNumber(soldiersLost) })
      : "";
  const left =
    siege && siege.killedAt == null && hpAfter > 0
      ? t(" נותרו לו {hp} חיים.", { hp: formatNumber(Math.round(Math.max(0, hpAfter))) })
      : "";

  if (status === "KILLED") {
    return t("{haul}{cost} אוצר ההפלה מתחלק בין כל מי שפצע אותו, והוא יקום לתחייה בעוד שעה.", {
      haul,
      cost,
    });
  }
  if (status === "ROUTED") {
    return t("הקו נשבר והצבא נסוג מוקדם.{left} {haul}{cost}", { left, haul, cost });
  }
  if (status === "EXPIRED") {
    return t("הקרב נסגר לפני שהוכרע. {haul}{cost}", { haul, cost });
  }
  return t("{boss} עוד עומד.{left} {haul}{cost} צא שוב וסיים את העבודה.", {
    boss: bossName,
    left,
    haul,
    cost,
  });
}

/* ------------------------------ the kill purse ------------------------------ */

/**
 * Share the fallen tyrant's hoard out over everyone who wounded it.
 *
 * The kill share used to be the killing blow's alone, which was the right answer
 * while every empire fought a private copy: you felled your own boss, you took
 * your own hoard. On a shared fixture it would mean the strongest empire in the
 * city collecting the whole purse of a pool ten people emptied — so the purse is
 * pro-rata on exactly the basis the chip loot is (`bossKillShareFraction`), and
 * an empire that did one share's worth of damage takes one full kill purse. What
 * belongs to the blow that closed it is the grade — which multiplies *everyone's*
 * cut — the gear, and the line in the public room.
 *
 * Exactly-once is `spoilsPaidAt`, claimed by a guarded UPDATE before a single
 * resource moves. It is claimed inside the same transaction that pays, so a crash
 * halfway rolls the claim back with the payments and the next sweep retries.
 *
 * Runs after the settle has committed rather than inside it, for the reason every
 * fan-out in this codebase does: it writes a row per besieger, and hanging that
 * off the killing player's own transaction would make their report wait for the
 * city's bookkeeping.
 */
async function payKillSpoils(siegeId: string): Promise<void> {
  try {
    const tunables = await getTunables();
    const head = await prisma.bossSiege.findUnique({
      where: { id: siegeId },
      select: { cityTier: true, killedAt: true, spoilsPaidAt: true },
    });
    // The cheap probe that answers "nothing to do" without opening a transaction,
    // which is the common case on every sweep.
    if (!head || head.killedAt == null || head.spoilsPaidAt != null) return;

    await prisma.$transaction(async (tx) => {
      await lockTier(tx, head.cityTier);

      const siege = await tx.bossSiege.findUnique({ where: { id: siegeId } });
      if (!siege || siege.killedAt == null || siege.spoilsPaidAt != null) return;

      // The grade the closing blow earned, off its report. A killing assault that
      // has not settled yet has no grade to read and no report to point at — the
      // next sweep will find it (this is why the claim below is not taken first).
      const closing = await tx.bossFight.findFirst({
        where: { cityTier: siege.cityTier, victory: true, battle: { siegeId } },
        orderBy: { createdAt: "desc" },
        select: { grade: true },
      });
      if (!closing) return;
      const grade = (closing.grade as BossGrade | null) ?? "C";

      // The receipt, before anything moves.
      const claimed = await tx.bossSiege.updateMany({
        where: { id: siegeId, spoilsPaidAt: null },
        data: { spoilsPaidAt: new Date() },
      });
      if (claimed.count === 0) return;

      const strikes = await tx.bossSiegeStrike.findMany({
        where: { siegeId, damage: { gt: 0 } },
        // Sorted by empire id, not by damage: this is the order the rows are
        // locked in, and a stable one is what keeps two payouts (a player who
        // founded a city between two lives can appear in both) from deadlocking.
        orderBy: { empireId: "asc" },
      });
      if (strikes.length === 0) return;

      const now = new Date();
      const season = await tx.gameSeason.findFirst({
        where: { isActive: true },
        select: { startsAt: true, endsAt: true },
      });
      const lifeHaul = bossReward(
        siege.cityTier,
        seasonPassDay(season, now.getTime()),
        tunables.boss.rewardMultiplier,
        tunables.boss.slaveMultiplier
      );
      const happyHour = await getLiveHappyHour(tx, now);
      const plunderFactor = happyHourFactor(happyHour, "boostPlunder");
      const xpFactor = happyHourFactor(happyHour, "boostXp");
      const share = lootShare(siege);
      const boss = bossForCity(siege.cityTier);
      const fullXp = bossHeroXp(siege.cityTier, tunables.boss.heroXpMultiplier);

      for (const strike of strikes) {
        const fraction = bossKillShareFraction(strike.damage, share, grade);
        if (fraction <= 0) continue;
        const reward = bossPayout(lifeHaul, fraction, plunderFactor);
        // Happy Hour only here; the per-player brew is applied below, where the
        // hero is read.
        const heroXp = Math.round(fullXp * fraction * xpFactor);

        await lockEmpire(tx, strike.empireId);
        if (reward.gold > 0 || reward.wood > 0 || reward.iron > 0 || reward.stone > 0) {
          await tx.empire.update({
            where: { id: strike.empireId },
            data: {
              gold: { increment: reward.gold },
              wood: { increment: reward.wood },
              iron: { increment: reward.iron },
              stone: { increment: reward.stone },
            },
          });
        }
        if (reward.slaves > 0) {
          await tx.army.update({
            where: { empireId: strike.empireId },
            data: { mineSlaves: { increment: reward.slaves } },
          });
          await syncEmpirePower(tx, strike.empireId);
        }

        // The hero learns from the kill on the same basis as it learns from the
        // wearing-down: XP is pro-rata against damage, so folding the kill share
        // into the purse is what keeps a levelling hero exactly where it was
        // before the tyrant became everybody's.
        const hero = await tx.hero.findUnique({
          where: { empireId: strike.empireId },
          select: SETTLE_HERO_SELECT,
        });
        if (hero && heroXp > 0) {
          // The brew is read per besieger, not once for the fan-out: a potion is
          // a timed buff one player paid for, and half their boss XP arriving
          // un-doubled because somebody else landed the killing blow is the kind
          // of quiet shortfall nobody can report but everybody feels.
          const doubled = (await getActivePotionKinds(strike.empireId, tx, now)).has(
            "DOUBLE_XP"
          )
            ? POTION_DOUBLE
            : 1;
          const next = applyHeroXp(
            hero,
            Math.round(heroXp * doubled * classXpMultiplier(hero))
          );
          await tx.hero.update({
            where: { id: hero.id },
            data: {
              level: next.level,
              xp: next.xp,
              unspentPoints: { increment: next.pointsGained },
            },
          });
          const levelsGained = next.level - hero.level;
          if (levelsGained > 0) {
            await grantCitizens(tx, strike.empireId, levelsGained * CITIZENS_PER_LEVEL);
          }
        }

        // i18n-keys-start: written on the slayer's request and read by every
        // besieger, so the row carries keys and their values and the sentence is
        // assembled in each reader's own language — see renderMessageText.
        const slaves: HeraldValue =
          reward.slaves > 0
            ? { key: " · {count} עבדים", params: { count: formatNumber(reward.slaves) } }
            : "";
        const xp: HeraldValue =
          heroXp > 0
            ? { key: " · {count} ניסיון לגיבור", params: { count: formatNumber(heroXp) } }
            : "";
        await tx.message.create({
          data: {
            empireId: strike.empireId,
            kind: "SYSTEM",
            title: "👑 {boss} נפל — הנה חלקך",
            titleParams: heraldParams({ boss: { key: boss.name } }),
            body: "{slayer} הנחית את המכה האחרונה, ואוצר {boss} התחלק בין כל מי שפצע אותו. חלקך, לפי הנזק שגרמת: {gold} זהב · {wood} עץ · {iron} ברזל · {stone} אבן{slaves}{xp}",
            bodyParams: heraldParams({
              slayer: siege.slayerName ?? "—",
              boss: { key: boss.name },
              gold: formatNumber(reward.gold),
              wood: formatNumber(reward.wood),
              iron: formatNumber(reward.iron),
              stone: formatNumber(reward.stone),
              slaves,
              xp,
            }),
            href: "/game/rankings",
          },
        });
        // i18n-keys-end
      }
    });
  } catch (err) {
    // The claim rolls back with the payments, so a failure here is a purse that is
    // still owed rather than one that was lost: the next sweep picks it up.
    await logError("bossSiege.payKillSpoils", err);
  }
}

/* ------------------------------ the lazy clocks ------------------------------ */

/**
 * Settle this empire's assault if its clock has run out.
 *
 * Cheap and idempotent, because it is called from everywhere a player might be
 * when the minute elapses: the arena, the boss banner, and the inbox poll that
 * runs on every game screen. Returns null when there is nothing due, which is the
 * overwhelmingly common case — one indexed lookup and out.
 */
export async function settleDueAssault(empireId: string): Promise<BossSettleResult | null> {
  const now = new Date();
  const due = await prisma.bossBattle.findFirst({
    where: { empireId, status: "ACTIVE", endsAt: { lte: now } },
    select: { id: true },
  });
  if (!due) return null;
  return settleAndHerald(due.id, empireId);
}

/**
 * Everything about the city's tyrant that is nobody's own poll to run.
 *
 * A private boss only ever needed the one clock — its owner's. A shared one has
 * three things that must happen whether or not the player they concern is at the
 * keyboard, and this is the sweep that runs them off whatever load happens to
 * come next (there is no cron in this deployment):
 *
 *  1. **Somebody else's finished assault.** A player who closed the tab mid-reveal
 *     has an unsettled battle, and it is holding the kill purse of the whole city
 *     if theirs was the closing blow.
 *  2. **An unpaid kill purse**, for the same reason.
 *  3. **The revival**, announced to the people who were fighting it.
 *
 * Only the third is the poller's own news, so only the third runs on every poll:
 * it is one indexed lookup that finds nothing on all but a handful of calls a
 * day. The other two are repairs to somebody else's interrupted request, so they
 * are gated to once a minute per instance per tier — the same ceiling and the
 * same reasoning as `sweepWorldBossSpoils`.
 */
export async function sweepCityBoss(cityTier: number): Promise<boolean> {
  try {
    if (localRateLimit(`cityboss:sweep:${cityTier}`, 1, BOSS_SWEEP_EVERY_MS)) {
      const now = new Date();
      // Somebody else's expired assault. Capped rather than drained: a sweep is a
      // passenger on somebody's page load, and whatever it leaves behind the next
      // one takes.
      const due = await prisma.bossBattle.findMany({
        where: { status: "ACTIVE", endsAt: { lte: now }, siege: { cityTier } },
        orderBy: { endsAt: "asc" },
        take: 3,
        select: { id: true, empireId: true },
      });
      for (const battle of due) await settleAndHerald(battle.id, battle.empireId);

      // A life that fell and has not paid out. `settleAndHerald` pays the purse
      // the moment the closing assault settles; this is the retry for the case
      // where that call died between the two.
      const unpaid = await prisma.bossSiege.findFirst({
        where: { cityTier, killedAt: { not: null }, spoilsPaidAt: null },
        orderBy: { life: "desc" },
        select: { id: true },
      });
      if (unpaid) await payKillSpoils(unpaid.id);
    }

    return await announceBossRevival(cityTier);
  } catch (err) {
    await logError("bossSiege.sweepCityBoss", err);
    return false;
  }
}

/**
 * The settle, plus the two things the rest of the city gets out of it.
 *
 * Split out so both run **after** the transaction has committed. They have to:
 * both write through the shared client, and asking for a second connection while
 * holding a transaction's is the deadlock this file warns about at its head.
 * Committing first is also the honest order — a room told a tyrant is down before
 * the row says so is a room that can be wrong.
 */
async function settleAndHerald(
  battleId: string,
  empireId: string
): Promise<BossSettleResult | null> {
  const result = await runSettle(battleId, empireId);
  if (result?.status === "KILLED") {
    await payKillSpoils(result.siegeId);
    await heraldBossFelled(result.fightId);
  }
  return result;
}

async function runSettle(
  battleId: string,
  empireId: string
): Promise<BossSettleResult | null> {
  // Only now, and deliberately in this order. This function is called from the
  // inbox poll that runs on *every* game screen, so the no-op path is by far the
  // hottest thing here — reading the config before knowing whether there is
  // anything to settle put a GameConfig row on every one of those polls for
  // nothing. It still has to happen before the transaction opens, for the
  // connection-pool reason in `startBossAssault`.
  const tunables = await getTunables();

  return prisma.$transaction(async (tx) => {
    await lockEmpire(tx, empireId);
    // Re-read under the lock: a concurrent settle may have taken it already, and
    // paying an assault twice is the one mistake that matters here.
    const battle = await tx.bossBattle.findFirst({
      where: { id: battleId, status: "ACTIVE" },
    });
    if (!battle) return null;
    return settleBattle(tx, battle, empireId, new Date(), tunables);
  });
}

/* ------------------------------ heralds ------------------------------ */

/**
 * "The city just put its tyrant down."
 *
 * Chat rather than the inbox, deliberately: the people with money in this are
 * told by name (`payKillSpoils` writes each besieger their share), and everybody
 * else gets the line in the room — which is what makes the ladder above it feel
 * inhabited. See the channel note at the head of herald.ts.
 */
async function heraldBossFelled(fightId: string): Promise<void> {
  try {
    const fight = await prisma.bossFight.findUnique({
      where: { id: fightId },
      select: {
        cityTier: true,
        empire: { select: { name: true, isStaff: true, isBot: true } },
      },
    });
    // Staff are out of the game and a garrison is not a player: neither belongs
    // in a feed of who is doing what (src/lib/staff.ts, src/lib/bot.ts).
    if (!fight || fight.empire.isStaff || fight.empire.isBot) return;
    // i18n-keys-start: stored on the chat row as a key, assembled in each
    // reader's own language when the room is polled — see server/herald.ts.
    await heraldChat({
      key: "⚔️ {empire} הנחית את המכה האחרונה על {boss}, עריץ {city}.",
      params: {
        empire: fight.empire.name,
        boss: { key: bossForCity(fight.cityTier).name },
        city: { key: cityAt(fight.cityTier).name },
      },
    });
    // i18n-keys-end
  } catch (err) {
    // The assault has already been settled and paid. A herald that fails is a
    // line nobody reads, never a battle that did not happen.
    await logError("bossSiege.heraldBossFelled", err);
  }
}

/**
 * "The tyrant is back on its feet."
 *
 * A felled boss returns after `boss.reviveMinutes`, and until now nothing said
 * so: the countdown lived on the banner, which means the player learned their
 * boss was available by going to look — the exact opposite of what a
 * notification is for.
 *
 * ## Who is told
 *
 * The empires that were fighting *this* life, off its own strike rows. Not the
 * whole tier: a player who has never marched on the tyrant has not asked to hear
 * about it every hour, and the fan-out is naturally bounded by the people who did.
 *
 * ## Why it is claimed here rather than fired on the clock
 *
 * There is no cron in this deployment, so nothing runs at the instant
 * `revivesAt` passes. This is the lazy clock the rest of the game uses: it rides
 * the inbox poll, which is the one call that runs on every screen, and in the
 * overwhelmingly common case it is a single indexed lookup that finds nothing.
 * The claim is a guarded UPDATE, so of the several players in the city polling at
 * the same second exactly one writes the messages.
 *
 * Returns whether anything was written — used only to decide whether the caller's
 * screen is now stale.
 */
export async function announceBossRevival(cityTier: number): Promise<boolean> {
  try {
    const now = new Date();
    const due = {
      cityTier,
      killedAt: { not: null },
      revivesAt: { lte: now },
      revivedNotifiedAt: null,
    } as const;

    // The cheap probe that answers "no" almost every time, on the same
    // [cityTier, life] index the siege lookup uses.
    const newest = await prisma.bossSiege.findFirst({
      where: due,
      orderBy: { life: "desc" },
      select: { id: true },
    });
    if (!newest) return false;

    const claimed = await prisma.bossSiege.updateMany({
      where: { ...due, id: newest.id },
      data: { revivedNotifiedAt: now },
    });
    if (claimed.count === 0) return false;

    const besiegers = await prisma.bossSiegeStrike.findMany({
      where: { siegeId: newest.id },
      select: { empireId: true },
    });
    if (besiegers.length === 0) return false;

    const boss = bossForCity(cityTier);
    // i18n-keys-start: the row holds keys and their values; the sentence is
    // assembled when its owner opens the inbox — see renderMessageText.
    await prisma.message.createMany({
      data: besiegers.map((b) => ({
        empireId: b.empireId,
        kind: "SYSTEM" as const,
        // Keys, not sentences: these rows are written on whichever request
        // happened to trip the poll and read by their owners later, possibly in
        // the other language. See renderMessageText.
        title: "👹 {boss} קם לתחייה",
        titleParams: heraldParams({ boss: { key: boss.name } }),
        body: "{boss}, {title}, עומד שוב על שערי {city} בחיים מלאים. כל העיר תוקפת אותו יחד — צא למצור.",
        bodyParams: heraldParams({
          boss: { key: boss.name },
          title: { key: boss.title },
          city: { key: cityAt(cityTier).name },
        }),
        href: "/game/rankings",
      })),
    });
    // i18n-keys-end
    return true;
  } catch (err) {
    await logError("bossSiege.announceBossRevival", err);
    return false;
  }
}
