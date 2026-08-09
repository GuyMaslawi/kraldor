-- Two more mini-games.
--
-- The roster was cups and the safe: one game with no information at all (lift a
-- cup, hope) and one that is pure deduction (a code, marked digit by digit).
-- Those are the two ends of a spectrum and nothing sat between them, so an
-- admin fielding a release had only "luck" or "puzzle" to choose from.
--
--  * TREASURE_MAP is the middle: every dig comes back with how *close* it was,
--    so a run narrows down rather than being right or wrong, and a player who
--    reasons well does better without the game becoming a code-breaker.
--  * RIDDLE is the one shape the engine could not express at all — a question
--    the admin writes and a player answers in words. It costs no new mechanic
--    and gives the admin a genuinely open tool: lore, trivia, a joke about the
--    current season.
--
-- Additive: an enum value nothing has written yet, so every existing event and
-- entry reads back exactly as before.
ALTER TYPE "MiniGameType" ADD VALUE 'TREASURE_MAP';
ALTER TYPE "MiniGameType" ADD VALUE 'RIDDLE';
