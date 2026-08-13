// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { WeaponCategory } from "@prisma/client";
import { MAX_CITIES } from "./constants";
import { HERO_MAX_LEVEL } from "./hero";

/* ------------------------------ weapon categories ------------------------------ */

export interface WeaponCategoryMeta {
  label: string;
  icon: string;
  /** "כוח X מנשקים" summary label. */
  powerLabel: string;
}

export const WEAPON_CATEGORY_META: Record<WeaponCategory, WeaponCategoryMeta> = {
  ATTACK: { label: "התקפה", icon: "⚔️", powerLabel: "כוח התקפה מנשקים" },
  DEFENSE: { label: "הגנה", icon: "🛡️", powerLabel: "כוח הגנה מנשקים" },
  SPY: { label: "ריגול", icon: "🕵️", powerLabel: "כוח ריגול מנשקים" },
};

export const WEAPON_CATEGORIES = Object.keys(
  WEAPON_CATEGORY_META
) as WeaponCategory[];

/* ------------------------------ weapon definitions ------------------------------ */

export interface WeaponCost {
  gold: number;
  wood: number;
  iron: number;
  stone: number;
}

export interface WeaponDefinition {
  key: string;
  category: WeaponCategory;
  name: string;
  description: string;
  tier: number;
  power: number;
  cost: WeaponCost;
}

/** Number of weapon tiers per category — 35 per category, 105 in total. */
export const TIERS_PER_CATEGORY = 35;

/**
 * Cost doubles every tier, power grows by 2.5× every tier — the same rule in
 * all three categories. Power outrunning cost is deliberate: it is what makes a
 * higher tier worth buying instead of stacking more of the cheap one. Every
 * tier buys 25% more power per gold than the tier below it.
 *
 * Cost rule: gold is always double every other resource, and tier 1 starts at
 * 50 gold / 25 of each other resource — so tier `t` costs
 * gold = 50·2^(t-1), wood/iron/stone = 25·2^(t-1).
 */
const BASE_GOLD_COST = 50;
const BASE_OTHER_COST = 25;
/** Cost multiplier per tier. */
export const WEAPON_COST_GROWTH = 2;
/** Power multiplier per tier — higher than the cost growth on purpose. */
export const WEAPON_POWER_GROWTH = 2.5;
const BASE_POWER: Record<WeaponCategory, number> = {
  ATTACK: 5,
  DEFENSE: 5,
  SPY: 4,
};

function weaponCostForTier(tier: number): WeaponCost {
  const mult = WEAPON_COST_GROWTH ** (tier - 1);
  return {
    gold: BASE_GOLD_COST * mult,
    wood: BASE_OTHER_COST * mult,
    iron: BASE_OTHER_COST * mult,
    stone: BASE_OTHER_COST * mult,
  };
}

function weaponPowerForTier(category: WeaponCategory, tier: number): number {
  // Rounded so power is always a whole number; the ratio between neighbouring
  // tiers stays 2.5 to within the rounding of the first few (tiny) tiers.
  return Math.round(BASE_POWER[category] * WEAPON_POWER_GROWTH ** (tier - 1));
}

/**
 * Per-tier flavor (name + description), tier 1 → tier 35, ordered from the most
 * basic weapon up to the ultimate one. Cost and power come from the formulas
 * above; only the flavor lives here.
 */
type WeaponFlavor = readonly [name: string, description: string];

