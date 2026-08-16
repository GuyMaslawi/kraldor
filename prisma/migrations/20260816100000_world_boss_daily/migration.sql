-- מפלצת העולם — the world boss stands for a day, not a week.
--
-- Nothing about how the beast is fought changes: it is still one shared pool
-- the whole server strikes, still opened lazily with no scheduler behind it,
-- still a pure function of the period it belongs to. Only the period shrinks,
-- from a Jerusalem week to a Jerusalem day.
--
-- A week was longer than the game's unit of attention. Felled on Monday, the
-- arena spent five days as a page saying "already dead"; not felled at all, it
-- spent five days saying "still standing" to a server that had stopped trying.
-- Either way the fixture had one moment in it and six days of aftermath.
--
-- The pool, the strike allowance and the purse were divided by the same factor
-- in the same change (see lib/game/worldBoss.ts), so a week of this fixture
-- still costs the same turns and pays the same spoils — it just happens seven
-- times instead of once, and every one of them is a fresh beast to bring down.
--
-- The column is renamed rather than added-and-dropped so the standing rows keep
-- their strikes, their blows and — critically — their UNCOLLECTED SPOILS. A
-- striker's `claimed` flag lives on WorldBossStrike and is not touched here;
-- `sweepWorldBossSpoils` finds an unsettled boss by `defeatedAt`, never by the
-- period, so a debt from before the move is still paid after it.
ALTER TABLE "WorldBoss" RENAME COLUMN "week" TO "day";

-- Every stored value is still a WEEK index, and a week index read as a day
-- index is a date in 1978 — the old rows would sort below every new one, but
-- the numbers themselves would be nonsense. Rewrite each to the day index its
-- week opened on, exactly as the arena's move did: `gameWeek(d) = floor((d +
-- 4) / 7)`, so the Sunday of week w is `7w - 4`. The map is injective, so the
-- uniqueness the index below re-establishes cannot be violated by the rewrite,
-- and every converted row lands strictly in the past — including the week that
-- was live when this ran, whose beast is therefore retired rather than left
-- standing with a week's health pool in a day's fixture.
UPDATE "WorldBoss" SET "day" = "day" * 7 - 4;

ALTER INDEX "WorldBoss_week_key" RENAME TO "WorldBoss_day_key";
