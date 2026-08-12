import type { Prisma } from "@prisma/client";
import { lastDailyUpdate } from "@/lib/game/time";
import { SEASON_PASS_XP, type SeasonPassAction } from "@/lib/game/seasonPass";
import { bumpFervor } from "@/server/fervor";

/**
 * Add season-pass XP for a gameplay action — and heat that player's להט הקרב.
 *
 * Deliberately NOT in a `"use server"` module: it takes a transaction client,
 * so it can only ever be called from server code inside an open transaction.
 * Exporting it from an actions file would publish it as a callable endpoint.
 *
 * Call it from inside the acting transaction so the XP and the action itself
 * commit together. It never throws — season-pass progress is a side benefit,
 * and a failure here must not roll back the attack or upgrade the player
 * actually asked for.
 *
 * ## Why the fervor meter rides here
 *
 * This function is already the game's single "a tracked player action happened"
 * choke point: twenty call sites across ten modules — attacks, spies, mine and
 * empire upgrades, weapons, minigames, wheel spins, hero quests, boss fights,
 * monuments — and the taxonomy of what counts as an action is exactly the
 * taxonomy fervor needs. Bumping the meter here rather than at those twenty
 * sites means no site can forget, and a feature added next month is covered the
 * day it starts awarding pass XP.
 *
 * That the meter is fed by *every* action and not only by turn-spending ones is
 * load-bearing, not incidental. A player on turns-upgrade level 1 has 288 turns
 * a day — 28 attacks — and if raids were the only way to warm the meter he
 * would have to spend most of his day's fuel reaching a multiplier the whale
 * reaches with 17% of his. Free actions are what make the ladder climbable from
 * the bottom.
 *
 * The `units === 0` early return below is inherited on purpose: a spend too
 * small to earn pass XP is too small to heat the meter, so the existing
 * anti-micro-transaction gate protects fervor for free.
 *
 * The one thing this coupling costs: fervor now depends on the season pass's
 * action taxonomy. If that taxonomy is ever reworked, this call has to be
 * re-homed rather than deleted with it.
 */
export async function awardSeasonPassXp(
  tx: Prisma.TransactionClient,
  empireId: string,
  action: SeasonPassAction,
  times = 1
): Promise<void> {
  // `times` of 0 means the action earned nothing (a spend below the XP
  // threshold — see seasonPassSpendUnits) and must award nothing. Clamping to a
  // minimum of 1 here would hand the floor back to every micro-transaction and
  // undo the spend gate entirely.
  const units = Math.max(0, Math.floor(times));
  if (units === 0) return;

  // One click, one point — never `units`. A max-out upgrade that awards five
  // levels of pass XP is still a single decision by a single present player,
  // and paying it five points would let one button jump two tiers.
  //
  // Inside the guard, not above it: this function promises never to take the
  // caller's attack or upgrade down with it, and an unguarded write here would
  // have made a fervor failure roll back the thing the player actually asked
  // for. The catch is not the real defence though — a statement that throws
  // inside the caller's transaction poisons it, and every statement after it
  // fails too, so swallowing the error cannot save the action. That is why
  // `bumpFervor` is written as one arithmetic UPDATE by primary key with every
  // term clamped: it is built not to throw, and this is the belt to that
  // braces.
  try {
    await bumpFervor(tx, empireId, new Date());
  } catch {
    // Presence is a side benefit. Never the reason an action failed.
  }

  const amount = SEASON_PASS_XP[action] * units;
  const cycleStart = lastDailyUpdate(new Date());

  try {
    // Stale row: fold the cycle reset and this award into a single write so the
    // XP lands in the new cycle instead of topping up the expired one.
    const rolled = await tx.seasonPassProgress.updateMany({
      where: { empireId, cycleStartedAt: { lt: cycleStart } },
      data: {
        cycleStartedAt: cycleStart,
        xp: amount,
        claimedFree: [],
        claimedPremium: [],
      },
    });
    if (rolled.count > 0) return;

    const bumped = await tx.seasonPassProgress.updateMany({
      where: { empireId, cycleStartedAt: cycleStart },
      data: { xp: { increment: amount } },
    });
    if (bumped.count > 0) return;

    // No row yet — first tracked action for this empire. seasonId is left null
    // and adopted by loadCycle on the next read; premium defaults to false, so
    // nothing can be lost by deferring it.
    //
    // upsert, not create: this runs inside the caller's transaction, and in
    // Postgres a failed statement poisons the whole transaction. Two of the
    // player's own concurrent actions both reach this line on a brand-new
    // empire; the loser would hit the unique index on empireId, and catching
    // that in JS does NOT recover the connection — Prisma wraps no savepoint
    // around individual statements, so every later statement returns 25P02 and
    // the enclosing $transaction rolls the player's real action back. upsert
    // compiles to ON CONFLICT, which resolves the race inside the statement.
    await tx.seasonPassProgress.upsert({
      where: { empireId },
      create: {
        empireId,
        cycleStartedAt: cycleStart,
        xp: amount,
        claimedFree: [],
        claimedPremium: [],
      },
      update: { xp: { increment: amount } },
    });
  } catch {
    // Any other hiccup — drop the XP rather than fail the player's action.
  }
}
