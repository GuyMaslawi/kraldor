// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { Hero, HeroClass, HeroItem, HeroItemSlot, HeroRarity } from "@prisma/client";
import type { IconName } from "@/components/ui/Icon";
import type { T, TranslateParams } from "@/i18n/translate";
import {
  DAILY_UPDATE_TIMES,
  RESOURCE_META,
  TICKS_PER_DAY,
  TURNS_UPGRADE_MAX_LEVEL,
  type StorableResource,
} from "./constants";
import { secureRandom } from "./random";

/* ------------------------------ hero progression ------------------------------ */

export const HERO_MAX_LEVEL = 100;

/** Stat points granted per hero level-up (1 point = +1% to the chosen stat). */
export const POINTS_PER_LEVEL = 1;

/** Citizens the empire receives for each hero level gained. */
export const CITIZENS_PER_LEVEL = 25;

/**
 * Reset ("prestige") at level 100: the hero returns to level 1 with these.
 *
 * The points are **cumulative across resets** — every reset behind the hero is
 * worth another 30, permanently. A hero on his first reset starts level 1 with
 * 30 of them (31 points in hand, the level-1 point included) and can reach 130
 * at the cap; his second reset starts him at 60, his third at 90. See
 * `heroPointPool`, which is the single expression of that rule.
 */
export const HERO_RESET_CITIZENS = 3000;
export const HERO_RESET_TURNS = 6000;
export const HERO_RESET_POINTS = 30;

/** The four columns hero points live in — what `heroPointsHeld` sums. */
export type HeroPointColumns = Pick<
  Hero,
  "unspentPoints" | "attackPoints" | "defensePoints" | "resourcePoints"
>;

/** Every point the hero currently holds, spent and unspent alike. */
export function heroPointsHeld(hero: HeroPointColumns): number {
  return (
    hero.unspentPoints + hero.attackPoints + hero.defensePoints + hero.resourcePoints
  );
}

/**
 * Every point a hero at this standing is entitled to — the invariant the whole
 * point economy is built on, and the one place it is written down. Two sources,
 * both permanent:
 *
 * - **one per level he stands at**, level 1 included. A newborn hero therefore
 *   already holds one point, and the promise "every level gained is another
 *   point" holds all the way up: level 16 → 16, level 100 → 100.
 * - **30 per reset behind him**, and they *stack* — the grant of every reset
 *   survives, not just the most recent one. A first reset means 31 points at
 *   level 1 and 130 at the cap; a second, 61 at level 1 and 160 at the cap.
 *
 * Because it is a pure function of (level, resets), any hero row can be checked
 * against it — which is exactly what `applyPendingUpdates` does on every load,
 * topping up a hero who was shorted his points (the admin editor sets the point
 * columns absolutely, so raising a level there used to leave the pool behind).
 */
export function heroPointPool(level: number, resets: number): number {
  const lvl = Math.min(HERO_MAX_LEVEL, Math.max(1, Math.floor(level)));
  return lvl * POINTS_PER_LEVEL + Math.max(0, Math.floor(resets)) * HERO_RESET_POINTS;
}

/**
 * The unspent points a hero holds the moment a reset lands him back at level 1:
 * his whole (larger) pool, since a reset wipes every allocated point.
 */
export function heroResetPoints(resetsAfter: number): number {
  return heroPointPool(1, resetsAfter);
}

/**
 * Unequipped items the bag can hold — a 5×3 grid of slots. When it is full no
 * new item enters it: drops (attack, boss, wheel) are skipped and unequipping
 * is refused, so the count can never exceed this.
 */
export const HERO_BAG_CAPACITY = 15;

/** XP needed to advance from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  return 120 + (level - 1) * 35;
}

/**
 * A hero's standing on one scale, resets included. A reset sends the hero back
 * to level 1, so raw level alone says nothing about a prestiged opponent: a
 * level-1 hero with one reset has already climbed the whole ladder once and
 * kept 30 points and his gear. Every reset is therefore worth a full ladder
 * (`HERO_MAX_LEVEL` levels) here, which is what makes him read as the veteran
 * he is when the two sides of a battle are compared.
 */
export const RESET_LEVEL_EQUIV = HERO_MAX_LEVEL;
export function effectiveHeroLevel(level: number, resets: number): number {
  return (
    Math.max(1, Math.floor(level)) +
    Math.max(0, Math.floor(resets)) * RESET_LEVEL_EQUIV
  );
}

/**
 * How far above you the opponent stands, as a reward factor. The comparison is
 * between *effective* levels, so a foe's resets lift him just as a foe's levels
 * do — a level-1 hero on his first reset counts as level 101 and pays like one.
 *
 * Equal standing pays exactly ×1; climbing pays more, up to ×2.5 for a foe
 * three times your standing; punching down still pays a ×0.25 floor, so farming
 * beginners is never worthless — only a small fraction of a real fight.
 */
export const MIN_LEVEL_GAP_XP_FACTOR = 0.25;
export const MAX_LEVEL_GAP_XP_FACTOR = 2.5;
export function levelGapXpFactor(ownLevel: number, foeLevel: number): number {
  const ratio = ownLevel > 0 ? foeLevel / ownLevel : 0;
  return Math.min(
    MAX_LEVEL_GAP_XP_FACTOR,
    Math.max(MIN_LEVEL_GAP_XP_FACTOR, 0.25 + ratio * 0.75)
  );
}

/**
 * How real the fight was, as a reward factor. `foePower / ownPower` is ~0 when
 * you crush someone far weaker and approaches 1 for an even match (on a win the
 * ratio is usually < 1, since the winner normally had the greater power). We map
 * it to a 0.3x–2x band so a stomp still pays a small floor while a nail-biter —
 * or an upset against a stronger foe — pays full and then some. This is what
 * makes the gain sensible relative to *who you picked*, and dynamic on every
 * attack: as both armies change, so does the ratio, so no two attacks pay the
 * same.
 *
 * **The ratio is read on a cube-root scale, not linearly.** Every ladder in this
 * game is geometric (see `upgrade-cost-curves`), so army power is spread over
 * orders of magnitude, not over a percentage band: the median *winning* attack
 * in a live season had a defender/attacker ratio of ~0.015, and the 90th
 * percentile only reached ~0.26. Read linearly, that whole range collapses onto
 * the 0.3 floor — every real fight paid the minimum, which is what players felt
 * as "attacking pays almost no XP", and it silently cancelled the level-gap
 * bonus for punching up (×2 of a floored number is still a floored number).
 * The cube root makes the factor move with the *order of magnitude* of the gap
 * instead: a foe at 1.5% of your power now reads as 0.65 rather than 0.32,
 * while a genuinely helpless target (1e-6 of your power, i.e. a bot garrison or
 * an empire with no army left) still sits on the floor. An even fight is
 * deliberately unchanged at ×1.7.
 */
export const MIN_MATCHUP_XP_FACTOR = 0.3;
export const MAX_MATCHUP_XP_FACTOR = 2;
export function matchupXpFactor(ownPower: number, foePower: number): number {
  const ratio = ownPower > 0 ? Math.max(0, foePower) / ownPower : 0;
  return Math.min(
    MAX_MATCHUP_XP_FACTOR,
    Math.max(MIN_MATCHUP_XP_FACTOR, 0.3 + Math.cbrt(ratio) * 1.4)
  );
}

/**
 * How the two sides' *prestige* compares, as a reward factor — the term that
 * makes re-climbing the ladder a matter of who you are willing to fight rather
 * than of how big the army you kept is.
 *
 * `levelGapXpFactor` already reads resets, through the effective level, and it
 * does slow a prestiged hero down: measured over a full 1→100 climb against
 * level-40 no-reset targets, one reset behind you costs ~1,130 wins where a
 * fresh player needs ~581. But it decays *gradually* and it is bounded below by
 * `MIN_LEVEL_GAP_XP_FACTOR`, so a veteran who farms rookies still climbs — just
 * at a discount. That is the wrong shape for prestige: a reset is meant to be a
 * fresh climb against your own weight class, not the same climb with a level-100
 * army pointed at people who have never had one.
 *
 * So resets get their own term, and it is a **gate rather than a slope**:
 *
 * - a foe with **as many resets as you, or more, pays in full** (×1). This is
 *   the whole rule, and the only thing a player needs to remember. It is capped
 *   at ×1 rather than paying a bonus because `levelGapXpFactor` already pays for
 *   a more-prestiged foe through his effective level — a second bonus here would
 *   count the same reset twice.
 * - every reset you stand **above** him halves it (`RESET_GAP_XP_DECAY`), down
 *   to a `MIN_RESET_GAP_XP_FACTOR` floor. One reset ahead ≈ ×4 the wins for a
 *   full climb, two ahead ≈ ×9.5 — while a fight against your own standing is
 *   left exactly where it was.
 *
 * A floor rather than zero, like every other factor in this file: a win must
 * always be worth something, or the board of legitimate targets a prestiged
 * hero can even *see* becomes the thing that gates him.
 */
export const RESET_GAP_XP_DECAY = 0.5;
export const MIN_RESET_GAP_XP_FACTOR = 0.05;
export function resetGapXpFactor(ownResets: number, foeResets: number): number {
  const gap =
    Math.max(0, Math.floor(ownResets)) - Math.max(0, Math.floor(foeResets));
  if (gap <= 0) return 1;
  return Math.max(MIN_RESET_GAP_XP_FACTOR, RESET_GAP_XP_DECAY ** gap);
}

/** Where a hero stands: his level and the resets behind him. */
export type HeroStanding = { level: number; resets: number };

