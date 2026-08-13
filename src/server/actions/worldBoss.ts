"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { gameWeek, nextGameWeekStart } from "@/lib/game/time";
import { formatNumber } from "@/lib/game/format";
import { notStaffOrBot } from "@/lib/bot";
import { POLL_LIMIT, POLL_WINDOW_MS, localRateLimit } from "@/lib/rateLimit";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  WORLD_BOSS_BY_KEY,
  WORLD_BOSS_KILL_DIAMONDS,
  WORLD_BOSS_MAX_STRIKES,
  WORLD_BOSS_STRIKE_TURNS,
  expectedStrikeDamage,
  rollWorldBoss,
  strikeDamage,
  worldBossBlowGrade,
  worldBossMaxHp,
  worldBossPhase,
  worldBossReward,
  type WorldBossBlowEntry,
  type WorldBossState,
  type WorldBossStrikeReveal,
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

/**
 * Blows shown in the live feed.
 *
 * Twelve is about a screen of them at the arena's density, and the number is a
 * hard ceiling on the query rather than a display truncation — the feed is read
 * on a poll by every player in the arena at once, which is precisely the shape
 * of query the "no cached boards" rule says must be bounded at the database
 * instead of cached in front of it.
 */
const FEED_SIZE = 12;

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

  const [strikes, participants, damageTotal, mine, blows] = await Promise.all([
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
    prisma.worldBossBlow.findMany({
      where: { bossId: boss.id },
      orderBy: { createdAt: "desc" },
      take: FEED_SIZE,
      select: {
        id: true,
        empireId: true,
        empireName: true,
        title: true,
        damage: true,
        hpAfter: true,
        slaying: true,
        createdAt: true,
      },
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

  const feed: WorldBossBlowEntry[] = blows.map((row) => ({
    id: row.id,
    empireId: row.empireId,
    empireName: row.empireName,
    title: row.title,
    damage: row.damage,
    hpAfter: row.hpAfter,
    slaying: row.slaying,
    at: row.createdAt.getTime(),
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
    phase: worldBossPhase(boss.hp, boss.maxHp).key,
    defeated: boss.defeatedAt !== null,
    slayerName: boss.slayerName,

    endsAt: nextGameWeekStart(now).getTime(),
    serverNow: now.getTime(),

    strikesLeft: Math.max(0, WORLD_BOSS_MAX_STRIKES - (mine?.hits ?? 0)),
    strikeTurns: WORLD_BOSS_STRIKE_TURNS,
    turns: empire.turns,
    expectedDamage: expectedStrikeDamage(empire.militaryPower),
    myDamage: mine?.damage ?? 0,
    board,
    participants,
    feed,

    // The spoils open the moment it is down, not at the end of the week — a
    // server that killed it on Tuesday should not be told to come back Sunday.
    claimable:
      boss.defeatedAt !== null && (mine?.hits ?? 0) > 0 && !(mine?.claimed ?? false),
    claimed: mine?.claimed ?? false,
    reward: worldBossReward(share, participants, empire.cities),
  };
}

/* ------------------------------ strike ------------------------------ */

/** A landed blow, with everything the arena needs to play it out. */
export interface WorldBossStrikeState extends ActionState {
  reveal?: WorldBossStrikeReveal;
}

/**
 * Land one blow.
 *
 * Everything that can fail is checked *inside* the transaction against rows read
 * under the empire's own lock, because every one of these is a claim on a shared
 * resource: the turns are the player's, the strike count is theirs, and the
 * health is everybody's.
 *
 * ## The blow lands here, and only then is it shown
 *
 * The arena plays a short reveal over the returned `reveal` — the beast rears,
 * the blow lands, the bar drops. It is worth being exact about what that is and
 * is not, because the city boss's assault (lib/game/bossBattle.ts) works the
 * opposite way round and copying it here would break two things at once.
 *
 * There, the whole fight is rolled at launch and *applied at the settle* a
 * minute later, which is safe because the fight is private. Here the health is
 * shared and the killing blow is a race: the moment a blow's effect is deferred,
 * the bar every other player is watching becomes a lie, and two players can each
 * be told they landed the kill. So the damage, the kill stamp and the diamonds
 * are all committed in this transaction, before anything is returned, and the
 * reveal is a *report* of something that has already happened. A player who
 * closes the tab mid-animation has lost nothing but the animation.
 */
export async function strikeWorldBoss(): Promise<WorldBossStrikeState> {
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
      const striker = await tx.worldBossStrike.upsert({
        where: { bossId_empireId: { bossId: boss.id, empireId } },
        create: { bossId: boss.id, empireId, damage, hits: 1 },
        update: { damage: { increment: damage }, hits: { increment: 1 } },
        select: { hits: true },
      });

      // The blow itself, for the live feed. Written in the same transaction as
      // the damage so the feed can never show a blow the bar has not taken.
      await tx.worldBossBlow.create({
        data: {
          bossId: boss.id,
          empireId,
          empireName: empire.name,
          title: empire.title,
          damage,
          hpAfter: hit.hp,
          slaying: hit.slain,
        },
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

      // The health the instant *before* this blow, and it is exact for every
      // blow that did not kill: `GREATEST(0, hp - damage)` clamps only on the
      // kill, so `hpAfter + damage` is the health this strike actually found —
      // even if somebody else's blow landed between the read above and this
      // write. That exactness is what makes the phase crossing below belong to
      // exactly one striker server-wide, instead of being announced by everyone
      // who happened to be looking at a stale bar. On the kill there is no
      // phase left to cross, so the approximate branch is never read for one.
      const hpBefore = hit.slain
        ? Math.min(live.hp, damage)
        : hit.hp + damage;
      const expected = expectedStrikeDamage(empire.militaryPower);

      const reveal: WorldBossStrikeReveal = {
        damage,
        expected,
        grade: worldBossBlowGrade(damage, expected),
        hpBefore,
        hpAfter: hit.hp,
        maxHp: boss.maxHp,
        slain: hit.slain,
        phaseBefore: worldBossPhase(hpBefore, boss.maxHp).key,
        phaseAfter: worldBossPhase(hit.hp, boss.maxHp).key,
        strikesLeft: Math.max(0, WORLD_BOSS_MAX_STRIKES - striker.hits),
        diamonds: hit.slain ? WORLD_BOSS_KILL_DIAMONDS : 0,
      };

      // Only the kill says anything in words.
      //
      // An ordinary blow used to come back as "you hit it for 10,011, it has
      // 135,112 left", and the arena printed it under the card — a line that
      // appeared and vanished on every strike, moving the whole page twice, to
      // restate the health bar that is permanently on screen above it. The
      // figure now lives beside the beast instead (see the note at the head of
      // WorldBossArena), and there is nothing left for a sentence to add. The
      // kill is different: it pays diamonds, which the bar cannot show.
      return {
        reveal,
        success: hit.slain
          ? t("המכה שלך הפילה את {boss}! {diamonds} יהלומים על המכה האחרונה.", {
              boss: t(definition.name),
              diamonds: WORLD_BOSS_KILL_DIAMONDS,
            })
          : undefined,
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("worldBoss.strikeWorldBoss", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ watching ------------------------------ */

/**
 * What the arena asks for while it is open. `retry` is a refused or failed
 * round, which is a different thing from "the fixture is gone" — see the same
 * distinction on BossArenaPoll, and the bug it was introduced to fix.
 */
export interface WorldBossPoll {
  state?: WorldBossState | null;
  retry?: boolean;
}

/**
 * The arena, re-read.
 *
 * This exists because the world boss is the one screen in the game whose
 * contents change without the viewer doing anything: the bar moves when a
 * stranger strikes, and the phase turns when a stranger crosses a threshold. A
 * server-rendered snapshot cannot show that, and until the arena polled, "the
 * whole server is fighting this" was a claim the page made rather than
 * something a player could see.
 *
 * Rate-limited with the in-process ceiling rather than the Postgres-counted one
 * for the reason `pollBossArena` states: this is a read path, and a refused
 * round costs the player nothing because the arena simply asks again. The
 * client also stops polling on a hidden tab and on a felled boss, which is what
 * keeps a page anyone may leave open all week from being a standing load.
 */
export async function pollWorldBoss(): Promise<WorldBossPoll> {
  try {
    const empireId = await getActiveEmpireId();
    if (empireId === null) return { retry: true };

    if (!localRateLimit(`poll:worldboss:${empireId}`, POLL_LIMIT, POLL_WINDOW_MS)) {
      return { retry: true };
    }

    return { state: await getWorldBossState() };
  } catch (err) {
    await logError("worldBoss.pollWorldBoss", err);
    return { retry: true };
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
