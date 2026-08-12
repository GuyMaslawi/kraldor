import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidBuyerName, isValidBuyerPhone } from "@/lib/game/diamondStore";
import {
  growCallbackSecretMatches,
  growConfigStatus,
  growFullName,
  growPhone,
  growProvider,
  growSafeText,
} from "@/server/grow";

/**
 * The Grow gateway, tested where it is actually dangerous.
 *
 * Grow is reached through Make scenarios rather than its own API (the direct
 * Light API is a paid add-on this account does not have — see
 * `docs/payments-grow-make.md`), so what these tests pin down is the contract
 * with those scenarios: what we POST them, and what we do with what they answer.
 *
 * Two things here are worth a test and the rest is plumbing:
 *
 * 1. **Nothing credits off an unverified answer.** `captureOrder` is the only
 *    source of a payment's amount, and it has to fail closed on every shape it
 *    does not positively recognise — an unpaid status, a missing transaction id,
 *    a non-numeric sum, a scenario that answered with something other than JSON.
 *    Getting this wrong turns an unsigned public callback into a diamond
 *    printer, so each way of getting it wrong gets its own case.
 * 2. **The request Grow receives is the request we meant.** The gateway
 *    validates the name and phone formats itself, but only *after* a PENDING
 *    purchase row exists — and the callback URL is the endpoint's only
 *    credential, so a malformed one silently loses every payment notification.
 *
 * The tests drive real env vars and a stubbed `fetch` rather than mocking the
 * provider, because the mapping between our fields and the scenarios' is exactly
 * the part that has no other check on it.
 */

const SECRET = "a".repeat(32);
const CREATE_URL = "https://hook.eu1.make.com/create";
const INFO_URL = "https://hook.eu1.make.com/info";

/** Env keys this file owns; restored after every case. */
const KEYS = [
  "MAKE_GROW_CREATE_LINK_WEBHOOK_URL",
  "MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL",
  "MAKE_GROW_APPROVE_WEBHOOK_URL",
  "MAKE_WEBHOOK_API_KEY",
  "GROW_CALLBACK_SECRET",
  "GROW_ENV",
  "NEXT_PUBLIC_APP_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

function configure(overrides: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  process.env.MAKE_GROW_CREATE_LINK_WEBHOOK_URL = CREATE_URL;
  process.env.MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL = INFO_URL;
  process.env.GROW_CALLBACK_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "https://kraldor.example";
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}

/** Stub `fetch` with a canned scenario response and capture what was sent. */
function stubMake(response: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init.body)),
      });
      const text = typeof response === "string" ? response : JSON.stringify(response);
      return new Response(text, { status });
    })
  );
  return calls;
}

/* ------------------------------ field mapping ------------------------------ */

describe("growPhone", () => {
  it("accepts what people actually type", () => {
    expect(growPhone("0501234567")).toBe("0501234567");
    expect(growPhone("050-123-4567")).toBe("0501234567");
    expect(growPhone(" 050 123 4567 ")).toBe("0501234567");
    expect(growPhone("+972501234567")).toBe("0501234567");
    expect(growPhone("972-50-1234567")).toBe("0501234567");
  });

  it("rejects anything that is not an Israeli mobile", () => {
    expect(growPhone("021234567")).toBeNull(); // landline
    expect(growPhone("05012345")).toBeNull(); // too short
    expect(growPhone("05012345678")).toBeNull(); // too long
    expect(growPhone("")).toBeNull();
  });
});

describe("growFullName", () => {
  it("requires two parts, because the gateway does", () => {
    expect(growFullName("ישראל ישראלי")).toBe("ישראל ישראלי");
    expect(growFullName("ישראל")).toBeNull();
    expect(growFullName("   ")).toBeNull();
  });

  it("strips characters the payment page rejects without losing the name", () => {
    expect(growFullName("Israel <b>Israeli</b>")).toBe("Israel b Israeli b");
  });
});

describe("growSafeText", () => {
  it("collapses whitespace and drops special characters", () => {
    expect(growSafeText("1000  יהלומים!! (מבצע)")).toBe("1000 יהלומים מבצע");
  });

  it("truncates to the limit", () => {
    expect(growSafeText("x".repeat(200)).length).toBe(60);
  });
});

describe("the checkout form and the gateway agree on what is valid", () => {
  /**
   * The rules exist twice — once in `@/lib/game/diamondStore` so the browser can
   * grey the button out, once in `@/server/grow` because the gateway is where
   * they are actually enforced. Drift between them is invisible in both
   * directions and bad in both: a form that is stricter blocks real buyers, and
   * a form that is looser opens a PENDING purchase row for every typo.
   */
  const NAMES = ["ישראל ישראלי", "ישראל", "  ", "Israel Israeli", "א ב", "Israel  "];
  const PHONES = ["0501234567", "050-123-4567", "+972501234567", "021234567", "", "05012345"];

  it.each(NAMES)("agrees on the name %j", (name) => {
    expect(isValidBuyerName(name)).toBe(growFullName(name) !== null);
  });

  it.each(PHONES)("agrees on the phone %j", (phone) => {
    expect(isValidBuyerPhone(phone)).toBe(growPhone(phone) !== null);
  });
});

