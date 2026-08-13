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
import { formatNumber } from "@/lib/game/format";
import { RESOURCE_META } from "@/lib/game/constants";
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
  bossKillFraction,
  bossPayout,
  bossSiegeMaxHp,
  refitSiegePool,
  simulateBossSortie,
  type BossGrade,
  type BossRound,
} from "@/lib/game/bossBattle";

/**
 * Resolution for the city-boss siege.
 *
 * Two entry points:
 *
 *   `startBossAssault`  pays the turns, rolls the whole battle, sets its deadline
 *   `settleDueAssault`  applies a finished battle to the world and notifies
 *
 * The split is the feature. Nothing about an assault's outcome depends on the
 * player being present for it: the fight is decided at launch, the clock only
 * paces the reveal, and the settle is idempotent and lazy — triggered by whatever
 * reads next, including the inbox poll that runs on every game screen. A player
 * can press attack, walk to another page, and be told what they won.
 *
 * Both run inside a transaction that first takes `FOR UPDATE` on the empire row.
 * That lock is load-bearing rather than defensive: the settle reads a snapshot and
 * then writes derived values (health, casualties, loot, hero XP), so two
 * concurrent settles without it would pay the same assault twice — the exact
 * duplicate class this codebase has been bitten by before (see the stale-snapshot
 * notes in game.ts).
 */

/* ------------------------------ shared shapes ------------------------------ */

/** One resolved round as stored on the battle row. Re-exported for the UI. */
export type BossRoundLogEntry = BossRound;

export type BossSortieOutcome = { error: string } | { battleId: string; endsAt: number };

