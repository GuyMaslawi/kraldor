"use client";

import { useEffect, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNumber, formatCompact } from "@/lib/game/format";
import { REWARD_ICON, REWARD_LABEL } from "@/lib/game/rewards";
import {
  WORLD_BOSS_KILL_DIAMONDS,
  WORLD_BOSS_MAX_STRIKES,
  type WorldBossState,
} from "@/lib/game/worldBoss";
import { collectWorldBoss, strikeWorldBoss } from "@/server/actions/worldBoss";
import { useT } from "@/i18n/client";

/**
 * /game/worldboss — the arena.
 *
 * The health bar is the whole screen. Everything else on it exists to answer
 * one of two questions a player arrives with: "are we going to get it down"
 * (the bar, the countdown, the number of people fighting) and "did I do
 * anything" (my damage, my rank, my share). Nothing here is decoration for its
 * own sake — a fixture the whole server shares only works if a stranger's
 * contribution is legible.
 */
export function WorldBossArena({ state }: { state: WorldBossState }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  const strike = () => {
    setMessage({});
    startTransition(async () => {
      const result = await strikeWorldBoss();
      setMessage({ error: result.error, success: result.success });
    });
  };

  const collect = () => {
    setMessage({});
    startTransition(async () => {
      const result = await collectWorldBoss();
      setMessage({ error: result.error, success: result.success });
    });
  };

  const pct = state.maxHp > 0 ? (state.hp / state.maxHp) * 100 : 0;
  const canStrike =
    !state.defeated && state.strikesLeft > 0 && state.turns >= state.strikeTurns;

  return (
    <div
      style={{ "--accent": state.accent } as CSSProperties}
      className="space-y-5"
    >
      {/* -------- the beast -------- */}
      <section className="wb-scene panel-gold rounded-2xl p-4 sm:p-6">
        <span className="wb-aura" aria-hidden />

        <div className="relative text-center">
          <span
            className={`wb-sigil block text-6xl sm:text-7xl ${
              state.defeated ? "wb-sigil-slain" : ""
            }`}
            aria-hidden
          >
            {state.sigil}
          </span>
          <h2 className="mt-2 text-xl font-black tracking-wide text-gold-bright sm:text-2xl">
            {t(state.name)}
          </h2>
          <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-relaxed text-bone/80">
            {t(state.lore)}
          </p>
        </div>

        {/* The bar. Deliberately the largest thing on the page. */}
        <div className="relative mt-5">
          <div className="wb-bar" aria-hidden>
            <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="font-black nums text-bone" dir="ltr">
              {formatNumber(Math.round(state.hp))} /{" "}
              {formatNumber(Math.round(state.maxHp))}
            </span>
            <span className="flex items-center gap-3 text-zinc-500">
              <span>
                {t("{count} נלחמים", { count: state.participants })}
              </span>
              <WeekCountdown at={state.endsAt} serverNow={state.serverNow} />
            </span>
          </div>
        </div>

        {/* -------- the one control -------- */}
        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-3">
          {state.defeated ? (
            <div className="text-center">
              <p className="text-lg font-black text-emerald-300">
                {t("המפלצת הופלה!")}
              </p>
              {state.slayerName && (
                <p className="mt-0.5 text-xs text-zinc-400">
                  {t("המכה האחרונה: {name}", { name: state.slayerName })}
                </p>
              )}
            </div>
          ) : (
            <span className="gleam-wrap">
              <button
                type="button"
                onClick={strike}
                disabled={pending || !canStrike}
                className={`btn btn-gold px-6 py-2.5 text-base disabled:opacity-50${
                  pending || !canStrike ? "" : " btn-gleam"
                }`}
              >
                {pending ? (
                  t("מכה…")
                ) : (
                  <>
                    <Icon name="attack" size={18} />
                    {t("הכה")}
                  </>
                )}
              </button>
              {!pending && canStrike && (
                <>
                  <i className="gleam-spark gleam-spark-a" aria-hidden />
                  <i className="gleam-spark gleam-spark-b" aria-hidden />
                </>
              )}
            </span>
          )}

          {!state.defeated && (
            <span className="flex flex-wrap items-center gap-3 text-xs">
              <Tip tip={t("כל מכה עולה תורות")}>
                <span
                  className={`flex items-center gap-1 font-bold nums ${
                    state.turns >= state.strikeTurns ? "text-gold" : "text-red-400"
                  }`}
                >
                  <Icon name="turns" size={13} />
                  {state.strikeTurns}
                </span>
              </Tip>
              <Tip
                tip={t("מספר המכות מוגבל כדי שלוח הנזק לא יהיה עותק של דירוג הכוח")}
              >
                <span className="font-bold nums text-zinc-400">
                  {t("{left}/{max} מכות", {
                    left: state.strikesLeft,
                    max: WORLD_BOSS_MAX_STRIKES,
                  })}
                </span>
              </Tip>
            </span>
          )}
        </div>

        {/* -------- the spoils -------- */}
        {state.defeated && (
          <div className="relative mt-4 flex flex-col items-center gap-2">
            <span className="flex flex-wrap items-center justify-center gap-1.5">
              {state.reward.map((r) => (
                <Tip key={r.kind} tip={t(REWARD_LABEL[r.kind])}>
                  <span
                    className="inline-flex items-center gap-1 rounded border border-border-subtle bg-black/30 px-2 py-0.5 text-xs font-bold nums text-bone/90"
                    dir="ltr"
                  >
                    <Icon name={REWARD_ICON[r.kind]} size={12} />
                    {formatCompact(r.amount)}
                  </span>
                </Tip>
              ))}
            </span>
            {state.claimed ? (
              <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-300">
                <Icon name="check" size={16} />
                {t("אספת את חלקך.")}
              </p>
            ) : state.claimable ? (
              <button
                type="button"
                onClick={collect}
                disabled={pending}
                className="btn btn-gold px-5 py-2 text-sm disabled:opacity-60"
              >
                {pending ? t("אוסף…") : t("קח את חלקך")}
              </button>
            ) : (
              <p className="text-xs text-zinc-500">
                {t("לא הכית את המפלצת השבוע — אין חלק בשלל.")}
              </p>
            )}
          </div>
        )}

        <div className="relative mt-3">
          <FormMessage error={message.error} success={message.success} />
        </div>
      </section>

      {/* -------- the damage board -------- */}
      <section className="panel rounded-2xl p-4 sm:p-5">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-black tracking-wide text-gold-bright">
          <Icon name="rankings" size={19} className="text-crimson-bright" />
          {t("לוח הנזק")}
          {state.myDamage > 0 && (
            <span className="rounded bg-black/40 px-2 py-0.5 text-[11px] font-bold nums text-zinc-400">
              {t("הנזק שלך: {damage}", {
                damage: formatCompact(state.myDamage),
              })}
            </span>
          )}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          {t("חצי מהשלל מתחלק שווה בשווה בין כל מי שהכה, וחצי לפי נזק. מי שמפיל אותה מקבל {diamonds} יהלומים לעצמו.", {
            diamonds: WORLD_BOSS_KILL_DIAMONDS,
          })}
        </p>

        {state.board.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border-subtle bg-black/25 px-3 py-3 text-sm text-zinc-500">
            {t("אף אחד עדיין לא הכה. תהיה הראשון.")}
          </p>
        ) : (
          <ol className="mt-3 space-y-1">
            {state.board.map((striker, index) => (
              <li
                key={striker.empireId}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  striker.isMe
                    ? "border border-gold/40 bg-gold/8"
                    : "border border-transparent bg-black/20"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-center font-black nums text-zinc-600">
                    {index + 1}
                  </span>
                  <PlayerLink
                    empireId={striker.empireId}
                    name={striker.empireName}
                    titleKey={striker.title}
                    className="truncate font-bold"
                  />
                  <span className="shrink-0 text-[10px] nums text-zinc-600">
                    {t("×{hits}", { hits: striker.hits })}
                  </span>
                </span>
                <span className="shrink-0 font-bold nums text-crimson-bright" dir="ltr">
                  {formatCompact(striker.damage)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/**
 * The wait until the week's fixture closes, ticking in the browser.
 *
 * `serverNow` rather than the reader's own clock, for the reason the daily
 * board's countdown states: the boundary that matters is the server's, and a
 * device an hour fast would otherwise show a fight that has already ended.
 */
function WeekCountdown({ at, serverNow }: { at: number; serverNow: number }) {
  const t = useT();
  const [left, setLeft] = useState(() => at - serverNow);

  useEffect(() => {
    const skew = Date.now() - serverNow;
    const tick = () => setLeft(at - (Date.now() - skew));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [at, serverNow]);

  if (left <= 0) return <span>{t("השבוע נגמר")}</span>;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  return (
    <span className="nums" dir="ltr">
      {days > 0 ? t("{d}י {h}ש", { d: days, h: hours }) : t("{h}ש", { h: hours })}
    </span>
  );
}
