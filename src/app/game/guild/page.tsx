import type { CSSProperties, ReactNode } from "react";
import { requireEmpire } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { isOnline } from "@/lib/game/chat";
import { formatNumber } from "@/lib/game/format";
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

export const metadata = { title: "הברית שלי | KRALDOR" };

/** How many guilds the recruitment browser lists. */
const GUILD_BROWSE_LIMIT = 100;

/**
 * Embers rising off the brazier: `[left %, delay s, duration s, drift px]`.
 * A fixed table, never `Math.random()` — the server and the first client render
 * have to agree on every one of these numbers.
 */
const EMBERS: [number, number, number, number][] = [
  [38, 0, 5.4, -14],
  [46, 1.7, 6.2, 9],
  [54, 3.1, 5.8, -7],
  [61, 0.9, 6.6, 13],
  [44, 4.3, 5.1, 16],
  [57, 2.4, 6.9, -11],
];

/**
 * The hall at the top of both guild views: war banners on the wall, a hearth
 * in the middle of the table and one pennant per seat the guild has bought.
 *
 * The seat row is the whole reason the scene is worth drawing — it is live
 * data, not decoration. A lit pennant is a member, a dark one is a vacancy,
 * and the brightest one is you. A player with no guild yet gets the same hall
 * cold and empty, so the recruiting screen never looks like a hall he already
 * owns.
 */
function GuildHall({
  seats,
  taken,
  mySeat,
  children,
}: {
  seats: number;
  taken: number;
  /** Index of the viewer's own seat, or -1 when he has no guild yet. */
  mySeat: number;
  children: ReactNode;
}) {
  return (
    <div className={`panel-gold gd-hall rounded-2xl p-4${taken === 0 ? " is-empty" : ""}`}>
      <span className="gd-banner gd-banner-r" aria-hidden />
      <span className="gd-banner gd-banner-l" aria-hidden />
      <span className="gd-hearth" aria-hidden />
      {/* Sparks off the brazier — they only rise once someone is seated. */}
      {EMBERS.map(([left, delay, duration, drift], i) => (
        <span
          key={i}
          className="gd-ember"
          aria-hidden
          style={
            {
              left: `${left}%`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              "--drift": `${drift}px`,
            } as CSSProperties
          }
        />
      ))}

      <div className="gd-body text-center">
        {children}
        <div className="mt-3 flex items-end justify-center gap-1.5" aria-hidden>
          {Array.from({ length: seats }).map((_, i) => (
            <span
              key={i}
              className={`gd-seat${i < taken ? " is-taken" : ""}${
                i === mySeat ? " is-me" : ""
              }`}
              style={{ "--i": i } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------- no guild yet: create + browse open guilds -------- */

async function NoGuildView({
  empireId,
  diamonds,
}: {
  empireId: string;
  diamonds: number;
}) {
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
          אין לך ברית
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          האולם ריק — המתן להזמנה לברית קיימת או הקם אחת משלך.
        </p>
      </GuildHall>

      {/* -------- standing invitations: the only way in -------- */}
      {invites.length > 0 && (
        <div className="panel-gold rounded-xl p-4">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="messages" size={18} className="text-crimson" />
            הזמנות שממתינות לך
            <span className="nums mr-auto rounded-full border border-gold/50 bg-panel-inset px-2.5 py-0.5 text-xs font-bold text-gold-bright" dir="ltr">
              {invites.length}
            </span>
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            הזמנה תקפה ל־{GUILD_INVITE_TTL_HOURS} שעות מרגע שנשלחה. אישור מכניס
            אותך לברית מיד — ושאר ההזמנות שלך נמחקות.
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
                    {invite.guild.name}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    מנהיג:{" "}
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
                      הוזמנת ע״י{" "}
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
            בריתות הממלכה
          </h2>
          {/* This list used to carry a "הצטרף" button on every row, which was
              the whole bug: joining asked for nothing but a guild id, so the
              directory was an open door into any guild in the game. */}
          <p className="mb-4 text-xs text-zinc-500">
            הכניסה לברית היא בהזמנה בלבד — פנה למנהיג או לסגן כדי שיזמינו אותך.
          </p>

          {guilds.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              עדיין אין בריתות בממלכה — היה הראשון להקים אחת!
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-right text-xs text-gold-dim">
                    <th className="pb-2 pr-2 font-semibold">שם הברית</th>
                    <th className="pb-2 font-semibold">מנהיג</th>
                    <th className="pb-2 font-semibold">חברים</th>
                    <th className="pb-2 pl-2 font-semibold">הצטרפות</th>
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
                            {guild.name}
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
                              הוזמנת ✉︎
                            </span>
                          ) : memberCount >= capacity ? (
                            <span className="inline-block rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400">
                              מלאה 🚫
                            </span>
                          ) : (
                            <span className="inline-block rounded-full border border-border-subtle bg-panel-inset px-2.5 py-1 text-[11px] font-semibold text-zinc-500">
                              בהזמנה בלבד
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
              יצירת ברית
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
          title="הברית שלי"
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
          אולם הברית
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          <span className="nums font-bold text-gold-bright" dir="ltr">
            {members.length}/{capacity}
          </span>{" "}
          מושבים תפוסים סביב השולחן
        </p>
      </GuildHall>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          התפקיד שלך:{" "}
          <span className="font-bold text-gold-bright">
            {GUILD_ROLE_META[membership.role].icon}{" "}
            {GUILD_ROLE_META[membership.role].label}
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
            חברי הברית
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
                      staff={member.empire.isStaff}
                    />
                    {member.empireId === empire.id && (
                      <span className="mr-1 text-xs text-gold-dim">(אתה)</span>
                    )}
                  </span>
                  <span className="rounded-full border border-gold/40 bg-panel-inset px-2 py-0.5 text-[10px] font-bold text-gold-bright">
                    {roleMeta.icon} {roleMeta.label}
                  </span>
                  <span className="nums text-[11px] text-zinc-500" title="רמת הגיבור">
                    גיבור רמה{" "}
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
            שדרוגי זהב הברית
          </h2>
          <span className="nums flex items-center gap-1 rounded-full border border-gold/40 bg-panel-inset px-3 py-1 text-xs font-bold text-gold-bright" dir="ltr">
            {formatNumber(Math.floor(guild.treasury))}{" "}
            <Icon name="gold" size={13} className="text-gold-bright" />
          </span>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          שני הסולמות האלה משולמים מ
          <span className="font-semibold text-gold-dim">אוצר הברית</span> — מנהיג או
          סגן קונים, וכל החברים נהנים.
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
            קסמי יהלום
          </h2>
          <span className="nums flex items-center gap-1 rounded-full border border-cyan-400/40 bg-panel-inset px-3 py-1 text-xs font-bold text-cyan-300" dir="ltr">
            {formatNumber(diamonds)}{" "}
            <Icon name="diamond" size={13} className="text-cyan-300" />
          </span>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          קסמי התקפה, הגנה ומשאבים נקנים ב
          <span className="font-semibold text-cyan-300">יהלומים</span> אישיים. שדרוג קסם
          מעלה את עזרת הקסם לכל החברים, והטלה מעניקה לך באפ אישי של עד{" "}
          <span className="font-semibold text-gold-dim">
            {GUILD_SPELL_META.ATTACK.maxLevel}% ל־{GUILD_SPELL_META.ATTACK.buffHours} שעות
          </span>
          .
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
