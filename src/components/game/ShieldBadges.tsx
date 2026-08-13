"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { SHIELDS, shieldMeta, type ShieldKey } from "@/lib/game/diamondShop";
import { useT } from "@/i18n/client";

/**
 * The glyph and tint each raid shield wears — one source of truth so a shield
 * looks the same in the diamond shop, on the rankings ladder and on a target's
 * profile. The shield outline is common to both; the second glyph says *what*
 * is behind it (a warehouse for the resource shield, a helmet for the soldier
 * shield), which is what lets a raider tell them apart at a glance.
 */
export const SHIELD_ICON: Record<ShieldKey, IconName> = {
  resources: "storage",
  soldiers: "army",
};

export const SHIELD_TONE: Record<ShieldKey, string> = {
  resources: "border-gold/50 bg-gold/10 text-gold-bright",
  soldiers: "border-sky-400/50 bg-sky-500/10 text-sky-300",
};

/**
 * The pill for one shield — a shield outline, tinted by which shield it is.
 * Shared by the live badges below and every report that mentions a shield, so
 * the same mark always means the same thing.
 *
 * It carries no word and no second glyph on purpose. A raid shield is a
 * secondary fact on a row that is already dense (name, city, guild, power), and
 * spelling `משאבים` / `חיילים` beside every one of them cost a line of reading
 * for something most readers skip. The tint carries the difference — gold for
 * the resource shield, blue for the soldier shield — and the tooltip says it in
 * full for anyone who stops on it.
 *
 * The frame (`rounded-md px-2 py-0.5`) is deliberately the same one every other
 * stat pill wears — power, guild, health. A shield drawn tighter than its
 * neighbours read as a lesser, decorative mark sitting in a row of real ones.
 */
export function ShieldGlyph({
  shieldKey,
  size = 12,
  tip,
}: {
  shieldKey: ShieldKey;
  size?: number;
  /** Override the tooltip; defaults to the shield's badge line. */
  tip?: string;
}) {
  const t = useT();
  const meta = shieldMeta(shieldKey);
  return (
    // shrink-0 on the Tip wrapper as well as the pill: the wrapper is the flex
    // child, so without it a tight row squeezes the badge instead of the name.
    <Tip className="shrink-0" tip={tip ?? t(meta.badge)}>
      <span
        // The pill is the whole meaning here, so it needs its own name for a
        // reader who never sees the tint or the tooltip.
        role="img"
        aria-label={t(meta.label)}
        className={`inline-flex shrink-0 cursor-help items-center rounded-md border px-2 py-0.5 ${SHIELD_TONE[shieldKey]}`}
      >
        <Icon name="shield" size={size} />
      </span>
    </Tip>
  );
}

/**
 * Which shields to draw. Any truthy value means "this one is up" — an expiry
 * timestamp where the screen is allowed to know the hour (the spy report, your
 * own shop), and a bare `true` everywhere else. See `shieldFlags` in
 * `src/lib/game/diamondEffects.ts`: this component is a client component, so
 * whatever it is handed crosses into the payload, and the drop hour is intel
 * the badge deliberately does not carry.
 */
export type ShieldState = Partial<Record<ShieldKey, Date | string | boolean | null>>;

/**
 * The shield pills shown beside an empire's name. Renders nothing when the
 * empire holds no shield, so it can be dropped into any row unconditionally.
 *
 * The badge says *that* a shield is up and nothing more. The hour it drops is
 * intel — a raider who knows a shield expires at 14:30 can park on the target
 * and strike the minute it does, without paying a spy for the timing. That
 * number belongs in the spy report (and in the shop, for your own shields).
 */
export function ShieldBadges({
  shields,
  size = "sm",
}: {
  shields: ShieldState | undefined;
  /** `sm` for table rows, `md` for the profile header. */
  size?: "sm" | "md";
}) {
  if (!shields) return null;
  // Truthiness, not `!= null`: a flags map spells a shield that is *not* up as
  // `false`, and a null check would draw a badge for every one of them.
  const active = SHIELDS.filter((s) => Boolean(shields[s.key]));
  if (active.length === 0) return null;

  return (
    <>
      {active.map((s) => (
        <ShieldGlyph key={s.key} shieldKey={s.key} size={size === "md" ? 14 : 12} />
      ))}
    </>
  );
}
