// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { IconName } from "@/components/ui/Icon";
import type { T } from "@/i18n/translate";
import { lastWallTime, nextWallTime, type WallTime } from "./time";

/**
 * מלחמת בריתות — the nightly guild campaign.
 *
 * Every guild may enrol, registration never closes (you always sign up for the
 * *next* bell), and then nobody touches anything. For thirty minutes an evening
 * the game fights the war by itself: once a minute every enrolled guild throws
 * one clash at a rival, the system resolves it with the real battle maths, and
 * the result lands on a live feed the guilds simply watch.
 *
 * Three things follow from it being automatic, and they are the whole design:
 *
 *  - **Nobody can be out-clicked.** A guild's showing depends on the armies,
 *    heroes and guild upgrades it brought, not on who happened to be at a
 *    keyboard at 19:30. Enrolling is the entire act of participation.
 *  - **Size cannot decide it.** Every guild gets exactly one clash per round —
 *    one, whether it holds ten players or one — so a full roster fields no more
 *    attacks than a solo founder. What a bigger roster does give is depth: it
 *    rotates a different member into each round, so the guild is only as strong
 *    as its *average* member. Guild aid follows the same rule below.
 *  - **Nothing is taken.** Clashes plunder nothing, enslave nobody and leave
 *    every hero untouched. They do not even cost turns — the players are not
 *    acting. The only currency is score.
 *
 * It only counts as a war if someone showed up: below GUILD_WAR_MIN_GUILDS
 * entrants the whole night is void and the lone guild is paid nothing. Second
 * place is only worth paying with a real field behind it, hence
 * GUILD_WAR_RUNNER_UP_MIN_GUILDS.
 *
 * This module is pure and client-importable — the page, the live board and the
 * simulation all price the war from here. Server state lives in
 * src/server/guildWarState.ts.
 */

/* ------------------------------ the window ------------------------------ */

/** The bell: 19:30 Jerusalem, every night. */
export const GUILD_WAR_START: WallTime = { hour: 19, minute: 30 };

/** Thirty minutes, ending at 20:00. */
export const GUILD_WAR_DURATION_MINUTES = 30;
export const GUILD_WAR_DURATION_MS = GUILD_WAR_DURATION_MINUTES * 60_000;

/** One clash round a minute, for the whole window. */
export const GUILD_WAR_ROUND_MS = 60_000;
export const GUILD_WAR_ROUNDS = GUILD_WAR_DURATION_MS / GUILD_WAR_ROUND_MS;

/**
 * How long a finished war stays the headline before the screen turns to the
 * next one. Results that vanish the moment the last clash lands are results
 * nobody reads.
 */
export const GUILD_WAR_RESULTS_LINGER_MS = 3 * 3_600_000;

/** Close of the window that opened at `startsAt`. */
export function warEndsAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() + GUILD_WAR_DURATION_MS);
}

/** When round `round` (0-based) is fought. */
export function roundStartsAt(warStartsAt: Date, round: number): Date {
  return new Date(warStartsAt.getTime() + round * GUILD_WAR_ROUND_MS);
}

/**
 * How many rounds have come due by `now` — the target the lazy simulation
 * catches up to. Round 0 fires on the bell itself, so the war opens with a
 * clash rather than a minute of silence.
 */
export function roundsDueBy(warStartsAt: Date, now: Date): number {
  const elapsed = now.getTime() - warStartsAt.getTime();
  if (elapsed < 0) return 0;
  return Math.min(GUILD_WAR_ROUNDS, Math.floor(elapsed / GUILD_WAR_ROUND_MS) + 1);
}

/** The window a war fought at `now` belongs to, or null outside the bell. */
export function liveWarStart(now: Date): Date | null {
  const start = lastWallTime(now, GUILD_WAR_START);
  return now.getTime() < warEndsAt(start).getTime() ? start : null;
}

/**
 * The window registration enrols a guild in: always the next bell that has not
 * rung yet. Registering at 19:45 therefore books tomorrow, not the campaign
 * already under way — you cannot walk into a war that started without you.
 */
