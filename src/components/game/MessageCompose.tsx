"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  searchMessageRecipients,
  sendPlayerMessage,
} from "@/server/actions/messages";
import {
  MESSAGE_BODY_MAX,
  MESSAGE_MAX_RECIPIENTS,
  MESSAGE_SEARCH_MIN,
} from "@/lib/game/messages";
import type { ActionState } from "@/server/actions/game";
import { Dialog } from "@/components/ui/Dialog";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Icon } from "@/components/ui/Icon";
import { ContactStaff } from "@/components/game/ContactStaff";
import { useT } from "@/i18n/client";

export type PlayerOption = { id: string; name: string };

/**
 * "Send a message" box: pick one or more players out of the game's roster (a
 * closed list — you can only write to empires that exist, never to a free-text
 * name), and write.
 *
 * What it sends is a letter *and* a line in the private conversation with each
 * addressee — the same conversation the chat dock opens. See
 * `deliverPlayerMail`: the mailbox and the dock are two doors onto one
 * transcript, so a letter written here is already there when the other side
 * answers from the chat, and their answer is here when this box is opened
 * again. `MessageThread` is the reply half of the same idea.
 *
 * `players` is a *seed*, not the roster: an alphabetical first page the list
 * shows at rest. Typing queries the server (searchMessageRecipients) instead of
 * filtering a copy of the whole directory in the browser — see
 * MESSAGE_ROSTER_SEED for why. The picked addressees are held as whole
 * `{id, name}` pairs rather than ids, because a name that came back from a
 * search has to keep rendering in its chip after the search that found it is
 * gone from the list.
 *
 * This is the *broadcast* door — one letter, up to MESSAGE_MAX_RECIPIENTS
 * addressees, none of whom you are necessarily mid-conversation with. Writing to
 * one player you already know is `MessageThread` instead, which opens what the
 * two of you have already said rather than a blank page; it took over the
 * profile buttons this component used to serve with a `lockedRecipient` prop.
 * Mail is gated on neither city nor level in either door.
 */
