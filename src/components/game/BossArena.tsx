"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { LivingPortrait } from "@/components/game/LivingPortrait";
import { formatNumber } from "@/lib/game/format";
import { cityName } from "@/lib/game/cities";
import { BOSS_REWARD_RESOURCES, bossImage } from "@/lib/game/bosses";
import {
  BOSS_CASUALTIES,
  BOSS_CHIP_SHARE,
  BOSS_KILL_SHARE,
  BOSS_MOVE_COUNTER,
  BOSS_MOVE_META,
  BOSS_TACTIC_META,
} from "@/lib/game/bossBattle";
import { pollBossArena } from "@/server/actions/boss";
import type { BossArenaState } from "@/server/bossBattleState";
import { useT } from "@/i18n/client";

/** How often to ask the server what has happened. */
const POLL_MS = 3_000;

/**
 * Polls that told us nothing at all before we stop insisting a battle is running.
 *
 * Three of them is ~9 seconds, which is far longer than any settle takes. It only
 * ever trips when there is genuinely nothing left to watch — and even then the
 * screen says so and offers a link, rather than navigating out from under the
 * player (see the history in the poll's own doc comment).
 */
const EMPTY_POLLS_BEFORE_GIVING_UP = 3;

/** Under this many seconds left, the clock turns and the last beat reads as urgent. */
const URGENT_MS = 10_000;

