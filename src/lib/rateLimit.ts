import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * Fixed-window rate limiter, counted in Postgres so it holds across the whole
 * fleet.
 *
 * It used to count in module memory. On a single long-lived Node process that
 * is a real limiter; on Vercel it is theatre. Every concurrent lambda keeps its
 * own `Map`, so the effective budget is `limit × instances`, and every cold
 * start hands the caller a clean slate — an attacker does not even have to try
 * to evade it, the platform resets it for them. `login-email` (10 tries per 15
 * minutes) was the one that mattered: the ceiling it advertised was not the
 * ceiling anyone actually faced.
 *
 * Postgres is the only shared state this app has, and one indexed upsert on a
 * single row is cheap next to the bcrypt compare it is guarding, so the
 * counters moved there. The in-process map survives as a *pre-filter*: it can
 * only ever be more permissive than the shared counter (each instance sees a
 * fraction of the traffic), so when it says no, the shared counter would have
 * said no too — and the request is refused without a round trip.
 *
 * Fails **open**. A limiter that takes signup and login down with the database
 * is a worse outage than the one it prevents, and the pre-filter still caps
 * what any single instance can pass through while the database is unreachable.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Bound the map so a flood of distinct keys (e.g. spoofed IPs) can't grow it
// without limit. When the cap is hit we drop already-expired windows first.
const MAX_BUCKETS = 10_000;

/**
 * Drop expired windows; if that frees nothing, evict the oldest entries anyway.
 *
 * The unconditional eviction is the part that makes MAX_BUCKETS a real bound.
 * Sweeping only expired windows left the map free to grow past the cap whenever
 * every entry was still live (a flood of distinct keys inside one window), while
 * paying an O(n) scan on every insert once at the cap — so the "bound" cost
 * time without ever bounding memory. Map preserves insertion order, so taking
 * from the front evicts the least recently created window.
 */
function sweep(now: number): void {
  for (const [key, win] of buckets) {
    if (win.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size < MAX_BUCKETS) return;
  const excess = buckets.size - MAX_BUCKETS + 1;
  let dropped = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++dropped >= excess) break;
  }
}

/** Consume `cost` hits against this instance's own copy of the window. */
function localAllows(
  key: string,
  limit: number,
  windowMs: number,
  cost: number
): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    buckets.set(key, { count: cost, resetAt: now + windowMs });
    // A single action worth more than the whole window is refused outright
    // rather than let through on a fresh bucket.
    return cost <= limit;
  }

  if (existing.count + cost > limit) return false;
  existing.count += cost;
  return true;
}

/**
 * A ceiling on a *polled read*, counted in this instance's memory only — never in
 * Postgres.
 *
 * Per-instance state is precisely what the header above calls theatre, and for
 * `login-email` it was. The difference is what is being defended. A login limiter
 * IS the security boundary: an attacker who gets `limit × instances` tries has
 * beaten it. A poll ceiling defends nothing but database load — there is no secret
 * behind `getGlobalChat`, no state to guess, and a caller who gets through is
 * merely reading their own chat again. The goal is to blunt a flood, and refusing
 * past a share per instance does that.
 *
 * It has to be free, which is the other half of the reasoning. `rateLimit` costs
 * one upsert, so putting it on a read path would add a query to every poll an
 * *honest* client makes — the app is polled from every screen, so that is a
 * guaranteed load increase to defend against a hypothetical one. This variant
 * touches only the Map: an allowed poll costs nothing at all, and a refused one
 * costs nothing either.
 *
 * A refused round is silent by construction — every caller already returns an
 * empty view on failure and the client polls again in a few seconds.
 */
export function localRateLimit(key: string, limit: number, windowMs: number): boolean {
  return localAllows(key, limit, windowMs, 1);
}

/**
 * Budget for one polled read path, per player, per minute.
 *
 * Sized off the fastest poll in the app: the boss arena refreshes every 1.5s, so
 * 40/min is what one honest tab spends there, and the chat's 5s panes spend 12.
 * 240 leaves 6x headroom over the fastest and 20x over the chat — enough for a
 * player with several tabs open and a re-render storm, far short of a loop.
 */
export const POLL_LIMIT = 240;
export const POLL_WINDOW_MS = 60 * 1000;

/**
 * How often (in hits) an instance bothers to clear expired rows. The sweep is
 * a single indexed DELETE and rows are tiny, so this is housekeeping, not a
 * correctness requirement — an expired row is already inert, since the upsert
 * below restarts the window in place rather than reading a stale count.
 */
const SWEEP_EVERY = 500;
let hitsSinceSweep = 0;

async function sweepShared(): Promise<void> {
  if (++hitsSinceSweep < SWEEP_EVERY) return;
  hitsSinceSweep = 0;
  try {
    await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lte: new Date() } } });
  } catch {
    // Housekeeping only — a failed sweep costs nothing but disk.
  }
}

