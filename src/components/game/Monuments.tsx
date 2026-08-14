"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { useActionState, useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { Dialog } from "@/components/ui/Dialog";
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
 * The screen *is* the build site (MonumentVillage — an isometric plot where
 * every monument grows with its level). It used to be the site plus five cards
 * under it, with each lot an anchor down to its own card, and that was one
 * scroll down and one scroll back up for every level bought. Now a lot opens
 * the monument over the field: one dialog, carrying the lore, the ladder, the
 * price and the button, and the field never leaves the screen.
 *
 * The dialog deliberately does *not* try to compute a payback period — that
 * depends on the player's own income, which nothing here knows, and a wrong
 * number would be worse than none. What it does show is the pair the decision
 * actually turns on: what the monument pays now, and what the next level makes
 * that.
 */
export function Monuments({ state }: { state: MonumentsState }) {
  const t = useT();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const selected = state.monuments.find((m) => m.key === openKey) ?? null;

  return (
    <div className="space-y-4">
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
            <p className="mt-1.5 text-[11px] font-bold text-zinc-500">
              {t("לחץ על מבנה במפה כדי לבנות או לשדרג אותו.")}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-center">
              <span className="flex items-center justify-center gap-1 text-lg font-black nums text-gold">
                <Icon name="gold" size={16} />
                {formatCompact(state.gold)}
              </span>
              <span className="block text-[10px] font-bold text-zinc-500">
                {t("זהב")}
              </span>
            </span>

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
        </div>
      </section>

      <MonumentVillage monuments={state.monuments} onOpen={setOpenKey} />

      {/* The same five, as a row of chips. A lot on the field is a small target
          on a phone, and this is the accessible list version of the map — same
          dialog, no aiming. */}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {state.monuments.map((monument) => (
          <li key={monument.key}>
            <MonumentChip monument={monument} onOpen={setOpenKey} />
          </li>
        ))}
      </ul>

      <Dialog
        open={selected !== null}
        onClose={() => setOpenKey(null)}
        labelledBy="mono-dialog-title"
        size="lg"
      >
        {selected && (
          // Keyed by the monument: opening a different one must start with a
          // clean form state, not the previous building's success line.
          <MonumentPanel
            key={selected.key}
            monument={selected}
            gold={state.gold}
            onClose={() => setOpenKey(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

/* --------------------------------- chip --------------------------------- */

function MonumentChip({
  monument,
  onOpen,
}: {
  monument: MonumentView;
  onOpen: (key: string) => void;
}) {
  const t = useT();
  const maxed = monument.cost === null;

  return (
    <button
      type="button"
      onClick={() => onOpen(monument.key)}
      style={{ "--accent": monument.accent } as CSSProperties}
      className={`mono-chip flex w-full items-center gap-2 rounded-xl p-2 text-right${
        monument.affordable ? " is-ready" : ""
      }`}
    >
      <span className="mono-sigil flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border">
        <Icon name={monument.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-black text-gold-bright">
          {t(monument.name)}
        </span>
        <span className="block text-[10px] font-bold nums text-zinc-500">
          {maxed
            ? t("במלוא גובהו")
            : t("רמה {level}/{max}", {
                level: monument.level,
                max: MONUMENT_MAX_LEVEL,
              })}
        </span>
      </span>
      {monument.affordable && <span className="mono-chip-dot" aria-hidden />}
    </button>
  );
}

/* -------------------------------- dialog -------------------------------- */

function MonumentPanel({
  monument,
  gold,
  onClose,
}: {
  monument: MonumentView;
  gold: number;
  onClose: () => void;
}) {
  const t = useT();
  const [result, formAction, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(raiseMonument, {});

  const maxed = monument.cost === null;
  const founded = monument.level > 0;
  const missing = maxed ? 0 : Math.max(0, (monument.cost ?? 0) - gold);

  return (
    <div style={{ "--accent": monument.accent } as CSSProperties}>
      <span className="mono-glow" aria-hidden />

      <div className="relative flex items-start gap-3">
        <span className="mono-sigil flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border">
          <Icon name={monument.icon} size={24} />
        </span>

        <div className="min-w-0 flex-1">
          <h2
            id="mono-dialog-title"
            className="text-base font-black text-gold-bright"
          >
            {t(monument.name)}
          </h2>
          <p className="mt-0.5 text-[11px] font-bold nums text-zinc-400">
            {maxed
              ? t("במלוא גובהו")
              : t("רמה {level}/{max}", {
                  level: monument.level,
                  max: MONUMENT_MAX_LEVEL,
                })}
          </p>
        </div>

        <CloseButton onClick={onClose} className="-mt-1" />
      </div>

      <div className="rule-gold my-3" />

      <p className="relative text-xs leading-relaxed text-zinc-400">
        {t(monument.lore)}
      </p>

      {/* Twelve pips rather than a bar: the ladder has twelve rungs and each one
          is a separate purchase, so the player should be able to count them. */}
      <div className="mono-pips relative mt-3" aria-hidden>
        {Array.from({ length: MONUMENT_MAX_LEVEL }, (_, i) => (
          <span key={i} className={i < monument.level ? "is-on" : ""} />
        ))}
      </div>

      <div className="panel-inset relative mt-3 space-y-2 rounded-xl p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-bold text-zinc-500">{t("כרגע")}</span>
          <span className="font-black nums text-emerald-300">
            {t(monument.effectLabel, { pct: monument.pct })}
          </span>
        </div>
        {!maxed && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-bold text-zinc-500">{t("אחרי הבנייה")}</span>
            <span className="font-black nums text-gold-bright">
              {t(monument.effectLabel, { pct: monument.nextPct })}
            </span>
          </div>
        )}
      </div>

      {maxed ? (
        <p className="relative mt-4 flex items-center justify-center gap-2 rounded-xl border border-gold/50 bg-gold/10 px-3 py-3 text-sm font-bold text-gold-bright">
          <Icon name="crown" size={16} />
          {t("במלוא גובהו")}
        </p>
      ) : (
        <form action={formAction} className="relative mt-4 space-y-3">
          <input type="hidden" name="key" value={monument.key} />

          <div className="panel-inset space-y-2 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-bold text-zinc-500">
                {founded ? t("עלות הרמה הבאה") : t("עלות הייסוד")}
              </span>
              <Tip tip={formatNumber(monument.cost ?? 0) + " " + t("זהב")}>
                <span
                  className={`flex items-center gap-1 text-sm font-black nums ${
                    monument.affordable ? "text-gold" : "text-red-400"
                  }`}
                >
                  <Icon name="gold" size={14} />
                  {formatCompact(monument.cost ?? 0)}
                </span>
              </Tip>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-bold text-zinc-500">{t("הזהב שלך")}</span>
              <span className="flex items-center gap-1 font-bold nums text-zinc-300">
                <Icon name="gold" size={12} />
                {formatCompact(gold)}
              </span>
            </div>
            {missing > 0 && (
              <p className="text-[11px] font-bold nums text-red-400">
                {t("חסרים {gold} זהב", { gold: formatCompact(missing) })}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending || !monument.affordable}
            className="btn btn-gold w-full py-2.5 text-sm disabled:opacity-50"
          >
            {pending ? t("בונה…") : founded ? t("הרם רמה") : t("ייסד")}
          </button>
        </form>
      )}

      {(result.error || result.success) && (
        <div className="relative mt-3">
          <FormMessage error={result.error} success={result.success} />
        </div>
      )}
    </div>
  );
}
