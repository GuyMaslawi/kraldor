"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { useAfterFirstPaint } from "@/components/ui/motion";
import { claimAchievement, claimAchievements } from "@/server/actions/achievements";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_META,
  type AchievementCategory,
  type AchievementRewardTotal,
  type AchievementsState,
  type AchievementView,
} from "@/lib/game/achievements";

const heNum = (n: number) => Math.round(n).toLocaleString("en-US");

/** Compact form for the big numbers the late ladder deals in. */
function short(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return heNum(n);
}

/** How close an unfinished achievement is to done, 0..1. */
const ratio = (a: AchievementView) => (a.goal > 0 ? a.progress / a.goal : 0);

/* ------------------------------ pieces ------------------------------ */

const PILL_TONE = {
  ready: "bg-emerald-500/20 text-emerald-300",
  locked: "bg-black/30 text-zinc-400",
  claimed: "bg-emerald-500/10 text-emerald-300/50",
} as const;

/**
 * Reward amount + its resource icon.
 *
 * The tone carries the page's visual hierarchy: only a reward you can take
 * right now gets the bright treatment. Painting every pill green made a locked
 * row shout as loudly as a collectable one.
 */
function RewardPill({
  item,
  tone = "ready",
}: {
  item: AchievementView;
  tone?: keyof typeof PILL_TONE;
}) {
  return (
    <span
      className={`nums flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold ${PILL_TONE[tone]}`}
    >
      <span dir="ltr">{short(item.rewardAmount)}</span>
      <Icon
        name={RESOURCE_ICON[item.rewardKind]}
        size={14}
        className={
          tone === "ready" ? RESOURCE_ICON_COLOR[item.rewardKind] : "opacity-45 grayscale"
        }
        aria-hidden
      />
    </span>
  );
}

