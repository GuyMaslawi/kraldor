import {
  ENSLAVE_MIN_SOLDIERS,
  MAX_CITIES,
  SOLDIER_POWER,
  cityHeroLevelRequired,
} from "./constants";
import { HERO_MAX_LEVEL } from "./hero";
import {
  MAX_WEAPON_TIER,
  weaponByKey,
  weaponGateStatus,
  weaponsOfCategory,
} from "./weapons";

/**
 * Bot empires — the garrisons an admin plants in a city tier.
 *
 * This module is the *arithmetic* of a bot: what it is called, what it fields
 * and what its mines are worth. Nothing here touches the database —
 * src/server/bots.ts does the planting and the refilling, and the admin page
 * reads these same functions to describe what it is about to create.
 *
 * The problem a bot solves is a city with one player in it. Combat is confined
 * to your own city tier (see attackEmpire / spyOnEmpire), so the first player to
 * climb into תדמור finds a ladder with exactly one row on it — their own — and
 * every offensive action in the game becomes unavailable to them until someone
 * else arrives. A bot is a resident of that tier: raidable, spyable, worth loot,
 * and rebuilt after it is farmed.
 */

/* ------------------------------ how strong ------------------------------ */

/**
 * The whole of a bot's garrison: nineteen soldiers, no spies, no weapons.
 *
 * Bots used to be *sized* — a power figure, taken from the city's own average or
 * typed by the admin, spent on bodies and an arsenal so the garrison read as a
 * plausible neighbour. It did not survive contact with the game. The figure a
 * high city averages is enormous, and a bot built at it is not a target on the
 * way to the boss but the hardest empire in the tier, standing at the top of the
 * ladder the player is trying to climb.
 *
 * Nineteen is not a round number, it is {@link ENSLAVE_MIN_SOLDIERS} minus one:
 * enslavement only fires on a defender holding *twenty* soldiers or more, so a
 * garrison of nineteen can never be turned into mine slaves however many times
 * it is farmed. That is the point. A bot is planted so the lone resident of a
 * high city has somebody to attack and somebody to spy; it is not meant to be an
 * income stream, and every version of it that carried a real army was one —
 * a rebuilt garrison every hour is an infinite supply of bodies to enslave.
 *
 * So what is left is exactly the minimum that makes the target legal and worth
 * loading: an army that is not empty, mines that produce something to plunder,
 * and no power at all beyond the nineteen bodies themselves.
 */
export const BOT_SOLDIERS = ENSLAVE_MIN_SOLDIERS - 1;

/** Bots an admin may create in one submit, across all selected cities. */
export const BOT_BATCH_MAX = 50;

/** How long a plundered bot takes to rebuild its garrison. */
export const BOT_RESTORE_MS = 60 * 60 * 1000; // 1 hour

/**
 * The hero level a bot of this tier carries.
 *
 * `cityHeroLevelRequired` is what a *player* must reach to found the city one
 * tier below, so it is the honest reading of "the level of someone who lives
 * here". It matters for more than flavour: the ladder breaks power ties on hero
 * level, and it decides which weapon tier the garrison below may legitimately
 * carry.
 *
 * The bot's points are deliberately left unspent (see src/server/bots.ts): an
 * allocated point is +1% attack or defence, which would make the bot fight
 * harder than the power figure printed beside it on the ladder.
 */
export function botHeroLevel(cities: number): number {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  return Math.min(HERO_MAX_LEVEL, Math.max(1, cityHeroLevelRequired(tier - 1) || 1));
}

/**
 * The weapon tier this empire's city and hero level would legitimately unlock.
 *
 * A bot buys none of them — every stack is zero — but the tier is still stored
 * and still granted as an unlock, so a spy who gets into a bot reads a dossier
 * that is *consistent*: an empire of this city, at this hero level, with an
 * empty armoury. A tier nobody here could have reached would read as a bug.
 */
export function botWeaponTier(cities: number, heroLevel: number): number {
  let unlocked = 1;
  for (let tier = 1; tier <= MAX_WEAPON_TIER; tier++) {
    if (weaponGateStatus(tier, cities, heroLevel).met) unlocked = tier;
  }
  return unlocked;
}

/* ------------------------------ the garrison ------------------------------ */

export interface BotGarrison {
  soldiers: number;
  spies: number;
  weaponTier: number;
  attackWeapons: number;
  defenseWeapons: number;
  spyWeapons: number;
}

/**
 * What a bot is built with, and rebuilt to: {@link BOT_SOLDIERS} soldiers and
 * nothing else. It takes no power argument because there is nothing left to
 * spend one on — see the note on {@link BOT_SOLDIERS} for why.
 *
 * The city and hero level survive only to name the weapon tier the (empty)
 * armoury is recorded at.
 */
