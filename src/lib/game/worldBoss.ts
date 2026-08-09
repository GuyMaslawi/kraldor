import type { IconName } from "@/components/ui/Icon";
import { seededRandom } from "./random";
import { scaleRewards, type Reward } from "./rewards";

/**
 * מפלצת העולם — one enemy the whole server fights at once.
 *
 * Every fight in the game is between two players or between a player and their
 * own city's boss. Both are zero-sum or private: nobody has ever had a reason
 * to care what a stranger in another city did today. A world boss is the one
 * fixture where the entire server is on the same side, where a small empire's
 * contribution is visible next to a large one's, and where the interesting
 * question is "will we get it down in time" rather than "can I beat him".
 *
 * ## It is a fixture, not an event
 *
 * There is no admin button. The boss **spawns on the clock** — one per Jerusalem
 * week, created lazily the first time anybody looks at the arena that week, the
 * same way a mission board and a guild contract are. Three things follow, and
 * all three are why it was built this way:
 *
 *  - Nothing has to be running for the game to have a world boss. No scheduler,
 *    no cron, no admin who has to remember.
 *  - Which boss appears is a pure function of the week, so every player computes
 *    the same answer with no writer, and the row can be created by whoever gets
 *    there first (the unique index drops the losers).
 *  - The whole server is on the same timer, which is the only way "we are 60%
 *    through and it is Thursday" means anything to anybody.
 *
 * ## What a strike costs and what it does
 *
 * A strike costs turns — the game's real currency of attention — and deals
 * damage proportional to the striker's military power. That makes a large
 * empire's blow genuinely larger, which it should be, and it is why the reward
 * is **not** purely proportional: see WORLD_BOSS_FLOOR_SHARE.
 */

/* ------------------------------ the catalog ------------------------------ */

export interface WorldBossDefinition {
  /** Stable key stored on the row. Never reuse or rename one. */
  key: string;
  name: string;
  /** Two lines of flavour, shown above the health bar. */
  lore: string;
  /** Emoji sigil — the arena is one card, and there is no art to load. */
  sigil: string;
  icon: IconName;
  /** Accent as an `R G B` triple, so the arena tints from one token. */
  accent: string;
  /**
   * Multiplier on the week's health pool. The whole difficulty dial: a 0.8
   * beast is a Tuesday kill, a 1.4 one needs the server to actually turn up.
   */
  toughness: number;
}

/**
 * Six of them, drawn one per week. They differ in flavour and in one number,
 * which is the honest amount of variety a fixture like this can carry without
 * becoming six features to balance.
 */
export const WORLD_BOSSES: readonly WorldBossDefinition[] = [
  {
    key: "ashworm",
    name: "תולעת האפר",
    lore: "היא עלתה מתחת לארץ האפר ובלעה שיירה שלמה לפני שמישהו הספיק לצעוק. הדרך דרומה סגורה עד שהיא תיפול.",
    sigil: "🪱",
    icon: "mine",
    accent: "196 120 60",
    toughness: 0.85,
  },
  {
    key: "iron_colossus",
    name: "קולוסוס הברזל",
    lore: "מבנה בגובה חומה שצועד לאט ולא עוצר. איש אינו יודע מי בנה אותו ולא ברור שיש בפנים מישהו.",
    sigil: "🗿",
    icon: "shield",
    accent: "150 168 190",
    toughness: 1.25,
  },
  {
    key: "storm_drake",
    name: "דרקון הסופה",
    lore: "הוא מגיע עם העננים ויוצא מהם רק כדי לקחת. שלוש ערים כבר איבדו את גגותיהן השבוע.",
    sigil: "🐉",
    icon: "attack",
    accent: "96 156 224",
    toughness: 1.1,
  },
  {
    key: "plague_herald",
    name: "מבשר הדבר",
    lore: "הוא אינו נלחם. הוא פשוט עומד, והמכרות שסביבו מפסיקים להפיק. זה מספיק.",
    sigil: "☠️",
    icon: "potion",
    accent: "150 96 232",
    toughness: 0.95,
  },
  {
    key: "crown_wraith",
    name: "רוח הכתר",
    lore: "מה שנשאר מהקיסר האפל הראשון, ומה שהוא רוצה זה בדיוק מה שיש לך.",
    sigil: "👑",
    icon: "crown",
    accent: "228 195 90",
    toughness: 1.4,
  },
  {
    key: "deep_leviathan",
    name: "לווייתן המעמקים",
    lore: "הנמלים ריקים מאז יום שלישי. הדייגים אומרים שהם ראו עין, ואיש לא צחק.",
    sigil: "🐋",
    icon: "storage",
    accent: "62 200 140",
    toughness: 1.0,
  },
];

