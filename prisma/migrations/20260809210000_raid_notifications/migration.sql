-- "Somebody raided you while you were out."
--
-- The game already tells a defender everything — the battle report, the inbox
-- alert, the toast. All of it requires the player to be looking at the game,
-- which is exactly the state they are not in when it matters. This is the one
-- message that goes to somebody who has closed the tab.
--
-- Opt-*out*, because a notification nobody switched on is a notification nobody
-- gets, and this is the only unprompted mail the game sends.
ALTER TABLE "User" ADD COLUMN "notifyRaids" BOOLEAN NOT NULL DEFAULT true;

-- The cooldown IS this column: the send is a guarded UPDATE with a `lt` on it,
-- so two concurrent raids cannot both slip through the window. That guard is
-- doing real work in two directions — a player being farmed must not receive
-- twenty emails, and the free mail tier is 300 a day for the entire game.
ALTER TABLE "User" ADD COLUMN "notifiedAt" TIMESTAMP(3);
