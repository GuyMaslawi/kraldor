// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { IconName } from "@/components/ui/Icon";
import { secureRandom, seededRandom } from "./random";
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
 * day, opened lazily by the first game screen that looks after midnight, the
 * same way a mission board and a guild contract are. Three things follow, and
 * all three are why it was built this way:
 *
 *  - Nothing has to be running for the game to have a world boss. No scheduler,
 *    no cron, no admin who has to remember.
 *  - Which boss appears is a pure function of the day, so every player computes
 *    the same answer with no writer, and the row can be created by whoever gets
 *    there first (the unique index drops the losers).
 *  - The whole server is on the same timer, which is the only way "we are 60%
 *    through and it is nine in the evening" means anything to anybody.
 *
 * ## Every 24 hours, and why it is not every week
 *
 * It stood for a week until 2026-08-16, and a week is longer than this game's
 * unit of attention. A beast felled on Monday left five days of an arena saying
 * "already dead"; a beast nobody could fell left five days of one saying "still
 * standing" to a server that had stopped turning up. Either way there was one
 * moment in the fixture and six days of aftermath, and a player who missed the
 * moment had nothing to come back for.
 *
 * Daily is the same fixture at the cadence people actually play it. **The week
 * was held flat when it moved**: the health pool, the strike allowance and the
 * purse were all divided by the same factor, so seven daily beasts cost one
 * empire the turns one weekly beast did and pay what one weekly beast paid.
 * Nothing was inflated — the drama was simply cut into seven pieces. Anything
 * that moves one of those three numbers has to move the other two with it.
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
   * Multiplier on the day's health pool. The whole difficulty dial: a 0.8
   * beast falls by the evening, a 1.4 one needs the server to actually turn up.
   */
  toughness: number;
}

/**
 * Six of them, drawn one per day. They differ in flavour and in one number,
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
 * Retuning the table changes what a given day draws, which would swap a live
 * boss out from under a server mid-fight. Bump this instead, and the reroll is
 * deliberate. `v2` is the move from a weekly index to a daily one — the seed
 * space changed under it, so the old value would have meant nothing.
 */
export const WORLD_BOSS_ROLL_VERSION = "v2";

/**
 * How far back the draw looks to avoid repeating itself.
 *
 * Six beasts drawn independently repeat about one day in six, and two identical
 * mornings in a row is the one thing that makes a daily fixture read as a
 * respawning health bar rather than as something new. The lookback resolves the
 * previous days' *final* picks, not their raw rolls, so the shift cannot chain
 * into a repeat of its own; the depth is what bounds that recursion.
 */
const WORLD_BOSS_NO_REPEAT_DEPTH = 8;

/** The unshifted draw for a day. */
function rawPick(day: number): number {
  const random = seededRandom(`${WORLD_BOSS_ROLL_VERSION}:${day}`);
  return Math.floor(random() * WORLD_BOSSES.length) % WORLD_BOSSES.length;
}

/** The draw for a day, stepped one along if it matches the day before. */
function pickIndex(day: number, depth = WORLD_BOSS_NO_REPEAT_DEPTH): number {
  const raw = rawPick(day);
  if (depth <= 0) return raw;
  return raw === pickIndex(day - 1, depth - 1)
    ? (raw + 1) % WORLD_BOSSES.length
    : raw;
}

/**
 * The boss for a given Jerusalem day — a pure function of the day index, so
 * every player computes the same answer with no writer.
 */
export function rollWorldBoss(day: number): WorldBossDefinition {
  return WORLD_BOSSES[pickIndex(day)] ?? WORLD_BOSSES[0];
}

/* ------------------------------ health ------------------------------ */

