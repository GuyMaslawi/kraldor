import type { T, TranslateParams } from "@/i18n/translate";

/**
 * The inbox, in the reader's language.
 *
 * ## The problem this exists to solve
 *
 * A `Message` row is written by one player and read by another. An attack
 * report is written while the *attacker's* request is being served; a guild
 * invitation while the *recruiter's* is. `getT()` resolves the language of
 * whoever is making the request, so translating at write time hands the reader
 * a sentence in a language their enemy picked. Every producer therefore left
 * these rows in Hebrew — which meant an English player's inbox was Hebrew from
 * top to bottom, permanently, no matter how much of the rest of the game had
 * been translated.
 *
 * ## The shape
 *
 * The row stores the dictionary **key** and the values that fill it, and the
 * sentence is assembled when the inbox is opened:
 *
 *     // producer
 *     title: "⚔️ הותקפת על ידי {attacker} — ההגנה נפרצה",
 *     titleParams: { attacker: attacker.name },
 *
 *     // reader
 *     const { title, body } = renderMessageText(t, row);
 *
 * Player names, numbers and place names go in `params` and are never
 * translated — they are facts about the world, and `{attacker}` is filled with
 * the same string in both languages.
 *
 * A value that *is* itself a dictionary key — a sabotage mission's name, a
 * city's name, a whole clause of a battle report — says so by wrapping itself,
 * and is translated inside the sentence at read time. It may carry its own
 * params, which is what lets a message be *composed* from clauses that each
 * survive translation whole:
 *
 *     bodyParams: {
 *       attacker: attacker.name,
 *       mission: { key: mission.name },
 *       plunder: { key: "נבזזו ממך {gold} זהב.", params: { gold } },
 *     }
 *
 * Self-describing on purpose. The alternative, a third column listing which
 * params are keys, puts the fact one place away from the value it describes,
 * and the two drift.
 *
 * A clause that does not apply is simply absent, so the sentence around it is
 * written with plain spaces between its placeholders and the runs of space an
 * omitted clause leaves behind are collapsed on the way out. That is why the
 * clause keys themselves carry no padding: spacing belongs to the sentence, not
 * to the pieces.
 *
 * ## Why old rows keep working
 *
 * A message written before this landed holds a finished Hebrew sentence and no
 * params. `t()` returns a key it cannot find unchanged, so such a row renders
 * exactly as it always did — in Hebrew, for everyone, which is what it already
 * was. Nothing needs backfilling and nothing can break; the inbox simply gets
 * better one new message at a time.
 */
export interface StoredMessageText {
  title: string;
  body: string;
  titleParams?: unknown;
  bodyParams?: unknown;
}

/**
 * Prisma hands back `Json?` as `unknown`, so the params are checked rather than
 * cast. A row whose params are not a flat object of primitives is treated as
 * having none: a malformed value must degrade to the un-interpolated key, not
 * throw inside a page render.
 */
function toParams(t: T, value: unknown): TranslateParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: TranslateParams = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" || typeof item === "number") {
      out[name] = item;
    } else if (
      item &&
      typeof item === "object" &&
      typeof (item as { key?: unknown }).key === "string"
    ) {
      const nested = item as { key: string; params?: unknown };
      out[name] = t(nested.key, toParams(t, nested.params));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Tidy up after an omitted clause: two spaces where one belongs, or a space
 * before the full stop. Horizontal whitespace only — a producer that laid a
 * message out over several lines keeps its lines.
 */
function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,!?;:])/g, "$1").trim();
}

/** Title and body of one stored message, translated and interpolated. */
export function renderMessageText(
  t: T,
  row: StoredMessageText
): { title: string; body: string } {
  return {
    title: tidy(t(row.title, toParams(t, row.titleParams))),
    body: tidy(t(row.body, toParams(t, row.bodyParams))),
  };
}
