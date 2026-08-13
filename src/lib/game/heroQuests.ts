// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { T } from "@/i18n/translate";
import type { StorableResource } from "./constants";
import { MAX_CITIES } from "./constants";
import { secureRandom } from "./random";

/**
 * מסעות הגיבור — the hero's expedition board.
 *
 * The hero is the one asset the game had no *use* for between battles: he sat
 * on his page accruing bonuses. An expedition sends him away for a stretch of
 * real time and pays out when he comes home, which turns the hero page into a
 * loop a player returns to rather than a sheet they read once.
 *
 * Three rules define the whole feature, and the UI states all three:
 *
 * 1. **One quest at a time.** There is one hero; he cannot be in two places.
 *    Enforced by the unique index on `HeroQuest.empireId` (see the schema) on
 *    top of the empire row lock the action takes.
 * 2. **A city unlocks a longer quest.** Quest tier N needs N cities, and the
 *    tiers run 1h → 24h (`HERO_QUEST_HOURS`). The board keeps every tier the
 *    empire has unlocked, so founding a city adds a rung without retiring one.
 * 3. **Every rung pays the same per hour — on average.** The payout scales with
 *    the empire's *city count*, not with the quest's tier, so a one-hour run is
 *    never obsolete. What the long rungs buy is turn efficiency (fewer turns per
 *    hour of quest, see `heroQuestTurnCost`) and much better loot odds per run;
 *    what the short rungs buy is loot *per hour* and the freedom to react.
 *
 * That trade is the whole design: an attentive player farms short runs, a
 * player going to bed sets the long one, and neither is playing it wrong.
 *
 * **The haul is never shown before he is home.** The board quotes the price (in
 * turns) and the odds, never the payout — an expedition you can price to the
 * gold is an errand, and this one is supposed to feel like a gamble the hero
 * takes on your behalf. That is not just a UI decision: the haul is *rolled*,
 * not tabulated (see `rollHeroQuestReward`), so there is no number the board
 * could honestly print even if it wanted to. Two runs of the same rung, from the
 * same empire, on the same day, come home with different wagons.
 *
 * Deliberately absent: diamonds. Same reasoning as the boss and the season
 * pass — a repeatable diamond faucet undercuts the real-money store.
 */

/* ------------------------------ catalog ------------------------------ */

export interface HeroQuest {
  /** Stable key — used in copy and as the React key; the tier is the identity. */
  key: string;
  /** City tier this quest needs (1..MAX_CITIES). */
  tier: number;
  name: string;
  /** One line of flavour shown under the name on the board. */
  lore: string;
  /** Emoji sigil — the board is a list, not a gallery; no art to load. */
  sigil: string;
  /** How long the hero is away, in hours. */
  hours: number;
  /** Chance the run brings back a piece of gear. */
  itemChance: number;
  /** Chance the run brings back a potion (rolled independently of the gear). */
  potionChance: number;
  /** Accent as an `R G B` triple, so the row can tint from one token. */
  accent: string;
}

/**
 * Hours per tier. Hand-authored rather than a formula: the shape matters more
 * than the curve — the first rungs sit inside a single sitting, the middle ones
 * span a work day, and the last two are the overnight and the full-day runs.
 */
export const HERO_QUEST_HOURS: readonly number[] = [1, 2, 3, 4, 6, 8, 10, 12, 16, 24];

