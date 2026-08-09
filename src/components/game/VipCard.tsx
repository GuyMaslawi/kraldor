"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatDate } from "@/lib/game/format";
import { VIP_COST, VIP_LABEL } from "@/lib/game/vip";
import { useLocale, useT } from "@/i18n/client";
import { VipUpsellDialog } from "./VipUpsellDialog";

/**
 * The pass, on the diamond shop's own screen — one line above the shop grid.
 *
 * It used to be the widest card on the page: the full pitch, four perk tiles
 * and the buy button, all permanently open above a grid of things the player
 * came here to buy. That is a lot of screen for an item most visitors already
 * own or have already decided against, and it pushed the shop itself below the
 * fold. The pitch is not gone, it is folded: this row names the pass and its
 * price, and the button opens {@link VipUpsellDialog} — the same box every
 * locked "הכל" button in the game opens, which already carries the perks, the
 * disclaimer and the purchase.
 *
 * Routing the sale through that dialog rather than keeping a second buy form
 * here also means there is exactly one VIP checkout in the app: what a player
 * sees pressing "הפקד הכל" in the bank and what he sees here are the same
 * component, so the copy cannot drift between them.
 */
export function VipCard({
  vipSince,
}: {
  /** ISO stamp of when the pass was bought, or null for a player without it. */
  vipSince: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  // Once it is bought there is nothing left to sell: the perks are already
  // living in the top bar, so the pitch collapses to a one-line receipt.
  if (vipSince != null) {
    return (
      <section className="panel-gold flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
          <Icon name="crown" size={16} className="text-crimson-bright" />
          {t(VIP_LABEL)}
          <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-black text-gold-bright">
            VIP
          </span>
        </h2>
        <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
          {t("ברשותך מאז")}{" "}
          <span className="nums" dir="ltr">
            {formatDate(new Date(vipSince), locale)}
          </span>
        </span>
      </section>
    );
  }

  return (
    <>
      <section className="panel-gold flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl px-3 py-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
            <Icon name="crown" size={16} className="text-crimson-bright" />
            {t(VIP_LABEL)}
            <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-black text-gold-bright">
              VIP
            </span>
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {t("רכישה חד־פעמית · לא פג תוקף · חיסכון בלחיצות בלבד")}
          </p>
        </div>

        {/* Not disabled on a thin purse: the dialog answers "how much is
            missing" with the exact figure buyVip returns, which is more use
            than a dead button that says nothing. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="btn btn-gold px-3 py-1.5 text-xs font-black max-sm:w-full"
        >
          <span className="flex items-center justify-center gap-1.5">
            <Icon name="crown" size={14} />
            {t("רכוש {pass} ·", { pass: t(VIP_LABEL) })}
            <span className="nums inline-flex items-center gap-1" dir="ltr">
              {VIP_COST}
              <Icon name="diamond" size={13} className="text-cyan-100" />
            </span>
          </span>
        </button>
      </section>

      <VipUpsellDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
