import "server-only";
import { prisma } from "@/lib/prisma";
import { isBanned, notBannedWhere } from "@/lib/ban";
import { appBaseUrl, isMailLive, sendMail } from "@/server/mailer";
import { logError } from "@/server/errorLog";
import { makeT } from "@/i18n/translate";
import { LOCALE_DIR, toLocale } from "@/i18n/locale";

/**
 * "Somebody raided you while you were out."
 *
 * The game already tells a defender everything: the battle report, the inbox
 * alert, the live toast. Every one of those requires the player to be looking
 * at the game — which is precisely the state they are not in when it matters.
 * This is the one message that reaches somebody who has closed the tab.
 *
 * ## Three rules, and all three are about restraint
 *
 * 1. **It never blocks and never rolls back.** Every caller fires this
 *    *outside* its transaction and does not await the result for correctness.
 *    A mail provider having a bad minute must not cost a player their battle.
 * 2. **It is rationed hard.** One message per player per NOTIFY_COOLDOWN_MS,
 *    enforced by a guarded UPDATE rather than a read — a player being farmed
 *    would otherwise get twenty emails in an hour, and the free mail tier is
 *    300 a day for the whole game.
 * 3. **It says nothing worth stealing.** No figures, no numbers, no names of
 *    what was taken — just that something happened and a link to the game.
 *    Mail is the least private channel the game has, and a raid report in an
 *    inbox is a raid report in whoever's hands the inbox is in.
 */

/**
 * The quiet period between notifications, per player.
 *
 * Six hours. Long enough that a night of being farmed is one email, short
 * enough that a player raided on Monday and again on Wednesday hears about
 * both. Deliberately not per-*event*: the question a notification answers is
 * "is anything happening", and the second raid of an evening does not change
 * the answer.
 */
export const NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** What happened, in the only three flavours worth an email. */
export type NotifyKind = "raid" | "sabotage" | "spy";

/** Subject and body per kind. Deliberately free of figures — see rule 3. */
// i18n-keys-start: dictionary keys, resolved below against the *recipient's*
// stored language rather than the request's — see the note on the send.
const COPY: Record<NotifyKind, { subject: string; line: string }> = {
  raid: {
    subject: "קראלדור — תקפו את האימפריה שלך",
    line: "צבא זר פרץ את ההגנות שלך בזמן שלא היית. הדוח המלא מחכה לך במשחק.",
  },
  sabotage: {
    subject: "קראלדור — חבלה בשטחך",
    line: "מישהו שלח תא חבלה לאימפריה שלך. הפרטים מחכים לך בהיסטוריה.",
  },
  spy: {
    subject: "קראלדור — תפסו מרגל בשטחך",
    line: "כוחות הביטחון שלך תפסו מרגל זר. מישהו מתעניין בך.",
  },
};
// i18n-keys-end

/**
 * Claim the right to notify this player, then send.
 *
 * The claim is the interesting half. It is a single guarded UPDATE that
 * *both* tests every condition and stamps the cooldown — verified email, not
 * banned, opted in, and outside the quiet period — so two raids landing at the
 * same instant produce exactly one email. A read-then-send would produce two.
 *
 * Returns whether a message actually went out, which is only ever used by
 * tests and by the console fallback; no caller may branch on it, because a
 * caller that cares whether the mail arrived is a caller that is waiting for
 * it.
 */
