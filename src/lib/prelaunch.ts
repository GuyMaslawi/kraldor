import type { Role } from "@prisma/client";

/**
 * Pre-launch: the gate is shut and the sign-up sheet is out.
 *
 * The season gate (server/seasonClose.ts) closes the game *after* a season ends
 * and deliberately takes registration down with it — an empire founded during
 * the break would be wiped by the world restart on the next opening. This is the
 * opposite window, and it needs the opposite shape: the game has never opened,
 * so **signing up is the only thing anyone should be able to do**, and playing is
 * the thing that must not be possible yet.
 *
 * It is therefore a separate gate rather than a mode of the season one, and it
 * cannot be derived from the database: `getSeasonGate` reports `open: true`
 * whenever no season row is active, which is exactly the state a pre-launch
 * deployment (or a freshly wiped one) is in.
 *
 * ## Why the default is ON
 *
 * A missing or misspelt environment variable must not open the game. The flag is
 * read as "shut unless explicitly told otherwise", so a plain deploy with
 * nothing configured is a shut one — and opening the game is a deliberate act
 * with a name: set `PRELAUNCH=0`, or delete these three lines.
 *
 * ## Admins are exempt, on purpose
 *
 * Somebody has to be able to sign in and book the season that ends the window.
 * `/admin` is only reachable through `/login`, so a gate that turned everyone
 * away would lock the operator out of the panel that opens the gate.
 */
export const PRELAUNCH: boolean = process.env.PRELAUNCH !== "0";

/**
 * Whether this account must be turned away from the game while it is pre-launch.
 *
 * Takes the role rather than reading a session, so it is usable both from a page
 * (which has one) and from `login`, which is deciding whether to create one and
 * therefore has only the row it just authenticated.
 */
export function prelaunchShut(role: Role | null | undefined): boolean {
  return PRELAUNCH && role !== "ADMIN";
}

/**
 * What a player is told at a door that has not opened yet.
 *
 * Says the one thing that is actually actionable — you can register now — so a
 * refused sign-in does not read as "your account is broken".
 */
export const PRELAUNCH_LOGIN_NOTICE =
  "המשחק עוד לא נפתח, אז אי אפשר להיכנס. אפשר להירשם עכשיו ולשמור את שם האימפריה לרגע שהשערים נפתחים.";
