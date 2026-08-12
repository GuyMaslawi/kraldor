import "server-only";

import { STORE_CURRENCY } from "@/lib/game/diamondStore";
import { appBaseUrl } from "@/server/mailer";
import { getT } from "@/i18n/server";
import type {
  CaptureResult,
  OrderInput,
  OrderPaymentProvider,
  OrderRef,
  OrderResult,
} from "@/server/payments";

/**
 * Grow (formerly Meshulam) — the Israeli gateway the diamond store settles
 * through, reached through **Make** rather than through Grow's own API.
 *
 * ## Why Make is in the path at all
 *
 * Grow's direct "Light API" (`createPaymentProcess`) is a paid add-on that this
 * account does not have. Without it every call comes back
 * `{"status":0,"err":{"id":701,"message":"פרמטר קוד זיהוי אינו תקין: userId"}}` —
 * not a misconfiguration with a value that would fix it, but a closed door:
 * there is no `userId` to hold. Grow's Make app ships with its own connection
 * and needs no such add-on, so a Make scenario is the way in. Allura settles
 * through the same merchant account the same way.
 *
 * ## The flow, and where trust lives
 *
 * 1. `createOrder` POSTs the order to a Make scenario, which calls Grow's
 *    "Create Payment Link" module and answers `{url, processId, processToken}`.
 *    The buyer is redirected to `url`.
 * 2. The buyer pays on Grow's page (card / Bit / Apple Pay / Google Pay).
 * 3. Grow POSTs our callback and, separately, returns the browser to
 *    `successUrl`.
 * 4. **Neither of those may be believed.** Grow does not sign its callback, so
 *    the callback body is treated as a bare notification — it tells us *which*
 *    order to look at and nothing more. Both the callback and the browser
 *    return call {@link GrowProvider.captureOrder}, which asks Grow (through a
 *    second scenario, "Get Payment Link Info") what the order is worth, and only
 *    that answer reaches `settleDiamondPurchase`.
 *
 * That is the whole security model, and it is why the amount is never read out
 * of a request body: an unsigned callback is a public endpoint, and a public
 * endpoint that credits diamonds off its own `sum` field is a free diamond
 * printer for anyone who guesses the URL. **The verify scenario is therefore not
 * optional**, which is the one way this differs from Allura's setup — there the
 * callback only extends a subscription, so there is nothing worth forging.
 *
 * ## Configuration
 *
 * ```
 * MAKE_GROW_CREATE_LINK_WEBHOOK_URL   scenario 1 — Grow "Create Payment Link"
 * MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL  scenario 2 — Grow "Get Payment Link Info"
 * MAKE_GROW_APPROVE_WEBHOOK_URL       optional, scenario 3 — "Approve Transaction"
 * MAKE_WEBHOOK_API_KEY                optional; sent as the `x-make-apikey`
 *                                     header Make checks at its own edge
 * GROW_CALLBACK_SECRET                >=24 chars, [A-Za-z0-9] only — the
 *                                     unguessable path segment the callback
 *                                     arrives on. `openssl rand -hex 24`.
 * GROW_ENV                            "sandbox" (default) | "production"
 * ```
 *
 * The callback secret lives in the *path*, not a query string, because Grow
 * rejects "special characters" in `notifyUrl` — `?` and `=` included.
 *
 * Payment methods (card, Bit, wallets) are configured on the Grow module inside
 * the Make scenario, not here: they are a property of the scenario, and a field
 * we do not send is a field whose mapping cannot be got wrong.
 *
 * See `docs/payments-grow-make.md` for how the scenarios are built and the exact
 * JSON each one must answer with.
 */

/* --------------------------------- config --------------------------------- */

/**
 * Status codes that mean the money moved.
 *
 * VERIFY: taken from Grow's documented callback example (`statusCode: "2"`,
 * `status: "שולם"`). Anything not listed here is treated as unpaid, which leaves
 * a real payment PENDING and visible in /admin/purchases — recoverable. The
 * opposite default is not.
 */
const PAID_STATUS_CODES = new Set(["2"]);

/** A callback secret has to survive being a URL path segment, and be unguessable. */
const SECRET_PATTERN = /^[A-Za-z0-9]{24,}$/;

export type GrowEnv = "sandbox" | "production";

