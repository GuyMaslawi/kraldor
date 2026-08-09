"use client";

import { useActionState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { Meter } from "@/components/ui/Meter";
import { Tip } from "@/components/ui/Tip";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNumber, formatCompact } from "@/lib/game/format";
import {
  MONUMENT_MAX_LEVEL,
  MONUMENT_PCT_PER_LEVEL,
  type MonumentView,
  type MonumentsState,
} from "@/lib/game/monuments";
import { raiseMonument } from "@/server/actions/monuments";
import { MonumentVillage } from "@/components/game/MonumentVillage";
import { useT } from "@/i18n/client";

/**
 * /game/monuments — the capital's skyline.
 *
 * The screen opens on the ground the monuments stand on (MonumentVillage — an
 * isometric build site where each one grows with its level), and the cards
 * below are where the gold is actually spent. Every lot on the site is an
 * anchor to its own card, so there is exactly one place to buy a level; the
 * site shows state, it never changes it.
 *
 * One card per monument, each carrying the two numbers that decide whether it
 * is worth raising: what it pays now and what the next level costs. The screen
 * deliberately does *not* try to compute a payback period — that depends on the
 * player's own income, which the card does not know, and a wrong number here
 * would be worse than none.
 */
export function Monuments({ state }: { state: MonumentsState }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <section className="panel-gold rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
              <Icon name="crown" size={20} className="text-crimson-bright" />
              {t("מבני הבירה")}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
              {t("מבנים שנבנים פעם אחת ועומדים עד סוף העונה. כל רמה מוסיפה {pct}% לאחד ממקורות ההכנסה של האימפריה — ואף מבנה אינו נוגע בכוח הקרב.", {
                pct: MONUMENT_PCT_PER_LEVEL,
              })}
            </p>
          </div>

          <Tip tip={t("רמות שהועלו מתוך כל הרמות האפשריות")}>
            <span className="text-center">
              <span className="block text-2xl font-black nums text-gold-bright">
                {state.built}/{state.total}
              </span>
              <span className="block text-[10px] font-bold text-zinc-500">
                {t("רמות")}
              </span>
            </span>
          </Tip>
        </div>
      </section>

      <MonumentVillage monuments={state.monuments} />

      <ul className="grid gap-4 lg:grid-cols-2">
        {state.monuments.map((monument, index) => (
          <MonumentCard key={monument.key} monument={monument} index={index} />
        ))}
      </ul>
    </div>
  );
}

function MonumentCard({
  monument,
  index,
}: {
  monument: MonumentView;
  index: number;
}) {
  const t = useT();
  const [result, formAction, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(raiseMonument, {});

  const maxed = monument.cost === null;
  const founded = monument.level > 0;

  return (
    <li
      id={`mono-${monument.key}`}
      style={
        { "--accent": monument.accent, "--i": index + 1 } as CSSProperties
      }
      className="mono-card panel scroll-mt-24 rounded-2xl p-4"
    >
      <span className="mono-glow" aria-hidden />

      <div className="relative flex items-start gap-3">
        <span className="mono-sigil flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border">
          <Icon name={monument.icon} size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-baseline gap-x-2 font-black text-gold-bright">
            {t(monument.name)}
            {founded && (
              <span className="rounded bg-black/40 px-1.5 text-[10px] font-bold nums text-zinc-400">
                {t("רמה {level}/{max}", {
                  level: monument.level,
                  max: MONUMENT_MAX_LEVEL,
                })}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            {t(monument.lore)}
          </p>
        </div>
      </div>

      {/* What it pays now, and what the next level makes it. Two figures side
          by side rather than one, because the decision on this card is always
          "is the step worth the price". */}
      <div className="relative mt-3 flex items-center gap-3">
        <span className="flex items-baseline gap-1.5">
          <span className="text-lg font-black nums text-emerald-300">
            {t(monument.effectLabel, { pct: monument.pct })}
          </span>
        </span>
        {!maxed && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-zinc-500">
            <span aria-hidden>→</span>
            <span className="nums text-gold-dim">
              {t(monument.effectLabel, { pct: monument.nextPct })}
            </span>
          </span>
        )}
      </div>

      <Meter
        value={monument.level}
        max={MONUMENT_MAX_LEVEL}
        tone="xp"
        className="relative mt-2 w-full"
      />

      <div className="relative mt-3">
        {maxed ? (
          <p className="inline-flex items-center gap-2 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm font-bold text-gold-bright">
            <Icon name="crown" size={16} />
            {t("במלוא גובהו")}
          </p>
        ) : (
          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="key" value={monument.key} />
            <button
              type="submit"
              disabled={pending || !monument.affordable}
              className="btn btn-gold px-4 py-2 text-sm disabled:opacity-50"
            >
              {pending ? t("בונה…") : founded ? t("הרם רמה") : t("ייסד")}
            </button>
            <Tip tip={formatNumber(monument.cost ?? 0) + " " + t("זהב")}>
              <span
                className={`flex items-center gap-1 text-sm font-bold nums ${
                  monument.affordable ? "text-gold" : "text-red-400"
                }`}
              >
                <Icon name="gold" size={14} />
                {formatCompact(monument.cost ?? 0)}
              </span>
            </Tip>
          </form>
        )}
      </div>

      {(result.error || result.success) && (
        <div className="relative mt-3">
          <FormMessage error={result.error} success={result.success} />
        </div>
      )}
    </li>
  );
}
