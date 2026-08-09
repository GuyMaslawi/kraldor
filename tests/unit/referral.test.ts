import { describe, expect, it } from "vitest";
import {
  REFERRAL_BURST_LIMIT,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_FLAG_DETAIL,
  REFERRAL_FLAG_LABEL,
  REFERRAL_GOAL_CITIES,
  REFERRAL_HARD_FLAGS,
  REFERRAL_JOINER_PURSE,
  REFERRAL_NAME_MAX_CITIES,
  REFERRAL_REFERRER_PURSE,
  REFERRAL_SEASON_CAP,
  isHardReferralFlag,
  joinerReward,
  mayNameReferrer,
  normalizeMailbox,
  normalizeReferralCode,
  referralEarned,
  referralPath,
  referralPayable,
  referralStanding,
  referrerReward,
  type ReferralFlag,
} from "@/lib/game/referral";
import { MAX_CITIES } from "@/lib/game/constants";
import { STREAK_WEEK_DIAMONDS } from "@/lib/game/streak";

describe("the referral deal", () => {
  it("pays for real play, not for a signup", () => {
    // The whole design. One city is registration; the goal has to be somewhere
    // a bot would not casually arrive.
    expect(REFERRAL_GOAL_CITIES).toBeGreaterThan(2);
    expect(referralEarned(1)).toBe(false);
    expect(referralEarned(REFERRAL_GOAL_CITIES - 1)).toBe(false);
    expect(referralEarned(REFERRAL_GOAL_CITIES)).toBe(true);
    expect(referralEarned(MAX_CITIES)).toBe(true);
  });

  it("treats junk city counts as not earned", () => {
    expect(referralEarned(0)).toBe(false);
    expect(referralEarned(-4)).toBe(false);
  });

  it("closes the naming window before the goal is reached", () => {
    // The window has to shut before the reward is due, or a player could shop
    // their loyalty around after the fact.
    expect(REFERRAL_NAME_MAX_CITIES).toBeLessThan(REFERRAL_GOAL_CITIES);
    expect(mayNameReferrer(1)).toBe(true);
    expect(mayNameReferrer(REFERRAL_NAME_MAX_CITIES)).toBe(true);
    expect(mayNameReferrer(REFERRAL_NAME_MAX_CITIES + 1)).toBe(false);
    expect(mayNameReferrer(MAX_CITIES)).toBe(false);
  });
});

describe("the purses", () => {
  it("pays the referrer more diamonds than the newcomer", () => {
    const diamonds = (purse: readonly { kind: string; amount: number }[]) =>
      purse.find((r) => r.kind === "diamonds")?.amount ?? 0;
    expect(diamonds(REFERRAL_REFERRER_PURSE)).toBeGreaterThan(
      diamonds(REFERRAL_JOINER_PURSE)
    );
  });

  it("gives the newcomer what a young empire actually needs", () => {
    const kinds = REFERRAL_JOINER_PURSE.map((r) => r.kind);
    expect(kinds).toContain("turns");
    expect(kinds).toContain("citizens");
  });

  it("keeps the diamond payout in the same league as the weekly muster", () => {
    // A referral has to be worth chasing without becoming the cheapest route to
    // the store's own goods. Both halves are within a few weeks of the roll.
    const diamonds = (purse: readonly { kind: string; amount: number }[]) =>
      purse.find((r) => r.kind === "diamonds")?.amount ?? 0;
    for (const purse of [REFERRAL_REFERRER_PURSE, REFERRAL_JOINER_PURSE]) {
      expect(diamonds(purse)).toBeGreaterThan(STREAK_WEEK_DIAMONDS);
      expect(diamonds(purse)).toBeLessThan(STREAK_WEEK_DIAMONDS * 5);
    }
  });

  it("leaves diamonds off the city curve on both halves", () => {
    // A late-game referrer must not be paid a fortune in diamonds for the same
    // act a new one is paid 75 for.
    const diamonds = (rewards: ReturnType<typeof referrerReward>) =>
      rewards.find((r) => r.kind === "diamonds")!.amount;
    expect(diamonds(referrerReward(MAX_CITIES))).toBe(
      diamonds(referrerReward(1))
    );
    expect(diamonds(joinerReward(MAX_CITIES))).toBe(diamonds(joinerReward(1)));
  });

  it("scales the resource half with the claimer's own empire", () => {
    const gold = (rewards: ReturnType<typeof referrerReward>) =>
      rewards.find((r) => r.kind === "gold")?.amount ?? 0;
    expect(gold(referrerReward(MAX_CITIES))).toBeGreaterThan(
      gold(referrerReward(1))
    );
  });

  it("pays both halves something at every empire size", () => {
    for (let cities = 1; cities <= MAX_CITIES; cities += 1) {
      for (const rewards of [referrerReward(cities), joinerReward(cities)]) {
        expect(rewards.length).toBeGreaterThan(0);
        for (const line of rewards) expect(line.amount).toBeGreaterThan(0);
      }
    }
  });

  it("caps a season's worth of referrer purses well above any real run", () => {
    // The bound that survives every fraud check failing. It has to be high
    // enough that no honest recruiter ever meets it and low enough that an
    // undetected farm is not a faucet.
    expect(REFERRAL_SEASON_CAP).toBeGreaterThan(REFERRAL_BURST_LIMIT);
    expect(REFERRAL_SEASON_CAP).toBeLessThan(200);
  });
});

/* ------------------------------ the code ------------------------------ */

