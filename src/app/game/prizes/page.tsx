import type { CSSProperties } from "react";
import Link from "next/link";
import { requireEmpire } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notStaffOrBot } from "@/lib/bot";
import { getLivePodium } from "@/server/seasonClose";
import { SEASON_PRIZES, PRIZE_POOL } from "@/lib/game/prizes";
import { formatCompact, formatDate, formatNumber } from "@/lib/game/format";
import { cityFullName } from "@/lib/game/cities";
import { AutoRefresh } from "@/components/game/AutoRefresh";
import { SeasonCountdown } from "@/components/game/SeasonCountdown";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("פרסי העונה | KRALDOR") };
}

/**
 * The prize hall — what the season is worth.
 *
 * Three seats, paid in diamonds when the season is sealed (the table lives in
 * lib/game/prizes.ts). The screen has one job beyond announcing the amounts: to
 * show the reader **who is sitting in each seat right now**, and how far he is
 * from taking one, so the prize reads as something being contested tonight
 * rather than a rule in the manual.
 *
 * The standing is the live podium — the very function the close archives with,
 * so nobody can find himself third here and off the podium in the hall.
 */

/** Fixed sparkle table — never Math.random(), or SSR and hydration disagree. */
const MOTES = [
  { left: 8, top: 62, delay: 0, dur: 5.5, size: 3 },
  { left: 17, top: 28, delay: 1.8, dur: 6.5, size: 2 },
  { left: 29, top: 74, delay: 3.2, dur: 5, size: 2 },
  { left: 38, top: 18, delay: 0.9, dur: 7, size: 3 },
  { left: 47, top: 55, delay: 4.4, dur: 6, size: 2 },
  { left: 56, top: 24, delay: 2.3, dur: 5.5, size: 3 },
  { left: 65, top: 70, delay: 5.1, dur: 6.5, size: 2 },
  { left: 74, top: 34, delay: 1.3, dur: 5, size: 3 },
  { left: 83, top: 66, delay: 3.9, dur: 7, size: 2 },
  { left: 92, top: 40, delay: 2.7, dur: 6, size: 3 },
];

/** Gold dust rising off the winner's card. */
const SPARKS = [
  { left: 12, delay: 0, dur: 4.5 },
  { left: 31, delay: 1.6, dur: 5.5 },
  { left: 52, delay: 3.1, dur: 4 },
  { left: 71, delay: 0.8, dur: 6 },
  { left: 88, delay: 2.4, dur: 5 },
];

const MEDALS = ["🥇", "🥈", "🥉"];
/** Pedestal heights, tallest in the middle. */
const STEPS = ["4.5rem", "2.75rem", "1.75rem"];

