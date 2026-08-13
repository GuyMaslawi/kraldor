import type { ReactNode } from "react";
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
 * Two markers, both chosen because they cannot occur in the game's Hebrew by
 * accident: `**…**` for emphasis and `[label](href)` for a link. Everything
 * else is text.
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
}: {
  /** Already translated — pass `t("…")`, not the key. */
  text: string;
  /** Class for `**…**`. The one thing worth varying: gold in prose, plain in a panel. */
  strong?: string;
  /** Class for `[label](href)`. */
  link?: string;
}) {
  return <>{renderRich(text, strong, link)}</>;
}

/** The split, exported so a caller that must build its own wrapper can reuse it. */
export function renderRich(text: string, strong: string, link: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className={strong}>
          {part.slice(2, -2)}
        </strong>
      );
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
