import { seededRandom } from "./random";
import { mergeRewards, scaleRewards, type Reward } from "./rewards";

/**
 * הזירה — the daily tournament.
 *
 * The ladder tells a player where they stand; it never tells them whether they
 * would *win*. Raiding is the only answer the game had, and raiding is filtered
 * through turns, shields, timing and who happened to be online — a fair fight
 * between two empires has never actually been available.
 *
 * The arena is that fight, run every day, for everybody who signs up.
 *
 * ## Fought by the system, like the guild war
 *
 * Nobody presses attack. Entrants register during the day, and when the day
 * turns over the whole card is resolved at once: every entrant meets every
 * other entrant exactly once, and the table is the result. Three things follow:
 *
 *  - **Nobody has to be online.** A tournament that rewarded being awake at the
 *    right minute would be a tournament for one time zone.
 *  - **There is no bracket to hold.** A round-robin is a pure function of who
 *    entered, so the arena stores an entry per player and nothing else — no
 *    rounds, no pairings, no half-finished tree to repair when somebody's
 *    account is deleted mid-card.
 *  - **It is reproducible.** Every duel is decided from a seeded stream (see
 *    `duelWinner`), so resolving the same card twice gives the same table, and
 *    a resolution that races itself cannot produce two different results.
 *
 * ## Daily since 2026-08-13
 *
 * It ran weekly until then, and the change is only to the *period* — a card
 * still opens on the first look, still resolves when its period turns over,
 * still pays the same shape of purse. What did have to move with it is every
 * figure below: seven cards a week paying a weekly podium would be a diamond
 * faucet with as many spouts as the game has tiers. The purses and the entry
 * price were all divided by five rather than by seven, which is deliberate —
 * turning up every day should be worth about 1.4× what turning up on Sunday
 * used to be, or there is no reason to have made it daily.
 *
 * ## The same city rule as everything else
 *
 * One arena per city tier per day. Combat in this game is confined to your own
 * city tier everywhere else, and a tournament that ignored that would be a
 * tournament the largest empire in the game wins every day forever.
 */

/* ------------------------------ entry ------------------------------ */

/**
 * Turns to enter. Real but small — the arena is meant to be entered by
 * everybody in the tier, and a price that made a player choose between the
 * tournament and their day's raiding would be a price nobody pays.
 *
 * 12 rather than the 60 the weekly card charged. A daily ticket is paid seven
 * times as often, so holding the weekly price would have made the arena the
 * single most expensive standing habit in the game.
 */
export const ARENA_ENTRY_TURNS = 12;

/**
 * The most entrants one arena will resolve.
 *
 * A round-robin is O(N²) duels, resolved in one transaction at the moment the
 * day turns over. At 60 that is 1,770 comparisons — arithmetic, no queries,
 * a few milliseconds. Ten times as many entrants would be a hundred times the
 * work, and this is the one place in the game where a quiet upper bound is
 * worth more than an unbounded promise.
 *
 * Unchanged by the move to a daily card: the ceiling is about what one
 * transaction can afford, and a transaction does not care how often it runs.
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
 * Entrants a card needs before it is a tournament at all.
 *
 * Two, because a round-robin of one is *zero duels*. The lone entrant is ranked
 * first by arithmetic, wins nothing, loses nothing, and has nobody to have
 * out-fought — there is no result there to pay for. A tier holding one empire is
 * routine at the top of the ladder and normal on a quiet day anywhere else, so
 * this is not a corner case: it is what the arena looks like for the first
 * player who tries it.
 *
 * Below this floor the card is **void**: no purse at all, and the entry turns
 * come back exactly as they were paid (see `arenaReward`). Not the consolation
 * purse — that one is deliberately worth *more* than the ticket, which is right
 * for a player who fought a card and finished last, and wrong for one who
 * fought nothing: it would make "enter alone, collect, repeat" a standing daily
 * profit in turns and gold for the price of nothing. And not a forfeit either,
 * which is the other failure — a player who paid to enter a tournament that
 * never happened is owed their ticket back, not a lesson.
 *
 * The same rule the guild war has run on since it shipped: below
 * GUILD_WAR_MIN_GUILDS the night is void and the lone guild is paid nothing.
 * The war has nothing to refund because enrolling there is free; the arena
 * charges, so voiding it has to hand the price back.
 */
export const ARENA_MIN_ENTRANTS = 2;

/**
 * Whether this card was a tournament — i.e. whether a single duel was fought.
 *
 * Shared by the screen, the claim and the guide, so the three can never
 * disagree about whether a player is owed a purse or a refund.
 */
export function arenaCardFought(entrants: number): boolean {
  return Math.max(0, Math.floor(entrants) || 0) >= ARENA_MIN_ENTRANTS;
}

/**
 * Entrants a card needs before it pays a podium at all.
 *
 * The one number standing between this feature and a diamond faucet, and it
 * exists because a tier is not a room full of people — it is however many
 * empires happen to hold that many cities today. At the top of the ladder
 * that is routinely one. Without a floor, the sole entrant in a thin tier is
 * ranked first by arithmetic (a round-robin of one is zero duels and a table of
 * one row), and collects the winner's diamonds every day forever for the price
 * of the entry turns — with no opponent, no risk, and nothing to out-play. Two
 * accounts in the same empty tier take first *and* second.
 *
 * Five is the smallest number for which "first place" describes something that
 * happened. Between ARENA_MIN_ENTRANTS and here the card still runs, still
 * resolves, and still pays — the consolation purse and the per-win gold, which
 * are earned rather than awarded — so a thin tier is never a dead screen. It
 * simply does not mint diamonds until there is a tournament to win. Below
 * ARENA_MIN_ENTRANTS there was no card to speak of and the ticket is refunded
 * instead; the two floors answer different questions ("was this worth
 * diamonds?" and "did this happen at all?").
 *
 * Deliberately **not** lowered when the card went daily, though a daily card
 * fills more thinly than a weekly one did. The floor is the anti-faucet, and a
 * faucet that opens every day needs it more, not less: dropping it to four
 * would hand a guaranteed daily podium to any two tiers that happen to hold
 * exactly four regulars.
 */
