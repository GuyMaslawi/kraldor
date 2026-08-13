// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { HeroRarity } from "@prisma/client";
import { MAX_CITIES, type StorableResource } from "./constants";

/**
 * City bosses — the PvE tyrant that rules every city tier.
 *
 * Each of the ten city tiers (`Empire.cities`, 1..MAX_CITIES) is held by one
 * named boss. Unlike a player target, a boss is a *fixed, public* wall: its
 * power is printed on the rankings page, so a player can see exactly what they
 * are up against before marching.
 *
 * This file holds the catalog and the three curves the encounter is built from.
 * The encounter itself — a multi-round sortie against a health pool that
 * persists across the daily cycle — lives in `bossBattle.ts`, and the resolution
 * in `server/bossSiege.ts`.
 *
 * 1. **Turn cost** — 300 turns in the first city, +200 for every city after
 *    (see `bossTurnCost`). At the base turn income (1 turn / 5 min) 300 turns is
 *    roughly one full daily-update cycle of banked turns, so a sortie is a
 *    deliberate, expensive commitment rather than something you spam. It is also
 *    now the *only* limit on how often the boss can be attacked: the loot is
 *    bounded by the cycle's pool rather than by a victory counter, so extra
 *    turns buy extra attempts, never extra payouts.
 * 2. **Power** — static per tier, growing on the same ×2.5-per-tier curve the
 *    game already uses for `cityCost`. It no longer decides the fight on its own
 *    (see `bossBattle.ts`); it sets the boss's health pool and scales the damage
 *    a round deals, so a bigger army fells the tyrant faster and bleeds less.
 * 3. **Reward** — scales with the tier *and* with the current season day, the
 *    same idea (though not the same curve — the pass now rides a geometric one,
 *    see `seasonPassRewardAmount`) so the haul is always meaningful for where
 *    the season actually is. What
 *    `bossReward` returns is the haul for a *whole cycle*, which a sortie earns
 *    a share of: pro-rata as it wears the boss down, plus the hoard on the kill
 *    (see `BOSS_CHIP_SHARE` / `BOSS_KILL_SHARE`).
 *
 * **The tyrant is a siege, not an errand (2026-08-06).** The wall, the pool and
 * the haul were all raised together on one instruction — the boss should be the
 * hardest thing in the game and pay like it. Felling one now takes about three
 * assaults from an army standing at its printed power (it used to take one), and
 * a life is worth about six times what it was. The two curves are kept in step on
 * purpose: `BOSS_REWARD_TIER_MULTIPLIER` now matches `BOSS_POWER_TIER_MULTIPLIER`
 * exactly, so a tenth-city tyrant is not merely bigger in both directions but
 * pays the *same* haul per unit of work as the first — which it did not before.
 * The arithmetic behind "harder, and worth it" is written out on each constant.
 *
 * Deliberately absent: diamonds. Same reasoning as the season pass — a
 * repeatable source of diamonds undercuts the real-money store (see
 * DiamondPurchase). The boss pays resources, slaves, hero XP and gear.
 */

/* ------------------------------ catalog ------------------------------ */

export interface CityBoss {
  /** Stable key — also the portrait filename under /public/boss. */
  key: string;
  /** City tier this boss rules (1..MAX_CITIES). */
  tier: number;
  name: string;
  title: string;
  lore: string;
  /**
   * Accent color for the boss banner, as an `R G B` triple so callers can build
   * `rgb(var(--x) / alpha)` shades from a single token.
   */
  accent: string;
}

/**
 * The ten rulers, in city order. `tier` is derived from the position so the
 * table can never drift out of sync with the city count.
 */
