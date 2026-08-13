"use client";

import { useId, type ReactElement, type SVGProps } from "react";
import type { PotionKind } from "@prisma/client";
import { POTION_META, type PotionShape } from "@/lib/game/potions";
import { useT } from "@/i18n/client";

/**
 * The potion art — hand-drawn glassware in SVG rather than PNGs, so a bottle
 * stays crisp at any size, tints itself from the catalog, and costs no asset
 * pipeline. Each brew gets its own silhouette *and* its own liquid colour, so
 * a full belt is readable by shape alone at 40px.
 *
 * Every shape is described once below as a *function* of its paint, because the
 * same geometry is drawn three times over: filled as glass, stroked as the
 * glass edge, and again inside a clipPath that keeps the liquid in the bottle.
 */

/** Only the paint varies between the three passes — geometry never does. */
type ShapeProps = Pick<
  SVGProps<SVGElement>,
  "fill" | "stroke" | "strokeWidth"
>;

interface ShapeSpec {
  /** The glass body — drawn as glass, as its own outline, and as the liquid clip. */
  Body: (props: ShapeProps) => ReactElement;
  /** Neck and shoulders, drawn under the cork. */
  Neck: (props: ShapeProps) => ReactElement;
  /** y of the liquid surface in user units, and its half-width there. */
  surface: { y: number; rx: number };
  cork: { x: number; y: number; w: number; h: number };
}

const SHAPES: Record<PotionShape, ShapeSpec> = {
  // tall slender tube — the scholar's brew
  vial: {
    Body: (p) => <rect x="25" y="25" width="14" height="30" rx="7" {...p} />,
    Neck: (p) => <rect x="28.5" y="13" width="7" height="14" rx="2.5" {...p} />,
    surface: { y: 31, rx: 6.6 },
    cork: { x: 27.5, y: 7.5, w: 9, h: 6.5 },
  },
  // fat round bulb — abundance, drawn as a belly full of it
  orb: {
    Body: (p) => <circle cx="32" cy="42" r="14.5" {...p} />,
    Neck: (p) => <rect x="27" y="18" width="10" height="13" rx="2.5" {...p} />,
    surface: { y: 34, rx: 13.4 },
    cork: { x: 25.5, y: 11.5, w: 13, h: 7 },
  },
  // broad-based conical flask — the one that stands its ground
  flask: {
    Body: (p) => (
      <path
        d="M26 25 h12 v7 l10.6 20.4 a5.4 5.4 0 0 1 -4.8 7.9 h-23.6 a5.4 5.4 0 0 1 -4.8 -7.9 l10.6 -20.4 z"
        {...p}
      />
    ),
    Neck: (p) => <rect x="27" y="13" width="10" height="13" rx="2.5" {...p} />,
    surface: { y: 41, rx: 12.4 },
    cork: { x: 25.5, y: 7, w: 13, h: 7 },
  },
  // faceted crystal — cut glass for the forge
  crystal: {
    Body: (p) => <path d="M32 22.5 L46 31 V47.5 L32 56.5 L18 47.5 V31 Z" {...p} />,
    Neck: (p) => <rect x="28" y="11" width="8" height="13" rx="2" {...p} />,
    surface: { y: 33, rx: 12.6 },
    cork: { x: 26.5, y: 5.5, w: 11, h: 6.5 },
  },
};

/** Bubbles rising through the liquid — x, radius and animation offset. */
const BUBBLES = [
  { cx: 28, r: 1.5, delay: "0s", duration: "3.1s" },
  { cx: 34.5, r: 1.1, delay: "1.1s", duration: "3.8s" },
  { cx: 31, r: 1.9, delay: "2.2s", duration: "3.4s" },
];

const GLASS_EDGE = "rgba(255,255,255,0.42)";

export function PotionBottle({
  kind,
  className,
  /** Drain the colour — used for a brew the player doesn't hold. */
  empty = false,
}: {
  kind: PotionKind;
  className?: string;
  empty?: boolean;
}) {
  // useId contains ':' which is not valid inside an SVG url(#…) reference.
  const uid = useId().replace(/:/g, "");
  const meta = POTION_META[kind];
  const { Body, Neck, surface, cork } = SHAPES[meta.shape];
  const { from, to, glow } = meta.liquid;

  const t = useT();
  const liquidId = `pl-${uid}`;
  const glassId = `pg-${uid}`;
  const clipId = `pc-${uid}`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={t(meta.label)}
      style={{ opacity: empty ? 0.4 : 1 }}
    >
      <defs>
        <linearGradient id={liquidId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="55%" stopColor={to} />
          <stop offset="100%" stopColor={to} stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.13" />
        </linearGradient>
        <clipPath id={clipId}>
          <Body />
        </clipPath>
      </defs>

      {/* the light the brew throws behind it */}
      {!empty && (
        <ellipse
          cx="32"
          cy="43"
          rx="19"
          ry="17"
          fill={glow}
          opacity="0.16"
          className="potion-glow"
        />
      )}

      {/* neck, then the cork jammed into it */}
      <Neck fill={`url(#${glassId})`} stroke={GLASS_EDGE} strokeWidth={1.4} />
      <rect
        x={cork.x}
        y={cork.y}
        width={cork.w}
        height={cork.h}
        rx="2.2"
        fill="#7c5228"
        stroke="#42260f"
        strokeWidth="1.1"
      />
      <rect
        x={cork.x + 1}
        y={cork.y + 1.2}
        width={cork.w - 2}
        height="1.6"
        rx="0.8"
        fill="#a97845"
        opacity="0.8"
      />

      {/* glass body */}
      <Body fill={`url(#${glassId})`} />

      {/* the brew itself, clipped to the glass */}
      {!empty && (
        <g clipPath={`url(#${clipId})`}>
          <rect
            x="0"
            y={surface.y}
            width="64"
            height={64 - surface.y}
            fill={`url(#${liquidId})`}
          />
          {/* a lit meniscus, so the surface reads as liquid and not a cut-off */}
          <ellipse
            cx="32"
            cy={surface.y}
            rx={surface.rx}
            ry="2.2"
            fill={from}
            opacity="0.9"
          />
          {BUBBLES.map((bubble, i) => (
            <circle
              key={i}
              cx={bubble.cx}
              cy="57"
              r={bubble.r}
              fill="#ffffff"
              opacity="0.6"
              className="potion-bubble"
              style={{
                animationDelay: bubble.delay,
                animationDuration: bubble.duration,
              }}
            />
          ))}
        </g>
      )}

      {/* the glass edge sits on top of the liquid, and a highlight down its side */}
      <Body fill="none" stroke={GLASS_EDGE} strokeWidth={1.4} />
      <g clipPath={`url(#${clipId})`}>
        <rect
          x="22"
          y="20"
          width="3.2"
          height="34"
          rx="1.6"
          fill="#ffffff"
          opacity="0.26"
          transform="rotate(6 24 37)"
        />
      </g>
    </svg>
  );
}