/* ------------------------------ configuration ------------------------------ */

describe("growConfigStatus", () => {
  it("is unset when nothing is configured, and stays on the mock", () => {
    const status = growConfigStatus();
    expect(status.state).toBe("unset");
    expect(growProvider()).toBeNull();
  });

  it("reports a partial configuration by name instead of failing every checkout", () => {
    process.env.MAKE_GROW_CREATE_LINK_WEBHOOK_URL = CREATE_URL;
    const status = growConfigStatus();
    expect(status.state).toBe("partial");
    expect(status.missing).toEqual([
      "MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL",
      "GROW_CALLBACK_SECRET",
    ]);
    // Still null: a half-configured gateway must not take the seat from the mock.
    expect(growProvider()).toBeNull();
  });

  it("refuses to run without the verify scenario", () => {
    /**
     * The one difference from Allura's setup, and the reason it gets its own
     * case: there the callback only extends a subscription, so a missing verify
     * step costs nothing. Here it is the only thing standing between an unsigned
     * public endpoint and free diamonds, so its absence has to keep the whole
     * provider off rather than degrade to trusting the callback body.
     */
    configure();
    delete process.env.MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL;
    expect(growConfigStatus().missing).toContain("MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL");
    expect(growProvider()).toBeNull();
  });

  it("treats a weak or URL-hostile callback secret as missing", () => {
    configure({ GROW_CALLBACK_SECRET: "short" });
    expect(growConfigStatus().state).toBe("partial");
    configure({ GROW_CALLBACK_SECRET: `${"a".repeat(30)}/../` });
    expect(growConfigStatus().state).toBe("partial");
  });

  it("runs without the optional approve scenario", () => {
    configure();
    expect(growConfigStatus().state).toBe("ready");
    expect(growProvider()).not.toBeNull();
  });

  it("defaults to sandbox, and sandbox charges are test charges", () => {
    configure();
    expect(growConfigStatus().env).toBe("sandbox");
    expect(growProvider()?.isTestMode).toBe(true);
  });

  it("only production moves real money", () => {
    configure({ GROW_ENV: "production" });
    expect(growProvider()?.isTestMode).toBe(false);
  });
});

describe("growCallbackSecretMatches", () => {
  it("matches the configured secret and nothing else", () => {
    configure();
    expect(growCallbackSecretMatches(SECRET)).toBe(true);
    expect(growCallbackSecretMatches(`${"a".repeat(31)}b`)).toBe(false);
    expect(growCallbackSecretMatches("a")).toBe(false);
    expect(growCallbackSecretMatches("")).toBe(false);
  });

  it("never matches while Grow is unconfigured", () => {
    expect(growCallbackSecretMatches(SECRET)).toBe(false);
    expect(growCallbackSecretMatches("")).toBe(false);
  });
});

/* ------------------------------- createOrder ------------------------------- */

const ORDER = {
  purchaseId: "purchase-1",
  empireId: "empire-1",
  packageId: "chest",
  amountIls: 69.9,
  description: "3500 יהלומים KRALDOR",
  buyer: { name: "ישראל ישראלי", phone: "050-123-4567", email: "buyer@example.com" },
};

const LINK = { url: "https://pay.example/p/1", processId: "332002", processToken: "tok-1" };

