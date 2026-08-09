import type { T } from "@/i18n/translate";
import {
  DAILY_UPDATE_TIMES,
  GAME_TIMEZONE,
  REGULAR_TICK_MS,
} from "./constants";

interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: GAME_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Wall-clock parts of an instant in Asia/Jerusalem. */
function zonedParts(date: Date): WallParts {
  const parts: Partial<Record<string, number>> = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    // Intl may report midnight as 24 with hour12: false.
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/**
 * Convert an Asia/Jerusalem wall time to a UTC instant, accounting for DST.
 * Iterates on the offset guess until the round-trip matches.
 */
function wallTimeToUtc(wall: Omit<WallParts, "second">): Date {
  const desired = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let ts = desired;
  for (let i = 0; i < 3; i++) {
    const roundTrip = zonedParts(new Date(ts));
    const got = Date.UTC(
      roundTrip.year,
      roundTrip.month - 1,
      roundTrip.day,
      roundTrip.hour,
      roundTrip.minute
    );
    if (got === desired) break;
    ts += desired - got;
  }
  return new Date(ts);
}

/** A Jerusalem wall-clock time of day, e.g. the 19:30 guild-war bell. */
export interface WallTime {
  hour: number;
  minute: number;
}

/** The instant at Jerusalem wall time `wall`, `dayOffset` days from `date`. */
function wallInstantForDay(date: Date, dayOffset: number, wall: WallTime): Date {
  const base = zonedParts(new Date(date.getTime() + dayOffset * 86_400_000));
  return wallTimeToUtc({
    year: base.year,
    month: base.month,
    day: base.day,
    hour: wall.hour,
    minute: wall.minute,
  });
}

/** The daily-update instants for the Jerusalem calendar day containing `date`, shifted by `dayOffset` days. */
function dailyInstantsForDay(date: Date, dayOffset: number): Date[] {
  return DAILY_UPDATE_TIMES.map((wall) => wallInstantForDay(date, dayOffset, wall));
}

/**
 * The first occurrence of Jerusalem wall time `wall` strictly after `after`.
 * Used by fixtures that fire once a day at their own hour rather than on a
 * daily-update boundary — the guild war bell (see src/lib/game/guildWar.ts).
 */
export function nextWallTime(after: Date, wall: WallTime): Date {
  for (let offset = 0; offset < 3; offset++) {
    const instant = wallInstantForDay(after, offset, wall);
    if (instant.getTime() > after.getTime()) return instant;
  }
  // Unreachable: within 2 days the time always comes round.
  return new Date(after.getTime() + 86_400_000);
}

/** The most recent occurrence of Jerusalem wall time `wall` at or before `date`. */
export function lastWallTime(date: Date, wall: WallTime): Date {
  for (let offset = 0; offset >= -2; offset--) {
    const instant = wallInstantForDay(date, offset, wall);
    if (instant.getTime() <= date.getTime()) return instant;
  }
  // Unreachable: within 2 days back the time has always just passed.
  return new Date(date.getTime() - 86_400_000);
}

/**
 * All daily-update instants in the interval (after, until].
 * Bounded to ~2 years of catch-up as a safety net.
 */
export function dailyUpdatesBetween(after: Date, until: Date): Date[] {
  const result: Date[] = [];
  const maxDays = 750;
  for (let offset = 0; offset <= maxDays; offset++) {
    const instants = dailyInstantsForDay(after, offset);
    let pastUntil = true;
    for (const instant of instants) {
      if (instant.getTime() > after.getTime() && instant.getTime() <= until.getTime()) {
        result.push(instant);
      }
      if (instant.getTime() <= until.getTime()) pastUntil = false;
    }
    if (pastUntil && offset > 0) break;
  }
  return result.sort((a, b) => a.getTime() - b.getTime());
}

/** The first daily-update instant strictly after `after`. */
export function nextDailyUpdate(after: Date): Date {
  for (let offset = 0; offset < 3; offset++) {
    for (const instant of dailyInstantsForDay(after, offset)) {
      if (instant.getTime() > after.getTime()) return instant;
    }
  }
  // Unreachable: within 2 days there is always an update.
  return new Date(after.getTime() + 86_400_000);
}

/**
 * Regular ticks are GLOBAL: they fire on round 5-minute wall-clock boundaries
 * (XX:00, XX:05, XX:10, …) shared by every empire, so the whole game — the
 * rankings included — updates at the same instant.
 */

/** The most recent global tick boundary at or before `date`. */
export function lastTickBoundary(date: Date): Date {
  return new Date(Math.floor(date.getTime() / REGULAR_TICK_MS) * REGULAR_TICK_MS);
}

/** The next global tick boundary strictly after `date` (XX:00, XX:05, …). */
export function nextRegularUpdate(date: Date): Date {
  return new Date(lastTickBoundary(date).getTime() + REGULAR_TICK_MS);
}

/** Global 5-minute boundaries crossed between the last update and now. */
export function elapsedRegularTicks(lastRegularUpdateAt: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor(now.getTime() / REGULAR_TICK_MS) -
      Math.floor(lastRegularUpdateAt.getTime() / REGULAR_TICK_MS)
  );
}

