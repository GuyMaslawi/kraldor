-- מונומנטים — what a finished empire builds.
--
-- The endgame had a gold problem of the shape every accumulation game finds:
-- mines compound, plunder compounds, the bank compounds, and by the last third
-- of a season a serious empire earns far more than anything on the board costs.
-- Weapons cap, upgrades cap, and the item ladder — the one deliberately
-- geometric sink in the game — tops out at 700B for a single piece and stops.
--
-- A monument is a sink that pays a *percentage*, which is the only kind that
-- stays worth building: the reward compounds with the income that bought it,
-- while the price is geometric at a steeper rate than the payout, so the ladder
-- never runs away in either direction.
--
-- Two properties of this table are deliberate:
--
--  * A monument nobody has built has NO ROW. The read side defaults a missing
--    key to level 0, so nothing has to be seeded per empire and retiring a
--    monument leaves no orphan to clean up.
--  * "key" is a plain string, not an enum — adding or retiring a monument is a
--    code change rather than a migration, and an unknown key is ignored on read.
--
-- Note the rule stated at length in src/lib/game/monuments.ts: no monument may
-- touch combat power. The battle report itemises every term of that
-- calculation, so a new combat modifier needs a snapshot column and a ledger
-- row or the report starts lying about why somebody lost. Monuments buy income.
CREATE TABLE "EmpireMonument" (
    "id" TEXT NOT NULL,
    "empireId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmpireMonument_pkey" PRIMARY KEY ("id")
);

-- Also serves "this empire's monuments", which is the only read this table gets
-- and which runs on every settle of the game clock.
CREATE UNIQUE INDEX "EmpireMonument_empireId_key_key"
    ON "EmpireMonument"("empireId", "key");

ALTER TABLE "EmpireMonument" ADD CONSTRAINT "EmpireMonument_empireId_fkey"
    FOREIGN KEY ("empireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
