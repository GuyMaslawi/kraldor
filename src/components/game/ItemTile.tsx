"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { formatBonus } from "@/lib/game/format";
import { heroItemArtPath, itemSetForLevel } from "@/lib/game/heroSets";
import { useTip } from "@/components/ui/Tip";
import { useT } from "@/i18n/client";

export type Rarity = "legendary" | "epic" | "rare" | "common";

const RARITY: Record<
  Rarity,
  {
    ring: string;
    glow: string;
    bg: string;
    badge: string;
    text: string;
    /** Hex the sparkle stars glow with, tinted to the rarity. */
    spark: string;
    /** How many star sparkles twinkle on the tile — rarer = more. */
    sparks: number;
    /** Whether the piece gets a breathing inner aura (top rarities only). */
    aura: boolean;
  }
> = {
  legendary: {
    ring: "border-gold/80",
    glow: "shadow-[0_0_22px_-4px_rgba(212,168,67,0.6)]",
    bg: "from-[#3a2c10] to-[#0f0b06]",
    badge: "text-gold-bright",
    text: "text-gold-bright",
    spark: "#f7dd7a",
    sparks: 3,
    aura: true,
  },
  epic: {
    ring: "border-purple-400/70",
    glow: "shadow-[0_0_22px_-4px_rgba(168,85,247,0.55)]",
    bg: "from-[#2a1740] to-[#0e0916]",
    badge: "text-purple-200",
    text: "text-purple-300",
    spark: "#cda2f7",
    sparks: 3,
    aura: true,
  },
  rare: {
    ring: "border-sky-400/70",
    glow: "shadow-[0_0_22px_-4px_rgba(56,189,248,0.5)]",
    bg: "from-[#0f2b40] to-[#080f16]",
    badge: "text-sky-200",
    text: "text-sky-300",
    spark: "#7fcdf7",
    sparks: 2,
    aura: false,
  },
  common: {
    ring: "border-emerald-400/60",
    glow: "shadow-[0_0_18px_-6px_rgba(52,211,153,0.5)]",
    bg: "from-[#123023] to-[#080f0c]",
    badge: "text-emerald-200",
    text: "text-emerald-300",
    spark: "#74e6ac",
    sparks: 1,
    aura: false,
  },
};

/** Fixed twinkle anchors (inside the frame); each tile uses the first N. */
const SPARK_SPOTS: { top: string; left: string; size: number; delay: string }[] = [
  { top: "14%", left: "18%", size: 9, delay: "0s" },
  { top: "72%", left: "76%", size: 7, delay: "0.9s" },
  { top: "40%", left: "83%", size: 6, delay: "1.7s" },
];

/** One thing an item grants, as the tooltip renders it. */
export interface ItemTileBonus {
  /** Icon for the line — a stat glyph, or a resource glyph for a resource line. */
  icon: IconName;
  label: string;
  value: number;
  /** Whole units (turns/citizens/resources) rather than a percentage. */
  flat: boolean;
  /** The slot's headline stat, rendered larger and first. */
  primary: boolean;
  /** Tailwind colour class for the icon (resource lines carry their own tint). */
  iconClass?: string;
}

/** Everything the hover tooltip shows about an item. */
export interface ItemTileDetails {
  name: string;
  rarityLabel: string;
  /**
   * Everything the item grants, primary first. Items carry one generous stat
   * plus a couple of smaller ones, so this is a list rather than the single
   * stat + optional resource-lines pair it replaced.
   */
  bonuses: ItemTileBonus[];
  /** Requirement: the hero must be at least this level to equip. */
  requiredLevel: number;
  /** Whether the current hero meets the requirement. */
  meetsRequirement?: boolean;
  /**
   * The piece is on the hero's body right now. Gear worn before a prestige
   * reset stays worn and keeps paying out even though its level requirement is
   * no longer met, so a worn tile never renders locked — the requirement line
   * still says ✗, with a note that taking it off locks it away.
   */
  worn?: boolean;
  equipped?: boolean;
  /** Catalog view: the player already owns a copy. */
  owned?: boolean;
  /** Action hint shown at the bottom, e.g. "לחץ כדי ללבוש". */
  hint?: string;
}