/** The most recent daily-update instant at or before `date`. */
export function lastDailyUpdate(date: Date): Date {
  for (let offset = 0; offset >= -2; offset--) {
    const instants = dailyInstantsForDay(date, offset).filter(
      (instant) => instant.getTime() <= date.getTime()
    );
    if (instants.length > 0) return instants[instants.length - 1];
  }
  // Unreachable: within 2 days back there is always an update.
  return new Date(date.getTime() - 86_400_000);
}

/* ------------------------------ calendar days ------------------------------ */

/**
 * The Jerusalem calendar day an instant falls in, as a plain integer count of
 * days since 1970-01-01.
 *
 * The game's own clock runs on 07:30/19:30 boundaries, and everything that
 * *pays* uses those. This is a different unit on purpose, and it is the one the
 * daily loop needs: a player who signs in at 23:00 and again at 08:00 the next
 * morning has visited on two days, but has crossed only one daily-update
 * boundary — counting their streak on the game clock would break it for anyone
 * whose habit is late nights, which is most of them.
 *
 * An integer rather than a "YYYY-MM-DD" key so consecutiveness is `b - a === 1`
 * — no string parsing, no month arithmetic, and it sorts and indexes as itself.
 *
 * DST is why this cannot be `floor(ms / 86_400_000)`: two days a year in
 * Jerusalem are 23 and 25 hours long, and on those days a UTC-derived index
 * disagrees with the calendar the player is reading. Going through the zoned
 * parts costs an Intl format and is correct on every day of the year.
 */
export function gameDay(date: Date): number {
  const { year, month, day } = zonedParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Midnight Jerusalem opening the day *after* the one `date` falls in. */
export function nextGameDayStart(date: Date): Date {
  const base = zonedParts(new Date(date.getTime() + 86_400_000));
  return wallTimeToUtc({
    year: base.year,
    month: base.month,
    day: base.day,
    hour: 0,
    minute: 0,
  });
}

/**
 * The Jerusalem week an instant falls in, as an integer.
 *
 * Weeks start on **Sunday**, which is the working week where the game is played
 * and where its season boundaries already sit. Day index 0 (1970-01-01) was a
 * Thursday, so the +4 shift moves the epoch onto a Sunday before the divide.
 */
export function gameWeek(date: Date): number {
  return Math.floor((gameDay(date) + 4) / 7);
}

/** Midnight Jerusalem opening the week *after* the one `date` falls in. */
export function nextGameWeekStart(date: Date): Date {
  const daysLeft = 7 - ((gameDay(date) + 4) % 7);
  return nextGameDayStart(new Date(date.getTime() + (daysLeft - 1) * 86_400_000));
}

/** Format an instant as Jerusalem wall time (HH:MM). */
export function formatGameTime(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: GAME_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Format an instant as a Jerusalem wall date and time (DD.MM.YYYY, HH:MM).
 *
 * The timezone is pinned rather than left to the host, because the callers that
 * need this are server-side (the Discord announcer) and a Vercel function runs
 * in UTC — a season deadline announced three hours early is a wrong deadline.
 */
export function formatGameDateTime(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: GAME_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A wait, in the largest unit that still says something true: "בעוד **3 שעות**",
 * "בעוד **3 ימים**" — the Hebrew a player would use out loud, duals included
 * (שעתיים, יומיים), never "2 שעות".
 *
 * The dual is why this takes the translator rather than returning a source
 * string: Hebrew has three number forms where English has two, so the *branch*
 * is part of the language and cannot be moved into a dictionary value.
 *
 * The unit is chosen by size, not by a fixed scale: under an hour it is minutes,
 * under a day it is hours, and from a day up it is days. A break of 30 hours is
 * therefore "בעוד יום" and not "בעוד 30 שעות", which is how the wait is actually
 * spoken about.
 *
 * **Always rounded down.** Every caller is a countdown to something that opens,
 * and the two directions of error are not equal: rounding up sends a player back
 * *after* the thing has started. Down at worst brings them early, to a page that
 * is already telling them the exact time.
 */
export function formatWaitDuration(t: T, ms: number): string {
  if (ms < MINUTE_MS) return t("רגע");
  if (ms < HOUR_MS) {
    const minutes = Math.floor(ms / MINUTE_MS);
    if (minutes === 1) return t("דקה");
    if (minutes === 2) return t("שתי דקות");
    return t("{count} דקות", { count: minutes });
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    if (hours === 1) return t("שעה");
    if (hours === 2) return t("שעתיים");
    return t("{count} שעות", { count: hours });
  }
  const days = Math.floor(ms / DAY_MS);
  if (days === 1) return t("יום");
  if (days === 2) return t("יומיים");
  return t("{count} ימים", { count: days });
}