const ATTACK_FLAVOR: readonly WeaponFlavor[] = [
  ["חרבות ברזל", "חרבות בסיסיות ואמינות לחיילי החזית."],
  ["קשתות קרב", "קשתות ארוכות טווח שפוגעות באויב עוד לפני ההתנגשות."],
  ["גרזני מלחמה", "גרזנים כבדים ששוברים מגן ועצם כאחד."],
  ["רמחי פרשים", "רמחים ארוכים להסתערות פרשים מוחצת."],
  ["בליסטראות", "מכונות ירי כבדות שמרסקות שורות שלמות של אויבים."],
  ["איילי ניגוח", "קורות ברזל שמפרקות שערים וחומות."],
  ["מנגנוני קטפולט", "אבני ענק עפות מעל החומות אל לב האויב."],
  ["תותחי מצור", "תותחים אדירים שמפילים חומות ומבצרים."],
  ["רובי אבק שריפה", "נשק חם ראשון ששובר את מערכות הקרב הישנות."],
  ["להבי אש", "להבים אגדיים עטופי אש — נשק העילית של האימפריה."],
  ["מטילי להביור", "מכונות שיורות סילוני אש על שדה הקרב."],
  ["תותחי רעם", "תותחים שקולם לבדו מפיל אימה על האויב."],
  ["מרגמות ברק", "פגזים שמתפוצצים בברק כחול על הכוחות."],
  ["רובאי צלפים", "יחידת עילית שפוגעת במפקדי האויב מרחוק."],
  ["מכונות ירי מהיר", "מטר כדורים בלתי פוסק שמכסה את כל החזית."],
  ["טנקי פלדה", "מפלצות משוריינות שדורסות כל התנגדות."],
  ["תותחי ענק", "לוע ברזל שמוחק ביצורים בפגז אחד."],
  ["משגרי טילים", "טילים מונחים שרודפים את האויב עד חיסולו."],
  ["מפציצי אש", "מכונות מעופפות שממטירות אש מהשמיים."],
  ["קרני לייזר", "אלומות אנרגיה שחותכות שריון כמו חמאה."],
  ["תותחי פלזמה", "כדורי פלזמה בוערים ששורפים כל דבר בדרכם."],
  ["רובי חלקיקים", "נשק שמפרק את האויב לרמת האטום."],
  ["משגרי אלקטרומגנט", "פגזים במהירות על-קולית שמנקבים כל מבצר."],
  ["רחפני נחיל", "נחיל מכונות זעירות שתוקף מכל כיוון בו-זמנית."],
  ["תותחי חורבן", "נשק כבד שמשאיר מכתשים בשדה הקרב."],
  ["מחוללי הדף", "גלי הלם שמוחקים גדודים שלמים בבת אחת."],
  ["להבי אנרגיה טהורה", "חרבות אור שחותכות דרך כל הגנה."],
  ["תותחי סינגולריות", "נשק שיוצר חור שחור זעיר בלב האויב."],
  ["משמידי ממדים", "נשק שמוחק את האויב מהמציאות עצמה."],
  ["יד קראלדור", "יד הברזל של הכתר — אין בעולם הזה כוח שעומד מולה."],
  ["שוברי כוכבים", "תותחים שמנפצים גרמי שמיים לרסיסים בוערים."],
  ["סופות אנטי-חומר", "ענני חומר נגדי שמאיינים כל מה שהם נוגעים בו."],
  ["להבי אינסוף", "חרבות שהלהב שלהן פשוט לא נגמר."],
  ["מכת האלים", "רעם שיורד מהשמיים ומוחק צבאות שלמים בבת אחת."],
  ["זעם קראלדור", "הנשק האולטימטיבי — זעם שמוחק ממלכות מן הקיום."],
];

