-- מפלצת העולם — one enemy the whole server fights at once.
--
-- Every other fight in the game is between two players or between a player and
-- their own city's boss. Both are zero-sum or private: nobody has ever had a
-- reason to care what a stranger in another city did today. This is the one
-- fixture where the whole server is on the same side, where a small empire's
-- contribution is visible next to a large one's, and where the question is
-- "will we get it down in time" rather than "can I beat him".
--
-- It is a FIXTURE, not an event. Exactly one row per Jerusalem week, created
-- lazily the first time anybody opens the arena that week. There is no admin
-- button and no scheduler: which boss appears is a pure function of the week, so
-- every player computes the same answer with no writer, and the unique index
-- drops whichever concurrent first-load loses.
CREATE TABLE "WorldBoss" (
    "id" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    -- Frozen at spawn from the empire count, never recomputed: a boss that grew
    -- because somebody registered on Thursday would punish the server for
    -- growing.
    "maxHp" DOUBLE PRECISION NOT NULL,
    -- Driven to zero by guarded decrements. The strike that takes it to 0 is the
    -- one that stamps "defeatedAt", so the kill is a transition rather than a
    -- comparison and exactly one striker can win it.
    "hp" DOUBLE PRECISION NOT NULL,
    "defeatedAt" TIMESTAMP(3),
    -- Not a foreign key: the empire may be deleted at a season restart while
    -- this row is still being read, and a dangling name is a better outcome
    -- than a cascade that erases who killed it.
    "slayerId" TEXT,
    "slayerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldBoss_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorldBoss_week_key" ON "WorldBoss"("week");

-- One empire's running total against one boss.
--
-- A real counter rather than a derived figure, for the reason the guild contract
-- is one: the alternative is summing a row per blow across the whole server on
-- every page load. Both counters only ever rise.
CREATE TABLE "WorldBossStrike" (
    "id" TEXT NOT NULL,
    "bossId" TEXT NOT NULL,
    "empireId" TEXT NOT NULL,
    "damage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Capped at WORLD_BOSS_MAX_STRIKES, which is what stops the damage board
    -- from being a copy of the power ladder with extra steps.
    "hits" INTEGER NOT NULL DEFAULT 0,
    -- The flag IS the receipt: the claim is a guarded UPDATE with
    -- `claimed = false` in its WHERE, so two simultaneous clicks cannot both pay.
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldBossStrike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorldBossStrike_bossId_empireId_key"
    ON "WorldBossStrike"("bossId", "empireId");
-- The damage board: "this boss's strikers, hardest first".
CREATE INDEX "WorldBossStrike_bossId_damage_idx"
    ON "WorldBossStrike"("bossId", "damage");

ALTER TABLE "WorldBossStrike" ADD CONSTRAINT "WorldBossStrike_bossId_fkey"
    FOREIGN KEY ("bossId") REFERENCES "WorldBoss"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorldBossStrike" ADD CONSTRAINT "WorldBossStrike_empireId_fkey"
    FOREIGN KEY ("empireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
