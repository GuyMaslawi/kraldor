import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireEmpire } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { GuildHall } from "@/components/game/GuildHall";
import { GuildInviteActions } from "@/components/game/GuildInviteActions";
import { isOnline } from "@/lib/game/chat";
import { cityName } from "@/lib/game/cities";
import { formatDate } from "@/lib/game/format";
import { getI18n, getT } from "@/i18n/server";
import {
  GUILD_INVITE_TTL_HOURS,
  GUILD_ROLE_META,
  guildAidPct,
  guildCapacity,
} from "@/lib/game/guild";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("ברית | KRALDOR") };
}

/**
 * Another guild's hall, seen from outside.
 *
 * Every guild name in the game is a link (see components/ui/GuildLink) and this
 * is what it opens: the same hall the members sit in, the same roster, and
 * nothing else. It exists because a guild name was the one proper noun in the
 * game that led nowhere — the ladder printed it beside a rival, the war board
 * ranked it, the recruitment directory listed it, and none of them could answer
 * "who is actually in it".
 *
 * ## What it does and does not show
 *
 * The roster is public knowledge and always was: every member of it is on the
 * rankings ladder with his military power beside his name, and the war board
 * publishes each enrolled guild's combined power. So names, roles and hero
 * levels cost nothing to publish here.
 *
 * The treasury and the donation board are not here, and that is the whole
 * difference between this page and /game/guild. Who carried the guild is the
 * thing a guild argues about internally; it is not intelligence for a rival,
 * and a stranger reading "he gave 40% of the treasury" learns which member is
 * the guild's bank. עזרת הברית *is* shown — a battle report already itemises
 * the opponent's aid percentage in the power ledger, so it is published
 * knowledge the moment you fight one of them.
 *
 * A member who opens his own guild's dossier is sent to /game/guild instead:
 * this page would be the same hall with the treasury and the buttons cut out,
 * which is nothing but his own screen made worse.
 */
