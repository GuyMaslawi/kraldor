import type { CSSProperties } from "react";
import { requireEmpire } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { GuildLink } from "@/components/ui/GuildLink";
import { GuildHall } from "@/components/game/GuildHall";
import { isOnline } from "@/lib/game/chat";
import { formatNumber } from "@/lib/game/format";
import { getT } from "@/i18n/server";
import { RichText } from "@/components/ui/RichText";
import {
  GUILD_AID_MAX_LEVEL,
  GUILD_CAPACITY_MAX_LEVEL,
  GUILD_CREATION_COST_DIAMONDS,
  GUILD_INVITE_TTL_HOURS,
  GUILD_ROLE_META,
  GUILD_SPELL_META,
  GUILD_SPELL_TYPES,
  aidUpgradeCostGold,
  capacityUpgradeCostGold,
  guildAidPct,
  guildCapacity,
  guildSpellBonusPct,
  guildSpellMaxLevel,
  spellCastCostDiamonds,
  spellUpgradeCostDiamonds,
} from "@/lib/game/guild";
import { GuildCreateForm } from "@/components/game/GuildCreateForm";
import { GuildInviteActions } from "@/components/game/GuildInviteActions";
import { GuildAddMemberForm } from "@/components/game/GuildAddMemberForm";
import { GuildShopCard } from "@/components/game/GuildShopCard";
import { GuildCapacityCard } from "@/components/game/GuildCapacityCard";
import { GuildAidCard } from "@/components/game/GuildAidCard";
import {
  GuildTreasuryCard,
  type GuildContributor,
} from "@/components/game/GuildTreasuryCard";
import { GuildMemberActions } from "@/components/game/GuildMemberActions";
import { GuildLeaveButton } from "@/components/game/GuildLeaveButton";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("הברית שלי | KRALDOR") };
}

/** How many guilds the recruitment browser lists. */
const GUILD_BROWSE_LIMIT = 100;

/* -------- no guild yet: create + browse open guilds -------- */

