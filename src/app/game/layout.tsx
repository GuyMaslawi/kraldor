import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import {
  gameDay,
  nextDailyUpdate,
  nextRegularUpdate,
  formatGameTime,
} from "@/lib/game/time";
import { isProductionBuilding } from "@/lib/game/constants";
import { liveWarStart } from "@/lib/game/guildWar";
import {
  HERO_CLASS_META,
  HERO_MAX_HEALTH,
  HERO_MAX_LEVEL,
  heroClassImage,
  isHeroDead,
  xpToNextLevel,
} from "@/lib/game/hero";
import { ResourceBar } from "@/components/game/ResourceBar";
import { UpdateTimers } from "@/components/game/UpdateTimers";
import { SeasonPassButton } from "@/components/game/SeasonPass";
import { Sidebar, MobileMenu, type SidebarProps } from "@/components/game/Sidebar";
import { InboxNav } from "@/components/game/InboxNav";
import { AdminNav } from "@/components/game/AdminNav";
import { ImpersonationBanner } from "@/components/game/ImpersonationBanner";
import { WarAlerts } from "@/components/game/WarAlerts";
import { ChatDock } from "@/components/game/ChatDock";
import { ActivePotions } from "@/components/game/ActivePotions";
import { FervorGauge } from "@/components/game/FervorGauge";
import { getActivePotionExpiries } from "@/lib/game/potionEffects";
import { MiniGameButton } from "@/components/game/MiniGameButton";
import { VipQuickCommand } from "@/components/game/VipQuickCommand";
import { isVip } from "@/lib/game/vip";
import { getMiniGameStates } from "@/server/actions/minigame";
import { countWaitingSupport } from "@/server/actions/support";
import { HappyHourBanner } from "@/components/game/HappyHourBanner";
import { getHappyHourState } from "@/server/actions/happyHour";
import { getSeasonPassState } from "@/server/actions/seasonPass";
import { getCollectableAchievements } from "@/server/achievementState";
import { buildStreakState, getDailyBadge } from "@/server/dailyState";
import { DailyGift } from "@/components/game/DailyGift";
import { OrnateFrame } from "@/components/ui/OrnateFrame";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { Tip } from "@/components/ui/Tip";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { discordInviteUrl } from "@/server/discord";
import { getI18n } from "@/i18n/server";

