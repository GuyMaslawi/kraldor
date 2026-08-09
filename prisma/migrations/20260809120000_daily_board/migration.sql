-- לוח היום — the daily loop: the muster roll, the mission boards, the guild
-- contract.
--
-- The game had no mechanical reason to be opened on a day you did not feel like
-- playing: turns accrue whether you are there or not, mines settle lazily, and
-- the season pass repeats twice a day. Everything below exists to make a *visit*
-- worth something.
--
-- Every column here is additive and defaulted, so an empire that existed before
-- this migration reads back as one that has never signed a roll — which is
-- exactly right, and is why no backfill is needed.

-- The muster roll, in two integers on the empire itself.
--
-- "streakDay" is the Jerusalem calendar day (days since the epoch) the roll was
-- last signed on, and it doubles as the claim receipt: signing is a guarded
-- UPDATE that pins this column to the value it read, so two simultaneous clicks
-- cannot both pay out and no table of claims is needed. 0 is 1970-01-01, so a
-- fresh empire is always a gap.
--
-- Nothing ever clears these on a schedule. A missed day is noticed by the *next*
-- claim, which is what keeps the whole feature free of a background job.
ALTER TABLE "Empire" ADD COLUMN "streakDay" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Empire" ADD COLUMN "streakCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Empire" ADD COLUMN "streakBest" INTEGER NOT NULL DEFAULT 0;

-- Daily boards and weekly boards are the same shape, so they are the same table.
CREATE TYPE "MissionScope" AS ENUM ('DAY', 'WEEK');

-- One player's board for one period.
--
-- Note what is NOT here: a progress counter. A mission's progress is
-- `now − baseline`, where "baseline" is the same lifetime-counters snapshot the
-- achievements ladder is evaluated against, frozen when the board opened. That
-- is what lets the whole feature exist without instrumenting a single gameplay
-- action — no second write inside the battle transaction, and nothing that can
-- be double-counted.
--
-- "missions" is rolled deterministically from (empireId, scope, period), so two
-- requests racing to open the same board compute the identical row and the
-- unique index below can drop the loser harmlessly.
CREATE TABLE "MissionBoard" (
    "id" TEXT NOT NULL,
    "empireId" TEXT NOT NULL,
    "scope" "MissionScope" NOT NULL,
    "period" INTEGER NOT NULL,
    "missions" TEXT[],
    "claimed" TEXT[],
    "baseline" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionBoard_pkey" PRIMARY KEY ("id")
);

-- Also serves the board lookup — the only read this table ever gets.
CREATE UNIQUE INDEX "MissionBoard_empireId_scope_period_key"
    ON "MissionBoard"("empireId", "scope", "period");

ALTER TABLE "MissionBoard" ADD CONSTRAINT "MissionBoard_empireId_fkey"
    FOREIGN KEY ("empireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The guild's shared daily goal.
--
-- This one IS a counter, and it has to be: the baseline trick above works
-- because one empire's snapshot is a single indexed query, and running that per
-- member on every page load would be a dozen of the app's heaviest reads to draw
-- one progress bar. Instead members contribute by claiming their own daily
-- missions — a path that is already transactional, already guarded and already
-- once-per-mission, so the increment inherits all three properties.
--
-- "goal" is frozen from the member count when the contract opens: a contract
-- that got harder because somebody joined at 23:00 would be a punishment for
-- recruiting. "completedAt" is stamped by the same statement that pushes
-- progress over the line, so completion is a transition rather than a
-- comparison. "paid" is the per-member receipt.
CREATE TABLE "GuildContract" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "goal" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "paid" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildContract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildContract_guildId_day_key"
    ON "GuildContract"("guildId", "day");

ALTER TABLE "GuildContract" ADD CONSTRAINT "GuildContract_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
