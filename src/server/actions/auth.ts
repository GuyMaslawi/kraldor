"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { HeroClass } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, getSessionUserId } from "@/lib/auth";
import { banNotice, isBanned } from "@/lib/ban";
import { clientIp, clientIpForStorage, rateLimit } from "@/lib/rateLimit";
import { rememberDevice } from "@/lib/device";
import { consumePendingReferral } from "@/server/referralGuard";
import { verifyGoogleIdToken } from "@/lib/google";
import { newEmpireData } from "@/lib/game/createEmpire";
import { normalizeName } from "@/lib/game/text";
import { getTunables } from "@/lib/game/config";
import { appBaseUrl, sendMail } from "@/server/mailer";
import { seasonClosedError } from "@/server/seasonGuard";
import { PRELAUNCH_LOGIN_NOTICE, prelaunchShut } from "@/lib/prelaunch";
import { getI18n, getT } from "@/i18n/server";
import {
  LOGIN_TIMING_DUMMY_HASH,
  hashPassword,
  isStaleHash,
} from "@/lib/password";

export interface AuthState {
  error?: string;
}

/* --------------------------- email verification --------------------------- */

/** How long a verification link stays usable. */
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Hash a verification token for storage/lookup.
 *
 * SHA-256 with no salt is correct here precisely because it would be wrong for
 * a password: the token is 256 bits of CSPRNG output, so there is no dictionary
 * to attack and the hash must be deterministic to be looked up by index. What
 * this buys is that a dump of the token table cannot be replayed into anyone's
 * account, because the raw values only ever existed in the emails.
 */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Issue a fresh verification link and email it.
 *
 * Any earlier outstanding token for the user is consumed first, so a link only
 * stays live until the next one is requested — a leaked older link (forwarded
 * mail, a shared screenshot) stops working as soon as the user asks again.
 */
