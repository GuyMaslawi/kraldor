"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getChatThread, type ChatLine } from "@/server/actions/chat";
import { replyToPlayer } from "@/server/actions/messages";
import { MESSAGE_BODY_MAX } from "@/lib/game/messages";
import { clampChars } from "@/lib/game/text";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { useT } from "@/i18n/client";

/**
 * How often an open conversation re-reads itself.
 *
 * Slower than the dock's 4s: this is a mailbox, and the person on the other end
 * of a letter is by assumption not sitting in it. Fast enough that two players
 * who *are* both here can hold a conversation without either of them wondering
 * whether it arrived.
 */
const POLL_MS = 8_000;

/**
 * "Reply" — the conversation with one player, opened from a letter in the
 * mailbox or from a profile.
 *
 * ## Why this reads the chat's transcript and not the inbox
 *
 * The mailbox is a list of *notifications*, one row per letter, oldest to
 * newest, mixed in with battle reports and quest hauls. That is the right shape
 * for "what happened while I was away" and the wrong shape entirely for "what
 * are we talking about" — a reply written against a single row is a reply
 * written with the rest of the conversation off-screen, which is exactly why
 * there was nothing to press here before.
 *
 * So this reads `getChatThread`, the *same* call the chat dock's private thread
 * makes, over the same rows. A letter writes into that transcript when it is
 * sent (see `deliverPlayerMail`), so everything said through either door is
 * here: the letters, and whatever was typed into the dock in between. Two
 * doors, one history — which is the whole point, and is true by construction
 * rather than by anything being copied or kept in step.
 *
 * What it *sends* is still a letter (`replyToPlayer`): it lands in the other
 * side's mailbox and rings their badge, because somebody who answers from the
 * mailbox is writing to somebody who reads their mail. The dock is where you
 * write to somebody who is standing there.
 */
