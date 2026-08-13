import type { CSSProperties } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getHallOfFame } from "@/server/seasonClose";
import { formatCompact, formatDate, formatNumber } from "@/lib/game/format";
import { PublicShell } from "@/components/public/PublicShell";
import { Icon, type IconName } from "@/components/ui/Icon";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t("היכל התהילה | קראלדור"),
    description: t("האלופים של העונות שהסתיימו בקראלדור — פודיום ושלושת לוחות התהילה."),
  };
}

export const dynamic = "force-dynamic";

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * היכל התהילה, in public.
 *
 * The same three archived boards the rankings screen shows a player (see
 * `getHallOfFame`), plus the podium of the season they belong to — published
 * where a stranger can read them, because "who won last season" is the one thing
 * about a competitive game that is worth seeing before you decide to play it,
 * and it is the only page on the site that can honestly answer "is anybody
 * actually here".
 *
 * Every figure is read off the frozen archive, never off a live empire: those
 * rows are written once when a season's clock runs out and survive the reset
 * that deletes every empire in the game. So this page is safe to publish at any
 * moment of a season's life — it cannot leak the running ladder, because it
 * does not know it exists.
 *
 * Names are plain text rather than profile links. On the player's copy they open
 * a dossier at `/game/empires/…`; here that route would bounce a stranger to the
 * login, and half of the empires named do not exist any more anyway.
 */
export default async function PublicHallPage() {
  const { t, locale } = await getI18n();
  const hall = await getHallOfFame();

  // The podium of the same season the boards came from — one indexed read off
  // the archive, and skipped entirely when no season has finished yet.
  const champions = hall
    ? await prisma.seasonChampion.findMany({
        where: { seasonId: hall.seasonId },
        orderBy: { rank: "asc" },
        take: 3,
        select: {
          rank: true,
          empireName: true,
          playerName: true,
          guildName: true,
          power: true,
          cities: true,
          heroLevel: true,
        },
      })
    : [];

  return (
    <PublicShell
      title={t("היכל התהילה")}
      subtitle={
        hall
          ? t("כך הסתיימה {season}, ב־{date}. הלוחות נחרתו ברגע שהעונה ננעלה ואינם משתנים עוד.", {
              season: hall.seasonName,
              date: formatDate(hall.endsAt, locale),
            })
          : t("כאן ייחרתו האלופים ברגע שהעונה הראשונה תסתיים.")
      }
    >
      {!hall ? (
        <div className="panel rounded-xl p-8 text-center">
          <p className="text-sm text-zinc-400">
            {t("עוד לא הסתיימה אף עונה. הלוחות הראשונים ייחרתו כאן בסיום העונה הנוכחית.")}
          </p>
          <Link href="/register" className="btn btn-gold mt-4 inline-block px-6 py-2 text-sm">
            {t("הצטרף לעונה הראשונה")}
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* -------- the podium -------- */}
          {champions.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center justify-center gap-2 text-base font-bold tracking-wide text-gold-bright">
                <Icon name="crown" size={20} className="text-crimson-bright" />
                {t("פודיום העונה")}
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {champions.map((champion, i) => (
                  <div
                    key={champion.rank}
                    style={{ "--i": i } as CSSProperties}
                    className={`ldr-podium panel-gold rounded-xl p-4 text-center ${
                      champion.rank === 1 ? "sm:-mt-2" : ""
                    }`}
                  >
                    <span aria-hidden className="block text-2xl">
                      {MEDALS[champion.rank - 1] ?? champion.rank}
                    </span>
                    <p className="mt-1 truncate text-sm font-black text-gold-bright">
                      {champion.empireName}
                    </p>
                    {(champion.playerName || champion.guildName) && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {[champion.playerName, champion.guildName]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    <dl className="mt-3 grid grid-cols-3 gap-1 text-[11px]">
                      <div>
                        <dt className="text-zinc-500">{t("כוח")}</dt>
                        <dd className="nums font-bold text-gold" dir="ltr" title={formatNumber(champion.power)}>
                          {formatCompact(champion.power)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">{t("ערים")}</dt>
                        <dd className="nums font-bold text-bone" dir="ltr">
                          {champion.cities}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">{t("גיבור")}</dt>
                        <dd className="nums font-bold text-bone" dir="ltr">
                          {champion.heroLevel}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* -------- the three boards -------- */}
          <section>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {hall.boards.map((board, bi) => (
                <div
                  key={board.kind}
                  style={{ "--i": bi } as CSSProperties}
                  className="ldr-podium panel-gold rounded-xl p-4"
                >
                  <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-border-subtle pb-2">
                    <h3 className="flex items-center gap-1.5 truncate text-sm font-bold text-gold-bright">
                      <Icon
                        name={board.icon as IconName}
                        size={16}
                        className="shrink-0 text-crimson-bright"
                      />
                      {t(board.title)}
                    </h3>
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {t(board.unit)}
                    </span>
                  </div>
                  <ol className="space-y-2 text-sm">
                    {board.rows.map((row) => (
                      <li key={row.rank} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span aria-hidden className="w-4 shrink-0 text-center">
                            {MEDALS[row.rank - 1] ?? (
                              <span className="nums text-[11px] text-zinc-600" dir="ltr">
                                {row.rank}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-zinc-100">
                              {row.name}
                            </span>
                            {(row.playerName || row.note) && (
                              <span className="block truncate text-[10px] text-zinc-500">
                                {[row.playerName, row.note].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                        </span>
                        <span
                          className="nums shrink-0 font-bold text-gold"
                          dir="ltr"
                          title={formatNumber(row.value)}
                        >
                          {formatCompact(row.value)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </PublicShell>
  );
}
