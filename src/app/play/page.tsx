import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUserId } from "@/lib/auth";
import { getLandingData } from "@/server/landing";
import { discordInviteUrl } from "@/server/discord";
import { formatNumber } from "@/lib/game/format";
import { GateScene } from "@/components/auth/GateScene";
import { PublicNav } from "@/components/public/PublicNav";
import { LogoMark } from "@/components/ui/Logo";
import { OperatorCredit } from "@/components/ui/OperatorCredit";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { Icon, type IconName } from "@/components/ui/Icon";
import { SeasonCountdown } from "@/components/game/SeasonCountdown";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t("קראלדור — משחק אסטרטגיה בעברית, בדפדפן"),
    description: t(
      "בנה אימפריה, גייס צבא, הצטרף לברית וכבוש את הדירוג. עונה חדשה כל 30 יום — כולם מתחילים מאפס. חינם, בדפדפן, בלי הורדה."
    ),
  };
}

export const dynamic = "force-dynamic";

/**
 * `/play` — the door a paid click lands on.
 *
 * ## Why it is not `/login`
 *
 * `/` sends everybody to the sign-in form, which is the right destination for
 * somebody who already plays and the wrong one for somebody who has never heard
 * of the game: an email field and a password field answer none of the four
 * questions a stranger arrives with — what is this, is anyone playing, is it
 * too late to start, does it cost anything — and a visitor who was interested
 * enough to click an ad leaves without ever finding out. Every ad in the
 * campaign points here instead, and the sign-up form is one deliberate click
 * further on.
 *
 * ## The page is built around one argument
 *
 * Not a feature list. The single objection that stops people joining a PvP game
 * is *"everyone is already stronger than me"*, and this game answers it
 * structurally: the world is wiped every 30 days. So the countdown is the hero,
 * the three live counts are there to prove somebody is home, and the features
 * come third — they are the reason to stay, not the reason to click.
 *
 * ## Everything on it is true and checkable
 *
 * The clock reads the actual season row and the counts are real queries with
 * bots and staff excluded. A landing page that inflates its population is found
 * out on day two, when the new player looks at the ladder — and the campaign
 * that brought them has already been paid for by then.
 *
 * A server component. The only client JavaScript is the countdown, which is
 * shared with `/season`.
 */

// i18n-keys-start: the landing copy — three tables of dictionary keys, each
// drawn through t() at the call site below. They live as data rather than JSX
// because the page renders them in a loop; the scanner is told so here.

/** The three steps, in the order a first evening actually goes. */
const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "base",
    title: "מקימים אימפריה",
    body: "שם, גיבור, וכפר אחד. חופרים מכרות, בונים מחסנים, מייצרים נשק — כל דקה מייצרת משאבים גם כשאתם לא מחוברים.",
  },
  {
    icon: "attack",
    title: "יוצאים לקרב",
    body: "מרגלים אחרי השכן, תוקפים את מי שנראה שמן מדי, ובוזזים לו את הזהב. מפסידים? גם זה קורה. החומות נבנות מחדש.",
  },
  {
    icon: "guild",
    title: "מצטרפים לברית",
    body: "לבד לא מפילים מפלצת עולם ולא זוכים במלחמת בריתות. הברית היא מה שהופך את זה ממשחק לחיים חברתיים.",
  },
];

/** Six things to do here. Chosen to be *scenes*, not mechanics. */
const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "heart",
    title: "מפלצת העולם",
    body: "כל 24 שעות קמה חיה אחת שכל השרת מכה בה יחד. מי שהנחית את המכה האחרונה לוקח את הראש — והשלל מתחלק לפי מי שדימם אותה.",
  },
  {
    icon: "guild",
    title: "מלחמת בריתות",
    body: "כל ערב ב-19:30 הבריתות מתנגשות. הקרב נלחם על ידי המערכת, בגודל הוגן — ברית קטנה לא נמחקת מול ברית ענקית.",
  },
  {
    icon: "laurel",
    title: "הזירה",
    body: "טורניר בין שחקנים בדרגה שלכם. נכנסים, נלחמים, ומי שנשאר עומד לוקח את הקופה.",
  },
  {
    icon: "hero",
    title: "גיבור וציוד",
    body: "לגיבור שלכם יש מחלקה, רמה, נשק ושריון. הציוד נופל מקרבות שניצחתם, מתחלף כל 10 רמות, ואפשר לחשל אותו למעלה.",
  },
  {
    icon: "shield",
    title: "שליטי הערים",
    body: "בכל עיר יושב עריץ אחד משותף לכל תושביה. להפיל אותו זו מצור, לא דו-קרב — וזה משתלם.",
  },
  {
    icon: "crown",
    title: "עונה של 30 יום",
    body: "בסוף העונה הדירוג נחתם, שלושת הראשונים לוקחים יהלומים, השמות נכנסים להיכל התהילה — והעולם נמחק ומתחיל מחדש.",
  },
];