async function NoGuildView({
  empireId,
  diamonds,
}: {
  empireId: string;
  diamonds: number;
}) {
  const t = await getT();
  // Bounded: this is a recruitment browser, not a directory. Unbounded it grew
  // with the player count and carried a nested per-guild join, reachable by any
  // guildless player on every page load.
  const [guilds, invites] = await Promise.all([
    prisma.guild.findMany({
      orderBy: { createdAt: "asc" },
      take: GUILD_BROWSE_LIMIT,
      include: {
        _count: { select: { members: true } },
        members: {
          where: { role: "LEADER" },
          include: { empire: { select: { name: true } } },
        },
      },
    }),
    // Live invitations only — a lapsed row is not a door, and joinGuild would
    // refuse it anyway.
    prisma.guildInvite.findMany({
      where: { empireId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      include: {
        guild: {
          include: {
            _count: { select: { members: true } },
            members: {
              where: { role: "LEADER" },
              include: { empire: { select: { name: true } } },
            },
          },
        },
        invitedBy: { select: { name: true } },
      },
    }),
  ]);

  const invitedGuildIds = new Set(invites.map((i) => i.guildId));

  return (
    <>
      {/* The same hall the members see, drawn at the size a fully upgraded
          guild reaches and with every seat dark. */}
      <GuildHall seats={guildCapacity(GUILD_CAPACITY_MAX_LEVEL)} taken={0} mySeat={-1}>
        <p className="text-base font-bold tracking-wide text-gold-bright">
          {t("אין לך ברית")}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {t("האולם ריק — המתן להזמנה לברית קיימת או הקם אחת משלך.")}
        </p>
      </GuildHall>

      {/* -------- standing invitations: the only way in -------- */}
      {invites.length > 0 && (
        <div className="panel-gold rounded-xl p-4">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="messages" size={18} className="text-crimson" />
            {t("הזמנות שממתינות לך")}
            <span className="nums mr-auto rounded-full border border-gold/50 bg-panel-inset px-2.5 py-0.5 text-xs font-bold text-gold-bright" dir="ltr">
              {invites.length}
            </span>
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            {t(
              "הזמנה תקפה ל־{hours} שעות מרגע שנשלחה. אישור מכניס אותך לברית מיד — ושאר ההזמנות שלך נמחקות.",
              { hours: GUILD_INVITE_TTL_HOURS }
            )}
          </p>

          <ul className="space-y-2">
            {invites.map((invite, index) => {
              const capacity = guildCapacity(invite.guild.capacityLevel);
              const memberCount = invite.guild._count.members;
              return (
                <li
                  key={invite.id}
                  className="panel-inset gd-row flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5"
                  style={{ "--i": index } as CSSProperties}
                >
                  <span className="text-sm font-bold text-gold-bright">
                    {/* Before you answer an invitation you want to see who is
                        already in the hall — the name is the way in. */}
                    <GuildLink guildId={invite.guildId} name={invite.guild.name} />
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {t("מנהיג:")}{" "}
                    {invite.guild.members[0] ? (
                      <PlayerLink
                        empireId={invite.guild.members[0].empireId}
                        name={invite.guild.members[0].empire.name}
                      />
                    ) : (
                      "—"
                    )}
                  </span>
                  <span className="nums text-[11px] text-zinc-500" dir="ltr">
                    {memberCount}/{capacity}
                  </span>
                  {invite.invitedBy && (
                    <span className="text-[11px] text-zinc-500">
                      {t("הוזמנת ע״י")}{" "}
                      {/* SetNull on the FK: the recruiter can be gone while the
                          invitation still stands, and then there is nothing to
                          open — PlayerLink falls back to plain text. */}
                      <PlayerLink
                        empireId={invite.invitedById}
                        name={invite.invitedBy.name}
                      />
                    </span>
                  )}
                  <div className="mr-auto">
                    <GuildInviteActions
                      guildId={invite.guildId}
                      guildName={invite.guild.name}
                      full={memberCount >= capacity}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* -------- active recruitment (right in RTL) -------- */}
        <div className="panel rounded-xl p-4">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="citizens" size={18} className="text-crimson" />
            {t("בריתות הממלכה")}
          </h2>
          {/* This list used to carry a "הצטרף" button on every row, which was
              the whole bug: joining asked for nothing but a guild id, so the
              directory was an open door into any guild in the game. */}
          <p className="mb-4 text-xs text-zinc-500">
            {t("הכניסה לברית היא בהזמנה בלבד — פנה למנהיג או לסגן כדי שיזמינו אותך.")}
          </p>

          {guilds.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              {t("עדיין אין בריתות בממלכה — היה הראשון להקים אחת!")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-right text-xs text-gold-dim">
                    <th className="pb-2 pr-2 font-semibold">{t("שם הברית")}</th>
                    <th className="pb-2 font-semibold">{t("מנהיג")}</th>
                    <th className="pb-2 font-semibold">{t("חברים")}</th>
                    <th className="pb-2 pl-2 font-semibold">{t("הצטרפות")}</th>
                  </tr>
                </thead>
                <tbody>
                  {guilds.map((guild, index) => {
                    const capacity = guildCapacity(guild.capacityLevel);
                    const memberCount = guild._count.members;
                    return (
                      <tr
                        key={guild.id}
                        className="gd-row border-b border-border-subtle last:border-0"
                        // Capped: this browser lists up to 100 guilds and a
                        // linear delay would leave the tail sitting blank.
                        style={{ "--i": Math.min(index, 12) } as CSSProperties}
                      >
                        <td className="py-3 pr-2">
                          <span className="font-semibold text-zinc-100">
                            <GuildLink guildId={guild.id} name={guild.name} />
                          </span>
                        </td>
                        <td className="py-3 text-zinc-300">
                          {/* Joining is by invitation only, so the leader's name
                              is the one actionable thing on the row: his dossier
                              is where the "send him mail" button lives. */}
                          {guild.members[0] ? (
                            <PlayerLink
                              empireId={guild.members[0].empireId}
                              name={guild.members[0].empire.name}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3">
                          <span className="nums text-zinc-200" dir="ltr">
                            {memberCount}/{capacity}
                          </span>
                        </td>
                        <td className="py-3 pl-2">
                          {invitedGuildIds.has(guild.id) ? (
                            <span className="inline-block rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold-bright">
                              {t("הוזמנת ✉︎")}
                            </span>
                          ) : memberCount >= capacity ? (
                            <span className="inline-block rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400">
                              {t("מלאה 🚫")}
                            </span>
                          ) : (
                            <span className="inline-block rounded-full border border-border-subtle bg-panel-inset px-2.5 py-1 text-[11px] font-semibold text-zinc-500">
                              {t("בהזמנה בלבד")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* -------- create guild (left in RTL) -------- */}
        <div className="panel-gold relative rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
              <Icon name="base" size={18} className="text-crimson" />
              {t("יצירת ברית")}
            </h2>
            <span className="nums flex items-center gap-1 rounded-full border border-gold/50 bg-panel-inset px-3 py-1 text-sm font-bold text-sky-300">
              <Icon name="diamond" size={14} className="text-cyan-300" /> {GUILD_CREATION_COST_DIAMONDS}
            </span>
          </div>

          <GuildCreateForm diamonds={diamonds} />
        </div>
      </div>
    </>
  );
}

/* -------- page -------- */

export default async function GuildPage() {
  const empire = await requireEmpire();
  const t = await getT();

  const membership = await prisma.guildMember.findUnique({
    where: { empireId: empire.id },
    include: {
      guild: {
        include: {
          members: {
            include: {
              empire: {
                select: {
                  id: true,
                  name: true,
                  // A staff member in the guild is named in molten gold on the
                  // roster — they lend it no power and never take the field in
                  // the war (see src/lib/staff.ts), so the roster has to say so
                  // rather than count them as a fighter.
                  isStaff: true,
                  // The תואר beside a guildmate's name. This is the roster you
                  // read most often in the game, and the one place where the
                  // people on the list are not rivals — which is exactly why a
                  // title belongs on it: it is the only board that shows off
                  // your own.
                  title: true,
                  // Collapsed to a boolean before it reaches the roster below —
                  // the raw heartbeat never becomes a prop. `isBot` rides along
                  // because presence is read off the whole row (see isOnline).
                  lastSeenAt: true,
                  isBot: true,
                  // The roster shows the hero level, not `empire.level` — that
                  // column is never incremented by gameplay.
                  hero: { select: { level: true } },
                },
              },
            },
          },
          spells: true,
        },
      },
    },
  });

  const diamonds = Math.floor(empire.diamonds);

  if (!membership) {
    return (
      <div className="space-y-6">
        <SectionHeading
          title={t("הברית שלי")}
          ornament={<Icon name="base" size={22} className="text-crimson" />}
        />
        <NoGuildView empireId={empire.id} diamonds={diamonds} />
      </div>
    );
  }

  const { guild } = membership;
  const capacity = guildCapacity(guild.capacityLevel);
  const availableGold = Math.floor(empire.gold);
  const isLeadership = membership.role !== "MEMBER";
  const members = [...guild.members].sort(
    (a, b) =>
      GUILD_ROLE_META[a.role].order - GUILD_ROLE_META[b.role].order ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );

  // The contribution board, derived from the roster this page has already
  // loaded rather than queried again. Only members who have actually given
  // appear: a list of zeroes names everybody who has not donated, which is a
  // wall of shame nobody asked for and the wrong tone for a guild screen.
  const contributors: GuildContributor[] = members
    .filter((m) => m.donated > 0)
    .sort((a, b) => b.donated - a.donated)
    .map((m) => ({
      empireId: m.empire.id,
      empireName: m.empire.name,
      donated: m.donated,
      isMe: m.empire.id === empire.id,
    }));

  // The viewer's active spell buffs, keyed by type.
  const now = new Date();
  const activeBuffs = await prisma.guildSpellBuff.findMany({
    where: { empireId: empire.id, expiresAt: { gt: now } },
  });
  const activeUntilByType = new Map(
    activeBuffs.map((buff) => [buff.type, buff.expiresAt.toISOString()])
  );
  const spellLevelByType = new Map(guild.spells.map((s) => [s.type, s.level]));

  return (
    <div className="space-y-6">
      <SectionHeading
        title={guild.name}
        ornament={<Icon name="base" size={22} className="text-crimson" />}
      />

      <GuildHall
        seats={capacity}
        taken={members.length}
        mySeat={members.findIndex((m) => m.empireId === empire.id)}
      >
        <p className="text-base font-bold tracking-wide text-gold-bright">
          {t("אולם הברית")}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          <span className="nums font-bold text-gold-bright" dir="ltr">
            {members.length}/{capacity}
          </span>{" "}
          {t("מושבים תפוסים סביב השולחן")}
        </p>
      </GuildHall>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          {t("התפקיד שלך:")}{" "}
          <span className="font-bold text-gold-bright">
            {GUILD_ROLE_META[membership.role].icon}{" "}
            {t(GUILD_ROLE_META[membership.role].label)}
          </span>
        </p>
        <GuildLeaveButton
          disbands={membership.role === "LEADER" && members.length === 1}
        />
      </div>

      <div className="grid items-start gap-4">
        {/* -------- members -------- */}
        <div className="panel rounded-xl p-4">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="citizens" size={18} className="text-crimson" />
            {t("חברי הברית")}
            <span className="nums mr-auto text-sm font-bold text-zinc-400" dir="ltr">
              {members.length}/{capacity}
            </span>
          </h2>

          <ul className="space-y-2">
            {members.map((member, index) => {
              const roleMeta = GUILD_ROLE_META[member.role];
              return (
                <li
                  key={member.id}
                  className="panel-inset gd-row flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
                  style={{ "--i": index } as CSSProperties}
                >
                  {/* Who is around right now is the first thing a guild roster
                      is read for — whether the war call, the spell request or
                      the mail you are about to send will be seen in the next
                      minute or tomorrow morning. Before the name, which on this
                      RTL row draws it at the name's right edge. */}
                  <PresenceDot
                    online={
                      member.empireId === empire.id || isOnline(member.empire, now)
                    }
                  />
                  <span className="text-sm font-semibold text-zinc-100">
                    <PlayerLink
                      empireId={member.empireId}
                      name={member.empire.name}
                      titleKey={member.empire.title}
                      staff={member.empire.isStaff}
                    />
                    {member.empireId === empire.id && (
                      <span className="mr-1 text-xs text-gold-dim">{t("(אתה)")}</span>
                    )}
                  </span>
                  <span className="rounded-full border border-gold/40 bg-panel-inset px-2 py-0.5 text-[10px] font-bold text-gold-bright">
                    {roleMeta.icon} {t(roleMeta.label)}
                  </span>
                  <span className="nums text-[11px] text-zinc-500" title={t("רמת הגיבור")}>
                    {t("גיבור רמה")}{" "}
                    <span dir="ltr">{member.empire.hero?.level ?? 1}</span>
                  </span>
                  {member.empireId !== empire.id && (
                    <div className="mr-auto">
                      <GuildMemberActions
                        targetEmpireId={member.empireId}
                        targetName={member.empire.name}
                        targetRole={member.role}
                        viewerRole={membership.role}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Leader and deputy recruit straight into the roster. */}
          {isLeadership && (
            <GuildAddMemberForm full={members.length >= capacity} />
          )}
        </div>
      </div>

      {/* -------- the treasury: donations in, guild upgrades out -------- */}
      <GuildTreasuryCard
        treasury={guild.treasury}
        availableGold={availableGold}
        contributors={contributors}
      />

      {/* -------- gold upgrades, bought from the treasury -------- */}
      <div className="panel rounded-xl p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="gold" size={18} className="text-gold-bright" />
            {t("שדרוגי זהב הברית")}
          </h2>
          <span className="nums flex items-center gap-1 rounded-full border border-gold/40 bg-panel-inset px-3 py-1 text-xs font-bold text-gold-bright" dir="ltr">
            {formatNumber(Math.floor(guild.treasury))}{" "}
            <Icon name="gold" size={13} className="text-gold-bright" />
          </span>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          <RichText
            text={t("שני הסולמות האלה משולמים מ**אוצר הברית** — מנהיג או סגן קונים, וכל החברים נהנים.")}
            strong="font-semibold text-gold-dim"
          />
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <GuildCapacityCard
            memberCount={members.length}
            capacity={capacity}
            upgradeCost={
              guild.capacityLevel >= GUILD_CAPACITY_MAX_LEVEL
                ? null
                : capacityUpgradeCostGold(guild.capacityLevel)
            }
            treasury={guild.treasury}
            mayUpgrade={isLeadership}
          />
          <GuildAidCard
            aidPct={guildAidPct(guild.aidLevel)}
            upgradeCost={
              guild.aidLevel >= GUILD_AID_MAX_LEVEL
                ? null
                : aidUpgradeCostGold(guild.aidLevel)
            }
            treasury={guild.treasury}
            mayUpgrade={isLeadership}
          />
        </div>
      </div>

      {/* -------- diamond spell shop -------- */}
      <div className="panel rounded-xl p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="diamond" size={18} className="text-cyan-300" />
            {t("קסמי יהלום")}
          </h2>
          <span className="nums flex items-center gap-1 rounded-full border border-cyan-400/40 bg-panel-inset px-3 py-1 text-xs font-bold text-cyan-300" dir="ltr">
            {formatNumber(diamonds)}{" "}
            <Icon name="diamond" size={13} className="text-cyan-300" />
          </span>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          <RichText
            text={t(
              "קסמי התקפה, הגנה ומשאבים נקנים ב**יהלומים** אישיים. שדרוג קסם מעלה את עזרת הקסם לכל החברים, והטלה מעניקה לך באפ אישי של עד **{pct}% ל־{hours} שעות**.",
              {
                pct: GUILD_SPELL_META.ATTACK.maxLevel,
                hours: GUILD_SPELL_META.ATTACK.buffHours,
              }
            )}
            strong="font-semibold text-cyan-300"
          />
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GUILD_SPELL_TYPES.map((type, index) => {
            const level = spellLevelByType.get(type) ?? 1;
            // Resolve the "active until HH:MM" label here (server-side) so the
            // client card never reads the clock during render.
            const activeUntil = activeUntilByType.get(type) ?? null;
            const activeLabel =
              activeUntil && new Date(activeUntil).getTime() > new Date().getTime()
                ? new Date(activeUntil).toLocaleTimeString("he-IL", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null;
            return (
              <GuildShopCard
                key={type}
                type={type}
                index={index}
                bonusPct={guildSpellBonusPct(type, level)}
                maxPct={guildSpellMaxLevel(type)}
                upgradeCost={
                  level >= guildSpellMaxLevel(type)
                    ? null
                    : spellUpgradeCostDiamonds(level)
                }
                castCost={spellCastCostDiamonds(type, level)}
                activeLabel={activeLabel}
                diamonds={diamonds}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
