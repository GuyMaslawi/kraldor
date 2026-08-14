-- The city tyrant becomes one shared fixture per city tier.
--
-- Until now `BossSiege` was one row per (empire, tier): every player fought a
-- private copy of the same named boss. Now there is one living row per tier and
-- the whole city chips at it together, the way the server shares the world boss.
--
-- Nothing here can be migrated in place — a standing life belongs to one empire,
-- and its pool is sized for one empire — so the lives go. The *reports* survive:
-- `BossFight.battleId` is ON DELETE SET NULL and `BossBattle` cascades from the
-- siege, so every player's boss history, kill count and honour roll is intact.
-- At worst somebody loses a wounded tyrant that would have revived within the
-- hour anyway.
DELETE FROM "BossSiege";

ALTER TABLE "BossSiege" DROP CONSTRAINT "BossSiege_empireId_fkey";
DROP INDEX "BossSiege_empireId_cityTier_createdAt_idx";
ALTER TABLE "BossSiege" DROP COLUMN "empireId";

-- The serial life number within a tier, and the head count the pool was frozen
-- against. `life` carries no default in the schema: it is always computed from
-- the tier's newest row, and the unique index below is what makes two empires
-- opening a life in the same instant collide instead of both creating one.
ALTER TABLE "BossSiege" ADD COLUMN "life" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BossSiege" ALTER COLUMN "life" DROP DEFAULT;
ALTER TABLE "BossSiege" ADD COLUMN "participants" INTEGER NOT NULL DEFAULT 1;

-- Who closed it, and whether the city has been paid for it.
ALTER TABLE "BossSiege" ADD COLUMN "slayerId" TEXT;
ALTER TABLE "BossSiege" ADD COLUMN "slayerName" TEXT;
ALTER TABLE "BossSiege" ADD COLUMN "spoilsPaidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "BossSiege_cityTier_life_key" ON "BossSiege"("cityTier", "life");
CREATE INDEX "BossSiege_cityTier_life_idx" ON "BossSiege"("cityTier", "life");

-- One empire's running total against one life: the contribution board, and the
-- list the kill purse is shared out over.
CREATE TABLE "BossSiegeStrike" (
    "id" TEXT NOT NULL,
    "siegeId" TEXT NOT NULL,
    "empireId" TEXT NOT NULL,
    "empireName" TEXT NOT NULL,
    "damage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sorties" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BossSiegeStrike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BossSiegeStrike_siegeId_empireId_key" ON "BossSiegeStrike"("siegeId", "empireId");
CREATE INDEX "BossSiegeStrike_siegeId_damage_idx" ON "BossSiegeStrike"("siegeId", "damage");

ALTER TABLE "BossSiegeStrike" ADD CONSTRAINT "BossSiegeStrike_siegeId_fkey" FOREIGN KEY ("siegeId") REFERENCES "BossSiege"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BossSiegeStrike" ADD CONSTRAINT "BossSiegeStrike_empireId_fkey" FOREIGN KEY ("empireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
