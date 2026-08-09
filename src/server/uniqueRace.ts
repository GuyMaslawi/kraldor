import "server-only";

/**
 * Losing a unique-index race inside an interactive transaction.
 *
 * ## The trap this exists to close
 *
 * Several actions in this codebase debit a resource, then insert a row whose
 * unique index is the once-only receipt — a title purchase, a monument's
 * founding row, an arena entry. The obvious way to handle the losing half of a
 * double-click is to catch the violation and hand the money back:
 *
 * ```ts
 * try { await tx.thing.create(...) }
 * catch { await tx.empire.update({ data: { gold: { increment: cost } } }) }
 * ```
 *
 * **That refund never runs.** Postgres aborts a transaction the moment any
 * statement in it fails, and Prisma does not wrap individual queries in
 * savepoints — so every statement after the violation fails too, with
 * `25P02 current transaction is aborted`. The `catch` block executes, its query
 * throws, and the whole transaction rolls back.
 *
 * The player is not charged, because the rollback undoes the debit as well. But
 * the refund is dead code that reads like the thing keeping them safe, and the
 * error it meant to return is replaced by whatever the outer handler says about
 * an unexpected failure — usually a generic "try again" plus a logged error for
 * something that is not a fault at all.
 *
 * ## What to do instead
 *
 * Throw this, and let the rollback be the refund — which is what was really
 * happening anyway. The outer handler recognises it, skips the error log, and
 * returns the message the losing click should have seen.
 *
 * ```ts
 * try { await tx.thing.create(...) }
 * catch { throw new UniqueRaceLost("כבר קנית את זה") }
 * ```
 *
 * The one rule: nothing may be *conditionally* committed after this point in
 * the transaction, because nothing after this point commits at all. That is
 * fine for every current caller — the insert is the last thing each of them
 * does that matters.
 */
export class UniqueRaceLost extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniqueRaceLost";
  }
}

/**
 * The message a lost race should show, or null if this is a real failure.
 *
 * Written as a type guard over `unknown` so an action's `catch (err)` can ask
 * without casting: `const raced = uniqueRaceMessage(err)`.
 */
export function uniqueRaceMessage(err: unknown): string | null {
  return err instanceof UniqueRaceLost ? err.message : null;
}
