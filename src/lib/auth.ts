import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { applyPendingUpdates } from "@/lib/game/updates";
import { isBanned } from "@/lib/ban";
import { PRELAUNCH, prelaunchShut } from "@/lib/prelaunch";
import { getSeasonGate } from "@/server/seasonClose";

const SESSION_COOKIE = "kraldor_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Session-signing key. Fails closed on a weak value rather than issuing tokens
 * an attacker could forge.
 *
 * This is the whole ballgame for the session layer: anyone holding AUTH_SECRET
 * can mint `{sub: <any user id>, ver: 0}` and sign in as any account, admins
 * included, without touching the database. A short or placeholder key is
 * therefore not a lint issue — it is a total authentication bypass, so a
 * misconfigured deploy must crash instead of quietly running on a guessable
 * secret. 32 chars is the floor for the 256-bit HMAC below.
 */
const MIN_SECRET_LENGTH = 32;

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters of random data`
    );
  }
  if (/change-?me|placeholder|your-secret|dev-secret|example/i.test(secret)) {
    throw new Error(
      "AUTH_SECRET is a placeholder value — generate one with `openssl rand -base64 48`"
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(
  userId: string,
  tokenVersion: number
): Promise<void> {
  // `ver` pins the session to the user's current tokenVersion. Bumping the
  // column (e.g. on password reset) invalidates every token issued before it,
  // so a leaked cookie can be revoked even though the JWT itself is stateless.
  const token = await new SignJWT({ sub: userId, ver: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secretKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/* --------------------------- impersonation --------------------------- */

/**
 * The admin's way back out of a player's account.
 *
 * "Sign in as this player" replaces the admin's session cookie with the
 * player's, so without something else on the request there is nothing left to
 * say who was there before — the admin would have to log in again, and any page
 * showing "you are impersonating" would have no source of truth.
 *
 * The ticket is a *signed* JWT rather than a plain "admin id" cookie precisely
 * because it grants a session for the id it names: an unsigned one would be a
 * one-line privilege escalation for anyone who can set a cookie. It carries the
 * admin's `tokenVersion` for the same reason the session does, so a password
 * reset (or a ban) during the impersonation invalidates the way back too.
 */
const IMPERSONATION_COOKIE = "kraldor_admin_return";
/** Short-lived on purpose: an impersonation is a task, not a mode to live in. */
const IMPERSONATION_DURATION_SECONDS = 60 * 60 * 4; // 4 hours

export async function setImpersonationReturn(
  adminUserId: string,
  tokenVersion: number
): Promise<void> {
  const token = await new SignJWT({ sub: adminUserId, ver: tokenVersion, imp: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${IMPERSONATION_DURATION_SECONDS}s`)
    .sign(secretKey());

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_DURATION_SECONDS,
  });
}

/** The parked admin session, or null when this is an ordinary player visit. */
export const readImpersonationReturn = cache(
  async (): Promise<{ userId: string; tokenVersion: number } | null> => {
    const cookieStore = await cookies();
    const token = cookieStore.get(IMPERSONATION_COOKIE)?.value;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, secretKey(), {
        algorithms: ["HS256"],
      });
      // `imp` keeps a stolen/copied *session* token from being replayed here as
      // a return ticket: the two are signed with the same key, so the claim is
      // what separates them.
      if (payload.imp !== true) return null;
      const userId = typeof payload.sub === "string" ? payload.sub : null;
      if (!userId) return null;
      return {
        userId,
        tokenVersion: typeof payload.ver === "number" ? payload.ver : 0,
      };
    } catch {
      return null;
    }
  }
);

export async function clearImpersonationReturn(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE);
}

export const getSessionUserId = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    // Pin the algorithm so verification can only accept the HS256 tokens we
    // issue (defense-in-depth against algorithm-confusion attacks).
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return null;

    // Reject tokens whose version no longer matches the account's — this is how
    // a stateless JWT gets revoked (password reset bumps tokenVersion). Tokens
    // predating the `ver` claim read as 0, matching the column default, so they
    // stay valid until their own reset. One indexed PK lookup, cached per request.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    if (!user) return null;
    const tokenVer = typeof payload.ver === "number" ? payload.ver : 0;
    if (tokenVer !== user.tokenVersion) return null;

    return userId;
  } catch {
    return null;
  }
});

/**
 * Whether the pre-launch gate bars this account from the game (see
 * lib/prelaunch.ts).
 *
 * A separate one-column read rather than a `role` added to the selects below,
 * for the reason spelled out in `requireEmpire`: that object is spread into the
 * props of every `/game` screen, and the less of the User row travels with it the
 * better. React-cached, so the two callers share one round trip per request — and
 * once the game is open (`PRELAUNCH=0`) it makes no query at all.
 */
