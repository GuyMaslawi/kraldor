-- מפלצת העולם — the blow ledger behind the live feed.
--
-- WorldBossStrike is an aggregate: one row per empire per boss, carrying a
-- running damage total and a hit count. That is the right shape for the damage
-- board, and it is the wrong shape for the only question a *shared* fixture has
-- to answer on arrival — is anybody else in here right now. A total looks
-- identical whether it was earned a minute ago or on Monday.
--
-- So every blow now also writes a row here, and the arena reads the last dozen
-- of them newest-first. The two are not redundant: the aggregate is the
-- standings and this is the story.
--
-- `empireName` and `title` are denormalised for the same reason
-- WorldBoss."slayerName" is: the feed is read on a poll, and a name that
-- disappeared at a season wipe is better rendered as it was than as a dangling
-- join. `hpAfter` is stored rather than derived so a row can be read on its own
-- ("...and left it at 4.2M") without replaying the week.
--
-- Nothing is pruned. One week of one boss is at most WORLD_BOSS_MAX_STRIKES
-- rows per empire, and the boss row is deleted at the season wipe, which takes
-- its blows with it through the cascade.

CREATE TABLE "WorldBossBlow" (
  "id"         TEXT             NOT NULL,
  "bossId"     TEXT             NOT NULL,
  "empireId"   TEXT             NOT NULL,
  "empireName" TEXT             NOT NULL,
  "title"      TEXT,
  "damage"     DOUBLE PRECISION NOT NULL,
  "hpAfter"    DOUBLE PRECISION NOT NULL,
  "slaying"    BOOLEAN          NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorldBossBlow_pkey" PRIMARY KEY ("id")
);

-- The feed's only query: this boss's blows, newest first.
CREATE INDEX "WorldBossBlow_bossId_createdAt_idx"
  ON "WorldBossBlow" ("bossId", "createdAt");

ALTER TABLE "WorldBossBlow"
  ADD CONSTRAINT "WorldBossBlow_bossId_fkey"
  FOREIGN KEY ("bossId") REFERENCES "WorldBoss" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorldBossBlow"
  ADD CONSTRAINT "WorldBossBlow_empireId_fkey"
  FOREIGN KEY ("empireId") REFERENCES "Empire" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
