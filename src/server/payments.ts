import "server-only";

import { STORE_CURRENCY } from "@/lib/game/diamondStore";
import { getLegalOperator, missingLegalFields } from "@/lib/legal";
import { growProvider, growConfigStatus } from "@/server/grow";

/**
 * Payment-provider seam for the real-money diamond store.
 *
 * Two provider shapes are defined, because real gateways come in both:
 *
 * - **direct** (`DirectPaymentProvider`) — one server-side call charges and
 *   settles. The built-in `mock` provider is this shape: it approves every
 *   charge, moves no money, and exists so the checkout is exercisable end to
 *   end before credentials arrive.
 * - **order** (`OrderPaymentProvider`) — the buyer approves the payment on the
 *   provider's own page, so the flow is *create order → buyer approves →
 *   capture*. **Grow** (`@/server/grow`) is this shape, and the settlement half
 *   is written and hardened independently of it: see `@/server/orderSettle` and
 *   `@/server/purchases`.
 *
 * Which one is active is decided by {@link getPaymentProvider} from the
 * environment alone: configure the gateway's credentials and the store switches
 * to it; leave them unset and it stays on the mock. Nothing else in the codebase
 * names a gateway — which is what has twice made swapping one out a one-file
 * change rather than a rewrite. Keep it that way: a gateway name belongs in its
 * own provider module and nowhere else.
 *
 * Going live is a two-step change, and both steps are enforced:
 *   1. Wire a provider that moves real money (`isTestMode === false`).
 *   2. Set `DIAMOND_PURCHASES_LIVE=true` so purchases open to every player.
 * Until then only admins can complete a purchase (see {@link arePurchasesLive}),
 * so no player earns free diamonds off a play-money provider.
 */

export interface ChargeInput {
  /** Empire being charged — carried through to the provider metadata. */
  empireId: string;
  /** Package id from DIAMOND_PACKAGES. */
  packageId: string;
  /** Amount to charge in ILS (already net of any admin discount). */
  amountIls: number;
  /** Human-readable description shown on the charge / receipt. */
  description: string;
}

export type ChargeResult =
  | { ok: true; providerRef: string }
  | { ok: false; reason: string };

/**
 * Who is paying, as the gateway needs them.
 *
 * Not decoration: Grow requires a full name and an Israeli mobile number on
 * every payment page, and an עוסק פטור has to name the customer on the receipt
 * it issues per sale — so these are collected at checkout rather than derived.
 * They are passed straight through to the gateway and never stored on our side
 * beyond the `userEmail`/`empireName` snapshots the audit row already keeps.
 */
export interface BuyerDetails {
  /** Full name, two words minimum (the gateway rejects a single name). */
  name: string;
  /** Israeli mobile, digits only, "05XXXXXXXX". */
  phone: string;
  /** Where the receipt goes — the account's verified address. */
  email: string;
}

export interface OrderInput extends ChargeInput {
  /** The `DiamondPurchase` row this order settles — echoed back on capture. */
  purchaseId: string;
  /** Buyer identity for the hosted page and the receipt. */
  buyer: BuyerDetails;
}

export type OrderResult =
  | {
      ok: true;
      /** Provider-side order id, stored as `providerRef` on the purchase row. */
      orderId: string;
      /**
       * The provider's hosted payment page. The browser is sent here — this is
       * the whole point of an order provider, so it is required rather than
       * optional: a create-order that returned no page would leave the buyer on
       * a spinner with a PENDING row already open.
       */
      redirectUrl: string;
      /**
       * Provider-side secret for querying this order later, stored as
       * `providerToken` on the purchase row. See {@link OrderRef}.
       */
      token?: string | null;
    }
  | { ok: false; reason: string };

export type CaptureResult =
  | {
      ok: true;
      /** Provider-side id of the money movement itself. */
      captureId: string;
      /** Amount actually captured, in `currency`. */
      amount: number;
      currency: string;
      /** Our purchase row id as echoed back by the provider, when present. */
      purchaseId: string | null;
    }
  | { ok: false; reason: string; /** Buyer-facing hint, already in Hebrew. */ message?: string };

/**
 * One tax document the gateway's invoicing company issued against a payment.
 *
 * The link is **signed and short-lived** — a gateway proxies an invoicing
 * company whose download URLs carry their own expiring token — so it is fetched
 * when someone asks for it and never written to a row. A stored copy would be a
 * dead link the day a buyer clicks it, which is worse than no link at all.
 *
 * Nothing implements this today: `fetchDocuments` is optional on the seam and
 * the Grow provider does not offer it, so the receipt button honestly answers
 * "no document" rather than pointing at an endpoint nobody has verified.
 */
