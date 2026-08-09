-- חבלה — what a spy does when you stop asking him to look.
--
-- Espionage was read-only. A mission came back with a dossier, and the dossier
-- was an input to an *attack* — so a player who invested in spies was really
-- investing in somebody else's raid, and the spy branch had no way to hurt
-- anybody on its own. This is that way.
--
-- The rule the whole feature is built around, stated at length in
-- src/lib/game/sabotage.ts: **a sabotage mission never touches soldiers,
-- weapons or power.** The battle report itemises every term of the power
-- calculation, and the game's PvP contract is that an army is lost in battles
-- that are reported. A spy who could quietly delete an army would make the
-- ladder unreadable and the reports a lie. So these missions take stores, gold
-- and mine slaves — the economy, which regrows, and which the defender can see
-- was taken.
CREATE TYPE "SabotageKind" AS ENUM ('BURN_STORES', 'STEAL_PLANS', 'SPIKE_WELLS');

-- Kept apart from "SpyReport" rather than folded into it with a kind column.
-- The two are read by different screens and carry different facts: a spy report
-- is a dossier, frozen and re-readable; this is a receipt for damage done.
-- Sharing a table would have meant every column of each being nullable for the
-- other, on a model the reports page reads on every visit.
CREATE TABLE "SabotageReport" (
    "id" TEXT NOT NULL,
    "attackerEmpireId" TEXT NOT NULL,
    "defenderEmpireId" TEXT NOT NULL,
    "kind" "SabotageKind" NOT NULL,
    "success" BOOLEAN NOT NULL,
    -- A sabotage mission needs a clear intelligence margin rather than a bare
    -- win; storing both figures is what lets the report say why it failed.
    "attackerIntel" DOUBLE PRECISION NOT NULL,
    "defenderIntel" DOUBLE PRECISION NOT NULL,
    "turnsSpent" INTEGER NOT NULL,
    "spiesSpent" INTEGER NOT NULL,
    "spiesLost" INTEGER NOT NULL DEFAULT 0,
    -- What the mission took, by kind. Only the columns its own mission uses are
    -- ever non-zero, which is why these are plain defaulted numbers rather than
    -- a JSON blob: the reports list sums them without parsing anything.
    "goldTaken" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "woodBurned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ironBurned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stoneBurned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slavesKilled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SabotageReport_pkey" PRIMARY KEY ("id")
);

-- The two reads this table gets: "my missions" and "what was done to me".
CREATE INDEX "SabotageReport_attackerEmpireId_createdAt_idx"
    ON "SabotageReport"("attackerEmpireId", "createdAt");
CREATE INDEX "SabotageReport_defenderEmpireId_createdAt_idx"
    ON "SabotageReport"("defenderEmpireId", "createdAt");

ALTER TABLE "SabotageReport" ADD CONSTRAINT "SabotageReport_attackerEmpireId_fkey"
    FOREIGN KEY ("attackerEmpireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SabotageReport" ADD CONSTRAINT "SabotageReport_defenderEmpireId_fkey"
    FOREIGN KEY ("defenderEmpireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