/**
 * Health per participating empire, before the beast's own toughness.
 *
 * Scaled by the number of empires rather than fixed, because a fixture that is
 * impossible on a quiet server and trivial on a busy one is not a fixture. The
 * figure is calibrated against `strikeDamage` below: an empire pays its own
 * share of the pool when its twenty blows come to this number, so a server where
 * most people turn up wins and one where they do not falls short.
 *
 * ## Priced at the late game, then cut to a day
 *
 * The original 40,000 put the break-even at an average military power of about
 * 28,000 — an army a player has three days into a season. From there the beast
 * was a Tuesday errand for the rest of the season, and the fixture had no arc.
 * The weekly figure that replaced it was 800,000, twenty times as much, which
 * put break-even at roughly **11 million** military power.
 *
 * 120,000 is that same wall on a daily clock. The strike allowance fell in the
 * same proportion (twenty blows a week became three a day, see
 * WORLD_BOSS_MAX_STRIKES), so the arithmetic behind the wall is untouched —
 * three blows of `√power × 12` covering one empire's share of the pool still
 * breaks even at about 11 million power. The fixture is priced at the late
 * game: a mid-season server does not fell it however many heads it brings — the
 * pool grows with the head count, so more players at the same power never
 * closes the gap, only stronger ones do. That is the deliberate shape. The
 * escape hatch for a server that has been left short of it is
 * `worldBoss.damageMultiplier`, which is the one dial that reaches a beast
 * already standing (the pool is frozen at spawn — see `worldBossMaxHp`).
 *
 * Nothing pays until it is down: the shared purse is gated on `defeatedAt`. A
 * pool nobody can reach is therefore not "a hard day", it is a closed fixture,
 * which is why this number and WORLD_BOSS_DAMAGE_PER_POWER have to be read
 * together and never moved alone.
 */
export const WORLD_BOSS_HP_PER_EMPIRE = 120_000;

/** The floor, so a server with three players still meets something. */
export const WORLD_BOSS_HP_MIN = 750_000;

/**
 * The health pool for a day.
 *
 * Frozen onto the row at spawn (never recomputed), which matters for the same
 * reason the guild contract's goal is frozen: a boss that grew because somebody
 * registered on Thursday would punish the server for growing.
 */
export function worldBossMaxHp(
  boss: WorldBossDefinition,
  empires: number,
  /** `worldBoss.hpMultiplier` — the admin's dial on a *new* spawn's pool. */
  hpMultiplier = 1
): number {
  const pool = Math.max(1, Math.floor(empires)) * WORLD_BOSS_HP_PER_EMPIRE;
  const scale = Math.max(0, hpMultiplier);
  return Math.max(
    1,
    Math.round(Math.max(WORLD_BOSS_HP_MIN, pool * boss.toughness) * scale)
  );
}

/* ------------------------------ striking ------------------------------ */

/** Turns one strike costs. A real price — about four ordinary attacks. */
export const WORLD_BOSS_STRIKE_TURNS = 40;

/**
 * Strikes one empire may land per day.
 *
 * A cap rather than turns alone, and it is the fairness mechanism: without it,
 * the empire with the largest turn income would land ten times as many blows as
 * anybody else *and* hit harder on each, and the damage board would be a copy of
 * the power ladder with extra steps.
 *
 * Three a day rather than the twenty a week it replaced, which is the same
 * allowance to within a rounding error (21 against 20) and the same 120 turns a
 * day. It is deliberately not "20, every day": that would be 800 turns a day on
 * one fixture — more than most empires earn — so the cap would stop being the
 * fairness mechanism and start being a wall only the largest turn income could
 * reach, which is the exact thing it exists to prevent.
 */
export const WORLD_BOSS_MAX_STRIKES = 3;

/**
 * Damage per point of military power. Sub-linear on purpose — see
 * `strikeDamage`.
 */
export const WORLD_BOSS_DAMAGE_PER_POWER = 12;

/**
 * How far a blow may land either side of its expected size.
 *
 * ±25%, and it is a **security** parameter rather than a flavour one.
 *
 * The killing blow is worth WORLD_BOSS_KILL_DIAMONDS, and with a damage figure
 * that was a pure function of the striker's own power the last blow was not a
 * race but a calculation: the arena publishes the boss's exact remaining
 * health, a player can compute their own damage to the point, and so anybody
 * holding strikes could sit on the page, wait for `hp` to drop below their
 * figure, and take the prize every single day with certainty. The comment on
 * WORLD_BOSS_KILL_DIAMONDS claimed the blow could not be farmed; before this
 * band, it could — and on a daily fixture that is 365 certain purses a year.
 *
 * A band wide enough to straddle the threshold means nobody can know which blow
 * lands the kill. What remains is a genuine race at low health, between
 * everybody watching the same bar — which is the contest the prize was always
 * meant to be.
 */
export const WORLD_BOSS_DAMAGE_SPREAD = 0.25;

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
 * The result is then scattered across WORLD_BOSS_DAMAGE_SPREAD, from
 * `secureRandom` rather than a seeded stream: this roll is worth diamonds to
 * the player, which is exactly the line lib/game/random.ts draws between the
 * two generators. A predictable damage figure hands the kill bonus to whoever
 * does the arithmetic.
 *
 * A floor of one point of damage means a brand-new empire with no army at all
 * still moves the bar, which is the difference between "I helped" and "why is
 * this page here".
 */
