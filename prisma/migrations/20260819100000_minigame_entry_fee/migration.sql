-- מיני-משחק בתשלום — an event may now charge an entry fee.
--
-- Four knobs on the event: which balance pays ("diamonds"/"gold"/"wood"/
-- "iron"/"stone", NULL = free), the one-off fee that unlocks the base attempt
-- budget, the price of one extra attempt past that budget, and how many such
-- extras a single player may buy. Two counters on the entry: whether the fee
-- was paid, and how many extras were bought (the player's real ceiling is
-- maxAttempts + extraAttempts).
--
-- Everything defaults to the free game the table already describes, so every
-- existing event and entry row keeps meaning exactly what it meant.
ALTER TABLE "MiniGameEvent"
  ADD COLUMN "costResource" TEXT,
  ADD COLUMN "costAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "extraAttemptCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "maxExtraAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MiniGameEntry"
  ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "extraAttempts" INTEGER NOT NULL DEFAULT 0;
