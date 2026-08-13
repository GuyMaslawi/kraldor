// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { BossMove, BossTactic } from "@prisma/client";
import { secureRandom } from "./random";
import { bossPower, type BossReward } from "./bosses";

/**
 * The city-boss assault: a multi-round battle the army fights on its own.
 *
 * The encounter has been through three shapes, and the reasons matter because
 * they are the constraints on the fourth:
 *
 * 1. **One comparison.** Attack power over the boss's power won, everything else
 *    lost. A player below the wall had no move but "come back bigger", and a
 *    player above it had no fight — the outcome was known before the click.
 * 2. **A health pool that persists across the daily cycle** (`BossSiege`), so
 *    every attack that lands leaves a mark and partial progress pays. That part
 *    was right and is unchanged.
 * 3. **Player-chosen tactics, one decision per round.** This read as homework:
 *    a wall of buttons whose consequences a player had to learn before the screen
 *    made any sense at all.
 *
 * So the fight now runs *itself*. One button sends the army, the whole battle is
 * rolled at launch, and it plays out over `BOSS_ASSAULT_DURATION_MS` of real time
 * as an animated report the player can watch or walk away from. What used to be
 * the player's decision is now the army's, and how well it reads the tyrant is
 * the hero's job:
 *
 *   מחץ כבד   (SMASH)   → חומת מגן      (SHIELD)  — absorb the blow
 *   סער סוחף  (SWEEP)   → תמרון עוקף    (FLANK)   — spread out from under it
 *   פרצה      (EXPOSED) → הסתערות חזית  (ASSAULT) — pour into the opening
 *
 * Each round the officers either read the tyrant correctly — which multiplies the
 * damage dealt and all but negates the casualties taken — or misread it, which
 * does the opposite. The *chance* of reading right is `bossReadChance`, and it
 * climbs with the hero's level. That is what replaced the player's skill: the
 * fight still swings on reads, but you improve them by levelling the hero rather
 * than by memorising a matrix, and the hero's fury still lands as the climax.
 *
 * Everything here is pure and takes its randomness as a parameter, so the whole
 * balance is unit-testable (see tests/unit/bossBattle.test.ts) and the server
 * resolver holds no formulas of its own.
 */

/* ------------------------------ shape of the fight ------------------------------ */

/** Rounds in one assault. Six is the number every multiplier below is tuned to. */
export const BOSS_SORTIE_ROUNDS = 6;

/**
 * How long a *full-length* assault takes in real time.
 *
 * A minute is long enough for six rounds to land as separate events rather than a
 * blur, and short enough that a player who wants to watch is not being asked to
 * babysit. Nothing waits on the player: the outcome is decided at launch, the
 * clock only paces the reveal, and the settle happens whether or not anyone is
 * looking at it (see `settleDueAssault`).
 */
export const BOSS_ASSAULT_DURATION_MS = 60_000;

/**
 * Tail of the assault left empty after the last round lands, so the final blow
 * has a beat to itself before the verdict replaces the screen.
 */
export const BOSS_ASSAULT_VERDICT_MS = 5_000;

/**
 * Real time between rounds — a fixed cadence, not the duration divided by however
 * many rounds the plan happens to contain.
 *
 * The difference matters at both ends. An army that fells the tyrant in one blow
 * would otherwise stand around for fifty seconds watching a finished fight, and an
 * army that goes the distance would have its rounds bunched. A constant beat means
 * a short fight *is* short: the assault lasts exactly as long as it has rounds to
 * show.
 */
export const BOSS_ROUND_REVEAL_MS =
  (BOSS_ASSAULT_DURATION_MS - BOSS_ASSAULT_VERDICT_MS) / BOSS_SORTIE_ROUNDS;

/** When round `index` (0-based) becomes visible, as an offset from the launch. */
export function roundRevealAt(index: number): number {
  return Math.round(BOSS_ROUND_REVEAL_MS * (index + 1));
}

/**
 * How long an assault of `rounds` rounds runs: the last reveal plus the verdict
 * beat. Six rounds is the full minute; a one-round rout or kill is over in about
 * fourteen seconds.
 */
export function bossAssaultDuration(rounds: number): number {
  return roundRevealAt(Math.max(1, rounds) - 1) + BOSS_ASSAULT_VERDICT_MS;
}

/**
 * The boss's health pool for one life, as a multiple of its printed battle power.
 *
 * **This is the difficulty knob, and it was 6.5 until 2026-08-06.** At 6.5 an
 * army standing at the printed wall dealt ~98% of the pool in a single assault,
 * which meant the entire encounter was: bank one day of turns, press the button
 * once, collect. A tyrant that a parity army removes in one click is not a wall,
 * it is a vending machine — and it made the printed power a pass/fail line rather
 * than something to grow past.
 *
 * At 18 an assault takes roughly a third of the pool at parity, so the shape of
 * the fight is a *siege*, and the printed power reads as a ladder:
 *
 *  - a level-1 hero's officers read the tyrant right 45% of the time — ~6.3× the
 *    army's power per assault, so three marches at the wall, four under it.
 *  - a mid-level hero (~30) reads it 60% of the time, worth ~7.2×: still three,
 *    and the hero is what makes the third one comfortable rather than a coin flip.
 *  - an army at double the wall ends it in two, at triple in one.
 *  - an unlucky assault underperforms and nothing more: since
 *    {@link BOSS_ROUND_LOSS_BASE} went to zero it cannot break the formation, so
 *    what a bad run costs is the turns and another march.
 *
 * Nobody is paid less for the longer siege: chip loot is pro-rata against this
 * pool, and `BOSS_REWARD_SCALE` went up by more than this did, so every army —
 * including one far under the wall, which now simply chips for longer — earns
 * about 30% more per turn than it did before the boss got hard.
 *
 * These figures are asserted in tests/unit/bossBattle.test.ts, because every
 * multiplier below moves them and "how many marches does the printed power cost
 * me" is the promise the printed power makes.
 */
