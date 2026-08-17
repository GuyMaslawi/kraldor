import "server-only";

import { cookies } from "next/headers";

import {
  ATTRIBUTION_COOKIE,
  attributionColumns,
  parseAttribution,
} from "@/lib/attribution";

/**
 * The campaign labels this request arrived on, shaped for a `user.create`.
 *
 * Split out from lib/attribution.ts so that file stays free of `next/headers`:
 * it is also imported by `src/proxy.ts`, which runs before a request has the
 * header store this reads.
 *
 * Always returns the four keys, all null when there is no cookie — so the
 * caller can spread it unconditionally and an organic signup writes four
 * explicit nulls rather than taking a different code path.
 */
export async function signupAttribution() {
  const jar = await cookies();
  return attributionColumns(parseAttribution(jar.get(ATTRIBUTION_COOKIE)?.value));
}
