/**
 * Live chat: limits, and the two pure functions the pane and the action both
 * need. Kept out of the action module because a `"use server"` file may only
 * export async functions — the composer needs the length cap at render time.
 */

import type { T } from "@/i18n/translate";
import { botOnline } from "./bots";
import { clampChars, stripInvisible } from "./text";

/** Longest single line. A chat line is a shout, not a letter — the inbox
 *  (MESSAGE_BODY_MAX = 1000) is where long-form belongs. */
export const CHAT_BODY_MAX = 300;

/** How many lines the pane holds. Also the tail size the server sends on open. */
export const CHAT_PAGE_SIZE = 60;

/** Longest transcript a private thread ships in one go. */
export const CHAT_THREAD_PAGE_SIZE = 80;

/** Most private conversations listed. Bounds the thread-list query. */
export const CHAT_THREAD_LIST_MAX = 30;

/**
 * Two budgets on the public room, because they bound different things.
 *
 * BURST is what a human types: four lines in ten seconds is a fast
 * conversation, and anything above it is a paste loop. It fails fast and cheap.
 *
 * SUSTAINED is the one that stops a room being drowned over a minute — a
 * scripted sender staying just under the burst cap still hits it.
 */
export const CHAT_BURST_LIMIT = 4;
export const CHAT_BURST_WINDOW_MS = 10 * 1000;

export const CHAT_GLOBAL_LIMIT = 15;
export const CHAT_GLOBAL_WINDOW_MS = 60 * 1000;

/**
 * Private lines are cheaper to allow (a conversation is faster than a room) but
 * the per-partner budget matters more: the volume cap alone lets a whole minute
 * be aimed at one player, which is the harassment case rather than the spam one.
 */
export const CHAT_DIRECT_LIMIT = 30;
export const CHAT_DIRECT_WINDOW_MS = 60 * 1000;

export const CHAT_PAIR_LIMIT = 20;
export const CHAT_PAIR_WINDOW_MS = 60 * 1000;

/** How long a just-sent line blocks an identical repeat (see isRepeat). */
export const CHAT_REPEAT_WINDOW_MS = 30 * 1000;

/** Minimum characters in a searched name before the roster is queried. */
export const CHAT_SEARCH_MIN = 2;
export const CHAT_SEARCH_MAX_RESULTS = 12;

/** Players listed in the "start a conversation" roster, most recently seen
 *  first. Bounded because the roster is a polled query on a table that grows
 *  with the player base — the search box is how you reach anyone past it. */
export const CHAT_ROSTER_MAX = 50;

/**
 * How long after the last heartbeat a player still counts as online.
 *
 * It has to outlast the slowest poll by a wide margin. The dock beats every 25
 * seconds while shut, but a browser that is throttling background timers (or a
 * player reading one long page) can stretch that, and a dot that blinks off
 * while someone is mid-sentence is worse than one that lingers a minute.
 */
export const PRESENCE_ONLINE_MS = 3 * 60 * 1000;

/**
 * How stale the heartbeat must be before a poll bothers to write it again.
 *
 * The write is a guarded `updateMany` whose WHERE usually matches nothing, so
 * the common case is an index probe rather than a row update: every player
 * online costs one real write every 90 seconds, not one per poll.
 */
export const PRESENCE_TOUCH_MS = 90 * 1000;

/**
 * How long a typing marker stays true after the last keystroke that refreshed
 * it. Comfortably longer than the poll interval on purpose: at a shorter TTL the
 * indicator would blink out between two polls of someone who is still typing.
 */
export const TYPING_TTL_MS = 9 * 1000;

/** How often a typing player refreshes their marker while they keep typing. */
export const TYPING_PING_MS = 3 * 1000;

/**
 * Budget on the typing marker, which was the one write path in the chat with no
 * budget at all.
 *
 * The composer refreshes at most once every TYPING_PING_MS, so a player who
 * never stops typing spends 20 a minute; a script spent as many as it liked, and
 * each one costs a name lookup plus an upsert. Generous enough that no real
 * keyboard reaches it, tight enough that the marker cannot be used as a write
 * amplifier. Failing this is silent — see `setTyping`.
 */
export const TYPING_LIMIT = 40;
export const TYPING_WINDOW_MS = 60 * 1000;

/**
 * Longest id the chat will look at.
 *
 * Empire ids are cuids (25 chars); 64 leaves room for a format change without
 * letting an unbounded string reach a query — or, in `ChatTyping.toEmpireId`,
 * a column with no foreign key behind it, where a 4KB "addressee" was being
 * stored verbatim.
 */
export const CHAT_ID_MAX = 64;