/**
 * Battle XP, and the only source of it in a player battle: a winning attack.
 * Nothing else in a raid pays — not a repelled attacker, and deliberately not
 * the defender who repelled him. Defending is already rewarded by keeping what
 * you have (no plunder, no enslavement, no hero damage), and hero progress is
 * meant to be the prize for going out and taking a fight, not for sitting in a
 * city that someone else picked. A defender cannot choose his battles, so
 * paying him XP handed levels to whoever happened to be attractive to attack.
 *
 * Three terms, and each answers a different question:
 *
 * - **base** — your *own* level, so the reward keeps pace with your own curve
 *   (`xpToNextLevel` rises with it) and one win is worth roughly the same slice
 *   of a level at 5 as at 95. It reads your actual level, not the effective one:
 *   a reset hero re-climbs the same ladder and must earn it at the same pace.
 * - **level gap** — who you picked, on effective levels (see
 *   `levelGapXpFactor`), so a target above you pays more, an equal target pays
 *   ×1, and one far below you pays the ×0.25 floor. A foe's resets count here in
 *   full: a level-1 hero with one reset still pays like the level-101 veteran he
 *   effectively is.
 * - **reset gap** — whether he is in your weight class at all
 *   (`resetGapXpFactor`). Full pay for a foe of your own prestige or above,
 *   halved for every reset you stand ahead of him. The level gap answers "how
 *   far up the ladder is he"; this answers "how many ladders has he climbed",
 *   and only this one is a gate.
 * - **matchup** — how real the fight was, from the two armies' power
 *   (`matchupXpFactor`), so the number moves with every battle rather than being
 *   fixed by the two nameplates.
 */
export function attackWinXp(
  attacker: HeroStanding,
  defender: HeroStanding,
  attackerPower: number,
  defenderPower: number
): number {
  const base = 40 + Math.max(1, attacker.level) * 10;
  return Math.round(
    base *
      levelGapXpFactor(
        effectiveHeroLevel(attacker.level, attacker.resets),
        effectiveHeroLevel(defender.level, defender.resets)
      ) *
      resetGapXpFactor(attacker.resets, defender.resets) *
      matchupXpFactor(attackerPower, defenderPower)
  );
}

/**
 * Apply an XP gain, cascading level-ups (each grants POINTS_PER_LEVEL).
 * XP stops accumulating at the level cap — reset the hero to keep growing.
 */
export function applyHeroXp(
  hero: Pick<Hero, "level" | "xp">,
  gain: number
): { level: number; xp: number; pointsGained: number } {
  let { level, xp } = hero;
  let pointsGained = 0;
  if (level >= HERO_MAX_LEVEL) return { level, xp: 0, pointsGained };

  xp += Math.max(0, Math.floor(gain));
  while (level < HERO_MAX_LEVEL && xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
    pointsGained += POINTS_PER_LEVEL;
  }
  if (level >= HERO_MAX_LEVEL) xp = 0;
  return { level, xp, pointsGained };
}

/* ------------------------------ health, death & revival ------------------------------ */

/** A hero at full strength. Health is a plain 0–100 percentage. */
export const HERO_MAX_HEALTH = 100;

/**
 * Health lost every time an enemy attack breaches the empire's defence. Ten
 * lost defences fell the hero — and only a *won* attack wounds him, so a
 * repelled raid costs the defender nothing.
 */
export const HERO_DAMAGE_PER_LOST_DEFENSE = 10;

/** How long a fallen hero lies dead before rising by himself. */
export const HERO_REVIVE_HOURS = 1;
export const HERO_REVIVE_MS = HERO_REVIVE_HOURS * 3_600_000;

/** The two columns that decide whether the hero is alive — all these need. */
export type HeroVitals = Pick<Hero, "health" | "diedAt">;

/** A hero at zero health is dead: he grants nothing until he is raised. */
export function isHeroDead(hero: HeroVitals | null | undefined): boolean {
  return hero != null && hero.health <= 0;
}

/** Health remaining after taking a blow, floored at 0 (dead) and capped at full. */
export function damagedHealth(
  health: number,
  damage: number = HERO_DAMAGE_PER_LOST_DEFENSE
): number {
  return Math.max(0, Math.min(HERO_MAX_HEALTH, health) - Math.max(0, damage));
}

/** When a fallen hero rises on his own, or null while he still lives. */
export function heroReviveAt(hero: HeroVitals | null | undefined): Date | null {
  if (!hero || !isHeroDead(hero) || !hero.diedAt) return null;
  return new Date(hero.diedAt.getTime() + HERO_REVIVE_MS);
}

/** Whether the hour is up and the hero should be raised (lazy — see updates.ts). */
export function heroShouldRevive(
  hero: HeroVitals | null | undefined,
  now: Date
): boolean {
  const at = heroReviveAt(hero);
  return at !== null && at <= now;
}

/* ------------------------------ stats ------------------------------ */

/** Stats that hero points can be allocated to (each point = +1%). */
export type HeroPointStat = "attack" | "defense" | "resources";

/**
 * Stats whose item bonus is a **percentage** (multiplies the relevant power).
 * attack/defense stack on top of allocated points; spy is item-only.
 */
export type HeroPercentStat = "attack" | "defense" | "spy";

/**
 * Stats whose item bonus is a **flat count**, not a percentage — an item that
 * grants turns/citizens gives whole units, and a resources item adds a flat
 * amount to each mined resource.
 *
 * ### The three power stats
 *
 * `attackPower` / `defensePower` / `spyPower` are raw combat power, added to a
 * side's base **beside soldiers and weapons** rather than multiplying it. Gear
 * used to speak only in percentages, which is self-scaling and correct but
 * unreadable: "+40% התקפה" is a number about an army the tooltip cannot see. A
 * flat line is the same promise stated in the unit the battle report already
 * counts in, and it is what makes a found piece feel like equipment rather than
 * a modifier.
 *
 * It is safe here in a way it would not be in another game: PvP costs neither
 * side a single soldier (see `attackEmpire`) and weapons are never destroyed,
 * so power that does not depend on the army is not a new class of thing — it is
 * exactly what a weapon already is.
 *
 * ### Diamonds
 *
 * Diamonds are the real-money currency, and gear was once the faucet that broke
 * the rule the rest of the game keeps: a maxed PANTS paid 80 a day, roughly a
 * paid package a fortnight, forever. They are back, deliberately small and
 * fenced in — **one slot** carries them (👖, the pocket that used to), as its
 * *minor* extra, so the ladder a player climbs runs +1 → +25 **per daily update**
 * (2 → 50 a day) rather than +80. The season pass and the wheel still mint none
 * that scale.
 */
export type HeroFlatStat =
  | "resources"
  | "turns"
  | "citizens"
  | "attackPower"
  | "defensePower"
  | "spyPower"
  | "diamonds";

/** Every stat the hero surfaces: the percentage stats + the flat-count stats. */
export type HeroStat = HeroPercentStat | HeroFlatStat;

/* ------------------------------ when a flat stat is paid ------------------------------ */

/**
 * **When** a flat item bonus is actually handed over. Three cadences, and every
 * flat stat has exactly one:
 *
 * - `regular` — the 5-minute production tick. The empire's own clock, and where
 *   gear belongs by default: an item you equip changes what you can afford this
 *   hour, not tomorrow morning.
 * - `daily` — the twice-a-day update (07:30 / 19:30 Asia/Jerusalem). Only the two
 *   stats whose *base* is itself paid daily live here: citizens (the growth
 *   building pays per daily update) and diamonds (a deliberate trickle — the paid
 *   currency must never be a per-tick faucet).
 * - `battle` — not on a clock at all. The three flat power stats are counted
 *   inside a fight, beside soldiers and weapons, every time one happens.
 *
 * This table is the **single source of truth** for the cadence: `applyPendingUpdates`
 * pays each stat by the count its cadence names (see `lib/game/updates.ts`), and
 * the hero page groups its yield lines under these same three headings. A stat
 * cannot drift between what the code pays and what the screen promises, which is
 * exactly what happened before: turns were paid per *daily* update while the item
 * tooltips of the same build had said "per regular update" for months.
 */
export type HeroFlatCadence = "regular" | "daily" | "battle";

/** Display order — the two clock cadences first, fastest first, then battle. */
export const HERO_CADENCE_ORDER: HeroFlatCadence[] = ["regular", "daily", "battle"];

export interface HeroCadenceMeta {
  /** Heading a UI groups this cadence's lines under. */
  label: string;
  /** The note a single stat line carries. */
  note: string;
}

export const HERO_CADENCE_META: Record<HeroFlatCadence, HeroCadenceMeta> = {
  regular: { label: "בכל עדכון רגיל", note: "נוסף בכל עדכון רגיל" },
  daily: { label: "בכל עדכון יומי", note: "נוסף בכל עדכון יומי" },
  battle: { label: "בכל קרב", note: "נספר בקרב עצמו — לא על השעון" },
};

export const HERO_FLAT_CADENCE: Record<HeroFlatStat, HeroFlatCadence> = {
  resources: "regular",
  // Turns ride the 5-minute tick, in the same unit as the TURNS_PER_REGULAR_UPDATE
  // upgrade — see the turns note in FLAT_CURVE for what that costs and what it buys.
  turns: "regular",
  citizens: "daily",
  diamonds: "daily",
  attackPower: "battle",
  defensePower: "battle",
  spyPower: "battle",
};

/** The flat stats paid on one cadence, in HERO_FLAT_STATS order. */
export function flatStatsWithCadence(cadence: HeroFlatCadence): HeroFlatStat[] {
  return HERO_FLAT_STATS.filter((stat) => HERO_FLAT_CADENCE[stat] === cadence);
}

/**
 * How many times a cadence comes round in a day — 288 ticks, two daily updates,
 * and 0 for the battle stats, which have no clock at all.
 */
export const UPDATES_PER_DAY: Record<HeroFlatCadence, number> = {
  regular: TICKS_PER_DAY,
  daily: DAILY_UPDATE_TIMES.length,
  battle: 0,
};

/**
 * What a flat bonus adds up to over a full day, or null for a stat with no
 * cadence to add up (the battle stats). This is the figure that makes the two
 * clocks comparable — 5 turns a tick and 450 citizens a daily update are 1,440
 * and 900 a day respectively — so the hero page can state both without the
 * player having to know how many ticks a day holds.
 */
