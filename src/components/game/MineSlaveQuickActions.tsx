"use client";

import { useActionState } from "react";
import {
  assignAllMineSlavesToResource,
  splitMineSlavesEqually,
  clearMineSlaveAssignments,
  type ActionState,
} from "@/server/actions/game";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon } from "@/components/ui/Icon";
import { VipLockedAction } from "./VipLockedAction";
import { VIP_LABEL } from "@/lib/game/vip";
import { useT } from "@/i18n/client";

// i18n-keys-start: dictionary keys, drawn through t(label) below
const ALL_TO_RESOURCE: Array<{
  resource: "gold" | "wood" | "iron" | "stone";
  label: string;
}> = [
  { resource: "gold", label: "הצב הכל בזהב" },
  { resource: "wood", label: "הצב הכל בעץ" },
  { resource: "iron", label: "הצב הכל בברזל" },
  { resource: "stone", label: "הצב הכל באבן" },
];
// i18n-keys-end

/**
 * The crew-wide shortcuts.
 *
 * The five that move the whole crew at once are the pass's; "נקה חלוקה" is not,
 * because it is not a shortcut for anything — it is the only way to take every
 * slave off the mines, and a player must be able to unassign what he assigned.
 * Each card below still has its own number box, which is the free path to every
 * layout these buttons produce.
 */
export function MineSlaveQuickActions({ isVip }: { isVip: boolean }) {
  const t = useT();
  const [allState, allAction] = useActionState<ActionState, FormData>(
    assignAllMineSlavesToResource,
    {}
  );
  const [splitState, splitAction] = useActionState<ActionState, FormData>(
    splitMineSlavesEqually,
    {}
  );
  const [clearState, clearAction] = useActionState<ActionState, FormData>(
    clearMineSlaveAssignments,
    {}
  );

  return (
    <div className="panel rounded-xl p-4 space-y-3">
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
        <Icon name="spark" size={16} className="text-crimson-bright" />
        {t("פעולות מהירות")}
        {!isVip && (
          <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-black text-gold-bright">
            {t(VIP_LABEL)}
          </span>
        )}
      </h2>
      <div className="flex flex-wrap gap-2">
        {ALL_TO_RESOURCE.map(({ resource, label }) =>
          isVip ? (
            <form key={resource} action={allAction}>
              <input type="hidden" name="resource" value={resource} />
              <SubmitButton
                variant="secondary"
                className="btn btn-ghost px-4 py-2 text-sm"
                pendingText={t("מציב...")}
              >
                {t(label)}
              </SubmitButton>
            </form>
          ) : (
            <VipLockedAction key={resource} label={t(label)} />
          )
        )}
        {isVip ? (
          <form action={splitAction}>
            <SubmitButton
              variant="secondary"
              className="btn btn-ghost px-4 py-2 text-sm"
              pendingText={t("מחלק...")}
            >
              {t("חלק שווה בין המשאבים")}
            </SubmitButton>
          </form>
        ) : (
          <VipLockedAction label={t("חלק שווה בין המשאבים")} />
        )}
        <form action={clearAction}>
          <SubmitButton
            variant="secondary"
            className="btn btn-ghost px-4 py-2 text-sm"
            pendingText={t("מנקה...")}
          >
            {t("נקה חלוקה")}
          </SubmitButton>
        </form>
      </div>
      <FormMessage
        error={allState.error ?? splitState.error ?? clearState.error}
        success={allState.success ?? splitState.success ?? clearState.success}
      />
    </div>
  );
}
