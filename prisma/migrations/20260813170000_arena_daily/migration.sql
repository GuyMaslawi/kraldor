-- הזירה — the tournament runs daily, not weekly.
--
-- Nothing about how a card is fought changes: it is still one arena per city
-- tier, still a round-robin resolved by the system when the period turns over,
-- still seeded so the same card resolves the same way twice. Only the period
-- shrinks, from a Jerusalem week to a Jerusalem day, so a player gets a fair
-- fight against their tier every morning instead of once on a Sunday. The
-- purses shrink with it (see ARENA_PODIUM in lib/game/arena.ts) — a podium
-- paying its weekly diamonds seven times a week would be a faucet with as many
-- spouts as the game has tiers.
--
-- The column is renamed rather than added-and-dropped so the existing cards
-- keep their entries, their tables and — critically — their UNCOLLECTED
-- SPOILS. An entry's `place` and `claimed` live on ArenaEntry and are not
-- touched here at all.
ALTER TABLE "Arena" RENAME COLUMN "week" TO "day";

-- Every stored value is still a WEEK index, and a week index read as a day
-- index is a date in 1970 — every old card would sort below every new one but
-- the numbers themselves would be nonsense. Rewrite each to the day index its
-- week opened on: `gameWeek(d) = floor((d + 4) / 7)`, so the Sunday of week w
-- is `7w - 4`. The map is injective, so the (day, tier) uniqueness that the
-- index below re-establishes cannot be violated by the rewrite, and every
-- converted row lands strictly in the past — no old card can collide with a
-- card the game is about to open.
UPDATE "Arena" SET "day" = "day" * 7 - 4;

ALTER INDEX "Arena_week_tier_key" RENAME TO "Arena_day_tier_key";
