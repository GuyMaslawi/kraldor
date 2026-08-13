"use client";

import { useActionState, useEffect, useState, type MouseEvent } from "react";
import {
  depositAllToStorage,
  depositToStorage,
  upgradeStorage,
  withdrawAllFromStorage,
  withdrawFromStorage,
  type ActionState,
} from "@/server/actions/game";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Meter";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { usePulse } from "@/components/ui/motion";
import { StorageSilo, type SiloPulseKind } from "./StorageSilo";
import { VipLockedAction } from "./VipLockedAction";
import type { AvailableResources } from "./WeaponCard";
import type { OreKind } from "./oreTint";
import { formatNumber } from "@/lib/game/format";
import { useT } from "@/i18n/client";

export interface StorageCardProps {
  resourceType: "GOLD" | "WOOD" | "IRON" | "STONE";
  label: string;
  level: number;
  /**
   * Every unprotected balance, not just this warehouse's resource: the deposit
   * box spends one of them, the upgrade below spends all four.
   */
  available: AvailableResources;
  /** Protected balance inside the warehouse. */
  stored: number;
  capacity: number;
  upgradeCost: { gold: number; wood: number; iron: number; stone: number };
  /**
   * The pass gates "הפקד הכל" / "משוך הכל". The amount box above them, and the
   * upgrade below, stay free.
   */
  isVip: boolean;
}

type TransferKind = "deposit" | "withdraw" | "depositAll" | "withdrawAll";

// i18n-keys-start: dictionary keys, read through t(RESOURCE_LABEL[key]) below
const RESOURCE_LABEL: Record<OreKind, string> = {
  gold: "זהב",
  wood: "עץ",
  iron: "ברזל",
  stone: "אבן",
};
// i18n-keys-end

const formatAmount = (value: number) => formatNumber(value);

