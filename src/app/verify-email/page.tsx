import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { verifyEmailToken } from "@/server/actions/auth";
import { requireOpenSeason } from "@/server/seasonGuard";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResendVerification } from "@/components/auth/ResendVerification";
import { FormMessage } from "@/components/ui/FormMessage";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("אימות אימייל | קראלדור") };
}

export const dynamic = "force-dynamic";

/**
 * Two jobs in one route:
 *  - with `?token=…`, consume the emailed link and report the outcome;
 *  - without one, tell a signed-in but unverified user what to do next.
 *
 * The token is consumed in a Server Component rather than a route handler
 * because the app has no route handlers — server actions and pages are the
 * whole surface. Consuming on GET is safe here: the token is single-use and
 * verifying an address is the link's entire purpose, so a prefetching mail
 * scanner costs the user nothing (the second open reports success too).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  // Shut with the rest of the site between seasons (see seasonGuard). A link
  // that expires unclicked during the break costs its owner nothing: there is
  // no game to be verified into yet, and "שלח לי שוב" is waiting for them the
  // moment the next season opens.
  await requireOpenSeason();
  const t = await getT();
  const { token } = await searchParams;

  if (token) {
    const result = await verifyEmailToken(token);
    if (result.ok) {
      return (
        <AuthShell>
          <div className="space-y-4 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="text-xl font-bold text-zinc-100">{t("האימייל אומת")}</h2>
            <p className="text-sm text-zinc-400">
              {t("החשבון שלך פעיל. אפשר להיכנס ולהתחיל לבנות.")}
            </p>
            <Link href="/game/base" className="btn btn-primary block w-full py-2">
              {t("כניסה למשחק")}
            </Link>
          </div>
        </AuthShell>
      );
    }

    return (
      <AuthShell>
        <div className="space-y-4 text-center">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-xl font-bold text-zinc-100">{t("האימות נכשל")}</h2>
          <FormMessage error={result.error} />
          <VerifyHelp />
        </div>
      </AuthShell>
    );
  }

  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (!user) redirect("/login");
  if (user.emailVerified) redirect("/game/base");

  return (
    <AuthShell>
      <div className="space-y-4 text-center">
        <div className="text-4xl">📬</div>
        <h2 className="text-xl font-bold text-zinc-100">{t("אמת את האימייל שלך")}</h2>
        <p className="text-sm text-zinc-400">
          {t("שלחנו קישור אימות אל")}{" "}
          <span dir="ltr" className="font-semibold text-zinc-200">
            {user.email}
          </span>
          {t(". פתח אותו כדי להפעיל את החשבון. הקישור תקף ל-24 שעות.")}
        </p>
        <ResendVerification />
        <p className="text-xs text-zinc-500">
          {t("לא רואה את המייל? בדוק בתיקיית הספאם.")}
        </p>
      </div>
    </AuthShell>
  );
}

async function VerifyHelp() {
  const t = await getT();
  return (
    <>
      <ResendVerification />
      <p className="text-sm text-zinc-400">
        {t("אם אינך מחובר,")}{" "}
        <Link href="/login" className="font-semibold text-gold hover:text-gold-bright">
          {t("התחבר תחילה")}
        </Link>{" "}
        {t("ואז בקש קישור חדש.")}
      </p>
    </>
  );
}
