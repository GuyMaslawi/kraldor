import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { requireOpenSeason } from "@/server/seasonGuard";
import { requireLaunched } from "@/server/prelaunchGuard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Before the game has ever opened, the bare address *is* the poster: anyone who
  // types the domain lands on the countdown rather than a login form for a game
  // they cannot enter yet. Admins fall through to the game — see prelaunchGuard.
  await requireLaunched();
  // Between seasons the door itself is the season page — see seasonGuard.
  await requireOpenSeason();
  const userId = await getSessionUserId();
  redirect(userId ? "/game/base" : "/login");
}
