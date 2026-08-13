-- Flat combat power the hero's equipped gear contributed to a battle.
-- Nullable and un-defaulted: a report written before gear had power must read
-- back as "not recorded", not as a zero the fight never had — the ledger's
-- residual check depends on being able to tell those apart.
ALTER TABLE "BattleReport" ADD COLUMN "attackerHeroPower" DOUBLE PRECISION;
ALTER TABLE "BattleReport" ADD COLUMN "defenderHeroPower" DOUBLE PRECISION;
