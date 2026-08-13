import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getSeasonGate, readRecap, type SeasonRecap } from "@/server/seasonClose";
import { getTunables } from "@/lib/game/config";
import { formatCompact, formatDate, formatNumber } from "@/lib/game/format";
import { SeasonCountdown } from "@/components/game/SeasonCountdown";
import { OrnateFrame } from "@/components/ui/OrnateFrame";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon, type IconName } from "@/components/ui/Icon";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("העונה הסתיימה | קראלדור") };
}
export const dynamic = "force-dynamic";

/**
 * The one screen that stands between seasons.
 *
 * When a season's clock runs out the whole game shuts (see server/seasonClose.ts
 * — `requireEmpire` and `getActiveEmpireId` both refuse) and every route lands
 * here: the final podium, everything that happened, and a countdown to the next
 * season. It reads **only the frozen archive** on the GameSeason row — never
 * live empires — because the admin's reset deletes every empire in the game and
 * this page has to keep telling the story afterwards.
 *
 * While a season is running there is nothing to say, so the page bounces to the
 * game. That also means it can never be a stale second copy of the ladder.
 */

/** Fixed embers — never Math.random(), or SSR and hydration disagree. */
const EMBERS = [
  { left: 6, delay: 0, dur: 13, size: 3 },
  { left: 18, delay: 2.4, dur: 16, size: 2 },
  { left: 31, delay: 5.1, dur: 11, size: 4 },
  { left: 44, delay: 1.2, dur: 15, size: 2 },
  { left: 57, delay: 6.8, dur: 12, size: 3 },
  { left: 69, delay: 3.6, dur: 17, size: 2 },
  { left: 81, delay: 0.8, dur: 14, size: 3 },
  { left: 93, delay: 4.9, dur: 12, size: 2 },
];

const MEDALS = ["🥇", "🥈", "🥉"];