export const BOSS_HP_PER_POWER = 18;

/**
 * The health pool one life of the boss of `cities` carries.
 *
 * `powerMultiplier` is the admin scalar on the boss's printed power (so the pool
 * follows the wall it advertises), and `hpMultiplier` scales only the pool — the
 * knob for "the fight should take more/fewer assaults" without moving the power
 * number players compare themselves against.
 */
export function bossSiegeMaxHp(
  cities: number,
  powerMultiplier = 1,
  hpMultiplier = 1
): number {
  return Math.round(
    bossPower(cities, powerMultiplier) * BOSS_HP_PER_POWER * Math.max(0.01, hpMultiplier)
  );
}

/**
 * Re-fit a *live* boss's pool to what its tier is worth right now, keeping the
 * share of it the player has already taken off.
 *
 * `BossSiege.maxHp` is stamped when a life is created, so any change to the curve
 * — a deploy that retunes {@link BOSS_HP_PER_POWER}, or an admin moving
 * `boss.hpMultiplier` — leaves every life already in progress fighting the old
 * pool while `bossReward` pays the new haul. On the 2026-08-06 rebalance that gap
 * was worth roughly six times the loot for the old effort, once per player: every
 * wounded tyrant in the world would have been a windfall waiting to be collected.
 *
 * Scaling by the *remaining fraction* rather than by the raw number is what makes
 * this fair in both directions. Chip loot is `damage ÷ maxHp` at the moment of
 * each settle, so a life that was 50% gone stays 50% gone: the loot already paid
 * against the old pool plus the loot still to be paid against the new one comes to
 * exactly the one haul the life is worth, and no assault is retroactively
 * cheapened or double-paid.
 *
 * Only ever applied between assaults (see `currentLife`), never to a life with a
 * battle running against it — that plan was rolled against the health it read at
 * launch.
 */
export function refitSiegePool(
  hp: number,
  maxHp: number,
  target: number
): { hp: number; maxHp: number } {
  if (!(target > 0) || !(maxHp > 0) || target === maxHp) return { hp, maxHp };
  const remaining = Math.min(1, Math.max(0, hp / maxHp));
  // Never refit a living tyrant into a dead one: rounding a sliver of health down
  // to zero would hand out the kill share for free on the next settle.
  return { hp: Math.max(1, Math.round(target * remaining)), maxHp: target };
}

/**
 * Damage one round deals, as a fraction of the attacker's battle power, before the
 * tactic matrix. The matrix spans ~0.35–1.9, so a round swings between a third of
 * this and nearly double it.
 */
export const BOSS_ROUND_DAMAGE_BASE = 0.8;

/**
 * Soldiers one round costs, as a fraction of the army that marched, before the
 * matrix (~0.2–1.8).
 *
 * **Zero since 2026-08-03: the boss no longer kills soldiers.** Player raids
 * stopped costing lives first (see the casualty note in server/actions/game.ts),
 * which left the tyrant as the last place in the game where an army could
 * actually shrink — and it was the wrong place for it. An army is the slowest
 * thing in the empire to rebuild, so a bad run of misreads did not cost a fight,
 * it cost the evening, and the honest response to that was to stop marching. A
 * bloodless assault prices a sortie in turns alone: you always send everyone,
 * and what varies is only how much of the tyrant you take off.
 *
 * Nothing else here was deleted — the matrix's `taken` column, `bossLossScale`,
 * the rout line and the projections are all intact and simply resolve to zero
 * through this one number. Raising it above zero restores the whole casualty
 * side, including the UI, which reads {@link BOSS_CASUALTIES}.
 *
 * The tuning it carried, for whoever brings it back: it was 0.03, retuned down
 * from 0.045 on 2026-07-31 because casualties are a fraction of the *army* while
 * chip loot is a fraction of the *boss's pool*, so an empire under the wall bled
 * what one at parity bled for a sliver of the haul. `bossLossScale` closes the
 * rest of that gap by charging each army its own share. At 0.03, six rounds of
 * correct reads cost ~6% of the army, a level-1 hero's read rate ~13%, and six
 * straight misreads ~25% — measured against the army *at launch*, not the
 * survivors, so the rout line stays a straight cumulative fraction.
 */
export const BOSS_ROUND_LOSS_BASE = 0;

/**
 * Whether an assault costs soldiers at all — the single switch every screen
 * reads before it renders a casualty figure, a rout warning or the hero's
 * survivability pitch.
 *
 * Derived rather than declared so the mechanic and the copy that explains it can
 * never disagree: put blood back in {@link BOSS_ROUND_LOSS_BASE} and the banner,
 * the arena and the report grow their casualty columns back on the same deploy.
 */
export const BOSS_CASUALTIES: boolean = BOSS_ROUND_LOSS_BASE > 0;

/**
 * Cumulative losses that break the army. Reaching it ends the assault early as a
 * rout, which pays only `BOSS_ROUT_LOOT_PENALTY` of what the damage earned.
 *
 * Moved with `BOSS_ROUND_LOSS_BASE`, and it has to be: the line is only a rule if
 * a bad assault can actually reach it. An assault of pure misreads costs ~25%, so
 * 28% sits just inside what bad luck reaches — the same relationship 40% had to
 * the old 37%. Set it much higher and the rout becomes decorative, which would
 * quietly delete the only thing that punishes a fight going badly.
 *
 * Read against `bossLossScale`: those figures are the ones an army *at the wall*
 * faces, which is the fight this line is meant to police. An army far under it
 * pays a fraction of the price and can no longer be routed for turning up.
 */