export const CITY_BOSSES: readonly CityBoss[] = [
  {
    key: "varkos",
    name: "ורקוס",
    title: "שובר השערים",
    lore: "ענק משוריין שמנפץ שערי ערים במקבת אחת. הוא חונה על חורבות העיר הראשונה ודורש מס דמים מכל אימפריה שעולה לדרך.",
    accent: "196 92 48",
  },
  {
    key: "morgeth",
    name: "מורגהת",
    title: "אלמנת האפר",
    lore: "מכשפה עטופת רעלות פחם ששרפה את ממלכתה שלה. כל מי שמתקרב לחומותיה נושם אפר — והאפר זוכר את שמו.",
    accent: "168 108 214",
  },
  {
    key: "dragor",
    name: "דראגור",
    title: "בן הברזל",
    lore: "נולד בכבשן ומעולם לא הסיר את שריונו. חרב התליין שלו נעוצה באדמה, וסביבה קבורים כל מי שניסו להזיז אותה.",
    accent: "96 156 224",
  },
  {
    key: "serpina",
    name: "סרפינה",
    title: "לוחשת הרעל",
    lore: "מלכת המתנקשים של הביצות הירוקות. היא לא נלחמת בצבאות — היא מרעילה את בארותיהם ומחכה שהמצור ייגמר מעצמו.",
    accent: "62 200 140",
  },
  {
    key: "kharon",
    name: "קרון",
    title: "רועה השבויים",
    lore: "סוחר עבדים במסכת ארד ללא פה. כל שרשרת שכרוכה על זרועו הייתה פעם צבא שלם שחשב שהוא חזק מספיק.",
    accent: "205 150 70",
  },
  {
    key: "azrael",
    name: "אזראל",
    title: "נביא הלהבה",
    lore: "כוהן אש שפניו נמסו לתוך הלבה שהוא סוגד לה. הוא מטיף שכל אימפריה נועדה להישרף — ומקדים להגשים את הנבואה.",
    accent: "255 140 52",
  },
  {
    key: "tharos",
    name: "תארוס",
    title: "מצביא הלגיון השחור",
    lore: "מפקד הלגיון שלא הפסיד קרב מעולם. הוא לא בא לבזוז — הוא בא למחוק את שם האימפריה מכל מפה קיימת.",
    accent: "230 62 62",
  },
  {
    key: "rythen",
    name: "רית'ן",
    title: "מלך הצללים",
    lore: "אין לו גוף, רק שריון שממשיך לצעוד. חרמש הצל שלו חותך דרך חומות כאילו הן לא היו שם מעולם.",
    accent: "150 96 232",
  },
  {
    key: "volgaris",
    name: "וולגריס",
    title: "הר הפלדה",
    lore: "טיטאן מצור בגובה חומה, ששריונו בנוי משערי הערים שהפיל. הוא לא צועד מהר — הוא פשוט לא נעצר.",
    accent: "150 168 190",
  },
  {
    key: "nox",
    name: "נוקס",
    title: "קיסר הכתר השבור",
    lore: "הקיסר האפל הראשון, שיושב על כס שבור מאז שהעולם היה צעיר. מי שמפיל אותו יורש את קראלדור כולה.",
    accent: "228 195 90",
  },
].map((boss, index) => ({ ...boss, tier: index + 1 }));

/** The boss ruling a given city tier; clamped to the catalog's ends. */
export function bossForCity(cities: number): CityBoss {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  return CITY_BOSSES[tier - 1];
}

export function bossByKey(key: string): CityBoss | undefined {
  return CITY_BOSSES.find((b) => b.key === key);
}

/**
 * Portrait path for a boss. JPEG, not PNG, for the same reason the hero class
 * portraits are: the raw 768×1024 renders are ~1.2 MB each, and ten of them
 * would put over 11 MB of art on a page every player loads.
 *
 * The banner draws a crest underlay behind this image, so a boss whose art has
 * not been generated yet degrades to a deliberate-looking plate rather than a
 * broken image.
 */
export function bossImage(key: string): string {
  return `/boss/${key}.jpg`;
}

/* ------------------------------ turn cost ------------------------------ */

/** Turns the first city's boss demands. */
export const BOSS_TURN_COST_BASE = 300;
/** Extra turns demanded by each city tier above the first. */
export const BOSS_TURN_COST_PER_CITY = 200;

