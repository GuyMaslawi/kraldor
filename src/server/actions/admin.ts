"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  BuildingType,
  DiamondEffectKind,
  EmpireUpgradeType,
  GuildRole,
  GuildSpellType,
  HeroItemSlot,
  HeroRarity,
  MessageKind,
  MiniGameType,
  PotionKind,
  Prisma,
  ResourceStorageType,
  Role,
  WeaponCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
  logAdmin,
  saturatingIncrement,
  ADMIN_INT_MAX,
  type EmpireIntField,
} from "@/lib/admin";
import { BAN_DAYS_MAX, formatBanDate, isBanned } from "@/lib/ban";
import { syncStaffFlag } from "@/lib/staff";
import { notBot, notStaffOrBot } from "@/lib/bot";
import { GIFT_DEFAULTS, isGameWideScope } from "@/lib/adminBroadcast";
import { weaponByKey, TIERS_PER_CATEGORY } from "@/lib/game/weapons";
import { GUILD_AID_MAX_LEVEL, GUILD_CAPACITY_MAX_LEVEL } from "@/lib/game/guild";
import {
  MINIGAME_TYPE_META,
  CUPS_MIN,
  MAX_LIVE_MINIGAMES,
  SAFE_DIGITS_MIN,
  clampAttempts,
  clampCups,
  clampMapSize,
  MAP_SIZE_MIN,
  RIDDLE_ANSWER_MAX,
  RIDDLE_QUESTION_MAX,
  clampDigits,
  prizeText,
  type MiniGameShape,
} from "@/lib/game/minigame";
import {
  HERO_BAG_CAPACITY,
  HERO_MAX_HEALTH,
  HERO_MAX_LEVEL,
  RARITY_META,
  SLOT_ORDER,
  heroPointPool,
  tierForLevel,
  xpToNextLevel,
} from "@/lib/game/hero";
import { itemSetForLevel } from "@/lib/game/heroSets";
import {
  EMPIRE_UPGRADE_META,
  MAX_CITIES,
  MINE_MAX_LEVEL,
  RESOURCE_MAX,
  empireUpgradeMaxLevel,
  isProductionBuilding,
  type ActiveEmpireUpgradeType,
} from "@/lib/game/constants";
import { formatNumber } from "@/lib/game/format";
import { POTION_STACK_CAP } from "@/lib/game/potions";
import { BOT_BATCH_MAX, BOT_SEED_CITY, BOT_SOLDIERS } from "@/lib/game/bots";
import { applyPendingUpdates } from "@/lib/game/updates";
import {
  castBankInterest,
  castCityDowngrade,
  castRaidShield,
  castResourceBoost,
  castShopDiscount,
  castTurnPackage,
  lockEmpire,
  type BankInterestEmpire,
  type CastContext,
  type EffectResult,
} from "@/server/diamondEffects";
import {
  HAPPY_HOUR_DEFAULT_TITLE,
  HAPPY_HOUR_MAX_MINUTES,
  HAPPY_HOUR_MAX_PCT,
  HAPPY_HOUR_MIN_PCT,
  multiplierLabel,
} from "@/lib/game/happyHour";
import { SEASON_PASS_XP_MAX } from "@/lib/game/seasonPass";
import { ACHIEVEMENT_BY_KEY, GLORY_KEYS } from "@/lib/game/achievements";
import { formatGameDateTime, gameDay, lastDailyUpdate } from "@/lib/game/time";
import {
  WORLD_BOSS_BY_KEY,
  rollWorldBoss,
  worldBossMaxHp,
} from "@/lib/game/worldBoss";
import {
  DEFAULT_TUNABLES,
  getTunables,
  mergeTunables,
  type GameTunables,
} from "@/lib/game/config";
import {
  breakToHours,
  isBreakUnit,
} from "@/lib/game/seasonCycle";
import { formatBreakHours as formatBreak } from "@/components/admin/seasonBreak";
import { makeT } from "@/i18n/translate";
import { DEFAULT_LOCALE } from "@/i18n/locale";
import { newEmpireData } from "@/lib/game/createEmpire";
import { hashPassword } from "@/lib/password";
import { syncEmpirePower } from "@/server/empirePower";
import { createBots, deleteBot, ensureCityBots, planBots, rearmBot } from "@/server/bots";
import { repairGuildLeadership } from "@/server/guildLeadership";
import { applyGuildCityRule, guildCityTier } from "@/server/guildCity";
import type { GuildCityOutcome } from "@/lib/game/guild";
import {
  announceSeasonStart,
  archiveSeasonStandings,
  closeSeason,
} from "@/server/seasonClose";
import { restartWorld } from "@/server/seasonRestart";
import { announceToDiscord, gameLink } from "@/server/discord";
import { heraldDiscord, heraldInbox, type HeraldText } from "@/server/herald";
import {
  DIAMOND_SALE_ANNOUNCEMENT,
  clampDiscountPct,
  isDiscountRelease,
} from "@/lib/game/diamondStore";
import { logError } from "@/server/errorLog";

export interface AdminActionState {
  error?: string;
  success?: string;
}

/* ------------------------------ helpers ------------------------------ */

/**
 * A user-facing admin error whose message is safe to return to the client.
 * Anything thrown that is NOT an AdminError (Prisma/DB errors, ZodError from a
 * tampered enum field, unexpected runtime failures) is treated as internal and
 * replaced with a generic message by `toErr`, so DB schema/column names and
 * other internals never leak to the admin client.
 */
class AdminError extends Error {}

function toErr(e: unknown): AdminActionState {
  // Next.js control-flow signals (redirect / notFound) are thrown as errors
  // carrying a `digest`. They must propagate so the framework can act on them —
  // swallowing them here would leak a "NEXT_REDIRECT;…" string to the client and
  // silently drop the redirect (e.g. an expired admin session never lands on /login).
  if (
    e &&
    typeof e === "object" &&
    "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    ((e as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (e as { digest: string }).digest === "NEXT_NOT_FOUND")
  ) {
    throw e;
  }
  // Only our own AdminError messages are safe to surface. Everything else is
  // an internal failure — log it server-side and return a generic message so
  // no DB/stack internals reach the client.
  if (e instanceof AdminError) return { error: e.message };
  console.error("[admin action]", e);
  return { error: "אירעה שגיאה, נסה שוב" };
}

// Upper bound for any admin-entered number. Prevents a fat-fingered or hostile
// value (e.g. 1e308) from reaching a column at all. Applied symmetrically so
// negative inputs are bounded too (callers still Math.max(0, …) where needed).
//
// It is the game's resource ceiling, because the resources are the only fields
// this bound actually decides: every other `num()` caller clamps again to its
// own ladder immediately afterwards (clampLevel for cities/hero level/tiers,
// POTION_STACK_CAP for potions, SEASON_PASS_XP_MAX for pass XP, xpToNextLevel
// for hero XP), so widening this cannot loosen any of them.
//
// The database holds the same line independently — see RESOURCE_MAX — so a
// balance cannot exceed it through normal play either. This is only what the
// form will carry.
const ADMIN_NUM_MAX = RESOURCE_MAX; // 999P

function clampNum(n: number): number {
  return Math.max(-ADMIN_NUM_MAX, Math.min(ADMIN_NUM_MAX, n));
}

/** Clamp to what an `Int` column can hold — see ADMIN_INT_MAX. */
function clampInt(n: number): number {
  return Math.max(-ADMIN_INT_MAX, Math.min(ADMIN_INT_MAX, Math.round(n)));
}

/** Read a required numeric field destined for an `Int` column (int4-bounded). */
function intNum(formData: FormData, key: string): number {
  return clampInt(num(formData, key));
}

/** Read an optional numeric field destined for an `Int` column (int4-bounded). */
function intOptNum(formData: FormData, key: string, fallback = 0): number {
  return clampInt(optNum(formData, key, fallback));
}

/** Read a required numeric form field (finite, bounded). Throws on invalid input. */
function num(formData: FormData, key: string): number {
  const raw = formData.get(key);
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n)) {
    throw new AdminError(`ערך לא תקין בשדה ${key}`);
  }
  return clampNum(n);
}

/**
 * Clamp an admin-entered level/tier to the ceiling the game itself enforces.
 *
 * The editor is a shortcut around the *cost* of progression, never around its
 * ceilings: anything a player cannot reach by playing, an admin cannot hand out
 * here either. Skipping this is not a cosmetic "big number" — every ladder in
 * the game is a multiplier on something unbounded downstream. A mine at level
 * 555,555,555 yields `level × 2` per assigned slave *per tick* (an infinite
 * resource faucet that also poisons the rankings and the world records), a hero
 * stat point is +1% attack, and TURNS_PER_REGULAR_UPDATE past its cap of 5
 * uncaps attacking itself. The upgrade paths in `game.ts` all guard these caps;
 * the admin path is the only way around them, so it clamps identically.
 */
function clampLevel(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Read an optional numeric field (bounded); returns `fallback` when blank. */
function optNum(formData: FormData, key: string, fallback = 0): number {
  const raw = formData.get(key);
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clampNum(n) : fallback;
}

/**
 * Guard against peer-admin takeover. There is no super-admin tier, so every
 * admin is otherwise omnipotent over every other admin — one admin could reset
 * another's password, ban them out (locking them at requireAdmin), or delete
 * them. This blocks mutating a target that is *itself* an ADMIN unless it's the
 * caller's own account. Promoting a plain USER to ADMIN stays allowed.
 */
async function assertNotPeerAdmin(
  admin: { id: string },
  targetUserId: string
): Promise<void> {
  if (!targetUserId || targetUserId === admin.id) return;
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true },
  });
  if (target?.role === "ADMIN") {
    throw new AdminError("אין הרשאה לפעול על חשבון אדמין אחר");
  }
}

/**
 * The single choke point every target-scoped admin action funnels through.
 *
 * `assertNotPeerAdmin` was called from 4 of the 17 actions that carry a target,
 * which is worse than not having it at all: it stopped one admin renaming or
 * banning another, while leaving them free to empty that admin's treasury, wipe
 * their army, strip their hero, delete their gear or kick them out of their
 * guild. A guard covering a quarter of the surface is false assurance, so it now
 * hangs off the one line all 17 already shared.
 *
 * The owner is resolved from `empireId` in preference to the `userId` the form
 * also carries. That field exists only so the action can revalidate the right
 * page, and the two are never cross-checked — so an admin hand-rolling the POST
 * could pair a peer's `empireId` with their own `userId` and walk straight past
 * a userId-only check.
 */
async function assertTargetEditable(
  admin: { id: string },
  target: { userId?: string; empireId?: string }
): Promise<void> {
  if (target.empireId) {
    const owner = await prisma.empire.findUnique({
      where: { id: target.empireId },
      select: { userId: true },
    });
    if (owner) return assertNotPeerAdmin(admin, owner.userId);
  }
  if (target.userId) return assertNotPeerAdmin(admin, target.userId);
}

/**
 * Read a trimmed string field, truncated to `maxLen`.
 *
 * Numbers here are carefully clamped but strings used to be unbounded, so a
 * multi-megabyte broadcast body was `createMany`'d onto every empire in the
 * game in a single call. The default is generous enough for every real field;
 * pass a larger cap explicitly for message bodies.
 */
function str(formData: FormData, key: string, maxLen = 500): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, maxLen);
}

/**
 * Validate an optional message link. Only internal paths are allowed.
 *
 * Every legitimate value in the codebase is a relative route ("/game/..."), and
 * an admin-authored absolute URL rendered as a trusted in-game link is a
 * broadcast-scale phishing primitive — the message UI presents it as the game's
 * own "view full report" affordance to every player at once.
 *
 * Rather than blocklisting prefixes, resolve the value against a sentinel origin
 * and require that the origin survives. Prefix checks kept missing forms that
 * browsers treat as protocol-relative: `//evil.tld` was caught, but per the
 * WHATWG URL spec a special-scheme URL treats `/\` exactly like `//`, so
 * `/\evil.tld/x` passed the old guard and resolved to `https://evil.tld/x`.
 * `next/link` does not save us there — it classifies the value as local and
 * renders it verbatim, so a ctrl/middle-click hands it straight to the browser.
 */
const HREF_SENTINEL_ORIGIN = "https://href-check.invalid";

function optHref(formData: FormData, key: string): string | null {
  const raw = str(formData, key, 500);
  if (!raw) return null;
  const reject = () => {
    throw new AdminError("קישור חייב להיות נתיב פנימי שמתחיל ב-/");
  };
  if (!raw.startsWith("/")) reject();
  let resolved: URL;
  try {
    resolved = new URL(raw, HREF_SENTINEL_ORIGIN);
  } catch {
    return reject();
  }
  // Anything that steered off the sentinel origin was not an internal path.
  if (resolved.origin !== HREF_SENTINEL_ORIGIN) reject();
  return raw;
}

/**
 * Rows per statement for the broadcast/gift fan-out.
 *
 * These target every empire in the game. As one statement that is a single
 * `IN (…)` list and a single `createMany` with one row per player, which runs
 * into Postgres bind-parameter limits and holds the whole payload in memory
 * once the player count is large. Admin-only, so this is a scaling limit rather
 * than an attacker-reachable one.
 */
const BULK_BATCH_SIZE = 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function revalidateEmpire(userId?: string) {
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
  // The edited player's own game view must reflect changes immediately.
  revalidatePath("/game", "layout");
}

/** Bounds on the "active players" window, in hours. */
const ACTIVE_WINDOW_MIN_HOURS = 1;
const ACTIVE_WINDOW_MAX_HOURS = 24 * 90;
const ACTIVE_WINDOW_DEFAULT_HOURS = 24;

/** Read the "active" scope's window out of `scopeId`, clamped to sane bounds. */
function activeWindowHours(scopeId: string): number {
  const raw = Math.floor(Number(scopeId));
  if (!Number.isFinite(raw) || raw <= 0) return ACTIVE_WINDOW_DEFAULT_HOURS;
  return Math.min(ACTIVE_WINDOW_MAX_HOURS, Math.max(ACTIVE_WINDOW_MIN_HOURS, raw));
}

/** The id an audit row files a target-scoped action under. */
function scopeAuditId(scope: string, scopeId: string): string {
  if (scope === "empire") return scopeId;
  if (scope === "active") return `active:${activeWindowHours(scopeId)}h`;
  return scope;
}

/**
 * Resolve a broadcast/gift target ("scope") to a concrete list of empire ids.
 * scope: "all" | "active" | "season" | "guild" | "empire".
 *
 * `scopeId` carries a row id for season/guild/empire, and the window **in
 * hours** for "active" — those players whose `lastSeenAt` heartbeat (stamped by
 * the chat pulse that every game screen runs, open dock or not) falls inside
 * it. That is deliberately looser than the monitor's "wrote a row" definition
 * of active: a gift should reach everyone who showed up, not only the raiders.
 */
async function resolveTargetEmpireIds(scope: string, scopeId: string): Promise<string[]> {
  if (scope === "empire") {
    return scopeId ? [scopeId] : [];
  }
  // Bots are never an audience. Nobody reads their inbox, and a gift is worse
  // than pointless: resources handed to a bot land in the purse of something
  // whose whole purpose is to be plundered, so "1M gold to every player" would
  // quietly become "1M gold to every player, and a fresh haul waiting in every
  // garrison". The one scope that skips this filter is `empire`, where the
  // admin named the target by id and meant it. See src/lib/bot.ts.
  if (scope === "active") {
    const since = new Date(Date.now() - activeWindowHours(scopeId) * 3_600_000);
    const rows = await prisma.empire.findMany({
      where: { ...notBot, lastSeenAt: { gte: since } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  if (scope === "season") {
    const rows = await prisma.empire.findMany({
      where: { ...notBot, seasonId: scopeId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  if (scope === "guild") {
    const rows = await prisma.guildMember.findMany({
      where: { guildId: scopeId, empire: notBot },
      select: { empireId: true },
    });
    return rows.map((r) => r.empireId);
  }
  // "all"
  const rows = await prisma.empire.findMany({ where: notBot, select: { id: true } });
  return rows.map((r) => r.id);
}

/* ============================================================= */
/*                      USER ACCOUNT ACTIONS                     */
/* ============================================================= */

const roleSchema = z.enum(["USER", "ADMIN"]);

/** Edit a user's name, email and role. */
export async function updateUserAccount(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const name = str(formData, "name");
    const email = str(formData, "email").toLowerCase();
    const role = roleSchema.parse(formData.get("role")) as Role;

    if (name.length < 2) return { error: "שם קצר מדי" };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "אימייל לא תקין" };
    if (userId === admin.id && role !== "ADMIN") {
      return { error: "אי אפשר להסיר לעצמך הרשאות אדמין" };
    }

    const clash = await prisma.user.findFirst({
      where: { email, NOT: { id: userId } },
      select: { id: true },
    });
    if (clash) return { error: "האימייל כבר תפוס על ידי משתמש אחר" };

    // Moving an account to a different address invalidates the proof of
    // ownership that was taken for the old one, so re-gate verification and
    // revoke every live session. Otherwise the row stays "verified" for an
    // address nobody has ever confirmed, and whoever was signed in keeps their
    // session across the identity change. This is the only email-mutation path
    // in the app, so it is the only place that invariant can be broken.
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const emailChanged = target != null && target.email !== email;
    // The role and the empire's `isStaff` flag must land together: the flag is
    // what every board filters on and what makes the empire untargetable, so a
    // promotion that wrote only the role would leave an admin still ranked and
    // still farmable. In one transaction so a failure cannot leave the two
    // disagreeing. See src/lib/staff.ts.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name,
          email,
          role,
          ...(emailChanged
            ? { emailVerified: null, tokenVersion: { increment: 1 } }
            : {}),
        },
      });
      await syncStaffFlag(tx, userId, role);
    });
    await logAdmin(admin, {
      action: "user.update",
      targetType: "user",
      targetId: userId,
      summary: `עודכן משתמש ${email} (תפקיד: ${role})`,
    });
    revalidateEmpire(userId);
    return { success: "פרטי המשתמש עודכנו" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Ban a user (blocks login and all game access) for a chosen span.
 *
 * Three shapes, all stored as the same pair of columns: `days` sets a deadline
 * N days out, `season` borrows the active season's `endsAt` (the natural unit
 * of punishment here — a cheat sits out the rest of the competition and starts
 * clean with everyone else next season), and `permanent` leaves `bannedUntil`
 * null. Nothing lifts a timed ban on a schedule; it simply stops matching
 * `isBanned` once its deadline passes.
 */
export async function banUser(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    if (userId === admin.id) return { error: "אי אפשר לתת באן לעצמך" };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { bannedAt: true, bannedUntil: true, email: true },
    });
    if (!user) return { error: "המשתמש לא נמצא" };

    const now = new Date();
    const mode = str(formData, "mode", 20);
    let bannedUntil: Date | null = null;
    if (mode === "days") {
      // Clamped rather than rejected: the field is a number box, and a ban an
      // admin meant as "a week" must never land as an accidental millennium.
      const days = Math.max(1, Math.min(BAN_DAYS_MAX, Math.round(optNum(formData, "days", 7))));
      bannedUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    } else if (mode === "season") {
      const season = await prisma.gameSeason.findFirst({
        where: { isActive: true },
        select: { name: true, endsAt: true },
      });
      if (!season) return { error: "אין עונה פעילה — בחר משך אחר" };
      if (season.endsAt <= now) return { error: "העונה הפעילה כבר הסתיימה — בחר משך אחר" };
      bannedUntil = season.endsAt;
    } else if (mode !== "permanent") {
      return { error: "משך באן לא תקין" };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        // Re-banning an account that is already serving one keeps the original
        // stamp: the row records when the player was first punished, and only
        // the deadline moves.
        bannedAt: isBanned(user, now) ? user.bannedAt : now,
        bannedUntil,
        // Bumping tokenVersion invalidates every JWT already issued to this
        // account, so the ban takes effect on the next request instead of
        // relying on each call site to re-read the ban. Sessions are stateless
        // and last 30 days; any path that checks only the signature would
        // otherwise keep serving a banned user until the token expired.
        tokenVersion: { increment: 1 },
      },
    });
    const span = bannedUntil ? `עד ${formatBanDate(bannedUntil)}` : "לצמיתות";
    await logAdmin(admin, {
      action: "user.ban",
      targetType: "user",
      targetId: userId,
      summary: `ניתן באן ל-${user.email} ${span}`,
    });
    revalidateEmpire(userId);
    return { success: `הבאן ניתן — ${span}` };
  } catch (e) {
    return toErr(e);
  }
}