const DEFENSE_FLAVOR: readonly WeaponFlavor[] = [
  ["מגני עץ", "מגנים פשוטים שבולמים את המכות הראשונות."],
  ["שריון ברזל", "שריון כבד שמגן על החיילים בקרב פנים אל פנים."],
  ["קסדות פלדה", "קסדות שמגנות על הלוחמים מפגיעות ראש."],
  ["שריון קשקשים", "שריון גמיש שסופג מכות ומאפשר תנועה חופשית."],
  ["חומות חניתות", "שורות חניתות דחוסות שעוצרות כל הסתערות."],
  ["תעלות הגנה", "תעלות עמוקות שמאטות את הסתערות האויב."],
  ["סוללות עפר", "סוללות מבוצרות שמגנות על המחנה."],
  ["מגדלי שמירה", "מגדלים מבוצרים שיורים באויב מלמעלה."],
  ["חומות אבן", "חומות עבות שעומדות בפני כל מצור."],
  ["חומת קראלדור", "החומה האיתנה שסביבה נבנתה הממלכה."],
  ["שערי ברזל", "שערים כבדים שאף איל ניגוח לא שובר."],
  ["מבצרי פלדה", "מצודות ממתכת שאין דרך לחדור אליהן."],
  ["מגיני מצור", "מערך הגנה שסופג פגזי קטפולט ותותח."],
  ["שריון מרוכב", "שכבות מתכת מרובות שסופגות כל פגיעה."],
  ["כיפת מגן", "מערך שמיירט קליעים לפני שהם פוגעים."],
  ["בונקרים מבוצרים", "מקלטים תת-קרקעיים שאי אפשר לפצח."],
  ["חומות ריאקטיביות", "שריון שמתפוצץ החוצה ומנטרל פגזים."],
  ["מגני אנרגיה", "שדות כוח שבולמים את אש האויב."],
  ["כיפת ברזל", "מערך יירוט שמפיל כל טיל באוויר."],
  ["מגן פלזמה", "קיר פלזמה בוער ששורף כל מתקרב."],
  ["שדות כוח", "מחסום אנרגיה בלתי חדיר סביב המבצר."],
  ["שריון ננו", "שריון שמתקן את עצמו תוך שניות."],
  ["מגני עקיפה", "טכנולוגיה שמסיטה קליעים מהמסלול."],
  ["מבצר מרחף", "מצודה מעופפת שאי אפשר להגיע אליה."],
  ["חומות קוונטיות", "הגנה שקיימת בכמה ממדים בו-זמנית."],
  ["מגן סינגולריות", "שדה שבולע כל התקפה לתוך עצמו."],
  ["שריון על-ממדי", "הגנה שהאויב פשוט לא מסוגל לגעת בה."],
  ["כיפת נצח", "מגן שלא נפרץ מעולם בכל ההיסטוריה."],
  ["חומת המציאות", "מחסום ששובר את חוקי הפיזיקה עצמם."],
  ["מבצר קראלדור", "מצודת הכתר — אין בעולם הזה צבא שמפיל אותה."],
  ["חומות נצח", "אבן שלא נסדקת גם אחרי אלף מצורים."],
  ["מגני אנטי-חומר", "שכבה שמאיינת כל פגז עוד באוויר."],
  ["שריון אינסוף", "שריון שמתעבה עוד ועוד ככל שמכים בו."],
  ["כיפת האלים", "מגן שהאלים עצמם פרשו מעל הממלכה."],
  ["מגן קראלדור", "ההגנה האולטימטיבית — שום כוח ביקום לא חודר אותה."],
];