export function flatStatPerDay(stat: HeroFlatStat, value: number): number | null {
  const updates = UPDATES_PER_DAY[HERO_FLAT_CADENCE[stat]];
  return updates === 0 ? null : value * updates;
}

export interface HeroStatMeta {
  label: string;
  /** Shared icon-set name — resource stats wear the same glyph as everywhere. */
  icon: IconName;
  tone: string;
  /** Present only on stats that accept allocated hero points. */
  pointsField?: "attackPoints" | "defensePoints" | "resourcePoints";
  description: string;
  /** Short noun for the line under an item, e.g. "התקפה" / "תורות לעדכון יומי". */
  itemLabel: string;
}

export const HERO_STAT_META: Record<HeroStat, HeroStatMeta> = {
  attack: {
    label: "התקפה",
    itemLabel: "התקפה",
    icon: "attack",
    tone: "text-red-400",
    pointsField: "attackPoints",
    description: "כל אחוז מגדיל את כוח הצבא שלך בתקיפה.",
  },
  defense: {
    label: "הגנה",
    itemLabel: "הגנה",
    icon: "shield",
    tone: "text-sky-300",
    pointsField: "defensePoints",
    description: "כל אחוז מגדיל את כוח הצבא שלך בהגנה מפני תקיפות.",
  },
  resources: {
    label: "משאבים",
    itemLabel: "משאבים לעדכון רגיל",
    icon: "mine",
    tone: "text-emerald-400",
    pointsField: "resourcePoints",
    // Points give a %; items give either, decided per slot (see SlotStatWeight).
    description:
      "כל אחוז נקודות מגדיל את תפוקת המכרות. פרי שטן, מכנסיים ונעליים מוסיפים משאבים בכמות קבועה בכל עדכון רגיל; חרב ומגן מגדילים את תפוקת המכרות באחוזים.",
  },
  spy: {
    label: "ריגול",
    itemLabel: "ריגול",
    icon: "spy",
    tone: "text-fuchsia-300",
    description: "כל אחוז מחפצים מגדיל את סיכוי הצלחת משימת הריגול שלך.",
  },
  turns: {
    label: "תורות",
    itemLabel: "תורות לעדכון רגיל",
    icon: "turns",
    tone: "text-amber-300",
    // Per regular (5-minute) tick, like the resource lines and like the upgrade
    // that exists for turns — HERO_FLAT_CADENCE is the rule, and the FLAT_CURVE
    // note explains why the ceiling is quoted in the upgrade's own unit.
    description: "חפצים מוסיפים תורות בכמות קבועה בכל עדכון רגיל (לא באחוזים).",
  },
  citizens: {
    label: "אזרחים",
    itemLabel: "אזרחים לעדכון יומי",
    icon: "citizens",
    tone: "text-lime-300",
    description: "חפצים מוסיפים אזרחים בכמות קבועה בכל עדכון יומי (לא באחוזים).",
  },
  attackPower: {
    label: "כוח התקפה",
    itemLabel: "כוח התקפה",
    icon: "attack",
    tone: "text-red-300",
    description:
      "כוח קרב קבוע שנוסף לצבא שלך בתקיפה, בדיוק כמו כוח מנשקים — ואז כל האחוזים מוכפלים גם עליו.",
  },
  defensePower: {
    label: "כוח הגנה",
    itemLabel: "כוח הגנה",
    icon: "shield",
    tone: "text-sky-200",
    description:
      "כוח קרב קבוע שנוסף לצבא שלך בהגנה, בדיוק כמו כוח מנשקים — ואז כל האחוזים מוכפלים גם עליו.",
  },
  spyPower: {
    label: "כוח ריגול",
    itemLabel: "כוח ריגול",
    icon: "spy",
    tone: "text-fuchsia-200",
    description:
      "כוח ריגול קבוע שנוסף למרגלים ולנשקי הריגול שלך בכל משימת ריגול, לפני מכפיל המודיעין.",
  },
  diamonds: {
    label: "יהלומים",
    itemLabel: "יהלומים לעדכון יומי",
    icon: "diamond",
    tone: "text-cyan-300",
    description:
      "סלוט אחד בלבד (מכנסיים) מזקק יהלומים, ובכמות קטנה — עד 25 בכל עדכון יומי בציוד המקסימלי.",
  },
};

/**
 * Label for a resource line paid as a percentage. It cannot come from
 * HERO_STAT_META like every other line, because `resources` is the one stat with
 * two instruments and the two need different words: the flat lines name the
 * resource and its cadence ("אבן לעדכון רגיל"), while a percentage multiplies
 * every mine at once and has no cadence to state.
 */
export const RESOURCE_PCT_ITEM_LABEL = "תפוקת המכרות";

export const HERO_STATS = Object.keys(HERO_STAT_META) as HeroStat[];

/** The three point-allocatable stats, in display order. */
export const HERO_POINT_STATS: HeroPointStat[] = ["attack", "defense", "resources"];

/** Stats whose item bonus is a percentage (attack/defense stack with points). */
export const HERO_PERCENT_STATS: HeroPercentStat[] = ["attack", "defense", "spy"];

/** Stats whose item bonus is a flat count of whole units. */
export const HERO_FLAT_STATS: HeroFlatStat[] = [
  "resources",
  "turns",
  "citizens",
  "attackPower",
  "defensePower",
  "spyPower",
  "diamonds",
];

/**
 * The three flat combat stats, and which battle number each one reinforces.
 * Everything that adds gear power to a fight reads this rather than naming the
 * three keys again.
 */
export const HERO_POWER_STATS = ["attackPower", "defensePower", "spyPower"] as const;
export type HeroPowerStat = (typeof HERO_POWER_STATS)[number];

/** The flat power stat that reinforces a percentage stat's side of a battle. */
export const POWER_STAT_FOR: Record<HeroPercentStat, HeroPowerStat> = {
  attack: "attackPower",
  defense: "defensePower",
  spy: "spyPower",
};

/** Whether a stat's item bonus is a flat count (true) or a percentage (false). */
export function statIsFlat(stat: HeroStat): stat is HeroFlatStat {
  return (HERO_FLAT_STATS as HeroStat[]).includes(stat);
}

/* ------------------------------ tiers (derived from level) ------------------------------ */

/**
 * An item's tier (its "rarity") is derived purely from its level — two items
 * of the same slot and level are always identical. The named series repeats
 * every 10 levels: within each decade, offsets 1-2 are פשוט, 3-7 מתקדם,
 * 8-9 אליט, 10 אגדי; then the pattern begins again one decade higher.
 */

/** UI rarity key used by ItemTile (lowercase) for each tier. */
export type UiRarity = "common" | "rare" | "epic" | "legendary";

export interface RarityMeta {
  label: string;
  ui: UiRarity;
  tone: string;
}

/** Ordered lowest → highest tier within a series. */
export const RARITY_ORDER: HeroRarity[] = ["COMMON", "RARE", "EPIC", "LEGENDARY"];

export const RARITY_META: Record<HeroRarity, RarityMeta> = {
  COMMON: { label: "פשוט", ui: "common", tone: "text-emerald-300" },
  RARE: { label: "מתקדם", ui: "rare", tone: "text-sky-300" },
  EPIC: { label: "אליט", ui: "epic", tone: "text-purple-300" },
  LEGENDARY: { label: "אגדי", ui: "legendary", tone: "text-gold-bright" },
};

/** The tier an item of the given level belongs to (repeats every 10 levels). */
export function tierForLevel(level: number): HeroRarity {
  const offset = ((Math.max(1, level) - 1) % 10) + 1; // 1..10 within the decade
  if (offset <= 2) return "COMMON";
  if (offset <= 7) return "RARE";
  if (offset <= 9) return "EPIC";
  return "LEGENDARY";
}

/* ------------------------------ item upgrades ------------------------------ */

/**
 * The level where each tier band begins, within a decade: פשוט at +1,
 * מתקדם at +3, אליט at +8, אגדי at +10. Upgrading an item jumps its level to
 * the next of these — i.e. up to the start of the next tier, and never past the
 * אגדי that closes the decade (see `nextTierLevel`).
 */
const BAND_START_OFFSETS = [1, 3, 8, 10];

/**
 * Every rung of the ladder, ascending: 1,3,8,10,11,13,…,100. These are the
 * levels an item can *sit* on — the band starts drops land on and upgrades climb
 * to — but a rung that opens a new decade (11, 21, …) is only ever reached by
 * finding a piece of that set, never by upgrading into it.
 */
export const UPGRADE_LEVELS: number[] = Array.from(
  { length: HERO_MAX_LEVEL / 10 },
  (_, decade) => decade * 10
).flatMap((base) => BAND_START_OFFSETS.map((o) => base + o));

/**
 * The level an item reaches when upgraded, or null when it has nothing left to
 * upgrade into.
 *
 * **An אגדי is the ceiling of its set.** Upgrading walks a piece up its own
 * decade — 1 → 3 → 8 → 10 — and stops there: every set has a maximum of its own,
 * and no amount of gold carries a piece across into the set above it. The only
 * way into the next set is to *find* a piece of it, which is what keeps the gear
 * ladder a matter of playing rather than of banking gold.
 */
export function nextTierLevel(level: number): number | null {
  if (tierForLevel(level) === "LEGENDARY") return null;
  for (const v of UPGRADE_LEVELS) if (v > level) return v;
  return null;
}

/**
 * True when an item cannot be upgraded because its *set* has run out, not
 * because the game has: an אגדי below level 100. The distinction is the whole
 * message to the player — this piece is finished, the next one is loot.
 */
export function atSetCeiling(level: number): boolean {
  return nextTierLevel(level) === null && level < HERO_MAX_LEVEL;
}

/**
 * An item's rung on the upgrade ladder: how many upgrade levels it has reached
 * (1..40). This — not the raw level — drives the bonus, because every upgrade
 * advances the item by exactly one rung, so bonuses keyed to the rung are
 * *guaranteed* to strictly increase on each upgrade (never the +17 → +17 that a
 * rounded level-based bonus produced when a rate fell below 1/level). A dropped
 * item at any level shares the rung of the last upgrade level it has passed, so
 * two items in the same tier band (e.g. levels 41 and 42) read identically.
 */
