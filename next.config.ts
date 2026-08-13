import path from "node:path";
import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * `script-src` keeps `'unsafe-inline'` because the App Router streams RSC
 * payloads through inline `<script>` tags; removing it requires a per-request
 * nonce from `proxy.ts`, which forces every route dynamic. The rest of the
 * policy still buys real mitigation even with inline scripts allowed:
 * `base-uri` blocks `<base>` injection, `form-action` blocks form-hijacking
 * exfiltration, `object-src` kills plugin embeds, and the host allowlists mean
 * an injected tag cannot pull code from an attacker's origin.
 *
 * The accounts.google.com / gstatic entries are what Google Identity Services
 * needs: the GIS client script, the stylesheet it injects into our `<head>` to
 * skin the button, the iframe it renders the button into, the token endpoint it
 * calls, and the avatars it shows.
 *
 * The payment gateway (Grow) is deliberately **not** allowlisted, and does not
 * need to be. Its checkout is a full-page navigation to its own origin, which no
 * directive here governs: `connect-src` does not apply (the API calls are
 * server-to-server), `form-action` does not apply (we assign `location`, we do
 * not submit a form), and `frame-src` does not apply (nothing is embedded). If
 * the hosted page is ever moved into an iframe instead, that is the change that
 * needs `frame-src` plus `payment=` widened in the Permissions-Policy below —
 * and it should fail visibly rather than be pre-authorised now.
 */
// React evaluates code via `eval` in development to rebuild server stacks for
// the error overlay. Production builds never do, so the escape hatch is scoped
// to dev and can't weaken the deployed policy.
const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${devEval} https://accounts.google.com https://apis.google.com`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Drop the framework banner — it tells an attacker which version to look up
  // advisories for.
  poweredByHeader: false,

  /**
   * Pin the project root, or Turbopack infers it.
   *
   * There is a stray `package-lock.json` in the home directory, and with more
   * than one lockfile in the tree Turbopack picked *that* directory as the
   * root — which means the dev file-watcher was subscribed to the whole home
   * folder instead of this repo. The docs are explicit about what the root
   * buys ("reduce filesystem watching overhead", 05-config/turbopack), and an
   * over-wide watcher is a rebuild on every unrelated file that changes
   * anywhere under ~.
   */
  turbopack: { root: path.join(__dirname) },

  /**
   * `/game` is a bare alias for `/game/base` — there is no dashboard at the top
   * of the game, only the base.
   *
   * It lives here rather than in a `page.tsx` that calls `redirect()`, because a
   * page whose whole body is a redirect still has to be *rendered* to issue one,
   * and rendering a route that immediately redirects made the App Router throw
   * "Rendered more hooks than during the previous render" (React #310) on every
   * visit. The navigation recovered — the player did land on the base — but at
   * the cost of a thrown error, a remount of the whole tree, and a row in
   * `ErrorLog` for every player who ever typed `/game` or followed a stale link.
   *
   * The docs are explicit about this case: "If you'd like to redirect before the
   * render process, use next.config.js or Proxy" (01-app/02-guides/redirecting).
   * Answered here, nothing renders at all — the 308 goes out on the request.
   */
  async redirects() {
    return [{ source: "/game", destination: "/game/base", permanent: true }];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Two years, preloadable. Vercel terminates TLS for us; this stops a
          // first-request downgrade on any custom domain added later.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Redundant with frame-ancestors for modern browsers, honoured by old ones.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // `payment` is granted to our own origin only — no gateway iframe
            // to allow yet. The rest stay switched off everywhere.
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
