import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/admin";
import { isBanned } from "@/lib/ban";
import { PRELAUNCH, prelaunchShut } from "@/lib/prelaunch";

/**
 * Send everyone but an admin to the launch poster while the game is pre-launch.
 *
 * The page-level half of the gate described in lib/prelaunch.ts. `/game` is shut
 * by `requireEmpire` and every server action by `getActiveEmpireId`; this is for
 * the pages in front of them.
 *
 * **Deliberately not applied to** `/register`, `/verify-email`, `/onboarding`,
 * `/r/<code>`, `/login` or the legal pages. The first four are the sign-up path,
 * which is the one thing that stays open — naming an empire is part of
 * registering, not part of playing (the Google flow reaches `/onboarding` two
 * screens after the invite link). `/login` stays reachable because it is the only
 * way into `/admin`, and refuses non-admins at the POST instead (see `login`).
 * The legal pages are published obligations, not game screens.
 *
 * Costs one indexed row read per gated page load while the window is open, and
 * literally nothing once `PRELAUNCH=0` — the flag is checked first.
 */
export async function requireLaunched(): Promise<void> {
  if (await prelaunchShutForViewer()) redirect("/launch");
}

/**
 * The same question without the redirect: is the gate shut for whoever is
 * reading this request?
 *
 * For chrome that has to decide what to *offer* rather than whether to let
 * somebody through — the public top bar drops a link that would only bounce
 * here, the public shell's call to action points at the countdown instead of the
 * game. Shares `getSessionUser`'s per-request cache with the guard above, so a
 * page that calls both pays for one lookup.
 */
export async function prelaunchShutForViewer(): Promise<boolean> {
  if (!PRELAUNCH) return false;
  const user = await getSessionUser();
  // A banned admin is not an admin here either — same rule as `isAdmin`.
  const role = user && !isBanned(user) ? user.role : null;
  return prelaunchShut(role);
}