export interface PaymentDocument {
  /** Kind, as the invoicing company names it: "Invoice Receipt", "Credit Invoice". */
  type: string;
  /** Issue date, in whatever shape the provider formats it. Displayed, never parsed. */
  date: string;
  /** The document itself. */
  url: string;
  /** The "נאמן למקור" copy, when the provider distinguishes one. */
  copyUrl?: string | null;
}

export type DocumentsResult =
  | { ok: true; documents: PaymentDocument[] }
  | { ok: false; reason: string };

/** Which payment to ask the invoicing company about. */
export interface DocumentQuery {
  /** Provider-side id of the money movement — `captureRef` on the purchase row. */
  captureId: string;
  /** When the charge settled, to bound the provider's date-range search. */
  paidAt?: Date | null;
}

interface ProviderBase {
  /** Stable identifier stored on every purchase row ("mock" today). */
  readonly name: string;
  /**
   * True when charges are play money. Test charges are flagged `isTest` on the
   * audit row and can never be "live".
   */
  readonly isTestMode: boolean;
}

export interface DirectPaymentProvider extends ProviderBase {
  readonly kind: "direct";
  /** Attempt to charge. Never throws — failures come back as `ok:false`. */
  charge(input: ChargeInput): Promise<ChargeResult>;
}

/**
 * How an already-opened order is named back to the provider.
 *
 * The id alone is not always enough: Grow's order lookup is authenticated by a
 * per-process token issued at creation time, so the token travels with the id
 * rather than being re-derived. It is stored on the purchase row
 * (`providerToken`) precisely so the *return from the payment page* can verify
 * a payment without trusting anything the browser carried back.
 */
export interface OrderRef {
  /** Provider-side order id — `providerRef` on the purchase row. */
  orderId: string;
  /** Provider-side secret for querying that order, when the gateway needs one. */
  token?: string | null;
  /**
   * *Our* purchase-row id, as echoed to the gateway at order time (Grow's
   * `cField1`).
   *
   * Present because gateways index the finished transaction differently: Grow
   * answers on its own process id, while others have no handle on the payment
   * *page* at all and are queried by the merchant reference instead. Passing
   * both means a provider can look the order up by whichever one it actually
   * understands — which is what kept the seam intact across two gateway swaps.
   */
  purchaseId?: string | null;
}

export interface OrderPaymentProvider extends ProviderBase {
  readonly kind: "order";
  /** Open an order for the buyer to approve. Never throws. */
  createOrder(input: OrderInput): Promise<OrderResult>;
  /**
   * Ask the provider, server to server, what actually happened to an order,
   * and report the money it says moved. Never throws.
   *
   * This is the *only* trusted source of a payment's amount and status. Neither
   * the browser returning from the hosted page nor the gateway's callback body
   * may be believed on its own — see `@/server/orderSettle`.
   */
  captureOrder(ref: OrderRef): Promise<CaptureResult>;
  /**
   * Optional: tell the gateway we took delivery of its notification, so it stops
   * retrying. Grow needs this (`approveTransaction`); a gateway that treats a
   * 200 as the acknowledgement leaves it out. Never throws — by the time it runs the
   * money has moved and the diamonds are credited, so a failure costs at most a
   * duplicate callback, which the settlement guard swallows.
   */
  acknowledge?(ref: OrderRef, captureId: string): Promise<void>;
  /**
   * Optional: ask the gateway which tax documents were issued for a settled
   * payment. Never throws.
   *
   * Separate from `captureOrder` because it answers a different question and
   * fails differently. Capture asks *did the money move* — it gates crediting and
   * must fail closed. This asks *was a receipt issued*, which is a legal
   * obligation the gateway discharges asynchronously through a third party, and
   * whose absence must never hold up a payment. A provider with no invoicing
   * module simply does not implement it.
   */
  fetchDocuments?(query: DocumentQuery): Promise<DocumentsResult>;
}

export type PaymentProvider = DirectPaymentProvider | OrderPaymentProvider;

/**
 * Placeholder provider: approves every charge instantly and returns a synthetic
 * reference. No network, no real money. Active whenever Grow is unconfigured —
 * which is every local checkout and every deploy without credentials.
 */