/**
 * Consume `cost` hits against `key` (default 1). Allows up to `limit` hits per
 * `windowMs`; resolves `true` while under the limit and `false` once the window
 * is exhausted, until it rolls over.
 *
 * `cost` is what lets a budget be counted in something other than calls. Player
 * mail is the case that needs it: throttling *sends* leaves the recipient count
 * unbounded, since one send may address many players, so the mail budget is
 * charged per addressee instead.
 *
 * The counter moves in a single statement. `ON CONFLICT DO UPDATE` with the
 * window rollover expressed as a `CASE` is what makes it safe: read-then-write
 * would let N concurrent attempts all read the same count and each write
 * count+1, which on the login path is exactly the burst the limit exists to
 * stop. `RETURNING` hands back the post-increment count, so the decision is
 * made from the value the database actually stored, not from what we hoped it
 * would store.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  cost = 1
): Promise<boolean> {
  // A caller-supplied cost reaches the counter, so it is clamped to a positive
  // integer here: a zero or negative charge would decrement a shared window,
  // handing an attacker a way to refund every other bucket they share.
  const hits = Math.max(1, Math.floor(cost));

  // Cheap per-instance pre-filter — see the header.
  if (!localAllows(key, limit, windowMs, hits)) return false;

  // The window is expressed in SQL rather than bound as a JS Date, and both
  // sides of the rollover test read `NOW() AT TIME ZONE 'UTC'`. Two separate
  // hazards make that necessary, and each one alone is enough to break the
  // limiter on a database session that is not running in UTC:
  //
  //  - `resetAt` is a `TIMESTAMP(3)` *without* a zone. A JS Date bound into a
  //    **raw** query arrives as a `timestamptz` and is converted through the
  //    session's zone on the way in, so the stored instant is offset from what
  //    every other timestamp in this database means — including the one
  //    `sweepShared` compares against through the Prisma API, which is why dead
  //    buckets would otherwise survive the sweep for hours.
  //  - a bare `NOW()` is likewise a `timestamptz`, so comparing it against the
  //    column converts the *column* instead. Paired with the write above the two
  //    errors cancel, which is exactly why this was invisible: the limiter
  //    worked while storing nonsense, and fixing either half alone breaks it.
  //
  // Computing the instant in UTC on the server settles both: what is stored is
  // what every other reader of this table already believes a timestamp to be.
  const windowSeconds = windowMs / 1000;
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (
        ${key},
        ${hits}::int,
        (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${windowSeconds}::double precision)
      )
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= (NOW() AT TIME ZONE 'UTC') THEN ${hits}::int
          ELSE "RateLimitBucket"."count" + ${hits}::int
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= (NOW() AT TIME ZONE 'UTC')
            THEN (NOW() AT TIME ZONE 'UTC')
                 + make_interval(secs => ${windowSeconds}::double precision)
          ELSE "RateLimitBucket"."resetAt"
        END
      RETURNING "count"
    `;
    // Awaited, not fired and forgotten: a serverless instance can be frozen the
    // moment the action returns, so a dangling query is a query that may never
    // run and may reject against a disconnected client. It does real work only
    // once every SWEEP_EVERY hits.
    await sweepShared();
    const count = Number(rows[0]?.count ?? 1);
    return count <= limit;
  } catch (error) {
    // Fail open — see the header. Logged rather than swallowed: a limiter that
    // has quietly stopped limiting is worth knowing about.
    console.error(`[rate-limit] shared counter unavailable for ${key}`, error);
    return true;
  }
}

/**
 * Number of trusted reverse proxies between the public internet and the app
 * (e.g. one load balancer → 1). The client IP is read this many hops from the
 * RIGHT of `X-Forwarded-For`, because only the rightmost entries are appended by
 * infrastructure we control — everything to their left is attacker-controllable.
 * Defaults to 1 (a single trusted LB, the common case). Set TRUSTED_PROXY_HOPS
 * to 0 only when the app is exposed directly with no proxy.
 */
function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS);
  return Number.isInteger(raw) && raw >= 0 ? raw : 1;
}

/**
 * Best-effort client IP for keying the limiter, from the proxy headers Next.js
 * populates behind a load balancer. Falls back to a constant when absent (dev /
 * direct connections) so the limiter still applies globally rather than not at
 * all. Never throws.
 *
 * Security: `X-Forwarded-For` is `client, proxy1, proxy2, …` where each proxy
 * APPENDS the address it saw. A client can forge the leftmost entries, so we
 * never trust position 0 — we index `trustedProxyHops()` from the right, which
 * is the address our own edge proxy observed. Trusting the leftmost token (the
 * old behaviour) let an attacker mint a fresh limiter bucket per request by
 * rotating a spoofed header, defeating the register/login throttles entirely.
 */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const hops = trustedProxyHops();
    // hops === 0 means the app is exposed directly, so X-Forwarded-For is fully
    // client-controlled and must not be trusted — fall through to x-real-ip /
    // the global bucket rather than honour a spoofable value.
    if (hops > 0) {
      const fwd = h.get("x-forwarded-for");
      if (fwd) {
        const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length > 0) {
          // hops from the right; clamp so a short header can't underflow.
          const idx = Math.max(0, parts.length - hops);
          return parts[idx]!;
        }
      }
    }
    return h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The client IP to *store* against an account, or null when there is nothing
 * worth storing.
 *
 * `clientIp` returns the sentinel `"unknown"` so the rate limiter always has a
 * bucket key, but that sentinel must never be written to a row: it is not an
 * address, and persisting it would make every account whose IP could not be read
 * cluster together under one fake "shared address" — turning a dev environment,
 * or any run behind a proxy we do not trust, into a wall of false alt rings.
 * Storing null instead keeps those accounts out of every cluster.
 */
export async function clientIpForStorage(): Promise<string | null> {
  const ip = await clientIp();
  return ip === "unknown" ? null : ip;
}