export default async function GuildDossierPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { t, locale } = await getI18n();
  const { guildId } = await params;
  const me = await requireEmpire();

  const [guild, myMembership] = await Promise.all([
    prisma.guild.findUnique({
      where: { id: guildId },
      select: {
        id: true,
        name: true,
        capacityLevel: true,
        aidLevel: true,
        createdAt: true,
        members: {
          select: {
            id: true,
            role: true,
            empireId: true,
            createdAt: true,
            empire: {
              select: {
                id: true,
                name: true,
                // Same three as the members' own roster: staff are named in
                // molten gold and lend the guild no power, a תואר rides beside
                // the name, and presence is collapsed to a boolean below so the
                // raw heartbeat never becomes a prop.
                isStaff: true,
                title: true,
                lastSeenAt: true,
                isBot: true,
                // The leader's tier is the guild's tier — the one thing a
                // stranger reading this dossier needs to know before asking for
                // an invitation. See server/guildCity.ts.
                cities: true,
                hero: { select: { level: true } },
              },
            },
          },
        },
      },
    }),
    prisma.guildMember.findUnique({
      where: { empireId: me.id },
      select: { guildId: true },
    }),
  ]);

  if (!guild) notFound();
  // His own hall has a door of its own, with the treasury and the buttons on it.
  if (myMembership?.guildId === guild.id) redirect("/game/guild");

  const capacity = guildCapacity(guild.capacityLevel);
  const members = [...guild.members].sort(
    (a, b) =>
      GUILD_ROLE_META[a.role].order - GUILD_ROLE_META[b.role].order ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
  const full = members.length >= capacity;
  const guildCity =
    members.find((m) => m.role === "LEADER")?.empire.cities ?? null;

  // The one thing a stranger can act on here. Only asked for when he is
  // guildless — a member of another guild cannot accept anything anyway, and
  // the query would be a read nobody uses.
  const invite = myMembership
    ? null
    : await prisma.guildInvite.findFirst({
        where: { guildId: guild.id, empireId: me.id, expiresAt: { gt: new Date() } },
        select: { id: true },
      });

  const now = new Date();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={guild.name}
        ornament={<Icon name="base" size={22} className="text-crimson" />}
      />

      <GuildHall seats={capacity} taken={members.length} mySeat={-1}>
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

      {/* -------- the guild in three numbers -------- */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="panel-inset flex items-center gap-1.5 rounded-full px-3 py-1">
          <span className="text-zinc-500">{t("חברים")}</span>
          <span className="nums font-bold text-zinc-200" dir="ltr">
            {members.length}/{capacity}
          </span>
        </span>
        {guildCity !== null && (
          <span
            className="panel-inset flex items-center gap-1.5 rounded-full px-3 py-1"
            title={t("ברית מאחדת שחקנים מאותה העיר בלבד")}
          >
            <span className="text-zinc-500">{t("עיר")}</span>
            <span
              className={`font-bold ${
                guildCity === me.cities ? "text-bone" : "text-zinc-500"
              }`}
            >
              {cityName(t, guildCity)}
            </span>
          </span>
        )}
        <span className="panel-inset flex items-center gap-1.5 rounded-full px-3 py-1">
          <span className="text-zinc-500">{t("עזרת ברית")}</span>
          <span className="nums font-bold text-gold-bright" dir="ltr">
            {guildAidPct(guild.aidLevel)}%
          </span>
        </span>
        <span className="panel-inset flex items-center gap-1.5 rounded-full px-3 py-1">
          <span className="text-zinc-500">{t("נוסדה")}</span>
          <span className="nums font-bold text-zinc-200">
            {formatDate(guild.createdAt, locale)}
          </span>
        </span>
      </div>

      {/* -------- the roster -------- */}
      <div className="panel rounded-xl p-4">
        <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
          <Icon name="citizens" size={18} className="text-crimson" />
          {t("חברי הברית")}
          <span className="nums mr-auto text-sm font-bold text-zinc-400" dir="ltr">
            {members.length}/{capacity}
          </span>
        </h2>

        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            {t("האולם ריק — לברית הזו אין חברים.")}
          </p>
        ) : (
          <ul className="space-y-2">
            {members.map((member, index) => {
              const roleMeta = GUILD_ROLE_META[member.role];
              return (
                <li
                  key={member.id}
                  className="panel-inset gd-row flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
                  style={{ "--i": index } as CSSProperties}
                >
                  <PresenceDot
                    online={
                      member.empireId === me.id || isOnline(member.empire, now)
                    }
                  />
                  <span className="text-sm font-semibold text-zinc-100">
                    <PlayerLink
                      empireId={member.empireId}
                      name={member.empire.name}
                      titleKey={member.empire.title}
                      staff={member.empire.isStaff}
                    />
                  </span>
                  <span className="rounded-full border border-gold/40 bg-panel-inset px-2 py-0.5 text-[10px] font-bold text-gold-bright">
                    {roleMeta.icon} {t(roleMeta.label)}
                  </span>
                  <span className="nums text-[11px] text-zinc-500" title={t("רמת הגיבור")}>
                    {t("גיבור רמה")}{" "}
                    <span dir="ltr">{member.empire.hero?.level ?? 1}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* -------- how one gets in, if at all -------- */}
      <div className="panel-gold rounded-xl p-4">
        {invite ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">
              {t("הוזמנת לברית הזו — ההזמנה תקפה ל־{hours} שעות מרגע ששלחו אותה.", {
                hours: GUILD_INVITE_TTL_HOURS,
              })}
            </p>
            <GuildInviteActions guildId={guild.id} guildName={guild.name} full={full} />
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            {myMembership
              ? t("אתה כבר חבר בברית אחרת — עזוב אותה כדי שיוכלו להזמין אותך לכאן.")
              : t("הכניסה לברית היא בהזמנה בלבד — פנה למנהיג או לסגן כדי שיזמינו אותך.")}
          </p>
        )}
        <Link href="/game/guild" className="btn btn-ghost mt-3 w-full py-2 text-sm">
          <Icon name="guild" size={16} className="inline-block align-middle" />{" "}
          {myMembership ? t("לעמוד הברית שלי") : t("לבריתות הממלכה")}
        </Link>
      </div>
    </div>
  );
}