/**
 * Turns spent on one sortie at the boss of `cities`: 300 in the first city, 500
 * in the second, and so on up to 2,100 in the tenth. Paid at launch and never
 * refunded — a sortie that routs still cost the march.
 */
export function bossTurnCost(cities: number): number {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  return BOSS_TURN_COST_BASE + (tier - 1) * BOSS_TURN_COST_PER_CITY;
}

/* ------------------------------ power ------------------------------ */

/**
 * Attack power the first city's boss fields — ~2,000 soldiers, or the same power
 * bought as weapons (the weapon table pays exactly 1 power per 10 gold at every
 * tier).
 *
 * Raised from 12,000 on 2026-08-06. Twelve thousand was "what a player holds
 * after their first week", which made the very first tyrant something you walked
 * past on the way to the second one. The wall a boss advertises should be an
 * army you had to *decide* to build, so it is now a good fortnight's worth — and
 * because the health pool is a multiple of this number (`bossSiegeMaxHp`),
 * raising it raises the length of the siege by the same factor.
 */
export const BOSS_BASE_POWER = 20_000;

/**
 * Power multiplier per city tier. Matches CITY_COST_TIER_MULTIPLIER, so the
 * boss keeps pace with the empire that founded the city it guards.
 */
export const BOSS_POWER_TIER_MULTIPLIER = 2.5;

/**
 * The boss's reference battle power. Static by design and printed on the boss
 * banner, so a player always knows what the wall is worth.
 *
 * It is the yardstick, not the verdict: the boss's health pool is a multiple of
 * it (`bossSiegeMaxHp`) and each round's damage is a fraction of the attacker's
 * power, so the printed power reads as a ladder rather than as a pass/fail line —
 * an army *at* the wall fells the tyrant in about three assaults, one at double
 * it in two, one at triple in one, and one under it chips away and is paid for
 * the work. Casualties are dealt per round by the tactic matrix.
 */
export function bossPower(cities: number, powerMultiplier = 1): number {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  return Math.round(
    BOSS_BASE_POWER * Math.pow(BOSS_POWER_TIER_MULTIPLIER, tier - 1) * powerMultiplier
  );
}

/* ------------------------------ rewards ------------------------------ */

export interface BossReward {
  gold: number;
  wood: number;
  iron: number;
  stone: number;
  /** Captives dragged home — they join the free mine-slave pool. */
  slaves: number;
}

/** Day-1, first-city haul. Every other tier and day is derived from this. */
export const BOSS_REWARD_BASE: BossReward = {
  gold: 50_000,
  wood: 30_000,
  iron: 25_000,
  stone: 25_000,
  slaves: 40,
};

/**
 * Scale-up applied to the whole haul, on top of the day-1 base.
 *
 * Raised twice, and the second raise is the one that matters:
 *
 *  - **×2.5 (2026-07-30)**, when the boss became a siege. The payout before that
 *    was sized against a single click and players read it as not worth the wait,
 *    which it wasn't — one win per cycle for a bit more than the same turns would
 *    have earned as ordinary attacks.
 *  - **×15 (2026-08-06)**, when the tyrant was made genuinely hard. Felling one
 *    now costs about 4.6× the turns it used to (`BOSS_BASE_POWER` ×1.67 into
 *    `BOSS_HP_PER_POWER` ×2.77), and a fight that costs five times as much has to
 *    pay more than five times as much or "harder" is just a nerf with a story.
 *    Six times the haul against 4.6× the work leaves the boss ~30% better per turn
 *    than it was, which is the intended shape: the most expensive thing you can
 *    point banked turns at is also the best-paying one.
 *
 * A sortie that lands the kill with an S grade takes home `0.55 + 0.45 × 1.5` of
 * this — so a felled first-city tyrant is worth ~900k gold on day one, and the
 * tenth city's is worth billions.
 */
export const BOSS_REWARD_SCALE = 15;

