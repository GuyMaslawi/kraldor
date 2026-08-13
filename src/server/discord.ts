import "server-only";
import { parseDiscordInvite } from "@/lib/community";
import { logError } from "@/server/errorLog";
import { appBaseUrl } from "@/server/mailer";

/**
 * The game's side of the Discord channel: where the invite lives, and how the
 * server speaks into the room.
 *
 * Independent environment variables, because they are separate decisions and
 * any one of them may be made first:
 *
 *   DISCORD_URL                   the public invite — https://discord.gg/xxxxxxx
 *   DISCORD_WEBHOOK_URL_EVENTS    webhook for what happens *in* the game
 *   DISCORD_WEBHOOK_URL_UPDATES   webhook for news *about* the game
 *   DISCORD_WEBHOOK_URL_SUPPORT   webhook for somebody waiting at the door
 *
 * All are optional and all fail closed. With none set the site simply has no
 * community channel: every link is hidden, nothing is posted anywhere, and no
 * code path changes behaviour. That is deliberate — the channel is being built
 * by somebody else, and the site had to be ready before it exists.
 *
 * Deliberately *not* `NEXT_PUBLIC_`. A NEXT_PUBLIC value is inlined into the
 * browser bundle at build time, which would make the invite a build-time
 * constant and put the webhook one careless import away from the client. These
 * are read per request on the server and the invite reaches client components
 * as a plain prop.
 */

/** The configured invite, or null while the channel is still being built. */
export function discordInviteUrl(): string | null {
  return parseDiscordInvite(process.env.DISCORD_URL);
}

/**
 * The two rooms the game speaks into.
 *
 *   "events"  — what happens *inside* the game, on the clock: a Happy Hour
 *               opening, a mini-game released, a war settling, a season
 *               starting or ending, a game-wide gift. Time-critical: read late
 *               is read too late.
 *   "updates" — news *about* the game: what was built, what changed, what is
 *               coming. Nothing in it expires.
 *
 *   "support" — somebody is stuck in front of the login screen and has written
 *               to us (see server/actions/support.ts). Not news at all: it is a
 *               work queue, read by whoever is on duty, and it is the only one
 *               of the three that should be *noisy* — an unanswered ticket is a
 *               player who never got into the game.
 *
 * Separate rooms rather than one because they are read differently. Someone who
 * muted a channel that fires every Happy Hour must still hear that the game got
 * a new feature, and neither of those should bury a person asking for help; a
 * single feed forces one decision on all three.
 */
export type DiscordChannel = "events" | "updates" | "support";

const CHANNEL_ENV: Record<DiscordChannel, string> = {
  events: "DISCORD_WEBHOOK_URL_EVENTS",
  updates: "DISCORD_WEBHOOK_URL_UPDATES",
  support: "DISCORD_WEBHOOK_URL_SUPPORT",
};

/**
 * Discord's own webhook endpoints, and nothing else.
 *
 * The announcer posts game state — season podiums, war results, broadcast text
 * — so a mistyped or hostile value would be an outbound feed of the game's
 * events to an arbitrary host, chosen by whatever wrote the environment. Pinning
 * the host keeps a typo from becoming that.
 *
 * There is no fallback to the single `DISCORD_WEBHOOK_URL` this replaced — that
 * webhook is retired, and a channel whose own variable is unset is simply not
 * configured. Falling back would quietly resurrect a dead room's URL and post
 * the game's news somewhere nobody is reading.
 */
