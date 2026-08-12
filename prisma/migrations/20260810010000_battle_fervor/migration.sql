-- להט הקרב — the presence boost.
--
-- Four columns on Empire, no new table and no job. The rationale for the whole
-- mechanic lives in src/lib/game/fervor.ts; what matters at this layer is only
-- why it is shaped as four scalars:
--
-- The meter decays over time, and the obvious implementation of "decays" is a
-- sweep that walks every empire and subtracts. That is exactly what the daily
-- streak (streakDay/streakCount above) refuses to do, for the same reason:
-- nothing may run while a player is away. So the decay is *derived* at read
-- time from `fervorPoints` and `fervorAt` by a pure function, and a player who
-- is gone for a week costs the game nothing while he is gone.
--
-- `fervorAt` is not "when the player last acted". It is the instant
-- `fervorPoints` was last exactly true, and it advances only in whole decay
-- periods so the sub-period remainder carries forward — see `bumpedFervor`.
--
-- All four are defaulted and nullable-where-appropriate, so every existing row
-- backfills to a cold meter with no data migration: `fervorAt IS NULL` reads as
-- "never lit", and `fervorDay = 0` (1970-01-01) can never collide with a live
-- game day, which is the same trick `streakDay` uses.

ALTER TABLE "Empire"
  ADD COLUMN "fervorPoints"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fervorAt"         TIMESTAMP(3),
  ADD COLUMN "fervorDay"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fervorHotAttacks" INTEGER NOT NULL DEFAULT 0;

-- What the meter was worth when a raid resolved, as a percent on top of the
-- haul. Nullable and unbackfilled on purpose: every battle fought before today
-- was fought without a meter, and null reads as "the meter did not change this
-- report" rather than as a zero that would have to be explained on screen.
ALTER TABLE "BattleReport"
  ADD COLUMN "attackerFervorPct" DOUBLE PRECISION;
