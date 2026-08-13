import { describe, expect, it } from "vitest";
import type { BossMove, BossTactic } from "@prisma/client";
import {
  BOSS_CASUALTIES,
  BOSS_CHIP_SHARE,
  BOSS_FURY_MAX,
  BOSS_FURY_ON_MISREAD,
  BOSS_FURY_PER_ROUND,
  BOSS_HP_PER_POWER,
  BOSS_KILL_SHARE,
  BOSS_LOSS_ENGAGEMENT_FLOOR,
  BOSS_MOVE_COUNTER,
  BOSS_MOVE_WEIGHTS,
  BOSS_ROUND_DAMAGE_BASE,
  BOSS_ROUND_LOSS_BASE,
  BOSS_ROUT_LOSS_FRACTION,
  BOSS_SORTIE_ROUNDS,
  BOSS_TACTIC_MATRIX,
  bossChipFraction,
  bossFuryMultiplier,
  bossFightScore,
  bossGrade,
  bossKillFraction,
  bossLossScale,
  bossPayout,
  bossExpectedSortieDamage,
  bossExpectedSortieLosses,
  bossReadChance,
  bossSiegeMaxHp,
  bossSortiesToKill,
  canReleaseFury,
  refitSiegePool,
  resolveBossRound,
  rollBossMove,
  roundRevealAt,
  bossAssaultDuration,
  autoTactic,
  simulateBossSortie,
  BOSS_ASSAULT_DURATION_MS,
  BOSS_ASSAULT_VERDICT_MS,
  BOSS_READ_CHANCE_BASE,
  BOSS_READ_CHANCE_MAX,
  BOSS_READ_CHANCE_NO_HERO,
  BOSS_ROUND_REVEAL_MS,
  BOSS_ROUT_LOOT_PENALTY,
  type BossCounter,
} from "@/lib/game/bossBattle";
import {
  BOSS_REVIVE_MS,
  bossHeroXp,
  bossPower,
  bossReviveMs,
  bossReward,
} from "@/lib/game/bosses";

const MOVES: BossMove[] = ["SMASH", "SWEEP", "EXPOSED"];
const COUNTERS: BossCounter[] = ["ASSAULT", "SHIELD", "FLANK"];

/** A deterministic stand-in for the CSPRNG, cycling a fixed sequence. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Variance off: `jitter` reads 0.5 as dead centre, so every roll is 1.0×. */
const noJitter = () => 0.5;

function baseInput(over: Partial<Parameters<typeof resolveBossRound>[0]> = {}) {
  return {
    move: "SMASH" as BossMove,
    tactic: "SHIELD" as BossTactic,
    attackPower: 10_000,
    soldiers: 1_000,
    soldiersAtStart: 1_000,
    bossHp: 1_000_000,
    fury: 0,
    heroLevel: 1,
    heroAlive: true,
    ...over,
  };
}