/** Lift a ban (including one whose deadline has already passed). */
export async function unbanUser(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) return { error: "המשתמש לא נמצא" };

    await prisma.user.update({
      where: { id: userId },
      data: { bannedAt: null, bannedUntil: null },
    });
    await logAdmin(admin, {
      action: "user.unban",
      targetType: "user",
      targetId: userId,
      summary: `הוסר באן מ-${user.email}`,
    });
    revalidateEmpire(userId);
    return { success: "הבאן הוסר" };
  } catch (e) {
    return toErr(e);
  }
}

/** Force-set a new password for a user. */
export async function resetUserPassword(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const password = String(formData.get("password") ?? "");
    if (password.length < 8) return { error: "סיסמה חייבת להכיל לפחות 8 תווים" };

    const passwordHash = await hashPassword(password);
    // Bump tokenVersion so every session issued under the old password is
    // revoked — a reset must lock out anyone holding a stale/leaked cookie.
    await prisma.user.update({
      where: { id: userId },
      // Clearing the lockout is what makes this the support path for a player
      // locked out by someone else guessing at their account.
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    await logAdmin(admin, {
      action: "user.reset_password",
      targetType: "user",
      targetId: userId,
      summary: "אופסה סיסמת משתמש",
    });
    return { success: "הסיסמה אופסה בהצלחה" };
  } catch (e) {
    return toErr(e);
  }
}

/** Permanently delete a user and their empire (cascade). */
export async function deleteUser(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    if (userId === admin.id) return { error: "אי אפשר למחוק את עצמך" };
    const confirm = str(formData, "confirm");
    if (confirm !== "DELETE") return { error: 'יש להקליד DELETE לאישור המחיקה' };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    await prisma.user.delete({ where: { id: userId } });
    await logAdmin(admin, {
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      summary: `נמחק משתמש ${user?.email ?? userId}`,
    });
    revalidatePath("/admin/users");
    return { success: "המשתמש נמחק" };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                       EMPIRE STATE EDIT                       */
/* ============================================================= */

/**
 * Report a guild the city edit just broke up, appended to the panel's own
 * success line.
 *
 * An admin nudging `cities` on the vitals panel is not thinking about guilds,
 * and the rule (server/guildCity.ts) is silent by design — without this line
 * the roster would simply be one member shorter, or the guild gone, with the
 * only trace in the player's inbox.
 */
function guildCityAdminNote(outcome: GuildCityOutcome | null): string {
  if (!outcome) return "";
  return outcome.kind === "disbanded"
    ? ` · הברית "${outcome.guildName}" פורקה — מנהיג שעבר עיר`
    : ` · השחקן פרש מהברית "${outcome.guildName}" (עיר ${outcome.guildCity})`;
}

/**
 * Set the empire core scalars (resources, name, turns, wheel spins, cities).
 *
 * Deliberately does **not** touch `Empire.level`: that column is vestigial and
 * no screen in the game reads it, so an editable "רמה" here was a trap — it
 * saved happily and changed nothing the player could see. The level a player
 * has is the hero's, and it is edited in the גיבור panel (`updateHero`).
 */
export async function updateEmpireCore(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const name = str(formData, "name");
    if (name.length < 2) return { error: "שם אימפריה קצר מדי" };

    const clash = await prisma.empire.findFirst({
      where: { name, NOT: { id: empireId } },
      select: { id: true },
    });
    if (clash) return { error: "שם האימפריה כבר תפוס" };

    // The city write and the guild rule share a transaction: an admin moving a
    // guild leader between tiers disbands the guild exactly the way the player
    // doing it himself would. See server/guildCity.ts.
    const guildOutcome = await prisma.$transaction(async (tx) => {
      // Read before the write: the rule only fires on a tier that actually
      // moved, and this form posts `cities` on every save.
      const { cities: previousCities } = await tx.empire.findUniqueOrThrow({
        where: { id: empireId },
        select: { cities: true },
      });
      await tx.empire.update({
        where: { id: empireId },
        data: {
          name,
          gold: Math.max(0, num(formData, "gold")),
          wood: Math.max(0, num(formData, "wood")),
          iron: Math.max(0, num(formData, "iron")),
          stone: Math.max(0, num(formData, "stone")),
          diamonds: Math.max(0, num(formData, "diamonds")),
          citizens: Math.max(0, intNum(formData, "citizens")),
          turns: Math.max(0, intNum(formData, "turns")),
          wheelSpins: Math.max(0, intNum(formData, "wheelSpins")),
          // Cities gate the whole progression (citizen cap, quest tiers, the
          // ranking bucket), so it is clamped to the real ladder rather than
          // trusted from the form.
          cities: Math.max(
            1,
            Math.min(MAX_CITIES, Math.round(num(formData, "cities")))
          ),
        },
      });
      return applyGuildCityRule(tx, empireId, previousCities);
    });
    await logAdmin(admin, {
      action: "empire.core",
      targetType: "empire",
      targetId: empireId,
      summary: `עודכנו נתוני ליבה של ${name}`,
    });
    revalidateEmpire(userId);
    // A clamped field must never look like it saved as typed. Both ceilings are
    // reported, and they are different numbers: the int4 columns stop a billion
    // short of int4's max, the resource columns at the game's RESOURCE_MAX.
    //
    // Compared against the *raw* form value rather than what `num`/`intNum`
    // returned, because those already clamped — the evidence that a ceiling bit
    // is gone by the time they return.
    const notes = [
      ...clampNotes(formData, INT_CORE_FIELDS, ADMIN_INT_MAX),
      ...clampNotes(formData, FLOAT_CORE_FIELDS, ADMIN_NUM_MAX),
    ];
    return {
      success:
        (notes.length
          ? `נתוני האימפריה עודכנו — ${notes.join("; ")}`
          : "נתוני האימפריה עודכנו") + guildCityAdminNote(guildOutcome),
    };
  } catch (e) {
    return toErr(e);
  }
}

/** Core empire fields backed by an `Int` column, with their Hebrew labels. */
const INT_CORE_FIELDS = [
  ["level", "רמה"],
  ["citizens", "אזרחים"],
  ["turns", "תורות"],
  ["wheelSpins", "סיבובי גלגל"],
] as const;

/** Core empire fields backed by a `Float` column, with their Hebrew labels. */
const FLOAT_CORE_FIELDS = [
  ["gold", "זהב"],
  ["wood", "עץ"],
  ["iron", "ברזל"],
  ["stone", "אבן"],
  ["diamonds", "יהלומים"],
] as const;

/**
 * One "these fields were capped at N" sentence, or nothing if none were.
 *
 * Reads the submitted string directly instead of going through `num`: the whole
 * point is to notice a value the parsers would silently pull down, and they have
 * already done so by the time they return. A field that is absent or unparseable
 * is not reported — `num` throws on those long before this runs.
 */
function clampNotes(
  formData: FormData,
  fields: ReadonlyArray<readonly [string, string]>,
  max: number
): string[] {
  const hit = fields
    .filter(([key]) => Number(formData.get(key)) > max)
    .map(([, label]) => label);
  if (hit.length === 0) return [];
  return [`${hit.join(", ")} הוגבלו למקסימום ${formatNumber(max)}`];
}

/** Set the army counts. */
export async function updateArmy(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const data = {
      soldiers: Math.max(0, intNum(formData, "soldiers")),
      spies: Math.max(0, intNum(formData, "spies")),
      mineSlaves: Math.max(0, intNum(formData, "mineSlaves")),
    };
    await prisma.army.upsert({
      where: { empireId },
      create: { empireId, ...data },
      update: data,
    });
    await syncEmpirePower(prisma, empireId);
    await logAdmin(admin, {
      action: "empire.army",
      targetType: "empire",
      targetId: empireId,
      summary: `צבא עודכן: ${data.soldiers} חיילים / ${data.spies} מרגלים / ${data.mineSlaves} עבדים`,
    });
    revalidateEmpire(userId);
    return { success: "הצבא עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * The quick-glance panel at the top of a player's page: the handful of numbers
 * an admin actually reaches for, saved in one submit.
 *
 * It is a shortcut around the *scrolling*, never around a rule. Every field it
 * writes is already editable further down the same page, and it clamps exactly
 * the way those panels do — the resources through `num` (RESOURCE_MAX), the
 * int4 columns through `intNum`, the cities to the real ladder. Nothing new is
 * reachable from here; the army and the treasury simply stopped being nine
 * panels apart.
 *
 * Empire and army land in one transaction with the power re-sync, so the
 * denormalised ladder figures can never commit out of step with the soldier
 * count that produced them (see syncEmpirePower).
 */
export async function updateVitals(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });

    const army = {
      soldiers: Math.max(0, intNum(formData, "soldiers")),
      spies: Math.max(0, intNum(formData, "spies")),
      mineSlaves: Math.max(0, intNum(formData, "mineSlaves")),
    };
    const core = {
      gold: Math.max(0, num(formData, "gold")),
      wood: Math.max(0, num(formData, "wood")),
      iron: Math.max(0, num(formData, "iron")),
      stone: Math.max(0, num(formData, "stone")),
      diamonds: Math.max(0, num(formData, "diamonds")),
      citizens: Math.max(0, intNum(formData, "citizens")),
      turns: Math.max(0, intNum(formData, "turns")),
      wheelSpins: Math.max(0, intNum(formData, "wheelSpins")),
      cities: clampLevel(num(formData, "cities"), 1, MAX_CITIES),
    };

    const guildOutcome = await prisma.$transaction(async (tx) => {
      // See updateEmpireCore: the tier before the write is what tells the guild
      // rule whether anything moved at all.
      const { cities: previousCities } = await tx.empire.findUniqueOrThrow({
        where: { id: empireId },
        select: { cities: true },
      });
      await tx.empire.update({ where: { id: empireId }, data: core });
      await tx.army.upsert({
        where: { empireId },
        create: { empireId, ...army },
        update: army,
      });
      await syncEmpirePower(tx, empireId);
      // This panel edits `cities` too, so it owes the same guild rule the core
      // panel does — see server/guildCity.ts.
      return applyGuildCityRule(tx, empireId, previousCities);
    });

    await logAdmin(admin, {
      action: "empire.vitals",
      targetType: "empire",
      targetId: empireId,
      summary: `מבט מהיר עודכן: ${Math.round(core.gold)} זהב / ${Math.round(core.diamonds)} יהלומים / ${core.turns} תורות / ${army.soldiers} חיילים / ${army.mineSlaves} עבדים`,
    });
    revalidateEmpire(userId);

    // Same reporting the core panel does: a value the parsers pulled down must
    // never look like it saved as typed.
    const notes = [
      ...clampNotes(formData, VITALS_INT_FIELDS, ADMIN_INT_MAX),
      ...clampNotes(formData, FLOAT_CORE_FIELDS, ADMIN_NUM_MAX),
    ];
    return {
      success:
        (notes.length
          ? `המבט המהיר נשמר — ${notes.join("; ")}`
          : "המבט המהיר נשמר") + guildCityAdminNote(guildOutcome),
    };
  } catch (e) {
    return toErr(e);
  }
}

/** Int-backed fields of the quick panel, with their Hebrew labels. */
const VITALS_INT_FIELDS = [
  ["citizens", "אזרחים"],
  ["turns", "תורות"],
  ["wheelSpins", "סיבובי גלגל"],
  ["soldiers", "חיילים"],
  ["spies", "מרגלים"],
  ["mineSlaves", "עבדים"],
] as const;