/**
 * How many live empires it takes before the page is willing to quote a number.
 *
 * Under this the counts are hidden entirely — not faked, not padded, just not
 * mentioned. "2 אימפריות בעולם" is a true statement that costs more clicks than
 * silence does, and the two moments it is most likely to be true are the two
 * moments the campaign is spending hardest: the hours after a world restart,
 * and a brand-new server. The countdown carries the hero on its own until the
 * population is worth boasting about.
 */
const PROOF_FLOOR = 25;

/** Short, and only the questions that actually stop somebody from signing up. */
const FAQ: { q: string; a: string }[] = [
  {
    q: "צריך להוריד משהו?",
    a: "לא. קראלדור רץ בדפדפן — במחשב ובנייד. אין אפליקציה להתקין, אין אפ-סטור, אין עדכונים.",
  },
  {
    q: "זה עולה כסף?",
    a: "אפשר לשחק את כל המשחק בחינם. יש חנות יהלומים שחוסכת זמן ומוסיפה נוחות, והיא לא קונה ניצחון בקרב — הכוח מגיע מהצבא, מהשדרוגים ומהברית.",
  },
  {
    q: "מאוחר מדי להתחיל?",
    a: "לא, וזו כל הנקודה. העולם נמחק כל 30 יום וכולם מתחילים מאפס באותו רגע. גם באמצע עונה אפשר להיכנס — נכנסים לעיר הראשונה, שבה כולם חדשים כמוכם.",
  },
  {
    q: "כמה זמן ביום זה דורש?",
    a: "המכרות עובדים גם כשאתם לא. עשר דקות ביום מספיקות כדי להישאר בעניינים; מי שרוצה להיות במקום הראשון ישקיע יותר.",
  },
  {
    q: "המשחק בעברית?",
    a: "כולו. עברית מלאה, מימין לשמאל, כולל התמיכה והקהילה. יש גם אנגלית למי שמעדיף.",
  },
];
// i18n-keys-end