export function botGarrison(cities: number, heroLevel: number): BotGarrison {
  return {
    soldiers: BOT_SOLDIERS,
    spies: 0,
    weaponTier: botWeaponTier(cities, heroLevel),
    attackWeapons: 0,
    defenseWeapons: 0,
    spyWeapons: 0,
  };
}

/** The weapon keys a garrison's three (empty) stacks are recorded under. */
export function botWeaponKeys(weaponTier: number): {
  attack: string;
  defense: string;
  spy: string;
} {
  const keyOf = (category: "ATTACK" | "DEFENSE" | "SPY") =>
    weaponsOfCategory(category).find((w) => w.tier === weaponTier)?.key ?? "";
  return { attack: keyOf("ATTACK"), defense: keyOf("DEFENSE"), spy: keyOf("SPY") };
}

/**
 * Military power a garrison actually fields — soldiers + attack + defence
 * weapons, the ladder's own formula. With an empty armoury that is the bodies
 * alone, which is the whole of a bot's power by design; the arithmetic is kept
 * general so the figure stays true if a garrison ever carries weapons again.
 */
export function botRealisedPower(garrison: BotGarrison): number {
  const keys = botWeaponKeys(garrison.weaponTier);
  return (
    garrison.soldiers * SOLDIER_POWER +
    garrison.attackWeapons * (weaponByKey(keys.attack)?.power ?? 0) +
    garrison.defenseWeapons * (weaponByKey(keys.defense)?.power ?? 0)
  );
}

/* ------------------------------ the economy ------------------------------ */

/**
 * Slaves on each of a bot's mines.
 *
 * This used to follow the garrison — one slave per ten soldiers — which is no
 * longer a scale of anything now that every bot fields the same nineteen. It is
 * therefore its own number, and the one knob left that decides what a raid on a
 * bot is worth. Kept deliberately small: a bot is a sparring partner, not a
 * revenue stream, and its mines are only there so the raid has *something* in
 * it. Raise this if bots should be worth farming for resources.
 */
export const BOT_MINE_SLAVES = 5;

/**
 * A bot's mine level and slave count.
 *
 * Bots hold no stored (warehoused) resources on purpose — plunder only reaches
 * the *available* balance, and a bot whose purse is locked away is a bot worth
 * raiding once. Everything it owns is out in the open, and everything it owns
 * came out of its own mines on the ordinary clock: `applyPendingUpdates` settles
 * a bot's backlog the moment a raider loads it as a target, so the haul is
 * whatever it has genuinely produced since it was last robbed.
 *
 * The level tracks the tier — production is `level × 2` per assigned slave, so
 * a bot in a high city is still worth more per raid than one in a low city,
 * which is the only way its income is allowed to differ.
 */
export function botMineSetup(cities: number): { level: number; slavesPerMine: number } {
  const tier = Math.min(MAX_CITIES, Math.max(1, Math.floor(cities)));
  return {
    level: Math.max(1, tier * 4),
    slavesPerMine: BOT_MINE_SLAVES,
  };
}

/* ------------------------------ who is at the keyboard ------------------------------ */

/**
 * Share of the planted garrisons that read as online at any one moment.
 *
 * A bot has no browser, so nothing ever stamps its `lastSeenAt` — presence has
 * to be *decided* for it. It used to be decided as "always here", which was
 * defensible when a city held two or three garrisons and fatal now that a fresh
 * season opens with three pages of them: thirty rows all lit green, all at once,
 * for ever, is the one pattern no real city ever shows, and it announces which
 * rows are planted more loudly than a label would.
 *
 * So a third of them are at the keyboard, and which third changes through the
 * day. That is roughly what a live board looks like at a good hour, and it means
 * a player who comes back an hour later finds a different set of names lit — the
 * city reads as inhabited rather than as a fixture.
 */
export const BOT_ONLINE_SHARE = 0.35;

/**
 * How long one bot's "session" lasts, and therefore how often the roster of who
 * is here turns over.
 *
 * An hour, because both shorter and longer are wrong in visible ways: at a few
 * minutes the dots flicker between two refreshes of the same page (the ladder
 * re-reads every 30 seconds), and at a day the same names are lit every time
 * anybody looks. A session of {@link BOT_ONLINE_SHARE} of an hour — about
 * twenty minutes — outlasts a sitting at the ladder and still turns over while
 * the player is off doing something else.
 */
export const BOT_PRESENCE_CYCLE_MS = 60 * 60 * 1000;