async function Totals({ totals }: { totals: SeasonRecap["totals"] }) {
  const t = await getT();
  const cells: { label: string; value: string; icon: IconName }[] = [
    { label: t("אימפריות"), value: formatNumber(totals.empires), icon: "base" },
    { label: t("בריתות"), value: formatNumber(totals.guilds), icon: "guild" },
    { label: t("קרבות"), value: formatNumber(totals.battles), icon: "attack" },
    { label: t("זהב שנשדד"), value: formatCompact(totals.goldPlundered), icon: "gold" },
    { label: t("חיילים שנפלו"), value: formatCompact(totals.soldiersLost), icon: "army" },
    { label: t("נלקחו בשבי"), value: formatCompact(totals.soldiersEnslaved), icon: "citizens" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c, i) => (
        <div
          key={c.label}
          style={{ "--i": i } as CSSProperties}
          className="ssn-tally panel rounded-xl px-3 py-3 text-center"
        >
          <Icon name={c.icon} size={18} className="mx-auto mb-1 text-crimson-bright" />
          <span className="nums block text-base font-bold text-gold-bright" dir="ltr">
            {c.value}
          </span>
          <span className="block text-[11px] text-zinc-500">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

export default async function SeasonEndPage() {
  const { t, locale } = await getI18n();
  const gate = await getSeasonGate();

  // A live season has no story to tell yet — send everyone back where they
  // came from rather than showing an empty ceremonial page.
  if (gate.open) redirect((await getSessionUserId()) ? "/game/base" : "/login");

  const [season, champions, tunables] = await Promise.all([
    prisma.gameSeason.findUnique({
      where: { id: gate.seasonId },
      select: { startsAt: true, endsAt: true, recap: true },
    }),
    // Off the archive table, not through the season — SeasonChampion holds no
    // relation to GameSeason on purpose (see the model comment).
    prisma.seasonChampion.findMany({
      where: { seasonId: gate.seasonId },
      orderBy: { rank: "asc" },
      select: {
        rank: true,
        empireName: true,
        playerName: true,
        guildName: true,
        power: true,
        cities: true,
        heroLevel: true,
        prizeDiamonds: true,
      },
    }),
    getTunables(),
  ]);

  const recap = readRecap(season?.recap ?? null);
  const restarts = tunables.season.autoRestart >= 1;
  // The countdown ticks in server time — see SeasonCountdown.
  const now = new Date().getTime();

  return (
    <div dir="rtl" className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-6 lg:px-6">
      <OrnateFrame className="overflow-hidden p-3 sm:p-5 md:p-7">
        {/* -------- the sealed gate -------- */}
        <div className="ssn-gate">
          {EMBERS.map((e, i) => (
            <span
              key={i}
              aria-hidden
              className="ssn-ember"
              style={
                {
                  "--left": `${e.left}%`,
                  "--delay": `${e.delay}s`,
                  "--dur": `${e.dur}s`,
                  "--size": `${e.size}px`,
                } as CSSProperties
              }
            />
          ))}
          <span aria-hidden className="ssn-glow" />
          <div className="ssn-body space-y-4 py-8 text-center">
            <p className="ssn-kicker text-xs font-bold tracking-[0.3em] text-crimson-bright">
          {t("העונה הסתיימה")}
            </p>
            <h1 className="ssn-title text-3xl font-black text-gold-bright sm:text-4xl">
              {gate.seasonName}
            </h1>
            {season && (
              <p className="text-xs text-zinc-500">
                {formatDate(season.startsAt, locale)} — {formatDate(season.endsAt, locale)}
              </p>
            )}
            <p className="mx-auto max-w-xl text-sm text-zinc-400">
          {t("השערים נעולים. הדירוג הסופי נחתם ונכנס להיכל התהילה, ולא ניתן עוד לשנות דבר בעולם הזה.")}

            </p>
          </div>
        </div>

        {/* -------- the countdown -------- */}
        <div className="mt-6 rounded-xl border border-gold/25 bg-panel-inset px-4 py-5 text-center">
          {gate.nextStartsAt ? (
            <>
              <p className="mb-3 text-xs font-bold tracking-wide text-gold-dim">
                {gate.nextSeasonName
                ? t("{season} נפתחת בעוד", { season: gate.nextSeasonName })
                : t("העונה הבאה נפתחת בעוד")}
              </p>
              <SeasonCountdown
                serverNow={now}
                startsAt={gate.nextStartsAt.getTime()}
              />
              <p className="mt-3 text-[11px] text-zinc-500">
                {formatDate(gate.nextStartsAt, locale)}
              </p>
              {/* Said here, before it happens, and only when it is actually
                  going to: the restart is the single biggest thing about the
                  next season, and nobody should meet it as a surprise on the
                  first page load after the countdown hits zero. */}
              {restarts && (
                <p className="mt-3 text-xs text-zinc-400">
              {t("כשהשערים ייפתחו העולם יתאפס — כל אימפריה מתחילה מאפס והבריתות מתפרקות. רק היהלומים נשארים איתכם. 💎")}

                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-400">
            {t("מועד העונה הבאה טרם נקבע. חזרו לכאן בקרוב.")}
            </p>
          )}
        </div>

        {/* -------- the podium -------- */}
        {champions.length > 0 && (
          <div className="mt-8">
          <SectionHeading title={t("אלופי העונה")} ornament="👑" />
            {/* Second place left, first in the middle, third right — the podium
                order, not the reading order, so the tallest step is central.
                `order` is a visual reshuffle only; the DOM stays 1-2-3 for a
                screen reader. */}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {champions.map((c) => (
                <div
                  key={c.rank}
                  style={{ "--i": c.rank - 1 } as CSSProperties}
                  className={`ssn-champ rounded-xl p-4 text-center ${
                    c.rank === 1
                      ? "panel-gold ssn-champ-first sm:order-2"
                      : c.rank === 2
                        ? "panel sm:order-1"
                        : "panel sm:order-3"
                  }`}
                >
                  <span aria-hidden className="ssn-medal block text-3xl">
                    {MEDALS[c.rank - 1]}
                  </span>
                  <p className="mt-2 truncate text-base font-bold text-gold-bright">
                    {c.empireName}
                  </p>
                  {c.playerName && (
                    <p className="truncate text-[11px] text-zinc-500">{c.playerName}</p>
                  )}
                  <p
                    className="nums mt-2 text-lg font-black text-zinc-100"
                    dir="ltr"
                    title={formatNumber(c.power)}
                  >
                    {formatCompact(c.power)}
                  </p>
                    <p className="text-[11px] text-zinc-500">{t("כוח צבאי")}</p>
                  {/* Only when it was actually credited: a champion whose empire
                      was already gone keeps his place and his record, but the
                      card must not claim he collected anything. */}
                  {c.prizeDiamonds > 0 && (
                    <p className="mt-2 flex items-center justify-center gap-1 text-sm font-bold text-cyan-300">
                      <Icon name="diamond" size={14} />
                      <span className="nums" dir="ltr">
                        {formatNumber(c.prizeDiamonds)}
                      </span>
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-zinc-400">
                    {t("{cities} ערים · גיבור {level}", { cities: c.cities, level: c.heroLevel })}
                    {c.guildName ? ` · ${c.guildName}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* -------- what happened this season -------- */}
        {recap && (
          <div className="mt-8 space-y-5">
          <SectionHeading title={t("העונה במספרים")} ornament="⚔" />
            <Totals totals={recap.totals} />

            {recap.boards.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {recap.boards.map((board, bi) => (
                  <div
                    key={board.key}
                    style={{ "--i": bi } as CSSProperties}
                    className="ssn-tally panel rounded-xl p-4"
                  >
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright">
                      <Icon
                        name={board.icon as IconName}
                        size={18}
                        className="text-crimson-bright"
                      />
                      {board.title}
                    </h3>
                    <ol className="space-y-2 text-sm">
                      {board.rows.map((row, i) => (
                        <li
                          key={`${row.name}-${i}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="nums w-4 shrink-0 text-xs text-zinc-600" dir="ltr">
                              {i + 1}
                            </span>
                            <span className="truncate text-zinc-200">{row.name}</span>
                          </span>
                          <span
                            className="nums shrink-0 text-xs font-bold text-gold"
                            dir="ltr"
                            title={row.note ?? formatNumber(row.value)}
                          >
                            {formatCompact(row.value)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!recap && champions.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500">
            {t("העונה נסגרה לפני שנרשמו בה תוצאות.")}
          </p>
        )}
      </OrnateFrame>
    </div>
  );
}
