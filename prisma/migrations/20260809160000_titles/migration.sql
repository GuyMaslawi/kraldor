-- תארים — the line under a player's name.
--
-- Everything the game sold for diamonds was a convenience: VIP buys bulk
-- buttons, the season pass buys a reward track, and both are careful to grant no
-- power. That is the right instinct, and it left an obvious gap — the only
-- completely safe thing to sell is something that changes nothing at all, and
-- the game had none of it.
--
-- A title is that. It shows on the dossier and beside the name in the ladders,
-- it multiplies nothing, and it is the cheapest way for a player to be
-- recognisable to the people they already compete with.

-- The title currently worn: a key from TITLES in src/lib/game/titles.ts, or NULL
-- for a player wearing none. A key that has fallen out of the catalog resolves
-- to null on read, so retiring a title needs no migration and leaves no raw key
-- printed on anybody's dossier.
ALTER TABLE "Empire" ADD COLUMN "title" TEXT;

-- A BOUGHT title's receipt.
--
-- Earned titles deliberately have no row here: their condition is re-derived on
-- every read from the same lifetime-counters snapshot the achievements ladder
-- uses, so adding one needs no backfill and retiring one leaves nothing behind.
-- Only a purchase is recorded, because only a purchase is a fact about money
-- rather than a fact about play.
--
-- Buying is permanent and separate from wearing: an empire owns every title it
-- has paid for and wears at most one, so changing your mind is free.
CREATE TABLE "EmpireTitle" (
    "id" TEXT NOT NULL,
    "empireId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    -- Frozen at purchase, so retuning a price does not rewrite the ledger.
    "paid" INTEGER NOT NULL DEFAULT 0,
    "boughtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmpireTitle_pkey" PRIMARY KEY ("id")
);

-- The receipt IS the guard: the purchase inserts unconditionally and lets this
-- constraint drop a double-click, so nobody is charged twice for one title. It
-- also serves "which titles does this empire own", the only read.
CREATE UNIQUE INDEX "EmpireTitle_empireId_key_key" ON "EmpireTitle"("empireId", "key");

ALTER TABLE "EmpireTitle" ADD CONSTRAINT "EmpireTitle_empireId_fkey"
    FOREIGN KEY ("empireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
