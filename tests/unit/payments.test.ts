import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arePurchasesLive, getPaymentProvider, purchaseBlockers } from "@/server/payments";

/**
 * The provider seam — which gateway the store charges through, and whether the
 * store is open at all.
 *
 * `@/server/grow` has its own suite for the wire protocol. This one covers the
 * layer above it, which no test touched until the gateway moved twice inside a
 * week. Both swaps were a one-file change to `getPaymentProvider()`, and both
 * had the same two ways to go silently wrong.
 *
 * 1. **Selection.** A gateway takes the seat when its credentials are complete
 *    and the mock holds it otherwise. The dangerous case is the middle one: a
 *    *partial* configuration is a deploy that meant to take money and is not, so
 *    it must stay on the mock (rather than ship a provider that errors on every
 *    checkout) *and* say which variable is missing. Silently charging through a
 *    provider nobody expected is the failure a swap invites.
 * 2. **The go-live interlocks.** `arePurchasesLive()` guards the one state that
 *    cannot be undone by a redeploy — players minting real diamonds off play
 *    money, or the store selling without the merchant being named. Each
 *    interlock is asserted from the closed side, because a test that only proves
 *    the open case would pass just as happily with the whole gate removed.
 *
 * Env vars are driven for real rather than mocked: they are the entire input to
 * both functions, and the modules read `process.env` per call by design so a
 * credential can be added without a rebuild.
 */

const KEYS = [
  "GROW_USER_ID",
  "GROW_PAGE_CODE",
  "GROW_CALLBACK_SECRET",
  "GROW_ENV",
  "DIAMOND_PURCHASES_LIVE",
  "LEGAL_OPERATOR_NAME",
  "LEGAL_OPERATOR_TAX_ID",
  "LEGAL_CONTACT_EMAIL",
  "LEGAL_CONTACT_PHONE",
  "LEGAL_OPERATOR_ADDRESS",
] as const;

let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** A complete Grow configuration. The secret must survive `SECRET_PATTERN`. */
function configureGrow(env: "sandbox" | "production") {
  process.env.GROW_USER_ID = "user-1";
  process.env.GROW_PAGE_CODE = "page-1";
  process.env.GROW_CALLBACK_SECRET = "a".repeat(32);
  process.env.GROW_ENV = env;
}

/** All five fields the operator disclosure needs to count as complete. */
function configureOperator() {
  process.env.LEGAL_OPERATOR_NAME = "GM-business";
  // Checksum-valid; `@/lib/legal` rejects a dealer number that is not.
  process.env.LEGAL_OPERATOR_TAX_ID = "000000018";
  process.env.LEGAL_CONTACT_EMAIL = "operator@example.com";
  process.env.LEGAL_CONTACT_PHONE = "0500000000";
  process.env.LEGAL_OPERATOR_ADDRESS = "רחוב הדוגמה 1, תל אביב";
}

describe("getPaymentProvider", () => {
  it("holds the mock while no gateway is configured", () => {
    const provider = getPaymentProvider();
    expect(provider.name).toBe("mock");
    expect(provider.kind).toBe("direct");
    expect(provider.isTestMode).toBe(true);
  });

  it("hands the seat to Grow once its credentials are complete", () => {
    configureGrow("sandbox");
    const provider = getPaymentProvider();
    expect(provider.name).toBe("grow");
    // An order provider, so the checkout redirects to a hosted page rather than
    // charging in-process — `startDiamondCheckout` branches on exactly this.
    expect(provider.kind).toBe("order");
  });

  it("treats the sandbox as play money and production as real", () => {
    configureGrow("sandbox");
    expect(getPaymentProvider().isTestMode).toBe(true);
    configureGrow("production");
    expect(getPaymentProvider().isTestMode).toBe(false);
  });

  it("stays on the mock when Grow is only half-configured", () => {
    process.env.GROW_USER_ID = "user-1";
    process.env.GROW_PAGE_CODE = "page-1";
    // No callback secret: the callback would be unauthenticated, and Grow would
    // refuse the notifyUrl anyway.
    expect(getPaymentProvider().name).toBe("mock");
  });

  it("rejects a callback secret that could not survive a URL path", () => {
    configureGrow("production");
    // Too short, and then long enough but carrying characters Grow rejects.
    process.env.GROW_CALLBACK_SECRET = "short";
    expect(getPaymentProvider().name).toBe("mock");
    process.env.GROW_CALLBACK_SECRET = `${"a".repeat(30)}?=/`;
    expect(getPaymentProvider().name).toBe("mock");
  });
});

describe("purchaseBlockers", () => {
  it("names the missing Grow variable rather than reporting 'no provider'", () => {
    process.env.GROW_USER_ID = "user-1";
    const blockers = purchaseBlockers().join("|");
    expect(blockers).toContain("GROW_PAGE_CODE");
    expect(blockers).toContain("GROW_CALLBACK_SECRET");
  });

  it("flags the sandbox by name, so a test gateway is never mistaken for a live one", () => {
    configureGrow("sandbox");
    configureOperator();
    process.env.DIAMOND_PURCHASES_LIVE = "true";
    expect(purchaseBlockers().join("|")).toContain("GROW_ENV=sandbox");
  });

  it("is empty exactly when the store is open", () => {
    configureGrow("production");
    configureOperator();
    process.env.DIAMOND_PURCHASES_LIVE = "true";
    expect(purchaseBlockers()).toEqual([]);
    expect(arePurchasesLive()).toBe(true);
  });
});

describe("arePurchasesLive", () => {
  it("stays shut without the flag, however complete everything else is", () => {
    configureGrow("production");
    configureOperator();
    expect(arePurchasesLive()).toBe(false);
  });

  it("stays shut on a test-mode gateway even with the flag on", () => {
    // The interlock that matters most: flipping the flag ahead of a real
    // gateway would let every player mint diamonds off a charge costing nothing.
    configureGrow("sandbox");
    configureOperator();
    process.env.DIAMOND_PURCHASES_LIVE = "true";
    expect(arePurchasesLive()).toBe(false);
  });

  it("stays shut on the mock provider even with the flag on", () => {
    configureOperator();
    process.env.DIAMOND_PURCHASES_LIVE = "true";
    expect(arePurchasesLive()).toBe(false);
  });

  it("stays shut while the operator is unnamed", () => {
    // Selling to the public without publishing who is selling — the state the
    // third interlock exists to make unreachable.
    configureGrow("production");
    process.env.DIAMOND_PURCHASES_LIVE = "true";
    expect(arePurchasesLive()).toBe(false);
    expect(purchaseBlockers().join("|")).toContain("פרטי המפעיל");
  });
});
