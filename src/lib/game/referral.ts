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
 * ## Two ways in, one link
 *
 * Every account owns an opaque invite code (`User.referralCode`), and the thing
 * a player actually hands out is the URL built from it — `/r/<code>`. Opening
 * it parks the code in a short-lived cookie and drops the visitor on the sign-up
 * form; the link is attached the moment their empire is founded, whether they
 * register with a password or with Google. Nothing is asked of them on the form
 * itself, which is the most abandoned screen in any game and no place for a
 * field that is not needed to play.
 *
 * The older path is kept beside it: the referrals screen still takes a code —
 * or an empire name — typed in by hand, for the friend who was told about the
 * game before they were sent a link. It stays open only while the newcomer is
 * small (REFERRAL_NAME_MAX_CITIES) so an established player cannot shop their
 * loyalty around.
 *
 * The code lives on the **User** rather than the empire because a season restart
 * deletes every empire, and a link already posted in a Discord channel has to
 * keep working across that.
 *
 * ## Nothing is paid for a signup
 *
 * Both halves are gated on the newcomer reaching REFERRAL_GOAL_CITIES, checked
 * against their **live** city count. A sign-up bounty rewards creating accounts;
 * this rewards a player who was still there days later, which is the only
 * version of the loop that is not a farm. It is also the defence that does not
 * depend on detecting anything: three cities is real play, so a pair of accounts
 * farming this are doing a week of work for one purse.
 *
 * ## What the checks add on top
 *
 * A link is far easier to farm than a typed-in name — the second account never
 * has to know anything — so the payout runs through a review (see
 * src/server/referralGuard.ts, which owns the signals catalogued below).
 *
 * The split that matters is between signals that *identify one person* and
 * signals that merely *co-locate two people*:
 *
 *  - A **hard** signal refuses the link outright. Naming yourself, a ring, a
 *    referrer who is staff, a bot or banned, two addresses that normalise to one
 *    mailbox, and — the sharp one — two accounts signed into from the same
 *    browser profile. None of those has an innocent reading.
 *  - A **soft** signal holds the payout for an admin and does nothing else. A
 *    shared IP address is a household, a dorm, an office or a carrier's NAT
 *    before it is ever a farm; brothers inviting each other is the single most
 *    common *real* referral there is. Blocking on it would cost more honest
 *    referrals than it would stop farms, so it buys a human look instead.
 *
 * Two more bounds sit outside the signal list: REFERRAL_BURST_LIMIT caps how
 * many invitees may attach to one referrer in a day before the queue wants eyes
 * on it, and REFERRAL_SEASON_CAP caps how many referrer purses one player can
 * ever be paid in a season, so no amount of undetected farming is unbounded.
 *
 * ## The link does not survive a season restart, and that is deliberate
 *
 * A restart deletes and re-creates every empire (see server/seasonRestart.ts),
 * so `referredById` — which points at an empire id — cannot be carried across
 * even in principle without mapping old ids to new ones. It is left to reset,
 * and the reading that falls out of that is the right one: a new season is a
 * new world, and *bringing a lapsed friend back for it* is exactly the
 * behaviour worth paying for again. The invite *code* is on the User and does
 * survive, so the link a player printed on a banner keeps working.
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
 * The most referrer purses one player can be paid in a single season.
 *
 * Not a fraud check — the signals do that — but the bound that survives every
 * fraud check failing. Twenty-five invitees who each played to three cities is
 * a genuinely extraordinary recruiting run and far beyond anything the game has
 * seen; what the cap actually buys is that *no* undetected scheme, however
 * clever, can mint diamonds without limit. A player who hits it has earned a
 * conversation, not a silent faucet.
 *
 * Counted over paid receipts in the current season only, so it resets with the
 * world.
 */
export const REFERRAL_SEASON_CAP = 25;

/**
 * How many invitees may attach to one referrer inside REFERRAL_BURST_WINDOW_MS
 * before the rest are held for review.
 *
 * Five in a day is a person who posted their link in a group chat — plausible
 * and welcome. Fifty is a script. The window is a day rather than an hour
 * because the honest version of this arrives in one evening's clump, and an
 * hourly limit would hold most of a successful post.
 */
export const REFERRAL_BURST_LIMIT = 5;
export const REFERRAL_BURST_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ------------------------------ the code ------------------------------ */

/**
 * The invite code's alphabet: Crockford base32 — digits and upper-case letters
 * with `I`, `L`, `O` and `U` removed.
 *
 * A code is read off a screen and typed into a phone at least as often as it is
 * clicked, so the characters that collide when read aloud or in a condensed font
 * (1/I/L, 0/O) must not both exist. `U` is dropped so no accidental English
 * obscenity can be generated. Lower case is accepted on input and folded up —
 * see `normalizeReferralCode`.
 */