export interface GrowConfig {
  createLinkUrl: string;
  paymentInfoUrl: string;
  /** Empty when scenario 3 was not built — acknowledgement is best-effort. */
  approveUrl: string;
  /** Empty when the Make webhooks were left unauthenticated. */
  apiKey: string;
  callbackSecret: string;
  env: GrowEnv;
}

function readEnv(key: string): string {
  return process.env[key]?.trim() ?? "";
}

/**
 * Which Grow connection the Make scenarios are pointed at.
 *
 * Unlike the direct API — where the sandbox was a different hostname and
 * therefore self-evident — this is a *declaration*, not something observable
 * from here: the connection lives inside Make and both look identical over the
 * webhook. It still drives `isTestMode`, so leaving it unset keeps the store
 * shut rather than quietly counting sandbox runs as revenue.
 */
function growEnv(): GrowEnv {
  return readEnv("GROW_ENV").toLowerCase() === "production" ? "production" : "sandbox";
}

/**
 * Whether Grow is configured, and what is missing if it is not.
 *
 * `partial` is its own state on purpose. A deploy with two of the three
 * required values set is a deploy that *meant* to take money and silently is
 * not — so it is surfaced by name in the admin's go-live blockers instead of
 * being flattened into "no provider configured".
 */
export function growConfigStatus():
  | { state: "unset"; missing: string[]; env: GrowEnv }
  | { state: "partial"; missing: string[]; env: GrowEnv }
  | { state: "ready"; missing: never[]; env: GrowEnv; config: GrowConfig } {
  const env = growEnv();
  const createLinkUrl = readEnv("MAKE_GROW_CREATE_LINK_WEBHOOK_URL");
  const paymentInfoUrl = readEnv("MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL");
  const secret = readEnv("GROW_CALLBACK_SECRET");

  const missing: string[] = [];
  if (!createLinkUrl) missing.push("MAKE_GROW_CREATE_LINK_WEBHOOK_URL");
  // Required, not optional. Without the verify scenario the only account of what
  // a payment was worth is the unsigned callback body — see the module comment.
  if (!paymentInfoUrl) missing.push("MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL");
  // A secret that exists but is too short or has URL-hostile characters is
  // *missing*, not merely weak: a guessable callback path is the one thing
  // standing between an unsigned public endpoint and a stranger, and Grow will
  // not deliver to a notifyUrl it considers malformed.
  if (!SECRET_PATTERN.test(secret)) missing.push("GROW_CALLBACK_SECRET");

  if (missing.length === 3) return { state: "unset", missing, env };
  if (missing.length > 0) return { state: "partial", missing, env };
  return {
    state: "ready",
    missing: [],
    env,
    config: {
      createLinkUrl,
      paymentInfoUrl,
      approveUrl: readEnv("MAKE_GROW_APPROVE_WEBHOOK_URL"),
      apiKey: readEnv("MAKE_WEBHOOK_API_KEY"),
      callbackSecret: secret,
      env,
    },
  };
}

/** The configured Grow setup, or null while it is unset or incomplete. */
export function growConfig(): GrowConfig | null {
  const status = growConfigStatus();
  return status.state === "ready" ? status.config : null;
}

/**
 * Constant-time comparison of the secret in an inbound callback URL.
 *
 * Timing-safe because the alternative leaks the secret one character at a time
 * to anyone willing to time a few thousand requests, and this secret is the
 * only thing authenticating the endpoint.
 */
export function growCallbackSecretMatches(candidate: string): boolean {
  const expected = growConfig()?.callbackSecret;
  if (!expected || !candidate) return false;
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return diff === 0;
}

/* ------------------------------- transport -------------------------------- */

type MakeCall =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string };

/** How long a scenario may hang before the checkout gives up on it. */
const REQUEST_TIMEOUT_MS = 20_000;

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/**
 * POST one payload to a Make scenario and read its Webhook response as JSON.
 *
 * Never throws: a scenario that is off, slow, or answering with something other
 * than JSON is a `reason` string, because every caller is on a path where an
 * exception would either abandon a PENDING row or 500 a webhook Grow would then
 * retry six times.
 *
 * The bare-"Accepted" case gets its own message rather than a generic parse
 * error. It is what Make answers when a scenario has no *Webhook response*
 * module — the single most likely way these scenarios get built wrong, and one
 * that otherwise surfaces as an unreadable parse failure.
 */
