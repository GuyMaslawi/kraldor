"use client";

import type { GuildCityStake } from "@/lib/game/guild";
import { useT } from "@/i18n/client";

/**
 * The line both city cards owe a guild member before they move them: a guild
 * holds one city (server/guildCity.ts), so climbing out of it is also a
 * resignation — and for a leader, the dissolution of the whole guild.
 *
 * Printed on the card rather than behind a confirm dialog because the price is
 * only ever paid on purpose: the button already sits behind a resource cost the
 * player spent days gathering, and a leader who reads this is meant to go and
 * hand the crown over first, which no yes/no box can express.
 */
export function GuildCityWarning({ stake }: { stake: GuildCityStake | null }) {
  const t = useT();
  if (!stake) return null;

  const disband = stake.effect === "disband";
  return (
    <p
      className={`rounded-lg border px-3 py-2 text-xs ${
        disband
          ? "border-red-500/40 bg-red-500/10 text-red-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      <span className="font-bold">{disband ? "⚠️ " : "ℹ️ "}</span>
      {disband
        ? t(
            'אתה מנהיג הברית "{guild}". ברית מאחדת שחקנים מאותה העיר בלבד — אם תשנה עיר הברית תפורק על אוצרה ושדרוגיה. העבר את ההנהגה לחבר אחר לפני שאתה זז כדי לשמור עליה.',
            { guild: stake.guildName }
          )
        : t(
            'ברית מאחדת שחקנים מאותה העיר בלבד — שינוי עיר יוציא אותך מהברית "{guild}".',
            { guild: stake.guildName }
          )}
    </p>
  );
}
