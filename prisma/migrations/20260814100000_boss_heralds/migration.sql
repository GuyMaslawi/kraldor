-- The tyrant's return, told to its owner.
ALTER TABLE "BossSiege" ADD COLUMN "revivedNotifiedAt" TIMESTAMP(3);

-- The two game-wide heralds a world boss is worth, each claimed once.
ALTER TABLE "WorldBoss" ADD COLUMN "spawnAnnouncedAt" TIMESTAMP(3);
ALTER TABLE "WorldBoss" ADD COLUMN "defeatAnnouncedAt" TIMESTAMP(3);

-- A line the game itself wrote in the public room: `body` is a dictionary key
-- and `bodyParams` fills it, resolved in the reader's language.
ALTER TABLE "ChatMessage" ADD COLUMN "system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatMessage" ADD COLUMN "bodyParams" JSONB;