const QUEST_TABLE: ReadonlyArray<Omit<HeroQuest, "tier" | "hours">> = [
  {
    key: "border_raid",
    name: "פשיטת הגבול",
    lore: "שיירת אספקה חוצה את קצה הנחלה בלי ליווי. הגיבור יוצא לבדו, חוזר לפני רדת הלילה.",
    sigil: "🗡",
    itemChance: 0.08,
    potionChance: 0.1,
    accent: "180 160 120",
  },
  {
    key: "caravan_escort",
    name: "ליווי השיירה",
    lore: "סוחרים משלמים בזהב כדי שמישהו יצעד לצדם דרך המעבר. הגיבור לוקח את התשלום ואת מה שנופל בדרך.",
    sigil: "🐫",
    itemChance: 0.14,
    potionChance: 0.16,
    accent: "205 150 70",
  },
  {
    key: "den_purge",
    name: "טיהור המאורה",
    lore: "מערה מתחת לגבעות שממנה יוצאים פושטים כל לילה. מי שנכנס פנימה חייב לצאת עם ראש.",
    sigil: "🔥",
    itemChance: 0.19,
    potionChance: 0.21,
    accent: "196 92 48",
  },
  {
    key: "chieftain_hunt",
    name: "ציד ראשי השבט",
    lore: "שלושה ראשי שבט חולקים את הערבה ואת השלל שגנבו ממך. הגיבור יוצא לגבות חוב.",
    sigil: "🏹",
    itemChance: 0.24,
    potionChance: 0.26,
    accent: "62 200 140",
  },
  {
    key: "raider_siege",
    name: "מצור על מעוז הפורעים",
    lore: "מבצר עץ על צוק, ובתוכו כל מה שנשדד מהאזור בעשור האחרון. מצור לוקח זמן.",
    sigil: "🏰",
    itemChance: 0.32,
    potionChance: 0.33,
    accent: "150 168 190",
  },
  {
    key: "ashlands",
    name: "חציית ארץ האפר",
    lore: "אין שם דרך ואין שם מים — רק ערים שרופות שאיש לא בזז מאז שנפלו.",
    sigil: "🌋",
    itemChance: 0.4,
    potionChance: 0.4,
    accent: "255 140 52",
  },
  {
    key: "princes_vault",
    name: "שוד גנזך הנסיך",
    lore: "נסיך גולה החביא את אוצרו מתחת לארמון נטוש. המפה עלתה לגיבור יותר ממה שהוא מודה.",
    sigil: "🗝",
    itemChance: 0.47,
    potionChance: 0.46,
    accent: "228 195 90",
  },
  {
    key: "broken_peaks",
    name: "מסע אל ההרים השבורים",
    lore: "מעברים שקפואים תשעה חודשים בשנה, ומנזר בפסגה ששומר על משהו ישן מהאימפריה.",
    sigil: "🏔",
    itemChance: 0.54,
    potionChance: 0.52,
    accent: "96 156 224",
  },
  {
    key: "over_the_sea",
    name: "משלחת מעבר לים",
    lore: "ספינה אחת, צוות ששכרת בנמל, ויבשת שאיש מאנשיך לא ראה. הוא יחזור — כנראה.",
    sigil: "⛵",
    itemChance: 0.65,
    potionChance: 0.6,
    accent: "150 96 232",
  },
  {
    key: "crown_tower",
    name: "עלייה למגדל הכתר השבור",
    lore: "המגדל שממנו שלט הקיסר האפל הראשון. יממה שלמה של טיפוס, ובראשו כל מה שנשאר מקראלדור הישנה.",
    sigil: "👑",
    itemChance: 0.8,
    potionChance: 0.75,
    accent: "232 82 82",
  },
];

/** The ten expeditions, in city order. `tier` and `hours` follow the position. */
export const HERO_QUESTS: readonly HeroQuest[] = QUEST_TABLE.map((quest, index) => ({
  ...quest,
  tier: index + 1,
  hours: HERO_QUEST_HOURS[index],
}));

/** Clamp any tier-ish number onto the catalog. */
function clampTier(tier: number): number {
  return Math.min(MAX_CITIES, Math.max(1, Math.floor(tier)));
}

/** The quest at a tier, or undefined for a tier outside the catalog. */
export function heroQuestByTier(tier: number): HeroQuest | undefined {
  if (!Number.isFinite(tier) || tier < 1 || tier > HERO_QUESTS.length) return undefined;
  return HERO_QUESTS[Math.floor(tier) - 1];
}

