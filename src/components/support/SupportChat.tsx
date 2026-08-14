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
import { Icon } from "@/components/ui/Icon";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { useDir, useT } from "@/i18n/client";
import { clampChars } from "@/lib/game/text";
import {
  SUPPORT_BODY_MAX,
  SUPPORT_POLL_CLOSED_MS,
  SUPPORT_POLL_OPEN_MS,
} from "@/lib/support";
import {
  getSupportChat,
  sendSupportMessage,
  type SupportLine,
} from "@/server/actions/support";

/**
 * The support dock: a launcher in the corner of every screen in front of the
 * game, and the conversation behind it.
 *
 * It exists because the login screen is the one place in the app where a player
 * can be completely stuck with nowhere to turn — the verification mail never
 * arrived, the Google button loops, the password reset does nothing, a payment
 * went through on an account that will not open. All of those happen *before*
 * the session, so the in-game chat cannot help: it is addressed by empire id and
 * refuses everyone without one. A link to Discord (which is also on this page)
 * asks someone already frustrated to sign up for a second service first.
 *
 * Shaped like the game's own ChatDock on purpose — same corner, same launcher,
 * same panel — so it is recognised before it is read.
 *
 * Polling follows attention and, unlike the game's dock, follows *existence*: a
 * visitor who has never written to us has no thread, so the widget makes no
 * requests at all until they do. That matters because this component renders for
 * every anonymous visitor to the login page, most of whom will never open it.
 */

const OPEN_KEY = "kraldor-support-open";

/** Cross-component "open the support chat, and put this in the box". Dispatched
 *  by the auth forms when they show an error — see AuthErrorHelp. */
export const SUPPORT_OPEN_EVENT = "kraldor:support-open";

export type SupportOpenDetail = { prefill?: string };

/** Open the dock from anywhere on the page, optionally with a first draft. */
export function openSupportChat(detail: SupportOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent(SUPPORT_OPEN_EVENT, { detail }));
}

/* Whether the panel is open survives a navigation (login → register → verify),
 * so it lives in localStorage and is read through a real external store — the
 * server has no localStorage, so the server snapshot is "shut" and React
 * re-renders once it hydrates. Same pattern, and same reasons, as ChatDock. */
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
    // Private-mode browsers: the dock just forgets between loads.
  }
  listeners.forEach((fn) => fn());
}

const isOpenSnapshot = () => readStored(OPEN_KEY) === "1";
const isOpenServerSnapshot = () => false;
const hydratedSnapshot = () => true;
const hydratedServerSnapshot = () => false;

/** Merge polled lines into what is on screen, dropping ids already held. The
 *  server overlaps its cursor by a millisecond on purpose. */
function mergeLines(current: SupportLine[], incoming: SupportLine[]) {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((line) => line.id));
  const fresh = incoming.filter((line) => !seen.has(line.id));
  return fresh.length === 0 ? current : [...current, ...fresh];
}

