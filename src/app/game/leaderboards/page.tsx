import Link from "next/link";
import type { ReactNode } from "react";
import { requireEmpire } from "@/lib/auth";
import {
  getGlobalBoards,
  getTheftBoard,
  getEnslavementBoard,
  type BoardRow,
} from "@/server/rankingsLadder";
import { formatNumber } from "@/lib/game/format";
import { cityFullName, cityName } from "@/lib/game/cities";
import { AutoRefresh } from "@/components/game/AutoRefresh";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { WornTitle } from "@/components/ui/WornTitle";
import { Tip } from "@/components/ui/Tip";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("טבלאות מובילים | KRALDOR") };
}

type Period = "day" | "week";

/**
 * Which city the row's empire sits in.
 *
 * These boards are the only ones in the game that cross cities — the ladder on
 * /game/rankings is one bucket, so there the city is a page-level fact printed
 * once in the header. Here every row can be somewhere else, and where a leader
 * stands is what decides whether the reader can spy on him or raid him at all.
 * `null` is a raider whose empire no longer exists (see BoardRow.cities).
 */
async function CityChip({ cities }: { cities: number | null }) {
  if (cities === null) return null;
  const t = await getT();
  // shrink-0 on the Tip wrapper too, not just the pill inside it: the wrapper
  // is the flex child, and without it the row squeezes the chip instead of
  // truncating the (already truncating) name.
  return (
    <Tip
      className="shrink-0"
      tip={t("{city} — ריגול ותקיפה אפשריים רק בתוך העיר שלך.", {
        city: cityFullName(t, cities),
      })}
    >
      <span className="shrink-0 cursor-help whitespace-nowrap rounded-full border border-border-subtle bg-panel-inset px-1.5 text-[10px] font-semibold text-zinc-400">
        <Icon name="base" size={10} className="inline-block align-middle text-crimson-bright" />{" "}
        {cityName(t, cities)}
      </span>
    </Tip>
  );
}

