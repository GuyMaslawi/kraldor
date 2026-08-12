import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  FERVOR_CAP,
  FERVOR_DECAY_MS,
  fervorNow,
  type FervorState,
} from "@/lib/game/fervor";

/**
 * Writing להט הקרב.
 *
 * The meter's arithmetic is pure and lives in lib/game/fervor.ts; this module is
 * the one statement that advances it, and the read that hands it to a screen.
 *
 * There is no job here and there never should be. The decay is derived at read
 * time, so the only write is the bump itself — see `bumpFervor`.
 */

/** The four columns the meter is made of, as every reader wants them. */
export const FERVOR_SELECT = {
  fervorPoints: true,
  fervorAt: true,
  fervorDay: true,
  fervorHotAttacks: true,
} satisfies Prisma.EmpireSelect;

export type FervorColumns = Prisma.EmpireGetPayload<{
  select: typeof FERVOR_SELECT;
}>;

/** The meter's two live columns as the pure functions want them. */
export function fervorStateOf(row: {
  fervorPoints: number;
  fervorAt: Date | null;
}): FervorState {
  return { points: row.fervorPoints, at: row.fervorAt?.getTime() ?? null };
}

/** What the meter is actually worth right now, after decay. */
export function livePoints(
  row: { fervorPoints: number; fervorAt: Date | null },
  now: Date
): number {
  const state = fervorStateOf(row);
  return fervorNow(state.points, state.at, now.getTime());
}

/**
 * Credit one action to the meter.
 *
 * A single UPDATE rather than a read-modify-write, because this sits on the hot
 * path of nearly every action in the game — an attack, a spy, an upgrade, a
 * minigame — and none of them should pay a round-trip to read a number they are
 * about to overwrite. Call sites need no state at all: they call this and move
 * on.
 *
 * ## Why this is all integer epoch arithmetic
 *
 * `fervorAt` is `TIMESTAMP(3)` — *without* a zone — holding UTC, which is what
 * Prisma writes into one. Bare `NOW()` produces a `timestamptz`, and assigning
 * one of those to a zoneless column converts it through the database session's
 * own zone: the bug that has already bitten the guild contract, the world boss
 * and the rate limiter. The house fix is `NOW() AT TIME ZONE 'UTC'`, but that
 * still cannot be used here, because the caller's `now` — not the database's —
 * is what the rest of the transaction is stamped against, and a test must be
 * able to hand this a fixed clock.
 *
 * So both conversions are done in epoch milliseconds, and both directions are
 * zone-independent by construction:
 *
 *   • `EXTRACT(EPOCH FROM ts)` on a zoneless timestamp reads it literally as
 *     UTC — `EXTRACT(EPOCH FROM TIMESTAMP '1970-01-01 00:00:00') = 0` in every
 *     session zone there is.
 *   • `TIMESTAMP 'epoch' + n * INTERVAL '1 millisecond'` is naive timestamp
 *     arithmetic on a naive literal. No zone is consulted in either step.
 *
 * That is a stronger guarantee than `AT TIME ZONE 'UTC'`, which is merely
 * *correct*: this one has no zone-dependent term to get wrong in the first
 * place.
 *
 * ## Why the clock advances the way it does
 *
 * `fervorAt` moves by whole decay periods only, never to `now`. Decay is
 * floored, so stamping `now` would throw the sub-period remainder away on every
 * action and let a player acting every 1:59 pay zero decay forever. This is the
 * SQL twin of `bumpedFervor`, and tests/db/fervor.test.ts asserts the two agree
 * step for step.
 *
 * ## Concurrency
 *
 * Two actions landing together may cost the player a point — both may read the
 * same `fervorPoints` and each write it one higher — and that is fine. The race
 * can only ever under-credit: every path through the statement is bounded above
 * by FERVOR_CAP, so there is nothing to farm. The meter is a soft multiplier
 * that rebuilds within seconds of play, not a balance; guarding it with a row
 * lock would cost more than the point it saves.
 */
export async function bumpFervor(
  tx: Prisma.TransactionClient,
  empireId: string,
  now: Date,
  amount = 1
): Promise<void> {
  if (amount <= 0) return;
  const nowMs = BigInt(now.getTime());
  const decay = BigInt(FERVOR_DECAY_MS);

  await tx.$executeRaw`
    UPDATE "Empire" e
    SET "fervorPoints" = LEAST(
          ${FERVOR_CAP}::int,
          GREATEST(0, LEAST(${FERVOR_CAP}::int, e."fervorPoints") - c.periods::int)
            + ${amount}::int
        ),
        "fervorAt" = TIMESTAMP 'epoch'
          + ((c.base_ms + c.periods * ${decay}::bigint) * INTERVAL '1 millisecond')
    FROM (
      SELECT
        COALESCE(
          (EXTRACT(EPOCH FROM x."fervorAt") * 1000)::bigint,
          ${nowMs}::bigint
        ) AS base_ms,
        GREATEST(0, FLOOR((
          ${nowMs}::bigint - COALESCE(
            (EXTRACT(EPOCH FROM x."fervorAt") * 1000)::bigint,
            ${nowMs}::bigint
          )
        ) / ${decay}::bigint))::bigint AS periods
      FROM "Empire" x
      WHERE x.id = ${empireId}
    ) AS c
    WHERE e.id = ${empireId}
  `;
}

/**
 * The meter for a screen: its live points, read without writing.
 *
 * Deliberately a plain read. A gameplay read must never turn into a write on the
 * hot path — the same rule Happy Hour follows with its stale `isActive` flag.
 */
export async function readFervorPoints(
  empireId: string,
  now: Date = new Date(),
  tx: Prisma.TransactionClient = prisma
): Promise<number> {
  const row = await tx.empire.findUnique({
    where: { id: empireId },
    select: { fervorPoints: true, fervorAt: true },
  });
  return row ? livePoints(row, now) : 0;
}