/** Quest tier N is open to an empire holding N cities. */
export function heroQuestUnlocked(tier: number, cities: number): boolean {
  return tier <= cities;
}

export function heroQuestDurationMs(tier: number): number {
  return heroQuestHours(tier) * 3_600_000;
}

export function heroQuestHours(tier: number): number {
  return HERO_QUEST_HOURS[clampTier(tier) - 1];
}

/* ------------------------------ turn cost ------------------------------ */

/**
 * Turns charged per hour of the *first* quest, and how much that rate drops
 * with each tier. A short run is deliberately the expensive way to buy an hour
 * of expedition: it pays the same resources and better loot per hour, so
 * something has to make the long runs worth unlocking, and turns are it.
 */
export const HERO_QUEST_TURNS_PER_HOUR_BASE = 22;
export const HERO_QUEST_TURNS_PER_HOUR_DROP = 1.6;

/**
 * Turns to send the hero on a quest: 22 for the one-hour run, down to ~7.6 an
 * hour (182 turns) for the full-day run. Spent at departure and never refunded
 * — recalling the hero early is not offered, so there is nothing to refund.
 */
export function heroQuestTurnCost(tier: number): number {
  const t = clampTier(tier);
  const perHour = Math.max(
    1,
    HERO_QUEST_TURNS_PER_HOUR_BASE - HERO_QUEST_TURNS_PER_HOUR_DROP * (t - 1)
  );
  return Math.max(1, Math.round(HERO_QUEST_HOURS[t - 1] * perHour));
}

/* ------------------------------ rewards ------------------------------ */

export interface HeroQuestReward {
  gold: number;
  wood: number;
  iron: number;
  stone: number;
  /** Settlers the hero brings home — straight into the population. */
  citizens: number;
  /** Captives — they join the free mine-slave pool. */
  slaves: number;
}

/** The four storable resources of a reward, for iteration in the UI. */
export const HERO_QUEST_REWARD_RESOURCES: readonly StorableResource[] = [
  "gold",
  "wood",
  "iron",
  "stone",
];

/**
 * The *centre* of the payout for one hour of expedition at one city, on season
 * day 1. Everything else is derived from this, and every actual haul is this
 * times the run's own luck (see the fortune table below, whose expected value is
 * ~1.24 — so an average hour at one city is worth a little over 3,200 gold).
 *
 * Tuned against the mines: a one-city empire pulls roughly 2,400 gold an hour
 * from a level-5 gold mine, so a typical hour of questing beats one mine, a bad
 * one falls short of it, and a lucky one pays several — a real second income
 * with a pulse, not a replacement for play.
 */
export const HERO_QUEST_REWARD_PER_HOUR: HeroQuestReward = {
  gold: 2_600,
  wood: 1_600,
  iron: 1_350,
  stone: 1_350,
  citizens: 2,
  slaves: 1,
};

/* ------------------------------ fortune ------------------------------ */

/** One band of the luck table — the roll picks a band, then a value inside it. */
export interface HeroQuestFortune {
  key: string;
  /** What the homecoming line calls this run. */
  label: string;
  /** One line of flavour, shown with the spoils when he walks back in. */
  lore: string;
  /** Draw weight, relative to the rest of the table. */
  weight: number;
  /** The multiplier band, drawn uniformly. */
  min: number;
  max: number;
}

/**
 * How well the road treated him. Drawn once per expedition and applied to the
 * whole haul.
 *
 * The shape is deliberate: two thirds of runs land in "cheap disappointment" or
 * "about what you expected", and the memorable ones are rare enough to be worth
 * telling someone about — a 3% tail that pays roughly five times an average run
 * of the same rung. The expected value across the table is ~1.24, which is where
 * the per-hour numbers above were tuned from; changing a weight changes the
 * game's whole quest income, so change the base instead.
 *
 * Note what does *not* enter here: the tier. A one-hour run and a full-day run
 * draw from the same table, so the long rungs still buy turn efficiency and loot
 * odds rather than better luck — rule 3 in the header survives the dice.
 */
