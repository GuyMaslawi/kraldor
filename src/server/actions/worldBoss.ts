"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { gameWeek, nextGameWeekStart } from "@/lib/game/time";
import { formatNumber } from "@/lib/game/format";
import { notStaffOrBot } from "@/lib/bot";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  WORLD_BOSS_BY_KEY,
  WORLD_BOSS_KILL_DIAMONDS,
  WORLD_BOSS_MAX_STRIKES,
  WORLD_BOSS_STRIKE_TURNS,
  rollWorldBoss,
  strikeDamage,
  worldBossMaxHp,
  worldBossReward,
  type WorldBossState,
  type WorldBossStriker,
} from "@/lib/game/worldBoss";
import { payRewards } from "@/server/rewardGrant";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT, type T } from "@/i18n/server";

/**
 * מפלצת העולם — the arena.
 *
 * Three things happen here: the week's boss is spawned (lazily, on the first
 * read), it is struck, and the spoils are collected. See lib/game/worldBoss.ts
 * for why it is a clock fixture with no admin button behind it.
 *
 * The one genuinely hard part is the kill, and it is worth stating how it is
 * made safe: **the strike that takes health to zero is the same statement that
 * stamps the slayer.** One UPDATE, guarded on `hp > 0`, decrementing and
 * stamping in the same breath — so of two players landing the last blow at the
 * same instant, exactly one matches a row with health left, and the other's
 * blow finds a corpse.
 */

async function requireOwnEmpireId(): Promise<string> {
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the catch returns a translated line.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

/** "120,000 זהב, 150 תורות" — a purse as one readable line. */
function describeRewards(t: T, rewards: readonly Reward[]): string {
  return rewards
    .filter((r) => r.amount > 0)
    .map((r) =>
      t("{amount} {resource}", {
        amount: formatNumber(r.amount),
        resource: t(REWARD_LABEL[r.kind]),
      })
    )
    .join(", ");
}

/* ------------------------------ spawn ------------------------------ */

/**
 * The week's boss, creating it on the first look.
 *
 * Safe to race for the same reason a mission board is: the key is a pure
 * function of the week, so two concurrent first-loads compute the identical row
 * and the unique index rejects the loser, whose `catch` re-reads what the winner
 * wrote. The health pool is the one thing that could differ between them — it
 * reads a live count — and that is exactly why the loser takes the winner's row
 * rather than its own figure.
 *
 * Staff and bots are excluded from the count. A garrison an admin planted is
 * not somebody who will turn up to fight, and counting it would raise the pool
 * against players who have to clear it.
 */
async function openWorldBoss(week: number) {
  const existing = await prisma.worldBoss.findUnique({ where: { week } });
  if (existing) return existing;

  const definition = rollWorldBoss(week);
  const empires = await prisma.empire.count({ where: notStaffOrBot });
  const maxHp = worldBossMaxHp(definition, empires);

  try {
    return await prisma.worldBoss.create({
      data: { week, key: definition.key, maxHp, hp: maxHp },
    });
  } catch {
    return prisma.worldBoss.findUniqueOrThrow({ where: { week } });
  }
}

/* ------------------------------ read ------------------------------ */

/** Rows shown on the damage board. Beyond this it is a scroll, not a board. */
const BOARD_SIZE = 25;

/** Everything the arena renders. */
export async function getWorldBossState(): Promise<WorldBossState | null> {
  const empireId = await getActiveEmpireId();
  if (empireId === null) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: { id: true, cities: true, turns: true, militaryPower: true },
  });
  if (!empire) return null;

  const now = new Date();
  const week = gameWeek(now);
  const boss = await openWorldBoss(week);
  const definition = WORLD_BOSS_BY_KEY.get(boss.key);
  // A retired key degrades to no arena rather than a crash — the same rule
  // every other keyed table here follows.
  if (!definition) return null;

  const [strikes, participants, damageTotal, mine] = await Promise.all([
    prisma.worldBossStrike.findMany({
      where: { bossId: boss.id },
      orderBy: { damage: "desc" },
      take: BOARD_SIZE,
      select: {
        empireId: true,
        damage: true,
        hits: true,
        empire: { select: { name: true, title: true } },
      },
    }),
    prisma.worldBossStrike.count({ where: { bossId: boss.id } }),
    prisma.worldBossStrike.aggregate({
      where: { bossId: boss.id },
      _sum: { damage: true },
    }),
    prisma.worldBossStrike.findUnique({
      where: { bossId_empireId: { bossId: boss.id, empireId } },
      select: { damage: true, hits: true, claimed: true },
    }),
  ]);

  const total = damageTotal._sum.damage ?? 0;
  const share = total > 0 ? (mine?.damage ?? 0) / total : 0;

  const board: WorldBossStriker[] = strikes.map((row) => ({
    empireId: row.empireId,
    empireName: row.empire.name,
    title: row.empire.title,
    damage: row.damage,
    hits: row.hits,
    isMe: row.empireId === empireId,
  }));

  return {
    key: definition.key,
    name: definition.name,
    lore: definition.lore,
    sigil: definition.sigil,
    icon: definition.icon,
    accent: definition.accent,

    maxHp: boss.maxHp,
    hp: Math.max(0, boss.hp),
    defeated: boss.defeatedAt !== null,
    slayerName: boss.slayerName,

    endsAt: nextGameWeekStart(now).getTime(),
    serverNow: now.getTime(),

    strikesLeft: Math.max(0, WORLD_BOSS_MAX_STRIKES - (mine?.hits ?? 0)),
    strikeTurns: WORLD_BOSS_STRIKE_TURNS,
    turns: empire.turns,
    myDamage: mine?.damage ?? 0,
    board,
    participants,

    // The spoils open the moment it is down, not at the end of the week — a
    // server that killed it on Tuesday should not be told to come back Sunday.
    claimable:
      boss.defeatedAt !== null && (mine?.hits ?? 0) > 0 && !(mine?.claimed ?? false),
    claimed: mine?.claimed ?? false,
    reward: worldBossReward(share, participants, empire.cities),
  };
}

