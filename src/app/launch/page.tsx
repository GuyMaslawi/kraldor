import type { CSSProperties } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/game/format";
import { LaunchCountdown } from "@/components/game/LaunchCountdown";
import { OrnateFrame } from "@/components/ui/OrnateFrame";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon, type IconName } from "@/components/ui/Icon";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t("פתיחת העונה | קראלדור"),
    description: t("העונה החדשה נפתחת. בנה אימפריה, צור ברית, כבוש את הדירוג."),
  };
}
export const dynamic = "force-dynamic";

/**
 * The poster for a season opening.
 *
 * Deliberately outside `requireOpenSeason`: this is the one page whose whole
 * job is to be seen *before* the gates open, so the guard that sends every
 * other public route to `/season` would defeat it. It reads no session and no
 * empire — a link to it can go out anywhere.
 *
 * **Where the deadline comes from.** The scheduled season wins: whatever the
 * admin panel booked is what the clock counts to, so moving the date moves the
 * poster with it and there is no second source of truth to forget. The
 * constant below is only the fallback for a database with nothing booked yet —
 * a local checkout, or a launch announced before the season row exists.
 */

/** Fallback deadline: 13.8.2026, 19:00 Israel time. See the note above. */
const FALLBACK_STARTS_AT = "2026-08-13T19:00:00+03:00";

/** Fixed sparks — never Math.random(), or SSR and hydration disagree. */
const SPARKS = [
  { left: 8, delay: 0, dur: 12, size: 3 },
  { left: 21, delay: 3.1, dur: 15, size: 2 },
  { left: 35, delay: 1.4, dur: 11, size: 4 },
  { left: 48, delay: 5.2, dur: 14, size: 2 },
  { left: 60, delay: 2.3, dur: 13, size: 3 },
  { left: 73, delay: 6.1, dur: 16, size: 2 },
  { left: 86, delay: 0.9, dur: 12, size: 3 },
  { left: 95, delay: 4.4, dur: 15, size: 2 },
];

const PROMISES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "base",
    title: "עולם חדש לגמרי",
    body: "כולם מתחילים מאפס באותה שנייה. אין ותק, אין יתרון — רק מי שמשחק נכון.",
  },
  {
    icon: "guild",
    title: "בריתות",
    body: "לבד לא שורדים כאן הרבה זמן. תבחרו צד לפני שהמפה מתחלקת בלעדיכם.",
  },
  {
    icon: "attack",
    title: "קרבות ושוד",
    body: "כל אימפריה שכנה היא הזדמנות — או האיום הבא על אוצר הזהב שלכם.",
  },
  {
    icon: "rankings",
    title: "הדירוג",
    body: "בסוף העונה נחתם היכל התהילה. שלושת הראשונים נשארים שם לנצח.",
  },
];

export default async function LaunchPage() {
  const { t, locale } = await getI18n();

  // The next season that is booked and has not started yet. An active season
  // has `startsAt` in the past and is correctly ignored: it is already running.
  const next = await prisma.gameSeason.findFirst({
    where: { closedAt: null, startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    select: { name: true, startsAt: true },
  });

  const startsAt = next?.startsAt ?? new Date(FALLBACK_STARTS_AT);
  // The clock ticks in server time — see LaunchCountdown.
  const serverNow = new Date().getTime();

  return (
    <div className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-6 lg:px-6">
      <OrnateFrame className="overflow-hidden p-3 sm:p-5 md:p-7">
        {/* -------- the gate about to open -------- */}
        <div className="lnc-stage">
          {SPARKS.map((s, i) => (
            <span
              key={i}
              aria-hidden
              className="lnc-spark"
              style={
                {
                  "--left": `${s.left}%`,
                  "--delay": `${s.delay}s`,
                  "--dur": `${s.dur}s`,
                  "--size": `${s.size}px`,
                } as CSSProperties
              }
            />
          ))}
          <span aria-hidden className="lnc-dawn" />

          <div className="lnc-body space-y-4 py-10 text-center">
            <p className="lnc-kicker text-xs font-bold tracking-[0.3em] text-crimson-bright">
              {t("פתיחת עונה רשמית")}
            </p>
            <h1 className="lnc-title text-4xl font-black text-gold-bright sm:text-6xl">
              {next?.name ?? t("העונה נפתחת")}
            </h1>
            <p className="mx-auto max-w-xl text-sm text-zinc-400">
              {t("מפה ריקה, אוצר ריק וכל השאר תלוי בכם. ברגע שהשערים נפתחים, כל שנייה נחשבת.")}
            </p>
            <p className="nums text-xs text-zinc-500" dir="ltr">
              {formatDate(startsAt, locale)}
            </p>
          </div>
        </div>

        {/* -------- the countdown -------- */}
        <div className="mt-6 rounded-xl border border-gold/25 bg-panel-inset px-4 py-7 text-center">
          <p className="mb-5 text-xs font-bold tracking-wide text-gold-dim">
            {t("השערים נפתחים בעוד")}
          </p>
          <LaunchCountdown
            serverNow={serverNow}
            startsAt={startsAt.getTime()}
          />

          {/* The one thing there is to do here. While the game is pre-launch this
              page is where every visitor lands (see server/prelaunchGuard.ts) and
              signing up is the only door that is open, so it cannot be a page you
              can only read. Registering now also claims the empire name, which is
              the actual reason to do it before the gates rather than after. */}
          <div className="mt-7 space-y-2">
            <Link
              href="/register"
              className="inline-block rounded-lg border border-gold/40 bg-gold/15 px-7 py-3 text-sm font-bold text-gold-bright transition hover:bg-gold/25"
            >
              {t("הירשם עכשיו ותפוס את השם")}
            </Link>
            <p className="text-xs text-zinc-500">
              {t("ההרשמה פתוחה. הכניסה למשחק תיפתח כשהספירה מסתיימת.")}
            </p>
          </div>
        </div>

        {/* -------- what is waiting behind them -------- */}
        <div className="mt-10">
          <SectionHeading title={t("מה מחכה מעבר לשער")} ornament="⚔" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map((p, i) => (
              <div
                key={p.title}
                style={{ "--i": i } as CSSProperties}
                className="lnc-promise panel rounded-xl px-4 py-5 text-center"
              >
                <Icon
                  name={p.icon}
                  size={26}
                  className="mx-auto mb-2 text-crimson-bright"
                />
                <h2 className="text-sm font-bold text-gold-bright">
                  {t(p.title)}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  {t(p.body)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </OrnateFrame>
    </div>
  );
}
