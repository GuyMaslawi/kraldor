import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { notBannedWhere } from "@/lib/ban";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { isOnline } from "@/lib/game/chat";
import { formatDate } from "@/lib/game/format";
import { markMessagesRead } from "@/server/actions/messages";
import { MESSAGE_ROSTER_SEED } from "@/lib/game/messages";
import { MarkSeen } from "@/components/game/MarkSeen";
import { MessageCompose, type PlayerOption } from "@/components/game/MessageCompose";
import { ContactStaff } from "@/components/game/ContactStaff";
import type { MessageKind } from "@prisma/client";
import type { CSSProperties, ReactNode } from "react";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("הודעות | קראלדור") };
}

/** The night sky over the loft — fixed, so SSR and hydration agree. */
const STARS = [
  { x: "8%", y: "62%", d: "0s", dur: "4.5s" },
  { x: "22%", y: "24%", d: "1.6s", dur: "5.5s" },
  { x: "37%", y: "72%", d: "0.7s", dur: "4s" },
  { x: "54%", y: "18%", d: "2.9s", dur: "6s" },
  { x: "63%", y: "58%", d: "1.1s", dur: "5s" },
  { x: "79%", y: "30%", d: "3.4s", dur: "4.8s" },
  { x: "91%", y: "70%", d: "2.2s", dur: "5.7s" },
];

/** Couriers crossing the banner, right to left. */
const BIRDS = [
  { top: "26%", d: "0s", dur: "13s" },
  { top: "58%", d: "6.5s", dur: "17s" },
];

const KIND_META: Record<MessageKind, { icon: ReactNode; label: string; tone: string }> = {
  SYSTEM: { icon: "📣", label: "מערכת", tone: "border-gold/40 text-gold" },
  BATTLE: { icon: <Icon name="attack" size={22} />, label: "קרב", tone: "border-red-500/40 text-red-400" },
  SPY: { icon: <Icon name="spy" size={22} />, label: "ריגול", tone: "border-purple-500/40 text-purple-300" },
  PLAYER: { icon: <Icon name="messages" size={22} />, label: "משחקן", tone: "border-emerald-500/40 text-emerald-300" },
};