async function sendVerificationEmail(user: {
  id: string;
  email: string;
  name: string;
}): Promise<boolean> {
  // Throttle on the RECIPIENT, not just the sender.
  //
  // The other limiters here are keyed on the calling user id and the caller's
  // IP, neither of which is the party who receives the mail — and because
  // registration never proves ownership of the address, the caller chooses
  // whose inbox that is. Registering a victim's address from a handful of IPs,
  // each with its own fresh per-IP budget, aimed an unbounded number of
  // "verify your account" mails at a third party. Keying on the address itself
  // is the only limit the attacker cannot rotate around. It also protects the
  // provider's daily send quota, which a bomb would otherwise exhaust and take
  // real signups down with it.
  const recipientKey = createHash("sha256")
    .update(user.email.trim().toLowerCase())
    .digest("hex");
  if (!(await rateLimit(`verify-mail-to:${recipientKey}`, 5, 60 * 60 * 1000))) {
    return false;
  }

  const raw = randomBytes(32).toString("base64url");
  const now = new Date();

  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(now.getTime() + VERIFY_TOKEN_TTL_MS),
      },
    }),
  ]);

  const link = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(raw)}`;
  // The letter goes to one reader, and this runs on their own request — the
  // sign-up or the resend — so `getT()` resolves *their* language. The `dir`
  // has to follow it: an English letter laid out RTL is unreadable.
  const { t, dir } = await getI18n();
  return sendMail({
    to: user.email,
    subject: t("אימות כתובת האימייל שלך בקראלדור"),
    text: t(
      "שלום {name},\n\nכדי להפעיל את החשבון שלך בקראלדור, פתח את הקישור:\n{link}\n\nהקישור תקף ל-24 שעות. אם לא נרשמת, אפשר להתעלם מההודעה.",
      { name: user.name, link }
    ),
    html: `<div dir="${dir}" style="font-family:system-ui,sans-serif;line-height:1.6">
      <h2>${escapeHtml(t("ברוך הבא לקראלדור, {name}", { name: user.name }))}</h2>
      <p>${escapeHtml(t("כדי להפעיל את החשבון ולהתחיל לשחק, אשר את כתובת האימייל שלך:"))}</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#b8892b;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(
        t("אימות האימייל")
      )}</a></p>
      <p style="color:#666;font-size:13px">${escapeHtml(
        t("הקישור תקף ל-24 שעות. אם לא נרשמת לקראלדור, אפשר להתעלם מההודעה.")
      )}</p>
    </div>`,
  });
}

/**
 * How long an unverified password account keeps its email address and empire
 * name before either can be reclaimed by a new registration.
 *
 * Comfortably longer than VERIFY_TOKEN_TTL_MS, so a real person who lets the
 * first link expire can still resend one against their existing row.
 */
const UNVERIFIED_ACCOUNT_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Release abandoned registrations that are squatting an address or empire name.
 *
 * `register` writes the User and Empire rows before anything proves the
 * registrant controls the address — it has to, because the verification link is
 * mailed to that row. The side effect was a permanent denial of service against
 * any third party: sign up as victim@gmail.com and the real owner can never
 * register (unique email), can never take the row over with Google (googleSignIn
 * correctly refuses to adopt a row that has a passwordHash), and has no
 * self-service path at all. The same trick squatted any empire name.
 *
 * Expiring the rows turns a permanent squat into a 72-hour one. Nothing of value
 * is destroyed: an unverified account is barred from every part of the game by
 * `requireEmpire`/`getActiveEmpireId`, so its empire has never been playable.
 *
 * Deliberately scoped to rows that have no other credential and no money
 * attached — a Google-linked row is verified by definition, and the purchase
 * check is belt-and-braces, since `preflight` already refuses to sell to an
 * unverified account.
 *
 * Runs opportunistically from `register` rather than on a schedule: the app has
 * no cron, and a registration attempt is exactly the moment the space is
 * contended. Failures are swallowed — a sweep that cannot run must not take
 * signup down with it.
 */
async function releaseAbandonedRegistrations(email: string, empireName: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - UNVERIFIED_ACCOUNT_TTL_MS);
    const stale = await prisma.user.findMany({
      where: {
        emailVerified: null,
        googleId: null,
        createdAt: { lt: cutoff },
        OR: [
          { email },
          { empire: { name: { equals: empireName, mode: "insensitive" } } },
        ],
      },
      select: { id: true },
    });
    if (stale.length === 0) return;

    const ids = stale.map((u) => u.id);
    const paid = await prisma.diamondPurchase.findMany({
      where: { userId: { in: ids }, status: { in: ["PAID", "REFUNDED"] } },
      select: { userId: true },
    });
    const spent = new Set(paid.map((p) => p.userId));
    const deletable = ids.filter((id) => !spent.has(id));
    if (deletable.length === 0) return;

    // Empire, hero, items and tokens all cascade from User.
    await prisma.user.deleteMany({ where: { id: { in: deletable } } });
  } catch (e) {
    console.error("[register] abandoned-registration sweep failed", e);
  }
}

/** Minimal escaping for the one user-controlled value in the email body. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}

/**
 * Create the fresh empire for `userId` inside a transaction, mapping the empire
 * name unique-constraint hit (P2002) to a friendly error. Shared by the
 * password register flow and the Google onboarding flow. Returns `null` on
 * success, or an `AuthState` with the error message to surface.
 *
 * Unlike `register`, this runs for an account that already exists — which may
 * already be an ADMIN naming its first empire. So the role is read here and the
 * staff flag set from it; leaving it false would put an admin into the
 * competition the moment they onboarded. See src/lib/staff.ts.
 */
async function createEmpireForUser(
  userId: string,
  empireName: string,
  heroClass: HeroClass
): Promise<AuthState | null> {
  const t = await getT();
  const [activeSeason, tunables, owner] = await Promise.all([
    prisma.gameSeason.findFirst({ where: { isActive: true }, select: { id: true } }),
    getTunables(),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  let empireId: string;
  try {
    const empire = await prisma.empire.create({
      data: newEmpireData(
        userId,
        empireName,
        activeSeason?.id,
        tunables.starting,
        heroClass,
        owner?.role === "ADMIN"
      ),
      select: { id: true },
    });
    empireId = empire.id;
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
      return { error: t("שם האימפריה כבר תפוס, בחר שם אחר") };
    }
    return { error: t("אירעה שגיאה ביצירת האימפריה, נסה שוב") };
  }

  // The Google path reaches an empire two screens after the invite link was
  // clicked — sign-in, then onboarding — which is exactly why the code travels
  // in a cookie rather than a query string. This is the first moment there is
  // anything to attach it to.
  await consumePendingReferral(empireId);
  return null;
}

/** The character chosen at signup — must be one of the four playable classes. */
const heroClassSchema = z.enum(["WARLORD", "GUARDIAN", "MERCHANT", "SHADOW"], {
  message: "בחר דמות גיבור",
});

/**
 * A name field, normalised before it is measured.
 *
 * `.trim()` is not enough on its own and the order matters — see
 * `normalizeName`. The length check has to run on what is left, or a name padded
 * with zero-width spaces clears a minimum it does not actually meet.
 *
 * Shared by `register` and by the Google onboarding step below, which name the
 * same column and must not drift apart: an empire named through one path and an
 * empire named through the other have to answer to the same unique index.
 */
function nameField(min: number, max: number, tooShort: string) {
  return z.preprocess(
    (raw) => (typeof raw === "string" ? normalizeName(raw) : raw),
    z.string().min(min, tooShort).max(max)
  );
}

const EMPIRE_NAME_FIELD = nameField(2, 40, "שם האימפריה חייב להכיל לפחות 2 תווים");

const registerSchema = z.object({
  name: nameField(2, 40, "שם חייב להכיל לפחות 2 תווים"),
  empireName: EMPIRE_NAME_FIELD,
  heroClass: heroClassSchema,
  // .max(254) is the RFC 5321 address limit. Without it Zod's email check passes
  // a megabyte-long local part, which reaches both an unbounded Postgres text
  // column and — on login — a Map key in the in-process rate limiter.
  email: z.string().trim().toLowerCase().max(254).email("כתובת אימייל לא תקינה"),
  password: z.string().min(8, "סיסמה חייבת להכיל לפחות 8 תווים").max(100),
});

export async function register(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const t = await getT();
  const ip = await clientIp();

  // Registration reopens with the next season, not before. The form is not even
  // reachable during the break (`/register` redirects to `/season`), so this is
  // the POST-level half of that gate: an empire created now would be wiped by
  // the world restart the moment the next season opens, and the account would
  // have spent the whole break unable to reach a single game screen.
  const shut = await seasonClosedError();
  if (shut) return { error: shut };

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    empireName: formData.get("empireName"),
    heroClass: formData.get("heroClass"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: t(parsed.error.issues[0].message) };
  }
  const { name, empireName, heroClass, email, password } = parsed.data;

  // Throttle mass account/empire creation from one origin (resource exhaustion,
  // empire-name squatting).
  //
  // **Charged after validation, not before**, and this is the part that matters:
  // the budget used to be spent by any POST at all, so a *rejected* form — an
  // empire name already taken, a password one character short, a typo'd email —
  // cost a try. At the old ceiling of five per hour, a new player who fumbled
  // the form five times was locked out of the game for an hour having never
  // created anything. Everything above this line is a cheap parse; nothing has
  // been written and no hash computed, so refusing to charge for it gives an
  // attacker nothing and gives an honest player their retries back.
  //
  // Twenty rather than five because the key is an **IP, not a person**. Israeli
  // mobile carriers put many subscribers behind one CGNAT address, and a family,
  // a dorm or an office share one too — at five, the sixth genuine player behind
  // a shared address is turned away on the busiest night the game will have. The
  // ceiling still bounds the expensive work below (one bcrypt hash per allowed
  // attempt) and still makes automated mass signup from one origin useless, and
  // it is not the real defence against alt rings in any case: that is the
  // shared-IP clustering the admin monitor surfaces (see getSharedIpClusters),
  // which reports on signups rather than blocking them.
  if (!(await rateLimit(`register:${ip}`, 20, 60 * 60 * 1000))) {
    return { error: t("יותר מדי נסיונות הרשמה. נסה שוב מאוחר יותר.") };
  }

  // No pre-flight "does this email exist?" query: it was both a TOCTOU race with
  // the insert and an enumeration oracle (a fast email-taken reply, returned
  // before the bcrypt hash below, told an attacker which emails are registered
  // purely from latency). We always hash and attempt the insert, letting the
  // unique constraints be the single source of truth (P2002 handling below), so
  // both the taken and free paths do the same work. (The friendly "email taken"
  // message is still returned on the constraint hit — full enumeration hardening
  // would need out-of-band email verification, which the app has no infra for.)
  const passwordHash = await hashPassword(password);

  // Reclaim an address or empire name held by an abandoned unverified signup
  // before we try to take it — otherwise the squat below is permanent.
  await releaseAbandonedRegistrations(email, empireName);

  const [activeSeason, tunables] = await Promise.all([
    prisma.gameSeason.findFirst({ where: { isActive: true }, select: { id: true } }),
    getTunables(),
  ]);

  // Recorded so the admin monitor can surface accounts that all registered from
  // one address (see getSharedIpClusters). Not the rate-limit `ip` above, which
  // may be the "unknown" sentinel — that must not be stored (see
  // clientIpForStorage).
  const signupIp = await clientIpForStorage();

  let user;
  let empireId: string;
  try {
    const founded = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, name, signupIp, lastLoginIp: signupIp },
      });
      const empire = await tx.empire.create({
        data: newEmpireData(
          created.id,
          empireName,
          activeSeason?.id,
          tunables.starting,
          heroClass
        ),
        select: { id: true },
      });
      return { created, empireId: empire.id };
    });
    user = founded.created;
    empireId = founded.empireId;
  } catch (e) {
    // The pre-checks above are not atomic with the insert; a concurrent signup
    // can still trip the unique constraints on User.email / Empire.name. Map the
    // Prisma P2002 to the same friendly message instead of crashing.
    if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
      const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? "");
      if (target.includes("name")) return { error: t("שם האימפריה כבר תפוס, בחר שם אחר") };
      return { error: t("כתובת האימייל כבר רשומה במערכת") };
    }
    return { error: t("אירעה שגיאה בהרשמה, נסה שוב") };
  }

  // Record the browser this account was created in — the backbone of the
  // self-invite check on הזמנת חבר (see src/lib/device.ts). It has to happen
  // here, before the referral below: the attach asks whether this browser has
  // ever been the *referrer's*, which is a question about the sightings that
  // already exist, and answering it after adding one is the same answer.
  await rememberDevice(user.id);

  // Attach the invite link the visitor arrived on, if any. Best-effort by
  // design: a refused or missing referral is a missing bonus, never a failed
  // registration — the account and the empire already exist by this line.
  await consumePendingReferral(empireId);

  // Best-effort: a mail hiccup must not undo a completed registration. The
  // user lands on /verify-email either way and can resend from there.
  await sendVerificationEmail({ id: user.id, email: user.email, name: user.name });

  await createSession(user.id, user.tokenVersion);
  redirect("/verify-email");
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("כתובת אימייל לא תקינה"),
  password: z.string().min(1, "יש להזין סיסמה"),
});


/**
 * An id no row can hold (cuids never contain a colon), used to spend one cheap
 * indexed round trip on the unknown-email login path so it costs the same
 * number of DB hits as the known-email one. See the failure branch in `login`.
 */
const LOGIN_TIMING_EQUALIZER_ID = "timing:equalizer";

/** Consecutive wrong passwords that lock an account. */
const LOGIN_MAX_FAILURES = 10;
/** How long a locked account stays locked. */
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export async function login(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const t = await getT();
  // Two-axis throttle against online brute force: a broad per-IP cap (a single
  // origin hammering many accounts) and a tighter per-email cap (many origins
  // targeting one account). Either tripping refuses the attempt before the user
  // lookup and the bcrypt compare, which is where the real cost of a flood is.
  const ip = await clientIp();
  if (!(await rateLimit(`login-ip:${ip}`, 30, 15 * 60 * 1000))) {
    return { error: t("יותר מדי נסיונות התחברות. נסה שוב מאוחר יותר.") };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: t(parsed.error.issues[0].message) };
  }
  const { email, password } = parsed.data;

  // Hashed, not raw. The counters live in a table now, and a table of every
  // address anyone has ever tried to log in as is a list worth stealing — the
  // limiter only ever needs the key to be stable, never readable.
  const emailKey = createHash("sha256").update(email).digest("hex");
  if (!(await rateLimit(`login-email:${emailKey}`, 10, 15 * 60 * 1000))) {
    return { error: t("יותר מדי נסיונות התחברות לחשבון זה. נסה שוב מאוחר יותר.") };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  const now = new Date();
  // Durable lockout, applied as a *soft* lock: it is evaluated only against a
  // WRONG password, never against a correct one.
  //
  // A hard lock (refusing every attempt while `lockedUntil` is in the future,
  // before the password is even checked) turned this endpoint into a targeted
  // denial-of-service: knowing only a victim's address, an attacker sent 10
  // garbage passwords and locked the real owner out of their own account for 15
  // minutes — repeatable indefinitely from a single IP, since 10 attempts per
  // 15 minutes sits inside the 30-per-15-minutes per-IP budget above. In a PvP
  // game that means farming a player who cannot log in to defend, with no
  // self-service recovery (only an admin password reset clears the lock).
  //
  // Refusing only wrong passwords costs nothing in brute-force resistance —
  // an attacker who already has the correct password has won regardless — while
  // removing the DoS entirely. This is also why NIST SP 800-63B recommends
  // throttling over account lockout.
  const isLocked = user?.lockedUntil != null && user.lockedUntil > now;

  // Always run a bcrypt.compare (against a dummy hash when the user is missing)
  // so both branches cost the same — no account-enumeration timing side-channel.
  const passwordOk = await bcrypt.compare(
    password,
    user?.passwordHash ?? LOGIN_TIMING_DUMMY_HASH
  );
  // A password-less account must never be authenticated by this compare.
  //
  // Google-only rows carry `passwordHash: null`, so they fell through to the
  // timing dummy — and a dummy that *matches* is a successful login. One known
  // plaintext would therefore have signed the attacker into every Google account
  // in the game at once, and the digest it must match is a public constant in
  // this file. The plaintext was never written down, but "nobody remembers the
  // password" is not an access control: it is a single master key whose only
  // protection is that it has not been recovered yet. The compare above still
  // runs so the timing stays flat; its result is simply not allowed to grant a
  // session to a row that has no password of its own.
  const hasPassword = user?.passwordHash != null;
  if (!user || !hasPassword || !passwordOk) {
    if (user) {
      // Count the miss and lock once the threshold is crossed. The increment is
      // unconditional so concurrent guesses all register; `lockedUntil` is set
      // from the post-increment value in the same statement's result. While
      // already locked, a further miss slides the window forward — safe to do
      // precisely because the lock never blocks the account's real owner.
      const failed = await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });
      if (isLocked || failed.failedLogins >= LOGIN_MAX_FAILURES) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            lockedUntil: new Date(now.getTime() + LOGIN_LOCKOUT_MS),
            failedLogins: 0,
          },
        });
      }
    } else {
      // Equalise the round-trip count with the branch above. Without this, a
      // miss on a *known* address costs one extra DB write and a miss on an
      // unknown one costs none — a latency difference that survives the bcrypt
      // equalisation and re-opens account enumeration over enough samples.
      await prisma.user.count({ where: { id: LOGIN_TIMING_EQUALIZER_ID } });
    }
    // Deliberately the same message and shape whether or not the account
    // exists, and whether or not it is locked. Reporting the lock (or the
    // minutes remaining) was itself an enumeration oracle: only a real account
    // can ever be locked, so the distinctive lockout message answered "does
    // this address have an account?" with certainty.
    return { error: t("אימייל או סיסמה שגויים") };
  }
  if (isBanned(user)) {
    return { error: banNotice(await getT(), user) };
  }

  // The game has not opened yet — see lib/prelaunch.ts. Two things about where
  // this sits. It is *after* the password check, so it tells a stranger nothing
  // the correct password had not already told them (a wrong password still gets
  // the generic message above, and the enumeration hardening upstream is intact).
  // And it is *before* `createSession`, so a refused player never holds a cookie
  // for a game they cannot enter — rather than being handed one and bouncing off
  // every screen behind it.
  if (prelaunchShut(user.role)) {
    return { error: t(PRELAUNCH_LOGIN_NOTICE) };
  }

  // Successful sign-in clears the streak (and any expired lock), and is also the
  // one moment we hold the plaintext for an existing account — so it is where a
  // digest written at an older, weaker cost gets upgraded in place. Without this
  // the cost bump would only ever apply to accounts created after the deploy,
  // and every pre-existing password would sit at the old factor forever.
  const rehash = isStaleHash(user.passwordHash!)
    ? await hashPassword(password)
    : null;
  // Stamp the address this sign-in came from (see getSharedIpClusters). This is
  // why the update is now unconditional: it used to fire only when there was a
  // streak, a lock or a rehash to clear, but the login IP has to be recorded on
  // every success — an alt farmer signs in far more often than they fail.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLogins: 0,
      lockedUntil: null,
      lastLoginIp: await clientIpForStorage(),
      ...(rehash ? { passwordHash: rehash } : {}),
    },
  });

  // Every successful sign-in records the browser it came from. This is the path
  // that catches the farmer who registers an alt in a fresh profile and then
  // signs into it from their usual one — see src/lib/device.ts.
  await rememberDevice(user.id);

  await createSession(user.id, user.tokenVersion);
  redirect("/game/base");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "יש להזין את הסיסמה הנוכחית"),
  newPassword: z.string().min(8, "סיסמה חדשה חייבת להכיל לפחות 8 תווים").max(100),
});

export interface AccountActionState {
  error?: string;
  success?: string;
}

/**
 * Change the signed-in user's password.
 *
 * Bumps `tokenVersion`, which invalidates every session token issued before
 * this moment, and then re-issues one for the caller so they stay signed in
 * here while every other device is signed out. Sessions are stateless 30-day
 * JWTs — before this action existed, a user whose password leaked (or whose
 * cookie was copied on a shared machine) had no way at all to evict the
 * attacker, because `tokenVersion` was only ever bumped by an admin reset.
 *
 * The current password is required: without it, anyone holding a stolen cookie
 * could rotate the password and lock the real owner out permanently.
 */
export async function changePassword(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const t = await getT();
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  // Password checks are expensive by design; throttle so a stolen session can't
  // be used to brute-force the current password from inside the account.
  const ip = await clientIp();
  if (!(await rateLimit(`chpw:${userId}:${ip}`, 10, 15 * 60 * 1000))) {
    return { error: t("יותר מדי נסיונות. נסה שוב מאוחר יותר.") };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) return { error: t(parsed.error.issues[0].message) };
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");
  if (isBanned(user)) {
    await destroySession();
    redirect("/login");
  }

  // Google-only accounts have no password to verify against, so there is
  // nothing here that proves ownership — refuse rather than let a stolen
  // session mint a password and take the account over permanently.
  if (!user.passwordHash) {
    return {
      error: t("החשבון הזה מחובר דרך Google בלבד ואין לו סיסמה לשינוי."),
    };
  }
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return { error: t("הסיסמה הנוכחית שגויה") };
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return { error: t("הסיסמה החדשה זהה לנוכחית") };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      tokenVersion: { increment: 1 },
      // Rotating your own password clears the failure streak and any lock, the
      // same way an admin reset does. Otherwise a user who was being guessed at
      // stays locked on every *other* device even after proving ownership here.
      failedLogins: 0,
      lockedUntil: null,
    },
    select: { tokenVersion: true },
  });

  // Re-issue with the new version so this device survives its own revocation.
  await createSession(userId, updated.tokenVersion);
  return { success: t("הסיסמה שונתה. כל המכשירים האחרים נותקו.") };
}

/**
 * Revoke every session for the signed-in user, including this one.
 *
 * The counterpart to `logout`, which only deletes the local cookie: anyone who
 * copied that cookie beforehand keeps a working session for up to 30 days.
 * Bumping `tokenVersion` invalidates all of them at once.
 */
export async function signOutEverywhere(): Promise<void> {
  const userId = await getSessionUserId();
  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }
  await destroySession();
  redirect("/login");
}

/**
 * Sign in (or sign up) with a Google Identity Services credential (ID token).
 *
 * Flow: verify the token server-side, then resolve the account by Google id;
 * failing that, link to an existing password account with the same *verified*
 * email; failing that, create a new password-less account. A fresh account has
 * no empire yet, so we route it to /onboarding to name its empire; returning
 * users go straight to the game. Redirects on success (throws NEXT_REDIRECT);
 * returns an `AuthState` only on failure.
 */
export async function googleSignIn(credential: string): Promise<AuthState> {
  const t = await getT();
  const ip = await clientIp();
  if (!(await rateLimit(`google:${ip}`, 20, 15 * 60 * 1000))) {
    return { error: t("יותר מדי נסיונות התחברות. נסה שוב מאוחר יותר.") };
  }

  if (typeof credential !== "string" || !credential) {
    return { error: t("התחברות Google נכשלה, נסה שוב") };
  }

  const identity = await verifyGoogleIdToken(credential);
  if (!identity) {
    return { error: t("אימות מול Google נכשל, נסה שוב") };
  }
  // Only trust identities Google has verified — an unverified email could belong
  // to someone else and would let an attacker link into their account below.
  if (!identity.emailVerified) {
    return { error: t("כתובת האימייל של חשבון Google אינה מאומתת") };
  }

  const name = identity.name.slice(0, 40);

  // 1) Known Google account → straight login.
  let user = await prisma.user.findUnique({ where: { googleId: identity.googleId } });

  // 2) No Google link yet, but an account already owns this verified email.
  //
  //    Auto-linking here used to be unconditional, which was a pre-hijack
  //    account takeover: `register` never proves the registrant owns the
  //    address, so an attacker could sign up as victim@gmail.com with a password
  //    only they know, wait for the real owner to arrive and click "Continue
  //    with Google" (silently grafting their Google sub onto the attacker's
  //    row), and then log in with that password at any later date — same
  //    account, same empire. Google verifying its side says nothing about who
  //    owns the *password* account.
  //
  //    So we only adopt an email-matched row that has no other credential of its
  //    own. A row with a passwordHash must prove ownership by signing in with
  //    it; a row already bound to a different Google sub is never rebound (that
  //    would hand the account to whoever next controls a recycled or reassigned
  //    address, since Google mints a fresh sub for the same email in that case).
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
    if (byEmail) {
      if (byEmail.passwordHash) {
        return {
          error:
            t("כתובת האימייל הזו כבר רשומה עם סיסמה. התחבר עם האימייל והסיסמה שלך."),
        };
      }
      if (byEmail.googleId && byEmail.googleId !== identity.googleId) {
        return { error: t("כתובת האימייל הזו כבר משויכת לחשבון Google אחר.") };
      }
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: identity.googleId,
          image: byEmail.image ?? identity.picture ?? null,
          // Google asserted email_verified above (checked before we got here),
          // which is exactly the proof our own link asks for.
          emailVerified: byEmail.emailVerified ?? new Date(),
        },
      });
    }
  }

  // The address this sign-in came from, recorded on the row below. Google is a
  // full account-creation *and* login path, so it carries the same alt signal as
  // register/login — see getSharedIpClusters.
  const googleIp = await clientIpForStorage();

  // 3) Brand-new user → create a password-less account (no empire yet).
  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          email: identity.email,
          name,
          googleId: identity.googleId,
          image: identity.picture ?? null,
          // Verified by Google — no confirmation link needed.
          emailVerified: new Date(),
          signupIp: googleIp,
          lastLoginIp: googleIp,
        },
      });
    } catch (e) {
      // A concurrent Google sign-in for the same email/sub can still trip the
      // unique constraints; re-resolve rather than crash.
      // Re-resolve by googleId only. Falling back to an email lookup here would
      // reintroduce the takeover closed in step 2 by the back door: reaching this
      // point means step 2 saw no row for the address, so an email match now can
      // only be an account created concurrently — which has proved nothing about
      // owning this Google identity.
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        user = await prisma.user.findUnique({
          where: { googleId: identity.googleId },
        });
      }
      if (!user) return { error: t("אירעה שגיאה בהרשמה, נסה שוב") };
    }
  }

  if (isBanned(user)) {
    return { error: banNotice(await getT(), user) };
  }

  // Read up here rather than just before the redirect, because the pre-launch
  // gate below turns on exactly this answer.
  const empire = await prisma.empire.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  // The same shut door as `login`, with one exemption that matters: an account
  // with no empire yet is still *registering*, and registration is the one thing
  // that stays open all through the pre-launch window. Google reaches the empire
  // two screens after the button (sign-in, then /onboarding), so refusing every
  // non-admin here would leave a Google sign-up permanently half-finished — able
  // to create an account it can never name an empire for. Coming back to *play*
  // is what is shut, and that is the branch that already has one.
  if (empire && prelaunchShut(user.role)) {
    return { error: t(PRELAUNCH_LOGIN_NOTICE) };
  }

  // Stamp the login address on every Google sign-in, returning users included —
  // the create branch above only covers brand-new accounts.
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginIp: googleIp },
  });

  // Google is a full account-creation and login path, so it records the browser
  // for the same reason register and login do.
  await rememberDevice(user.id);

  await createSession(user.id, user.tokenVersion);

  // Route by whether the account already has an empire.
  redirect(empire ? "/game/base" : "/onboarding");
}

/**
 * Consume a verification link. Returns whether the address is now verified.
 *
 * Called from the /verify-email page with the raw token from the query string.
 * The claim is a guarded `updateMany` on `consumedAt: null`, so a link that is
 * opened twice (mail scanners prefetch links routinely) verifies once and the
 * second attempt is reported as already-used rather than crashing.
 */
export async function verifyEmailToken(
  rawToken: string
): Promise<{ ok: boolean; error?: string }> {
  const t = await getT();
  if (typeof rawToken !== "string" || !rawToken) {
    return { ok: false, error: t("קישור אימות לא תקין") };
  }

  // Unauthenticated and directly callable, like every other export of a
  // `"use server"` module — so it needs the same throttle the other public auth
  // actions carry. The 256-bit token itself is not guessable; this bounds the
  // unauthenticated DB lookups an anonymous caller can drive.
  const ip = await clientIp();
  if (!(await rateLimit(`verify-token:${ip}`, 30, 60 * 60 * 1000))) {
    return { ok: false, error: t("יותר מדי נסיונות. נסה שוב מאוחר יותר.") };
  }

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  });
  if (!record) return { ok: false, error: t("קישור האימות אינו תקין") };

  const now = new Date();
  if (record.expiresAt < now) {
    return { ok: false, error: t("פג תוקף הקישור — שלח לעצמך קישור חדש") };
  }

  const claimed = await prisma.emailVerificationToken.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (claimed.count === 0) {
    // Already used. If that use verified the account, treat this as success so
    // a prefetched link doesn't show the real user an error.
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { emailVerified: true },
    });
    return user?.emailVerified
      ? { ok: true }
      : { ok: false, error: t("הקישור כבר נוצל — שלח לעצמך קישור חדש") };
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerified: now },
  });
  return { ok: true };
}

/** Send the signed-in user a fresh verification link. */
export async function resendVerificationEmail(
  _prev: AccountActionState,
  _formData: FormData
): Promise<AccountActionState> {
  const t = await getT();
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  // Mail costs money and inboxes are abusable; cap resends hard.
  const ip = await clientIp();
  if (!(await rateLimit(`verify-resend:${userId}`, 5, 60 * 60 * 1000))) {
    return { error: t("נשלחו יותר מדי קישורים. נסה שוב בעוד שעה.") };
  }
  if (!(await rateLimit(`verify-resend-ip:${ip}`, 20, 60 * 60 * 1000))) {
    return { error: t("נשלחו יותר מדי קישורים. נסה שוב מאוחר יותר.") };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerified: true },
  });
  if (!user) redirect("/login");
  if (user.emailVerified) return { success: t("האימייל שלך כבר מאומת") };

  const sent = await sendVerificationEmail(user);
  return sent
    ? { success: t("שלחנו קישור אימות חדש. בדוק את תיבת הדואר.") }
    : { error: t("שליחת המייל נכשלה. נסה שוב בעוד רגע.") };
}

const onboardingSchema = z.object({
  empireName: EMPIRE_NAME_FIELD,
  heroClass: heroClassSchema,
});

/**
 * Create the empire for the currently-signed-in user who doesn't have one yet
 * (the Google onboarding step). Guards against being called by an unauthenticated
 * user or one who already owns an empire.
 */
export async function createEmpireForCurrentUser(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const t = await getT();
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  // getSessionUserId only proves the JWT is valid — it does not read the ban,
  // and the /game guards this action bypasses are the ones that normally do.
  // Without this check a user banned before onboarding (a Google sign-up has no
  // empire yet) could still create one and squat an empire name.
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { bannedAt: true, bannedUntil: true },
  });
  if (!account || isBanned(account)) {
    await destroySession();
    redirect("/login");
  }

  const existing = await prisma.empire.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) redirect("/game/base");

  // No new empires between seasons — same reason as in `register`.
  const shut = await seasonClosedError();
  if (shut) return { error: shut };

  const parsed = onboardingSchema.safeParse({
    empireName: formData.get("empireName"),
    heroClass: formData.get("heroClass"),
  });
  if (!parsed.success) {
    return { error: t(parsed.error.issues[0].message) };
  }

  const err = await createEmpireForUser(
    userId,
    parsed.data.empireName,
    parsed.data.heroClass
  );
  if (err) return err;

  redirect("/game/base");
}
