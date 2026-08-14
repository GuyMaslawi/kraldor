"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import Link from "next/link";
import { useActionState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon } from "@/components/ui/Icon";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import type { ActionState } from "@/server/actions/game";
import { buyVip } from "@/server/actions/vip";
import { VIP_COST, VIP_LABEL, VIP_PERKS } from "@/lib/game/vip";

/**
 * The pitch for the pass, wherever a player just pressed something the pass
 * unlocks — and the purchase itself, in the same box.
 *
 * It buys here rather than linking to the diamond shop on purpose. A player who
 * pressed "הפקד הכל" and lands on a screen of eight cards has been handed a
 * search task instead of an answer: nothing on that page says which of them is
 * the thing he just tried to use, and the button he wanted is now two screens
 * behind him. He asked a yes/no question about one control, so this is a yes/no
 * — perks, price, one button — and the control he pressed is unlocked on the
 * page underneath (`buyVip` revalidates the game layout, which re-renders the
 * locked slot as the live button).
 *
 * The shop link stays as the *second* line, because it answers a different
 * question — "I do not have 1000 diamonds" — and only that one.
 */
export function VipUpsellDialog({
  open,
  onClose,
  /** The control the player pressed, named back at him in the intro line. */
  action,
}: {
  open: boolean;
  onClose: () => void;
  action?: string;
}) {
  const t = useT();
  const [state, buy] = useActionState<ActionState, FormData>(buyVip, {});

  return (
    <Dialog open={open} onClose={onClose} labelledBy="vip-upsell-title" size="lg">
      <div className="flex items-start justify-between gap-3">
        <h2
          id="vip-upsell-title"
          className="flex items-center gap-2 text-lg font-black text-gold-bright"
        >
          <Icon name="crown" size={20} className="text-crimson-bright" />
          {t(VIP_LABEL)}
        </h2>
        <CloseButton onClick={onClose} />
      </div>

      {action && (
        <p className="mt-1 text-xs font-bold text-gold">
          {t("״{action}״ נפתח עם {vip}", { action, vip: t(VIP_LABEL) })}
        </p>
      )}
      <p className="mt-1 text-xs text-zinc-400">
        {t(
          "רכישה חד־פעמית שפותחת את כפתורי ״הכל״ שכבר קיימים במשחק. חיסכון בלחיצות בלבד — כל מה שהם עושים אפשר לעשות גם בלעדיהם, ידנית."
        )}
      </p>

      <ul className="mt-4 space-y-2">
        {VIP_PERKS.map((perk) => (
          <li key={perk.title} className="panel-inset flex gap-2.5 rounded-lg p-3">
            <Icon
              name={perk.icon}
              size={18}
              className="mt-0.5 shrink-0 text-crimson-bright"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-gold-bright">
                {t(perk.title)}
              </span>
              <span className="block text-[11px] leading-snug text-zinc-400">
                {t(perk.desc)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {state.success ? (
        <p className="mt-4 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-center text-sm font-semibold text-emerald-400">
          <Icon name="crown" size={16} className="shrink-0" />
          {state.success}
        </p>
      ) : (
        <form className="mt-4">
          <SubmitButton
            className="btn btn-gold w-full px-4 py-2.5 font-black"
            formAction={buy}
            pendingText={t("רוכש...")}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Icon name="crown" size={16} />
              {t("שדרג ל־{vip}", { vip: t(VIP_LABEL) })} ·
              <span className="nums inline-flex items-center gap-1" dir="ltr">
                {VIP_COST}
                <Icon name="diamond" size={14} className="text-cyan-100" />
              </span>
            </span>
          </SubmitButton>
        </form>
      )}

      {state.error && (
        <div className="mt-3">
          <FormMessage error={state.error} />
        </div>
      )}

      {!state.success && (
        <Link
          href="/game/diamonds/buy"
          onClick={onClose}
          className="mt-3 block text-center text-[11px] text-zinc-500 underline underline-offset-2 transition-colors hover:text-gold-bright"
        >
          {t("אין מספיק יהלומים? לרכישת יהלומים")}
        </Link>
      )}
    </Dialog>
  );
}