describe("the tactic matrix", () => {
  it("gives every telegraph exactly one counter, and no counter answers two", () => {
    // The fight's entire skill is a 1:1 mapping. A move with two right answers
    // (or a tactic that answers two moves) would make guessing correct half the
    // time by accident.
    expect(new Set(Object.values(BOSS_MOVE_COUNTER)).size).toBe(MOVES.length);
    for (const move of MOVES) expect(COUNTERS).toContain(BOSS_MOVE_COUNTER[move]);
  });

  it("makes the counter the best damage answer to its own move", () => {
    for (const move of MOVES) {
      const counter = BOSS_MOVE_COUNTER[move];
      const best = Math.max(...COUNTERS.map((t) => BOSS_TACTIC_MATRIX[move][t].damage));
      expect(BOSS_TACTIC_MATRIX[move][counter].damage).toBe(best);
    }
  });

  it("makes the counter the cheapest answer in blood for SMASH and SWEEP", () => {
    // EXPOSED is the exception on purpose: shielding a bared guard is safest of
    // all, it just wastes the one round that pays. The counter has to be the
    // cheapest answer where the boss is actually swinging.
    for (const move of ["SMASH", "SWEEP"] as const) {
      const counter = BOSS_MOVE_COUNTER[move];
      const cheapest = Math.min(...COUNTERS.map((t) => BOSS_TACTIC_MATRIX[move][t].taken));
      expect(BOSS_TACTIC_MATRIX[move][counter].taken).toBe(cheapest);
    }
  });

  it("never lets a shield wall be a bloodbath — it is the honest hedge", () => {
    for (const move of MOVES) {
      expect(BOSS_TACTIC_MATRIX[move].SHIELD.taken).toBeLessThanOrEqual(0.8);
      // ...and never a damage race either, or hedging would dominate.
      expect(BOSS_TACTIC_MATRIX[move].SHIELD.damage).toBeLessThan(1.4);
    }
  });

  it("weights the telegraph to a whole distribution", () => {
    const total = MOVES.reduce((sum, m) => sum + BOSS_MOVE_WEIGHTS[m], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("rolls the move from the weights, and lands on each one", () => {
    expect(rollBossMove(() => 0)).toBe("SMASH");
    expect(rollBossMove(() => 0.5)).toBe("SWEEP");
    expect(rollBossMove(() => 0.9)).toBe("EXPOSED");
    // A degenerate 1.0 must still return a move rather than undefined: the value
    // goes straight into a non-null enum column.
    expect(MOVES).toContain(rollBossMove(() => 1));
  });
});

describe("resolving a round", () => {
  it("scales damage with battle power and the matrix", () => {
    const r = resolveBossRound(
      baseInput({ move: "EXPOSED", tactic: "ASSAULT" }),
      noJitter
    );
    const expected =
      10_000 * BOSS_ROUND_DAMAGE_BASE * BOSS_TACTIC_MATRIX.EXPOSED.ASSAULT.damage;
    expect(r.damage).toBe(Math.round(expected));
    expect(r.correct).toBe(true);
  });

  it("measures casualties against the army that marched, not the survivors", () => {
    // Both calls have the same `soldiersAtStart`; the second is already down to
    // half strength. The loss is identical, which is what keeps the rout line a
    // straight cumulative fraction instead of an asymptote.
    const full = resolveBossRound(baseInput({ soldiers: 1_000 }), noJitter);
    const mauled = resolveBossRound(baseInput({ soldiers: 500 }), noJitter);
    expect(mauled.soldiersLost).toBe(full.soldiersLost);
  });

  it("never kills more soldiers than are standing", () => {
    const r = resolveBossRound(
      baseInput({ move: "SMASH", tactic: "ASSAULT", soldiers: 3 }),
      noJitter
    );
    expect(r.soldiersLost).toBeLessThanOrEqual(3);
  });

  it("reports a kill the round the pool empties", () => {
    const r = resolveBossRound(baseInput({ bossHp: 100 }), noJitter);
    expect(r.bossHpAfter).toBe(0);
    expect(r.killed).toBe(true);
    expect(r.routed).toBe(false);
  });

  it("lets a kill outrank a rout on the same blow", () => {
    // The formation broke and the tyrant fell together. The army that killed it
    // is not denied the hoard on a technicality.
    const r = resolveBossRound(
      baseInput({
        move: "SMASH",
        tactic: "ASSAULT",
        bossHp: 1,
        soldiers: 1_000,
        soldiersAtStart: 1_000,
      }),
      () => 0.99
    );
    expect(r.killed).toBe(true);
    expect(r.routed).toBe(false);
  });

  it("routs when cumulative losses reach the line", () => {
    // Already at the line before the round: any further loss trips it.
    const r = resolveBossRound(
      baseInput({ soldiers: 501, soldiersAtStart: 1_000, bossHp: 1e9 }),
      noJitter
    );
    expect(r.routed).toBe(true);
  });

  // Every assertion about blood from here on is gated on the mechanic being on.
  // The assault is bloodless (BOSS_ROUND_LOSS_BASE = 0) and these tests hold its
  // balance, so they wait rather than being deleted — re-deriving it from scratch
  // is the alternative. "a bloodless assault" below asserts what is true *now*.
  it.runIf(BOSS_CASUALTIES)("routs an army wiped to the last soldier", () => {
    const r = resolveBossRound(
      baseInput({ soldiers: 1, soldiersAtStart: 1, bossHp: 1e9, move: "SMASH", tactic: "ASSAULT" }),
      noJitter
    );
    expect(r.soldiersLost).toBe(1);
    expect(r.routed).toBe(true);
  });

  it("charges fury every round, and faster when the read was wrong", () => {
    const right = resolveBossRound(baseInput({ move: "SMASH", tactic: "SHIELD" }), noJitter);
    const wrong = resolveBossRound(baseInput({ move: "SMASH", tactic: "FLANK" }), noJitter);
    expect(right.furyAfter).toBe(BOSS_FURY_PER_ROUND);
    expect(wrong.furyAfter).toBe(BOSS_FURY_PER_ROUND + BOSS_FURY_ON_MISREAD);
    expect(wrong.correct).toBe(false);
  });

  it("caps the fury meter", () => {
    const r = resolveBossRound(baseInput({ fury: BOSS_FURY_MAX - 1 }), noJitter);
    expect(r.furyAfter).toBe(BOSS_FURY_MAX);
  });

  it("spends fury whole and hits for the hero's multiplier", () => {
    const r = resolveBossRound(
      baseInput({ tactic: "FURY", fury: BOSS_FURY_MAX, heroLevel: 30, move: "SWEEP" }),
      noJitter
    );
    expect(r.furyUsed).toBe(true);
    expect(r.furyAfter).toBe(0);
    expect(r.correct).toBe(true);
    expect(r.damage).toBe(
      Math.round(10_000 * BOSS_ROUND_DAMAGE_BASE * bossFuryMultiplier(30))
    );
  });

  it("beats the best ordinary round with a fury, at every hero level", () => {
    const bestOrdinary = Math.max(
      ...MOVES.flatMap((m) => COUNTERS.map((t) => BOSS_TACTIC_MATRIX[m][t].damage))
    );
    for (const level of [1, 30, 60, 100]) {
      expect(bossFuryMultiplier(level)).toBeGreaterThan(bestOrdinary);
    }
  });

  it("caps the hero-level term so a max-level fury cannot run away", () => {
    expect(bossFuryMultiplier(100)).toBe(bossFuryMultiplier(1000));
  });

  it("refuses to arm fury for a dead or half-charged hero", () => {
    expect(canReleaseFury(BOSS_FURY_MAX, false)).toBe(false);
    expect(canReleaseFury(BOSS_FURY_MAX - 1, true)).toBe(false);
    expect(canReleaseFury(BOSS_FURY_MAX, true)).toBe(true);
  });

  it("degrades an unchargeable FURY to a shield wall rather than to nothing", () => {
    // The server refuses this case outright; the fallback exists so a round can
    // never resolve as a no-op and leave the row and the client disagreeing.
    const r = resolveBossRound(baseInput({ tactic: "FURY", fury: 0, move: "SMASH" }), noJitter);
    expect(r.furyUsed).toBe(false);
    expect(r.damage).toBe(
      Math.round(10_000 * BOSS_ROUND_DAMAGE_BASE * BOSS_TACTIC_MATRIX.SMASH.SHIELD.damage)
    );
  });

  it("keeps the variance inside its stated band", () => {
    const low = resolveBossRound(baseInput(), seeded([0]));
    const high = resolveBossRound(baseInput(), seeded([1]));
    const mid = resolveBossRound(baseInput(), noJitter);
    expect(low.damage).toBeLessThan(mid.damage);
    expect(high.damage).toBeGreaterThan(mid.damage);
    expect(high.damage / mid.damage).toBeLessThanOrEqual(1.13);
    expect(low.damage / mid.damage).toBeGreaterThanOrEqual(0.87);
  });
});

describe("how the army reads the tyrant", () => {
  it("beats a coin-flipping army even at level 1, and caps short of certainty", () => {
    expect(bossReadChance(1, true)).toBe(BOSS_READ_CHANCE_BASE);
    expect(BOSS_READ_CHANCE_BASE).toBeGreaterThan(1 / 3);
    expect(bossReadChance(1000, true)).toBe(BOSS_READ_CHANCE_MAX);
    // A quarter of rounds still misread at the top: an assault is never a
    // formality, which is what keeps the fight worth watching.
    expect(BOSS_READ_CHANCE_MAX).toBeLessThanOrEqual(0.8);
  });

  it("climbs with the hero's level — the one thing the hero contributes", () => {
    expect(bossReadChance(30, true)).toBeGreaterThan(bossReadChance(1, true));
    expect(bossReadChance(60, true)).toBeGreaterThan(bossReadChance(30, true));
  });

  it("leaves a dead hero's officers guessing", () => {
    expect(bossReadChance(60, false)).toBe(BOSS_READ_CHANCE_NO_HERO);
  });

  it("answers with the counter on a read and a wrong tactic otherwise", () => {
    // random() < chance → read succeeds.
    for (const move of MOVES) {
      expect(autoTactic(move, 1, true, () => 0).tactic).toBe(BOSS_MOVE_COUNTER[move]);
      const missed = autoTactic(move, 1, true, seeded([0.99, 0.1]));
      expect(missed.read).toBe(false);
      expect(missed.tactic).not.toBe(BOSS_MOVE_COUNTER[move]);
    }
  });

  it("spreads misreads over both wrong answers", () => {
    const low = autoTactic("SMASH", 1, true, seeded([0.99, 0.1])).tactic;
    const high = autoTactic("SMASH", 1, true, seeded([0.99, 0.9])).tactic;
    expect(low).not.toBe(high);
  });
});

describe("the balance the whole fight rests on", () => {
  // These are the numbers the feature was tuned to. They are asserted here
  // because a change to any multiplier silently moves them, and "can an army at
  // the printed power fell this thing" is the promise the printed power makes.
  const power = bossPower(1);
  const maxHp = bossSiegeMaxHp(1);

  it("sizes the pool off the printed power", () => {
    expect(maxHp).toBe(Math.round(power * BOSS_HP_PER_POWER));
  });

  it("makes an army at the printed wall fight a siege, not press a button", () => {
    // The 2026-08-06 rebalance, and the reason BOSS_HP_PER_POWER exists. At 6.5 a
    // parity army took ~98% of the pool off in one march and the whole encounter
    // was one click; three marches is the shape the fight is tuned for now.
    const dealt = bossExpectedSortieDamage(power, 1, true);
    expect(dealt).toBeLessThan(maxHp / 2);
    expect(bossSortiesToKill(power, maxHp, 1, true)).toBe(3);
    // ...and it stays a siege for a good hero too: the hero buys comfort inside
    // the three, not a way around them.
    expect(bossSortiesToKill(power, maxHp, 30, true)).toBe(3);
    expect(bossSortiesToKill(power, maxHp, 60, true)).toBe(3);
  });

  it("makes the hero, not just the army, move the projection", () => {
    const weak = bossExpectedSortieDamage(power, 1, true);
    const strong = bossExpectedSortieDamage(power, 60, true);
    expect(strong).toBeGreaterThan(weak);
    // A dead hero is strictly worse than a live level-1 one.
    expect(bossExpectedSortieDamage(power, 60, false)).toBeLessThan(weak);
  });

  it("reads the printed power as a ladder: triple ends it in one, double in two", () => {
    // The wall is not a pass/fail line — it is a scale a player can locate
    // themselves on, and every rung has to be worth climbing to.
    expect(bossSortiesToKill(power * 3, maxHp, 1, true)).toBe(1);
    expect(bossSortiesToKill(power * 2, maxHp, 1, true)).toBe(2);
    expect(bossSortiesToKill(power / 2, maxHp, 1, true)).toBeGreaterThan(3);
  });

  it("still answers 'how many assaults' for an army far below the wall", () => {
    // The old banner had nothing to say to a player under the boss's power. This
    // must always be a finite number they can plan against.
    const sorties = bossSortiesToKill(power / 8, maxHp, 1, true);
    expect(Number.isFinite(sorties)).toBe(true);
    expect(sorties).toBeGreaterThan(1);
  });

  it("has no answer only for an empire with no army at all", () => {
    expect(bossSortiesToKill(0, maxHp, 1, true)).toBe(Infinity);
  });

  it.runIf(BOSS_CASUALTIES)("routs an army that misreads everything", () => {
    // Misreads pick the wrong cell; the worst of them, over a full assault, has to
    // reach the rout line or the rout rule would be unreachable.
    const worstPerRound = MOVES.reduce(
      (sum, move) =>
        sum +
        BOSS_MOVE_WEIGHTS[move] *
          Math.max(...COUNTERS.map((t) => BOSS_TACTIC_MATRIX[move][t].taken)),
      0
    );
    expect(BOSS_ROUND_LOSS_BASE * worstPerRound * BOSS_SORTIE_ROUNDS).toBeGreaterThan(
      BOSS_ROUT_LOSS_FRACTION * 0.85
    );
  });

  it("keeps a well-read assault cheap in blood", () => {
    const perfectPerRound = MOVES.reduce(
      (sum, move) =>
        sum + BOSS_MOVE_WEIGHTS[move] * BOSS_TACTIC_MATRIX[move][BOSS_MOVE_COUNTER[move]].taken,
      0
    );
    expect(BOSS_ROUND_LOSS_BASE * perfectPerRound * BOSS_SORTIE_ROUNDS).toBeLessThan(0.1);
  });
});

describe("re-fitting a life when the curve moves under it", () => {
  // `BossSiege.maxHp` is stamped at creation, so a retune (or an admin moving
  // boss.hpMultiplier) leaves lives already in progress fighting the old pool
  // while `bossReward` pays the new haul. On the 2026-08-06 rebalance that was
  // worth ~6x the loot for the old effort, once per player.
  it("keeps the share already taken off, not the raw number", () => {
    expect(refitSiegePool(39_000, 78_000, 360_000)).toEqual({ hp: 180_000, maxHp: 360_000 });
    expect(refitSiegePool(78_000, 78_000, 360_000)).toEqual({ hp: 360_000, maxHp: 360_000 });
  });

  it("pays exactly one haul across a life the refit happened in the middle of", () => {
    // The property the fraction buys: chip loot is `damage / maxHp` at each
    // settle, so the shares paid either side of the refit have to still add up to
    // the whole. Anything else either cheapens the work already done or pays for
    // it twice.
    const before = 78_000;
    const after = 360_000;
    const dealt = 39_000;
    const paidBefore = bossChipFraction(dealt, before);
    const fitted = refitSiegePool(before - dealt, before, after);
    const paidAfter = bossChipFraction(fitted.hp, fitted.maxHp);
    expect(paidBefore + paidAfter).toBeCloseTo(BOSS_CHIP_SHARE, 6);
  });

  it("leaves a pool that is already the right size alone", () => {
    const same = refitSiegePool(1_234, 5_000, 5_000);
    expect(same).toEqual({ hp: 1_234, maxHp: 5_000 });
    // ...and refuses to invent a pool out of degenerate input rather than
    // dividing by zero into a boss with no health at all.
    expect(refitSiegePool(10, 0, 5_000)).toEqual({ hp: 10, maxHp: 0 });
    expect(refitSiegePool(10, 100, 0)).toEqual({ hp: 10, maxHp: 100 });
  });

  it("never refits a living tyrant into a dead one", () => {
    // A sliver of health rounding to zero would hand the kill share — and the
    // guaranteed gear — to whoever marched next, for nothing.
    const slice = refitSiegePool(1, 1_000_000_000, 100);
    expect(slice.hp).toBe(1);
  });
});

describe("pricing the blood against the wall", () => {
  const wall = bossPower(1);
  const maxHp = bossSiegeMaxHp(1);

  it("charges the full price at parity and above", () => {
    expect(bossLossScale(wall, wall)).toBe(1);
    expect(bossLossScale(wall * 10, wall)).toBe(1);
  });

  it("charges an army under the wall its own share of the price", () => {
    expect(bossLossScale(wall / 2, wall)).toBeCloseTo(0.5, 10);
    expect(bossLossScale(wall * 0.4, wall)).toBeCloseTo(0.4, 10);
  });

  it("never charges nothing, however far under the wall the army is", () => {
    expect(bossLossScale(1, wall)).toBe(BOSS_LOSS_ENGAGEMENT_FLOOR);
    expect(bossLossScale(0, wall)).toBe(BOSS_LOSS_ENGAGEMENT_FLOOR);
    // A boss with no printed power at all must not divide by zero into a free fight.
    expect(bossLossScale(1_000, 0)).toBe(1);
  });

  it.runIf(BOSS_CASUALTIES)(
    "keeps the blood-per-loot ratio the same for a small empire as for a big one",
    () => {
      // The whole point. Loot is pro-rata against the pool, so the price has to be
      // pro-rata against the wall or being small is a punishment on its own.
      const priced = (power: number) => {
        const loot = bossChipFraction(bossExpectedSortieDamage(power, 1, true), maxHp);
        const blood =
          bossExpectedSortieLosses(1_000, 1, true, bossLossScale(power, wall)) / 1_000;
        return blood / loot;
      };
      // A third of the wall against parity: the same deal, to the decimal.
      expect(priced(wall / 3) / priced(wall)).toBeCloseTo(1, 6);
      // Under the floor the deal does get worse — that is what the floor is for —
      // but by a fraction rather than by the order of magnitude it used to be.
      expect(priced(wall / 20) / priced(wall)).toBeLessThan(6);
    }
  );

  it.runIf(BOSS_CASUALTIES)("takes a real bite out of what a small empire used to bleed", () => {
    // The case that prompted this: 350 soldiers marching at the first tyrant with
    // under a third of its power, losing ~45 of them for a sliver of the haul.
    const soldiers = 350;
    const power = soldiers * 10;
    const before = bossExpectedSortieLosses(soldiers, 1, true);
    const after = bossExpectedSortieLosses(soldiers, 1, true, bossLossScale(power, wall));
    expect(before).toBeGreaterThan(40);
    expect(after).toBeLessThan(before / 3);
    // ...and well clear of the line that breaks a formation mid-fight.
    expect(after / soldiers).toBeLessThan(BOSS_ROUT_LOSS_FRACTION / 3);
  });

  it.runIf(BOSS_CASUALTIES)("bleeds a scaled army less over a whole simulated assault", () => {
    const small = { attackPower: 3_500, soldiers: 350, bossHp: maxHp, heroLevel: 1, heroAlive: true };
    const unscaled = simulateBossSortie(small, () => 0.5);
    const scaled = simulateBossSortie({ ...small, bossPower: wall }, () => 0.5);
    expect(scaled.soldiersLost).toBeLessThan(unscaled.soldiersLost);
    // Same rolls, same reads — only the price changed.
    expect(scaled.damageDealt).toBe(unscaled.damageDealt);
  });

  it("leaves an army at parity paying exactly what it always did", () => {
    const parity = {
      attackPower: wall,
      soldiers: 1_200,
      bossHp: 1e9,
      heroLevel: 30,
      heroAlive: true,
    };
    const unscaled = simulateBossSortie(parity, () => 0.5);
    const scaled = simulateBossSortie({ ...parity, bossPower: wall }, () => 0.5);
    expect(scaled.soldiersLost).toBe(unscaled.soldiersLost);
  });
});

describe("projecting what an assault costs", () => {
  // The banner prints this number *before* the turns are paid, so it has to be
  // the same trade the simulation actually makes.
  it.runIf(BOSS_CASUALTIES)(
    "prices a full assault in the tenth-to-quarter band, never the whole army",
    () => {
      const green = bossExpectedSortieLosses(1_000, 1, true);
      expect(green).toBeGreaterThan(1_000 * 0.05);
      expect(green).toBeLessThan(1_000 * BOSS_ROUT_LOSS_FRACTION);
    }
  );

  it.runIf(BOSS_CASUALTIES)("makes the hero the defensive stat: a better read bleeds less", () => {
    const rookie = bossExpectedSortieLosses(1_000, 1, true);
    const veteran = bossExpectedSortieLosses(1_000, 60, true);
    const corpse = bossExpectedSortieLosses(1_000, 60, false);
    expect(veteran).toBeLessThan(rookie);
    // A dead hero drops the officers to pure chance *and* forfeits the fury round.
    expect(corpse).toBeGreaterThan(veteran);
  });

  it("never projects more casualties than the army that marched", () => {
    expect(bossExpectedSortieLosses(3, 1, false)).toBeLessThanOrEqual(3);
    expect(bossExpectedSortieLosses(0, 1, true)).toBe(0);
  });
});

/**
 * The promise as it stands: marching on the tyrant costs turns and nothing else.
 *
 * Asserted through the public surface rather than by reading the constant, so it
 * covers the whole path a player meets — one round, a whole assault, and the
 * figure the banner quotes before any of it is paid for.
 */
describe.runIf(!BOSS_CASUALTIES)("a bloodless assault", () => {
  it("agrees with itself about whether blood is on", () => {
    expect(BOSS_CASUALTIES).toBe(BOSS_ROUND_LOSS_BASE > 0);
  });

  it("costs nothing even in the worst cell of the matrix", () => {
    // ASSAULT into a SMASH — 1.8x casualties, the most expensive round there is.
    const r = resolveBossRound(
      baseInput({
        move: "SMASH",
        tactic: "ASSAULT",
        soldiers: 1_000,
        soldiersAtStart: 1_000,
        bossHp: 1e9,
      }),
      () => 0.99
    );
    expect(r.soldiersLost).toBe(0);
    expect(r.routed).toBe(false);
    // The damage side is untouched — this is a change to the price, not the fight.
    expect(r.damage).toBeGreaterThan(0);
  });

  it("brings the whole army home from an assault that goes badly", () => {
    // A tiny army against a bottomless pool with a dead hero: the run that used
    // to break the formation before round three.
    const plan = simulateBossSortie(
      {
        attackPower: 1,
        soldiers: 10,
        bossHp: 1e9,
        bossPower: bossPower(1),
        heroLevel: 1,
        heroAlive: false,
      },
      () => 0.99
    );
    expect(plan.soldiersLost).toBe(0);
    expect(plan.routed).toBe(false);
    expect(plan.outcome).toBe("SPENT");
    expect(plan.rounds).toHaveLength(BOSS_SORTIE_ROUNDS);
    expect(plan.rounds.every((r) => r.soldiersLost === 0)).toBe(true);
  });

  it("quotes no price on the banner either", () => {
    expect(bossExpectedSortieLosses(1_000, 1, true)).toBe(0);
    expect(bossExpectedSortieLosses(1_000, 1, false, bossLossScale(1, bossPower(1)))).toBe(0);
  });

  it("hands every sortie the preservation quarter of the grade", () => {
    // With nothing lost the grade is the reads alone, on the ladder the
    // BOSS_GRADE_MIN_DECISIONS note describes for a clean army: one good read in
    // a one-round kill is a B, three are an S.
    expect(bossGrade(1, 1, 0)).toBe("B");
    expect(bossGrade(2, 2, 0)).toBe("A");
    expect(bossGrade(3, 3, 0)).toBe("S");
  });
});

describe("simulating a whole assault", () => {
  const base = {
    attackPower: 12_000,
    soldiers: 1_200,
    bossHp: bossSiegeMaxHp(1),
    heroLevel: 30,
    heroAlive: true,
  };

  it("rolls a complete plan up front, with a reveal time on every round", () => {
    const plan = simulateBossSortie(base, seeded([0.5, 0.2, 0.5, 0.5]));
    expect(plan.rounds.length).toBeGreaterThan(0);
    expect(plan.rounds.length).toBeLessThanOrEqual(BOSS_SORTIE_ROUNDS);
    plan.rounds.forEach((r, i) => {
      expect(r.round).toBe(i + 1);
      expect(r.at).toBeGreaterThan(0);
      expect(r.at).toBeLessThanOrEqual(BOSS_ASSAULT_DURATION_MS - BOSS_ASSAULT_VERDICT_MS);
      expect(r.at).toBe(roundRevealAt(i));
    });
  });

  it("keeps its totals consistent with its own rounds", () => {
    const plan = simulateBossSortie(base, seeded([0.3, 0.7, 0.5]));
    expect(plan.damageDealt).toBe(plan.rounds.reduce((s, r) => s + r.damage, 0));
    expect(plan.soldiersLost).toBe(plan.rounds.reduce((s, r) => s + r.soldiersLost, 0));
    expect(plan.correctCounters).toBe(plan.rounds.filter((r) => r.correct).length);
    expect(plan.bossHpAfter).toBe(plan.rounds.at(-1)!.bossHpAfter);
  });

  it("stops at the kill and reports it", () => {
    const plan = simulateBossSortie({ ...base, bossHp: 500 }, () => 0.5);
    expect(plan.killed).toBe(true);
    expect(plan.outcome).toBe("KILLED");
    expect(plan.rounds).toHaveLength(1);
    expect(plan.bossHpAfter).toBe(0);
  });

  it.runIf(BOSS_CASUALTIES)("stops at a rout and reports it", () => {
    // A tiny army against a huge pool: casualties reach the rout line long before
    // the health does.
    const plan = simulateBossSortie(
      { ...base, attackPower: 1, soldiers: 10, bossHp: 1e9, heroAlive: false },
      () => 0.99
    );
    expect(plan.outcome).toBe("ROUTED");
    expect(plan.routed).toBe(true);
    expect(plan.rounds.length).toBeLessThan(BOSS_SORTIE_ROUNDS);
  });

  it("spends the whole assault when the boss outlasts it", () => {
    const plan = simulateBossSortie({ ...base, bossHp: 1e9 }, () => 0.5);
    expect(plan.outcome).toBe("SPENT");
    expect(plan.rounds).toHaveLength(BOSS_SORTIE_ROUNDS);
    expect(plan.killed).toBe(false);
    expect(plan.routed).toBe(false);
  });

  it("releases the hero's fury by itself once the meter fills", () => {
    const plan = simulateBossSortie({ ...base, bossHp: 1e9 }, () => 0.5);
    const fury = plan.rounds.filter((r) => r.furyUsed);
    expect(fury).toHaveLength(1);
    // The meter charges 22 a round, so it cannot land before round 5.
    expect(fury[0].round).toBeGreaterThanOrEqual(5);
    expect(fury[0].damage).toBeGreaterThan(plan.rounds[0].damage);
  });

  it("never releases fury for a dead hero", () => {
    const plan = simulateBossSortie({ ...base, bossHp: 1e9, heroAlive: false }, () => 0.5);
    expect(plan.rounds.some((r) => r.furyUsed)).toBe(false);
  });

  it("paces the reveal on a fixed beat, in order, inside the minute", () => {
    const ats = Array.from({ length: BOSS_SORTIE_ROUNDS }, (_, i) => roundRevealAt(i));
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(ats.at(-1)).toBeLessThanOrEqual(
      BOSS_ASSAULT_DURATION_MS - BOSS_ASSAULT_VERDICT_MS
    );
    // The verdict tail exists so the last blow is not cut off by the settle.
    expect(BOSS_ASSAULT_DURATION_MS - ats.at(-1)!).toBeGreaterThanOrEqual(
      BOSS_ASSAULT_VERDICT_MS
    );
    // A constant beat: the gap between rounds never depends on how many there are.
    // Within a millisecond — the offsets are rounded, and 55000/6 does not divide.
    const gaps = ats.slice(1).map((at, i) => at - ats[i]);
    for (const gap of gaps) expect(Math.abs(gap - BOSS_ROUND_REVEAL_MS)).toBeLessThan(1);
  });

  it("keeps a short fight short — the clock follows the plan", () => {
    // The whole point: an army that fells the tyrant on the first blow must not be
    // made to watch a settled battle for another fifty seconds.
    expect(bossAssaultDuration(BOSS_SORTIE_ROUNDS)).toBe(BOSS_ASSAULT_DURATION_MS);
    expect(bossAssaultDuration(1)).toBeLessThan(BOSS_ASSAULT_DURATION_MS / 3);
    expect(bossAssaultDuration(1)).toBeGreaterThan(BOSS_ASSAULT_VERDICT_MS);
    // Monotonic, and never zero for a degenerate plan.
    expect(bossAssaultDuration(0)).toBe(bossAssaultDuration(1));
    for (let n = 2; n <= BOSS_SORTIE_ROUNDS; n++) {
      expect(bossAssaultDuration(n)).toBeGreaterThan(bossAssaultDuration(n - 1));
    }
  });
});

describe("grading a sortie", () => {
  it("grades on the reads, so a lucky-but-clumsy walkover scores low", () => {
    // 6/6 correct at 10% losses versus 2/6 correct at the same losses: an army
    // strong enough to shrug off the casualties must not grade well on that alone.
    expect(bossGrade(6, 6, 0.1)).toBe("S");
    expect(bossGrade(2, 6, 0.1)).toBe("C");
  });

  it("still rewards bringing the army home", () => {
    expect(bossGrade(6, 6, 0)).toBe("S");
    // Same perfect reads, but the army was mauled to the rout line.
    expect(bossGrade(6, 6, BOSS_ROUT_LOSS_FRACTION)).toBe("A");
  });

  it("hands out the floor grade for a fight with no decisions in it", () => {
    // Unreachable in practice — only a kill is graded, and a kill takes a round —
    // but it must resolve to the floor rather than to a free bonus.
    expect(bossGrade(0, 0, 0)).toBe("C");
  });

  it("will not sell the top grade to a one-round walkover", () => {
    // The 2026-07-30 audit's finding. `decisions` is however many rounds the fight
    // lasted, so before BOSS_GRADE_MIN_DECISIONS an army far over the wall killed
    // in one round and needed ONE lucky read to bank 100% accuracy — measured at
    // 59% S against 7% S for a parity fight, with A and B unreachable for it.
    // A perfect one-round kill with a pristine army now tops out at B.
    expect(bossGrade(1, 1, 0)).toBe("B");
    expect(bossGrade(2, 2, 0)).toBe("A");
    // Three good reads is the shortest fight that can still earn S.
    expect(bossGrade(3, 3, 0)).toBe("S");
    // And a misread walkover is still the floor, however intact the army.
    expect(bossGrade(0, 1, 0)).toBe("C");
  });

  it("scores the parity fight above the autopilot one, as its doc claims", () => {
    // Six rounds read almost perfectly at a real blood price, against a
    // single-round kill that cost nothing. The first is the better-fought battle
    // and must grade higher.
    const parity = bossGrade(5, 6, 0.2);
    const walkover = bossGrade(1, 1, 0.001);
    const order = { S: 3, A: 2, B: 1, C: 0 } as const;
    expect(order[parity]).toBeGreaterThan(order[walkover]);
  });

  it("never scores above a perfect fight, whatever the counters say", () => {
    // `correctCounters` comes off a stored row; a corrupt or hand-edited one must
    // not multiply the haul past S.
    expect(bossFightScore(99, 1, 0)).toBeLessThanOrEqual(1);
    expect(bossFightScore(-5, 6, 0)).toBeGreaterThanOrEqual(0);
    expect(bossGrade(99, 1, 0)).toBe("S");
  });

  it("orders the grade bonuses so S is the only one worth chasing", () => {
    expect(bossKillFraction("S")).toBeGreaterThan(bossKillFraction("A"));
    expect(bossKillFraction("A")).toBeGreaterThan(bossKillFraction("B"));
    expect(bossKillFraction("B")).toBeGreaterThan(bossKillFraction("C"));
    expect(bossKillFraction("C")).toBe(BOSS_KILL_SHARE);
  });
});

describe("splitting the haul", () => {
  it("pays chip loot in proportion to the damage dealt", () => {
    expect(bossChipFraction(0, 1_000)).toBe(0);
    expect(bossChipFraction(500, 1_000)).toBeCloseTo(BOSS_CHIP_SHARE / 2, 10);
    expect(bossChipFraction(1_000, 1_000)).toBeCloseTo(BOSS_CHIP_SHARE, 10);
  });

  it("cannot pay more than the pool, however the damage is reported", () => {
    // The clamp is the economic cap that replaced the per-cycle victory counter:
    // overshoot on the killing blow must not mint loot.
    expect(bossChipFraction(10_000, 1_000)).toBeCloseTo(BOSS_CHIP_SHARE, 10);
    expect(bossChipFraction(-5, 1_000)).toBe(0);
    expect(bossChipFraction(5, 0)).toBe(0);
  });

  it("bounds a whole cycle at the chip share plus one graded kill", () => {
    // A player may launch any number of sorties — turns are the only limit — so
    // this ceiling is what stops banked turns from becoming banked loot.
    const ceiling = BOSS_CHIP_SHARE + bossKillFraction("S");
    expect(ceiling).toBeLessThanOrEqual(1.3);
    const haul = bossReward(1, 1);
    const paid = bossPayout(haul, ceiling);
    expect(paid.gold).toBeLessThanOrEqual(Math.round(haul.gold * 1.3));
  });

  it("scales a payout down without inventing captives", () => {
    const haul = bossReward(1, 1);
    const scratch = bossPayout(haul, 0.001);
    expect(scratch.gold).toBeLessThan(haul.gold);
    // A sortie that barely dented the gate does not open the pens.
    expect(scratch.slaves).toBe(0);
  });

  it("pays nothing at all for a fraction of zero", () => {
    const nothing = bossPayout(bossReward(5, 20), 0);
    expect(nothing).toEqual({ gold: 0, wood: 0, iron: 0, stone: 0, slaves: 0 });
  });

  it("keeps the two shares a whole haul", () => {
    expect(BOSS_CHIP_SHARE + BOSS_KILL_SHARE).toBeCloseTo(1, 10);
  });

  it("halves a routed assault's loot rather than voiding it", () => {
    // With the army fighting itself there is no decision to punish, so a rout has
    // to stay clearly worse than a spent assault without wiping the haul.
    expect(BOSS_ROUT_LOOT_PENALTY).toBeGreaterThan(0);
    expect(BOSS_ROUT_LOOT_PENALTY).toBeLessThan(1);
  });
});

describe("the reward scale-up", () => {
  it("pays a felled boss well above the old single-victory haul", () => {
    // The old payout was the unscaled `BOSS_REWARD_BASE` for one win. A kill at
    // grade S must be worth clearly more than that, or the siege is a downgrade
    // dressed as a feature.
    const haul = bossReward(1, 1);
    const bestCase = bossPayout(haul, BOSS_CHIP_SHARE + bossKillFraction("S"));
    expect(bestCase.gold).toBeGreaterThan(50_000 * 2.5);
  });

  it("grows the haul with the tier and with the season", () => {
    expect(bossReward(2, 1).gold).toBeGreaterThan(bossReward(1, 1).gold);
    expect(bossReward(1, 10).gold).toBeGreaterThan(bossReward(1, 1).gold);
  });

  it("pays the same haul per point of damage at every city tier", () => {
    // The reward curve and the power curve are the same number on purpose (see
    // BOSS_REWARD_TIER_MULTIPLIER). While they differed, nine tiers of 2.4/2.5
    // compounded into the tenth city's tyrant paying ~31% less per unit of work
    // than the first city's — the boss got quietly stingier the further you
    // climbed, which is exactly backwards.
    const rate = (tier: number) => bossReward(tier, 1).gold / bossSiegeMaxHp(tier);
    for (let tier = 2; tier <= 10; tier++) {
      expect(rate(tier) / rate(1)).toBeCloseTo(1, 2);
    }
  });

  it("raises the haul by more than it raised the pool", () => {
    // The whole bargain of the 2026-08-06 rebalance: the tyrant costs ~4.6x the
    // turns it used to, so it has to pay more than 4.6x or "harder" is a nerf
    // with a story attached. Chip loot is pro-rata against the pool, so this
    // ratio *is* the loot-per-turn any army earns, whatever its size.
    const before = { power: 12_000, hpPerPower: 6.5, scale: 2.5 };
    const harder = (bossPower(1) * BOSS_HP_PER_POWER) / (before.power * before.hpPerPower);
    const richer = bossReward(1, 1).gold / (50_000 * before.scale);
    expect(harder).toBeGreaterThan(4);
    expect(richer).toBeGreaterThan(harder);
    // ...and not so much richer that the boss becomes the only thing worth doing.
    expect(richer / harder).toBeLessThan(1.5);
  });
});

/**
 * The city boss's admin dials, added with /admin/bosses. Same contract as the
 * world boss's: every one is a trailing optional parameter, so an untouched
 * overlay leaves the shipped curves exactly where they were.
 */
describe("the city boss admin multipliers", () => {
  it("changes nothing at 1", () => {
    expect(bossReward(3, 5, 1, 1)).toEqual(bossReward(3, 5));
    expect(bossHeroXp(4, 1)).toBe(bossHeroXp(4));
    expect(bossReviveMs(BOSS_REVIVE_MS / 60_000)).toBe(BOSS_REVIVE_MS);
  });

  it("moves the captives without touching the resources", () => {
    const base = bossReward(3, 5);
    const generous = bossReward(3, 5, 1, 2);
    expect(generous.gold).toBe(base.gold);
    expect(generous.slaves).toBe(base.slaves * 2);
  });

  it("closes the pens entirely at zero, rather than paying the floor of one", () => {
    expect(bossReward(3, 5, 1, 0).slaves).toBe(0);
    expect(bossReward(3, 5, 0).slaves).toBe(0);
  });

  it("compounds the captive dial with the global haul dial", () => {
    const base = bossReward(2, 1);
    const both = bossReward(2, 1, 2, 2);
    expect(both.gold).toBe(base.gold * 2);
    expect(both.slaves).toBe(base.slaves * 4);
  });

  it("scales the hero's XP", () => {
    expect(bossHeroXp(5, 2)).toBe(bossHeroXp(5) * 2);
    expect(bossHeroXp(5, 0)).toBe(0);
  });

  it("reads the revive delay in minutes and never goes negative", () => {
    expect(bossReviveMs(15)).toBe(15 * 60_000);
    expect(bossReviveMs(0)).toBe(0);
    expect(bossReviveMs(-5)).toBe(0);
  });
});
