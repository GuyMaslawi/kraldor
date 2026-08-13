import type { CSSProperties } from "react";
import Link from "next/link";
import { requireEmpire } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCityLadderPage } from "@/server/rankingsLadder";
import { getHallOfFame } from "@/server/seasonClose";
import { GUILD_ROLE_META } from "@/lib/game/guild";
import { formatCompact, formatDate, formatNumber } from "@/lib/game/format";
import { cityFullName, cityName } from "@/lib/game/cities";
import { AutoRefresh } from "@/components/game/AutoRefresh";
import { CityBossBanner } from "@/components/game/CityBossBanner";
import { ShieldBadges } from "@/components/game/ShieldBadges";
import { getShieldsForEmpires, shieldFlags } from "@/lib/game/diamondEffects";
import { getCityBossState } from "@/server/bossState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { WornTitle } from "@/components/ui/WornTitle";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("דירוג | קראלדור") };
}

/** Page links to draw around the current one, either side. */
const PAGER_SPREAD = 2;

/**
 * The ladder's pager. Plain links, so a page survives a reload, a shared URL
 * and the 30-second AutoRefresh (which re-fetches the current URL rather than
 * resetting to the top).
 *
 * "הדף שלי" is the one control that matters on a long ladder: once the table
 * shows ten rows at a time, an empire ranked 140th is fourteen clicks from
 * home, and the page it lives on changes as other players rise and fall.
 */
