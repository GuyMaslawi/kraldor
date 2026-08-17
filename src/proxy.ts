import { NextResponse, type NextRequest } from "next/server";

import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE,
  readAttributionParams,
  serializeAttribution,
} from "@/lib/attribution";

/**
 * The one job this file has: remember which ad a visitor arrived on.
 *
 * (In Next 16 this file is `proxy.ts`, not `middleware.ts` — same thing,
 * renamed. It defaults to the Node runtime and must not declare one.)
 *
 * ## Why it cannot live in a page
 *
 * The tags arrive on whatever URL the ad points at, and cookies cannot be
 * written while a page renders — only a Route Handler, a Server Action or this
 * file can set one. Putting the capture here rather than on `/play` also means a
 * tagged link to *any* page works: the manual, the hall of fame, an invite link,
 * a creative that pointed somewhere unexpected. The campaign should never be
 * lost because a link went to the wrong place.
 *
 * ## First touch wins, and costs one comparison
 *
 * If the cookie already exists nothing is written — see the note in
 * lib/attribution.ts on why first touch is the right credit. And a request with
 * no ad tags returns the untouched `NextResponse.next()`, which is every request
 * this site normally serves: the common path is one `URLSearchParams` read.
 *
 * Nothing here can reject a request, and nothing downstream may treat the cookie
 * as a fact about the visitor — it is a marketing label, it is client-writable,
 * and it is used for one grouped admin report and nothing else.
 */
export function proxy(req: NextRequest): NextResponse {
  const attr = readAttributionParams(req.nextUrl.searchParams);
  if (!attr) return NextResponse.next();
  if (req.cookies.has(ATTRIBUTION_COOKIE)) return NextResponse.next();

  const res = NextResponse.next();
  res.cookies.set({
    name: ATTRIBUTION_COOKIE,
    value: serializeAttribution(attr),
    maxAge: ATTRIBUTION_MAX_AGE,
    // Read only by `register` and `googleSignIn`, both server-side. No script
    // needs it, so no script gets it.
    httpOnly: true,
    // Lax, not Strict: the visitor arrives here by following a link from
    // facebook.com, and a Strict cookie is not sent on that first cross-site
    // navigation — which is the only navigation that matters here.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}

export const config = {
  /**
   * Everything except the framework's own traffic and static assets.
   *
   * Without a matcher this runs on every `_next/static` chunk and every image in
   * `public/` — hundreds of invocations per page view, each one parsing a query
   * string, for a cookie that can only usefully be set on a document request.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|mp4|webm|css|js|txt|xml|json|woff|woff2)$).*)",
  ],
};
