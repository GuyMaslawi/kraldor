"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/server/actions/auth";
import { Meter } from "@/components/ui/Meter";
import { Tip } from "@/components/ui/Tip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { formatCompact } from "@/lib/game/format";
import { useScrollLock } from "@/components/ui/scrollLock";
import { useT, useDir } from "@/i18n/client";
import { LivingPortrait } from "@/components/game/LivingPortrait";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  /**
   * How the badge reads. "muted" is a neutral count (recruits waiting);
   * "attention" is something the player can act on right now, so it takes the
   * gold treatment and pulses the row — matching the rewards pill in the
   * command bar (see InboxNav).
   */
  badgeTone?: "muted" | "attention";
  /**
   * Replaces the badge's number with a word. Some badges are not a count of
   * anything — a guild war either is on the air or it is not — and rendering
   * that as "1" reads like an unread item.
   */
  badgeText?: string;
};

/**
 * One cluster of the command board. The nav is a *grid of tiles* rather than a
 * list of rows, and this is why: twenty-one rows at 38px each is 840px of nav,
 * against roughly 610px of room under the hero card on a 900px screen — so the
 * last four entries lived permanently below a fold, in the one component that
 * is supposed to make every screen reachable. Three tiles to a row turns those
 * twenty-one rows into nine, and the four headings below cost less height than
 * the scrollbar they replace.
 */
type NavGroup = { label: string; items: NavItem[] };

export type SidebarProps = {
  empireName: string;
  heroClass: string;
  /** Portrait art of the chosen hero class (see heroClassImage). */
  heroImage?: string;
  /** rgb triple for the class — the portrait's own light. */
  heroAccent?: string;
  heroLevel: number;
  /** Prestige count — how many times the hero was reset at level 100. */
  heroResets?: number;
  /** Unspent hero points waiting to be allocated. */
  heroPoints?: number;
  /** Hero health, 0–100. */
  heroHealthPct: number;
  /** Health has hit zero: the hero is out until he rises (see isHeroDead). */
  heroDead?: boolean;
  heroXp: number;
  heroXpMax: number;
  recruits: number;
  /** Mine slaves owned but not assigned to any machine — idle, producing nothing. */
  freeMineSlaves?: number;
  /** Achievement rewards unlocked and waiting to be collected. */
  collectableAchievements?: number;
  /**
   * Things waiting on לוח היום: an unsigned muster roll plus any finished
   * mission. Deliberately *not* the whole daily state — see getDailyBadge for
   * why the nav's count is the cheap one and what it leaves out.
   */
  dailyWaiting?: number;
  /** The hero is back from an expedition and his haul is uncollected. */
  heroQuestReady?: boolean;
  /** In a guild — the only players the war arena exists for, so the only ones who see it. */
  inGuild?: boolean;
  /** A guild war is on the air right now: the row lights up for the half hour. */
  guildWarLive?: boolean;
};

/**
 * Desktop-only sidebar column (hidden below the lg breakpoint). It sticks just
 * under the command bar while the page scrolls — see .sidebar-sticky in
 * globals.css, which owns position/top/align-self/max-height (a `position`
 * utility loses to .ornate-shell's unlayered position:relative). The inner
 * wrapper scrolls on its own when the nav outgrows the viewport, so the aside
 * stays clipped and its ornate frame stays painted around the edge.
 */
export function Sidebar(props: SidebarProps) {
  const pathname = usePathname();
  return (
    <aside className="ornate-shell sidebar-sticky hidden w-full shrink-0 overflow-hidden rounded-lg lg:flex lg:w-72 lg:flex-col">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-3">
        <SidebarContent {...props} pathname={pathname} />
      </div>
    </aside>
  );
}

/** "Has this hydrated yet" as a store: false on the server, true in the browser. */
const subscribeNever = () => () => {};