function webhookUrl(channel: DiscordChannel): string | null {
  // Never from a test run. The DB suite calls the real `closeSeason` two dozen
  // times per `npm run test:db`, and importing `@/lib/prisma` loads `.env` into
  // process.env as a side effect — so without this line every test run posts
  // twenty "the season is over" announcements into the players' channel. Vitest
  // sets VITEST in every worker; nothing in dev or production does.
  if (process.env.VITEST) return null;

  const raw = process.env[CHANNEL_ENV[channel]]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host !== "discord.com" && host !== "discordapp.com" && host !== "ptb.discord.com") {
      return null;
    }
    if (!url.pathname.startsWith("/api/webhooks/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Is that room wired up — used by the admin screens to say so. */
export function isDiscordAnnouncerConfigured(channel: DiscordChannel): boolean {
  return webhookUrl(channel) !== null;
}

/** The stripe down the side of the embed, by what is being announced. */
const COLORS = {
  /** Antique gold — the game's own colour, for plain announcements. */
  announcement: 0xc4a032,
  /** Golden hour: it is loud on the site, it is loud here. */
  event: 0xe8850c,
  /** War results. */
  war: 0xb02a37,
  /** A season closing — the rarest post the channel will ever get. */
  season: 0x8a5cd6,
  /** Somebody needs help. Cool blue: it is a queue, not a celebration. */
  support: 0x2d7ff9,
} as const;

export type AnnouncementKind = keyof typeof COLORS;

export interface Announcement {
  kind: AnnouncementKind;
  /**
   * Which room this belongs in. Stated at every call site rather than inferred
   * from `kind`: the colour of the stripe and the audience of the post are two
   * different questions, and a wrong guess here puts a changelog in the room
   * people opened for Happy Hours.
   */
  channel: DiscordChannel;
  title: string;
  body: string;
  /** Where to read more — a link back into the game. */
  url?: string | null;
}

/** Discord's own ceilings; over them the whole POST is rejected with a 400. */
const TITLE_MAX = 256;
const BODY_MAX = 4000;

function clamp(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Post one announcement to the channel. Never throws, never blocks the caller's
 * outcome.
 *
 * Everything about this is defensive on purpose: it is called from the tail of
 * an admin action, a war settlement and a season close — work that has already
 * succeeded and been committed by the time we get here. A Discord outage, a
 * revoked webhook or a slow network must not turn a completed season close into
 * an error on somebody's page load, so every failure is swallowed into the
 * error log and the caller is told nothing.
 *
 * Two details that are not decoration:
 *
 *  - `allowed_mentions: { parse: [] }`. An admin broadcast is free text, and a
 *    broadcast containing "@everyone" would otherwise ping an entire Discord
 *    server from a game form — a megaphone nobody meant to hand out. Mentions
 *    are stripped of their power; the text still reads as written.
 *  - A hard timeout. Without one an unresponsive webhook host holds the request
 *    open for as long as it feels like.
 *
 * Callers must invoke this **outside** any database transaction. A network call
 * inside one holds a connection open for the length of someone else's outage.
 */
export async function announceToDiscord(announcement: Announcement): Promise<boolean> {
  const url = webhookUrl(announcement.channel);
  if (!url) return false;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // i18n-exempt: the webhook's author name. A Discord post lands in one
        // channel with many readers and one language, not in a reader's session.
        username: "קראלדור",
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: clamp(announcement.title, TITLE_MAX),
            description: clamp(announcement.body, BODY_MAX),
            url: announcement.url || undefined,
            color: COLORS[announcement.kind],
          },
        ],
      }),
      signal: AbortSignal.timeout(5_000),
      // Nothing about a webhook POST is cacheable, and Next will happily try.
      cache: "no-store",
    });
    if (!response.ok) {
      // The channel goes in the log key: with two webhooks live, "the announcer
      // is broken" is not actionable until you know which room went silent.
      await logError(
        `discord.announce.${announcement.channel}`,
        new Error(`webhook responded ${response.status}`)
      );
      return false;
    }
    return true;
  } catch (err) {
    // Includes the timeout: an AbortError here means Discord did not answer in
    // five seconds, which is not the game's problem to escalate.
    await logError(`discord.announce.${announcement.channel}`, err);
    return false;
  }
}

/**
 * Absolute link back into the game, for the "read more" on an embed.
 *
 * Discord will not linkify a relative path, and the announcement is read
 * somewhere that has no idea what host the game runs on. Shares `appBaseUrl`
 * with the mailer — the same question, already answered there, and answered
 * without trusting the request's Host header.
 */
export function gameLink(path: string): string | undefined {
  try {
    return new URL(path, appBaseUrl()).toString();
  } catch {
    return undefined;
  }
}