export function StorageCard({
  resourceType,
  label,
  level,
  available,
  stored,
  capacity,
  upgradeCost,
  isVip,
}: StorageCardProps) {
  const t = useT();
  /** The resource this warehouse holds — drives its canonical icon and tint. */
  const storedResource = resourceType.toLowerCase() as OreKind;
  /** The unprotected balance of this warehouse's own resource. */
  const ownAvailable = available[storedResource];
  const [upgradeState, upgradeAction] = useActionState<ActionState, FormData>(
    upgradeStorage,
    {}
  );
  const [depositState, depositAction] = useActionState<ActionState, FormData>(
    depositToStorage,
    {}
  );
  const [depositAllState, depositAllAction] = useActionState<ActionState, FormData>(
    depositAllToStorage,
    {}
  );
  const [withdrawState, withdrawAction] = useActionState<ActionState, FormData>(
    withdrawFromStorage,
    {}
  );
  const [withdrawAllState, withdrawAllAction] = useActionState<ActionState, FormData>(
    withdrawAllFromStorage,
    {}
  );

  const [amount, setAmount] = useState("");
  const [clientError, setClientError] = useState<string>();
  const [lastAction, setLastAction] = useState<TransferKind>();

  const availableWhole = Math.floor(ownAvailable);
  const storedWhole = Math.floor(stored);
  const freeSpace = Math.max(0, capacity - storedWhole);
  const fillRatio = capacity > 0 ? Math.min(1, stored / capacity) : 0;
  const fillPercent = (fillRatio * 100).toFixed(1);
  const nearFull = fillRatio >= 0.9;
  const capacityPerLevel = level > 0 ? Math.round(capacity / level) : capacity;

  // The upgrade is paid out of the unprotected balances, so what is short is
  // marked in red below and the button itself refuses the doomed submit.
  const missingCost = (["gold", "wood", "iron", "stone"] as const).filter(
    (key) => upgradeCost[key] > 0 && available[key] < upgradeCost[key]
  );
  const canAffordUpgrade = missingCost.length === 0;

  const validateAmount = (kind: "deposit" | "withdraw"): string | undefined => {
    if (amount.trim() === "") return t("יש להזין כמות");
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      return t("יש להזין מספר שלם גדול מ־0");
    }
    if (kind === "deposit" && value > availableWhole) {
      return t("הכמות גדולה מהמשאבים הזמינים");
    }
    if (kind === "deposit" && value > freeSpace) {
      return t("אין מספיק מקום במחסן (מקום פנוי: {free})", {
        free: formatAmount(freeSpace),
      });
    }
    if (kind === "withdraw" && value > storedWhole) {
      return t("הכמות גדולה מהכמות המאוחסנת במחסן");
    }
    return undefined;
  };

  const handleTransfer =
    (kind: "deposit" | "withdraw") => (event: MouseEvent<HTMLButtonElement>) => {
      const error = validateAmount(kind);
      setClientError(error);
      setLastAction(kind);
      if (error) event.preventDefault();
    };

  const handleQuickAction = (kind: "depositAll" | "withdrawAll") => () => {
    setClientError(undefined);
    setLastAction(kind);
  };

  const transferStates: Record<TransferKind, ActionState> = {
    deposit: depositState,
    withdraw: withdrawState,
    depositAll: depositAllState,
    withdrawAll: withdrawAllState,
  };
  const transferState = lastAction ? transferStates[lastAction] : {};

  // Every settled transfer runs crates through the silo's hatch. The action
  // states are fresh objects per submit, so an identical repeat still fires;
  // `fire` is stable, so it never re-triggers on its own.
  const [pulse, fire] = usePulse<SiloPulseKind>();
  useEffect(() => {
    if (depositState.success) fire("deposit");
  }, [depositState, fire]);
  useEffect(() => {
    if (depositAllState.success) fire("deposit");
  }, [depositAllState, fire]);
  useEffect(() => {
    if (withdrawState.success) fire("withdraw");
  }, [withdrawState, fire]);
  useEffect(() => {
    if (withdrawAllState.success) fire("withdraw");
  }, [withdrawAllState, fire]);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon
            name={RESOURCE_ICON[storedResource]}
            size={30}
            className={RESOURCE_ICON_COLOR[storedResource]}
          />
          <div>
            <h3 className="font-bold text-gold-bright">{t(label)}</h3>
            <p className="text-xs font-semibold text-gold">
              {t("רמה")}{" "}
              <span className="nums" dir="ltr">
                {level}
              </span>
            </p>
          </div>
        </div>
        <span
          className={`nums rounded-full border px-2.5 py-1 text-xs font-bold ${
            nearFull
              ? "border-red-500/40 bg-red-950/40 text-red-400"
              : "border-gold/40 bg-panel-inset text-gold-bright"
          }`}
          dir="ltr"
        >
          {fillPercent}%
        </span>
      </div>

      {/* The warehouse itself: the stock rises from empty on first paint, and
          a settled transfer runs crates through the hatch. */}
      <StorageSilo
        resource={storedResource}
        label={t(label)}
        stored={stored}
        capacity={capacity}
        pulse={pulse}
      />

      <div>
        <Meter
          tone={nearFull ? "health" : "xp"}
          value={storedWhole}
          max={capacity}
        />
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-gold-dim">
          <span className="nums" dir="ltr">
            {formatAmount(stored)} / {formatAmount(capacity)}
          </span>
          <span>
            {t("פנוי:")}{" "}
            <span className="nums" dir="ltr">
              {formatAmount(freeSpace)}
            </span>
          </span>
        </div>
      </div>

      <p className="text-sm text-zinc-300">
        {t("זמין אצלך:")}{" "}
        <span className="nums font-bold text-gold-bright" dir="ltr">
          {formatAmount(ownAvailable)}
        </span>
      </p>

      {/* -------- deposit / withdraw -------- */}
      <form className="space-y-2">
        <input type="hidden" name="resourceType" value={resourceType} />
        <Input
          type="number"
          name="amount"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder={t("כמות")}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label={t("כמות להפקדה או משיכה — {label}", { label: t(label) })}
          aria-invalid={clientError ? true : undefined}
        />
        <div className="grid grid-cols-2 gap-2">
          <SubmitButton
            className="btn btn-dark w-full"
            formAction={depositAction}
            onClick={handleTransfer("deposit")}
            pendingText={t("מפקיד...")}
          >
            {t("הפקד")}
          </SubmitButton>
          <SubmitButton
            className="btn btn-dark w-full"
            formAction={withdrawAction}
            onClick={handleTransfer("withdraw")}
            pendingText={t("מושך...")}
          >
            {t("משוך")}
          </SubmitButton>
          {isVip ? (
            <>
              <SubmitButton
                variant="secondary"
                className="btn btn-ghost w-full"
                formAction={depositAllAction}
                onClick={handleQuickAction("depositAll")}
                pendingText={t("מפקיד...")}
              >
                {t("הפקד הכל")}
              </SubmitButton>
              <SubmitButton
                variant="secondary"
                className="btn btn-ghost w-full"
                formAction={withdrawAllAction}
                onClick={handleQuickAction("withdrawAll")}
                pendingText={t("מושך...")}
              >
                {t("משוך הכל")}
              </SubmitButton>
            </>
          ) : (
            <>
              <VipLockedAction label={t("הפקד הכל")} className="w-full" />
              <VipLockedAction label={t("משוך הכל")} className="w-full" />
            </>
          )}
        </div>
      </form>
      <FormMessage
        error={clientError ?? transferState.error}
        success={clientError ? undefined : transferState.success}
      />

      <p className="text-xs text-gold-dim">
        {t("משאבים במחסן מוגנים ואינם זמינים לשימוש עד שתמשוך אותם.")}
      </p>

      {/* -------- upgrade -------- */}
      <form action={upgradeAction} className="mt-auto space-y-2">
        <input type="hidden" name="resourceType" value={resourceType} />
        <div className="panel-inset rounded-lg p-3 text-xs text-zinc-400">
          <p className="text-gold-bright">
            {t("לרמה הבאה:")}{" "}
            <span className="nums font-bold text-emerald-400" dir="ltr">
              +{formatAmount(capacityPerLevel)}
            </span>{" "}
            {t("מקום אחסון")}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            <span className="font-semibold text-gold-dim">{t("עלות שדרוג:")}</span>
            {(["gold", "wood", "iron", "stone"] as const).map((key) => {
              const missing = upgradeCost[key] > 0 && available[key] < upgradeCost[key];
              return (
                <span
                  key={key}
                  className={missing ? "font-semibold text-red-400" : undefined}
                  title={
                    missing
                      ? t("חסר: {amount}", {
                          amount: formatAmount(
                            Math.ceil(upgradeCost[key] - available[key])
                          ),
                        })
                      : undefined
                  }
                >
                  <Icon
                    name={RESOURCE_ICON[key]}
                    size={14}
                    className={`inline align-[-2px] ${
                      missing ? "text-red-400" : RESOURCE_ICON_COLOR[key]
                    }`}
                  />{" "}
                  <span className="nums" dir="ltr">
                    {formatAmount(upgradeCost[key])}
                  </span>
                </span>
              );
            })}
          </div>
          {!canAffordUpgrade && (
            <p className="mt-2 font-semibold text-red-400">
              {t("חסר לשדרוג: {resources}", {
                resources: missingCost
                  .map(
                    (key) =>
                      `${t(RESOURCE_LABEL[key])} ${formatAmount(
                        Math.ceil(upgradeCost[key] - available[key])
                      )}`
                  )
                  .join(", "),
              })}
            </p>
          )}
        </div>
        <SubmitButton
          className="btn btn-dark w-full"
          pendingText={t("משדרג...")}
          disabled={!canAffordUpgrade}
        >
          {t("🔧 שדרג לרמה {level}", { level: level + 1 })}
        </SubmitButton>
      </form>

      <FormMessage error={upgradeState.error} success={upgradeState.success} />
    </Card>
  );
}