export const WORLD_BOSS_BY_KEY = new Map(WORLD_BOSSES.map((b) => [b.key, b]));

/**
 * Retuning the table changes what a given week draws, which would swap a live
 * boss out from under a server mid-fight. Bump this instead, and the reroll is
 * deliberate.
 */
export const WORLD_BOSS_ROLL_VERSION = "v1";

/**
 * The boss for a given Jerusalem week — a pure function of the week index, so
 * every player computes the same answer with no writer.
 */
export function rollWorldBoss(week: number): WorldBossDefinition {
  const random = seededRandom(`${WORLD_BOSS_ROLL_VERSION}:${week}`);
  return (
    WORLD_BOSSES[Math.floor(random() * WORLD_BOSSES.length)] ?? WORLD_BOSSES[0]
  );
}

/* ------------------------------ health ------------------------------ */

/**
 * Health per participating empire, before the beast's own toughness.
 *
 * Scaled by the number of empires rather than fixed, because a fixture that is
 * impossible on a quiet server and trivial on a busy one is not a fixture. The
 * figure is calibrated against `strikeDamage` below: at the shipped numbers an
 * average empire's week of strikes is roughly one empire's share, so a server
 * where most people turn up wins and one where they do not falls short.
 */
export const WORLD_BOSS_HP_PER_EMPIRE = 40_000;

/** The floor, so a server with three players still meets something. */
export const WORLD_BOSS_HP_MIN = 250_000;

/**
 * The health pool for a week.
 *
 * Frozen onto the row at spawn (never recomputed), which matters for the same
 * reason the guild contract's goal is frozen: a boss that grew because somebody
 * registered on Thursday would punish the server for growing.
 */
export function worldBossMaxHp(
  boss: WorldBossDefinition,
  empires: number
): number {
  const pool = Math.max(1, Math.floor(empires)) * WORLD_BOSS_HP_PER_EMPIRE;
  return Math.max(WORLD_BOSS_HP_MIN, Math.round(pool * boss.toughness));
}

/* ------------------------------ striking ------------------------------ */

/** Turns one strike costs. A real price — about four ordinary attacks. */
export const WORLD_BOSS_STRIKE_TURNS = 40;

/**
 * Strikes one empire may land per week.
 *
 * A cap rather than turns alone, and it is the fairness mechanism: without it,
 * the empire with the largest turn income would land ten times as many blows as
 * anybody else *and* hit harder on each, and the damage board would be a copy of
 * the power ladder with extra steps.
 */
export const WORLD_BOSS_MAX_STRIKES = 20;

/**
 * Damage per point of military power. Sub-linear on purpose — see
 * `strikeDamage`.
 */
export const WORLD_BOSS_DAMAGE_PER_POWER = 12;

/**
 * What one blow takes off.
 *
 * The **square root** of military power, not power itself. A linear term would
 * make an empire with a hundred times the army worth a hundred blows from
 * everybody else, so the board would be settled before the small empires had
 * loaded the page, and their share of the reward would round to nothing. The
 * root keeps a big empire clearly better — ten times the power is a little over
 * three times the blow — while leaving a small one's contribution visible.
 *
 * A floor of one point of damage means a brand-new empire with no army at all
 * still moves the bar, which is the difference between "I helped" and "why is
 * this page here".
 */
export function strikeDamage(militaryPower: number): number {
  const power = Math.max(0, militaryPower);
  return Math.max(1, Math.round(Math.sqrt(power) * WORLD_BOSS_DAMAGE_PER_POWER));
}