export default async function PlayPage() {
  // Somebody who already has a session does not need to be sold the game.
  if (await getSessionUserId()) redirect("/game/base");

  const t = await getT();
  const data = await getLandingData();
  const discord = discordInviteUrl();

  // Between seasons the sign-up form is closed (register redirects to /season),
  // so the page must not put a button in front of a locked door — see the
  // `preseason` branch in server/landing.ts.
  const open = data.season.phase !== "preseason";

  // A zero is worse than silence. "0 קרבות ב-24 שעות" on a page whose whole job
  // is to prove somebody is home reads as a dead server — and early in a season,
  // or an hour after a world restart, a genuine zero is exactly what the query
  // returns. Empty counts are dropped rather than shown, and if none survive the
  // strip does not render at all.
  const allCounts: { icon: IconName; value: number; label: string }[] = [
    { icon: "base", value: data.empires, label: t("אימפריות בעולם") },
    { icon: "guild", value: data.guilds, label: t("בריתות") },
    { icon: "attack", value: data.battles24h, label: t("קרבות ב-24 שעות") },
  ];
  const counts =
    data.empires >= PROOF_FLOOR ? allCounts.filter((c) => c.value > 0) : [];

  return (
    <main dir="rtl" className="relative flex min-h-screen flex-col items-center px-4 pb-10 pt-6">
      {/* The same besieged capital that stands behind the sign-in form, so the
          click from here to there does not change worlds. Fixed and
          aria-hidden; this page scrolls over a still horizon. */}
      <GateScene />

      <PublicNav className="gate-content gate-fade" />

      <div className="gate-content w-full max-w-5xl space-y-14">
        {/* ------------------------------- hero ------------------------------- */}
        <header className="flex flex-col items-center text-center">
          <div className="gate-crest-wrap mb-2">
            <span aria-hidden className="gate-halo" />
            <span aria-hidden className="gate-ring gate-ring-outer" />
            <span aria-hidden className="gate-ring gate-ring-inner" />
            <LogoMark size={64} className="gate-crest" />
          </div>
          <h1
            dir="ltr"
            className="gate-word text-4xl font-black tracking-[0.18em] text-bone-bright sm:text-5xl"
          >
            {[..."KRALDOR"].map((letter, i) => (
              <span
                key={i}
                style={{ "--i": i } as CSSProperties}
                className={letter === "L" ? "text-crimson-bright" : undefined}
              >
                {letter}
              </span>
            ))}
          </h1>

          <p className="lnd-lede mt-5 max-w-2xl text-balance text-xl font-bold leading-relaxed text-bone-bright sm:text-2xl">
            {t("משחק אסטרטגיה בעברית, בדפדפן. בנה אימפריה, גייס צבא, הצטרף לברית — וכבוש את הדירוג.")}
          </p>
          <p className="lnd-lede-sub mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
            {t("בלי הורדה, בלי אפ-סטור. נכנסים ומשחקים.")}
          </p>

          {/* ---------------------------- the clock ---------------------------- */}
          {/* The strongest thing this page can say, and the only one a
              competitor cannot copy: a start line everybody shares. */}
          <div className="lnd-clock mt-8 w-full max-w-lg rounded-2xl border border-gold/30 bg-black/45 px-5 py-5 backdrop-blur-sm">
            {data.season.phase === "preseason" ? (
              <>
                <p className="mb-3 text-xs font-bold tracking-[0.2em] text-crimson-bright">
                  {t("העולם החדש נפתח בעוד")}
                </p>
                <SeasonCountdown serverNow={data.now} startsAt={data.season.startsAt.getTime()} />
                <p className="mt-3 text-sm font-bold text-gold-bright">
                  {t("כולם מתחילים מאפס. באותו רגע.")}
                </p>
              </>
            ) : data.season.phase === "running" ? (
              <>
                <p className="mb-3 text-xs font-bold tracking-[0.2em] text-crimson-bright">
                  {t("{season} נחתמת בעוד", { season: data.season.name })}
                </p>
                <SeasonCountdown
                  serverNow={data.now}
                  startsAt={data.season.endsAt.getTime()}
                  // i18n-keys: SeasonCountdown runs arrivedLabel through t()
                  // itself, so this is passed as Hebrew. Its own default
                  // promises gates *opening*, which is the opposite of what
                  // this clock is counting down to.
                  arrivedLabel="העונה נחתמת…"
                />
                <p className="mt-3 text-sm text-zinc-300">
                  {t("ואז העולם נמחק וכולם מתחילים מאפס — כולל מי שנמצא עכשיו במקום הראשון.")}
                </p>
              </>
            ) : (
              <p className="text-sm font-bold text-gold-bright">
                {t("כל 30 יום העולם נמחק וכולם מתחילים מאפס.")}
              </p>
            )}
          </div>

          {/* ----------------------------- the ask ----------------------------- */}
          <div className="mt-7 flex w-full max-w-lg flex-col items-center gap-3">
            {open ? (
              <>
                <Link
                  href="/register"
                  className="lnd-cta btn btn-gold w-full py-3 text-base font-black tracking-wide"
                >
                  {t("הקם אימפריה — חינם")}
                </Link>
                <p className="text-xs text-zinc-500">
                  {t("נרשמים באימייל או עם Google. לוקח פחות מדקה.")}
                </p>
                <Link
                  href="/login"
                  className="text-xs font-semibold text-zinc-400 underline-offset-4 hover:text-gold-bright hover:underline"
                >
                  {t("כבר יש לי חשבון")}
                </Link>
              </>
            ) : (
              <>
                {/* Sign-up is shut during the break. Asking for a Discord follow
                    is the only honest call to action here — it is also the one
                    that brings them back on opening night. */}
                {/* i18n-keys: the label goes in as Hebrew — DiscordLink runs
                    it through t() itself (see its signature). */}
                <DiscordLink
                  url={discord}
                  variant="pill"
                  label="קבלו התראה כשהשערים נפתחים"
                />
                <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
                  {t("ההרשמה נפתחת יחד עם העונה. הצטרפו לדיסקורד ותדעו ראשונים.")}
                </p>
              </>
            )}
          </div>

          {/* ---------------------------- live proof ---------------------------- */}
          {open && counts.length > 0 && (
            <div className="mt-9 flex w-full max-w-2xl flex-wrap justify-center gap-2 sm:gap-3">
              {counts.map((c, i) => (
                <div
                  key={c.label}
                  style={{ "--i": i } as CSSProperties}
                  className="lnd-count min-w-28 flex-1 rounded-xl border border-border-subtle bg-black/40 px-2 py-3 text-center backdrop-blur-sm sm:min-w-36 sm:max-w-52"
                >
                  <Icon name={c.icon} size={18} className="mx-auto mb-1 text-crimson-bright" />
                  <span className="nums block text-lg font-black text-gold-bright sm:text-xl" dir="ltr">
                    {formatNumber(c.value)}
                  </span>
                  <span className="block text-[10px] leading-tight text-zinc-500 sm:text-[11px]">
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </header>

        {/* ------------------------------ the steps ------------------------------ */}
        <section className="space-y-5">
          <SectionTitle title={t("איך זה עובד")} />
          <div className="grid gap-3 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div
                key={s.title}
                style={{ "--i": i } as CSSProperties}
                className="lnd-card relative rounded-xl border border-border-subtle bg-panel/80 p-4 backdrop-blur-sm"
              >
                <span
                  aria-hidden
                  dir="ltr"
                  className="nums absolute left-3 top-3 text-3xl font-black text-gold/15"
                >
                  {i + 1}
                </span>
                <Icon name={s.icon} size={26} className="mb-2 text-crimson-bright" />
                <h3 className="mb-1 text-base font-bold text-gold-bright">{t(s.title)}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{t(s.body)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ----------------------------- the features ----------------------------- */}
        <section className="space-y-5">
          <SectionTitle title={t("מה יש שם")} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                style={{ "--i": i } as CSSProperties}
                className="lnd-card rounded-xl border border-border-subtle bg-panel/80 p-4 backdrop-blur-sm"
              >
                <h3 className="mb-1.5 flex items-center gap-2 text-sm font-bold text-gold-bright">
                  <Icon name={f.icon} size={20} className="shrink-0 text-crimson-bright" />
                  {t(f.title)}
                </h3>
                <p className="text-sm leading-relaxed text-zinc-400">{t(f.body)}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-zinc-500">
            {t("יש עוד הרבה — הכל מוסבר עד הסוף ב")}{" "}
            <Link href="/guide" className="font-semibold text-gold hover:text-gold-bright">
              {t("מדריך המשחק")}
            </Link>
            {t(", בלי להירשם.")}
          </p>
        </section>

        {/* -------------------------------- the FAQ -------------------------------- */}
        <section className="space-y-5">
          <SectionTitle title={t("שאלות שנשאלות")} />
          <div className="mx-auto max-w-3xl space-y-2">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="lnd-faq group rounded-xl border border-border-subtle bg-panel/80 px-4 py-3 backdrop-blur-sm"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-zinc-100 marker:hidden">
                  {t(item.q)}
                  <span
                    aria-hidden
                    className="shrink-0 text-gold-dim transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{t(item.a)}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ------------------------------ the last ask ------------------------------ */}
        {open && (
          <section className="mx-auto max-w-lg space-y-3 text-center">
            <p className="text-lg font-black text-bone-bright">
              {data.season.phase === "running"
                ? t("העולם הזה נגמר בקרוב. הבא הוא שלכם.")
                : t("העולם מחכה.")}
            </p>
            <Link
              href="/register"
              className="lnd-cta btn btn-gold block w-full py-3 text-base font-black tracking-wide"
            >
              {t("הקם אימפריה — חינם")}
            </Link>
            {/* i18n-keys: Hebrew in, t() applied inside DiscordLink. */}
            <DiscordLink url={discord} variant="pill" label="או קפצו קודם לדיסקורד" />
          </section>
        )}

        <OperatorCredit className="gate-fade" />
      </div>
    </main>
  );
}

/** A centred rule-and-title, matching the game's SectionHeading at hero scale. */
function SectionTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <span aria-hidden className="h-px w-10 bg-gradient-to-l from-transparent to-gold-dim sm:w-20" />
      <h2 className="text-center text-lg font-black tracking-wide text-bone-bright sm:text-xl">
        {title}
      </h2>
      <span aria-hidden className="h-px w-10 bg-gradient-to-r from-transparent to-gold-dim sm:w-20" />
    </div>
  );
}