const SPY_FLAVOR: readonly WeaponFlavor[] = [
  ["גלימות הסוואה", "גלימות שמסתירות את המרגלים מעיני השומרים."],
  ["סכיני צללים", "סכינים שקטים למשימות חשאיות במיוחד."],
  ["כלי פריצה", "ערכות לפתיחת מנעולים ושערים סמויים."],
  ["תחפושות סוחרים", "מסווה שמאפשר להיכנס לכל עיר בלי חשד."],
  ["עורבי מודיעין", "עורבים מאולפים שמעבירים מסרים מעבר לקווי האויב."],
  ["רשת מודיעים", "עיניים ואוזניים בכל פונדק ושוק."],
  ["סמים מרדימים", "שיקויים שמפילים שומרים בשקט."],
  ["אבקת היעלמות", "אבקה שמעלימה את המרגל בענן עשן."],
  ["מפות סתר", "מפות מדויקות של כל ביצורי האויב."],
  ["טבעות התחזות", "טבעות קסומות שמאפשרות למרגל להתחזות לכל אדם."],
  ["יוני דואר", "מסרים מוצפנים שעפים מעל קווי האויב."],
  ["משקפות ליל", "עדשות שרואות בחשכה מוחלטת."],
  ["מכשירי האזנה", "מכשירים שקולטים כל לחישה בארמון."],
  ["סוכני עומק", "מרגלים ששתולים שנים בלב האויב."],
  ["צפני סתרים", "שפה סודית שאיש אינו יכול לפצח."],
  ["רחפני ריגול", "עיניים מעופפות מעל מחנה האויב."],
  ["מצלמות זעירות", "עדשות נסתרות שמתעדות כל מסמך."],
  ["וירוסי מידע", "קוד שגונב תוכניות מארכיוני האויב."],
  ["רשת לוויינים", "עיניים בשמיים שרואות הכול מלמעלה."],
  ["פורצי הצפנה", "מכונות ששוברות כל קוד סתרים."],
  ["שתלי מוח", "טכנולוגיה שקוראת מחשבות של שבויים."],
  ["מרגלי כפילים", "עותקים מושלמים של מפקדי האויב."],
  ["רשת עצבים", "רשת שחודרת לכל מערכת מידע של האויב."],
  ["עיני צל", "חיישנים בלתי נראים בכל פינה בממלכה."],
  ["פורצי קוונטים", "מחשבים ששוברים כל הצפנה בשבריר שנייה."],
  ["רוחות רפאים", "סוכנים שאיש לא יודע שהם קיימים."],
  ["עין כול-רואה", "מערך שרואה כל תנועה בכל הממלכות."],
  ["תודעת רשת", "בינה שיודעת הכול עוד לפני שזה קורה."],
  ["עין המציאות", "ריגול שחודר את מסך הזמן עצמו."],
  ["עין קראלדור", "עין הכתר — אין סוד בממלכות שנסתר ממנה."],
  ["צופי נצח", "סוכנים ששומרים על היעד דורות שלמים בלי למצמץ."],
  ["רשת אינסוף", "רשת שמסתעפת לכל פינה בלי גבול ובלי סוף."],
  ["קוראי גורל", "מודיעין שקורא את מהלכי האויב לפני שהם נולדו."],
  ["עין האלים", "מבט שחודר כל שכבה של המציאות."],
  ["סוד קראלדור", "הריגול האולטימטיבי — כל האמת ביקום בידיים שלך."],
];

const CATEGORY_FLAVOR: Record<WeaponCategory, readonly WeaponFlavor[]> = {
  ATTACK: ATTACK_FLAVOR,
  DEFENSE: DEFENSE_FLAVOR,
  SPY: SPY_FLAVOR,
};

/** Static weapon definitions, generated from per-tier flavor + cost/power formulas. */
function buildWeapons(): WeaponDefinition[] {
  const out: WeaponDefinition[] = [];
  for (const category of WEAPON_CATEGORIES) {
    CATEGORY_FLAVOR[category].slice(0, TIERS_PER_CATEGORY).forEach(
      ([name, description], i) => {
        const tier = i + 1;
        out.push({
          key: `${category}_T${tier}`,
          category,
          name,
          description,
          tier,
          power: weaponPowerForTier(category, tier),
          cost: weaponCostForTier(tier),
        });
      }
    );
  }
  return out;
}

export const WEAPONS: readonly WeaponDefinition[] = buildWeapons();

export function weaponsOfCategory(category: WeaponCategory): WeaponDefinition[] {
  return WEAPONS.filter((w) => w.category === category).sort(
    (a, b) => a.tier - b.tier
  );
}

const WEAPON_BY_KEY = new Map(WEAPONS.map((w) => [w.key, w]));

export function weaponByKey(key: string): WeaponDefinition | undefined {
  return WEAPON_BY_KEY.get(key);
}

/**
 * Generated art for a weapon, as `public/weapons/<category>-t<tier>.webp`.
 * Every weapon in the catalogue has a piece — 105 of them, `TIERS_PER_CATEGORY`
 * × 3; the card still falls back to the category emoji if a file is ever
 * missing, so art and code stay independent.
 */
