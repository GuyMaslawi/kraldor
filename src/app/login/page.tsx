import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getSeasonGate } from "@/server/seasonClose";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("התחברות | קראלדור") };
}
export const dynamic = "force-dynamic";

/**
 * The one door that stays open between seasons.
 *
 * Every other public route redirects to `/season` while the game is shut (see
 * server/seasonGuard.ts), but this one cannot: it is the only way into `/admin`,
 * and somebody has to be able to move a date or open a season early during the
 * break. It costs nothing to leave up — signing in during the break lands the
 * player on `/season` like everybody else, because every route past this door
 * is gated — so instead of hiding it, it says what is going on and points at
 * the recap.
 */
export default async function LoginPage() {
  if (await getSessionUserId()) redirect("/game/base");
  const gate = await getSeasonGate();
  const t = await getT();
  return (
    <AuthShell>
      {!gate.open && (
        <div className="mb-5 rounded-xl border border-gold/25 bg-panel-inset px-4 py-3 text-center">
          <p className="text-sm font-bold text-gold-bright">
            {t("{season} הסתיימה", { season: gate.seasonName ?? "" })}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {t("המשחק סגור עד פתיחת העונה הבאה.")}
          </p>
          <Link
            href="/season"
            className="mt-2 inline-block text-xs font-semibold text-crimson-bright underline-offset-4 hover:underline"
          >
            {t("לתוצאות העונה ולספירה לאחור →")}
          </Link>
        </div>
      )}
      <LoginForm canRegister={gate.open} />
    </AuthShell>
  );
}
