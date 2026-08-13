-- The inbox spoke one language, permanently.
--
-- Every game-written Message stored its *rendered* sentence: "⚔️ הותקפת על ידי
-- X — ההגנה נפרצה". That is written by whoever triggered it — usually the
-- attacker — while the only person who ever reads it is the recipient, so
-- translating at write time would have frozen the row in a language chosen by
-- the reader's enemy. The producers therefore left it in Hebrew, and an English
-- player's whole inbox stayed Hebrew: attack reports, guild invitations, prize
-- mail, the welcome letter.
--
-- The fix is to store the dictionary *key* plus the values that fill it, and
-- render through t() when the inbox is opened — in the reader's language, at
-- read time, every time.
--
-- Backwards compatible by construction, which is why it is two nullable columns
-- and not a rewrite: rows written before this hold a finished Hebrew sentence
-- that matches no dictionary key, and t() returns an unmatched key unchanged.
-- Every existing message therefore renders exactly as it does today.
ALTER TABLE "Message" ADD COLUMN "titleParams" JSONB;
ALTER TABLE "Message" ADD COLUMN "bodyParams" JSONB;
