-- הזירה — the weekly tournament.
--
-- The ladder tells a player where they stand; it never tells them whether they
-- would *win*. Raiding is the only answer the game had, and raiding is filtered
-- through turns, shields, timing and who happened to be online — a fair fight
-- between two empires has never actually been available. This is that fight.
--
-- Fought by the system rather than by players, like the guild war: entrants
-- register during the week, and when the week turns over the whole card is
-- resolved at once — every entrant against every other, exactly once. Nobody has
-- to be online, there is no bracket to hold, and the result is reproducible
-- because every duel is decided from a seed derived from the pair.
CREATE TABLE "Arena" (
    "id" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    -- Combat never crosses a city tier anywhere else in the game, and a
    -- tournament that ignored that would be won by the largest empire forever.
    "tier" INTEGER NOT NULL,
    -- The transition, not the clock, is what makes a table final: the guarded
    -- UPDATE that sets this filters on IS NULL, so a card cannot be fought twice.
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arena_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Arena_week_tier_key" ON "Arena"("week", "tier");

CREATE TABLE "ArenaEntry" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "empireId" TEXT NOT NULL,
    -- Military power at RESOLUTION, not at sign-up: an empire that grew during
    -- the week should fight with the army it actually has, and freezing at
    -- registration would reward entering early over playing.
    "power" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    -- 1-based placing; 0 until the card is resolved.
    "place" INTEGER NOT NULL DEFAULT 0,
    -- The flag IS the receipt: a guarded UPDATE with claimed = false.
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArenaEntry_arenaId_empireId_key"
    ON "ArenaEntry"("arenaId", "empireId");
-- The table: "this arena's entrants, best first".
CREATE INDEX "ArenaEntry_arenaId_place_idx" ON "ArenaEntry"("arenaId", "place");

ALTER TABLE "ArenaEntry" ADD CONSTRAINT "ArenaEntry_arenaId_fkey"
    FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArenaEntry" ADD CONSTRAINT "ArenaEntry_empireId_fkey"
    FOREIGN KEY ("empireId") REFERENCES "Empire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
