"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "לוח בקרה", icon: "📊", exact: true },
  { href: "/admin/monitor", label: "ניטור", icon: "📡" },
  { href: "/admin/support", label: "תמיכה", icon: "🛟" },
  { href: "/admin/users", label: "שחקנים", icon: "👥" },
  { href: "/admin/referrals", label: "הזמנות חברים", icon: "🎁" },
  { href: "/admin/bots", label: "בוטים", icon: "🤖" },
  { href: "/admin/broadcast", label: "שידור ומתנות", icon: "📣" },
  { href: "/admin/minigame", label: "מיני-משחק", icon: "🎯" },
  { href: "/admin/happy-hour", label: "Happy Hour", icon: "🔥" },
  { href: "/admin/seasons", label: "עונות", icon: "📅" },
  { href: "/admin/guilds", label: "בריתות", icon: "🤝" },
  { href: "/admin/war", label: "מלחמת בריתות", icon: "⚔️" },
  { href: "/admin/balance", label: "איזון גלובלי", icon: "⚖️" },
  { href: "/admin/purchases", label: "רכישות והכנסות", icon: "💳" },
  { href: "/admin/audit", label: "יומן פעולות", icon: "📜" },
];

export function AdminNav({
  /**
   * Tickets whose newest line is the player's — the only number in the control
   * centre that means "somebody is waiting on you right now", so it is the only
   * one the nav carries. Counted once per admin page load; it does not poll,
   * because the support screen itself does.
   */
  waitingSupport = 0,
  /**
   * Referrals held for a decision. The other thing in here that is somebody
   * waiting on you — two players cannot collect a purse until this is cleared —
   * and, unlike support, they were never told to expect an answer, so nothing
   * else would ever prompt the admin to look.
   */
  heldReferrals = 0,
}: {
  waitingSupport?: number;
  heldReferrals?: number;
}) {
  const badges: Record<string, number> = {
    "/admin/support": waitingSupport,
    "/admin/referrals": heldReferrals,
  };
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex flex-row gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname.startsWith(link.href);
        const badge = badges[link.href] ?? 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors lg:justify-between lg:gap-3 ${
              active
                ? "bg-gold/12 text-gold-bright shadow-[inset_3px_0_0_var(--gold)]"
                : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
            }`}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              {link.label}
              {badge > 0 && (
                <span className="min-w-5 rounded-full bg-red-600 px-1.5 py-px text-center text-[10px] font-black text-white">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
            <span aria-hidden className="text-base opacity-90">
              {link.icon}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
