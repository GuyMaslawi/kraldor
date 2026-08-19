// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { MiniGameEvent, MiniGameType } from "@prisma/client";
import type { T } from "@/i18n/translate";

/** Prize bundle fields on a MiniGameEvent, in display order. */
export const PRIZE_FIELDS = [
  { key: "prizeGold", label: "זהב", int: false },
  { key: "prizeWood", label: "עץ", int: false },
  { key: "prizeIron", label: "ברזל", int: false },
  { key: "prizeStone", label: "אבן", int: false },
  { key: "prizeDiamonds", label: "יהלומים", int: false },
  { key: "prizeCitizens", label: "אזרחים", int: true },
  { key: "prizeTurns", label: "תורות", int: true },
  { key: "prizeWheelSpins", label: "סיבובים", int: true },
] as const satisfies ReadonlyArray<{
  key: keyof MiniGameEvent;
  label: string;
  int: boolean;
}>;

/**
 * Compact one-line prize summary, e.g. "1,000 זהב · 5 יהלומים".
 *
 * Named in words rather than icons on purpose: this string lands in inbox
 * bodies and toasts, where an emoji would be a second, off-set drawing of a
 * resource the rest of the UI renders from the shared icon set.
 */
export function prizeText(t: T, event: MiniGameEvent): string {
  const parts: string[] = [];
  for (const f of PRIZE_FIELDS) {
    const amount = Number(event[f.key] ?? 0);
    if (amount > 0) {
      parts.push(
        t("{amount} {resource}", {
          amount: Math.round(amount).toLocaleString("en-US"),
          resource: t(f.label),
        })
      );
    }
  }
  return parts.length ? parts.join(" · ") : t("כבוד בלבד");
}

/**
 * The balances an entry fee may be charged in. A deliberate subset of
 * RESOURCE_META: citizens and turns are *earned* quantities with their own
 * ceilings and grant paths, and a game that ate them would interact with every
 * system that pays them out.
 */
export const MINIGAME_COST_RESOURCES = [
  { key: "diamonds", label: "יהלומים" },
  { key: "gold", label: "זהב" },
  { key: "wood", label: "עץ" },
  { key: "iron", label: "ברזל" },
  { key: "stone", label: "אבן" },
] as const satisfies ReadonlyArray<{ key: string; label: string }>;

export type MiniGameCostResource = (typeof MINIGAME_COST_RESOURCES)[number]["key"];

export function isMiniGameCostResource(value: unknown): value is MiniGameCostResource {
  return (
    typeof value === "string" &&
    MINIGAME_COST_RESOURCES.some((r) => r.key === value)
  );
}

/** The word for a cost resource, e.g. "יהלומים". */
export function costResourceLabel(resource: MiniGameCostResource): string {
  return MINIGAME_COST_RESOURCES.find((r) => r.key === resource)!.label;
}

/** "200 יהלומים" — same voice as prizeText, and for the same inbox/toast reasons. */
export function costText(t: T, resource: MiniGameCostResource, amount: number): string {
  return t("{amount} {resource}", {
    amount: Math.round(amount).toLocaleString("en-US"),
    resource: t(costResourceLabel(resource)),
  });
}

/** The fields on a MiniGameEvent this feature reads — see the schema note. */
export interface MiniGameCostFields {
  costResource: string | null;
  costAmount: number;
  extraAttemptCost: number;
  maxExtraAttempts: number;
}

/**
 * The entry fee an event actually charges, or null for a free game.
 *
 * Null unless BOTH halves are sane — a resource with a zero amount is a free
 * game, and an amount with no resource has nothing to debit. Extras are read
 * separately (see `eventExtraCost`) because they are independent: an admin may
 * sell extra attempts on a game whose entry is free.
 */
