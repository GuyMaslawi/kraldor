"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { Meter } from "@/components/ui/Meter";
import { Tip } from "@/components/ui/Tip";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNumber, formatCompact } from "@/lib/game/format";
import { REWARD_ICON, REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import { STREAK_CYCLE_DAYS } from "@/lib/game/streak";
import type { MissionBoardState, MissionView } from "@/lib/game/missions";
import type { GuildContractView } from "@/lib/game/guildContract";
import type { DailyState, StreakState } from "@/server/dailyState";
import {
  claimMission,
  claimStreak,
  collectGuildContract,
} from "@/server/actions/daily";
import { useT } from "@/i18n/client";

/**
 * לוח היום — the muster roll, the two mission boards and the guild contract, on
 * one screen.
 *
 * One client component for all four panels rather than four, because they share
 * exactly one thing and it is the thing that matters: a **countdown to the
 * reset**. Every panel here is worthless the moment its period turns over, and
 * a page that quietly keeps offering yesterday's board is the worst failure
 * this screen has. The timer below is what refreshes the route when a boundary
 * passes, and it can only be written once.
 *
 * Everything else is server-rendered state passed straight in. The claims are
 * server actions that revalidate the layout, so a collected mission, the
 * resources it paid and the nav badge all move together without any of it being
 * mirrored in local state.
 *
 * `serverNow` is threaded in from the page rather than read here. Two reasons,
 * and both are load-bearing: `Date.now()` during render is impure (the server
 * pass and the hydration pass disagree, and React says so), and the reader's
 * own clock cannot be trusted to agree with the boundary the *server* will
 * enforce — a device an hour fast would refresh in a loop.
 */
export function DailyBoard({
  state,
  serverNow,
}: {
  state: DailyState;
  /** The server's clock at render, epoch ms. */
  serverNow: number;
}) {
  const t = useT();
  return (
    <div className="space-y-6">
      <StreakCard streak={state.streak} serverNow={serverNow} />
      {state.contract && <ContractCard contract={state.contract} />}
      <MissionPanel
        board={state.day}
        serverNow={serverNow}
        title={t("משימות היום")}
        blurb={t("שלוש משימות, נבחרות מחדש בכל יום בחצות. הן נמדדות ממתי שהלוח נפתח — לא מתחילת היום.")}
      />
      <MissionPanel
        board={state.week}
        serverNow={serverNow}
        title={t("משימות השבוע")}
        blurb={t("שלוש משימות גדולות יותר, נבחרות מחדש בכל יום ראשון בחצות.")}
      />
    </div>
  );
}

/* ------------------------------ shared bits ------------------------------ */

/**
 * A purse as a row of chips. Icons rather than words for the amount's unit,
 * with the word in the tooltip — a mission row has to fit three of these
 * beside a progress bar on a phone.
 */
function RewardChips({ rewards, size = "sm" }: { rewards: readonly Reward[]; size?: "sm" | "md" }) {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {rewards.map((r) => (
        <Tip key={r.kind} tip={t(REWARD_LABEL[r.kind])}>
          <span
            className={`inline-flex items-center gap-1 rounded border border-border-subtle bg-black/30 font-bold nums text-bone/90 ${
              size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 text-[10px]"
            }`}
            dir="ltr"
          >
            <Icon name={REWARD_ICON[r.kind]} size={size === "md" ? 13 : 11} />
            {formatCompact(r.amount)}
          </span>
        </Tip>
      ))}
    </span>
  );
}

/**
 * The wait until a board is swept, ticking in the browser — and the reload when
 * it reaches zero.
 *
 * The reload is the point. Every panel on this screen is scoped to a period,
 * and a tab left open across midnight would otherwise keep offering a board
 * whose claims the server now refuses, with no explanation on screen. Rather
 * than reason about which panel expired, the whole route is refreshed: the
 * server is the only thing that knows what today's board is.
 *
 * `serverNow` rather than the browser's clock: a device with a skewed clock
 * would otherwise refresh in a loop, or never.
 */
