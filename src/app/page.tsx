import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { requireOpenSeason } from "@/server/seasonGuard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Between seasons the door itself is the season page — see seasonGuard.
  await requireOpenSeason();
  const userId = await getSessionUserId();
  redirect(userId ? "/game/base" : "/login");
}