export function strikeDamage(
  militaryPower: number,
  random: () => number = secureRandom,
  /**
   * `worldBoss.damageMultiplier`. Scales the blow rather than the pool, which is
   * the knob to reach for once a day is already under way: the health of a
   * standing boss is frozen at spawn, so raising it is the only way to help a
   * server that is not going to get its beast down in time.
   */
  damageMultiplier = 1
): number {
  const power = Math.max(0, militaryPower);
  const base = Math.sqrt(power) * WORLD_BOSS_DAMAGE_PER_POWER;
  const spread = 1 + (random() * 2 - 1) * WORLD_BOSS_DAMAGE_SPREAD;
  return Math.max(1, Math.round(base * spread * Math.max(0, damageMultiplier)));
}

/**
 * The blow the *screen* quotes before it is struck — the expected size, with no
 * roll taken.
 *
 * Deliberately separate from `strikeDamage`: a preview that consumed a roll
 * would either differ from the blow actually landed or hand the player the roll
 * in advance, and the second is the whole thing the spread exists to prevent.
 */
export function expectedStrikeDamage(
  militaryPower: number,
  damageMultiplier = 1
): number {
  return strikeDamage(militaryPower, () => 0.5, damageMultiplier);
}

/* ------------------------------ the beast's temper ------------------------------ */

/**
 * מפלצת העולם is the only fight in the game the whole server watches at once,
 * and until now nothing about it changed while it was being fought: the bar
 * shortened and that was the entire arc of the fixture. A phase is what gives
 * the day a *shape* — four states the server crosses together, each announced the
 * moment somebody's blow breaks the threshold.
 *
 * ## Deliberately cosmetic
 *
 * A phase changes what the arena looks like and what it says. It changes no
 * number. That is a decision rather than an omission: the health pool, the blow
 * and the purse are calibrated against each other in this file (see
 * WORLD_BOSS_HP_PER_EMPIRE), and an enrage that doubled the beast's health or
 * halved a blow would retune the whole fixture from the middle of the fight —
 * and would do it to a server that is already losing. The drama is free; the
 * balance is not, so only the drama is taken.
 */
export type WorldBossPhaseKey = "calm" | "roused" | "enraged" | "dying";

export interface WorldBossPhase {
  key: WorldBossPhaseKey;
  /** Health fraction *above* which this phase holds — read top down. */
  from: number;
  /** A word for the beast's state, shown beside the bar. */
  label: string;
  /**
   * What the arena announces when a blow crosses into it — null for the phase
   * the day opens in, which is never crossed into.
   *
   * Written about "המפלצת" rather than about the beast by name, because the six
   * in the catalog are not of one grammatical gender and one line has to serve
   * all of them.
   */
  cry: string | null;
  /**
   * 0..3, handed to the CSS as `--heat`. One number rather than a palette per
   * phase, so the six beasts keep their own accent and only burn hotter.
   */
  heat: number;
}

export const WORLD_BOSS_PHASES: readonly WorldBossPhase[] = [
  {
    key: "calm",
    from: 0.75,
    label: "שלווה",
    cry: null,
    heat: 0,
  },
  {
    key: "roused",
    from: 0.5,
    label: "נעורה",
    cry: "המפלצת מרימה את ראשה. עכשיו היא יודעת שאתם כאן.",
    heat: 1,
  },
  {
    key: "enraged",
    from: 0.25,
    label: "משתוללת",
    cry: "משהו נשבר בה. היא נלחמת מכאן בלי חשבון.",
    heat: 2,
  },
  {
    key: "dying",
    from: 0,
    label: "גוססת",
    cry: "היא בקושי עומדת. מישהו הולך לסיים את זה היום.",
    heat: 3,
  },
];

export const WORLD_BOSS_PHASE_BY_KEY = new Map(
  WORLD_BOSS_PHASES.map((p) => [p.key, p])
);

/** The beast's temper at a given health. Exactly zero is always the last phase. */
export function worldBossPhase(hp: number, maxHp: number): WorldBossPhase {
  const fraction = maxHp > 0 ? Math.max(0, hp) / maxHp : 0;
  return (
    WORLD_BOSS_PHASES.find((phase) => fraction > phase.from) ??
    WORLD_BOSS_PHASES[WORLD_BOSS_PHASES.length - 1]
  );
}

