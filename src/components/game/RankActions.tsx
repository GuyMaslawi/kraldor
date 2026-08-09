"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import {
  spyOnEmpire,
  attackEmpire,
  type ActionState,
} from "@/server/actions/game";
import { ATTACK_TURN_COST, SPY_TURN_COST } from "@/lib/game/constants";
import { RANK_ACTION_BUTTON_BASE } from "@/lib/game/actionButtonStyles";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon } from "@/components/ui/Icon";
import { useT } from "@/i18n/client";

/** A big prominent submit button that shows a pending label while its form runs. */
function ActionButton({
  children,
  pendingText,
  disabled,
  tone,
  title,
}: {
  children: ReactNode;
  pendingText: string;
  disabled?: boolean;
  tone: "attack" | "spy";
  title?: string;
}) {
  const { pending } = useFormStatus();
  const styles =
    tone === "attack"
      ? "border border-red-500/70 bg-gradient-to-b from-red-600 to-red-800 text-white shadow-[0_4px_20px_-6px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-red-700 hover:-translate-y-0.5"
      : "border border-gold/70 bg-gradient-to-b from-[#e8c877] to-[#c99a3f] text-[#241701] shadow-[0_4px_20px_-6px_rgba(212,168,67,0.55)] hover:brightness-110 hover:-translate-y-0.5";
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      title={title}
      className={`${RANK_ACTION_BUTTON_BASE} ${styles}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function RankActions({
  targetEmpireId,
  currentTurns,
  attackBlockedReason = null,
  messageAction = null,
}: {
  targetEmpireId: string;
  /** The viewer's available turns — used to disable unaffordable actions. */
  currentTurns: number;
  /**
   * Why this target may not be attacked at all (guildmates). Disables the
   * attack half and says why; spying is untouched — the server allows it.
   */
  attackBlockedReason?: string | null;
  /**
   * The mail trigger, handed in by the profile page so it can stand in the
   * action row beside attack and spy instead of below the whole dossier. It is
   * a slot rather than something this component builds because the composer is
   * a dialog that owns its own state — this row only owns the layout.
   */
  messageAction?: ReactNode;
}) {
  const [spyState, spyAction] = useActionState<ActionState, FormData>(spyOnEmpire, {});
  const [attackState, attackAction] = useActionState<ActionState, FormData>(attackEmpire, {});

  const canSpy = currentTurns >= SPY_TURN_COST;
  const canAttack = currentTurns >= ATTACK_TURN_COST && !attackBlockedReason;

  const t = useT();
  return (
    <div className={`w-full space-y-2 ${messageAction ? "sm:w-[24rem]" : "sm:w-80"}`}>
      <div className={`grid gap-2.5 ${messageAction ? "grid-cols-3" : "grid-cols-2"}`}>
        <form action={attackAction}>
          <input type="hidden" name="targetEmpireId" value={targetEmpireId} />
          <ActionButton
            tone="attack"
            pendingText={t("תוקף…")}
            disabled={!canAttack}
            title={
              attackBlockedReason ??
              (canAttack
                ? t("עלות תקיפה: {turns} תורות", { turns: ATTACK_TURN_COST })
                : t("אין לך מספיק תורות לתקיפה"))
            }
          >
            <Icon name="attack" size={16} className="inline-block align-middle" />{" "}
            {t("תקיפה")}
          </ActionButton>
          {/* No dir="ltr" here: the line is Hebrew with a number in it, and
              forcing LTR throws the digits to the far side of the word. */}
          <p
            className={`mt-1 text-center text-[10px] ${attackBlockedReason ? "text-emerald-400/80" : "text-zinc-500 nums"}`}
          >
            {attackBlockedReason ??
              t("{turns} תורות", { turns: ATTACK_TURN_COST })}
          </p>
        </form>
        <form action={spyAction}>
          <input type="hidden" name="targetEmpireId" value={targetEmpireId} />
          <ActionButton
            tone="spy"
            pendingText={t("מרגל…")}
            disabled={!canSpy}
            title={
              canSpy
                ? t("עלות ריגול: {turns} תורות", { turns: SPY_TURN_COST })
                : t("אין לך מספיק תורות לריגול")
            }
          >
            <Icon name="spy" size={16} className="inline-block align-middle" />{" "}
            {t("ריגול")}
          </ActionButton>
          <p className="mt-1 text-center text-[10px] text-zinc-500 nums">
            {t("{turns} תורות", { turns: SPY_TURN_COST })}
          </p>
        </form>
        {/* Last in the row, so in RTL it lands to the left of the spy button.
            Its caption keeps the three columns on one baseline and says the
            thing that separates it from its neighbours: mail is free. */}
        {messageAction && (
          <div>
            {messageAction}
            <p className="mt-1 text-center text-[10px] text-zinc-500">
              {t("ללא עלות")}
            </p>
          </div>
        )}
      </div>
      <FormMessage
        error={spyState.error ?? attackState.error}
        success={spyState.success ?? attackState.success}
      />
    </div>
  );
}
