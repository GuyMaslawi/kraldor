import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BUILDING_META,
  bankInterestRate,
  citizensPerDailyUpdate,
  cityProductionMultiplier,
  mineProductionPerTick,
  type StorableResource,
} from "./constants";
import { getTunables } from "./config";
import { dailyUpdatesBetween, elapsedRegularTicks, lastTickBoundary } from "./time";
import { turnsGainFromUpgrades } from "./turns";
import {
  HERO_FLAT_CADENCE,
  HERO_MAX_HEALTH,
  bonusMultiplier,
  heroBonuses,
  heroPointPool,
  heroPointsHeld,
  heroShouldRevive,
  resourceProductionPct,
  type HeroFlatCadence,
  type HeroFlatStat,
} from "./hero";
import {
  monumentBonuses,
  monumentLuckChance,
  monumentMultiplier,
} from "./monuments";
import { secureRandom } from "./random";
import { getActiveGuildBuffPct } from "./guildBuffs";
import { getActiveResourceBoosts } from "./diamondEffects";
import { getActivePotionKinds } from "./potionEffects";
import { POTION_DOUBLE } from "./potions";
import { computePower } from "@/server/empirePower";
import { mineTicksWithHappyHour } from "@/server/happyHour";
import { restoreBotGarrison } from "@/server/bots";

const FULL_EMPIRE_INCLUDE = {
  buildings: true,
  army: true,
  storages: true,
  upgrades: true,
  bankAccount: true,
  weapons: true,
  weaponUnlocks: true,
  hero: { include: { items: true } },
  // At most five rows, and it rides the same JOINed read as everything else —
  // see relationLoadStrategy below. This function is the *only* place the
  // monuments' effects are applied (rule 2 in lib/game/monuments.ts), so it is
  // the one place they have to be loaded.
  monuments: true,
} satisfies Prisma.EmpireInclude;

export type FullEmpire = Prisma.EmpireGetPayload<{
  include: typeof FULL_EMPIRE_INCLUDE;
}>;

/**
 * Lazy game clock: apply every missed 5-minute production tick and every
 * missed daily update (07:30 / 19:30 Asia/Jerusalem) for this empire.
 * Called whenever the empire is loaded or acts.
 */
