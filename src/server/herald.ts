import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notBot } from "@/lib/bot";
import { logError } from "@/server/errorLog";
import { announceToDiscord, gameLink, type AnnouncementKind } from "@/server/discord";
import { makeT } from "@/i18n/translate";
import { DEFAULT_LOCALE } from "@/i18n/locale";
import { renderMessageText } from "@/lib/game/messageText";

/**
 * The herald — how the game says something to more than one player at once.
 *
 * Until now everything the server wrote was addressed to somebody: a battle
 * report to its defender, a guild message to its members, a settle summary to
 * the player who ordered the march. The two boss fixtures needed the other
 * thing. A world boss is the one enemy the whole server shares, and a beast that
 * spawned on Monday and was felled on Thursday said so nowhere except to whoever
 * happened to open /game/worldboss in between — which is the same as not saying
 * it at all.
 *
 * ## Three channels, and they are not interchangeable
 *
 *   `heraldChat`   one line in the public room. Cheap (a single row), seen by
 *                  whoever has the dock open, gone from view once it scrolls.
 *                  This is the channel for things that happen *often* — a
 *                  tyrant felled in somebody's city, several times an hour
 *                  across the server.
 *   `heraldInbox`  a Message on every empire in the game. It toasts, it lights
 *                  the badge, and it is still there tomorrow. Expensive: one row
 *                  per player. Reserved for what is genuinely worth a player's
 *                  attention twice a week.
 *   Discord        `announceToDiscord`, called by the caller — it reaches people
 *                  who are not in the game right now, which is the only thing
 *                  the other two cannot do.
 *
 * A caller picks; nothing here picks for it. The wrong choice is not a bug that
 * shows up in a test, it is a game that nobody can stand the notifications of.
 *
 * ## Everything here is written in keys, not sentences
 *
 * A herald is written on one player's request — whoever's page load tripped the
 * spawn, whoever landed the killing blow — and read by everybody else. `getT()`
 * would resolve *that* player's language, so the row stores the dictionary key
 * and its values and the sentence is assembled per reader. Same rule and same
 * machinery as the inbox: see `renderMessageText`.
 */

/**
 * One value filling a placeholder.
 *
 * A name or a number goes in as itself and is never translated — it is a fact
 * about the world, the same string in both languages. A whole *clause* goes in
 * as another `HeraldText`, which is what lets a sentence be composed from pieces
 * that each survive translation intact ("{slayer} landed the final blow"). An
 * empty string is the third case and it is not an oversight: a clause that does
 * not apply this time is left out, and the run of spaces it leaves behind is
 * collapsed on the way out. See the long note in `messageText.ts`.
 */
export type HeraldValue = string | number | HeraldText;

/** A line to be assembled in the reader's language, not this caller's. */
export interface HeraldText {
  /** Dictionary key — the Hebrew source string, exactly as written. */
  key: string;
  params?: Record<string, HeraldValue>;
}

/**
 * Params on their way into a `Json` column.
 *
 * `Prisma.InputJsonValue` will not take a named interface — it demands a string
 * index signature, and `HeraldText` deliberately has named fields instead. The
 * shape is genuinely JSON (it is nothing but strings, numbers and nested objects
 * of the same), so this asserts what the type system cannot see rather than
 * loosening `HeraldText` into an untyped bag. `toParams` on the read side is the
 * check that matters: it validates the stored value and degrades a malformed one
 * to the un-interpolated key instead of throwing inside a page render.
 *
 * Exported because the heralds are not the only writers of these params: a
 * caller composing clauses for a `Message` of its own hits the same wall at its
 * own `titleParams`/`bodyParams`, and one narrow assertion in one place beats a
 * cast scattered across every producer.
 */
export function heraldParams(
  params: Record<string, HeraldValue> | undefined
): Prisma.InputJsonValue | undefined {
  return params as Prisma.InputJsonValue | undefined;
}

/**
 * The name a system line is signed with in the public room.
 *
 * Not translated: it is the game's own name, which reads the same in both
 * languages, and the pane draws a system line as a centred notice rather than as
 * a bubble from a player anyway (see `ChatDock`).
 */
