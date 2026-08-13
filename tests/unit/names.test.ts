import { describe, expect, it } from "vitest";

import { normalizeName } from "@/lib/game/text";

/**
 * An empire name is the one piece of player text the game promises is unique,
 * and it is rendered on every board, battle report and chat line. Uniqueness is
 * enforced in two places, and this file pins the half that lives in code.
 *
 * The database holds the other half: a unique index on the exact bytes, and a
 * second one on `lower(name)` for the case that `normalizeName` deliberately
 * leaves alone (see the case_insensitive_names migration). What is tested here
 * is everything an index cannot see past — two names that differ only by
 * characters a reader never sees are two rows to Postgres and one name to a
 * player, which is exactly what a name may not be.
 */
describe("normalizeName", () => {
  it("leaves an ordinary name exactly as it was typed", () => {
    expect(normalizeName("קראלדור")).toBe("קראלדור");
    expect(normalizeName("Kraldor")).toBe("Kraldor");
    expect(normalizeName("בית דוד")).toBe("בית דוד");
    expect(normalizeName("  ממלכת הצפון  ")).toBe("ממלכת הצפון");
  });

  it("closes the three ways to sit beside a name that is already taken", () => {
    // A zero-width space: a different row, an identical reader experience.
    expect(normalizeName("קראלדור​")).toBe("קראלדור");
    // A second space, which HTML collapses the moment it is rendered.
    expect(normalizeName("קראל  דור")).toBe("קראל דור");
    // A fullwidth letter — a different code point drawn the same.
    expect(normalizeName("Ｋraldor")).toBe("Kraldor");
  });

  it("takes the direction overrides out with the rest", () => {
    // An unpaired RLO in a name would reverse every board it is printed on.
    expect(normalizeName("‮קראלדור")).toBe("קראלדור");
    expect(normalizeName("a‏b")).toBe("ab");
  });

  it("flattens the whitespace a name has no use for", () => {
    expect(normalizeName("קראל\nדור")).toBe("קראל דור");
    expect(normalizeName("קראל\tדור")).toBe("קראל דור");
    expect(normalizeName("a" + " ".repeat(40) + "b")).toBe("a b");
  });

  it("can only ever shorten — which is why callers measure afterwards", () => {
    // Two characters to a length check, one character to a reader. Validating
    // before normalising would let this clear a two-character minimum.
    expect(normalizeName("​a")).toBe("a");
    expect(normalizeName("​​​")).toBe("");
  });

  it("does not fold case — that collision is the index's job", () => {
    // Deliberate: a player who capitalised their empire keeps the capital, and
    // `lower(name)` in the database is what stops the second one being taken.
    expect(normalizeName("KRALDOR")).toBe("KRALDOR");
    expect(normalizeName("Kraldor")).not.toBe(normalizeName("kraldor"));
  });

  it("keeps an emoji whole", () => {
    // U+200D is the glue inside a compound emoji, so it survives on purpose.
    expect(normalizeName("🏳️‍🌈 הברית")).toBe("🏳️‍🌈 הברית");
    expect(normalizeName("צבא 🙂")).toBe("צבא 🙂");
  });
});
