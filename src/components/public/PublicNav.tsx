import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { discordInviteUrl } from "@/server/discord";
import { prelaunchShutForViewer } from "@/server/prelaunchGuard";
import { getT } from "@/i18n/server";

/**
 * The bar across the top of every screen in front of the game.
 *
 * Until now the only thing on the login page besides the form was a language
 * switch: a visitor who had not decided yet could read nothing about the game
 * without first creating an account, which is the wrong way round — the manual,
 * last season's champions and the rules a payment is made under are all things
 * you read *before* you sign up, not after.
 *
 * Every destination here is genuinely public. That is a constraint on this list,
 * not a description of it: a link that bounces to `/login` is worse than no link
 * at all, because it looks like the door is open and then closes it. The same
 * rule is why היכל התהילה drops out of the bar while the game is pre-launch —
 * `/hall` sends everybody but an admin to `/launch` (see prelaunchGuard), so for
 * a visitor it is a tab that throws them off the page they were reading. The
 * countdown itself takes its place, because that is where that click was
 * actually going.
 *
 * **The bar owns its own spacing.** The margin below it and the width it sits in
 * are set here rather than by each shell, because the four screens that mount it
 * (the gate, the public pages, the policy pages, the launch poster) each used to
 * pass their own — so the bar sat at a different height on each one and every
 * link that crossed between them looked like the page jumped. Callers pass only
 * decoration (the gate's fade-in), never position.
 *
 * A server component with no client JavaScript beyond the two pills that already
 * had it (the language switch's form and the Discord link), so it costs the
 * first paint of the site nothing.
 */

type NavLink = { href: string; label: string; icon: IconName };

// i18n-keys-start: dictionary keys, drawn through t(link.label) in the bar
const LINKS: NavLink[] = [
  { href: "/guide", label: "מדריך המשחק", icon: "reports" },
  { href: "/hall", label: "היכל התהילה", icon: "crown" },
  { href: "/terms", label: "תקנון", icon: "shield" },
  { href: "/refund", label: "ביטולים והחזרים", icon: "gold" },
  { href: "/privacy", label: "פרטיות", icon: "lock" },
];

/** Stands in for the hall while the gates have never opened. */
const COUNTDOWN: NavLink = { href: "/launch", label: "ספירה לאחור", icon: "crown" };
// i18n-keys-end

export async function PublicNav({ className = "" }: { className?: string }) {
  const t = await getT();
  const discord = discordInviteUrl();
  // Cached with the session read the page around it already did — see
  // getSessionUser — so this costs the bar nothing on a gated page.
  const shut = await prelaunchShutForViewer();
  const links = shut
    ? LINKS.map((link) => (link.href === "/hall" ? COUNTDOWN : link))
    : LINKS;

  return (
    <nav
      className={`mb-8 flex w-full flex-wrap items-center justify-center gap-1.5 ${className}`}
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-black/30 px-2.5 py-1.5 text-[11px] font-bold text-zinc-300 transition-colors hover:border-gold/50 hover:bg-white/5 hover:text-gold-bright"
        >
          <Icon name={link.icon} size={13} className="shrink-0 text-gold-dim" />
          {t(link.label)}
        </Link>
      ))}
      {/* The pill variant carries its own blurple sizing — left alone rather
          than squeezed to match, because the one link that leaves the site
          should not look like the five that stay on it. */}
      <DiscordLink url={discord} variant="pill" label={t("דיסקורד")} />
      <LanguageSwitch compact />
    </nav>
  );
}