export default async function PrizesPage() {
  const { t, locale } = await getI18n();
  const me = await requireEmpire();

  const [podium, season, ahead] = await Promise.all([
    getLivePodium(),
    prisma.gameSeason.findFirst({
      where: { isActive: true },
      select: { name: true, endsAt: true },
    }),
    // The viewer's place in the game-wide power order. Only the primary term of
    // the ladder's ordering (see LADDER_ORDER in server/rankingsLadder.ts) —
    // players tied on raw power read as sharing a rank here instead of being
    // split by their heroes. That costs a join on every load to fix, and the
    // line it feeds is "how far are you from the podium", where a tie is
    // already the answer: you are level with him.
    //
    // Bots are counted out with the staff: this is the prize ladder, and no
    // garrison stands between a player and a diamond.
    prisma.empire.count({
      where: { ...notStaffOrBot, militaryPower: { gt: me.militaryPower } },
    }),
  ]);

  const myRank = ahead + 1;
  const mySeat = podium.find((c) => c.empireId === me.id) ?? null;
  const last = podium.length > 0 ? podium[podium.length - 1] : null;
  // What it would take to displace the bottom of a full podium. A partial
  // podium (an early season, a game just reset) has a free seat instead.
  const podiumFull = podium.length >= SEASON_PRIZES.length;
  const gap =
    !mySeat && podiumFull && last ? Math.max(1, Math.ceil(last.power - me.militaryPower)) : 0;

  const now = new Date();
  const seats = SEASON_PRIZES.map((prize) => ({
    prize,
    champ: podium.find((c) => c.rank === prize.rank) ?? null,
  }));

  return (
    <div className="space-y-6">
      {/* A seat can change hands with a single attack — keep the hall live. */}
      <AutoRefresh intervalMs={45_000} />
      <SectionHeading
        title={t("פרסי העונה")}
        ornament={<Icon name="gift" size={22} className="text-crimson" />}
      />

      {/* -------- the hall -------- */}
      <div className="prize-hall panel-gold">
        <span aria-hidden className="prize-rays" />
        <span aria-hidden className="prize-glow" />
        {MOTES.map((m, i) => (
          <span
            key={i}
            aria-hidden
            className="prize-mote"
            style={
              {
                "--left": `${m.left}%`,
                "--top": `${m.top}%`,
                "--delay": `${m.delay}s`,
                "--dur": `${m.dur}s`,
                "--size": `${m.size}px`,
              } as CSSProperties
            }
          />
        ))}
        <div className="prize-body space-y-3 px-4 py-9 text-center">
          <p className="prize-kicker text-xs font-bold tracking-[0.3em] text-crimson-bright">
            {t("הפרס הראשון")}
          </p>
          {/* The winner's purse, not the pool. The pool was the headline for
              about an hour and read as first place's prize — a bigger number in
              the same slot is simply taken as "what I get if I win". */}
          <h2 className="prize-pool flex items-center justify-center gap-2 text-4xl font-black sm:text-5xl">
            <Icon name="diamond" size={38} className="prize-gem text-cyan-300" />
            <span className="prize-amount nums" dir="ltr">
              {formatNumber(SEASON_PRIZES[0].diamonds)}
            </span>
          </h2>
          <p className="text-sm font-bold tracking-wide text-gold-bright">
            {t("יהלומים לאלוף העונה")}
          </p>
          <p className="mx-auto max-w-xl text-xs text-zinc-400">
            {t("גם המקום השני והשלישי זוכים — {second} ו־{third} יהלומים, {pool} בסך הכול. הדירוג נקבע לפי הכוח הצבאי בסיום העונה, וכל עוד העונה רצה כל תקיפה יכולה להזיז כיסא.", {
              second: formatNumber(SEASON_PRIZES[1].diamonds),
              third: formatNumber(SEASON_PRIZES[2].diamonds),
              pool: formatNumber(PRIZE_POOL),
            })}



          </p>
        </div>
      </div>

      {/* -------- the clock on it -------- */}
      {/* The dials, not the one-line "3ד 04:12:07" clock the rest of the game
          uses: the day suffix is a Hebrew letter inside an LTR run, so bidi
          reorders it to the far side and "25ד 23:32:35" reads as 2,523 hours.
          Fine on a spell chip in a table, not on the headline clock of the
          screen whose whole subject is a deadline. */}
      <div className="panel-inset rounded-xl px-4 py-4 text-center">
        {season ? (
          <>
            <p className="mb-3 text-xs font-bold tracking-wide text-gold-dim">
              <Icon name="turns" size={14} className="inline-block align-middle" />{" "}
              {t("{season} — הפרסים מוענקים בעוד", { season: season.name })}
            </p>
            <SeasonCountdown
              serverNow={now.getTime()}
              startsAt={season.endsAt.getTime()}
              arrivedLabel="העונה ננעלת…"
            />
            <p className="mt-3 text-[11px] text-zinc-500">{formatDate(season.endsAt, locale)}</p>
          </>
        ) : (
          <p className="text-sm text-zinc-400">
            {t("מועד סיום העונה טרם נקבע — הפרסים ממתינים לעונה מתוזמנת.")}
          </p>
        )}
      </div>

      {/* -------- the podium -------- */}
      {/* Second place on the left, first in the middle, third on the right: the
          podium order, not the reading order. `order` is a visual reshuffle
          only — the DOM stays 1-2-3 for a screen reader. */}
      <div>
      <div className="grid items-end gap-3 sm:grid-cols-3">
        {seats.map(({ prize, champ }, i) => {
          const first = prize.rank === 1;
          const isMe = champ?.empireId === me.id;
          return (
            <div
              key={prize.rank}
              style={{ "--i": i } as CSSProperties}
              className={`flex flex-col justify-end ${
                first ? "sm:order-2" : prize.rank === 2 ? "sm:order-1" : "sm:order-3"
              }`}
            >
              <div
                className={`prize-seat rounded-xl p-4 text-center ${
                  first ? "panel-gold prize-seat-first" : "panel"
                } ${isMe ? "prize-seat-mine" : ""}`}
              >
                <span aria-hidden className="prize-shine" />
                <span aria-hidden className="prize-halo" />
                {first &&
                  SPARKS.map((s, j) => (
                    <span
                      key={j}
                      aria-hidden
                      className="prize-spark"
                      style={
                        {
                          "--left": `${s.left}%`,
                          "--delay": `${s.delay}s`,
                          "--dur": `${s.dur}s`,
                        } as CSSProperties
                      }
                    />
                  ))}

                <div className="prize-seat-body">
                  <span
                    aria-hidden
                    className="prize-medal block text-4xl"
                    style={{ "--i": i } as CSSProperties}
                  >
                    {MEDALS[prize.rank - 1]}
                  </span>
                  <p className="mt-1 text-xs font-bold tracking-[0.2em] text-gold-dim">
                    {prize.label}
                  </p>

                  <p className="mt-3 flex items-center justify-center gap-1.5">
                    <Icon
                      name="diamond"
                      size={first ? 26 : 20}
                      className="prize-gem text-cyan-300"
                    />
                    <span
                      className={`prize-amount nums font-black ${
                        first ? "text-3xl" : "text-2xl"
                      }`}
                      dir="ltr"
                    >
                      {formatNumber(prize.diamonds)}
                    </span>
                  </p>

                  <div className="mt-4 border-t border-border-subtle pt-3">
                    {champ ? (
                      <>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                          {t("מחזיק בכיסא")}
                        </p>
                        <p className="mt-1 truncate text-sm font-bold text-gold-bright">
                          <PlayerLink
                            empireId={champ.empireId}
                            name={champ.empireName}
                            titleKey={champ.title}
                          />
                          {isMe && (
                            <span className="mr-1.5 rounded-full bg-gold/15 px-1.5 align-middle text-[10px] font-bold text-gold">
                              {t("את/ה")}
                            </span>
                          )}
                        </p>
                        <p
                          className="nums mt-1 text-sm font-bold text-zinc-100"
                          dir="ltr"
                          title={formatNumber(champ.power)}
                        >
                          {formatCompact(champ.power)}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {t("כוח צבאי")} · {cityFullName(t, champ.cities)}
                          {champ.guildName ? ` · ${champ.guildName}` : ""}
                        </p>
                      </>
                    ) : (
                      <p className="py-2 text-sm text-zinc-500">{t("הכיסא עדיין פנוי")}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* The step it stands on — three-across only. Stacked on a phone
                  the seats are already in order top to bottom, and a pedestal
                  under each one says nothing the medal has not. */}
              <div
                aria-hidden
                className="prize-step mt-2 hidden items-center justify-center sm:flex"
                style={{ "--h": STEPS[prize.rank - 1] } as CSSProperties}
              >
                <span className="prize-step-num nums" dir="ltr">
                  {prize.rank}
                </span>
              </div>
            </div>
          );
        })}
        </div>
        {/* The floor the three steps stand on. Without it the pedestals — which
            carry no bottom border on purpose — read as cut off rather than as
            standing on something. */}
        <div aria-hidden className="prize-floor hidden sm:block" />
      </div>

      {/* -------- where the reader stands -------- */}
      <div className="panel-gold rounded-xl p-4">
        {me.isStaff ? (
          <p className="text-sm text-zinc-400">
            {t("חשבונות ההנהלה אינם משתתפים בדירוג ואינם זכאים לפרסים.")}
          </p>
        ) : mySeat ? (
          <p className="text-sm text-zinc-200">
            {t("את/ה")}{" "}
            <strong className="text-gold-bright">{t(SEASON_PRIZES[mySeat.rank - 1].label)}</strong>{" "}
            {t("— שמירה על המקום עד נעילת העונה שווה")}{" "}
            <strong className="nums text-cyan-300" dir="ltr">
              {formatNumber(SEASON_PRIZES[mySeat.rank - 1].diamonds)}
            </strong>{" "}
            <Icon name="diamond" size={14} className="inline-block align-middle text-cyan-300" />.
          </p>
        ) : (
          <p className="text-sm text-zinc-200">
            {t("המקום שלך בדירוג הכללי:")}{" "}
            <strong className="nums text-gold-bright" dir="ltr">
              {formatNumber(myRank)}
            </strong>
            {gap > 0 ? (
              <>
                {" "}
                {t("— חסרים לך")}{" "}
                <strong className="nums text-gold-bright" dir="ltr" title={formatNumber(gap)}>
                  {formatCompact(gap)}
                </strong>{" "}
                {t("כוח צבאי כדי לעלות על הפודיום.")}
              </>
            ) : (
              t(" — הפודיום עדיין לא מלא, כל מקום פנוי שם שווה יהלומים.")
            )}
          </p>
        )}
      </div>

      {/* -------- the rules -------- */}
      <div className="panel rounded-xl p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
          <Icon name="reports" size={16} className="text-crimson-bright" />
          {t("איך זוכים")}
        </h3>
        <ul className="space-y-1.5 text-xs text-zinc-400">
          <li>{t("• הדירוג הוא גלובלי — כל השחקנים במשחק, לא רק העיר שלך.")}</li>
          <li>{t("• מדד הדירוג הוא הכוח הצבאי: הצבא, הנשק שבידיו והבונוסים של הגיבור.")}</li>
          <li>{t("• שוויון נשבר לפי רמת הגיבור, ואחריה מספר האיפוסים שלו.")}</li>
          <li>{t("• חשבונות ההנהלה אינם משתתפים ואינם תופסים מקום בפודיום.")}</li>
          <li>
            {t("• הדירוג הקובע הוא זה שנחתם ברגע נעילת העונה, והיהלומים נכנסים לחשבון")}{" "}
            <strong className="text-gold-bright">{t("אוטומטית")}</strong>{" "}
            {t("באותו רגע — עם הודעה לתיבת הדואר. אין צורך לאסוף דבר.")}


          </li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/game/rankings" className="btn btn-gold px-4 py-2 text-sm">
          <Icon name="rankings" size={16} className="inline-block align-middle" /> {t("לטבלת הדירוג")}
          </Link>
          <Link href="/game/leaderboards" className="btn btn-ghost px-4 py-2 text-sm">
          <Icon name="crown" size={16} className="inline-block align-middle" /> {t("טבלאות מובילים")}
          </Link>
        </div>
      </div>
    </div>
  );
}