export function upgradeStep(level: number): number {
  let k = 0;
  for (const v of UPGRADE_LEVELS) {
    if (v <= level) k += 1;
    else break;
  }
  return Math.max(1, k);
}

/**
 * Upgrade prices are **geometric in the target level**, not linear — the two
 * ends of the ladder are the anchors and every rung between them is filled in
 * by the same ratio:
 *
 *   - the first series' last step (אליט → אגדי, target level 10) costs 3M
 *   - the last series' last step (target level 100) costs 700B
 *
 * That is a factor of ~233,000 spread over 90 levels — ≈ +14.7% per level, or
 * **×3.95 per series**. So each decade of gear is worth about four times the
 * decade below it, forever, instead of the old linear curve where a level-100
 * upgrade cost only ten times a level-10 one and late-game gold had nothing to
 * buy. Prices are rounded to three significant figures so they read as prices.
 */
export const UPGRADE_COST_AT_LEVEL_10 = 3_000_000;
export const UPGRADE_COST_AT_LEVEL_100 = 700_000_000_000;

/** Per-level growth factor derived from the two anchors above (≈1.1472). */
export const UPGRADE_COST_GROWTH = Math.pow(
  UPGRADE_COST_AT_LEVEL_100 / UPGRADE_COST_AT_LEVEL_10,
  1 / 90
);

/**
 * Round to three significant figures — 3M, 11.9M, 47M, 700B, never 46,847,113.
 *
 * Shared by the two geometric curves in this file (upgrade prices and the flat
 * resource bonus). Both are exponentials whose raw output is a long irrational
 * number at every rung, and both are read by players as a figure rather than a
 * measurement. Always lands on a whole number: the magnitude is floored at 1.
 */
function roundSignificant(value: number): number {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 2);
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Gold needed to upgrade one item to the next tier level, or null when there is
 * nothing to upgrade into — an אגדי, which closes its set.
 */
export function itemUpgradeCost(level: number): number | null {
  const target = nextTierLevel(level);
  if (target === null) return null;
  return roundSignificant(
    UPGRADE_COST_AT_LEVEL_10 * UPGRADE_COST_GROWTH ** (target - 10)
  );
}

/* ------------------------------ item slots ------------------------------ */

/**
 * How a slot pays a stat it grants. Every stat but `resources` has exactly one
 * possible mode (see `statIsFlat`); `resources` is the one stat a slot can pay
 * either way, and the slot decides — see `SlotStatWeight.mode`.
 */
export type SlotStatMode = "flat" | "pct";

/**
 * One stat an item's slot grants, how heavily it weighs it, and — for
 * `resources` only — whether it pays in whole units or in percent.
 *
 * **Resources are the one stat with two instruments**, because mine output is
 * multiplicative (slaves × mine level × cities) while a flat grant is additive.
 * A single global choice therefore cannot work: measured against a played
 * empire, a flat grant sized to matter at level 100 flattens the early game,
 * and one sized for the early game is a rounding error by mid-game. So the two
 * live side by side and cover different halves of the curve:
 *
 * - **flat** — פרי שטן, מכנסיים, נעליים. Whole units per regular update, on the
 *   squared rung curve. That curve happens to track empire income almost
 *   exactly, so a flat item holds a near-constant *share* of a mine's output at
 *   every level (~11% for a primary at the current cap). This is the instrument
 *   that carries the early game, when a mine produces hundreds per tick.
 * - **pct** — חרב, מגן. A percentage on the linear rung curve, multiplying mine
 *   production alongside the hero's allocated resource points. Deliberately
 *   small early (a rung-6 extra is +2.1%) and dominant late (+14% at rung 40),
 *   which is what a percentage of a multiplicative economy is worth.
 *
 * The two meet at roughly the same value at level 100, so neither instrument is
 * strictly better — they are early-game and late-game answers to the same need.
 *
 * Omitted `mode` means the stat's own nature decides, which is the only option
 * for every stat except `resources`.
 */
export interface SlotStatWeight {
  stat: HeroStat;
  weight: number;
  /** Only meaningful on `resources`; ignored on every other stat. */
  mode?: SlotStatMode;
}

export interface SlotMeta {
  label: string;
  icon: string;
  /** Names the art file: see `heroItemArtPath` in `heroSets.ts` (set per decade). */
  slug: string;
  /**
   * What this slot grants: the **primary** stat first (full weight), then the
   * extras, deepest first. Never empty.
   */
  stats: readonly SlotStatWeight[];
  /**
   * For a slot that grants `resources`: which resources it feeds, and in what
   * order. A piece covers as many of these as its tier allows (see
   * `RESOURCE_TIER_COVERAGE`), so the *first* entry is what a פשוט piece of this
   * slot conjures, and only an אגדי reaches the fourth.
   *
   * Each flat resource slot leads with a different resource, which is the
   * cheapest way to make two items of the same tier a real choice: an early
   * מכנסיים solves an iron shortage, an early פרי שטן a gold one. Omitted on
   * slots that grant no resources — and on the slots that pay them as a
   * percentage, which multiplies every mine at once and so has nothing to lead
   * with (see `SlotStatWeight.mode`).
   */
  resourceOrder?: readonly StorableResource[];
}

/** Fixed 3x3 equipment layout order. */
export const SLOT_ORDER: HeroItemSlot[] = [
  "RELIC",
  "HELMET",
  "WINGS",
  "ARMOR",
  "SHIELD",
  "SWORD",
  "BOOTS",
  "PANTS",
  "GAUNTLETS",
];

/**
 * Weight of a slot's headline stat vs. the extras riding along with it.
 *
 * Every item used to grant exactly one stat, which made gear a set of nine
 * single-purpose sliders: a sword was worth wearing or it wasn't, and there was
 * no reason to ever compare two items in different slots. Giving each slot one
 * generous stat plus a couple of smaller ones means a piece reads as a
 * character — "the sword that also drags home loot and captives" — and two
 * builds at the same hero level can differ.
 *
 * The extras come in **three graded weights** rather than one. When every extra
 * was worth the same quarter, the second and third lines of every item read
 * identically and the only thing distinguishing two slots was *which* stats they
 * listed. Grading them means a slot also has a shape: a specialist spends its
 * whole extra budget on one stat (כפפות pour everything into defence, שריון into
 * citizens), while a generalist splits it between two at different depths.
 *
 * Every slot spends the same total budget — 1.5 for the specialists, 1.6 for the
 * generalists — so no slot is strictly better than another; they differ in how
 * the budget is spread. (This is also what finally brought כפפות and שריון up to
 * par: they carried a single quarter-extra and were a flat 1.25 while every
 * other slot was 1.5.)
 */
export const PRIMARY_WEIGHT = 1;
/** A specialist's single extra — its whole budget in one stat. */
export const MAJOR_EXTRA_WEIGHT = 0.5;
/** The deeper of a generalist's two extras. */
export const EXTRA_WEIGHT = 0.35;
/** The shallower of a generalist's two extras. */
export const MINOR_EXTRA_WEIGHT = 0.25;

/** Every extra weight, for the invariants that must hold across all of them. */
export const EXTRA_WEIGHTS = [
  MAJOR_EXTRA_WEIGHT,
  EXTRA_WEIGHT,
  MINOR_EXTRA_WEIGHT,
] as const;

const primary = (stat: HeroStat, mode?: SlotStatMode): SlotStatWeight => ({
  stat,
  weight: PRIMARY_WEIGHT,
  mode,
});
const major = (stat: HeroStat, mode?: SlotStatMode): SlotStatWeight => ({
  stat,
  weight: MAJOR_EXTRA_WEIGHT,
  mode,
});
const extra = (stat: HeroStat, mode?: SlotStatMode): SlotStatWeight => ({
  stat,
  weight: EXTRA_WEIGHT,
  mode,
});
const minor = (stat: HeroStat, mode?: SlotStatMode): SlotStatWeight => ({
  stat,
  weight: MINOR_EXTRA_WEIGHT,
  mode,
});

/**
 * How `slot` pays `stat`. Everything but `resources` has a single possible
 * answer; a resource slot states its own, defaulting to flat so a new slot that
 * forgets to declare behaves like the dedicated resource slots.
 *
 * Only meaningful for a stat the slot actually grants — check `slotGrants`
 * first. For one it does not, the answer is that default rather than "neither",
 * which would read as "this slot pays flat resources" if trusted on its own.
 */
export function slotStatMode(slot: HeroItemSlot, stat: HeroStat): SlotStatMode {
  if (stat !== "resources") return statIsFlat(stat) ? "flat" : "pct";
  return SLOT_META[slot].stats.find((s) => s.stat === stat)?.mode ?? "flat";
}

/**
 * Whether this slot pays `stat` in whole units rather than percent. Carries the
 * same precondition as `slotStatMode` — ask only about a stat the slot grants.
 */
export function slotStatIsFlat(slot: HeroItemSlot, stat: HeroStat): boolean {
  return slotStatMode(slot, stat) === "flat";
}

/**
 * Slot → stat profile. Each line reads "primary ‖ extras, deepest first".
 *
 * The thematic logic: what a piece of equipment *does* decides what it pays.
 * Blades and gauntlets strike; armour and shields hold; the visor scouts; the
 * relic conjures; wings carry you further in a day; pockets and boots are the
 * quartermaster's slots. The extras are the second-order consequence of the
 * same idea — a sword drags home loot and captives, a shield's wall buys time,
 * the relic's magic sharpens the hand and the eye that wield it.
 *
 * Two of the nine are **specialists** — כפפות (attack ‖ a deep defence) and
 * שריון (defense ‖ a deep citizens) — spending their whole extra budget on a
 * single stat instead of splitting it. They are the slots you take when you know
 * what you are building; the other seven hedge.
 *
 * Every one of the six percentage/economy stats is the primary of at least one
 * slot, so no build can corner a stat by hoarding a single slot, and each
 * appears as an extra somewhere else so there is always more than one route to
 * it.
 *
 * ### The power twins
 *
 * Every combat percentage a slot grants is **mirrored by a flat power line at
 * the same weight** — a slot that pays attack% pays attackPower, a slot that
 * pays a minor defence% pays a minor defensePower. That is a rule, not nine
 * separate decisions, so a slot's combat identity is stated once and cannot
 * drift between its two instruments.
 *
 * The power lines are a *parallel* budget, not a share of the percentage one:
 * they are new value, and the whole reason gear now reads as equipment rather
 * than as a modifier. 🥾 is the one slot with no power line at all, because it
 * is the one slot that grants no combat stat — the quartermaster does not
 * fight.
 */
