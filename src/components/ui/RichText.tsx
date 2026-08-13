import { Fragment, type ReactNode } from "react";
import Link from "next/link";

/**
 * A translated sentence that carries its own emphasis and links.
 *
 * Almost every explanatory paragraph in this game bolds something in the
 * *middle* of itself — a number, a defined term, the name of a screen. Written
 * as JSX that is three fragments around a `<b>`, which means three dictionary
 * keys, and that is the shape that quietly breaks translation:
 *
 *  - the fragments are not sentences. A translator handed "משולמים מ" and
 *    "— מנהיג או סגן קונים" separately cannot produce English that reads,
 *    because the emphasised term does not sit in the same place in the two
 *    languages and one of the fragments usually has to move across it.
 *  - the seams collect leading and trailing spaces, so the keys become
 *    `" אישיים. שדרוג קסם…"` — impossible to copy correctly and impossible to
 *    spot when it drifts.
 *
 * So the markup travels *inside* the key, and the whole sentence stays one
 * entry the translator can move freely:
 *
 *     t("משולמים מ**אוצר הברית** — מנהיג או סגן קונים.")
 *     t("אוספת **{n} יהלומים**, פעם אחת.", { n })     ← the number rides along
 *     t("ראה את [תנאי השימוש](/terms).")
 *
 * Three markers, all chosen because they cannot occur in the game's Hebrew by
 * accident: `**…**` for emphasis, `[label](href)` for a link, and `<0>` `<1>` …
 * for a **slot** — a piece of markup that has to survive intact.
 *
 * Slots are what make this usable for the manual, where a sentence wraps a
 * number in its own styled span:
 *
 *     <RichText
 *       text={t("עד <0> משאבים בכל עדכון רגיל.")}
 *       slots={[<span className="nums text-emerald-300">+{cap.value}</span>]}
 *     />
 *
 * `**…**` would have flattened that span to one shared emphasis style and lost
 * its colour and its tabular figures. A slot keeps the element exactly as it was
 * written and still leaves the translator free to move it: the marker travels
 * inside the key, so English may put it at the front of the sentence where
 * Hebrew put it in the middle.
 *
 * A slot with no matching entry renders nothing rather than the literal `<0>` —
 * a sentence that lost its number reads as a wording bug; a visible `<0>` reads
 * as a broken page.
 *
 * Deliberately **not** a markdown parser and deliberately not `dangerouslySet
 * InnerHTML`. It renders React elements from a split, so a translation can add
 * emphasis and a link and nothing else — no tags, no scripts, nothing a
 * dictionary entry could smuggle into the page.
 */
export function RichText({
  text,
  strong = "font-bold text-bone-bright",
  link = "text-gold underline",
  slots,
}: {
  /** Already translated — pass `t("…")`, not the key. */
  text: string;
  /** Class for `**…**`. The one thing worth varying: gold in prose, plain in a panel. */
  strong?: string;
  /** Class for `[label](href)`. */
  link?: string;
  /** Markup for `<0>`, `<1>`, … in the order the *source* sentence used them. */
  slots?: ReactNode[];
}) {
  return <>{renderRich(text, strong, link, slots)}</>;
}

/** The split, exported so a caller that must build its own wrapper can reuse it. */
export function renderRich(
  text: string,
  strong: string,
  link: string,
  slots?: ReactNode[]
): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|<\d+>)/g)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className={strong}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      const slot = /^<(\d+)>$/.exec(part);
      if (slot) {
        // A fragment, so the slot's own element keeps its identity in the tree
        // rather than being re-keyed by its position in the sentence.
        return <Fragment key={i}>{slots?.[Number(slot[1])]}</Fragment>;
      }
      const href = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (href) {
        return (
          <Link key={i} href={href[2]} className={link}>
            {href[1]}
          </Link>
        );
      }
      return part;
    });
}
