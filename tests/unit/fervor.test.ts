import { describe, expect, it } from "vitest";
import {
  FERVOR_CAP,
  FERVOR_DECAY_MS,
  FERVOR_MAX_HOT_ATTACKS,
  bumpedFervor,
  fervorLabel,
  fervorMultiplier,
  fervorNextTier,
  fervorNow,
  fervorProgress,
  fervorTier,
  hotAttackDecision,
  type FervorState,
} from "@/lib/game/fervor";

/**
 * The meter has no job behind it: two columns and a pure function, exactly like
 * the daily streak. Everything that can go wrong therefore goes wrong *here*,
 * and one thing in particular — `bumpedFervor` carrying the sub-period remainder
 * — is load-bearing enough that the naive version is a live exploit. See the
 * "1:59" block below.
 */

const D = FERVOR_DECAY_MS;

/** A meter lit with `points` at instant `at`. */
const state = (points: number, at: number | null): FervorState => ({ points, at });

describe("fervorNow", () => {
  it("reads a cold meter as zero", () => {
    expect(fervorNow(0, null, 0)).toBe(0);
    expect(fervorNow(12, null, 0)).toBe(0);
    expect(fervorNow(0, 0, 0)).toBe(0);
  });

  it("holds its points until a whole period has passed", () => {
    expect(fervorNow(10, 0, 0)).toBe(10);
    expect(fervorNow(10, 0, D - 1)).toBe(10);
    expect(fervorNow(10, 0, D)).toBe(9);
  });

  it("sheds one point per decay period", () => {
    expect(fervorNow(10, 0, 3 * D)).toBe(7);
    expect(fervorNow(10, 0, 9 * D)).toBe(1);
  });

  it("floors at zero however long the player has been away", () => {
    expect(fervorNow(10, 0, 10 * D)).toBe(0);
    expect(fervorNow(30, 0, 7 * 24 * 60 * 60 * 1000)).toBe(0);
  });

  it("clamps stored points to the cap before decaying them", () => {
    // A row edited by hand — or written by an older build — must not out-earn
    // the ceiling just because the number on disk is bigger than it.
    expect(fervorNow(500, 0, 0)).toBe(FERVOR_CAP);
  });

  it("does not gain points from a timestamp in the future", () => {
    // Clock skew between hosts, or a restored backup. Subtracting a negative
    // period count would *add* points; the guard in fervorNow is what stops it.
    expect(fervorNow(10, 100 * D, 0)).toBe(10);
  });
});

describe("fervorTier", () => {
  it("puts a cold meter on the bottom rung", () => {
    expect(fervorTier(0).key).toBe("spark");
    expect(fervorTier(3).key).toBe("spark");
  });

  it("promotes exactly on the threshold", () => {
    expect(fervorTier(4).key).toBe("flame");
    expect(fervorTier(9).key).toBe("flame");
    expect(fervorTier(10).key).toBe("bonfire");
    expect(fervorTier(19).key).toBe("bonfire");
    expect(fervorTier(20).key).toBe("blaze");
  });

  it("stays on the top rung above it", () => {
    expect(fervorTier(FERVOR_CAP).key).toBe("blaze");
    expect(fervorTier(9999).key).toBe("blaze");
  });
});

describe("fervorMultiplier", () => {
  it("pays nothing on the cold rung", () => {
    // The whole floor of the design: an unlit meter must never *cost* anything
    // relative to the game as it was before this existed.
    expect(fervorMultiplier(0)).toBe(1);
    expect(fervorMultiplier(3)).toBe(1);
  });

  it("climbs with the rungs", () => {
    expect(fervorMultiplier(4)).toBe(1.15);
    expect(fervorMultiplier(10)).toBe(1.3);
    expect(fervorMultiplier(20)).toBe(1.5);
  });

  it("labels multipliers without trailing zeros", () => {
    expect(fervorLabel(0)).toBe("×1");
    expect(fervorLabel(10)).toBe("×1.3");
    expect(fervorLabel(20)).toBe("×1.5");
  });
});

describe("fervorNextTier", () => {
  it("points at the next rung and the distance to it", () => {
    expect(fervorNextTier(0)).toMatchObject({ pointsAway: 4 });
    expect(fervorNextTier(0)?.tier.key).toBe("flame");
    expect(fervorNextTier(16)).toMatchObject({ pointsAway: 4 });
    expect(fervorNextTier(16)?.tier.key).toBe("blaze");
  });

  it("has nothing to promise on the top rung", () => {
    expect(fervorNextTier(20)).toBeNull();
    expect(fervorNextTier(FERVOR_CAP)).toBeNull();
  });
});

describe("fervorProgress", () => {
  it("fills across the rung the player is standing on", () => {
    expect(fervorProgress(0)).toBe(0);
    expect(fervorProgress(2)).toBe(0.5);
    expect(fervorProgress(10)).toBe(0);
    expect(fervorProgress(15)).toBe(0.5);
  });

  it("reads full on the top rung", () => {
    expect(fervorProgress(20)).toBe(1);
    expect(fervorProgress(FERVOR_CAP)).toBe(1);
  });
});