export const BOSS_ROUT_LOSS_FRACTION = 0.28;

/** Per-round spread on both damage and casualties, ±12%. */
export const BOSS_ROUND_VARIANCE = 0.12;

/* ------------------------------ paying for what you took ------------------------------ */

/**
 * Floor on the engagement scale below — the smallest share of the full price an
 * assault can be charged, however far under the wall the army is.
 *
 * Not zero, and not much lower than this: a march on a tyrant ten times your size
 * still has to cost blood, or the boss becomes a free faucet for anyone willing to
 * spend turns. A quarter of the price is enough to keep the trade honest at the
 * bottom while removing the trap it used to be.
 */
export const BOSS_LOSS_ENGAGEMENT_FLOOR = 0.25;

/**
 * How much of the full casualty price this army actually pays.
 *
 * Casualties used to be a flat fraction of the army no matter who marched, and
 * that was the single worst deal in the game — because the *loot* is not flat.
 * Chip loot is pro-rata against the boss's health pool (`bossChipFraction`), so an
 * empire at a fraction of the wall earned that fraction of the haul and bled
 * exactly the same percentage as one at parity. Measured at city 1 over 4,000
 * assaults, hero level 1:
 *
 *   350 soldiers (3,500 power vs a 12,000 wall)   45 lost, 12.8%   ~20,000 gold
 *   1,200 soldiers (at the wall)                 154 lost, 12.8%   ~67,000 gold
 *
 * Identical blood, a third of the bread — and the small empire had to pay it four
 * or five times over before it ever saw the kill share or the gear. That reads as
 * a punishment for being new, and it was.
 *
 * So the price is scaled by the army's share of the printed wall, which is very
 * nearly the share of the haul it will earn (damage per assault is ~6.3× battle
 * power against a pool of 6.5× boss power). The cost-to-reward ratio is now the
 * same for everyone: chip a tenth, pay a tenth. The 350-soldier army above now
 * loses 13 per assault instead of 45 for the same haul; an army at parity or above
 * is unchanged — it pays the full price, and it kills, which is what the price
 * buys.
 *
 * It also puts the rout out of a small empire's reach. Breaking the formation is
 * meant to be the risk of a *real* fight going badly, not the standing hazard of a
 * young empire marching at the only boss it is allowed to attack.
 */
export function bossLossScale(attackPower: number, bossReferencePower: number): number {
  if (!(bossReferencePower > 0)) return 1;
  return Math.min(
    1,
    Math.max(BOSS_LOSS_ENGAGEMENT_FLOOR, Math.max(0, attackPower) / bossReferencePower)
  );
}

/* ------------------------------ the tactic matrix ------------------------------ */

/** The three tactics a player can answer a telegraph with (fury aside). */
export type BossCounter = Exclude<BossTactic, "FURY">;

export interface RoundModifiers {
  /** Multiplier on the damage this round deals. */
  damage: number;
  /** Multiplier on the casualties this round costs. */
  taken: number;
}

/**
 * Damage / casualty multipliers for every (move, tactic) pair.
 *
 * The diagonal — each move answered by its counter — is the payoff, and the rest
 * is the price of guessing. Two shapes worth keeping in mind when tuning:
 *
 *  - SHIELD is never a *bad* answer for survival (its `taken` never exceeds 0.8),
 *    which makes it the honest hedge: cheap in blood, poor in damage. A player
 *    who shields every round survives comfortably and kills nothing.
 *  - ASSAULT into a SMASH is the single worst cell in the table (1.8× casualties)
 *    and ASSAULT into an EXPOSED is the single best (1.9× damage). The frontal
 *    charge is the high-variance answer, on purpose.
 */
export const BOSS_TACTIC_MATRIX: Record<
  BossMove,
  Record<BossCounter, RoundModifiers>
> = {
  SMASH: {
    ASSAULT: { damage: 1.1, taken: 1.8 },
    SHIELD: { damage: 1.3, taken: 0.3 },
    FLANK: { damage: 0.8, taken: 1.0 },
  },
  SWEEP: {
    ASSAULT: { damage: 0.9, taken: 1.5 },
    SHIELD: { damage: 0.6, taken: 0.8 },
    FLANK: { damage: 1.3, taken: 0.35 },
  },
  EXPOSED: {
    ASSAULT: { damage: 1.9, taken: 0.45 },
    SHIELD: { damage: 0.45, taken: 0.2 },
    FLANK: { damage: 1.0, taken: 0.35 },
  },
};

/** The one right answer to each telegraph. */
export const BOSS_MOVE_COUNTER: Record<BossMove, BossCounter> = {
  SMASH: "SHIELD",
  SWEEP: "FLANK",
  EXPOSED: "ASSAULT",
};

/* ------------------------------ move & tactic copy ------------------------------ */

export interface BossMoveMeta {
  label: string;
  /** What the player is shown *before* choosing — the tell, not the move. */
  telegraph: string;
  /** One-line reminder of what it does, for the arena's legend and the guide. */
  effect: string;
  icon: string;
  /** Tailwind text tone for the telegraph card. */
  tone: string;
}

