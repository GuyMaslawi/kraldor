import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notStaffOrBotEmpire } from "@/lib/bot";
import { localRateLimit } from "@/lib/rateLimit";
import { getTunables } from "@/lib/game/config";
import { formatNumber } from "@/lib/game/format";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import { WORLD_BOSS_BY_KEY, worldBossReward } from "@/lib/game/worldBoss";
import { payRewards } from "@/server/rewardGrant";
import { logError } from "@/server/errorLog";

/**
 * Paying out a felled world boss.
 *
 * ## The bug this replaced
 *
 * The share used to be a button. A contender's purse sat unpaid on their
 * `WorldBossStrike` row until they opened /game/worldboss and pressed "קח את
 * חלקך" — and because the arena only ever renders the boss of the *current*
 * period (see `getWorldBossState`), the button vanished when that period turned
 * over along with any share nobody had got round to taking. Nothing swept for
 * the remainder; there was no screen that could still show it. A beast felled
 * in the evening paid the players who happened to log in again before it turned
 * over, and silently kept everyone else's. The fixture runs daily now, which
 * would have made that window seven times narrower and the bug seven times
 * worse.
 *
 * That is the exact shape of the complaint this was written for: *"I hit the
 * boss and never got anything."* From the player's side an unclaimed share and
 * an unpaid one are the same thing.
 *
 * ## The shape now
 *
 * The kill pays everybody. `settleWorldBossSpoils` fans out over every contender
 * who landed a blow, credits their share and writes them a message saying what
 * it was. The button stays as a fallback for a row the fan-out missed, and needs
 * no knowledge of it: both take the share with the same guarded UPDATE on
 * `claimed = false`, so of two payers reaching one striker together exactly one
 * pays.
 *
 * ## Why it is a sweep rather than part of the killing transaction
 *
 * The kill is one player's request, and the fan-out is one small transaction per
 * contender — potentially hundreds. Folding that into the transaction that
 * stamps `defeatedAt` would hold the striker's empire lock and a database
 * connection for the whole fan-out, and an interactive transaction that runs
 * long enough gets rolled back by its own timeout, which would undo the kill.
 *
 * So the kill commits first and this runs after it, and every property that
 * matters survives being interrupted:
 *
 *  - **Exactly-once per player** is the `claimed` guard, not the sweep.
 *  - **Resumable** is `spoilsSettledAt`, stamped only once a pass finds nothing
 *    left to pay. A fan-out cut short by a redeploy leaves it null, so the next
 *    sweep finishes the job.
 *  - **Reachable** is the sweep's `where`, which asks for *any* felled boss with
 *    unpaid shares rather than today's — so it also settles the debts the old
 *    button left behind in the weeks this fixture used to run in.
 */

/**
 * How often one instance bothers to look for an unsettled boss.
 *
 * The repair sweep rides the inbox poll, which is the only call that runs on
 * every screen — and therefore also the hottest path in the game, held to a
 * handful of indexed lookups on purpose (see `getInboxPulse`). A world boss
 * falls at most once a day, so probing for one on every poll of every player
 * would be a query per player per four seconds to answer a question whose
 * answer changes daily.
 *
 * A minute per instance is far more often than the debt can appear and costs
 * nothing at all in between — the gate is the same in-memory counter the poll
 * ceilings use, and a refused sweep is silent because the next one is a minute
 * away. Not a correctness mechanism: the kill pays on the spot, and this only
 * catches what a redeploy interrupted.
 */
const SWEEP_EVERY_MS = 60_000;

/** Strikers paid per pass. A pass re-queries, so this only bounds memory. */
const PAGE_SIZE = 200;

/** Payments in flight at once — see the note at the fan-out itself. */
const PAY_CONCURRENCY = 8;

/**
 * Passes one sweep will make before giving up.
 *
 * Each pass pays up to PAGE_SIZE strikers, so this is a ceiling of 20,000
 * payouts — far beyond any real server — and exists only so that a striker whose
 * payment keeps failing cannot spin the loop forever. Reaching it leaves
 * `spoilsSettledAt` null, which is the correct outcome: the debt is still owed
 * and the next sweep will try again.
 */
const MAX_PASSES = 100;

/** How many were paid, and whether anything is left. */
export interface WorldBossSpoilsResult {
  bossId: string;
  paid: number;
  /** Every contender is settled — the marker was stamped. */
  complete: boolean;
}

