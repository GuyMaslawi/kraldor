"use client";

import { useActionState } from "react";
import { foundCity, type ActionState } from "@/server/actions/game";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Card } from "@/components/ui/Card";
import { Icon, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { formatNumber } from "@/lib/game/format";
import { CITIZEN_GROWTH_LEVELS_PER_CITY } from "@/lib/game/constants";
import { cityName } from "@/lib/game/cities";
import type { GuildCityStake } from "@/lib/game/guild";
import { GuildCityWarning } from "@/components/game/GuildCityWarning";
import { useT } from "@/i18n/client";

const COST_RESOURCES = [
  { key: "gold", icon: "gold" },
  { key: "wood", icon: "wood" },
  { key: "iron", icon: "iron" },
  { key: "stone", icon: "stone" },
] as const;

export interface CityFoundCardProps {
  cities: number;
  maxCities: number;
  heroLevel: number;
  heroRequired: number;
  cost: { gold: number; wood: number; iron: number; stone: number; soldiers: number };
  available: { gold: number; wood: number; iron: number; stone: number };
  soldiersAvailable: number;
  /** What the climb would cost the player's guild, or null if nothing. */
  guildStake: GuildCityStake | null;
}

/** Mine production scales with the city count: ×1 now, ×(cities+1) after upgrading. */

export function CityFoundCard({
  cities,
  maxCities,
  heroLevel,
  heroRequired,
  cost,
  available,
  soldiersAvailable,
  guildStake,
}: CityFoundCardProps) {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(foundCity, {});

  const isMax = cities >= maxCities;
  const meetsHero = heroLevel >= heroRequired;
  const enoughSoldiers = soldiersAvailable >= cost.soldiers;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gold/40 bg-panel-inset"
        >
          <Icon name="base" size={26} className="text-crimson-bright" />
        </span>
        <div>
          <h3 className="font-bold text-gold-bright">{t("עליית עיר")}</h3>
          {/* Named first, numbered in the parentheses the name carries: the card
              is the moment the player decides to make the climb, and
              "אשמורן (3) → תרשיש (4)" is a destination in a way that "3 → 4"
              never was — while the tier is still what the costs and the hero
              gate are keyed to. */}
          <p className="text-xs font-semibold text-gold">
            <span className="text-bone">{cityName(t, cities)}</span>
            {!isMax && (
              <>
                {" → "}
                <span className="text-bone">{cityName(t, cities + 1)}</span>
              </>
            )}{" "}
            <span className="font-normal text-gold-dim">
              {t("(מתוך {max} ערים)", { max: maxCities })}
            </span>
          </p>
        </div>
      </div>

      {isMax ? (
        <p className="text-sm text-zinc-400">
          {t("הגעת ל־")}
          <span className="font-bold text-bone">{cityName(t, cities)}</span>{" "}
          {t("— העיר האחרונה. תפוקת המכרות ורמות קבלת האזרחים שלך במקסימום.")}
        </p>
      ) : (
        <>
          <p className="text-sm text-zinc-400">
            {t("עליית עיר מכפילה את תפוקת המכרות ל־")}
            <span className="font-bold text-emerald-400 nums" dir="ltr">
              ×{cities + 1}
            </span>{" "}
            {t("ופותחת עוד {levels} רמות לשדרוג קבלת האזרחים.", {
              levels: CITIZEN_GROWTH_LEVELS_PER_CITY,
            })}
          </p>

          {/* Requirements — these are gates the empire must meet; none are spent. */}
          <div className="panel-inset space-y-2 rounded-lg p-3 text-xs">
            <p className="font-semibold text-gold-dim">{t("דרישות (אינן נצרכות):")}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className={meetsHero ? "text-emerald-400" : "text-red-400"}>
                <Icon name="hero" size={14} className="inline align-[-2px]" />{" "}
                {t("גיבור רמה {required} (כעת {level})", {
                  required: heroRequired,
                  level: heroLevel,
                })}{" "}
                {meetsHero ? "✓" : "✗"}
              </span>
              <span className={enoughSoldiers ? "text-emerald-400" : "text-red-400"}>
                <Icon name="army" size={14} className="inline align-[-2px]" />{" "}
                {t("{count} חיילים בצבא", { count: formatNumber(cost.soldiers) })}{" "}
                {enoughSoldiers ? "✓" : "✗"}
              </span>
            </div>
          </div>

          <div className="panel-inset space-y-2 rounded-lg p-3 text-xs">
            <p className="font-semibold text-gold-dim">{t("עלות עלייה (נצרכת):")}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-400">
              {COST_RESOURCES.map(({ key, icon }) => {
                const missing = available[key] < cost[key];
                return (
                  <span
                    key={key}
                    className={missing ? "font-semibold text-red-400" : undefined}
                    title={missing ? t("אין מספיק מהמשאב הזה") : undefined}
                  >
                    <Icon
                      name={icon}
                      size={14}
                      className={`inline align-[-2px] ${RESOURCE_ICON_COLOR[key]}`}
                    />{" "}
                    <span className="nums" dir="ltr">
                      {formatNumber(cost[key])}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Last thing above the button: a leader who climbs takes his guild's
              city with him and the guild is disbanded. */}
          <GuildCityWarning stake={guildStake} />

          <form action={action} className="mt-auto">
            <SubmitButton
              className="btn btn-gold w-full"
              pendingText={t("מעלה עיר...")}
              disabled={!meetsHero || !enoughSoldiers}
            >
              {t("עלה עיר")}
            </SubmitButton>
          </form>
        </>
      )}

      <FormMessage error={state.error} success={state.success} />
    </Card>
  );
}