export const REFERRAL_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Twelve symbols out of 32 is 60 bits.
 *
 * The number that matters is not "how long until someone guesses a code" but
 * "can `/r/<code>` be swept to enumerate the player base". At 60 bits it cannot,
 * by an enormous margin, which is what lets that route answer without a
 * CAPTCHA — the per-IP throttle on it is belt and braces.
 */
export const REFERRAL_CODE_LENGTH = 12;

/** Path of the invite link for a code. The absolute URL is built server-side. */
export function referralPath(code: string): string {
  return `/r/${code}`;
}

/**
 * Fold whatever the player pasted into the canonical code, or null.
 *
 * Deliberately generous about the wrapper: people paste the whole URL, they
 * paste it with the query string a chat app appended, they type it with spaces
 * or dashes, and phone keyboards capitalise the first letter of everything. All
 * of that resolves; anything left over that is not exactly the code shape does
 * not, and falls through to the empire-name lookup instead.
 */
export function normalizeReferralCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Take the last path segment of a pasted link, before any ?query or #hash.
  const tail = trimmed.split(/[?#]/)[0]!.replace(/\/+$/, "").split("/").pop() ?? "";
  const folded = tail.toUpperCase().replace(/[\s-]/g, "");
  if (folded.length !== REFERRAL_CODE_LENGTH) return null;
  for (const ch of folded) {
    if (!REFERRAL_CODE_ALPHABET.includes(ch)) return null;
  }
  return folded;
}

/**
 * Reduce an address to the mailbox it actually reaches, for the one check that
 * catches the laziest alt of all: `me+alt@gmail.com` inviting `me@gmail.com`.
 *
 * Gmail (and the Google Workspace domains that inherit its rules) ignores dots
 * in the local part and everything from a `+` onwards, so those three addresses
 * are one inbox while being three distinct values in a `UNIQUE` column. Every
 * other provider gets the `+` tag stripped — near-universal, and a false match
 * there would need someone to own both `a@x.com` and `a+b@x.com` as separate
 * accounts, which is the very thing being looked for — but keeps its dots,
 * because plenty of hosts treat `a.b@` and `ab@` as different people.
 *
 * Returns null for anything that is not shaped like an address, so a missing or
 * malformed value never matches another missing one.
 */
export function normalizeMailbox(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at <= 0 || at === email.trim().length - 1) return null;
  const lowered = email.trim().toLowerCase();
  let local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GOOGLE_MAIL_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  if (local === "") return null;
  return `${local}@${domain}`;
}

/** Domains whose local part ignores dots. Google's, and its two aliases. */
const GOOGLE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/* ------------------------------ the signals ------------------------------ */

/**
 * Everything the guard can notice about a referral. Stored on the newcomer's
 * row as strings and re-derived at every payout attempt, so the admin queue
 * shows what is true now.
 */
export type ReferralFlag =
  /** The two sides are the same account. */
  | "self"
  /** The referrer is downstream of the newcomer — a ring. */
  | "cycle"
  /** The referrer is staff, a garrison bot, or banned: not a recruiter. */
  | "ineligible"
  /** Both accounts have been signed into from the same browser profile. */
  | "device"
  /** Both addresses normalise to one mailbox (dots / `+tag`). */
  | "mailbox"
  /** The two accounts share a registration or last-login address. */
  | "shared_ip"
  /** More than REFERRAL_BURST_LIMIT invitees attached to this referrer today. */
  | "burst"
  /** The pair have fought, spied or sabotaged each other. */
  | "combat";

/**
 * The signals that refuse a referral outright rather than holding it.
 *
 * Every one of them identifies *one person on both sides*; none has a reading
 * where two different players are involved. That is the whole test for
 * membership here — a signal that merely puts two people in the same building
 * belongs in the soft list, where a human decides.
 */
export const REFERRAL_HARD_FLAGS: readonly ReferralFlag[] = [
  "self",
  "cycle",
  "ineligible",
  "device",
  "mailbox",
];

export function isHardReferralFlag(flag: ReferralFlag): boolean {
  return REFERRAL_HARD_FLAGS.includes(flag);
}

/** Short label for the admin queue. */
export const REFERRAL_FLAG_LABEL: Record<ReferralFlag, string> = {
  self: "אותו חשבון",
  cycle: "מעגל הזמנות",
  ineligible: "מזמין לא כשיר",
  device: "אותו דפדפן",
  mailbox: "אותה תיבת דואר",
  shared_ip: "כתובת IP משותפת",
  burst: "ריבוי הזמנות ביום אחד",
  combat: "קרבות בין השניים",
};

