import type { ComponentType, SVGProps } from "react";
import {
  GiTwoCoins, GiWoodPile, GiMetalBar, GiStoneBlock, GiCutDiamond,
  GiThreeFriends, GiSandsOfTime, GiSpartanHelmet, GiSpy, GiCrossedSwords,
  GiCheckedShield, GiCastle, GiAnvil, GiMineWagon, GiBank, GiChest,
  GiUpgrade, GiFlyingFlag, GiBowman, GiTrophy, GiRibbonMedal,
  GiScrollUnfurled, GiEnvelope, GiGears, GiExitDoor, GiCrown,
  GiRollingDices, GiShoppingBag, GiPresent, GiSparkles,
  GiHeartInside, GiHealthPotion, GiCompass, GiTalk,
  GiPadlock, GiPadlockOpen, GiCheckMark, GiLaurelCrown,
  GiWorld, GiLinkedRings, GiShare,
} from "react-icons/gi";
// The one glyph that is a *brand*, not a game-art silhouette: the community
// channel is Discord, and a hand-picked sword or scroll standing in for it
// would read as some other game feature. It still renders in `currentColor`
// like every other entry, so it takes the gold of the nav around it.
import { FaDiscord } from "react-icons/fa6";

/**
 * KRALDOR icon set — professional game-art silhouettes (game-icons.net via
 * react-icons). Each icon renders in `currentColor`, so it takes the antique
 * gold of a heading or the bone tone of the nav automatically. One shared
 * component keeps every call site (`<Icon name="gold" />`) stable regardless of
 * which underlying glyph we choose.
 */

export type IconName =
  | "gold" | "wood" | "iron" | "stone" | "diamond" | "citizens" | "turns"
  | "army" | "spy" | "attack" | "shield" | "base" | "factory" | "mine"
  | "bank" | "storage" | "upgrades" | "guild" | "hero" | "rankings"
  | "achievements" | "reports" | "messages" | "settings" | "logout"
  | "crown" | "dice" | "wheel" | "shop" | "gift" | "spark" | "heart" | "potion"
  | "quest" | "chat" | "discord" | "language"
  /* the invite link and the buttons that send it on */
  | "link" | "share"
  /* status glyphs — these replace the 🔒 / ✅ emoji that had crept into the
     reward ladders, which render differently on every platform and cannot take
     a design token's color. */
  | "lock" | "unlocked" | "check" | "laurel";

/**
 * The one glyph game-icons.net doesn't carry: a carnival prize wheel — a
 * segmented disc under a pointer. Hand-drawn to match the silhouette weight of
 * the react-icons set (solid shapes, `currentColor`, 24×24 box) so it sits
 * beside them without looking imported. Eight alternating wedges leave a gap at
 * twelve o'clock for the pointer to bite into, which is what makes it read as a
 * wheel rather than a pinwheel at nav sizes.
 */
function FortuneWheelGlyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      {children}
      <path d="M12 13.4L12.45 6.01A7.4 7.4 0 0 1 16.9 7.86ZM12 13.4L19.39 13.85A7.4 7.4 0 0 1 17.54 18.3ZM12 13.4L11.55 20.79A7.4 7.4 0 0 1 7.1 18.94ZM12 13.4L4.61 12.95A7.4 7.4 0 0 1 6.46 8.5Z" />
      <circle cx="12" cy="13.4" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 6.2 9.2 0.6h5.6z" />
    </svg>
  );
}

const GLYPHS: Record<IconName, ComponentType<SVGProps<SVGSVGElement>>> = {
  gold: GiTwoCoins,
  wood: GiWoodPile,
  iron: GiMetalBar,
  stone: GiStoneBlock,
  diamond: GiCutDiamond,
  citizens: GiThreeFriends,
  turns: GiSandsOfTime,
  army: GiSpartanHelmet,
  spy: GiSpy,
  attack: GiCrossedSwords,
  shield: GiCheckedShield,
  base: GiCastle,
  factory: GiAnvil,
  mine: GiMineWagon,
  bank: GiBank,
  storage: GiChest,
  upgrades: GiUpgrade,
  guild: GiFlyingFlag,
  hero: GiBowman,
  rankings: GiTrophy,
  achievements: GiRibbonMedal,
  reports: GiScrollUnfurled,
  messages: GiEnvelope,
  settings: GiGears,
  logout: GiExitDoor,
  crown: GiCrown,
  dice: GiRollingDices,
  wheel: FortuneWheelGlyph,
  shop: GiShoppingBag,
  gift: GiPresent,
  spark: GiSparkles,
  heart: GiHeartInside,
  potion: GiHealthPotion,
  quest: GiCompass,
  chat: GiTalk,
  discord: FaDiscord,
  language: GiWorld,
  lock: GiPadlock,
  unlocked: GiPadlockOpen,
  check: GiCheckMark,
  laurel: GiLaurelCrown,
  link: GiLinkedRings,
  share: GiShare,
};

export function Icon({
  name,
  size = 20,
  className,
  title,
  ...rest
}: { name: IconName; size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      width={size}
      height={size}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
    </Glyph>
  );
}

/**
 * Map a resource key to its icon name — the single source of truth for which
 * glyph a resource wears. Every surface (command bar, mines, warehouses, wheel,
 * season pass, boss loot, hero items, battle reports) resolves through here, so
 * a resource never shows two different icons in two different screens.
 *
 * Accepts both the singular `diamond` and the `diamonds` balance key, since
 * call sites legitimately hold either.
 */
export const RESOURCE_ICON: Record<string, IconName> = {
  gold: "gold", wood: "wood", iron: "iron", stone: "stone",
  diamond: "diamond", diamonds: "diamond", citizens: "citizens", turns: "turns",
};

/**
 * Authentic per-resource icon tint, so each resource reads at a glance — and
 * the companion source of truth to `RESOURCE_ICON`. Pair the two whenever a
 * resource is shown as a value; the only icons that opt out are section-heading
 * ornaments, which follow the crimson heading language instead.
 */
export const RESOURCE_ICON_COLOR: Record<string, string> = {
  gold: "text-gold-bright",
  wood: "text-amber-600",
  iron: "text-slate-300",
  stone: "text-stone-400",
  diamond: "text-cyan-300",
  diamonds: "text-cyan-300",
  citizens: "text-bone",
  turns: "text-emerald-400",
};

/** Icon name + tint for a resource key, ready to spread onto `<Icon>`. */
export function resourceIcon(key: string): { name: IconName; className: string } {
  return { name: RESOURCE_ICON[key], className: RESOURCE_ICON_COLOR[key] };
}
