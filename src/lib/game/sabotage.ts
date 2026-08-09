import type { IconName } from "@/components/ui/Icon";
import type { StorableResource } from "./constants";

/**
 * חבלה — what a spy does when you stop asking him to look.
 *
 * Espionage was read-only. A mission came back with a dossier, and the dossier
 * was an input to an *attack* — so a player who invested in spies was really
 * investing in somebody else's raid, and the spy branch had no way to hurt
 * anybody on its own. This is that way.
 *
 * ## The rules it inherits, and the one it adds
 *
 * A sabotage mission is a spy mission in every respect the rest of the game
 * already enforces: same city tier only, same turn cost shape, same new-player
 * shield, same ban gate, same "acting drops your own shield". It resolves on
 * the same intelligence comparison, so nothing here is a second combat system —
 * it is the existing one with a different verb.
 *
 * The rule it adds is about *what may be destroyed*:
 *
 * > **A sabotage mission never touches soldiers, weapons or power.**
 *
 * Not squeamishness. The battle report itemises every term of the power
 * calculation (see battleLedger.ts), and the game's whole PvP contract is that
 * an army is lost in battles that are reported. A spy who could quietly delete
 * an army would make the ladder unreadable and the reports a lie. So the three
 * missions below take *stores*, *gold* and *mine slaves* — the economy, which
 * regrows, and which the target can see was taken.
 *
 * ## Why mine slaves count as economy
 *
 * `SPIKE_WELLS` kills mine slaves rather than "halting production for N hours",
 * which was the obvious design. A timed debuff needs a new effect row, a new
 * read on the game clock's hot path, and a new expiry to reason about. Killing
 * slaves produces the same felt outcome — the target's mines run slower until
 * they replace them — with no new machinery at all, and it is legible: the
 * defender can see exactly what it cost them.
 */

/* ------------------------------ the missions ------------------------------ */

export type SabotageKind = "BURN_STORES" | "STEAL_PLANS" | "SPIKE_WELLS";

export interface SabotageMission {
  kind: SabotageKind;
  name: string;
  /** One line describing what it does, shown on the target's dossier. */
  blurb: string;
  icon: IconName;
  /** Accent as an `R G B` triple. */
  accent: string;
  /** Spies committed. They are lost on a failed mission. */
  spies: number;
  /** Turns spent, win or lose. */
  turns: number;
  /**
   * Share of the target's holding this mission destroys or takes, on success.
   * Deliberately modest: a mission that emptied a rival would make espionage a
   * better raid than raiding, and the point is a second lever, not a bigger one.
   */
  share: number;
  /**
   * Which shield blocks it. Sabotage honours the paid shields exactly as
   * plunder does — a player who bought protection for their resources has
   * bought it against every way of losing them, or the purchase is a lie.
   */
  shield: "resources" | "soldiers";
}

export const SABOTAGE_MISSIONS: readonly SabotageMission[] = [
  {
    kind: "BURN_STORES",
    name: "הצתת המחסנים",
    blurb: "שריפת חלק מהמלאי המוגן במחסני היעד — עץ, ברזל ואבן.",
    icon: "storage",
    accent: "196 92 48",
    spies: 3,
    turns: 25,
    share: 0.12,
    shield: "resources",
  },
  {
    kind: "STEAL_PLANS",
    name: "שוד הגנזך",
    blurb: "גניבת חלק מהזהב הזמין של היעד — ישר לקופה שלך.",
    icon: "gold",
    accent: "228 195 90",
    spies: 4,
    turns: 30,
    share: 0.08,
    shield: "resources",
  },
  {
    kind: "SPIKE_WELLS",
    name: "הרעלת הבארות",
    blurb: "חיסול חלק מעבדי המכרות של היעד. המכרות שלו יאטו עד שיחליף אותם.",
    icon: "mine",
    accent: "150 96 232",
    spies: 5,
    turns: 35,
    share: 0.1,
    shield: "soldiers",
  },
];

export const SABOTAGE_BY_KIND = new Map(
  SABOTAGE_MISSIONS.map((m) => [m.kind, m])
);

/** Whether a value from a form is a mission the game actually has. */
export function isSabotageKind(value: unknown): value is SabotageKind {
  return typeof value === "string" && SABOTAGE_BY_KIND.has(value as SabotageKind);
}

/**
 * The stored resources `BURN_STORES` burns.
 *
 * Gold is absent on purpose, and it is the difference between the two economic
 * missions: burning takes what is *protected in the warehouses* (which plunder
 * cannot reach), while `STEAL_PLANS` takes from the *available* balance. Two
 * missions that both hit gold would be one mission with two names.
 */
export const BURNABLE: readonly StorableResource[] = ["wood", "iron", "stone"];

/* ------------------------------ the odds ------------------------------ */

/**
 * How much harder sabotage is than looking.
 *
 * A plain spy mission succeeds on `attackerIntel > defenderIntel`. Sabotage
 * asks for a clear margin instead: burning somebody's warehouses is not the
 * same errand as counting their soldiers, and a mission that destroyed property
 * on a hair's-breadth win would make every marginal spy advantage a licence to
 * strip a rival.
 *
 * 1.35 is a third again as much intelligence. It keeps sabotage the province of
 * a player who has genuinely invested in the spy branch rather than one who is
 * a hundred points ahead this afternoon.
 */
export const SABOTAGE_INTEL_MARGIN = 1.35;

/** Whether a mission gets in, given both sides' intelligence power. */
export function sabotageSucceeds(
  attackerIntel: number,
  defenderIntel: number
): boolean {
  return attackerIntel > defenderIntel * SABOTAGE_INTEL_MARGIN;
}

/**
 * What a successful mission takes: the share, floored, and never more than the
 * target actually holds.
 *
 * Floored rather than rounded, so a target holding nine of something loses one
 * at a 12% share rather than being rounded up to two. The direction matters —
 * this is somebody else's property, and the rounding should favour them.
 */
export function sabotageAmount(held: number, share: number): number {
  if (!(held > 0)) return 0;
  return Math.max(0, Math.min(Math.floor(held), Math.floor(held * share)));
}

/* ------------------------------ view model ------------------------------ */

/** One mission as the dossier's sabotage panel renders it. */
export interface SabotageOption {
  kind: SabotageKind;
  name: string;
  blurb: string;
  icon: IconName;
  accent: string;
  spies: number;
  turns: number;
  /** The share, as a whole percentage, for the copy. */
  pct: number;
  /** The viewer can pay for it right now. */
  affordable: boolean;
  /** A shield on the target blocks this mission outright. */
  shielded: boolean;
}