export function MessageCompose({
  players = [],
  // i18n-keys: a default the component runs through t() itself, so callers pass Hebrew
  triggerLabel = "שלח הודעה",
  triggerClassName = "btn btn-gold px-4 py-2 text-sm",
}: {
  players?: PlayerOption[];
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PlayerOption[]>([]);
  const [query, setQuery] = useState("");
  // Tagged with the query it answers, so "is this result current?" is a
  // comparison rather than a second piece of state the effect has to clear.
  const [found, setFound] = useState<{ q: string; rows: PlayerOption[] } | null>(
    null
  );
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(
    sendPlayerMessage,
    {}
  );

  // A delivered message empties the composer so the next one starts blank.
  // Done as a render-phase adjustment (React's "derive state from props"
  // pattern) rather than an effect — the action always returns a fresh state
  // object, so identity is what marks a new result.
  const [handledState, setHandledState] = useState<ActionState>(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success) {
      setSelected([]);
      setQuery("");
      setFound(null);
      setFormKey((k) => k + 1);
    }
  }

  const trimmed = query.trim();
  const searchable = trimmed.length >= MESSAGE_SEARCH_MIN;

  // Ask the server for anything past the seed. Debounced so a typed name is one
  // query rather than one per keystroke, and guarded by `stale` so a slow early
  // reply cannot overwrite the answer to what is in the box now.
  useEffect(() => {
    if (!open || !searchable) return;
    let stale = false;
    const timer = setTimeout(() => {
      void searchMessageRecipients(trimmed)
        .then((rows) => {
          if (!stale) setFound({ q: trimmed, rows });
        })
        .catch(() => {
          if (!stale) setFound({ q: trimmed, rows: [] });
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, searchable, trimmed]);

  const matches = useMemo(() => {
    // Below the search floor a single character still narrows the seed locally —
    // that costs nothing, and an empty box shows the seed as it came.
    if (!searchable) {
      const q = trimmed.toLowerCase();
      return q ? players.filter((p) => p.name.toLowerCase().includes(q)) : players;
    }
    return found?.q === trimmed ? found.rows : [];
  }, [players, found, searchable, trimmed]);

  /** The box holds a query the server has not answered yet. */
  const searching = searchable && found?.q !== trimmed;

  const atCap = selected.length >= MESSAGE_MAX_RECIPIENTS;

  function toggle(player: PlayerOption) {
    setSelected((prev) =>
      prev.some((p) => p.id === player.id)
        ? prev.filter((p) => p.id !== player.id)
        : prev.length >= MESSAGE_MAX_RECIPIENTS
          ? prev
          : [...prev, player]
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName}
      >
        <Icon name="messages" size={16} /> {t(triggerLabel)}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="compose-title"
        size="lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="compose-title" className="text-lg font-black text-gold-bright">
            {t("הודעה חדשה")}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("סגירה")}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-zinc-400 transition-colors hover:border-crimson/50 hover:text-crimson-bright"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form key={formKey} action={action} className="mt-4 space-y-3">
          {/* recipients — the closed list of the game's players */}
          <div>
            <label
              htmlFor="msg-search"
              className="mb-1.5 block text-xs font-semibold text-gold"
            >
              {t("נמענים")} ({selected.length}/{MESSAGE_MAX_RECIPIENTS})
            </label>

            {selected.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selected.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs font-bold text-gold-bright"
                  >
                    {p.name}
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      aria-label={t("הסרת {name}", { name: p.name })}
                      className="text-gold-dim hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* The picked ids ride along with the form submission. */}
            {selected.map((p) => (
              <input key={p.id} type="hidden" name="recipients" value={p.id} />
            ))}

            <input
              id="msg-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("חיפוש שחקן לפי שם אימפריה")}
              className="w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none"
            />

            <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-border-subtle bg-panel-inset p-1">
              {searching ? (
                <li className="px-2 py-3 text-center text-xs text-zinc-500">
                  {t("מחפש…")}
                </li>
              ) : matches.length === 0 ? (
                <li className="px-2 py-3 text-center text-xs text-zinc-500">
                  {t("לא נמצא שחקן בשם הזה.")}
                </li>
              ) : (
                matches.map((p) => {
                  const checked = selected.some((s) => s.id === p.id);
                  return (
                    <li key={p.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                          checked
                            ? "bg-gold/12 text-gold-bright"
                            : "text-zinc-300 hover:bg-white/5"
                        } ${!checked && atCap ? "opacity-40" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && atCap}
                          onChange={() => toggle(p)}
                          className="accent-[var(--gold)]"
                        />
                        <span className="truncate font-semibold">{p.name}</span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
            {!searchable && players.length > 0 && (
              <p className="mt-1 text-[11px] text-zinc-500">
                {t("מוצגים {count} השחקנים הראשונים — הקלד שם כדי לחפש בכל המשחק.", {
                  count: players.length,
                })}
              </p>
            )}
            {atCap && (
              <p className="mt-1 text-[11px] text-zinc-500">
                {t("הגעת למקסימום {max} נמענים בהודעה אחת.", {
                  max: MESSAGE_MAX_RECIPIENTS,
                })}
              </p>
            )}
          </div>

          {/* body. There is no subject line: it was a required field above
              every letter that nobody read and most people filled with the
              first words of the message again. The mailbox titles a letter
              itself now, from who sent it. */}
          <div>
            <label
              htmlFor="msg-body"
              className="mb-1.5 block text-xs font-semibold text-gold"
            >
              {t("תוכן ההודעה")}
            </label>
            <textarea
              id="msg-body"
              name="body"
              required
              rows={5}
              maxLength={MESSAGE_BODY_MAX}
              placeholder={t("עד {max} תווים", { max: MESSAGE_BODY_MAX })}
              className="w-full resize-y rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none"
            />
          </div>

          <FormMessage error={state.error} success={state.success} />

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500">
              {t("ההודעה תגיע לתיבת הדואר של הנמענים ותופיע גם בשיחה הפרטית איתם בצ׳אט.")}
              {/* Somebody who opened this box to report a player or a broken
                  purchase is in the wrong place — mail addressed at a guess to
                  an admin's own empire is a letter, not a ticket. One line
                  here, pointing at the channel that is actually watched. */}
              <br />
              <ContactStaff
                // i18n-keys: ContactStaff runs label through t()
                label="רוצה לפנות להנהלה?"
                className="font-bold text-gold-bright underline-offset-2 hover:underline"
                onOpen={() => setOpen(false)}
              />
            </p>
            <SubmitButton
              className="btn btn-gold"
              disabled={selected.length === 0}
              pendingText={t("שולח...")}
            >
              {t("שליחה")}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
