"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { getTunables } from "@/lib/game/config";
import { gameWeek, nextGameWeekStart } from "@/lib/game/time";
import { formatNumber } from "@/lib/game/format";
import { notStaffOrBot, notStaffOrBotEmpire } from "@/lib/bot";
import { POLL_LIMIT, POLL_WINDOW_MS, localRateLimit } from "@/lib/rateLimit";
import { REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import {
  WORLD_BOSS_BY_KEY,
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
import { settleWorldBossSpoils } from "@/server/worldBossSpoils";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import {
  heraldChat,
  heraldDiscord,
  heraldInbox,
  type HeraldText,
} from "@/server/herald";
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
async function openWorldBoss(week: number, hpMultiplier: number) {
  const existing = await prisma.worldBoss.findUnique({ where: { week } });
  if (existing) return existing;

  const definition = rollWorldBoss(week);
  const empires = await prisma.empire.count({ where: notStaffOrBot });
  const maxHp = worldBossMaxHp(definition, empires, hpMultiplier);

  try {
    const created = await prisma.worldBoss.create({
      data: { week, key: definition.key, maxHp, hp: maxHp },
    });
    // Only the winner of the create race gets here, and the claim inside makes
    // it exactly-once even so. Awaited rather than fired and forgotten: it runs
    // once a week, and a fan-out cut short when the response is sent is a fan-out
    // half the game never receives.
    await heraldWorldBossSpawn(created.id);
    return created;
  } catch {
    return prisma.worldBoss.findUniqueOrThrow({ where: { week } });
  }
}

/* ------------------------------ heralds ------------------------------ */

/** Where a herald sends the reader. */
const ARENA_HREF = "/game/worldboss";

/**
 * "A world boss is loose."
 *
 * The whole server is on the same side of this fight and on the same weekly
 * clock, which is the entire argument for spending an inbox message on it: a
 * player who never opens /game/worldboss has no other way to learn there is
 * something there this week, and by the time they wander in the server may
 * already have felled it.
 *
 * All three channels, because they reach three different people — the player
 * who is in the game right now (chat), the one who will open it this evening
 * (inbox), and the one who is not playing at all (Discord).
 */
async function heraldWorldBossSpawn(bossId: string): Promise<void> {
  try {
    // The claim, before anything is sent. See the note on WorldBoss.spawnAnnouncedAt.
    const claimed = await prisma.worldBoss.updateMany({
      where: { id: bossId, spawnAnnouncedAt: null },
      data: { spawnAnnouncedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const boss = await prisma.worldBoss.findUnique({
      where: { id: bossId },
      select: { key: true, maxHp: true },
    });
    const definition = boss ? WORLD_BOSS_BY_KEY.get(boss.key) : undefined;
    if (!boss || !definition) return;

    // i18n-keys-start: keys and their values, stored rather than rendered — the
    // spawn is discovered on one player's page load and read by everybody else,
    // each in their own language. See server/herald.ts.
    const title: HeraldText = {
      key: "🌍 מפלצת עולם חדשה: {boss}",
      params: { boss: { key: definition.name } },
    };
    const body: HeraldText = {
      key: "{lore} {hp} נקודות חיים, והיא נופלת רק אם כל השרת יכה בה. הזירה פתוחה עד סוף השבוע.",
      params: {
        lore: { key: definition.lore },
        hp: formatNumber(Math.round(boss.maxHp)),
      },
    };

    await heraldChat({
      key: "{sigil} {boss} עלתה על העולם. הזירה פתוחה — כל אימפריה מוזמנת להכות.",
      params: { sigil: definition.sigil, boss: { key: definition.name } },
    });
    await heraldInbox({ title, body, href: ARENA_HREF });
    await heraldDiscord({ kind: "event", title, body, href: ARENA_HREF });
    // i18n-keys-end
  } catch (err) {
    // The boss exists and can be fought; a herald that failed is only silence.
    await logError("worldBoss.heraldWorldBossSpawn", err);
  }
}

/**
 * "It is down, and here is who put it down."
 *
 * Fired from outside the killing transaction, so the row already says
 * `defeatedAt` by the time anybody is told — and claimed on
 * `defeatAnnouncedAt`, so a second tab replaying the same strike cannot announce
 * the kill twice.
 *
 * Sent *after* `settleWorldBossSpoils` has run, which is what lets it speak in
 * the past tense: by the time anybody reads this the shares are already in their
 * treasuries, and each contender has a message of their own saying what theirs
 * came to. This one is the world's account of the kill, not a call to come and
 * collect.
 */
async function heraldWorldBossDefeat(bossId: string): Promise<void> {
  try {
    const claimed = await prisma.worldBoss.updateMany({
      where: { id: bossId, defeatAnnouncedAt: null, defeatedAt: { not: null } },
      data: { defeatAnnouncedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const boss = await prisma.worldBoss.findUnique({
      where: { id: bossId },
      select: { key: true, slayerId: true, slayerName: true },
    });
    const definition = boss ? WORLD_BOSS_BY_KEY.get(boss.key) : undefined;
    if (!boss || !definition) return;

    // A beast felled by a staff empire is still felled, but nobody is named for
    // it — the same rule the arena's own kill line follows.
    const slayer = boss.slayerId
      ? await prisma.empire.findUnique({
          where: { id: boss.slayerId },
          select: { name: true, isStaff: true, isBot: true },
        })
      : null;
    const slayerName =
      slayer && !slayer.isStaff && !slayer.isBot ? slayer.name : null;

    // i18n-keys-start: as above — stored keys, assembled per reader.
    const title: HeraldText = {
      key: "🏆 {boss} הופלה",
      params: { boss: { key: definition.name } },
    };
    const body: HeraldText = {
      key: "{slayer} חלקו של כל מי שהכה אותה השבוע כבר נכנס לאוצר שלו.",
      params: {
        // An absent clause is simply left out and the spaces around it are
        // collapsed on the way out — see the note in messageText.ts.
        slayer: slayerName
          ? { key: "{name} הנחית את המכה האחרונה.", params: { name: slayerName } }
          : "",
      },
    };

    await heraldChat({
      key: slayerName
        ? "🏆 {slayer} הפיל את {boss}! השלל חולק בין כל מי שהכה בה."
        : "🏆 {boss} הופלה! השלל חולק בין כל מי שהכה בה.",
      params: { slayer: slayerName ?? "", boss: { key: definition.name } },
    });
    await heraldInbox({ title, body, href: ARENA_HREF });
    await heraldDiscord({ kind: "event", title, body, href: ARENA_HREF });
    // i18n-keys-end
  } catch (err) {
    await logError("worldBoss.heraldWorldBossDefeat", err);
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

  const tunables = await getTunables();
  // Closed from /admin/bosses. Checked before `openWorldBoss` so a shut arena
  // does not spawn the week's row on the first look — a boss nobody may strike
  // would otherwise sit there accruing a week it never gets fought.
  if (tunables.worldBoss.enabled < 1) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: {
      id: true,
      cities: true,
      turns: true,
      militaryPower: true,
      isStaff: true,
      isBot: true,
    },
  });
  if (!empire) return null;

  const now = new Date();
  const week = gameWeek(now);
  const boss = await openWorldBoss(week, tunables.worldBoss.hpMultiplier);
  const definition = WORLD_BOSS_BY_KEY.get(boss.key);
  // A retired key degrades to no arena rather than a crash — the same rule
  // every other keyed table here follows.
  if (!definition) return null;

  // Everything read here is filtered to contenders — neither staff nor bots.
  // The strike itself refuses them (see `strikeWorldBoss`), but that guard only
  // covers blows landed *after* it existed: rows an admin's empire left behind
  // beforehand still carried its name through the live feed and the damage
  // board, and its damage still sat in the denominator every player's share is
  // divided by. Staff are out of the game (src/lib/staff.ts), so they are
  // filtered on the way out as well as on the way in — the feed and the board
  // are the same kind of ranked view as every other place that spreads this.
  const [strikes, participants, damageTotal, mine, blows, slayer] = await Promise.all([
    prisma.worldBossStrike.findMany({
      where: { bossId: boss.id, ...notStaffOrBotEmpire },
      orderBy: { damage: "desc" },
      take: BOARD_SIZE,
      select: {
        empireId: true,
        damage: true,
        hits: true,
        empire: { select: { name: true, title: true } },
      },
    }),
    prisma.worldBossStrike.count({
      where: { bossId: boss.id, ...notStaffOrBotEmpire },
    }),
    prisma.worldBossStrike.aggregate({
      where: { bossId: boss.id, ...notStaffOrBotEmpire },
      _sum: { damage: true },
    }),
    prisma.worldBossStrike.findUnique({
      where: { bossId_empireId: { bossId: boss.id, empireId } },
      select: { damage: true, hits: true, claimed: true },
    }),
    prisma.worldBossBlow.findMany({
      where: { bossId: boss.id, ...notStaffOrBotEmpire },
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
    // `slayerId` is deliberately not a relation (see the model), so the kill
    // line cannot be filtered in the query above. Asked for only once there is
    // a slayer to check, which on the polled path is after the fight is over.
    boss.slayerId === null
      ? Promise.resolve(null)
      : prisma.empire.findUnique({
          where: { id: boss.slayerId },
          select: { isStaff: true, isBot: true },
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
    // A boss felled by a staff empire is still felled — but nobody is named for
    // it. The arena hides the line when there is no name.
    slayerName: slayer && (slayer.isStaff || slayer.isBot) ? null : boss.slayerName,

    endsAt: nextGameWeekStart(now).getTime(),
    serverNow: now.getTime(),

    strikesLeft: Math.max(0, tunables.worldBoss.maxStrikes - (mine?.hits ?? 0)),
    strikeTurns: tunables.worldBoss.strikeTurns,
    maxStrikes: tunables.worldBoss.maxStrikes,
    killDiamonds: Math.max(0, Math.round(tunables.worldBoss.killDiamonds)),
    turns: empire.turns,
    expectedDamage: expectedStrikeDamage(
      empire.militaryPower,
      tunables.worldBoss.damageMultiplier
    ),
    myDamage: mine?.damage ?? 0,
    board,
    participants,
    feed,
    blocked: empire.isStaff || empire.isBot,

    // The spoils open the moment it is down, not at the end of the week — a
    // server that killed it on Tuesday should not be told to come back Sunday.
    claimable:
      boss.defeatedAt !== null && (mine?.hits ?? 0) > 0 && !(mine?.claimed ?? false),
    claimed: mine?.claimed ?? false,
    reward: worldBossReward(
      share,
      participants,
      empire.cities,
      tunables.worldBoss.rewardMultiplier
    ),
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
    // connection while holding one — the same rule spyOnEmpire states. That is
    // also why the tunables are read here rather than beside their first use.
    const tunables = await getTunables();
    if (tunables.worldBoss.enabled < 1) {
      return { error: t("זירת מפלצת העולם סגורה כרגע.") };
    }

    const boss = await openWorldBoss(week, tunables.worldBoss.hpMultiplier);
    const definition = WORLD_BOSS_BY_KEY.get(boss.key);
    if (!definition) return { error: t("אין מפלצת עולם השבוע.") };

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      // Settle first: a strike costs turns, and a player who was away has a
      // backlog of them waiting to be credited.
      const empire = await applyPendingUpdates(empireId, tx);

      // Staff accounts are out of the game (src/lib/staff.ts), and this is the
      // one fixture the whole server shares: a blow from an admin's empire —
      // which can be handed any army at all — takes health off a pool everybody
      // else has to clear, puts the admin's name in the live feed and on the
      // damage board, and can take the kill prize. Refused inside the
      // transaction, alongside every other claim on a shared resource.
      if (empire.isStaff || empire.isBot) {
        return { error: t("חשבונות הנהלה אינם תוקפים את מפלצת העולם.") };
      }

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
      const maxStrikes = tunables.worldBoss.maxStrikes;
      const strikeTurns = tunables.worldBoss.strikeTurns;
      if ((mine?.hits ?? 0) >= maxStrikes) {
        return {
          error: t("ניצלת את כל {max} המכות שלך השבוע.", { max: maxStrikes }),
        };
      }

      // Guarded debit — the house rule for every spend here.
      const paid = await tx.empire.updateMany({
        where: { id: empireId, turns: { gte: strikeTurns } },
        data: { turns: { decrement: strikeTurns } },
      });
      if (paid.count === 0) {
        return { error: t("מכה עולה {turns} תורות.", { turns: strikeTurns }) };
      }

      const damage = strikeDamage(
        empire.militaryPower,
        undefined,
        tunables.worldBoss.damageMultiplier
      );

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
          data: { turns: { increment: strikeTurns } },
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
      const killDiamonds = Math.max(0, Math.round(tunables.worldBoss.killDiamonds));
      if (hit.slain && killDiamonds > 0) {
        await tx.empire.update({
          where: { id: empireId },
          data: { diamonds: { increment: killDiamonds } },
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
      const expected = expectedStrikeDamage(
        empire.militaryPower,
        tunables.worldBoss.damageMultiplier
      );

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
        strikesLeft: Math.max(0, maxStrikes - striker.hits),
        diamonds: hit.slain ? killDiamonds : 0,
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
        success: !hit.slain
          ? undefined
          : killDiamonds > 0
            ? t("המכה שלך הפילה את {boss}! {diamonds} יהלומים על המכה האחרונה.", {
                boss: t(definition.name),
                diamonds: killDiamonds,
              })
            : // The prize is a tunable now, and an admin may have zeroed it. The
              // moment still belongs to this player, so it is still announced —
              // just without a figure that is no longer paid.
              t("המכה שלך הפילה את {boss}!", { boss: t(definition.name) }),
      };
    });

    // Outside the transaction on purpose, and after it. Two reasons, one per
    // call: the herald posts to Discord, and a network call inside a transaction
    // holds a connection open for the length of somebody else's outage; the
    // payout is one small transaction per contender, and nesting a fan-out of
    // them inside the killing transaction would hold this player's empire lock
    // until the last of them committed — long enough for the interactive
    // transaction timeout to roll the kill itself back.
    //
    // By here the kill is committed, so both act on what the database says. The
    // spoils are paid before anybody is told the beast is down, so the herald
    // never arrives ahead of the purse it announces.
    if ("reveal" in result && result.reveal?.slain) {
      await settleWorldBossSpoils(boss.id);
      await heraldWorldBossDefeat(boss.id);
    }

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
 * Take your share of a felled boss, by hand.
 *
 * The fallback rather than the main path. A kill pays every contender on the
 * spot (see `settleWorldBossSpoils`), so by the time the arena renders a felled
 * beast this button is almost always already spent — it exists for the row a
 * fan-out was interrupted before it reached, and it is deliberately kept because
 * the alternative is a player with an unpaid share and no way to ask for it.
 *
 * ## Any felled boss, not this week's
 *
 * It used to look the boss up by the current week, which quietly made the share
 * expire: at midnight on Saturday the lookup found next week's beast, the row
 * holding the debt was no longer reachable from any screen, and the purse was
 * gone. The lookup is now the *striker* row — this empire's oldest unpaid share
 * of anything that has actually fallen — so a debt survives the week that
 * incurred it, which is the whole point of a receipt.
 */
export async function collectWorldBoss(): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await requireOwnEmpireId();

    // Read outside the transaction, like every other `getTunables` on a write
    // path here. The arena may since have been closed, but a share earned while
    // it was open is still owed — closing the fixture is not a confiscation, so
    // only the multiplier below is read from it.
    const tunables = await getTunables();

    const owed = await prisma.worldBossStrike.findFirst({
      where: {
        empireId,
        claimed: false,
        hits: { gt: 0 },
        boss: { defeatedAt: { not: null } },
      },
      orderBy: { boss: { week: "asc" } },
      select: { bossId: true },
    });
    if (!owed) {
      // Two different nothings, and the arena's own state already distinguishes
      // them — but this action is reachable from a stale tab, so it says which.
      const standing = await prisma.worldBoss.findUnique({
        where: { week: gameWeek(new Date()) },
        select: { defeatedAt: true },
      });
      return {
        error:
          standing && standing.defeatedAt === null
            ? t("המפלצת עדיין עומדת — אין שלל לחלק.")
            : t("כבר אספת את חלקך."),
      };
    }
    const boss = { id: owed.bossId };

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

      // Contenders only, exactly as the arena counts them — a claim must be paid
      // against the same denominator the board showed.
      const [totals, participants] = await Promise.all([
        tx.worldBossStrike.aggregate({
          where: { bossId: boss.id, ...notStaffOrBotEmpire },
          _sum: { damage: true },
        }),
        tx.worldBossStrike.count({
          where: { bossId: boss.id, ...notStaffOrBotEmpire },
        }),
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
        worldBossReward(
          share,
          participants,
          empire.cities,
          tunables.worldBoss.rewardMultiplier
        )
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
