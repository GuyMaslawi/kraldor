"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { CloseButton } from "@/components/ui/CloseButton";
import { formatDate } from "@/lib/game/format";
import { dismissAnnouncement, type LiveAlert } from "@/server/actions/messages";
import { useInboxPulse, refreshInboxPulse } from "./inboxPulse";
import { useT, useLocale } from "@/i18n/client";

/**
 * The herald: an admin's word to the whole game, delivered in the middle of the
 * screen instead of the corner.
 *
 * Every other thing that happens to a player — a raid, a caught spy, a letter —
 * is announced by a toast that fades on its own, and that is right, because they
 * are all things the player will find again in the inbox whenever they look. An
 * announcement is the opposite: a bug is fixed, a rule changed, a feature opened,
 * and a player who never learns it goes on playing the old game. So this one
 * stops them, once.
 *
 * "Once" is the whole design, and it is why the acknowledgement is a server
 * write (`dismissAnnouncement` → `readAt`) rather than a localStorage stamp like
 * the toasts use. A patch note dismissed on the desktop must not reappear on the
 * phone at dinner. Reading the mailbox counts as well — that also writes
 * `readAt`, so news the player already went and found is never handed to them a
 * second time as if it were new.
 *
 * The announcements arrive on the shared inbox pulse, so a broadcast sent while
 * the player is standing on a page reaches them within a poll without waiting
 * for a navigation — see `getInboxPulse`, which keeps them out of `alerts` so
 * the same message is never both a toast and a dialog.
 */
export function AnnouncementDialog() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pulse = useInboxPulse();
  const [current, setCurrent] = useState<LiveAlert | null>(null);
  /**
   * Ids already acknowledged in this tab.
   *
   * The server write and the next poll are seconds apart, and in between the
   * pulse still lists the announcement as unread. Without this the dialog would
   * close and immediately reopen on the same message. Cleared by nothing: the
   * set only ever grows within one mount, and a reload starts from a pulse that
   * no longer carries them.
   */
  const dismissedRef = useRef(new Set<string>());

  useEffect(() => {
    if (pulse === null) return;
    // Whatever is open stays open — replacing the card under the player's cursor
    // mid-read would lose them the sentence they were on, and the queue is
    // drained one at a time as each is acknowledged.
    if (current !== null) return;
    const next = pulse.announcements.find(
      (announcement) => !dismissedRef.current.has(announcement.id),
    );
    if (next) setCurrent(next);
  }, [pulse, current]);

  const acknowledge = useCallback(() => {
    const announcement = current;
    if (!announcement) return;
    dismissedRef.current.add(announcement.id);
    // Closed first, told second: the dialog is the player's to dismiss and must
    // never sit there waiting on a round trip. The write is what makes it stay
    // dismissed on their other devices; if it is lost, the dialog opens once
    // more and nothing worse.
    setCurrent(null);
    void dismissAnnouncement(announcement.id).then(() => {
      // The messages badge is one lower, and the announcement may have said the
      // screen behind it now shows something new.
      refreshInboxPulse();
      router.refresh();
    });
  }, [current, router]);

  if (!current) return null;

  return (
    <Dialog open onClose={acknowledge} labelledBy="announcement-title" size="xl">
      {/* The banner: a herald's proclamation, not a system notice. The seal
          swings on its ribbon and the light behind it turns — enough motion to
          say "this is the one that matters" and not so much that the text under
          it is hard to read. */}
      {/* The ✕ is the same acknowledgement as "הבנתי" — dismissing a herald's
          proclamation is dismissing it however it is done, and the server write
          is what stops it coming back on the player's other device. It exists
          because a proclamation can be long, and on a phone the buttons at the
          end of it are a scroll away from where the reading starts. */}
      {/* Sticky, not absolute: the card is its own scroller and a proclamation
          can run past a phone screen. */}
      <div className="sticky top-0 z-20 mb-1 flex justify-end">
        <CloseButton onClick={acknowledge} label={t("סגור את ההכרזה")} />
      </div>

      <div className="ann-banner relative overflow-hidden rounded-xl border border-gold/40 bg-gradient-to-b from-amber-950/70 to-black/50 px-5 py-6 text-center">
        <span className="ann-rays" aria-hidden />
        <span className="ann-seal" aria-hidden>
          📜
        </span>
        <p className="ann-eyebrow mt-3 text-[11px] font-black uppercase tracking-[0.3em] text-gold-dim">
          {t("הכרזת הממלכה")}
        </p>
        <h2
          id="announcement-title"
          className="ann-title mt-1.5 text-xl font-black leading-snug text-gold-bright sm:text-2xl"
        >
          {current.title}
        </h2>
      </div>

      <p className="ann-body mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">
        {current.body}
      </p>

      <p className="mt-3 text-xs text-zinc-500">
        <span className="nums" dir="ltr">
          {formatDate(new Date(current.createdAt), locale)}
        </span>
      </p>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row-reverse sm:items-center">
        <button
          type="button"
          onClick={acknowledge}
          className="btn-gold w-full rounded-lg px-5 py-3 text-sm font-black sm:w-auto"
        >
          {t("הבנתי")}
        </button>
        {/* A broadcast can carry a link to the thing it is about. Following it
            counts as reading it — the player is on their way to look. */}
        {current.href && (
          <Link
            href={current.href}
            onClick={acknowledge}
            className="w-full rounded-lg border border-gold/40 px-5 py-3 text-center text-sm font-bold text-gold-bright transition-colors hover:bg-white/5 sm:w-auto"
          >
            {t("קחו אותי לשם")} ←
          </Link>
        )}
      </div>
    </Dialog>
  );
}