describe("createOrder", () => {
  it("sends the fields Grow validates, in the shapes it validates them", async () => {
    configure();
    const calls = stubMake(LINK);

    const result = await growProvider()!.createOrder(ORDER);
    expect(result).toMatchObject({
      ok: true,
      orderId: "332002",
      redirectUrl: "https://pay.example/p/1",
      token: "tok-1",
    });

    const { url, body } = calls[0];
    expect(url).toBe(CREATE_URL);
    // Two decimals, always: the settlement comparison is exact, and a float that
    // serialises as "69.900000000000006" is a mismatch that refuses a real payment.
    expect(body.sum).toBe("69.90");
    expect(body.phone).toBe("0501234567");
    expect(body.fullName).toBe("ישראל ישראלי");
    // Our row id is the only thread from the callback back to a purchase.
    expect(body.cField1).toBe("purchase-1");
    // The secret rides in the path — Grow rejects query strings in notifyUrl.
    expect(body.notifyUrl).toBe(`https://kraldor.example/api/pay/grow/${SECRET}`);
    expect(body.successUrl).toBe("https://kraldor.example/game/diamonds/buy/success");
    expect(body.cancelUrl).toBe("https://kraldor.example/game/diamonds/buy/cancel");
  });

  it("authenticates to Make when a key is configured, and omits the header otherwise", async () => {
    configure({ MAKE_WEBHOOK_API_KEY: "key-1" });
    const withKey = stubMake(LINK);
    await growProvider()!.createOrder(ORDER);
    expect(withKey[0].headers["x-make-apikey"]).toBe("key-1");

    configure();
    delete process.env.MAKE_WEBHOOK_API_KEY;
    const without = stubMake(LINK);
    await growProvider()!.createOrder(ORDER);
    expect(without[0].headers["x-make-apikey"]).toBeUndefined();
  });

  it("rejects a bad name or phone before opening anything at the gateway", async () => {
    configure();
    const calls = stubMake(LINK);

    const noSurname = await growProvider()!.createOrder({
      ...ORDER,
      buyer: { ...ORDER.buyer, name: "ישראל" },
    });
    const badPhone = await growProvider()!.createOrder({
      ...ORDER,
      buyer: { ...ORDER.buyer, phone: "021234567" },
    });

    expect(noSurname.ok).toBe(false);
    expect(badPhone.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("names the missing Webhook response module instead of a parse error", async () => {
    /**
     * What Make answers when a scenario has no *Webhook response* module — the
     * single most likely way these scenarios get built wrong. Worth its own case
     * because the generic message ("not JSON") sends whoever reads it looking at
     * the wrong thing entirely.
     */
    configure();
    stubMake("Accepted");
    const result = await growProvider()!.createOrder(ORDER);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("Webhook response");
  });

  it("fails when the scenario answers without a payment page", async () => {
    configure();
    stubMake({ processId: "332002" });
    const result = await growProvider()!.createOrder(ORDER);
    expect(result.ok).toBe(false);
  });

  it("fails when the scenario itself errored", async () => {
    configure();
    stubMake("Internal Server Error", 500);
    const result = await growProvider()!.createOrder(ORDER);
    expect(result.ok).toBe(false);
  });

  it("never throws when Make is unreachable", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    await expect(growProvider()!.createOrder(ORDER)).resolves.toMatchObject({ ok: false });
  });
});

/* ------------------------------- captureOrder ------------------------------ */

const PAID = {
  statusCode: "2",
  transactionId: "145111110",
  sum: "69.9",
  cField1: "purchase-1",
};

describe("captureOrder", () => {
  it("reports the amount Grow says was paid, not one anybody sent us", async () => {
    configure();
    const calls = stubMake(PAID);
    const result = await growProvider()!.captureOrder({ orderId: "332002", token: "tok-1" });

    expect(result).toMatchObject({
      ok: true,
      captureId: "145111110",
      amount: 69.9,
      currency: "ILS",
      purchaseId: "purchase-1",
    });
    expect(calls[0].url).toBe(INFO_URL);
    expect(calls[0].body.processId).toBe("332002");
    expect(calls[0].body.processToken).toBe("tok-1");
  });

  it("fails closed on any status it does not positively recognise as paid", async () => {
    configure();
    for (const statusCode of ["0", "1", "3", "", "2 "]) {
      stubMake({ ...PAID, statusCode });
      const result = await growProvider()!.captureOrder({ orderId: "1", token: "t" });
      expect(result.ok, `statusCode=${JSON.stringify(statusCode)}`).toBe(false);
    }
  });

  it("fails closed when the transaction id or sum is unusable", async () => {
    configure();

    stubMake({ ...PAID, transactionId: "" });
    expect((await growProvider()!.captureOrder({ orderId: "1", token: "t" })).ok).toBe(false);

    stubMake({ ...PAID, sum: "לא מספר" });
    expect((await growProvider()!.captureOrder({ orderId: "1", token: "t" })).ok).toBe(false);
  });

  it("fails closed when the scenario answers with something other than JSON", async () => {
    /**
     * A misbuilt verify scenario must never read as a paid order. This is the
     * case that keeps "the scenario broke" and "the money moved" on opposite
     * sides of the credit decision.
     */
    configure();
    stubMake("Accepted");
    expect((await growProvider()!.captureOrder({ orderId: "1", token: "t" })).ok).toBe(false);

    stubMake("<html>gateway timeout</html>");
    expect((await growProvider()!.captureOrder({ orderId: "1", token: "t" })).ok).toBe(false);
  });

  it("refuses to ask at all without the order's lookup token", async () => {
    configure();
    const calls = stubMake(PAID);
    const result = await growProvider()!.captureOrder({ orderId: "332002", token: null });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------- acknowledge ------------------------------- */

describe("acknowledge", () => {
  it("is skipped entirely when the optional scenario was not built", async () => {
    configure();
    const calls = stubMake({});
    await growProvider()!.acknowledge?.({ orderId: "1", token: "t" }, "cap-1");
    expect(calls).toHaveLength(0);
  });

  it("tells Grow the notification was taken when it was", async () => {
    configure({ MAKE_GROW_APPROVE_WEBHOOK_URL: "https://hook.eu1.make.com/approve" });
    const calls = stubMake({});
    await growProvider()!.acknowledge?.({ orderId: "332002", token: "t" }, "145111110");
    expect(calls[0].url).toBe("https://hook.eu1.make.com/approve");
    expect(calls[0].body).toMatchObject({ processId: "332002", transactionId: "145111110" });
  });
});
