import type { IconName } from "@/components/ui/Icon";
import { seededRandom } from "./random";
import { scaleRewards, type Reward } from "./rewards";

/**
 * חוזה הברית — the guild's shared daily goal.
 *
 * The personal board (missions.ts) gives a player a reason to open the game.
 * This gives them a reason to care whether anyone *else* did: one goal per
 * guild per day, met by the members' own daily missions, paid to everybody the
 * moment it is met. A guild of four where three people played and one did not
 * is a conversation, and that conversation is the retention mechanic — not the
 * purse.
 *
 * ## Why it is a counter when nothing else here is
 *
 * The personal board deliberately stores no counters: progress is a difference
 * between two snapshots of the same empire (see the header of missions.ts).
 * That trick does not survive contact with a guild. It rests on the snapshot
 * being one cheap indexed query, and a guild's progress would need that query
 * *per member* on every page load — twelve of the game's heaviest reads to
 * render one progress bar.
 *
 * So the contract is a real counter, and it rides the one path that is already
 * safe to increment from: claiming a personal mission. That claim is already a
 * transaction, already guarded against double-claiming by the board's own
 * `claimed` array, and already happens exactly once per mission per player. A
 * contract increment bolted onto it inherits all three properties for free —
 * which is the whole reason the contract counts *missions* rather than attacks
 * or gold.
 *
 * ## The three rules
 *
 * 1. **The goal is frozen at creation.** It is computed from the member count
 *    the moment the day's contract is first opened. A contract that got harder
 *    because somebody joined at 23:00 would be a punishment for recruiting.
 * 2. **Completion is a transition, not a comparison.** `completedAt` is stamped
 *    by the same guarded UPDATE that pushes progress over the line, filtered on
 *    `completedAt IS NULL`. Two members claiming their last mission at the same
 *    instant cannot both trigger the payout.
 * 3. **Everyone in the guild when it completed is paid, once.** The `paid`
 *    array is the receipt. Someone who joins afterwards is not owed the day's
 *    contract, and someone who was paid cannot be paid again by reloading.
 */

/* ------------------------------ the catalog ------------------------------ */

export interface GuildContractDefinition {
  /** Stable id stored on the row. Never reuse or rename one. */
  key: string;
  name: string;
  /** One line of flavour under the name. */
  lore: string;
  icon: IconName;
  /**
   * Daily missions asked of each member, before rounding. The whole difficulty
   * dial: 1.0 is "everybody does one", 2.0 is "everybody does two thirds of
   * their board".
   */
  perMember: number;
  /** Purse paid to *each* member, quoted at one city. */
  reward: readonly Reward[];
}

/**
 * Four contracts, drawn one per day. They differ in exactly one axis — how much
 * they ask and how much they pay — and the flavour is what makes that axis
 * legible: "מסע האספקה" is the easy one and reads like it, "קריאת החרב" is the
 * heavy one.
 *
 * The purses are deliberately close to a single daily mission's. A contract is
 * a *bonus* for a guild that showed up, not a second economy: a guild of ten
 * meeting the hard contract pays out ten purses, which is already the largest
 * single payout in the daily loop.
 */
export const GUILD_CONTRACTS: readonly GuildContractDefinition[] = [
  {
    key: "supply",
    name: "מסע האספקה",
    lore: "השיירות של הברית יוצאות עם שחר. כל אחד לוקח את החלק שלו.",
    icon: "storage",
    perMember: 1,
    reward: [
      { kind: "gold", amount: 25_000 },
      { kind: "turns", amount: 30 },
    ],
  },
  {
    key: "muster",
    name: "מפקד הברית",
    lore: "המפקדים רוצים לראות מי עוד עומד על הרגליים. תתייצבו.",
    icon: "guild",
    perMember: 1.5,
    reward: [
      { kind: "turns", amount: 70 },
      { kind: "citizens", amount: 40 },
    ],
  },
  {
    key: "forge",
    name: "מכסת הנפחייה",
    lore: "המפעל עובד כל הלילה, ומישהו צריך להביא את הברזל.",
    icon: "factory",
    perMember: 1.5,
    reward: [
      { kind: "iron", amount: 45_000 },
      { kind: "stone", amount: 30_000 },
    ],
  },
  {
    key: "sword",
    name: "קריאת החרב",
    lore: "יום אחד בשבוע הברית לא מתגוננת. היום הזה.",
    icon: "attack",
    perMember: 2,
    reward: [
      { kind: "gold", amount: 60_000 },
      { kind: "turns", amount: 90 },
      { kind: "wheelSpins", amount: 1 },
    ],
  },
];

