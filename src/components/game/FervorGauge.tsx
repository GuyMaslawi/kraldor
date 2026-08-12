"use client";

import { useServerNow } from "@/components/game/HeroPotions";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { useT } from "@/i18n/client";
import {
  FERVOR_DECAY_MS,
  FERVOR_MAX_HOT_ATTACKS,
  type FervorTierKey,
  fervorLabel,
  fervorNextTier,
  fervorNow,
  fervorProgress,
  fervorTier,
} from "@/lib/game/fervor";

/**
 * The ember's tint per rung — presentation only, which is why it lives here and
 * not in lib/game/fervor.ts beside the multipliers. `fervor-blaze` (globals.css)
 * adds the breathing glow the top rung alone gets.
 */
const TIER_TONE: Record<FervorTierKey, string> = {
  spark: "text-zinc-600",
  flame: "text-amber-400/80",
  bonfire: "text-orange-400",
  blaze: "text-orange-500 fervor-blaze",
};

/**
 * להט הקרב, in the frame header beside the update timers and the running
 * potions — the row that answers "what is changing my numbers right now?".
 *
 * ## Why this polls nothing
 *
 * The meter's decay is a pure function of two numbers the server already sent:
 * the points, and the instant they were true. So the countdown runs entirely on
 * the client — `useServerNow` ticks a skew-corrected clock once a second and
 * `fervorNow` re-derives the value from the same inputs the server would use.
 *
 * That is not an optimisation, it is the point. This chip is on every game
 * screen for every player; polling it would put a request per second per player
 * against a number that nothing but the passage of time is changing. The only
 * thing that *raises* the meter is an action, and an action already revalidates
 * the layout, so fresh props arrive exactly when they mean something.
 *
 * ## Why it renders when cold
 *
 * A meter that only appears once it is lit can never teach anyone it exists —
 * the player would have to warm it by accident to find out warming it was
 * possible. Cold, it renders dim and says what it is; the tip carries the rest.
 */
export function FervorGauge({
  points,
  at,
  serverNow,
  hotUsed,
}: {
  /** Stored points — what the meter was worth at `at`, not what it is now. */
  points: number;
  /** Epoch ms those points were true, or null for a meter never lit. */
  at: number | null;
  serverNow: number;
  /** Boosted attacks already spent today (see FERVOR_MAX_HOT_ATTACKS). */
  hotUsed: number;
}) {
  const t = useT();
  const now = useServerNow(serverNow);

  const live = fervorNow(points, at, now);
  const tier = fervorTier(live);
  const next = fervorNextTier(live);
  const progress = fervorProgress(live);
  const lit = live > 0;
  const spent = hotUsed >= FERVOR_MAX_HOT_ATTACKS;

  return (
    <Tip
      side="bottom"
      tip={[
        t(
          "להט הקרב — כל פעולה שאתה מבצע מחממת את המד, ונקודה דועכת ממנו כל {minutes} דקות.",
          { minutes: FERVOR_DECAY_MS / 60_000 }
        ),
        t(
          "כשהמד לוהט, הביזה שאתה לוקח מאימפריה מובסת גדולה יותר — עד {max} תקיפות מנצחות ביום.",
          { max: FERVOR_MAX_HOT_ATTACKS }
        ),
        t("התורות עצמן נצברות כרגיל גם כשאתה לא מחובר. הלהט משנה כמה כל תורה שווה."),
      ].join(" ")}
    >
      <span className="flex cursor-help items-center gap-1.5 text-xs">
        {/* One ember that brightens up the ladder, rather than one emoji per
            rung. Three stacked 🔥 read as decoration in a header built from the
            game's own icon set, and the tier is already spelled out in words
            beside it — the colour is emphasis, never the only signal. */}
        <Icon
          name="spark"
          size={16}
          className={`shrink-0 ${TIER_TONE[tier.key]}`}
        />
        <span className="flex flex-col items-start leading-none">
          <span className="flex items-baseline gap-1">
            <span
              className={`font-bold ${lit ? "text-amber-300" : "text-zinc-500"}`}
            >
              {t(tier.label)}
            </span>
            {lit && (
              <span
                className="font-extrabold tabular-nums text-amber-400"
                dir="ltr"
              >
                {fervorLabel(live)}
              </span>
            )}
          </span>
          {/* The rung's own fill, not the ladder's: each tier empties and
              refills, so the bar reads as "how close to the next one" rather
              than as a total that barely moves near the top. */}
          <span
            aria-hidden
            className="mt-0.5 h-1 w-16 overflow-hidden rounded-full bg-zinc-800"
          >
            <span
              className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-[width] duration-500"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>
        </span>
        {/* The day's allowance, and only once it is worth knowing about. Shown
            from halfway so it reads as a budget rather than as an alarm. */}
        {hotUsed >= FERVOR_MAX_HOT_ATTACKS / 2 && (
          <span
            className={`tabular-nums ${spent ? "text-zinc-500" : "text-zinc-400"}`}
            dir="ltr"
          >
            {hotUsed}/{FERVOR_MAX_HOT_ATTACKS}
          </span>
        )}
        {next && lit && (
          <span className="hidden text-[10px] text-zinc-500 xl:inline">
            {t("→ {tier} בעוד {n}", {
              tier: t(next.tier.label),
              n: next.pointsAway,
            })}
          </span>
        )}
      </span>
    </Tip>
  );
}
