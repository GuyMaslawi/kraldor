"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatCompact } from "@/lib/game/format";
import { REWARD_ICON, REWARD_LABEL } from "@/lib/game/rewards";
import { ARENA_LUCK, type ArenaState } from "@/lib/game/arena";
import { collectArena, enterArena } from "@/server/actions/arena";
import { useT } from "@/i18n/client";

/**
 * /game/arena — the weekly card.
 *
 * The page answers two questions and nothing else: "am I in" and "how did I
 * do". Everything about *how* the duels are decided is stated in one line
 * rather than shown, because a player cannot influence it — there is no tactic
 * here, only whether you entered and what your army looked like when the week
 * turned over.
 */
export function ArenaBoard({ state }: { state: ArenaState }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  const run = (action: () => Promise<{ error?: string; success?: string }>) => {
    setMessage({});
    startTransition(async () => {
      const result = await action();
      setMessage({ error: result.error, success: result.success });
    });
  };

  const full = state.entrants >= state.maxEntrants;
  const canEnter =
    !state.resolved && !state.entered && !full && state.turns >= state.entryTurns;

  return (
    <div className="space-y-5">
      <section className="panel-gold rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
              <Icon name="crown" size={20} className="text-crimson-bright" />
              {state.resolved
                ? t("תוצאות הזירה")
                : t("הזירה של השבוע")}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
              {t("כל מי שנרשם נלחם בכל השאר בדיוק פעם אחת, כשהשבוע מסתיים. אתה לא צריך להיות מחובר — הזירה נלחמת לבד. הזירה מוגבלת לעיר שלך, וכ-{luck}% מהתוצאה הם מזל, כדי שגם אימפריה קטנה תיקח קרבות.", {
                luck: Math.round(ARENA_LUCK * 100),
              })}
            </p>
          </div>

          <span className="text-center">
            <span className="block text-2xl font-black nums text-gold-bright">
              {state.entrants}
              <span className="text-base text-zinc-600">/{state.maxEntrants}</span>
            </span>
            <span className="block text-[10px] font-bold text-zinc-500">
              {t("נרשמו")}
            </span>
          </span>
        </div>

        {/* Said up front rather than discovered at the payout. A thin tier still
            runs its card and still pays the participation purse and the per-win
            gold — only the diamonds wait for there to be a tournament to win.
            See ARENA_PODIUM_MIN_ENTRANTS. */}
        {!state.podiumPays && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
            {t("פרסי הפודיום (היהלומים) נפתחים מ-{min} משתתפים. מתחת לזה הזירה עדיין נלחמת ומשלמת על השתתפות ועל כל ניצחון.", {
              min: state.podiumMinEntrants,
            })}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {state.resolved ? (
            state.myPlace > 0 ? (
              <>
                <span className="flex items-center gap-2 rounded-xl border border-gold/50 bg-black/40 px-4 py-2">
                  <Icon name="laurel" size={16} className="text-crimson-bright" />
                  <span className="font-black text-gold-bright">
                    {t("מקום {place}", { place: state.myPlace })}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {state.reward.map((r) => (
                    <Tip key={r.kind} tip={t(REWARD_LABEL[r.kind])}>
                      <span
                        className="inline-flex items-center gap-1 rounded border border-border-subtle bg-black/30 px-1.5 text-[11px] font-bold nums text-bone/90"
                        dir="ltr"
                      >
                        <Icon name={REWARD_ICON[r.kind]} size={11} />
                        {formatCompact(r.amount)}
                      </span>
                    </Tip>
                  ))}
                </span>
                {state.claimed ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300">
                    <Icon name="check" size={15} />
                    {t("נאסף")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => run(collectArena)}
                    disabled={pending || !state.claimable}
                    className="btn btn-gold px-4 py-2 text-sm disabled:opacity-60"
                  >
                    {pending ? t("אוסף…") : t("אסוף שלל")}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                {t("לא נרשמת לזירה הזו.")}
              </p>
            )
          ) : state.entered ? (
            <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-4 py-2 text-sm font-bold text-emerald-300">
              <Icon name="check" size={16} />
              {t("אתה בפנים. הקרבות ייערכו בסוף השבוע.")}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => run(enterArena)}
                disabled={pending || !canEnter}
                className="btn btn-gold px-5 py-2 text-sm disabled:opacity-50"
              >
                {pending ? t("נרשם…") : t("הירשם לזירה")}
              </button>
              <span
                className={`flex items-center gap-1 text-sm font-bold nums ${
                  state.turns >= state.entryTurns ? "text-gold" : "text-red-400"
                }`}
              >
                <Icon name="turns" size={14} />
                {state.entryTurns}
              </span>
              {full && (
                <span className="text-xs font-bold text-amber-400">
                  {t("הזירה מלאה השבוע")}
                </span>
              )}
            </>
          )}

          {!state.resolved && (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">{t("נלחמת בעוד")}</span>
              <WeekCountdown at={state.resolvesAt} serverNow={state.serverNow} />
            </span>
          )}
        </div>

        <div className="mt-3">
          <FormMessage error={message.error} success={message.success} />
        </div>
      </section>

      <section className="panel rounded-2xl p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
          <Icon name="rankings" size={19} className="text-crimson-bright" />
          {state.resolved ? t("הטבלה הסופית") : t("מי נרשם")}
        </h3>

        {state.standings.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border-subtle bg-black/25 px-3 py-3 text-sm text-zinc-500">
            {t("עדיין אף אחד לא נרשם. היה הראשון.")}
          </p>
        ) : (
          <ol className="mt-3 space-y-1">
            {state.standings.map((row, index) => (
              <li
                key={row.empireId}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  row.isMe
                    ? "border border-gold/40 bg-gold/8"
                    : "border border-transparent bg-black/20"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-center font-black nums text-zinc-600">
                    {state.resolved ? row.place || index + 1 : index + 1}
                  </span>
                  <PlayerLink
                    empireId={row.empireId}
                    name={row.empireName}
                    className="truncate font-bold"
                  />
                </span>
                {state.resolved && (
                  <span className="shrink-0 font-bold nums" dir="ltr">
                    <span className="text-emerald-300">{row.wins}</span>
                    <span className="text-zinc-600">–</span>
                    <span className="text-red-400">{row.losses}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/**
 * The wait until the card is fought. `serverNow` rather than the reader's own
 * clock, for the reason every countdown in this codebase gives: the boundary
 * that matters is the server's.
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

  if (left <= 0) return <span>{t("עוד רגע")}</span>;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  return (
    <span className="nums text-zinc-500" dir="ltr">
      {days > 0 ? t("{d}י {h}ש", { d: days, h: hours }) : t("{h}ש", { h: hours })}
    </span>
  );
}