async function makePost(
  config: GrowConfig,
  url: string,
  label: string,
  payload: Record<string, unknown>
): Promise<MakeCall> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { "x-make-apikey": config.apiKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    // i18n-exempt: a `reason` string, logged and shown only in the control
    // centre when a charge is investigated — never rendered to the buyer, who
    // gets the translated `message` instead.
    return { ok: false, reason: `${label}: הבקשה ל-Make נכשלה (${str(err)})` };
  }

  const body = await res.text().catch(() => "");

  if (!res.ok) {
    // i18n-exempt: an operator-side `reason` — see above.
    return { ok: false, reason: `${label}: Make החזיר HTTP ${res.status} (${body.slice(0, 200)})` };
  }

  const trimmed = body.trim();
  if (trimmed === "Accepted") {
    return {
      ok: false,
      // i18n-exempt: an operator-side `reason` — see above.
      reason: `${label}: התרחיש ב-Make ענה "Accepted" — חסר לו מודול Webhook response`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // i18n-exempt: an operator-side `reason` — see above.
    return { ok: false, reason: `${label}: תשובה שאינה JSON מ-Make (${trimmed.slice(0, 200)})` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // i18n-exempt: an operator-side `reason` — see above.
    return { ok: false, reason: `${label}: תשובת Make אינה אובייקט (${trimmed.slice(0, 200)})` };
  }

  return { ok: true, data: parsed as Record<string, unknown> };
}

/* ------------------------------ field mapping ------------------------------ */

/**
 * Grow rejects "special characters" in the free-text fields it puts on the
 * payment page and the receipt. Rather than discover which ones at underwriting
 * time, everything outside letters/digits/spaces and a couple of safe marks is
 * dropped — the description is decoration on a page whose numbers all come from
 * structured fields.
 */
export function growSafeText(value: string, max = 60): string {
  return value
    .replace(/[^\p{L}\p{N} .,'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Israeli mobile in the `0500000000` shape Grow validates against, or null if
 * the input cannot be one. Accepts what people actually type — spaces, dashes,
 * and the +972 international form.
 */
export function growPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  return /^05\d{8}$/.test(digits) ? digits : null;
}

/**
 * A full name with at least two parts — Grow's payment page rejects a single
 * name, and the receipt an עוסק פטור issues needs a real one anyway.
 */
export function growFullName(raw: string): string | null {
  const clean = growSafeText(raw, 80);
  return clean.split(" ").filter(Boolean).length >= 2 ? clean : null;
}

/* -------------------------------- provider -------------------------------- */

export class GrowProvider implements OrderPaymentProvider {
  readonly kind = "order" as const;
  readonly name = "grow";
  readonly isTestMode: boolean;

  constructor(private readonly config: GrowConfig) {
    // A sandbox connection settles nothing, so its charges are test charges —
    // this is what keeps `arePurchasesLive()` shut while pointed at sandbox, and
    // what flags the rows `isTest` so sandbox runs never land in a revenue
    // figure.
    this.isTestMode = config.env !== "production";
  }

  /** Where Grow posts the result of a payment. Path-embedded secret — see above. */
  callbackUrl(): string {
    return `${appBaseUrl()}/api/pay/grow/${this.config.callbackSecret}`;
  }

  async createOrder(input: OrderInput): Promise<OrderResult> {
    const name = growFullName(input.buyer.name);
    const phone = growPhone(input.buyer.phone);
    // Validated here rather than only at the form, because this is the boundary
    // Grow actually enforces: a bad name reaches it as an opaque "process
    // failed" long after a PENDING row was opened.
    // i18n-exempt-start: operator-side `reason` strings — the checkout form
    // validates the same two fields and shows the buyer a translated refusal.
    if (!name) return { ok: false, reason: "שם מלא לא תקין (נדרשים שם פרטי ושם משפחה)" };
    if (!phone) return { ok: false, reason: "מספר טלפון נייד לא תקין" }; // i18n-exempt-end

    const base = appBaseUrl();
    const call = await makePost(this.config, this.config.createLinkUrl, "createPaymentLink", {
      // Whole agorot. A float with a trailing 0.00000001 is a mismatch at
      // settlement time, where the comparison is exact.
      sum: (Math.round(input.amountIls * 100) / 100).toFixed(2),
      description: growSafeText(input.description),
      fullName: name,
      phone,
      email: input.buyer.email,
      successUrl: `${base}/game/diamonds/buy/success`,
      cancelUrl: `${base}/game/diamonds/buy/cancel`,
      notifyUrl: this.callbackUrl(),
      // Our purchase row id, echoed back on the callback. It is the only thing
      // tying Grow's notification to a row of ours, and it is *not* a secret —
      // the callback is verified by re-asking Grow, never by recognising this.
      cField1: input.purchaseId,
    });
    if (!call.ok) return { ok: false, reason: call.reason };

    const redirectUrl = str(call.data.url);
    const orderId = str(call.data.processId);
    const token = str(call.data.processToken);
    if (!redirectUrl || !orderId || !token) {
      return {
        ok: false,
        // i18n-exempt: an operator-side `reason` — see above.
        reason: "createPaymentLink: חסרים url/processId/processToken בתשובת התרחיש",
      };
    }

    return { ok: true, orderId, redirectUrl, token };
  }

  async captureOrder(ref: OrderRef): Promise<CaptureResult> {
    const t = await getT();
    if (!ref.token) {
      // i18n-exempt: an operator-side `reason` — see above.
      return { ok: false, reason: "אין processToken לאימות מול הספק" };
    }

    const call = await makePost(this.config, this.config.paymentInfoUrl, "getPaymentInfo", {
      processId: ref.orderId,
      processToken: ref.token,
    });
    if (!call.ok) return { ok: false, reason: call.reason };

    const statusCode = str(call.data.statusCode);
    if (!PAID_STATUS_CODES.has(statusCode)) {
      return {
        ok: false,
        // i18n-exempt: an operator-side `reason`; the buyer reads `message`.
        reason: `העסקה אינה במצב שולם (statusCode=${statusCode || "?"})`,
        message: t("התשלום לא הושלם. אם חויבת, פנה לתמיכה ונטפל בזה."),
      };
    }

    const captureId = str(call.data.transactionId);
    if (!captureId) {
      // i18n-exempt: an operator-side `reason` — see above.
      return { ok: false, reason: "getPaymentInfo: חסר transactionId בתשובה" };
    }

    const amount = Number(call.data.sum);
    if (!Number.isFinite(amount)) {
      // i18n-exempt: an operator-side `reason` — see above.
      return { ok: false, reason: `getPaymentInfo: sum לא מספרי (${str(call.data.sum)})` };
    }

    // Grow settles in shekels only, so the currency is a constant rather than a
    // field — but it is still stated, because `settleDiamondPurchase` refuses to
    // credit a purchase whose currency does not match the row.
    return {
      ok: true,
      captureId,
      amount,
      currency: STORE_CURRENCY,
      purchaseId: str(call.data.cField1) || null,
    };
  }

  /**
   * Grow's "yes, I got it" call (`approveTransaction`), as the seam's optional
   * {@link OrderPaymentProvider.acknowledge}.
   *
   * Fire-and-forget by design: the money has already moved and the diamonds are
   * already credited by the time this runs, so a failure here costs at most a
   * duplicate notification — which the settlement guard swallows. Skipping it,
   * on the other hand, makes Grow retry the callback six times over an hour.
   * Absent scenario 3 it is skipped entirely, which is exactly that trade.
   */
  async acknowledge(ref: OrderRef, captureId: string): Promise<void> {
    if (!this.config.approveUrl) return;
    await makePost(this.config, this.config.approveUrl, "approveTransaction", {
      processId: ref.orderId,
      transactionId: captureId,
    });
  }
}

/**
 * The Grow provider, or null when it is not fully configured.
 *
 * A *partial* configuration also returns null: a provider missing its verify
 * scenario would either fail every settlement or, far worse, invite someone to
 * remove the check — which is strictly worse than staying on the mock. The gap
 * is reported instead — see `growConfigStatus` and `purchaseBlockers`.
 */
export function growProvider(): OrderPaymentProvider | null {
  const config = growConfig();
  return config ? new GrowProvider(config) : null;
}