/* ------------------------------ how a blow landed ------------------------------ */

/**
 * A blow is scattered across WORLD_BOSS_DAMAGE_SPREAD, and until the arena grew
 * a reveal that scatter was invisible — two blows a third apart in size read as
 * the same sentence with different digits. The grade is what the reveal
 * narrates, and it is derived from the roll that already happened rather than
 * rolled again: there is no second source of randomness here to disagree with
 * the damage actually dealt.
 */
export type WorldBossBlowGrade = "glancing" | "solid" | "crushing";

/**
 * How far from the expected blow a roll has to fall to be called anything other
 * than solid — 40% of the spread, so roughly the outer third at each end lands
 * a named blow and the middle stays unremarkable. Much tighter and every second
 * strike is "crushing", which is the same as none of them being.
 */
export const WORLD_BOSS_BLOW_BAND = WORLD_BOSS_DAMAGE_SPREAD * 0.4;

export function worldBossBlowGrade(
  damage: number,
  expected: number
): WorldBossBlowGrade {
  if (!(expected > 0)) return "solid";
  const ratio = damage / expected;
  if (ratio <= 1 - WORLD_BOSS_BLOW_BAND) return "glancing";
  if (ratio >= 1 + WORLD_BOSS_BLOW_BAND) return "crushing";
  return "solid";
}

export interface WorldBossBlowMeta {
  label: string;
  /** One sentence for the reveal — the army's account of the blow. */
  line: string;
  /** Tailwind tone for the damage figure. */
  tone: string;
}

export const WORLD_BOSS_BLOW_META: Record<
  WorldBossBlowGrade,
  WorldBossBlowMeta
> = {
  glancing: {
    label: "מכה שטחית",
    line: "הכוח נחבט בשריון ונסוג. המכה עברה בשוליים.",
    tone: "text-zinc-300",
  },
  solid: {
    label: "פגיעה מלאה",
    line: "הפלוגות פורצות פנימה, והנשק מוצא בשר.",
    tone: "text-gold-bright",
  },
  crushing: {
    label: "מכה מוחצת",
    line: "הפרצה נפתחה בדיוק כשהלהב ירד. משהו בפנים נשבר.",
    tone: "text-crimson-bright",
  },
};

/* ------------------------------ the spoils ------------------------------ */

/**
 * The purse one empire takes for the day, quoted at **one city**;
 * `scaleRewards` applies the city curve at claim time.
 *
 * Paid once a day to everybody who turned up, so it has to be worth the three
 * strikes it cost without being the day's main income.
 *
 * ## Sized to the wall, then cut with it
 *
 * The resource lines were sized against WORLD_BOSS_HP_PER_EMPIRE — a fixture
 * the server can only fell in the late game has to pay a late-game purse, or
 * nobody spends the turns on it. Every line is now a seventh of the weekly
 * figure it replaced, to the same rounding the strike allowance took: seven of
 * these pays 2.52M gold against the week's old 2.4M, 525 turns against 500, 42
 * spins against 40. The fixture pays what it always paid; it simply pays a
 * little every morning instead of everything on one kill.
 *
 * `turns` stays the line that is deliberately not proportional to the rest.
 * Turns are the game's real currency of attention rather than a resource, and
 * 75 of them is a purse that pays back the 120 the three strikes cost well
 * enough to be worth turning up for without making the boss the way you fund
 * raiding.
 */
export const WORLD_BOSS_PURSE: readonly Reward[] = [
  { kind: "gold", amount: 360_000 },
  { kind: "iron", amount: 180_000 },
  { kind: "turns", amount: 75 },
  { kind: "wheelSpins", amount: 6 },
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
 * small, unpredictable prize is the cheapest way to have one.
 *
 * "Unpredictable" is doing real work in that sentence, and it is only true
 * because of WORLD_BOSS_DAMAGE_SPREAD. The arena publishes the boss's exact
 * remaining health, so with a damage figure a player could compute they would
 * simply wait for the bar to fall inside their own blow and take this every
 * day. The spread is what makes the last blow a race between everyone watching
 * rather than a sum anyone can do.
 *
 * Fifteen, not the hundred it paid weekly. Diamonds are the one currency the
 * game also sells, so a faucet that fired seven times as often at the same size
 * would be a real change to what a diamond is worth — 105 a week against 100 is
 * not. The moment is not made smaller by the figure: it is still the only prize
 * in the fixture that belongs to one player.
 */
export const WORLD_BOSS_KILL_DIAMONDS = 15;

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
  cities: number,
  /** `worldBoss.rewardMultiplier` — the admin's dial on the whole purse. */
  rewardMultiplier = 1
): Reward[] {
  const factor = worldBossShare(share, participants) * Math.max(0, rewardMultiplier);
  // The per-line floor below exists so a tiny share is never worth nothing. A
  // multiplier of zero is a different statement — an admin closing the purse —
  // and the floor must not overrule it into paying one of everything.
  if (factor <= 0) return [];
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
  /** `Empire.title` — drawn beside the name by WornTitle, null for none. */
  title: string | null;
  damage: number;
  hits: number;
  /** The viewer — their own row is marked rather than hidden. */
  isMe: boolean;
}

