-- The game's hard resource ceiling: 999P (999 x 10^18).
--
-- Mirrored in TypeScript as RESOURCE_MAX in src/lib/game/constants.ts, which
-- carries the full rationale. The two must be changed together.
--
-- Enforced here rather than at the ~30 call sites that credit a balance. Every
-- one of those is an `{ increment }` expression evaluated by Postgres, and
-- several sit inside guarded `updateMany` claims whose whole point is that the
-- read and the write are a single statement (applyPendingUpdates in
-- src/lib/game/updates.ts is the important one). Clamping in application code
-- would mean reading the current balance first, which is exactly the
-- stale-snapshot race those guards exist to close — and any credit site added
-- later would silently opt out of the ceiling.
--
-- The triggers saturate rather than raising, so a payout that lands on the
-- ceiling still commits instead of aborting its whole transaction. That matters:
-- these credits run inside battle, settle and season-close transactions that
-- carry a great deal more than the one balance.
--
-- BEFORE INSERT as well as UPDATE, so a seeded or restored row cannot enter
-- above the ceiling and sit there until something happens to touch it.

CREATE OR REPLACE FUNCTION kraldor_cap_empire_resources() RETURNS trigger AS $$
BEGIN
  NEW.gold     := LEAST(NEW.gold,     999e18);
  NEW.wood     := LEAST(NEW.wood,     999e18);
  NEW.iron     := LEAST(NEW.iron,     999e18);
  NEW.stone    := LEAST(NEW.stone,    999e18);
  NEW.diamonds := LEAST(NEW.diamonds, 999e18);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kraldor_cap_bank_balance() RETURNS trigger AS $$
BEGIN
  NEW."goldBalance" := LEAST(NEW."goldBalance", 999e18);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kraldor_cap_stored_amount() RETURNS trigger AS $$
BEGIN
  NEW."storedAmount" := LEAST(NEW."storedAmount", 999e18);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kraldor_cap_guild_treasury() RETURNS trigger AS $$
BEGIN
  NEW.treasury := LEAST(NEW.treasury, 999e18);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS empire_cap_resources ON "Empire";
CREATE TRIGGER empire_cap_resources
  BEFORE INSERT OR UPDATE ON "Empire"
  FOR EACH ROW EXECUTE FUNCTION kraldor_cap_empire_resources();

DROP TRIGGER IF EXISTS bank_cap_balance ON "BankAccount";
CREATE TRIGGER bank_cap_balance
  BEFORE INSERT OR UPDATE ON "BankAccount"
  FOR EACH ROW EXECUTE FUNCTION kraldor_cap_bank_balance();

DROP TRIGGER IF EXISTS storage_cap_stored_amount ON "ResourceStorage";
CREATE TRIGGER storage_cap_stored_amount
  BEFORE INSERT OR UPDATE ON "ResourceStorage"
  FOR EACH ROW EXECUTE FUNCTION kraldor_cap_stored_amount();

DROP TRIGGER IF EXISTS guild_cap_treasury ON "Guild";
CREATE TRIGGER guild_cap_treasury
  BEFORE INSERT OR UPDATE ON "Guild"
  FOR EACH ROW EXECUTE FUNCTION kraldor_cap_guild_treasury();

-- Pull anything already past the ceiling down to it. No row can be there today,
-- but the migration has to be correct when it is replayed against a database
-- that was written to under the old 1e12 admin bound and a later, higher one.
UPDATE "Empire" SET
  gold     = LEAST(gold,     999e18),
  wood     = LEAST(wood,     999e18),
  iron     = LEAST(iron,     999e18),
  stone    = LEAST(stone,    999e18),
  diamonds = LEAST(diamonds, 999e18)
WHERE gold > 999e18 OR wood > 999e18 OR iron > 999e18
   OR stone > 999e18 OR diamonds > 999e18;

UPDATE "BankAccount" SET "goldBalance" = 999e18 WHERE "goldBalance" > 999e18;
UPDATE "ResourceStorage" SET "storedAmount" = 999e18 WHERE "storedAmount" > 999e18;
UPDATE "Guild" SET treasury = 999e18 WHERE treasury > 999e18;