/** The hamburger glyph, morphing into an X while the drawer is open. */
function BurgerGlyph({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={open ? "M6 6l12 12" : "M3 6h18"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M3 12h18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={`origin-center transition-opacity duration-150 ${open ? "opacity-0" : "opacity-100"}`}
      />
      <path
        d={open ? "M18 6L6 18" : "M3 18h18"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Mobile navigation: one hamburger button — the drawer's only control — plus a
 * slide-in drawer holding the full sidebar. Hidden at lg+, where the static
 * <Sidebar> takes over.
 *
 * Both live in a portal on <body>, not in the command bar where the trigger is
 * laid out. The bar sets `backdrop-blur`, and a filtered ancestor becomes the
 * containing block for `position: fixed` descendants — a drawer rendered inside
 * it is clipped to the 3.75rem header strip and trapped under the bar's z-40
 * stacking context. The bar keeps a same-size placeholder so the row's layout
 * is unchanged, and the button re-anchors itself over that slot with the same
 * fixed offsets the header uses (dir=ltr, so: leading edge on the left).
 *
 * The panel's position/height/overflow are NOT utilities — they are the
 * `.nav-drawer` rule in globals.css, which has to be unlayered to outrank
 * .ornate-shell's `position: relative`. See the long note there.
 */
export function MobileMenu(props: SidebarProps) {
  const pathname = usePathname();
  const t = useT();
  const dir = useDir();
  const [open, setOpen] = useState(false);
  // Portals cannot render on the server; until hydration the command bar paints
  // an inert copy of the glyph so the bar never flashes a hole where it goes.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the nav is scrolled to its end — drives the bottom fade, which is
  // the only cue that the list continues past the fold.
  //
  // State, not a `dataset` write on a ref. The attribute is rendered from JSX,
  // so React owns it: any re-render of the drawer puts the JSX value straight
  // back and silently undoes an imperative write. That is not theoretical —
  // it is what happened here, and the fade stayed hidden on exactly the
  // viewport where the list overflowed by the least.
  //
  // Setting it on every scroll event is not a re-render per frame: the setter
  // is passed the same boolean nearly every time, and React bails out of a
  // render when the state is unchanged.
  const [atEnd, setAtEnd] = useState(true);
  const syncEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  }, []);

  // The page behind the drawer does not scroll while it is open.
  useScrollLock(open);

  // While open: Escape closes, and the back button closes (the only navigation
  // that can start while the drawer covers everything — taps on its own links
  // are handled below).
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", close);
    };
  }, [open]);

  // Open onto the tile the player is standing on. The grid fits the whole board
  // on one screen, so this is now belt-and-braces — a very short phone with the
  // hero card on top can still push the last cluster under the fold.
  useEffect(() => {
    if (!open) return;
    scrollRef.current
      ?.querySelector('a[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // A ResizeObserver rather than a one-shot measure on open: the hero portrait
  // finishes loading after the drawer is already on screen and grows the card
  // by enough to push the list past the fold, so a fade computed at open time
  // says "this is the whole list" when it no longer is. Watching the scroller
  // and its content also covers the rows that come and go (the war row, badges)
  // and a rotation, so the window resize listener is not needed on top.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEnd);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    // After paint, not during the effect: the drawer is mid slide-in here and
    // has not been laid out at its final size yet.
    const frame = requestAnimationFrame(syncEnd);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [open, syncEnd]);

  return (
    <>
      {/* The slot the button occupies in the command bar's flex row — a bare
          spacer once the real (fixed) button is painted over it. */}
      <div className="h-10 w-10 shrink-0 lg:hidden" aria-hidden>
        {!mounted && (
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border-gold-strong bg-black/30 text-gold-bright">
            <BurgerGlyph open={false} />
          </div>
        )}
      </div>

      {mounted &&
        createPortal(
          <div
            className={`fixed inset-x-0 top-0 z-[60] h-[100dvh] lg:hidden ${
              open ? "" : "pointer-events-none"
            }`}
          >
            <div
              onClick={() => setOpen(false)}
              className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
                open ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden
            />

            <aside
              // The drawer is portaled to <body>, outside the command bar's
              // dir="ltr" wrapper — so it has to name the document's direction
              // rather than inherit the one above it.
              dir={dir}
              // Any nav link tapped inside the drawer closes it (delegated click).
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setOpen(false);
              }}
              // Offscreen is not just invisible: while closed the drawer is out
              // of the tab order and out of the accessibility tree entirely.
              inert={!open}
              data-at-end={String(atEnd)}
              // The width is expressed as "everything but the strip the
              // hamburger stands in" rather than a flat 86vw, so the button is
              // always *beside* the panel and never over its ornate edge. At
              // 86vw a 320px phone left only 45px of margin — three pixels
              // narrower than the button — and the two overlapped.
              className={`ornate-shell nav-drawer flex w-[calc(100vw-3.5rem)] max-w-xs flex-col rounded-l-lg transition-transform duration-200 ${
                open ? "translate-x-0" : "translate-x-full"
              }`}
            >
              {/* The frame clips and the border stays painted; this is the one
                  thing that scrolls.

                  Padding is uniform: the drawer does NOT need to clear the
                  command bar. The hamburger sits in the strip to the side of
                  the panel (see the width above), so a header-height top pad
                  bought nothing but a 60px empty band above the first row —
                  and cost 60px of nav, which is the difference between the list
                  fitting on a phone and not. */}
              <div
                ref={scrollRef}
                onScroll={syncEnd}
                className="nav-drawer-scroll flex flex-col gap-4 p-3"
              >
                <SidebarContent {...props} pathname={pathname} />
              </div>
            </aside>

            {/* Mirrors the command bar's own row box, so the button lands
                exactly on the placeholder it replaces — and stays above the
                backdrop and the drawer, the single thing that toggles them. */}
            <div
              dir="ltr"
              className="pointer-events-none absolute inset-x-0 top-0 flex h-[var(--header-h)] items-center px-2 sm:px-3 md:px-5"
            >
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={open ? t("סגירת תפריט") : t("פתיחת תפריט")}
                aria-expanded={open}
                className={`pointer-events-auto flex h-10 w-10 items-center justify-center rounded-md border bg-black/30 backdrop-blur transition-colors ${
                  open
                    ? "border-crimson/60 text-crimson-bright"
                    : "border-border-gold-strong text-gold-bright hover:border-gold"
                }`}
              >
                <BurgerGlyph open={open} />
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** The full sidebar body — shared by the desktop column and the mobile drawer. */
function SidebarContent({
  empireName,
  heroClass,
  heroImage,
  heroAccent,
  heroLevel,
  heroResets = 0,
  heroPoints = 0,
  heroHealthPct,
  heroDead = false,
  heroXp,
  heroXpMax,
  recruits,
  freeMineSlaves = 0,
  collectableAchievements = 0,
  dailyWaiting = 0,
  heroQuestReady = false,
  inGuild = false,
  guildWarLive = false,
  pathname,
}: SidebarProps & { pathname: string }) {
  const t = useT();
  // Four clusters of tiles — see NavGroup for why this stopped being a flat
  // list. History lives in the top command bar (see InboxNav), so it
  // deliberately has no entry here.
  //
  // Every row below renders with `prefetch={false}`, which is not the usual
  // advice and is deliberate. Next prefetches a <Link> the moment it enters the
  // viewport, and this whole list is in the viewport on every screen of the
  // game — so one page view asked the server to render fifteen more. None of
  // them are static, so each prefetch is a real function invocation with real
  // queries behind it, and a dynamic prefetch is not reused for long, so
  // navigating re-fires the entire list.
  //
  // What that cost in production: during one player's evening session, 2,106 of
  // his 2,328 requests were prefetches — a 10:1 ratio of speculative renders to
  // pages he actually opened. Attacking is the worst case, because the action
  // redirects to a fresh battle report and the sidebar re-mounts each time; two
  // or three attacks in a row were enough to cross Vercel's per-IP ceiling and
  // hand him a 429 on the report he had just earned.
  //
  // The navigation still feels instant without it: every /game route has a
  // loading.tsx, so the skeleton paints immediately on click.
  const navGroups: NavGroup[] = [
    {
      // The four screens a returning player touches before anything else, in
      // the order they touch them.
      // Same four words the achievement categories use — אימפריה / מלחמה /
      // כלכלה / תהילה — so the nav and the goal list carve the game up the
      // same way, and all four are already in the dictionary.
      label: t("אימפריה"),
      items: [
        { href: "/game/base", label: t("בסיס"), icon: "base" },
        // Second tile, directly beside the base — the daily board is the first
        // thing a returning player should be able to clear, and an entry buried
        // at the bottom of twenty-one is one nobody opens on the day they were
        // most likely to sign the roll.
        {
          href: "/game/daily",
          label: t("לוח היום"),
          icon: "quest",
          badge: dailyWaiting,
          badgeTone: "attention",
        },
        {
          href: "/game/hero",
          label: t("גיבור"),
          icon: "hero",
          // A returned hero is one thing to collect, so it wears the same gold
          // "1" the achievements tile does rather than inventing a second
          // dialect of badge for a count that is only ever 0 or 1.
          badge: heroQuestReady ? 1 : 0,
          badgeTone: "attention",
        },
        { href: "/game/upgrades", label: t("שדרוגים"), icon: "upgrades" },
      ],
    },
    {
      label: t("מלחמה"),
      items: [
        { href: "/game/rankings", label: t("דירוג"), icon: "rankings" },
        // Beside the ladder rather than deeper in the war block: the world boss
        // is the one fixture where the whole server is on the same side, and it
        // is read as a standing rather than as a raid.
        { href: "/game/worldboss", label: t("מפלצת העולם"), icon: "attack" },
        // Beside the world boss: both are fixtures the system fights on a
        // clock, and both answer a question the ladder cannot.
        { href: "/game/arena", label: t("הזירה"), icon: "crown" },
        // The prize hall is deliberately absent: it rides in the top command
        // bar beside the inbox (see InboxNav), where the season's stakes are
        // visible from every screen rather than only from an open nav.
        { href: "/game/weapons", label: t("מפעל"), icon: "factory" },
        { href: "/game/army", label: t("ניהול"), icon: "army", badge: recruits },
        { href: "/game/guild", label: t("ברית"), icon: "guild" },
        // Guild-only, and hidden rather than disabled: a locked door on the nav
        // for a screen a guildless player can do nothing with is just noise.
        // The page enforces the same rule itself — see /game/war.
        ...(inGuild
          ? [
              {
                href: "/game/war",
                label: t("מלחמת בריתות"),
                icon: "attack" as IconName,
                badge: guildWarLive ? 1 : 0,
                badgeText: t("חי"),
                badgeTone: "attention" as const,
              },
            ]
          : []),
      ],
    },
    {
      // Everything that makes or holds money. Buildings sit here rather than
      // beside the upgrades they resemble, because what they buy is income —
      // and the tile grid can say that with a neighbour instead of a comment.
      label: t("כלכלה"),
      items: [
        // Idle mine slaves read exactly like waiting recruits on the army tile:
        // a neutral count of something sitting unused, not an alert.
        {
          href: "/game/production",
          label: t("מכונות"),
          icon: "mine",
          badge: freeMineSlaves,
        },
        { href: "/game/monuments", label: t("מבנים"), icon: "crown" },
        { href: "/game/storage", label: t("מחסנים"), icon: "storage" },
        { href: "/game/bank", label: t("בנק"), icon: "bank" },
        { href: "/game/diamonds", label: t("יהלומים"), icon: "diamond" },
      ],
    },
    {
      label: t("תהילה"),
      items: [
        {
          href: "/game/achievements",
          label: t("הישגים"),
          icon: "achievements",
          badge: collectableAchievements,
          badgeTone: "attention",
        },
        // Beside the achievements rather than the shop: most of the shelf is
        // earned rather than bought, and a title filed under "things to buy"
        // would teach the wrong thing about the eight that cannot be.
        { href: "/game/titles", label: t("תארים"), icon: "laurel" },
        { href: "/game/guide", label: t("מדריך"), icon: "reports" },
        // Points at the game's own community page rather than straight out to
        // Discord: the invite may not exist yet, the page works either way, and
        // a player who lands there also gets the house rules and the welcome
        // purse.
        { href: "/game/community", label: t("קהילה"), icon: "discord" },
        // Beside the community rather than near the shop: bringing a friend in
        // is a social act, and filing it under "ways to get diamonds" would
        // frame the one growth loop the game has as a bounty scheme.
        { href: "/game/referrals", label: t("הזמנת חברים"), icon: "gift" },
      ],
    },
  ];

  const xpPct = heroXpMax > 0 ? Math.round((heroXp / heroXpMax) * 100) : 0;

  return (
    <>
      {/* header: logout + settings + welcome */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <form action={logout}>
            <button
              type="submit"
              title={t("התנתקות")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-400"
            >
              <Icon name="logout" size={17} />
            </button>
          </form>
          <Link
            href="/game/settings"
            title={t("הגדרות")}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-zinc-400 transition-colors hover:border-crimson/50 hover:text-crimson-bright"
          >
            <Icon name="settings" size={17} />
          </Link>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[11px] text-zinc-400">{t("ברוך שובך,")}</p>
          <p className="flex items-center justify-end gap-1.5 truncate font-black text-gold-bright">
            {empireName}
            <Icon name="crown" size={16} className="shrink-0 text-crimson-bright" />
          </p>
        </div>
      </div>

      {/* History, messages and the admin control center now live in the top
          command bar — see InboxNav and AdminNav. */}

      {/* hero card — portrait on one side, everything that reads about him
          stacked beside it. The gauges used to hang in a block *under* the
          whole row, which left the width next to the portrait empty and pushed
          the card two rows taller than it needs to be. */}
      <div className="panel-gold rounded-lg p-3">
        <div className="flex items-stretch gap-3">
          {/* The portrait takes whatever height the text column settles on
              rather than a fixed one — a taller frame is the only thing here
              that wants more room, so the art absorbs the slack instead of the
              card carrying a blank strip beside it. */}
          <div className="relative w-[5.5rem] shrink-0">
            {/* a div, not a span: the portrait frame below is flow content */}
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-crimson/50 bg-gradient-to-b from-[#2a1520] to-[#0e0b12] shadow-inner">
              {heroImage ? (
                /* Chrome, and on screen on every page — so this one only
                   breathes, on a long cycle, with no embers or halo. */
                <LivingPortrait
                  src={heroImage}
                  alt={heroClass}
                  className="absolute inset-0"
                  accent={heroAccent}
                  tilt={2}
                  drift={34}
                  halo={false}
                />
              ) : (
                <Icon name="hero" size={30} className="text-crimson-bright" />
              )}
            </div>
            <span className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap">
              <Tip tip={t("רמת הגיבור — עולה מניסיון שנצבר בקרבות")}>
                <span className="rounded bg-amber-500 px-1.5 text-[10px] font-black text-black shadow">
                  {heroLevel}
                </span>
              </Tip>
              {heroResets > 0 && (
                <Tip
                  tip={
                    heroResets === 1
                      ? t("תג איפוס: הגיבור הגיע לרמה 100 ואופס פעם אחת")
                      : t("תג איפוס: הגיבור הגיע לרמה 100 ואופס {count} פעמים", {
                          count: heroResets,
                        })
                  }
                >
                  <span className="rounded bg-purple-600 px-1 text-[10px] font-black text-white shadow">
                    ↻{heroResets}
                  </span>
                </Tip>
              )}
            </span>
          </div>
          {/* Name and class share one line — the class used to own a row of its
              own and, being pushed to the far edge, read as a caption for the
              blank space rather than for the hero. Both gauges read the same
              way — label on the leading edge, its number on the trailing one,
              the bar directly beneath — so health and experience line up
              instead of scattering numbers around the card. Level lives on the
              portrait badge only, and each number appears exactly once. */}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="shrink-0 font-bold text-gold-bright">{t("גיבור")}</p>
              {/* On the trailing edge, on the same column as the two numbers
                  below it: every row of the card now reads "what it is" on one
                  side and "which one / how much" on the other. */}
              <Tip tip={t("מקצוע הגיבור")}>
                <span className="truncate rounded-full border border-border-subtle bg-black/30 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
                  {heroClass}
                </span>
              </Tip>
            </div>

            {/* Health, not a stat ratio: this is the bar that actually moves —
                every breached defence takes a bite out of it, and at zero the
                hero is out of the fight until he is raised. */}
            {heroDead ? (
              <Tip
                tip={t(
                  "הגיבור נפל בקרב — כל נקודותיו והבונוסים שלו מושבתים עד שיקום לתחייה. לחץ לפרטים."
                )}
                className="w-full"
              >
                <Link
                  href="/game/hero"
                  className="flex w-full items-center justify-center gap-1 rounded-full border border-red-500/50 bg-red-950/60 px-2 py-1 text-[10px] font-black text-red-300"
                >
                  {t("💀 הגיבור מת")}
                </Link>
              </Tip>
            ) : (
              <HeroGauge
                icon="heart"
                label={t("חיים")}
                value={`${heroHealthPct}%`}
                accent="text-red-300"
                tone="health"
                meterValue={heroHealthPct}
                tip={t("חיי הגיבור — כל תקיפה שפורצת את ההגנה שלך מורידה מהם")}
              />
            )}
            <HeroGauge
              icon="spark"
              label={t("ניסיון")}
              value={`${formatCompact(heroXp)}/${formatCompact(heroXpMax)} · ${xpPct}%`}
              accent="text-purple-300"
              tone="xp"
              meterValue={heroXp}
              meterMax={heroXpMax}
              tip={t(
                "ניסיון הגיבור — נצבר מקרבות: ניצחון בתקיפה מעניק הכי הרבה, גם הגנה מוצלחת מזכה. במלוא הבר הגיבור עולה רמה"
              )}
            />
          </div>
        </div>

        {/* The one badge in the card that asks for an action — full width under
            the row, where it is a target rather than a chip squeezed beside the
            name, and only present when there is something to spend. */}
        {heroPoints > 0 && (
          <Tip
            tip={t("נקודות גיבור פנויות — הקצה אותן בעמוד הגיבור (כל נקודה = +1%)")}
            className="mt-2 block w-full"
          >
            <Link
              href="/game/hero"
              className="flex w-full items-center justify-center gap-1 rounded-full border border-purple-400/50 bg-purple-600/25 px-2 py-0.5 text-[10px] font-black text-purple-200"
            >
              <Icon name="spark" size={11} />
              {t("{points} נקודות פנויות", { points: heroPoints })}
            </Link>
          </Tip>
        )}
      </div>

      {/* The command board: four clusters, three tiles to a row. */}
      <nav className="flex flex-col gap-2.5">
        {navGroups.map((group) => (
          <div key={group.label}>
            {/* The heading and a rule running off it to the trailing edge —
                enough to separate the clusters at a glance without spending a
                full row of height on each one. */}
            <p className="mb-1 flex items-center gap-2 px-0.5">
              <span className="whitespace-nowrap text-[9px] font-black tracking-[0.2em] text-bone-dim/80">
                {group.label}
              </span>
              {/* Strongest where it leaves the heading and gone by the far
                  edge — a full rule across the column reads as a divider
                  between two halves of the nav rather than as a label. */}
              <span className="h-px flex-1 bg-gradient-to-l from-border-gold-strong/60 to-transparent" />
            </p>
            {/* Tiles in one row stretch to the tallest of them (grid's default
                alignment), so a two-line label like מפלצת העולם sets the row's
                height instead of leaving its neighbours ragged. */}
            <ul className="grid grid-cols-3 gap-1">
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                const hasBadge = item.badge != null && item.badge > 0;
                // Only an actionable badge pulses the tile, and never while the
                // player is already standing on that page.
                const calling = hasBadge && item.badgeTone === "attention" && !active;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // Prefetch off — see the note above `navGroups`. Every
                      // tile here is in the viewport at all times, so the
                      // default would fire a request per tile on every render.
                      prefetch={false}
                      // Names the current screen for a screen reader, and is
                      // what the mobile drawer scrolls to when it opens.
                      aria-current={active ? "page" : undefined}
                      // The label wraps to two lines inside the tile, so the
                      // full name is also on the element itself for the cases
                      // where a translation outgrows the box.
                      title={item.label}
                      className={`group relative flex h-full flex-col items-center justify-start gap-1 rounded-md border px-1 py-1.5 text-center transition-colors ${
                        active
                          ? "border-gold/60 bg-gold/12 text-gold-bright"
                          : calling
                            ? "nav-glow-gold border-gold/40 text-gold-bright"
                            : "border-border-subtle/70 bg-black/30 text-zinc-300 hover:border-gold/40 hover:bg-white/5 hover:text-zinc-100"
                      }`}
                    >
                      <Icon
                        name={item.icon}
                        size={18}
                        className={
                          active
                            ? "text-crimson-bright"
                            : calling
                              ? "text-gold-bright"
                              : "text-bone-dim opacity-90 group-hover:text-bone"
                        }
                      />
                      <span className="text-[10px] font-bold leading-[1.15]">
                        {item.label}
                      </span>
                      {hasBadge && (
                        // Corner pip rather than a chip beside the label: the
                        // tile has no room for a second thing on the text line,
                        // and the leading corner is empty on every tile because
                        // the icon is centred.
                        <span
                          className={`absolute top-1 start-1 rounded px-1 text-[9px] font-bold nums ${
                            item.badgeTone === "attention"
                              ? "bg-gold font-black text-black"
                              : "bg-black/60 text-zinc-400"
                          }`}
                        >
                          {item.badgeText ?? formatCompact(item.badge!)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

/**
 * One gauge in the hero card: an icon+label on the leading edge, its number on
 * the trailing one, and the bar underneath spanning both. Every bar in the card
 * uses it, so they all say where their number came from — a bare bar with a
 * figure floating somewhere else in the panel is what made the card unreadable.
 * Spans throughout: the Tip trigger is itself a span.
 */
function HeroGauge({
  icon,
  label,
  value,
  accent,
  tone,
  meterValue,
  meterMax = 100,
  tip,
}: {
  icon: IconName;
  label: string;
  /** Already-formatted reading — a percentage, or "have/need · pct". */
  value: string;
  /** Text colour class shared by the label and the number. */
  accent: string;
  tone: "xp" | "health";
  meterValue: number;
  meterMax?: number;
  tip: string;
}) {
  return (
    <Tip tip={tip} className="w-full">
      <span className="block w-full">
        <span
          className={`flex items-baseline justify-between gap-2 text-[11px] font-semibold ${accent}`}
        >
          <span className="flex items-center gap-1">
            <Icon name={icon} size={12} />
            {label}
          </span>
          <span className="nums" dir="ltr">
            {value}
          </span>
        </span>
        <Meter value={meterValue} max={meterMax} tone={tone} className="mt-1 w-full" />
      </span>
    </Tip>
  );
}
