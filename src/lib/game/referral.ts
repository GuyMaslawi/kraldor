import { MAX_CITIES } from "./constants";
import { scaleRewards, type Reward } from "./rewards";

/**
 * הזמנת חבר — the one growth loop the game can run without a budget.
 *
 * Everything else built around the daily board keeps the players who are
 * already here. This is the only feature that brings new ones, and it matters
 * most in exactly the period the game is in now: before the payment gateway
 * opens, a player recruited by a friend costs nothing and is worth as much as
 * one bought with advertising.
 *
 * ## Why it is claimed in-game rather than at registration
 *
 * The obvious design puts a "who invited you" field on the sign-up form. This
 * one puts it on a page inside the game, open for the newcomer's first few
 * cities. Three reasons, and the third is the important one:
 *
 *  - Registration is the most abandoned screen in any game; a field that is not
 *    needed to play does not belong on it.
 *  - The referrer's name is the code, so nothing has to be generated,
 *    distributed, or looked up — "tell them my empire is called X" is the whole
 *    mechanism.
 *  - **A referral that is claimed after the newcomer has played is worth
 *    something.** A sign-up field rewards creating accounts; this rewards a
 *    player who is still there at their third city (see REFERRAL_GOAL_CITIES),
 *    which is the only version of the loop that is not a farm.
 *
 * ## What stops it being farmed anyway
 *
 * The reward is gated on the *newcomer's* progress, not on their existence, and
 * three cities is real play — days of it. On top of that, the naming itself is
 * bounded: it can be done once, only while the newcomer is still small
 * (REFERRAL_NAME_MAX_CITIES), never for a staff account or a garrison bot, and
 * never in a circle. The remaining exposure — somebody playing two accounts to
 * three cities each — is a great deal of work for one purse, which is the
 * design's real defence rather than any check.
 *
 * ## The link does not survive a season restart, and that is deliberate
 *
 * A restart deletes and re-creates every empire (see server/seasonRestart.ts),
 * so `referredById` — which points at an empire id — cannot be carried across
 * even in principle without mapping old ids to new ones. It is left to reset,
 * and the reading that falls out of that is the right one: a new season is a
 * new world, and *bringing a lapsed friend back for it* is exactly the
 * behaviour worth paying for again.
 *
 * The cost of that choice is bounded and worth stating plainly: a pair of
 * accounts can earn one referral per season. That is three cities of real play
 * each, every season, for a purse smaller than a few weeks of the muster roll —
 * a worse hourly rate than simply playing, which is the only defence that has
 * ever held.
 */

/* ------------------------------ the deal ------------------------------ */

/**
 * Cities the newcomer must reach before either side is paid.
 *
 * Three, not one. Founding a second city is the tutorial's last step and a bot
 * could do it; a third is a real player who came back. Deliberately checked
 * against the *live* city count rather than a stamp, so a referral is never
 * owed for an account that was abandoned on the way there.
 */
export const REFERRAL_GOAL_CITIES = 3;

/**
 * The newcomer may still name a referrer while they hold this many cities or
 * fewer.
 *
 * The window has to be open long enough that a friend can mention it after the
 * first session, and short enough that an established player cannot shop their
 * loyalty around. Two cities is roughly the first evening.
 */
export const REFERRAL_NAME_MAX_CITIES = 2;

/**
 * What the *referrer* takes, quoted at one city. The larger half: they did the
 * recruiting, and they are the one the loop has to be worth something to.
 */
export const REFERRAL_REFERRER_PURSE: readonly Reward[] = [
  { kind: "diamonds", amount: 75 },
  { kind: "turns", amount: 250 },
  { kind: "gold", amount: 100_000 },
];

/**
 * What the *newcomer* takes. Smaller in diamonds and larger in the things a
 * young empire actually needs — a third-city player has no use for a fortune
 * and every use for turns and people.
 */
export const REFERRAL_JOINER_PURSE: readonly Reward[] = [
  { kind: "diamonds", amount: 50 },
  { kind: "turns", amount: 300 },
  { kind: "citizens", amount: 120 },
];

export function referrerReward(cities: number): Reward[] {
  return scaleRewards(REFERRAL_REFERRER_PURSE, cities);
}

export function joinerReward(cities: number): Reward[] {
  return scaleRewards(REFERRAL_JOINER_PURSE, cities);
}

/**
 * Whether a newcomer's referral has come due.
 *
 * A pure function over the newcomer's live city count, shared by the page and
 * the claim so the button and the payout can never disagree.
 */
export function referralEarned(joinerCities: number): boolean {
  return Math.min(MAX_CITIES, Math.max(0, joinerCities)) >= REFERRAL_GOAL_CITIES;
}

/** Whether an empire is still inside the window for naming a referrer. */
export function mayNameReferrer(cities: number): boolean {
  return Math.max(1, cities) <= REFERRAL_NAME_MAX_CITIES;
}

/* ------------------------------ view model ------------------------------ */

/** One empire this player brought in. */
export interface ReferralInvitee {
  empireId: string;
  empireName: string;
  cities: number;
  /** Reached the goal — the referrer may collect. */
  earned: boolean;
  /** Already collected by the referrer. */
  claimed: boolean;
}

export interface ReferralState {
  /** The player's own empire name — the code they hand out. */
  code: string;

  /* ---- as a referrer ---- */
  invitees: ReferralInvitee[];
  /** Invitees who have reached the goal and are uncollected. */
  collectable: number;
  /** What one collected referral pays this player. */
  referrerReward: Reward[];

  /* ---- as a newcomer ---- */
  /** The empire that brought this player in, if they named one. */
  referrerName: string | null;
  /** The naming window is still open and nobody has been named. */
  mayName: boolean;
  /** The newcomer's own half is due and uncollected. */
  joinerClaimable: boolean;
  /** The newcomer's own half has been collected. */
  joinerClaimed: boolean;
  joinerReward: Reward[];
  /** How far this player is towards their own half. */
  cities: number;
  goalCities: number;
}