const prelaunchBars = cache(async (userId: string): Promise<boolean> => {
  if (!PRELAUNCH) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return prelaunchShut(user?.role);
});

/**
 * Resolve the logged-in user's empire id for a server action, **enforcing the
 * ban on every action** — not just on page load.
 *
 * Sessions are stateless 30-day JWTs that a ban does not revoke, and
 * `requireEmpire` only runs on `/game/*` page loads. Without this check a user
 * banned mid-session could keep POSTing to server actions (bank, training,
 * wheel, diamond shop, guild, messages…) indefinitely. Returns `null` when the
 * caller is unauthenticated, has no empire, or is banned.
 */
export const getActiveEmpireId = cache(async (): Promise<string | null> => {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const empire = await prisma.empire.findUnique({
    where: { userId },
    select: {
      id: true,
      user: { select: { bannedAt: true, bannedUntil: true, emailVerified: true } },
    },
  });
  // Unverified accounts are gated here as well as at requireEmpire: page loads
  // are not the only way in, and every server action resolves its empire
  // through this function. Gating only the pages would leave the whole
  // mutation surface reachable by POST from an unverified account.
  if (!empire || isBanned(empire.user) || !empire.user.emailVerified) return null;
  // Between seasons the world is frozen. Same reasoning as the verification
  // check above: redirecting the pages alone would leave every server action
  // — bank, training, attacks, the diamond shop — POSTable after the final
  // standings were archived, which would let a player keep playing (and keep
  // changing the numbers the next season's ladder starts from) inside a season
  // that is already over and recorded.
  if (!(await getSeasonGate()).open) return null;
  // The game has not opened yet. Gated here as well as at `requireEmpire` for
  // exactly the reason the two checks above are: registration hands out a real
  // session (it has to, so the account can verify its address), and a session is
  // a POST away from every mutation in the game. Shutting only the pages would
  // leave a pre-registered player able to train, bank and attack through server
  // actions before the season the world is supposed to start from even exists.
  if (await prelaunchBars(userId)) return null;
  return empire.id;
});

/**
 * Load the logged-in user's empire or redirect to /login.
 * Applies all pending regular/daily updates before returning, so every
 * page sees an up-to-date empire (buildings, army, storages, upgrades, bank).
 */
export const requireEmpire = cache(async () => {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  // An explicit select, never `include: { user: true }`. The relation carries
  // `passwordHash`, `googleId`, `tokenVersion`, `signupIp` and `lastLoginIp`,
  // and this object is spread into the return value of the function every
  // `/game/*` page builds itself from — so a whole-row include is one careless
  // `<SomeClientComponent empire={empire} />` away from serialising the account's
  // password digest into the RSC payload of every screen in the game. Only the
  // five fields something actually reads leave the database.
  const existing = await prisma.empire.findUnique({
    where: { userId },
    select: {
      id: true,
      user: {
        select: {
          name: true,
          email: true,
          emailVerified: true,
          bannedAt: true,
          bannedUntil: true,
        },
      },
    },
  });
  // No empire yet — a Google sign-up that never finished naming one, or an
  // account whose empire was removed by a pre-launch reset. `/onboarding`, not
  // `/login`: the session is perfectly valid, and `/login` bounces a
  // session-holder straight back to `/game/base`, which is this line again.
  if (!existing) redirect("/onboarding");
  // Banned users lose all game access, until the ban's deadline passes.
  if (isBanned(existing.user)) {
    await destroySession();
    redirect("/login");
  }
  // Unverified accounts keep their session (so they can resend the link) but
  // reach no part of the game until they confirm the address.
  if (!existing.user.emailVerified) redirect("/verify-email");
  // The season's clock has run out: every /game screen closes and the only
  // thing left standing is the recap. Checked *before* applyPendingUpdates so
  // a page load after the deadline cannot settle another hour of production
  // into an empire whose final standing is already carved into the hall.
  if (!(await getSeasonGate()).open) redirect("/season");
  // The game has not opened yet — see lib/prelaunch.ts. Like the season check
  // above, this sits *before* applyPendingUpdates: a page load during the
  // pre-launch window must not settle production into an empire that is waiting
  // for a world that has not started.
  if (await prelaunchBars(userId)) redirect("/launch");

  const empire = await applyPendingUpdates(existing.id);
  return { ...empire, user: existing.user };
});