class MockPaymentProvider implements DirectPaymentProvider {
  readonly kind = "direct" as const;
  readonly name = "mock";
  readonly isTestMode = true;

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const ref = `mock_${input.packageId}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    return { ok: true, providerRef: ref };
  }
}

const mockProvider = new MockPaymentProvider();

/**
 * The active payment provider — the single place a gateway is selected.
 * Everything downstream (the audit row, the interlocks, the checkout UI) reads
 * it through this one call.
 *
 * Selection is by configuration, not by a flag: Grow takes over as soon as its
 * credentials are present and complete, and the mock holds the seat otherwise. A
 * *half*-configured gateway deliberately stays on the mock rather than shipping
 * a provider that errors on every checkout — but it is not silent about it,
 * since that state means a deploy meant to take money and is not. It is named,
 * by env var, in {@link purchaseBlockers}.
 */
export function getPaymentProvider(): PaymentProvider {
  return growProvider() ?? mockProvider;
}

/**
 * Whether real-money purchases are open to all players. Off by default so no
 * play-money provider ever hands out free diamonds; go-live needs all three of
 * the interlocks below.
 */
export function arePurchasesLive(): boolean {
  if (process.env.DIAMOND_PURCHASES_LIVE !== "true") return false;

  // Interlock 1: purchases are never "live" while the active provider is running
  // on play money (today: always, since only the mock exists). Otherwise
  // flipping the flag ahead of a real gateway would let every player mint free
  // diamonds through a charge that costs nothing.
  if (getPaymentProvider().isTestMode) return false;

  // Interlock 2: and never while nobody has said who is selling.
  //
  // A distance-selling merchant in Israel has to publish its legal name, dealer
  // number and a contact address on the page itself, and the gateways check the
  // same fields during underwriting. Those come from the environment
  // (LEGAL_OPERATOR_*), so a deploy that has payments configured but not the
  // operator would be taking money from the public under a placeholder — the
  // policy pages would name "מפעיל השירות" and nothing else.
  //
  // Failing closed is the whole point: the alternative is a store that quietly
  // works while the disclosure it depends on does not exist, which is precisely
  // the state nobody notices until a chargeback or an underwriter asks. Admins
  // are unaffected — they bypass this gate for test purchases (see `preflight`),
  // so the checkout can still be exercised end to end before go-live.
  if (!getLegalOperator().complete) return false;

  return true;
}

/**
 * Why the store is not open to players, in the order it has to be fixed —
 * empty once `arePurchasesLive()` is true.
 *
 * Shown to admins on the buy screen. Without it the three interlocks are
 * invisible: an admin sees a checkout that works for *them* (they bypass the
 * gate) and no indication that every player is looking at a chained store, or
 * which of the three conditions is the one still missing.
 */
export function purchaseBlockers(): string[] {
  // i18n-exempt-start: every line here is shown to an admin on the buy screen
  // and names an env var to go and set — the control centre stays Hebrew on
  // purpose. A player never sees any of it; they see a store that is simply
  // not open yet.
  const blockers: string[] = [];
  if (process.env.DIAMOND_PURCHASES_LIVE !== "true") {
    blockers.push('DIAMOND_PURCHASES_LIVE אינו "true"');
  }
  const grow = growConfigStatus();
  const provider = getPaymentProvider();
  if (provider.isTestMode) {
    if (provider.name === "grow") {
      blockers.push(`Grow רץ בסביבת בדיקות (GROW_ENV=${grow.env}) — לא זז כסף אמיתי`);
    } else {
      blockers.push("לא מחובר ספק תשלומים אמיתי — הרכישות רצות על ספק דמה");
    }
  }
  // A partial configuration is its own blocker, and a louder one: it means a
  // deploy *meant* to take money is running on the mock. Without this line the
  // only symptom is the generic "no real provider" above, which reads like
  // nothing was ever configured.
  if (grow.state === "partial") {
    blockers.push(`הגדרות Grow חסרות: ${grow.missing.join(", ")}`);
  }
  const missing = missingLegalFields();
  if (missing.length > 0) {
    blockers.push(`פרטי המפעיל לא פורסמו — חסר: ${missing.join(", ")}`);
  }
  return blockers; // i18n-exempt-end
}

/** Everything the checkout UI needs to know about the active provider. */
export interface CheckoutConfig {
  provider: string;
  /** "direct" providers charge in one server call; "order" ones need buyer approval. */
  kind: PaymentProvider["kind"];
  /** Purchases are open to every player. */
  live: boolean;
  /** Charges are play money. */
  testMode: boolean;
  currency: string;
  /** Admin-facing: what is keeping the store shut. Empty when `live`. */
  blockers: string[];
}

/** Snapshot of the checkout setup, safe to hand to a client component. */
export function getCheckoutConfig(): CheckoutConfig {
  const provider = getPaymentProvider();
  return {
    provider: provider.name,
    kind: provider.kind,
    live: arePurchasesLive(),
    testMode: provider.isTestMode,
    currency: STORE_CURRENCY,
    blockers: purchaseBlockers(),
  };
}