describe("bumpedFervor", () => {
  it("lights a cold meter at the instant of the action", () => {
    expect(bumpedFervor(state(0, null), 5_000)).toEqual({ points: 1, at: 5_000 });
  });

  it("adds a point and leaves the clock alone inside a period", () => {
    // No whole period elapsed, so `at` must not move: the remainder is still
    // owed. Stamping `now` here is precisely the bug the next block covers.
    expect(bumpedFervor(state(5, 0), D - 1)).toEqual({ points: 6, at: 0 });
  });

  it("pays the decay it owes before crediting the action", () => {
    expect(bumpedFervor(state(5, 0), 3 * D)).toEqual({ points: 3, at: 3 * D });
  });

  it("cannot climb past the cap", () => {
    expect(bumpedFervor(state(FERVOR_CAP, 0), 0).points).toBe(FERVOR_CAP);
    expect(bumpedFervor(state(FERVOR_CAP - 1, 0), 0).points).toBe(FERVOR_CAP);
  });

  it("re-lights a meter that had fully decayed", () => {
    expect(bumpedFervor(state(3, 0), 50 * D)).toEqual({ points: 1, at: 50 * D });
  });

  it("ignores a negative amount", () => {
    expect(bumpedFervor(state(5, 0), 0, -10).points).toBe(5);
  });

  /**
   * The exploit this function exists to close.
   *
   * Decay is floored, so the naive implementation — subtract the elapsed
   * periods, then stamp `at = now` — throws the sub-period remainder away on
   * every action. A player acting every 1:59 would pay `floor(0.99) = 0` decay
   * each time, forever, and climb to the cap on a cadence designed to hold him
   * a rung below. Carrying the remainder forward is what makes the two-minute
   * number mean two minutes.
   */
  it("does not let a sub-period cadence dodge decay forever", () => {
    const period = D - 1_000; // act every 1:59
    let meter = state(0, null);
    let now = 0;
    for (let i = 0; i < 200; i += 1) {
      meter = bumpedFervor(meter, now);
      now += period;
    }
    const held = fervorNow(meter.points, meter.at, now);

    // 200 actions at 1:59 apart span ~6.6 hours and owe ~198 points of decay
    // against 200 credited, so the meter must sit near the bottom — not pinned
    // at the ceiling the way the naive version leaves it.
    expect(held).toBeLessThan(10);
    expect(meter.at).toBeLessThanOrEqual(now);
  });

  it("holds a tier for a cadence inside the decay period", () => {
    // The flip side: someone genuinely playing — an action every 30 seconds —
    // must be able to reach and hold the top rung.
    let meter = state(0, null);
    let now = 0;
    for (let i = 0; i < 40; i += 1) {
      meter = bumpedFervor(meter, now);
      now += 30_000;
    }
    expect(fervorNow(meter.points, meter.at, now)).toBeGreaterThanOrEqual(20);
  });

  it("settles to a steady state at exactly one action per period", () => {
    // One action per decay period is break-even by construction: +1 credited,
    // -1 owed. Whatever the meter reaches, it must not run away.
    let meter = state(0, null);
    let now = 0;
    for (let i = 0; i < 500; i += 1) {
      meter = bumpedFervor(meter, now);
      now += D;
    }
    expect(fervorNow(meter.points, meter.at, now)).toBeLessThanOrEqual(2);
  });
});

describe("hotAttackDecision", () => {
  const today = 20_000;

  it("does not boost a cold meter, and does not spend a slot on it", () => {
    expect(hotAttackDecision(today, 3, today, 0)).toEqual({
      hot: false,
      usedToday: 3,
      nextHot: 3,
    });
  });

  it("boosts a lit meter and consumes a slot", () => {
    expect(hotAttackDecision(today, 3, today, 20)).toEqual({
      hot: true,
      usedToday: 3,
      nextHot: 4,
    });
  });

  it("reads a stale day as a fresh allowance", () => {
    // Nothing runs at midnight to reset this — the next attack sees the gap,
    // exactly as the streak columns do.
    expect(hotAttackDecision(today - 1, FERVOR_MAX_HOT_ATTACKS, today, 20)).toEqual({
      hot: true,
      usedToday: 0,
      nextHot: 1,
    });
  });

  it("stops boosting once the day's allowance is spent", () => {
    expect(
      hotAttackDecision(today, FERVOR_MAX_HOT_ATTACKS, today, 20)
    ).toEqual({ hot: false, usedToday: FERVOR_MAX_HOT_ATTACKS, nextHot: FERVOR_MAX_HOT_ATTACKS });
  });

  it("boosts the last allowed attack and not the one after it", () => {
    const last = hotAttackDecision(today, FERVOR_MAX_HOT_ATTACKS - 1, today, 20);
    expect(last.hot).toBe(true);
    expect(last.nextHot).toBe(FERVOR_MAX_HOT_ATTACKS);
    expect(hotAttackDecision(today, last.nextHot, today, 20).hot).toBe(false);
  });

  it("never binds on a player whose turns cannot reach it", () => {
    // Turns upgrade level 1 is 288 turns a day = 28 attacks at ATTACK_TURN_COST.
    // The cap is the ceiling for a whale and a no-op for everyone else; if this
    // ever fails, the floor that protects small accounts is gone.
    expect(FERVOR_MAX_HOT_ATTACKS).toBeGreaterThan(28);
  });
});