/**
 * "3.1M זהב · 1.5M ברזל · 640 תורות" as a translatable clause.
 *
 * Folded into a chain of nested clauses rather than joined into a string,
 * because this lands in a `Message` that the *reader* renders: a row written
 * during the slayer's request must not carry a sentence in the slayer's
 * language. See `renderMessageText` for the shape, and note that the two keys
 * used here are the ones the arena's own receipt already uses — a spoils line
 * reads the same wherever it appears.
 */
function spoilsClause(rewards: readonly Reward[]): Prisma.InputJsonValue | "" {
  const parts = rewards.filter((r) => r.amount > 0);
  return parts.reduceRight<Prisma.InputJsonValue | "">((rest, reward) => {
    const item: Prisma.InputJsonValue = {
      key: "{amount} {resource}",
      params: {
        amount: formatNumber(reward.amount),
        resource: { key: REWARD_LABEL[reward.kind] },
      },
    };
    return rest === "" ? item : { key: "{item} · {rest}", params: { item, rest } };
  }, "");
}

/**
 * Pay every unpaid contender of one felled boss.
 *
 * `bossId` narrows the sweep to the beast that has just been killed — the common
 * path, straight off the killing blow. Omitting it asks for the oldest felled
 * boss with anything still owed, which is the repair path: it is what pays off
 * a fan-out a redeploy interrupted, and what pays off the days the arena can no
 * longer render.
 *
 * Never throws. It runs at the tail of a strike that has already committed and
 * off a poll that has other work to do; a payout that fails is a debt still
 * recorded on the row, not an error on somebody's screen.
 */
export async function settleWorldBossSpoils(
  bossId?: string
): Promise<WorldBossSpoilsResult | null> {
  try {
    const boss = await prisma.worldBoss.findFirst({
      where: {
        ...(bossId ? { id: bossId } : {}),
        defeatedAt: { not: null },
        spoilsSettledAt: null,
      },
      orderBy: { day: "asc" },
      select: { id: true, key: true },
    });
    if (!boss) return null;

    // A retired catalog key still owes its strikers their share, so the payout
    // does not depend on the name resolving — only the message does, and it
    // falls back to the generic noun rather than printing a raw key.
    // i18n-keys-start: a dictionary key stored on the message row, not a
    // sentence — assembled in the reader's language. See renderMessageText.
    const bossName = WORLD_BOSS_BY_KEY.get(boss.key)?.name ?? "מפלצת העולם";
    // i18n-keys-end

    // Outside every transaction below, for the connection-pool reason
    // `startBossAssault` states at length.
    const tunables = await getTunables();
    const rewardMultiplier = tunables.worldBoss.rewardMultiplier;

    // The denominator, read once for the whole fan-out. Reading it per striker
    // would be the same figure at more cost — the boss is down, so no further
    // damage can land — and reading it once is also what guarantees every
    // contender is paid against the *same* totals, which is the fairness
    // property the old claim-time computation was reaching for.
    const [totals, participants] = await Promise.all([
      prisma.worldBossStrike.aggregate({
        where: { bossId: boss.id, ...notStaffOrBotEmpire },
        _sum: { damage: true },
      }),
      prisma.worldBossStrike.count({
        where: { bossId: boss.id, ...notStaffOrBotEmpire },
      }),
    ]);
    const total = totals._sum.damage ?? 0;

    const owed = {
      bossId: boss.id,
      claimed: false,
      hits: { gt: 0 },
      // Staff and bots are out of the game and out of the denominator above, so
      // paying them would hand a share to somebody the split never counted.
      ...notStaffOrBotEmpire,
    } as const;

    let paid = 0;
    let complete = false;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      // Re-queried each pass rather than paged by cursor: a paid striker no
      // longer matches `claimed: false`, so the unpaid set shrinks on its own
      // and an offset would skip rows as it did.
      const strikers = await prisma.worldBossStrike.findMany({
        where: owed,
        take: PAGE_SIZE,
        select: {
          id: true,
          empireId: true,
          damage: true,
          empire: { select: { cities: true } },
        },
      });
      if (strikers.length === 0) {
        complete = true;
        break;
      }

      // Several at a time, and this is a latency decision rather than a
      // throughput one. The common caller is the killing blow's own request: the
      // player is watching a reveal animation, and every payment is a small
      // transaction costing a handful of round trips to Neon. Paid one after
      // another, a server of two hundred contenders would hold that request for
      // the better part of a minute and quite likely hit the platform's function
      // timeout — leaving the fan-out for the sweep to finish, which works, but
      // hands the slayer an error for a kill that succeeded.
      //
      // Kept deliberately small all the same. Each payment holds one database
      // connection for the length of its transaction, and a fan-out wide enough
      // to drain the pool would stall every other player's request to speed up
      // this one.
      for (let i = 0; i < strikers.length; i += PAY_CONCURRENCY) {
        const results = await Promise.all(
          strikers
            .slice(i, i + PAY_CONCURRENCY)
            .map((striker) =>
              paySpoils(striker, bossName, total, participants, rewardMultiplier)
            )
        );
        paid += results.filter(Boolean).length;
      }
    }

    if (complete) {
      // After the last payment, never before: a marker stamped up front would
      // record an interrupted fan-out as a finished one, and the shares it never
      // reached would be exactly as lost as they were under the button.
      await prisma.worldBoss.updateMany({
        where: { id: boss.id, spoilsSettledAt: null },
        data: { spoilsSettledAt: new Date() },
      });
    }

    return { bossId: boss.id, paid, complete };
  } catch (err) {
    await logError("worldBossSpoils.settleWorldBossSpoils", err);
    return null;
  }
}

