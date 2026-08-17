-- Ad attribution — four labels saying which campaign an account arrived on.
--
-- The ad platform can already tell us what a signup cost. What it cannot tell us
-- is which of those signups was still playing a week later, because that fact
-- only exists in this database. These four columns are the join between the two
-- halves, and without them a campaign's real question — cost per *retained*
-- player, not cost per click — has no answer at all.
--
-- Nullable with no default and no backfill: every account that already exists
-- arrived before any of this was measured, and NULL is the honest record of
-- that. It is also exactly what organic traffic will keep writing, so the
-- report treats "no campaign" as a real bucket rather than as missing data.
--
-- Nothing here identifies a person. The values are campaign labels we choose
-- ourselves and that hundreds of visitors share ("meta", "paid",
-- "season-12-launch"); the per-click ids the ad networks append to a URL are
-- deliberately never persisted. See src/lib/attribution.ts.
ALTER TABLE "User" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "User" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "User" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "User" ADD COLUMN "utmContent" TEXT;

-- The acquisition report reads one date window at a time and buckets what it
-- finds. `createdAt` leads because it is the selective half: a campaign burns
-- for four days inside a table that accumulates for seasons, so the window
-- alone cuts the scan down to the rows the report is about.
CREATE INDEX "User_createdAt_utmSource_idx" ON "User"("createdAt", "utmSource");