export const HERO_QUEST_FORTUNES: readonly HeroQuestFortune[] = [
  {
    key: "grim",
    label: "מסע קשה",
    lore: "הדרך גבתה את שלה — הוא חוזר חבול ועם מעט מכפי שקיווה.",
    weight: 18,
    min: 0.55,
    max: 0.8,
  },
  {
    key: "plain",
    label: "מסע כשורה",
    lore: "בלי הפתעות. יצא, עשה את שלו, חזר עם מה שמגיע.",
    weight: 44,
    min: 0.85,
    max: 1.15,
  },
  {
    key: "good",
    label: "מסע מוצלח",
    lore: "הוא מצא יותר משציפה, וידע לקחת את הכול.",
    weight: 26,
    min: 1.25,
    max: 1.75,
  },
  {
    key: "rich",
    label: "שלל אדיר",
    lore: "עגלה שלמה נגררת אחריו, וחצי מהעיר יצאה לראות.",
    weight: 9,
    min: 1.9,
    max: 2.4,
  },
  {
    key: "legend",
    label: "מסע אגדי",
    lore: "על מסע כזה מספרים בטברנות שנים אחרי שהגיבור כבר איננו.",
    weight: 3,
    min: 2.8,
    max: 3.6,
  },
];

const FORTUNE_WEIGHT_TOTAL = HERO_QUEST_FORTUNES.reduce((sum, f) => sum + f.weight, 0);

/** The band a stored `fortune` key refers to — unknown keys read as "as usual". */
export function heroQuestFortuneByKey(key: string): HeroQuestFortune {
  return (
    HERO_QUEST_FORTUNES.find((f) => f.key === key) ??
    HERO_QUEST_FORTUNES.find((f) => f.key === "plain")!
  );
}

/** Draw a band, then a multiplier inside it. */
export function rollHeroQuestFortune(
  random: () => number = secureRandom
): { fortune: HeroQuestFortune; multiplier: number } {
  let ticket = random() * FORTUNE_WEIGHT_TOTAL;
  let fortune = HERO_QUEST_FORTUNES[HERO_QUEST_FORTUNES.length - 1]!;
  for (const band of HERO_QUEST_FORTUNES) {
    ticket -= band.weight;
    if (ticket < 0) {
      fortune = band;
      break;
    }
  }
  return { fortune, multiplier: fortune.min + random() * (fortune.max - fortune.min) };
}

/**
 * On top of the run's luck, each resource wobbles on its own, and one is always
 * conspicuously fat while another is conspicuously thin.
 *
 * This is the difference between "the quest paid 1.4× today" and "he came back
 * with a mountain of iron and almost no stone" — the first is a number, the
 * second is a story, and they cost the same to implement. The rich and the lean
 * slots roughly cancel, so the mean haul is untouched.
 */
export const HERO_QUEST_WOBBLE_MIN = 0.72;
export const HERO_QUEST_WOBBLE_MAX = 1.28;
export const HERO_QUEST_RICH_SHARE = 1.45;
export const HERO_QUEST_LEAN_SHARE = 0.6;

/**
 * Resource payout multiplier per city held. The same ×2.4 curve the city boss
 * pays on, so quest income keeps pace with the empire exactly as boss loot
 * does — and, like the boss, it is keyed to the empire's own city count so a
 * lost city lowers it automatically.
 */
export const HERO_QUEST_REWARD_CITY_MULTIPLIER = 2.4;