export const GUILD_CONTRACT_BY_KEY = new Map(
  GUILD_CONTRACTS.map((c) => [c.key, c])
);

/**
 * Retuning the table changes what a given seed draws, which would swap a
 * guild's contract out from under it mid-day. Bump this instead, and the reroll
 * is deliberate and uniform.
 */
export const GUILD_CONTRACT_ROLL_VERSION = "v1";

/**
 * The contract for one guild on one day.
 *
 * Seeded from `(guildId, day)` for the same reason the mission board is: every
 * member's page load computes the same answer with no writer, so the row can be
 * created by whoever gets there first and the losers of that race are dropped
 * by the unique index without anybody seeing a different contract.
 */
export function rollGuildContract(
  guildId: string,
  day: number
): GuildContractDefinition {
  const random = seededRandom(
    `${GUILD_CONTRACT_ROLL_VERSION}:${guildId}:${day}`
  );
  return GUILD_CONTRACTS[Math.floor(random() * GUILD_CONTRACTS.length)] ??
    GUILD_CONTRACTS[0];
}

/* ------------------------------ the goal ------------------------------ */

/**
 * The floor under every contract. A guild of one — a leader who has not
 * recruited yet, which every guild is on its first day — would otherwise get a
 * one-mission contract that completes by accident and teaches nothing about
 * what the feature is for.
 */
export const GUILD_CONTRACT_MIN_GOAL = 3;

/**
 * The ceiling. `perMember` is a rate, and at a full guild the hard contract
 * would ask for more missions than the members have boards to fill: three
 * dailies each is the hard cap on supply, so a goal above `members × 3` is
 * unmeetable by construction. Capping at 2.5 leaves room for a guild to fail a
 * hard day without it being arithmetically impossible.
 */
export const GUILD_CONTRACT_MAX_PER_MEMBER = 2.5;

/**
 * Missions this contract asks of a guild with `members` members.
 *
 * Frozen onto the row at creation (rule 1). Rounded up, so a rate of 1.5 across
 * three members is 5 rather than 4 — the contract should ask for slightly more
 * than the obvious share, or a guild that is half awake meets it every day.
 */
export function guildContractGoal(
  contract: GuildContractDefinition,
  members: number
): number {
  const heads = Math.max(1, Math.floor(members) || 1);
  const rate = Math.min(GUILD_CONTRACT_MAX_PER_MEMBER, contract.perMember);
  return Math.max(GUILD_CONTRACT_MIN_GOAL, Math.ceil(heads * rate));
}

/** What one member takes home, at their own empire's size. */
export function guildContractReward(
  contract: GuildContractDefinition,
  cities: number
): Reward[] {
  return scaleRewards(contract.reward, cities);
}

/* ------------------------------ view model ------------------------------ */

/** The contract as the guild screen and the daily board render it. */
export interface GuildContractView {
  key: string;
  name: string;
  lore: string;
  icon: IconName;
  goal: number;
  /** Clamped to `goal` for display. */
  progress: number;
  complete: boolean;
  /** The viewer has already taken their share. */
  collected: boolean;
  /** What the viewer will take, at their own city count. */
  reward: Reward[];
  /** Members counted when the goal was frozen. */
  members: number;
}
