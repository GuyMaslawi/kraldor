"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { useScrollLock } from "@/components/ui/scrollLock";
import { useDir, useT } from "@/i18n/client";
import { formatNumber } from "@/lib/game/format";
import {
  SEASON_PASS_HAUL_ORDER,
  SEASON_PASS_PREMIUM_MULTIPLIER,
  SEASON_PASS_REWARD_LABEL,
  SEASON_PASS_XP_PER_TIER,
  type SeasonPassRewardKind,
} from "@/lib/game/seasonPass";
import {
  buySeasonPassPremium,
  claimSeasonPassRewards,
  claimSeasonPassTier,
  type SeasonPassHaulEntry,
  type SeasonPassRewardView,
  type SeasonPassState,
  type SeasonPassTierView,
} from "@/server/actions/seasonPass";


/**
 * The premium-unlock cascade pops rows one after another. At 50 tiers a
 * per-row delay would run for the better part of a minute, so only the first
 * few rows — the ones actually on screen when the modal is at the top — are
 * staggered; everything below opens together, off-screen.
 */
const UNLOCK_CASCADE_ROWS = 12;
const UNLOCK_CASCADE_STEP = 55;
const UNLOCK_CASCADE_MS = UNLOCK_CASCADE_ROWS * UNLOCK_CASCADE_STEP + 700;

/**
 * The ladder is read in chapters of ten rungs.
 *
 * Fifty identical rows is a spreadsheet, not a journey: nothing tells you where
 * you are, how much road is behind you, or that the thing even ends. Ten-rung
 * chapters give the scroll landmarks — and they line up with `KIND_CYCLE`,
 * which repeats every ten tiers and puts gold on each chapter's last rung.
 */
const TIERS_PER_CHAPTER = 10;

/** Rendered height of a pinned chapter header, in px — see `scrollToCurrent`. */
const CHAPTER_HEAD_H = 34;

/**
 * Remember that this cycle's clear has already been celebrated, and report
 * whether this is the first time. Keyed by the cycle's end timestamp, so the
 * next ladder celebrates again; the key changes twice a day, which also keeps
 * the entry from accumulating meaningfully.
 *
 * Storage can throw (Safari private mode, blocked cookies) — a celebration is
 * not worth breaking a claim over, so a failure just means it may show twice.
 */
function markCleared(cycleEndsAt: number): boolean {
  const key = `sp-cleared:${cycleEndsAt}`;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, "1");
  } catch {
    // ignore — fall through and celebrate
  }
  return true;
}

/** Sum a set of rewards per kind, in the canonical display order. */
function totalByKind(
  rewards: Iterable<Pick<SeasonPassRewardView, "kind" | "amount">>
): SeasonPassHaulEntry[] {
  const totals = new Map<SeasonPassRewardKind, number>();
  for (const r of rewards) totals.set(r.kind, (totals.get(r.kind) ?? 0) + r.amount);
  return SEASON_PASS_HAUL_ORDER.filter((k) => totals.has(k)).map((kind) => ({
    kind,
    amount: totals.get(kind)!,
  }));
}

/* ------------------------------ shared pieces ------------------------------ */

/**
 * A row of "+1,470 🪙" chips — the answer to "what do I actually get?".
 *
 * Carries the three sums the player needs and the old modal never showed: what
 * the collect button is about to pay, what the gold track adds on top, and what
 * a full clear is worth. The kind rides on the tinted resource icon (the same
 * pairing the command bar uses) plus a `title` and an off-screen label, so it
 * stays readable to a screen reader without printing six words per chip.
 */
