import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("הדף לא נמצא | קראלדור") };
}

/**
 * The 404 for a URL that matches no route at all.
 *
 * `app/game/not-found.tsx` only covers `notFound()` thrown *inside* a `/game`
 * route — a battle id that is nobody's, a deleted empire. A URL that matches no
 * route in the first place falls all the way back to the root, and with no file
 * here that meant Next's own unstyled English "404 | This page could not be
 * found" — the one screen in the whole game that looked like a framework
 * default. A mistyped or truncated link is exactly how that page gets reached:
 * links to the game get shared through WhatsApp and Discord, which are happy to
 * clip a trailing character off a URL.
 *
 * Deliberately public: no session is read, nothing is queried, and it does not
 * call `requireOpenSeason`. A 404 has to render for a signed-out stranger during
 * the between-seasons shutdown as readily as for a player mid-raid, so it wraps
 * the same `AuthShell` the login and registration screens use rather than the
 * game chrome, which needs an empire to draw.
 */
export default async function NotFound() {
  const t = await getT();
  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <span className="text-5xl">🗺️</span>
        <h1 className="text-2xl font-black text-gold-bright">{t("הדף לא נמצא")}</h1>
        <p className="max-w-sm text-sm text-zinc-400">
          {t("הכתובת שהגעת אליה לא קיימת — ייתכן שהקישור נשבר בדרך או שהדף הוסר.")}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/game/base" className="btn btn-gold px-5 py-2 text-sm">
            {t("חזרה לבסיס")}
          </Link>
          <Link href="/login" className="btn btn-ghost px-5 py-2 text-sm">
            {t("התחברות")}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