/** A single leaderboard, top players first. */
async function Board({
  title,
  icon,
  iconClass,
  unit,
  rows,
  myEmpireId,
  hideValue = false,
  empty,
}: {
  title: string;
  icon: IconName;
  iconClass: string;
  unit: ReactNode;
  rows: BoardRow[];
  myEmpireId: string;
  /** Rank the board by value but keep the actual number secret. */
  hideValue?: boolean;
  /**
   * What an empty board says. The four standing boards are empty only before
   * anyone has played at all, so the generic line does; the raid boards below
   * are empty every morning and need to say *why* — nobody has raided in this
   * window yet, which is news, not a missing board.
   */
  empty?: string;
}) {
  const t = await getT();
  return (
    <div className="panel-gold flex flex-col rounded-xl p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
        <Icon name={icon} size={18} className={iconClass} />
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty ?? t("אין נתונים עדיין.")}</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {rows.map((row, index) => {
            const isMe = row.empireId === myEmpireId;
            const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : null;
            return (
              <li
                key={row.empireId}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                  isMe ? "bg-gold/10" : "hover:bg-panel-raised/50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="nums w-5 shrink-0 text-center font-black text-gold" dir="ltr">
                    {medal ?? index + 1}
                  </span>
                  {/* Between the rank and the name, which on this RTL row puts it
                      hard against the start of the name. Bare dot, no word: these
                      rows are one line each and already carry a number and a
                      unit — the tooltip says it in words for anyone who cannot
                      read the colour. `isMe` is forced on: the viewer is by
                      definition at the keyboard, and his own heartbeat may be up
                      to PRESENCE_TOUCH_MS stale, which would draw him away on
                      his own board. */}
                  <PresenceDot online={isMe || row.online} />
                  <Link
                    href={`/game/empires/${row.empireId}`}
                    className="truncate font-semibold text-zinc-100 underline-offset-4 hover:text-gold-bright hover:underline"
                  >
                    {row.name}
                  </Link>
                  {/* Outside the link, so the ellipsis that truncates a long
                      name on a narrow board never eats the תואר. These are the
                      six global boards — the shortest list in the game and the
                      one most worth being named on — which is exactly where a
                      title is supposed to be legible. */}
                  <WornTitle titleKey={row.title} />
                  {isMe && (
                    <span className="shrink-0 rounded-full bg-gold/15 px-1.5 text-[10px] font-bold text-gold">
                        {t("את/ה")}
                    </span>
                  )}
                  <CityChip cities={row.cities} />
                </span>
                {!hideValue && (
                  <span className="nums inline-flex shrink-0 items-center gap-1 font-bold text-gold-bright" dir="ltr">
                    {formatNumber(row.value)} {unit}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Cutoff timestamp for the raid window — local midnight, or seven days back. */
function raidCutoff(period: Period): Date {
  const now = new Date();
  return period === "day"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ theft?: string }>;
}) {
  const t = await getT();
  const myEmpire = await requireEmpire();
  const { theft } = await searchParams;
  const period: Period = theft === "day" ? "day" : "week";

  // Every board here is GLOBAL — ranked across the whole game, not scoped to a
  // single city like the /game/rankings list.
  //
  // All six boards are live — no cache anywhere behind them. They used to sit
  // behind a 20-second TTL, because `spy` and `power` were JS figures: the
  // top-N cut could not move into SQL and every read was a full scan of Empire
  // plus its armies and arsenals, on every load and again every 30s per open tab
  // with no rate limit on RSC GETs. Now all six are indexed `ORDER BY … LIMIT 5`
  // (or one aggregate), so thirty rows come back instead of the table and a
  // balance that moved a second ago is already on the board.
  const cutoff = raidCutoff(period);
  const [boards, theftRows, enslavementRows] = await Promise.all([
    getGlobalBoards(),
    getTheftBoard(cutoff),
    getEnslavementBoard(cutoff),
  ]);

  return (
    <div className="space-y-6">
      {/* Balances, slaves and plunder all shift constantly — keep the boards live. */}
      <AutoRefresh intervalMs={30_000} />
      <SectionHeading
        title={t("טבלאות מובילים")}
        ornament={<Icon name="rankings" size={22} className="text-crimson" />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* The scope note earns its keep now that the rows name cities: these
            boards cross the whole game, so the leader on them is usually
            somewhere you cannot reach. */}
        <p className="text-xs text-zinc-400">
            {t("דירוג גלובלי על פני כל השחקנים במשחק — ליד כל שם מופיעה העיר שבה הוא יושב.")}
        </p>
        <Link href="/game/rankings" className="btn btn-ghost px-4 py-2 text-sm">
            <Icon name="base" size={16} className="inline-block align-middle" /> {t("דירוג העיר שלי")}
        </Link>
      </div>

      {/* Overall power leads: it is the one board that answers "who is winning
          the game", and the three under it are each a single facet of it. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Board
          title={t("כוח כללי")}
          icon="spark"
          iconClass="text-gold-bright"
          unit={<Icon name="spark" size={13} className="inline-block align-middle" />}
          rows={boards.power}
          myEmpireId={myEmpire.id}
          hideValue
        />
        <Board
          title={t("עבדים")}
          icon="mine"
          iconClass="text-crimson-bright"
          unit={<Icon name="mine" size={13} className="inline-block align-middle" />}
          rows={boards.slaves}
          myEmpireId={myEmpire.id}
          hideValue
        />
        <Board
          title={t("הבנק הגדול ביותר")}
          icon="bank"
          iconClass="text-gold-bright"
          unit={<Icon name="gold" size={13} className="inline-block align-middle text-gold-bright" />}
          rows={boards.bank}
          myEmpireId={myEmpire.id}
          hideValue
        />
        <Board
          title={t("הריגול הגבוה ביותר")}
          icon="spy"
          iconClass="text-crimson-bright"
          unit={<Icon name="spy" size={13} className="inline-block align-middle" />}
          rows={boards.spy}
          myEmpireId={myEmpire.id}
          hideValue
        />
      </div>

      {/* -------- the raid boards: what was taken off other players --------
          Both are grouped off BattleReport over the same window, so they share
          one today / this-week toggle rather than carrying one each — two
          toggles side by side that must agree to be readable is a way to
          confuse the page, not a feature. Unlike the four standing boards
          above these print their figures: they count blows already reported to
          both sides, so the number is public by the time it lands here. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-400">
            {t("מי לוקח הכי הרבה משחקנים אחרים — זהב שנשדד וחיילים שנשבו בתקיפות מנצחות.")}
          </p>
          <div className="flex gap-1.5">
            <Link
              href="/game/leaderboards?theft=day"
              className={`btn px-3 py-1.5 text-xs ${period === "day" ? "btn-gold" : "btn-ghost"}`}
            >
              {t("היום")}
            </Link>
            <Link
              href="/game/leaderboards?theft=week"
              className={`btn px-3 py-1.5 text-xs ${period === "week" ? "btn-gold" : "btn-ghost"}`}
            >
              {t("השבוע")}
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Board
            title={t("הגניבות הגדולות ביותר")}
            icon="attack"
            iconClass="text-crimson-bright"
            unit={<Icon name="gold" size={13} className="inline-block align-middle text-gold-bright" />}
            rows={theftRows}
            myEmpireId={myEmpire.id}
            empty={period === "day" ? t("לא נגנב זהב היום עדיין.") : t("לא נגנב זהב השבוע עדיין.")}
          />
          <Board
            title={t("השיעבודים הגדולים ביותר")}
            icon="mine"
            iconClass="text-crimson-bright"
            unit={<Icon name="mine" size={13} className="inline-block align-middle" />}
            rows={enslavementRows}
            myEmpireId={myEmpire.id}
            empty={
              period === "day"
                ? t("לא שועבדו חיילים היום עדיין.")
                : t("לא שועבדו חיילים השבוע עדיין.")
            }
          />
        </div>
      </div>
    </div>
  );
}
