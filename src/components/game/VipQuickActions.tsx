"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import {
  assignAllMineSlavesToResource,
  depositAllToStorage,
  splitMineSlavesEqually,
  withdrawAllFromStorage,
  type ActionState,
} from "@/server/actions/game";
import {
  depositAllGoldToBank,
  withdrawAllGoldFromBank,
} from "@/server/actions/bank";
import { RESOURCE_META, STORAGE_META, STORAGE_TYPES } from "@/lib/game/constants";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR, type IconName } from "@/components/ui/Icon";
import { useT } from "@/i18n/client";

/**
 * The מפקדה dock: every one-click action the pass unlocks, gathered from the
 * screens they live on.
 *
 * Nothing here is a new action — each button posts to exactly the action its
 * own screen posts to, and each of those re-checks the pass server-side. What
 * the dock buys is the trip: "הפקד הכל" on the warehouse screen saves the
 * typing, the same button reachable from the battle report you are reading
 * saves the walk to the warehouse screen — and that walk is the one players
 * skip, which is why their resources are sitting out when the raid lands.
 */

/**
 * One button: a label, an icon, the action, and whatever the action reads.
 *
 * `label`/`labelParams` and `pendingText` stay in Hebrew here and go through
 * `t()` where the button is drawn — the table is module-level data, and a
 * rendered string in it could only ever be one language.
 */
interface QuickAction {
  key: string;
  icon: IconName;
  iconClass?: string;
  label: string;
  labelParams?: Record<string, string>;
  pendingText: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** Hidden fields posted with it — the per-resource actions need one. */
  fields?: Record<string, string>;
}

interface QuickSection {
  title: string;
  icon: IconName;
  actions: QuickAction[];
}

/**
 * The two bank actions take no arguments at all — the same shape they have had
 * since the bank was built. The cast keeps them in one table with the actions
 * that do read a field.
 */
const asFormAction = (fn: unknown) =>
  fn as (state: ActionState, formData: FormData) => Promise<ActionState>;

const MINE_RESOURCES = ["gold", "wood", "iron", "stone"] as const;

// i18n-keys-start: dictionary keys, drawn through t(section.title) / t(meta.label)
const SECTIONS: QuickSection[] = [
  {
    title: "בנק",
    icon: "bank",
    actions: [
      {
        key: "bankDepositAll",
        icon: "gold",
        iconClass: RESOURCE_ICON_COLOR.gold,
        label: "הפקד הכל לבנק",
        pendingText: "מפקיד...",
        action: asFormAction(depositAllGoldToBank),
      },
      {
        key: "bankWithdrawAll",
        icon: "gold",
        iconClass: RESOURCE_ICON_COLOR.gold,
        label: "משוך הכל מהבנק",
        pendingText: "מושך...",
        action: asFormAction(withdrawAllGoldFromBank),
      },
    ],
  },
  {
    title: "מחסנים",
    icon: "storage",
    actions: STORAGE_TYPES.flatMap((type) => {
      const meta = STORAGE_META[type];
      const icon = RESOURCE_ICON[meta.resourceKey];
      const iconClass = RESOURCE_ICON_COLOR[meta.resourceKey];
      const label = RESOURCE_META[meta.resourceKey].label;
      return [
        {
          key: `storeAll-${type}`,
          icon,
          iconClass,
          label: "הפקד הכל · {resource}",
          labelParams: { resource: label },
          pendingText: "מפקיד...",
          action: depositAllToStorage,
          fields: { resourceType: type },
        },
        {
          key: `releaseAll-${type}`,
          icon,
          iconClass,
          label: "משוך הכל · {resource}",
          labelParams: { resource: label },
          pendingText: "מושך...",
          action: withdrawAllFromStorage,
          fields: { resourceType: type },
        },
      ];
    }),
  },
  {
    title: "עבדי מכרות",
    icon: "mine",
    actions: [
      ...MINE_RESOURCES.map((resource) => ({
        key: `assignAll-${resource}`,
        icon: RESOURCE_ICON[resource],
        iconClass: RESOURCE_ICON_COLOR[resource],
        label: "הצב הכל · {resource}",
        labelParams: { resource: RESOURCE_META[resource].label },
        pendingText: "מציב...",
        action: assignAllMineSlavesToResource,
        fields: { resource },
      })),
      {
        key: "splitEqually",
        icon: "mine",
        label: "חלק שווה בין המשאבים",
        pendingText: "מחלק...",
        action: asFormAction(splitMineSlavesEqually),
      },
    ],
  },
];
// i18n-keys-end

function QuickActionButton({
  meta,
  onResult,
}: {
  meta: QuickAction;
  onResult: (state: ActionState) => void;
}) {
  const t = useT();
  const [state, formAction] = useActionState<ActionState, FormData>(meta.action, {});

  // The action state is a fresh object per submit, so an identical repeat still
  // reports; the empty initial state never does.
  useEffect(() => {
    if (state.error || state.success) onResult(state);
  }, [state, onResult]);

  return (
    <form action={formAction} className="min-w-0">
      {Object.entries(meta.fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* Deliberately `btn-ghost` **without** `btn`: the shared `.btn` rule is
          unlayered and centres its content, which would beat the utilities that
          line these labels up along the dialog's right edge. */}
      <SubmitButton
        variant="secondary"
        className="btn-ghost flex w-full items-center gap-1.5 px-3 py-2 text-start text-[13px] font-bold"
        pendingText={t(meta.pendingText)}
      >
        <Icon
          name={meta.icon}
          size={15}
          className={`shrink-0 ${meta.iconClass ?? "text-crimson-bright"}`}
        />
        {t(meta.label, meta.labelParams && Object.fromEntries(
          Object.entries(meta.labelParams).map(([k, v]) => [k, t(v)])
        ))}
      </SubmitButton>
    </form>
  );
}

/** The whole dock: three sections of buttons over one shared message line. */
export function VipQuickActions() {
  const t = useT();
  const [result, setResult] = useState<ActionState>({});
  const onResult = useCallback((state: ActionState) => setResult(state), []);

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-gold-dim">
            <Icon name={section.icon} size={14} className="text-crimson-bright" />
            {t(section.title)}
          </h3>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {section.actions.map((action) => (
              <QuickActionButton key={action.key} meta={action} onResult={onResult} />
            ))}
          </div>
        </section>
      ))}
      <FormMessage error={result.error} success={result.success} />
    </div>
  );
}