// i18n-exempt: the game's own name, stored on the row as the line's author. It
// reads the same in both languages, and the pane draws a herald as a notice
// rather than as a signed bubble anyway.
export const HERALD_NAME = "קראלדור";

/**
 * Say one line in the public room.
 *
 * Never throws and never blocks the caller's outcome: this runs at the tail of a
 * settle that has already committed, and a chat row failing to insert must not
 * turn a felled boss into an error on somebody's screen.
 */
export async function heraldChat(body: HeraldText): Promise<void> {
  try {
    await prisma.chatMessage.create({
      data: {
        channel: "GLOBAL",
        system: true,
        // No sender: the game is not a player, and `senderEmpireId` is what the
        // pane uses to offer "open a private conversation with this person".
        senderEmpireId: null,
        senderName: HERALD_NAME,
        body: body.key,
        bodyParams: heraldParams(body.params),
        // Explicit, exactly as `sendChat` writes it and for the same reason: the
        // column default is the database's own clock, and a herald stamped hours
        // from every other line would sort to the wrong end of the room — and,
        // worse, sit outside the `since` window every open pane polls with.
        createdAt: new Date(),
      },
    });
  } catch (err) {
    await logError("herald.heraldChat", err);
  }
}

/**
 * Rows per `createMany`, for a fan-out that targets every empire in the game.
 *
 * The same ceiling the admin broadcast uses and for the same reason: one
 * statement per player runs into Postgres bind-parameter limits and holds the
 * whole payload in memory at once. Unlike the broadcast this one is not
 * admin-triggered — it fires off a page load — so the bound matters more here,
 * not less.
 */
const FANOUT_BATCH_SIZE = 1000;

export interface HeraldMessage {
  title: HeraldText;
  body: HeraldText;
  /** Where reading more happens — an internal path, as every Message href is. */
  href?: string;
  /**
   * Narrow the audience. Bots are excluded whatever this says: nobody reads a
   * garrison's inbox. Staff are *not* — an admin has every reason to be told the
   * world boss is down, and unlike a prize or a board this costs nobody
   * anything.
   */
  where?: Prisma.EmpireWhereInput;
}

/**
 * Put one message in every (matching) empire's inbox.
 *
 * Returns how many it reached, which is only ever used for logging — no caller
 * may branch on it, for the same reason `notifyPlayer` says so: a caller that
 * cares whether the herald arrived is a caller that is waiting for it.
 */
export async function heraldInbox(message: HeraldMessage): Promise<number> {
  try {
    const empires = await prisma.empire.findMany({
      where: { ...notBot, ...message.where },
      select: { id: true },
    });
    for (let i = 0; i < empires.length; i += FANOUT_BATCH_SIZE) {
      const batch = empires.slice(i, i + FANOUT_BATCH_SIZE);
      await prisma.message.createMany({
        data: batch.map((empire) => ({
          empireId: empire.id,
          kind: "SYSTEM" as const,
          title: message.title.key,
          titleParams: heraldParams(message.title.params),
          body: message.body.key,
          bodyParams: heraldParams(message.body.params),
          href: message.href,
        })),
      });
    }
    return empires.length;
  } catch (err) {
    await logError("herald.heraldInbox", err);
    return 0;
  }
}

/**
 * The same announcement, posted to Discord.
 *
 * Discord is one room with many readers and one language, so unlike the two
 * channels above there is nobody whose preference could be honoured — the keys
 * are rendered here, in the source language, exactly as `announceToDiscord`'s
 * own `username` already is.
 *
 * Called separately rather than folded into the two above because the audience
 * is genuinely different: a Discord post reaches people who are not playing, and
 * "everyone in the game" and "everyone who follows the game" are two decisions.
 */
export async function heraldDiscord(announcement: {
  kind: AnnouncementKind;
  title: HeraldText;
  body: HeraldText;
  href?: string;
}): Promise<void> {
  const t = makeT(DEFAULT_LOCALE);
  const { title, body } = renderMessageText(t, {
    title: announcement.title.key,
    titleParams: announcement.title.params,
    body: announcement.body.key,
    bodyParams: announcement.body.params,
  });
  await announceToDiscord({
    kind: announcement.kind,
    channel: "events",
    title,
    body,
    url: announcement.href ? gameLink(announcement.href) : undefined,
  });
}
