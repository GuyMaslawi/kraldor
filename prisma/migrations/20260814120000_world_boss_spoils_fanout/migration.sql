-- The spoils of a felled world boss are paid to every contender at the kill
-- rather than waiting for each of them to press a button. This marks a fan-out
-- that found no more unpaid strikers; the per-striker `claimed` flag is still
-- what makes each payment exactly-once. See settleWorldBossSpoils.
ALTER TABLE "WorldBoss" ADD COLUMN "spoilsSettledAt" TIMESTAMP(3);

-- Every boss that is already down when this lands has been payable by button
-- only, and some of its shares are still unclaimed — including from weeks the
-- arena can no longer render. Leaving `spoilsSettledAt` NULL on them is what
-- makes the first sweep after deploy pay those debts off.
