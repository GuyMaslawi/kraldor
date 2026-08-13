import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/ui/Logo";
import { OperatorCredit } from "@/components/ui/OperatorCredit";
import { OrnateFrame } from "@/components/ui/OrnateFrame";
import { PublicNav } from "@/components/public/PublicNav";
import { SupportChat } from "@/components/support/SupportChat";
import { prelaunchShutForViewer } from "@/server/prelaunchGuard";
import { getSessionUserId } from "@/lib/auth";
import { getSeasonGate } from "@/server/seasonClose";
import { hasSupportThread } from "@/server/actions/support";
import { discordInviteUrl } from "@/server/discord";
import { getI18n } from "@/i18n/server";

/**
 * The frame around the pages a stranger can read: the manual and the hall of
 * fame.
 *
 * Deliberately *not* the game shell. That one costs a settled empire, a resource
 * bar, a chat dock, a season pass and a dozen queries — none of which a reader
 * without an account has or needs. What it does share is the top bar and the
 * support dock, so the chrome is the same whether you arrived from the login
 * screen or from a search result.
 *
 * The one call to action adapts to who is reading: a visitor is invited to sign
 * up, somebody already signed in is sent back into the game rather than told to
 * register a second time.
 */
export async function PublicShell({
  title,
  subtitle,
  children,
}: {
  /** The crest line above the frame — the page's own name. */
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t, dir } = await getI18n();
  const [signedIn, hasThread, gate, shut] = await Promise.all([
    getSessionUserId(),
    hasSupportThread(),
    getSeasonGate(),
    prelaunchShutForViewer(),
  ]);
  const discord = discordInviteUrl();

  /**
   * Where the one button on this page goes.
   *
   * Four readers, four answers. Between seasons `/register` and `/game/*` both
   * redirect to `/season` (see seasonGuard), so sending anybody there would be a
   * button that visibly does something other than what it says — the page stays
   * open through the break precisely so it can be read then, and its call to
   * action has to be honest about the door being shut.
   *
   * The pre-launch pair is the same rule one window earlier: signing up is open
   * (and is the whole point of the window), but a reader who already has an
   * account cannot go back into a game that has never started — "חזרה למשחק"
   * would only bounce them to the poster, so it says so up front.
   */
  const cta = !gate.open
    ? { href: "/season", label: t("לתוצאות העונה ולספירה לאחור") }
    : shut && signedIn
      ? { href: "/launch", label: t("לספירה לאחור") }
      : signedIn
        ? { href: "/game/base", label: t("חזרה למשחק") }
        : { href: "/register", label: t("הקם אימפריה — חינם") };

  return (
    <div
      dir={dir}
      className="flex min-h-screen flex-col items-center bg-[radial-gradient(ellipse_at_top,rgba(224,35,51,0.10),transparent_60%)] px-3 pb-6 pt-6 lg:px-6"
    >
      <PublicNav />

      <div className="w-full max-w-[1400px]">
        <header className="mb-5 flex flex-col items-center text-center">
          <Link href="/" className="mb-3 inline-flex flex-col items-center">
            <LogoMark size={56} className="drop-shadow-[0_6px_20px_rgba(224,35,51,0.35)]" />
            <span className="mt-2 text-2xl font-black tracking-[0.18em] text-bone-bright">
              KRA<span className="text-crimson-bright">L</span>DOR
            </span>
          </Link>
          <h1 className="text-lg font-black text-gold-bright">{title}</h1>
          {subtitle && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
              {subtitle}
            </p>
          )}
          <Link href={cta.href} className="btn btn-gold mt-4 px-6 py-2 text-sm">
            {cta.label}
          </Link>
        </header>

        <OrnateFrame className="p-3 sm:p-5 md:p-7">{children}</OrnateFrame>

        <footer className="mt-6 flex flex-col items-center">
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-zinc-500">
            {/* No sign-in offered before the gates open: `login` refuses every
                non-admin during the window (see PRELAUNCH_LOGIN_NOTICE), so the
                only honest invitation on the site until then is הרשמה. */}
            {!shut && (
              <>
                <Link href="/login" className="transition-colors hover:text-gold">
                  {t("התחברות")}
                </Link>
                <span aria-hidden className="text-zinc-700">•</span>
              </>
            )}
            <Link href="/terms" className="transition-colors hover:text-gold">
              {t("תנאי שימוש")}
            </Link>
            <span aria-hidden className="text-zinc-700">•</span>
            <Link href="/refund" className="transition-colors hover:text-gold">
              {t("ביטולים והחזרים")}
            </Link>
            <span aria-hidden className="text-zinc-700">•</span>
            <Link href="/privacy" className="transition-colors hover:text-gold">
              {t("פרטיות")}
            </Link>
          </nav>
          <OperatorCredit className="mt-3" />
        </footer>
      </div>

      <SupportChat hasThread={hasThread} discordUrl={discord} />
    </div>
  );
}
