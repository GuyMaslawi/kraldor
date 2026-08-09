"use client";

import type { CSSProperties } from "react";
import {
  MONUMENT_MAX_LEVEL,
  VILLAGE_SIZE,
  type MonumentView,
} from "@/lib/game/monuments";
import { useT } from "@/i18n/client";

/**
 * אתר הבנייה — the capital's build site.
 *
 * The five monuments used to be five cards with a progress bar, and a progress
 * bar is a poor way to say "this thing is half-built". So the screen now opens
 * on the ground itself: an eight-by-eight isometric plot of grass, dirt and
 * road, with each monument standing on its own 2×2 lot and **growing with its
 * level** — bare stakes at 0, scaffolded stone through the middle, and only at
 * 12 does it get its crown and its banner.
 *
 * ## Why clip-path and not 3D transforms
 *
 * The obvious way to draw this is `transform-style: preserve-3d` with a camera
 * rotation, and it is the wrong way here. A 3D scene inherits the browser's
 * z-sorting, which is per-plane and not per-pixel, so overlapping buildings
 * flicker; it fights every ancestor that creates a stacking context (this page
 * sits inside several); and it is unpredictable on mobile Safari. Painting the
 * projection by hand with `clip-path` polygons is deterministic: every vertex
 * below is a `calc()` on two numbers, `--tw` (tile width) and `--th` (tile
 * height, always half of it), so the whole scene rescales for a phone by
 * changing those two values and nothing else.
 *
 * ## The projection, in two lines
 *
 * A tile at grid `(c, r)` lands at
 *   `left = (c - r + N - 1) · tw/2`,  `top = (c + r) · th/2`
 * which is the standard 2:1 isometric mapping. Painter's order falls out of the
 * same pair: `z-index: c + r` puts a lot in front of everything behind it, and
 * that is the only depth sorting this scene needs.
 *
 * Everything here is presentational — the levels, the costs and the buying all
 * still live on the cards below (see Monuments.tsx). A lot is an anchor to its
 * own card, so the scene never becomes a second, divergent place to spend gold.
 */

const N = VILLAGE_SIZE;

/** Grid coordinates of the decorative trees, on the four grass verges.
 *
 * Fixed rather than random for the reason every scene on this site is: the
 * markup is server-rendered, and `Math.random()` would make the server and the
 * client disagree about where the trees are. */
const TREES: readonly { c: number; r: number; s: number }[] = [
  { c: 0, r: 3, s: 0 },
  { c: 1, r: 4, s: 1 },
  { c: 3, r: 0, s: 1 },
  { c: 4, r: 1, s: 0 },
  { c: 6, r: 4, s: 0 },
  { c: 7, r: 3, s: 1 },
  { c: 4, r: 6, s: 1 },
  { c: 3, r: 7, s: 0 },
];

type TileKind = "grass" | "road" | "dirt";

/**
 * Classify every tile once. Dirt is a monument's lot, road is the two crossing
 * bands that separate the lots, and what is left over is grass.
 */
function buildTiles(monuments: readonly MonumentView[]) {
  const lots = new Set<string>();
  for (const m of monuments) {
    for (let dc = 0; dc < 2; dc += 1) {
      for (let dr = 0; dr < 2; dr += 1) {
        lots.add(`${m.plot.c + dc},${m.plot.r + dr}`);
      }
    }
  }

  const tiles: { c: number; r: number; kind: TileKind; shade: number }[] = [];
  for (let r = 0; r < N; r += 1) {
    for (let c = 0; c < N; c += 1) {
      const kind: TileKind = lots.has(`${c},${r}`)
        ? "dirt"
        : c === 2 || c === 5 || r === 2 || r === 5
          ? "road"
          : "grass";
      // A cheap deterministic hash, so neighbouring tiles rarely share a shade
      // and the ground stops reading as one flat colour.
      tiles.push({ c, r, kind, shade: (c * 7 + r * 13) % 3 });
    }
  }
  return tiles;
}

export function MonumentVillage({
  monuments,
}: {
  monuments: readonly MonumentView[];
}) {
  const t = useT();
  const tiles = buildTiles(monuments);

  // A <nav>, not a labelled <div role="img">: the five lots are real in-page
  // links, and `role="img"` would have made the whole subtree presentational —
  // leaving five focusable elements inside a region assistive tech is told to
  // treat as a single picture.
  return (
    <nav className="vil-stage" aria-label={t("אתר הבנייה של הבירה")}>
      <div className="vil-field">
        <span className="vil-soil" aria-hidden />

        {tiles.map((tile) => (
          <span
            key={`${tile.c},${tile.r}`}
            aria-hidden
            className={`vil-tile vil-${tile.kind} vil-s${tile.shade}`}
            style={{ "--c": tile.c, "--r": tile.r } as CSSProperties}
          />
        ))}

        {TREES.map((tree) => (
          <span
            key={`t${tree.c},${tree.r}`}
            aria-hidden
            className={`vil-tree vil-tree-${tree.s}`}
            style={{ "--c": tree.c, "--r": tree.r } as CSSProperties}
          />
        ))}

        {monuments.map((monument) => (
          <Lot key={monument.key} monument={monument} />
        ))}
      </div>
    </nav>
  );
}