export const BOSS_MOVE_META: Record<BossMove, BossMoveMeta> = {
  SMASH: {
    label: "מחץ כבד",
    telegraph: "מרים את נשקו מעל הראש — מכה אחת, כל הכוח בה",
    effect: "מכה אנכית הרסנית. חומת מגן בולמת אותה כמעט לגמרי.",
    icon: "🔨",
    tone: "text-red-300",
  },
  SWEEP: {
    label: "סער סוחף",
    telegraph: "פורש את זרועותיו לרוחב וסוחף את הקו כולו",
    effect: "פוגע בכל השורה הצפופה. תמרון עוקף מפזר את הכוח מתחת למכה.",
    icon: "🌀",
    tone: "text-amber-300",
  },
  EXPOSED: {
    label: "פרצה בהגנה",
    telegraph: "מתנשם כבדות — ההגנה שלו נפערת לרגע",
    effect: "חלון ההזדמנות. הסתערות חזית מכפילה כאן את הנזק.",
    icon: "💥",
    tone: "text-emerald-300",
  },
};

export interface BossTacticMeta {
  label: string;
  blurb: string;
  icon: string;
  /** Tailwind classes for the button's identity. */
  tone: string;
}

export const BOSS_TACTIC_META: Record<BossTactic, BossTacticMeta> = {
  ASSAULT: {
    label: "הסתערות חזית",
    blurb: "נזק מקסימלי, חשוף למכות",
    icon: "⚔️",
    tone: "border-red-500/60 text-red-200 hover:border-red-400",
  },
  SHIELD: {
    label: "חומת מגן",
    blurb: "אבדות מינימליות, נזק נמוך",
    icon: "🛡️",
    tone: "border-sky-500/60 text-sky-200 hover:border-sky-400",
  },
  FLANK: {
    label: "תמרון עוקף",
    blurb: "מאוזן — טוב מול סער",
    icon: "🏹",
    tone: "border-emerald-500/60 text-emerald-200 hover:border-emerald-400",
  },
  FURY: {
    label: "זעם הגיבור",
    blurb: "מכת מחץ אחת, מתעלמת מהמהלך",
    icon: "🔥",
    tone: "border-gold/70 text-gold-bright hover:border-gold-bright",
  },
};

/* ------------------------------ the boss's next move ------------------------------ */

/**
 * Weights for the telegraph. EXPOSED is the rarest because it is the round that
 * pays: a player who opens with ASSAULT every round is betting on a 1-in-4.
 */
export const BOSS_MOVE_WEIGHTS: Record<BossMove, number> = {
  SMASH: 0.4,
  SWEEP: 0.35,
  EXPOSED: 0.25,
};

/** Roll the move the boss commits to for the coming round. */
export function rollBossMove(random: () => number = secureRandom): BossMove {
  const roll = random();
  let acc = 0;
  for (const move of Object.keys(BOSS_MOVE_WEIGHTS) as BossMove[]) {
    acc += BOSS_MOVE_WEIGHTS[move];
    if (roll < acc) return move;
  }
  return "SMASH";
}

/* ------------------------------ hero fury ------------------------------ */

/** Full meter. Fury is spent whole — there is no partial release. */
export const BOSS_FURY_MAX = 100;
/** Charge gained every round simply for standing in the fight. */
export const BOSS_FURY_PER_ROUND = 22;
/** Extra charge when the telegraph was misread — the hero rages as troops fall. */
export const BOSS_FURY_ON_MISREAD = 14;

/** Base damage multiplier of a released fury, before the hero's level. */
export const BOSS_FURY_DAMAGE_BASE = 2.4;
/** Added per hero level, capped — so the hero's level matters inside the fight. */
export const BOSS_FURY_DAMAGE_PER_LEVEL = 0.02;
export const BOSS_FURY_DAMAGE_LEVEL_CAP = 1.2;
/** The hero leads the charge and absorbs most of the answer. */
export const BOSS_FURY_LOSS_MULTIPLIER = 0.5;

/**
 * Damage multiplier of a released fury: 2.4× at level 1 up to 3.6× at level 60
 * and above. Compare the best ordinary round (1.9×, ASSAULT into an EXPOSED) —
 * fury is worth about two of them, which is what makes holding it for the right
 * moment a decision rather than a formality.
 */
export function bossFuryMultiplier(heroLevel: number): number {
  const fromLevel = Math.min(
    BOSS_FURY_DAMAGE_LEVEL_CAP,
    Math.max(0, heroLevel - 1) * BOSS_FURY_DAMAGE_PER_LEVEL
  );
  return BOSS_FURY_DAMAGE_BASE + fromLevel;
}

/** Whether fury releases this round: a full meter, and a hero alive to swing it. */
export function canReleaseFury(fury: number, heroAlive: boolean): boolean {
  return heroAlive && fury >= BOSS_FURY_MAX;
}

/* ------------------------------ how the army reads the tyrant ------------------------------ */

/**
 * Chance the officers read a telegraph correctly, at hero level 1.
 *
 * Above the 1-in-3 a coin-flipping army would manage, because an army with no
 * hero at all should still look like an army — and below the point where the
 * hero stops mattering.
 */
export const BOSS_READ_CHANCE_BASE = 0.45;
/** Gained per hero level, up to the cap. Level 30 reads 60%, level 60+ reads 75%. */
export const BOSS_READ_CHANCE_PER_LEVEL = 0.005;
export const BOSS_READ_CHANCE_MAX = 0.75;
/**
 * A dead hero leaves the officers guessing. Not zero — the army still has
 * officers — but no better than chance.
 */
export const BOSS_READ_CHANCE_NO_HERO = 1 / 3;

/**
 * How often this army reads the boss right.
 *
 * This is the single number the hero contributes to the fight, and it is where
 * the player's old per-round decision went: you no longer out-think the tyrant
 * yourself, you field a hero good enough to do it for you. It is deliberately
 * capped well short of certainty — at the top the army still misreads one round
 * in four, so an assault is never a formality.
 */