/** What the admin needs to know to judge it. */
export const REFERRAL_FLAG_DETAIL: Record<ReferralFlag, string> = {
  self: "המזמין והמוזמן הם אותו משתמש.",
  cycle: "המזמין הוזמן בעצמו, במישרין או בעקיפין, על ידי המוזמן.",
  ineligible: "המזמין הוא חשבון צוות, בוט או חשבון חסום.",
  device:
    "שני החשבונות נכנסו למשחק מאותו פרופיל דפדפן. זה הסימן החזק ביותר לחשבון שני של אותו אדם.",
  mailbox:
    "שתי כתובות הדוא״ל מגיעות לאותה תיבה (נקודות או ‎+תווית ב-Gmail).",
  shared_ip:
    "שני החשבונות נרשמו או התחברו מאותה כתובת IP. זה גם המצב של אחים, שותפים לדירה, משרד או רשת סלולרית — ולכן זה מגיע לבדיקה ולא לחסימה.",
  burst:
    "יותר מ-" +
    REFERRAL_BURST_LIMIT +
    " מוזמנים נקשרו למזמין הזה ביממה האחרונה. יכול להיות פוסט מוצלח בקבוצה, ויכול להיות סקריפט.",
  combat:
    "השניים תקפו, ריגלו או חיבלו זה בזה. שחקנים אמיתיים עושים את זה, אבל זו גם הדרך להעביר משאבים בין שני חשבונות של אותו אדם.",
};

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

/**
 * How a referral stands with the review, in the words the players see.
 *
 * A deliberately narrower vocabulary than the `ReferralReview` column: the
 * database distinguishes "never flagged" from "an admin approved it", and the
 * screen has no business doing so — both simply pay. What the player is told is
 * only ever one of three things, and the *reason* for a hold is never shown.
 * Naming the signal would turn the screen into a tester for the checks
 * ("switch to mobile data and try again"), which is exactly what it must not
 * be.
 */
export type ReferralStanding = "ok" | "held" | "rejected";

/** One empire this player brought in. */
export interface ReferralInvitee {
  empireId: string;
  empireName: string;
  cities: number;
  /** Reached the goal — nothing else stands in the way of the city count. */
  earned: boolean;
  /** Already collected by the referrer. */
  claimed: boolean;
  standing: ReferralStanding;
}

export interface ReferralState {
  /** This player's invite code, and the link built from it. */
  code: string;
  link: string;

  /* ---- as a referrer ---- */
  invitees: ReferralInvitee[];
  /** Invitees who have reached the goal, cleared review, and are uncollected. */
  collectable: number;
  /** What one collected referral pays this player. */
  referrerReward: Reward[];
  /** Purses already collected this season, against the ceiling. */
  paidThisSeason: number;
  seasonCap: number;

  /* ---- as a newcomer ---- */
  /** The empire that brought this player in, if there is one. */
  referrerName: string | null;
  /** Where the newcomer's own half stands with the review. */
  standing: ReferralStanding;
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

/* --------------------------- the admin's view --------------------------- */

/** One side of a referral, as the review queue prints it. */
export interface ReferralParty {
  empireId: string;
  empireName: string;
  cities: number;
  /** Account address. Admin-only, and the reason this type is not the player's. */
  email: string;
  signupIp: string | null;
  lastLoginIp: string | null;
  joinedAt: Date;
  banned: boolean;
}

/**
 * One referral awaiting (or having received) a decision.
 *
 * Deliberately carries the *evidence* rather than a verdict: emails, addresses,
 * both sides' progress and the signals that fired, so the admin is deciding from
 * what the checks saw instead of from what they concluded. The queue is small by
 * construction — only flagged referrals reach it — so there is room to show all
 * of it.
 */
export interface ReferralCase {
  joiner: ReferralParty;
  referrer: ReferralParty;
  flags: ReferralFlag[];
  via: string | null;
  referredAt: Date | null;
  review: "OK" | "HELD" | "APPROVED" | "REJECTED";
  reviewedAt: Date | null;
  /** Whether each half has already been collected. */
  joinerPaid: boolean;
  referrerPaid: boolean;
  /** The newcomer has reached the goal, so a decision unblocks money today. */
  earned: boolean;
}

/** Map the stored review state onto what the two screens are allowed to say. */
export function referralStanding(
  review: "OK" | "HELD" | "APPROVED" | "REJECTED"
): ReferralStanding {
  switch (review) {
    case "HELD":
      return "held";
    case "REJECTED":
      return "rejected";
    default:
      return "ok";
  }
}

/** Whether a referral in this state may be paid. */
export function referralPayable(
  review: "OK" | "HELD" | "APPROVED" | "REJECTED"
): boolean {
  return review === "OK" || review === "APPROVED";
}
