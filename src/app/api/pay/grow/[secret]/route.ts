import type { NextRequest } from "next/server";

import { clientIp, rateLimit } from "@/lib/rateLimit";
import { logError } from "@/server/errorLog";
import { growCallbackSecretMatches } from "@/server/grow";
import { settleOrder } from "@/server/orderSettle";

/**
 * Grow's server-to-server payment callback.
 *
 * This is the app's only route handler, and the only endpoint reachable without
 * a session. It exists because a hosted-checkout payment is confirmed by the
 * gateway, not by the browser: the buyer can close the tab the instant they pay,
 * and this call is what still credits them.
 *
 * ## What authenticates it
 *
 * Grow does not sign its callbacks. There is no HMAC, no shared header, nothing
 * to verify the body against — so the body authenticates nothing, and this
 * handler treats it as an untrusted hint that *some* order deserves a look.
 * Two things carry the weight instead:
 *
 * 1. **The URL is the credential.** `GROW_CALLBACK_SECRET` is an unguessable
 *    path segment (Grow rejects query strings in `notifyUrl`), compared in
 *    constant time. A wrong secret gets a 404 — not a 401 — so probing cannot
 *    even establish that the endpoint exists.
 * 2. **The money is re-read from Grow.** `settleGrowOrder` asks the gateway
 *    directly what the order is worth and credits only that. Even a caller who
 *    learned the secret cannot mint diamonds: a forged `sum` is never read, and
 *    an order Grow says is unpaid credits nothing.
 *
 * ## Status codes, and why they are what they are
 *
 * Grow retries an unacknowledged callback six times over an hour. That retry is
 * a feature — it is the recovery path for a deploy that was mid-rollout when the
 * money moved — so a transient failure deliberately answers 500 to buy the
 * retry, while anything a retry cannot fix (bad shape, unknown order) answers
 * 200 to stop the pointless hourly knocking.
 */

// Prisma and the gateway call both need the Node runtime; nothing here may be
// prerendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flatten whatever Grow posted into `key → string`.
 *
 * Both encodings are handled because the documentation shows a nested JSON
 * example while the callback itself is documented as
 * `application/x-www-form-urlencoded` — where that same nesting arrives as
 * `data[processId]`. Accepting both costs a few lines and removes an entire
 * class of "works in the docs, not in production".
 */
function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      flatten(inner, prefix ? `${prefix}[${key}]` : key, out);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return;
  }
  if (prefix) out.set(prefix, String(value));
}

async function readPayload(req: NextRequest): Promise<Map<string, string> | null> {
  const type = req.headers.get("content-type") ?? "";
  const fields = new Map<string, string>();
  try {
    if (type.includes("json")) {
      flatten(await req.json(), "", fields);
    } else {
      // Covers both x-www-form-urlencoded and multipart; `formData()` parses
      // either, and the keys arrive already in `data[processId]` form.
      for (const [key, value] of (await req.formData()).entries()) {
        if (typeof value === "string") fields.set(key, value);
      }
    }
  } catch {
    return null;
  }
  return fields;
}

/**
 * Read one logical field regardless of how deeply Grow nested it. `processId`
 * has been documented at the top level and under `data`, and custom fields
 * under both `customFields` and `data.customFields`.
 */
function pick(fields: Map<string, string>, name: string): string {
  const candidates = [
    name,
    `data[${name}]`,
    `customFields[${name}]`,
    `data[customFields][${name}]`,
  ];
  for (const key of candidates) {
    const value = fields.get(key);
    if (value) return value;
  }
  return "";
}

export async function POST(
  req: NextRequest,
  // Spelled out rather than using the global `RouteContext<…>` helper: that type
  // only exists after `next typegen` has run, and `npm run typecheck` is a bare
  // `tsc` that must pass on a fresh clone.
  ctx: { params: Promise<{ secret: string }> }
) {
  const { secret } = await ctx.params;

  // Throttled before the secret is even compared, so the endpoint cannot be used
  // to grind guesses (or, with a leaked secret, to hammer the gateway through
  // us). The ceiling is far above Grow's own retry schedule.
  const ip = await clientIp();
  if (!(await rateLimit(`growCallback:${ip}`, 60, 60 * 1000))) {
    return new Response("Too Many Requests", { status: 429 });
  }

  if (!growCallbackSecretMatches(secret)) {
    // 404, not 401: an unauthenticated prober learns nothing about whether a
    // payment callback lives here at all.
    return new Response("Not Found", { status: 404 });
  }

  const fields = await readPayload(req);
  if (!fields) return new Response("Bad Request", { status: 400 });

  const purchaseId = pick(fields, "cField1");
  const orderId = pick(fields, "processId");
  if (!purchaseId && !orderId) {
    // Nothing identifies an order, so no retry will help. Acknowledged and
    // logged rather than retried into the void.
    // i18n-exempt: an operator-side log line. Nobody reads this but us, and the
    // gateway is told "OK" either way.
    await logError("grow.callback", new Error("קריאה ללא processId/cField1"), {
      path: "/api/pay/grow",
    });
    return new Response("OK", { status: 200 });
  }

  try {
    const result = await settleOrder({ purchaseId, orderId });

    // `unverified` means Grow's own lookup did not (yet) confirm the payment.
    // Answering 500 keeps the retry schedule alive, which is exactly the
    // recovery path when the callback outruns the transaction's booking.
    if (result.outcome === "unverified" || result.outcome === "unconfigured") {
      await logError("grow.callback", new Error(result.reason ?? result.outcome), {
        path: "/api/pay/grow",
      });
      return new Response("Retry", { status: 500 });
    }

    if (result.outcome === "mismatch" || result.outcome === "not-found") {
      // i18n-exempt-start: operator-side log lines, read only in the error log.
      await logError(
        "grow.callback",
        new Error(`עסקה לא נזקפה (${result.outcome}) purchaseId=${result.purchaseId ?? "?"}`),
        { path: "/api/pay/grow" }
      );
      // i18n-exempt-end
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    // A database blip is precisely what Grow's retries are for.
    await logError("grow.callback", err, { path: "/api/pay/grow" });
    return new Response("Retry", { status: 500 });
  }
}