export const SLOT_META: Record<HeroItemSlot, SlotMeta> = {
  SWORD: {
    label: "חרב",
    icon: "🗡️",
    slug: "sword",
    // No resourceOrder: a percentage multiplies every mine at once, so there is
    // no single resource for the slot to lead with.
    stats: [
      primary("attack"),
      primary("attackPower"),
      extra("resources", "pct"),
      minor("citizens"),
    ],
  },
  GAUNTLETS: {
    label: "כפפות",
    icon: "🧤",
    slug: "gauntlet",
    stats: [
      primary("attack"),
      primary("attackPower"),
      major("defense"),
      major("defensePower"),
    ],
  },
  HELMET: {
    label: "קסדה",
    icon: "🪖",
    slug: "helmet",
    stats: [
      primary("spy"),
      primary("spyPower"),
      extra("turns"),
      minor("defense"),
      minor("defensePower"),
    ],
  },
  ARMOR: {
    label: "שריון",
    icon: "🛡️",
    slug: "armor",
    stats: [primary("defense"), primary("defensePower"), major("citizens")],
  },
  SHIELD: {
    label: "מגן",
    icon: "🔰",
    slug: "buckler",
    // No resourceOrder — see חרב above.
    stats: [
      primary("defense"),
      primary("defensePower"),
      extra("resources", "pct"),
      minor("turns"),
    ],
  },
  RELIC: {
    label: "פרי שטן",
    icon: "😈",
    slug: "demon-fruit",
    stats: [
      primary("resources", "flat"),
      extra("attack"),
      extra("attackPower"),
      minor("spy"),
      minor("spyPower"),
    ],
    // The conjurer's slot — the canonical order, gold first.
    resourceOrder: ["gold", "wood", "iron", "stone"],
  },
  WINGS: {
    label: "כנפיים",
    icon: "🪽",
    slug: "wings",
    stats: [
      primary("turns"),
      extra("spy"),
      extra("spyPower"),
      minor("attack"),
      minor("attackPower"),
    ],
  },
  PANTS: {
    // The pocket that used to be the diamond slot, and is again — as its minor
    // extra only, a trickle rather than the old +80 a day (see HeroFlatStat).
    label: "מכנסיים",
    icon: "👖",
    slug: "pants",
    stats: [
      primary("resources", "flat"),
      extra("defense"),
      extra("defensePower"),
      minor("citizens"),
      minor("diamonds"),
    ],
    // The quartermaster's pockets — what an army actually runs out of.
    resourceOrder: ["iron", "gold", "stone", "wood"],
  },
  BOOTS: {
    label: "נעליים",
    icon: "🥾",
    slug: "boots",
    stats: [primary("citizens"), extra("turns"), minor("resources", "flat")],
    // What you can carry home on foot: whatever you walked over.
    resourceOrder: ["stone", "wood", "gold", "iron"],
  },
};

/** The stat a slot exists for — its headline, shown on the tile. */
export function slotPrimaryStat(slot: HeroItemSlot): HeroStat {
  return SLOT_META[slot].stats[0].stat;
}

/** Whether a slot grants `stat` at all, primary or extra. */
export function slotGrants(slot: HeroItemSlot, stat: HeroStat): boolean {
  return SLOT_META[slot].stats.some((s) => s.stat === stat);
}

/* ------------------------------ item catalog ------------------------------ */

/**
 * The catalog shows one representative item per tier-band start level, per
 * slot — 1,3,8,10,11,… (the same levels an item can be upgraded to).
 */
export const ITEM_LEVELS: number[] = UPGRADE_LEVELS;

/**
 * Bonuses scale with the item's upgrade *rung* (see `upgradeStep`), not its raw
 * level. There are 40 rungs (levels 1→100), and the cap tables below are what a
 * primary is worth on the fortieth.
 */

/** Rungs on the ladder — what the curve is normalised against. */
export const MAX_UPGRADE_STEP = UPGRADE_LEVELS.length; // 40

/**
 * Percentage added per upgrade rung, at PRIMARY_WEIGHT, for the percentage
 * stats. 1%/rung → a level-100 item grants 40% in its primary stat, and its
 * extras a fraction of that (14% / 10%).
 *
 * Percentages scale **linearly** with the rung, and they are the only stats that
 * do. They can afford to: a percentage is already relative to the army it
 * multiplies, so +1% is a small bonus to a beginner and a small bonus to a
 * veteran. The flat stats have no such property — see FLAT_CURVE.
 *
 * They are also not rounded to whole percent. An extra on a rung-1 item is
 * genuinely worth a quarter of a percent, and printing that as "+1%" (the old
 * floor did) made the cheapest item in the game claim the same defence bonus as
 * a slot that exists for defence.
 */
export const PCT_PER_STEP = 1;

/**
 * How a flat stat climbs across the 40 rungs. Two shapes, because the two
 * things flat stats are measured against do not grow the same way — see
 * FLAT_CURVE for which stat takes which and why.
 *
 * Both are stated as anchors rather than as a slope, so the numbers in the table
 * are the numbers a player sees at the two ends of the ladder. Everything in
 * between is filled in by the shape.
 */
/**
 * ### The combat-power anchors
 *
 * Flat power is the one gear stat measured against something outside the hero:
 * the weapon ladder, which is what a player's power is actually made of. A
 * weapon's power is ×2.5 a tier and four tiers open every ten hero levels, so
 * the thing an item's flat power has to be priced against grows by ~×39 per
 * decade — and stops dead at tier 30, which a hero-70 empire has already
 * unlocked.
 *
 * Both anchors are therefore stated as *weapons of the tier that item's level
 * can field*:
 *
 *   - rung 1 (a level-1 piece):  250 ≈ three tier-4 weapons, or 25 soldiers.
 *     A beginner's whole army is a few hundred power, so the first sword he
 *     finds is felt the moment he equips it.
 *   - rung 40 (a level-100 piece):  5T ≈ three tier-30 weapons (1.73T each),
 *     which is roughly what a maxed relic's own resource line buys in a day.
 *
 * That is ×1.837 a rung, ×11.4 a set. Deliberately **flatter than the weapon
 * curve it is priced against**: gear power leads early, and by the endgame a
 * full set is a respectable slice of an army rather than a replacement for one.
 * Chasing the weapon curve instead would either round to +1 for the first
 * twenty rungs or hand a level-100 player a second arsenal for free.
 *
 * Both are one constant each — retune here and the whole ladder follows.
 */
export const POWER_AT_FIRST_STEP = 250;
export const POWER_AT_MAX_STEP = 5_000_000_000_000;

export type FlatCurve =
  /**
   * Constant *relative* growth: every rung multiplies the bonus by the same
   * factor, derived from the two anchors. This is the same instrument the
   * upgrade-price curve uses (see UPGRADE_COST_GROWTH) and it is the only shape
   * under which "one upgrade" means the same thing at every point on the ladder.
   */
  | { shape: "geometric"; atFirstStep: number; atMaxStep: number }
  /**
   * A power of the rung's progress: `atMaxStep · (rung / 40) ** exponent`. The
   * bonus starts at a rounding error and accelerates, so the whole first series
   * stays inside single digits. Right for a stat whose *base* barely grows.
   */
  | { shape: "power"; atMaxStep: number; exponent: number };

/**
 * What a **primary** flat stat is worth at each end of the upgrade ladder. The
 * units differ wildly — a turn is not a citizen — so each stat carries its own
 * curve, and an extra takes its weighted share of the same numbers.
 *
 * ### resources — geometric, 1,500 → 350,000,000 per regular update
 *
 * The squared curve this replaced was measured against mine output and held a
 * near-constant *share* of it, which sounded right and played wrong: a share of
 * an economy that is itself near zero is near zero. The first six rungs paid
 * +1, +5, +11, +20, +31, +45 — an item you win, equip, and cannot detect. A
 * level-1 item now conjures 1,500 of its resource every five minutes, which is
 * many times what a first-city empire's mines produce and is the point: early
 * gear is *supposed* to change what you can afford that hour.
 *
 * The ceiling is set against the other end of the same complaint. A level-100
 * empire settles resources in the billions per update, so the old 2,000 was as
 * invisible at the top of the ladder as +1 was at the bottom.
 *
 * Geometric is what makes the middle honest: ×1.373 per rung, so **every**
 * upgrade is worth the same +37% no matter where you stand. That lands within a
 * hair of the price curve it is paid for with — the bonus rises ×3.55 per
 * series against a price that rises ×3.95 — so gold buys roughly constant value
 * from the first upgrade to the fortieth.
 *
 *   resources, as a primary:  rung 1 → 1,500 · rung 5 (a level-11 relic) →
 *   5,330 · rung 10 → 26,000 · rung 20 → 619,000 · rung 40 → 350,000,000
 *
 * ### citizens — power 1.75, up to 450 per daily update
 *
 * Citizens do not get the same treatment, because they are the one flat stat
 * whose base does *not* grow with the economy: the empire's growth building pays
 * 20 + 10·level per daily update and caps at 1,020 with ten cities, full stop. A
 * citizen is also the cheapest unit of anything — it buys a soldier, a spy or a
 * mine slave — and nothing caps the population, so all of it lands. Gear that
 * out-paid the building that exists for the job would retire it.
 *
 * So citizens keep the accelerating shape and a deliberately small ceiling: the
 * whole first series (levels 1–10) runs 1 → 8, and the ladder ends at 450, well
 * under the building's own 1,020.
 *
 *   citizens, as a primary:  rung 1 → +1 · rung 4 (a level-10 boot) → +8 ·
 *   rung 10 → +40 · rung 20 → +134 · rung 40 → +450
 *
 * ### turns — power 2, up to 5 per regular update
 *
 * Turns are paid on the 5-minute tick like the resource lines (see
 * HERO_FLAT_CADENCE), and the ceiling is stated **in the unit of the upgrade that
 * exists for turns**: `turnsPerRegularUpdate` pays its level, capped at
 * TURNS_UPGRADE_MAX_LEVEL = 5. So a maxed primary turn item is worth exactly the
 * whole upgrade ladder — 5 a tick, {@link TICKS_PER_DAY} × 5 = 1,440 a day — and
 * every rung below it reads as "so many upgrade levels".
 *
 * The cadence is the reason the number moved (it was 40 per *daily* update, i.e.
 * 80 a day). Whole units on a 288-a-day clock have a floor nothing can go under:
 * **any** turn line at all is at least 1 a tick, which is 288 a day, which is one
 * upgrade level given away with the first wing a beginner finds. That is a real
 * gift and it is priced in deliberately — it is the same promise the resource
 * lines already make, that gear changes what you can do *this hour* — but it is
 * also why the ceiling is 5 rather than something that would let the four
 * turn-granting slots stack past a couple of upgrade ladders at level 100.
 *
 * The price of the floor is a flat line early: the whole first half of the ladder
 * pays 1 a tick, and the five distinct values (1→5) are all this stat can hold.
 * That is fine for a line no upgrade is bought *for* — a wing's own price is
 * carried by its spy and power lines, which are geometric — and it is what keeps
 * the game's one metered currency from being minted by gear.
 *
 * Note what the power curves cost: on turns and citizens the first few rungs all
 * round to +1, so those *lines* stand still early. The item as a whole never
 * does — its percentage extras move on every single rung, and a resource item
 * widens its coverage with every tier (see resourceItemResources).
 */