function Medallion({ item }: { item: AchievementView }) {
  const tone = item.claimed
    ? { ring: "border-emerald-500/50", icon: "text-emerald-400/70" }
    : item.unlocked
      ? { ring: "border-gold", icon: "text-gold-bright" }
      : { ring: "border-white/10", icon: "text-zinc-600" };
  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-panel-inset ${tone.ring} ${
        item.unlocked && !item.claimed ? "shadow-[0_0_14px_-4px_var(--gold)]" : ""
      }`}
    >
      <Icon name={item.icon} size={22} className={tone.icon} />
    </span>
  );
}

function LockedCard({ item, t }: { item: AchievementView; t: T }) {
  const pct = Math.min(100, ratio(item) * 100);
  return (
    <div className="panel flex items-start gap-3 rounded-xl p-3.5">
      <Medallion item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold text-zinc-300">{t(item.name, item.params)}</p>
          <RewardPill item={item} tone="locked" />
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
          {t(item.hint, item.params)}
        </p>
        {/* A 1-of-1 milestone has no meaningful progress to draw. */}
        {item.goal > 1 && (
          <div className="mt-2">
            <div className="relative h-1.5 overflow-hidden rounded-full bg-black/50">
              <span
                className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-gold-dim to-gold"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="nums mt-1 block text-[10px] text-zinc-500" dir="ltr">
              {short(item.progress)} / {short(item.goal)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A collectable achievement, with a collect button of its own.
 *
 * "אסוף הכל" is the fast path, not the only one: a player who wants a single
 * milestone — the gold for the upgrade they are two clicks from buying, and
 * nothing else — had to empty the whole ladder to get it. So every ready row
 * carries a full-size button next to the reward it pays.
 */
function ReadyCard({
  item,
  t,
  onClaim,
  busy,
  disabled,
}: {
  item: AchievementView;
  t: T;
  onClaim: () => void;
  /** This row's own claim is in flight. */
  busy: boolean;
  /** Some claim is in flight — this row's, another's, or the collect-all. */
  disabled: boolean;
}) {
  return (
    // Wraps on a narrow phone: medallion + name + reward on the first line, the
    // button across the second. Keeping all four inline at 320px left the
    // milestone's name as two letters and an ellipsis.
    <div className="panel flex flex-wrap items-center gap-3 rounded-xl border-gold/60 bg-gradient-to-l from-amber-950/40 to-transparent p-3.5 shadow-[0_0_20px_-10px_var(--gold)]">
      <Medallion item={item} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-black text-zinc-100">{t(item.name, item.params)}</p>
        {/* `min-w-0` on the nested flex row, not just the column: a flex
            container's own min-width is `auto`, so this line held the whole
            card open at its natural width and the row could not shrink to a
            320px phone even before the button was added to it. */}
        <p className="flex min-w-0 items-center gap-1 text-[11px] font-bold text-gold-bright">
          <Icon name="gift" size={12} className="shrink-0" />
          <span className="truncate">{t("מוכן לאיסוף")}</span>
        </p>
      </div>
      <RewardPill item={item} />
      <button
        onClick={onClaim}
        disabled={disabled}
        aria-label={t("אסוף את הפרס של {name}", { name: t(item.name, item.params) })}
        className="btn btn-gold w-full shrink-0 px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {busy ? t("אוסף...") : t("אסוף")}
      </button>
    </div>
  );
}

function ClaimedCard({ item, t }: { item: AchievementView; t: T }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      <Icon name={item.icon} size={16} className="shrink-0 text-emerald-400/60" />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-500">
        {t(item.name, item.params)}
      </span>
      <RewardPill item={item} tone="claimed" />
      <span className="shrink-0 text-xs font-bold text-emerald-400/70" aria-label={t("נאסף")}>
        ✓
      </span>
    </div>
  );
}

function Card({
  item,
  t,
  onClaim,
  busy,
  disabled,
}: {
  item: AchievementView;
  t: T;
  onClaim: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  if (item.claimed) return <ClaimedCard item={item} t={t} />;
  return item.unlocked ? (
    <ReadyCard item={item} t={t} onClaim={onClaim} busy={busy} disabled={disabled} />
  ) : (
    <LockedCard item={item} t={t} />
  );
}

/** One chip in the category filter row. */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
        active
          ? "border-gold/70 bg-gold/15 text-gold-bright"
          : "border-border-subtle text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The payout summary after a collect — one line per resource, merged across the
 * whole batch, so collecting fifty achievements does not print fifty fragments.
 */
function PayoutSummary({
  count,
  totals,
  onDismiss,
  t,
}: {
  count: number;
  totals: AchievementRewardTotal[];
  onDismiss: () => void;
  t: T;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-gold/50 bg-gradient-to-b from-amber-950/60 to-black/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-black text-gold-bright">
          <Icon name="gift" size={15} />{" "}
          {/* A single-row collect is now the common case, and "נאספו 1 הישגים"
              reads as a string-formatting bug. */}
          {count === 1 ? t("הישג אחד נאסף") : t("נאספו {count} הישגים", { count })}
        </p>
        <button
          onClick={onDismiss}
          aria-label={t("סגירה")}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-border-subtle text-zinc-500 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap justify-center gap-2">
        {totals.map((total) => (
          <span
            key={total.kind}
            className="nums flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-sm font-black text-emerald-200"
          >
            <Icon
              name={RESOURCE_ICON[total.kind]}
              size={16}
              className={RESOURCE_ICON_COLOR[total.kind]}
              aria-hidden
            />
            <span dir="ltr">+{heNum(total.amount)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ screen ------------------------------ */

export function AchievementList({ state }: { state: AchievementsState }) {
  const t = useT();
  const [payout, setPayout] = useState<{ count: number; totals: AchievementRewardTotal[] } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<AchievementCategory | "all">("all");
  // Which row's button is spinning. Null while the collect-all runs, so only
  // the big button says "אוסף..." then and fifty rows do not all claim to be
  // mid-collect at once.
  const [claiming, setClaiming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The completion bar grows into place from empty on the first paint rather
  // than appearing already filled — the ladder's one bit of ceremony.
  const painted = useAfterFirstPaint();

  // No local copy of the ladder: `claimAchievements` calls revalidatePath, and
  // the transition stays pending until that re-render lands, so `state` is
  // already the post-claim server truth by the time the button re-enables.
  const { items, collectable, claimed, total } = state;

  function handleClaim() {
    if (pending || collectable === 0) return;
    setError(null);
    setClaiming(null);
    startTransition(async () => {
      const res = await claimAchievements();
      if (res.ok) {
        setPayout({ count: res.count ?? 0, totals: res.totals ?? [] });
      } else {
        setError(res.error ?? t("האיסוף נכשל"));
      }
    });
  }

  /** Collect one milestone, leaving the rest of the ladder where it is. */
  function handleClaimOne(key: string) {
    if (pending) return;
    setError(null);
    setClaiming(key);
    startTransition(async () => {
      const res = await claimAchievement(key);
      if (res.ok) {
        setPayout({ count: res.count ?? 0, totals: res.totals ?? [] });
      } else {
        setError(res.error ?? t("האיסוף נכשל"));
      }
      // Cleared here rather than in an effect: the transition only settles once
      // the revalidated page has landed, so the row is already gone by now.
      setClaiming(null);
    });
  }

  // One list, always the whole ladder: collectable first, then the unfinished
  // ones closest to done, and everything already taken sinks to the bottom.
  const ordered = useMemo(() => {
    const rank = (i: AchievementView) => (i.claimed ? 2 : i.unlocked ? 0 : 1);
    return [...items].sort((a, b) => rank(a) - rank(b) || ratio(b) - ratio(a));
  }, [items]);

  const visible = useMemo(
    () => (category === "all" ? ordered : ordered.filter((i) => i.category === category)),
    [ordered, category]
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<AchievementCategory, number>();
    for (const i of items) {
      counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const donePct = total > 0 ? Math.round((claimed / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ---------- overall standing ---------- */}
      <div className="mx-auto max-w-xl">
        <div className="flex items-end justify-between gap-3 text-sm">
          <span className="font-bold text-zinc-400">
            {t("הושלמו")}{" "}
            <span className="nums font-black text-gold-bright" dir="ltr">
              {claimed}/{total}
            </span>
          </span>
          <span className="nums text-xs text-zinc-500" dir="ltr">
            {donePct}%
          </span>
        </div>
        <div className="tro-bar relative mt-1.5 h-2.5 overflow-hidden rounded-full border border-gold/30 bg-black/50">
          <span
            className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-gold to-gold-bright"
            style={{ width: painted ? `${donePct}%` : 0 }}
          />
        </div>
      </div>

      {/* ---------- call to action ---------- */}
      {collectable > 0 && (
        <div className="mx-auto max-w-xl rounded-xl border-2 border-gold/60 bg-gradient-to-br from-amber-900/40 via-amber-950/50 to-black p-4 text-center shadow-[0_0_30px_-8px_var(--gold)]">
          <p className="flex items-center justify-center gap-1.5 text-lg font-black text-gold-bright">
            <Icon name="gift" size={18} />
            {collectable === 1
              ? t("פרס אחד ממתין לך")
              : t("{count} פרסים ממתינים לך", { count: collectable })}
          </p>
          <button
            onClick={handleClaim}
            disabled={pending}
            className={`btn btn-gold mt-3 w-full py-2.5 text-base font-black disabled:opacity-70 ${
              pending ? "" : "animate-pulse"
            }`}
          >
            {pending ? (
              t("אוסף...")
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="gift" size={16} /> {t("אסוף הכל")}
              </span>
            )}
          </button>
        </div>
      )}

      {payout && (
        <PayoutSummary
          count={payout.count}
          totals={payout.totals}
          onDismiss={() => setPayout(null)}
          t={t}
        />
      )}
      {error && (
        <p className="mx-auto max-w-xl rounded-lg border border-red-500/40 bg-red-950/40 p-2 text-center text-xs font-bold text-red-200">
          {error}
        </p>
      )}

      {/* ---------- categories ---------- */}
      <div className="flex flex-wrap justify-center gap-1.5">
        <Chip active={category === "all"} onClick={() => setCategory("all")}>
          {t("הכל")}
          <span className="nums opacity-60" dir="ltr">
            {total}
          </span>
        </Chip>
        {ACHIEVEMENT_CATEGORIES.filter((c) => (categoryCounts.get(c) ?? 0) > 0).map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            <Icon name={ACHIEVEMENT_CATEGORY_META[c].icon} size={12} />
            {t(ACHIEVEMENT_CATEGORY_META[c].label)}
            <span className="nums opacity-60" dir="ltr">
              {categoryCounts.get(c)}
            </span>
          </Chip>
        ))}
      </div>

      {/* ---------- the list ---------- */}
      {visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-500">{t("אין הישגים בקטגוריה הזו")}</p>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {/* The stagger is capped at the first screenful: the ladder runs to
              dozens of rows, and an uncapped `--i` would still be dealing
              cards out four seconds after the page arrived. */}
          {visible.map((a, i) => (
            <div
              key={a.key}
              // `min-w-0`: a grid item's automatic minimum is its content's
              // min-content width, and the ready row's title is `truncate`
              // (white-space: nowrap) — so a long milestone name held the whole
              // column open past the viewport on a narrow phone instead of
              // being ellipsised. Without this the collect button pushed the
              // row off the screen edge entirely.
              className="tro-card min-w-0"
              style={{ "--i": Math.min(i, 12) } as CSSProperties}
            >
              <Card
                item={a}
                t={t}
                onClaim={() => handleClaimOne(a.key)}
                busy={claiming === a.key}
                disabled={pending}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
