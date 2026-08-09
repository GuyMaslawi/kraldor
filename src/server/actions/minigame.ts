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
  DIG_BAND_LABEL,
  RIDDLE_ANSWER_MAX,
  HISTORY_LIMIT,
  MAX_LIVE_MINIGAMES,
  PRIZE_FIELDS,
  type MiniGameState,
  type MiniGameBoardRow,
  type MiniGameGuessResult,
  type MiniGameHistoryRow,
} from "@/lib/game/minigame";

/** How many rival rows the live board carries (the viewer is always included). */
const BOARD_LIMIT = 50;

type Board = { rows: MiniGameBoardRow[]; players: number };

const EMPTY_BOARD: Board = { rows: [], players: 0 };

/** The viewer's own entry in one event — what the board needs to pin their row. */
type OwnEntry = { attempts: number; solved: boolean; won: boolean };

async function ownEmpireId(): Promise<string | null> {
  // Enforces the ban on every action (not just page loads); see getActiveEmpireId.
  return getActiveEmpireId();
}

function toState(
  event: MiniGameEvent,
  entry: { attempts: number; solved: boolean; won: boolean; guesses?: unknown } | null,
  t: T,
  board: Board = EMPTY_BOARD
): MiniGameState {
  const attempts = entry?.attempts ?? 0;
  const solved = entry?.solved ?? false;
  const pub = publicConfig(event);
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
    maxAttempts: event.maxAttempts,
    solved,
    won: entry?.won ?? false,
    finished: solved || attempts >= event.maxAttempts,
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
  eventIds: string[],
  selfEmpireId: string,
  own: Map<string, OwnEntry>,
  t: T
): Promise<Map<string, Board>> {
  if (eventIds.length === 0) return new Map();

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
          select: { empireId: true, attempts: true, solved: true, won: true },
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
  eventId: string,
  selfEmpireId: string,
  own: OwnEntry | null,
  t: T
): Promise<Board> {
  const boards = await loadBoards(
    [eventId],
    selfEmpireId,
    own ? new Map([[eventId, own]]) : new Map(),
    t
  );
  return boards.get(eventId) ?? EMPTY_BOARD;
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
      select: { eventId: true, attempts: true, solved: true, won: true, guesses: true },
    });
    const mine = new Map(entries.map((e) => [e.eventId, e]));
    const boards = await loadBoards(
      events.map((e) => e.id),
      empireId,
      mine,
      t
    );

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
      const attemptClaim = await tx.miniGameEntry.updateMany({
        where: { id: entry.id, solved: false, attempts: { lt: event.maxAttempts } },
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
        const finished = attempts >= event.maxAttempts;
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
      const board = await loadBoard(result.state.id, empireId, result.state, t);
      return { ...result, state: { ...result.state, board: board.rows, players: board.players } };
    }
    return result;
  } catch {
    return { state: null, feedback: t("אירעה שגיאה, נסה שוב"), tone: "error" };
  }
}