/**
 * Bounds on the `sinceMs` poll cursor.
 *
 * The client supplies it, so it is attacker-controlled input that goes straight
 * into `new Date()` and from there into a query. NaN, Infinity, a string, an
 * object or anything past the Date range produced an *invalid* Date, which Prisma
 * rejects — turning a poll into a caught exception, an error-log row, and an
 * empty pane. A cursor that does not parse is now simply ignored, which degrades
 * to "send me the tail": exactly what a client with no cursor asks for.
 */
export function parseSinceMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const ms = Math.floor(value);
  // The ECMAScript Date range, and no futures: a cursor ahead of now can only
  // ever match nothing, and is not something an honest client sends.
  if (ms <= 0 || ms > 8.64e15) return undefined;
  return ms;
}

/** Most names the indicator will read out before it starts counting instead. */
const TYPING_MAX_NAMES = 2;

/**
 * The indicator's sentence. Hebrew has gendered verbs and no neutral plural, so
 * this stays with the masculine form the rest of the game uses ("מקליד"), and
 * switches to a count rather than listing a crowd.
 */
export function typingLabel(t: T, names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return t("{name} מקליד…", { name: names[0] });
  if (names.length <= TYPING_MAX_NAMES) {
    return t("{names} מקלידים…", { names: names.join(t(" ו")) });
  }
  return t("{count} שחקנים מקלידים…", { count: names.length });
}

/**
 * Whether an empire shows the green dot: a heartbeat recent enough, or — for a
 * bot — whether it is inside one of its rostered sessions.
 *
 * Takes the row rather than the timestamp so that the bot rule cannot be
 * forgotten at one call site: every surface that draws the dot reads presence
 * through here, and a garrison must never be the one row on the city ladder
 * that is permanently "לא מחובר". A bot has no browser to stamp `lastSeenAt`,
 * so left to the column alone it would advertise itself as a bot on the very
 * board it was planted to populate (see src/lib/bot.ts).
 *
 * It used to answer "always here" for a bot, which was the same mistake from
 * the other side once a season opens with three pages of them — thirty rows lit
 * green at once, permanently, is not what a live city looks like. `botOnline`
 * gives each garrison its own hours instead; see src/lib/game/bots.ts.
 *
 * The row is nullable for callers resolving a name that may no longer exist —
 * a deleted empire reads as away.
 */
export function isOnline(
  empire: { id: string; lastSeenAt: Date | null; isBot: boolean } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!empire) return false;
  if (empire.isBot) return botOnline(empire.id, now);
  if (!empire.lastSeenAt) return false;
  return now.getTime() - empire.lastSeenAt.getTime() < PRESENCE_ONLINE_MS;
}

/**
 * Collapse a submitted line to what actually gets stored.
 *
 * Three separate abuses, all of them layout rather than language:
 * - control characters (a line can carry a `\r` or a zero-width run that
 *   renders as nothing but survives every length check),
 * - newline runs — chat is one line, so a "message" of forty blank rows is a
 *   way to scroll everyone else's pane clean,
 * - long whitespace runs, the same trick sideways.
 *
 * Newlines are kept (a pasted couplet is legitimate) but capped at one break,
 * and the result is hard-truncated: validation rejects an over-long body, so
 * the cut only ever applies to what the collapse itself could not shorten.
 */
export function normalizeChatBody(raw: string): string {
  // The invisible-character strip is shared with the profile blurb — see
  // lib/game/text.ts for what it removes and, more interestingly, what it
  // deliberately keeps.
  const collapsed = stripInvisible(raw)
    .replace(/\r\n?/g, "\n")
    // Three or more breaks (with any spacing between them) become one.
    .replace(/\n[ \t]*(\n[ \t]*)+/g, "\n")
    .replace(/[ \t]{3,}/g, "  ")
    .trim();
  return clampChatBody(collapsed);
}

/**
 * Cut a line to the chat cap, by character rather than by code unit — see
 * `clampChars` for why that distinction is load-bearing. Kept as its own export
 * because the composer imports it by name and calls it on every keystroke.
 */
export function clampChatBody(text: string): string {
  return clampChars(text, CHAT_BODY_MAX);
}

/**
 * Whether a line repeats what the same player just said. Rate limits bound how
 * *often* someone writes; this bounds saying the same thing over and over, which
 * is the shape room spam actually takes and which no per-minute budget catches.
 */
export function isRepeat(
  body: string,
  previous: { body: string; createdAt: Date } | null,
  now: Date
): boolean {
  if (previous === null) return false;
  if (previous.body !== body) return false;
  return now.getTime() - previous.createdAt.getTime() < CHAT_REPEAT_WINDOW_MS;
}

/**
 * Stable key for a two-person conversation, used to label rate-limit buckets
 * and to dedupe threads client-side. Order-independent: A→B and B→A are one
 * conversation, so both sides must resolve to the same string.
 */
export function threadKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