function ResetCountdown({ at, serverNow }: { at: number; serverNow: number }) {
  const t = useT();
  const [left, setLeft] = useState(() => at - serverNow);

  useEffect(() => {
    const skew = Date.now() - serverNow;
    const tick = () => setLeft(at - (Date.now() - skew));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [at, serverNow]);

  useEffect(() => {
    if (left > 0) return;
    // A whole-document reload rather than router.refresh(): the boards, the
    // streak card and the resource bar all have to come back from the same
    // request, and this fires at most once per period.
    const id = setTimeout(() => window.location.reload(), 1_500);
    return () => clearTimeout(id);
  }, [left]);

  if (left <= 0) return <span className="text-zinc-500">{t("מתחדש…")}</span>;

  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return (
    <span className="nums text-zinc-500" dir="ltr">
      {hours > 0
        ? t("{h}ש {m}ד", { h: hours, m: minutes })
        : t("{m}ד", { m: Math.max(1, minutes) })}
    </span>
  );
}

/* ------------------------------ the muster roll ------------------------------ */

function StreakCard({
  streak,
  serverNow,
}: {
  streak: StreakState;
  serverNow: number;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  const sign = () => {
    setMessage({});
    startTransition(async () => {
      const result = await claimStreak();
      setMessage({ error: result.error, success: result.success });
    });
  };

  return (
    <section className="streak-scene panel-gold rounded-2xl p-4 sm:p-5">
      <span className="streak-rays" aria-hidden />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
            <Icon name="laurel" size={20} className="text-crimson-bright" />
            {t("מפקד הנאמנים")}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {t("חתום על המפקד פעם ביום. יום שמפוספס מאפס את הרצף — ולא את השיא.")}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Tip tip={t("ימים רצופים שבהם חתמת על המפקד")}>
            <span className="text-center">
              <span className="block text-2xl font-black nums text-gold-bright">
                {streak.count}
              </span>
              <span className="block text-[10px] font-bold text-zinc-500">
                {t("ברצף")}
              </span>
            </span>
          </Tip>
          <Tip tip={t("הרצף הארוך ביותר שהיה לך אי־פעם")}>
            <span className="text-center">
              <span className="block text-2xl font-black nums text-bone/70">
                {streak.best}
              </span>
              <span className="block text-[10px] font-bold text-zinc-500">
                {t("שיא")}
              </span>
            </span>
          </Tip>
        </div>
      </div>

      {/* The seven-day cycle. Every tile shows what it pays, so the seventh
          reads as a destination from day one rather than as a surprise. */}
      <ol className="relative mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {streak.ladder.map((rung) => {
          const current = rung.day === streak.nextCycleDay;
          const crown = rung.day === STREAK_CYCLE_DAYS;
          return (
            <li
              key={rung.day}
              style={{ "--i": rung.day } as CSSProperties}
              className={`streak-tile rounded-lg border p-2 text-center ${
                current
                  ? "streak-tile-live border-gold bg-gold/12"
                  : rung.passed
                    ? "border-emerald-700/50 bg-emerald-950/30"
                    : "border-border-subtle bg-black/25"
              }`}
            >
              <span
                className={`block text-[10px] font-black nums ${
                  crown ? "text-crimson-bright" : "text-zinc-500"
                }`}
              >
                {t("יום {day}", { day: rung.day })}
              </span>
              <span className="mt-1 flex flex-wrap justify-center gap-1">
                {rung.rewards.map((r) => (
                  <Tip
                    key={r.kind}
                    tip={`${formatNumber(r.amount)} ${t(REWARD_LABEL[r.kind])}`}
                  >
                    <span className="inline-flex">
                      <Icon
                        name={REWARD_ICON[r.kind]}
                        size={13}
                        className={rung.passed ? "opacity-50" : ""}
                      />
                    </span>
                  </Tip>
                ))}
              </span>
              {rung.passed && (
                <Icon
                  name="check"
                  size={12}
                  className="mx-auto mt-1 text-emerald-400"
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3">
        {streak.claimable ? (
          <span className="gleam-wrap">
            <button
              type="button"
              onClick={sign}
              disabled={pending}
              className={`btn btn-gold px-5 py-2 text-sm disabled:opacity-60${
                pending ? "" : " btn-gleam"
              }`}
            >
              {pending ? (
                t("חותם…")
              ) : (
                <>
                  <Icon name="check" size={16} />
                  {t("חתום על המפקד")}
                </>
              )}
            </button>
            {!pending && (
              <>
                <i className="gleam-spark gleam-spark-a" aria-hidden />
                <i className="gleam-spark gleam-spark-b" aria-hidden />
              </>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-4 py-2 text-sm font-bold text-emerald-300">
            <Icon name="check" size={16} />
            {t("חתמת היום")}
          </span>
        )}

        <span className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">{t("מתחדש בעוד")}</span>
          <ResetCountdown at={streak.resetsAt} serverNow={serverNow} />
        </span>
      </div>

      {streak.broken && streak.claimable && (
        <p className="relative mt-3 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {t("פספסת יום — החתימה הבאה מתחילה רצף חדש מיום 1.")}
        </p>
      )}

      <div className="relative mt-3">
        <FormMessage error={message.error} success={message.success} />
      </div>
    </section>
  );
}

/* ------------------------------ the guild contract ------------------------------ */

function ContractCard({ contract }: { contract: GuildContractView }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  const collect = () => {
    setMessage({});
    startTransition(async () => {
      const result = await collectGuildContract();
      setMessage({ error: result.error, success: result.success });
    });
  };

  const pct = contract.goal > 0 ? (contract.progress / contract.goal) * 100 : 0;

  return (
    <section className="panel rounded-2xl border-crimson/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
            <Icon name={contract.icon} size={20} className="text-crimson-bright" />
            {t(contract.name)}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {t(contract.lore)}
          </p>
        </div>
        <RewardChips rewards={contract.reward} size="md" />
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2 text-[11px] font-semibold">
          <span className="text-zinc-400">
            {t("משימות יומיות שחברי הברית השלימו")}
          </span>
          <span className="nums text-gold-bright" dir="ltr">
            {formatNumber(contract.progress)}/{formatNumber(contract.goal)}
          </span>
        </div>
        <Meter value={pct} tone="xp" className="mt-1 w-full" />
        <p className="mt-1.5 text-[10px] text-zinc-500">
          {t("היעד נקבע לפי {members} חברי הברית כשהחוזה נפתח היום. רק משימות יומיות נספרות.", {
            members: contract.members,
          })}
        </p>
      </div>

      <div className="mt-3">
        {!contract.complete ? (
          <p className="text-xs text-zinc-500">
            {t("כשהברית תשלים את היעד, כל חבר יוכל לקחת את חלקו כאן.")}
          </p>
        ) : contract.collected ? (
          <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-300">
            <Icon name="check" size={16} />
            {t("לקחת את חלקך.")}
          </p>
        ) : (
          <span className="gleam-wrap">
            <button
              type="button"
              onClick={collect}
              disabled={pending}
              className={`btn btn-gold px-5 py-2 text-sm disabled:opacity-60${
                pending ? "" : " btn-gleam"
              }`}
            >
              {pending ? t("אוסף…") : t("קח את חלקך")}
            </button>
            {!pending && <i className="gleam-spark gleam-spark-a" aria-hidden />}
          </span>
        )}
      </div>

      <div className="mt-3">
        <FormMessage error={message.error} success={message.success} />
      </div>
    </section>
  );
}

/* ------------------------------ mission boards ------------------------------ */

function MissionPanel({
  board,
  serverNow,
  title,
  blurb,
}: {
  board: MissionBoardState;
  serverNow: number;
  title: string;
  blurb: string;
}) {
  const t = useT();
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
          <Icon name="quest" size={20} className="text-crimson-bright" />
          {title}
          {board.collectable > 0 && (
            <span className="rounded bg-gold px-1.5 text-[10px] font-black nums text-black">
              {board.collectable}
            </span>
          )}
        </h2>
        <span className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">{t("מתחדש בעוד")}</span>
          <ResetCountdown at={board.resetsAt} serverNow={serverNow} />
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{blurb}</p>

      {board.missions.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border-subtle bg-black/25 px-3 py-3 text-sm text-zinc-500">
          {t("אין משימות פתוחות כרגע.")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {board.missions.map((mission) => (
            <MissionRow key={mission.key} mission={mission} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MissionRow({ mission }: { mission: MissionView }) {
  const t = useT();
  const [state, formAction, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(claimMission, {});

  const pct = mission.goal > 0 ? (mission.progress / mission.goal) * 100 : 0;

  return (
    <li
      className={`rounded-xl border p-3 transition-colors ${
        mission.claimed
          ? "border-emerald-800/40 bg-emerald-950/20"
          : mission.done
            ? "border-gold/60 bg-gold/8"
            : "border-border-subtle bg-black/25"
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon
          name={mission.icon}
          size={22}
          className={`mt-0.5 shrink-0 ${
            mission.claimed ? "text-emerald-500/70" : "text-crimson-bright"
          }`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-bold text-bone">{t(mission.name, mission.params)}</p>
            <RewardChips rewards={mission.rewards} />
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            {t(mission.hint, mission.params)}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <Meter value={pct} tone="xp" className="w-full" />
            <span className="shrink-0 text-[10px] font-bold nums text-zinc-400" dir="ltr">
              {formatCompact(mission.progress)}/{formatCompact(mission.goal)}
            </span>
          </div>
        </div>

        <div className="shrink-0 self-center">
          {mission.claimed ? (
            <Icon name="check" size={20} className="text-emerald-400" />
          ) : mission.done ? (
            <form action={formAction}>
              <input type="hidden" name="scope" value={mission.scope} />
              <input type="hidden" name="key" value={mission.key} />
              <button
                type="submit"
                disabled={pending}
                className="btn btn-gold px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {pending ? t("אוסף…") : t("אסוף")}
              </button>
            </form>
          ) : (
            <Icon name="lock" size={16} className="text-zinc-700" />
          )}
        </div>
      </div>

      {(state.error || state.success) && (
        <div className="mt-2">
          <FormMessage error={state.error} success={state.success} />
        </div>
      )}
    </li>
  );
}
