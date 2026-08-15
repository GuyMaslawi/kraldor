"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { DiscordLink } from "@/components/ui/DiscordLink";
// The dot is shared with the rankings ladder — see components/ui/PresenceDot.
import { PresenceDot } from "@/components/ui/PresenceDot";
import {
  CHAT_BODY_MAX,
  CHAT_SEARCH_MIN,
  TYPING_PING_MS,
  typingLabel,
} from "@/lib/game/chat";
import { ChatEmojiPicker } from "@/components/game/ChatEmojiPicker";
import { useDir, useT } from "@/i18n/client";
// The composer clamps to two different caps now — the chat's and the ticket's —
// so it counts characters itself rather than through clampChatBody.
import { clampChars } from "@/lib/game/text";
import { SUPPORT_BODY_MAX } from "@/lib/support";
import {
  getChatDirectory,
  getChatPulse,
  getChatThread,
  getGlobalChat,
  hideChatMessage,
  searchChatPlayers,
  sendChat,
  setTyping,
  type ChatLine,
  type ChatPlayer,
  type ChatThread,
} from "@/server/actions/chat";
import {
  getSupportChat,
  sendSupportMessage,
  type SupportLine,
} from "@/server/actions/support";
import type { SupportSummary } from "@/server/supportThread";

/**
 * The live chat dock: a launcher in the bottom-left corner that opens a pane
 * with the public room on one tab and private conversations on the other.
 *
 * It is deliberately a *dock*, not a page. Chat is what you do while doing
 * something else — building, attacking, reading a report — so it floats above
 * whatever screen the player is on, remembers whether it was open, and never
 * takes the router with it: everything inside is client state fed by polled
 * server actions (see src/server/actions/chat.ts).
 *
 * Poll cadence follows attention. Shut, it asks one cheap question every 25
 * seconds (any unread private lines? has the room spoken?); open, it reads the
 * visible surface every 5 seconds; hidden behind another tab, it stops
 * entirely — a background tab left open all day must not cost a query a second.
 */

// The open pane polls fast enough for a typing indicator to mean something: at
// five seconds "X is typing" arrived after the message it was announcing.
const POLL_OPEN_MS = 4_000;
const POLL_THREADS_MS = 8_000;
const POLL_CLOSED_MS = 25_000;

const OPEN_KEY = "kraldor-chat-open";
const TAB_KEY = "kraldor-chat-tab";
const ROOM_SEEN_KEY = "kraldor-chat-room-seen";

type Tab = "global" | "direct";

/**
 * Whether the dock is open, which tab it was on, and how far the player has read
 * the room all live in localStorage rather than in React state — they must
 * survive a navigation, and the game shell re-mounts this component on every
 * route change.
 *
 * It is wired as a real external store (subscribe + snapshot) instead of the
 * usual "read it in an effect and setState" because the read has to be
 * server-safe: the server has no localStorage, so the server snapshot is the
 * closed default and React re-renders with the stored value once it hydrates —
 * no flash of a dock that opens itself, and no effect that renders twice.
 */
const listeners = new Set<() => void>();

function subscribeStore(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode browsers: the dock just forgets its state between loads.
  }
  listeners.forEach((fn) => fn());
}

/** Snapshots. Each returns a primitive, so React can compare them cheaply and
 *  never re-renders on an unchanged read. */
const isOpenSnapshot = () => readStored(OPEN_KEY) === "1";
const isOpenServerSnapshot = () => false;
const tabSnapshot = (): Tab =>
  readStored(TAB_KEY) === "direct" ? "direct" : "global";
const tabServerSnapshot = (): Tab => "global";
/** The classic hydration flag: false on the server, true once mounted. */
const hydratedSnapshot = () => true;
const hydratedServerSnapshot = () => false;

/** Merge polled lines into what is on screen, dropping ids already held.
 *  The server overlaps its cursor by a millisecond on purpose, so duplicates
 *  are expected rather than exceptional. */
function mergeLines(current: ChatLine[], incoming: ChatLine[], cap: number) {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((line) => line.id));
  const fresh = incoming.filter((line) => !seen.has(line.id));
  if (fresh.length === 0) return current;
  return [...current, ...fresh].slice(-cap);
}

const LINE_CAP = 120;

/**
 * "Open the conversation with the staff" — dispatched from anywhere on the page,
 * because the dock is mounted once in the game shell and the doors into it are
 * elsewhere (the mailbox, the compose dialog).
 *
 * The support widget in front of the login screen has an event of its own with
 * the same shape; the two docks never share a screen, and the names are kept
 * apart so a stray listener cannot answer for the other one.
 */
export const STAFF_CHAT_EVENT = "kraldor:staff-chat";

export type StaffChatDetail = { prefill?: string };