/**
 * People grow on a far gentler curve than resources, and — unlike resources —
 * they do **not** grow with the season day at all.
 *
 * Both rules exist for the same reason: a citizen becomes a mine slave, and a
 * mine slave multiplies with the city production multiplier, so people are
 * resources one step removed and paying them on the resource curve compounds
 * into the economy twice. Letting the seasonal factor touch them as well makes
 * that a third time: on the ×2.4 curve with ×12.8 of day-60 growth, one
 * full-day quest would hand over ~9,000 citizens — nine times what a maxed
 * CITIZEN_GROWTH upgrade pays across a whole day, which would retire the
 * upgrade. Cities alone, and the quest tops out near one daily update's worth.
 */
export const HERO_QUEST_PEOPLE_CITY_MULTIPLIER = 1.35;

/** Fraction of the base added per elapsed season day — the boss's rate. */
export const HERO_QUEST_REWARD_DAILY_GROWTH = 0.2;

/** The season-day factor applied to the resource half of the haul. */
function seasonalGrowth(day: number): number {
  return 1 + HERO_QUEST_REWARD_DAILY_GROWTH * (Math.max(1, day) - 1);
}

function byCities(base: number, cityMultiplier: number, cities: number): number {
  return base * Math.pow(cityMultiplier, clampTier(cities) - 1);
}

/**
 * The unrounded centre of the haul, before the run's own luck. Shared by the
 * average (`heroQuestReward`) and the roll, so the two can never drift apart.
 *
 * Note the tier only enters through the *duration*: two empires with the same
 * cities earn the same per hour whichever rung they picked. See the header.
 */
function baseHaul(
  tier: number,
  cities: number,
  day: number,
  multiplier: number
): HeroQuestReward {
  const hours = heroQuestHours(tier);
  const res = (base: number) =>
    byCities(base * hours, HERO_QUEST_REWARD_CITY_MULTIPLIER, cities) *
    seasonalGrowth(day) *
    multiplier;
  // No seasonal factor here — see HERO_QUEST_PEOPLE_CITY_MULTIPLIER.
  const people = (base: number) =>
    byCities(base * hours, HERO_QUEST_PEOPLE_CITY_MULTIPLIER, cities) * multiplier;
  return {
    gold: res(HERO_QUEST_REWARD_PER_HOUR.gold),
    wood: res(HERO_QUEST_REWARD_PER_HOUR.wood),
    iron: res(HERO_QUEST_REWARD_PER_HOUR.iron),
    stone: res(HERO_QUEST_REWARD_PER_HOUR.stone),
    citizens: people(HERO_QUEST_REWARD_PER_HOUR.citizens),
    slaves: people(HERO_QUEST_REWARD_PER_HOUR.slaves),
  };
}

/** Resources land on round hundreds; people are people. */
const round100 = (value: number) => Math.max(0, Math.round(value / 100) * 100);
const roundPeople = (value: number) => Math.max(1, Math.round(value));

/**
 * The *average* haul of a quest of `tier` run by an empire holding `cities`
 * cities on season day `day`. `multiplier` is the admin-tunable global scalar.
 *
 * No player-facing surface shows this — it is the balance number, for the admin
 * console and for reasoning about the economy. What a player actually receives
 * comes from `rollHeroQuestReward`, which multiplies this by the run's luck.
 */
export function heroQuestReward(
  tier: number,
  cities: number,
  day: number,
  multiplier = 1
): HeroQuestReward {
  const base = baseHaul(tier, cities, day, multiplier);
  return {
    gold: round100(base.gold),
    wood: round100(base.wood),
    iron: round100(base.iron),
    stone: round100(base.stone),
    citizens: roundPeople(base.citizens),
    slaves: roundPeople(base.slaves),
  };
}

export interface HeroQuestRoll {
  reward: HeroQuestReward;
  /** The band that was drawn — its key is what the quest row stores. */
  fortune: HeroQuestFortune;
}

/** Every kind a homecoming can pay in — the reveal panel's tile set. */
export type HeroQuestHaulKind = keyof HeroQuestReward | "xp";

/**
 * What each kind is called when the hero walks back through the gate. Lives
 * here rather than beside the collect action so both the server's fallback
 * sentence and the client's reveal panel read from one list — a "use server"
 * module can only export async functions, so it cannot hold the map itself.
 */