export function bossReadChance(heroLevel: number, heroAlive: boolean): number {
  if (!heroAlive) return BOSS_READ_CHANCE_NO_HERO;
  return Math.min(
    BOSS_READ_CHANCE_MAX,
    BOSS_READ_CHANCE_BASE + Math.max(0, heroLevel - 1) * BOSS_READ_CHANCE_PER_LEVEL
  );
}

/**
 * The tactic the army picks for itself against `move`.
 *
 * On a successful read it is the counter; on a failed one it is one of the two
 * wrong answers, picked evenly — so a misread is sometimes merely weak and
 * sometimes actively expensive, which is what gives the log its texture.
 */
export function autoTactic(
  move: BossMove,
  heroLevel: number,
  heroAlive: boolean,
  random: () => number = secureRandom
): { tactic: BossCounter; read: boolean } {
  const counter = BOSS_MOVE_COUNTER[move];
  if (random() < bossReadChance(heroLevel, heroAlive)) return { tactic: counter, read: true };
  const wrong = (["ASSAULT", "SHIELD", "FLANK"] as BossCounter[]).filter((t) => t !== counter);
  return { tactic: wrong[random() < 0.5 ? 0 : 1], read: false };
}

/* ------------------------------ resolving one round ------------------------------ */

export interface RoundInput {
  /** The move already committed to the battle row — the player has seen it. */
  move: BossMove;
  tactic: BossTactic;
  /** Battle power snapshotted when the sortie launched. */
  attackPower: number;
  /** Soldiers still standing, and the army that marched. */
  soldiers: number;
  soldiersAtStart: number;
  /** The boss's remaining cycle health. */
  bossHp: number;
  /**
   * The boss's *printed* battle power — the wall, not the pool. Only the casualty
   * price reads it (see `bossLossScale`). Omitted means "charge the full price",
   * which is what every caller that does not know the wall should get.
   */
  bossPower?: number;
  fury: number;
  heroLevel: number;
  heroAlive: boolean;
}

export interface RoundResult {
  damage: number;
  soldiersLost: number;
  /** Whether the tactic was the move's counter (a released fury always counts). */
  correct: boolean;
  furyUsed: boolean;
  furyAfter: number;
  bossHpAfter: number;
  /** True when this round emptied the pool. */
  killed: boolean;
  /** True when cumulative losses reached the rout line. */
  routed: boolean;
}

/** `1 ± BOSS_ROUND_VARIANCE`, drawn once per quantity. */
function jitter(random: () => number): number {
  return 1 + (random() * 2 - 1) * BOSS_ROUND_VARIANCE;
}

/**
 * Resolve a single round.
 *
 * Deliberately total: it never throws and never reads the clock or the database.
 * The caller has already decided that the tactic is legal (see `canReleaseFury`)
 * and owns persisting the result.
 */
export function resolveBossRound(
  input: RoundInput,
  random: () => number = secureRandom
): RoundResult {
  const {
    move,
    tactic,
    attackPower,
    soldiers,
    soldiersAtStart,
    bossHp,
    bossPower: wallPower,
    fury,
    heroLevel,
    heroAlive,
  } = input;

  const furyUsed = tactic === "FURY" && canReleaseFury(fury, heroAlive);
  // A FURY that is not actually chargeable degrades to the shield wall rather
  // than to nothing: the round is already paid for, and refusing to resolve it
  // would leave the battle row and the client disagreeing about the round number.
  const counter: BossCounter = furyUsed
    ? "ASSAULT"
    : tactic === "FURY"
      ? "SHIELD"
      : tactic;
  const mods = BOSS_TACTIC_MATRIX[move][counter];
  const correct = furyUsed || counter === BOSS_MOVE_COUNTER[move];

  const damageMultiplier = furyUsed ? bossFuryMultiplier(heroLevel) : mods.damage;
  const damage = Math.max(
    0,
    Math.round(attackPower * BOSS_ROUND_DAMAGE_BASE * damageMultiplier * jitter(random))
  );

  const takenMultiplier = mods.taken * (furyUsed ? BOSS_FURY_LOSS_MULTIPLIER : 1);
  // Scaled by how much of this wall the army can actually engage, so the blood
  // costs the same *per unit of haul* for everyone — see `bossLossScale`.
  const engagement = wallPower == null ? 1 : bossLossScale(attackPower, wallPower);
  const rawLoss =
    soldiersAtStart * BOSS_ROUND_LOSS_BASE * takenMultiplier * engagement * jitter(random);
  // A blow that lands kills at least one soldier. Without the floor, rounding
  // made any army under about six men *immortal* in the fight — it took literally
  // zero casualties every round and could never be routed, only run out of
  // rounds. Tiny armies deal negligible damage, so this is about the rule being
  // coherent rather than about an exploit.
  const soldiersLost = Math.min(
    soldiers,
    rawLoss > 0 ? Math.max(1, Math.round(rawLoss)) : 0
  );

  const bossHpAfter = Math.max(0, bossHp - damage);
  const soldiersAfter = soldiers - soldiersLost;
  const lossFraction =
    soldiersAtStart > 0 ? (soldiersAtStart - soldiersAfter) / soldiersAtStart : 1;

  return {
    damage,
    soldiersLost,
    correct,
    furyUsed,
    // Fury is spent whole; otherwise the meter charges, and faster when it hurt.
    furyAfter: furyUsed
      ? 0
      : Math.min(
          BOSS_FURY_MAX,
          fury + BOSS_FURY_PER_ROUND + (correct ? 0 : BOSS_FURY_ON_MISREAD)
        ),
    bossHpAfter,
    killed: bossHpAfter <= 0,
    // A kill outranks a rout: the tyrant fell on the same blow that broke the
    // formation, and the army that killed it is not denied the hoard.
    routed: bossHpAfter > 0 && (soldiersAfter <= 0 || lossFraction >= BOSS_ROUT_LOSS_FRACTION),
  };
}