export const FLAT_CURVE: Record<HeroFlatStat, FlatCurve> = {
  resources: { shape: "geometric", atFirstStep: 1_500, atMaxStep: 350_000_000 },
  // Per *regular* update, and the ceiling is TURNS_UPGRADE_MAX_LEVEL: a maxed
  // primary wing is worth the whole turns-upgrade ladder. See the turns note above.
  turns: { shape: "power", atMaxStep: TURNS_UPGRADE_MAX_LEVEL, exponent: 2 },
  citizens: { shape: "power", atMaxStep: 450, exponent: 1.75 },
  // The three combat-power curves are one curve, used three times — see the
  // POWER_CURVE note below for what the two anchors are measured against.
  attackPower: {
    shape: "geometric",
    atFirstStep: POWER_AT_FIRST_STEP,
    atMaxStep: POWER_AT_MAX_STEP,
  },
  defensePower: {
    shape: "geometric",
    atFirstStep: POWER_AT_FIRST_STEP,
    atMaxStep: POWER_AT_MAX_STEP,
  },
  spyPower: {
    shape: "geometric",
    atFirstStep: POWER_AT_FIRST_STEP,
    atMaxStep: POWER_AT_MAX_STEP,
  },
  // Stated unweighted like every other curve, but no slot carries diamonds as a
  // primary: 👖 pays them as its *minor* extra, so a quarter of this is the
  // whole ladder — +1 per daily update at the bottom, +25 in the divine set (2
  // and 50 a day). The accelerating shape keeps the first four series at a
  // trickle, which is the point: a diamond faucet must be an endgame trophy,
  // never an income — and never on the 5-minute clock (HERO_FLAT_CADENCE).
  diamonds: { shape: "power", atMaxStep: 100, exponent: 2.2 },
};

/**
 * What one upgrade multiplies a geometric flat stat by (resources ≈ ×1.373), or
 * null for a stat on a power curve, where no such single number exists — that is
 * the difference between the two shapes, stated as a function.
 */
export function flatCurveGrowth(stat: HeroFlatStat): number | null {
  const curve = FLAT_CURVE[stat];
  if (curve.shape !== "geometric") return null;
  return (curve.atMaxStep / curve.atFirstStep) ** (1 / (MAX_UPGRADE_STEP - 1));
}

/**
 * The unweighted value of a flat stat on a given rung — the curve itself,
 * before the slot's weight and before rounding.
 */
function flatCurveValue(stat: HeroFlatStat, step: number): number {
  const curve = FLAT_CURVE[stat];
  if (curve.shape === "power") {
    return curve.atMaxStep * (step / MAX_UPGRADE_STEP) ** curve.exponent;
  }
  return curve.atFirstStep * flatCurveGrowth(stat)! ** (step - 1);
}

/**
 * How many of its slot's resources a resource-granting item feeds, by tier: a
 * פשוט piece conjures a single one and each tier up adds another, until an אגדי
 * piece yields all four — each at the item's full resource value, not a split of
 * it. *Which* four, and in what order, is the slot's own (`SlotMeta.resourceOrder`).
 */
export const RESOURCE_TIER_COVERAGE: Record<HeroRarity, number> = {
  COMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
};

/** The canonical order, used by any slot that does not name its own. */
const DEFAULT_RESOURCE_ORDER: readonly StorableResource[] = [
  "gold",
  "wood",
  "iron",
  "stone",
];

/** The resources an item of this slot and level produces, widest last. */
export function resourceItemResources(
  slot: HeroItemSlot,
  level: number
): StorableResource[] {
  const order = SLOT_META[slot].resourceOrder ?? DEFAULT_RESOURCE_ORDER;
  return order.slice(0, RESOURCE_TIER_COVERAGE[tierForLevel(level)]);
}

/** The weight `slot` puts on `stat`, or 0 when it does not grant it at all. */
function slotWeight(slot: HeroItemSlot, stat: HeroStat): number {
  return SLOT_META[slot].stats.find((s) => s.stat === stat)?.weight ?? 0;
}

/**
 * Percentages to two decimals — the resolution of the smallest bonus in the
 * game (a rung-1 minor extra, +0.25%). Everything that produces or sums a hero
 * percentage goes through this, so no float noise ever reaches a tooltip.
 */
export function roundPct(pct: number): number {
  return Math.round(pct * 100) / 100;
}

/**
 * The bonus an item grants in one specific stat — a pure function of slot,
 * level and stat, so every item of the same slot+level is identical. 0 when the
 * slot does not carry that stat.
 *
 * Percentage stats come back as a fraction of a percent where that is what they
 * are worth (a rung-1 extra is +0.25%), rounded to two decimals so the arithmetic
 * stays exact and the UI has something finite to print. Flat stats are whole
 * units off their own curve (see FLAT_CURVE), rounded to three significant
 * figures so a geometric bonus reads as a figure rather than a measurement, and
 * floored at 1 so a stat an item genuinely grants is never shown as +0.
 */
export function itemStatBonus(
  slot: HeroItemSlot,
  level: number,
  stat: HeroStat
): number {
  const weight = slotWeight(slot, stat);
  if (weight === 0) return 0;
  const step = upgradeStep(level);
  // The mode is the slot's, not the stat's: חרב and מגן pay resources as a
  // percentage while פרי שטן, מכנסיים and נעליים pay them in whole units.
  if (!slotStatIsFlat(slot, stat)) return roundPct(step * PCT_PER_STEP * weight);
  const flat = stat as HeroFlatStat;
  return Math.max(1, roundSignificant(flatCurveValue(flat, step) * weight));
}

/**
 * The item's headline number — its primary stat's value, tagged flat/percent.
 * For anywhere that shows one figure per item (catalog headers, pick lists);
 * `itemBonusLines` is what shows the whole profile.
 */
export function itemPrimaryBonus(
  slot: HeroItemSlot,
  level: number
): { stat: HeroStat; flat: boolean; value: number } {
  const stat = slotPrimaryStat(slot);
  return {
    stat,
    flat: slotStatIsFlat(slot, stat),
    value: itemStatBonus(slot, level, stat),
  };
}

/** One line of what an item grants, ready to render. */
export interface ItemBonusLine {
  stat: HeroStat;
  /** True for whole-unit stats, false for percentages. */
  flat: boolean;
  value: number;
  /** True for the slot's headline stat — the UI leads with it. */
  primary: boolean;
  /**
   * Set only on the resource lines an item splits into, so the tooltip can name
   * gold/wood/iron/stone individually instead of saying "משאבים" four times.
   */
  resource?: StorableResource;
  /** Translation source for this line's word. */
  label: string;
  /** Fills the `{placeholders}` in `label`. */
  labelParams?: TranslateParams;
}

/**
 * Everything an item grants, primary first — the single entry point the UI
 * renders from.
 *
 * A **flat** resource stat expands into one line per resource its tier covers,
 * because that is what the player actually receives: an אגדי relic is not
 * "+2,000 משאבים", it is +2,000 of each of the four. A **percentage** resource
 * stat stays a single line — it multiplies every mine at once, so there is
 * nothing to split and no tier coverage to widen.
 *
 * Every line carries the cadence in its label. The flat resource lines used to
 * print a bare "אבן" while the lines above them said "לעדכון יומי", which left
 * no way to tell that resources are paid every five minutes and citizens twice a
 * day — a 288× difference hidden in a missing suffix.
 */
