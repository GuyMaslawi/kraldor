-- הזמנת חבר, second pass: a real invite link, and the machinery that stops it
-- being a diamond faucet for one person with two browsers.
--
-- The first pass (20260809190000_referrals) made the referrer's *empire name*
-- the code and had the newcomer type it in. That works, but it cannot be
-- shared: there is nothing to paste into a WhatsApp message, and a season
-- restart renames the world. This adds an opaque per-account code, the link
-- built from it, and — because a link is precisely what makes farming cheap —
-- the review state that decides whether a referral is allowed to pay.
--
-- See src/lib/game/referral.ts (the deal and the signal catalog) and
-- src/server/referralGuard.ts (what fires, and what each signal costs).

-- The code lives on the USER, not the empire: a season restart deletes every
-- empire, and a link already posted in a Discord channel has to survive that.
-- Backfilled as NULL and minted lazily on first use, so no existing row needs a
-- value invented for it here.
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- One (browser, account) pair the game has seen.
--
-- A long-lived first-party cookie carries an opaque random id; every sign-in
-- and registration records which account used it. Two accounts sharing a row
-- here have been signed into from the same browser profile, which is a sharper
-- signal than a shared IP — an address is a household, a browser profile is one
-- person — and it is the one signal allowed to refuse a referral outright.
CREATE TABLE "DeviceAccount" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAccount_pkey" PRIMARY KEY ("id")
);

-- One row per pair: the sighting is an upsert on this key, so a player who
-- signs in every evening leaves one row rather than one per session.
CREATE UNIQUE INDEX "DeviceAccount_deviceId_userId_key" ON "DeviceAccount"("deviceId", "userId");
-- "Which accounts has this browser been?" — the self-invite check.
CREATE INDEX "DeviceAccount_deviceId_idx" ON "DeviceAccount"("deviceId");
CREATE INDEX "DeviceAccount_userId_idx" ON "DeviceAccount"("userId");

ALTER TABLE "DeviceAccount" ADD CONSTRAINT "DeviceAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Whether a referral may be paid. The column gates the PAYOUT, never the link:
-- a held referral still shows on both screens with its progress, because the
-- common cause of a hold is two real players behind one address.
CREATE TYPE "ReferralReview" AS ENUM ('OK', 'HELD', 'APPROVED', 'REJECTED');

ALTER TABLE "Empire" ADD COLUMN "referredAt" TIMESTAMP(3);
ALTER TABLE "Empire" ADD COLUMN "referralVia" TEXT;
ALTER TABLE "Empire" ADD COLUMN "referralReview" "ReferralReview" NOT NULL DEFAULT 'OK';
-- With an explicit empty-array default, and not merely because it is tidier.
-- `ADD COLUMN … TEXT[]` on a populated table leaves every existing row NULL, and
-- a NULL scalar list is not an empty one: array predicates against it match
-- nothing rather than matching "no flags". Every empire that predates this
-- migration has no flags, so say so.
ALTER TABLE "Empire" ADD COLUMN "referralFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Empire" ADD COLUMN "referralReviewedAt" TIMESTAMP(3);
ALTER TABLE "Empire" ADD COLUMN "referralReviewedBy" TEXT;

-- Referrals that predate this migration were attached under the old rules and
-- have no attach timestamp. Stamp them from the empire's own creation — close
-- enough for the burst window, and it keeps the admin queue sortable — and mark
-- them as typed in, which is the only way they could have been made.
UPDATE "Empire"
   SET "referredAt" = "createdAt", "referralVia" = 'name'
 WHERE "referredById" IS NOT NULL;

-- The admin review queue: the handful of held referrals, newest first.
CREATE INDEX "Empire_referralReview_referredAt_idx" ON "Empire"("referralReview", "referredAt");