/* ------------------------------ the whole assault ------------------------------ */

/** One resolved round, as stored on the battle row and replayed by the arena. */
export interface BossRound {
  /** 1-based. */
  round: number;
  move: BossMove;
  tactic: BossTactic;
  /** Whether the officers read the tyrant right. */
  correct: boolean;
  furyUsed: boolean;
  damage: number;
  soldiersLost: number;
  /** The boss's health after this round, and the meter after it. */
  bossHpAfter: number;
  fury: number;
  /** Milliseconds after launch at which this round becomes visible. */
  at: number;
}

export interface BossSortiePlan {
  rounds: BossRound[];
  /** Totals, all pre-decided at launch and applied in one write at the settle. */
  damageDealt: number;
  soldiersLost: number;
  bossHpAfter: number;
  correctCounters: number;
  killed: boolean;
  routed: boolean;
  /** How the assault ended, ready to store as the battle's terminal status. */
  outcome: "KILLED" | "ROUTED" | "SPENT";
}

export interface SortieInput {
  attackPower: number;
  soldiers: number;
  bossHp: number;
  /** The boss's printed power — prices the casualties (see `bossLossScale`). */
  bossPower?: number;
  heroLevel: number;
  heroAlive: boolean;
  rounds?: number;
}

/**
 * Roll an entire assault at launch.
 *
 * Deciding the whole battle up front — rather than a round at a time as the clock
 * ticks — is what lets the player walk away from it. The plan is stored on the
 * battle row, the arena reveals the rounds whose `at` has elapsed, and the settle
 * applies the totals in a single write. Nothing about the outcome depends on the
 * player being present, on how long they watched, or on when the settle actually
 * fires, which is the whole point: an assault interrupted by a closed laptop pays
 * exactly what it would have paid.
 *
 * It also means the reveal cannot be gamed by reloading, because there is nothing
 * left to roll — and the un-elapsed rounds are filtered out server-side, so the
 * client is never handed the ending early.
 */
export function simulateBossSortie(
  input: SortieInput,
  random: () => number = secureRandom
): BossSortiePlan {
  const total = input.rounds ?? BOSS_SORTIE_ROUNDS;
  const rounds: BossRound[] = [];

  let hp = input.bossHp;
  let soldiers = input.soldiers;
  let fury = 0;
  let correctCounters = 0;
  let damageDealt = 0;
  let soldiersLost = 0;
  let killed = false;
  let routed = false;

  for (let i = 0; i < total; i++) {
    // Fury releases itself the moment it is full: with no player to hold it for
    // the right moment, sitting on a charged meter would only waste it.
    const releasing = canReleaseFury(fury, input.heroAlive);
    const move = rollBossMove(random);
    const chosen = releasing
      ? { tactic: "FURY" as BossTactic }
      : autoTactic(move, input.heroLevel, input.heroAlive, random);

    const result = resolveBossRound(
      {
        move,
        tactic: chosen.tactic,
        attackPower: input.attackPower,
        soldiers,
        soldiersAtStart: input.soldiers,
        bossHp: hp,
        bossPower: input.bossPower,
        fury,
        heroLevel: input.heroLevel,
        heroAlive: input.heroAlive,
      },
      random
    );

    hp = result.bossHpAfter;
    soldiers -= result.soldiersLost;
    fury = result.furyAfter;
    damageDealt += result.damage;
    soldiersLost += result.soldiersLost;
    if (result.correct) correctCounters += 1;

    rounds.push({
      round: i + 1,
      move,
      tactic: chosen.tactic,
      correct: result.correct,
      furyUsed: result.furyUsed,
      damage: result.damage,
      soldiersLost: result.soldiersLost,
      bossHpAfter: hp,
      fury,
      at: roundRevealAt(i),
    });

    if (result.killed) {
      killed = true;
      break;
    }
    if (result.routed) {
      routed = true;
      break;
    }
  }

  return {
    rounds,
    damageDealt,
    soldiersLost,
    bossHpAfter: hp,
    correctCounters,
    killed,
    routed,
    outcome: killed ? "KILLED" : routed ? "ROUTED" : "SPENT",
  };
}

/* ------------------------------ the grade ------------------------------ */

export type BossGrade = "S" | "A" | "B" | "C";

/** Kill-bonus multiplier per grade. */
export const BOSS_GRADE_BONUS: Record<BossGrade, number> = {
  S: 1.5,
  A: 1.3,
  B: 1.15,
  C: 1,
};

export const BOSS_GRADE_LABEL: Record<BossGrade, string> = {
  S: "מושלם",
  A: "מצוין",
  B: "טוב",
  C: "מדשדש",
};

/**
 * How well the sortie was fought, on 0..1: mostly how many telegraphs were read
 * correctly, partly how much of the army came home.
 *
 * Accuracy carries three quarters of it, on purpose. Grading on speed or on
 * losses alone would grade the *army*, handing an S to anyone who outguns the
 * boss badly enough to end it in two rounds; accuracy grades the play, so a
 * parity fight won on reads scores above an overwhelming one won on autopilot.
 *
 * The split is 0.75/0.25 rather than 0.7/0.3 because at the softer weighting the
 * preservation term alone floated a third of the reads correct up into a B: an
 * army strong enough to shrug off the casualties could guess its way to a bonus.
 *
 * While {@link BOSS_CASUALTIES} is off, `lossFraction` is always 0 and the
 * preservation quarter is a constant every sortie collects — which is exactly the
 * ladder the `BOSS_GRADE_MIN_DECISIONS` note below describes for "a clean army",
 * so the grades land where they were designed to. It is left in the formula
 * rather than folded into the thresholds so that restoring the blood restores the
 * grade too.
 */