export function itemBonusLines(
  slot: HeroItemSlot,
  level: number
): ItemBonusLine[] {
  const lines: ItemBonusLine[] = [];
  for (const { stat } of SLOT_META[slot].stats) {
    const value = itemStatBonus(slot, level, stat);
    if (value === 0) continue;
    const primary = stat === slotPrimaryStat(slot);
    if (stat === "resources" && slotStatIsFlat(slot, stat)) {
      for (const resource of resourceItemResources(slot, level)) {
        lines.push({
          stat,
          flat: true,
          value,
          primary,
          resource,
          // A pattern, not a rendered name: the resource word and the word
          // order around it both change with the language.
          label: "{resource} לעדכון רגיל",
          labelParams: { resource: RESOURCE_META[resource].label },
        });
      }
      continue;
    }
    // Everything that is not a flat resource line: the percentage stats, the
    // percent-paying resource line, and the other flat stats (turns/citizens),
    // which are still whole units and must not print a % sign.
    lines.push({
      stat,
      flat: slotStatIsFlat(slot, stat),
      value,
      primary,
      label:
        stat === "resources" ? RESOURCE_PCT_ITEM_LABEL : HERO_STAT_META[stat].itemLabel,
    });
  }
  return lines;
}

/** One resource line an item grants: its icon, its name, and the flat amount. */
export interface ItemResourceLine {
  /** Resource key — the view resolves icon + tint from the shared maps. */
  resource: StorableResource;
  label: string;
  value: number;
}

/**
 * The per-resource breakdown a resource-granting item provides — one line per
 * covered resource. Empty for items that grant no resources at all.
 */
export function itemResourceBreakdown(
  slot: HeroItemSlot,
  level: number
): ItemResourceLine[] {
  const value = itemStatBonus(slot, level, "resources");
  if (value === 0) return [];
  return resourceItemResources(slot, level).map((r) => ({
    resource: r,
    label: RESOURCE_META[r].label,
    value,
  }));
}

/** Equip requirement: the hero must be at least the item's level. */
export function canEquipItem(heroLevel: number, itemLevel: number): boolean {
  return heroLevel >= itemLevel;
}

/**
 * Upgrade requirement: the level the item would *reach* must not exceed the
 * hero's own level — you can't push gear above your hero. Returns false when
 * there is nothing to upgrade into: an אגדי, or level 100.
 */
export function canUpgradeItem(heroLevel: number, itemLevel: number): boolean {
  const target = nextTierLevel(itemLevel);
  return target !== null && heroLevel >= target;
}

/* ------------------------------ hero classes ------------------------------ */

/**
 * The permanent % bonuses a class grants. attack/defense/spy stack with the
 * point and item percentages; resources multiplies mine production alongside
 * the resource points; xp scales every battle-XP gain (Shadow only).
 */
export interface HeroClassBonuses {
  attack: number;
  defense: number;
  resources: number;
  spy: number;
  xp: number;
}

export interface HeroClassMeta {
  label: string;
  /** Portrait art at /hero/classes/<slug>.jpg. */
  slug: string;
  /** rgb triple tinting the portrait's embers and halo — the class's own
   *  light, the way each boss carries its accent. */
  accent: string;
  tagline: string;
  description: string;
  bonuses: HeroClassBonuses;
}

/** Display order for pickers and galleries. */
export const HERO_CLASS_ORDER: HeroClass[] = ["WARLORD", "GUARDIAN", "MERCHANT", "SHADOW"];

export const HERO_CLASS_META: Record<HeroClass, HeroClassMeta> = {
  WARLORD: {
    label: "המצביא",
    slug: "warlord",
    accent: "214 84 62",
    tagline: "כוח הוא הטיעון היחיד",
    description: "מפקד קרבות מלידה — צבאותיו מכים חזק יותר בכל תקיפה.",
    bonuses: { attack: 10, defense: 0, resources: 0, spy: 0, xp: 0 },
  },
  GUARDIAN: {
    label: "המגן",
    slug: "guardian",
    accent: "96 156 224",
    tagline: "החומה שלא נפלה מעולם",
    description: "שומר הסף של האימפריה — הגנתו עומדת גם מול המתקפות הקשות.",
    bonuses: { attack: 0, defense: 10, resources: 0, spy: 0, xp: 0 },
  },
  MERCHANT: {
    label: "הסוחר",
    slug: "merchant",
    accent: "228 195 90",
    tagline: "כל מלחמה מתחילה באוצר",
    description: "אשף כלכלה ערמומי — המכרות שלו מפיקים יותר מכל אחד אחר.",
    bonuses: { attack: 0, defense: 0, resources: 10, spy: 0, xp: 0 },
  },
  SHADOW: {
    label: "הצל",
    slug: "shadow",
    accent: "150 96 232",
    tagline: "מה שלא רואים — מנצח",
    description: "מרגל־מתנקש הלומד מכל קרב — ריגול חד יותר וניסיון נצבר מהר.",
    bonuses: { attack: 0, defense: 0, resources: 0, spy: 15, xp: 10 },
  },
};

/** Portrait art path for a class. */
export function heroClassImage(heroClass: HeroClass): string {
  return `/hero/classes/${HERO_CLASS_META[heroClass].slug}.jpg`;
}

/** The class bonuses, zeroed for a missing hero. */
export function heroClassBonuses(heroClass: HeroClass | null | undefined): HeroClassBonuses {
  return heroClass
    ? HERO_CLASS_META[heroClass].bonuses
    : { attack: 0, defense: 0, resources: 0, spy: 0, xp: 0 };
}

/**
 * Battle-XP multiplier from the class (e.g. הצל earns +10% XP). A fallen hero
 * still learns from the battle his army fought, but his class bonus — like
 * every other bonus he brings — is switched off until he is raised.
 */
export function classXpMultiplier(
  hero: (Pick<Hero, "heroClass"> & HeroVitals) | null | undefined
): number {
  if (!hero || isHeroDead(hero)) return 1;
  return bonusMultiplier(heroClassBonuses(hero.heroClass).xp);
}

/** The non-zero bonus lines of a class, for badges/tooltips. */
export function heroClassBonusLines(
  heroClass: HeroClass
): { label: string; icon: IconName; pct: number }[] {
  const b = HERO_CLASS_META[heroClass].bonuses;
  const lines: { label: string; icon: IconName; pct: number }[] = [];
  if (b.attack) lines.push({ label: "התקפה", icon: "attack", pct: b.attack });
  if (b.defense) lines.push({ label: "הגנה", icon: "shield", pct: b.defense });
  if (b.resources) lines.push({ label: "תפוקת משאבים", icon: "mine", pct: b.resources });
  if (b.spy) lines.push({ label: "ריגול", icon: "spy", pct: b.spy });
  if (b.xp) lines.push({ label: "ניסיון גיבור", icon: "spark", pct: b.xp });
  return lines;
}

/* ------------------------------ combined bonuses ------------------------------ */

export type HeroWithItems = Hero & { items: HeroItem[] };

export interface HeroBonuses {
  /** % from allocated points only (attack/defense/resources). */
  points: Record<HeroPointStat, number>;
  /** % from equipped items, for the percentage stats (attack/defense/spy). */
  itemsPct: Record<HeroPercentStat, number>;
  /**
   * % from equipped items that pay `resources` as a percentage (חרב, מגן). It
   * is deliberately *not* part of `itemsPct` — that record covers the battle
   * stats and is summed into `totalPct`, while this one multiplies mine
   * production and belongs beside `points.resources` and `classPct.resources`.
   */
  itemsResourcePct: number;
  /** Flat unit counts from equipped items (resources/turns/citizens). */
  itemsFlat: Record<HeroFlatStat, number>;
  /**
   * Flat resource units from equipped resource-items, split across the specific
   * resources each item covers (a specialised relic feeds one; an אגדי relic
   * feeds all four). This — not `itemsFlat.resources` — drives production.
   */
  itemsFlatByResource: Record<StorableResource, number>;
  /**
   * The permanent % the chosen class contributes (zero for a missing hero).
   * attack/defense/spy are already folded into `totalPct`; resources must be
   * added wherever `points.resources` multiplies production.
   */
  classPct: { attack: number; defense: number; resources: number; spy: number };
  /**
   * Combined percentage per percentage stat = allocated points + item % +
   * class %. (spy has no point allocation, so its total is items + class.)
   * These drive battle/spy power; the flat item counts drive production
   * directly.
   */
  totalPct: Record<HeroPercentStat, number>;
}

/** Every bonus at zero — what a fallen hero contributes, and a missing one. */
export function zeroHeroBonuses(): HeroBonuses {
  return {
    points: { attack: 0, defense: 0, resources: 0 },
    itemsPct: { attack: 0, defense: 0, spy: 0 },
    itemsResourcePct: 0,
    itemsFlat: zeroItemsFlat(),
    itemsFlatByResource: { gold: 0, wood: 0, iron: 0, stone: 0 },
    classPct: { attack: 0, defense: 0, resources: 0, spy: 0 },
    totalPct: { attack: 0, defense: 0, spy: 0 },
  };
}

/**
 * A zeroed flat-stat tally. Built from HERO_FLAT_STATS rather than written out,
 * so adding a flat stat cannot leave one of the two accumulators behind.
 */
function zeroItemsFlat(): Record<HeroFlatStat, number> {
  return Object.fromEntries(HERO_FLAT_STATS.map((s) => [s, 0])) as Record<
    HeroFlatStat,
    number
  >;
}

/**
 * The bonuses the hero is **actually** contributing right now. A dead hero
 * (health 0) carries none of them — not his allocated points, not his gear,
 * not his class bonus — until he rises, an hour after he fell or the moment
 * his owner pays the diamonds. Every gameplay site (battle, spy, production,
 * boss, the power cards) reads this, so death is felt everywhere at once.
 *
 * The character sheet wants the numbers the hero *would* grant — it uses
 * `rawHeroBonuses` and says plainly that death has switched them off.
 */
export function heroBonuses(hero: HeroWithItems | null): HeroBonuses {
  return isHeroDead(hero) ? zeroHeroBonuses() : rawHeroBonuses(hero);
}

/**
 * Aggregate the hero's bonuses, ignoring whether he is alive. Percentage stats
 * (attack/defense/spy) combine allocated points with item %; flat stats
 * (resources/turns/citizens) come from equipped items only, as whole unit
 * counts. Item percentages are fractions of a percent on the low rungs, so the
 * sums are rounded back to two decimals — nine binary fractions added together
 * otherwise surface as 13.999999999999998 in every tooltip that prints them.
 *
 * Each equipped item contributes through *every* stat its slot carries — its
 * primary and its extras alike — so a build is the sum of nine profiles rather
 * than nine independent sliders.
 */
