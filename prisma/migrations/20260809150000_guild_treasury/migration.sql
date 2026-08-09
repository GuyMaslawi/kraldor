-- אוצר הברית — the guild's own wallet.
--
-- The guild's two ladders (roster capacity and battle aid) were paid out of
-- whichever member happened to want the upgrade. That made every guild
-- improvement one person's charity: the buyer got a bill, everybody else got
-- the benefit, and nobody had a reason to care whether it happened. A guild
-- that cannot spend together is a chat room with a shared badge.
--
-- A treasury turns the same two ladders into a shared project — anyone can put
-- gold in, the leadership decides what it buys, and the board shows who carried
-- the guild. No new bonus system is introduced: the ladders and their effects
-- are exactly the ones that already shipped, only the till has changed.
--
-- Both columns are additive and defaulted, so every existing guild reads back
-- with an empty treasury and every member with nothing donated — which is
-- right, because nothing has been donated yet.

-- A Float, matching Empire.gold: the two are transferred between each other and
-- a type mismatch would round somebody's donation.
ALTER TABLE "Guild" ADD COLUMN "treasury" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Lifetime gold this member has put in. Stored rather than derived from a
-- ledger because what a guild actually argues about is who carried it, and that
-- has to be answerable on the guild screen without a scan. It only ever rises,
-- and it is NOT reduced when the treasury is spent: it records what this member
-- gave, not what is left.
ALTER TABLE "GuildMember" ADD COLUMN "donated" DOUBLE PRECISION NOT NULL DEFAULT 0;
