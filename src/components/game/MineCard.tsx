"use client";

import { useActionState, useEffect, useId, type ReactNode } from "react";
import {
  upgradeMine,
  upgradeMineToMax,
  assignMineSlavesToResource,
  type ActionState,
} from "@/server/actions/game";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { usePulse } from "@/components/ui/motion";
import { MineRig, type MineRigPulseKind } from "./MineRig";
import { VipLockedAction } from "./VipLockedAction";
import { formatNumber } from "@/lib/game/format";
import type { MineProductionBreakdown } from "@/lib/game/resources";
import { useT } from "@/i18n/client";

const nis = (n: number) => formatNumber(n);

export interface MineCardProps {
  resource: "gold" | "wood" | "iron" | "stone";
  label: string;
  description: string;
  level: number;
  maxLevel: number;
  assignedSlaves: number;
  freeSlaves: number;
  resourceLabel: string;
  /** Production per assigned mine slave per regular update. */
  productionPerSlave: number;
  /** Real production per regular update, broken down by active bonus. */
  breakdown: MineProductionBreakdown;
  upgradeCost: { gold: number; wood: number; iron: number; stone: number };
  /** The pass gates "שדרג למקסימום". "שדרג רמה" beside it stays free. */
  isVip: boolean;
}

export function MineCard({
  resource,
  label,
  description,
  level,
  maxLevel,
  assignedSlaves,
  freeSlaves,
  resourceLabel,
  productionPerSlave,
  breakdown,
  upgradeCost,
  isVip,
}: MineCardProps) {
  const t = useT();
  const crewId = useId();
  const [upgradeState, upgradeAction] = useActionState<ActionState, FormData>(
    upgradeMine,
    {}
  );
  const [maxState, maxAction] = useActionState<ActionState, FormData>(
    upgradeMineToMax,
    {}
  );
  const [assignState, assignAction] = useActionState<ActionState, FormData>(
    assignMineSlavesToResource,
    {}
  );

  const isMaxLevel = level >= maxLevel;

  // Every settled upgrade / re-assignment throws a burst out of the shaft. The
  // action states are fresh objects per submit, so an identical repeat still
  // fires; `fire` is stable, so it never re-triggers on its own.
  const [pulse, fire] = usePulse<MineRigPulseKind>();
  useEffect(() => {
    if (upgradeState.success) fire("upgrade");
  }, [upgradeState, fire]);
  useEffect(() => {
    if (maxState.success) fire("upgrade");
  }, [maxState, fire]);
  useEffect(() => {
    if (assignState.success) fire("assign");
  }, [assignState, fire]);

  return (
    <div className="panel rounded-xl p-4 flex flex-col gap-3">
      {/* One line, one level. The old header printed the level twice — the
          fraction under the name and a separate "max" pill beside it. */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-bold text-gold-bright">
          <Icon
            name={RESOURCE_ICON[resource]}
            size={26}
            className={`shrink-0 ${RESOURCE_ICON_COLOR[resource]}`}
          />
          <span className="truncate">{t(label)}</span>
        </h3>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
            isMaxLevel
              ? "border border-gold/40 bg-gold/10 text-gold-bright"
              : "border border-border-subtle bg-panel-inset text-gold-dim"
          }`}
        >
          {isMaxLevel ? `${t("שיא")} · ` : ""}
          {t("רמה")}{" "}
          <span className="nums" dir="ltr">
            {isMaxLevel ? maxLevel : `${level}/${maxLevel}`}
          </span>
        </span>
      </div>

      {/* The machine itself: it runs at the speed of the crew standing on it,
          and the plate on its frame carries the real per-update output — which
          is the one number this card exists to show, so nothing repeats it. */}
      <MineRig
        resource={resource}
        label={t(label)}
        resourceLabel={t(resourceLabel)}
        slaves={assignedSlaves}
        level={level}
        output={breakdown.total}
        pulse={pulse}
      />

      {/* -------- the crew box --------
          The number here is how many men to move, not the mine's new crew: on a
          mine already running 100, typing 10 and pressing "הוסף" leaves 110. The
          box used to be pre-filled with the current crew and read as the new
          total, so the natural "type what you want to add" released the rest. */}
      <form action={assignAction} className="space-y-1.5">
        <input type="hidden" name="resource" value={resource} />
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <label htmlFor={crewId} className="font-semibold text-gold-dim">
            {t("עובדים במכרה")}{" "}
            <span className="nums font-bold text-zinc-300" dir="ltr">
              {nis(assignedSlaves)}
            </span>
          </label>
          <span className="text-zinc-500">
            {t("פנויים")}{" "}
            <span className="nums font-bold text-zinc-300" dir="ltr">
              {nis(freeSlaves)}
            </span>
          </span>
        </div>
        <div className="flex gap-2">
          <input
            id={crewId}
            type="number"
            name="amount"
            min={1}
            max={Math.max(freeSlaves, assignedSlaves, 1)}
            required
            placeholder={t("כמות")}
            className="nums w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-1.5 text-center text-sm font-bold text-zinc-100 outline-none focus:border-gold"
          />
          <SubmitButton
            name="mode"
            value="add"
            variant="secondary"
            className="btn btn-ghost shrink-0 px-3"
            /* Both buttons submit the same action, so both would light up with
               the same pending word and squeeze the number box mid-submit. */
            pendingText="…"
          >
            {t("הוסף")}
          </SubmitButton>
          <SubmitButton
            name="mode"
            value="remove"
            variant="secondary"
            className="btn btn-ghost shrink-0 px-3"
            /* Both buttons submit the same action, so both would light up with
               the same pending word and squeeze the number box mid-submit. */
            pendingText="…"
            disabled={assignedSlaves === 0}
          >
            {t("הסר")}
          </SubmitButton>
        </div>
      </form>

      {/* At the ceiling there is nothing left to buy, so the two upgrade
          buttons and the cost line give way to a single "maxed out" plate. */}
      {isMaxLevel ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm font-bold text-gold-bright">
          <Icon name="spark" size={16} className="text-gold-bright" />
          {t("המכונה משודרגת למקסימום")}
        </div>
      ) : (
        <form action={upgradeAction} className="space-y-2">
          <input type="hidden" name="resource" value={resource} />
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-gold-dim">{t("עלות שדרוג")}</span>
            <span className="nums font-bold text-zinc-200" dir="ltr">
              <Icon
                name={RESOURCE_ICON[resource]}
                size={14}
                className={`inline align-[-2px] ${RESOURCE_ICON_COLOR[resource]}`}
              />{" "}
              {nis(upgradeCost[resource])}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SubmitButton className="btn btn-dark w-full" pendingText={t("משדרג...")}>
              {t("שדרג רמה")}
            </SubmitButton>
            {isVip ? (
              <SubmitButton
                formAction={maxAction}
                variant="secondary"
                className="btn btn-ghost w-full"
                pendingText={t("משדרג...")}
              >
                {t("שדרג למקסימום")}
              </SubmitButton>
            ) : (
              <VipLockedAction label={t("שדרג למקסימום")} className="w-full" />
            )}
          </div>
        </form>
      )}

      {/* Everything a player reads once and then never again — where the plate's
          figure comes from, and the mine's flavour — folded away. `mt-auto` sits
          here rather than on the upgrade form so opening one card's fold cannot
          drag its buttons out of line with the other three. */}
      <details className="group mt-auto border-t border-border-subtle pt-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-bold text-gold-dim transition-colors hover:text-gold-bright [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className="inline-block transition-transform group-open:rotate-90 rtl:-scale-x-100"
          >
            ▸
          </span>
          {t("מאיפה המספר הזה")}
        </summary>

        <dl className="mt-2.5 space-y-1 text-[11px]">
          <BreakRow label={t("תפוקה לכל עובד")} value={nis(productionPerSlave)} />
          {/* With no bonus running, base *is* the total — printing both would be
              the same figure twice, which is what this card is getting away from. */}
          {breakdown.lines.length > 0 && (
            <BreakRow
              label={t("תפוקת בסיס")}
              value={`+${nis(breakdown.base)}`}
              className="border-t border-border-subtle pt-1"
            />
          )}
          {breakdown.lines.map((line) => (
            <BreakRow
              key={line.key}
              label={
                <>
                  {t(line.label, line.labelParams)}
                  {line.pct !== undefined ? (
                    <span className="nums" dir="ltr">
                      {" "}
                      (+{line.pct}%)
                    </span>
                  ) : null}
                </>
              }
              value={`+${nis(line.amount)}`}
              tone="text-emerald-300"
            />
          ))}
          <BreakRow
            label={t("סה״כ לעדכון")}
            value={`+${nis(breakdown.total)} ${t(resourceLabel)}`}
            tone="text-emerald-400"
            className={`font-black ${
              breakdown.lines.length > 0 ? "border-t border-border-subtle pt-1" : ""
            }`}
          />
        </dl>

        <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
          {t(description)}
        </p>
      </details>

      <FormMessage
        error={upgradeState.error ?? maxState.error ?? assignState.error}
        success={assignState.success ?? upgradeState.success ?? maxState.success}
      />
    </div>
  );
}

/**
 * One line of the folded breakdown. Every row is the same flex — label at the
 * start, figure at the end — so the column of numbers cannot drift out of line
 * the way the old grid's mixed `text-left` / `text-end` cells did.
 */
function BreakRow({
  label,
  value,
  tone = "text-zinc-100",
  className = "",
}: {
  label: ReactNode;
  value: string;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${className}`}>
      <dt className="text-zinc-400">{label}</dt>
      <dd className={`nums shrink-0 font-bold ${tone}`} dir="ltr">
        {value}
      </dd>
    </div>
  );
}