export function SupportChat({
  /** Whether this browser already has a conversation — resolved on the server
   *  from the cookie, so the first paint knows whether to poll. */
  hasThread = false,
  discordUrl = null,
}: {
  hasThread?: boolean;
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

  const [exists, setExists] = useState(hasThread);
  const [closed, setClosed] = useState(false);
  const [lines, setLines] = useState<SupportLine[]>([]);
  const [unread, setUnread] = useState(0);
  const [email, setEmail] = useState("");
  /** The address already on the ticket — once we have one, we stop asking. */
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const linesRef = useRef<SupportLine[]>([]);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const openDock = useCallback(() => store(OPEN_KEY, "1"), []);
  const closeDock = useCallback(() => store(OPEN_KEY, "0"), []);

  /* ---------------------------------------------------------------- polling */

  useEffect(() => {
    if (!mounted) return;
    // Nothing to poll for: no conversation, and the panel is shut. This is the
    // state almost every visitor to the login page is in, and it must cost
    // nothing at all.
    if (!exists && !open) return;

    let cancelled = false;

    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      // A shut panel with no thread has nothing to ask about.
      if (!exists) return;
      const since = linesRef.current.at(-1)?.at;
      const view = await getSupportChat({ sinceMs: since, reading: open });
      if (cancelled || !view.exists) return;
      setLines((prev) => (since ? mergeLines(prev, view.lines) : view.lines));
      setUnread(view.unread);
      setClosed(view.status === "CLOSED");
      setSavedEmail(view.email);
    };

    void poll();
    const interval = setInterval(
      () => void poll(),
      open ? SUPPORT_POLL_OPEN_MS : SUPPORT_POLL_CLOSED_MS
    );
    // Coming back to the tab should feel instant, not "in thirty seconds".
    const onWake = () => void poll();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [mounted, open, exists]);

  /* ------------------------------------------------------- opened from afar */

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<SupportOpenDetail>).detail ?? {};
      openDock();
      if (detail.prefill) {
        // Never over an unsent draft: someone who has already started typing
        // their own account of the problem must not lose it to a canned one.
        setDraft((prev) => (prev.trim().length > 0 ? prev : detail.prefill!));
      }
      setTimeout(() => inputRef.current?.focus(), 60);
    };
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, [openDock]);

  /* --------------------------------------------------------------- scrolling */

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /* ------------------------------------------------------------------ send */

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const result = await sendSupportMessage({
      body,
      email: savedEmail ? null : email.trim() || null,
      // The browser knows the screen it is on; the server can only guess it
      // from a referer.
      path: window.location.pathname,
    });
    setSending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDraft("");
    stickRef.current = true;
    setExists(true);
    setClosed(false);
    if (!savedEmail && email.trim()) setSavedEmail(email.trim());
    setLines((prev) => mergeLines(prev, [result.line]));
  };

  if (!mounted || typeof document === "undefined") return null;

  const draftLength = [...draft].length;
  const badge = unread > 9 ? "9+" : String(unread);

  /* -------------------------------------------------------------------- view */

  const launcher = (
    <button
      type="button"
      onClick={openDock}
      aria-label={t("פתיחת צ׳אט התמיכה")}
      className="chat-launcher group flex items-center gap-2 rounded-full border border-gold/50 bg-[#12100b]/95 px-3.5 py-2.5 text-gold-bright shadow-[0_10px_30px_rgba(0,0,0,0.75)] backdrop-blur-sm transition-colors hover:border-gold hover:bg-[#1b1710]"
    >
      <Icon name="chat" size={20} />
      <span className="text-sm font-black tracking-wide">{t("תמיכה")}</span>
      {unread > 0 && (
        <span className="min-w-5 rounded-full bg-red-600 px-1.5 py-px text-center text-[10px] font-black text-white">
          {badge}
        </span>
      )}
    </button>
  );

  const panel = (
    <div
      dir={dir}
      // dvh, not vh: at 72vh the panel is measured against the toolbar-collapsed
      // height, and on a phone the composer at its foot hides behind the URL bar
      // — you could read the answer but not write back.
      className="chat-panel flex h-[min(72dvh,32rem)] w-[min(92vw,22.5rem)] flex-col overflow-hidden rounded-2xl border border-gold/40 bg-[#0f0e12]/97 shadow-[0_20px_60px_rgba(0,0,0,0.85)] backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-gold/25 bg-gradient-to-l from-transparent to-gold-deep/25 px-2.5 py-2">
        <Icon name="chat" size={16} className="shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-gold-bright">
            {t("תמיכה")}
          </p>
          <p className="truncate text-[10px] text-bone-dim">
            {t("צוות קראלדור — נשיב כאן, בדרך כלל תוך כמה שעות")}
          </p>
        </div>
        <CloseButton onClick={closeDock} label={t("סגירת צ׳אט התמיכה")} />
      </div>

      <DiscordLink
        url={discordUrl}
        variant="strip"
        label={t("אפשר גם בדיסקורד — יש שם מי שעונה")}
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        className="chat-scroll flex-1 space-y-2 overflow-y-auto px-2.5 py-3"
      >
        {lines.length === 0 && (
          <div className="mt-2 space-y-2 rounded-xl border border-border-subtle bg-panel-inset px-3 py-3">
            <p className="text-xs font-bold text-gold-bright">
              {t("נתקעת? ספר לנו מה קרה.")}
            </p>
            <p className="text-[11px] leading-relaxed text-bone-dim">
              {t(
                "לא הגיע מייל אימות, ההרשמה נתקעת, ההתחברות עם גוגל לא עובדת, שילמת ולא קיבלת — כתוב כאן ונטפל בזה. אם תשאיר אימייל נוכל לחזור אליך גם אם תסגור את החלון."
              )}
            </p>
          </div>
        )}
        {lines.map((line) => (
          <div
            key={line.id}
            // dir="rtl", so `start` is the right edge: our replies hug the left,
            // the visitor's own words hug the right — the same arrangement as
            // the game's chat, where "mine" is on the start side.
            className={`flex ${line.fromStaff ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`flex max-w-[85%] flex-col ${
                line.fromStaff ? "items-end" : "items-start"
              }`}
            >
              <div className="mb-0.5 flex items-center gap-1.5 px-1">
                <span
                  className={`text-[11px] font-black ${
                    line.fromStaff ? "staff-name text-gold-bright" : "text-gold"
                  }`}
                >
                  {line.fromStaff ? t("צוות קראלדור") : line.name}
                </span>
                <span className="nums text-[10px] text-bone-dim/70">{line.time}</span>
              </div>
              <div
                className={`whitespace-pre-wrap break-words rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${
                  line.fromStaff
                    ? "rounded-tl-sm border border-[#3a4152] bg-[#1b1f2b] text-bone"
                    : "rounded-tr-sm border border-gold/45 bg-gold-deep/40 text-bone-bright"
                }`}
              >
                {line.body}
              </div>
            </div>
          </div>
        ))}
        {closed && lines.length > 0 && (
          <p className="pt-2 text-center text-[11px] text-bone-dim">
            {t("הפנייה סומנה כטופלה. אם זה עדיין לא נפתר — כתוב שוב כאן.")}
          </p>
        )}
      </div>

      <div className="border-t border-border-subtle bg-[#0d0c10]/80 p-2">
        {error && (
          <p className="mb-1.5 rounded border border-red-500/40 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {error}
          </p>
        )}
        {/* Asked once, and only while we have no way to reach them. A visitor
            who already gave an address (or who is signed in and simply stuck)
            should not see a form field every time they write a line. */}
        {!savedEmail && (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.slice(0, 254))}
            dir="ltr"
            placeholder={t("אימייל לחזרה (לא חובה)")}
            className="mb-1.5 w-full rounded-lg border border-border-subtle bg-panel-inset px-2.5 py-1.5 text-xs text-bone-bright outline-none placeholder:text-bone-dim/70 focus:border-gold/60"
          />
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(clampChars(e.target.value, SUPPORT_BODY_MAX))}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line. A support message is
              // often several lines long, which is exactly why the break has to
              // be reachable without losing the send shortcut everyone knows.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={t("מה קרה? כתוב כאן…")}
            className="chat-scroll max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-border-subtle bg-panel-inset px-2.5 py-2 text-sm text-bone-bright outline-none placeholder:text-bone-dim/70 focus:border-gold/60"
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
        {draftLength > SUPPORT_BODY_MAX - 120 && (
          <p className="mt-1 text-left text-[10px] text-bone-dim">
            {draftLength}/{SUPPORT_BODY_MAX}
          </p>
        )}
      </div>
    </div>
  );

  // Same corner and the same z-50 as the game's chat dock — below every overlay
  // (nav drawer, modals) and above the page. See the stacking order at the top
  // of globals.css.
  return createPortal(
    <div className="fixed bottom-3 left-3 z-50 print:hidden">
      {open ? panel : launcher}
    </div>,
    document.body
  );
}
