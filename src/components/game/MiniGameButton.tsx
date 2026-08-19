"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useScrollLock } from "@/components/ui/scrollLock";
import {
  buyMiniGameAttempt,
  payMiniGameEntry,
  pollMiniGame,
  submitMiniGameGuess,
} from "@/server/actions/minigame";
import {
  DIG_BAND_LABEL,
  MINIGAME_TYPE_META,
  RIDDLE_ANSWER_MAX,
  costText,
  type DigBand,
  type MiniGameBoardRow,
  type MiniGameHistoryRow,
  type MiniGameState,
  type SafeMark,
} from "@/lib/game/minigame";
import { Icon } from "@/components/ui/Icon";
import { CloseButton } from "@/components/ui/CloseButton";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { MiniGameTakeover } from "@/components/game/MiniGameTakeover";
import { useDir, useT } from "@/i18n/client";

/**
 * Two rates, because this panel lives in the game's layout — it is mounted on
 * every single `/game/*` screen, for every player, for as long as the tab is
 * open.
 *
 * At one flat 10s beat that cost six round trips a minute per open tab forever,
 * and the overwhelming majority of them asked a question with no answer: most of
 * the time no event is running, so each poll was a session verification and a
 * `loadLiveEvent()` that returned null. A hundred players idling on a page was
 * ~36k empty queries an hour.
 *
 * LIVE is the old beat and applies only while an event is actually on screen,
 * where the countdown and the rival board genuinely move. IDLE is the rest of
 * the time, when the only thing being waited for is an event to be announced —
 * and even that is belt-and-braces, since the layout renders the panel
 * server-side, so any navigation picks up a new event at once.
 */
const POLL_LIVE_MS = 10_000;
const POLL_IDLE_MS = 30_000;

type Feedback = { text: string; tone: string; eventId: string };

/** Time left on a timed release; fires `onExpire` once it runs out. */
function Countdown({
  endsAt,
  serverNow,
  onExpire,
}: {
  endsAt: number;
  serverNow: number;
  onExpire: () => void;
}) {
  // Counts down in SERVER time: the deadline is enforced server-side, so a
  // skewed client clock would otherwise show a number the server disagrees
  // with. Seeding from serverNow also makes the first client render identical
  // to the server's.
  const [now, setNow] = useState(serverNow);
  const skewRef = useRef(0);
  const fired = useRef(false);

  useEffect(() => {
    skewRef.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    return () => clearInterval(id);
  }, []);

  const left = endsAt - now;

  // The panel clears itself the second the clock runs out — by asking the
  // server, which is what actually decides. Fired once: `left` keeps ticking
  // past zero and a plain effect would re-ask every second.
  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    onExpire();
  }, [left, onExpire]);

  if (left <= 0) return <span className="nums text-lg font-black leading-none">00:00</span>;
  const total = Math.floor(left / 1000);
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return (
    <span className="nums text-lg font-black leading-none tabular-nums" dir="ltr">
      {h > 0 ? `${String(h).padStart(2, "0")}:` : ""}
      {m}:{s}
    </span>
  );
}