export const BOSS_SCORE_ACCURACY_WEIGHT = 0.75;

/**
 * Floor on the accuracy denominator — the number of reads a sortie has to show
 * before it can claim a perfect one.
 *
 * Without it the grade measured the opposite of what the comment above promises.
 * `decisions` is however many rounds the fight actually lasted, so an army far
 * over the wall ends it in one round and needs ONE lucky read to score 100%
 * accuracy, while a parity army goes six rounds and needs very nearly all six.
 * Measured over 4,000 simulated sorties per cell at hero 30:
 *
 *   at parity      S  7.0%  A 42.0%  B 30.9%  C  3.0%
 *   at 100x        S 59.0%  A  0.0%  B  0.0%  C 41.0%
 *
 * The overwhelming army took the top grade 8.4x as often, and A and B were
 * literally unreachable for it — a four-rung ladder collapsed into a coin flip on
 * one dice roll.
 *
 * Three, because that is the shortest fight in which the reads can be said to
 * have gone well rather than to have gone one way. A one-round kill now tops out
 * at B (0.25 accuracy credit + a clean army), two rounds read correctly reach A,
 * and S needs three good reads — which an overwhelming army can still get, it
 * just has to actually fight for them. The full ladder is reachable again from
 * both ends, and the parity fight scores above the autopilot one as intended.
 */
export const BOSS_GRADE_MIN_DECISIONS = 3;

export function bossFightScore(
  correctCounters: number,
  decisions: number,
  lossFraction: number
): number {
  const accuracy =
    Math.max(0, correctCounters) / Math.max(decisions, BOSS_GRADE_MIN_DECISIONS);
  const preserved = 1 - Math.min(1, Math.max(0, lossFraction) / BOSS_ROUT_LOSS_FRACTION);
  return (
    Math.min(1, accuracy) * BOSS_SCORE_ACCURACY_WEIGHT +
    preserved * (1 - BOSS_SCORE_ACCURACY_WEIGHT)
  );
}

export function bossGrade(
  correctCounters: number,
  decisions: number,
  lossFraction: number
): BossGrade {
  const score = bossFightScore(correctCounters, decisions, lossFraction);
  if (score >= 0.85) return "S";
  if (score >= 0.65) return "A";
  if (score >= 0.45) return "B";
  return "C";
}

/* ------------------------------ splitting the haul ------------------------------ */

/**
 * How the cycle's haul divides between wearing the boss down and felling it.
 *
 * The chip share is what makes a sortie that fails to kill still worth marching:
 * loot arrives in proportion to the damage dealt, so an under-powered empire can
 * work at the boss across several sorties and be paid for the work. The kill
 * share is the hoard behind the gates, and it is the only part the grade
 * multiplies — it is also the only part that cannot be farmed, since a siege can
 * be killed once per cycle.
 *
 * Because chip loot is pro-rata against `maxHp`, the two together pay at most
 * `BOSS_CHIP_SHARE + BOSS_KILL_SHARE × grade bonus` of the haul per cycle, no
 * matter how many sorties it took. That bound is what replaced the old
 * one-victory-per-cycle cap.
 */
export const BOSS_CHIP_SHARE = 0.55;
export const BOSS_KILL_SHARE = 0.45;

/**
 * Fraction of the chip loot a routed assault still brings home.
 *
 * Half, not none. When the player chose the tactics, a rout paying nothing was the
 * point — it made pulling out in time a real decision. With the army fighting
 * itself there is no decision to punish, so confiscating the whole haul for an
 * unlucky run of misreads would read as a bug rather than a risk. Halving it keeps
 * a broken formation clearly worse than a spent one without being arbitrary.
 */
export const BOSS_ROUT_LOOT_PENALTY = 0.5;

/** Fraction of the cycle's haul earned by dealing `damage` out of `maxHp`. */
export function bossChipFraction(damage: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.min(1, Math.max(0, damage) / maxHp) * BOSS_CHIP_SHARE;
}

/** Fraction of the cycle's haul the killing blow pays, grade included. */
export function bossKillFraction(grade: BossGrade): number {
  return BOSS_KILL_SHARE * BOSS_GRADE_BONUS[grade];
}

/**
 * Scale a full-cycle haul down to the part a sortie earned.
 *
 * Resources round to hundreds (as `bossReward` does) so a chip payout reads like
 * plunder rather than a computed remainder; slaves round to whole captives and
 * are allowed to come out at zero — a sortie that barely scratched the gate does
 * not open the pens.
 *
 * `resourceBonus` is Happy Hour (see lib/game/happyHour.ts) and multiplies the
 * four resources only. The captives are left at the plain share on purpose: a
 * freed slave is a permanent addition to the production engine, so doubling the
 * pens for an hour would outlive the hour by the rest of the season.
 */
export function bossPayout(
  reward: BossReward,
  fraction: number,
  resourceBonus = 1
): BossReward {
  const share = Math.max(0, fraction);
  const resShare = share * Math.max(0, resourceBonus);
  const res = (base: number) => Math.round((base * resShare) / 100) * 100;
  return {
    gold: res(reward.gold),
    wood: res(reward.wood),
    iron: res(reward.iron),
    stone: res(reward.stone),
    slaves: Math.round(reward.slaves * share),
  };
}

