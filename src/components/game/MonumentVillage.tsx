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
 * bar is a poor way to say "this thing is half-built". So the screen is the
 * ground itself: an eight-by-eight isometric plot of grass, dirt and road, with
 * each monument standing on its own 2×2 lot and **growing with its level** —
 * bare stakes at 0, scaffolded stone through the middle, and only at 12 does it
 * get its crown and its banner.
 *
 * A lot is a **button**, not an anchor. It used to jump to a card further down
 * the page, which meant every purchase cost the player a scroll down and a
 * scroll back up; now the lot opens the monument's own dialog over the field
 * (see Monuments.tsx), so the site is the only place the screen ever is.
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
 * ## One light, and everything obeys it
 *
 * The moon sits at the top right of the sky, which is why every right-hand wall
 * is the lit one, every left-hand wall is in shade, and every building throws
 * its shadow down and to the left along the grid's `+r` axis. That single
 * decision is what makes a pile of clipped rectangles read as a place — break
 * it in one piece and the whole field goes flat.
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

/** Lamp posts down the two roads — the only light source at ground level, and
 * what stops the crossroads from reading as an empty gap between the lots. */
const LAMPS: readonly { c: number; r: number }[] = [
  { c: 2, r: 2 },
  { c: 5, r: 2 },
  { c: 2, r: 5 },
  { c: 5, r: 5 },
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
  onOpen,
}: {
  monuments: readonly MonumentView[];
  /** Opens a monument's dialog. The scene shows state; it never changes it. */
  onOpen: (key: string) => void;
}) {
  const t = useT();
  const tiles = buildTiles(monuments);

  // A <nav>, not a labelled <div role="img">: the five lots are real controls,
  // and `role="img"` would have made the whole subtree presentational — leaving
  // five focusable elements inside a region assistive tech is told to treat as
  // a single picture.
  return (
    <nav className="vil-stage" aria-label={t("אתר הבנייה של הבירה")}>
      <span className="vil-sky" aria-hidden />
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

        {LAMPS.map((lamp) => (
          <span
            key={`l${lamp.c},${lamp.r}`}
            aria-hidden
            className="vil-lamp"
            style={{ "--c": lamp.c, "--r": lamp.r } as CSSProperties}
          >
            <i />
          </span>
        ))}

        {monuments.map((monument) => (
          <Lot key={monument.key} monument={monument} onOpen={onOpen} />
        ))}
      </div>
    </nav>
  );
}

/* --------------------------- one monument's lot --------------------------- */

function Lot({
  monument,
  onOpen,
}: {
  monument: MonumentView;
  onOpen: (key: string) => void;
}) {
  const t = useT();
  const level = monument.level;
  const done = level >= MONUMENT_MAX_LEVEL;
  const empty = level === 0;
  // Scaffolding stands for exactly as long as the thing is unfinished, which
  // here means "not at 12" — that is the whole visual grammar of the screen.
  const building = level > 0 && !done;
  // The pieces that only appear past a threshold. The plaque hangs off the top
  // of the silhouette, so it has to be told when they are there — the CSS
  // cannot see a conditionally-rendered child.
  const roofed = monument.shape === "tower" && level >= 5;
  const spired = monument.shape === "tower" && level >= 8;
  const lofted = monument.shape === "hall" && level >= 7;
  const crowned = monument.shape === "column" && level >= 10;

  const flags =
    (done ? " is-done" : "") +
    (roofed ? " is-roofed" : "") +
    (spired ? " is-spired" : "") +
    (lofted ? " is-lofted" : "") +
    (crowned ? " is-crowned" : "") +
    // "You can raise this right now" is the one piece of state the field says
    // out loud, because it is the only one that asks the player to act.
    (monument.affordable ? " is-ready" : "");

  return (
    <button
      type="button"
      onClick={() => onOpen(monument.key)}
      className={`vil-lot vil-${monument.shape}${flags}`}
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
      <span className="vil-plot" aria-hidden />
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
    </button>
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

/**
 * A hipped roof: four planes meeting at a point, of which the camera sees
 * exactly two, and those two tile the whole silhouette — so two triangles are
 * the entire roof. `--rw` is the eaves' width, `--rise` how far the apex sits
 * above them, `--ry` where the eaves land on the wall below.
 */
function Roof({ className }: { className: string }) {
  return (
    <span className={`vil-roof ${className}`}>
      <i className="vil-roof-r" />
      <i className="vil-roof-l" />
    </span>
  );
}

/** A column, a tower or a hall: a stepped base, the shaft, and a crown. */
function Block({
  shape,
  level,
}: {
  shape: "column" | "tower" | "hall";
  level: number;
}) {
  // The hall is roofed from its first level, so it needs its cornice from the
  // first level too. On the other two the cap is a crown, and below level 5 a
  // crown sits on the plinth and reads as a lid.
  const capped = shape === "hall" || level >= 5;

  return (
    <>
      <Box className="vil-step" />
      <Box className="vil-plinth" />
      {/* `vil-lit` is what puts windows on a wall — the column has none, being
          solid stone, and that is most of what tells it apart from the tower. */}
      <Box className={`vil-shaft${shape === "column" ? "" : " vil-lit"}`} />
      {shape === "column" && level >= 3 && <span className="vil-flutes" />}
      {capped && <Box className="vil-cap" />}
      {shape === "tower" && level >= 4 && <span className="vil-clock" />}
      {shape === "hall" && <Roof className="vil-roof-hall" />}
      {/* The lantern goes on *after* the main roof: it replaces its tip. */}
      {shape === "hall" && level >= 7 && (
        <>
          <Box className="vil-loft" />
          <Roof className="vil-roof-loft" />
        </>
      )}
      {shape === "tower" && level >= 5 && <Roof className="vil-roof-tower" />}
      {shape === "tower" && level >= 8 && <span className="vil-spire" />}
      {shape === "column" && level >= 10 && (
        <span className="vil-statue">
          <i />
          <i />
        </span>
      )}
    </>
  );
}

/** The victory gate: two piers, the passage between them, and the lintel. */
function Gate({ level }: { level: number }) {
  return (
    <>
      <Box className="vil-gate-base" />
      {/* Far pier first, then what stands between them, then the near pier:
          DOM order is the depth sort inside a lot. */}
      <Box className="vil-pier vil-pier-a" />
      {level >= 2 && <span className="vil-arch" />}
      <Box className="vil-pier vil-pier-b" />
      {/* Nothing spans the piers until they are tall enough to be spanned. */}
      {level >= 3 && <Box className="vil-lintel" />}
      {level >= 6 && <span className="vil-keystone" />}
      {level >= 9 && <span className="vil-banner" />}
    </>
  );
}

/** The sky wheel: a pedestal, and the ring that turns on it. */
function Wheel({ level }: { level: number }) {
  return (
    <>
      <Box className="vil-step" />
      <Box className="vil-plinth" />
      <Box className="vil-shaft" />
      {level >= 2 && (
        <span className="vil-ring">
          <span className="vil-ring-spin">
            <i />
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
    </>
  );
}
