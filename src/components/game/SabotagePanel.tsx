"use client";

import { useActionState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { FormMessage } from "@/components/ui/FormMessage";
import {
  SABOTAGE_INTEL_MARGIN,
  type SabotageOption,
} from "@/lib/game/sabotage";
import { sabotageEmpire } from "@/server/actions/game";
import { useT } from "@/i18n/client";

/**
 * The sabotage bench on a rival's dossier.
 *
 * Sits beside the scout and raid buttons rather than on a page of its own,
 * because a sabotage mission is only ever wanted while looking at a specific
 * empire — and because putting it here makes the three verbs a player has
 * against a rival readable in one glance: look, break, raid.
 *
 * Each mission states its price in spies and turns *before* it is pressed. That
 * is not just courtesy: the cell is lost outright on failure, which is the
 * harshest cost in the game outside a lost battle, and a player should never
 * discover it afterwards.
 */
export function SabotagePanel({
  targetEmpireId,
  targetName,
  missions,
}: {
  targetEmpireId: string;
  targetName: string;
  missions: SabotageOption[];
}) {
  const t = useT();
  const [state, action, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(sabotageEmpire, {});

  return (
    <div className="panel rounded-xl p-4">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
        <Icon name="spy" size={18} className="text-crimson-bright" />
        {t("חבלה")}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        {t("משימות חבלה פוגעות בכלכלה בלבד — מלאי, זהב ועבדי מכרות. הן לעולם לא נוגעות בחיילים, בנשק או בכוח. נדרש יתרון מודיעיני של פי {margin} לפחות, וכישלון עולה בכל התא.", {
          margin: SABOTAGE_INTEL_MARGIN,
        })}
      </p>

      <ul className="mt-3 space-y-2">
        {missions.map((mission) => (
          <li
            key={mission.kind}
            style={{ "--accent": mission.accent } as CSSProperties}
            className="rounded-lg border border-border-subtle bg-black/25 p-2.5"
          >
            <div className="flex items-start gap-2.5">
              <span className="mono-sigil flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border">
                <Icon name={mission.icon} size={16} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-bone">{t(mission.name)}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  {t(mission.blurb)}{" "}
                  <span className="font-bold text-zinc-400">
                    {t("({pct}%)", { pct: mission.pct })}
                  </span>
                </p>
                <p className="mt-1 flex items-center gap-2.5 text-[10px] font-bold nums">
                  <Tip tip={t("מרגלים שנשלחים — אובדים אם התא נתפס")}>
                    <span className="flex items-center gap-1 text-purple-300">
                      <Icon name="spy" size={11} />
                      {mission.spies}
                    </span>
                  </Tip>
                  <span className="flex items-center gap-1 text-gold">
                    <Icon name="turns" size={11} />
                    {mission.turns}
                  </span>
                </p>
              </div>

              <form action={action} className="shrink-0 self-center">
                <input type="hidden" name="targetEmpireId" value={targetEmpireId} />
                <input type="hidden" name="kind" value={mission.kind} />
                {mission.shielded ? (
                  <Tip tip={t("על היעד יש מגן פעיל שחוסם את המשימה הזו")}>
                    <span className="flex h-8 w-8 items-center justify-center">
                      <Icon name="shield" size={16} className="text-sky-400" />
                    </span>
                  </Tip>
                ) : (
                  <button
                    type="submit"
                    disabled={pending || !mission.affordable}
                    className="btn btn-dark px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {pending ? t("שולח…") : t("שלח")}
                  </button>
                )}
              </form>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] text-zinc-600">
        {t("{target} תמיד מקבל התראה על חבלה — מוצלחת או שנתפסה.", {
          target: targetName,
        })}
      </p>

      <div className="mt-3">
        <FormMessage error={state.error} success={state.success} />
      </div>
    </div>
  );
}
