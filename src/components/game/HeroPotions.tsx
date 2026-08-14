"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PotionKind } from "@prisma/client";
import { Dialog } from "@/components/ui/Dialog";
import { Tip } from "@/components/ui/Tip";
import { PotionBottle } from "@/components/game/PotionBottle";
import { drinkPotion } from "@/server/actions/potions";
import type { ActionState } from "@/server/actions/game";
import { useT } from "@/i18n/client";
import {
  POTION_KINDS,
  POTION_META,
  potionDurationLabel,
} from "@/lib/game/potions";

/**
 * The potion belt: four cubes under the bag, one per brew, each holding a
 * stack. Unlike an item, a potion is not worn — clicking one opens its dialog
 * and drinking it starts an hour (half an hour for the forge brew) in which one
 * rule of the game is bent. An active brew keeps its cube lit with a live
 * countdown, and the page refreshes itself the moment the window closes.
 *
 * All timing runs in SERVER time — the same skew trick as HeroRevive, because a
 * client clock that is two minutes fast would otherwise show an expired potion
 * as still running (or worse, the reverse).
 */

/** "12:34" — the only shape an under-an-hour wait needs. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** A ticking clock pinned to the server's stamp, not the browser's. */
export function useServerNow(serverNow: number): number {
  const [now, setNow] = useState(serverNow);
  const skewRef = useRef(0);

  useEffect(() => {
    skewRef.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const tick = () => setNow(Date.now() + skewRef.current);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return now;
}

export interface PotionBeltProps {
  /** How many of each brew are on the belt. */
  counts: Record<PotionKind, number>;
  /** Epoch ms at which each *active* brew wears off. Absent = not running. */
  activeUntil: Partial<Record<PotionKind, number>>;
  /** The server's own clock at render time — see useServerNow. */
  serverNow: number;
}

export function HeroPotions({ counts, activeUntil, serverNow }: PotionBeltProps) {
  const router = useRouter();
  const now = useServerNow(serverNow);
  const [open, setOpen] = useState<PotionKind | null>(null);

  // When the last running window closes, let the server re-render: the buff is
  // gone from every calculation already, and the page should say so.
  const nextExpiry = Object.values(activeUntil).reduce<number | null>(
    (soonest, at) => (soonest === null || at < soonest ? at : soonest),
    null
  );
  const expired = nextExpiry !== null && nextExpiry <= now;
  useEffect(() => {
    if (!expired) return;
    const timeout = setTimeout(() => router.refresh(), 1000);
    const retry = setInterval(() => router.refresh(), 5000);
    return () => {
      clearTimeout(timeout);
      clearInterval(retry);
    };
  }, [expired, router]);

  const t = useT();
  const held = POTION_KINDS.reduce((sum, kind) => sum + counts[kind], 0);

  return (
    <div className="mt-6 border-t border-border-subtle pt-4">
      <div className="mx-auto w-full max-w-[25rem]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tip tip={t("שיקויים נלכדים בניצחון בתקיפה. כל שיקוי מפעיל אפקט זמני על כל האימפריה — לחיצה פותחת את פרטיו ומאפשרת לשתות.")}>
            <h2 className="cursor-help text-base font-bold tracking-wide text-gold-bright">
              {t("שיקויים")}
            </h2>
          </Tip>
          <span className="nums text-xs text-zinc-400" dir="ltr">
            {held}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {POTION_KINDS.map((kind) => (
            <PotionCube
              key={kind}
              kind={kind}
              count={counts[kind]}
              activeUntil={activeUntil[kind] ?? null}
              now={now}
              onOpen={() => setOpen(kind)}
            />
          ))}
        </div>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-500">
          {t("שיקויים נופלים מתקיפות מוצלחות. שתיית שיקוי שכבר פועל מאריכה אותו — לעולם לא בזבוז.")}
        </p>
      </div>

      {open && (
        <PotionDialog
          kind={open}
          count={counts[open]}
          activeUntil={activeUntil[open] ?? null}
          now={now}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** One cube on the belt: the bottle, its stack badge and its running clock. */
function PotionCube({
  kind,
  count,
  activeUntil,
  now,
  onOpen,
}: {
  kind: PotionKind;
  count: number;
  activeUntil: number | null;
  now: number;
  onOpen: () => void;
}) {
  const t = useT();
  const meta = POTION_META[kind];
  const active = activeUntil !== null && activeUntil > now;
  const owned = count > 0;

  return (
    <Tip
      tip={
        t("{potion} — {tagline} ({duration})", {
          potion: t(meta.label),
          tagline: t(meta.tagline),
          duration: potionDurationLabel(t, kind),
        }) + (owned ? "" : t(" · אין לך אחד כזה"))
      }
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={t(meta.label)}
        className="panel-inset relative flex aspect-square w-full items-center justify-center rounded-xl p-1 transition hover:brightness-125"
        style={
          active
            ? { boxShadow: `inset 0 0 18px -6px ${meta.liquid.glow}` }
            : undefined
        }
      >
        {/* the running ring takes the brew's own colour, not the generic gold */}
        {active && (
          <span
            aria-hidden
            className="potion-ring pointer-events-none absolute -inset-px rounded-xl"
            style={{ boxShadow: `0 0 0 2px ${meta.liquid.glow}` }}
          />
        )}

        <PotionBottle kind={kind} empty={!owned && !active} className="h-full w-full" />

        {count > 0 && (
          <span
            className="nums absolute bottom-0.5 left-0.5 rounded-md border border-border-gold-strong bg-black/85 px-1 text-[10px] font-black text-gold-bright"
            dir="ltr"
          >
            {count}
          </span>
        )}

        {active && (
          <span
            className="nums absolute -top-1 left-1/2 -translate-x-1/2 rounded-md border border-white/25 bg-black/90 px-1 text-[9px] font-black"
            style={{ color: meta.liquid.glow }}
            dir="ltr"
          >
            {formatCountdown(activeUntil - now)}
          </span>
        )}
      </button>
    </Tip>
  );
}

/** The drink dialog: what the brew does, how long, and the one button. */
function PotionDialog({
  kind,
  count,
  activeUntil,
  now,
  onClose,
}: {
  kind: PotionKind;
  count: number;
  activeUntil: number | null;
  now: number;
  onClose: () => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});
  const meta = POTION_META[kind];
  const active = activeUntil !== null && activeUntil > now;
  const titleId = `potion-dialog-${kind}`;

  const doDrink = () => {
    const fd = new FormData();
    fd.set("kind", kind);
    startTransition(async () => {
      setMsg(await drinkPotion({}, fd));
    });
  };

  return (
    <Dialog open onClose={onClose} labelledBy={titleId}>
      <div className="flex items-start gap-4">
        <div className="w-24 shrink-0">
          <PotionBottle kind={kind} empty={count === 0 && !active} className="w-full" />
        </div>
        <div className="flex-1 pt-1">
          <h2 id={titleId} className={`text-lg font-black ${meta.tone}`}>
            {t(meta.label)}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">{t(meta.tagline)}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {t("משך:")}{" "}
            <span className="text-zinc-300">{potionDurationLabel(t, kind)}</span>
            {" · "}
            {t("בתרמיל:")}{" "}
            <span className="nums text-zinc-200" dir="ltr">
              {count}
            </span>
          </p>
        </div>
        <CloseButton onClick={onClose} className="-mt-1" />
      </div>

      <div className="rule-gold my-4" />

      <p className="text-sm leading-relaxed text-zinc-300">{t(meta.description)}</p>

      {active && (
        <div className="panel-inset mt-4 flex items-center justify-between rounded-lg p-3 text-xs">
          <span className="text-zinc-400">{t("פועל כרגע — נותר")}</span>
          <span className="nums font-black" style={{ color: meta.liquid.glow }} dir="ltr">
            {formatCountdown(activeUntil - now)}
          </span>
        </div>
      )}

      {(msg.error || msg.success) && (
        <p
          className={`mt-3 text-xs font-semibold ${
            msg.error ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {msg.error ?? msg.success}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onClose} disabled={pending} className="btn btn-ghost py-2 text-sm">
          {t("סגור")}
        </button>
        <button
          onClick={doDrink}
          disabled={pending || count === 0}
          title={count === 0 ? t("אין לך שיקוי כזה — נלכד בתקיפות מוצלחות") : undefined}
          className="btn btn-gold py-2 text-sm"
        >
          {pending
            ? t("שותה…")
            : count === 0
              ? t("אין במלאי")
              : active
                ? t("שתה והארך")
                : t("שתה")}
        </button>
      </div>
    </Dialog>
  );
}