/**
 * The one term the scale-up is held back on — deliberately half the resource
 * scale rather than the same number.
 *
 * Mine slaves feed uncapped production, and a slave payout compounds twice over
 * (more slaves × a higher city production multiplier) — the same reason their
 * tier curve is gentler than the resource curve. At ×6 against the resources' ×15
 * the pens are still a visibly bigger prize per kill than they were (240 captives
 * a life at the first city, against 70), while the *rate* — captives per turn
 * spent — comes out slightly below today's, which is the right direction for the
 * one reward that never gets spent. If it still inflates, `boss.rewardMultiplier`
 * is the live knob.
 */
export const BOSS_REWARD_SCALE_SLAVES = 6;

/**
 * Resource reward multiplier per city tier — deliberately *identical* to
 * `BOSS_POWER_TIER_MULTIPLIER`.
 *
 * It was 2.4 against the power's 2.5, and that gap compounded the wrong way: nine
 * tiers of `(2.4 / 2.5)` left the tenth city's tyrant paying ~31% less per unit of
 * work than the first city's, so climbing the city ladder quietly made the boss a
 * worse deal at exactly the point it became a bigger commitment. Matching the two
 * curves makes the haul-per-turn flat across all ten tiers: every city up is more
 * power on the wall *and* proportionally more resources behind it.
 */
export const BOSS_REWARD_TIER_MULTIPLIER = 2.5;

/**
 * Slaves grow on a gentler curve than resources: mine slaves feed uncapped
 * production, so a ×2.4-per-tier slave payout would compound into the economy
 * twice (more slaves × a higher city production multiplier).
 */
export const BOSS_SLAVE_TIER_MULTIPLIER = 1.6;

/**
 * Fraction of the base added per elapsed season day, so the haul stays relevant
 * to where the season actually is (the season pass uses the same idea at 0.25).
 * Held lower here because the tier multiplier already carries most of the
 * growth and the two compound.
 */
export const BOSS_REWARD_DAILY_GROWTH = 0.2;

function grow(base: number, tierMultiplier: number, tier: number, day: number): number {
  const seasonal = 1 + BOSS_REWARD_DAILY_GROWTH * (Math.max(1, day) - 1);
  return base * Math.pow(tierMultiplier, tier - 1) * seasonal;
}

/**
 * The haul a whole cycle of the boss of `cities` is worth on season day `day`.
 *
 * This is the *pool*, not a payout: a sortie earns `bossChipFraction` of it for
 * the damage it deals and `bossKillFraction` for the kill (see `bossBattle.ts`).
 * `multiplier` is the admin-tunable global scalar.
 */
export function bossReward(
  cities: number,
  day: number,
  multiplier = 1,
  /**
   * `boss.slaveMultiplier`, applied to the captives *on top of* `multiplier`.
   * Separate because the pens are the one line here that is never spent — see
   * BOSS_REWARD_SCALE_SLAVES.
   */
  slaveMultiplier = 1
): BossReward {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  const res = (base: number) =>
    Math.round(
      (grow(base, BOSS_REWARD_TIER_MULTIPLIER, tier, day) * BOSS_REWARD_SCALE * multiplier) / 100
    ) * 100;
  return {
    gold: res(BOSS_REWARD_BASE.gold),
    wood: res(BOSS_REWARD_BASE.wood),
    iron: res(BOSS_REWARD_BASE.iron),
    stone: res(BOSS_REWARD_BASE.stone),
    // Floored at one only while the pens are meant to pay at all: an admin who
    // sets either dial to zero is closing the captive line, and a "minimum of
    // one" that survived that would be the knob quietly refusing to obey.
    slaves: (() => {
      const scale = BOSS_REWARD_SCALE_SLAVES * multiplier * slaveMultiplier;
      if (scale <= 0) return 0;
      return Math.max(
        1,
        Math.round(
          grow(BOSS_REWARD_BASE.slaves, BOSS_SLAVE_TIER_MULTIPLIER, tier, day) * scale
        )
      );
    })(),
  };
}