/** Set the bank gold balance. */
export async function updateBank(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const goldBalance = Math.max(0, num(formData, "goldBalance"));
    await prisma.bankAccount.upsert({
      where: { empireId },
      create: { empireId, goldBalance },
      update: { goldBalance },
    });
    await logAdmin(admin, {
      action: "empire.bank",
      targetType: "empire",
      targetId: empireId,
      summary: `יתרת בנק הוגדרה ל-${Math.round(goldBalance)}`,
    });
    revalidateEmpire(userId);
    return { success: "הבנק עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

/** Set one building's level + assigned slaves. */
export async function updateBuilding(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const type = str(formData, "type") as BuildingType;
    const isMine = isProductionBuilding(type);
    // Mines share the player's ceiling; the barracks and the spy center are
    // built once at level 1 and have no upgrade path at all. The floor is 1
    // for everything: a level-0 mine produces nothing no matter how many
    // slaves are in it, and the player has no way to see why.
    const level = clampLevel(num(formData, "level"), 1, isMine ? MINE_MAX_LEVEL : 1);

    // Mine slaves are a *shared* pool: the assignment screen refuses any split
    // whose total exceeds the army's `mineSlaves`. This form edits one mine at a
    // time, so the ceiling is the pool minus what the other mines already hold —
    // without it a mine could be staffed with slaves the empire never trained,
    // which is production conjured out of nothing.
    const [army, others] = await Promise.all([
      prisma.army.findUnique({ where: { empireId }, select: { mineSlaves: true } }),
      prisma.building.findMany({
        where: { empireId, NOT: { type } },
        select: { type: true, slavesAssigned: true },
      }),
    ]);
    const assignedElsewhere = others
      .filter((b) => isProductionBuilding(b.type))
      .reduce((sum, b) => sum + b.slavesAssigned, 0);
    const slaveCeiling = Math.max(0, (army?.mineSlaves ?? 0) - assignedElsewhere);
    const slavesAssigned = isMine
      ? clampLevel(optNum(formData, "slavesAssigned"), 0, slaveCeiling)
      : 0;

    await prisma.building.upsert({
      where: { empireId_type: { empireId, type } },
      create: { empireId, type, level, slavesAssigned },
      update: { level, slavesAssigned },
    });
    await logAdmin(admin, {
      action: "empire.building",
      targetType: "empire",
      targetId: empireId,
      summary: `מבנה ${type} → רמה ${level}${isMine ? ` · ${slavesAssigned} עבדים` : ""}`,
    });
    revalidateEmpire(userId);
    // The applied numbers ride back on the message: a clamped value must not
    // look like it was saved as typed.
    return {
      success: `המבנה עודכן — רמה ${level}${isMine ? `, ${slavesAssigned} עבדים` : ""}`,
    };
  } catch (e) {
    return toErr(e);
  }
}

/** Set one warehouse's level + stored amount. */
export async function updateStorage(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const resourceType = str(formData, "resourceType") as ResourceStorageType;
    const level = Math.max(1, intNum(formData, "level"));
    const storedAmount = Math.max(0, num(formData, "storedAmount"));
    await prisma.resourceStorage.upsert({
      where: { empireId_resourceType: { empireId, resourceType } },
      create: { empireId, resourceType, level, storedAmount },
      update: { level, storedAmount },
    });
    await logAdmin(admin, {
      action: "empire.storage",
      targetType: "empire",
      targetId: empireId,
      summary: `מחסן ${resourceType} → רמה ${level}`,
    });
    revalidateEmpire(userId);
    return { success: "המחסן עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

/** Set one empire upgrade's level. */
export async function updateUpgrade(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const type = str(formData, "type") as EmpireUpgradeType;
    // Ceilings are per-type and, for CITIZEN_GROWTH, per city count — the exact
    // rule `empireUpgradeMaxLevel` enforces on the upgrades page. DIAMOND_YIELD
    // is retired and carries no metadata, so it keeps the lower bound only.
    const cities =
      (
        await prisma.empire.findUnique({
          where: { id: empireId },
          select: { cities: true },
        })
      )?.cities ?? 1;
    const maxLevel =
      type in EMPIRE_UPGRADE_META
        ? empireUpgradeMaxLevel(type as ActiveEmpireUpgradeType, cities)
        : undefined;
    const level = clampLevel(num(formData, "level"), 1, maxLevel ?? ADMIN_INT_MAX);
    await prisma.empireUpgrade.upsert({
      where: { empireId_type: { empireId, type } },
      create: { empireId, type, level },
      update: { level },
    });
    await logAdmin(admin, {
      action: "empire.upgrade",
      targetType: "empire",
      targetId: empireId,
      summary: `שדרוג ${type} → רמה ${level}`,
    });
    revalidateEmpire(userId);
    return { success: `השדרוג עודכן — רמה ${level}` };
  } catch (e) {
    return toErr(e);
  }
}

/** Set a weapon category's unlocked tier. */
export async function updateWeaponUnlock(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const category = str(formData, "category") as WeaponCategory;
    // 30 tiers per category is the whole catalog — a higher "unlocked tier" is
    // not just meaningless, it silently widens the wheel's weapon prize pool
    // (`wheel.ts` gates drops on `weapon.tier <= unlockedTier`).
    const unlockedTier = clampLevel(
      num(formData, "unlockedTier"),
      1,
      TIERS_PER_CATEGORY
    );
    await prisma.empireWeaponUnlock.upsert({
      where: { empireId_category: { empireId, category } },
      create: { empireId, category, unlockedTier },
      update: { unlockedTier },
    });
    await logAdmin(admin, {
      action: "empire.weapon_unlock",
      targetType: "empire",
      targetId: empireId,
      summary: `פתיחת נשק ${category} → טיר ${unlockedTier}`,
    });
    revalidateEmpire(userId);
    return { success: `פתיחת הנשק עודכנה — טיר ${unlockedTier}` };
  } catch (e) {
    return toErr(e);
  }
}

/** Set the quantity of one weapon (0 removes it from the arsenal). */
export async function setWeaponQuantity(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const weaponKey = str(formData, "weaponKey");
    if (!weaponByKey(weaponKey)) return { error: "מפתח נשק לא קיים" };
    const quantity = Math.max(0, intNum(formData, "quantity"));

    if (quantity === 0) {
      await prisma.empireWeapon.deleteMany({ where: { empireId, weaponKey } });
    } else {
      await prisma.empireWeapon.upsert({
        where: { empireId_weaponKey: { empireId, weaponKey } },
        create: { empireId, weaponKey, quantity },
        update: { quantity },
      });
    }
    // Both branches change the arsenal, so the sync sits after the whole
    // if/else rather than inside either arm.
    await syncEmpirePower(prisma, empireId);
    await logAdmin(admin, {
      action: "empire.weapon",
      targetType: "empire",
      targetId: empireId,
      summary: `נשק ${weaponKey} → ${quantity}`,
    });
    revalidateEmpire(userId);
    return { success: "מלאי הנשק עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

/** Set the hero stats. */
export async function updateHero(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const heroClass = z
      .enum(["WARLORD", "GUARDIAN", "MERCHANT", "SHADOW"])
      .parse(formData.get("heroClass"));
    // Health doubles as the life/death switch: setting it to 0 kills the hero
    // here and now (starting his revival hour), anything above raises him.
    const health = Math.max(
      0,
      Math.min(HERO_MAX_HEALTH, Math.round(num(formData, "health")))
    );
    const level = clampLevel(num(formData, "level"), 1, HERO_MAX_LEVEL);
    const resets = Math.max(0, intNum(formData, "resets"));
    // XP is consumed as it is earned — `applyHeroXp` subtracts each level's cost
    // as it cascades — so a live hero never holds more than the next level's
    // requirement, and a hero standing at the cap always sits at exactly 0.
    const xp =
      level >= HERO_MAX_LEVEL
        ? 0
        : clampLevel(num(formData, "xp"), 0, xpToNextLevel(level));

    // Stat points have exactly two sources — one per level the hero stands at
    // and 30 for every reset behind him — and `heroPointPool` is the only place
    // that says so. Each point is a permanent +1% on a core combat stat, so an
    // unbounded field here is a bigger cheat than any resource number. The pool
    // is filled in allocation order and whatever exceeds it is dropped.
    //
    // What is *not* dropped is the remainder: a level raised here used to leave
    // the extra points unwritten (the form posts the old figures), which is how
    // a level-16 hero ended up holding 9 points. Whatever the four fields leave
    // unspent now lands in `unspentPoints`, so the row always satisfies the pool.
    const pointPool = heroPointPool(level, resets);
    let unallocated = pointPool;
    const takePoints = (key: string) => {
      const want = Math.max(0, Math.round(num(formData, key)));
      const got = Math.min(unallocated, want);
      unallocated -= got;
      return got;
    };

    const data = {
      heroClass,
      health,
      diedAt: health <= 0 ? new Date() : null,
      level,
      xp,
      attackPoints: takePoints("attackPoints"),
      defensePoints: takePoints("defensePoints"),
      resourcePoints: takePoints("resourcePoints"),
      // Takes what the form asked for and then keeps the rest of the pool —
      // never less than the hero is owed.
      unspentPoints: takePoints("unspentPoints") + unallocated,
      resets,
    };
    await prisma.hero.upsert({
      where: { empireId },
      create: { empireId, ...data },
      update: data,
    });
    await logAdmin(admin, {
      action: "empire.hero",
      targetType: "empire",
      targetId: empireId,
      summary: `גיבור → רמה ${data.level}`,
    });
    revalidateEmpire(userId);
    return {
      success: `הגיבור עודכן — רמה ${data.level}, ${pointPool} נק' זמינות`,
    };
  } catch (e) {
    return toErr(e);
  }
}

const slotSchema = z.enum([
  "SWORD",
  "GAUNTLETS",
  "WINGS",
  "HELMET",
  "ARMOR",
  "SHIELD",
  "PANTS",
  "BOOTS",
  "RELIC",
]);
const raritySchema = z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY"]);

/** Grant a hero item to an empire's hero. */
export async function grantHeroItem(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const slot = slotSchema.parse(formData.get("slot")) as HeroItemSlot;
    const rarity = raritySchema.parse(formData.get("rarity")) as HeroRarity;
    // Gear levels ride the hero ladder: drops roll at most HERO_MAX_LEVEL and
    // `nextTierLevel` refuses to upgrade past it.
    const level = clampLevel(num(formData, "level"), 1, HERO_MAX_LEVEL);

    const hero = await prisma.hero.upsert({
      where: { empireId },
      create: { empireId },
      update: {},
      select: { id: true },
    });
    await prisma.heroItem.create({
      data: { heroId: hero.id, slot, level, rarity, equipped: false },
    });
    await logAdmin(admin, {
      action: "empire.hero_item",
      targetType: "empire",
      targetId: empireId,
      summary: `פריט גיבור הוענק: ${slot} ${rarity} רמה ${level}`,
    });
    revalidateEmpire(userId);
    return { success: `הפריט הוענק לגיבור — רמה ${level}` };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Hand a hero a **whole set** in one click: the nine slots, all at one item
 * level, worn on the spot unless the form says otherwise.
 *
 * This is the shortcut `grantHeroItem` isn't — dressing a tester or compensating
 * a player used to mean nine trips through that form, each one a slot/rarity/level
 * triple that had to be kept consistent by hand. Here the level is the *only*
 * choice: rarity follows from `tierForLevel`, so the piece and its band always
 * agree exactly as a drop's would, and the level itself is a rung of the set
 * ladder, so the gear is a real set with real art rather than nine odd levels.
 *
 * Worn gear that gets displaced is moved to the bag, never destroyed — the old
 * pieces may well outrank the gift. That can push the bag past HERO_BAG_CAPACITY,
 * which is a state the game already tolerates (every add-to-bag path checks the
 * cap before it writes, so an over-full bag simply blocks new loot until the
 * player throws something away). The success message says so when it happens.
 */
export async function grantHeroSet(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const level = clampLevel(num(formData, "level"), 1, HERO_MAX_LEVEL);
    const rarity = tierForLevel(level);
    const equip = flag(formData, "equip");

    const hero = await prisma.hero.upsert({
      where: { empireId },
      create: { empireId },
      update: {},
      select: { id: true },
    });

    const bagCount = await prisma.$transaction(async (tx) => {
      // One worn item per slot, exactly as the paperdoll enforces: the whole
      // set is going on, so everything currently worn comes off first.
      if (equip) {
        await tx.heroItem.updateMany({
          where: { heroId: hero.id, equipped: true },
          data: { equipped: false },
        });
      }
      await tx.heroItem.createMany({
        data: SLOT_ORDER.map((slot) => ({
          heroId: hero.id,
          slot,
          level,
          rarity,
          equipped: equip,
        })),
      });
      return tx.heroItem.count({ where: { heroId: hero.id, equipped: false } });
    });

    const setLabel = itemSetForLevel(level).label;
    await logAdmin(admin, {
      action: "empire.hero_set",
      targetType: "empire",
      targetId: empireId,
      summary: `סט גיבור הוענק: ${setLabel} רמה ${level} (${rarity})${equip ? " וחובש" : ""}`,
    });
    revalidateEmpire(userId);
    return {
      success:
        `הוענק סט מלא — ${setLabel}, ${SLOT_ORDER.length} פריטים ברמה ${level} ` +
        `(${RARITY_META[rarity].label})${equip ? ", חבושים על הגיבור" : ""}` +
        (bagCount > HERO_BAG_CAPACITY
          ? ` — שים לב: התיק חורג מהקיבולת (${bagCount}/${HERO_BAG_CAPACITY}), השחקן יצטרך להשליך פריטים`
          : ""),
    };
  } catch (e) {
    return toErr(e);
  }
}

/** Delete a hero item. */
export async function deleteHeroItem(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const itemId = str(formData, "itemId");
    const userId = str(formData, "userId");
    // The only target-scoped action that names its target by neither empireId
    // nor a trustworthy userId — the item id is the real subject, so walk it
    // back to the empire that owns it rather than trusting the form's userId.
    const owner = await prisma.heroItem.findUnique({
      where: { id: itemId },
      select: { hero: { select: { empireId: true } } },
    });
    await assertTargetEditable(admin, {
      userId,
      empireId: owner?.hero.empireId,
    });
    await prisma.heroItem.delete({ where: { id: itemId } });
    await logAdmin(admin, {
      action: "empire.hero_item_delete",
      targetType: "heroItem",
      targetId: itemId,
      summary: "נמחק פריט גיבור",
    });
    revalidateEmpire(userId);
    return { success: "הפריט נמחק" };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                    PER-PLAYER FULL CONTROL                    */
/* ============================================================= */

/**
 * Everything below edits ONE player and completes the editor above: account
 * security, the empire clocks, timed buffs, the ladders, the mailbox and the
 * history tables. Same contract as every action in this file — `requireAdmin`,
 * `assertTargetEditable`, an audit row, a revalidate.
 *
 * These write game state directly and deliberately skip the costs, cooldowns
 * and capacity rules the player-facing paths enforce; that is the point of an
 * admin console. Nothing here pays out a reward as a side effect either —
 * granting an achievement marks it collected, it does not credit its prize.
 */

/** Read a boolean carried as a "1"/"0" select (the forms have no checkboxes). */
function flag(formData: FormData, key: string): boolean {
  const raw = String(formData.get(key) ?? "");
  return raw === "1" || raw === "on" || raw === "true";
}

/**
 * Read an optional "hours ago" field as an absolute instant; blank → null.
 *
 * The clock fields are entered as an age rather than a wall-clock time on
 * purpose: a `datetime-local` value is a bare "YYYY-MM-DDTHH:mm" with no zone,
 * so the browser means the admin's timezone and `new Date()` on the server
 * would read it as the server's (UTC in production) — a silent three-hour slip
 * on every edit. An offset from now means the same thing on both ends.
 */
function hoursAgo(formData: FormData, key: string): Date | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new AdminError(`ערך לא תקין בשדה ${key}`);
  return new Date(Date.now() - clampNum(n) * 3_600_000);
}

/** A future instant `minutes` from now, or null for a non-positive duration. */
function inMinutes(minutes: number): Date | null {
  if (minutes <= 0) return null;
  return new Date(Date.now() + minutes * 60_000);
}

/* ------------------------- account security ------------------------- */

/** Mark the address verified, or revoke the verification (re-gates the game). */
export async function toggleEmailVerified(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true, email: true },
    });
    if (!user) return { error: "המשתמש לא נמצא" };

    const verify = user.emailVerified == null;
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: verify ? new Date() : null },
    });
    await logAdmin(admin, {
      action: verify ? "user.verify_email" : "user.unverify_email",
      targetType: "user",
      targetId: userId,
      summary: `${verify ? "אומת" : "בוטל אימות"} האימייל ${user.email}`,
    });
    revalidateEmpire(userId);
    return { success: verify ? "האימייל סומן כמאומת" : "אימות האימייל בוטל" };
  } catch (e) {
    return toErr(e);
  }
}

/** Clear a login lockout (failed-attempt counter + lock window). */
export async function clearLoginLock(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId });
    await prisma.user.update({
      where: { id: userId },
      data: { failedLogins: 0, lockedUntil: null },
    });
    await logAdmin(admin, {
      action: "user.clear_lock",
      targetType: "user",
      targetId: userId,
      summary: "נעילת ההתחברות נוקתה",
    });
    revalidateEmpire(userId);
    return { success: "הנעילה הוסרה — המשתמש יכול להתחבר שוב" };
  } catch (e) {
    return toErr(e);
  }
}

/** Revoke every live session of a user (bumps the token version). */
export async function forceLogoutUser(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId });
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await logAdmin(admin, {
      action: "user.force_logout",
      targetType: "user",
      targetId: userId,
      summary: "כל החיבורים של המשתמש נותקו",
    });
    revalidateEmpire(userId);
    return { success: "כל ההתחברויות הקיימות נותקו" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Unlink the Google identity from an account.
 *
 * Refused while the account has no password, because Google is then the only
 * way in and unlinking would lock the player out of their own empire.
 */
export async function unlinkGoogleAccount(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleId: true, passwordHash: true },
    });
    if (!user) return { error: "המשתמש לא נמצא" };
    if (!user.googleId) return { error: "לחשבון אין חיבור לגוגל" };
    if (!user.passwordHash) {
      return { error: "אין סיסמה לחשבון — קבע סיסמה לפני ניתוק גוגל" };
    }

    await prisma.user.update({ where: { id: userId }, data: { googleId: null } });
    await logAdmin(admin, {
      action: "user.unlink_google",
      targetType: "user",
      targetId: userId,
      summary: "החיבור לגוגל נותק",
    });
    revalidateEmpire(userId);
    return { success: "החיבור לגוגל נותק" };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------- empire clocks / season ------------------------- */

/**
 * Newbie/raid protection: set it a number of hours out, or clear it so the
 * empire becomes attackable immediately.
 */
