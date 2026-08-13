import "server-only";
import { redirect } from "next/navigation";
import { getSeasonGate } from "@/server/seasonClose";
import { getT } from "@/i18n/server";

/**
 * The lock on the front door, for everything that is not a `/game` screen.
 *
 * Between seasons the game is shut, and "shut" has to mean the whole site, not
 * only the part behind a login. `requireEmpire` already turns every `/game`
 * page away and `getActiveEmpireId` already refuses every server action (see
 * lib/auth.ts); this is the same gate for the pages in front of them — the
 * landing page, registration, empire creation, email verification. Without it
 * the shutdown has a hole in exactly the wrong place: a visitor could sign up
 * during the break, name an empire, and be bounced to `/season` from the very
 * first page after it — an account created, mid-break, into a world that is
 * about to be wiped when the next season opens.
 *
 * **`/login` is the deliberate exception.** It is the only way into `/admin`,
 * which stays reachable all break (someone has to be able to move a date, open
 * a season early or stop the cycle), and it costs nothing: a player who signs
 * in during the break lands on `/season` like everybody else, because every
 * route past the door is gated. The legal pages (`/terms`, `/privacy`,
 * `/refund`) stay up for the same class of reason — they are published
 * obligations, not game screens.
 *
 * Calling this costs nothing extra: `getSeasonGate` is React-cached per
 * request, and a page that also calls `requireEmpire` shares the one read.
 */
export async function requireOpenSeason(): Promise<void> {
  if (!(await getSeasonGate()).open) redirect("/season");
}

/**
 * The same check for a server action, which must answer with a message rather
 * than a redirect — a `redirect()` thrown inside a `useActionState` submit
 * shows the user nothing at all about why their form did not go through.
 */
export async function seasonClosedError(): Promise<string | null> {
  if ((await getSeasonGate()).open) return null;
  // Translated here rather than by the two callers: this is the finished
  // sentence they hand straight back to `useActionState`, and the reader is the
  // person whose form was just refused.
  const t = await getT();
  return t("העונה הסתיימה — המשחק סגור עד פתיחת העונה הבאה");
}
