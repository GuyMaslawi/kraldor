import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/ui/Logo";
import { formatLegalDate, getLegalOperator } from "@/lib/legal";
import { OperatorCredit } from "@/components/ui/OperatorCredit";
import { PublicNav } from "@/components/public/PublicNav";
import { SupportChat } from "@/components/support/SupportChat";
import { hasSupportThread } from "@/server/actions/support";
import { discordInviteUrl } from "@/server/discord";
import { getI18n } from "@/i18n/server";
import { RichText } from "@/components/ui/RichText";

/**
 * Shared furniture for the three public policy pages (/terms, /refund,
 * /privacy).
 *
 * These are the only screens a stranger can reach without an account — a
 * payment gateway's underwriter reads them before approving the merchant, and a
 * player reads them after a charge they did not expect. So they are plain
 * documents rather than game screens: no scene, no animation, no data. The
 * frame is the game's, the typography is a legal page's.
 */

/** The policy pages, in the order the footer links them. */
// i18n-keys-start: dictionary keys, drawn through t(p.label) in the footer nav
const PAGES = [
  { href: "/terms", label: "תנאי שימוש" },
  { href: "/refund", label: "ביטולים והחזרים" },
  { href: "/privacy", label: "פרטיות" },
] as const;
// i18n-keys-end

export async function LegalShell({
  title,
  lead,
  updated,
  current,
  children,
}: {
  title: string;
  /** One-paragraph summary in plain Hebrew, above the clauses. */
  lead: string;
  /** ISO date from LEGAL_UPDATED. */
  updated: string;
  /** Path of the page being rendered, so it is not linked to itself. */
  current: (typeof PAGES)[number]["href"];
  children: ReactNode;
}) {
  const operator = getLegalOperator();
  const hasThread = await hasSupportThread();
  const { t, locale } = await getI18n();

  return (
    // `pt-6` and not the page's own rhythm: the bar has to land on the same
    // line here as on every other public screen, or moving between them looks
    // like the page jumped. The document's breathing room is the bar's own
    // bottom margin plus the padding below.
    <main className="min-h-screen flex-1 px-4 pb-10 pt-6 sm:pb-14">
      {/* The same bar as the login screen. A policy page is often the *first*
          page a stranger sees — a refund clause reached from a receipt, terms
          reached from a payment form — and from here there was previously no way
          to the manual, the hall, or a human. */}
      <PublicNav />
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex flex-col items-center text-center">
          <Link href="/" aria-label={t("חזרה לקראלדור")}>
            <LogoMark size={56} className="drop-shadow-[0_6px_20px_rgba(224,35,51,0.35)]" />
          </Link>
          <h1 className="mt-4 text-2xl font-black tracking-wide text-gold-bright sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1 text-[11px] font-semibold tracking-[0.3em] text-bone-dim">
            {t("קראלדור")}
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            {t("עודכן לאחרונה: {date}", { date: formatLegalDate(updated, locale) })}
          </p>
        </header>

        <div className="ornate-shell rounded-2xl px-5 py-7 sm:px-9 sm:py-10">
          <p className="border-r-2 border-gold-dim/50 pr-4 text-[0.95rem] leading-relaxed text-bone/90">
            {lead}
          </p>

          <div className="mt-7 space-y-7">{children}</div>

          {/* Who you are actually contracting with. Israeli distance-selling
              rules require this on the page itself, not only in an email.

              While the details are unset the block says so outright rather than
              printing the placeholder as though it were the merchant: an
              incomplete disclosure that *looks* complete is worse than a visibly
              missing one, and this is the state the reader is entitled to know
              about. The store is closed to players in that state anyway — see
              the operator interlock in `arePurchasesLive`. */}
          <section className="panel-inset mt-9 rounded-xl px-4 py-4 text-sm">
            <h2 className="font-black text-gold-bright">{t("פרטי המפעיל")}</h2>
            {!operator.complete && (
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                {t(
                  "פרטי המפעיל המלאים טרם פורסמו. עד לפרסומם לא מתבצעות רכישות בכסף אמיתי באתר. לכל פנייה — כתובת הדוא״ל שלהלן."
                )}
              </p>
            )}
            <dl className="mt-2 space-y-1 text-zinc-400">
              <div className="flex gap-2">
                <dt className="text-zinc-500">{t("שם:")}</dt>
                <dd>{operator.name}</dd>
              </div>
              {operator.taxId && (
                <div className="flex gap-2">
                  <dt className="text-zinc-500">{t("מספר עוסק:")}</dt>
                  <dd dir="ltr" className="text-start">
                    {operator.taxId}
                  </dd>
                </div>
              )}
              {operator.address && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-zinc-500">{t("כתובת למשלוח דואר:")}</dt>
                  <dd>{operator.address}</dd>
                </div>
              )}
              {operator.phone && (
                <div className="flex gap-2">
                  <dt className="text-zinc-500">{t("טלפון:")}</dt>
                  <dd>
                    {/* A real `tel:` link, not printed text — on the phone most
                        buyers read this on, the whole point of publishing a
                        number is that it can be dialled from here. */}
                    <a
                      href={`tel:${operator.phone.replace(/[^\d+]/g, "")}`}
                      className="text-gold underline"
                      dir="ltr"
                    >
                      {operator.phone}
                    </a>
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="text-zinc-500">{t("דוא״ל:")}</dt>
                <dd>
                  <a href={`mailto:${operator.email}`} className="text-gold underline" dir="ltr">
                    {operator.email}
                  </a>
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <nav className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
          {PAGES.filter((p) => p.href !== current).map((p) => (
            <Link key={p.href} href={p.href} className="btn btn-ghost px-4 py-2">
              {t(p.label)}
            </Link>
          ))}
          <Link href="/" className="btn btn-gold px-4 py-2">
            {t("חזרה למשחק")}
          </Link>
        </nav>

        <OperatorCredit className="mt-5" />
      </div>

      {/* The refund page in particular is read by somebody with a charge they
          want to argue, and the operator's mailbox is a slow way to argue it. */}
      <SupportChat hasThread={hasThread} discordUrl={discordInviteUrl()} />
    </main>
  );
}

/** A numbered clause. The number is decorative — the title carries the meaning. */
export function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-lg font-black text-gold-bright">
        <span className="text-sm font-bold text-gold-dim">{n}.</span>
        {title}
      </h2>
      <div className="space-y-2 text-[0.9rem] leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-gold-dim" />
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A clause the reader must not skim past — the ones that decide arguments
 * later: diamonds have no cash value, a charge cannot be undone once spent.
 */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gold-dim/40 bg-gold-dim/[0.06] px-4 py-3 text-[0.9rem] leading-relaxed text-bone/90">
      {children}
    </div>
  );
}

/** Inline emphasis for a defined term or a hard number. */
export function T({ children }: { children: ReactNode }) {
  return <strong className="font-bold text-bone-bright">{children}</strong>;
}

/**
 * A translated clause that carries its own emphasis and links.
 *
 * The policy pages bold a term in the *middle* of a sentence — "זכות הביטול
 * הסטטוטורית של 14 יום **אינה חלה** על רכישת יהלומים" — and link out to a
 * sibling policy mid-clause. {@link RichText} explains why that has to travel
 * inside the dictionary key rather than around it; this is the same renderer
 * wearing the documents' own emphasis, which is `<T>`'s bone-bright rather than
 * the gold prose uses.
 */
export function Rich({ text }: { text: string }) {
  return <RichText text={text} strong="font-bold text-bone-bright" />;
}
