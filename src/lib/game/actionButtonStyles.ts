/**
 * The skin of the big verb buttons on a player's dossier — attack, spy, mail.
 *
 * These live outside RankActions because that file is `"use client"`, and every
 * export of a client module becomes a client *reference* when a server
 * component imports it: the profile page would get a proxy where it expected a
 * string. Plain constants in a plain module cross the boundary intact.
 */

/**
 * The shape all three share, so the row keeps one baseline and one height.
 * The type steps down on the smallest screens: three of these across a phone
 * at text-base spills the label out past the padding, and one shrunken row
 * reads far better than a wrapped one.
 */
export const RANK_ACTION_BUTTON_BASE =
  "flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-3 text-sm font-black tracking-wide transition-all cursor-pointer sm:gap-2 sm:px-3 sm:text-base disabled:cursor-not-allowed disabled:opacity-45";

/** Mail: green, to read as the one peaceful verb among the war buttons. */
export const RANK_ACTION_MESSAGE_STYLE =
  "border border-emerald-500/70 bg-gradient-to-b from-emerald-600 to-emerald-800 text-white shadow-[0_4px_20px_-6px_rgba(16,185,129,0.6)] hover:from-emerald-500 hover:to-emerald-700 hover:-translate-y-0.5";