export function weaponArtPath(weapon: WeaponDefinition): string {
  return `/weapons/${weapon.category.toLowerCase()}-t${weapon.tier}.webp`;
}

/* ------------------------------ tier unlocks ------------------------------ */

/** Every category starts with the first two weapon tiers unlocked. */
export const INITIAL_WEAPON_UNLOCKED_TIER = 2;

export const MAX_WEAPON_TIER = TIERS_PER_CATEGORY;

/** Cost to unlock tier `currentUnlockedTier + 1` in a category. */
export function weaponTierUnlockCost(currentUnlockedTier: number): WeaponCost {
  return {
    gold: Math.round(2500 * currentUnlockedTier * 1.8),
    wood: Math.round(1200 * currentUnlockedTier * 1.6),
    iron: Math.round(1200 * currentUnlockedTier * 1.6),
    stone: Math.round(900 * currentUnlockedTier * 1.5),
  };
}

/* ------------------------------ progression gates ------------------------------ */

/**
 * Weapon progression is **shared** across all three categories — unlocking a
 * tier in one place (attack / defense / spy) advances all of them together.
 */

/** A higher city level + hero level requirement kicks in every this many tiers. */
export const WEAPON_GATE_EVERY = 4;
/** Hero level required grows by this much at every gate step. */
export const WEAPON_GATE_HERO_STEP = 10;

export interface WeaponTierGate {
  /** City level the empire must have reached to unlock this tier. */
  cities: number;
  /** Hero level required to unlock this tier. */
  heroLevel: number;
}

/**
 * Requirements to unlock up to `tier`. Every {@link WEAPON_GATE_EVERY} tiers
 * demands both a higher city level and a higher hero level, so weapons, hero
 * and city all advance in lockstep. Between gate steps the requirement stays
 * flat, so once a step is crossed the next few tiers open on resources alone.
 */
export function weaponTierGate(tier: number): WeaponTierGate {
  const step = Math.max(0, Math.floor((tier - 1) / WEAPON_GATE_EVERY));
  return {
    cities: Math.min(MAX_CITIES, 1 + step),
    heroLevel: Math.min(HERO_MAX_LEVEL, step * WEAPON_GATE_HERO_STEP),
  };
}

export interface WeaponGateStatus extends WeaponTierGate {
  citiesMet: boolean;
  heroLevelMet: boolean;
  /** True when both the city and hero-level requirements are satisfied. */
  met: boolean;
}

/** The gate for `tier` resolved against a specific empire's cities + hero level. */
export function weaponGateStatus(
  tier: number,
  cities: number,
  heroLevel: number
): WeaponGateStatus {
  const gate = weaponTierGate(tier);
  const citiesMet = cities >= gate.cities;
  const heroLevelMet = heroLevel >= gate.heroLevel;
  return { ...gate, citiesMet, heroLevelMet, met: citiesMet && heroLevelMet };
}

/* ------------------------------ power ------------------------------ */

export interface WeaponQuantityRow {
  weaponKey: string;
  quantity: number;
}

/** Sum of quantity * weapon power over the given category. */
export function weaponsPower(
  rows: readonly WeaponQuantityRow[],
  category: WeaponCategory
): number {
  let total = 0;
  for (const row of rows) {
    const weapon = weaponByKey(row.weaponKey);
    if (weapon?.category === category) total += row.quantity * weapon.power;
  }
  return total;
}

/**
 * Spy weapons slightly improve spy success chance: up to +15 percentage
 * points, one point per 100 spy weapon power.
 */
export function spyWeaponsBonusPercent(spyWeaponsPower: number): number {
  return Math.min(15, Math.floor(spyWeaponsPower / 100));
}

/** Final spy chance (fraction), capped at 95%. */
export function finalSpyChance(
  intelligenceChance: number,
  spyWeaponsPowerValue: number
): number {
  return Math.min(
    0.95,
    intelligenceChance + spyWeaponsBonusPercent(spyWeaponsPowerValue) / 100
  );
}
