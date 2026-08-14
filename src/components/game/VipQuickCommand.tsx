"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { VIP_SHORT } from "@/lib/game/vip";
import { VipQuickActions } from "./VipQuickActions";
import { VipUpsellDialog } from "./VipUpsellDialog";
import { useT } from "@/i18n/client";

/**
 * The VIP command post: a chip in the row the season pass and the timers ride
 * in, opening the game's one-click bulk actions from wherever the player
 * happens to be.
 *
 * Reachability is the actual product here. "הפקד הכל" on the warehouse screen
 * saves the typing; the same button reachable from the battle report you are
 * reading saves the trip to the warehouse screen as well — which is the trip
 * players skip, and the reason their resources are sitting unprotected when the
 * raid lands.
 *
 * A player without the pass gets the same chip, opening the pitch instead of
 * the buttons. Hiding it entirely would make the pass invisible to exactly the
 * people it is sold to, and a locked control that names what it unlocks is the
 * honest version of an advertisement.
 */
export function VipQuickCommand({ isVip }: { isVip: boolean }) {
  const [open, setOpen] = useState(false);

  const t = useT();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`btn gap-1.5 px-3 py-1.5 text-sm ${isVip ? "btn-gold" : "btn-dark"}`}
      >
        <Icon name="crown" size={15} aria-hidden />
        {t("מפקדה")}
        {!isVip && (
          <span className="rounded bg-red-500 px-1 text-[9px] font-black text-white">
            {t(VIP_SHORT)}
          </span>
        )}
      </button>

      {isVip ? (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          labelledBy="vip-command-title"
          size="lg"
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id="vip-command-title"
              className="flex items-center gap-2 text-lg font-black text-gold-bright"
            >
              <Icon name="crown" size={20} className="text-crimson-bright" />
              {t("מפקדה מהירה")}
            </h2>
            <CloseButton onClick={() => setOpen(false)} />
          </div>

          <p className="mt-1 text-xs text-zinc-400">
            {t("אותן פעולות שבעמודי הבנק, המחסנים והייצור — מכל מסך במשחק. כל פעולה מדווחת בדיוק מה קרה.")}
          </p>
          <div className="mt-4">
            <VipQuickActions />
          </div>
        </Dialog>
      ) : (
        // Without the pass the same chip opens the pass itself — bought right
        // there, rather than a link that drops the player into the diamond shop
        // to find the right card on his own.
        <VipUpsellDialog open={open} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
