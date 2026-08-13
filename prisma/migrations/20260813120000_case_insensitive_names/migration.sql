-- Names are unique the way a reader sees them, not the way Postgres stores them.
--
-- `Empire.name` and `Guild.name` already carry a plain unique index, which is
-- exact-byte and therefore case-sensitive: "Kraldor" and "kraldor" were two
-- names to the database and one name to every player looking at a battle report.
-- These two indexes close that half. The other half — invisible characters and
-- doubled spaces, which no index can see past — is normalised out in the app
-- before the insert (see normalizeName in src/lib/game/text.ts).
--
-- Expression indexes cannot be declared in schema.prisma, so these are written
-- by hand. That is safe in both directions: `prisma migrate diff` ignores index
-- forms it cannot represent, so it will not propose dropping them on the next
-- migration (verified against Prisma 6.19 before this was written).
--
-- Hebrew has no case, so `lower()` is a no-op on most names in the game; it is
-- the Latin ones this is for.
CREATE UNIQUE INDEX "Empire_name_lower_key" ON "Empire" (lower("name"));
CREATE UNIQUE INDEX "Guild_name_lower_key" ON "Guild" (lower("name"));