export function eventCost(
  event: MiniGameCostFields
): { resource: MiniGameCostResource; amount: number } | null {
  if (!isMiniGameCostResource(event.costResource)) return null;
  const amount = Number(event.costAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { resource: event.costResource, amount };
}

/** The price of one extra attempt, or null when extras are not for sale. */
export function eventExtraCost(
  event: MiniGameCostFields
): { resource: MiniGameCostResource; amount: number } | null {
  if (!isMiniGameCostResource(event.costResource)) return null;
  const amount = Number(event.extraAttemptCost);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (Math.round(Number(event.maxExtraAttempts)) <= 0) return null;
  return { resource: event.costResource, amount };
}

export const MINIGAME_TYPE_META: Record<MiniGameType, { label: string; icon: string }> = {
  FIND_BALL: { label: "מצא את הכדור", icon: "🥤" },
  CRACK_SAFE: { label: "פריצת הכספת", icon: "🔐" },
  TREASURE_MAP: { label: "מפת האוצר", icon: "🗺️" },
  RIDDLE: { label: "חידה", icon: "❓" },
};

/**
 * How many releases may run at the same time.
 *
 * More than one is deliberate — an admin fielding a cups game and a safe at once
 * is two races with two prizes, and stopping the first to start the second used
 * to be the only option. The ceiling is what keeps that a choice rather than a
 * pile: every live release costs a pill in the command bar (they share one row,
 * and a phone's row is not wide) and a board read on every poll, on every screen,
 * for every player. Four is the most that still reads as a row of chips.
 */
export const MAX_LIVE_MINIGAMES = 4;

/**
 * Bounds on the two games' shapes, shared by the admin form and the server.
 *
 * Three cups is the floor because two is not a game — it is a coin toss with a
 * prize attached, and the row of cups on screen is meant to look like a choice.
 */
export const CUPS_MIN = 3;
export const CUPS_MAX = 6;
export const SAFE_DIGITS_MIN = 3;
export const SAFE_DIGITS_MAX = 5;

/**
 * The treasure map's grid, per side. Four is the floor for the same reason
 * three cups is: a 3×3 map is nine cells and the hot/cold banding has nowhere
 * to speak, so the deduction the game is *for* never happens. Seven is the
 * ceiling because a 49-cell grid still fits a phone at a readable tap size.
 */
export const MAP_SIZE_MIN = 4;
export const MAP_SIZE_MAX = 7;

/** Longest riddle answer the engine will store or compare. */
export const RIDDLE_ANSWER_MAX = 60;
/** Longest question an admin may set. */
export const RIDDLE_QUESTION_MAX = 240;

/** Hard floor/ceiling on the attempt budget, whatever the game. */
export const ATTEMPTS_MIN = 1;
export const ATTEMPTS_CEILING = 30;

/** The shape of a game — only the field its own type uses matters. */
export interface MiniGameShape {
  cups: number;
  digits: number;
  /**
   * Side of the treasure map's square grid. Optional so the two older games'
   * call sites — which have no notion of a grid — keep compiling unchanged;
   * `clampMapSize` supplies the floor for anything absent.
   */
  size?: number;
}

/**
 * The attempt budget a given game shape can carry: what the admin form offers,
 * and what the server clamps to.
 *
 * The interesting half is the cups. With N cups, N−1 attempts wins by
 * elimination — the last cup is free — so anything at or above that hands out
 * the prize to everyone who bothers to click, which is not a game and not a
 * prize. The ceiling is therefore N−2, and the default is a single shot: three
 * cups, one lift, one in three. An admin who wants a kinder game raises the cup
 * count, not the attempts.
 *
 * The safe is the opposite problem. Every attempt comes back marked (right
 * digit / right place), so attempts are the *information* the player reasons
 * from — with one shot a three-digit code is a 1-in-1000 blind guess. Five
 * attempts on three digits is the tuned starting point, and it scales with the
 * code length.
 */
export function attemptsRange(
  type: MiniGameType,
  shape: MiniGameShape
): { min: number; max: number; fallback: number } {
  if (type === "FIND_BALL") {
    const cups = clampCups(shape.cups);
    return { min: ATTEMPTS_MIN, max: Math.max(ATTEMPTS_MIN, cups - 2), fallback: 1 };
  }
  if (type === "TREASURE_MAP") {
    // Every dig comes back banded by distance, so attempts are information here
    // exactly as they are on the safe — but a grid is far larger than a code,
    // and a budget near the cell count would let a patient player sweep it. The
    // ceiling is a quarter of the map, and the default is one dig per side:
    // enough to triangulate, nowhere near enough to search.
    const size = clampMapSize(shape.size ?? MAP_SIZE_MIN);
    const cells = size * size;
    return {
      min: ATTEMPTS_MIN,
      max: Math.max(ATTEMPTS_MIN + 1, Math.floor(cells / 4)),
      fallback: size,
    };
  }
  if (type === "RIDDLE") {
    // A riddle has no partial credit — an answer is right or it is not — so
    // attempts buy nothing but retries. Three is generous enough to survive a
    // typo and mean enough that the guessing has to stop.
    return { min: ATTEMPTS_MIN, max: 5, fallback: 3 };
  }
  const digits = clampDigits(shape.digits);
  return { min: ATTEMPTS_MIN, max: ATTEMPTS_CEILING, fallback: digits * 2 - 1 };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

export function clampCups(value: number): number {
  return Number.isFinite(value) ? clamp(value, CUPS_MIN, CUPS_MAX) : CUPS_MIN;
}

export function clampDigits(value: number): number {
  return Number.isFinite(value) ? clamp(value, SAFE_DIGITS_MIN, SAFE_DIGITS_MAX) : SAFE_DIGITS_MIN;
}

export function clampMapSize(value: number): number {
  return Number.isFinite(value) ? clamp(value, MAP_SIZE_MIN, MAP_SIZE_MAX) : MAP_SIZE_MIN;
}

/** Clamp an admin-supplied attempt budget into what this shape can carry. */
export function clampAttempts(
  type: MiniGameType,
  shape: MiniGameShape,
  value: number
): number {
  const range = attemptsRange(type, shape);
  return Number.isFinite(value) ? clamp(value, range.min, range.max) : range.fallback;
}

/**
 * Clamp how many extra attempts one player may buy on top of `baseAttempts`.
 *
 * Bounded by the same ceiling as the budget itself — `attemptsRange` exists
 * because past a point the attempts ARE the answer (lift every cup, sweep the
 * map), and an attempt that was paid for is no less a giveaway than one that
 * was not. So base + extras can never exceed what the shape can carry: a
 * three-cup game (max 1) simply has no extras to sell.
 */
export function clampExtraAttempts(
  type: MiniGameType,
  shape: MiniGameShape,
  baseAttempts: number,
  value: number
): number {
  const range = attemptsRange(type, shape);
  const room = Math.max(0, range.max - baseAttempts);
  return Number.isFinite(value) ? clamp(value, 0, room) : 0;
}

/**
 * Public (answer-free) parameters a player is allowed to see.
 *
 * Every field here crosses to the browser, so the rule is absolute: the shape
 * of a game may be public, its answer may not. `question` is the one string
 * that ships — a riddle without its question is not a riddle — and it is the
 * admin's own text, never derived from the answer.
 */
export interface MiniGamePublicConfig {
  cups: number | null;
  digits: number | null;
  /** Side of the treasure map's grid. */
  size: number | null;
  /** The riddle's question. Never its answer. */
  question: string | null;
}

export function publicConfig(event: MiniGameEvent): MiniGamePublicConfig {
  const cfg = (event.config ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    cups: n(cfg.cups),
    digits: n(cfg.digits),
    size: n(cfg.size),
    question: typeof cfg.question === "string" ? cfg.question : null,
  };
}

/* ---------------------------- attempt history ---------------------------- */

/** How one digit of a submitted code scored against the secret one. */
export type SafeMark = "hit" | "near" | "miss";

/**
 * How close a dig landed. Bands rather than a raw distance, and that is the
 * whole design of the treasure map: a number would make the grid a
 * co-ordinate puzzle solvable with two digs and a pencil, while four bands
 * narrow the search without ever handing over the cell.
 *
 * Measured in Chebyshev distance (the larger of the row and column gaps),
 * because on a grid a diagonal neighbour is as close as an orthogonal one —
 * a player reasons in rings around a dig, not in city blocks.
 */
export type DigBand = "found" | "hot" | "warm" | "cold";

export const DIG_BANDS: readonly DigBand[] = ["found", "hot", "warm", "cold"];

export function isDigBand(value: unknown): value is DigBand {
  return typeof value === "string" && (DIG_BANDS as string[]).includes(value);
}

/** What each band is called when a dig comes back. */
export const DIG_BAND_LABEL: Record<DigBand, string> = {
  found: "כאן!",
  hot: "חם",
  warm: "פושר",
  cold: "קר",
};

/**
 * Band a dig by its distance from the buried cell.
 *
 * The thresholds are absolute rather than scaled to the grid, and deliberately
 * so: "hot means one cell away" is a rule a player can learn once and use on
 * every map, where a proportional band would mean something different on a 4×4
 * than on a 7×7 and could never be reasoned about.
 */
export function digBand(
  pick: number,
  answer: number,
  size: number
): DigBand {
  if (pick === answer) return "found";
  const dr = Math.abs(Math.floor(pick / size) - Math.floor(answer / size));
  const dc = Math.abs((pick % size) - (answer % size));
  const distance = Math.max(dr, dc);
  if (distance <= 1) return "hot";
  if (distance <= 2) return "warm";
  return "cold";
}

/* ---------------------------- riddles ---------------------------- */

/**
 * Normalise a riddle answer for comparison.
 *
 * A riddle is judged on what the player *meant*, not on their keyboard: case,
 * surrounding space, runs of space inside, Hebrew niqqud and the geresh/gershayim
 * that half of players type and half do not. Applied identically to the stored
 * answer and to the attempt, so the admin never has to guess which form to save.
 *
 * Deliberately no further cleverness — no stemming, no edit distance. A riddle
 * whose answer needs fuzzy matching is a badly written riddle, and a matcher
 * that accepts near-misses would eventually accept a wrong one.
 */
export function normalizeRiddleAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[\u05F3\u05F4'"`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("he");
}

/** Whether an attempt answers the riddle. */
export function riddleSolved(guess: string, answer: string): boolean {
  const wanted = normalizeRiddleAnswer(answer);
  return wanted.length > 0 && normalizeRiddleAnswer(guess) === wanted;
}

/**
 * One past attempt by the viewing player. Answer-free by construction: a cup row
 * says which cup *this player* lifted, a code row says what they typed and how
 * it scored — neither is enough to name the answer without playing for it.
 */
export type MiniGameHistoryRow =
  | { kind: "cup"; pick: number; hit: boolean }
  | { kind: "code"; code: string; marks: SafeMark[] }
  /** A dig on the treasure map: which cell, and how close it turned out to be. */
  | { kind: "dig"; pick: number; band: DigBand }
  /** An answer to a riddle: what was typed, and whether it was right. */
  | { kind: "word"; word: string; hit: boolean };

/** Most recent attempts kept per player — the safe's board never needs more. */
export const HISTORY_LIMIT = 12;

/** Read a stored `guesses` column back, dropping anything malformed. */
export function parseHistory(value: unknown): MiniGameHistoryRow[] {
  if (!Array.isArray(value)) return [];
  const rows: MiniGameHistoryRow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.kind === "cup" && typeof r.pick === "number" && Number.isInteger(r.pick)) {
      rows.push({ kind: "cup", pick: r.pick, hit: r.hit === true });
    } else if (r.kind === "code" && typeof r.code === "string" && Array.isArray(r.marks)) {
      const marks = r.marks.filter(
        (m): m is SafeMark => m === "hit" || m === "near" || m === "miss"
      );
      if (marks.length === r.marks.length) rows.push({ kind: "code", code: r.code, marks });
    } else if (
      r.kind === "dig" &&
      typeof r.pick === "number" &&
      Number.isInteger(r.pick) &&
      isDigBand(r.band)
    ) {
      rows.push({ kind: "dig", pick: r.pick, band: r.band });
    } else if (r.kind === "word" && typeof r.word === "string") {
      rows.push({ kind: "word", word: r.word, hit: r.hit === true });
    }
  }
  return rows.slice(-HISTORY_LIMIT);
}