/* ------------------------------ projections for the UI ------------------------------ */

/** Mean damage multiplier of a correctly-read round, over the move distribution. */
function readRightMultiplier(): number {
  return (Object.keys(BOSS_MOVE_WEIGHTS) as BossMove[]).reduce(
    (sum, move) =>
      sum + BOSS_MOVE_WEIGHTS[move] * BOSS_TACTIC_MATRIX[move][BOSS_MOVE_COUNTER[move]].damage,
    0
  );
}

/** Mean damage multiplier of a misread round — the average of the two wrong cells. */
function readWrongMultiplier(): number {
  return (Object.keys(BOSS_MOVE_WEIGHTS) as BossMove[]).reduce((sum, move) => {
    const counter = BOSS_MOVE_COUNTER[move];
    const wrong = (["ASSAULT", "SHIELD", "FLANK"] as BossCounter[])
      .filter((t) => t !== counter)
      .map((t) => BOSS_TACTIC_MATRIX[move][t].damage);
    return sum + BOSS_MOVE_WEIGHTS[move] * (wrong.reduce((a, b) => a + b, 0) / wrong.length);
  }, 0);
}

/**
 * Damage one assault is *expected* to deal, hero included.
 *
 * The honest number for the banner now that the army fights itself: reads land at
 * `bossReadChance`, and one round of the six is the fury (the meter fills on
 * round 5 at 22 a round, and releases itself immediately). A player reading this
 * should be able to predict how many assaults the tyrant will take, and be right
 * most of the time.
 */
export function bossExpectedSortieDamage(
  attackPower: number,
  heroLevel: number,
  heroAlive: boolean,
  rounds = BOSS_SORTIE_ROUNDS
): number {
  const p = bossReadChance(heroLevel, heroAlive);
  const ordinary = p * readRightMultiplier() + (1 - p) * readWrongMultiplier();
  // Rounds it takes to fill the meter — the fury replaces one ordinary round.
  const furyRounds =
    heroAlive && rounds > Math.ceil(BOSS_FURY_MAX / BOSS_FURY_PER_ROUND) ? 1 : 0;
  const multiplier =
    ordinary * (rounds - furyRounds) + furyRounds * bossFuryMultiplier(heroLevel);
  return attackPower * BOSS_ROUND_DAMAGE_BASE * multiplier;
}

/** Mean casualty multiplier of a correctly-read round, over the move distribution. */
function readRightLossMultiplier(): number {
  return (Object.keys(BOSS_MOVE_WEIGHTS) as BossMove[]).reduce(
    (sum, move) =>
      sum + BOSS_MOVE_WEIGHTS[move] * BOSS_TACTIC_MATRIX[move][BOSS_MOVE_COUNTER[move]].taken,
    0
  );
}

/** Mean casualty multiplier of a misread round — the average of the two wrong cells. */
function readWrongLossMultiplier(): number {
  return (Object.keys(BOSS_MOVE_WEIGHTS) as BossMove[]).reduce((sum, move) => {
    const counter = BOSS_MOVE_COUNTER[move];
    const wrong = (["ASSAULT", "SHIELD", "FLANK"] as BossCounter[])
      .filter((t) => t !== counter)
      .map((t) => BOSS_TACTIC_MATRIX[move][t].taken);
    return sum + BOSS_MOVE_WEIGHTS[move] * (wrong.reduce((a, b) => a + b, 0) / wrong.length);
  }, 0);
}

/**
 * Soldiers one assault is *expected* to cost — the other half of the deal.
 *
 * The mirror of `bossExpectedSortieDamage`, and it exists for one reason: the
 * price of a sortie used to be invisible until the report. A player marched, lost
 * a fifth of their army and found out afterwards, which is how "I lost dozens for
 * nothing" happens. Shown *before* the attack, next to the loot the same assault
 * is expected to earn, the whole trade is on the screen where the decision is.
 *
 * Same shape as the damage projection: reads land at `bossReadChance` (which is
 * why a levelled, living hero is the defensive stat), and the fury round costs
 * half what an ordinary one does.
 */
export function bossExpectedSortieLosses(
  soldiers: number,
  heroLevel: number,
  heroAlive: boolean,
  /** The army's share of the full price — `bossLossScale`, 1 when unknown. */
  lossScale = 1,
  rounds = BOSS_SORTIE_ROUNDS
): number {
  const p = bossReadChance(heroLevel, heroAlive);
  const ordinary = p * readRightLossMultiplier() + (1 - p) * readWrongLossMultiplier();
  const furyRounds =
    heroAlive && rounds > Math.ceil(BOSS_FURY_MAX / BOSS_FURY_PER_ROUND) ? 1 : 0;
  const multiplier =
    ordinary * (rounds - furyRounds) +
    furyRounds * readRightLossMultiplier() * BOSS_FURY_LOSS_MULTIPLIER;
  return Math.min(soldiers, soldiers * BOSS_ROUND_LOSS_BASE * multiplier * lossScale);
}

/**
 * Assaults this army needs to clear `hp`. Shown on the banner in place of the old
 * "you are N power short" line, which had nothing to say to a player who was
 * short: this always has an answer, and the answer shrinks as the army — and the
 * hero — grow.
 */
export function bossSortiesToKill(
  attackPower: number,
  hp: number,
  heroLevel = 1,
  heroAlive = true
): number {
  const perSortie = bossExpectedSortieDamage(attackPower, heroLevel, heroAlive);
  if (perSortie <= 0) return Infinity;
  return Math.max(1, Math.ceil(hp / perSortie));
}