export const ARENA_PODIUM_MIN_ENTRANTS = 5;

/**
 * Whether a card of this size pays its podium.
 *
 * Shared by the screen and the claim, so the purse a player is shown before the
 * week turns over is the purse they are paid — the two must never be able to
 * disagree about this.
 */
export function arenaPodiumPays(entrants: number): boolean {
  return Math.max(0, Math.floor(entrants) || 0) >= ARENA_PODIUM_MIN_ENTRANTS;
}

/**
 * The podium purses, quoted at **one city**. Everyone below third takes the
 * participation purse instead — see `arenaReward`.
 *
 * Diamonds only on the podium, and modestly: this repeats every day for every
 * city tier, so a generous top prize would be a diamond faucet with as many
 * spouts as the game has tiers. `ARENA_PODIUM_MIN_ENTRANTS` is the other half
 * of that argument — the spout only opens where there is a contest.
 *
 * Divided by five when the card went daily (60/35/20 → 12/7/4). Not by seven,
 * which would have held the weekly rate exactly: a player who shows up seven
 * times should end the week ahead of one who showed up once, and ×1.4 is the
 * size of that "ahead" — big enough to be worth the habit, small enough that
 * the diamond supply is still recognisably the one the store is priced against.
 */
export const ARENA_PODIUM: readonly (readonly Reward[])[] = [
  [
    { kind: "diamonds", amount: 12 },
    { kind: "gold", amount: 30_000 },
    { kind: "turns", amount: 50 },
  ],
  [
    { kind: "diamonds", amount: 7 },
    { kind: "gold", amount: 18_000 },
    { kind: "turns", amount: 30 },
  ],
  [
    { kind: "diamonds", amount: 4 },
    { kind: "gold", amount: 12_000 },
    { kind: "turns", amount: 20 },
  ],
];

/**
 * What everybody else takes for turning up.
 *
 * Deliberately worth more than the turns the entry cost, so entering is never a
 * loss — an arena a mid-table player leaves poorer is an arena they enter once.
 * The unit suite asserts that relation against ARENA_ENTRY_TURNS rather than
 * against a literal, so retuning one of the two can never quietly invert it.
 */
export const ARENA_CONSOLATION: readonly Reward[] = [
  { kind: "turns", amount: 18 },
  { kind: "gold", amount: 5_000 },
];

/**
 * Extra gold per duel won, quoted at one city.
 *
 * The reason a fourth-place finish is not the same as a last-place one. Small
 * per duel, but a strong card of thirty wins is worth more than the podium's
 * gold — which is the right shape: the podium sells the diamonds, the wins sell
 * the grind.
 */
export const ARENA_GOLD_PER_WIN = 800;

/**
 * The purse for a given placing (1-based) and win count on a card of
 * `entrants` entrants.
 *
 * `entrants` is not decoration: a card too thin to have been fought at all pays
 * the entry back and nothing else (ARENA_MIN_ENTRANTS), and a podium on a card
 * too thin to be worth diamonds pays the consolation purse instead
 * (ARENA_PODIUM_MIN_ENTRANTS). It is a parameter rather than a check at the
 * call site precisely so neither can be forgotten at one of the two call
 * sites — the screen's preview and the claim both go through here, and both
 * must reach the same answer.
 *
 * The refund is deliberately **not** run through `scaleRewards`: it is the
 * price that was paid, and the entry costs the same flat ARENA_ENTRY_TURNS at
 * one city as at ten. Scaling it would turn a void card into the single best
 * turn faucet a large empire has.
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
  cities: number,
  entrants: number
): Reward[] {
  // Void card: the ticket back, nothing else, unscaled.
  if (!arenaCardFought(entrants)) {
    return [{ kind: "turns", amount: ARENA_ENTRY_TURNS }];
  }
  const base =
    place >= 1 && place <= ARENA_PODIUM.length && arenaPodiumPays(entrants)
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
  /**
   * `Empire.title` — resolved against the catalog by WornTitle at render time,
   * null for a fighter wearing none. The arena card is a table of at most a
   * handful of rivals from your own city tier, which is the shape a title reads
   * best in.
   */
  title: string | null;
  wins: number;
  losses: number;
  /** 1-based placing; 0 while the card is unresolved. */
  place: number;
  isMe: boolean;
}

export interface ArenaState {
  /** The city tier this arena belongs to — combat never crosses one. */
  tier: number;
  /** Jerusalem day index. */
  day: number;
  /**
   * The viewer's cities, so the screen can quote the podium at *their* curve.
   * Every purse here is written at one city and scaled on payout; a prize table
   * shown at its unscaled figures would understate a city-eight empire's
   * winnings by three orders of magnitude.
   */
  cities: number;
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
  /** Entrants this card needs before it is fought at all. */
  minEntrants: number;
  /**
   * Whether this card has an opponent in it. False means the night is void and
   * the entry turns come back — see ARENA_MIN_ENTRANTS.
   */
  cardFought: boolean;
  /** Entrants this card needs before the podium pays diamonds. */
  podiumMinEntrants: number;
  /** Whether this card is big enough for the podium purses. */
  podiumPays: boolean;

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