/** Geometry of the countdown ring. */
const RING_R = 43;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The arena: an assault playing itself out.
 *
 * There is nothing to press. The battle was decided the moment the player sent the
 * army, and this screen is its reveal — a round lands every nine seconds or so,
 * the tyrant's health drains, and when the clock runs out the report replaces it.
 *
 * Three things this screen has to do, all learned the hard way:
 *
 *  1. **Say how long is left, loudly.** The countdown used to be a chip reading
 *     "נותרו 33 שנ׳" in the corner of a busy stage, which is not a clock — it is a
 *     number. It is now a draining ring with the digits inside it, next to the
 *     round pips, so the pacing of the fight is legible at a glance.
 *  2. **Narrate.** Every round is a sentence ("he raised the hammer, the officers
 *     answered with the shield wall"), because a log of multipliers explains
 *     nothing to a player who has never read the tactic matrix.
 *  3. **Never navigate out from under the player.** An empty poll used to send
 *     them to the ladder — which raced the settle's own push to the report and
 *     produced the "the report flashed for a second and then I was on the
 *     rankings page" bug. Nothing here leaves for the ladder any more; the only
 *     destination is the report, and if there is nothing to show, the screen says
 *     so and waits.
 *
 * The client holds no authority and no secrets: `revealed` only ever contains
 * rounds whose moment has passed, because the server filters the plan by elapsed
 * time before sending it. Polling — rather than a local timer walking a full
 * script — is what keeps that true.
 */
export function BossArena({ initial }: { initial: BossArenaState }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<BossArenaState>(initial);
  const [now, setNow] = useState(initial.serverNow);
  // Server-clock skew, measured in an effect rather than during render: reading
  // the wall clock while rendering is impure, and the countdown has to agree with
  // the server anyway, since the server is what decides when the assault ends.
  const skew = useRef(0);
  const seen = useRef(initial.revealed.length);
  const [flash, setFlash] = useState<{
    correct: boolean;
    fury: boolean;
  } | null>(null);
  const [stranded, setStranded] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empties = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    skew.current = initial.serverNow - Date.now();
  }, [initial.serverNow]);

  /** Ask the server what has landed; hand over to the report once it settles. */
  const poll = useCallback(async () => {
    if (done.current) return;
    const res = await pollBossArena();
    // A refused round (rate limit, a hiccup) is not information. Change nothing.
    if (res.retry) return;

    if (res.fightId) {
      done.current = true;
      router.push(`/game/boss/${res.fightId}`);
      return;
    }
    if (res.state) {
      empties.current = 0;
      skew.current = res.state.serverNow - Date.now();
      // Newly landed rounds flash here, where they arrive, rather than in an
      // effect watching `state` — the strike is an event, not derived state.
      if (res.state.revealed.length > seen.current) {
        seen.current = res.state.revealed.length;
        const landed = res.state.revealed.at(-1);
        if (landed) {
          setFlash({ correct: landed.correct, fury: landed.furyUsed });
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(null), 900);
        }
      }
      setState(res.state);
      return;
    }

    // No running assault, no report, no refusal: there is really nothing here.
    // Say so in place instead of moving the player somewhere they did not ask to
    // go — the last thing they saw may well have been their own report.
    empties.current += 1;
    if (empties.current >= EMPTY_POLLS_BEFORE_GIVING_UP) {
      done.current = true;
      setStranded(true);
    }
  }, [router]);

  // One clock for the countdown, one poll for the content.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() + skew.current), 250);
    const beat = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(beat);
    };
  }, [poll]);

  // Poll immediately once the clock runs out, rather than waiting out the beat —
  // the settle is what produces the report, and the player is watching for it.
  useEffect(() => {
    if (now >= state.endsAt && !done.current) void poll();
  }, [now, state.endsAt, poll]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  const msLeft = Math.max(0, state.endsAt - now);
  const secondsLeft = Math.ceil(msLeft / 1000);
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const elapsedPct = Math.min(
    100,
    Math.max(0, ((now - state.startedAt) / Math.max(1, state.endsAt - state.startedAt)) * 100)
  );
  const hpPct = state.bossMaxHp > 0 ? (state.bossHp / state.bossMaxHp) * 100 : 0;
  const damagePct =
    state.bossMaxHp > 0
      ? (Math.min(state.damageSoFar, state.bossHpAtStart) / state.bossMaxHp) * 100
      : 0;
  const furyPct = (state.fury / state.furyMax) * 100;
  const lossPct =
    state.soldiersAtStart > 0 ? (state.soldiersLostSoFar / state.soldiersAtStart) * 100 : 0;
  const last = state.revealed.at(-1);
  const over = msLeft <= 0;
  const urgent = !over && msLeft <= URGENT_MS;
  const nextRoundIn =
    state.nextRoundAt != null ? Math.max(0, Math.ceil((state.nextRoundAt - now) / 1000)) : null;

  return (
    <div dir="rtl" className="space-y-4" style={{ ["--boss-accent" as string]: state.boss.accent }}>
      {/* ---------------- the battle ---------------- */}
      <section className="ba-stage relative overflow-hidden rounded-2xl border border-[rgb(var(--boss-accent))]/45 bg-[#0a0709]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgb(var(--boss-accent)/0.3),transparent_62%)]"
        />
        {flash && (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 z-20 ${
              flash.fury ? "ba-flash-fury" : flash.correct ? "ba-flash-good" : "ba-flash-bad"
            }`}
          />
        )}

        <div className="relative grid gap-4 p-4 sm:grid-cols-[minmax(0,180px)_1fr] sm:p-5">
          {/* portrait */}
          <div className="relative mx-auto h-[200px] w-[145px] overflow-hidden rounded-xl border border-[rgb(var(--boss-accent))]/50 sm:mx-0 sm:h-[220px] sm:w-full">
            <div
              aria-hidden
              className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[rgb(var(--boss-accent)/0.35)] to-black"
            >
              <Icon name="attack" size={70} className="text-black/40" />
            </div>
            <LivingPortrait
              src={bossImage(state.boss.key)}
              alt={t("{name} — {title}", {
                name: t(state.boss.name),
                title: t(state.boss.title),
              })}
              className={`absolute inset-0 ${
                flash ? (flash.correct ? "ba-boss-hit" : "ba-boss-roar") : ""
              }`}
              accent={state.boss.accent}
              embers={10}
              tilt={7}
              drift={22}
              rich
            >
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent"
              />
            </LivingPortrait>
            {flash && last && last.damage > 0 && (
              <span
                aria-hidden
                className="nums ba-damage absolute inset-x-0 top-5 z-10 text-center text-2xl font-black text-gold-bright"
                dir="ltr"
              >
                −{formatNumber(last.damage)}
              </span>
            )}
          </div>

          {/* name, the clock, health */}
          <div className="flex min-w-0 flex-col justify-center gap-3">
            <div className="min-w-0">
              <p className="text-xl font-black leading-tight text-[rgb(var(--boss-accent))] sm:text-2xl">
                {t(state.boss.name)}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-bone-dim">
                {t(state.boss.title)} · {t("עיר {city}", { city: cityName(t, state.cityTier) })}
              </p>
            </div>

            {/* ---------------- the clock ----------------
                A real countdown: a ring that drains, the digits inside it, and
                the rounds as pips beside it. This is the element the whole screen
                is paced by, so it is the biggest thing in the column — it used to
                be a 12px chip in the corner, which read as a status label rather
                than as time running out. */}
            <div
              className={`flex items-center gap-3.5 rounded-xl border px-3 py-2.5 ${
                over
                  ? "border-gold/45 bg-gold/[0.07]"
                  : urgent
                    ? "border-red-500/45 bg-red-950/20"
                    : "border-border-subtle bg-black/45"
              }`}
            >
              <div className="relative h-[74px] w-[74px] shrink-0 sm:h-[86px] sm:w-[86px]">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
                  <circle
                    cx="50"
                    cy="50"
                    r={RING_R}
                    fill="none"
                    stroke="rgba(255,255,255,0.07)"
                    strokeWidth="9"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r={RING_R}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (elapsedPct / 100)}
                    className={`ba-ring ${urgent ? "text-red-400" : "text-gold-bright"}`}
                  />
                </svg>
                <span
                  role="timer"
                  aria-live="off"
                  className={`nums absolute inset-0 flex items-center justify-center text-xl font-black sm:text-2xl ${
                    over ? "text-gold-bright" : urgent ? "text-red-300" : "text-zinc-100"
                  }`}
                  dir="ltr"
                >
                  {over ? "✓" : clock}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-gold-dim">
                  {over ? t("הקרב הוכרע") : t("הקרב נגמר בעוד")}
                </p>
                <p className="mt-0.5 truncate text-sm font-bold text-zinc-100">
                  {over ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="ba-spin inline-block">
                        ⏳
                      </span>
                      {t("מסכמים את השלל…")}
                    </span>
                  ) : (
                    <span className="nums">
                      {t("סבב {round} מתוך {total}", {
                        round: Math.min(state.revealed.length + 1, state.totalRounds),
                        total: state.totalRounds,
                      })}
                      {nextRoundIn != null && (
                        <span className="font-normal text-zinc-400">
                          {" "}
                          {t("· המכה הבאה בעוד {seconds} שנ׳", { seconds: nextRoundIn })}
                        </span>
                      )}
                    </span>
                  )}
                </p>

                {/* one pip per round of the plan, filling as they land */}
                <div className="mt-2 flex items-center gap-1">
                  {Array.from({ length: state.totalRounds }).map((_, i) => {
                    const round = state.revealed[i];
                    const tone = round
                      ? round.furyUsed
                        ? "bg-gold-bright"
                        : round.correct
                          ? "bg-emerald-400"
                          : "bg-red-500"
                      : "bg-white/10";
                    const pending = !round && i === state.revealed.length && !over;
                    return (
                      <span
                        key={i}
                        aria-hidden
                        className={`h-1.5 flex-1 rounded-full ${tone} ${
                          pending ? "ba-pip-next" : ""
                        }`}
                      />
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-500">
                  {over
                    ? t("אל תסגור — דוח הקרב המלא נפתח בעוד רגע.")
                    : t("הצבא נלחם לבד. אין מה ללחוץ — אפשר גם לצאת ולחזור.")}
                </p>
              </div>
            </div>

            {/* the tyrant's health, with this assault's damage marked behind it */}
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="font-bold text-[rgb(var(--boss-accent))]">
                  {t("חיי הבוס")}
                </span>
                <span className="nums font-black text-zinc-100" dir="ltr">
                  {formatNumber(Math.round(state.bossHp))} / {formatNumber(state.bossMaxHp)}
                </span>
              </div>
              <div className="relative h-4 overflow-hidden rounded-full border border-black/60 bg-white/5">
                <span
                  className="ba-hp absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-[rgb(var(--boss-accent))] to-[rgb(var(--boss-accent)/0.4)]"
                  style={{ width: `${Math.max(0, Math.min(100, hpPct))}%` }}
                />
                <span
                  aria-hidden
                  className="absolute inset-y-0 rounded-l-full bg-gold/25"
                  style={{
                    right: `${Math.max(0, Math.min(100, hpPct))}%`,
                    width: `${Math.max(0, Math.min(100 - hpPct, damagePct))}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">
                {t("המאגר משותף לכל שחקני העיר, והפסים המוזהבים הם הנזק של התקיפה הזו. הפצעים נשארים עליו גם אחרי שהקרב נגמר.")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- the play-by-play ----------------
          One sentence for the round that just landed, in words rather than
          multipliers. This is the only place the screen explains *why* a round
          went the way it did, and it is why the log below is now readable. */}
      <section
        className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
          last
            ? last.furyUsed
              ? "border-gold/40 bg-gold/[0.06] text-gold-bright"
              : last.correct
                ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
                : "border-red-500/30 bg-red-950/20 text-red-200"
            : "border-border-subtle bg-panel-inset text-zinc-400"
        }`}
        aria-live="polite"
      >
        {stranded ? (
          t("הקרב הזה כבר הסתיים. הדוח נשלח אליך להודעות.")
        ) : !last ? (
          t("הכוחות מסתערים על השער… המכה הראשונה נופלת עוד רגע.")
        ) : last.furyUsed ? (
          <span className="nums">
            <b>{t("הגיבור השתחרר.")}</b>{" "}
            {t("{move} של {boss} לא הספיק — מכת זעם אחת הורידה לו {damage} חיים.", {
              move: t(BOSS_MOVE_META[last.move]?.label ?? last.move),
              boss: t(state.boss.name),
              damage: formatNumber(last.damage),
            })}
          </span>
        ) : (
          <span className="nums">
            <b>
              {t(state.boss.name)} {t(BOSS_MOVE_META[last.move]?.telegraph ?? "")}
            </b>{" "}
            {t("— הקצינים ענו ב{tactic}", {
              tactic: t(BOSS_TACTIC_META[last.tactic]?.label ?? last.tactic),
            })}
            {last.correct ? (
              <>
                {t(", וזו התשובה הנכונה: נזק כפול")}
                {BOSS_CASUALTIES && t(" ובקושי אבדות")}{" "}
                {BOSS_CASUALTIES
                  ? t("(−{damage} חיים, −{soldiers} חיילים).", {
                      damage: formatNumber(last.damage),
                      soldiers: formatNumber(last.soldiersLost),
                    })
                  : t("(−{damage} חיים).", { damage: formatNumber(last.damage) })}
              </>
            ) : (
              <>
                {t(", וזו התשובה הלא נכונה — היה צריך {tactic}. הנזק נחלש", {
                  tactic: t(
                    BOSS_TACTIC_META[BOSS_MOVE_COUNTER[last.move]]?.label ?? ""
                  ),
                })}{" "}
                {BOSS_CASUALTIES
                  ? t("(−{damage} חיים, והמכה נכנסה: −{soldiers} חיילים).", {
                      damage: formatNumber(last.damage),
                      soldiers: formatNumber(last.soldiersLost),
                    })
                  : t("(−{damage} חיים).", { damage: formatNumber(last.damage) })}
              </>
            )}
          </span>
        )}
      </section>

      {/* ---------------- you can go ---------------- */}
      <section className="panel-inset flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
        <p className="text-xs text-zinc-400">
          <span aria-hidden className="me-1">
            📨
          </span>
          {stranded
            ? t("אפשר לחזור לבוס העיר או לקרוא את הדוח בהודעות.")
            : t("אפשר לצאת ולעשות דברים אחרים — כשהקרב ייגמר תקבל הודעה עם כל השלל.")}
        </p>
        <div className="flex gap-2">
          <Link href="/game/base" className="btn btn-ghost px-4 py-1.5 text-xs">
            <Icon name="base" size={14} className="inline-block align-middle" /> {t("לבסיס")}
          </Link>
          <Link
            href="/game/rankings"
            className={`btn px-4 py-1.5 text-xs ${stranded ? "btn-gold" : "btn-ghost"}`}
          >
            <Icon name="rankings" size={14} className="inline-block align-middle" />{" "}
            {t("לבוס העיר")}
          </Link>
        </div>
      </section>

      {/* ---------------- your side ---------------- */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="panel-inset rounded-xl p-4">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
              <Icon name="army" size={14} /> {t("הצבא שלך")}
            </span>
            <span className="nums text-sm font-black text-zinc-100" dir="ltr">
              {formatNumber(state.soldiersAtStart - state.soldiersLostSoFar)}
              {BOSS_CASUALTIES && (
                <span className="text-xs font-normal text-zinc-500">
                  {" "}
                  / {formatNumber(state.soldiersAtStart)}
                </span>
              )}
            </span>
          </div>
          {/* The attrition bar is the casualty mechanic's readout — with the
              assault bloodless it would sit empty for the whole minute, which
              reads as "not yet" rather than "never". */}
          {BOSS_CASUALTIES ? (
            <>
              <div className="h-2.5 overflow-hidden rounded-full border border-black/60 bg-white/5">
                <span
                  className="block h-full rounded-full bg-gradient-to-l from-amber-400 to-amber-700 transition-[width] duration-500"
                  style={{
                    width: `${Math.min(100, (lossPct / (state.routLine * 100)) * 100)}%`,
                  }}
                />
              </div>
              <p className="nums mt-1.5 text-[11px] text-zinc-500">
                {t("אבדות עד כה:")}{" "}
                <span className="nums text-red-300" dir="ltr">
                  {formatNumber(state.soldiersLostSoFar)}
                </span>{" "}
                {t("({lossPct}%). הצבא נסוג אם יאבד {routPct}%.", {
                  lossPct: Math.round(lossPct),
                  routPct: Math.round(state.routLine * 100),
                })}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-emerald-300/80">
              {t("כל החיילים חוזרים הביתה — קרב מול הבוס לא עולה באף חייל.")}
            </p>
          )}
          <div className="mt-2">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
              <span className="font-bold text-gold-dim">{t("זעם הגיבור")}</span>
              <span className="nums text-zinc-500" dir="ltr">
                {Math.round(furyPct)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-black/60 bg-white/5">
              <span
                className={`block h-full rounded-full bg-gradient-to-l from-gold-bright to-crimson transition-[width] duration-500 ${
                  furyPct >= 100 ? "ba-fury-bar" : ""
                }`}
                style={{ width: `${Math.min(100, furyPct)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              {t("מתמלא בכל סבב. כשהוא מתמלא הגיבור משתחרר במכה אחת גדולה.")}
            </p>
          </div>
        </div>

        {/* the running loot */}
        <div className="panel-gold rounded-xl p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gold-bright">
            <Icon name="gift" size={14} /> {t("שלל שנצבר עד כה")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {BOSS_REWARD_RESOURCES.map((res) => (
              <span
                key={res}
                className="nums inline-flex items-center gap-1 rounded-md border border-border-subtle bg-black/40 px-1.5 py-1 text-[11px] font-bold text-zinc-200"
              >
                <Icon name={RESOURCE_ICON[res]} size={12} className={RESOURCE_ICON_COLOR[res]} />
                <span dir="ltr">{formatNumber(state.earned[res])}</span>
              </span>
            ))}
            {state.earned.slaves > 0 && (
              <span className="nums inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-1.5 py-1 text-[11px] font-bold text-emerald-300">
                <Icon name="mine" size={12} />
                <span dir="ltr">{state.earned.slaves}</span>
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            {t("נצבר לפי הנזק שנגרם עד כה. הפלת הבוס משלמת את האוצר כולו מעל זה, והכול משולם בסוף הקרב.")}
          </p>
        </div>
      </section>

      {/* ---------------- what has happened ---------------- */}
      <section className="panel rounded-xl p-3">
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-dim">
          {t("יומן הקרב")}
        </p>
        {state.revealed.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-zinc-500">
            {t("הכוחות מתקרבים לשער…")}
          </p>
        ) : (
          <>
            {/* A header row, because the log is five unlabelled columns otherwise
                and every one of them needed guessing. */}
            <div className="flex flex-wrap items-center gap-x-2 px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">
              <span className="w-8 shrink-0">{t("סבב")}</span>
              <span className="shrink-0">{t("המהלך שלו")}</span>
              <span aria-hidden className="opacity-0">
                ←
              </span>
              <span className="shrink-0">{t("התשובה שלנו")}</span>
              <span className="ms-auto shrink-0">{t("נזק")}</span>
              {BOSS_CASUALTIES && <span className="shrink-0">{t("אבדות")}</span>}
            </div>
            <ul className="space-y-1">
              {[...state.revealed].reverse().map((entry) => (
                <li
                  key={entry.round}
                  className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-[11px] odd:bg-white/[0.03] ${
                    entry.round === state.revealed.length ? "ba-log-in" : ""
                  }`}
                >
                  <span className="nums w-8 shrink-0 text-zinc-500" dir="ltr">
                    #{entry.round}
                  </span>
                  <span className="shrink-0 text-zinc-400">
                    {BOSS_MOVE_META[entry.move]?.icon}{" "}
                    {t(BOSS_MOVE_META[entry.move]?.label ?? entry.move)}
                  </span>
                  <span aria-hidden className="text-zinc-600">
                    ←
                  </span>
                  <span
                    className={`shrink-0 font-bold ${
                      entry.furyUsed ? "text-gold-bright" : "text-zinc-200"
                    }`}
                  >
                    {t(BOSS_TACTIC_META[entry.tactic]?.label ?? entry.tactic)}
                  </span>
                  <span
                    className={`shrink-0 font-bold ${
                      entry.correct ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {entry.furyUsed
                      ? "🔥"
                      : entry.correct
                        ? t("✔ קריאה נכונה")
                        : t("✘ קריאה שגויה")}
                  </span>
                  <span className="nums ms-auto shrink-0 font-bold text-gold-bright" dir="ltr">
                    −{formatNumber(entry.damage)}
                  </span>
                  {BOSS_CASUALTIES && (
                    <span className="nums shrink-0 text-red-300" dir="ltr">
                      −{formatNumber(entry.soldiersLost)} ⚔
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="nums mt-2 px-2 text-[11px] text-zinc-500">
              {t("קריאות נכונות עד כה:")}{" "}
              <span className="nums text-emerald-300" dir="ltr">
                {state.correctSoFar}
              </span>{" "}
              {t("מתוך {total} — הן קובעות גם את דירוג הקרב וגם את גודל אוצר ההפלה.", {
                total: state.revealed.length,
              })}
            </p>
          </>
        )}
      </section>

      {/* ---------------- what am I even watching ---------------- */}
      <details className="panel group rounded-xl p-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 text-[11px] font-bold text-gold-dim transition-colors hover:text-gold-bright [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className="inline-block transition-transform group-open:rotate-90 rtl:-scale-x-100"
          >
            ▸
          </span>
          {t("מה בעצם קורה כאן, ואיך משפרים את התוצאה")}
        </summary>

        <div className="mt-3 space-y-3 px-1">
          <ol className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
            <li>
              <b className="text-zinc-200">1.</b>{" "}
              {t("שילמת תורות ושלחת את הצבא. מרגע הלחיצה הכול כבר מוכרע — הדקה הזו היא הצפייה, לא ההחלטה.")}
            </li>
            <li>
              <b className="text-zinc-200">2.</b>{" "}
              {t("בכל סבב {boss} מבצע מהלך, והקצינים שלך מנסים לקרוא אותו ולענות בתשובה הנכונה. סיכוי הקריאה שלך כרגע:", {
                boss: t(state.boss.name),
              })}{" "}
              <b className="nums text-gold-bright" dir="ltr">
                {Math.round(state.readChance * 100)}%
              </b>{" "}
              {t("— הוא נקבע ברמת הגיבור.")}
            </li>
            <li>
              <b className="text-zinc-200">3.</b> {t("כשהמונה נגמר משולם השלל")}
              {BOSS_CASUALTIES && t(", נכנסות האבדות")}
              {t(", ונשלחת אליך הודעה עם הסיכום — גם אם עברת בינתיים למסך אחר.")}
            </li>
          </ol>

          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-dim">
              {t("שלוש התשובות")}
            </p>
            <ul className="space-y-1">
              {(["SMASH", "SWEEP", "EXPOSED"] as const).map((move) => {
                const meta = BOSS_MOVE_META[move];
                const counter = BOSS_TACTIC_META[BOSS_MOVE_COUNTER[move]];
                return (
                  <li
                    key={move}
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-border-subtle bg-panel-inset px-2 py-1 text-[11px]"
                  >
                    <span aria-hidden>{meta.icon}</span>
                    <b className={meta.tone}>{t(meta.label)}</b>
                    <span aria-hidden className="text-zinc-600">
                      ←
                    </span>
                    <span aria-hidden>{counter.icon}</span>
                    <b className="text-zinc-200">{t(counter.label)}</b>
                    <span className="text-zinc-500">{t(meta.effect)}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <p className="rounded-lg border border-border-subtle bg-panel-inset p-2.5 text-[11px] leading-relaxed text-zinc-400">
              <b className="text-emerald-300">{t("כדי לפגוע בו יותר:")}</b>{" "}
              {t("כוח התקיפה. עוד חיילים, נשקי תקיפה, ציוד ונקודות תקיפה לגיבור, באפ גילדה ושיקוי כוח — הנזק בכל סבב הוא אחוז מהכוח הזה.")}
            </p>
            <p className="rounded-lg border border-border-subtle bg-panel-inset p-2.5 text-[11px] leading-relaxed text-zinc-400">
              {BOSS_CASUALTIES ? (
                <>
                  <b className="text-sky-300">{t("כדי לאבד פחות חיילים:")}</b>{" "}
                  {t("הגיבור. רמה גבוהה יותר = קריאות נכונות יותר, וסבב שנקרא נכון עולה כשליש מהדם.")}
                </>
              ) : (
                <>
                  <b className="text-sky-300">{t("כדי לקרוא אותו נכון יותר:")}</b>{" "}
                  {t("הגיבור. רמה גבוהה יותר = יותר סבבים שנקראים נכון, וכל אחד מהם מכפיל את הנזק.")}
                </>
              )}{" "}
              {t("גיבור מת מוריד את הקריאה לניחוש ומבטל את הזעם.")}
            </p>
          </div>

          <p className="nums text-[11px] leading-relaxed text-zinc-500">
            {t("השלל: {chip}% מהאוצר משולם לפי הנזק שגרמת — גם בקרב שלא הפיל אותו — והשאר ({kill}% + ציוד גיבור מובטח) משולם רק למי שמנחית את המכה האחרונה. הפצעים נשארים על הבוס בין תקיפות, אז כל תקיפה מקרבת את ההפלה.", {
              chip: Math.round(BOSS_CHIP_SHARE * 100),
              kill: Math.round(BOSS_KILL_SHARE * 100),
            })}
          </p>
        </div>
      </details>
    </div>
  );
}
