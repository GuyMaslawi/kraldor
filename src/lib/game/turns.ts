import "server-only";
import type { EmpireUpgrade, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { turnsPerRegularUpdate } from "./constants";

/**
 * Sources of turn gain per regular update. Only the upgrade contributes *here*:
 * the hero's turn items ride the same 5-minute cadence (see HERO_FLAT_CADENCE)
 * but are added by `applyPendingUpdates` from the equipped gear it has already
 * loaded, and deliberately outside the מגדל השעון multiplier — a monument
 * multiplies what the upgrade pays, never what a piece of gear conjures. Season
 * pass, events and VIP will add their own components here later.
 */
export interface TurnsGainBreakdown {
  baseUpgrade: number;
  heroBonus: number;
  itemBonus: number;
  eventBonus: number;
}

export function totalTurnsGain(breakdown: TurnsGainBreakdown): number {
  return (
    breakdown.baseUpgrade +
    breakdown.heroBonus +
    breakdown.itemBonus +
    breakdown.eventBonus
  );
}

/**
 * Turns gained per regular update from already-loaded upgrade rows.
 * A missing TURNS_PER_REGULAR_UPDATE row is safely treated as level 1.
 */
export function turnsGainFromUpgrades(
  upgrades: Pick<EmpireUpgrade, "type" | "level">[]
): number {
  const level =
    upgrades.find((u) => u.type === "TURNS_PER_REGULAR_UPDATE")?.level ?? 1;
  return totalTurnsGain({
    baseUpgrade: turnsPerRegularUpdate(level),
    heroBonus: 0,
    itemBonus: 0,
    eventBonus: 0,
  });
}

/** Turns gained per regular update for an empire, loaded from the database. */
export async function getTurnsGainPerRegularUpdate(
  empireId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<number> {
  const upgrades = await tx.empireUpgrade.findMany({
    where: { empireId, type: "TURNS_PER_REGULAR_UPDATE" },
    select: { type: true, level: true },
  });
  return turnsGainFromUpgrades(upgrades);
}