/** What a settle produced, or null when there was nothing due. */
export interface BossSettleResult {
  fightId: string;
  status: Exclude<BossBattleStatus, "ACTIVE">;
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

/* ------------------------------ the boss's current life ------------------------------ */

/**
 * The live boss of this empire's city tier, or the clock until it returns.
 *
 * A "siege" row is one *life* of the tyrant. It never resets while it is alive —
 * wounds accumulate across assaults for as long as it takes — and when it dies it
 * carries `revivesAt`, after which the next assault opens a fresh life at full
 * health. There is no shared schedule and no unique key to collide on; the empire
 * row lock in `startBossAssault` is what serialises concurrent marches.
 */
async function currentLife(
  tx: Prisma.TransactionClient,
  empireId: string,
  cities: number,
  now: Date,
  powerMultiplier: number,
  hpMultiplier: number
): Promise<{ siege: BossSiege } | { revivesAt: Date }> {
  const boss = bossForCity(cities);
  const newest = await tx.bossSiege.findFirst({
    where: { empireId, cityTier: cities },
    orderBy: { createdAt: "desc" },
  });

  const maxHp = bossSiegeMaxHp(cities, powerMultiplier, hpMultiplier);

  if (newest && newest.killedAt == null && newest.hp > 0) {
    // The curve may have moved under a life that is already in progress — a
    // deploy that retunes the pool, or an admin turning `boss.hpMultiplier`. Fit
    // it to today's pool at the share of health it has left, or the loot (which
    // is priced against `maxHp` at every settle) and the fight stop describing
    // the same tyrant. See `refitSiegePool` for why the fraction is what carries.
    if (newest.maxHp !== maxHp) {
      const refit = refitSiegePool(newest.hp, newest.maxHp, maxHp);
      return {
        siege: await tx.bossSiege.update({ where: { id: newest.id }, data: refit }),
      };
    }
    return { siege: newest };
  }
  if (newest?.revivesAt && newest.revivesAt > now) return { revivesAt: newest.revivesAt };

  return {
    siege: await tx.bossSiege.create({
      data: { empireId, cityTier: cities, bossKey: boss.key, maxHp, hp: maxHp },
    }),
  };
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
 * Send the army at the boss of this empire's own city tier.
 *
 * Pays the turns, rolls the entire battle, and stores it with a deadline. The
 * player is not asked for anything else — see `simulateBossSortie` for why the
 * outcome is decided here rather than a round at a time.
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

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

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
    const now = new Date();
    const boss = bossForCity(empire.cities);
    const turnCost = bossTurnCost(empire.cities);

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
      empireId,
      empire.cities,
      now,
      tunables.boss.powerMultiplier,
      tunables.boss.hpMultiplier
    );
    if ("revivesAt" in life) {
      return {
        error: t("{boss} מת — הוא קם לתחייה ב־{time}.", {
          boss: t(boss.name),
          time: life.revivesAt.toLocaleTimeString(LOCALE_TAG[locale], {
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
      bossPower: bossPower(empire.cities, tunables.boss.powerMultiplier),
      heroLevel: empire.hero?.level ?? 1,
      heroAlive,
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

    await tx.bossSiege.update({
      where: { id: siege.id },
      data: { sorties: { increment: 1 } },
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
 * Apply a finished assault to the world and write its report.
 *
 * The payout rules, in one place because they are the whole economy of the
 * feature:
 *
 *  - Every ending pays chip loot pro-rata to the damage dealt, out of the haul
 *    this boss *life* is worth. A rout pays it at `BOSS_ROUT_LOOT_PENALTY` —
 *    reduced, not voided: the army chose none of this, and confiscating the whole
 *    haul for an unlucky roll would read as a bug rather than a risk.
 *  - A kill also pays the hoard — the kill share, multiplied by the grade — plus
 *    the guaranteed piece of gear, and starts the revive clock.
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

  // The life the assault was launched against is gone: another assault felled it
  // first, or it revived out from under this one. Nothing to apply — the turns
  // were spent and the report says so.
  const stale = siege == null || siege.killedAt != null;
  // `outcome` is written by the simulation, which only ever produces a terminal
  // status; ACTIVE in that column would be a data bug, and settling it as EXPIRED
  // pays the chip loot rather than crashing the poll that found it.
  const status: Exclude<BossBattleStatus, "ACTIVE"> =
    stale || battle.outcome === "ACTIVE" ? "EXPIRED" : battle.outcome;
  const killed = status === "KILLED";
  const routed = status === "ROUTED";

  /* ---- the boss ---- */
  // Credited, not swung: a killing blow overshoots, often wildly (an army at ten
  // times the wall deals millions into a pool of tens of thousands). Capping at
  // what was standing keeps the report's number and the payout the same number.
  const credited = stale ? 0 : Math.min(battle.damageDealt, battle.hpAtStart);
  if (siege && !stale) {
    await tx.bossSiege.update({
      where: { id: siege.id },
      data: {
        hp: Math.max(0, siege.hp - credited),
        damageDealt: { increment: credited },
        ...(killed
          ? {
              killedAt: now,
              revivesAt: new Date(
                now.getTime() + bossReviveMs(tunables.boss.reviveMinutes)
              ),
            }
          : {}),
      },
    });
  }

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

  const chip =
    bossChipFraction(credited, siege?.maxHp ?? 0) * (routed ? BOSS_ROUT_LOOT_PENALTY : 1);
  const fraction = chip + (grade ? bossKillFraction(grade) : 0);
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
      bossHpAfter: Math.max(0, (siege?.hp ?? 0) - credited),
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
      body: settleSummary(t, t(boss.name), status, reward, heroXp, siege, credited, soldiersLost),
      href: `/game/boss/${fight.id}`,
    },
  });

  return { fightId: fight.id, status };
}

/** The one-paragraph "what you got and how much" that lands in the inbox. */
function settleSummary(
  t: T,
  bossName: string,
  status: Exclude<BossBattleStatus, "ACTIVE">,
  reward: BossReward,
  heroXp: number,
  siege: BossSiege | null,
  credited: number,
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
    siege && siege.killedAt == null && siege.hp - credited > 0
      ? t(" נותרו לו {hp} חיים.", {
          hp: formatNumber(Math.round(Math.max(0, siege.hp - credited))),
        })
      : "";

  if (status === "KILLED") {
    return t("{haul}{cost} הבוס יקום לתחייה בעוד שעה.", { haul, cost });
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

  // Only now, and deliberately in this order. This function is called from the
  // inbox poll that runs on *every* game screen, so the no-op path is by far the
  // hottest thing here — reading the config before knowing whether there is
  // anything to settle put a GameConfig row on every one of those polls for
  // nothing. It still has to happen before the transaction opens, for the
  // connection-pool reason in `startBossAssault`.
  const tunables = await getTunables();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
    // Re-read under the lock: a concurrent settle may have taken it already, and
    // paying an assault twice is the one mistake that matters here.
    const battle = await tx.bossBattle.findFirst({
      where: { id: due.id, status: "ACTIVE" },
    });
    if (!battle) return null;
    return settleBattle(tx, battle, empireId, new Date(), tunables);
  });
}