describe("the invite code", () => {
  it("has no character that can be misread for another", () => {
    // A code is read off a screen and typed into a phone at least as often as
    // it is clicked, so the collidable glyphs must not both exist.
    for (const pair of ["I1", "L1", "O0"]) {
      const present = [...pair].filter((c) => REFERRAL_CODE_ALPHABET.includes(c));
      expect(present.length).toBeLessThan(2);
    }
    expect(REFERRAL_CODE_ALPHABET).not.toContain("U");
    expect(new Set(REFERRAL_CODE_ALPHABET).size).toBe(REFERRAL_CODE_ALPHABET.length);
  });

  it("is long enough that /r/<code> cannot be swept", () => {
    // The number that matters is not "how long to guess one" but "can the
    // player base be enumerated". 50 bits is the floor for that being absurd.
    const bits = REFERRAL_CODE_LENGTH * Math.log2(REFERRAL_CODE_ALPHABET.length);
    expect(bits).toBeGreaterThan(50);
  });

  const CODE = "0123456789AB".slice(0, REFERRAL_CODE_LENGTH);

  it("accepts the code however the player pasted it", () => {
    expect(normalizeReferralCode(CODE)).toBe(CODE);
    expect(normalizeReferralCode(`  ${CODE.toLowerCase()}  `)).toBe(CODE);
    expect(normalizeReferralCode(`https://kraldor.example${referralPath(CODE)}`)).toBe(
      CODE
    );
    // Chat apps append tracking junk and trailing slashes; phones add spaces.
    expect(
      normalizeReferralCode(`https://kraldor.example/r/${CODE}/?utm_source=wa`)
    ).toBe(CODE);
    expect(normalizeReferralCode(`https://kraldor.example/r/${CODE}#top`)).toBe(CODE);
  });

  it("rejects anything that is not exactly a code, so a name falls through", () => {
    // The in-game field takes a code OR an empire name. A near-miss must not
    // resolve as a code, or the name lookup it should have had never happens.
    expect(normalizeReferralCode("ממלכת הברזל")).toBeNull();
    expect(normalizeReferralCode(CODE.slice(0, -1))).toBeNull();
    expect(normalizeReferralCode(`${CODE}X`)).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    // 'I' is not in the alphabet, so a code shaped like one but carrying it is
    // not a code.
    expect(normalizeReferralCode("I".repeat(REFERRAL_CODE_LENGTH))).toBeNull();
  });
});

/* ------------------------------ the checks ------------------------------ */

describe("mailbox normalisation", () => {
  it("collapses the laziest alt there is", () => {
    // me+alt@gmail.com inviting me@gmail.com is one inbox and two rows in a
    // UNIQUE column, which is exactly why the raw values cannot be compared.
    expect(normalizeMailbox("me+alt@gmail.com")).toBe(normalizeMailbox("me@gmail.com"));
    expect(normalizeMailbox("m.e@gmail.com")).toBe(normalizeMailbox("me@gmail.com"));
    expect(normalizeMailbox("M.E+kraldor@GoogleMail.com")).toBe("me@googlemail.com");
  });

  it("keeps dots outside Google, where they are different people", () => {
    expect(normalizeMailbox("a.b@example.com")).not.toBe(
      normalizeMailbox("ab@example.com")
    );
    // The `+tag` convention is near-universal, so it is stripped everywhere.
    expect(normalizeMailbox("a+x@example.com")).toBe(normalizeMailbox("a@example.com"));
  });

  it("never lets two unreadable values match each other", () => {
    // Two nulls matching would flag every pair of malformed rows as one person.
    for (const junk of ["", "nope", "@example.com", "a@", "  "]) {
      expect(normalizeMailbox(junk)).toBeNull();
    }
    expect(normalizeMailbox(null)).toBeNull();
    expect(normalizeMailbox(undefined)).toBeNull();
  });
});

describe("the signal catalog", () => {
  const ALL: ReferralFlag[] = [
    "self",
    "cycle",
    "ineligible",
    "device",
    "mailbox",
    "shared_ip",
    "burst",
    "combat",
  ];

  it("describes every signal it can raise", () => {
    // The admin queue prints these; a missing entry renders `undefined` beside a
    // decision worth diamonds.
    for (const flag of ALL) {
      expect(REFERRAL_FLAG_LABEL[flag]).toBeTruthy();
      expect(REFERRAL_FLAG_DETAIL[flag]).toBeTruthy();
    }
  });

  it("only blocks automatically on signals that mean one person", () => {
    // The line the whole design rests on: a shared address is a household
    // before it is a farm, so it may hold a purse but never refuse a link.
    expect(REFERRAL_HARD_FLAGS).not.toContain("shared_ip");
    expect(REFERRAL_HARD_FLAGS).not.toContain("burst");
    expect(REFERRAL_HARD_FLAGS).not.toContain("combat");
    expect(isHardReferralFlag("self")).toBe(true);
    expect(isHardReferralFlag("device")).toBe(true);
    expect(isHardReferralFlag("mailbox")).toBe(true);
    expect(isHardReferralFlag("cycle")).toBe(true);
    expect(isHardReferralFlag("shared_ip")).toBe(false);
  });
});

describe("the review gate", () => {
  it("pays only what a human has not stopped", () => {
    expect(referralPayable("OK")).toBe(true);
    expect(referralPayable("APPROVED")).toBe(true);
    expect(referralPayable("HELD")).toBe(false);
    expect(referralPayable("REJECTED")).toBe(false);
  });

  it("never tells a player that an admin approved them", () => {
    // The screens know three states, not four: "approved" and "never flagged"
    // must read identically, or the copy leaks that the pair was suspected.
    expect(referralStanding("APPROVED")).toBe(referralStanding("OK"));
    expect(referralStanding("HELD")).toBe("held");
    expect(referralStanding("REJECTED")).toBe("rejected");
  });
});
