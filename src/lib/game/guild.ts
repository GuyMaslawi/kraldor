// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { GuildRole, GuildSpellType } from "@prisma/client";
import type { IconName } from "@/components/ui/Icon";
import type { T } from "@/i18n/translate";

/* ------------------------------ creation & capacity ------------------------------ */

/** Founding a guild costs diamonds — name only, no tag. */
export const GUILD_CREATION_COST_DIAMONDS = 750;

/**
 * The smallest donation אוצר הברית accepts.
 *
 * Not a nicety — it is what keeps `GuildMember.donated` meaningful. Without a
 * floor, a member could top the contribution board with ten thousand one-gold
 * donations, and the number everybody reads as "who carried this guild" would
 * be measuring clicking rather than giving.
 */
export const GUILD_DONATION_MIN = 1_000;

export const GUILD_NAME_MIN_LENGTH = 2;
export const GUILD_NAME_MAX_LENGTH = 30;

/**
 * Member capacity = 1 + capacity level, so a fresh guild (level 1) holds
 * 2 members and each shop expansion adds one seat.
 */
export function guildCapacity(capacityLevel: number): number {
  return 1 + capacityLevel;
}

/** Top capacity level — 10 members. */
export const GUILD_CAPACITY_MAX_LEVEL = 9;

/**
 * Gold cost to expand from `level` to `level + 1`. Guilds have no treasury, so
 * the leader or deputy who buys the seat pays it from their own available gold.
 */
export function capacityUpgradeCostGold(level: number): number {
  return 50_000 * (level + 1);
}

/* ------------------------------ guild aid ------------------------------ */

/**
 * Guild aid pools the whole guild's strength: every member fights with a flat
 * power bonus equal to `aidLevel`% of the guild's total military power — both
 * when attacking and when being attacked — up to a 15% cap. Level starts at 0
 * (no aid) and any member can raise it by paying from their own gold.
 */
export const GUILD_AID_MAX_LEVEL = 15;

export function guildAidPct(level: number): number {
  return Math.min(GUILD_AID_MAX_LEVEL, Math.max(0, level));
}

/**
 * Gold cost to raise aid from `level` to `level + 1`. There is no guild bank —
 * the member who wants the upgrade pays it from their own available gold.
 */
export function aidUpgradeCostGold(level: number): number {
  return 75_000 * (level + 1);
}

/* ------------------------------ spells ------------------------------ */

/**
 * Guild help is measured in power: each spell's level IS its bonus percent.
 * It starts at 1% and the shop upgrades it up to that spell's own ceiling.
 *
 * The ceiling and the window are **per spell**, not one global pair. All three
 * were cut to +10% for 6 hours on 2026-08-03: at the old 30% for 24 hours a
 * guild that had bought the shop out simply lived with a third of its power for
 * free, all day, on every member at once — the buff had stopped being a play
 * and become a passive stat. Six hours makes casting a decision about *when*,
 * and 10% keeps it a nudge rather than the battle.
 *
 * A fourth spell, `SPY`, was deleted the same day: spy missions are settled by
 * intelligence power, and a guild-bought flat percentage on top of that made
 * the mission about the shop instead. The enum value is gone from the schema.
 */
const SPELL_HOURS = 6;

export interface GuildSpellMeta {
  label: string;
  icon: IconName;
  description: string;
  /** Highest level (= bonus percent) the shop will sell for this spell. */
  maxLevel: number;
  /** How long one cast holds on the caster. */
  buffHours: number;
  /**
   * Human-readable effect for a given bonus percent. Takes the translator
   * rather than returning a source string — the sentence is built around a
   * number that only exists at this level.
   */
  effectLabel: (t: T, pct: number) => string;
}

export const GUILD_SPELL_META: Record<GuildSpellType, GuildSpellMeta> = {
  ATTACK: {
    label: "קסם התקפה",
    icon: "attack",
    description: "מגביר את כוח ההתקפה שלך בקרבות.",
    maxLevel: 10,
    buffHours: SPELL_HOURS,
    effectLabel: (t, pct) =>
      t("+{pct}% לכוח ההתקפה למשך {hours} שעות", { pct, hours: SPELL_HOURS }),
  },
  DEFENSE: {
    label: "קסם הגנה",
    icon: "shield",
    description: "מגביר את כוח ההגנה שלך כשמתקיפים אותך.",
    maxLevel: 10,
    buffHours: SPELL_HOURS,
    effectLabel: (t, pct) =>
      t("+{pct}% לכוח ההגנה למשך {hours} שעות", { pct, hours: SPELL_HOURS }),
  },
  RESOURCES: {
    label: "קסם משאבים",
    icon: "mine",
    description: "מאיץ את תפוקת המכרות של האימפריה שלך.",
    maxLevel: 10,
    buffHours: SPELL_HOURS,
    effectLabel: (t, pct) =>
      t("+{pct}% לתפוקת המכרות למשך {hours} שעות", { pct, hours: SPELL_HOURS }),
  },
};

export const GUILD_SPELL_TYPES = Object.keys(GUILD_SPELL_META) as GuildSpellType[];

/** This spell's ceiling — the level the shop refuses to upgrade past. */
export function guildSpellMaxLevel(type: GuildSpellType): number {
  return GUILD_SPELL_META[type].maxLevel;
}

/**
 * The bonus a spell of `type` at `level` grants, clamped to that spell's
 * ceiling. Rows bought before a ceiling was lowered stay in the database at
 * their old level; clamping here is what makes them harmless.
 */
export function guildSpellBonusPct(type: GuildSpellType, level: number): number {
  return Math.min(guildSpellMaxLevel(type), Math.max(0, level));
}

/** Diamond cost to upgrade a spell from `level` to `level + 1`. */
export function spellUpgradeCostDiamonds(level: number): number {
  return 40 * (level + 1);
}

/** How long one cast of `type` holds, in hours and in milliseconds. */
export function guildSpellBuffHours(type: GuildSpellType): number {
  return GUILD_SPELL_META[type].buffHours;
}

export function guildSpellBuffMs(type: GuildSpellType): number {
  return guildSpellBuffHours(type) * 60 * 60 * 1000;
}

/** Diamond cost to cast a spell at the guild's current level. */
export function spellCastCostDiamonds(type: GuildSpellType, level: number): number {
  return 10 + guildSpellBonusPct(type, level) * 2;
}

/* ------------------------------ invitations ------------------------------ */

/** How long a guild invitation stays claimable before it lapses. */
export const GUILD_INVITE_TTL_HOURS = 72;
export const GUILD_INVITE_TTL_MS = GUILD_INVITE_TTL_HOURS * 60 * 60 * 1000;

/* ------------------------------ roles ------------------------------ */

export interface GuildRoleMeta {
  label: string;
  icon: string;
  /** Sort order in the member list — leader first. */
  order: number;
}

export const GUILD_ROLE_META: Record<GuildRole, GuildRoleMeta> = {
  LEADER: { label: "מנהיג", icon: "👑", order: 0 },
  DEPUTY: { label: "סגן", icon: "⭐", order: 1 },
  MEMBER: { label: "חבר", icon: "🪖", order: 2 },
};