/**
 * Score a submitted code against the secret one, Mastermind-style:
 * `hit` = right digit in the right slot, `near` = a digit that is in the code
 * but not here, `miss` = not in the code at all.
 *
 * Two passes, with consumption, because duplicates otherwise lie: against the
 * code `1 1 5`, the attempt `1 7 1` must score hit/miss/near — one of the two
 * typed `1`s is already spoken for by the exact match, so the other may only
 * claim the *second* `1`. A single pass that just asked `code.includes(digit)`
 * would call both of them near and tell the player there are more `1`s than
 * there are.
 */
export function scoreCode(guess: string, code: string): SafeMark[] {
  const marks: SafeMark[] = new Array(guess.length).fill("miss");
  // Digits of the code not already claimed by an exact match.
  const spare = new Map<string, number>();

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === code[i]) marks[i] = "hit";
    else spare.set(code[i], (spare.get(code[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === "hit") continue;
    const left = spare.get(guess[i]) ?? 0;
    if (left > 0) {
      marks[i] = "near";
      spare.set(guess[i], left - 1);
    }
  }
  return marks;
}

/**
 * One rival's public progress in the running event. A player who is out of
 * attempts keeps watching this board until the event itself ends, so it
 * carries no secrets — only how far everyone else got.
 */
export interface MiniGameBoardRow {
  empireId: string;
  name: string;
  attempts: number;
  /** THIS row's ceiling — base budget plus whatever extras they bought. */
  maxAttempts: number;
  solved: boolean;
  won: boolean;
  /** True for the viewer's own row, so it can be highlighted. */
  isSelf: boolean;
}

/** Live per-player state of the active mini-game (null = none active). */
export interface MiniGameState {
  id: string;
  type: MiniGameType;
  title: string;
  prizeText: string;
  cups: number | null;
  digits: number | null;
  /** Side of the treasure map's grid. */
  size: number | null;
  /** The riddle's question. Never its answer. */
  question: string | null;
  /** The viewer's own attempt log, oldest first. Never another player's. */
  history: MiniGameHistoryRow[];
  attempts: number;
  /** The VIEWER's ceiling: the base budget plus their own bought extras. */
  maxAttempts: number;
  /** The event's base budget — what an entry fee unlocks, before extras. */
  baseAttempts: number;
  /** The entry fee, or null for a free game. */
  cost: { resource: MiniGameCostResource; amount: number } | null;
  /** True once the viewer may play: no fee, or the fee was paid. */
  paid: boolean;
  /** Price of one extra attempt, or null when extras are not for sale. */
  extraCost: { resource: MiniGameCostResource; amount: number } | null;
  /** How many more extras the viewer may still buy. */
  extrasLeft: number;
  solved: boolean;
  won: boolean;
  /** No more moves for this player (solved or out of attempts). */
  finished: boolean;
  /** Whether prize slots remain (maxWinners not yet reached). */
  prizesLeft: boolean;
  winnersCount: number;
  maxWinners: number;
  /** Epoch ms this timed release expires at (null = until the admin stops it). */
  endsAt: number | null;
  /** Server clock when this snapshot was built — the countdown ticks from it,
   *  so a skewed client clock can't disagree with the server-side deadline. */
  serverNow: number;
  /** Everyone who has played this event, best progress first. */
  board: MiniGameBoardRow[];
  /** Total participants (the board itself is capped for size). */
  players: number;
}

/** Result of a single guess submission. */
export interface MiniGameGuessResult {
  state: MiniGameState | null;
  feedback: string;
  tone: "win" | "lose" | "hint" | "error" | "info";
}
