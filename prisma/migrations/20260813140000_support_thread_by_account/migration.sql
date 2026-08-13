-- A support conversation is now found by the account behind it, not only by the
-- cookie that started it: the same channel is opened from inside the game (the
-- chat dock's pinned "צוות קראלדור" row), where the caller always has a session
-- and may well be on a different device than the one they first wrote from.
--
-- That lookup runs on the dock's badge poll, on every game screen, for every
-- player — including the great majority who have never written in and whose
-- answer is "no row". It has to be an index probe.
CREATE INDEX "SupportThread_userId_lastMessageAt_idx" ON "SupportThread"("userId", "lastMessageAt");
