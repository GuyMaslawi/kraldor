"use client";

import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { NavLink } from "@/components/ui/NavLink";
import { Tip } from "@/components/ui/Tip";
import { useInboxPulse } from "./inboxPulse";
import { useT, useDir } from "@/i18n/client";

export type InboxNavProps = {
  /**
   * Incoming reports since the last visit to the history page (red badge):
   * attacks on me and enemy spies I caught. My own attacks and missions never
   * count — they are not news to the player who ordered them.
   *
   * Server-rendered, and only the opening value: once the live pulse answers it
   * takes over (see below), so a player standing still on one screen watches
   * the number climb as the raids land.
   */
  newReports?: number;
  /** Unread inbox messages (green badge). Same handover to the live pulse. */
  unreadMessages?: number;
  /** Achievement rewards unlocked and not yet collected (gold badge). */
  collectableAchievements?: number;
};

type Entry = {
  href: string;
  label: string;
  icon: IconName;
  tip: string;
  count: number;
  /** Badge + glow color: red for history, green for messages, gold for rewards. */
  tone: "red" | "green" | "gold";
  /**
   * Hide the pill entirely at count 0. History, messages and the prize hall are
   * permanent destinations; the rewards pill is a nudge, so it earns its space
   * in an already-crowded bar only while something is actually waiting.
   */
  onlyWhenWaiting?: boolean;
  /**
   * Walking in is what clears this badge — the destination marks its content
   * seen on arrival. Rewards are the exception: they are cleared by collecting
   * them, not by looking at them, so the gold pill keeps counting while you
   * stand on the achievements page.
   */
  clearsOnVisit?: boolean;
};

const TONE = {
  red: {
    badge: "bg-red-500 text-white",
    active: "border-red-500/70 text-white",
    idle: "text-red-300/90",
    glow: "inbox-glow-red",
  },
  green: {
    badge: "bg-emerald-500 text-black",
    active: "border-emerald-400/70 text-white",
    idle: "text-emerald-300/90",
    glow: "inbox-glow-green",
  },
  gold: {
    badge: "bg-gold text-black",
    active: "border-gold/70 text-white",
    idle: "text-gold-bright",
    glow: "inbox-glow-gold",
  },
} as const;

/**
 * History, messages, the prize hall and unclaimed rewards, parked in the free
 * space of the top command bar so all of them are reachable from every screen.
 * Each carries its own colored counter badge and pulses while it has something
 * waiting, so an update can't be missed.
 */
export function InboxNav({
  newReports = 0,
  unreadMessages = 0,
  collectableAchievements = 0,
}: InboxNavProps) {
  const pathname = usePathname();
  const t = useT();
  const dir = useDir();

  /**
   * The live counts, once the shared poller has answered. Being attacked or
   * mailed is something *another player* does to you, so the number has to be
   * able to change while you sit on a screen you never reload — the whole point
   * of the badge is that it is the thing you notice without looking for it.
   *
   * The pulse wins outright rather than being maxed against the props: the
   * props are a snapshot from whenever this screen was last server-rendered,
   * which after a few minutes of standing still is the older of the two.
   * Achievements stay server-only — nobody else can complete one for you, so
   * every path that changes that count already re-renders the layout.
   */
  const pulse = useInboxPulse();
  const liveReports = pulse?.newReports ?? newReports;
  const liveMessages = pulse?.unreadMessages ?? unreadMessages;

  const allEntries: Entry[] = [
    {
      href: "/game/reports",
      label: t("היסטוריה"),
      icon: "reports",
      tip: t(
        "היסטוריית קרבות וריגול — תקיפות עליי, תקיפות שלי, ריגול עליי וריגול שלי. ההתראה נדלקת רק כשתוקפים או מרגלים עליי"
      ),
      count: liveReports,
      tone: "red",
      clearsOnVisit: true,
    },
    {
      href: "/game/messages",
      label: t("הודעות"),
      icon: "messages",
      tip: t(
        "תיבת הדואר: הודעות משחקנים, התראות על התקפות, מרגלים שנתפסו ועדכוני מערכת"
      ),
      count: liveMessages,
      tone: "green",
      clearsOnVisit: true,
    },
    {
      // The season's stakes, parked beside the inbox rather than buried in the
      // nav list: what the ladder is actually worth should be one glance away
      // from every screen, on the same row the player already watches.
      href: "/game/prizes",
      label: t("פרסים"),
      icon: "crown",
      tip: t(
        "פרסי העונה — יהלומים לשלושת הראשונים בסיום העונה, והדירוג החי שקובע מי יושב על כל מדרגה"
      ),
      count: 0,
      tone: "gold",
    },
    {
      href: "/game/achievements",
      label: t("תגמולים"),
      icon: "gift",
      tip: t("יש לך הישגים שהושלמו וממתינים לאיסוף — היכנס ואסוף את התגמולים"),
      count: collectableAchievements,
      tone: "gold",
      onlyWhenWaiting: true,
    },
  ];

  /**
   * Standing on the destination is enough to put its badge out.
   *
   * The counts arrive server-rendered, while the write that actually marks the
   * mail read runs *after* the page paints (MarkSeen → markMessagesRead), so
   * without this the player sits inside the inbox for a whole round trip with
   * "3 new" still pulsing at them — which reads as broken, and worse, teaches
   * them the badge is noise. Walking in is the acknowledgement; the server
   * write behind it is what makes it stick after they leave.
   *
   * Deliberately not a subtraction against the count seen on arrival: mail that
   * lands while the player is parked on the inbox stays silent here, but it is
   * already announced by the live toast (WarAlerts) and by the page itself, and
   * a counter that flickers back to life on the screen that is supposed to be
   * clearing it is worse than one that waits until they walk away.
   */
  const entries = allEntries
    .map((e) => ({
      ...e,
      count: e.clearsOnVisit && pathname.startsWith(e.href) ? 0 : e.count,
    }))
    .filter((e) => !e.onlyWhenWaiting || e.count > 0);

  return (
    // Inside the command bar, which is dir="ltr" so the emblem keeps the same
    // corner in both languages — these pills read in the document's direction.
    <div dir={dir} className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      {entries.map((e) => {
        const active = pathname.startsWith(e.href);
        const tone = TONE[e.tone];
        return (
          <Tip key={e.href} tip={e.tip} side="bottom">
            <NavLink
              href={e.href}
              // Same reasoning as the sidebar tiles (see Sidebar's navGroups):
              // these pills sit in the command bar on every screen, so the
              // default viewport prefetch renders each destination on the
              // server again every time any page in the game is opened —
              // while a flat `prefetch={false}` leaves the click with nothing
              // to show until the server answers. NavLink is both halves.
              aria-label={
                e.count > 0
                  ? t("{label} — {count} חדשים", { label: e.label, count: e.count })
                  : e.label
              }
              className={`res-pill relative gap-1.5 px-2 py-1.5 font-bold transition-colors sm:px-2.5 ${
                active ? tone.active : `${tone.idle} hover:text-white`
              } ${e.count > 0 ? tone.glow : ""}`}
            >
              <Icon name={e.icon} size={18} className="shrink-0" />
              <span className="hidden text-xs md:inline">{e.label}</span>
              {e.count > 0 && (
                <span
                  className={`absolute -left-1.5 -top-1.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-black leading-[1.1rem] nums ${tone.badge}`}
                  dir="ltr"
                >
                  {e.count > 99 ? "99+" : e.count}
                </span>
              )}
            </NavLink>
          </Tip>
        );
      })}
    </div>
  );
}