/**
 * One blow in the live feed — the part of the arena that is other people.
 *
 * The damage board answers "who is carrying this one"; it is a standings
 * table, and a standings table looks identical whether it was filled an hour
 * ago or on Monday. The feed answers the other question a shared fixture has to
 * answer — "is anyone else actually here" — and it is the only place the server
 * appears on the screen as something happening rather than something recorded.
 */
export interface WorldBossBlowEntry {
  id: string;
  empireId: string;
  empireName: string;
  /** `Empire.title` — drawn beside the name by WornTitle, null for none. */
  title: string | null;
  damage: number;
  /** The beast's health after this blow, so the feed reads as a descent. */
  hpAfter: number;
  /** This was the killing blow. */
  slaying: boolean;
  at: number;
  isMe: boolean;
}

/**
 * What one strike hands back to the screen so it can be *played* rather than
 * printed.
 *
 * The damage is already applied and the kill already awarded by the time this
 * is returned — see the note on `strikeWorldBoss`. Nothing here is authority;
 * it is the report of a blow that has landed, which is exactly why the reveal
 * can be skipped, interrupted or missed entirely with no consequence.
 */
export interface WorldBossStrikeReveal {
  damage: number;
  /** The blow this striker's power was expected to land, for the grade. */
  expected: number;
  grade: WorldBossBlowGrade;
  /** Health the instant before this blow, and the instant after. */
  hpBefore: number;
  hpAfter: number;
  maxHp: number;
  slain: boolean;
  /**
   * The phase the blow started in and the one it ended in. They differ on
   * exactly one strike per threshold, server-wide — which is what makes the
   * announcement an event rather than a status line.
   */
  phaseBefore: WorldBossPhaseKey;
  phaseAfter: WorldBossPhaseKey;
  strikesLeft: number;
  /** Diamonds paid for the killing blow, 0 for every other blow. */
  diamonds: number;
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
  /** The beast's temper at this health — see WORLD_BOSS_PHASES. */
  phase: WorldBossPhaseKey;
  /** True once hp reached zero. */
  defeated: boolean;
  /** Who landed the killing blow, if it is down. */
  slayerName: string | null;

  /** When the day's fixture closes — midnight Jerusalem, epoch ms. */
  endsAt: number;
  serverNow: number;

  /** Strikes this empire has left today. */
  strikesLeft: number;
  strikeTurns: number;
  /**
   * The day's allowance and the kill prize, as they actually stand.
   *
   * Carried on the state rather than read from the constants above, because
   * both are admin tunables now (`worldBoss.maxStrikes`, `worldBoss.killDiamonds`)
   * — a screen quoting the shipped figure would be advertising a rule the server
   * is no longer enforcing.
   */
  maxStrikes: number;
  killDiamonds: number;
  /** The viewer's turns, so the button can say why it is disabled. */
  turns: number;
  /** The blow this empire's power is worth, quoted before it is struck. */
  expectedDamage: number;
  /** Damage this empire has dealt. */
  myDamage: number;
  /** Everyone who has struck, most damage first (capped for display). */
  board: WorldBossStriker[];
  participants: number;
  /** The last blows anybody landed, newest first. */
  feed: WorldBossBlowEntry[];

  /**
   * The viewer is out of the game and may watch but never strike — a staff
   * account or a planted garrison. The arena is still drawn in full: an admin
   * has every reason to look at the day's fixture, and none to be in it.
   */
  blocked: boolean;

  /** The viewer may collect their share. */
  claimable: boolean;
  /** Already collected. */
  claimed: boolean;
  /** What the viewer's share is worth right now. */
  reward: Reward[];
}