export async function applyPendingUpdates(
  empireId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<FullEmpire> {
  let empire = await tx.empire.findUniqueOrThrow({
    where: { id: empireId },
    include: FULL_EMPIRE_INCLUDE,
    // One JOINed query instead of ~10 (one per relation). This runs on every
    // /game page load via requireEmpire, so it's the app's hottest read.
    relationLoadStrategy: "join",
  });

  const now = new Date();

  // A bot's garrison grows back on the same lazy clock, before anything else
  // reads its army — this function is what loads a target for a raid or a spy
  // mission, so a bot is rebuilt in the breath before it is fought rather than
  // by a scheduler nobody is running. Once an hour at most, and only for an
  // empire actually flagged as one, so a player's settle pays a boolean check
  // and no query at all. See server/bots.ts.
  if (empire.isBot && (await restoreBotGarrison(tx, empireId, now))) {
    empire = await tx.empire.findUniqueOrThrow({
      where: { id: empireId },
      include: FULL_EMPIRE_INCLUDE,
      relationLoadStrategy: "join",
    });
  }

  // Empires created before the hero system get their hero lazily.
  if (!empire.hero) {
    empire.hero = {
      ...(await tx.hero.create({ data: { empireId } })),
      items: [],
    };
  }

  // A fallen hero rises by himself an hour after the blow that felled him.
  // This is part of the lazy clock on purpose: it runs on every page load and
  // every action, so the hour passes for offline players too. Guarded on the
  // `diedAt` we read — if a concurrent settlement (or a diamond revival) got
  // there first the updateMany matches nothing, and either way the hero is
  // alive again, so the in-memory snapshot below is corrected unconditionally.
  const deadHero = empire.hero;
  if (deadHero && heroShouldRevive(deadHero, now)) {
    await tx.hero.updateMany({
      where: { id: deadHero.id, diedAt: deadHero.diedAt },
      data: { health: HERO_MAX_HEALTH, diedAt: null },
    });
    deadHero.health = HERO_MAX_HEALTH;
    deadHero.diedAt = null;
  }

  // The point pool is an invariant, not a running total: a hero is owed one
  // point per level he stands at plus 25 for every reset behind him
  // (`heroPointPool`). Every grant path increments the column as it raises the
  // level, but the columns are also written *absolutely* elsewhere — the admin
  // editor sets all four from a form, and a hero created before a rule change
  // never saw the difference — so a row can fall behind the pool and silently
  // stay there (a level-16 hero holding 9 points). Reconciling here, on the same
  // lazy clock that revives him, means the shortfall is repaid the next time the
  // player so much as loads a page. Only a *deficit* is paid: an excess is left
  // alone, since taking allocated points back would silently weaken an empire.
  const hero = empire.hero;
  if (hero) {
    const owed = heroPointPool(hero.level, hero.resets) - heroPointsHeld(hero);
    if (owed > 0) {
      // Guarded on the exact snapshot that produced the figure, so a concurrent
      // level-up (which increments the same column) can never be double-paid.
      const paid = await tx.hero.updateMany({
        where: {
          id: hero.id,
          level: hero.level,
          resets: hero.resets,
          unspentPoints: hero.unspentPoints,
          attackPoints: hero.attackPoints,
          defensePoints: hero.defensePoints,
          resourcePoints: hero.resourcePoints,
        },
        data: { unspentPoints: { increment: owed } },
      });
      if (paid.count > 0) hero.unspentPoints += owed;
    }
  }

  const tunables = await getTunables();

  // Hero bonuses: the resources *points* still multiply mine production, while
  // equipped items add flat amounts in whole units — each on its own cadence,
  // which is HERO_FLAT_CADENCE's business and not this function's (resources and
  // turns per 5-minute tick, citizens and diamonds per daily update). A hero who
  // is still dead at this point contributes none of it (heroBonuses).
  const heroBonus = heroBonuses(empire.hero);

  // The capital's monuments, folded into five percentages. This is the only
  // place in the game they are read — see rule 2 in lib/game/monuments.ts, and
  // note that none of them touches combat power, which is why nothing outside
  // this function has to know they exist.
  const monuments = monumentBonuses(empire.monuments);

  /* ---- regular ticks: mine-slave production + turns ---- */
  const ticks = elapsedRegularTicks(empire.lastRegularUpdateAt, now);
  const gained: Record<StorableResource, number> = { gold: 0, wood: 0, iron: 0, stone: 0 };
  let turnsGained = 0;
  if (ticks > 0) {
    // An active guild resources spell multiplies mine production on top of
    // the hero bonus for the ticks being settled now; diamond boosts add a
    // further per-resource multiplier on top of both.
    const guildResourcesPct = await getActiveGuildBuffPct(empire.id, "RESOURCES", tx, now);
    const resourceBoosts = await getActiveResourceBoosts(empire.id, tx, now);
    // שיקוי השפע doubles raw mine output for its hour. It multiplies the ticks
    // settled *by this call* — which is why drinkPotion settles the backlog
    // before opening the window, so a night of unsettled ticks can't be doubled
    // retroactively by drinking at dawn.
    const potionResources = (await getActivePotionKinds(empire.id, tx, now)).has(
      "DOUBLE_RESOURCES"
    )
      ? POTION_DOUBLE
      : 1;
    // Cities multiply raw mine output: ×1 at one city, ×10 at ten. Derived from
    // the live count, so a city lost to siege drops production on the next tick.
    const baseMultiplier =
      bonusMultiplier(resourceProductionPct(heroBonus)) *
      bonusMultiplier(guildResourcesPct) *
      potionResources *
      // עמוד הפועלים. Multiplies alongside the hero and the guild spell rather
      // than adding into either, so a monument is worth the same *proportion*
      // however decorated the empire already is.
      monumentMultiplier(monuments.mines) *
      tunables.economy.mineProductionMultiplier *
      cityProductionMultiplier(empire.cities);
    // Happy Hour rides on the *tick count*, not the multiplier: the backlog being
    // settled here may straddle the edges of a window (or a window that opened
    // and closed while the player was offline), and only the ticks that fell
    // inside it may be paid at the golden rate. See server/happyHour.ts.
    const productionTicks = await mineTicksWithHappyHour(
      ticks,
      empire.lastRegularUpdateAt,
      now,
      tx
    );
    for (const building of empire.buildings) {
      const meta = BUILDING_META[building.type];
      if (!meta.producedResource) continue;
      const multiplier =
        baseMultiplier * bonusMultiplier(resourceBoosts[meta.producedResource]);
      gained[meta.producedResource] +=
        mineProductionPerTick(building.level, building.slavesAssigned) *
        productionTicks *
        multiplier;
    }
    // Full ticks only — no partial-tick turns, no cap for now. The hero's turn
    // items are added below, with every other flat gear grant.
    //
    // מגדל השעון multiplies the upgrade's rate, not the tick count: the ticks
    // being settled are a fact about the clock, and a monument that changed how
    // many of them there were would double-pay any backlog it straddled.
    turnsGained = Math.round(
      ticks *
        turnsGainFromUpgrades(empire.upgrades) *
        monumentMultiplier(monuments.turns)
    );
  }

  /* ---- daily: citizens + bank interest + period reset ---- */
  const missedDailies = dailyUpdatesBetween(empire.lastDailyUpdateAt, now);
  let citizensGained = 0;
  if (missedDailies.length > 0) {
    const growthLevel =
      empire.upgrades.find((u) => u.type === "CITIZEN_GROWTH")?.level ?? 1;
    const citizensPerDaily = citizensPerDailyUpdate(growthLevel, tunables.daily);
    // No ceiling: the whole backlog lands, so a week away is a week's citizens
    // rather than one update's worth. Cities still shape this figure through the
    // CITIZEN_GROWTH levels they unlock — they just no longer cap the pool.
    // שער הניצחון multiplies the upgrade's intake but NOT the hero's flat item
    // bonus (added below): a flat grant from a piece of gear is a fixed number of
    // people the item conjures, and a percentage of it would make the monument
    // worth more to a decorated hero than to a bare one, for no reason a player
    // could name.
    citizensGained = Math.round(
      citizensPerDaily * missedDailies.length * monumentMultiplier(monuments.citizens)
    );
  }

  /* ---- the flat gear grants, each on its own cadence ---- */

  // How many updates of each cadence this settlement is paying for.
  const updatesByCadence: Record<HeroFlatCadence, number> = {
    regular: ticks,
    daily: missedDailies.length,
  };
  /**
   * The whole flat yield of one gear stat for this settlement: its per-update
   * amount times however many of *its own* updates elapsed. The cadence comes
   * from HERO_FLAT_CADENCE and nowhere else, so a stat can never be paid on the
   * wrong clock — which is exactly the bug this shape exists to make impossible.
   *
   * The whole backlog always lands, on both clocks: a week away is a week's
   * turns, citizens and diamonds, not one update's worth.
   */
  const itemYield = (stat: HeroFlatStat) =>
    heroBonus.itemsFlat[stat] * updatesByCadence[HERO_FLAT_CADENCE[stat]];

  // Equipped resource items conjure a flat amount per update — but only for the
  // specific resources their tier covers (some feed one resource, some several,
  // an אגדי relic all four), which is why this reads the per-resource split
  // rather than itemsFlat.resources.
  const resourceUpdates = updatesByCadence[HERO_FLAT_CADENCE.resources];
  for (const res of Object.keys(gained) as StorableResource[]) {
    gained[res] += heroBonus.itemsFlatByResource[res] * resourceUpdates;
  }

  // Turns ride the 5-minute tick, in the same unit as the turns upgrade above —
  // a maxed 🪽 is worth the whole upgrade ladder and no more. They spent a while
  // on the daily clock instead, after a genuine 288× cadence bug (40 per *tick*
  // paid 11,520 turns a day against a designed 1,440); the curve is now stated in
  // per-tick units, so the cadence and the ceiling agree. See FLAT_CURVE.
  turnsGained += itemYield("turns");
  citizensGained += itemYield("citizens");
  // 👖 distils diamonds, and it is the only thing in the game that mints the paid
  // currency on a curve. Deliberately the slow clock: a diamond faucet on the
  // 5-minute tick is 288 times a trickle, which is an income.
  const diamondsGained = itemYield("diamonds");

  // Top up wheel spins once per missed daily update. Spins bank without limit
  // — a player who is away for a week comes back to the whole backlog.
  // Credited as a *delta* (never an absolute set): this claim can win the race
  // even when a concurrent grant path — minigame prize, item discard, battle
  // reward — has incremented wheelSpins without advancing lastDailyUpdateAt.
  // An absolute `wheelSpins: value` would clobber that grant (lost update,
  // destroying the won spins); the increment composes with it.
  //
  // גלגל השמיים adds to it, as a *chance* rather than as a multiplier: one roll
  // per missed update at the monument's own percentage, each winning one extra
  // spin. It used to multiply the grant and floor the result, which paid
  // literally nothing below +25% — see monumentLuckChance for why that whole
  // shape was wrong. Rolled per update rather than once for the backlog so a
  // week away is a week's worth of chances, exactly like the base grant.
  const wheelLuckChance = monumentLuckChance(monuments.wheelLuck);
  let bonusSpins = 0;
  for (let i = 0; i < missedDailies.length; i += 1) {
    if (wheelLuckChance > 0 && secureRandom() < wheelLuckChance) bonusSpins += 1;
  }
  const wheelSpinsDelta =
    missedDailies.length > 0
      ? Math.max(
          0,
          Math.floor(tunables.daily.wheelSpins * missedDailies.length) + bonusSpins
        )
      : 0;

  if (ticks === 0 && missedDailies.length === 0) return empire;

  // Claim this settlement atomically. The guard pins the clock columns to the
  // exact snapshot we read; if a concurrent settlement of the same empire has
  // already advanced the clock, this updateMany matches zero rows and we bail
  // out without re-crediting. Without this guard the derived production, turns
  // and citizens would be credited N times when N requests settle the
  // same backlog at once — and this runs *without* an outer transaction on
  // every page load (see requireEmpire in lib/auth.ts) and across many empires
  // concurrently on the rankings page.
  const claim = await tx.empire.updateMany({
    where: {
      id: empireId,
      ...(ticks > 0 ? { lastRegularUpdateAt: empire.lastRegularUpdateAt } : {}),
      ...(missedDailies.length > 0
        ? { lastDailyUpdateAt: empire.lastDailyUpdateAt }
        : {}),
    },
    data: {
      gold: { increment: gained.gold },
      wood: { increment: gained.wood },
      iron: { increment: gained.iron },
      stone: { increment: gained.stone },
      citizens: { increment: citizensGained },
      turns: { increment: turnsGained },
      // Omitted entirely when nothing was distilled, so an empire without 👖
      // never touches the paid-currency column on a routine settle.
      ...(diamondsGained > 0 ? { diamonds: { increment: diamondsGained } } : {}),
      // The denormalised power figures, re-derived from the army and arsenal
      // this settle already loaded — no extra query, and it makes every settle
      // a repair. A write path that changes an army and forgets to call
      // syncEmpirePower therefore costs a stale ladder until this player's next
      // page load, not a permanently wrong one. See server/empirePower.ts.
      ...computePower(empire.army, empire.weapons),
      ...(missedDailies.length > 0 && wheelSpinsDelta > 0
        ? { wheelSpins: { increment: wheelSpinsDelta } }
        : {}),
      // Snap to the global boundary that was just settled, so every empire
      // ticks together on round wall-clock times (XX:00, XX:05, …).
      ...(ticks > 0 ? { lastRegularUpdateAt: lastTickBoundary(now) } : {}),
      ...(missedDailies.length > 0
        ? { lastDailyUpdateAt: missedDailies[missedDailies.length - 1] }
        : {}),
    },
  });

  // Lost the race: another settlement already applied this backlog. Return the
  // freshly-settled row without crediting anything again (bank interest below
  // is likewise skipped, so interest cannot compound twice per daily boundary).
  if (claim.count === 0) {
    return tx.empire.findUniqueOrThrow({
      where: { id: empireId },
      include: FULL_EMPIRE_INCLUDE,
    });
  }

  // Only the settlement that won the claim compounds bank interest and opens a
  // new deposit period.
  const bankAccount = empire.bankAccount;
  if (bankAccount && missedDailies.length > 0) {
    // Interest compounds once per missed daily update, floored to whole gold.
    const interestLevel =
      empire.upgrades.find((u) => u.type === "BANK_DAILY_INTEREST")?.level ?? 1;
    // בית הגנזים multiplies the rate the upgrade bought. Applied *after* the
    // ladder's own clamp rather than before it: BANK_INTEREST_MAX_RATE exists
    // because interest compounds on plunder-immune gold twice a day, and a
    // monument that raised the ceiling would be a different feature from a
    // monument that helps you reach it. At full height this is +24% of a rate
    // already capped — meaningful, and still bounded.
    const rate = bankInterestRate(interestLevel) * monumentMultiplier(monuments.interest);
    let balance = bankAccount.goldBalance;
    const interestEntries: { amount: number; balanceAfter: number; createdAt: Date }[] = [];
    for (const dailyAt of missedDailies) {
      const interest = Math.floor(balance * rate);
      if (interest <= 0) continue;
      balance += interest;
      interestEntries.push({ amount: interest, balanceAfter: balance, createdAt: dailyAt });
    }

    // Every daily update opens a new deposit period. Credit the accrued
    // interest as an *increment*, never an absolute set: this settle can run
    // without an outer transaction (see requireEmpire / the rankings page), so a
    // concurrent deposit/withdraw may commit between the read at the top of this
    // function and this write. An absolute `goldBalance: balance` would clobber
    // that concurrent bank action (lost update — duplicating or destroying
    // gold); the delta form composes with it. Matches castBankInterestSpell.
    const accruedInterest = balance - bankAccount.goldBalance;
    await tx.bankAccount.update({
      where: { id: bankAccount.id },
      data: {
        goldBalance: { increment: accruedInterest },
        depositsUsedInCurrentPeriod: 0,
        depositPeriodStartedAt: missedDailies[missedDailies.length - 1],
      },
    });
    if (interestEntries.length > 0) {
      await tx.bankTransaction.createMany({
        data: interestEntries.map((entry) => ({
          bankAccountId: bankAccount.id,
          empireId: empire.id,
          type: "INTEREST" as const,
          ...entry,
        })),
      });
    }
  }

  // Warehouse capacity limits only the protected stored pool — production
  // accumulates freely into the available balance.
  return tx.empire.findUniqueOrThrow({
    where: { id: empireId },
    include: FULL_EMPIRE_INCLUDE,
    relationLoadStrategy: "join",
  });
}