/** Open the staff conversation from another client component. */
export function openStaffChat(detail: StaffChatDetail = {}): void {
  window.dispatchEvent(new CustomEvent(STAFF_CHAT_EVENT, { detail }));
}

/**
 * A support line, in the shape the dock already draws.
 *
 * The staff conversation is not a `ChatMessage` — it lives in its own table so
 * that it can outlive the empire, the account and the season (see SupportThread)
 * — but inside the panel it is a conversation like any other, so it is converted
 * once, on arrival, rather than rendered by a second copy of the bubble markup.
 * `mine` is "not from staff": in this thread there are exactly two sides.
 */
function fromSupport(line: SupportLine): ChatLine {
  return {
    id: line.id,
    // No profile behind it: the team answers as the game, not as an empire.
    empireId: null,
    name: line.name,
    body: line.body,
    // A person on the other end, even when they answer for the game — the
    // centred herald notice would be exactly the wrong shape for a reply.
    system: false,
    at: line.at,
    time: line.time,
    mine: !line.fromStaff,
    staff: line.fromStaff,
    // The staff channel has no mailbox behind it — a ticket is its own record.
    viaMail: false,
  };
}

export function ChatDock({
  canModerate = false,
  discordUrl = null,
}: {
  canModerate?: boolean;
  /**
   * The community channel's invite, or null while it is being built. Passed
   * down from the game layout rather than read here: the value lives in a
   * server-only module (see server/discord.ts).
   */
  discordUrl?: string | null;
}) {
  const t = useT();
  const dir = useDir();
  const mounted = useSyncExternalStore(
    subscribeStore,
    hydratedSnapshot,
    hydratedServerSnapshot
  );
  const open = useSyncExternalStore(
    subscribeStore,
    isOpenSnapshot,
    isOpenServerSnapshot
  );
  const tab = useSyncExternalStore(
    subscribeStore,
    tabSnapshot,
    tabServerSnapshot
  );
  const [partner, setPartner] = useState<{ id: string; name: string } | null>(
    null
  );

  // Presence of the open conversation's partner is held apart from `partner`
  // itself: the poll effect keys on that object, so folding a value that
  // changes every few minutes into it would restart the poll each time.
  const [partnerOnline, setPartnerOnline] = useState(false);

  const [globalLines, setGlobalLines] = useState<ChatLine[]>([]);
  const [threadLines, setThreadLines] = useState<ChatLine[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [roster, setRoster] = useState<ChatPlayer[]>([]);
  const [unread, setUnread] = useState(0);
  const [roomDot, setRoomDot] = useState(false);

  /* The conversation with the game's staff. It sits in the private tab beside
   * the player's own conversations because that is what it is — a private
   * conversation, with the one correspondent every player has from the moment
   * they sign up — but everything behind it is its own channel (see
   * server/actions/support.ts), so it carries its own transcript and its own
   * badge rather than being folded into `threads`. */
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffLines, setStaffLines] = useState<ChatLine[]>([]);
  const [staffUnread, setStaffUnread] = useState(0);
  const [staffClosed, setStaffClosed] = useState(false);
  /** The pinned row's preview, or null until this player has ever written in. */
  const [staffSummary, setStaffSummary] = useState<SupportSummary>(null);

  const [typing, setTypingNames] = useState<string[]>([]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  // Results carry the query they answered. Without that pairing the previous
  // player's matches stay on screen while a new name is being typed, and there
  // is no way to tell "still searching" from "nobody by that name".
  const [results, setResults] = useState<{
    query: string;
    list: ChatPlayer[];
  }>({ query: "", list: [] });

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** When my own typing marker was last refreshed — the throttle behind it. */
  const typingPingRef = useRef(0);

  // The poll builds its cursor from the tail of what is already on screen, but
  // it must not be re-created every time a line arrives — these refs carry the
  // current lists into a closure that only depends on which surface is open.
  const globalLinesRef = useRef<ChatLine[]>([]);
  const threadLinesRef = useRef<ChatLine[]>([]);
  const staffLinesRef = useRef<ChatLine[]>([]);
  useEffect(() => {
    globalLinesRef.current = globalLines;
    threadLinesRef.current = threadLines;
    staffLinesRef.current = staffLines;
  }, [globalLines, threadLines, staffLines]);

  const lines = staffOpen ? staffLines : partner ? threadLines : globalLines;
  /** The cap the composer clamps to — a ticket is a letter, a chat line is a
   *  shout across a room, and they are not the same length. */
  const bodyMax = staffOpen ? SUPPORT_BODY_MAX : CHAT_BODY_MAX;

  /* ---------------------------------------------------------------- polling */

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    const roomSeen = () => Number(readStored(ROOM_SEEN_KEY) ?? 0);

    const pulse = async () => {
      const next = await getChatPulse();
      if (cancelled) return;
      setUnread(next.unread);
      setStaffUnread(next.staffUnread);
      setRoomDot(next.latestGlobalAt > roomSeen());
    };

    const poll = async () => {
      if (document.visibilityState === "hidden") return;

      if (!open) {
        await pulse();
        return;
      }

      if (staffOpen) {
        const since = staffLinesRef.current.at(-1)?.at;
        // `reading: true` is the read receipt — the words are on screen.
        const view = await getSupportChat({ sinceMs: since, reading: true });
        if (cancelled) return;
        // No thread yet (nothing written from this account), or a refused
        // round: keep whatever is on screen rather than blanking it.
        if (view.exists) {
          setStaffLines((prev) =>
            since ? mergeLines(prev, view.lines.map(fromSupport), LINE_CAP) : view.lines.map(fromSupport)
          );
          setStaffClosed(view.status === "CLOSED");
        }
        setStaffUnread(0);
        return;
      }

      if (partner) {
        // A poll asks only for what it does not already have. The first round
        // after opening a thread has no cursor, so it loads the transcript.
        const since = threadLinesRef.current.at(-1)?.at;
        const view = await getChatThread(partner.id, since);
        if (cancelled) return;
        if (view.partner === null) {
          // The player was deleted or banned while the thread was open.
          setPartner(null);
          return;
        }
        setThreadLines((prev) =>
          since ? mergeLines(prev, view.lines, LINE_CAP) : view.lines
        );
        // The badge comes back with the transcript: reading this thread has
        // already cleared its own share of it.
        setUnread(view.unread);
        // Inside an open conversation presence is always disclosed (see
        // getChatThread); the fallback is only here to satisfy the optional type.
        setPartnerOnline(view.partner.online ?? false);
        setTypingNames(view.typing ? [view.partner.name] : []);
        return;
      }

      if (tab === "direct") {
        const directory = await getChatDirectory();
        if (cancelled) return;
        setThreads(directory.threads);
        setRoster(directory.roster);
        setStaffSummary(directory.staff);
        setStaffUnread(directory.staff?.unread ?? 0);
        setUnread(
          directory.threads.reduce((sum, thread) => sum + thread.unread, 0)
        );
        return;
      }

      const since = globalLinesRef.current.at(-1)?.at;
      const room = await getGlobalChat(since);
      if (cancelled) return;
      setGlobalLines((prev) =>
        since ? mergeLines(prev, room.lines, LINE_CAP) : room.lines
      );
      setUnread(room.unread);
      setTypingNames(room.typing);
      const latest =
        room.lines.at(-1)?.at ?? globalLinesRef.current.at(-1)?.at ?? 0;
      // The room is being read right now, so nothing in it is "new".
      if (latest) store(ROOM_SEEN_KEY, String(latest));
      setRoomDot(false);
    };

    void poll();
    const every =
      open && !partner && !staffOpen && tab === "direct"
        ? POLL_THREADS_MS
        : open
          ? POLL_OPEN_MS
          : POLL_CLOSED_MS;
    const interval = setInterval(() => void poll(), every);
    // Coming back to the tab should feel instant, not "in five seconds".
    const onWake = () => void poll();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [mounted, open, tab, partner, staffOpen]);

  /* --------------------------------------------------------------- scrolling */

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, open, partner, tab, staffOpen]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Reading older lines pins the view; coming back to the bottom re-arms it.
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /* ------------------------------------------------------------------ actions */

  const openDock = useCallback(() => store(OPEN_KEY, "1"), []);
  const closeDock = useCallback(() => store(OPEN_KEY, "0"), []);

  const switchTab = (next: Tab) => {
    store(TAB_KEY, next);
    setError(null);
    setTypingNames([]);
    stickRef.current = true;
  };

  /**
   * Announce that I am typing, at most once every TYPING_PING_MS.
   *
   * Throttled on the client rather than the server because the alternative is a
   * server round trip per keystroke to be told "too soon". The ref is reset on
   * send, so the first character of the next message pings immediately instead
   * of waiting out the window from the last one.
   */
  const pingTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingPingRef.current < TYPING_PING_MS) return;
    typingPingRef.current = now;
    void setTyping(partner ? partner.id : null);
  }, [partner]);

  const openThread = (id: string, name: string, online = false) => {
    setPartner({ id, name });
    setPartnerOnline(online);
    setThreadLines([]);
    setStaffOpen(false);
    setTypingNames([]);
    store(TAB_KEY, "direct");
    openDock();
    setError(null);
    setSearch("");
    setResults({ query: "", list: [] });
    stickRef.current = true;
    // The composer is the point of opening a conversation.
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  /**
   * Open the conversation with the staff — from the pinned row, or from a
   * doorway somewhere else on the page (see openStaffChat).
   *
   * The transcript is dropped rather than kept, so the next poll loads the
   * thread from its start: it is short by nature, and a stale tail from an hour
   * ago is the wrong thing to be looking at when you have just decided to ask
   * for help.
   */
  const openStaff = useCallback(
    (prefill?: string) => {
      setPartner(null);
      setStaffOpen(true);
      setStaffLines([]);
      setTypingNames([]);
      store(TAB_KEY, "direct");
      openDock();
      setError(null);
      setSearch("");
      setResults({ query: "", list: [] });
      stickRef.current = true;
      // Never over something already half-written: whoever is mid-sentence is
      // describing the same problem, better.
      if (prefill) setDraft((prev) => (prev.trim().length > 0 ? prev : prefill));
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [openDock]
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<StaffChatDetail>).detail ?? {};
      openStaff(detail.prefill);
    };
    window.addEventListener(STAFF_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(STAFF_CHAT_EVENT, onOpen);
  }, [openStaff]);

  /**
   * Drop an emoji where the cursor is — not at the end. Someone who has clicked
   * back into the middle of a sentence expects it there, and the selection is
   * restored after the state update so typing continues from the right place.
   */
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = clampChars(draft.slice(0, start) + emoji + draft.slice(end), bodyMax);
    setDraft(next);
    if (!staffOpen) pingTyping();
    requestAnimationFrame(() => {
      const caret = Math.min(start + emoji.length, next.length);
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);

    // A letter to the staff goes down its own channel: a different table, its
    // own rate limits, and a Discord ping on the other end. Nothing about it
    // touches the game's chat.
    if (staffOpen) {
      const answer = await sendSupportMessage({
        body,
        // The screen the player was on when they wrote is half of most bug
        // reports, and the server can only guess it from a referer.
        path: window.location.pathname,
      });
      setSending(false);
      if ("error" in answer) {
        setError(answer.error);
        return;
      }
      setDraft("");
      stickRef.current = true;
      setStaffClosed(false);
      const line = fromSupport(answer.line);
      setStaffLines((prev) => mergeLines(prev, [line], LINE_CAP));
      setStaffSummary({
        unread: 0,
        preview: line.body,
        at: line.at,
        time: line.time,
        closed: false,
      });
      return;
    }

    const result = await sendChat({
      body,
      toEmpireId: partner ? partner.id : null,
    });
    setSending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDraft("");
    typingPingRef.current = 0;
    stickRef.current = true;
    if (partner) {
      setThreadLines((prev) => mergeLines(prev, [result.line], LINE_CAP));
      // A brand-new conversation has no row in the list yet.
      setThreads((prev) =>
        prev.some((t) => t.empireId === partner.id)
          ? prev.map((t) =>
              t.empireId === partner.id
                ? { ...t, preview: result.line.body, at: result.line.at, time: result.line.time }
                : t
            )
          : [
              {
                empireId: partner.id,
                name: partner.name,
                preview: result.line.body,
                at: result.line.at,
                time: result.line.time,
                unread: 0,
                online: partnerOnline,
              },
              ...prev,
            ]
      );
    } else {
      setGlobalLines((prev) => mergeLines(prev, [result.line], LINE_CAP));
      store(ROOM_SEEN_KEY, String(result.line.at));
    }
  };

  const hide = async (id: string) => {
    const result = await hideChatMessage(id);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setGlobalLines((prev) => prev.filter((line) => line.id !== id));
    setThreadLines((prev) => prev.filter((line) => line.id !== id));
  };

  // Roster search behind "new conversation" — debounced so typing a name is one
  // query, not one per keystroke.
  const query = search.trim();
  const longEnough = query.length >= CHAT_SEARCH_MIN;
  // Derived rather than stored: "searching" is exactly the state of holding
  // results for some other query than the one in the box.
  const searching = longEnough && results.query !== query;

  useEffect(() => {
    const q = search.trim();
    if (q.length < CHAT_SEARCH_MIN) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchChatPlayers(q);
      if (cancelled) return;
      setResults({ query: q, list: found });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  if (!mounted || typeof document === "undefined") return null;

  // The launcher carries one number, and an answer from the staff counts in it:
  // a reply that is only visible after opening the dock is a reply the player
  // reads tomorrow.
  const totalUnread = unread + staffUnread;
  const badge = totalUnread > 99 ? "99+" : String(totalUnread);
  const typingLine = typingLabel(t, typing);
  // Counted in characters: one emoji is two UTF-16 units and must not read as
  // two of the three hundred a player is allowed.
  const draftLength = [...draft].length;
  // The roster lists everyone you are not already talking to — a name in both
  // places reads as two different players.
  const inThread = new Set(threads.map((thread) => thread.empireId));
  const others = roster.filter((player) => !inThread.has(player.id));
  // Counted over a union of ids: a conversation partner is usually in the
  // roster too, and adding the two lists would count them twice.
  const onlineCount = new Set([
    ...roster.filter((player) => player.online).map((player) => player.id),
    ...threads.filter((thread) => thread.online).map((thread) => thread.empireId),
  ]).size;

  /* -------------------------------------------------------------------- view */

  const launcher = (
    <button
      type="button"
      onClick={() => openDock()}
      aria-label={t("פתיחת הצ׳אט")}
      className="chat-launcher group flex items-center gap-2 rounded-full border border-gold/50 bg-[#12100b]/95 px-3.5 py-2.5 text-gold-bright shadow-[0_10px_30px_rgba(0,0,0,0.75)] backdrop-blur-sm transition-colors hover:border-gold hover:bg-[#1b1710]"
    >
      <Icon name="chat" size={20} />
      <span className="text-sm font-black tracking-wide">{t("צ׳אט")}</span>
      {totalUnread > 0 ? (
        <span className="min-w-5 rounded-full bg-red-600 px-1.5 py-px text-center text-[10px] font-black text-white">
          {badge}
        </span>
      ) : roomDot ? (
        <span className="chat-dot h-2 w-2 rounded-full bg-gold-bright" />
      ) : null}
    </button>
  );

  const composer = (
    <div className="border-t border-border-subtle bg-[#0d0c10]/80 p-2">
      {/* Sits directly above the box you type into — the spot every chat has
          trained people to glance at, and close enough to the last line that it
          reads as part of the conversation rather than as a status bar. */}
      {typingLine && (
        <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-gold-dim">
          <span className="chat-typing flex items-end gap-0.5" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          {typingLine}
        </p>
      )}
      {error && (
        <p className="mb-1.5 rounded border border-red-500/40 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <ChatEmojiPicker onPick={insertEmoji} />
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(clampChars(e.target.value, bodyMax));
            // Nobody is watching a typing indicator on the other side of a
            // support ticket.
            if (!staffOpen && e.target.value.trim().length > 0) pingTyping();
          }}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat on earth has trained players into.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={staffOpen ? 2 : 1}
          placeholder={
            staffOpen
              ? t("מה קרה? כתוב כאן…")
              : partner
                ? t("הודעה אל {name}…", { name: partner.name })
                : t("דבר אל האימפריה…")
          }
          className="chat-scroll max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-border-subtle bg-panel-inset px-2.5 py-2 text-sm text-bone-bright outline-none placeholder:text-bone-dim/70 focus:border-gold/60"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || draft.trim().length === 0}
          className="btn btn-gold h-9 shrink-0 px-3 text-xs"
        >
          {sending ? "…" : t("שלח")}
        </button>
      </div>
      {draftLength > bodyMax - 60 && (
        <p className="mt-1 text-left text-[10px] text-bone-dim">
          {draftLength}/{bodyMax}
        </p>
      )}
    </div>
  );

  const messageList = (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      className="chat-scroll flex-1 space-y-2 overflow-y-auto px-2.5 py-3"
    >
      {lines.length === 0 &&
        (staffOpen ? (
          /* The first thing a player sees after deciding to ask for help. It
             says what this channel is *for* — a report, a complaint, a payment
             that went wrong — because "write to the management" on its own gets
             either nothing or an apology for bothering us. */
          <div className="mt-2 space-y-2 rounded-xl border border-border-subtle bg-panel-inset px-3 py-3">
            <p className="text-xs font-bold text-gold-bright">
              {t("מה תרצה לספר לנו?")}
            </p>
            <p className="text-[11px] leading-relaxed text-bone-dim">
              {t(
                "באג במשחק, שחקן שמתנהג לא יפה, רכישה שלא נכנסה, הצעה לשיפור או כל דבר אחר — כתוב כאן וזה יגיע ישירות אלינו. אנחנו עונים באותו מקום."
              )}
            </p>
          </div>
        ) : (
          <p className="mt-8 text-center text-xs text-bone-dim">
            {partner
              ? t("אין עדיין הודעות בשיחה הזו — כתוב ראשון.")
              : t("החדר שקט. תהיה הראשון שמדבר.")}
          </p>
        ))}
      {lines.map((line) =>
        /* A herald is not somebody talking, so it is deliberately not a bubble
           on either side: a centred, full-width notice with a gold hairline,
           which is the one shape in the room that reads as the game speaking.
           See the note below on why every *player's* line is signed — this is
           the exception that note anticipates. */
        line.system ? (
          <div key={line.id} className="my-1 flex justify-center">
            <div className="w-full rounded-lg border border-gold/30 bg-gold-deep/12 px-3 py-1.5 text-center">
              <p className="whitespace-pre-wrap break-words text-[12px] font-bold leading-relaxed text-gold-bright">
                {line.body}
              </p>
              <span className="nums text-[10px] text-bone-dim/70">{line.time}</span>
            </div>
          </div>
        ) : (
        <div
          key={line.id}
          // dir="rtl", so `start` is the right edge: mine hugs the right, every
          // other player hugs the left. Written as logical classes rather than
          // left/right so the two sides stay mirror images of each other.
          className={`flex ${line.mine ? "justify-start" : "justify-end"}`}
        >
          {/* A column of shrink-to-fit children, not a block: as a block the
              bubble would inherit the width of whichever child is widest — so
              "כן" arrived in a bubble as wide as the name-and-time header above
              it. Each child now measures its own text, and the 85% ceiling is
              where a long line wraps. */}
          <div
            className={`flex max-w-[85%] flex-col ${
              line.mine ? "items-start" : "items-end"
            }`}
          >
            {/* Every line is signed, your own included: in a room where an
                admin, an ally and a stranger all speak, "who said this" is the
                first thing read — and an unsigned bubble reads as a system
                notice rather than as somebody talking. */}
            <div
              // The header block is shrink-to-fit, so on the left-hand side it
              // is reversed to keep the name flush with the bubble's edge
              // instead of the timestamp.
              className={`mb-0.5 flex items-center gap-1.5 px-1 ${
                line.mine ? "" : "flex-row-reverse"
              }`}
            >
              {/* A staff line wears the molten-gold name in all three shapes —
                  the chip beside it says *what* the speaker is, the name says
                  it at a glance while scrolling. `.staff-name` sets its own
                  colour (a gradient fill), so it overrides the text-* utility
                  rather than sitting alongside it. */}
              {line.mine ? (
                <span
                  className={`text-[11px] font-black text-gold ${
                    line.staff ? "staff-name" : ""
                  }`}
                >
                  {line.name}
                </span>
              ) : line.empireId ? (
                <button
                  type="button"
                  onClick={() => openThread(line.empireId!, line.name)}
                  title={t("פתיחת שיחה פרטית")}
                  className={`text-[11px] font-black text-gold-bright hover:underline ${
                    line.staff ? "staff-name" : ""
                  }`}
                >
                  {line.name}
                </button>
              ) : (
                <span
                  className={`text-[11px] font-black text-bone-dim ${
                    line.staff ? "staff-name" : ""
                  }`}
                >
                  {line.name}
                </span>
              )}
              {line.staff && (
                <span className="rounded bg-gold/20 px-1 text-[9px] font-black text-gold-bright">
                  {t("צוות")}
                </span>
              )}
              {/* A letter, not a shout. It was written in the mailbox or on a
                  profile, it may run to three times a chat line's length, and
                  the recipient's inbox rang when it arrived — so it is worth
                  saying which of the two doors it came through. */}
              {line.viaMail && (
                <span
                  title={t("נשלח כהודעה לתיבת הדואר")}
                  aria-label={t("נשלח כהודעה לתיבת הדואר")}
                  className="text-[10px] text-gold-dim"
                >
                  ✉
                </span>
              )}
              {!line.mine && line.empireId && (
                <Link
                  href={`/game/empires/${line.empireId}`}
                  title={t("פרופיל")}
                  className="text-bone-dim transition-colors hover:text-gold-bright"
                >
                  <Icon name="crown" size={11} />
                </Link>
              )}
              <span className="nums text-[10px] text-bone-dim/70">
                {line.time}
              </span>
              {/* Moderation is the chat's broom and only the chat's: a line in
                  the staff thread is not a ChatMessage and its id would not
                  name one. */}
              {canModerate && !line.mine && !staffOpen && (
                <button
                  type="button"
                  onClick={() => void hide(line.id)}
                  title={t("הסתרת ההודעה")}
                  className="text-[10px] text-bone-dim transition-colors hover:text-red-400"
                >
                  ✕
                </button>
              )}
            </div>
            <div
              // Two clearly different bubbles: warm gold for your own voice,
              // a cool slate for everyone else's. Side alone is not enough —
              // a glance at a busy room reads colour before position.
              className={`whitespace-pre-wrap break-words rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${
                line.mine
                  ? "rounded-tr-sm border border-gold/45 bg-gold-deep/40 text-bone-bright"
                  : "rounded-tl-sm border border-[#3a4152] bg-[#1b1f2b] text-bone"
              }`}
            >
              {line.body}
            </div>
          </div>
        </div>
        )
      )}
      {staffOpen && staffClosed && lines.length > 0 && (
        <p className="pt-2 text-center text-[11px] text-bone-dim">
          {t("הפנייה סומנה כטופלה. אם זה עדיין לא נפתר — כתוב שוב כאן.")}
        </p>
      )}
    </div>
  );

  /* The door to the management, pinned above everything else in the private
     tab and drawn whether or not a conversation exists yet.

     It is deliberately the first thing in the list rather than a link buried in
     a settings page: the moment a player wants to report a cheat, a broken
     purchase or a bug is the moment they are least willing to go looking, and
     the private-conversations tab is where a person already goes to say
     something to somebody. Gold-cased and marked "צוות" so it does not read as
     another player. */
  const staffRow = (
    <button
      type="button"
      onClick={() => openStaff()}
      className="mb-3 flex w-full items-center gap-2 rounded-lg border border-gold/45 bg-gold-deep/20 px-2.5 py-2 text-start transition-colors hover:border-gold hover:bg-gold-deep/35"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-gold/50 bg-[#12100b] text-gold-bright">
        <Icon name="crown" size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="staff-name truncate text-[13px] font-black text-gold-bright">
            {t("צוות קראלדור")}
          </span>
          <span className="shrink-0 rounded bg-gold/20 px-1 text-[9px] font-black text-gold-bright">
            {t("הנהלה")}
          </span>
          {staffSummary && (
            <span className="nums shrink-0 text-[10px] text-bone-dim">
              {staffSummary.time}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-bone-dim">
          {staffSummary?.preview || t("פנייה להנהלה — תקלה, דיווח או שאלה")}
        </span>
      </span>
      {staffUnread > 0 && (
        <span className="min-w-5 shrink-0 rounded-full bg-red-600 px-1.5 py-px text-center text-[10px] font-black text-white">
          {staffUnread > 9 ? "9+" : staffUnread}
        </span>
      )}
    </button>
  );

  const threadList = (
    <div className="chat-scroll flex-1 overflow-y-auto p-2">
      {staffRow}
      <div className="mb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("חיפוש שחקן לשיחה חדשה…")}
          className="w-full rounded-lg border border-border-subtle bg-panel-inset px-2.5 py-2 text-sm text-bone-bright outline-none placeholder:text-bone-dim/70 focus:border-gold/60"
        />
        {longEnough && (
          <div className="mt-1 overflow-hidden rounded-lg border border-border-subtle">
            {searching && (
              <p className="px-2.5 py-2 text-xs text-bone-dim">{t("מחפש…")}</p>
            )}
            {!searching && results.list.length === 0 && (
              <p className="px-2.5 py-2 text-xs text-bone-dim">
                {t("לא נמצא שחקן בשם הזה")}
              </p>
            )}
            {!searching &&
              results.list.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() =>
                    openThread(player.id, player.name, player.online)
                  }
                  className="flex w-full items-center gap-2 border-b border-border-subtle/60 px-2.5 py-2 text-start text-sm text-bone transition-colors last:border-0 hover:bg-white/5 hover:text-gold-bright"
                >
                  <PresenceDot online={player.online} />
                  {player.name}
                </button>
              ))}
          </div>
        )}
      </div>

      {threads.length > 0 && (
        <>
          <p className="mb-1 px-1 text-[10px] font-black uppercase tracking-widest text-gold-dim">
            {t("שיחות")}
          </p>
          <ul className="mb-3 space-y-1">
            {threads.map((thread) => (
              <li key={thread.empireId}>
                <button
                  type="button"
                  onClick={() =>
                    openThread(thread.empireId, thread.name, thread.online)
                  }
                  className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-panel-inset px-2.5 py-2 text-start transition-colors hover:border-gold/50 hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <PresenceDot online={thread.online} />
                      <span className="truncate text-[13px] font-black text-gold-bright">
                        {thread.name}
                      </span>
                      <span className="nums shrink-0 text-[10px] text-bone-dim">
                        {thread.time}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-bone-dim">
                      {thread.preview}
                    </span>
                  </span>
                  {thread.unread > 0 && (
                    <span className="min-w-5 shrink-0 rounded-full bg-red-600 px-1.5 py-px text-center text-[10px] font-black text-white">
                      {thread.unread}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* The roster. The tab opens on names rather than on an empty state:
          starting a conversation should not require knowing in advance who to
          look for, and who is online right now is the answer to "who can I
          actually talk to". Players already in the list above are left out so
          each name appears once. */}
      <p className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-black uppercase tracking-widest text-gold-dim">
        {t("שחקנים")}
        <span className="normal-case tracking-normal text-bone-dim">
          {t("({count} מחוברים)", { count: onlineCount })}
        </span>
      </p>
      {others.length === 0 ? (
        <p className="mt-4 text-center text-xs text-bone-dim">
          {roster.length === 0
            ? t("אין עדיין שחקנים אחרים במשחק.")
            : t("כל השחקנים כבר ברשימת השיחות שלך.")}
        </p>
      ) : (
        <ul className="space-y-1">
          {others.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() =>
                  openThread(player.id, player.name, player.online)
                }
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start transition-colors hover:bg-white/5"
              >
                <PresenceDot online={player.online} />
                <span
                  className={`truncate text-[13px] ${
                    player.online ? "text-bone-bright" : "text-bone-dim"
                  }`}
                >
                  {player.name}
                </span>
                <Icon
                  name="chat"
                  size={13}
                  className="ms-auto shrink-0 text-gold-dim"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const panel = (
    <div
      dir={dir}
      // dvh: at 72vh the panel is measured against the toolbar-collapsed height,
      // so on a phone the composer at its foot sat behind the URL bar and the
      // player could read the room but not write to it.
      className="chat-panel flex h-[min(72dvh,30rem)] w-[min(92vw,22.5rem)] flex-col overflow-hidden rounded-2xl border border-gold/40 bg-[#0f0e12]/97 shadow-[0_20px_60px_rgba(0,0,0,0.85)] backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-gold/25 bg-gradient-to-l from-transparent to-gold-deep/25 px-2.5 py-2">
        {staffOpen ? (
          <>
            <button
              type="button"
              onClick={() => {
                setStaffOpen(false);
                setError(null);
              }}
              aria-label={t("חזרה לרשימת השיחות")}
              className="flex h-6 w-6 items-center justify-center rounded text-bone-dim transition-colors hover:bg-white/10 hover:text-gold-bright"
            >
              ›
            </button>
            <Icon name="crown" size={14} className="shrink-0 text-gold" />
            <div className="min-w-0 flex-1">
              <p className="staff-name truncate text-sm font-black text-gold-bright">
                {t("צוות קראלדור")}
              </p>
              <p className="truncate text-[10px] text-bone-dim">
                {t("פנייה להנהלה — נשיב כאן, בדרך כלל תוך כמה שעות")}
              </p>
            </div>
          </>
        ) : partner ? (
          <>
            <button
              type="button"
              onClick={() => {
                setPartner(null);
                setError(null);
              }}
              aria-label={t("חזרה לרשימת השיחות")}
              className="flex h-6 w-6 items-center justify-center rounded text-bone-dim transition-colors hover:bg-white/10 hover:text-gold-bright"
            >
              ›
            </button>
            <PresenceDot online={partnerOnline} />
            <Link
              href={`/game/empires/${partner.id}`}
              className="truncate text-sm font-black text-gold-bright hover:underline"
            >
              {partner.name}
            </Link>
            <span className="shrink-0 text-[10px] text-bone-dim">
              {partnerOnline ? t("מחובר") : t("לא מחובר עכשיו")}
            </span>
          </>
        ) : (
          <>
            <Icon name="chat" size={16} className="shrink-0 text-gold" />
            <div className="flex flex-1 gap-1">
              <button
                type="button"
                onClick={() => switchTab("global")}
                className={`rounded-md px-2 py-1 text-[11px] font-black transition-colors ${
                  tab === "global"
                    ? "bg-gold/20 text-gold-bright"
                    : "text-bone-dim hover:text-bone"
                }`}
              >
                {t("חדר כללי")}
              </button>
              <button
                type="button"
                onClick={() => switchTab("direct")}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-black transition-colors ${
                  tab === "direct"
                    ? "bg-gold/20 text-gold-bright"
                    : "text-bone-dim hover:text-bone"
                }`}
              >
                {t("שיחות פרטיות")}
                {totalUnread > 0 && (
                  <span className="min-w-4 rounded-full bg-red-600 px-1 text-center text-[9px] font-black text-white">
                    {badge}
                  </span>
                )}
              </button>
            </div>
          </>
        )}
        <CloseButton onClick={closeDock} label={t("סגירת הצ׳אט")} className="ms-auto" />
      </div>

      {/* The public room is exactly where someone is already looking for other
          players, so it is where the bigger room is worth mentioning — once,
          quietly, above the log and never inside a private conversation. */}
      {tab === "global" && !partner && !staffOpen && (
        <DiscordLink
          url={discordUrl}
          variant="strip"
          label={t("הקהילה נפגשת בדיסקורד — הצטרפו")}
        />
      )}

      {tab === "direct" && !partner && !staffOpen ? threadList : messageList}
      {(tab === "global" || partner || staffOpen) && composer}
    </div>
  );

  // z-50 puts the dock below every overlay that covers the page — the nav
  // drawer (60) and the modals (95–100). At its old z-[80] the launcher pill
  // floated on top of the season-pass ladder, the mini-game board and the open
  // nav drawer, which read as a stuck widget rather than as a dock. See the
  // stacking order at the top of globals.css.
  return createPortal(
    <div className="fixed bottom-3 left-3 z-50 print:hidden">
      {open ? panel : launcher}
    </div>,
    document.body
  );
}