/** The four storable resources of a reward, for iteration in the UI. */
export const BOSS_REWARD_RESOURCES: readonly StorableResource[] = [
  "gold",
  "wood",
  "iron",
  "stone",
];

/* ------------------------------ hero XP & loot ------------------------------ */

/**
 * Hero XP for a whole life of the boss. Far above an ordinary attack win (which
 * pays `40 + defenderHeroLevel × 10` before multipliers) because the run costs
 * orders of magnitude more turns — but flat per tier, so it cannot be farmed by
 * picking a soft target the way player attacks can.
 *
 * Paid on the same split as the loot (`bossHeroXp(cities) * fraction` in the
 * settle), which is why it had to move with the pool: XP is pro-rata against
 * damage dealt, so tripling the health a life carries would otherwise have cut
 * the hero's XP per turn to a third without anybody deciding to. Scaled ×4.5
 * against the ×4.6 the fight got longer, so a levelling hero is exactly where it
 * was — the siege is the thing that changed, not the ladder.
 */
export const BOSS_HERO_XP_BASE = 1_800;
export const BOSS_HERO_XP_PER_TIER = 1_100;

export function bossHeroXp(cities: number, multiplier = 1): number {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  return Math.round(
    (BOSS_HERO_XP_BASE + (tier - 1) * BOSS_HERO_XP_PER_TIER) * Math.max(0, multiplier)
  );
}

/** A failed run teaches the hero nothing — only a felled boss pays XP. */
export const BOSS_HERO_XP_DEFEAT = 0;

/**
 * Rarity floor of the guaranteed drop a felled boss leaves behind. The roll
 * still uses the normal rarity odds (`rollGuaranteedItem`), but anything below
 * this floor is re-read as the floor — a boss never drops junk.
 */
export const BOSS_ITEM_RARITY_FLOOR: HeroRarity = "RARE";

/* ------------------------------ cadence ------------------------------ */

/**
 * How long a felled tyrant stays dead before it returns at full health.
 *
 * The clock starts **when it dies**, not on a shared schedule, and that asymmetry
 * is the whole design:
 *
 *  - A boss that is alive never resets. Its wounds persist indefinitely, so a
 *    player who cannot fell it in one assault is under no time pressure at all —
 *    they chip at it across as many assaults as they like and are paid for each.
 *  - A boss that is dead is gone for an hour, with a countdown to prove it.
 *
 * This replaced a per-daily-update reset, which had both failure modes at once:
 * it punished the weak player (progress wiped at 19:30 whether or not they were
 * done) and bored the strong one (killed it at 19:31, nothing to do for 24h).
 *
 * Nothing else caps the boss, and nothing else needs to. The turn cost is the
 * real limiter: 300 turns for the first city is roughly a full day of turn income
 * (1 turn / 5 min), so an hourly respawn does not mean hourly loot — it means a
 * player who has banked turns may spend them here instead of on attacks, which is
 * a trade rather than a windfall.
 */
export const BOSS_REVIVE_MS = 60 * 60 * 1000;

/**
 * The revive delay actually in force, from `boss.reviveMinutes`.
 *
 * The tunable is minutes rather than milliseconds because that is the unit the
 * admin thinks in, and it defaults to exactly BOSS_REVIVE_MS — an untouched
 * overlay leaves the cadence above unchanged.
 */
export function bossReviveMs(reviveMinutes: number): number {
  return Math.max(0, Math.round(reviveMinutes * 60_000));
}

/**
 * There is no victory allowance, and the absence is deliberate.
 *
 * The old rule was one win per daily update, because turn gain is uncapped (see
 * `applyPendingUpdates`). What replaced it is an economic bound rather than a
 * counter: each boss *life* is worth one haul, chip loot is paid pro-rata against
 * that life's health pool, and the kill bonus is paid once because a life can only
 * be ended once. Extra assaults against the same life therefore buy progress, not
 * duplicate payouts. See `bossBattle.ts` (`BOSS_CHIP_SHARE`) and
 * `server/bossSiege.ts`.
 */