/**
 * A stable number in [0, 1) from a string — FNV-1a, avalanched, folded into a
 * fraction.
 *
 * Deterministic on purpose, and that is the whole design: presence is recomputed
 * from scratch on every render, on every server, with no row to store it in and
 * no write to make. Two tabs looking at the same ladder in the same minute agree
 * because they compute the same answer, not because they read the same column.
 *
 * **The final mix is not decoration.** The seeds this is asked about differ in
 * their last character and nothing else — `bot:488688`, `bot:488689` — and plain
 * FNV-1a leaves the top bits of the result barely touched by the last byte it
 * ate. Taking a fraction reads exactly those top bits, so without the mix the
 * same garrisons came online hour after hour: a rota that never rotated, which
 * is the bug this whole mechanism exists to avoid. The finalizer is murmur3's
 * fmix32, whose job is precisely to carry a one-bit change into all thirty-two.
 */
function hashUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x1_0000_0000;
}

/**
 * Whether this bot shows the green dot right now.
 *
 * Each cycle the bot is given one session: a window of {@link BOT_ONLINE_SHARE}
 * of a cycle, opening at an offset drawn from the empire's own id and the cycle
 * number. Two things fall out of that shape, and both matter:
 *
 *   • the offsets differ per bot, so they do not switch on and off in unison at
 *     the top of the hour — they arrive and leave staggered, like people;
 *   • the previous cycle's window is tested too, so a session that opened at
 *     :52 runs past the boundary instead of being cut off by it.
 *
 * The average share of bots online at any instant is exactly
 * {@link BOT_ONLINE_SHARE}, since every cycle contributes one window per bot.
 */
export function botOnline(empireId: string, now: Date = new Date()): boolean {
  if (BOT_ONLINE_SHARE <= 0) return false;
  if (BOT_ONLINE_SHARE >= 1) return true;
  // Time measured in cycles, so a window is simply an interval on this axis.
  const t = now.getTime() / BOT_PRESENCE_CYCLE_MS;
  const open = (cycle: number) => {
    const start = cycle + hashUnit(`${empireId}:${cycle}`);
    return t >= start && t < start + BOT_ONLINE_SHARE;
  };
  const cycle = Math.floor(t);
  return open(cycle) || open(cycle - 1);
}

/* ------------------------------ the opening field ------------------------------ */

/**
 * The city a new season's garrisons are planted in.
 *
 * Always the first: a restart puts every player back at one city, so tier 1 is
 * the whole game for its opening days and the only tier that has to look
 * inhabited from the first minute. The tiers above fill up as players climb,
 * and the admin plants into them by hand from /admin/bots when one gets lonely.
 */
export const BOT_SEED_CITY = 1;

/* ------------------------------ the names ------------------------------ */

/**
 * Bot names are built, not drawn from a list, so a hundred of them never repeat
 * and none of them reads like a slot in a table. Two halves, both in the game's
 * register — a body of men and the thing they are named for.
 *
 * Deliberately indistinguishable from a player's empire name. A bot the ladder
 * marks as a bot is a target nobody bothers to raid, and the point of planting
 * one is that the lone resident of תדמור has someone to fight.
 */
const BOT_NAME_HEADS = [
  "בני",
  "שבט",
  "גדוד",
  "לגיון",
  "מסדר",
  "בית",
  "נסיכות",
  "ממלכת",
  "חיל",
  "משמר",
  "אנשי",
  "יורשי",
  "צאצאי",
  "נאמני",
  "שומרי",
] as const;

const BOT_NAME_TAILS = [
  "הנחושת",
  "העורב",
  "הזאב",
  "האפר",
  "הברזל",
  "הסהר",
  "המלח",
  "הבזלת",
  "הרעם",
  "הכפור",
  "החולות",
  "הלהבה",
  "הצללים",
  "השחר",
  "הנשר",
  "העקרב",
  "הגחלת",
  "החומה",
  "הנהר",
  "הכתר",
  "האורן",
  "הברקת",
  "הפלדה",
  "הדרקון",
  "הקרח",
] as const;

/** Every name this generator can produce, for the collision math. */
export const BOT_NAME_SPACE = BOT_NAME_HEADS.length * BOT_NAME_TAILS.length;

/**
 * One name from the space above. `pick` returns an integer in `[0, n)` — the
 * caller passes a real random source (crypto.randomInt on the server), which is
 * what keeps this file pure and testable.
 *
 * Empire names are unique, so the caller must be ready for a collision. With a
 * few hundred names available and bots created in tens, retrying is cheaper than
 * tracking what has been used; `botFallbackName` is the escape hatch when even
 * that runs out.
 */
export function botName(pick: (n: number) => number): string {
  const head = BOT_NAME_HEADS[pick(BOT_NAME_HEADS.length)];
  const tail = BOT_NAME_TAILS[pick(BOT_NAME_TAILS.length)];
  return `${head} ${tail}`;
}

/**
 * A name that cannot collide, for when the generated ones keep landing on names
 * already taken. Still reads as an empire — the number passes for a dynastic
 * ordinal rather than a database counter.
 */
export function botFallbackName(base: string, ordinal: number): string {
  return `${base} ${ordinal}`;
}