export const HERO_QUEST_HAUL_LABEL: Record<HeroQuestHaulKind, string> = {
  gold: "זהב",
  wood: "עץ",
  iron: "ברזל",
  stone: "אבן",
  citizens: "אזרחים",
  slaves: "עבדי מכרות",
  xp: "ניסיון",
};

/**
 * One expedition's actual haul: the centre, times the run's fortune, times a
 * per-resource wobble.
 *
 * People take the *square root* of the fortune rather than the fortune itself.
 * They already grow on a gentler curve for a reason spelled out at
 * HERO_QUEST_PEOPLE_CITY_MULTIPLIER — a citizen becomes a mine slave and a mine
 * slave multiplies with city production, so people are resources one step
 * removed. Letting a ×3.6 legendary roll land on them in full would hand over a
 * population spike no upgrade could match; the root keeps the good runs
 * *noticeably* better without making them the way to grow a city.
 */
export function rollHeroQuestReward(
  tier: number,
  cities: number,
  day: number,
  multiplier = 1,
  random: () => number = secureRandom
): HeroQuestRoll {
  const base = baseHaul(tier, cities, day, multiplier);
  const { fortune, multiplier: luck } = rollHeroQuestFortune(random);

  // Which resource the road was generous with, and which it was stingy with.
  // `lean` is picked out of the remaining slots, so it can never be `rich`.
  const count = HERO_QUEST_REWARD_RESOURCES.length;
  const rich = Math.min(count - 1, Math.floor(random() * count));
  const lean = (rich + 1 + Math.floor(random() * (count - 1))) % count;

  const reward: HeroQuestReward = {
    gold: 0,
    wood: 0,
    iron: 0,
    stone: 0,
    citizens: roundPeople(base.citizens * Math.sqrt(luck)),
    slaves: roundPeople(base.slaves * Math.sqrt(luck)),
  };
  HERO_QUEST_REWARD_RESOURCES.forEach((key, index) => {
    const wobble =
      HERO_QUEST_WOBBLE_MIN + random() * (HERO_QUEST_WOBBLE_MAX - HERO_QUEST_WOBBLE_MIN);
    const share =
      index === rich ? HERO_QUEST_RICH_SHARE : index === lean ? HERO_QUEST_LEAN_SHARE : 1;
    reward[key] = round100(base[key] * luck * wobble * share);
  });

  return { reward, fortune };
}

/* ------------------------------ hero XP ------------------------------ */

/**
 * XP per hour of expedition. Unlike the resources, this *does* climb with the
 * quest's tier: hero levels are a fixed 100-rung ladder that no economy scales,
 * so the only sensible axis is how dangerous the errand was.
 *
 * The full-day run at tier 10 pays ~1,900 XP, a little under one city-boss run
 * — a hero can be levelled by questing alone, just slower than by fighting.
 */
export const HERO_QUEST_XP_PER_HOUR_BASE = 18;
export const HERO_QUEST_XP_PER_HOUR_PER_TIER = 7;

export function heroQuestXp(tier: number): number {
  const t = clampTier(tier);
  return Math.round(
    HERO_QUEST_HOURS[t - 1] *
      (HERO_QUEST_XP_PER_HOUR_BASE + HERO_QUEST_XP_PER_HOUR_PER_TIER * (t - 1))
  );
}

/* ------------------------------ labels ------------------------------ */

/**
 * "שעה" / "שעתיים" / "12 שעות" — a quest's length as a player reads it.
 *
 * Takes the translator: Hebrew has a dual, so one, two and many hours are three
 * different sentences rather than one sentence with a number in it.
 */
export function heroQuestDurationLabel(t: T, tier: number): string {
  const hours = heroQuestHours(tier);
  if (hours === 1) return t("שעה");
  if (hours === 2) return t("שעתיים");
  return t("{count} שעות", { count: hours });
}
