"use client";

import { Icon } from "@/components/ui/Icon";
import { openStaffChat } from "@/components/game/ChatDock";
import { useT } from "@/i18n/client";

/**
 * "Write to the management" — the mailbox's door into the staff conversation.
 *
 * It opens the chat dock rather than sending anything of its own, and that is
 * the whole design decision: there is exactly one channel to the staff (see
 * server/actions/support.ts), so a second one built on player mail would answer
 * into a different inbox than the one the player is watching, and would vanish
 * with the empire at the end of a season — taking a payment dispute with it.
 *
 * It lives here because the mailbox is where a player goes when they have
 * something to say to somebody, and "somebody" is often us.
 */
export function ContactStaff({
  label = "פנייה להנהלה",
  prefill,
  className = "btn btn-ghost px-4 py-2 text-sm",
  onOpen,
}: {
  label?: string;
  /** A first draft, for a doorway that already knows what it is about. */
  prefill?: string;
  className?: string;
  /** Whatever the caller has to shut behind it — a dialog, usually. */
  onOpen?: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.();
        openStaffChat({ prefill });
      }}
      className={className}
    >
      <Icon name="crown" size={16} /> {t(label)}
    </button>
  );
}
