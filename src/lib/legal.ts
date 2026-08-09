import "server-only";
import { DEFAULT_LOCALE, LOCALE_TAG, type Locale } from "@/i18n/locale";

/**
 * Operator identity for the public legal pages (/terms, /refund, /privacy).
 *
 * Israeli consumer law requires a distance-selling merchant to publish who it
 * is — legal name, dealer number and a way to reach it — and the payment
 * gateways check for the same details during underwriting. None of it lives in
 * the repo: an עוסק number and a home address are personal data, so every field
 * comes from the environment and the pages degrade to a neutral placeholder
 * until it is set.
 *
 * Set on Vercel (and in `.env` for local work):
 *   LEGAL_OPERATOR_NAME    "ישראל ישראלי"             — the name on the dealer certificate
 *   LEGAL_OPERATOR_TAX_ID  "123456789"                — מספר עוסק (for an עוסק פטור: your ת.ז.)
 *   LEGAL_CONTACT_EMAIL    "kraldorsupport@gmail.com" — where cancellation requests land
 *   LEGAL_CONTACT_PHONE    "050-1234567"              — a number a customer can actually call
 *   LEGAL_OPERATOR_ADDRESS "הרצל 1, תל אביב 6100000"  — full postal address for written notice
 *
 * The last two were added on 2026-08-04 because the acquirer's underwriting asks
 * for them by name: a postal address for written notice and a contact telephone
 * number. That supersedes the earlier `LEGAL_OPERATOR_CITY`, which published a
 * city only — enough for the consumer-protection rule, not enough for the
 * gateway. Both are therefore *required*, not decorative: see
 * {@link REQUIRED_LEGAL_ENV}.
 */

export interface LegalOperator {
  /** Registered name of the person or company behind the game. */
  name: string;
  /** מספר עוסק, or null while unset. */
  taxId: string | null;
  /** Contact address for support, cancellations and privacy requests. */
  email: string;
  /** Telephone number a customer can reach, or null while unset. */
  phone: string | null;
  /**
   * Full postal address for written notice (street, number, city, postcode),
   * or null while unset.
   *
   * Worth saying out loud: for a home-run עוסק פטור this is a home address, and
   * publishing it is the point — the acquirer and the consumer-protection rules
   * both want a place a letter can be sent. A תא דואר satisfies both if the home
   * address should not be public.
   */
  address: string | null;
  /**
   * True once the operator is fully identified.
   *
   * This is not cosmetic. Selling to the public for real money while the
   * merchant is unnamed is the actual exposure — the policy page merely
   * publishes it — so `arePurchasesLive()` refuses to open the store while this
   * is false, and the pages say the details are pending rather than presenting
   * the placeholder below as if it were a real merchant. See
   * `missingLegalFields`.
   */
  complete: boolean;
}

/**
 * Shown until the real details are configured, so the page is never broken.
 *
 * Deliberately a *label* rather than an invented name: a plausible-looking
 * placeholder read as a real disclosure, which is worse than an obvious gap.
 * The pages pair it with an explicit notice while `complete` is false.
 *
 * The address, unlike the name, is the game's real support mailbox rather than
 * a placeholder: a page that prints an unreachable address is worse than one
 * that prints the working one, and here the fallback only shows up when
 * LEGAL_CONTACT_EMAIL was forgotten on a deploy — exactly when a player who
 * needs to reach us still has to be able to.
 */
// i18n-exempt: a legal operator identity, printed as filed rather than
// translated — see the note above.
const FALLBACK_NAME = "מפעיל השירות";
const FALLBACK_EMAIL = "kraldorsupport@gmail.com";

/**
 * The env vars that must be set before the game may take money, and which of
 * them are still missing.
 *
 * All five are here because all five are checked by someone. Name, dealer number
 * and a contact address identify who the buyer is contracting with under Israeli
 * distance-selling rules; the acquirer's underwriting adds a postal address and
 * a telephone number to that list by name. A deploy missing any of them is a
 * deploy that would fail review, so the store refuses to open rather than
 * discovering it after the first chargeback.
 *
 * `LEGAL_OPERATOR_CITY` is deliberately *not* here — it is superseded by
 * `LEGAL_OPERATOR_ADDRESS`, which contains the city.
 */
export const REQUIRED_LEGAL_ENV = [
  "LEGAL_OPERATOR_NAME",
  "LEGAL_OPERATOR_TAX_ID",
  "LEGAL_CONTACT_EMAIL",
  "LEGAL_CONTACT_PHONE",
  "LEGAL_OPERATOR_ADDRESS",
] as const;

/** Which of REQUIRED_LEGAL_ENV are unset — empty once the operator is published. */
export function missingLegalFields(): string[] {
  return REQUIRED_LEGAL_ENV.filter((key) => !process.env[key]?.trim());
}

export function getLegalOperator(): LegalOperator {
  const name = process.env.LEGAL_OPERATOR_NAME?.trim() || "";
  const taxId = process.env.LEGAL_OPERATOR_TAX_ID?.trim() || "";
  const email = process.env.LEGAL_CONTACT_EMAIL?.trim() || "";
  const phone = process.env.LEGAL_CONTACT_PHONE?.trim() || "";
  // The retired `LEGAL_OPERATOR_CITY` still answers when no full address is
  // configured, so a deploy mid-migration prints the city it always printed
  // instead of dropping the place of business off the page entirely.
  const address =
    process.env.LEGAL_OPERATOR_ADDRESS?.trim() ||
    process.env.LEGAL_OPERATOR_CITY?.trim() ||
    "";

  return {
    name: name || FALLBACK_NAME,
    taxId: taxId || null,
    email: email || FALLBACK_EMAIL,
    phone: phone || null,
    address: address || null,
    complete: missingLegalFields().length === 0,
  };
}

/**
 * Publication date of each policy, in ISO. Bump the one you edited whenever the
 * text changes materially — players are entitled to know a policy moved under
 * them, and a stale date is worse than no date.
 */
export const LEGAL_UPDATED = {
  terms: "2026-07-31",
  refund: "2026-07-31",
  // 2026-08-09: the browser-id cookie behind the referral self-invite check, and
  // the full cookie list that came with it.
  privacy: "2026-08-09",
} as const;

/** "31 ביולי 2026" / "31 July 2026" — the date as the policy pages print it. */
export function formatLegalDate(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE_TAG[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
