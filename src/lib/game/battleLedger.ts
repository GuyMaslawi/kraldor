/**
 * The battle power ledger: one side's combat power broken into every term that
 * produced it, each carrying the raw power it actually contributed.
 *
 * The battle report used to list the troops in power and the bonuses in
 * percent, and stop there. Two things followed from that. The percentages were
 * unreadable as quantities — "+18%" of *what*, applied to which subtotal, in
 * what order — and, worse, two whole terms were missing: the defender's flat
 * multiplier (the largest term after the troops themselves) and the passive
 * guild aid, which is a flat reinforcement rather than a percentage. A defender
 * reading their own report saw two numbers that could not produce the total
 * printed beneath them.
 *
 * The order here is the order `attackEmpire` applies them, and it matters —
 * multipliers compound, so a term's contribution depends on everything before
 * it:
 *
 *   base = soldiers + weapons + hero gear power
 *   ×  defence bonus   (defender only)
 *   ×  hero bonus
 *   ×  guild spell
 *   +  guild aid       (flat)
 *
 * Kept pure and out of the page so the arithmetic can be tested against the
 * battle formula rather than eyeballed in a screenshot.
 */

/** What one side's power was built from, as recorded on the BattleReport. */
export interface BattlePowerSources {
  soldiers: number | null;
  weapons: number | null;
  /**
   * Flat combat power from the hero's equipped gear. A *base* term, not a
   * bonus: it is added before the multipliers, so it appears above the subtotal
   * and every percentage below it scales it too.
   */
  heroPower: number | null;
  heroBonusPct: number | null;
  guildBonusPct: number | null;
  guildAidPct: number | null;
  guildAidPower: number | null;
  /** The flat defender multiplier in percent. Null for the attacker, which never gets it. */
  defenseBonusPct: number | null;
  /** The stored total this ledger must reconcile to. */
  total: number;
}

/** Which term a row represents — the view layer labels and styles from this. */
export type LedgerKind =
  | "soldiers"
  | "weapons"
  | "heroPower"
  | "subtotal"
  | "defense"
  | "hero"
  | "guildSpell"
  | "guildAid"
  | "residual";

export interface LedgerRow {
  kind: LedgerKind;
  /** Power this term added (or, for `subtotal`, the running total so far). */
  value: number;
  /** The bonus percentage behind the row, where one applies. */
  pct?: number;
}

/**
 * Break one side's power into its terms.
 *
 * A term that contributed nothing is omitted rather than shown as zero — a
 * report is easier to read when every line on it is a line that mattered.
 *
 * The last row may be a `residual`: reports written before the guild-aid and
 * defence-bonus columns existed cannot itemise those terms, so instead of
 * printing a column that does not add up, the gap is named. It is also a
 * standing check on this function — if the terms ever stop reproducing the
 * stored total, the discrepancy shows up on the page instead of hiding.
 */
export function battlePowerLedger(side: BattlePowerSources): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const soldiers = side.soldiers ?? 0;
  const weapons = side.weapons ?? 0;
  const heroPower = side.heroPower ?? 0;

  rows.push({ kind: "soldiers", value: soldiers });
  rows.push({ kind: "weapons", value: weapons });
  // Omitted when the hero brought no gear power — including a report written
  // before the column existed, which reads back as null and must not claim a
  // zero the battle never had. The residual check below catches the difference
  // if such a report's total ever fails to reconcile.
  if (heroPower !== 0) rows.push({ kind: "heroPower", value: heroPower });

  let running = soldiers + weapons + heroPower;
  // The subtotal every multiplier below applies to. Worth its own line: "+20%"
  // means nothing until the reader knows what it is 20% of.
  rows.push({ kind: "subtotal", value: running });

  const scale = (kind: LedgerKind, pct: number | null) => {
    if (pct == null || pct === 0) return;
    const after = running * (1 + pct / 100);
    rows.push({ kind, value: after - running, pct });
    running = after;
  };

  scale("defense", side.defenseBonusPct);
  scale("hero", side.heroBonusPct);
  scale("guildSpell", side.guildBonusPct);

  if (side.guildAidPower != null && side.guildAidPower !== 0) {
    rows.push({
      kind: "guildAid",
      value: side.guildAidPower,
      pct: side.guildAidPct ?? 0,
    });
    running += side.guildAidPower;
  }

  // Sub-1 gaps are float noise from the stored Doubles, not a missing term.
  const residual = side.total - running;
  if (Math.abs(residual) >= 1) {
    rows.push({ kind: "residual", value: residual });
  }

  return rows;
}
