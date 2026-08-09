import "server-only";
import type { Prisma } from "@prisma/client";
import { grantCitizens } from "@/lib/game/grants";
import { mergeRewards, type Reward } from "@/lib/game/rewards";

/**
 * Pay a batch of rewards to an empire, inside the caller's transaction.
 *
 * Deliberately NOT in a `"use server"` module: it takes a transaction client,
 * so it can only be reached from server code that already holds one. Exporting
 * it from an actions file would publish it as a callable endpoint that hands
 * out diamonds.
 *
 * Three properties every caller relies on:
 *
 *  - **One statement.** The whole purse lands in a single `UPDATE`, so a payout
 *    is atomic with respect to any concurrent action on the same empire and
 *    cannot half-apply.
 *  - **Increments, never absolute sets.** The caller has usually read the
 *    empire before deciding to pay, and a concurrent settle or plunder may have
 *    committed since. `{ increment }` composes with that; `gold: value` would
 *    silently destroy it.
 *  - **It is not the guard.** This function pays whatever it is handed. Whether
 *    the reward is *owed* — the claim receipt, the once-only check — is the
 *    caller's problem, and every caller does it with a guarded `updateMany`
 *    whose `count` decides whether this line is reached at all.
 *
 * Citizens go through `grantCitizens` rather than a plain increment because
 * every citizen faucet in the game is required to (see the note there).
 */
export async function payRewards(
  tx: Prisma.TransactionClient,
  empireId: string,
  rewards: readonly Reward[]
): Promise<Reward[]> {
  // Merged first so a purse that names the same kind twice — two missions
  // collected together, a contract that pays gold on two lines — becomes one
  // increment per column rather than a last-writer-wins overwrite.
  const totals = mergeRewards(rewards);
  if (totals.length === 0) return [];

  const data: Prisma.EmpireUpdateInput = {};
  let citizens = 0;

  for (const { kind, amount } of totals) {
    if (!(amount > 0)) continue;
    switch (kind) {
      case "gold":
      case "wood":
      case "iron":
      case "stone":
      case "diamonds":
        data[kind] = { increment: amount };
        break;
      case "turns":
        data.turns = { increment: Math.round(amount) };
        break;
      case "wheelSpins":
        data.wheelSpins = { increment: Math.round(amount) };
        break;
      case "citizens":
        citizens = Math.round(amount);
        break;
    }
  }

  if (Object.keys(data).length > 0) {
    await tx.empire.update({ where: { id: empireId }, data });
  }
  if (citizens > 0) {
    await grantCitizens(tx, empireId, citizens);
  }

  return totals;
}