export function MessageThread({
  partner,
  triggerLabel = "השב",
  triggerClassName = "btn btn-ghost px-3 py-1.5 text-xs",
  triggerTitle,
}: {
  partner: { id: string; name: string };
  /** i18n-keys: defaults the component runs through t() itself. */
  triggerLabel?: string;
  triggerClassName?: string;
  triggerTitle?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  /** False until the first load answers — "no history yet" and "not loaded yet"
   *  are different empty states and only one of them gets the explainer. */
  const [loaded, setLoaded] = useState(false);
  /**
   * Rounds in a row that came back with nothing.
   *
   * `getChatThread` answers with a null partner for two very different reasons:
   * the poll ceiling refused this round (transient, gone in eight seconds), or
   * the partner is banned or deleted (permanent). Neither is distinguishable
   * from the other in one answer, so the count is what separates them — one
   * failure keeps saying "loading", a run of them says so. Without this the
   * dialog sat on "טוען…" forever for a conversation that was never going to
   * arrive.
   */
  const [misses, setMisses] = useState(0);
  const [online, setOnline] = useState<boolean | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Load the whole tail, every time.
   *
   * The dock cursors its polls (`sinceMs`) because it holds a transcript open
   * for as long as the tab lives; this dialog holds one for as long as somebody
   * is reading it, and the thread page is bounded at CHAT_THREAD_PAGE_SIZE
   * either way. Re-reading it is one indexed query and removes every question
   * about merging, ordering and duplicate ids.
   */
  const load = useCallback(async () => {
    const view = await getChatThread(partner.id);
    // A refused poll (the ceiling) answers with a null partner, and so does a
    // partner who has since been banned. Neither is a reason to blank a
    // transcript that is on screen and being read — only to count the miss.
    if (!view.partner) {
      setMisses((n) => n + 1);
      return;
    }
    setMisses(0);
    setLines(view.lines);
    setOnline(view.partner.online);
    setLoaded(true);
  }, [partner.id]);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      // A backgrounded tab must not keep asking. `load` is a no-op on a refused
      // poll anyway, but the cheapest refusal is the one never sent.
      if (document.visibilityState === "hidden") return;
      void load().catch(() => {
        // A missed round just retries; never surface a poll failure over
        // something half-written.
      });
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [open, load]);

  // Pinned to the newest line whenever the transcript grows. Unconditional on
  // purpose: the pane is short, the reason it is open is the message at the
  // bottom, and there is no "scrolled up to read history" state to protect
  // because the whole history fits in one page.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const result = await replyToPlayer({ toEmpireId: partner.id, body });
    setSending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDraft("");
    // The reply is now a row in the transcript this dialog is reading, so it
    // arrives the same way the other side's does — no optimistic copy to
    // reconcile, and no way for the two to disagree.
    await load();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setLoaded(false);
          setMisses(0);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        title={triggerTitle ? t(triggerTitle) : undefined}
        className={triggerClassName}
      >
        <Icon name="messages" size={14} /> {t(triggerLabel)}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="thread-title"
        size="lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="thread-title"
              className="flex items-center gap-2 text-lg font-black text-gold-bright"
            >
              <span className="truncate">{partner.name}</span>
              <PresenceDot online={online} />
            </h2>
            <Link
              href={`/game/empires/${partner.id}`}
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-gold-bright"
            >
              <Icon name="crown" size={12} /> {t("לפרופיל")}
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("סגירה")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle text-zinc-400 transition-colors hover:border-crimson/50 hover:text-crimson-bright"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* the transcript */}
        <div
          ref={scrollRef}
          className="mt-3 max-h-[45dvh] space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-border-subtle bg-panel-inset p-3"
        >
          {!loaded ? (
            <p className="py-6 text-center text-xs text-zinc-500">
              {misses >= 2
                ? t("לא הצלחנו לטעון את השיחה — נסה שוב בעוד רגע.")
                : t("טוען…")}
            </p>
          ) : lines.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">
              {t("אין עדיין שיחה ביניכם — ההודעה הראשונה תפתח אותה.")}
            </p>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                // dir is rtl on the dialog, so `justify-start` is the right edge:
                // my own lines hug it, the other side hugs the left. Same
                // mirroring the chat dock uses, so a conversation looks the same
                // through both doors.
                className={`flex ${line.mine ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`flex max-w-[85%] flex-col ${
                    line.mine ? "items-start" : "items-end"
                  }`}
                >
                  <div
                    className={`mb-0.5 flex items-center gap-1.5 px-1 ${
                      line.mine ? "" : "flex-row-reverse"
                    }`}
                  >
                    <span className="text-[11px] font-black text-gold">
                      {line.mine ? t("אתה") : line.name}
                    </span>
                    {/* Which door the line came through. A letter is longer, was
                        written to somebody who was not expected to be reading,
                        and rang their mailbox — all of which changes how it is
                        read, and none of which the words themselves say. */}
                    {line.viaMail && (
                      <span
                        title={t("נשלח כהודעה לתיבת הדואר")}
                        className="text-[10px] text-gold-dim"
                        aria-label={t("נשלח כהודעה לתיבת הדואר")}
                      >
                        ✉
                      </span>
                    )}
                    <span className="nums text-[10px] text-zinc-500">{line.time}</span>
                  </div>
                  <div
                    className={`whitespace-pre-wrap break-words rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${
                      line.mine
                        ? "rounded-tr-sm border border-gold/45 bg-gold-deep/40 text-zinc-100"
                        : "rounded-tl-sm border border-border-subtle bg-panel text-zinc-200"
                    }`}
                  >
                    {line.body}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* the reply */}
        <div className="mt-3">
          <label htmlFor="thread-reply" className="sr-only">
            {t("תוכן ההודעה")}
          </label>
          <textarea
            id="thread-reply"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(clampChars(e.target.value, MESSAGE_BODY_MAX))}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line. A reply here is
              // usually one sentence; the paragraph case keeps its modifier.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder={t("כתוב תשובה…")}
            className="w-full resize-y rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none"
          />
          {error && <p className="mt-1 text-xs font-bold text-red-400">{error}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500">
              {t("התשובה תגיע לתיבת הדואר שלו ותופיע גם בשיחה הפרטית בצ׳אט.")}
            </p>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || draft.trim().length === 0}
              className="btn btn-gold shrink-0 disabled:opacity-50"
            >
              {sending ? t("שולח...") : t("שליחה")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
