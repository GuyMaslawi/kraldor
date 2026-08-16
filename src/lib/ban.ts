import type { Prisma } from "@prisma/client";
import { DEFAULT_LOCALE, LOCALE_TAG, type Locale } from "@/i18n/locale";
import type { T } from "@/i18n/translate";
import { GAME_TIMEZONE } from "@/lib/game/constants";

/**
 * The two columns that describe a ban: `bannedAt` is when it was handed down,
 * `bannedUntil` is when it lifts by itself — null meaning never (permanent).
 */
export interface BanState {
  bannedAt: Date | null;
  bannedUntil: Date | null;
}

/** Longest ban a day count may express (~10 years). Anything longer is permanent. */
export const BAN_DAYS_MAX = 3650;

/**
 * Is the account banned *right now*?
 *
 * Nothing sweeps expired rows — a timed ban stays on the user row after its
 * deadline passes — so every gate evaluates the deadline here instead of
 * reading `bannedAt` alone. `bannedAt` is a record, never a check.
 */
export function isBanned(user: BanState, now: Date = new Date()): boolean {
  if (!user.bannedAt) return false;
  return user.bannedUntil == null || user.bannedUntil > now;
}

/**
 * Prisma filter matching users whose ban is live. Mirrors `isBanned` exactly —
 * the two must move together, or a query would count a lapsed ban as active.
 */
export function bannedWhere(now: Date = new Date()): Prisma.UserWhereInput {
  return {
    bannedAt: { not: null },
    OR: [{ bannedUntil: null }, { bannedUntil: { gt: now } }],
  };
}

/** Prisma filter matching users who are not banned right now (inverse of `bannedWhere`). */
export function notBannedWhere(now: Date = new Date()): Prisma.UserWhereInput {
  return {
    OR: [{ bannedAt: null }, { bannedUntil: { lte: now } }],
  };
}

/**
 * Date + time in the reader's language, for every line a ban is written on.
 *
 * Language from the reader, **zone from the game**. The hour a ban lifts is the
 * one thing the notice exists to say, and it is read on a login page rendered
 * by a UTC server — unpinned, every timed ban announced itself three hours
 * early, and the player who came back on it found the door still shut.
 */
export function formatBanDate(d: Date, locale: Locale = DEFAULT_LOCALE): string {
  return d.toLocaleString(LOCALE_TAG[locale], {
    timeZone: GAME_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * The refusal shown to a banned player at the door. A timed ban names the hour
 * it lifts — without it the player has no way to tell a week from forever, and
 * every one of them writes to support.
 */
export function banNotice(t: T, user: BanState, locale: Locale = DEFAULT_LOCALE): string {
  return user.bannedUntil
    ? t("החשבון נחסם על ידי ההנהלה עד {until}", {
        until: formatBanDate(user.bannedUntil, locale),
      })
    : t("החשבון נחסם על ידי ההנהלה");
}

/**
 * Short label for the current ban state.
 *
 * Admin-facing only, so it stays in the source language like the rest of the
 * control centre — see the note in the i18n coverage script.
 */
export function banLabel(user: BanState, now: Date = new Date()): string {
  // i18n-exempt: read only in /admin, which stays Hebrew on purpose.
  if (!isBanned(user, now)) return "פעיל";
  // i18n-exempt: same — an admin-facing ban label.
  return user.bannedUntil ? `באן עד ${formatBanDate(user.bannedUntil)}` : "באן קבוע";
}