export function rawHeroBonuses(hero: HeroWithItems | null): HeroBonuses {
  const points: Record<HeroPointStat, number> = {
    attack: hero?.attackPoints ?? 0,
    defense: hero?.defensePoints ?? 0,
    resources: hero?.resourcePoints ?? 0,
  };
  const itemsPct: Record<HeroPercentStat, number> = { attack: 0, defense: 0, spy: 0 };
  let itemsResourcePct = 0;
  const itemsFlat: Record<HeroFlatStat, number> = zeroItemsFlat();
  const itemsFlatByResource: Record<StorableResource, number> = {
    gold: 0,
    wood: 0,
    iron: 0,
    stone: 0,
  };
  for (const item of hero?.items ?? []) {
    if (!item.equipped) continue;
    for (const { stat } of SLOT_META[item.slot].stats) {
      const value = itemStatBonus(item.slot, item.level, stat);
      if (value === 0) continue;
      // Whether this counts as flat is the *slot's* call, not the stat's: חרב
      // and מגן pay resources as a percentage of mine output.
      if (!slotStatIsFlat(item.slot, stat)) {
        if (stat === "resources") itemsResourcePct += value;
        else itemsPct[stat as HeroPercentStat] += value;
        continue;
      }
      itemsFlat[stat as HeroFlatStat] += value;
      // A flat resource bonus feeds only the resources the item's tier covers —
      // each at the full amount, which is what makes an אגדי piece worth four
      // times a פשוט one beyond the raw number.
      if (stat === "resources") {
        for (const r of resourceItemResources(item.slot, item.level)) {
          itemsFlatByResource[r] += value;
        }
      }
    }
  }
  for (const stat of HERO_PERCENT_STATS) itemsPct[stat] = roundPct(itemsPct[stat]);
  itemsResourcePct = roundPct(itemsResourcePct);
  const cls = heroClassBonuses(hero?.heroClass);
  const classPct = {
    attack: cls.attack,
    defense: cls.defense,
    resources: cls.resources,
    spy: cls.spy,
  };
  const totalPct: Record<HeroPercentStat, number> = {
    // Wearing items no longer changes the point cards, but the *combined* hero
    // power (shown in the summary and used in battle) adds points, items and
    // the class bonus together.
    attack: roundPct(points.attack + itemsPct.attack + classPct.attack),
    defense: roundPct(points.defense + itemsPct.defense + classPct.defense),
    spy: roundPct(itemsPct.spy + classPct.spy),
  };
  return {
    points,
    itemsPct,
    itemsResourcePct,
    itemsFlat,
    itemsFlatByResource,
    classPct,
    totalPct,
  };
}

/**
 * The full percentage multiplying mine production: allocated resource points +
 * the class bonus + the percent-paying resource items. Every site that scales
 * mine output must use this, so adding another resource-% source only has to
 * land here. (The flat items are added *after* the multiplier — they are units,
 * not a scaling of anything.)
 */
export function resourceProductionPct(bonuses: HeroBonuses): number {
  return roundPct(
    bonuses.points.resources + bonuses.classPct.resources + bonuses.itemsResourcePct
  );
}

/** Multiplier form of a % bonus (e.g. 25 → 1.25). */
export function bonusMultiplier(pct: number): number {
  return 1 + pct / 100;
}

/**
 * The flat combat power the hero's gear contributes to one side of a fight.
 *
 * It joins the base **beside soldiers and weapons**, before every multiplier —
 * so the hero's own percentages, the guild spell and the defender bonus all
 * scale it too. That is the only placement that keeps the battle report's
 * arithmetic honest: a term added after the multipliers would make "+40%" mean
 * two different things on the same line.
 *
 * Zero for a fallen hero, like every other bonus he carries: `heroBonuses`
 * already zeroes the tally, and this only reads it.
 */
export function heroPowerBonus(
  bonuses: HeroBonuses,
  stat: HeroPercentStat
): number {
  return bonuses.itemsFlat[POWER_STAT_FOR[stat]];
}

/* ------------------------------ item drops ------------------------------ */

/**
 * Chance that winning an attack captures an item **of each rarity**.
 *
 * Rarity drives frequency directly, rather than falling out of a uniform level
 * roll. Gear is meant to be earned: fewer than one in five winning attacks
 * yields anything at all, and the top of the ladder stays rare — an אגדי is a
 * flat 0.5% of winning attacks, an אליט 1.5%.
 *
 * These are per-winning-attack probabilities and are mutually exclusive; the
 * remainder (1 − ITEM_DROP_CHANCE) is no drop at all.
 */
export const ITEM_DROP_CHANCE_BY_RARITY: Record<HeroRarity, number> = {
  COMMON: 0.12, // פשוט — 12%
  RARE: 0.05, // מתקדם — 5%
  EPIC: 0.015, // אליט — 1.5%
  LEGENDARY: 0.005, // אגדי — 0.5%
};

/** Chance a won attack yields any item at all — the sum of the table above. */
export const ITEM_DROP_CHANCE = RARITY_ORDER.reduce(
  (sum, r) => sum + ITEM_DROP_CHANCE_BY_RARITY[r],
  0
);

/** The level at which each tier band opens inside a decade. */
const RARITY_BAND_OFFSET: Record<HeroRarity, number> = {
  COMMON: 1,
  RARE: 3,
  EPIC: 8,
  LEGENDARY: 10,
};

/**
 * A concrete level for a dropped item of the given rarity, in a decade near the
 * hero's own so the loot is roughly wearable. Drops land exactly on a band-start
 * level (an UPGRADE_LEVELS rung), which is what makes the rolled rarity and
 * `tierForLevel` agree by construction.
 */
export function itemLevelForRarity(
  heroLevel: number,
  rarity: HeroRarity,
  random: () => number = secureRandom
): number {
  const decades = HERO_MAX_LEVEL / 10;
  const heroDecade = Math.floor((Math.max(1, heroLevel) - 1) / 10);
  const jitter = Math.floor(random() * 3) - 1; // one decade either side
  const decade = Math.min(decades - 1, Math.max(0, heroDecade + jitter));
  return Math.min(HERO_MAX_LEVEL, decade * 10 + RARITY_BAND_OFFSET[rarity]);
}

function itemOfRarity(
  attackerHeroLevel: number,
  rarity: HeroRarity,
  random: () => number
): { slot: HeroItemSlot; level: number; rarity: HeroRarity } {
  const slot = SLOT_ORDER[Math.floor(random() * SLOT_ORDER.length)];
  const level = itemLevelForRarity(attackerHeroLevel, rarity, random);
  return { slot, level, rarity };
}

/**
 * Roll a captured item after a won attack, or null for no drop. One roll walks
 * the cumulative rarity table, so the odds are exactly ITEM_DROP_CHANCE_BY_RARITY.
 */
export function rollItemDrop(
  attackerHeroLevel: number,
  random: () => number = secureRandom
): { slot: HeroItemSlot; level: number; rarity: HeroRarity } | null {
  const roll = random();
  let acc = 0;
  for (const rarity of RARITY_ORDER) {
    acc += ITEM_DROP_CHANCE_BY_RARITY[rarity];
    if (roll < acc) return itemOfRarity(attackerHeroLevel, rarity, random);
  }
  return null;
}

/**
 * Roll an item that is guaranteed to drop, keeping the *relative* rarity odds
 * intact — the wheel's "חפץ" wedge already decided that something is won, so
 * only the rarity split matters. Renormalising beats forcing the drop roll to
 * zero, which would always hand out the most common tier.
 */
export function rollGuaranteedItem(
  attackerHeroLevel: number,
  random: () => number = secureRandom
): { slot: HeroItemSlot; level: number; rarity: HeroRarity } {
  const roll = random() * ITEM_DROP_CHANCE;
  let acc = 0;
  for (const rarity of RARITY_ORDER) {
    acc += ITEM_DROP_CHANCE_BY_RARITY[rarity];
    if (roll < acc) return itemOfRarity(attackerHeroLevel, rarity, random);
  }
  return itemOfRarity(attackerHeroLevel, "COMMON", random);
}

/**
 * Display name, e.g. "חרב מתקדם" / "Advanced Sword".
 *
 * Takes the translator because the two halves swap order between the languages:
 * Hebrew names the object then its grade, English the grade then the object.
 * The tier itself follows from the item's level.
 */
export function itemDisplayName(t: T, slot: HeroItemSlot, level: number): string {
  return t("{slot} {rarity}", {
    slot: t(SLOT_META[slot].label),
    rarity: t(RARITY_META[tierForLevel(level)].label),
  });
}

/* ------------------------------ discard → wheel spin ------------------------------ */

/**
 * Throwing an item away can reward a wheel-of-fortune spin — the fates smile on
 * those who part with their gear. The chance climbs sharply with the item's
 * tier, so junk almost never pays while an אגדי pays a full 1-in-10.
 */
export const DISCARD_WHEEL_SPIN_CHANCE: Record<HeroRarity, number> = {
  COMMON: 0.01, // פשוט — 1%
  RARE: 0.03, // מתקדם — 3%
  EPIC: 0.06, // אליט — 6%
  LEGENDARY: 0.1, // אגדי — 10%
};

/** The wheel-spin drop chance for an item of the given level (by its tier). */
export function discardWheelSpinChance(level: number): number {
  return DISCARD_WHEEL_SPIN_CHANCE[tierForLevel(level)];
}

/**
 * Roll whether throwing away an item of the given level grants a wheel spin.
 * `bonus` is the empire's wheel-luck upgrade bonus (a fraction, e.g. 0.1 = +10%)
 * added on top of the item's rarity-based chance. The server owns this roll,
 * exactly like item drops.
 */
export function rollDiscardWheelSpin(
  level: number,
  bonus = 0,
  random: () => number = secureRandom
): boolean {
  return random() < discardWheelSpinChance(level) + bonus;
}