/**
 * A hero equipment / inventory tile. Renders the generated art of the piece's
 * *set* — gear is redrawn every ten item levels, see `heroSets.ts` — falling
 * back to the pre-set single-look art and then to the emoji.
 * With `details`, hovering (or focusing) the tile opens a tooltip with the
 * item's stats and its equip requirement; an unmet requirement renders the
 * tile locked (dimmed + 🔒). The tooltip floats in a portal, so it survives
 * scrolling grids and screen edges without being clipped.
 *
 * `still` strips the moving parts (the light sweep, the twinkles, the breathing
 * aura) and keeps only the static rarity frame. The shimmer is a treasure
 * effect for the handful of pieces on the hero's body or in the bag; a wall of
 * hundreds of them — the full catalog — is a strobing page that drops frames,
 * so that grid asks for still tiles.
 */
export function ItemTile({
  slug,
  icon,
  level,
  name,
  rarity,
  size = "md",
  details,
  still = false,
}: {
  slug?: string;
  icon: string;
  level?: number;
  name?: string;
  rarity: Rarity;
  size?: "sm" | "md" | "lg";
  details?: ItemTileDetails;
  still?: boolean;
}) {
  const t = useT();
  const [imgOk, setImgOk] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const art = slug ? heroItemArtPath(slug, level) : undefined;
  // A missing set file drops to the pre-set art rather than to the bare emoji.
  // Tracking *which* path failed (rather than a boolean) means the fallback
  // clears itself when the tile is re-used for a different piece.
  const [failedArt, setFailedArt] = useState<string | null>(null);
  const src = art && failedArt === art ? `/hero/${slug}.png` : art;
  const r = RARITY[rarity];
  const iconSize =
    size === "lg" ? "text-6xl" : size === "sm" ? "text-3xl" : "text-4xl";
  const worn = details?.worn === true || details?.equipped === true;
  // A worn piece is never "locked": it is working right now, whatever the
  // hero's level. Only gear waiting in the bag greys out behind the 🔒.
  const locked = details?.meetsRequirement === false && !worn;
  // Locked items stay dim & inert; everything else shimmers. Desync each tile's
  // sweep from a stable seed so a grid twinkles unevenly rather than in a wave.
  const sparkle = !locked && !still;
  const shineDelay = `${(((level ?? 1) * 37 + (slug?.length ?? 3) * 13) % 40) / 10}s`;

  // On localhost the image can finish loading before React hydrates, so the
  // onLoad event never fires — check `.complete` on mount to catch that. Also
  // re-checked whenever the art changes, e.g. when an item is upgraded into the
  // next set while the tile stays mounted.
  useEffect(() => {
    const el = imgRef.current;
    setImgOk(!!el && el.complete && el.naturalWidth > 0);
  }, [src]);

  const tip = details && (
    <>
      <p className={`text-sm font-black ${r.text}`}>{details.name}</p>
      <p className="mt-0.5 text-[10px] text-zinc-500">
        {t("דרגה:")} <span className={r.text}>{details.rarityLabel}</span>
        {level != null && (
          <>
            {" · "}
            {t("רמת פריט:")} <span className="nums text-zinc-300">{level}</span>
          </>
        )}
      </p>
      {level != null && (
        <p className="text-[10px] text-zinc-500">
          {t("סט:")}{" "}
          <span className="text-zinc-300">{t(itemSetForLevel(level).label)}</span>
        </p>
      )}

      <div className="rule-gold my-2" />

      {/* what the item grants — headline stat first, extras beneath it */}
      <div className="space-y-0.5 text-xs text-zinc-300">
        {details.bonuses.map((line, i) => (
          <p
            key={`${line.label}-${i}`}
            className={`flex items-center justify-between gap-2 ${
              line.primary ? "" : "text-[11px] text-zinc-400"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Icon
                name={line.icon}
                size={line.primary ? 13 : 12}
                className={line.iconClass ?? "align-[-2px]"}
              />
              {line.label}
            </span>
            <span
              className={`nums font-black ${
                line.primary ? "text-emerald-400" : "text-emerald-500/80"
              }`}
              dir="ltr"
            >
              +{formatBonus(line.value)}
              {line.flat ? "" : "%"}
            </span>
          </p>
        ))}
      </div>

      {/* requirement */}
      <p
        className={`mt-1 text-[11px] ${
          details.meetsRequirement === false ? "text-red-400" : "text-emerald-400"
        }`}
      >
        {details.meetsRequirement === false ? "✗" : "✓"} {t("דרישה: גיבור רמה")}{" "}
        <span className="nums">{details.requiredLevel}</span>
      </p>

      {/* grandfathered: worn from before a reset, below its own requirement */}
      {worn && details.meetsRequirement === false && (
        <p className="mt-1 text-[11px] text-amber-300">
          {t("ממשיך לפעול — אך הסרתו תנעל אותו עד רמה")}{" "}
          <span className="nums">{details.requiredLevel}</span>
        </p>
      )}

      {details.equipped && (
        <p className="mt-1 text-[11px] font-bold text-emerald-300">{t("✔ לבוש כעת")}</p>
      )}
      {details.owned && !details.equipped && (
        <p className="mt-1 text-[11px] text-zinc-400">{t("נמצא ברשותך")}</p>
      )}
      {details.hint && (
        <p className="mt-2 border-t border-white/10 pt-1.5 text-[10px] text-gold-dim">
          {details.hint}
        </p>
      )}
    </>
  );

  const { triggerProps, node: tipNode } = useTip(tip, {
    className: "w-48 p-3",
    bare: true,
    disabled: !details,
  });

  return (
    <div className="relative flex flex-col items-center gap-1.5" {...triggerProps}>
      <div
        className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border-2 bg-gradient-to-b ${r.ring} ${r.glow} ${r.bg} ${
          sparkle ? "item-shine" : ""
        } ${sparkle && r.aura ? "item-aura" : ""} ${locked ? "opacity-90" : ""}`}
        style={
          sparkle
            ? ({ "--shine-delay": shineDelay, color: r.spark } as React.CSSProperties)
            : undefined
        }
      >
        {/* emoji base — always visible; generated art (if any) overlays it */}
        <span
          aria-hidden
          className={`${iconSize} drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] ${
            locked ? "grayscale-[0.7]" : ""
          }`}
        >
          {icon}
        </span>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={src}
            alt={name ?? ""}
            // The catalog renders hundreds of these at once: fetching and
            // decoding every one up front stalls the main thread for seconds.
            // Off-screen tiles now cost nothing until they are scrolled to.
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 h-full w-full object-contain p-1 transition-opacity ${imgOk ? "opacity-100" : "opacity-0"} ${
              locked ? "grayscale-[0.7]" : ""
            }`}
            onLoad={() => setImgOk(true)}
            onError={() => {
              setImgOk(false);
              if (art) setFailedArt(art);
            }}
          />
        )}
        {sparkle &&
          SPARK_SPOTS.slice(0, r.sparks).map((s, i) => (
            <span
              key={i}
              aria-hidden
              className="item-sparkle"
              style={{
                top: s.top,
                left: s.left,
                width: s.size,
                height: s.size,
                animationDelay: s.delay,
              }}
            />
          ))}
        {level != null && (
          <span
            className={`nums absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-black ${
              locked
                ? "border border-red-500/60 bg-black/80 text-red-300"
                : `bg-black/75 ${r.badge}`
            }`}
            dir="ltr"
            title={t("רמה {level}", { level })}
          >
            {level}
          </span>
        )}
        {locked && (
          <span
            aria-label={t("נעול — הגיבור ברמה נמוכה מדי")}
            className="absolute bottom-1 left-1 rounded bg-black/80 px-1 text-[11px]"
          >
            🔒
          </span>
        )}
        {details?.equipped && (
          <span className="absolute bottom-1 right-1 rounded bg-emerald-600/90 px-1 text-[9px] font-black text-white">
            {t("לבוש")}
          </span>
        )}
        {details?.owned && !details.equipped && (
          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] font-black text-emerald-300">
            ✓
          </span>
        )}
      </div>
      {name && <span className="text-xs font-semibold text-zinc-300">{name}</span>}

      {tipNode}
    </div>
  );
}
