-- The admin's word to the whole game, told in a dialog in the middle of the
-- screen rather than a corner toast. It needs its own kind because the dialog
-- has to be able to *find* it: SYSTEM is written by a dozen other paths (gift
-- notes, quest hauls, boss revivals, season notices) and none of them may stop
-- the player mid-screen.
--
-- Adding a value only. Postgres allows that inside a migration's transaction
-- provided the new label is not also *used* there, and nothing here does —
-- the first row carrying it is written by the next broadcast.
ALTER TYPE "MessageKind" ADD VALUE 'ANNOUNCEMENT';
