import { seededRandom } from "./random";
import { mergeRewards, scaleRewards, type Reward } from "./rewards";

/**
 * הזירה — the weekly tournament.
 *
 * The ladder tells a player where they stand; it never tells them whether they
 * would *win*. Raiding is the only answer the game had, and raiding is filtered
 * through turns, shields, timing and who happened to be online — a fair fight
 * between two empires has never actually been available.
 *
 * The arena is that fight, run every week, for everybody who signs up.
 *
 * ## Fought by the system, like the guild war
 *
 * Nobody presses attack. Entrants register during the week, and when the week
 * turns over the whole card is resolved at once: every entrant meets every
 * other entrant exactly once, and the table is the result. Three things follow:
 *
 *  - **Nobody has to be online.** A tournament that rewarded being awake at the
 *    right minute would be a tournament for one time zone.
 *  - **There is no bracket to hold.** A round-robin is a pure function of who
 *    entered, so the arena stores an entry per player and nothing else — no
 *    rounds, no pairings, no half-finished tree to repair when somebody's
 *    account is deleted mid-week.
 *  - **It is reproducible.** Every duel is decided from a seeded stream (see
 *    `duelWinner`), so resolving the same card twice gives the same table, and
 *    a resolution that races itself cannot produce two different results.
 *
 * ## The same city rule as everything else
 *
 * One arena per city tier per week. Combat in this game is confined to your own
 * city tier everywhere else, and a tournament that ignored that would be a
 * tournament the largest empire in the game wins every week forever.
 */

/* ------------------------------ entry ------------------------------ */

/**
 * Turns to enter. Real but small — the arena is meant to be entered by
 * everybody in the tier, and a price that made a player choose between the
 * tournament and their week's raiding would be a price nobody pays.
 */
export const ARENA_ENTRY_TURNS = 60;

/**
 * The most entrants one arena will resolve.
 *
 * A round-robin is O(N²) duels, resolved in one transaction at the moment the
 * week turns over. At 60 that is 1,770 comparisons — arithmetic, no queries,
 * a few milliseconds. Ten times as many entrants would be a hundred times the
 * work, and this is the one place in the game where a quiet upper bound is
 * worth more than an unbounded promise.
 */
export const ARENA_MAX_ENTRANTS = 60;

/* ------------------------------ the duel ------------------------------ */

/**
 * How much of a duel is the dice.
 *
 * The whole design question of the feature. At 0 the arena is a re-print of the
 * power ladder and nobody below the top ever enters; at 1 it is a raffle and
 * nobody's army matters. 0.35 means an empire with **half** the power of
 * another still takes roughly one duel in five — enough that entering is worth
 * it from anywhere in the table, and nowhere near enough for the strongest
 * entrant not to be the favourite.
 */
export const ARENA_LUCK = 0.35;

/**
 * Which of two entrants wins one duel.
 *
 * The comparison is on the **square root** of power, for the reason the world
 * boss uses one: raw power spans several orders of magnitude inside a single
 * city tier, and a linear comparison would make every duel between unequal
 * empires a formality. The root compresses that into a range where luck can
 * still speak.
 *
 * `random` is seeded from the arena and the two ids, so a duel always resolves
 * the same way however many times the card is computed — and so neither entrant
 * can be advantaged by the order the loops happen to run in.
 */
export function duelWinner(
  a: { id: string; power: number },
  b: { id: string; power: number },
  random: () => number
): string {
  const pa = Math.sqrt(Math.max(0, a.power)) + 1;
  const pb = Math.sqrt(Math.max(0, b.power)) + 1;
  // The favourite's share of the outcome, pulled towards an even coin by
  // ARENA_LUCK. At luck 0 this is the raw power share; at luck 1 it is 0.5.
  const share = pa / (pa + pb);
  const chance = share * (1 - ARENA_LUCK) + 0.5 * ARENA_LUCK;
  return random() < chance ? a.id : b.id;
}

/** A seed that is the same for a pair however they are ordered. */
export function duelSeed(arenaId: string, a: string, b: string): string {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `${arenaId}:${first}:${second}`;
}

/** One entrant, as the resolver needs them. */
export interface ArenaFighter {
  id: string;
  power: number;
}

/** One entrant's record after the card is resolved. */
export interface ArenaResult {
  id: string;
  wins: number;
  losses: number;
}

/**
 * Resolve the whole card: every entrant against every other, exactly once.
 *
 * Pure and deterministic, so the resolver can be tested without a database and
 * so a resolution that somehow runs twice writes the same table both times.
 * Entrants are sorted by id first, which makes the pairing order independent of
 * however the rows came back from the query.
 */