export function registrationWarStart(now: Date): Date {
  return nextWallTime(now, GUILD_WAR_START);
}

function clockLabel(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const startMinutes = GUILD_WAR_START.hour * 60 + GUILD_WAR_START.minute;

/** The bell as Jerusalem wall clock, for labels ("19:30"). */
export const GUILD_WAR_START_LABEL = clockLabel(startMinutes);

/** The closing time as Jerusalem wall clock, for labels ("20:00"). */
export const GUILD_WAR_END_LABEL = clockLabel(startMinutes + GUILD_WAR_DURATION_MINUTES);

/* ------------------------------ the field ------------------------------ */

/** Below this many enrolled guilds the war is void — see the header. */
export const GUILD_WAR_MIN_GUILDS = 2;

/** Second place is only paid once the field is this deep. */
export const GUILD_WAR_RUNNER_UP_MIN_GUILDS = 3;

/**
 * Who guild `index` attacks in `round`, as an index into the same guild list.
 * A rotating offset, so over thirty rounds every guild meets every rival
 * repeatedly and no pairing is fixed for the night. Never returns `index`.
 */
export function opponentForRound(
  guildCount: number,
  round: number,
  index: number
): number {
  if (guildCount < 2) return -1;
  const offset = 1 + ((round + index) % (guildCount - 1));
  return (index + offset) % guildCount;
}

/**
 * Which member of a roster fights in `round`. Plain rotation, so a ten-player
 * guild cycles through all ten across the campaign while a one-player guild
 * fields its founder every time — which is exactly what makes a guild score as
 * its average member rather than its headcount. `shift` separates the attacking
 * and defending picks so the same two players do not meet every round.
 */
export function memberForRound(
  memberCount: number,
  round: number,
  shift = 0
): number {
  if (memberCount <= 0) return -1;
  return (round + shift) % memberCount;
}

/** Offset applied to the defending guild's rotation. */
export const GUILD_WAR_DEFENDER_SHIFT = 3;

/**
 * How far a clash can swing on the day, either way (±20%).
 *
 * Without it the campaign is a spreadsheet: nothing varies between rounds
 * except which member rotated in, so a guild that is a few percent stronger
 * than another beats it in *every* clash they share, all thirty rounds, and the
 * weaker guild ends the night on literally zero. That is not a war, and there
 * is no reason to watch it.
 *
 * A fifth either way keeps the stronger guild the clear favourite over thirty
 * rounds — the noise averages out, which is exactly why the campaign is long —
 * while leaving a weaker one able to steal clashes and finish with something to
 * show. Ordinary raids stay deterministic on purpose: there the player picks
 * the fight and deserves to know the answer before spending turns. Here nobody
 * picks anything, so a coin with a heavy thumb on the scale is fairer than a
 * foregone conclusion.
 */
export const GUILD_WAR_SWING = 0.2;

/** Apply the day's swing to one side's power. `roll` is a float in [0, 1). */
export function applySwing(power: number, roll: number): number {
  return power * (1 - GUILD_WAR_SWING + roll * GUILD_WAR_SWING * 2);
}

/* ------------------------------ scoring ------------------------------ */

/**
 * Scale-free worth of a power figure. Empire power spans many orders of
 * magnitude over a season, so a linear points-per-power rule is either
 * meaningless early or unbounded late; the log keeps a clash against a
 * ten-times-stronger empire worth meaningfully — but not absurdly — more.
 *
 *   1K power → 75    1M → 150    1B → 225
 */
export function powerRating(power: number): number {
  return Math.round(Math.log10(Math.max(10, power)) * 25);
}

/** Points a breakthrough scores for the attacking guild. */
export const GUILD_WAR_WIN_BASE = 100;
export function breakthroughPoints(defenderPower: number): number {
  return GUILD_WAR_WIN_BASE + powerRating(defenderPower);
}

/**
 * Points a repelled clash scores for the *defending* guild. Defending is worth
 * less than attacking — a guild cannot win the campaign by being hard to hit —
 * but it is worth something, so stacking defence is a real strategy and the
 * guilds that draw the most attacks are not simply punished for being targets.
 */
export const GUILD_WAR_HOLD_BASE = 55;
export function holdPoints(attackerPower: number): number {
  return GUILD_WAR_HOLD_BASE + Math.round(powerRating(attackerPower) / 2);
}

/** Points the clash scores, and which side banks them. */
export function clashPoints(
  won: boolean,
  attackerPower: number,
  defenderPower: number
): number {
  return won ? breakthroughPoints(defenderPower) : holdPoints(attackerPower);
}

/* ------------------------------ the prizes ------------------------------ */

export interface GuildWarPrize {
  /** 1 = champion. */
  rank: number;
  label: string;
  icon: IconName;
  /** Accent colour for the podium card. */
  tone: string;
  citizens: number;
  turns: number;
  wheelSpins: number;
  /** Only handed out when at least this many guilds actually fought. */
  minGuilds: number;
}

/**
 * Paid to *every member* of the placing guild, in equal share, with no separate
 * purse for anyone. Nobody played the war — the guild's armies, heroes and
 * upgrades did — so there is no individual performance to single out, and a
 * prize that singled one out anyway would punish everyone who was at dinner.
 *
 * Deliberately paid in citizens, turns and spins rather than gold or diamonds.
 * Gold is plunderable and diamonds are the paid currency, so a nightly purse of
 * either would either evaporate on the next raid or undercut the store. These
 * three are *capacity*: citizens become soldiers, turns become attacks and
 * spins become another pull — the winning guild is paid in the ability to field
 * a stronger army tomorrow, which is the thing the campaign is measuring.
 */
export const GUILD_WAR_PRIZES: readonly GuildWarPrize[] = [
  {
    rank: 1,
    label: "אלופת המלחמה",
    icon: "crown",
    tone: "#e4c35a",
    citizens: 500,
    turns: 300,
    wheelSpins: 5,
    minGuilds: GUILD_WAR_MIN_GUILDS,
  },
  {
    rank: 2,
    label: "סגנית האלופה",
    icon: "achievements",
    tone: "#c0c8d4",
    citizens: 175,
    turns: 100,
    wheelSpins: 2,
    minGuilds: GUILD_WAR_RUNNER_UP_MIN_GUILDS,
  },
];

/**
 * The prize a placement earns given how deep the field was — null when the
 * rank is unpaid at that size (second place in a two-guild war) or off the
 * podium entirely.
 */
export function prizeForRank(rank: number, guildCount: number): GuildWarPrize | null {
  const prize = GUILD_WAR_PRIZES.find((p) => p.rank === rank);
  if (!prize || guildCount < prize.minGuilds) return null;
  return prize;
}

/**
 * One-line prize summary, snapshotted onto the entry at settlement.
 *
 * Takes the translator because the snapshot is written in the *reader's*
 * language at the moment it settles, and because Hebrew counts one spin
 * differently — "1 סיבובי גלגל" reads as a bug.
 */
export function prizeSummary(t: T, prize: GuildWarPrize): string {
  return [
    t("{count} אזרחים", { count: prize.citizens.toLocaleString("en-US") }),
    t("{count} תורות", { count: prize.turns.toLocaleString("en-US") }),
    prize.wheelSpins === 1
      ? t("סיבוב גלגל אחד")
      : t("{count} סיבובי גלגל", { count: prize.wheelSpins }),
  ].join(" · ");
}

/* ------------------------------ phases ------------------------------ */

/**
 * What the screen is showing.
 *  - REGISTRATION: the bell has not rung; guilds are still enrolling.
 *  - LIVE: the system is fighting rounds right now.
 *  - SETTLING: the window closed but the result has not been written yet
 *    (settlement is lazy — the very next reader does it).
 *  - SETTLED / CANCELLED: the night is over, with or without a champion.
 */
export type GuildWarPhase =
  | "REGISTRATION"
  | "LIVE"
  | "SETTLING"
  | "SETTLED"
  | "CANCELLED";

export const GUILD_WAR_PHASE_LABEL: Record<GuildWarPhase, string> = {
  REGISTRATION: "ההרשמה פתוחה",
  LIVE: "הקרב בעיצומו",
  SETTLING: "סופרים את הנקודות",
  SETTLED: "המלחמה הוכרעה",
  CANCELLED: "המלחמה בוטלה",
};

/* ------------------------------ live DTOs ------------------------------ */

/** One guild's row on the live scoreboard. */
export interface GuildWarScoreRow {
  guildId: string;
  guildName: string;
  /**
   * The guild's combined military power — the *only* strength figure the war
   * publishes, and the level the whole board reports at.
   *
   * The feed used to print each clash as "1.2M מול 900K" beside the two
   * fighters' names. Those are the hero- and spell-multiplied numbers, per
   * player, refreshed every minute for thirty minutes — finer intelligence than
   * the rankings ladder gives away and finer than a paid spy mission returns on
   * a single target, handed free to every viewer for every enrolled guild. A
   * guild total leaks nothing: guild rosters are public and every member's
   * military power is already on the ladder.
   */
  power: number;
  score: number;
  /** Clashes won on either side. */
  wins: number;
  losses: number;
  rank: number;
  /** Set once the war is settled. */
  rewardLabel: string | null;
  /** This is the viewer's own guild. */
  mine: boolean;
}

/** One clash in the live feed. */
export interface GuildWarFeedItem {
  id: string;
  round: number;
  attackerName: string;
  /** Both fighters' ids travel so the feed can link each name to its dossier. */
  attackerEmpireId: string;
  attackerGuildName: string;
  attackerGuildId: string;
  defenderName: string;
  defenderEmpireId: string;
  defenderGuildName: string;
  defenderGuildId: string;
  // No per-fighter power here — see GuildWarScoreRow.power. The clash rows keep
  // both figures (they are what resolved the fight and belong in the record);
  // they simply do not travel to the client.
  won: boolean;
  points: number;
  /** Epoch ms — the client renders the clock, never the server's string. */
  at: number;
  /** The viewer's own guild was involved. */
  mine: boolean;
}

/** A fighter on the personal board — who the war put to work, and how it went. */
export interface GuildWarFighterRow {
  empireId: string;
  name: string;
  /**
   * `Empire.title`, filled in after the board is cut to FIGHTER_LIMIT — see the
   * lookup in server/guildWarState.ts. Null both for a fighter wearing none and
   * for one whose empire is gone; the row's name is denormalised onto the clash
   * and outlives the account.
   */
  title: string | null;
  guildName: string;
  /**
   * The guild the fighter fought for, so the board's ברית column opens its hall
   * like every other guild name in the game. Null when the clash rows name a
   * guild that is not enrolled in this war any more — the name is denormalised
   * onto the clash and outlives the entry, exactly like the fighter's own name
   * outlives his account, and GuildLink degrades those to plain text.
   */
  guildId: string | null;
  points: number;
  wins: number;
  holds: number;
  /** This is the viewer. */
  me: boolean;
}

/**
 * Everything the war board redraws on a poll, in one flat object — so the
 * scoreboard, the feed and the fighter table can never disagree about who is
 * winning.
 */
export interface GuildWarLiveState {
  /** Null when no war row exists yet for the upcoming bell. */
  warId: string | null;
  phase: GuildWarPhase;
  /** Epoch ms. */
  startsAt: number;
  endsAt: number;
  serverNow: number;
  /** Rounds fought so far, out of GUILD_WAR_ROUNDS. */
  round: number;
  /** Guilds enrolled in the war being shown. */
  guildCount: number;
  /** True once enough guilds enrolled for the night to count. */
  valid: boolean;
  scoreboard: GuildWarScoreRow[];
  feed: GuildWarFeedItem[];
  fighters: GuildWarFighterRow[];
  /** The viewer's guild, if it is enrolled in this war. */
  myGuildId: string | null;
  myGuildName: string | null;
}

/**
 * How often the board re-asks the server. Rounds land a minute apart, so the
 * poll only has to be fast enough that a clash never feels stale.
 */
export function livePollMs(phase: GuildWarPhase): number {
  return phase === "LIVE" ? 6_000 : 25_000;
}