function RewardChips({
  entries,
  className = "",
}: {
  entries: SeasonPassHaulEntry[];
  className?: string;
}) {
  const t = useT();
  if (!entries.length) return null;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      {entries.map((e) => (
        <span
          key={e.kind}
          title={`${formatNumber(e.amount)} ${t(SEASON_PASS_REWARD_LABEL[e.kind])}`}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/55 px-1.5 py-0.5"
        >
          <Icon
            name={RESOURCE_ICON[e.kind]}
            size={13}
            className={RESOURCE_ICON_COLOR[e.kind]}
          />
          <span className="text-[11px] font-black text-bone-bright nums">
            +{formatNumber(e.amount)}
          </span>
          <span className="sr-only">{t(SEASON_PASS_REWARD_LABEL[e.kind])}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The spoils of a claim, one tile per resource kind.
 *
 * The server totals the haul per kind before it gets here, so this never shows
 * the same resource twice — the old summary was a per-tier string join and read
 * as "4,000 זהב · 12,000 זהב · … · 5,000 זהב", which looked like a bug.
 */
function HaulPanel({
  haul,
  tiers,
  onDismiss,
}: {
  haul: SeasonPassHaulEntry[];
  tiers: number;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="haul-panel mt-3 overflow-hidden rounded-xl border border-emerald-500/50 bg-gradient-to-b from-emerald-950/70 via-black/60 to-black/70 p-3 shadow-[0_0_28px_-10px_rgba(16,185,129,0.8)]">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onDismiss}
          aria-label={t("סגור את סיכום השלל")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 text-[11px] text-emerald-300/70 transition hover:bg-emerald-500/10 hover:text-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
        >
          ✕
        </button>
        <p className="flex items-center gap-1.5 text-sm font-black text-emerald-300">
          <Icon name="gift" size={15} />
          {t("השלל נאסף")}
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-black text-emerald-200 nums">
            {t("{count} דרגות", { count: tiers })}
          </span>
        </p>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {haul.map((entry, i) => (
          <div
            key={entry.kind}
            style={{ animationDelay: `${i * 70}ms` }}
            className="haul-tile flex flex-col items-center justify-center gap-1 rounded-lg border border-emerald-500/25 bg-black/50 p-2 text-center"
          >
            <Icon
              name={RESOURCE_ICON[entry.kind]}
              size={24}
              className={RESOURCE_ICON_COLOR[entry.kind]}
            />
            <span className="text-sm font-black text-emerald-200 nums">
              +{formatNumber(entry.amount)}
            </span>
            <span className="text-[10px] font-bold leading-none text-zinc-400">
              {t(SEASON_PASS_REWARD_LABEL[entry.kind])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Countdown to the daily update that refills the ladder with bigger rewards. */
function CycleCountdown({ endsAt }: { endsAt: number }) {
  const t = useT();
  // Seeded from a lazy initializer and re-seeded by the `key` at the call site,
  // so a new cycle boundary remounts this with a fresh reading. The old code
  // re-synced with a `setLeft` at the top of the effect, which fired on every
  // mount and forced a second render pass before the first had painted.
  const [left, setLeft] = useState(() => endsAt - Date.now());

  useEffect(() => {
    const id = setInterval(() => setLeft(endsAt - Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (left <= 0) return <span className="nums">{t("מתחדש עכשיו…")}</span>;
  const total = Math.floor(left / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return (
    <span className="nums">
      {h}:{m}:{s}
    </span>
  );
}

/* ------------------------------ the ladder ------------------------------ */

/**
 * What a single reward is doing right now. Four states, each with its own shape
 * *and* its own words — never colour alone, because "collected" and "still
 * locked" are the two the player must not confuse.
 */
type TileState = "done" | "ready" | "paywalled" | "future";

function tileState(
  reward: SeasonPassRewardView,
  reached: boolean,
  available: boolean
): TileState {
  if (reward.claimed) return "done";
  if (!available) return "paywalled";
  return reached ? "ready" : "future";
}

// i18n-keys-start: kept in Hebrew and translated at the call site, like every data label
const TILE_STATE_WORD: Record<TileState, string> = {
  done: "נאסף",
  ready: "מוכן לאיסוף",
  paywalled: "נעול מאחורי פרימיום",
  future: "עדיין לא הושג",
};
// i18n-keys-end

/**
 * One reward on one track.
 *
 * The amount is the headline. It used to be buried inside a single "1,470 זהב"
 * string at 10px — the one number the whole screen exists to communicate. A
 * reward collectable right now pulses; one already banked recedes; one still
 * ahead is dim but *legible*, because a ladder whose future you cannot read is
 * not a ladder worth climbing.
 */
function TierTile({
  reward,
  tier,
  track,
  state,
  reached,
  unlocking,
  delay,
  onClaim,
  busy,
  disabled,
}: {
  reward: SeasonPassRewardView;
  tier: number;
  track: "free" | "premium";
  state: TileState;
  reached: boolean;
  /** Premium only: the buy-cascade is popping this row's lock open. */
  unlocking?: boolean;
  delay?: number;
  /** Collect just this tile. */
  onClaim: () => void;
  /** This tile's own claim is in flight. */
  busy: boolean;
  /** Some claim or purchase is in flight. */
  disabled: boolean;
}) {
  const t = useT();
  const premium = track === "premium";
  const trackWord = premium ? t("מסלול פרימיום") : t("מסלול חינמי");
  // A locked gold reward the player has already climbed past is the whole sales
  // pitch, so it stays lit; only the rungs still ahead of them recede.
  const ahead = state === "paywalled" && !reached;

  const skin =
    state === "done"
      ? "border-emerald-600/35 bg-emerald-950/25"
      : state === "ready"
        ? "sp-ready border-emerald-500/60 bg-gradient-to-b from-emerald-900/35 to-black/60"
        : state === "future"
          ? "border-white/8 bg-black/35"
          : premium
            ? "border-gold/40 bg-gradient-to-b from-amber-900/30 to-amber-950/50"
            : "border-sky-500/30 bg-gradient-to-b from-sky-900/20 to-sky-950/45";

  const amountTone =
    state === "done"
      ? "text-emerald-300/70"
      : state === "ready"
        ? "text-emerald-200"
        : state === "future"
          ? "text-zinc-500"
          : premium
            ? "text-gold-bright"
            : "text-sky-200";

  return (
    <div
      style={unlocking ? { animationDelay: `${delay}ms` } : undefined}
      className={`relative flex h-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border px-1.5 py-2 text-center transition ${skin} ${
        ahead && !unlocking ? "opacity-55" : ""
      } ${unlocking ? "sp-unlocking" : ""}`}
    >
      {/* One accessible sentence per tile, so a screen reader never has to
          assemble meaning out of an icon, a number and a colour. */}
      <span className="sr-only">
        {t("דרגה {tier}, {track}: {reward} — {status}", {
          tier,
          track: trackWord,
          reward: t(reward.label),
          status: t(TILE_STATE_WORD[state]),
        })}
      </span>

      {/* Corner status marker, in the inline-start (right, in RTL) corner on
          every tile so the eye can scan one column for it. */}
      <span aria-hidden className="absolute start-1 top-1 leading-none">
        {state === "done" ? (
          <Icon name="check" size={11} className="text-emerald-400" />
        ) : state === "ready" ? (
          <span className="rounded bg-emerald-500 px-1 text-[8px] font-black text-black">
            {t("מוכן")}
          </span>
        ) : (
          <Icon
            name="lock"
            size={11}
            className={state === "paywalled" ? "text-gold-dim" : "text-zinc-700"}
          />
        )}
      </span>

      <Icon
        aria-hidden
        name={RESOURCE_ICON[reward.kind]}
        size={22}
        className={`${RESOURCE_ICON_COLOR[reward.kind]} ${
          state === "done" ? "opacity-50" : state === "future" ? "opacity-40" : ""
        }`}
      />
      <span aria-hidden className={`text-[13px] font-black leading-none nums ${amountTone}`}>
        {formatNumber(reward.amount)}
      </span>
      <span
        aria-hidden
        className={`text-[9px] font-bold leading-none ${
          state === "future" ? "text-zinc-600" : "text-zinc-400"
        }`}
      >
        {t(SEASON_PASS_REWARD_LABEL[reward.kind])}
      </span>

      {/* Per-tile collect. The head's button takes the whole ladder in one
          press, which is what most players want most of the time — but it is
          all-or-nothing, and a player holding one rung back (citizens while the
          cap is full, turns while a boost is running) had no way to take the
          rest without it. So a rung that is ready gets a button of its own,
          right under the amount it pays. */}
      {state === "ready" && (
        <button
          onClick={onClaim}
          disabled={disabled}
          aria-label={t("אסוף את דרגה {tier} ב{track} — {reward}", {
            tier,
            track: trackWord,
            reward: t(reward.label),
          })}
          className="mt-1 w-full rounded-md border border-emerald-400/70 bg-emerald-500 px-1 py-1 text-[11px] font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? t("אוסף...") : t("אסוף")}
        </button>
      )}

      {/* The scrim exists only for the split second its lock is breaking away
          on purchase. A permanent one used to sit a padlock squarely on top of
          the amount — obscuring the very number the gold track is selling. */}
      {unlocking && (
        <span
          aria-hidden
          style={{ animationDelay: `${delay}ms` }}
          className="sp-lockbreak pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45"
        >
          <Icon name="lock" size={18} className="text-gold-dim" />
        </span>
      )}
    </div>
  );
}

/**
 * A chapter divider, pinned to the top of the scroller while its ten rungs pass
 * underneath — so you always know which stretch of road you are looking at and
 * how much of it you have banked.
 */
function ChapterHead({
  from,
  to,
  claimed,
  total,
  active,
}: {
  from: number;
  to: number;
  claimed: number;
  total: number;
  active: boolean;
}) {
  const t = useT();
  const complete = total > 0 && claimed === total;
  return (
    <div
      // Opaque, not translucent: it is pinned *over* the rungs it describes, and
      // a tile sliding under a see-through header reads as a rendering fault.
      className={`sticky top-0 z-10 mb-1.5 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${
        active ? "border-emerald-500/45 bg-[#08150f]" : "border-border-subtle bg-[#0e0d12]"
      }`}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-black nums ${
          complete ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-zinc-400"
        }`}
      >
        {complete && <Icon aria-hidden name="check" size={10} />}
        {t("{claimed}/{total} נאספו", { claimed, total })}
      </span>
      <h3 className="flex items-center gap-1.5 text-[11px] font-black text-bone">
        <Icon
          aria-hidden
          name="laurel"
          size={13}
          className={active ? "text-emerald-400" : "text-gold-dim"}
        />
        {t("דרגות")}{" "}
        <span className="nums">
          {from}–{to}
        </span>
        {active && <span className="text-emerald-400">· {t("אתה כאן")}</span>}
      </h3>
    </div>
  );
}

/* ------------------------------ the head ------------------------------ */

/**
 * Progress, stated twice on purpose.
 *
 * The old head showed one bar — raw XP out of the cycle's 400 — which answers a
 * question nobody asks. A player wants to know "how close is the next reward"
 * (a handful of XP, one attack away) and "how far through the ladder am I". So
 * the rung bar carries the first, the cycle bar the second, and the medallion
 * states the tier outright.
 */
function ProgressConsole({
  state,
  tierCount,
}: {
  state: SeasonPassState;
  tierCount: number;
}) {
  const t = useT();
  const atMax = state.level >= tierCount;
  const intoRung = Math.max(0, state.xp - state.level * SEASON_PASS_XP_PER_TIER);
  const rungPct = atMax
    ? 100
    : Math.min(100, Math.round((intoRung / SEASON_PASS_XP_PER_TIER) * 100));
  const toNext = atMax
    ? 0
    : Math.max(0, (state.level + 1) * SEASON_PASS_XP_PER_TIER - state.xp);
  const cyclePct =
    state.xpMax > 0 ? Math.min(100, Math.round((state.xp / state.xpMax) * 100)) : 0;

  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-gold/30 bg-black/40 p-3">
      <div className="relative flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 border-gold/60 bg-gradient-to-b from-amber-800/50 to-black shadow-[0_0_18px_-6px_var(--gold)]">
        <span className="text-xl font-black leading-none text-gold-bright nums">
          {state.level}
        </span>
        <span className="mt-0.5 text-[8px] font-bold leading-none text-gold-dim nums">
          {t("מתוך {total}", { total: tierCount })}
        </span>
        <span className="sr-only">{t("דרגה נוכחית")}</span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-2">
          {/* Clamped: XP keeps accruing after rung 50, so a cleared ladder read
              "600/400 ניסיון" — which looks like an arithmetic bug rather than
              the overflow it is. The surplus buys nothing, so it is not
              information worth confusing anyone over. */}
          <span className="text-[11px] font-bold text-zinc-500 nums">
            {t("{xp}/{max} ניסיון · {pct}% מהסולם", {
              xp: Math.min(state.xp, state.xpMax),
              max: state.xpMax,
              pct: cyclePct,
            })}
          </span>
          <span className="text-[11px] font-black text-emerald-300 nums">
            {atMax
              ? t("כל הדרגות נפתחו")
              : t("עוד {xp} ניסיון לדרגה {tier}", {
                  xp: toNext,
                  tier: state.level + 1,
                })}
          </span>
        </p>

        {/* Rung bar — the next reward, which is always a few XP away. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={SEASON_PASS_XP_PER_TIER}
          aria-valuenow={atMax ? SEASON_PASS_XP_PER_TIER : intoRung}
          aria-valuetext={
            atMax
              ? t("כל הדרגות נפתחו")
              : t("עוד {xp} ניסיון לדרגה {tier}", { xp: toNext, tier: state.level + 1 })
          }
          className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-white/10"
        >
          <span
            className="absolute inset-y-0 right-0 rounded-full bg-emerald-400 transition-[width] duration-500"
            style={{ width: `${rungPct}%` }}
          />
        </div>

        {/* Cycle bar — the whole ladder, notched at every chapter break. The
            percentage lives in the caption above rather than inside the fill: a
            label printed over a bar that is gold on one side and black on the
            other cannot be legible against both. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={state.xpMax}
          aria-valuenow={state.xp}
          aria-valuetext={t("דרגה {level} מתוך {total} — {pct}% מהסולם", {
            level: state.level,
            total: tierCount,
            pct: cyclePct,
          })}
          className="relative mt-2 h-3.5 overflow-hidden rounded-full border border-gold/40 bg-black/60"
        >
          <span
            className="absolute inset-y-0 right-0 bg-gradient-to-l from-gold to-gold-bright transition-[width] duration-500"
            style={{ width: `${cyclePct}%` }}
          />
          {[20, 40, 60, 80].map((at) => (
            <span
              key={at}
              aria-hidden
              className="absolute inset-y-0 w-px bg-black/60"
              style={{ right: `${at}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ celebration ------------------------------ */

/**
 * Confetti positions. Hard-coded rather than randomised: this renders inside a
 * client component that can be server-rendered on a later navigation, and a
 * Math.random() here would produce a hydration mismatch.
 */
const CONFETTI = [
  { left: 6, delay: 0, dur: 2.6, tone: "var(--gold-bright)" },
  { left: 14, delay: 0.5, dur: 3.2, tone: "#34d399" },
  { left: 23, delay: 0.15, dur: 2.9, tone: "var(--gold)" },
  { left: 31, delay: 0.9, dur: 3.4, tone: "#f87171" },
  { left: 39, delay: 0.3, dur: 2.7, tone: "var(--gold-bright)" },
  { left: 47, delay: 1.1, dur: 3.1, tone: "#38bdf8" },
  { left: 55, delay: 0.2, dur: 3.5, tone: "var(--gold)" },
  { left: 63, delay: 0.75, dur: 2.8, tone: "#34d399" },
  { left: 71, delay: 0.45, dur: 3.3, tone: "var(--gold-bright)" },
  { left: 79, delay: 1.3, dur: 2.6, tone: "#f87171" },
  { left: 87, delay: 0.6, dur: 3.0, tone: "var(--gold)" },
  { left: 94, delay: 0.05, dur: 3.4, tone: "#38bdf8" },
];

/**
 * The "you cleared the whole ladder" moment.
 *
 * Deliberately a sibling of the pass modal rather than a child: the per-claim
 * haul panel dies with the modal, which meant finishing the ladder — the one
 * thing worth celebrating — flashed past and vanished on the next ✕. This
 * survives closing the pass and has to be dismissed on its own.
 */
function CycleClearedOverlay({
  haul,
  tierCount,
  day,
  cycleEndsAt,
  owned,
  lockedValue,
  onClose,
}: {
  haul: SeasonPassHaulEntry[];
  tierCount: number;
  day: number;
  cycleEndsAt: number;
  owned: boolean;
  /** What the gold track would have added, for a free player who just cleared. */
  lockedValue: SeasonPassHaulEntry[];
  onClose: () => void;
}) {
  const t = useT();
  const dir = useDir();
  const dialogRef = useModalChrome(onClose);
  return (
    <div
      dir={dir}
      onClick={onClose}
      className="fixed inset-x-0 top-0 z-[100] flex h-[100dvh] items-center justify-center overflow-hidden bg-black/85 p-4 backdrop-blur-sm"
    >
      {/* confetti rains over the whole screen, behind the card */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className="sp-confetti absolute top-[-8%] h-3 w-1.5 rounded-sm"
            style={{
              left: `${c.left}%`,
              background: c.tone,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.dur}s`,
            }}
          />
        ))}
      </span>

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-cleared-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="sp-cheer ornate-shell relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl"
      >
        <div className="min-h-0 overflow-y-auto p-6 text-center">
          <p aria-hidden className="sp-trophy text-5xl leading-none">
            🏆
          </p>
          <h2 id="sp-cleared-title" className="mt-3 text-2xl font-black text-gold-bright">
            {t("וואו! ניקית הכול 🔥")}
          </h2>
          <p className="nums mt-1.5 text-sm font-bold text-zinc-300">
            {t("סיימת את כל {total} הדרגות של דרך התהילה — ביום {day} של העונה. משוגע.", {
              total: tierCount,
              day,
            })}
          </p>

          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3">
            <p className="text-xs font-black text-emerald-300">
              {t("כל השלל של הסבב הזה")}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {haul.map((entry, i) => (
                <div
                  key={entry.kind}
                  style={{ animationDelay: `${i * 70}ms` }}
                  className="haul-tile flex flex-col items-center justify-center gap-1 rounded-lg border border-emerald-500/25 bg-black/50 p-2"
                >
                  <Icon
                    name={RESOURCE_ICON[entry.kind]}
                    size={24}
                    className={RESOURCE_ICON_COLOR[entry.kind]}
                  />
                  <span className="text-sm font-black text-emerald-200 nums">
                    +{formatNumber(entry.amount)}
                  </span>
                  <span className="text-[10px] font-bold leading-none text-zinc-400">
                    {t(SEASON_PASS_REWARD_LABEL[entry.kind])}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-gold/40 bg-amber-950/30 p-3">
            <p className="text-xs font-bold text-amber-100/90">
              {t("סבב חדש נפתח בעדכון היומי הבא, בעוד")}{" "}
              <b className="text-gold-bright">
                <CycleCountdown key={cycleEndsAt} endsAt={cycleEndsAt} />
              </b>
            </p>
            {/* Payouts are priced per season *day*, not per cycle: the ladder
                refills twice a day and only one of those refills a day crosses
                the season's own day rollover. Saying "next cycle pays more"
                would be a promise the math keeps at most half the time. */}
            <p className="mt-1 text-[11px] text-zinc-400">
              {t("הסולם יתמלא מחדש — וכל יום שעובר בעונה מגדיל את התגמולים בכל דרגה")}
            </p>
          </div>

          {!owned && (
            <div className="mt-3 rounded-xl border border-gold/40 bg-black/50 p-3">
              <p className="flex items-center justify-center gap-1.5 text-[11px] font-black text-gold-bright">
                <Icon aria-hidden name="lock" size={12} />
                {t("זה מה שהצד הזהוב היה מוסיף על השלל הזה")}
              </p>
              <RewardChips entries={lockedValue} className="mt-2" />
            </div>
          )}

          <button onClick={onClose} className="btn btn-gold mt-4 w-full py-2.5 font-black">
            {t("יאללה, בחזרה לקרב")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ modal chrome ------------------------------ */

/**
 * Escape-to-close, a focus trap, background scroll lock, and returning focus to
 * whatever opened the dialog.
 *
 * Both overlays here are hand-built — they need a pinned head above a single
 * scrolling ladder, which the shared `Dialog` shell cannot express — so the
 * behaviour every dialog owes a keyboard user has to come from somewhere.
 * Without this, Tab walked straight out of an open pass into the page behind
 * it and Escape did nothing at all.
 *
 * `onClose` is held in a ref so a caller that rebuilds the callback each render
 * cannot re-run the effect and yank focus back to the top mid-interaction.
 */
function useModalChrome(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const box = ref.current;
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const focusable = [
        ...box.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    box?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  // Refcounted, so a takeover landing over an open pass cannot leave the page
  // scroll-locked after both are gone — see ui/scrollLock.
  useScrollLock(true);

  return ref;
}

/* ------------------------------ the pass ------------------------------ */

export function SeasonPassButton({ initial }: { initial: SeasonPassState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(initial);
  const [unlocking, setUnlocking] = useState(false);
  const [flash, setFlash] = useState(false);
  const [shake, setShake] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [haul, setHaul] = useState<{ entries: SeasonPassHaulEntry[]; tiers: number } | null>(null);
  const [cleared, setCleared] = useState<SeasonPassHaulEntry[] | null>(null);
  // Which tile's own button is spinning, `"{tier}:{track}"`. Null during a
  // collect-all, so the head's button is the only thing that says "אוסף...".
  const [claimingTile, setClaimingTile] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ladderRef = useRef<HTMLDivElement | null>(null);
  const currentRowRef = useRef<HTMLDivElement | null>(null);
  const [offTrack, setOffTrack] = useState(false);

  // The layout re-renders with fresh server state after every claim/purchase
  // (revalidatePath), so adopt it rather than drifting on stale local state.
  // Adopted during render, not from an effect: an effect would paint the stale
  // ladder first and only then correct it, so a just-claimed tier flashed back
  // to "collectable" for a frame.
  const [syncedTo, setSyncedTo] = useState(initial);
  if (syncedTo !== initial) {
    setSyncedTo(initial);
    setState(initial);
  }

  const { premium: owned, tiers, collectable } = state;
  const canAfford = state.diamonds >= state.price;
  const canBuy = canAfford;
  const currentTier = Math.max(1, state.level);

  /**
   * The three sums the modal is really about, all derived from the tier views:
   * what the collect button is about to pay, what the gold track adds over a
   * whole cycle, and what the free track pays for a full clear. Every one of
   * them used to be information the player could only get by scrolling fifty
   * rows and doing the arithmetic in their head.
   */
  const pendingHaul = useMemo(
    () =>
      totalByKind(
        tiers.flatMap((t) => {
          if (!t.reached) return [];
          const take: SeasonPassRewardView[] = [];
          if (!t.free.claimed) take.push(t.free);
          if (owned && !t.premium.claimed) take.push(t.premium);
          return take;
        })
      ),
    [tiers, owned]
  );
  const premiumTrackTotal = useMemo(
    () => totalByKind(tiers.map((t) => t.premium)),
    [tiers]
  );
  const freeTrackTotal = useMemo(() => totalByKind(tiers.map((t) => t.free)), [tiers]);

  /** The ladder split into ten-rung chapters, each with its own claim tally. */
  const chapters = useMemo<Chapter[]>(() => {
    const out: Chapter[] = [];
    for (let i = 0; i < tiers.length; i += TIERS_PER_CHAPTER) {
      const rows = tiers.slice(i, i + TIERS_PER_CHAPTER);
      // Only rewards actually on offer count toward the tally: for a free
      // player the gold track was never theirs to collect, so counting it would
      // pin every chapter at half done forever.
      const total = rows.length * (owned ? 2 : 1);
      const claimed = rows.reduce(
        (n, t) => n + (t.free.claimed ? 1 : 0) + (owned && t.premium.claimed ? 1 : 0),
        0
      );
      out.push({
        from: rows[0].tier,
        to: rows[rows.length - 1].tier,
        rows,
        total,
        claimed,
        active: currentTier >= rows[0].tier && currentTier <= rows[rows.length - 1].tier,
      });
    }
    return out;
  }, [tiers, owned, currentTier]);

  const scrollToCurrent = useCallback((smooth: boolean) => {
    const box = ladderRef.current;
    const row = currentRowRef.current;
    if (!box || !row) return;
    // Nudged down by half a chapter header, since one is always pinned over the
    // top of the scrollport and would otherwise sit on the row we just aimed at.
    const top =
      row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2 + CHAPTER_HEAD_H / 2;
    box.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Open the ladder at the tier the player is actually on. Fifty rows means the
  // part that matters — what just unlocked and what is next — is otherwise
  // buried, and the top of the list is all long-since-collected tiers.
  //
  // Deferred by a frame: the ladder is a `flex-1` child of a shell that is
  // still sizing itself on the effect pass, so `clientHeight` reads far too
  // small and "centre the row" degenerates into "scroll it to the top" — which
  // is exactly where the current rung kept landing, half under the header.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => scrollToCurrent(false));
    return () => cancelAnimationFrame(id);
  }, [open, scrollToCurrent]);

  // …and offer a way back once they have wandered off. Without it the only
  // route back to your own position in a 50-row list is to scroll and hunt.
  useEffect(() => {
    if (!open) return;
    const box = ladderRef.current;
    const row = currentRowRef.current;
    if (!box || !row) return;
    const io = new IntersectionObserver(
      ([entry]) => setOffTrack(!entry.isIntersecting),
      { root: box, threshold: 0.5 }
    );
    io.observe(row);
    return () => io.disconnect();
  }, [open]);

  /**
   * Closing the pass throws away the post-claim panels with it. They report
   * what *just* happened, so leaving them in state meant reopening the ladder
   * an hour later still greeted you with "השלל נאסף" from the last claim — a
   * message that looked stuck, because only its own ✕ ever cleared it.
   */
  const closePass = useCallback(() => {
    setOpen(false);
    setHaul(null);
    setNotice(null);
    setOffTrack(false);
  }, []);

  const closeCleared = useCallback(() => setCleared(null), []);

  function reject(message?: string) {
    setShake(true);
    setTimeout(() => setShake(false), 450);
    if (message) {
      setHaul(null);
      setNotice(message);
    }
  }

  function handleUpgrade() {
    if (owned || unlocking || pending) return;
    if (!canAfford) return reject();

    startTransition(async () => {
      const res = await buySeasonPassPremium();
      if (!res.ok || !res.state) {
        reject(res.error ?? t("הרכישה נכשלה"));
        return;
      }
      setState(res.state);
      setHaul(null);
      setNotice(res.message ?? null);
      // Celebrate only now: playing the cascade while the request was still in
      // flight made a *refused* sale look like a successful one, and the gold
      // track then snapped shut a second later with no obvious reason.
      setUnlocking(true);
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
      setTimeout(() => setUnlocking(false), UNLOCK_CASCADE_MS);
    });
  }

  /**
   * Fold a finished claim — whole ladder or single tile — back into the modal.
   * Both paths return the same shape, so the celebration, the haul panel and
   * the fresh ladder are handled once.
   */
  function absorbClaim(res: Awaited<ReturnType<typeof claimSeasonPassRewards>>) {
    if (res.ok && res.state) {
      setState(res.state);
      // The haul panel *is* the confirmation, so don't also print the
      // plain-text fallback underneath it.
      setHaul(
        res.haul?.length
          ? { entries: res.haul, tiers: res.haulTiers ?? res.haul.length }
          : null
      );
      setNotice(res.haul?.length ? null : res.message ?? null);
      setFlash(true);
      setTimeout(() => setFlash(false), 700);

      // Clearing the ladder gets its own takeover — but only once per cycle,
      // remembered across reloads. Without the guard, every later render that
      // still reads `cleared` would re-fire it, and the reward for finishing
      // would be a popup that will not stay shut.
      if (res.state.cleared && res.cycleHaul?.length && markCleared(res.state.cycleEndsAt)) {
        setCleared(res.cycleHaul);
      }
    } else {
      setHaul(null);
      setNotice(res.error ?? t("האיסוף נכשל"));
    }
  }

  /** Collect one rung on one track, leaving the rest of the ladder standing. */
  function handleClaimTile(tier: number, track: "free" | "premium") {
    if (pending) return;
    setClaimingTile(`${tier}:${track}`);
    startTransition(async () => {
      absorbClaim(await claimSeasonPassTier(tier, track));
      setClaimingTile(null);
    });
  }

  function handleClaim() {
    if (pending || collectable === 0) return;
    setClaimingTile(null);
    startTransition(async () => absorbClaim(await claimSeasonPassRewards()));
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`btn gap-2 px-4 py-1.5 text-sm ${owned ? "btn-gold" : "btn-dark"}`}
      >
        {t("דרך התהילה")}
        {collectable > 0 && (
          <span className="rounded-full bg-emerald-500 px-1.5 text-[9px] font-black text-white nums">
            {collectable}
            <span className="sr-only"> {t("דרגות מוכנות לאיסוף")}</span>
          </span>
        )}
        {owned ? (
          <span className="rounded bg-emerald-500 px-1 text-[9px] font-black text-white">
            {t("פרימיום")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 animate-pulse rounded bg-red-500 px-1 text-[9px] font-black text-white">
            {t("שדרג")} <Icon aria-hidden name="spark" size={11} />
          </span>
        )}
      </button>

      {open && (
        <div
          // The overlay itself must NOT scroll. With one scroller here and
          // another around a 50-row ladder, a wheel gesture moved whichever the
          // browser felt like — the dialog drifting under the pointer while the
          // ladder crawled. The shell is height-capped instead, and the ladder
          // below is the single scroll region.
          // `h-[100dvh]`, not `inset-0`: the shell below is `max-h-full`, and
          // against a vh-tall box on a phone that capped the ladder to a height
          // that ran under the browser toolbar. See ui/Dialog.
          className="fixed inset-x-0 top-0 z-[100] flex h-[100dvh] items-center justify-center overflow-hidden bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          onClick={closePass}
        >
          <PassDialog
            state={state}
            chapters={chapters}
            currentTier={currentTier}
            pendingHaul={pendingHaul}
            premiumTrackTotal={premiumTrackTotal}
            freeTrackTotal={freeTrackTotal}
            ladderRef={ladderRef}
            currentRowRef={currentRowRef}
            offTrack={offTrack}
            scrollToCurrent={scrollToCurrent}
            unlocking={unlocking}
            flash={flash}
            shake={shake}
            pending={pending}
            notice={notice}
            haul={haul}
            canAfford={canAfford}
            canBuy={canBuy}
            claimingTile={claimingTile}
            onClose={closePass}
            onClaim={handleClaim}
            onClaimTile={handleClaimTile}
            onUpgrade={handleUpgrade}
            onDismissHaul={() => setHaul(null)}
          />
        </div>
      )}

      {/* Sibling of the pass modal, not a child — closing the pass must not take
          the celebration with it. */}
      {cleared && (
        <CycleClearedOverlay
          haul={cleared}
          tierCount={tiers.length}
          day={state.day}
          cycleEndsAt={state.cycleEndsAt}
          owned={owned}
          lockedValue={premiumTrackTotal}
          onClose={closeCleared}
        />
      )}
    </>
  );
}

interface Chapter {
  from: number;
  to: number;
  rows: SeasonPassTierView[];
  total: number;
  claimed: number;
  active: boolean;
}

/**
 * The dialog itself, split out from the trigger so `useModalChrome` mounts and
 * unmounts with it — a hook cannot run conditionally, and the chrome (focus
 * trap, scroll lock, focus restore) only makes sense while the pass is open.
 */
function PassDialog({
  state,
  chapters,
  currentTier,
  pendingHaul,
  premiumTrackTotal,
  freeTrackTotal,
  ladderRef,
  currentRowRef,
  offTrack,
  scrollToCurrent,
  unlocking,
  flash,
  shake,
  pending,
  notice,
  haul,
  canAfford,
  canBuy,
  claimingTile,
  onClose,
  onClaim,
  onClaimTile,
  onUpgrade,
  onDismissHaul,
}: {
  state: SeasonPassState;
  chapters: Chapter[];
  currentTier: number;
  pendingHaul: SeasonPassHaulEntry[];
  premiumTrackTotal: SeasonPassHaulEntry[];
  freeTrackTotal: SeasonPassHaulEntry[];
  ladderRef: RefObject<HTMLDivElement | null>;
  currentRowRef: RefObject<HTMLDivElement | null>;
  offTrack: boolean;
  scrollToCurrent: (smooth: boolean) => void;
  unlocking: boolean;
  flash: boolean;
  shake: boolean;
  pending: boolean;
  notice: string | null;
  haul: { entries: SeasonPassHaulEntry[]; tiers: number } | null;
  canAfford: boolean;
  canBuy: boolean;
  /** `"{tier}:{track}"` of the tile whose own claim is in flight, if any. */
  claimingTile: string | null;
  onClose: () => void;
  onClaim: () => void;
  onClaimTile: (tier: number, track: "free" | "premium") => void;
  onUpgrade: () => void;
  onDismissHaul: () => void;
}) {
  const t = useT();
  const dir = useDir();
  const dialogRef = useModalChrome(onClose);
  const { premium: owned, tiers, collectable } = state;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sp-title"
      tabIndex={-1}
      dir={dir}
      onClick={(e) => e.stopPropagation()}
      className="ornate-shell flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl"
    >
      {/* celebratory flash overlay */}
      {flash && (
        <span
          aria-hidden
          className="sp-flash pointer-events-none absolute left-1/2 top-1/2 z-10 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--gold-bright),transparent_70%)]"
        />
      )}

      {/* Pinned head: identity, progress, claim CTA. Stays put while the ladder
          scrolls, so the collect button is reachable from row 50.
          `shrink-0` is required, not cosmetic: the ladder is `flex-1` (basis
          0%), and a percentage basis against the shell's indefinite height
          resolves to *content* — all 50 rows. That makes the flex pass see huge
          negative free space and, if the head were shrinkable, crush it to
          ~100px with its own scrollbar. Which is precisely the
          two-scrollbars-at-once problem.
          Below ~560px tall the head alone no longer fits, so there it does
          shrink and scroll internally — better than clipping the collect button
          out of reach. Normal viewports never hit that branch. */}
      <div className="shrink-0 overflow-y-auto p-5 pb-4 [@media(max-height:560px)]:min-h-0 [@media(max-height:560px)]:shrink">
        <div className="flex items-center justify-between gap-2">
          <CloseButton onClick={onClose} label={t("סגור את דרך התהילה")} />
          <h2
            id="sp-title"
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xl font-black text-zinc-100 sm:text-2xl"
          >
            <Icon aria-hidden name="crown" size={20} className="text-gold" />
            {t("דרך התהילה")}
            <span className="rounded bg-red-500 px-1.5 text-[10px] font-black text-white nums">
              {t("יום {day}", { day: state.day })}
            </span>
            {/* Ownership as a chip rather than the old full-width green banner:
                it is a permanent fact about the account, not news, and the box
                it used to live in cost a fifth of the modal's height forever. */}
            {owned && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-black text-emerald-300">
                <Icon aria-hidden name="unlocked" size={11} /> {t("פרימיום פעיל")}
              </span>
            )}
          </h2>
          <span aria-hidden className="w-8 shrink-0" />
        </div>

        <ProgressConsole state={state} tierCount={tiers.length} />

        <p className="mt-1.5 text-center text-[10px] text-zinc-500">
          {t("מתאפס בעדכון היומי הבא בעוד")}{" "}
          <CycleCountdown key={state.cycleEndsAt} endsAt={state.cycleEndsAt} />{" "}
          {t("— וכל יום שעובר בעונה מגדיל את התגמולים")}
        </p>

        {/* Claim console — the modal's primary action, and the one place that
            answers "what do I get if I press this?" before it is pressed. */}
        <div aria-live="polite">
          {collectable > 0 || pending ? (
            <div className="mt-3 rounded-xl border border-emerald-500/45 bg-gradient-to-b from-emerald-950/55 to-black/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-200 nums">
                  {t("{count} דרגות", { count: collectable })}
                </span>
                <p className="flex items-center gap-1.5 text-xs font-black text-emerald-300">
                  <Icon aria-hidden name="gift" size={14} />
                  {t("מחכה לך לאיסוף")}
                </p>
              </div>
              <RewardChips entries={pendingHaul} className="mt-2" />
              <button
                onClick={onClaim}
                disabled={pending}
                className="btn btn-gold mt-2.5 w-full py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending
                  ? t("אוסף...")
                  : owned
                    ? t("אסוף את השלל")
                    : t("אסוף את השלל החינמי")}
              </button>
            </div>
          ) : (
            // A dead, greyed-out button reads as broken; when there is nothing
            // to take, say so as a status line instead — and say the right
            // thing, since "you collected everything" is nonsense to a player
            // who has not yet reached rung one.
            //
            // The icon is inline with the text, not a flex sibling: this copy
            // wraps to two lines on a phone, and a centred flex child then
            // floats off on its own at the edge of the box.
            <p className="mt-3 rounded-lg border border-border-subtle bg-black/30 px-3 py-2 text-center text-xs font-bold leading-relaxed text-zinc-400">
              {state.level === 0 ? (
                <>
                  <Icon
                    aria-hidden
                    name="spark"
                    size={13}
                    className="ms-1 inline-block align-text-bottom text-gold"
                  />
                  {t("כל פעולה במשחק מזכה בניסיון — תקוף או בנה כדי לפתוח את הדרגה הראשונה")}
                </>
              ) : (
                <>
                  <Icon
                    aria-hidden
                    name="check"
                    size={13}
                    className="ms-1 inline-block align-text-bottom text-emerald-500"
                  />
                  {t("אספת כל מה שנפתח — עלה דרגה כדי לפתוח עוד")}
                </>
              )}
            </p>
          )}

          {haul && (
            <HaulPanel
              key={haul.entries.map((e) => `${e.kind}:${e.amount}`).join()}
              haul={haul.entries}
              tiers={haul.tiers}
              onDismiss={onDismissHaul}
            />
          )}

          {notice && (
            <p className="mt-3 rounded-lg border border-gold/40 bg-amber-950/40 p-2 text-center text-xs font-bold text-amber-100">
              {notice}
            </p>
          )}
        </div>

        {/* Premium upsell, priced in the resources it actually pays. "פי 3" is a
            ratio of a number the player has never been shown; a row of
            "+27,000 🪙" chips is the offer itself.

            Hidden only from an owner, who has nothing left to buy. Everyone
            else always gets a live buy button — the offer never depends on the
            state of a season row. */}
        {!owned && (
          <div
            className={`mt-3 overflow-hidden rounded-xl border-2 border-gold/60 bg-gradient-to-br from-amber-900/40 via-amber-950/50 to-black p-3 text-center shadow-[0_0_30px_-8px_var(--gold)] ${
              shake ? "sp-shake" : ""
            }`}
          >
            <p className="flex items-center justify-center gap-1.5 text-base font-black text-gold-bright">
              <Icon aria-hidden name="crown" size={18} /> {t("פתח את הצד הזהוב")}
            </p>
            <p className="nums mt-0.5 text-[11px] text-amber-100/80">
              {t("פי {multiplier} שלל בכל אחת מ־{tiers} הדרגות · תשלום אחד לכל העונה", {
                multiplier: SEASON_PASS_PREMIUM_MULTIPLIER,
                tiers: tiers.length,
              })}
            </p>
            <RewardChips entries={premiumTrackTotal} className="mt-2" />
            <p className="mt-1 text-[10px] text-amber-200/50">
              {t("זה מה שהמסלול הזהוב מוסיף בסבב אחד — ויש שני סבבים ביום")}
            </p>
            <button
              onClick={onUpgrade}
              disabled={unlocking || pending}
              className={`btn btn-gold mt-2.5 w-full py-2.5 text-base font-black disabled:cursor-not-allowed disabled:opacity-60 ${
                unlocking || !canBuy ? "" : "animate-pulse"
              }`}
            >
              {unlocking || pending ? (
                t("פותח...")
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Icon aria-hidden name="unlocked" size={15} /> {t("שדרג עכשיו")} ·{" "}
                  {state.price}{" "}
                  <Icon aria-hidden name="diamond" size={14} className="text-cyan-300" />
                </span>
              )}
            </button>
            <p
              className={`mt-1.5 text-[10px] ${
                canBuy ? "text-amber-200/60" : "font-bold text-red-400"
              }`}
            >
              {canAfford ? (
                <span className="nums inline-flex items-center gap-1">
                  {t("יש לך {count}", { count: state.diamonds })}{" "}
                  <Icon aria-hidden name="diamond" size={12} className="text-cyan-300" />{" "}
                  {t("· נשאר פתוח עד סוף העונה")}
                </span>
              ) : (
                <span className="nums inline-flex items-center gap-1">
                  {t("אין מספיק יהלומים ({have}/{price}", {
                    have: state.diamonds,
                    price: state.price,
                  })}{" "}
                  <Icon aria-hidden name="diamond" size={12} className="text-cyan-300" />)
                </span>
              )}
            </p>
          </div>
        )}

        {/* Column headers: right = free, left = premium (RTL). They live in the
            pinned head rather than inside the scroller, so you can still tell
            the two tracks apart forty rows down. The gutter below is reserved
            on both so the columns stay aligned with these. */}
        <div className="mt-4 grid grid-cols-[1fr_3rem_1fr] items-center gap-2 [scrollbar-gutter:stable]">
          <div
            className={`flex items-center justify-center gap-1 rounded-lg border py-1.5 text-center text-xs font-black ${
              owned
                ? "border-gold/60 bg-amber-900/50 text-gold-bright"
                : "border-gold/40 bg-amber-950/50 text-gold-dim"
            }`}
          >
            <Icon aria-hidden name="crown" size={13} /> {t("פרימיום")}
            {!owned && <Icon aria-hidden name="lock" size={11} />}
          </div>
          <div />
          <div className="rounded-lg border border-sky-500/40 bg-sky-950/40 py-1.5 text-center text-xs font-black text-sky-200">
            {t("חינמי")}
          </div>
        </div>
      </div>

      {/* The one and only scroll region — the shell itself is height-capped and
          `overflow-hidden`, so nothing else on the page can scroll while this
          is open. `min-h-0` is what actually lets a flex child shrink below its
          content height; without it fifty rows push the shell past max-h and
          the overlay starts scrolling too.
          `relative` is load-bearing as well: the auto-scroll measures
          row.offsetTop, which is relative to the nearest positioned ancestor —
          without it that would be .ornate-shell and every row would measure the
          pinned head's height too low. */}
      <div
        ref={ladderRef}
        className="relative min-h-36 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2 [scrollbar-gutter:stable] [@media(max-height:560px)]:h-36 [@media(max-height:560px)]:flex-none"
      >
        {chapters.map((chapter) => (
          <section key={chapter.from} className="mb-1">
            <ChapterHead
              from={chapter.from}
              to={chapter.to}
              claimed={chapter.claimed}
              total={chapter.total}
              active={chapter.active}
            />
            {chapter.rows.map((t) => {
              // Every tenth rung is a landmark, so 50 rows still read as a
              // journey with waypoints instead of an undifferentiated list.
              const milestone = t.tier % TIERS_PER_CHAPTER === 0;
              const current = t.tier === currentTier;
              return (
                <div
                  key={t.tier}
                  ref={current ? currentRowRef : undefined}
                  aria-current={current ? "step" : undefined}
                  className={`grid grid-cols-[1fr_3rem_1fr] items-stretch gap-2 rounded-lg py-1 ${
                    current ? "bg-emerald-500/[0.07] ring-1 ring-emerald-500/25" : ""
                  }`}
                >
                  <TierTile
                    reward={t.premium}
                    tier={t.tier}
                    track="premium"
                    reached={t.reached}
                    state={tileState(t.premium, t.reached, owned)}
                    unlocking={unlocking}
                    delay={Math.min(t.tier - 1, UNLOCK_CASCADE_ROWS) * UNLOCK_CASCADE_STEP}
                    onClaim={() => onClaimTile(t.tier, "premium")}
                    busy={claimingTile === `${t.tier}:premium`}
                    disabled={pending}
                  />

                  {/* The rail: one climbing line threaded behind the tier
                      numbers, gold as far as you have come and dead ahead of
                      you. It is what turns two parallel lists of boxes into a
                      single road with a position on it. */}
                  <div className="relative flex items-center justify-center">
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 w-[3px] ${
                        t.reached
                          ? "bg-gradient-to-b from-gold/80 to-gold/50"
                          : "bg-white/[0.07]"
                      }`}
                    />
                    <span
                      aria-hidden
                      className={`relative flex items-center justify-center rounded-full font-black shadow ${
                        milestone ? "h-9 w-9 text-sm ring-2 ring-gold/50" : "h-7 w-7 text-[11px]"
                      } ${
                        t.reached
                          ? "bg-gradient-to-b from-gold-bright to-gold text-black"
                          : "bg-zinc-800 text-zinc-500"
                      } ${current ? "ring-2 ring-emerald-400" : ""}`}
                    >
                      {t.tier}
                    </span>
                  </div>

                  <TierTile
                    reward={t.free}
                    tier={t.tier}
                    track="free"
                    reached={t.reached}
                    state={tileState(t.free, t.reached, true)}
                    onClaim={() => onClaimTile(t.tier, "free")}
                    busy={claimingTile === `${t.tier}:free`}
                    disabled={pending}
                  />
                </div>
              );
            })}
          </section>
        ))}

        {/* End of the road: what a full clear is worth. The head can only ever
            show what is claimable *now*, so the ladder's own total — the thing
            that tells you whether finishing is worth the turns — belongs here,
            where finishing actually lands you. */}
        <div className="mt-2 rounded-xl border border-gold/30 bg-black/45 p-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs font-black text-gold-bright">
            <Icon aria-hidden name="rankings" size={14} />{" "}
            {t("סבב מלא — כל {tiers} הדרגות", { tiers: tiers.length })}
          </p>
          <p className="mt-1.5 text-[10px] font-bold text-sky-300">{t("מסלול חינמי")}</p>
          <RewardChips entries={freeTrackTotal} className="mt-1" />
          <p className="mt-2 text-[10px] font-bold text-gold-dim">
            {owned ? t("מסלול פרימיום (בנוסף)") : t("מסלול פרימיום — נעול")}
          </p>
          <RewardChips entries={premiumTrackTotal} className="mt-1" />
        </div>

        {/* Sticky escape hatch back to your own rung. Last child of the
            scroller, so it pins to the bottom edge while there is content below
            and settles into the flow at the end. */}
        {offTrack && (
          <div className="pointer-events-none sticky bottom-1 z-20 flex justify-center pt-2">
            <button
              onClick={() => scrollToCurrent(true)}
              className="pointer-events-auto rounded-full border border-emerald-400/60 bg-black/90 px-3 py-1 text-[11px] font-black text-emerald-300 shadow-lg backdrop-blur focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
            >
              {t("חזרה לדרגה שלך ({tier})", { tier: currentTier })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