export async function updateEmpireProtection(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const hours = optNum(formData, "hours", 0);
    const protectedUntil = inMinutes(hours * 60);

    await prisma.empire.update({ where: { id: empireId }, data: { protectedUntil } });
    await logAdmin(admin, {
      action: "empire.protection",
      targetType: "empire",
      targetId: empireId,
      summary: protectedUntil
        ? `הגנה נקבעה ל-${hours} שעות`
        : "ההגנה הוסרה",
    });
    revalidateEmpire(userId);
    return { success: protectedUntil ? "ההגנה עודכנה" : "ההגנה הוסרה" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Grant or revoke VIP (חותם המלוכה).
 *
 * A paid entitlement needs a hand on it: a purchase that failed halfway, a
 * refund, a compensation. The stamp is the entitlement (see src/lib/game/vip.ts),
 * so granting is writing `now` and revoking is writing null — nothing else in
 * the game reads a second column for it. Diamonds are deliberately **not**
 * touched either way: a comp is not a sale, and a revocation after a refund
 * must not also hand the player the price back.
 */
export async function setEmpireVip(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const grant = formData.get("grant") === "1";

    await prisma.empire.update({
      where: { id: empireId },
      data: { vipSince: grant ? new Date() : null },
    });
    await logAdmin(admin, {
      action: "empire.vip",
      targetType: "empire",
      targetId: empireId,
      summary: grant ? "הוענק חותם המלוכה (VIP)" : "בוטל חותם המלוכה (VIP)",
    });
    revalidateEmpire(userId);
    return { success: grant ? "חותם המלוכה הוענק" : "חותם המלוכה בוטל" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * The two lazy game clocks plus the reports-seen marker.
 *
 * Winding `lastRegularUpdateAt` / `lastDailyUpdateAt` back is how an admin
 * hands a player their pending ticks: `applyPendingUpdates` settles everything
 * between the stored instant and now on their next page load.
 */
export async function updateEmpireClocks(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const lastRegularUpdateAt = hoursAgo(formData, "regularHoursAgo");
    const lastDailyUpdateAt = hoursAgo(formData, "dailyHoursAgo");
    const reportsSeenAt = hoursAgo(formData, "reportsHoursAgo");
    if (!lastRegularUpdateAt && !lastDailyUpdateAt && !reportsSeenAt) {
      return { error: "יש למלא לפחות שדה אחד" };
    }

    await prisma.empire.update({
      where: { id: empireId },
      data: {
        ...(lastRegularUpdateAt ? { lastRegularUpdateAt } : {}),
        ...(lastDailyUpdateAt ? { lastDailyUpdateAt } : {}),
        ...(reportsSeenAt ? { reportsSeenAt } : {}),
      },
    });
    await logAdmin(admin, {
      action: "empire.clocks",
      targetType: "empire",
      targetId: empireId,
      summary: "שעוני העדכון של האימפריה עודכנו",
      details: {
        lastRegularUpdateAt: lastRegularUpdateAt?.toISOString() ?? null,
        lastDailyUpdateAt: lastDailyUpdateAt?.toISOString() ?? null,
        reportsSeenAt: reportsSeenAt?.toISOString() ?? null,
      },
    });
    revalidateEmpire(userId);
    return { success: "השעונים עודכנו" };
  } catch (e) {
    return toErr(e);
  }
}

/** Move an empire to another season, or detach it from every season. */
export async function setEmpireSeason(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const seasonId = str(formData, "seasonId");
    if (seasonId) {
      const season = await prisma.gameSeason.findUnique({
        where: { id: seasonId },
        select: { id: true },
      });
      if (!season) return { error: "העונה לא נמצאה" };
    }

    await prisma.empire.update({
      where: { id: empireId },
      data: { seasonId: seasonId || null },
    });
    await logAdmin(admin, {
      action: "empire.season",
      targetType: "empire",
      targetId: empireId,
      summary: seasonId ? `הועבר לעונה ${seasonId}` : "נותק מכל עונה",
    });
    revalidateEmpire(userId);
    return { success: "שיוך העונה עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Re-derive the denormalised power columns from the army and arsenal.
 * The repair tool for a ladder that looks wrong — see the note on
 * `Empire.militaryPower`.
 */
export async function recomputeEmpirePower(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    await syncEmpirePower(prisma, empireId);
    await logAdmin(admin, {
      action: "empire.resync_power",
      targetType: "empire",
      targetId: empireId,
      summary: "עוצמת האימפריה חושבה מחדש",
    });
    revalidateEmpire(userId);
    return { success: "העוצמה חושבה מחדש" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Wipe a player back to a brand-new empire.
 *
 * Deleting the row and re-creating it is what makes this a true reset: every
 * child table (reports, messages, hero, gear, potions, buffs, achievements,
 * purchases history…) hangs off it with `onDelete: Cascade`, so anything a
 * hand-written per-table reset forgot would survive. The account itself, its
 * name and its season are kept.
 */
export async function resetEmpireProgress(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    if (str(formData, "confirm") !== "RESET") {
      return { error: "יש להקליד RESET לאישור האיפוס" };
    }

    const empire = await prisma.empire.findUnique({
      where: { id: empireId },
      select: {
        name: true,
        userId: true,
        seasonId: true,
        isStaff: true,
        isBot: true,
        hero: { select: { heroClass: true } },
      },
    });
    if (!empire) return { error: "האימפריה לא נמצאה" };
    // A bot has nothing to reset *to*. This path deletes the empire row and
    // builds a starter one in its place, which would cascade the `EmpireBot`
    // garrison away and leave a flagged empire with nothing to be rebuilt from —
    // a permanently defenceless target that the refill can no longer repair.
    // Re-arm it, or delete it and plant another. See /admin/bots.
    if (empire.isBot) {
      return { error: "אי אפשר לאפס בוט — חדש את חיל המצב או מחק אותו מדף הבוטים" };
    }

    const tunables = await getTunables();
    // Delete and re-create in one transaction: the empire name is unique, so a
    // create-before-delete would collide with the row it is replacing.
    await prisma.$transaction(async (tx) => {
      await tx.empire.delete({ where: { id: empireId } });
      await tx.empire.create({
        data: newEmpireData(
          empire.userId,
          empire.name,
          empire.seasonId ?? undefined,
          tunables.starting,
          empire.hero?.heroClass ?? "WARLORD",
          // Carried across the rebuild: a reset must not readmit a staff
          // empire to the competition.
          empire.isStaff
        ),
      });
    });
    await logAdmin(admin, {
      action: "empire.reset",
      targetType: "empire",
      targetId: empireId,
      summary: `האימפריה ${empire.name} אופסה להתחלה חדשה`,
    });
    revalidateEmpire(userId);
    return { success: "האימפריה אופסה להתחלה חדשה" };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------------ hero extras ------------------------------ */

/** Edit an existing hero item in place (slot, level, rarity, equipped). */
export async function updateHeroItem(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const itemId = str(formData, "itemId");
    const userId = str(formData, "userId");
    const item = await prisma.heroItem.findUnique({
      where: { id: itemId },
      select: { heroId: true, hero: { select: { empireId: true } } },
    });
    await assertTargetEditable(admin, { userId, empireId: item?.hero.empireId });
    if (!item) return { error: "הפריט לא נמצא" };

    const slot = slotSchema.parse(formData.get("slot")) as HeroItemSlot;
    const rarity = raritySchema.parse(formData.get("rarity")) as HeroRarity;
    const level = clampLevel(num(formData, "level"), 1, HERO_MAX_LEVEL);
    const equipped = flag(formData, "equipped");

    await prisma.$transaction(async (tx) => {
      // One item per slot may be worn, exactly as the paperdoll enforces.
      if (equipped) {
        await tx.heroItem.updateMany({
          where: { heroId: item.heroId, slot, NOT: { id: itemId } },
          data: { equipped: false },
        });
      }
      await tx.heroItem.update({
        where: { id: itemId },
        data: { slot, level, rarity, equipped },
      });
    });
    await logAdmin(admin, {
      action: "empire.hero_item_update",
      targetType: "heroItem",
      targetId: itemId,
      summary: `פריט גיבור עודכן: ${slot} ${rarity} רמה ${level}${equipped ? " (חבוש)" : ""}`,
    });
    revalidateEmpire(userId);
    return { success: `הפריט עודכן — רמה ${level}` };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * The hero's expedition: end it now so it can be collected, or cancel it
 * outright. Cancelling refunds nothing — the turns were spent at departure.
 */
export async function manageHeroQuest(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const op = z.enum(["finish", "cancel"]).parse(formData.get("op"));

    if (op === "cancel") {
      const { count } = await prisma.heroQuest.deleteMany({ where: { empireId } });
      if (count === 0) return { error: "הגיבור אינו במסע" };
    } else {
      const { count } = await prisma.heroQuest.updateMany({
        where: { empireId },
        data: { endsAt: new Date() },
      });
      if (count === 0) return { error: "הגיבור אינו במסע" };
    }
    await logAdmin(admin, {
      action: `empire.hero_quest_${op}`,
      targetType: "empire",
      targetId: empireId,
      summary: op === "cancel" ? "מסע הגיבור בוטל" : "מסע הגיבור הסתיים מיידית",
    });
    revalidateEmpire(userId);
    return { success: op === "cancel" ? "המסע בוטל" : "המסע הסתיים — ניתן לאיסוף" };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------------- potions ------------------------------- */

const potionKindSchema = z.enum([
  "DOUBLE_XP",
  "DOUBLE_RESOURCES",
  "HERO_INVULNERABLE",
  "FORGE_DISCOUNT",
]);

/** Set how many sealed bottles of one brew sit on the belt (0 removes them). */
export async function setPotionStack(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const kind = potionKindSchema.parse(formData.get("kind")) as PotionKind;
    const count = Math.max(0, Math.min(POTION_STACK_CAP, Math.round(num(formData, "count"))));

    await prisma.potionStack.upsert({
      where: { empireId_kind: { empireId, kind } },
      create: { empireId, kind, count },
      update: { count },
    });
    await logAdmin(admin, {
      action: "empire.potion_stack",
      targetType: "empire",
      targetId: empireId,
      summary: `שיקוי ${kind} → ${count} בקבוקים`,
    });
    revalidateEmpire(userId);
    return { success: "מלאי השיקויים עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

/** Start (or stop) a running potion effect. 0 minutes clears it. */
export async function setPotionEffect(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const kind = potionKindSchema.parse(formData.get("kind")) as PotionKind;
    const minutes = Math.round(optNum(formData, "minutes", 0));
    const expiresAt = inMinutes(minutes);

    if (!expiresAt) {
      await prisma.potionEffect.deleteMany({ where: { empireId, kind } });
    } else {
      await prisma.potionEffect.upsert({
        where: { empireId_kind: { empireId, kind } },
        create: { empireId, kind, expiresAt },
        update: { expiresAt },
      });
    }
    await logAdmin(admin, {
      action: "empire.potion_effect",
      targetType: "empire",
      targetId: empireId,
      summary: expiresAt ? `אפקט ${kind} פעיל ל-${minutes} דקות` : `אפקט ${kind} בוטל`,
    });
    revalidateEmpire(userId);
    return { success: expiresAt ? "האפקט הופעל" : "האפקט בוטל" };
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------- diamond effects / raid shields -------------------- */

const diamondEffectKindSchema = z.enum([
  "RESOURCE_BOOST_GOLD",
  "RESOURCE_BOOST_WOOD",
  "RESOURCE_BOOST_IRON",
  "RESOURCE_BOOST_STONE",
  "SHOP_DISCOUNT",
  "BANK_INTEREST",
  "TURN_PACK_1",
  "TURN_PACK_2",
  "TURN_PACK_3",
  "TURN_PACK_4",
  "SHIELD_RESOURCES",
  "SHIELD_SOLDIERS",
  "CITY_DOWNGRADE",
]);

/**
 * Grant, retune or clear one diamond effect — a production boost, a shop
 * discount, a turn-pack cooldown or a raid shield.
 *
 * `activeUntil` and `readyAt` are the two independent axes the model carries:
 * a buff runs until the first, a cooldown-only spell (bank interest, the turn
 * packs) is usable again at the second. Blank/0 in either means "none", and
 * clearing both deletes the row.
 */
export async function setDiamondEffect(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const kind = diamondEffectKindSchema.parse(formData.get("kind")) as DiamondEffectKind;
    const magnitude = Math.max(0, optNum(formData, "magnitude", 0));
    const activeUntil = inMinutes(Math.round(optNum(formData, "activeMinutes", 0)));
    const readyAt = inMinutes(Math.round(optNum(formData, "cooldownMinutes", 0)));

    if (!activeUntil && !readyAt && magnitude <= 0) {
      await prisma.diamondEffect.deleteMany({ where: { empireId, kind } });
      await logAdmin(admin, {
        action: "empire.diamond_effect_clear",
        targetType: "empire",
        targetId: empireId,
        summary: `אפקט יהלומים ${kind} בוטל`,
      });
      revalidateEmpire(userId);
      return { success: "האפקט בוטל" };
    }

    await prisma.diamondEffect.upsert({
      where: { empireId_kind: { empireId, kind } },
      create: { empireId, kind, magnitude, activeUntil, readyAt },
      update: { magnitude, activeUntil, readyAt },
    });
    await logAdmin(admin, {
      action: "empire.diamond_effect",
      targetType: "empire",
      targetId: empireId,
      summary: `אפקט יהלומים ${kind} (${magnitude}%) עודכן`,
      details: {
        activeUntil: activeUntil?.toISOString() ?? null,
        readyAt: readyAt?.toISOString() ?? null,
      },
    });
    revalidateEmpire(userId);
    return { success: "האפקט עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------- casting on a player's behalf ------------------------- */

/**
 * Route one effect kind to the real cast that produces it.
 *
 * Exhaustive on purpose: a new `DiamondEffectKind` should fail to compile here
 * rather than silently become the one shop item an admin cannot cast.
 */
function castByKind(
  ctx: CastContext,
  empire: { cities: number } & BankInterestEmpire,
  kind: DiamondEffectKind,
  hours: number
): Promise<EffectResult> {
  switch (kind) {
    case "RESOURCE_BOOST_GOLD":
      return castResourceBoost(ctx, "gold");
    case "RESOURCE_BOOST_WOOD":
      return castResourceBoost(ctx, "wood");
    case "RESOURCE_BOOST_IRON":
      return castResourceBoost(ctx, "iron");
    case "RESOURCE_BOOST_STONE":
      return castResourceBoost(ctx, "stone");
    case "SHOP_DISCOUNT":
      return castShopDiscount(ctx);
    case "SHIELD_RESOURCES":
      return castRaidShield(ctx, "resources", hours);
    case "SHIELD_SOLDIERS":
      return castRaidShield(ctx, "soldiers", hours);
    case "TURN_PACK_1":
      return castTurnPackage(ctx, 0);
    case "TURN_PACK_2":
      return castTurnPackage(ctx, 1);
    case "TURN_PACK_3":
      return castTurnPackage(ctx, 2);
    case "TURN_PACK_4":
      return castTurnPackage(ctx, 3);
    case "BANK_INTEREST":
      return castBankInterest(ctx, empire);
    case "CITY_DOWNGRADE":
      return castCityDowngrade(ctx, empire);
  }
}

/**
 * Cast a diamond-shop spell **for** a player: the real effect, free of charge.
 *
 * This is not `setDiamondEffect` with nicer buttons. That one writes the effect
 * row and nothing else, which is right for a buff (the row *is* the buff) and
 * wrong for everything that pays out: casting bank interest moves gold into the
 * bank and writes a ledger row, a turn pack adds turns, the city spell drops a
 * tier. Support work — "his spell fired but he got nothing" — needs the payout,
 * not the row, so this runs the same code the shop runs.
 *
 * The cast ignores the player's cooldown and leaves none behind
 * (`ignoreCooldown`): being stuck behind a clock is the usual reason to ask, and
 * the panel has a separate button for the clock itself. Guards that are
 * legality rather than pacing still hold — the last city is still not for sale.
 */
export async function castDiamondSpell(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const kind = diamondEffectKindSchema.parse(
      formData.get("kind")
    ) as DiamondEffectKind;
    const hours = Math.round(optNum(formData, "hours", 24));

    const result = await prisma.$transaction(async (tx) => {
      await lockEmpire(tx, empireId);
      const empire = await applyPendingUpdates(empireId, tx);
      return castByKind(
        // The control centre stays Hebrew on purpose, so an admin casting on a
        // player's behalf reads the result in the source language rather than
        // whatever the *game* is set to for this admin's own account.
        { tx, empireId, now: new Date(), ignoreCooldown: true, t: makeT(DEFAULT_LOCALE) },
        empire,
        kind,
        hours
      );
    });

    if ("error" in result) return { error: result.error };

    await logAdmin(admin, {
      action: "empire.diamond_spell_cast",
      targetType: "empire",
      targetId: empireId,
      summary: `הוטל ${kind} בשם השחקן`,
      details: { kind, hours, outcome: result.success },
    });
    revalidateEmpire(userId);
    return { success: `הקסם הוטל: ${result.success}` };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Lift the cooldown on one spell so the player can cast it again now.
 *
 * Only `readyAt` is touched — an active buff on the same row (a shield still
 * protecting the empire, a production boost still running) is left standing,
 * because "he can cast again" and "his shield is gone" are opposite requests.
 * A row left with nothing on it at all is deleted rather than kept as an empty
 * clock.
 */
export async function clearDiamondCooldown(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const kind = diamondEffectKindSchema.parse(
      formData.get("kind")
    ) as DiamondEffectKind;

    const existing = await prisma.diamondEffect.findUnique({
      where: { empireId_kind: { empireId, kind } },
    });
    if (!existing?.readyAt) return { error: "אין צינון פעיל לקסם הזה" };

    const stillActive = existing.activeUntil !== null || existing.magnitude > 0;
    if (stillActive) {
      await prisma.diamondEffect.update({
        where: { empireId_kind: { empireId, kind } },
        data: { readyAt: null },
      });
    } else {
      await prisma.diamondEffect.deleteMany({ where: { empireId, kind } });
    }

    await logAdmin(admin, {
      action: "empire.diamond_cooldown_clear",
      targetType: "empire",
      targetId: empireId,
      summary: `צינון ${kind} בוטל`,
      details: { kind, was: existing.readyAt.toISOString() },
    });
    revalidateEmpire(userId);
    return { success: "הצינון בוטל — הקסם זמין מיד" };
  } catch (e) {
    return toErr(e);
  }
}

/** Cancel one diamond effect outright — buff, shield and cooldown together. */
export async function cancelDiamondEffect(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const kind = diamondEffectKindSchema.parse(
      formData.get("kind")
    ) as DiamondEffectKind;

    const { count } = await prisma.diamondEffect.deleteMany({ where: { empireId, kind } });
    if (count === 0) return { error: "אין מה לבטל — הקסם לא פעיל" };

    await logAdmin(admin, {
      action: "empire.diamond_effect_clear",
      targetType: "empire",
      targetId: empireId,
      summary: `אפקט יהלומים ${kind} בוטל`,
    });
    revalidateEmpire(userId);
    return { success: "הקסם בוטל" };
  } catch (e) {
    return toErr(e);
  }
}

const guildSpellSchema = z.enum(["ATTACK", "DEFENSE", "RESOURCES"]);

/** Cast (or extend) a guild spell buff on this empire without a guild. */
export async function grantGuildBuff(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const type = guildSpellSchema.parse(formData.get("type")) as GuildSpellType;
    const bonusPct = Math.max(0, optNum(formData, "bonusPct", 0));
    const hours = Math.max(0, optNum(formData, "hours", 0));
    const expiresAt = inMinutes(hours * 60);
    if (!expiresAt) return { error: "יש להזין משך בשעות" };

    // The buff table is append-only by design (each cast is its own row and
    // readers take the live ones), so replace this type rather than stack it.
    await prisma.$transaction(async (tx) => {
      await tx.guildSpellBuff.deleteMany({ where: { empireId, type } });
      await tx.guildSpellBuff.create({ data: { empireId, type, bonusPct, expiresAt } });
    });
    await logAdmin(admin, {
      action: "empire.guild_buff",
      targetType: "empire",
      targetId: empireId,
      summary: `קסם ברית ${type} ${bonusPct}% ל-${hours} שעות`,
    });
    revalidateEmpire(userId);
    return { success: "הקסם הוענק" };
  } catch (e) {
    return toErr(e);
  }
}

/** Cancel one guild spell on this empire, leaving the other two standing. */
export async function clearGuildBuff(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const type = guildSpellSchema.parse(formData.get("type")) as GuildSpellType;

    const { count } = await prisma.guildSpellBuff.deleteMany({ where: { empireId, type } });
    if (count === 0) return { error: "הקסם לא פעיל" };

    await logAdmin(admin, {
      action: "empire.guild_buff_clear",
      targetType: "empire",
      targetId: empireId,
      summary: `קסם ברית ${type} בוטל`,
    });
    revalidateEmpire(userId);
    return { success: "הקסם בוטל" };
  } catch (e) {
    return toErr(e);
  }
}

/** Strip every guild spell buff from this empire. */
export async function clearGuildBuffs(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const { count } = await prisma.guildSpellBuff.deleteMany({ where: { empireId } });
    await logAdmin(admin, {
      action: "empire.guild_buffs_clear",
      targetType: "empire",
      targetId: empireId,
      summary: `הוסרו ${count} קסמי ברית`,
    });
    revalidateEmpire(userId);
    return { success: `הוסרו ${count} קסמים` };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------- guild membership ------------------------- */

/**
 * Put the empire in a guild (or move it), with a role — an empty guild means
 * "remove". Guild capacity is deliberately not checked: this is the override
 * that fixes a guild the capacity rule has painted into a corner.
 */
export async function setGuildMembership(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const guildId = str(formData, "guildId");
    const role = guildRoleSchema.parse(formData.get("role")) as GuildRole;

    // Which guild this empire is leaving, read before the write so the guild it
    // vacates can be re-seated: pulling a leader out here is the main way a
    // guild ends up headless, and a headless guild cannot appoint its own
    // leader — see server/guildLeadership.ts.
    const previous = await prisma.guildMember.findUnique({
      where: { empireId },
      select: { guildId: true },
    });

    if (!guildId) {
      await prisma.guildMember.deleteMany({ where: { empireId } });
      await repairGuildLeadership(previous?.guildId);
      await logAdmin(admin, {
        action: "empire.guild_remove",
        targetType: "empire",
        targetId: empireId,
        summary: "הוסר מהברית",
      });
      revalidateEmpire(userId);
      return { success: "האימפריה הוסרה מהברית" };
    }

    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { name: true },
    });
    if (!guild) return { error: "הברית לא נמצאה" };

    await prisma.guildMember.upsert({
      where: { empireId },
      create: { empireId, guildId, role },
      update: { guildId, role },
    });
    // Both ends: the guild moved away from may have lost its leader, and the
    // one moved into may have been given a second one (role is unchecked here
    // by design — this is the override). ensureGuildLeader is a no-op whenever
    // a leader is already seated.
    if (previous?.guildId && previous.guildId !== guildId) {
      await repairGuildLeadership(previous.guildId);
    }
    await repairGuildLeadership(guildId);
    await logAdmin(admin, {
      action: "empire.guild_set",
      targetType: "empire",
      targetId: empireId,
      summary: `שויך לברית ${guild.name} בתפקיד ${role}`,
    });
    revalidateEmpire(userId);

    // Not blocked, for the same reason capacity is not: this is the override.
    // But a mixed-city guild is the state server/guildCity.ts exists to prevent,
    // and it will not repair itself — nothing re-tests a roster until somebody
    // moves — so the admin is told they have just created one.
    const guildCity = await guildCityTier(prisma, guildId);
    const target = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { cities: true },
    });
    const mixed =
      guildCity !== null && target != null && target.cities !== guildCity
        ? ` · ⚠️ השחקן בעיר ${target.cities} והברית בעיר ${guildCity} — ברית אמורה לאחד שחקנים מעיר אחת`
        : "";
    return { success: `האימפריה שויכה לברית ${guild.name}${mixed}` };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------------ season pass ------------------------------ */

/** Set the pass track, its XP, and optionally wipe this cycle's claims. */
export async function updateSeasonPass(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const premium = flag(formData, "premium");
    const xp = Math.max(0, Math.min(SEASON_PASS_XP_MAX, Math.round(num(formData, "xp"))));
    const clearClaims = flag(formData, "clearClaims");

    const activeSeason = await prisma.gameSeason.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    const data = {
      premium,
      premiumAt: premium ? new Date() : null,
      xp,
      ...(clearClaims ? { claimedFree: [], claimedPremium: [] } : {}),
    };
    await prisma.seasonPassProgress.upsert({
      where: { empireId },
      create: {
        empireId,
        seasonId: activeSeason?.id ?? null,
        cycleStartedAt: lastDailyUpdate(new Date()),
        ...data,
        claimedFree: [],
        claimedPremium: [],
      },
      update: data,
    });
    await logAdmin(admin, {
      action: "empire.season_pass",
      targetType: "empire",
      targetId: empireId,
      summary: `דרך התהילה: ${premium ? "פרימיום" : "חינם"}, ${xp} XP${clearClaims ? ", האיסופים אופסו" : ""}`,
    });
    revalidateEmpire(userId);
    return { success: "דרך התהילה עודכנה" };
  } catch (e) {
    return toErr(e);
  }
}

/* --------------------- achievements / world records --------------------- */

/**
 * Mark an achievement collected, or take it back.
 *
 * Granting writes the receipt only — it does not pay the prize, so use the
 * gift panel if the player is meant to receive the reward too.
 */
export async function toggleAchievement(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const key = str(formData, "key", 100);
    if (!ACHIEVEMENT_BY_KEY.has(key)) return { error: "הישג לא קיים בקטלוג" };
    const grant = flag(formData, "grant");

    if (grant) {
      await prisma.empireAchievement.upsert({
        where: { empireId_key: { empireId, key } },
        create: { empireId, key },
        update: {},
      });
    } else {
      await prisma.empireAchievement.deleteMany({ where: { empireId, key } });
    }
    await logAdmin(admin, {
      action: grant ? "empire.achievement_grant" : "empire.achievement_revoke",
      targetType: "empire",
      targetId: empireId,
      summary: `${grant ? "הוענק" : "בוטל"} הישג ${key}`,
    });
    revalidateEmpire(userId);
    return { success: grant ? "ההישג סומן כנאסף" : "ההישג בוטל" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Stamp (or remove) a world-record decoration for this empire.
 *
 * A grant that lands this empire at the *head* of the key — no earlier stamp
 * exists — hands over the record's purse as well (GLORY_PRIZE), paid on the
 * player's next base-screen load. That is the intended reading of "grant a world
 * record", and the audit row below is what makes it accountable; it is not a
 * silent side effect to be surprised by. Revoking does not claw the purse back.
 */
export async function toggleGloryAward(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const key = str(formData, "key", 100);
    if (!GLORY_KEYS.includes(key)) return { error: "שיא לא קיים" };
    const grant = flag(formData, "grant");

    if (grant) {
      await prisma.empireGloryAward.upsert({
        where: { empireId_key: { empireId, key } },
        create: { empireId, key },
        update: {},
      });
    } else {
      await prisma.empireGloryAward.deleteMany({ where: { empireId, key } });
    }
    await logAdmin(admin, {
      action: grant ? "empire.glory_grant" : "empire.glory_revoke",
      targetType: "empire",
      targetId: empireId,
      summary: `${grant ? "הוענק" : "בוטל"} שיא ${key}`,
    });
    revalidateEmpire(userId);
    return { success: grant ? "השיא הוענק" : "השיא בוטל" };
  } catch (e) {
    return toErr(e);
  }
}

/* --------------------------- inbox / history --------------------------- */

/** Delete a single message from a player's inbox. */
export async function deletePlayerMessage(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const messageId = str(formData, "messageId");
    const userId = str(formData, "userId");
    // The message id is the real subject — resolve the owner from it rather
    // than trusting the userId the form carries for revalidation.
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { empireId: true },
    });
    await assertTargetEditable(admin, { userId, empireId: message?.empireId });
    if (!message) return { error: "ההודעה לא נמצאה" };

    await prisma.message.delete({ where: { id: messageId } });
    await logAdmin(admin, {
      action: "empire.message_delete",
      targetType: "message",
      targetId: messageId,
      summary: "הודעה נמחקה מתיבת השחקן",
    });
    revalidateEmpire(userId);
    return { success: "ההודעה נמחקה" };
  } catch (e) {
    return toErr(e);
  }
}

/** Bulk inbox operations: mark everything read, or empty the inbox. */
export async function manageInbox(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const op = z.enum(["read_all", "clear"]).parse(formData.get("op"));

    const count =
      op === "clear"
        ? (await prisma.message.deleteMany({ where: { empireId } })).count
        : (
            await prisma.message.updateMany({
              where: { empireId, readAt: null },
              data: { readAt: new Date() },
            })
          ).count;
    await logAdmin(admin, {
      action: op === "clear" ? "empire.inbox_clear" : "empire.inbox_read_all",
      targetType: "empire",
      targetId: empireId,
      summary: op === "clear" ? `נמחקו ${count} הודעות` : `${count} הודעות סומנו כנקראו`,
    });
    revalidateEmpire(userId);
    return {
      success: op === "clear" ? `נמחקו ${count} הודעות` : `${count} הודעות סומנו כנקראו`,
    };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Erase this empire's history: battle reports, spy reports or boss fights.
 *
 * Reports are two-sided, so both directions go — a report the admin left on the
 * other side would still show the deleted history from the opponent's screen.
 * Achievements read these tables, so wiping them lowers derived progress.
 */
export async function clearEmpireHistory(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId });
    const what = z.enum(["battle", "spy", "boss", "all"]).parse(formData.get("what"));

    let count = 0;
    if (what === "battle" || what === "all") {
      count += (
        await prisma.battleReport.deleteMany({
          where: {
            OR: [{ attackerEmpireId: empireId }, { defenderEmpireId: empireId }],
          },
        })
      ).count;
    }
    if (what === "spy" || what === "all") {
      count += (
        await prisma.spyReport.deleteMany({
          where: {
            OR: [{ attackerEmpireId: empireId }, { defenderEmpireId: empireId }],
          },
        })
      ).count;
    }
    if (what === "boss" || what === "all") {
      count += (await prisma.bossFight.deleteMany({ where: { empireId } })).count;
      // Reports first, then the battles they came out of: BossFight.battleId is
      // ON DELETE SET NULL, so a surviving report would keep a battle row alive
      // that no longer has a report to belong to. Dropping the battles also
      // clears an open sortie — clearing a player's boss history and leaving them
      // mid-fight against a fight with no record would be the stranger outcome.
      count += (await prisma.bossBattle.deleteMany({ where: { empireId } })).count;
      // The siege itself is the *city's*, not this player's, and must survive:
      // erasing it would revive the tyrant for everyone at full health because
      // one player's history was cleared. What does go is this player's line on
      // its contribution board — which is also what takes them out of the next
      // kill purse, since the purse is shared out over exactly these rows.
      count += (await prisma.bossSiegeStrike.deleteMany({ where: { empireId } })).count;
    }
    await logAdmin(admin, {
      action: "empire.history_clear",
      targetType: "empire",
      targetId: empireId,
      summary: `נמחקו ${count} רשומות היסטוריה (${what})`,
    });
    revalidateEmpire(userId);
    return { success: `נמחקו ${count} רשומות` };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                    MESSAGES / BROADCAST                       */
/* ============================================================= */

/** Send a direct system message to a single empire. */
export async function sendMessageToEmpire(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    const userId = str(formData, "userId");
    await assertTargetEditable(admin, { userId, empireId: str(formData, "empireId") });
    const title = str(formData, "title", 200);
    const body = str(formData, "body", 4000);
    const href = optHref(formData, "href");
    if (!title || !body) return { error: "יש למלא כותרת ותוכן" };

    await prisma.message.create({
      data: { empireId, kind: "SYSTEM", title, body, href },
    });
    await logAdmin(admin, {
      action: "message.direct",
      targetType: "empire",
      targetId: empireId,
      summary: `הודעה נשלחה: ${title}`,
    });
    revalidateEmpire(userId);
    return { success: "ההודעה נשלחה" };
  } catch (e) {
    return toErr(e);
  }
}

const kindSchema = z.enum(["ANNOUNCEMENT", "SYSTEM", "BATTLE", "SPY"]);
const channelSchema = z.enum(["events", "updates"]);

/** Broadcast a message to a target audience (all / season / guild / empire). */
export async function broadcastMessage(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const scope = str(formData, "scope") || "all";
    const scopeId = str(formData, "scopeId");
    const title = str(formData, "title", 200);
    const body = str(formData, "body", 4000);
    const href = optHref(formData, "href");
    // ANNOUNCEMENT by default, and that default is the feature: a broadcast is
    // typed by hand precisely when something has to *reach* people — a bug
    // fixed, a rule changed, a feature opened — and an announcement is the one
    // kind the game stops the player to show (see AnnouncementDialog). The
    // quieter kinds stay available for a notice that only needs to be on record.
    const kind = (kindSchema.safeParse(formData.get("kind")).data ??
      "ANNOUNCEMENT") as MessageKind;
    // Which Discord room the mirror lands in. A broadcast is free text and can
    // be either thing — "the new hero shop is live" belongs with the updates,
    // "the boss is up for an hour" with the events — so the admin picks, and
    // the default is the one they type more often.
    const channel = channelSchema.safeParse(formData.get("discordChannel")).data ?? "updates";
    if (!title || !body) return { error: "יש למלא כותרת ותוכן" };

    const empireIds = await resolveTargetEmpireIds(scope, scopeId);
    if (empireIds.length === 0) return { error: "אין נמענים בקבוצה שנבחרה" };

    for (const batch of chunk(empireIds, BULK_BATCH_SIZE)) {
      await prisma.message.createMany({
        data: batch.map((empireId) => ({ empireId, kind, title, body, href })),
      });
    }
    await logAdmin(admin, {
      action: "message.broadcast",
      targetType: "broadcast",
      targetId: scopeAuditId(scope, scopeId),
      summary: `שידור "${title}" ל-${empireIds.length} אימפריות`,
      details: { scope, scopeId, count: empireIds.length },
    });
    revalidatePath("/game", "layout");

    // Mirrored to the community channel — every game-wide broadcast, whatever
    // it says. A message aimed at one season, one guild or one player is not
    // public, and reposting it to a room its target may not even be in would
    // leak who was told what; see `isGameWideScope`.
    // Awaited (it is bounded and rare) and unable to fail the send: the players
    // already have the message; Discord is a second copy, not the delivery.
    //
    // Word for word what the inbox got — no channel voice, no added prefix, no
    // footnote about who it went to. The Discord post exists because it pushes
    // a phone notification and the in-game inbox does not; a player who reads
    // one and then the other must not be able to tell them apart.
    let posted = false;
    if (isGameWideScope(scope)) {
      posted = await announceToDiscord({
        kind: "announcement",
        channel,
        title,
        body,
        url: gameLink("/game/messages"),
      });
    }
    return {
      success:
        `ההודעה נשלחה ל-${empireIds.length} אימפריות` +
        (posted ? " ופורסמה בדיסקורד" : ""),
    };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                        GIFTS / PRIZES                         */
/* ============================================================= */

/**
 * Grant a resource/diamond bundle (and an optional accompanying message) to a
 * target audience. Amounts are added to the current balances.
 */
export async function sendGift(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const scope = str(formData, "scope") || "all";
    const scopeId = str(formData, "scopeId");

    const bundle = {
      gold: Math.max(0, optNum(formData, "gold")),
      wood: Math.max(0, optNum(formData, "wood")),
      iron: Math.max(0, optNum(formData, "iron")),
      stone: Math.max(0, optNum(formData, "stone")),
      diamonds: Math.max(0, optNum(formData, "diamonds")),
      citizens: Math.max(0, intOptNum(formData, "citizens")),
      turns: Math.max(0, intOptNum(formData, "turns")),
      wheelSpins: Math.max(0, intOptNum(formData, "wheelSpins")),
    };
    const anyResource = Object.values(bundle).some((v) => v > 0);
    const title = str(formData, "title", 200);
    const body = str(formData, "body", 4000);
    if (!anyResource && !title) {
      return { error: "יש להזין לפחות משאב אחד או הודעה" };
    }

    const empireIds = await resolveTargetEmpireIds(scope, scopeId);
    if (empireIds.length === 0) return { error: "אין נמענים בקבוצה שנבחרה" };

    const increments: Prisma.EmpireUpdateManyMutationInput = {};
    if (bundle.gold) increments.gold = { increment: bundle.gold };
    if (bundle.wood) increments.wood = { increment: bundle.wood };
    if (bundle.iron) increments.iron = { increment: bundle.iron };
    if (bundle.stone) increments.stone = { increment: bundle.stone };
    if (bundle.diamonds) increments.diamonds = { increment: bundle.diamonds };
    const anyFloat = Object.keys(increments).length > 0;
    // citizens/turns/wheelSpins are int4: a plain increment that lands past
    // int4's max aborts the whole gift with an out-of-range error, so those
    // three saturate at the ceiling instead (see saturatingIncrement).
    const intGifts: EmpireIntField[] = (
      ["citizens", "turns", "wheelSpins"] as const
    ).filter((field) => bundle[field] > 0);

    await prisma.$transaction(async (tx) => {
      for (const batch of chunk(empireIds, BULK_BATCH_SIZE)) {
        if (anyFloat) {
          await tx.empire.updateMany({ where: { id: { in: batch } }, data: increments });
        }
        for (const field of intGifts) {
          await saturatingIncrement(tx, batch, field, bundle[field]);
        }
        if (title) {
          await tx.message.createMany({
            data: batch.map((empireId) => ({
              empireId,
              kind: "SYSTEM" as const,
              title,
              body: body || GIFT_DEFAULTS.body,
            })),
          });
        }
      }
    });
    await logAdmin(admin, {
      action: "gift.send",
      targetType: "gift",
      targetId: scopeAuditId(scope, scopeId),
      summary: `מתנה נשלחה ל-${empireIds.length} אימפריות`,
      details: { scope, scopeId, bundle, count: empireIds.length },
    });
    revalidatePath("/game", "layout");

    // A gift to the whole game is announced for the same reason a broadcast is:
    // it is news, and the only other way a player learns about it is by
    // happening to open the game and notice a fuller treasury. Same rule on who
    // hears it (game-wide audiences only — a guild's prize is that guild's
    // business), same defensiveness: outside the transaction, after the
    // revalidate, and unable to fail a gift that has already been credited.
    //
    // The post is the accompanying message verbatim — same title, same body,
    // same fallback the inbox copy used. So it is conditioned on there *being*
    // one: a silent gift (no title, hence no inbox message) stays silent in the
    // channel too, rather than the channel announcing something no player was
    // told about.
    let posted = false;
    if (isGameWideScope(scope) && title) {
      posted = await announceToDiscord({
        kind: "announcement",
        // The events room, not the updates one: a gift landing in every
        // treasury is something that happened in the game today, not news
        // about what was built.
        channel: "events",
        title,
        body: body || GIFT_DEFAULTS.body,
        url: gameLink("/game/base"),
      });
    }
    return {
      success:
        `המתנה נשלחה ל-${empireIds.length} אימפריות` +
        (posted ? " ופורסמה בדיסקורד" : ""),
    };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                          SEASONS                             */
/* ============================================================= */

/**
 * Read an **absolute** instant out of the form.
 *
 * The zone suffix is mandatory, and that is the whole point: a bare
 * "YYYY-MM-DDTHH:mm" — what a raw `datetime-local` input posts — means the
 * admin's timezone to the browser and the server's (UTC in production) to
 * `new Date()`, a silent three-hour slip on every season boundary. The season
 * form (`SeasonSchedule`) converts the picked wall-clock time to ISO in the
 * browser, so anything arriving without an offset is a stale or hand-rolled
 * submission and is rejected rather than guessed at.
 */
function parseDate(formData: FormData, key: string): Date {
  const raw = str(formData, key);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AdminError(`תאריך לא תקין בשדה ${key}`);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    throw new AdminError(`תאריך ללא אזור זמן בשדה ${key}`);
  }
  return d;
}

/**
 * The season cycle's own settings: how long the break is, how long the next
 * season runs, and whether the whole thing turns by itself at all.
 *
 * These four live in the global tunables (`season` in lib/game/config.ts) like
 * every other number an admin can move, and they are therefore also editable on
 * /admin/balance. They get a second home here because this is where an admin
 * thinks about them — reading "24 שעות הפסקה" next to the season that is
 * running is the difference between a setting and a schedule.
 *
 * Writes only its own group. The overlay is merged onto the tunables as they
 * are right now, so saving the break length can never quietly restore some
 * other page's field to its default.
 *
 * The break arrives as a free number plus a unit (`breakValue` + `breakUnit`)
 * and is stored in hours — see `breakToHours`. The raw `season.breakHours`
 * field is still accepted, because /admin/balance renders every tunable
 * generically and posts exactly that.
 */
export async function saveSeasonCycle(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const current = await getTunables();
    const season: Record<string, number> = { ...current.season };
    for (const field of Object.keys(DEFAULT_TUNABLES.season)) {
      const raw = formData.get(`season.${field}`);
      const n = Number(raw);
      if (raw != null && raw !== "" && Number.isFinite(n)) season[field] = n;
    }

    // The break, as it was actually typed. Takes precedence over any
    // `breakHours` above: this panel posts the pair, and a stale hidden field
    // must not win over the number the admin is looking at.
    const breakRaw = formData.get("season.breakValue");
    const breakUnit = formData.get("season.breakUnit");
    const breakValue = Number(breakRaw);
    if (breakRaw != null && breakRaw !== "" && Number.isFinite(breakValue)) {
      if (!isBreakUnit(breakUnit)) return { error: "יחידת זמן לא תקינה להפסקה" };
      season.breakHours = breakToHours(breakValue, breakUnit);
    }
    // mergeTunables re-clamps every group to its bounds, so an out-of-range
    // break length arrives as the nearest legal one rather than as a game that
    // never reopens.
    const merged = mergeTunables({ ...current, season });
    await prisma.gameConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", data: merged as unknown as Prisma.InputJsonValue },
      update: { data: merged as unknown as Prisma.InputJsonValue },
    });
    await logAdmin(admin, {
      action: "config.season",
      targetType: "config",
      summary: `מחזור העונות עודכן — הפסקה ${formatBreak(merged.season.breakHours)}, עונה ${merged.season.lengthDays} ימים`,
      details: merged.season as unknown as Prisma.InputJsonValue,
    });
    revalidatePath("/admin/seasons");
    revalidatePath("/admin/balance");
    // Says what was *stored*, not what was typed. The bounds in
    // lib/game/config.ts clamp silently, and an admin who asked for a ten-year
    // break has to see that they got one year rather than discover it later.
    return {
      success: `נשמר — הפסקה של ${formatBreak(merged.season.breakHours)}, ואז עונה של ${merged.season.lengthDays} ימים`,
    };
  } catch (e) {
    return toErr(e);
  }
}

export async function createSeason(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const name = str(formData, "name");
    if (name.length < 2) return { error: "שם עונה קצר מדי" };
    const startsAt = parseDate(formData, "startsAt");
    const endsAt = parseDate(formData, "endsAt");
    if (endsAt <= startsAt) return { error: "תאריך הסיום חייב להיות אחרי ההתחלה" };

    const season = await prisma.gameSeason.create({ data: { name, startsAt, endsAt } });
    await logAdmin(admin, {
      action: "season.create",
      targetType: "season",
      targetId: season.id,
      summary: `נוצרה עונה ${name}`,
    });
    revalidatePath("/admin/seasons");
    return { success: "העונה נוצרה" };
  } catch (e) {
    return toErr(e);
  }
}

export async function updateSeason(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const name = str(formData, "name");
    if (name.length < 2) return { error: "שם עונה קצר מדי" };
    const startsAt = parseDate(formData, "startsAt");
    const endsAt = parseDate(formData, "endsAt");
    if (endsAt <= startsAt) return { error: "תאריך הסיום חייב להיות אחרי ההתחלה" };

    await prisma.gameSeason.update({ where: { id }, data: { name, startsAt, endsAt } });
    await logAdmin(admin, {
      action: "season.update",
      targetType: "season",
      targetId: id,
      summary: `עודכנה עונה ${name}`,
    });
    revalidatePath("/admin/seasons");
    return { success: "העונה עודכנה" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Make a season the live one — and end whatever season was live before it.
 *
 * Activating is a season *transition*, not a flag flip. The outgoing season is
 * treated exactly as if its clock had just run out: its `endsAt` is pulled back
 * to now and `closeSeason` archives its podium and recap into היכל התהילה,
 * before the new season takes over. Without that it would merely stop being
 * active — never closed, never archived, its champions gone for good, because
 * `getSeasonGate` only ever looks at the row flagged active.
 *
 * Every empire is re-homed onto the new season too, so `Empire.seasonId` (which
 * drives broadcast/ban targeting and the counts on the seasons page) names the
 * season players are actually playing. **Progress is untouched** — wiping the
 * world stays the separate, confirmed `resetSeason`. The season passes reset
 * themselves: `loadCycle` clears premium and the ladder the first time it sees
 * a different active season.
 */
export async function activateSeason(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const now = new Date();

    const target = await prisma.gameSeason.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true, endsAt: true, closedAt: true },
    });
    if (!target) return { error: "העונה לא נמצאה" };
    if (target.isActive) return { error: "העונה כבר פעילה" };
    if (target.closedAt) return { error: "העונה כבר נסגרה — צור עונה חדשה במקומה" };
    // A season whose clock has already run out would be sealed by the gate on
    // the very next page load, locking every player out of the game — the exact
    // opposite of what pressing "הפעל עונה" means.
    if (target.endsAt <= now) {
      return { error: "מועד הסיום של העונה כבר עבר — עדכן את התאריכים לפני ההפעלה" };
    }

    const outgoing = await prisma.gameSeason.findFirst({
      where: { isActive: true, id: { not: id } },
      select: { id: true, name: true, endsAt: true, closedAt: true },
    });

    // Last chance to archive: the moment the flag moves, nothing looks at this
    // season again. Truncating `endsAt` first keeps the record honest — the
    // champions are stamped with the moment the season really ended, and the
    // hall (ordered by `seasonEndsAt`) lists it in the right place.
    if (outgoing && !outgoing.closedAt) {
      if (outgoing.endsAt > now) {
        await prisma.gameSeason.update({
          where: { id: outgoing.id },
          data: { endsAt: now },
        });
      }
      // No successor is booked for it: the admin is standing right here naming
      // the successor. Letting the close schedule its own would leave a second,
      // auto-created season in the list that nobody asked for and nothing opens.
      await closeSeason(outgoing.id, now, { scheduleNext: false });
    }

    // One transaction, so the game is never left with the old season closed and
    // no new one open — that gap is a locked game for every player in it.
    const empires = await prisma.$transaction(async (tx) => {
      await tx.gameSeason.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.gameSeason.update({ where: { id }, data: { isActive: true } });
      // Unconditional: `updatedAt` on an empire moves on every write anyway
      // (presence lives in `lastSeenAt`), so filtering to the rows that differ
      // buys nothing but a nullable-column edge case.
      const moved = await tx.empire.updateMany({ data: { seasonId: id } });
      return moved.count;
    });

    await logAdmin(admin, {
      action: "season.activate",
      targetType: "season",
      targetId: id,
      summary: outgoing
        ? `עונה ${target.name} הופעלה, ${outgoing.name} נסגרה`
        : `עונה ${target.name} הופעלה`,
      details: { empiresMoved: empires, closedSeasonId: outgoing?.id ?? null },
    });
    revalidatePath("/admin/seasons");
    revalidatePath("/game", "layout");

    // The channel hears about the transition in the order it happened: the
    // outgoing season's podium was posted by `closeSeason` above, and this is
    // the new one opening. After the commit and after the revalidate, so a
    // Discord outage cannot fail an activation that has already happened —
    // the same rule every other announcement in this file follows.
    await announceSeasonStart(target);
    return {
      success: outgoing
        ? `העונה הופעלה. ${outgoing.name} נסגרה והדירוג שלה נשמר בהיכל התהילה — ${empires} אימפריות עברו לעונה החדשה`
        : `העונה הופעלה — ${empires} אימפריות שויכו אליה`,
    };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Cut an active season short — move its end forward, nothing else.
 *
 * Separate from `updateSeason` (which edits both dates freely) because ending a
 * season early is the one schedule change with an immediate, irreversible
 * effect: the moment `endsAt` is in the past, the gate archives the standings
 * and shuts the game until the next season opens. That close is run here rather
 * than left to whichever page load happens to cross the boundary, so the admin
 * sees the result of their own click instead of a silent time bomb.
 *
 * Only ever earlier. Extending a season is `updateSeason` — the confirmation on
 * this form promises a shorter season, so it must not be able to grant a longer one.
 */
export async function shortenSeason(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const endsAt = parseDate(formData, "endsAt");
    const now = new Date();

    const season = await prisma.gameSeason.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
        closedAt: true,
      },
    });
    if (!season) return { error: "העונה לא נמצאה" };
    if (season.closedAt) return { error: "העונה כבר נסגרה" };
    if (endsAt >= season.endsAt) {
      return { error: "המועד החדש חייב להיות מוקדם מהסיום הנוכחי — להארכה, ערוך את התאריכים למעלה" };
    }
    if (endsAt <= season.startsAt) {
      return { error: "הסיום חייב להיות אחרי תחילת העונה" };
    }

    await prisma.gameSeason.update({ where: { id }, data: { endsAt } });

    // Already in the past: this click *is* the end of the season.
    const closed = season.isActive && endsAt <= now ? await closeSeason(id, now) : false;

    await logAdmin(admin, {
      action: "season.shorten",
      targetType: "season",
      targetId: id,
      summary: closed
        ? `עונה ${season.name} קוצרה ונסגרה`
        : `עונה ${season.name} קוצרה`,
      details: { endsAt: endsAt.toISOString(), closed },
    });
    revalidatePath("/admin/seasons");
    revalidatePath("/game", "layout");
    return {
      success: closed
        ? "העונה הסתיימה — הדירוג נשמר בהיכל התהילה, והמשחק נעול עד תחילת העונה הבאה"
        : "מועד הסיום עודכן",
    };
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteSeason(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    // Offered before every destructive season action: the standings are derived
    // from live empires, and once the season is gone there is nothing left to
    // derive them from. Defaults to "no" — an admin deleting a mis-typed season
    // they created a minute ago should not have it enshrined in the hall.
    const archive = str(formData, "archive") === "1";
    const archived = archive ? await archiveSeasonStandings(id) : 0;

    await prisma.gameSeason.delete({ where: { id } });
    await logAdmin(admin, {
      action: "season.delete",
      targetType: "season",
      targetId: id,
      summary: archived > 0 ? "עונה נמחקה (הדירוג נשמר)" : "עונה נמחקה",
      details: { archivedChampions: archived },
    });
    revalidatePath("/admin/seasons");
    revalidatePath("/game/rankings");
    return {
      success: archived > 0 ? "העונה נמחקה והדירוג נשמר בהיכל התהילה" : "העונה נמחקה",
    };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Nuke-and-reboot the whole game — a full season reset. EVERY empire is deleted
 * and recreated from scratch (fresh buildings, army, upgrades, storages,
 * weapons, hero and bank — identical to a brand-new registration), and ALL
 * guilds are wiped. What survives:
 *   • user accounts, roles and bans (User rows are untouched)
 *   • each player's current DIAMOND balance — carried over so paying customers
 *     never lose what they bought
 *   • the real-money purchase audit trail (DiamondPurchase → onDelete: SetNull,
 *     with userId/email/empireName snapshots)
 * Every other empire record cascades away with the empire it belonged to.
 *
 * This is irreversible and hits all players, so it fires only when the admin
 * types the confirmation phrase. The whole wipe-and-rebuild runs in one
 * transaction: it either resets everyone or no one — never half the players.
 */
export async function resetSeason(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    if (str(formData, "confirm") !== "אפס") {
      return { error: 'כדי לאפס, הקלד "אפס" בשדה האישור' };
    }

    const tunables = await getTunables();
    // The game runs a single active season for everyone; a reset re-homes every
    // rebuilt empire onto it (matching what fresh registrations get), rather
    // than preserving each empire's stale prior seasonId.
    const activeSeason = await prisma.gameSeason.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    // The final standings are a pure function of the empires this transaction
    // is about to delete, so if they are to be kept they must be read *first*.
    // Deliberately does not close the season: the world restarts inside the
    // same season and play continues — sealing it would lock every player out
    // of the game as a side effect of a reset button.
    const archived =
      str(formData, "archive") === "1" && activeSeason
        ? await archiveSeasonStandings(activeSeason.id)
        : 0;

    // The same rebuild the automatic season opening runs (server/seasonRestart.ts)
    // — one implementation, so the button and the clock can never produce two
    // different kinds of fresh world.
    const { empiresRebuilt, botsRemoved } = await prisma.$transaction(
      (tx) => restartWorld(tx, activeSeason?.id, tunables),
      { timeout: 120_000 }
    );

    // The same opening field the automatic season opening plants, for the same
    // reason: the reset just emptied the first city's ladder of everything but
    // the players themselves, and this is the button that does it by hand. It
    // runs after the wipe has committed and cannot undo it — a reset that
    // succeeded must not report failure because a garrison would not plant.
    let botsPlanted = 0;
    try {
      botsPlanted = (await ensureCityBots(BOT_SEED_CITY, tunables.season.openBots)).created;
    } catch (e) {
      console.error("[admin] failed to plant the opening field", e);
    }

    await logAdmin(admin, {
      action: "season.reset",
      targetType: "season",
      summary: `אופסה העונה — ${empiresRebuilt} אימפריות אותחלו, כל הגילדות נמחקו${
        botsRemoved > 0 ? `, ${botsRemoved} בוטים הוסרו` : ""
      }${botsPlanted > 0 ? `, ${botsPlanted} בוטים נשתלו בעיר הראשונה` : ""}${
        archived > 0 ? " (הדירוג נשמר)" : ""
      }`,
      details: {
        empiresReset: empiresRebuilt,
        botsRemoved,
        botsPlanted,
        archivedChampions: archived,
      },
    });

    revalidatePath("/admin/seasons");
    revalidatePath("/admin/bots");
    revalidatePath("/game", "layout");
    return {
      success:
        `העונה אופסה — ${empiresRebuilt} שחקנים התחילו מחדש` +
        (botsRemoved > 0 ? `, ${botsRemoved} בוטים הוסרו` : "") +
        (botsPlanted > 0 ? `, ${botsPlanted} בוטים חדשים נשתלו בעיר הראשונה` : "") +
        (archived > 0 ? ", והדירוג הסופי נשמר בהיכל התהילה" : ""),
    };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                           GUILDS                             */
/* ============================================================= */

export async function updateGuild(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const name = str(formData, "name");
    if (name.length < 2) return { error: "שם ברית קצר מדי" };
    const capacityLevel = Math.min(
      GUILD_CAPACITY_MAX_LEVEL,
      Math.max(1, Math.round(num(formData, "capacityLevel")))
    );
    const aidLevel = Math.min(
      GUILD_AID_MAX_LEVEL,
      Math.max(0, Math.round(num(formData, "aidLevel")))
    );

    const clash = await prisma.guild.findFirst({
      where: { name, NOT: { id } },
      select: { id: true },
    });
    if (clash) return { error: "שם הברית כבר תפוס" };

    await prisma.guild.update({
      where: { id },
      data: { name, capacityLevel, aidLevel },
    });
    await logAdmin(admin, {
      action: "guild.update",
      targetType: "guild",
      targetId: id,
      summary: `עודכנה ברית ${name}`,
    });
    revalidatePath("/admin/guilds");
    return { success: "הברית עודכנה" };
  } catch (e) {
    return toErr(e);
  }
}

const guildRoleSchema = z.enum(["LEADER", "DEPUTY", "MEMBER"]);

/** Set a guild member's role. */
export async function setGuildMemberRole(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const memberId = str(formData, "memberId");
    const role = guildRoleSchema.parse(formData.get("role")) as GuildRole;
    const member = await prisma.guildMember.update({
      where: { id: memberId },
      data: { role },
    });
    // Demoting the leader leaves the crown vacant, and no member of a headless
    // guild can fill it from the game screen.
    await repairGuildLeadership(member.guildId);
    await logAdmin(admin, {
      action: "guild.member_role",
      targetType: "guildMember",
      targetId: memberId,
      summary: `תפקיד חבר ברית → ${role}`,
    });
    revalidatePath("/admin/guilds");
    return { success: "תפקיד החבר עודכן" };
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteGuild(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    await prisma.guild.delete({ where: { id } });
    await logAdmin(admin, {
      action: "guild.delete",
      targetType: "guild",
      targetId: id,
      summary: "ברית פורקה",
    });
    revalidatePath("/admin/guilds");
    return { success: "הברית פורקה" };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                        GUILD WAR                              */
/* ============================================================= */

/** Revalidate everything a war row is visible through. */
function revalidateWarScreens() {
  revalidatePath("/admin/war");
  // The arena, plus the "war is on" badge the game layout renders from a live
  // war row.
  revalidatePath("/game", "layout");
}

/**
 * Call off a war that has not been decided — the campaign running right now, or
 * the next bell still taking enrolments — by deleting it outright.
 *
 * Deleting rather than flipping the status to CANCELLED is the point. That
 * status is the *game's* verdict on a night too few guilds turned up for, and
 * the board keeps showing it for three hours so the lone guild understands why
 * it was paid nothing. An admin calling a war off has nothing to explain on the
 * board — the enrolled guilds are told by message, here — while a surviving row
 * is a row the screen keeps showing and the lazy clock keeps picking up.
 *
 * Nothing is clawed back because nothing was paid: ranks and prizes are only
 * written at settlement, which by definition has not run for a SCHEDULED war.
 */
export async function cancelGuildWar(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");

    const war = await prisma.guildWar.findUnique({
      where: { id },
      select: {
        startsAt: true,
        status: true,
        entries: { select: { guildId: true } },
      },
    });
    if (!war) return { error: "המלחמה לא נמצאה" };
    if (war.status !== "SCHEDULED") {
      return { error: "המלחמה כבר הוכרעה — אפשר רק למחוק אותה" };
    }

    // The guilds' *current* rosters, not the enrolled ones: this is a notice,
    // not a payout, and whoever is in the guild now is who turns up to find the
    // arena empty tonight.
    const guildIds = war.entries.map((entry) => entry.guildId);
    const members =
      guildIds.length > 0
        ? await prisma.guildMember.findMany({
            where: { guildId: { in: guildIds } },
            select: { empireId: true },
          })
        : [];

    const when = formatGameDateTime(war.startsAt);

    await prisma.$transaction(
      async (tx) => {
        if (members.length > 0) {
          await tx.message.createMany({
            data: members.map((member) => ({
              empireId: member.empireId,
              kind: "SYSTEM" as const,
              title: "🏳️ מלחמת הבריתות בוטלה",
              body: `המלחמה שנקבעה ל-${when} בוטלה על ידי הנהלת המשחק. ההרשמה נמחקה ולא חולקו פרסים — אפשר להירשם מחדש למלחמה הבאה.`,
              href: "/game/war",
            })),
          });
        }
        // Entries and clashes cascade on warId. If a catch-up is mid-flight
        // this waits on the row lock advanceWar holds, and a catch-up that
        // starts after the delete simply finds no war and stops.
        await tx.guildWar.delete({ where: { id } });
      },
      { timeout: 20_000, maxWait: 10_000 }
    );

    await logAdmin(admin, {
      action: "guildwar.cancel",
      targetType: "guildWar",
      targetId: id,
      summary: `מלחמת בריתות ${when} בוטלה (${guildIds.length} בריתות)`,
    });
    revalidateWarScreens();
    return {
      success: `המלחמה בוטלה ונמחקה. ${
        members.length > 0 ? `${members.length} שחקנים קיבלו הודעה.` : "לא הייתה אף הרשמה."
      }`,
    };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Delete a war row and everything hanging off it, silently. For clearing out
 * decided wars — the history nobody reads — where a cancellation notice would
 * be nonsense.
 */
export async function deleteGuildWar(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    // deleteMany, so a war already swept away by the lazy purge (or by another
    // admin) reads as "gone" rather than a P2025 the client sees as an error.
    const { count } = await prisma.guildWar.deleteMany({ where: { id } });
    if (count === 0) return { error: "המלחמה לא נמצאה" };

    await logAdmin(admin, {
      action: "guildwar.delete",
      targetType: "guildWar",
      targetId: id,
      summary: "מלחמת בריתות נמחקה",
    });
    revalidateWarScreens();
    return { success: "המלחמה נמחקה" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Wipe every decided war at once. The same housekeeping `purgeOldWars` does on
 * the clock, without waiting for the results window to run out.
 */
export async function purgeFinishedWars(
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const { count } = await prisma.guildWar.deleteMany({
      where: { status: { in: ["SETTLED", "CANCELLED"] } },
    });
    if (count === 0) return { success: "אין מלחמות שהסתיימו למחיקה" };

    await logAdmin(admin, {
      action: "guildwar.purge",
      targetType: "guildWar",
      summary: `נמחקו ${count} מלחמות שהסתיימו`,
    });
    revalidateWarScreens();
    return { success: `${count} מלחמות שהסתיימו נמחקו` };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                       GLOBAL BALANCE                          */
/* ============================================================= */

/**
 * Tell the whole game a diamond sale just opened — inbox and Discord, off the
 * same save that opened it.
 *
 * A discount is a tunable like any other, which means releasing one used to be
 * two jobs: set the percentage, then go and type the same news into the
 * broadcast form and hope the wording matched. The second job is the one that
 * gets skipped or fumbled, and a sale nobody was told about is a price cut given
 * away for nothing. So the release *is* the announcement: whoever moves the
 * number cannot forget to say so, and cannot say it differently twice.
 *
 * `isDiscountRelease` decides whether this is news at all — the balance panel
 * submits every tunable on every save, so silence on an unchanged (or lowered)
 * discount is what keeps this from firing on unrelated edits.
 *
 * The loud kind, deliberately: a sale runs until the admin ends it and a player
 * who finds out afterwards never had the offer. That is the same test Happy Hour
 * and the mini-games pass, and the reason the quieter kinds exist for everything
 * that will still be true tomorrow.
 *
 * Never fails the save. The tunables are already committed by the time this
 * runs — the players are being charged the new price whether or not a webhook
 * answers — so every failure is logged and swallowed, exactly as the other
 * announcement tails do.
 *
 * @returns how many inboxes it reached, or null if this save was not a release.
 *   Not a headcount anybody branches on — it is what the audit line records and
 *   what the admin is told, so a sale released into an empty world still reads
 *   as sent rather than as failed.
 */
async function heraldDiamondSale(
  prevPct: number,
  nextPct: number
): Promise<number | null> {
  if (!isDiscountRelease(prevPct, nextPct)) return null;
  try {
    // Keys and their values, stored rather than rendered — one Message row per
    // player, each read in its own reader's language. The strings themselves
    // live with the catalogue (see DIAMOND_SALE_ANNOUNCEMENT); only the number
    // is filled in here.
    const title: HeraldText = {
      key: DIAMOND_SALE_ANNOUNCEMENT.title,
      params: { pct: Math.round(clampDiscountPct(nextPct)) },
    };
    const body: HeraldText = { key: DIAMOND_SALE_ANNOUNCEMENT.body };
    const reached = await heraldInbox({
      kind: "ANNOUNCEMENT",
      title,
      body,
      href: DIAMOND_SALE_ANNOUNCEMENT.href,
    });
    // The updates room, not the events one: a price is a thing about the game
    // that changed, and it stays changed until the sale is pulled. Posted after
    // the inbox fan-out — Discord reaches people who are not playing, and it
    // must never be the *first* place a live player hears it.
    await heraldDiscord({
      kind: "announcement",
      channel: "updates",
      title,
      body,
      href: DIAMOND_SALE_ANNOUNCEMENT.href,
    });
    // The dialog arrives on the inbox pulse without this, but the store page
    // itself reads the discount off the tunables — a player standing on it when
    // the sale opens would otherwise keep seeing the old prices.
    revalidatePath("/game", "layout");
    return reached;
  } catch (err) {
    await logError("admin.heraldDiamondSale", err);
    return null;
  }
}

/** Persist edited global tunables (only known numeric fields are kept). */
export async function saveTunables(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    // Read before the write: the diamond discount is announced when it *rises*,
    // and after the upsert there is nothing left to compare against.
    const before = await getTunables();
    const overlay: Record<string, Record<string, number>> = {};
    for (const group of Object.keys(DEFAULT_TUNABLES) as (keyof GameTunables)[]) {
      overlay[group] = {};
      for (const field of Object.keys(DEFAULT_TUNABLES[group])) {
        const raw = formData.get(`${group}.${field}`);
        const n = Number(raw);
        if (raw != null && raw !== "" && Number.isFinite(n)) {
          overlay[group][field] = n;
        }
      }
    }
    const merged = mergeTunables(overlay);
    await prisma.gameConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", data: merged as unknown as Prisma.InputJsonValue },
      update: { data: merged as unknown as Prisma.InputJsonValue },
    });
    await logAdmin(admin, {
      action: "config.save",
      targetType: "config",
      summary: "עודכן איזון גלובלי",
      details: merged as unknown as Prisma.InputJsonValue,
    });
    revalidatePath("/admin/balance");

    // Outside the write and after the audit line, like every other announcement
    // tail in this file: the balance is saved either way.
    const prevPct = before.diamondStore.purchaseDiscountPct;
    const nextPct = merged.diamondStore.purchaseDiscountPct;
    const reached = await heraldDiamondSale(prevPct, nextPct);
    if (reached !== null) {
      await logAdmin(admin, {
        action: "diamondsale.announce",
        targetType: "config",
        summary:
          `שוחררה הנחת יהלומים ${Math.round(clampDiscountPct(nextPct))}% ` +
          `והוכרזה ל-${reached} אימפריות ובדיסקורד`,
        details: { prevPct, nextPct, count: reached },
      });
    }
    return {
      success:
        "האיזון הגלובלי נשמר" +
        (reached !== null ? " — ההנחה הוכרזה לכל השחקנים ובדיסקורד" : ""),
    };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                         MINI-GAMES                           */
/* ============================================================= */

const miniTypeSchema = z.enum([
  "FIND_BALL",
  "CRACK_SAFE",
  "TREASURE_MAP",
  "RIDDLE",
]);

/** Random integer in [min, max] (inclusive). */
function randInt(min: number, max: number): number {
  // These pick the mini-game's *secret answer*, so the generator has to be
  // unpredictable. V8's Math.random is xorshift128+ — fast, but its internal
  // state is recoverable from a modest run of observed outputs, and every
  // created game leaks one. randomInt draws from the CSPRNG and is also free of
  // the modulo bias a hand-rolled `% range` would introduce.
  return randomInt(min, max + 1);
}

/**
 * Build a fresh secret config (with a new random answer) for a mini-game.
 *
 * A riddle is the one type whose secret is *authored* rather than rolled — so
 * it is the one type this cannot mint on its own, and the caller passes the
 * question and answer through `authored`. Re-releasing a riddle therefore
 * reuses its text (see the note in `releaseMiniGame`), while every other game
 * gets a genuinely new answer each time.
 */
function freshConfig(
  type: MiniGameType,
  params: MiniGameShape,
  authored?: { question: string; word: string }
): {
  cups?: number;
  digits?: number;
  size?: number;
  answer?: number;
  code?: string;
  question?: string;
  word?: string;
} {
  if (type === "CRACK_SAFE") {
    // Kept as a string, not a number: the code may legitimately start with a
    // zero, and "047" must survive the round trip through the JSON column as
    // three digits rather than come back as 47.
    let code = "";
    for (let i = 0; i < params.digits; i++) code += String(randInt(0, 9));
    return { digits: params.digits, code };
  }
  if (type === "TREASURE_MAP") {
    const size = clampMapSize(params.size ?? MAP_SIZE_MIN);
    return { size, answer: randInt(0, size * size - 1) };
  }
  if (type === "RIDDLE") {
    return {
      question: (authored?.question ?? "").slice(0, RIDDLE_QUESTION_MAX),
      word: (authored?.word ?? "").slice(0, RIDDLE_ANSWER_MAX),
    };
  }
  return { cups: params.cups, answer: randInt(0, params.cups - 1) };
}

/** The admin-authored half of a riddle, read off the creation form. */
function readRiddle(formData: FormData): { question: string; word: string } {
  const read = (key: string, max: number) => {
    const raw = formData.get(key);
    return typeof raw === "string" ? raw.trim().slice(0, max) : "";
  };
  return {
    question: read("question", RIDDLE_QUESTION_MAX),
    word: read("answer", RIDDLE_ANSWER_MAX),
  };
}

/** Clamp the admin-supplied shape of each game to what its UI can render. */
function readShape(formData: FormData): MiniGameShape {
  return {
    cups: clampCups(optNum(formData, "cups", CUPS_MIN)),
    digits: clampDigits(optNum(formData, "digits", SAFE_DIGITS_MIN)),
    size: clampMapSize(optNum(formData, "size", MAP_SIZE_MIN)),
  };
}

function readPrizeBundle(formData: FormData) {
  return {
    prizeGold: Math.max(0, optNum(formData, "prizeGold")),
    prizeWood: Math.max(0, optNum(formData, "prizeWood")),
    prizeIron: Math.max(0, optNum(formData, "prizeIron")),
    prizeStone: Math.max(0, optNum(formData, "prizeStone")),
    prizeDiamonds: Math.max(0, optNum(formData, "prizeDiamonds")),
    prizeCitizens: Math.max(0, intOptNum(formData, "prizeCitizens")),
    prizeTurns: Math.max(0, intOptNum(formData, "prizeTurns")),
    prizeWheelSpins: Math.max(0, intOptNum(formData, "prizeWheelSpins")),
  };
}

/** Upper bound on a timed release: one week, in minutes. */
const MAX_DURATION_MINUTES = 7 * 24 * 60;

/**
 * How many *other* releases are currently running.
 *
 * A timed game whose deadline has passed is not one of them even while its
 * `isActive` flag is still up: the flag is only flipped lazily, on the first
 * player read after the deadline (see minigame.ts), so counting the flag alone
 * would have an expired game hold a slot until somebody happened to load a page.
 */
async function liveMiniGameCount(exceptId?: string): Promise<number> {
  return prisma.miniGameEvent.count({
    where: {
      isActive: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
  });
}

/**
 * Release an event to all players: fresh answer, cleared entries, live.
 * `durationMinutes` > 0 sets a deadline the event expires at on its own (no
 * scheduler involved — the deadline is enforced on read; see minigame.ts).
 *
 * Additive: releasing a game leaves whatever else is running alone, up to
 * MAX_LIVE_MINIGAMES. This used to deactivate every other event on the way in,
 * which made "run a cups game and a safe at the same time" impossible to
 * express — the second release silently killed the first, mid-race, prize
 * unclaimed. The cap is what stops the other extreme: the players' end of this
 * is a row of chips in the command bar, and a row has a width.
 */
async function activateEvent(
  admin: Awaited<ReturnType<typeof requireAdmin>>,
  event: {
    id: string;
    type: MiniGameType;
    config: unknown;
    title: string;
    maxAttempts: number;
  },
  durationMinutes: number
): Promise<void> {
  // Admin chrome / broadcast copy stays in the source language.
  const t = makeT(DEFAULT_LOCALE);
  // Re-activating reuses the event's own shape (cup count / code length) and
  // only rolls a new secret behind it. Both the shape and the attempt budget go
  // back through the clamps on the way out: a row saved before the bounds
  // changed (a two-cup game, or five attempts at three cups — which is a free
  // prize) must not be releasable just because it is already in the table.
  const cfg = (event.config ?? {}) as Record<string, number>;
  const params: MiniGameShape = {
    cups: clampCups(cfg.cups ?? CUPS_MIN),
    digits: clampDigits(cfg.digits ?? SAFE_DIGITS_MIN),
    size: clampMapSize(cfg.size ?? MAP_SIZE_MIN),
  };
  // A riddle's secret is written, not rolled, so re-releasing one has to carry
  // its own text forward — `freshConfig` cannot invent a question.
  const authored = {
    question: typeof cfg.question === "string" ? cfg.question : "",
    word: typeof cfg.word === "string" ? cfg.word : "",
  };
  const maxAttempts = clampAttempts(event.type, params, event.maxAttempts);
  const minutes = Math.min(MAX_DURATION_MINUTES, Math.max(0, Math.round(durationMinutes)));
  const endsAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  if ((await liveMiniGameCount(event.id)) >= MAX_LIVE_MINIGAMES) {
    throw new AdminError(
      `כבר רצים ${MAX_LIVE_MINIGAMES} מיני-משחקים במקביל — עצור אחד מהם כדי לשחרר עוד`
    );
  }

  // The updated row is read back out of the transaction rather than re-fetched:
  // the prize bundle and the attempt/winner caps live on the event, and the
  // announcement below has to describe the window that actually went live.
  const [, released] = await prisma.$transaction([
    prisma.miniGameEntry.deleteMany({ where: { eventId: event.id } }),
    prisma.miniGameEvent.update({
      where: { id: event.id },
      data: {
        isActive: true,
        winnersCount: 0,
        activatedAt: new Date(),
        durationMinutes: minutes,
        endsAt,
        endedAt: null,
        maxAttempts,
        config: freshConfig(event.type, params, authored),
      },
    }),
  ]);
  await logAdmin(admin, {
    action: "minigame.activate",
    targetType: "minigame",
    targetId: event.id,
    summary:
      minutes > 0
        ? `שוחרר מיני-משחק "${event.title}" לכל השחקנים למשך ${minutes} דקות`
        : `שוחרר מיני-משחק "${event.title}" לכל השחקנים`,
  });
  revalidatePath("/admin/minigame");
  revalidatePath("/game", "layout");

  // Announced for the same reason a Happy Hour is: a mini-game is a race with a
  // deadline and a capped number of winners, and a player who hears about it
  // afterwards never had a chance at it. Outside the transaction and after the
  // revalidate — Discord must never be able to fail a release that has already
  // committed. Same channel voice as the other posts: prize first, deadline
  // second, flavour last.
  const meta = MINIGAME_TYPE_META[event.type];
  const limits = [
    `${released.maxAttempts} ניסיונות לכל אחד`,
    released.maxWinners > 0 ? `${released.maxWinners} זוכים בלבד` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  await announceToDiscord({
    kind: "event",
    channel: "events",
    title: `${meta.icon} ${released.title} — באוויר`,
    body:
      `🎁 בפרס: ${prizeText(t, released)}\n` +
      `${limits}\n` +
      (minutes > 0
        ? `נסגר בעוד ${minutes} דק׳ — מי שראשון, לוקח.`
        : "רץ עד שנגיד סטופ."),
    url: gameLink("/game/base"),
  });
}

/** Create a new mini-game with a preset prize (optionally launch it at once). */
export async function createMiniGame(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const type = miniTypeSchema.parse(formData.get("type")) as MiniGameType;
    // Title is optional — fall back to the type's own name so the admin can
    // fire off a game without typing anything.
    const title = str(formData, "title") || MINIGAME_TYPE_META[type].label;

    const shape = readShape(formData);
    // Clamped against the *shape*, not a flat 1..30: a game's attempt budget
    // only means anything next to the thing being guessed. Three cups and five
    // attempts is a guaranteed prize with a bit of clicking; see attemptsRange.
    const maxAttempts = clampAttempts(
      type,
      shape,
      optNum(formData, "maxAttempts", Number.NaN)
    );
    const maxWinners = Math.max(0, Math.round(optNum(formData, "maxWinners", 0)));
    const durationMinutes = Math.min(
      MAX_DURATION_MINUTES,
      Math.max(0, Math.round(optNum(formData, "durationMinutes", 0)))
    );

    // Checked before the row is written, not inside activateEvent: a one-click
    // launch that fails the cap should leave the admin where they started, not
    // with a saved game and an error that never mentions it.
    const launching = str(formData, "activate") === "1";
    if (launching && (await liveMiniGameCount()) >= MAX_LIVE_MINIGAMES) {
      throw new AdminError(
        `כבר רצים ${MAX_LIVE_MINIGAMES} מיני-משחקים במקביל — עצור אחד מהם כדי לשחרר עוד`
      );
    }

    // A riddle is the one game whose secret is written rather than rolled, so
    // it is refused up front if either half is missing — an empty answer can
    // never be matched, which would be a release nobody could win.
    const riddle = readRiddle(formData);
    if (type === "RIDDLE" && (!riddle.question || !riddle.word)) {
      throw new AdminError("לחידה צריך גם שאלה וגם תשובה");
    }

    const event = await prisma.miniGameEvent.create({
      data: {
        type,
        title,
        config: freshConfig(type, shape, riddle),
        maxAttempts,
        maxWinners,
        durationMinutes,
        ...readPrizeBundle(formData),
      },
    });
    await logAdmin(admin, {
      action: "minigame.create",
      targetType: "minigame",
      targetId: event.id,
      summary: `נוצר מיני-משחק "${title}"`,
    });

    // One-click launch: create and immediately release to everyone.
    if (launching) {
      await activateEvent(admin, event, durationMinutes);
      return {
        success: durationMinutes
          ? `"${title}" נוצר ושוחרר לכל השחקנים למשך ${durationMinutes} דקות! 🎉`
          : `"${title}" נוצר ושוחרר לכל השחקנים! 🎉`,
      };
    }

    revalidatePath("/admin/minigame");
    return { success: "המיני-משחק נוצר. הפעל אותו כדי לשחרר לכולם." };
  } catch (e) {
    return toErr(e);
  }
}

/** Activate a mini-game: fresh answer, cleared entries, live for everyone. */
export async function activateMiniGame(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const event = await prisma.miniGameEvent.findUnique({ where: { id } });
    if (!event) return { error: "המיני-משחק לא נמצא" };

    // An omitted field keeps the duration the event was last released with.
    const durationMinutes = optNum(formData, "durationMinutes", event.durationMinutes);
    await activateEvent(admin, event, durationMinutes);
    return {
      success:
        durationMinutes > 0
          ? `המיני-משחק שוחרר לכל השחקנים למשך ${Math.round(durationMinutes)} דקות! 🎉`
          : "המיני-משחק שוחרר לכל השחקנים! 🎉",
    };
  } catch (e) {
    return toErr(e);
  }
}

/** Stop the active mini-game. */
export async function deactivateMiniGame(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    await prisma.miniGameEvent.update({
      where: { id },
      // Clearing the deadline too: stopping by hand is the end, so nothing
      // should still read as "expires in N minutes".
      data: { isActive: false, endsAt: null, endedAt: new Date() },
    });
    await logAdmin(admin, {
      action: "minigame.deactivate",
      targetType: "minigame",
      targetId: id,
      summary: "מיני-משחק הופסק",
    });
    revalidatePath("/admin/minigame");
    revalidatePath("/game", "layout");
    return { success: "המיני-משחק הופסק" };
  } catch (e) {
    return toErr(e);
  }
}

/** Delete a mini-game (and its entries). */
export async function deleteMiniGame(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    await prisma.miniGameEvent.delete({ where: { id } });
    await logAdmin(admin, {
      action: "minigame.delete",
      targetType: "minigame",
      targetId: id,
      summary: "מיני-משחק נמחק",
    });
    revalidatePath("/admin/minigame");
    return { success: "המיני-משחק נמחק" };
  } catch (e) {
    return toErr(e);
  }
}

/** Reset all tunables back to code defaults. */
export async function resetTunables(
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    await prisma.gameConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", data: {} },
      update: { data: {} },
    });
    await logAdmin(admin, {
      action: "config.reset",
      targetType: "config",
      summary: "איזון גלובלי אופס לברירת מחדל",
    });
    revalidatePath("/admin/balance");
    return { success: "האיזון אופס לברירת המחדל" };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------------ Happy Hour ------------------------------ */

/**
 * Release a golden hour to the whole server.
 *
 * The window itself is enforced on the clock (see server/happyHour.ts), so the
 * only write is the row: a start, an end, and the bonus everyone is about to be
 * paid. Any other window is closed in the same transaction — two overlapping
 * releases would stack silently, and an admin firing a ×2 on top of a forgotten
 * ×5 would be handing out ×10 without ever seeing that number on a screen.
 */
async function releaseHappyHour(
  admin: Awaited<ReturnType<typeof requireAdmin>>,
  id: string,
  durationMinutes: number
): Promise<{ endsAt: Date | null; minutes: number }> {
  const minutes = Math.min(
    HAPPY_HOUR_MAX_MINUTES,
    Math.max(0, Math.round(durationMinutes))
  );
  const now = new Date();
  const endsAt = minutes > 0 ? new Date(now.getTime() + minutes * 60_000) : null;

  const [, released] = await prisma.$transaction([
    // Closing, not just deactivating: a stopped window still has to carry a real
    // `endsAt`, because the lazy mine clock prices an offline player's backlog
    // against the edges of every window it overlaps.
    prisma.happyHour.updateMany({
      where: { isActive: true },
      data: { isActive: false, endsAt: now, endedAt: now },
    }),
    prisma.happyHour.update({
      where: { id },
      data: {
        isActive: true,
        durationMinutes: minutes,
        startsAt: now,
        endsAt,
        endedAt: null,
      },
    }),
  ]);

  await logAdmin(admin, {
    action: "happyhour.release",
    targetType: "happyhour",
    targetId: id,
    summary:
      `שוחרר ${released.title} ${multiplierLabel(released.bonusPct)} לכל השחקנים` +
      (minutes > 0 ? ` למשך ${minutes} דקות` : " ללא הגבלת זמן"),
    details: {
      bonusPct: released.bonusPct,
      boostXp: released.boostXp,
      boostPlunder: released.boostPlunder,
      boostMines: released.boostMines,
      minutes,
    },
  });

  // The one announcement that is genuinely time-critical: a golden hour is
  // worthless to a player who hears about it after it closed, and most players
  // are not looking at the game when it opens. Posted from the one function
  // both release paths go through (createHappyHour with "activate", and
  // startHappyHour), so a window can never go live without the channel hearing.
  // Channel voice, not site voice: this is read on a phone, mid-scroll, by
  // someone deciding in about two seconds whether to open the game. Short
  // lines, the gamer loanwords players already use out loud (XP, לוט,
  // HAPPY HOUR), and the deadline before the flavour.
  const effects = [
    released.boostXp ? "XP" : null,
    released.boostPlunder ? "לוט" : null,
    released.boostMines ? "מכרות" : null,
  ].filter(Boolean).join(" · ");
  // The admin's own title only earns a place in the headline when it says
  // something "HAPPY HOUR" does not. A window called plainly "Happy Hour" — the
  // common case — otherwise posts as "HAPPY HOUR ×2 — Happy Hour".
  const named = released.title.trim();
  const generic = /^happy\s*hour$/i.test(named) || named === "שעת זהב" || named === "";
  await announceToDiscord({
    kind: "event",
    channel: "events",
    title:
      `🔥 HAPPY HOUR ${multiplierLabel(released.bonusPct)}` +
      (generic ? "" : ` — ${named}`),
    body:
      `${effects} ${multiplierLabel(released.bonusPct)} לכולם. 🚀\n` +
      (minutes > 0
        ? `נסגר בעוד ${minutes} דק׳ — מי שישן מפסיד.`
        : "רץ עד שנגיד סטופ."),
    url: gameLink("/game/base"),
  });
  return { endsAt, minutes };
}

/** Read the three switches off the form, defaulting to on. */
function readHappyHourEffects(formData: FormData) {
  const on = (key: string) => str(formData, key) !== "0";
  return {
    boostXp: on("boostXp"),
    boostPlunder: on("boostPlunder"),
    boostMines: on("boostMines"),
  };
}

/** Create a golden hour — and, from the launcher, release it in the same click. */
export async function createHappyHour(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const title = str(formData, "title", 80) || HAPPY_HOUR_DEFAULT_TITLE;
    const bonusPct = Math.min(
      HAPPY_HOUR_MAX_PCT,
      Math.max(HAPPY_HOUR_MIN_PCT, Math.round(optNum(formData, "bonusPct", 100)))
    );
    const effects = readHappyHourEffects(formData);
    if (!effects.boostXp && !effects.boostPlunder && !effects.boostMines) {
      return { error: "בחר לפחות הטבה אחת — אחרת אין מה לשחרר" };
    }
    const durationMinutes = Math.min(
      HAPPY_HOUR_MAX_MINUTES,
      Math.max(0, Math.round(optNum(formData, "durationMinutes", 60)))
    );

    const event = await prisma.happyHour.create({
      data: { title, bonusPct, durationMinutes, ...effects },
    });

    if (str(formData, "activate") === "1") {
      const { minutes } = await releaseHappyHour(admin, event.id, durationMinutes);
      revalidatePath("/admin/happy-hour");
      revalidatePath("/game", "layout");
      return {
        success:
          `🔥 ${title} ${multiplierLabel(bonusPct)} באוויר!` +
          (minutes > 0 ? ` נסגרת בעוד ${minutes} דקות.` : " רצה עד שתעצור אותה."),
      };
    }

    await logAdmin(admin, {
      action: "happyhour.create",
      targetType: "happyhour",
      targetId: event.id,
      summary: `נוצר ${title} ${multiplierLabel(bonusPct)}`,
    });
    revalidatePath("/admin/happy-hour");
    return { success: "ה-Happy Hour נוצר. שחרר אותו כדי להפעיל לכולם." };
  } catch (e) {
    return toErr(e);
  }
}

/** Release an existing golden hour again, with a fresh clock. */
export async function startHappyHour(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const event = await prisma.happyHour.findUnique({ where: { id } });
    if (!event) return { error: "ה-Happy Hour לא נמצא" };

    // An omitted field re-runs it for however long it last ran.
    const { minutes } = await releaseHappyHour(
      admin,
      id,
      optNum(formData, "durationMinutes", event.durationMinutes)
    );
    revalidatePath("/admin/happy-hour");
    revalidatePath("/game", "layout");
    return {
      success:
        `🔥 ${event.title} ${multiplierLabel(event.bonusPct)} באוויר!` +
        (minutes > 0 ? ` נסגרת בעוד ${minutes} דקות.` : " רצה עד שתעצור אותה."),
    };
  } catch (e) {
    return toErr(e);
  }
}

/** Call off the running golden hour. */
export async function stopHappyHour(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const now = new Date();
    // `endsAt: now` and not null — the backlog arithmetic needs to know exactly
    // when the golden rate stopped, for every player still to settle their ticks.
    await prisma.happyHour.update({
      where: { id },
      data: { isActive: false, endsAt: now, endedAt: now },
    });
    await logAdmin(admin, {
      action: "happyhour.stop",
      targetType: "happyhour",
      targetId: id,
      summary: "Happy Hour הופסק",
    });
    revalidatePath("/admin/happy-hour");
    revalidatePath("/game", "layout");
    return { success: "ה-Happy Hour הופסק" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Delete a golden hour. Refused while it is live, and refused for one that has
 * run: a window whose row is gone can no longer be found by the lazy mine clock,
 * so deleting it would quietly rob every player who has not yet settled the
 * ticks it covered.
 */
export async function deleteHappyHour(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const id = str(formData, "id");
    const event = await prisma.happyHour.findUnique({ where: { id } });
    if (!event) return { error: "ה-Happy Hour לא נמצא" };
    if (event.isActive) return { error: "עצור את ה-Happy Hour לפני מחיקה" };
    if (event.startsAt) {
      return { error: "Happy Hour שכבר רץ נשמר ביומן ואי אפשר למחוק" };
    }

    await prisma.happyHour.delete({ where: { id } });
    await logAdmin(admin, {
      action: "happyhour.delete",
      targetType: "happyhour",
      targetId: id,
      summary: "נמחק Happy Hour שלא שוחרר",
    });
    revalidatePath("/admin/happy-hour");
    return { success: "ה-Happy Hour נמחק" };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                            BOTS                               */
/* ============================================================= */

/**
 * Plant garrison empires in one or more city tiers.
 *
 * The whole reason this exists is a city with one player in it: combat is
 * confined to your own tier, so the first player to climb into a high city can
 * neither attack nor spy anybody until a second one arrives. A bot is a
 * resident of that tier — raidable, spyable, worth loot, and rebuilt after it is
 * farmed (see src/server/bots.ts).
 *
 * Every figure the admin supplies is clamped here rather than trusted from the
 * form, for the reason `clampLevel` gives: the admin path is the only way around
 * the ceilings the game itself enforces, so it has to enforce the same ones.
 */
export async function createBotEmpires(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();

    // The city checkboxes. Deduplicated and clamped into 1..MAX_CITIES: a
    // tampered value would otherwise plant an empire in a tier that does not
    // exist, where nobody could ever reach it.
    const cities = [
      ...new Set(
        formData
          .getAll("cities")
          .map((raw) => Math.round(Number(raw)))
          .filter((tier) => Number.isFinite(tier) && tier >= 1 && tier <= MAX_CITIES)
      ),
    ].sort((a, b) => a - b);
    if (cities.length === 0) return { error: "בחר לפחות עיר אחת" };

    const perCity = clampLevel(optNum(formData, "perCity", 1), 1, BOT_BATCH_MAX);
    const total = cities.length * perCity;
    if (total > BOT_BATCH_MAX) {
      return {
        error: `אפשר ליצור עד ${BOT_BATCH_MAX} בוטים בפעולה אחת (ביקשת ${total})`,
      };
    }

    // No power to choose: every bot is planted with the same fixed garrison
    // (BOT_SOLDIERS soldiers, no weapons), so the city and the count are the
    // whole of the decision.
    const plans = await planBots({ cities, perCity });
    const { created, failed, reason } = await createBots(plans);
    if (created === 0) {
      // The reason travels because "try again" was the wrong advice: a batch
      // that failed on every bot failed for something a retry will not change.
      return { error: `לא נוצר אף בוט${reason ? ` — ${reason}` : " — נסה שוב"}` };
    }

    await logAdmin(admin, {
      action: "bots.create",
      targetType: "bot",
      summary: `נשתלו ${created} בוטים בערים ${cities.join(", ")}`,
      details: { cities, perCity, soldiers: BOT_SOLDIERS, created, failed },
    });
    revalidatePath("/admin/bots");
    revalidatePath("/game", "layout");
    return {
      success:
        `נשתלו ${created} בוטים` +
        (failed > 0 ? ` (${failed} נכשלו על התנגשות שם — נסה שוב)` : ""),
    };
  } catch (e) {
    return toErr(e);
  }
}

/** Refill one bot's army and arsenal now, without waiting out the hour. */
export async function rearmBotEmpire(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    if (!(await rearmBot(empireId))) return { error: "הבוט לא נמצא" };

    await logAdmin(admin, {
      action: "bots.rearm",
      targetType: "empire",
      targetId: empireId,
      summary: "חיל המצב של הבוט חודש",
    });
    revalidatePath("/admin/bots");
    revalidatePath("/game", "layout");
    return { success: "חיל המצב חודש" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Remove a bot — the account, the empire and the garrison together.
 *
 * Battle and spy reports written against it survive, as they do for any deleted
 * empire: a player's own history must not rewrite itself because the admin
 * cleared a city.
 */
export async function deleteBotEmpire(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const empireId = str(formData, "empireId");
    if (!(await deleteBot(empireId))) return { error: "הבוט לא נמצא" };

    await logAdmin(admin, {
      action: "bots.delete",
      targetType: "empire",
      targetId: empireId,
      summary: "בוט נמחק",
    });
    revalidatePath("/admin/bots");
    revalidatePath("/game", "layout");
    return { success: "הבוט נמחק" };
  } catch (e) {
    return toErr(e);
  }
}

/* ============================================================= */
/*                     BOSSES & THE WORLD BOSS                   */
/* ============================================================= */

/**
 * The two bosses, from the control centre.
 *
 * They need different tools and it is worth saying why, because the asymmetry is
 * not an oversight in either design.
 *
 * **בוס העיר** is private: one *life* per empire per city tier (`BossSiege`),
 * with its own health and its own revive clock. There is nothing global to
 * edit — "revive the boss" means reviving as many rows as there are players
 * standing in front of one, so the actions below are scoped (everybody / one
 * tier / one empire) and act on the newest life of each.
 *
 * **מפלצת העולם** is the opposite: exactly one row a day, shared by the whole
 * server, deliberately built as a clock fixture with no admin button (see
 * lib/game/worldBoss.ts). That was right for *spawning* it and remains so — the
 * day's beast still appears on its own, now within a minute of midnight rather
 * than whenever somebody opens the arena (see `getWorldBossHerald`). What it
 * left missing is any way to reach the fixture once it is standing: a pool
 * frozen too high on a quiet day cannot be lowered, and a beast felled by an
 * exploit cannot be put back. These actions edit the live row and nothing else;
 * which boss a day draws is still a pure function of the day, except where an
 * admin says otherwise here.
 */

/** The live day's row, or null before anything has opened the arena. */
async function currentWorldBoss() {
  return prisma.worldBoss.findUnique({ where: { day: gameDay(new Date()) } });
}

/** Full health, no corpse: the shape both the revive and the reset write. */
function worldBossAlive(maxHp: number) {
  return {
    hp: maxHp,
    maxHp,
    defeatedAt: null,
    slayerId: null,
    slayerName: null,
    // Both are claims on something that happens **once per kill**, and a revived
    // beast has a kill still ahead of it. Left stamped, the next one would
    // announce nothing (`heraldWorldBossDefeat` finds its claim taken) and, far
    // worse, pay nobody: `settleWorldBossSpoils` looks for a felled boss whose
    // spoils are unsettled, so a stale marker would quietly reinstate the very
    // bug the fan-out was written to fix — an arena full of strikers owed a
    // share that nothing in the game will ever hand them.
    defeatAnnouncedAt: null,
    spoilsSettledAt: null,
  };
}

/**
 * Spawn the day's boss by hand, ahead of the first screen to look.
 *
 * Rarely needed now that any game screen opens it (see `getWorldBossHerald`):
 * useful on a server with nobody signed in, and harmless otherwise — after the
 * row exists every other action here edits it instead.
 */
export async function spawnWorldBoss(
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const day = gameDay(new Date());
    if (await prisma.worldBoss.findUnique({ where: { day } })) {
      return { error: "מפלצת היום כבר קיימת" };
    }

    const tunables = await getTunables();
    const definition = rollWorldBoss(day);
    const empires = await prisma.empire.count({ where: notStaffOrBot });
    const maxHp = worldBossMaxHp(definition, empires, tunables.worldBoss.hpMultiplier);
    const boss = await prisma.worldBoss.create({
      data: { day, key: definition.key, maxHp, hp: maxHp },
    });

    await logAdmin(admin, {
      action: "worldboss.spawn",
      targetType: "worldBoss",
      targetId: boss.id,
      summary: `${definition.name} נוצרה ידנית עם ${formatNumber(maxHp)} חיים`,
    });
    revalidateBossScreens();
    return { success: `${definition.name} עומדת בזירה` };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Edit the live beast: which one it is, its pool, and its health right now.
 *
 * `maxHp` is normally frozen at spawn — the fixture's whole shape depends on the
 * pool not moving under a server mid-fight (see `worldBossMaxHp`) — so this is
 * the one place it can move, and it moves deliberately. Health is clamped to the
 * pool: a beast on more health than it has is a bar that reads past full.
 */
export async function saveWorldBoss(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const boss = await currentWorldBoss();
    if (!boss) return { error: "אין מפלצת עולם היום — צור אותה קודם" };

    const key = str(formData, "key", 40) || boss.key;
    const definition = WORLD_BOSS_BY_KEY.get(key);
    if (!definition) return { error: "מפלצת לא מוכרת" };

    const maxHp = Math.max(1, Math.round(optNum(formData, "maxHp", boss.maxHp)));
    const hp = Math.min(maxHp, Math.max(0, Math.round(optNum(formData, "hp", boss.hp))));

    // Health at zero and a live corpse are the same state; the two must never
    // disagree, or the arena offers a strike that the guarded UPDATE refuses.
    const defeated = hp <= 0;
    const updated = await prisma.worldBoss.update({
      where: { id: boss.id },
      data: {
        key,
        maxHp,
        hp,
        ...(defeated
          ? boss.defeatedAt
            ? {}
            : { defeatedAt: new Date(), slayerId: null, slayerName: null }
          : { defeatedAt: null, slayerId: null, slayerName: null }),
      },
    });

    await logAdmin(admin, {
      action: "worldboss.save",
      targetType: "worldBoss",
      targetId: boss.id,
      summary: `${definition.name}: ${formatNumber(updated.hp)}/${formatNumber(updated.maxHp)} חיים`,
      details: { key, hp, maxHp, defeated },
    });
    revalidateBossScreens();
    return { success: `${definition.name} עודכנה` };
  } catch (e) {
    return toErr(e);
  }
}

/** Put the beast back on its feet at full health, keeping the damage board. */
export async function reviveWorldBoss(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const boss = await currentWorldBoss();
    if (!boss) return { error: "אין מפלצת עולם היום — צור אותה קודם" };

    // An optional new pool, so "bring it back, but bigger" is one click rather
    // than two. Blank keeps the pool it already carries.
    const maxHp = Math.max(1, Math.round(optNum(formData, "maxHp", boss.maxHp)));
    await prisma.worldBoss.update({
      where: { id: boss.id },
      data: worldBossAlive(maxHp),
    });

    await logAdmin(admin, {
      action: "worldboss.revive",
      targetType: "worldBoss",
      targetId: boss.id,
      summary: `המפלצת הוחזרה ל-${formatNumber(maxHp)} חיים מלאים`,
    });
    revalidateBossScreens();
    return { success: "המפלצת עומדת שוב, בחיים מלאים" };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Fell it now.
 *
 * No slayer is stamped — nobody landed the blow — so the kill diamonds are paid
 * to nobody, and the shared purse opens for everyone who struck today. That is
 * the point of the button: it ends a day that is not going to end on its own
 * without robbing the players who turned up.
 */
export async function killWorldBoss(
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const boss = await currentWorldBoss();
    if (!boss) return { error: "אין מפלצת עולם היום — צור אותה קודם" };
    if (boss.defeatedAt) return { error: "המפלצת כבר הופלה היום" };

    await prisma.worldBoss.update({
      where: { id: boss.id },
      data: { hp: 0, defeatedAt: new Date(), slayerId: null, slayerName: null },
    });

    await logAdmin(admin, {
      action: "worldboss.kill",
      targetType: "worldBoss",
      targetId: boss.id,
      summary: "המפלצת הופלה ידנית — השלל נפתח לכל המכים",
    });
    revalidateBossScreens();
    return { success: "המפלצת הופלה. השלל פתוח לכל מי שהכה היום." };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Start the day over: full health, and the damage board wiped.
 *
 * The destructive one, and the warning is real — the strikes carry the `claimed`
 * receipts, so deleting them re-opens the purse for anyone who already collected
 * it. Use it on a day that went wrong, not on one that merely ended early.
 */
export async function resetWorldBoss(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const boss = await currentWorldBoss();
    if (!boss) return { error: "אין מפלצת עולם היום — צור אותה קודם" };

    const tunables = await getTunables();
    const definition = WORLD_BOSS_BY_KEY.get(boss.key);
    // Blank recomputes the pool from today's head count, which is what a spawn
    // would have written had the day started now.
    const empires = await prisma.empire.count({ where: notStaffOrBot });
    const fresh =
      definition != null
        ? worldBossMaxHp(definition, empires, tunables.worldBoss.hpMultiplier)
        : boss.maxHp;
    const maxHp = Math.max(1, Math.round(optNum(formData, "maxHp", fresh)));

    const [blows, strikes] = await prisma.$transaction([
      prisma.worldBossBlow.deleteMany({ where: { bossId: boss.id } }),
      prisma.worldBossStrike.deleteMany({ where: { bossId: boss.id } }),
      prisma.worldBoss.update({ where: { id: boss.id }, data: worldBossAlive(maxHp) }),
    ]);

    await logAdmin(admin, {
      action: "worldboss.reset",
      targetType: "worldBoss",
      targetId: boss.id,
      summary: `היום אופס: ${formatNumber(maxHp)} חיים, ${strikes.count} מכים ו-${blows.count} מכות נמחקו`,
    });
    revalidateBossScreens();
    return {
      success: `המפלצת אופסה. לוח הנזק נוקה (${strikes.count} שחקנים).`,
    };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------------ city bosses ------------------------------ */

/**
 * Restore city bosses to full life.
 *
 * Acts on the **newest** life of each tier, which is the one row `currentLife`
 * will read next — an older siege is history and reviving it would change nothing
 * anybody can see. A dead one is brought back on the spot rather than having its
 * clock shortened: `killedAt`/`revivesAt` cleared and the pool refilled, so the
 * row that was a corpse is the tyrant standing in front of the city on its next
 * march.
 *
 * Scope is one city tier, or all of them. There is no per-player scope any more,
 * and there cannot be one: a tyrant belongs to its whole city (see BossSiege).
 */
export async function reviveCityBosses(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const tier = Math.round(optNum(formData, "cityTier", 0));

    const where: Prisma.BossSiegeWhereInput =
      tier > 0 ? { cityTier: clampLevel(tier, 1, MAX_CITIES) } : {};

    // Newest life per tier. Read as rows rather than updated in one statement
    // because "newest" is not something a Prisma updateMany can say — and an
    // updateMany over every matching row would resurrect sieges that were
    // superseded long ago.
    const sieges = await prisma.bossSiege.findMany({
      where,
      orderBy: { life: "desc" },
      select: { id: true, cityTier: true, hp: true, maxHp: true },
    });
    const newest = new Map<number, (typeof sieges)[number]>();
    for (const siege of sieges) {
      if (!newest.has(siege.cityTier)) newest.set(siege.cityTier, siege);
    }
    if (newest.size === 0) return { error: "לא נמצאו בוסים בטווח שנבחר" };

    const ids = [...newest.values()].map((s) => s.id);
    // One statement, and raw because `hp = "maxHp"` — a column read into another
    // column of the same row — is not something `updateMany` can express, and
    // the two halves must not be able to land apart: a row with its corpse
    // cleared but its pool still empty is a boss that is neither alive nor
    // counting down.
    // The board goes with the corpse. A revive has to leave a genuinely *fresh*
    // life, not a healed one: the kill purse is shared out by each empire's
    // damage against this row, so resurrecting it with the old contributions
    // still on it would pay every besieger a second time for damage they dealt
    // to the tyrant that already fell — and `spoilsPaidAt`, which is the receipt
    // that stops exactly that, has to be cleared for the new kill to pay at all.
    await prisma.bossSiegeStrike.deleteMany({ where: { siegeId: { in: ids } } });
    const restored = await prisma.$executeRaw`
      UPDATE "BossSiege"
      SET hp = "maxHp",
          "damageDealt" = 0,
          sorties = 0,
          "killedAt" = NULL,
          "revivesAt" = NULL,
          "slayerId" = NULL,
          "slayerName" = NULL,
          "spoilsPaidAt" = NULL,
          "revivedNotifiedAt" = NULL
      WHERE id = ANY(${ids})
    `;

    const scope = tier > 0 ? `דרגת עיר ${clampLevel(tier, 1, MAX_CITIES)}` : "כל הדרגות";
    await logAdmin(admin, {
      action: "boss.revive",
      targetType: "bossSiege",
      summary: `${restored} בוסי עיר הוחזרו לחיים מלאים (${scope})`,
    });
    revalidateBossScreens();
    return { success: `${restored} בוסי עיר חזרו לחיים מלאים` };
  } catch (e) {
    return toErr(e);
  }
}

/* ------------------------------ the knobs ------------------------------ */

/**
 * Save the two boss groups without touching anything else.
 *
 * Deliberately not `saveTunables`: that action rebuilds the whole overlay from
 * one form and merges it over the **defaults**, so a partial form — this page
 * carries two groups out of eight — would silently reset the starting bundle,
 * the battle rates and the season cycle to their shipped values. Here the
 * submitted fields are laid over the tunables as they currently stand.
 */
export async function saveBossTunables(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const current = await getTunables();
    const groups = ["boss", "worldBoss"] as const;

    const overlay: Record<string, Record<string, number>> = {
      ...(current as unknown as Record<string, Record<string, number>>),
    };
    for (const group of groups) {
      const values: Record<string, number> = { ...current[group] };
      for (const field of Object.keys(DEFAULT_TUNABLES[group])) {
        const raw = formData.get(`${group}.${field}`);
        const n = Number(raw);
        if (raw != null && raw !== "" && Number.isFinite(n)) values[field] = n;
      }
      overlay[group] = values;
    }

    const merged = mergeTunables(overlay);
    await prisma.gameConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", data: merged as unknown as Prisma.InputJsonValue },
      update: { data: merged as unknown as Prisma.InputJsonValue },
    });
    await logAdmin(admin, {
      action: "config.save",
      targetType: "config",
      summary: "עודכן איזון הבוסים",
      details: { boss: merged.boss, worldBoss: merged.worldBoss },
    });
    revalidateBossScreens();
    return { success: "איזון הבוסים נשמר" };
  } catch (e) {
    return toErr(e);
  }
}

/** Both boss screens plus the game shell, which carries the city-boss banner. */
function revalidateBossScreens(): void {
  revalidatePath("/admin/bosses");
  revalidatePath("/admin/balance");
  revalidatePath("/game", "layout");
}