export function resolveArena(
  arenaId: string,
  fighters: readonly ArenaFighter[]
): ArenaResult[] {
  const order = [...fighters].sort((a, b) => (a.id < b.id ? -1 : 1));
  const record = new Map<string, ArenaResult>(
    order.map((f) => [f.id, { id: f.id, wins: 0, losses: 0 }])
  );

  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      const a = order[i];
      const b = order[j];
      const winner = duelWinner(a, b, seededRandom(duelSeed(arenaId, a.id, b.id)));
      const loser = winner === a.id ? b.id : a.id;
      record.get(winner)!.wins += 1;
      record.get(loser)!.losses += 1;
    }
  }
  return [...record.values()];
}

/**
 * Rank a resolved table: most wins first, then by power as the tie-break.
 *
 * Power rather than a coin, because a tie on wins between two entrants who
 * never met is genuinely undecided, and "the stronger empire placed higher" is
 * the only tie-break a player will accept without an explanation.
 */
export function rankArena(
  results: readonly ArenaResult[],
  powerById: ReadonlyMap<string, number>
): ArenaResult[] {
  return [...results].sort(
    (a, b) =>
      b.wins - a.wins ||
      (powerById.get(b.id) ?? 0) - (powerById.get(a.id) ?? 0) ||
      (a.id < b.id ? -1 : 1)
  );
}

/* ------------------------------ the spoils ------------------------------ */

/**
 * The podium purses, quoted at **one city**. Everyone below third takes the
 * participation purse instead — see `arenaReward`.
 *
 * Diamonds only on the podium, and modestly: this repeats every week for every
 * city tier, so a generous top prize would be a diamond faucet with as many
 * spouts as the game has tiers.
 */
export const ARENA_PODIUM: readonly (readonly Reward[])[] = [
  [
    { kind: "diamonds", amount: 60 },
    { kind: "gold", amount: 150_000 },
    { kind: "turns", amount: 250 },
  ],
  [
    { kind: "diamonds", amount: 35 },
    { kind: "gold", amount: 90_000 },
    { kind: "turns", amount: 150 },
  ],
  [
    { kind: "diamonds", amount: 20 },
    { kind: "gold", amount: 60_000 },
    { kind: "turns", amount: 100 },
  ],
];

/**
 * What everybody else takes for turning up.
 *
 * Deliberately worth more than the 60 turns the entry cost, so entering is
 * never a loss — an arena a mid-table player leaves poorer is an arena they
 * enter once.
 */
export const ARENA_CONSOLATION: readonly Reward[] = [
  { kind: "turns", amount: 90 },
  { kind: "gold", amount: 25_000 },
];

/**
 * Extra gold per duel won, quoted at one city.
 *
 * The reason a fourth-place finish is not the same as a last-place one. Small
 * per duel, but a strong week of thirty wins is worth more than the podium's
 * gold — which is the right shape: the podium sells the diamonds, the wins sell
 * the grind.
 */
export const ARENA_GOLD_PER_WIN = 4_000;

/**
 * The purse for a given placing (1-based) and win count.
 *
 * Merged after scaling, and that is load-bearing rather than tidiness: both the
 * podium table and the per-win bonus pay gold, so an unmerged list comes back
 * with *two* gold lines. `payRewards` merges before it credits, so the player
 * would receive one figure while the screen showed a different, smaller one —
 * the classic "the preview lied" bug. Merging here makes the two the same list.
 *
 * Merged *after* `scaleRewards` because that helper rounds each line to whole
 * hundreds; merging first would round the sum instead of the parts, and the
 * displayed figure would drift from the paid one by up to a hundred gold.
 */
export function arenaReward(
  place: number,
  wins: number,
  cities: number
): Reward[] {
  const base =
    place >= 1 && place <= ARENA_PODIUM.length
      ? ARENA_PODIUM[place - 1]
      : ARENA_CONSOLATION;
  return mergeRewards(
    scaleRewards(
      [...base, { kind: "gold", amount: Math.max(0, wins) * ARENA_GOLD_PER_WIN }],
      cities
    )
  );
}

/* ------------------------------ view model ------------------------------ */

/** One row of the arena table. */
export interface ArenaStanding {
  empireId: string;
  empireName: string;
  wins: number;
  losses: number;
  /** 1-based placing; 0 while the card is unresolved. */
  place: number;
  isMe: boolean;
}

export interface ArenaState {
  /** The city tier this arena belongs to — combat never crosses one. */
  tier: number;
  /** Jerusalem week index. */
  week: number;
  /** When the card is resolved and the next arena opens, epoch ms. */
  resolvesAt: number;
  serverNow: number;

  /** The card has been fought. */
  resolved: boolean;
  /** The viewer is entered. */
  entered: boolean;
  entryTurns: number;
  /** The viewer's turns, so the button can say why it is disabled. */
  turns: number;
  entrants: number;
  maxEntrants: number;

  /** Everyone entered, ranked once resolved and unordered before. */
  standings: ArenaStanding[];
  /** The viewer's own placing, 0 if unresolved or not entered. */
  myPlace: number;
  /** The viewer may collect. */
  claimable: boolean;
  claimed: boolean;
  /** What the viewer's finish is worth. */
  reward: Reward[];
}
