"use client";

import { useActionState } from "react";
import { upgradeGuildAid } from "@/server/actions/guild";
import type { ActionState } from "@/server/actions/game";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon } from "@/components/ui/Icon";
import { useAfterFirstPaint } from "@/components/ui/motion";
import { formatNumber } from "@/lib/game/format";
import { GUILD_AID_MAX_LEVEL } from "@/lib/game/guild";
import { useT } from "@/i18n/client";

export interface GuildAidCardProps {
  /** Current aid percent (= aid level). */
  aidPct: number;
  /** Treasury gold needed to raise the aid by 1%; null when maxed. */
  upgradeCost: number | null;
  /** The guild's treasury — the upgrade is paid out of it. */
  treasury: number;
  /**
   * False for plain members. The gate is new: while the ladder was paid out of
   * the buyer's own pocket anyone could raise it, but a purchase from everyone's
   * donations is a leadership decision.
   */
  mayUpgrade: boolean;
}

export function GuildAidCard({
  aidPct,
  upgradeCost,
  treasury,
  mayUpgrade,
}: GuildAidCardProps) {
  const [state, action] = useActionState<ActionState, FormData>(
    upgradeGuildAid,
    {}
  );
  // The bar is server-rendered at its final width, so it can only *rise* into
  // place if the first painted frame draws it empty.
  const painted = useAfterFirstPaint();

  const t = useT();
  return (
    <div className="panel-inset gd-up flex flex-col gap-3 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-bold text-gold-bright">
          <Icon name="shield" size={16} className="text-crimson" />
          {t("עזרת הברית")}
        </p>
        <span className="nums rounded-full border border-gold/40 bg-panel-inset px-2.5 py-0.5 text-xs font-black text-gold-bright" dir="ltr">
          +{aidPct}%
        </span>
      </div>

      <p className="text-xs leading-relaxed text-zinc-400">
        {t("כל חבר נלחם עם תוספת כוח בקרב — גם כשהוא תוקף וגם כשתוקפים אותו.")}
      </p>
      <p className="text-[11px] text-gold-dim">
        {t("+{pct}% מסך הכוח הכולל של הברית להתקפה ולהגנה", { pct: aidPct })}
      </p>

      {/* How far the guild has walked towards the ceiling. */}
      <div className="gd-meter" aria-hidden>
        <span
          style={{
            width: painted ? `${(aidPct / GUILD_AID_MAX_LEVEL) * 100}%` : "0%",
          }}
        />
      </div>
      <p className="text-[11px] text-zinc-500">
        {t("מנהיג או סגן בלבד — משולם מאוצר הברית.")}
      </p>

      <form action={action} className="mt-auto">
        {upgradeCost != null ? (
          <SubmitButton
            className="btn btn-dark w-full"
            disabled={!mayUpgrade || treasury < upgradeCost}
            pendingText={t("משדרג...")}
          >
            {t("שדרג ל־{pct}%", { pct: aidPct + 1 })} · {formatNumber(upgradeCost)}{" "}
            <Icon name="gold" size={14} className="inline-block align-text-bottom text-gold-bright" />
          </SubmitButton>
        ) : (
          <span className="flex items-center justify-center gap-1 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-center text-xs font-semibold text-gold">
            <Icon name="rankings" size={14} />{" "}
            {t("עזרה מקסימלית ({max}%)", { max: GUILD_AID_MAX_LEVEL })}
          </span>
        )}
      </form>

      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