export async function notifyPlayer(
  empireId: string,
  kind: NotifyKind
): Promise<boolean> {
  try {
    const empire = await prisma.empire.findUnique({
      where: { id: empireId },
      select: {
        name: true,
        // A garrison bot has no owner to write to, and a staff empire is not
        // playing. Neither should ever cost a send from the daily quota.
        isBot: true,
        isStaff: true,
        user: {
          select: {
            id: true,
            email: true,
            emailVerified: true,
            notifyRaids: true,
            notifiedAt: true,
            // Which language to write in. Not `getLocale()`: this send happens
            // on the *attacker's* request, so the cookie in hand is theirs.
            locale: true,
            // Both halves of a ban: `bannedAt` alone is a record that one was
            // handed down, never a statement that one is live. See lib/ban.ts.
            bannedAt: true,
            bannedUntil: true,
          },
        },
      },
    });
    if (!empire || empire.isBot || empire.isStaff) return false;

    const now = new Date();

    const user = empire.user;
    // Every one of these is re-tested inside the claim below; this early exit
    // only saves the write.
    if (!user?.email || !user.emailVerified || !user.notifyRaids) return false;
    // `isBanned`, never `bannedAt !== null`. Nothing sweeps a lapsed timed ban
    // off the row, so reading the column alone would silently cut a player off
    // from notifications forever for a ban that expired months ago — the house
    // rule stated at the top of lib/ban.ts.
    if (isBanned(user, now)) return false;

    const cutoff = new Date(now.getTime() - NOTIFY_COOLDOWN_MS);

    // The claim. `OR` on the timestamp rather than a plain `lt`, because a
    // player who has never been notified has `null` there and `lt` matches no
    // null in SQL — which would have meant nobody ever received a first one.
    //
    // Both that OR and the ban filter's own OR live under an explicit `AND`:
    // two `OR` keys cannot coexist in one Prisma filter object, and merging
    // them into a single disjunction would let a banned player through on the
    // strength of their cooldown having expired.
    const claimed = await prisma.user.updateMany({
      where: {
        id: user.id,
        notifyRaids: true,
        emailVerified: { not: null },
        AND: [
          notBannedWhere(now),
          { OR: [{ notifiedAt: null }, { notifiedAt: { lt: cutoff } }] },
        ],
      },
      data: { notifiedAt: now },
    });
    if (claimed.count === 0) return false;

    // The recipient's own language, from their account — the one place the
    // game knows it without a request of theirs to read a cookie from.
    const t = makeT(toLocale(user.locale ?? undefined));
    const subject = t(COPY[kind].subject);
    const line = t(COPY[kind].line);
    const url = `${appBaseUrl()}/game/reports`;
    const text = `${line}\n\n${url}\n\n${t("לביטול ההתראות: הגדרות > התראות")}`;

    // Kept to one paragraph and one link on purpose. A notification is an
    // invitation back to the game, not a substitute for opening it — and the
    // less it says, the less an inbox can leak.
    const html = `<div dir="${LOCALE_DIR[toLocale(user.locale ?? undefined)]}" style="font-family:system-ui,sans-serif;line-height:1.7;max-width:32rem">
<h2 style="margin:0 0 .5rem;color:#c4a032">${subject}</h2>
<p style="margin:0 0 1rem">${line}</p>
<p style="margin:0 0 1.25rem"><a href="${url}" style="background:#c4a032;color:#111;padding:.6rem 1.1rem;border-radius:.5rem;text-decoration:none;font-weight:700">${t("לפתיחת המשחק")}</a></p>
<p style="margin:0;font-size:.8rem;color:#888">${t("לביטול ההתראות: הגדרות ← התראות")}</p>
</div>`;

    if (!isMailLive()) {
      // No provider configured — the mailer logs instead of sending, which is
      // what makes the whole flow exercisable in development. The claim above
      // still ran, so the cooldown behaves identically either way.
      return sendMail({ to: user.email, subject, html, text });
    }
    return await sendMail({ to: user.email, subject, html, text });
  } catch (err) {
    // Never thrown to a caller: this runs beside a battle that has already
    // committed, and a mail failure must not surface as a failed attack.
    await logError("notify.notifyPlayer", err);
    return false;
  }
}

/**
 * Fire a notification without waiting for it.
 *
 * The shape every caller uses. Written out rather than left to each call site
 * because a floating promise is exactly the kind of thing a linter or a later
 * reader "tidies" into an await — and awaiting it would put a mail provider's
 * latency inside a player's attack.
 */
export function notifyPlayerInBackground(
  empireId: string,
  kind: NotifyKind
): void {
  void notifyPlayer(empireId, kind);
}