/**
 * The repair pass: settle whatever is still owed, at most once a minute per
 * instance.
 *
 * Hung off the inbox poll rather than a cron because there is no cron in this
 * deployment — the same lazy clock the mission board, the guild contract and the
 * tyrant's revival all run on. It is a no-op on every call but the handful that
 * follow an interrupted fan-out, and it returns nothing because no caller may
 * branch on it: the shares it pays belong to other players, so the poller's own
 * screen is never made stale by one.
 */
export async function sweepWorldBossSpoils(): Promise<void> {
  if (!localRateLimit("worldboss:spoils-sweep", 1, SWEEP_EVERY_MS)) return;
  await settleWorldBossSpoils();
}

/**
 * One contender's share, in its own transaction.
 *
 * Small on purpose — the guarded flip, the credit and the message, and nothing
 * else. The empire row lock is taken for the same reason `collectWorldBoss`
 * takes it: `payRewards` may route a line through `grantCitizens`, which reads
 * the city ceiling before writing, and a read-then-write must not race the
 * settle that is crediting this player's mines at the same moment.
 *
 * Returns whether this call is the one that paid.
 */
async function paySpoils(
  striker: {
    id: string;
    empireId: string;
    damage: number;
    empire: { cities: number };
  },
  bossName: string,
  total: number,
  participants: number,
  rewardMultiplier: number
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${striker.empireId} FOR UPDATE`;

      // The flip IS the claim. If the player pressed the arena's button in the
      // moment between the query above and this write, they have already been
      // paid and this call must do nothing at all.
      const claimed = await tx.worldBossStrike.updateMany({
        where: { id: striker.id, claimed: false },
        data: { claimed: true },
      });
      if (claimed.count === 0) return false;

      const share = total > 0 ? striker.damage / total : 0;
      const rewards = worldBossReward(
        share,
        participants,
        striker.empire.cities,
        rewardMultiplier
      );
      const paidOut = await payRewards(tx, striker.empireId, rewards);

      const spoils = spoilsClause(paidOut);
      // An admin may have zeroed `rewardMultiplier`, which closes the purse
      // rather than flooring it at one of everything (see `worldBossReward`).
      // The row is still claimed above — the share was settled, it was simply
      // worth nothing — but there is no message worth sending about it.
      if (spoils === "") return true;

      await tx.message.create({
        data: {
          empireId: striker.empireId,
          kind: "SYSTEM",
          // i18n-keys-start: keys and their values, stored rather than
          // rendered. This row is written on the slayer's request and read by
          // somebody else, quite possibly in the other language — the one case
          // `getT()` cannot serve. See renderMessageText.
          title: "🏆 חלקך בשלל {boss}",
          titleParams: { boss: { key: bossName } },
          body: "המפלצת נפלה והשלל חולק. קיבלת {spoils} — {pct}% מהנזק שנגרם לה.",
          bodyParams: { spoils, pct: Math.round(share * 100) },
          // i18n-keys-end
          href: "/game/worldboss",
        },
      });
      return true;
    });
  } catch (err) {
    // One striker's payment failing must not abandon the rest of the fan-out.
    // The row is still `claimed = false`, so the next sweep tries again.
    await logError("worldBossSpoils.paySpoils", err);
    return false;
  }
}