/* --------------------------- one monument's lot --------------------------- */

function Lot({ monument }: { monument: MonumentView }) {
  const t = useT();
  const level = monument.level;
  const done = level >= MONUMENT_MAX_LEVEL;
  const empty = level === 0;
  // Scaffolding stands for exactly as long as the thing is unfinished, which
  // here means "not at 12" — that is the whole visual grammar of the screen.
  const building = level > 0 && !done;
  // The two crowning pieces that only appear past a threshold. The plaque hangs
  // off the top of the silhouette, so it has to be told when they are there —
  // the CSS cannot see a conditionally-rendered child.
  const spired = monument.shape === "tower" && level >= 8;
  const lofted = monument.shape === "hall" && level >= 7;

  return (
    <a
      href={`#mono-${monument.key}`}
      className={`vil-lot vil-${monument.shape}${done ? " is-done" : ""}${
        spired ? " is-spired" : ""
      }${lofted ? " is-lofted" : ""}`}
      style={
        {
          "--c": monument.plot.c,
          "--r": monument.plot.r,
          "--lv": level,
          "--accent": monument.accent,
        } as CSSProperties
      }
      aria-label={t("{monument} — רמה {level} מתוך {max}", {
        monument: t(monument.name),
        level,
        max: MONUMENT_MAX_LEVEL,
      })}
    >
      <span className="vil-shadow" aria-hidden />

      {empty ? (
        <span className="vil-stakes" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : (
        <span className="vil-build" aria-hidden>
          {monument.shape === "gate" ? (
            <Gate level={level} />
          ) : monument.shape === "wheel" ? (
            <Wheel level={level} />
          ) : (
            <Block shape={monument.shape} level={level} />
          )}
          {building && (
            <span className="vil-scaffold">
              <i />
              <i />
              <i />
            </span>
          )}
        </span>
      )}

      <span className="vil-plaque">
        <span className="vil-plaque-name">{t(monument.name)}</span>
        <span className="vil-plaque-lv nums">
          {level}/{MONUMENT_MAX_LEVEL}
        </span>
      </span>
    </a>
  );
}

/**
 * The isometric box, and the only primitive on this screen. Three faces — a top
 * diamond and the two walls that meet at the near vertex — each clipped out of
 * the same rectangle, so one element is one solid.
 *
 * It carries no geometry of its own: every box reads `--bw` (its footprint
 * width), `--h` (its height) and `--y` (how far its base is lifted off the
 * ground) from the class it is given, which keeps all five silhouettes in one
 * readable block of CSS instead of scattered through JSX.
 */
function Box({ className }: { className: string }) {
  return (
    <span className={`vil-box ${className}`}>
      <span className="vil-top" />
      <span className="vil-r" />
      <span className="vil-l" />
    </span>
  );
}

/** A column, a tower or a hall: a plinth, the shaft, and a crown of some kind. */
function Block({
  shape,
  level,
}: {
  shape: "column" | "tower" | "hall";
  level: number;
}) {
  return (
    <>
      <Box className="vil-plinth" />
      <Box className="vil-shaft" />
      {/* The cap only appears once there is a shaft worth capping — below level
          5 it would sit on the plinth and read as a lid, not a capital. */}
      {level >= 5 && <Box className="vil-cap" />}
      {shape === "tower" && level >= 4 && <span className="vil-clock" />}
      {shape === "tower" && level >= 8 && <span className="vil-spire" />}
      {shape === "hall" && level >= 7 && <Box className="vil-loft" />}
      {shape === "column" && level >= 3 && <span className="vil-flutes" />}
    </>
  );
}

/** The victory gate: two piers and the lintel that bridges them. */
function Gate({ level }: { level: number }) {
  return (
    <>
      <Box className="vil-pier vil-pier-a" />
      <Box className="vil-pier vil-pier-b" />
      {/* Nothing spans the piers until they are tall enough to be spanned. */}
      {level >= 3 && <Box className="vil-lintel" />}
      {level >= 9 && <span className="vil-banner" />}
    </>
  );
}

/** The sky wheel: a pedestal, and the ring that turns on it. */
function Wheel({ level }: { level: number }) {
  return (
    <>
      <Box className="vil-plinth" />
      <Box className="vil-shaft" />
      {level >= 2 && (
        <span className="vil-ring">
          <span className="vil-ring-spin">
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
    </>
  );
}