/* ------------------------------ the spoils ------------------------------ */

/**
 * The purse one empire takes for the whole week, quoted at **one city**;
 * `scaleRewards` applies the city curve at claim time.
 *
 * Sized against a day of hero questing rather than against a boss run: this is
 * paid once a week to everybody who turned up, so it has to be worth the twenty
 * strikes it cost without being the week's main income.
 */
export const WORLD_BOSS_PURSE: readonly Reward[] = [
  { kind: "gold", amount: 120_000 },
  { kind: "iron", amount: 60_000 },
  { kind: "turns", amount: 150 },
  { kind: "wheelSpins", amount: 2 },
];

/**
 * How much of the purse is paid for *showing up* rather than for damage.
 *
 * Half. This is the number that decides whether the fixture is worth a small
 * empire's time, and it is deliberately generous: damage is proportional to the
 * square root of power (see `strikeDamage`), so even with the root a top empire
 * out-damages a new one many times over, and a purely proportional split would
 * pay the newcomer a rounding error for the same twenty strikes.
 *
 * The other half is proportional to share of damage, so carrying the fight is
 * still worth carrying it.
 */
export const WORLD_BOSS_FLOOR_SHARE = 0.5;

/**
 * Diamonds for the killing blow, and for nothing else.
 *
 * The one part of the fixture that is not shared. A world boss needs a moment
 * that belongs to somebody — the server should know who put it down — and a
 * small, unpredictable prize is the cheapest way to have one. It cannot be
 * farmed: which strike lands last depends on every other player's timing.
 */
export const WORLD_BOSS_KILL_DIAMONDS = 100;

/**
 * What an empire's participation is worth, as a multiplier on the purse.
 *
 * `share` is this empire's fraction of the total damage dealt. The floor half
 * is split evenly among everyone who landed a blow; the other half is
 * proportional. An empire that did nothing gets nothing — this is only ever
 * called for one that struck.
 */
export function worldBossShare(share: number, participants: number): number {
  const heads = Math.max(1, Math.floor(participants) || 1);
  const even = WORLD_BOSS_FLOOR_SHARE / heads;
  const earned = (1 - WORLD_BOSS_FLOOR_SHARE) * Math.max(0, Math.min(1, share));
  return even + earned;
}

/**
 * The purse an empire actually takes.
 *
 * Rounded up to at least one of each kind it pays: a share that multiplies 150
 * turns down to 0.4 should hand over a turn, not nothing — the whole point of
 * the floor is that turning up is never worth zero.
 */
export function worldBossReward(
  share: number,
  participants: number,
  cities: number
): Reward[] {
  const factor = worldBossShare(share, participants);
  return scaleRewards(
    WORLD_BOSS_PURSE.map((r) => ({
      kind: r.kind,
      amount: Math.max(1, Math.round(r.amount * factor)),
    })),
    cities
  );
}

/* ------------------------------ view model ------------------------------ */

/** One row of the damage board. */
export interface WorldBossStriker {
  empireId: string;
  empireName: string;
  damage: number;
  hits: number;
  /** The viewer — their own row is marked rather than hidden. */
  isMe: boolean;
}

/** The arena, as the screen renders it. */
export interface WorldBossState {
  key: string;
  name: string;
  lore: string;
  sigil: string;
  icon: IconName;
  accent: string;

  maxHp: number;
  hp: number;
  /** True once hp reached zero. */
  defeated: boolean;
  /** Who landed the killing blow, if it is down. */
  slayerName: string | null;

  /** When the week's fixture closes, epoch ms. */
  endsAt: number;
  serverNow: number;

  /** Strikes this empire has left this week. */
  strikesLeft: number;
  strikeTurns: number;
  /** The viewer's turns, so the button can say why it is disabled. */
  turns: number;
  /** Damage this empire has dealt. */
  myDamage: number;
  /** Everyone who has struck, most damage first (capped for display). */
  board: WorldBossStriker[];
  participants: number;

  /** The viewer may collect their share. */
  claimable: boolean;
  /** Already collected. */
  claimed: boolean;
  /** What the viewer's share is worth right now. */
  reward: Reward[];
}