export default async function MessagesPage() {
  const { t, locale } = await getI18n();
  const empire = await requireEmpire();

  const [messages, roster] = await Promise.all([
    prisma.message.findMany({
      where: { empireId: empire.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      // The sender is selected down to a name and a heartbeat, and the heartbeat
      // is collapsed to a boolean below — the timestamp itself never crosses.
      // `isStaff` rides along so a letter from the game's own account is named
      // in molten gold — the one channel staff still share with players. `id` and
      // `isBot` are what presence is read off (see isOnline); the id is already
      // public here — the name beside it links to the profile it names.
      include: {
        sender: {
          select: { id: true, name: true, lastSeenAt: true, isStaff: true, isBot: true },
        },
      },
    }),
    // The seed the compose form opens on — an alphabetical first page, not the
    // roster. This used to be `take: 1000`, which meant every load of this page
    // serialised the entire player directory into the RSC payload so a search
    // box could filter it client-side; the box now asks the server instead (see
    // searchMessageRecipients). Only id + name leave here either way — this is
    // an address book, not a scouting report.
    prisma.empire.findMany({
      where: { id: { not: empire.id }, user: notBannedWhere() },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: MESSAGE_ROSTER_SEED,
    }),
  ]);

  const players: PlayerOption[] = roster;

  // "New" = unread, or read moments ago (so the highlight survives the
  // mark-read revalidation that clears the sidebar badge).
  const now = new Date();
  const freshCutoff = new Date(now.getTime() - 2 * 60 * 1000);
  const isNew = (m: (typeof messages)[number]) =>
    m.readAt === null || m.readAt > freshCutoff;
  const unread = messages.filter(isNew).length;

  return (
    <div className="space-y-6">
      <MarkSeen action={markMessagesRead} clears="messages" />
        <SectionHeading title={t("הודעות")} ornament={<Icon name="messages" size={22} className="text-crimson" />} />

      {/* -------- the loft --------
          A night sky with couriers crossing it. The wax seal is the one part
          that is not scenery: it rings only while something in the box has not
          been opened, and this page marks everything read as it loads, so it
          is showing what was waiting when you walked in. */}
      <div className="panel-gold mail-loft rounded-2xl p-4">
        <span className="mail-moon" aria-hidden />
        <span className="mail-stars" aria-hidden>
          {STARS.map((star) => (
            <span
              key={star.x}
              style={
                { "--x": star.x, "--y": star.y, "--d": star.d, "--dur": star.dur } as CSSProperties
              }
            />
          ))}
        </span>
        {BIRDS.map((bird) => (
          <span
            key={bird.top}
            className="mail-bird"
            aria-hidden
            style={{ "--top": bird.top, "--d": bird.d, "--dur": bird.dur } as CSSProperties}
          />
        ))}

        <div className="mail-body flex items-center justify-center gap-3 text-center">
          <span
            className={`mail-seal grid h-11 w-11 shrink-0 place-items-center rounded-full border ${
              unread > 0
                ? "is-unread border-red-500/60 bg-red-950/50 text-red-300"
                : "border-gold/40 bg-panel-inset text-gold-dim"
            }`}
            aria-hidden
          >
            <Icon name="messages" size={22} />
          </span>
          <div className="text-right">
            <p className="text-base font-bold tracking-wide text-gold-bright">
            {t("מגדל היונים")}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {unread > 0 ? (
                <>
                  <span className="nums font-bold text-red-300" dir="ltr">
                    {unread}
                  </span>{" "}
              {t("הודעות חדשות מתוך")}{" "}
                </>
              ) : (
              t("אין דואר חדש — ")
              )}
              <span className="nums font-bold text-zinc-300" dir="ltr">
                {messages.length}
              </span>{" "}
              {t("בתיבה")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
            {t("תיבת הדואר שלך — הודעות משחקנים והתראות מהמערכת.")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* The one address in the game that is not another player. It sits
              beside "שלח הודעה" because this is the screen a player is on when
              they have something to say and are looking for who to say it to —
              and a report about a cheat or a broken purchase must not depend on
              knowing that an admin has an empire and what it is called. It
              opens the staff conversation in the chat dock; see ContactStaff. */}
          <ContactStaff />
          <MessageCompose players={players} />
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="panel-gold rounded-xl p-10 text-center">
          <p className="text-4xl">🕊️</p>
            <p className="mt-3 font-bold text-zinc-300">{t("אין הודעות עדיין")}</p>
          <p className="mt-1 text-sm text-zinc-500">
              {t("הודעות משחקנים, התראות על התקפות, מרגלים שנתפסו ועדכוני מערכת יופיעו כאן.")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {messages.map((m, index) => {
            const meta = KIND_META[m.kind];
            const fresh = isNew(m);
            // A PLAYER message whose author was deleted keeps its text but
            // loses the name (the FK is SetNull, not Cascade).
            const from =
              m.kind === "PLAYER" ? m.sender?.name ?? t("שחקן שנמחק") : null;
            // `undefined` for a deleted author, which draws no dot at all — a
            // hollow ring would claim he is merely away. System mail (a battle
            // report, a quest haul) has no sender to be online in the first place.
            const fromOnline = m.sender ? isOnline(m.sender, now) : undefined;
            return (
              <li
                key={m.id}
                style={{ "--i": Math.min(index, 12) } as CSSProperties}
                className={`panel-gold mail-item rounded-xl p-4 ${
                  fresh ? "is-fresh border-gold/60 shadow-[inset_3px_0_0_var(--gold)]" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mail-glyph flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-panel-inset text-xl ${meta.tone}`}
                    aria-hidden
                  >
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-bold text-zinc-100">{m.title}</p>
                      {fresh && (
                        <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                          {t("חדש")}
                        </span>
                      )}
                    </div>
                    {from && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-300/90">
                        <span>
                        {t("מאת")}{" "}
                          {/* The name is the way to his dossier — an inbox is
                              where you meet a rival, and answering the letter
                              usually means looking him up first. `senderEmpireId`
                              is on the row itself, so this costs no extra read;
                              a deleted author has no id and stays flat text. */}
                          <PlayerLink
                            empireId={m.senderEmpireId}
                            name={from}
                            className="font-bold"
                            staff={m.sender?.isStaff ?? false}
                          />
                        </span>
                        {/* Whether the sender is at the keyboard is what decides
                            if a reply is a conversation or a letter — so it sits
                            on the "from" line, not somewhere else on the card. */}
                        <PresenceDot online={fromOnline} />
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                      {m.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className={`font-semibold ${meta.tone.split(" ")[1]}`}>
                        {t(meta.label)}
                      </span>
                      <span className="text-zinc-600" aria-hidden>·</span>
                      <span className="nums text-zinc-500" dir="ltr">
                        {formatDate(m.createdAt, locale)}
                      </span>
                      {m.href && (
                        <>
                          <span className="text-zinc-600" aria-hidden>·</span>
                          <Link
                            href={m.href}
                            className="font-bold text-gold-bright hover:text-white"
                          >
                          {t("לצפייה בדוח המלא")} ←
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
