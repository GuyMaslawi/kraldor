"use server";

import { revalidatePath } from "next/cache";
import type { MiniGameEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { POLL_LIMIT, POLL_WINDOW_MS, localRateLimit } from "@/lib/rateLimit";
import { grantCitizens } from "@/lib/game/grants";
import { awardSeasonPassXp } from "../seasonPassXp";
import { getT, type T } from "@/i18n/server";
import {
  prizeText,
  publicConfig,
  parseHistory,
  scoreCode,
  digBand,
  riddleSolved,
  eventCost,
  eventExtraCost,
  costText,
  costResourceLabel,
  DIG_BAND_LABEL,
  RIDDLE_ANSWER_MAX,
  HISTORY_LIMIT,
  MAX_LIVE_MINIGAMES,
  PRIZE_FIELDS,
  type MiniGameState,
  type MiniGameBoardRow,
  type MiniGameCostResource,
  type MiniGameGuessResult,
  type MiniGameHistoryRow,
} from "@/lib/game/minigame";

/** How many rival rows the live board carries (the viewer is always included). */
const BOARD_LIMIT = 50;

type Board = { rows: MiniGameBoardRow[]; players: number };

const EMPTY_BOARD: Board = { rows: [], players: 0 };

/** The viewer's own entry in one event — what the board needs to pin their row. */
type OwnEntry = { attempts: number; solved: boolean; won: boolean; extraAttempts: number };

async function ownEmpireId(): Promise<string | null> {
  // Enforces the ban on every action (not just page loads); see getActiveEmpireId.
  return getActiveEmpireId();
}

function toState(
  event: MiniGameEvent,
  entry: {
    attempts: number;
    solved: boolean;
    won: boolean;
    paid?: boolean;
    extraAttempts?: number;
    guesses?: unknown;
  } | null,
  t: T,
  board: Board = EMPTY_BOARD
): MiniGameState {
  const attempts = entry?.attempts ?? 0;
  const solved = entry?.solved ?? false;
  const pub = publicConfig(event);
  const cost = eventCost(event);
  const extraCost = eventExtraCost(event);
  const extras = entry?.extraAttempts ?? 0;
  // The viewer's own ceiling — the base budget plus every extra they bought.
  const maxAttempts = event.maxAttempts + extras;
  return {
    id: event.id,
    type: event.type,
    title: event.title,
    prizeText: prizeText(t, event),
    cups: pub.cups,
    digits: pub.digits,
    size: pub.size,
    question: pub.question,
    history: parseHistory(entry?.guesses),
    attempts,
    maxAttempts,
    baseAttempts: event.maxAttempts,
    cost,
    paid: cost === null || (entry?.paid ?? false),
    extraCost,
    extrasLeft: extraCost ? Math.max(0, event.maxExtraAttempts - extras) : 0,
    solved,
    won: entry?.won ?? false,
    finished: solved || attempts >= maxAttempts,
    prizesLeft: event.maxWinners === 0 || event.winnersCount < event.maxWinners,
    winnersCount: event.winnersCount,
    maxWinners: event.maxWinners,
    endsAt: event.endsAt?.getTime() ?? null,
    serverNow: Date.now(),
    board: board.rows,
    players: board.players,
  };
}

/** A timed release is over once its deadline passes, flag or no flag. */
function isExpired(event: { endsAt: Date | null }, now = Date.now()): boolean {
  return event.endsAt != null && event.endsAt.getTime() <= now;
}

/**
 * Every event a player may currently interact with, oldest release first.
 *
 * More than one can be live at a time (see MAX_LIVE_MINIGAMES), and the order is
 * the order they were released in *on purpose*: it is what the command bar hangs
 * the pills off, so releasing a second game appends a chip beside the first
 * instead of reshuffling the row under a player mid-guess.
 *
 * `isActive` alone is not the gate: a timed release expires on the wall clock,
 * and nothing runs on a schedule here — so the first read after the deadline is
 * what flips the flag (guarded, so concurrent readers don't double-write).
 */
async function loadLiveEvents(): Promise<MiniGameEvent[]> {
  const events = await prisma.miniGameEvent.findMany({
    where: { isActive: true },
    orderBy: { activatedAt: "asc" },
    // Activation already enforces the ceiling; this is the belt to that pair of
    // braces, so a row of stale flags can never turn one poll into N board reads.
    take: MAX_LIVE_MINIGAMES,
  });
  const now = Date.now();
  const expired = events.filter((e) => isExpired(e, now));
  if (expired.length > 0) {
    await prisma.miniGameEvent.updateMany({
      where: { id: { in: expired.map((e) => e.id) }, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });
  }
  return events.filter((e) => !isExpired(e, now));
}

/**
 * Public progress of everyone playing each live event. This is what a
 * knocked-out player keeps watching until the event ends, so it deliberately
 * exposes only attempt counts and win state — never a guess, never the answer.
 *
 * Batched across events rather than a call per event: this runs on every poll,
 * on every screen, for every player, so the per-event cost has to be one query,
 * not four. The participant counts come back in a single `groupBy` and the
 * names in a single lookup over the union of the boards; `own` is passed in by
 * the caller (which already read it) rather than re-fetched per event.
 */
async function loadBoards(
  events: { id: string; maxAttempts: number }[],
  selfEmpireId: string,
  own: Map<string, OwnEntry>,
  t: T
): Promise<Map<string, Board>> {
  if (events.length === 0) return new Map();
  const eventIds = events.map((e) => e.id);
  // Each row's attempt ceiling is the event's base budget plus ITS OWN bought
  // extras — a rival who paid for two more must read 5/5, not 5/3.
  const baseAttempts = new Map(events.map((e) => [e.id, e.maxAttempts]));

  const [perEvent, counts] = await Promise.all([
    Promise.all(
      eventIds.map((eventId) =>
        prisma.miniGameEntry.findMany({
          where: { eventId },
          orderBy: [
            { won: "desc" },
            { wonAt: "asc" },
            { solved: "desc" },
            { attempts: "desc" },
            { updatedAt: "asc" },
          ],
          take: BOARD_LIMIT,
          select: {
            empireId: true,
            attempts: true,
            solved: true,
            won: true,
            extraAttempts: true,
          },
        })
      )
    ),
    prisma.miniGameEntry.groupBy({
      by: ["eventId"],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
    }),
  ]);

  const players = new Map(counts.map((c) => [c.eventId, c._count._all]));

  // The viewer's own row always rides along, even past the cap — the board is
  // there so a knocked-out player can follow the race they're still in.
  const lists = perEvent.map((rows, i) => {
    const mine = own.get(eventIds[i]);
    if (mine && rows.length && !rows.some((r) => r.empireId === selfEmpireId)) {
      return [...rows, { empireId: selfEmpireId, ...mine }];
    }
    return rows;
  });

  const empires = await prisma.empire.findMany({
    where: { id: { in: [...new Set(lists.flat().map((r) => r.empireId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(empires.map((e) => [e.id, e.name]));

  return new Map(
    lists.map((rows, i) => [
      eventIds[i],
      {
        players: players.get(eventIds[i]) ?? rows.length,
        rows: rows.map((e) => ({
          empireId: e.empireId,
          name: names.get(e.empireId) ?? t("אימפריה אלמונית"),
          attempts: e.attempts,
          maxAttempts: (baseAttempts.get(eventIds[i]) ?? 0) + e.extraAttempts,
          solved: e.solved,
          won: e.won,
          isSelf: e.empireId === selfEmpireId,
        })),
      },
    ])
  );
}

/** One event's board — the single-event door into `loadBoards`. */
async function loadBoard(
  event: { id: string; maxAttempts: number },
  selfEmpireId: string,
  own: OwnEntry | null,
  t: T
): Promise<Board> {
  const boards = await loadBoards(
    [event],
    selfEmpireId,
    own ? new Map([[event.id, own]]) : new Map(),
    t
  );
  return boards.get(event.id) ?? EMPTY_BOARD;
}

/** Rebuild one event's board from a just-computed state — the actions' way out. */
async function refreshBoard(
  state: MiniGameState,
  empireId: string,
  t: T
): Promise<Board> {
  return loadBoard(
    { id: state.id, maxAttempts: state.baseAttempts },
    empireId,
    {
      attempts: state.attempts,
      solved: state.solved,
      won: state.won,
      extraAttempts: state.maxAttempts - state.baseAttempts,
    },
    t
  );
}

/**
 * Live per-player state of every running mini-game, oldest release first.
 * Best-effort — polled by the command-bar pills and also read once server-side
 * by the game layout.
 */
export async function getMiniGameStates(): Promise<MiniGameState[]> {
  try {
    const t = await getT();
    const empireId = await ownEmpireId();
    if (!empireId) return [];
    const events = await loadLiveEvents();
    if (events.length === 0) return [];

    // One read for the viewer's own entries across every live event: the state
    // needs the attempt log, and the boards need the row to pin.
    const entries = await prisma.miniGameEntry.findMany({
      where: { eventId: { in: events.map((e) => e.id) }, empireId },
      select: {
        eventId: true,
        attempts: true,
        solved: true,
        won: true,
        paid: true,
        extraAttempts: true,
        guesses: true,
      },
    });
    const mine = new Map(entries.map((e) => [e.eventId, e]));
    const boards = await loadBoards(events, empireId, mine, t);

    return events.map((e) =>
      toState(e, mine.get(e.id) ?? null, t, boards.get(e.id) ?? EMPTY_BOARD)
    );
  } catch {
    return [];
  }
}

/** What the pills' poll gets back. Mirrors `pollBossArena`'s shape. */
export interface MiniGamePoll {
  /** Every running release. An empty array means nothing is live. */
  states?: MiniGameState[];
  /** Nothing was learned this round; ask again, change nothing. */
  retry?: boolean;
}

/**
 * The pills' polled read — `getMiniGameStates` with a ceiling on it.
 *
 * The pills are mounted in the game layout, so this runs on every screen for
 * every signed-in player. Same free in-process counter the chat panes and the
 * boss arena use, for the same reason: nothing here is secret, so the ceiling is
 * not a security boundary — it stops a looping client turning a layout-level
 * poll into unbounded database load (this one reads the rival boards, so a round
 * costs several queries, not one).
 *
 * A refused round is `retry`, never an empty list: the poller must not read a
 * throttled answer as "the events ended" and pull a live game off the screen.
 * The layout's server-side render calls `getMiniGameStates` directly and is
 * deliberately not counted here.
 */
export async function pollMiniGame(): Promise<MiniGamePoll> {
  const empireId = await ownEmpireId();
  if (!empireId) return { retry: true };
  if (!localRateLimit(`poll:minigame:${empireId}`, POLL_LIMIT, POLL_WINDOW_MS)) {
    return { retry: true };
  }
  return { states: await getMiniGameStates() };
}

/** Build the {field: {increment}} prize map for a winning empire update. */
function prizeIncrements(event: MiniGameEvent): Prisma.EmpireUpdateInput {
  const inc: Prisma.EmpireUpdateInput = {};
  const map: Record<string, keyof Prisma.EmpireUpdateInput> = {
    prizeGold: "gold",
    prizeWood: "wood",
    prizeIron: "iron",
    prizeStone: "stone",
    prizeDiamonds: "diamonds",
    prizeCitizens: "citizens",
    prizeTurns: "turns",
    prizeWheelSpins: "wheelSpins",
  };
  for (const f of PRIZE_FIELDS) {
    const amount = Number(event[f.key] ?? 0);
    if (amount > 0) {
      const value = f.int ? Math.round(amount) : amount;
      (inc as Record<string, unknown>)[map[f.key]] = { increment: value };
    }
  }
  return inc;
}

/** The three code marks, for the one-line result summary. */
// i18n-keys: read through t(MARK_WORD[m]) where the tally is drawn
const MARK_WORD = { hit: "במקום", near: "בקוד", miss: "בחוץ" } as const;

/**
 * Submit one guess to a running mini-game — a cup index for FIND_BALL, a digit
 * string for CRACK_SAFE. Records the attempt, checks the secret answer, and —
 * on a correct first solve — atomically claims a prize slot (respecting
 * maxWinners) and grants the bundle.
 *
 * The event is named by the caller (`eventId`), because several releases can be
 * live at once: resolving it here from "whatever is active" would score a guess
 * against a game the player was never shown the moment a second one goes up.
 */
export async function submitMiniGameGuess(
  _prev: MiniGameGuessResult,
  formData: FormData
): Promise<MiniGameGuessResult> {
  const t = await getT();
  try {
    const empireId = await ownEmpireId();
    if (!empireId) return { state: null, feedback: t("לא מחובר"), tone: "error" };

    const raw = formData.get("guess");
    if (typeof raw !== "string") {
      return { state: null, feedback: t("בחר ניחוש תקין"), tone: "error" };
    }
    const guess = raw.trim();
    const rawEvent = formData.get("eventId");
    const eventId = typeof rawEvent === "string" && rawEvent ? rawEvent : null;

    const result = await prisma.$transaction(async (tx) => {
      // A named event is looked up by id and still has to be live; without one
      // (a tab that loaded before releases could overlap) fall back to the
      // newest release, which is what such a client was showing.
      const event = eventId
        ? await tx.miniGameEvent.findFirst({ where: { id: eventId, isActive: true } })
        : await tx.miniGameEvent.findFirst({
            where: { isActive: true },
            orderBy: { activatedAt: "desc" },
          });
      // A timed release stops accepting guesses the moment its deadline passes,
      // even if no read has flipped `isActive` yet (see loadLiveEvent).
      if (!event || isExpired(event)) {
        return { state: null, feedback: t("המשחק הסתיים"), tone: "info" as const };
      }
      const cfg = (event.config ?? {}) as Record<string, unknown>;
      const pub = publicConfig(event);

      // Reject a guess outside the event's own shape *before* claiming an
      // attempt slot. A malformed submission can never match the answer, so
      // letting it through would only silently burn one of the player's
      // limited attempts.
      const code = typeof cfg.code === "string" ? cfg.code : "";
      const cups = pub.cups ?? 0;
      const size = pub.size ?? 0;
      const word = typeof cfg.word === "string" ? cfg.word : "";
      const valid =
        event.type === "CRACK_SAFE"
          ? code.length > 0 &&
            guess.length === code.length &&
            /^[0-9]+$/.test(guess)
          : event.type === "TREASURE_MAP"
            ? // A cell index inside the grid. Two digits is enough for the 7×7
              // ceiling (48), and bounding the string before the number keeps a
              // 40-digit submission from ever reaching Number().
              size > 0 && /^[0-9]{1,2}$/.test(guess) && Number(guess) < size * size
            : event.type === "RIDDLE"
              ? // Length only. The *content* cannot be validated without the
                // answer, and rejecting a wrong answer here rather than scoring
                // it would tell the player they had typed something impossible
                // — and would hand back the attempt they should have spent.
                word.length > 0 && guess.length > 0 && guess.length <= RIDDLE_ANSWER_MAX
              : /^[0-9]{1,2}$/.test(guess) && Number(guess) < cups;
      if (!valid) {
        return { state: null, feedback: t("בחר ניחוש תקין"), tone: "error" as const };
      }

      // Staff may watch a release but never enter it: the board is a race for a
      // real prize, and an account that can be gifted the diamonds anyway has no
      // business on it. Refusing the entry is also what keeps them off the
      // board — `loadBoards` ranks MiniGameEntry rows, so an empire that never
      // gets one can never appear there. See src/lib/staff.ts.
      const player = await tx.empire.findUnique({
        where: { id: empireId },
        select: { isStaff: true },
      });
      if (!player || player.isStaff) {
        return {
          state: null,
          feedback: t("חשבון הנהלה אינו משתתף במשחקי הצד"),
          tone: "info" as const,
        };
      }

      const entry = await tx.miniGameEntry.upsert({
        where: { eventId_empireId: { eventId: event.id, empireId } },
        create: { eventId: event.id, empireId },
        update: {},
      });

      // A game with an entry fee takes no guesses until the fee is paid — the
      // client gates this too, but the server is the wall. Checked after the
      // upsert on purpose: the unpaid row is what payMiniGameEntry flips, and
      // it costs the player nothing.
      if (eventCost(event) !== null && !entry.paid) {
        return {
          state: toState(event, entry, t),
          feedback: t("יש לשלם את דמי ההשתתפות קודם"),
          tone: "error" as const,
        };
      }

      if (entry.solved) {
        return {
          state: toState(event, entry, t),
          feedback: t("כבר פתרת את המשחק 🎉"),
          tone: "info" as const,
        };
      }

      // Atomically claim one attempt slot. The `entry.attempts` read above is
      // not a safe gate on its own: without a row lock, N parallel guesses all
      // read attempts=0, all pass a check-then-act limit, and the one holding
      // the answer reaches the solve branch — bypassing maxAttempts entirely
      // (solve any mini-game on demand and drain the prize). This guarded
      // updateMany serializes the spend on the entry row, so at most
      // maxAttempts submissions ever proceed past here.
      //
      // The ceiling includes the extras this entry has bought. Read from the
      // pre-claim row, which can only UNDERcount — extraAttempts only grows,
      // so a purchase racing this guess is at worst not spendable this round.
      const attemptClaim = await tx.miniGameEntry.updateMany({
        where: {
          id: entry.id,
          solved: false,
          attempts: { lt: event.maxAttempts + entry.extraAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      if (attemptClaim.count === 0) {
        const current = await tx.miniGameEntry.findUniqueOrThrow({
          where: { id: entry.id },
        });
        return {
          state: toState(event, current, t),
          feedback: current.solved
            ? t("כבר פתרת את המשחק 🎉")
            : t("נגמרו הניסיונות"),
          tone: current.solved ? ("info" as const) : ("lose" as const),
        };
      }

      // We hold an attempt slot. Re-read the row rather than trusting the copy
      // from before the claim: the guarded updateMany above took the row lock,
      // so this reads *our* increment plus whatever history a guess that raced
      // us already committed. Appending to the pre-claim copy would drop it.
      const locked = await tx.miniGameEntry.findUniqueOrThrow({ where: { id: entry.id } });
      const attempts = locked.attempts;

      // Score the attempt and write the row the player will reason over. The
      // safe's marks ARE the game — a code attempt with no marks tells the
      // player nothing — so they are computed server-side, from the secret, and
      // the client only ever renders them.
      let correct: boolean;
      let row: MiniGameHistoryRow;
      let feedback: string;
      if (event.type === "CRACK_SAFE") {
        const marks = scoreCode(guess, code);
        correct = marks.every((m) => m === "hit");
        row = { kind: "code", code: guess, marks };
        const tally = { hit: 0, near: 0, miss: 0 };
        for (const m of marks) tally[m]++;
        feedback = correct
          ? ""
          : t("🔐 {marks}", {
              marks: (["hit", "near", "miss"] as const)
                .filter((m) => tally[m] > 0)
                .map((m) =>
                  t("{count} {mark}", { count: tally[m], mark: t(MARK_WORD[m]) })
                )
                .join(" · "),
            });
      } else if (event.type === "TREASURE_MAP") {
        // The band is the whole game, and it is computed here, from the secret,
        // for the same reason the safe's marks are: a dig with no reading tells
        // the player nothing, and a client that could compute it would have to
        // have been handed the answer.
        const pick = Number(guess);
        const answer = Number(cfg.answer);
        const band = digBand(pick, answer, size);
        correct = band === "found";
        row = { kind: "dig", pick, band };
        feedback = correct ? "" : t("🗺️ {band}", { band: t(DIG_BAND_LABEL[band]) });
      } else if (event.type === "RIDDLE") {
        correct = riddleSolved(guess, word);
        row = { kind: "word", word: guess, hit: correct };
        feedback = t("❓ לא זו התשובה…");
      } else {
        correct = Number(guess) === Number(cfg.answer);
        row = { kind: "cup", pick: Number(guess), hit: correct };
        feedback = t("🫙 הכוס ריקה…");
      }
      const history = [...parseHistory(locked.guesses), row].slice(-HISTORY_LIMIT);

      if (!correct) {
        const finished = attempts >= event.maxAttempts + locked.extraAttempts;
        const updated = await tx.miniGameEntry.update({
          where: { id: entry.id },
          data: { guesses: history },
        });
        return {
          state: toState(event, updated, t),
          feedback: finished ? t("😔 נגמרו הניסיונות — נסה בפעם הבאה") : feedback,
          tone: finished ? ("lose" as const) : ("hint" as const),
        };
      }

      // Correct! Claim *this player's* single solve atomically. Two concurrent
      // correct submissions both passed the attempt claim with solved=false;
      // this guarded updateMany takes the row lock and re-checks solved:false,
      // so only one flips the entry — the loser matches zero rows and skips the
      // prize. Without it the unlimited-winner (maxWinners===0) path, which has
      // no other atomic guard, would grant the prize twice.
      const solveClaim = await tx.miniGameEntry.updateMany({
        where: { id: entry.id, solved: false },
        data: { solved: true },
      });
      if (solveClaim.count === 0) {
        const current = await tx.miniGameEntry.findUniqueOrThrow({
          where: { id: entry.id },
        });
        return {
          state: toState(event, current, t),
          feedback: t("כבר פתרת את המשחק 🎉"),
          tone: "info" as const,
        };
      }

      // We own the solve — now claim a prize slot (respecting maxWinners).
      let won: boolean;
      if (event.maxWinners === 0) {
        await tx.miniGameEvent.update({
          where: { id: event.id },
          data: { winnersCount: { increment: 1 } },
        });
        won = true;
      } else {
        const claim = await tx.miniGameEvent.updateMany({
          where: { id: event.id, winnersCount: { lt: event.maxWinners } },
          data: { winnersCount: { increment: 1 } },
        });
        won = claim.count > 0;
      }

      const updatedEntry = await tx.miniGameEntry.update({
        where: { id: entry.id },
        data: {
          won,
          wonAt: won ? new Date() : null,
          guesses: history,
        },
      });

      if (won) {
        const inc = prizeIncrements(event);
        // Citizens are capped by city count, so they go through grantCitizens
        // instead of riding along in the bulk increment — a raw increment here
        // breached the ceiling the daily update enforces.
        const citizenPrize = Math.max(0, Math.round(Number(event.prizeCitizens ?? 0)));
        delete (inc as Record<string, unknown>).citizens;
        if (Object.keys(inc).length > 0) {
          await tx.empire.update({ where: { id: empireId }, data: inc });
        }
        await grantCitizens(tx, empireId, citizenPrize);
        await tx.message.create({
          data: {
            empireId,
            kind: "SYSTEM",
            // The winner is the player who just guessed, so `t` here is
            // already their language — unlike the mail an *action* sends to
            // somebody else (see the note in `attackEmpire`).
            title: t('🎉 ניצחת ב"{game}"!', { game: event.title }),
            body: t("כל הכבוד! זכית בפרס: {prize}", { prize: prizeText(t, event) }),
          },
        });
      }

      // Solving is once-per-event (guarded by the solve claim above), so this
      // pays pass XP exactly once whether or not a prize slot was left.
      await awardSeasonPassXp(tx, empireId, "miniGame");

      // Re-read the event so winnersCount/prizesLeft are fresh in the response.
      const freshEvent = (await tx.miniGameEvent.findUnique({ where: { id: event.id } }))!;
      return {
        state: toState(freshEvent, updatedEntry, t),
        feedback: won
          ? t("🎉 ניצחת! הפרס בדרך: {prize}", { prize: prizeText(t, event) })
          : t("✅ ניחשת נכון! אך כל הפרסים כבר חולקו"),
        tone: won ? ("win" as const) : ("info" as const),
      };
    });

    if (result.tone === "win") revalidatePath("/game", "layout");
    // Refresh the rival board on the way out so a player who just spent their
    // last attempt lands straight on the live standings instead of a stale copy.
    if (result.state) {
      const board = await refreshBoard(result.state, empireId, t);
      return { ...result, state: { ...result.state, board: board.rows, players: board.players } };
    }
    return result;
  } catch {
    return { state: null, feedback: t("אירעה שגיאה, נסה שוב"), tone: "error" };
  }
}

/* ------------------------------ paid entry ------------------------------ */

/**
 * Thrown inside a payment transaction when the guarded debit matched nothing —
 * the balance was short. Typed so the catch can tell "roll back and say so"
 * apart from a real failure.
 */
class InsufficientFunds extends Error {}

/**
 * Everything both purchase actions share before any money moves: the live
 * event, the staff refusal, and the player's entry row (created unpaid).
 * Returns a refusal result instead when the event is over or the account is
 * staff — the same walls submitMiniGameGuess puts up, for the same reasons.
 */
async function preparePurchase(
  tx: Prisma.TransactionClient,
  eventId: string,
  empireId: string,
  t: T
): Promise<
  | { refusal: MiniGameGuessResult }
  | {
      event: MiniGameEvent;
      entry: { id: string; paid: boolean; solved: boolean; extraAttempts: number };
    }
> {
  const event = await tx.miniGameEvent.findFirst({
    where: { id: eventId, isActive: true },
  });
  if (!event || isExpired(event)) {
    return {
      refusal: { state: null, feedback: t("המשחק הסתיים"), tone: "info" },
    };
  }
  const player = await tx.empire.findUnique({
    where: { id: empireId },
    select: { isStaff: true },
  });
  if (!player || player.isStaff) {
    return {
      refusal: {
        state: null,
        feedback: t("חשבון הנהלה אינו משתתף במשחקי הצד"),
        tone: "info",
      },
    };
  }
  const entry = await tx.miniGameEntry.upsert({
    where: { eventId_empireId: { eventId: event.id, empireId } },
    create: { eventId: event.id, empireId },
    update: {},
  });
  return { event, entry };
}

/**
 * Debit the entry fee / extra-attempt price from the paying balance.
 *
 * The guarded updateMany IS the balance check (the resource-spend convention:
 * a plain decrement after a read is a TOCTOU hole — two purchases both read a
 * sufficient balance and drive it negative). Zero rows matched means the money
 * was not there; the thrown error rolls the whole transaction back, taking the
 * paid flag / extras increment with it.
 */
async function debitOrThrow(
  tx: Prisma.TransactionClient,
  empireId: string,
  resource: MiniGameCostResource,
  amount: number
): Promise<void> {
  // The key is one of five known Float columns on Empire (see
  // MINIGAME_COST_RESOURCES); the casts are only because the column is picked
  // at runtime, which Prisma's generated input types cannot express.
  const debit = await tx.empire.updateMany({
    where: { id: empireId, [resource]: { gte: amount } } as Prisma.EmpireWhereInput,
    data: { [resource]: { decrement: amount } } as Prisma.EmpireUpdateManyMutationInput,
  });
  if (debit.count === 0) throw new InsufficientFunds();
}

/**
 * Pay a running mini-game's entry fee, unlocking its base attempt budget.
 *
 * The paid flip happens BEFORE the debit, both inside one transaction: the
 * guarded flip takes the entry row's lock, so of two concurrent payments only
 * one reaches the debit — the other sees paid already true and pays nothing.
 * A short balance throws, rolling the flip back with the money untouched.
 */
export async function payMiniGameEntry(eventId: string): Promise<MiniGameGuessResult> {
  const t = await getT();
  try {
    const empireId = await ownEmpireId();
    if (!empireId) return { state: null, feedback: t("לא מחובר"), tone: "error" };

    const result = await prisma.$transaction(async (tx) => {
      const prep = await preparePurchase(tx, eventId, empireId, t);
      if ("refusal" in prep) return prep.refusal;
      const { event, entry } = prep;

      const cost = eventCost(event);
      if (cost === null || entry.paid) {
        const current = await tx.miniGameEntry.findUniqueOrThrow({ where: { id: entry.id } });
        return {
          state: toState(event, current, t),
          feedback: cost === null ? t("המשחק הזה חינם — פשוט שחק") : t("כבר שילמת — המשחק פתוח"),
          tone: "info" as const,
        };
      }

      const claim = await tx.miniGameEntry.updateMany({
        where: { id: entry.id, paid: false },
        data: { paid: true },
      });
      if (claim.count === 0) {
        const current = await tx.miniGameEntry.findUniqueOrThrow({ where: { id: entry.id } });
        return {
          state: toState(event, current, t),
          feedback: t("כבר שילמת — המשחק פתוח"),
          tone: "info" as const,
        };
      }

      await debitOrThrow(tx, empireId, cost.resource, cost.amount);

      const current = await tx.miniGameEntry.findUniqueOrThrow({ where: { id: entry.id } });
      return {
        state: toState(event, current, t),
        feedback: t("🎟️ שולם {cost} — {count} הניסיונות שלך נפתחו!", {
          cost: costText(t, cost.resource, cost.amount),
          count: event.maxAttempts,
        }),
        tone: "info" as const,
      };
    });

    if (result.state) {
      const board = await refreshBoard(result.state, empireId, t);
      return { ...result, state: { ...result.state, board: board.rows, players: board.players } };
    }
    return result;
  } catch (e) {
    if (e instanceof InsufficientFunds) {
      const event = await prisma.miniGameEvent.findUnique({ where: { id: eventId } });
      const cost = event ? eventCost(event) : null;
      return {
        state: null,
        feedback: cost
          ? t("אין מספיק {resource}", { resource: t(costResourceLabel(cost.resource)) })
          : t("אין מספיק משאבים זמינים לקנייה."),
        tone: "error",
      };
    }
    return { state: null, feedback: t("אירעה שגיאה, נסה שוב"), tone: "error" };
  }
}

/**
 * Buy ONE extra attempt past the base budget, up to the event's per-player cap.
 *
 * Same shape as the entry payment: the guarded increment (solved:false, under
 * the cap, and — when the event charges entry — paid:true) serializes on the
 * entry row, so N concurrent buys can never exceed maxExtraAttempts; the
 * debit's failure rolls the increment back.
 */
export async function buyMiniGameAttempt(eventId: string): Promise<MiniGameGuessResult> {
  const t = await getT();
  try {
    const empireId = await ownEmpireId();
    if (!empireId) return { state: null, feedback: t("לא מחובר"), tone: "error" };

    const result = await prisma.$transaction(async (tx) => {
      const prep = await preparePurchase(tx, eventId, empireId, t);
      if ("refusal" in prep) return prep.refusal;
      const { event, entry } = prep;

      const extra = eventExtraCost(event);
      if (extra === null) {
        const current = await tx.miniGameEntry.findUniqueOrThrow({ where: { id: entry.id } });
        return {
          state: toState(event, current, t),
          feedback: t("במשחק הזה אין ניסיונות נוספים למכירה"),
          tone: "info" as const,
        };
      }

      const claim = await tx.miniGameEntry.updateMany({
        where: {
          id: entry.id,
          solved: false,
          extraAttempts: { lt: event.maxExtraAttempts },
          ...(eventCost(event) !== null ? { paid: true } : {}),
        },
        data: { extraAttempts: { increment: 1 } },
      });
      if (claim.count === 0) {
        const current = await tx.miniGameEntry.findUniqueOrThrow({ where: { id: entry.id } });
        return {
          state: toState(event, current, t),
          feedback: current.solved
            ? t("כבר פתרת את המשחק 🎉")
            : !current.paid && eventCost(event) !== null
              ? t("יש לשלם את דמי ההשתתפות קודם")
              : t("קנית כבר את כל הניסיונות הנוספים"),
          tone: "info" as const,
        };
      }

      await debitOrThrow(tx, empireId, extra.resource, extra.amount);

      const current = await tx.miniGameEntry.findUniqueOrThrow({ where: { id: entry.id } });
      return {
        state: toState(event, current, t),
        feedback: t("🎯 נוסף ניסיון תמורת {cost}", {
          cost: costText(t, extra.resource, extra.amount),
        }),
        tone: "info" as const,
      };
    });

    if (result.state) {
      const board = await refreshBoard(result.state, empireId, t);
      return { ...result, state: { ...result.state, board: board.rows, players: board.players } };
    }
    return result;
  } catch (e) {
    if (e instanceof InsufficientFunds) {
      const event = await prisma.miniGameEvent.findUnique({ where: { id: eventId } });
      const extra = event ? eventExtraCost(event) : null;
      return {
        state: null,
        feedback: extra
          ? t("אין מספיק {resource}", { resource: t(costResourceLabel(extra.resource)) })
          : t("אין מספיק משאבים זמינים לקנייה."),
        tone: "error",
      };
    }
    return { state: null, feedback: t("אירעה שגיאה, נסה שוב"), tone: "error" };
  }
}
