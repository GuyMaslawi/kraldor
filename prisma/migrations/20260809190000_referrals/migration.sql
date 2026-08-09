-- הזמנת חבר — the one growth loop the game can run without a budget.
--
-- Everything else built around the daily board keeps the players who are already
-- here. This is the only feature that brings new ones, and it matters most in
-- exactly the period the game is in now: before the payment gateway opens, a
-- player recruited by a friend costs nothing and is worth as much as one bought
-- with advertising.
--
-- The referral is claimed *in game* rather than named on the sign-up form, and
-- it pays only once the newcomer reaches their third city. That is what makes it
-- a growth loop rather than a farm: a sign-up field rewards creating accounts;
-- this rewards a player who is still there days later. See
-- src/lib/game/referral.ts.

-- A self-relation rather than a join table: at most one row per empire, set once
-- and never changed, and "who did I bring in" is exactly the reverse of it.
-- ON DELETE SET NULL, so a season restart that removes the referrer leaves the
-- newcomer's row intact rather than cascading them away.
ALTER TABLE "Empire" ADD COLUMN "referredById" TEXT;

-- The two receipts. Each claim is a guarded UPDATE with its own column IS NULL
-- in the WHERE, so two simultaneous clicks can never both pay out and no
-- separate table of claims is needed.
--
-- Both live on the NEWCOMER's row, because a referral is a fact about the
-- newcomer: one referrer may have many, and hanging the referrer's receipt off
-- their own row would need a counter saying which invitee it was for.
ALTER TABLE "Empire" ADD COLUMN "referralPaidAt" TIMESTAMP(3);
ALTER TABLE "Empire" ADD COLUMN "referrerPaidAt" TIMESTAMP(3);

-- "Who did I bring in" — the referrals page's only read.
CREATE INDEX "Empire_referredById_idx" ON "Empire"("referredById");

ALTER TABLE "Empire" ADD CONSTRAINT "Empire_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "Empire"("id") ON DELETE SET NULL ON UPDATE CASCADE;