/** One rival's row on the live standings. */
function BoardRow({ row }: { row: MiniGameBoardRow }) {
  const t = useT();
  // Against the ROW's own ceiling — a rival who bought extra attempts is
  // still in the race at 3/5 when the base budget was 3.
  const out = !row.solved && row.attempts >= row.maxAttempts;
  return (
    <li
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
        row.isSelf ? "bg-gold/10 ring-1 ring-gold/40" : "odd:bg-white/[0.03]"
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate font-bold ${
          row.isSelf ? "text-gold-bright" : "text-zinc-300"
        }`}
      >
        <PlayerLink empireId={row.empireId} name={row.name} />
        {row.isSelf && (
          <span className="ms-1 text-[10px] font-normal text-gold-dim">{t("(אתה)")}</span>
        )}
      </span>
      <span className="nums shrink-0 text-[11px] text-zinc-500" dir="ltr">
        {row.attempts}/{row.maxAttempts}
      </span>
      <span className="shrink-0 text-[10px] font-bold">
        {row.won ? (
          <span className="text-emerald-300">{t("🏆 זכה")}</span>
        ) : row.solved ? (
          <span className="text-sky-300">{t("✅ פתר")}</span>
        ) : out ? (
          <span className="text-red-300">{t("💀 נגמרו")}</span>
        ) : (
          <span className="text-amber-300">{t("⏳ משחק")}</span>
        )}
      </span>
    </li>
  );
}

/* ========================================================================== */
/*                          מצא את הכדור — the cups                           */
/* ========================================================================== */

/**
 * A row of upturned cups on a table, drawn in CSS (see `.cup*` in globals.css).
 * They are drawn rather than stood in for by an icon because the old panel
 * offered a line of potion bottles and asked "which cup?" — the one thing the
 * game is about was the one thing not on screen.
 *
 * A cup the player already lifted stays lifted, and cannot be picked again. The
 * attempt log is server-side, so that survives a reload — which is the point:
 * without it, the easiest way to lose is to spend a second attempt emptying a
 * cup you already emptied.
 */
function CupsGame({
  count,
  history,
  interactive,
  pending,
  onPick,
}: {
  count: number;
  history: MiniGameHistoryRow[];
  interactive: boolean;
  pending: boolean;
  onPick: (index: number) => void;
}) {
  const t = useT();
  const picks = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const row of history) if (row.kind === "cup") map.set(row.pick, row.hit);
    return map;
  }, [history]);

  // The shuffle is a mount-time flourish, gated on "has this player touched the
  // game yet" rather than re-run per render — a poll tick hands down a new state
  // object every 10s, and re-shuffling under a player mid-decision would read as
  // the game cheating.
  const shuffling = picks.size === 0;

  return (
    <div className="cups-stage" role="group" aria-label={t("כוסות")}>
      <div className={`cups-row ${shuffling ? "is-shuffling" : ""}`}>
        {Array.from({ length: count }).map((_, i) => {
          const tried = picks.has(i);
          const hit = picks.get(i) === true;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              disabled={!interactive || tried || pending}
              className="cup"
              data-state={hit ? "hit" : tried ? "tried" : "idle"}
              style={{ "--i": i, "--dir": i % 2 === 0 ? 1 : -1 } as CSSProperties}
              aria-label={
                hit
                  ? t("כוס {n} — הכדור כאן!", { n: i + 1 })
                  : tried
                    ? t("כוס {n} — ריקה", { n: i + 1 })
                    : t("כוס {n}", { n: i + 1 })
              }
            >
              {hit && <span className="cup-ball" aria-hidden />}
              {/* Only the art lifts. The ball and the shadow are siblings of it,
                  so the ball stays put on the table instead of being carried
                  away by the tilt of the cup that was covering it. */}
              <span className="cup-art" aria-hidden>
                <span className="cup-body">
                  <span className="cup-shine" />
                </span>
                <span className="cup-base" />
                <span className="cup-mouth" />
              </span>
              <span className="cup-shadow" aria-hidden />
              <span className="cup-empty" aria-hidden>
                ✕
              </span>
            </button>
          );
        })}
      </div>
      <div className="cups-table" aria-hidden />
    </div>
  );
}

/* ========================================================================== */
/*                        פריצת הכספת — the code lock                         */
/* ========================================================================== */

const MARK_CLASS: Record<SafeMark, string> = {
  hit: "mark-hit",
  near: "mark-near",
  miss: "mark-miss",
};

/** The three marks, spelled out once above the log so the game is learnable. */
function SafeLegend() {
  const t = useT();
  return (
    <ul className="safe-legend">
      <li>
        <span className="safe-pip mark-hit" aria-hidden />
        {t("ספרה נכונה במקום הנכון")}
      </li>
      <li>
        <span className="safe-pip mark-near" aria-hidden />
        {t("ספרה נכונה במקום אחר")}
      </li>
      <li>
        <span className="safe-pip mark-miss" aria-hidden />
        {t("לא בקוד")}
      </li>
    </ul>
  );
}

/**
 * The vault. Type a code and every digit comes back marked — right digit in the
 * right slot, right digit in the wrong slot, or not in the code at all — so the
 * attempt log below is a set of constraints to reason from rather than a list of
 * failures. The marks are computed server-side (see scoreCode); the client only
 * ever paints what it was handed.
 */
/**
 * מפת האוצר — the grid, with every dig left where it landed.
 *
 * The board *is* the player's notes. Each cell they have dug keeps its band
 * ("חם" / "פושר" / "קר") permanently, because the whole game is triangulating
 * from those readings — a grid that forgot them would force the player to
 * remember four numbers to play a puzzle about deduction.
 *
 * Bands rather than distances is a rule of the game, not of the view: see
 * `digBand`. Nothing here can compute a band, and nothing here is told the
 * answer — the server sends the reading with the dig.
 */
function TreasureGame({
  size,
  history,
  interactive,
  pending,
  onDig,
}: {
  size: number;
  history: MiniGameHistoryRow[];
  interactive: boolean;
  pending: boolean;
  onDig: (index: number) => void;
}) {
  const t = useT();
  const digs = useMemo(() => {
    const map = new Map<number, DigBand>();
    for (const row of history) if (row.kind === "dig") map.set(row.pick, row.band);
    return map;
  }, [history]);

  return (
    <div className="tmap-stage" role="group" aria-label={t("מפת האוצר")}>
      <div
        className="tmap-grid"
        style={{ "--size": size } as CSSProperties}
      >
        {Array.from({ length: size * size }).map((_, i) => {
          const band = digs.get(i);
          const row = Math.floor(i / size) + 1;
          const col = (i % size) + 1;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onDig(i)}
              disabled={!interactive || band !== undefined || pending}
              className="tmap-cell"
              data-band={band ?? "idle"}
              aria-label={
                band
                  ? t("שורה {row}, עמודה {col} — {band}", {
                      row,
                      col,
                      band: t(DIG_BAND_LABEL[band]),
                    })
                  : t("שורה {row}, עמודה {col}", { row, col })
              }
            >
              {band === "found" ? "💰" : band ? t(DIG_BAND_LABEL[band]) : ""}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-zinc-500">
        {t("כל חפירה מגלה כמה קרוב היית — לא לאן ללכת.")}
      </p>
    </div>
  );
}

/**
 * חידה — the question, a box, and everything already tried.
 *
 * The list of past answers is the only feedback there is: a riddle has no
 * partial credit, so showing what has been said keeps a player from spending
 * their last attempt on a word they already tried.
 */
function RiddleGame({
  question,
  history,
  interactive,
  pending,
  onAnswer,
}: {
  question: string;
  history: MiniGameHistoryRow[];
  interactive: boolean;
  pending: boolean;
  onAnswer: (value: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const tried = history.filter(
    (row): row is Extract<MiniGameHistoryRow, { kind: "word" }> =>
      row.kind === "word"
  );

  return (
    <div className="riddle-stage">
      <p className="riddle-question">{question}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const answer = value.trim();
          if (!answer) return;
          onAnswer(answer);
          setValue("");
        }}
        className="mt-3 flex flex-wrap items-center justify-center gap-2"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!interactive || pending}
          maxLength={RIDDLE_ANSWER_MAX}
          autoComplete="off"
          placeholder={t("התשובה שלך")}
          className="w-full max-w-xs rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-center text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-gold"
        />
        <button
          type="submit"
          disabled={!interactive || pending || value.trim().length === 0}
          className="btn btn-gold px-4 py-2 text-sm disabled:opacity-50"
        >
          {pending ? t("בודק…") : t("ענה")}
        </button>
      </form>

      {tried.length > 0 && (
        <ul className="mt-3 flex flex-wrap justify-center gap-1.5">
          {tried.map((row, i) => (
            <li
              key={`${row.word}-${i}`}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                row.hit
                  ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300"
                  : "border-border-subtle bg-black/30 text-zinc-500 line-through"
              }`}
            >
              {row.word}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SafeGame({
  digits,
  history,
  interactive,
  solved,
  pending,
  attempts,
  onSubmit,
}: {
  digits: number;
  history: MiniGameHistoryRow[];
  interactive: boolean;
  solved: boolean;
  pending: boolean;
  attempts: number;
  onSubmit: (code: string) => void;
}) {
  const t = useT();
  const [code, setCode] = useState<string[]>(() => Array(digits).fill(""));
  const slots = useRef<(HTMLInputElement | null)[]>([]);

  // Clear the dial once an attempt lands, keyed on the attempt count — that is
  // the *server's* record that the submission was accepted, so a rejected one
  // leaves the player's digits where they typed them.
  //
  // Adjusted during render rather than in an effect: an effect would paint the
  // spent code for a frame before wiping it, and re-keying the component would
  // remount the inputs and drop focus mid-game.
  const [lastReset, setLastReset] = useState(`${digits}:${attempts}`);
  if (lastReset !== `${digits}:${attempts}`) {
    setLastReset(`${digits}:${attempts}`);
    setCode(Array(digits).fill(""));
  }

  const rows = history.filter(
    (r): r is Extract<MiniGameHistoryRow, { kind: "code" }> => r.kind === "code"
  );
  const ready = code.length === digits && code.every((d) => d !== "");
  // A cracked safe keeps the winning code in the wheels. Three blank boxes under
  // "הכספת פתוחה" read as a form waiting for input, which is the opposite of
  // what just happened.
  const shown = solved ? (rows[rows.length - 1]?.code.split("") ?? code) : code;

  function put(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setCode((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < digits - 1) slots.current[index + 1]?.focus();
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      e.preventDefault();
      slots.current[index - 1]?.focus();
      setCode((prev) => {
        const next = [...prev];
        next[index - 1] = "";
        return next;
      });
    }
    if (e.key === "ArrowLeft" && index > 0) slots.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < digits - 1) slots.current[index + 1]?.focus();
  }

  // A player who wants to re-try an earlier code with one digit changed should be
  // able to paste it back in rather than retype it slot by slot.
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, digits);
    if (!pasted) return;
    e.preventDefault();
    setCode(Array.from({ length: digits }, (_, i) => pasted[i] ?? ""));
    slots.current[Math.min(pasted.length, digits - 1)]?.focus();
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || !interactive || pending) return;
    onSubmit(code.join(""));
  }

  return (
    <div className="safe-stage">
      {/* --- the vault door --- */}
      <div className={`safe-door ${solved ? "is-open" : ""}`} aria-hidden>
        <span className="safe-vault">
          <span className="safe-loot">💰</span>
        </span>
        <span className="safe-plate">
          {/* One notch per attempt, so the dial visibly winds as the player works. */}
          <span className="safe-dial" style={{ "--turn": attempts } as CSSProperties}>
            <span className="safe-dial-face" />
            <span className="safe-dial-mark" />
          </span>
          <span className="safe-rivets" />
          <span className="safe-handle" />
        </span>
      </div>

      {/* --- the keypad + the attempt log --- */}
      <div className="safe-controls">
        <form onSubmit={submit} className="space-y-2.5">
          <p className="text-center text-sm text-zinc-300">
            {solved ? (
              <span className="font-bold text-emerald-300">{t("הכספת פתוחה 🎉")}</span>
            ) : (
              <span className="nums">{t("הזן קוד בן {digits} ספרות", { digits })}</span>
            )}
          </p>
          <div className="safe-slots" dir="ltr">
            {Array.from({ length: digits }).map((_, i) => (
              <input
                key={i}
                ref={(el) => {
                  slots.current[i] = el;
                }}
                value={shown[i] ?? ""}
                onChange={(e) => put(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                onPaste={onPaste}
                onFocus={(e) => e.target.select()}
                disabled={!interactive || pending}
                inputMode="numeric"
                autoComplete="off"
                maxLength={1}
                className={`safe-slot nums ${solved ? "is-cracked" : ""}`}
                aria-label={t("ספרה {n}", { n: i + 1 })}
              />
            ))}
          </div>
          {interactive && (
            <div className="flex justify-center">
              <button type="submit" disabled={!ready || pending} className="btn btn-gold px-6">
                {t("🔓 נסה לפרוץ")}
              </button>
            </div>
          )}
        </form>

        {rows.length > 0 && (
          <div className="safe-log">
            <SafeLegend />
            <ul dir="ltr">
              {rows.map((row, i) => (
                <li key={i} className="safe-log-row">
                  <span className="safe-log-n nums">{i + 1}</span>
                  {row.code.split("").map((digit, d) => (
                    <span key={d} className={`safe-log-digit nums ${MARK_CLASS[row.marks[d]]}`}>
                      {digit}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/*                        לוח הזוכים — the winners' rail                       */
/* ========================================================================== */

/**
 * Who has already taken the prize, as a row of medals.
 *
 * This is the part of a running event that stays interesting after a player is
 * out of it: the board below answers "how is everyone doing", this answers the
 * only question a knocked-out player actually asks — "did anyone get it?". The
 * rows arrive won-first from the server (see loadBoard's ordering), so the
 * first medal is the player who cracked it first.
 */
function WinnersRail({ board }: { board: MiniGameBoardRow[] }) {
  const t = useT();
  const dir = useDir();
  const winners = board.filter((r) => r.won);
  if (winners.length === 0) return null;
  return (
    <div className="mg-winners" dir={dir}>
      <span className="mg-winners-title">{t("🏆 כבר זכו")}</span>
      <ul className="mg-winners-list">
        {winners.slice(0, 8).map((row, i) => (
          <li key={row.empireId} className="mg-winner" style={{ "--i": i } as CSSProperties}>
            {/* The first crack is the one worth naming — everyone after is a
                medal in a row, and the ordinal is what tells them apart. */}
            <span className="mg-winner-rank nums" dir="ltr">
              {i + 1}
            </span>
            <span className="min-w-0 truncate">
              <PlayerLink empireId={row.empireId} name={row.name} />
            </span>
          </li>
        ))}
        {winners.length > 8 && (
          <li className="mg-winner mg-winner--more">
            +<span className="nums">{winners.length - 8}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

/* ========================================================================== */
/*                          The game itself, in a modal                        */
/* ========================================================================== */

/**
 * The full mini-game: banner, play area, winners' rail and live standings.
 *
 * This used to be rendered inline at the top of every `/game/*` screen, and at
 * roughly 340px tall it pushed the page the player actually came for below the
 * fold — on every screen, for the whole release, including for the players who
 * had already spent their attempts. It now lives behind the command-bar pill,
 * so the cost of a running event on a page is one chip.
 */
function MiniGameStage({
  state,
  pending,
  feedback: fb,
  onPlay,
  onPay,
  onBuyExtra,
  onClose,
  onExpire,
}: {
  state: MiniGameState;
  pending: boolean;
  feedback: Feedback | null;
  onPlay: (value: string) => void;
  /** Pay the entry fee — only meaningful while `state.paid` is false. */
  onPay: () => void;
  /** Buy one extra attempt — only meaningful while `state.extrasLeft` > 0. */
  onBuyExtra: () => void;
  onClose: () => void;
  onExpire: () => void;
}) {
  const t = useT();
  const dir = useDir();
  const meta = MINIGAME_TYPE_META[state.type];
  const attemptsLeft = Math.max(0, state.maxAttempts - state.attempts);
  const outOfAttempts = state.paid && !state.solved && attemptsLeft === 0;
  // Out of attempts, but more are for sale and this player may still buy some.
  const canBuyExtra =
    state.paid && !state.solved && state.extraCost !== null && state.extrasLeft > 0;
  // A finished player keeps the board on screen in a read-only state rather than
  // having it swapped out for a text box: the cracked safe and the cup with the
  // ball under it ARE the payoff. An unpaid player sees the board too — the
  // game itself is the sales pitch — but cannot touch it until the fee clears.
  const interactive = state.paid && !state.solved && !outOfAttempts;
  const toneClass =
    fb?.tone === "win"
      ? "text-emerald-300"
      : fb?.tone === "lose" || fb?.tone === "error"
        ? "text-red-300"
        : fb?.tone === "hint"
          ? "text-amber-300"
          : "text-zinc-300";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${t(meta.label)} — ${state.title}`}
      dir={dir}
      onClick={(e) => e.stopPropagation()}
      // `max-h-full` against a dvh-sized overlay, not `max-h-[90vh]` — see the
      // note in ui/Dialog: on a phone `vh` is the toolbar-collapsed height, so
      // the guess keypad at the bottom of this board ended up unreachable.
      // No top padding: the title bar below is `sticky top-0` and carries its
      // own, so the card's padding would otherwise leave a band above the bar
      // for the board to scroll through.
      className="panel-gold relative z-10 max-h-full w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_20px_60px_rgba(0,0,0,0.85)] sm:px-5"
    >
      {/* ── Title bar: sticky, because the card itself is the scroller ──
          This board is taller than a phone screen on every one of the four
          games, and the ✕ used to be the last child of a flex-wrap row that
          also held three badges and a clock. At 320px that row wrapped and
          squeezed the button to a 20px sliver with its glyph clipped: the
          window had no visible way out, which is the bug players reported.
          Now the name and the ✕ ride above the scroll and the badges — which
          are information, not an escape route — wrap freely underneath. */}
      <div className="sticky top-0 z-20 -mx-4 flex items-start gap-3 border-b border-gold/25 bg-[#0d0c10]/95 px-4 py-3 backdrop-blur-sm sm:-mx-5 sm:px-5">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gold/50 bg-black/40 ${
            interactive ? "animate-bounce" : ""
          }`}
          aria-hidden
        >
          <Icon
            name={state.type === "CRACK_SAFE" ? (state.solved ? "unlocked" : "lock") : "dice"}
            size={24}
            className="text-gold-bright"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-black leading-tight text-gold-bright">
            <span aria-hidden>{meta.icon}</span>
            <span className="truncate">{state.title}</span>
          </p>
          <p className="text-xs text-gold-dim">
            {t(meta.label)} · {t("פרס:")}{" "}
            <span className="font-bold text-amber-200" dir="ltr">
              {state.prizeText}
            </span>
          </p>
        </div>
        <CloseButton onClick={onClose} label={t("סגירה")} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gold/25 py-2.5 text-[11px]">
        {state.endsAt != null && (
          // The clock is the one number on this banner that is actually
          // urgent, so it is sized past the badges around it rather than
          // sharing their 11px — at that size it read as another chip.
          <span className="flex items-center gap-1.5 rounded-lg border border-gold/50 bg-black/45 px-2.5 py-1 text-[13px] font-bold text-gold-bright shadow-[0_0_16px_-6px_var(--gold)]">
            <span aria-hidden className="text-base leading-none">
              ⏳
            </span>
            {t("נותר")}{" "}
            <Countdown
              key={state.endsAt}
              endsAt={state.endsAt}
              serverNow={state.serverNow}
              onExpire={onExpire}
            />
          </span>
        )}
        {state.maxWinners > 0 && (
          <span className="rounded-md border border-border-subtle px-2 py-1 text-zinc-400">
            {t("זוכים")}{" "}
            <span className="nums font-bold text-zinc-200" dir="ltr">
              {state.winnersCount}/{state.maxWinners}
            </span>
          </span>
        )}
        <span className="rounded-md border border-border-subtle px-2 py-1 text-zinc-400">
          {t("משתתפים")}{" "}
          <span className="nums font-bold text-zinc-200" dir="ltr">
            {state.players}
          </span>
        </span>
      </div>

      {/* ── Play area + live standings ── */}
      <div className="grid gap-4 pt-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-3">
          {!state.paid && state.cost && (
            <div className="panel-inset space-y-2 rounded-lg border border-gold/40 p-4 text-center">
              <p className="text-lg font-black text-gold-bright">
                {t("🎟️ משחק בתשלום")}
              </p>
              <p className="text-sm text-zinc-300">
                {t("דמי ההשתתפות: {cost} — התשלום פותח {count} ניסיונות", {
                  cost: costText(t, state.cost.resource, state.cost.amount),
                  count: state.baseAttempts,
                })}
              </p>
              {state.extraCost && state.extrasLeft > 0 && (
                <p className="text-xs text-zinc-500">
                  {t("ואם ייגמרו — עד {count} ניסיונות נוספים ב־{cost} כל אחד", {
                    count: state.extrasLeft,
                    cost: costText(t, state.extraCost.resource, state.extraCost.amount),
                  })}
                </p>
              )}
              <button
                type="button"
                onClick={onPay}
                disabled={pending}
                className="btn btn-gold px-6 py-2.5 text-sm disabled:opacity-50"
              >
                {pending
                  ? t("רגע…")
                  : t("שלם {cost} והשתתף", {
                      cost: costText(t, state.cost.resource, state.cost.amount),
                    })}
              </button>
            </div>
          )}
          {state.solved && (
            <div className="panel-inset space-y-1 rounded-lg p-3 text-center">
              <p className="text-xl font-black text-emerald-300">
                {state.won ? t("🎉 ניצחת!") : t("✅ פתרת נכון")}
              </p>
              <p className="text-sm text-zinc-300">
                {state.won
                  ? t("הפרס נוסף לאימפריה שלך: {prize}", { prize: state.prizeText })
                  : t("כל הפרסים כבר חולקו — אבל כל הכבוד!")}
              </p>
            </div>
          )}
          {outOfAttempts && (
            <div className="panel-inset space-y-2 rounded-lg p-3 text-center">
              <p className="text-xl font-black text-red-300">{t("😔 נגמרו הניסיונות")}</p>
              {canBuyExtra && state.extraCost ? (
                <>
                  <p className="text-sm text-zinc-300">
                    {t("אפשר לקנות עוד ניסיון ולהישאר במשחק — נותרו לך {count} לקנייה", {
                      count: state.extrasLeft,
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={onBuyExtra}
                    disabled={pending}
                    className="btn btn-gold px-5 py-2 text-sm disabled:opacity-50"
                  >
                    {pending
                      ? t("רגע…")
                      : t("🎯 קנה ניסיון נוסף — {cost}", {
                          cost: costText(t, state.extraCost.resource, state.extraCost.amount),
                        })}
                  </button>
                </>
              ) : (
                <p className="text-sm text-zinc-400">
                  {t("יצאת מהמשחק, אבל הוא עדיין רץ — סגור את החלון והמשך לשחק; הכפתור למעלה יעדכן אותך מי זכה.")}
                </p>
              )}
            </div>
          )}

          {state.type === "CRACK_SAFE" ? (
            <SafeGame
              digits={state.digits ?? 3}
              history={state.history}
              interactive={interactive}
              solved={state.solved}
              pending={pending}
              attempts={state.attempts}
              onSubmit={onPlay}
            />
          ) : state.type === "TREASURE_MAP" ? (
            <TreasureGame
              size={state.size ?? 4}
              history={state.history}
              interactive={interactive}
              pending={pending}
              onDig={(i) => onPlay(String(i))}
            />
          ) : state.type === "RIDDLE" ? (
            <RiddleGame
              question={state.question ?? ""}
              history={state.history}
              interactive={interactive}
              pending={pending}
              onAnswer={onPlay}
            />
          ) : (
            <CupsGame
              count={state.cups ?? 3}
              history={state.history}
              interactive={interactive}
              pending={pending}
              onPick={(i) => onPlay(String(i))}
            />
          )}

          <p className="nums text-center text-xs text-zinc-500">
            {!state.paid
              ? t("הלוח ייפתח ברגע שתשלם את דמי ההשתתפות")
              : interactive
                ? t("נותרו {count} ניסיונות", { count: attemptsLeft })
                : t("המשחק ממשיך בלעדיך — עקוב אחרי המתחרים")}
          </p>

          {fb && <p className={`text-center text-sm font-bold ${toneClass}`}>{fb.text}</p>}
        </div>

        {/* The tail of the event: who took it, then how everyone else is doing. */}
        <div className="space-y-3">
          <WinnersRail board={state.board} />

          <div className="panel-inset rounded-lg p-2">
            <p className="px-1 pb-1.5 text-[11px] font-bold text-gold-dim">
              {t("🏁 מי משחק עכשיו")}
            </p>
            {state.board.length === 0 ? (
              <p className="px-1 py-3 text-center text-[11px] text-zinc-500">
                {t("עדיין אף אחד לא ניסה — היה הראשון!")}
              </p>
            ) : (
              <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                {state.board.map((row) => (
                  <BoardRow key={row.empireId} row={row} />
                ))}
              </ul>
            )}
            {state.players > state.board.length && (
              <p className="nums px-1 pt-1.5 text-center text-[10px] text-zinc-600">
                {t("ועוד {count} משתתפים", {
                  count: state.players - state.board.length,
                })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* The second way out, at the end of the scroll. The ✕ above never
          leaves the screen, but a player who has read to the bottom of the
          standings should not have to travel back up to leave — and on a phone
          the backdrop this card could be tapped instead is a few pixels of
          margin. */}
      <div className="mt-4 flex justify-center border-t border-gold/20 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost px-6 py-2.5 text-sm"
        >
          {t("סגור")}
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*                     The corner column — herald + winners                    */
/* ========================================================================== */

/**
 * Which events a player has already been told about — i.e. already had the
 * release takeover for (see MiniGameTakeover).
 *
 * A list rather than the single id this used to hold: several releases can run
 * at once, and remembering only the last one heralded meant the older game
 * re-invited the player on the next load, forever. Capped, because the only
 * question ever asked of it is "have I seen *this* release", and a player who
 * has moved on by twenty games does not need the twenty-first answer.
 */
const HERALD_KEY = "kraldor.minigame.heralded";
const HERALD_MEMORY = 12;

function readHeralded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HERALD_KEY);
    if (!raw) return new Set();
    // The pre-multi-game format was a bare id, which is not JSON — read it back
    // as the one release it stood for rather than re-heralding it.
    const parsed: unknown = raw.startsWith("[") ? JSON.parse(raw) : [raw];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    // Private mode, blocked storage, a mangled value — better a repeated
    // invitation than none.
    return new Set();
  }
}

function writeHeralded(ids: Set<string>): void {
  try {
    window.localStorage.setItem(HERALD_KEY, JSON.stringify([...ids].slice(-HERALD_MEMORY)));
  } catch {
    /* nothing to do: the herald simply shows again next load */
  }
}

/** How long each winner call stays on screen. */
const WINNER_TOAST_MS = 7_000;

/** Most notes on screen at once — a burst of wins must not become a wall. */
const NOTE_LIMIT = 4;

/**
 * Each note carries its own deadline rather than its own timer. A per-note
 * `setTimeout` has to be rebuilt whenever the list changes, which silently
 * restarted the clock on every note still on screen — so a steady trickle of
 * winners could keep the first one pinned there indefinitely.
 *
 * Only wins live here now. The release invitation used to be a note in this
 * same column, which is what made a new game indistinguishable from every other
 * toast the game drops in that corner — it is a full-screen takeover instead.
 */
type CornerNote = {
  id: string;
  expiresAt: number;
  name: string;
  empireId: string;
  eventId: string;
  // `game` is only filled while more than one release is live — with a single
  // game on the board it would name the only thing it could possibly be.
  game: string | null;
};

/**
 * The bottom-right column: a call every time someone wins.
 *
 * This is half of what replaced the always-on panel (the takeover is the other
 * half). Pulling the standings off every screen would have made a running event
 * silent between its release and its end, so the standings come to the player
 * instead — only when something actually happened.
 *
 * Corner chosen to miss the neighbours: WarAlerts owns top-center, the chat dock
 * owns bottom-left.
 */
function CornerNotes({
  notes,
  onDismiss,
}: {
  notes: CornerNote[];
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  const dir = useDir();
  if (typeof document === "undefined" || notes.length === 0) return null;

  return createPortal(
    <div
      dir={dir}
      aria-live="polite"
      // Lifted clear of the chat dock on a phone: at 390px a note this wide
      // reaches the dock's corner, and being the higher layer it covered it.
      className="pointer-events-none fixed bottom-20 right-3 z-[85] flex w-[min(88vw,20rem)] flex-col gap-2 print:hidden sm:bottom-3"
    >
      {notes.map((note) => (
        <div key={note.id} className="mg-note mg-note--winner pointer-events-auto">
          <span className="mg-note-icon" aria-hidden>
            🏆
          </span>
          <span className="min-w-0 flex-1 text-xs text-zinc-300">
            <span className="font-black text-emerald-300">
              <PlayerLink empireId={note.empireId} name={note.name} />
            </span>{" "}
            {t("לקח את הפרס")}
            {note.game && (
              <>
                {" "}
                {t("ב־")}
                {/* The quotation marks are the dictionary's, not the markup's:
                    Hebrew quotes with ״ and English with " . The name inside is
                    free text an admin typed in the control centre — a proper
                    noun, like an empire's, so it rides in as a param. */}
                <span className="font-bold text-gold-bright">
                  {t("״{game}״", { game: note.game })}
                </span>
              </>
            )}
          </span>
          <button
            type="button"
            aria-label={t("סגירה")}
            onClick={() => onDismiss(note.id)}
            className="-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-white/10 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}


/* ========================================================================== */
/*                        One release, as a command-bar chip                   */
/* ========================================================================== */

/**
 * A single running mini-game, reduced to one pill.
 *
 * `crowded` is what a second live release does to this chip, and it is a trade
 * made twice over.
 *
 * On its own the title is a luxury and is the first thing dropped on a narrow
 * bar — the icon and the clock are what make the chip mean anything. Beside a
 * sibling it stops being a luxury: two gold chips carrying the same 🥤 and no
 * name are the same chip drawn twice, and the player cannot tell which race
 * they are opening. So a crowded chip keeps its title at every width.
 *
 * Which has to be paid for, because two full chips do not fit across a phone —
 * they wrapped into a stacked column, and a column of chips is a panel again,
 * which is the thing this whole component exists to not be. So below `sm` a
 * crowded chip also tightens its padding and drops the attempts badge: the row
 * has to say *which games are running and how long is left*, and the badge is
 * the one part of that the modal repeats the moment it is opened.
 */
function MiniGamePill({
  state,
  crowded,
  onOpen,
  onExpire,
}: {
  state: MiniGameState;
  crowded: boolean;
  onOpen: () => void;
  onExpire: () => void;
}) {
  const t = useT();
  const meta = MINIGAME_TYPE_META[state.type];
  const attemptsLeft = Math.max(0, state.maxAttempts - state.attempts);
  const interactive = !state.finished;
  const winners = state.board.filter((r) => r.won);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${state.title} — ${t(meta.label)}`}
      // The narrow-screen squeeze is `.mg-pill--crowded` in globals.css rather
      // than utilities here: `.mg-pill-badge` and `.btn` are unlayered rules, so
      // they beat any Tailwind `hidden`/`gap-*`/`text-*` this could ask for.
      className={`mg-pill btn gap-2 px-3 py-1.5 text-sm ${crowded ? "mg-pill--crowded" : ""} ${
        interactive ? "btn-gold mg-pill--live" : "btn-dark"
      }`}
      title={`${state.title} · ${t(meta.label)} · ${t("פרס:")} ${state.prizeText}`}
    >
      <span aria-hidden className="text-base leading-none">
        {meta.icon}
      </span>
      <span
        className={`mg-pill-title ${
          crowded
            ? "max-w-[5rem] truncate sm:max-w-[8rem] lg:max-w-[12rem]"
            : "hidden max-w-[9rem] truncate sm:inline"
        }`}
      >
        {state.title}
      </span>

      {state.endsAt != null && (
        <span className="mg-pill-clock nums" dir="ltr">
          <Countdown
            key={state.endsAt}
            endsAt={state.endsAt}
            serverNow={state.serverNow}
            onExpire={onExpire}
          />
        </span>
      )}

      {/* The one badge that changes with the player's own standing: the fee
          until it is paid, attempts while they are in it, the medal count once
          they are not. This is the answer to "what is this chip telling me
          right now" — and the piece that stands down on a phone when it is
          sharing the row. */}
      {!state.paid && state.cost ? (
        <span className="mg-pill-badge mg-pill-badge--go">
          🎟️{" "}
          <span className="nums">
            {costText(t, state.cost.resource, state.cost.amount)}
          </span>
        </span>
      ) : interactive ? (
        <span className="mg-pill-badge mg-pill-badge--go">
          {attemptsLeft === 1 ? (
            t("ניסיון אחרון")
          ) : (
            <span className="nums">{t("נותרו {count}", { count: attemptsLeft })}</span>
          )}
        </span>
      ) : (
        <span className="mg-pill-badge mg-pill-badge--done">
          {winners.length > 0 ? (
            <>
              🏆 <span className="nums">{winners.length}</span>
            </>
          ) : (
            t("אין עדיין זוכה")
          )}
        </span>
      )}
    </button>
  );
}

/* ========================================================================== */

/**
 * The live mini-games as they meet a player on an ordinary screen: a row of
 * pills in the command bar, next to the season pass.
 *
 * The pill is the whole point of this component. A running event is a real
 * event — it wants attention — but it is also mounted on every `/game/*` screen
 * for its entire window, and the version of this that sat inline above the page
 * spent that window shoving the actual game down the screen for everybody,
 * including the players who had already solved it or burned every attempt. So
 * each release announces itself once (the herald), calls out each win as it
 * happens, and otherwise costs a chip that reads at a glance:
 *
 *   • still in it  — gold, pulsing, showing the clock and attempts left
 *   • done with it — quiet, showing how many have won and who took it first
 *
 * There can be several at once (see MAX_LIVE_MINIGAMES): an admin fielding a
 * cups game and a safe together is two races with two prizes, so the chips sit
 * side by side in the same row, oldest release first, and every piece of the
 * component below — the modal, the herald, the winner calls, the guess itself —
 * is keyed by event rather than assuming there is only ever one.
 */
export function MiniGameButton({ initial }: { initial: MiniGameState[] }) {
  const router = useRouter();
  const [states, setStates] = useState<MiniGameState[]>(initial);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<CornerNote[]>([]);
  const [pending, startTransition] = useTransition();

  const dismissNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    // `retry` means the round learned nothing (throttled, or a signed-out tab).
    // Changing nothing is the right answer: reading it as "no events" would pull
    // a live game — and the player's own attempt log — off the screen.
    const { states: next, retry } = await pollMiniGame();
    if (retry) return;
    setStates(next ?? []);
    // This only runs when a countdown hit zero, and the layout rendered the
    // first copy server-side — so re-render the page rather than leave anything
    // else quoting a release that has just closed.
    router.refresh();
  }, [router]);

  // Derived rather than read off `states` inside the effect: the poll result is
  // a new array every tick, so depending on it would tear down and rebuild the
  // interval on every beat. This flips only when the last event ends or the
  // first one starts, which is exactly when the rate should change.
  const live = states.length > 0;

  // Poll for activation / end / rival progress.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // Nobody is watching a hidden tab, and the wake-up listeners below poll
      // the moment it comes back — so skipping here is not falling behind, it is
      // the difference between a backgrounded tab costing six requests a minute
      // for hours and costing nothing. Same rule the chat dock already follows.
      if (document.visibilityState === "hidden") return;
      const { states: next, retry } = await pollMiniGame();
      if (alive && !retry) setStates(next ?? []);
    };
    const id = setInterval(tick, live ? POLL_LIVE_MS : POLL_IDLE_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [live]);

  // With two games up, "someone won" is no longer self-explanatory — the note
  // has to say which one. With one it would be naming the only thing it could.
  const crowded = states.length > 1;

  /**
   * The winner feed.
   *
   * Every poll carries the rival boards, and a board already says who has won —
   * so calling out a new winner costs nothing extra on the wire. Each event
   * keeps its own ledger, seeded from the *first* state seen for it, so that
   * arriving mid-event does not replay ten wins that happened before the player
   * got here; and only ever announces other people — the player's own win is
   * already a modal, a system message and a resource bar that just went up.
   */
  const announced = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    const fresh: CornerNote[] = [];
    for (const s of states) {
      const seen = announced.current.get(s.id);
      if (!seen) {
        // First sight of this release: everyone already holding a medal is
        // history, not news.
        announced.current.set(s.id, new Set(s.board.filter((r) => r.won).map((r) => r.empireId)));
        continue;
      }
      for (const row of s.board) {
        if (!row.won || row.isSelf || seen.has(row.empireId)) continue;
        seen.add(row.empireId);
        fresh.push({
          id: `win:${s.id}:${row.empireId}`,
          name: row.name,
          empireId: row.empireId,
          eventId: s.id,
          game: crowded ? s.title : null,
          expiresAt: Date.now() + WINNER_TOAST_MS,
        });
      }
    }
    // Forget the ledger of anything that has ended — ids are per-empire, so a
    // stale set would suppress the same player's win in the next release.
    for (const id of [...announced.current.keys()]) {
      if (!states.some((s) => s.id === id)) announced.current.delete(id);
    }
    // Reacting to an external system, not deriving state: `states` is what the
    // poll brought back, and a win that already happened on the server is the
    // event this turns into a toast. There is nothing to compute during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh.length > 0) setNotes((prev) => [...prev, ...fresh].slice(-NOTE_LIMIT));
  }, [states, crowded]);

  /**
   * The release takeover, once per release. Only for a player who can still
   * play it: someone who already solved a game (or spent their attempts) on
   * another tab does not need the screen taken to be invited into it, and the
   * pill is enough.
   *
   * localStorage is not readable while rendering on the server, so the decision
   * is made after mount — which also keeps the server's HTML and the client's
   * first paint identical.
   *
   * The ledger is the guard, not the effect's dependencies: a poll hands down a
   * fresh array every ten seconds, and the version of this that leaned on deps
   * had the previous run's cleanup cancel the pending invitation while storage
   * had already sworn it was delivered. Marking the release the moment it is
   * scheduled makes every later pass a no-op, so this can run as often as it
   * likes. The timers are cancelled only on unmount, never on a re-run.
   *
   * A *queue* rather than a flag, because an admin can field several games at
   * once (see MAX_LIVE_MINIGAMES) and two takeovers stacked on the same screen
   * would be one unreadable screen: they announce themselves in turn, oldest
   * release first, each waiting for the one before it to leave.
   */
  const heralded = useRef<Set<string> | null>(null);
  const heraldTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [takeoverQueue, setTakeoverQueue] = useState<string[]>([]);
  useEffect(
    () => () => {
      for (const t of heraldTimers.current) clearTimeout(t);
    },
    []
  );
  useEffect(() => {
    heralded.current ??= readHeralded();
    for (const s of states) {
      if (s.finished || heralded.current.has(s.id)) continue;
      heralded.current.add(s.id);
      writeHeralded(heralded.current);
      const id = s.id;
      // A beat of delay so the page finishes painting first — slammed into the
      // same frame as a navigation it reads as a loading artefact, not an event.
      heraldTimers.current.push(
        setTimeout(() => {
          setTakeoverQueue((prev) => (prev.includes(id) ? prev : [...prev, id]));
        }, 600)
      );
    }
  }, [states]);

  // Resolved every render against the live list: a release that ends (or is
  // pulled) while it is queued never gets to take the screen for a game that is
  // no longer there.
  const takeoverState =
    takeoverQueue.length > 0
      ? (states.find((s) => s.id === takeoverQueue[0] && !s.finished) ?? null)
      : null;
  const takeoverId = takeoverQueue[0];
  useEffect(() => {
    if (takeoverId == null || takeoverState !== null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTakeoverQueue((prev) => prev.filter((id) => id !== takeoverId));
  }, [takeoverId, takeoverState]);

  const dropTakeover = useCallback((id: string) => {
    setTakeoverQueue((prev) => prev.filter((q) => q !== id));
  }, []);

  /**
   * Happy Hour gets the screen first.
   *
   * An admin opening a golden hour and fielding a game with it is one action to
   * them and two takeovers to the player — both fixed, both on the modal rung,
   * landing within half a second of each other. Rather than couple the two
   * components, this watches for the other one in the DOM and simply waits: the
   * Happy Hour takeover always leaves on its own, and the queue is patient.
   */
  const [hhTakeover, setHhTakeover] = useState(false);
  const queued = takeoverQueue.length > 0;
  useEffect(() => {
    if (!queued) return;
    const check = () => {
      // Any `.hh-takeover`, including one already fading: crossing a screen
      // that is on its way out is the same collision, half-transparent.
      const busy = document.querySelector(".hh-takeover") !== null;
      // Reacting to another component's DOM, not deriving state from props.
      setHhTakeover(busy);
    };
    check();
    const id = setInterval(check, 400);
    return () => clearInterval(id);
  }, [queued]);

  // Notes expire on their own deadline. One sweep for the whole column rather
  // than a timer per note — see CornerNote for what a per-note timer got wrong.
  const hasNotes = notes.length > 0;
  useEffect(() => {
    if (!hasNotes) return;
    const id = setInterval(() => {
      const now = Date.now();
      setNotes((prev) =>
        prev.some((n) => n.expiresAt <= now) ? prev.filter((n) => n.expiresAt > now) : prev
      );
    }, 500);
    return () => clearInterval(id);
  }, [hasNotes]);

  // The open game, resolved every render: a release that ends while its modal is
  // up takes the modal with it instead of stranding the player on a dead board.
  const openState = openId != null ? (states.find((s) => s.id === openId) ?? null) : null;
  const modalOpen = openState !== null;

  // Escape closes the game, and the page behind it stays put while it is open.
  useEffect(() => {
    if (!modalOpen) return;
    // The DOM event, not React's — the synthetic type is imported above for the
    // safe's keypad and would shadow it here.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  useScrollLock(modalOpen);

  function play(eventId: string, value: string) {
    startTransition(async () => {
      const fd = new FormData();
      // Which game this guess belongs to. Several can be live, and the server
      // will not guess on the player's behalf.
      fd.set("eventId", eventId);
      fd.set("guess", value);
      const res = await submitMiniGameGuess({ state: null, feedback: "", tone: "info" }, fd);
      const next = res.state;
      if (next) setStates((prev) => prev.map((s) => (s.id === next.id ? next : s)));
      setFeedback({ text: res.feedback, tone: res.tone, eventId });
      if (res.tone === "win") router.refresh();
    });
  }

  /** The two purchases share the guess's plumbing: fresh state in, feedback out.
   *  The router refresh is what repaints the resource bar the fee just left. */
  function purchase(eventId: string, action: (id: string) => Promise<{
    state: MiniGameState | null;
    feedback: string;
    tone: string;
  }>) {
    startTransition(async () => {
      const res = await action(eventId);
      const next = res.state;
      if (next) setStates((prev) => prev.map((s) => (s.id === next.id ? next : s)));
      setFeedback({ text: res.feedback, tone: res.tone, eventId });
      if (res.tone !== "error") router.refresh();
    });
  }

  if (states.length === 0) return null;

  const fb =
    feedback && openState && feedback.eventId === openState.id ? feedback : null;

  return (
    <>
      {/* Their own group inside the command bar, so a second release lands
          beside the first rather than being flung to the far side of the row by
          the potions and the update timers. */}
      <div className="mg-pills" data-count={states.length}>
        {states.map((s) => (
          <MiniGamePill
            key={s.id}
            state={s}
            crowded={crowded}
            onOpen={() => setOpenId(s.id)}
            onExpire={refresh}
          />
        ))}
      </div>

      {/* One announcement at a time, and never over an open board — a player who
          is already inside a game does not need the screen taken to be told a
          game exists. It waits in the queue until the board is closed. */}
      {takeoverState && !openState && !hhTakeover && (
        <MiniGameTakeover
          key={takeoverState.id}
          state={takeoverState}
          onPlay={() => setOpenId(takeoverState.id)}
          onDone={() => dropTakeover(takeoverState.id)}
        />
      )}

      <CornerNotes notes={notes} onDismiss={dismissNote} />

      {openState && (
        <div
          className="fixed inset-x-0 top-0 z-[95] flex h-[100dvh] items-center justify-center overflow-hidden bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setOpenId(null)}
        >
          <MiniGameStage
            state={openState}
            pending={pending}
            feedback={fb}
            onPlay={(value) => play(openState.id, value)}
            onPay={() => purchase(openState.id, payMiniGameEntry)}
            onBuyExtra={() => purchase(openState.id, buyMiniGameAttempt)}
            onClose={() => setOpenId(null)}
            onExpire={refresh}
          />
        </div>
      )}
    </>
  );
}