/* ------------------------------ strike ------------------------------ */

/**
 * Land one blow.
 *
 * Everything that can fail is checked *inside* the transaction against rows read
 * under the empire's own lock, because every one of these is a claim on a shared
 * resource: the turns are the player's, the strike count is theirs, and the
 * health is everybody's.
 */
export async function strikeWorldBoss(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();
    const week = gameWeek(new Date());

    // Outside the transaction: a transaction must not ask for a second
    // connection while holding one — the same rule spyOnEmpire states.
    const boss = await openWorldBoss(week);
    const definition = WORLD_BOSS_BY_KEY.get(boss.key);
    if (!definition) return { error: t("אין מפלצת עולם השבוע.") };

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      // Settle first: a strike costs turns, and a player who was away has a
      // backlog of them waiting to be credited.
      const empire = await applyPendingUpdates(empireId, tx);

      const live = await tx.worldBoss.findUnique({
        where: { id: boss.id },
        select: { hp: true, defeatedAt: true, slayerName: true },
      });
      if (!live) return { error: t("אין מפלצת עולם השבוע.") };
      if (live.defeatedAt !== null || live.hp <= 0) {
        return {
          error: t("{boss} כבר הופלה השבוע.", { boss: t(definition.name) }),
        };
      }

      const mine = await tx.worldBossStrike.findUnique({
        where: { bossId_empireId: { bossId: boss.id, empireId } },
        select: { id: true, hits: true },
      });
      if ((mine?.hits ?? 0) >= WORLD_BOSS_MAX_STRIKES) {
        return {
          error: t("ניצלת את כל {max} המכות שלך השבוע.", {
            max: WORLD_BOSS_MAX_STRIKES,
          }),
        };
      }

      // Guarded debit — the house rule for every spend here.
      const paid = await tx.empire.updateMany({
        where: { id: empireId, turns: { gte: WORLD_BOSS_STRIKE_TURNS } },
        data: { turns: { decrement: WORLD_BOSS_STRIKE_TURNS } },
      });
      if (paid.count === 0) {
        return {
          error: t("מכה עולה {turns} תורות.", { turns: WORLD_BOSS_STRIKE_TURNS }),
        };
      }

      const damage = strikeDamage(empire.militaryPower);

      // The blow and the kill in one statement. `hp > 0` is what makes the kill
      // exclusive: of two players landing the last blow together, exactly one
      // matches a row with health left. The GREATEST clamp keeps health from
      // going negative, so the bar never reads below empty.
      // `NOW() AT TIME ZONE 'UTC'` rather than a bare `NOW()`: these columns are
      // `TIMESTAMP(3)` without a zone holding UTC, which is what Prisma writes
      // into one, and assigning a `timestamptz` to such a column converts it
      // through the database session's own zone. On a server not running in UTC
      // the kill would be stamped hours from every other timestamp in the
      // database — and `defeatedAt` is what the whole week's fixture is read
      // against. See the same note in actions/daily.ts.
      const rows = await tx.$queryRaw<{ hp: number; slain: boolean }[]>`
        UPDATE "WorldBoss"
        SET hp = GREATEST(0, hp - ${damage}),
            "defeatedAt" = CASE
              WHEN hp - ${damage} <= 0 AND "defeatedAt" IS NULL
                THEN (NOW() AT TIME ZONE 'UTC')
              ELSE "defeatedAt" END,
            "slayerId" = CASE
              WHEN hp - ${damage} <= 0 AND "defeatedAt" IS NULL THEN ${empireId}
              ELSE "slayerId" END,
            "slayerName" = CASE
              WHEN hp - ${damage} <= 0 AND "defeatedAt" IS NULL THEN ${empire.name}
              ELSE "slayerName" END,
            "updatedAt" = (NOW() AT TIME ZONE 'UTC')
        WHERE id = ${boss.id} AND hp > 0
        RETURNING hp, ("slayerId" = ${empireId} AND hp <= 0) AS slain
      `;
      const hit = rows[0];
      if (!hit) {
        // Somebody killed it between the read above and this write. Give the
        // turns back — the blow never landed.
        await tx.empire.update({
          where: { id: empireId },
          data: { turns: { increment: WORLD_BOSS_STRIKE_TURNS } },
        });
        return {
          error: t("{boss} כבר הופלה השבוע.", { boss: t(definition.name) }),
        };
      }

      // The striker's running total. upsert rather than create-or-update: two of
      // this player's own tabs can reach here together, and a failed insert
      // would poison the transaction in Postgres.
      await tx.worldBossStrike.upsert({
        where: { bossId_empireId: { bossId: boss.id, empireId } },
        create: { bossId: boss.id, empireId, damage, hits: 1 },
        update: { damage: { increment: damage }, hits: { increment: 1 } },
      });

      // The killing blow is the one part of the fixture that belongs to
      // somebody. Paid immediately rather than through the shared claim, so the
      // moment lands while the player is looking at it.
      if (hit.slain) {
        await tx.empire.update({
          where: { id: empireId },
          data: { diamonds: { increment: WORLD_BOSS_KILL_DIAMONDS } },
        });
      }

      // Rated as a city-boss run: it costs 40 turns against the boss's 300, so
      // this is deliberately the smaller `attack`.
      await awardSeasonPassXp(tx, empireId, "attack");

      return {
        success: hit.slain
          ? t("המכה שלך הפילה את {boss}! {diamonds} יהלומים על המכה האחרונה.", {
              boss: t(definition.name),
              diamonds: WORLD_BOSS_KILL_DIAMONDS,
            })
          : t("פגעת ב{boss} ב-{damage} נזק. נותרו לה {hp} חיים.", {
              boss: t(definition.name),
              damage: formatNumber(damage),
              hp: formatNumber(Math.round(hit.hp)),
            }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("worldBoss.strikeWorldBoss", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ collect ------------------------------ */

/**
 * Take your share of a felled boss.
 *
 * The share is computed at claim time from the totals as they finally stand,
 * which is the only honest moment: a player who claims first must not be paid
 * against a smaller denominator than one who claims later.
 */
export async function collectWorldBoss(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();
    const week = gameWeek(new Date());

    const boss = await prisma.worldBoss.findUnique({ where: { week } });
    if (!boss) return { error: t("אין מפלצת עולם השבוע.") };
    if (boss.defeatedAt === null) {
      return { error: t("המפלצת עדיין עומדת — אין שלל לחלק.") };
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      const empire = await applyPendingUpdates(empireId, tx);

      const mine = await tx.worldBossStrike.findUnique({
        where: { bossId_empireId: { bossId: boss.id, empireId } },
        select: { id: true, damage: true, hits: true, claimed: true },
      });
      if (!mine || mine.hits === 0) {
        return { error: t("לא הכית את המפלצת השבוע.") };
      }
      if (mine.claimed) return { error: t("כבר אספת את חלקך.") };

      const [totals, participants] = await Promise.all([
        tx.worldBossStrike.aggregate({
          where: { bossId: boss.id },
          _sum: { damage: true },
        }),
        tx.worldBossStrike.count({ where: { bossId: boss.id } }),
      ]);
      const total = totals._sum.damage ?? 0;
      const share = total > 0 ? mine.damage / total : 0;

      // The flag flip IS the claim: whichever concurrent call sets it pays out,
      // and the other matches no row and pays nothing.
      const claimed = await tx.worldBossStrike.updateMany({
        where: { id: mine.id, claimed: false },
        data: { claimed: true },
      });
      if (claimed.count === 0) return { error: t("כבר אספת את חלקך.") };

      const paid = await payRewards(
        tx,
        empireId,
        worldBossReward(share, participants, empire.cities)
      );

      return {
        success: t("חלקך בשלל: {spoils}. ({pct}% מהנזק)", {
          spoils: describeRewards(t, paid),
          pct: Math.round(share * 100),
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("worldBoss.collectWorldBoss", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