export default async function GameLayout({ children }: { children: ReactNode }) {
  const { t, dir } = await getI18n();

  // requireEmpire applies all pending regular/daily updates (lazy game clock).
  const empire = await requireEmpire();

  const now = new Date();
  // Global boundary (XX:00, XX:05, …) — the same countdown for every player.
  const nextRegular = nextRegularUpdate(now);
  const nextDaily = nextDailyUpdate(now);

  // Real season-pass progression: XP earned by gameplay actions this cycle,
  // rewards priced at the current season day. See src/lib/game/seasonPass.ts.
  const seasonPass = await getSeasonPassState();

  // Real hero progression (battles grant XP; see src/lib/game/hero.ts).
  const hero = empire.hero;
  const heroLevel = hero?.level ?? 1;
  const heroAtCap = heroLevel >= HERO_MAX_LEVEL;
  const heroXpMax = heroAtCap ? 1 : xpToNextLevel(heroLevel);
  const heroXp = heroAtCap ? 1 : hero?.xp ?? 0;

  const admin = await isAdmin();
  // Tickets waiting on an answer, for the command bar's support alert. Only
  // ever asked for an admin: a player's page load must not pay for a count
  // they can never be shown. See AdminNav — the poll takes over from here.
  const waitingSupport = admin ? await countWaitingSupport() : 0;
  // Read once and handed to both surfaces that offer the channel on every
  // screen: the chat dock and the command-bar pill.
  const discordUrl = discordInviteUrl();
  // Every running release, oldest first — the admin can field more than one at
  // a time, and they share the command bar's row.
  const miniGames = await getMiniGameStates();
  // Rendered server-side so a player who navigates during a release meets it on
  // the first paint rather than one poll later.
  const happyHour = await getHappyHourState();

  // Running potions ride in the command bar: a buff that is quietly doubling
  // plunder and XP has to be visible from the screens people actually play on,
  // not only from the belt it was drunk on.
  const potionExpiries = await getActivePotionExpiries(empire.id, undefined, now);
  const potionActiveUntil = Object.fromEntries(
    Object.entries(potionExpiries).map(([kind, at]) => [kind, at.getTime()])
  );

  // Command-bar badges: unread inbox messages + reports since the last visit.
  // Only things *done to me* alert: an attack I was the defender of, or an
  // enemy spy my defenses caught (a successful enemy spy stays invisible to its
  // target — see ReportsTabs). My own attacks and missions are things I just
  // did on purpose, so they land in the history silently.
  //
  // The achievements count rides along here so an unclaimed reward is visible
  // from every screen, not only after the player happens to open the ladder.
  // It is memoised per request (see getAchievementsState), so the achievements
  // page itself does not pay for it twice.
  const [
    unreadMessages,
    newBattleReports,
    newSpyReports,
    collectableAchievements,
    finishedQuest,
    dailyWaiting,
  ] = await Promise.all([
      prisma.message.count({ where: { empireId: empire.id, readAt: null } }),
      prisma.battleReport.count({
        where: {
          defenderEmpireId: empire.id,
          createdAt: { gt: empire.reportsSeenAt },
        },
      }),
      prisma.spyReport.count({
        where: {
          defenderEmpireId: empire.id,
          success: false,
          createdAt: { gt: empire.reportsSeenAt },
        },
      }),
      getCollectableAchievements(empire.id),
      // A hero standing at the gate with a full pack. Deliberately a `count`
      // on the row's own end time rather than anything derived: the expedition
      // finishes on the clock, with nobody logged in to notice, so the badge
      // has to be a question the DB can answer on any page load.
      prisma.heroQuest.count({
        where: { empireId: empire.id, endsAt: { lte: new Date() } },
      }),
      // An unsigned muster roll plus any finished mission. The streak half is
      // free — it reads columns requireEmpire already loaded — and the mission
      // half reuses the counters snapshot the achievements badge on the line
      // above is gathering anyway (both go through getEmpireStats, memoised per
      // request). It never opens a board; see getDailyBadge.
      getDailyBadge(empire, now),
    ]);

  // The war arena is a guild screen: guildless players never see the link.
  // While the nightly window is open the row also announces itself, because a
  // fixture that lasts thirty minutes is missed if you have to go looking for
  // it. liveWarStart is a pure clock check, so the extra count only ever runs
  // during that half hour.
  const guildMembership = await prisma.guildMember.findUnique({
    where: { empireId: empire.id },
    select: { guildId: true },
  });
  const warStart = liveWarStart(now);
  const guildWarLive =
    guildMembership !== null &&
    warStart !== null &&
    (await prisma.guildWar.count({
      where: { startsAt: warStart, status: "SCHEDULED" },
    })) > 0;

  // Mine slaves standing idle — bought (or captured) but not put on a machine,
  // so they produce nothing until someone assigns them. Same arithmetic the
  // production page does, on the empire requireEmpire already loaded: no extra
  // query, and the nav badge can never disagree with the screen it links to.
  const assignedSlaves = empire.buildings.reduce(
    (sum, b) => sum + (isProductionBuilding(b.type) ? b.slavesAssigned : 0),
    0
  );
  const freeMineSlaves = Math.max(0, (empire.army?.mineSlaves ?? 0) - assignedSlaves);

  const sidebarProps: SidebarProps = {
    empireName: empire.name,
    heroClass: HERO_CLASS_META[hero?.heroClass ?? "WARLORD"].label,
    heroImage: heroClassImage(hero?.heroClass ?? "WARLORD"),
    heroAccent: HERO_CLASS_META[hero?.heroClass ?? "WARLORD"].accent,
    heroLevel,
    heroResets: hero?.resets ?? 0,
    heroPoints: hero?.unspentPoints ?? 0,
    // Real hero health: every breached defence wounds him, and at zero he is
    // dead — no points, no gear, no class bonus — until he rises.
    heroHealthPct: hero?.health ?? HERO_MAX_HEALTH,
    heroDead: isHeroDead(hero),
    heroXp,
    heroXpMax,
    recruits: empire.citizens,
    freeMineSlaves,
    collectableAchievements,
    dailyWaiting,
    heroQuestReady: finishedQuest > 0,
    inGuild: guildMembership !== null,
    guildWarLive,
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Only ever rendered when an admin is signed in as this player. */}
      <ImpersonationBanner empireName={empire.name} />
      {/* Live toasts for incoming attacks / spies / messages. */}
      <WarAlerts />
      {/* The day's chest, on the first game screen of the day and nowhere else.
          Free to render: buildStreakState reads columns requireEmpire has
          already loaded, and the component returns null the moment the roll is
          signed. See DailyGift for the once-a-day rule. */}
      <DailyGift
        streak={buildStreakState(empire, now)}
        today={gameDay(now)}
        serverNow={now.getTime()}
      />
      {/* The chat dock rides in the corner of every game screen — the public
          room and private conversations, without leaving the page you are on.
          Admins get the moderation control on each line. */}
      <ChatDock canModerate={admin} discordUrl={discordUrl} />
      <ResourceBar
        resources={{
          gold: empire.gold,
          wood: empire.wood,
          iron: empire.iron,
          stone: empire.stone,
          diamonds: empire.diamonds,
          citizens: empire.citizens,
          turns: empire.turns,
        }}
        mobileMenu={<MobileMenu {...sidebarProps} />}
        inbox={
          <InboxNav
            newReports={newBattleReports + newSpyReports}
            unreadMessages={unreadMessages}
            collectableAchievements={collectableAchievements}
          />
        }
        discord={
          // Nothing at all until the channel exists (discordInviteUrl fails
          // closed), which is also why the Tip is only mounted alongside a real
          // link — an empty tooltip wrapper in the command bar would still be a
          // hover target over nothing.
          discordUrl ? (
            <Tip
              tip={t(
                "קהילת קראלדור בדיסקורד — עדכונים, שעות שמחה, מיני-משחקים ושאר השחקנים. נפתח בלשונית חדשה"
              )}
              side="bottom"
            >
              <DiscordLink
                url={discordUrl}
                variant="topbar"
                label={t("דיסקורד")}
              />
            </Tip>
          ) : null
        }
        admin={admin ? <AdminNav waitingSupport={waitingSupport} /> : null}
        language={<LanguageSwitch compact />}
      />

      <div
        dir={dir}
        // The chat dock is fixed to the bottom-left corner of every game screen,
        // so the last thing on a page was always sitting underneath it. The
        // trailing padding is the dock's own height plus its offset, which buys
        // the page back its final row.
        className="mx-auto flex w-full max-w-[1900px] flex-1 flex-col gap-4 px-3 pb-20 pt-4 lg:flex-row lg:px-5 lg:pb-16"
      >
        <Sidebar {...sidebarProps} />

        <main className="min-w-0 flex-1">
          <OrnateFrame className="flex min-h-full flex-col overflow-hidden p-3 sm:p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle pb-3">
              {seasonPass && <SeasonPassButton initial={seasonPass} />}
              {/* Released mini-games ride in the command bar next to the season
                  pass — one chip each, side by side in this same row, opening
                  their game in a modal. They used to be a full-width panel
                  above the page, which meant every screen of the game was
                  pushed below the fold for the whole release, for players who
                  had already finished it too. They announce themselves once on
                  release and call out each winner from the corner instead; see
                  MiniGameButton. */}
              <MiniGameButton initial={miniGames} />
              {/* The VIP command post. Rendered for everyone — for a player
                  without the pass the chip opens what it would unlock, which is
                  the only place in the game that says so on every screen. */}
              <VipQuickCommand isVip={isVip(empire)} />
              <ActivePotions
                activeUntil={potionActiveUntil}
                serverNow={now.getTime()}
              />
              {/* להט הקרב belongs in this row and not with the balances: it is
                  not a thing the player owns, it is a thing that is currently
                  true about their numbers — the same question the potions and
                  the tick countdown beside it answer. Costs nothing to render;
                  every column it reads is already on the `empire` row. */}
              <FervorGauge
                points={empire.fervorPoints}
                at={empire.fervorAt?.getTime() ?? null}
                hotUsed={
                  empire.fervorDay === gameDay(now) ? empire.fervorHotAttacks : 0
                }
                serverNow={now.getTime()}
              />
              <UpdateTimers
                serverNow={now.getTime()}
                nextRegularAt={nextRegular.getTime()}
                nextDailyAt={nextDaily.getTime()}
                nextDailyLabel={formatGameTime(nextDaily)}
              />
            </div>
            {/* Happy Hour keeps the full-width banner: unlike a mini-game it is
                not something a player finishes and is done with — it is true
                for every player at once, for as long as it runs, and it changes
                the value of every action on the screen underneath it. */}
            <div className="flex-1 pt-5">
              <HappyHourBanner initial={happyHour} />
              {children}
            </div>
          </OrnateFrame>
        </main>
      </div>
    </div>
  );
}