async function Pager({
  page,
  pageCount,
  myPage,
}: {
  page: number;
  pageCount: number;
  myPage: number;
}) {
  const t = await getT();
  if (pageCount <= 1) return null;

  const href = (n: number) => `/game/rankings?page=${n}`;
  const first = Math.max(1, Math.min(page - PAGER_SPREAD, pageCount - PAGER_SPREAD * 2));
  const last = Math.min(pageCount, Math.max(page + PAGER_SPREAD, PAGER_SPREAD * 2 + 1));
  const numbers = [];
  for (let n = first; n <= last; n++) numbers.push(n);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3">
      <span className="text-[11px] text-zinc-500">
        {t("עמוד")}{" "}
        <span className="nums font-bold text-gold-bright" dir="ltr">
          {page}
        </span>{" "}
        {t("מתוך")}{" "}
        <span className="nums font-bold text-zinc-300" dir="ltr">
          {pageCount}
        </span>
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {page > 1 && (
          <Link href={href(page - 1)} className="btn btn-ghost px-2.5 py-1 text-xs">
            {t("← הקודם")}
          </Link>
        )}
        {first > 1 && <span className="px-1 text-xs text-zinc-600">…</span>}
        {numbers.map((n) => (
          <Link
            key={n}
            href={href(n)}
            aria-current={n === page ? "page" : undefined}
            className={`nums rounded-md border px-2.5 py-1 text-xs font-bold ${
              n === page
                ? "border-gold/60 bg-gold/15 text-gold-bright"
                : "border-border-subtle text-zinc-400 hover:border-gold/40 hover:text-gold"
            }`}
            dir="ltr"
          >
            {n}
          </Link>
        ))}
        {last < pageCount && <span className="px-1 text-xs text-zinc-600">…</span>}
        {page < pageCount && (
          <Link href={href(page + 1)} className="btn btn-ghost px-2.5 py-1 text-xs">
            {t("הבא →")}
          </Link>
        )}
        {page !== myPage && (
          <Link href={href(myPage)} className="btn btn-ghost px-2.5 py-1 text-xs text-gold">
            <Icon name="crown" size={13} className="inline-block align-middle" /> {t("הדף שלי")}
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { t, locale } = await getI18n();
  const myEmpire = await requireEmpire();
  const requestedPage = Number((await searchParams).page);

  // The ranking is confined to your own city — you only see (and may attack or
  // spy) empires that hold the same number of cities as you.
  const myCity = myEmpire.cities;
  // The bucket *is* one city, so every row on this page belongs to this one.
  const myCityName = cityName(t, myCity);

  // The game clock is lazy — every empire settles its own backlog when its owner
  // loads a page or acts. We deliberately do NOT settle other empires here:
  // doing so meant one rankings view could fire a heavy multi-query settle for
  // every stale empire in the city at once (a thundering herd right after each
  // 07:30 / 19:30 daily boundary, when all of them are stale), which could
  // exhaust the connection pool and stall the whole app. Offline players show
  // their last-settled gold until they next log in — it self-heals on their next
  // load, and the numbers shown here (gold/soldiers) drift only slowly anyway.
  // The city boss headlines this screen — it is the one target on the page
  // that everyone in the city shares, so it belongs above the ladder.
  const bossState = await getCityBossState(myEmpire);

  // Live — nothing on this ladder is cached. Ranked, counted and cut in SQL, so
  // it costs ten rows rather than the city bucket and an army trained a second
  // ago is already on it, yours or anyone else's. requireEmpire has just settled
  // this empire, so its own row is current before the ladder even reads it. See
  // the header of server/rankingsLadder.ts.
  const {
    rows: visible,
    total,
    myRank,
    page,
    pageCount,
    myPage,
    firstRank,
  } = await getCityLadderPage(myCity, myEmpire.id, requestedPage);

  // Raid shields and guild names for the rows actually rendered — scoped to the
  // ten visible rows rather than the whole bucket. The guild column shipped as
  // a hard-coded dash captioned "until alliances land on the ladder"; alliances
  // landed, and the column kept saying nobody was in one.
  const [shieldsByEmpire, guildRows, hall] = await Promise.all([
    getShieldsForEmpires(visible.map((e) => e.id)),
    prisma.guildMember.findMany({
      where: { empireId: { in: visible.map((e) => e.id) } },
      select: {
        empireId: true,
        guildId: true,
        role: true,
        guild: { select: { name: true } },
      },
    }),
    // The archive: the three boards of the last season that ended. Frozen data
    // — it moves a handful of times a year, not twice a minute, and the season
    // being played never touches it.
    getHallOfFame(),
  ]);
  const guildByEmpire = new Map(guildRows.map((row) => [row.empireId, row]));

  return (
    <div className="space-y-6">
      {/* Other players train, attack and rise in rank — keep the table live. */}
      <AutoRefresh intervalMs={30_000} />
        <SectionHeading title={t("דירוג")} ornament={<Icon name="rankings" size={22} className="text-crimson" />} />

      {/* -------- city boss -------- */}
      <CityBossBanner state={bossState} cities={myCity} />

      {/* -------- leaderboard -------- */}
      {/* The status strip, the cross-game link and the scope note all used to be
          separate full-width blocks between the boss and the table; folded into
          the table's own header they cost one row instead of four. The
          horizontal scroll sits on the table wrapper rather than the panel —
          on the panel it would also clip that header's tooltip. */}
      <div className="panel-gold rounded-xl p-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="rankings" size={20} className="text-crimson-bright" />
            {/* Was "דירוג לפי ואלקריה" — a name left over from an early
                prototype that referred to nothing in the game. The ladder is
                one city's, so it is named after that city. */}
              {t("דירוג {city}", { city: myCityName })}
              <Tip tip={t("{city} — הדירוג מציג רק את האימפריות בעיר שלך. ניתן לרגל ולתקוף רק אימפריות בעיר שלך.", { city: cityFullName(t, myCity) })}>
              <span className="cursor-help rounded-full border border-border-subtle bg-panel-inset px-2 py-0.5 text-[11px] font-normal text-zinc-300">
                <Icon name="base" size={12} className="inline-block align-middle text-crimson-bright" />{" "}
                {t("עיר")}{" "}
                <span className="nums font-bold text-gold-bright" dir="ltr">
                  {myCity}
                </span>{" "}
                ·{" "}
                <span className="nums font-bold text-emerald-400" dir="ltr">
                  {total}
                </span>{" "}
                {t("אימפריות")}
              </span>
            </Tip>
          </h2>
          {/* Wraps: the rank readout and a link do not always fit one phone line.
              The presence and shield legends that used to sit here are gone —
              every mark on a row now explains itself where it stands (in words,
              or in its own tooltip), so the key only repeated itself. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs text-zinc-400">
              {t("הדירוג שלך:")}{" "}
              <span className="nums font-bold text-gold-bright" dir="ltr">
                {myRank}
              </span>
            </span>
            {/* Interaction is city-scoped; the cross-game boards live on their own page. */}
            <Link href="/game/leaderboards" className="btn btn-ghost px-3 py-1.5 text-xs">
            <Icon name="rankings" size={14} className="inline-block align-middle" /> {t("טבלאות מובילים")}
            </Link>
          </div>
        </div>
        {/* The 640px floor is a desktop measure. On a phone it hid 300 of the
            table's 640px behind a silent sideways scroll — the loot and the
            garrison, which is the whole reason anyone reads this ladder. Below
            sm the table fits the screen instead: tighter cells, and the guild
            column (a placeholder dash until alliances land on the ladder) sits
            the round out. */}
        <div className="overflow-x-auto rounded-b-xl">
          <table className="w-full text-sm sm:min-w-[640px]">
            <thead>
              <tr className="border-y border-border-subtle text-right text-xs text-gold-dim">
                <th className="px-2 py-2.5 font-semibold sm:px-4">#</th>
                <th className="px-2 py-2.5 font-semibold sm:px-4">{t("שם הצבא")}</th>
                <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">{t("ברית")}</th>
                <th className="px-2 py-2.5 font-semibold sm:px-4">{t("זהב")}</th>
                <th className="px-2 py-2.5 font-semibold sm:px-4">{t("חיילים")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((empire, index) => {
                const isMe = empire.id === myEmpire.id;
                const guildMember = guildByEmpire.get(empire.id);
                const guildRole = guildMember
                  ? GUILD_ROLE_META[guildMember.role]
                  : null;
                // Rank is the position in the whole ladder, not on this page —
                // page 2 starts at 11, and the medals stay with the top three
                // wherever the reader happens to be standing.
                const rank = firstRank + index;
                const medal =
                  rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
                return (
                  /* The rows deal in top-down (`--i`), and your own keeps a
                     slow gold beat so paging back to it finds it at a glance. */
                  <tr
                    key={empire.id}
                    style={{ "--i": index } as CSSProperties}
                    className={`ldr-row border-b border-border-subtle last:border-b-0 ${
                      isMe ? "is-me bg-gold/5" : "hover:bg-panel-raised/50"
                    }`}
                  >
                    <td className="px-2 py-3 sm:px-4">
                      <span className="nums font-black text-gold" dir="ltr">
                        {medal ? (
                          <span
                            className="ldr-medal"
                            style={{ "--i": rank - 1 } as CSSProperties}
                          >
                            {medal}
                          </span>
                        ) : (
                          rank
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span
                          className="ldr-crest flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/40 bg-gradient-to-b from-gold-deep/40 to-black text-lg"
                          style={{ "--i": index } as CSSProperties}
                        >
                          <Icon name="crown" size={20} className="text-bone" />
                        </span>
                        <div className="min-w-0">
                          {/* Is this player at the keyboard right now? On a board
                              people read to pick targets that is the first thing
                              worth knowing — an offline empire cannot move its
                              gold to the bank or answer the raid — so it is
                              pinned to the name itself rather than buried in the
                              meta line below, where it used to sit as a word and
                              wrapped away on a phone. Placed before the name in
                              the DOM, which on this RTL row draws it at the
                              name's right edge; the tooltip still says it in
                              words for anyone who cannot read the colour. */}
                          <PresenceDot online={empire.online} />{" "}
                          <Link
                            href={`/game/empires/${empire.id}`}
                            className="font-bold text-zinc-100 underline-offset-4 hover:text-gold-bright hover:underline"
                          >
                            {empire.name}
                          </Link>{" "}
                          {/* The תואר, straight after the name and before the
                              level — a ladder is read name, then who they are,
                              then how big. Cosmetic only, and it is the whole
                              point of the feature that it be *here*: a title
                              nobody but its owner ever saw would have been worth
                              nothing. Renders nothing at all for the players
                              wearing none, which on most rows is what happens. */}
                          <WornTitle titleKey={empire.title} className="me-1" />{" "}
                          {/* The level beside the name is the *hero* level —
                              the only one that moves. It used to print
                              `empire.level`, a column no gameplay path ever
                              increments: it read "רמה 1" for every real player
                              and whatever number an admin (or a fixture) had
                              typed for the rest, which is worse than useless on
                              a ladder people read to pick targets. It says just
                              "רמה" and not "גיבור רמה": there is one level in
                              this game and it is the hero's, so the word only
                              cost width. */}
                          {/* nowrap: the name line is a wrapping inline flow, and
                              with a תואר now sitting in it "רמה" and its number
                              were landing on two different lines on a phone. The
                              pair is one token to a reader — it breaks before it,
                              never inside it. */}
                          <span className="nums whitespace-nowrap text-xs text-gold-dim">
                            {t("רמה")}{" "}
                            <span className="font-bold text-gold-bright">
                              {empire.hero?.level ?? 1}
                            </span>
                          </span>
                          {/* Prestige rides along with the level, because that
                              is what it modifies: a level 40 with ↻3 is a very
                              different target from a level 40 without. Glyph
                              only — the word "איפוס" doubled the pill's width on
                              every row, and the tooltip teaches it once. */}
                          {(empire.hero?.resets ?? 0) > 0 && (
                            <Tip
                              tip={t("תג איפוס: הגיבור הגיע לרמה 100 ואופס {times}. כל איפוס מוסיף +25% ליוקרה שלו.", {
                                times:
                                  empire.hero!.resets === 1
                                    ? t("פעם אחת")
                                    : t("{count} פעמים", { count: empire.hero!.resets }),
                              })}




                            >
                              <span
                                className="nums mr-1 cursor-help rounded border border-purple-400/50 bg-purple-950/60 px-1 text-[10px] font-black text-purple-300 align-middle"
                                dir="ltr"
                              >
                                ↻{empire.hero!.resets}
                              </span>
                            </Tip>
                          )}
                          {isMe && (
                            <span className="mr-1.5 whitespace-nowrap rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-gold">
                              {t("הצבא שלך")}
                            </span>
                          )}
                          {/* One readable line under the name. It used to be a
                              row of icon-only pills — a sword that meant "hero
                              level" (and read as attack power), a ↻ counter, a
                              hard-coded 100♥ the ladder never actually loaded,
                              and a two-icon shield rebus. What stayed says what
                              it is in words; the shield is the one exception,
                              and it explains itself in a tooltip. */}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 empty:mt-0">
                            {/* Everyone on this ladder holds the same number of
                                cities — that is what the bucket *is* — so the
                                city under each name is the same one. It is
                                still worth printing: it names the place the
                                whole page is about, right where the reader is
                                looking, instead of only in the header pill. */}
                            <span className="text-zinc-400">
                              {t("עיר")}{" "}
                              <span className="font-bold text-bone">
                                {myCityName}
                              </span>
                            </span>
                            {/* The guild has its own column, but that column is
                                one of the two the narrow layout drops — so on a
                                phone it rides here instead of vanishing. */}
                            {guildMember && guildRole && (
                              <span className="text-gold sm:hidden">
                                <span aria-hidden>{guildRole.icon}</span>{" "}
                                <span className="font-bold">
                                  {guildMember.guild.name}
                                </span>
                              </span>
                            )}
                            {/* Paid raid shields — worth knowing before you
                                spend turns on a target whose loot is locked.
                                Icon-only: which shield it is rides in the tint
                                and the tooltip, so a row that mostly does not
                                have one does not pay for the ones that do. */}
                            <ShieldBadges
                              shields={shieldFlags(shieldsByEmpire.get(empire.id))}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {guildMember && guildRole ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-semibold text-gold"
                          title={t("{role} בברית {guild}", { role: t(guildRole.label), guild: guildMember.guild.name })}
                        >
                          <span aria-hidden>{guildRole.icon}</span>
                          {guildMember.guild.name}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      {/* Compact on a phone, exact from sm up: the digits are
                          what you compare targets by, but four columns only fit
                          in 338px if the numbers give the name room. */}
                      <span
                        className="nums inline-flex items-center gap-1 font-bold text-gold-bright"
                        dir="ltr"
                      >
                        <span className="sm:hidden">{formatCompact(Math.floor(empire.gold))}</span>
                        <span className="hidden sm:inline">{formatNumber(Math.floor(empire.gold))}</span>
                        <Icon name="gold" size={14} className="inline-block align-middle text-gold-bright" />
                      </span>
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      <span className="nums text-zinc-300" dir="ltr">
                        <span className="sm:hidden">{formatCompact(empire.army?.soldiers ?? 0)}</span>
                        <span className="hidden sm:inline">{formatNumber(empire.army?.soldiers ?? 0)}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pager page={page} pageCount={pageCount} myPage={myPage} />
      </div>

      {/* -------- hall of fame: last season's three boards -------- */}
      {/* Deliberately static, and deliberately *not* about the season being
          played. Every figure is read off the SeasonBoardEntry archive, written
          once when a season's clock ran out (see server/seasonClose.ts) — the
          live ladder above can change every minute without moving a number
          here. The empires named may not even exist any more, because a season
          reset deletes them all. */}
      <div>
        <h2 className="mb-1 flex items-center justify-center gap-2 text-base font-bold tracking-wide text-gold-bright">
          <Icon name="crown" size={20} className="text-crimson-bright" />
            {t("היכל התהילה")}
        </h2>
        <p className="mb-3 text-center text-[11px] text-zinc-500">
          {hall ? (
            <>
              {t("כך הסתיימה")}{" "}
              <span className="font-bold text-gold-dim">{hall.seasonName}</span>{" "}
              {t("ב־{date}. העונה הנוכחית אינה משפיעה על הלוחות האלה — הם נחרתו ברגע שהעונה ננעלה.", { date: formatDate(hall.endsAt, locale) })}


            </>
          ) : (
            t("מתעדכן פעם אחת, בסיום כל עונה.")
          )}
        </p>

        {!hall ? (
          <div className="panel rounded-xl p-6 text-center">
            <p className="text-sm text-zinc-500">
              {t("עוד לא הסתיימה אף עונה. הלוחות הראשונים ייחרתו כאן בסיום העונה הנוכחית.")}

            </p>
          </div>
        ) : (
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
                    <li
                      key={row.rank}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden className="w-4 shrink-0 text-center">
                          {row.rank === 1
                            ? "🥇"
                            : row.rank === 2
                              ? "🥈"
                              : row.rank === 3
                                ? "🥉"
                                : (
                                  <span className="nums text-[11px] text-zinc-600" dir="ltr">
                                    {row.rank}
                                  </span>
                                )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-zinc-100">
                            <PlayerLink empireId={row.empireId} name={row.name} />
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
        )}
      </div>
    </div>
  );
}
