import { describe, expect, it } from "vitest";

import { makeT } from "@/i18n/translate";
import {
  formatWaitDuration,
  fromGameLocalInput,
  gameDayStart,
  lastWallTime,
  nextWallTime,
  toGameLocalInput,
  type WallTime,
} from "@/lib/game/time";

/**
 * The wall-clock helpers are load-bearing for the guild war: the bell is stored
 * as an exact instant and looked up with `findUnique({ startsAt })`, so if
 * `nextWallTime` and `lastWallTime` ever disagreed by a single millisecond the
 * war row would be written and then never found again — no rounds, no
 * settlement, and no error anywhere to say so.
 */

const BELL: WallTime = { hour: 19, minute: 30 };

/** Israel moves to DST in late March and back in late October. */
const BEFORE_DST_START = new Date("2026-03-26T12:00:00.000Z");
const AFTER_DST_END = new Date("2026-10-26T12:00:00.000Z");

describe("nextWallTime", () => {
  it("always lands strictly in the future", () => {
    for (const now of [
      new Date("2026-07-30T07:00:00.000Z"),
      new Date("2026-07-30T16:29:59.999Z"),
      new Date("2026-07-30T16:30:00.000Z"),
      new Date("2026-07-30T23:59:59.000Z"),
    ]) {
      expect(nextWallTime(now, BELL).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("lands on a whole minute — no seconds, no milliseconds", () => {
    // Exact equality is what the unique index on `startsAt` relies on.
    const t = nextWallTime(new Date("2026-07-30T07:00:00.000Z"), BELL);
    expect(t.getSeconds()).toBe(0);
    expect(t.getMilliseconds()).toBe(0);
  });

  it("skips to tomorrow once today's bell has rung", () => {
    const before = nextWallTime(new Date("2026-07-30T07:00:00.000Z"), BELL);
    const after = nextWallTime(new Date("2026-07-30T18:00:00.000Z"), BELL);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    expect(after.getTime() - before.getTime()).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(after.getTime() - before.getTime()).toBeLessThanOrEqual(25 * 3_600_000);
  });
});

describe("lastWallTime", () => {
  it("always lands at or before the moment asked about", () => {
    for (const now of [
      new Date("2026-07-30T07:00:00.000Z"),
      new Date("2026-07-30T16:31:00.000Z"),
      new Date("2026-12-31T22:00:00.000Z"),
    ]) {
      expect(lastWallTime(now, BELL).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("is never more than a day behind", () => {
    const now = new Date("2026-07-30T07:00:00.000Z");
    expect(now.getTime() - lastWallTime(now, BELL).getTime()).toBeLessThan(
      25 * 3_600_000
    );
  });
});

describe("the two agree", () => {
  it("round-trips: the bell booked by registration is the bell the war finds", () => {
    for (const now of [
      new Date("2026-07-30T07:00:00.000Z"),
      new Date("2026-01-15T20:00:00.000Z"),
      BEFORE_DST_START,
      AFTER_DST_END,
    ]) {
      const booked = nextWallTime(now, BELL);
      // A minute into the window, the "current" bell must be the booked one.
      expect(lastWallTime(new Date(booked.getTime() + 60_000), BELL).getTime()).toBe(
        booked.getTime()
      );
    }
  });

  it("survives both daylight-saving transitions", () => {
    // The instants shift by an hour of UTC across a transition; what must not
    // change is that the two helpers still name the same instant.
    for (const now of [BEFORE_DST_START, AFTER_DST_END]) {
      const booked = nextWallTime(now, BELL);
      const next = nextWallTime(booked, BELL);
      const gap = next.getTime() - booked.getTime();
      // 23, 24 or 25 hours depending on which side of the change we crossed.
      expect(gap).toBeGreaterThanOrEqual(23 * 3_600_000);
      expect(gap).toBeLessThanOrEqual(25 * 3_600_000);
      expect(lastWallTime(new Date(booked.getTime() + 1), BELL).getTime()).toBe(
        booked.getTime()
      );
    }
  });

  it("handles midnight as a wall time", () => {
    const midnight: WallTime = { hour: 0, minute: 0 };
    const now = new Date("2026-07-30T10:00:00.000Z");
    const next = nextWallTime(now, midnight);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(lastWallTime(new Date(next.getTime() + 1), midnight).getTime()).toBe(
      next.getTime()
    );
  });
});

/**
 * The game runs on one clock, and the machine reading it is on another: UTC on
 * a Vercel function, and whatever the admin's laptop says in a browser. These
 * are the helpers that stand between the two, so what they must prove is that
 * the *host* zone never reaches the answer — which is why every case below
 * asserts an absolute UTC instant rather than a re-formatted local string.
 */
describe("gameDayStart", () => {
  it("opens the day at Israel midnight, not the host's", () => {
    // 01:00 Israel on 30 July is still 22:00 UTC on the 29th. A day cut on the
    // server's own calendar would put this instant in the previous day and open
    // it three hours late — the daily raid board's window.
    expect(gameDayStart(new Date("2026-07-29T22:00:00.000Z")).toISOString()).toBe(
      "2026-07-29T21:00:00.000Z"
    );
  });

  it("follows the offset across DST", () => {
    // Summer is UTC+3, winter UTC+2, so the same wall-clock midnight is a
    // different instant depending on the date.
    expect(gameDayStart(new Date("2026-07-15T12:00:00.000Z")).toISOString()).toBe(
      "2026-07-14T21:00:00.000Z"
    );
    expect(gameDayStart(new Date("2026-12-15T12:00:00.000Z")).toISOString()).toBe(
      "2026-12-14T22:00:00.000Z"
    );
  });

  it("is idempotent and never lands in the future", () => {
    for (const iso of ["2026-03-27T00:30:00.000Z", "2026-10-25T00:30:00.000Z"]) {
      const at = new Date(iso);
      const start = gameDayStart(at);
      expect(start.getTime()).toBeLessThanOrEqual(at.getTime());
      expect(gameDayStart(start).getTime()).toBe(start.getTime());
    }
  });
});

/**
 * The admin's date picker. A `datetime-local` value carries no zone, so these
 * two decide what hour the admin typed — and the bug they exist to prevent is
 * the panel meaning one thing in Tel Aviv and another on a laptop left on UTC.
 */
describe("game-time datetime-local", () => {
  it("reads an instant as its Israel wall time", () => {
    // 21:00 UTC in July is midnight in Israel — the picker must say 00:00 of
    // the *next* day, which is the reading that trips a host-zone conversion.
    expect(toGameLocalInput(new Date("2026-07-14T21:00:00.000Z"))).toBe("2026-07-15T00:00");
    expect(toGameLocalInput(new Date("2026-12-15T10:30:00.000Z"))).toBe("2026-12-15T12:30");
  });

  it("writes a typed wall time back to the instant the admin meant", () => {
    expect(fromGameLocalInput("2026-07-15T00:00")?.toISOString()).toBe(
      "2026-07-14T21:00:00.000Z"
    );
    // Same reading, other side of DST: two hours' offset, not three.
    expect(fromGameLocalInput("2026-12-15T00:00")?.toISOString()).toBe(
      "2026-12-14T22:00:00.000Z"
    );
  });

  it("round-trips every instant, on both sides of both DST switches", () => {
    for (const iso of [
      "2026-01-15T08:00:00.000Z",
      "2026-03-27T09:00:00.000Z",
      "2026-03-27T23:00:00.000Z",
      "2026-07-15T12:34:00.000Z",
      "2026-10-25T00:30:00.000Z",
      "2026-12-31T22:00:00.000Z",
    ]) {
      const at = new Date(iso);
      expect(fromGameLocalInput(toGameLocalInput(at))?.toISOString()).toBe(iso);
    }
  });

  it("rejects what the picker hands over while empty", () => {
    expect(fromGameLocalInput("")).toBeNull();
    expect(fromGameLocalInput("not a date")).toBeNull();
    // The browser appends seconds when the input has a step; the reading is
    // still good, and truncating to the minute is what the field displays.
    expect(fromGameLocalInput("2026-07-15T00:00:30")?.toISOString()).toBe(
      "2026-07-14T21:00:00.000Z"
    );
  });
});

/**
 * The break between two seasons is announced as a wait, in the Discord post
 * every player reads on their way out of a closing season — so the unit it
 * picks and the direction it rounds are both player-facing decisions.
 */
describe("formatWaitDuration", () => {
  // Hebrew is the source language, so its translator returns the source text
  // untouched — these assertions read as the sentence a player is shown.
  const t = makeT("he");
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("says hours for an hours-long wait and days for a days-long one", () => {
    expect(formatWaitDuration(t, 3 * HOUR)).toBe("3 שעות");
    expect(formatWaitDuration(t, 23 * HOUR)).toBe("23 שעות");
    expect(formatWaitDuration(t, DAY)).toBe("יום");
    expect(formatWaitDuration(t, 3 * DAY)).toBe("3 ימים");
  });

  it("uses the Hebrew dual", () => {
    // "2 שעות" is not something anybody says.
    expect(formatWaitDuration(t, 2 * HOUR)).toBe("שעתיים");
    expect(formatWaitDuration(t, 2 * DAY)).toBe("יומיים");
    expect(formatWaitDuration(t, HOUR)).toBe("שעה");
    expect(formatWaitDuration(t, 2 * MINUTE)).toBe("שתי דקות");
  });

  it("rounds down, never up", () => {
    // The wait is a countdown to an opening: rounding up would send a player
    // back after it has already started.
    expect(formatWaitDuration(t, 3 * HOUR + 59 * MINUTE)).toBe("3 שעות");
    expect(formatWaitDuration(t, 2 * DAY - MINUTE)).toBe("יום");
    expect(formatWaitDuration(t, 30 * HOUR)).toBe("יום");
  });

  it("does not run out of words on the edges", () => {
    expect(formatWaitDuration(t, 45 * MINUTE)).toBe("45 דקות");
    expect(formatWaitDuration(t, 30_000)).toBe("רגע");
    expect(formatWaitDuration(t, 0)).toBe("רגע");
    expect(formatWaitDuration(t, -5 * HOUR)).toBe("רגע");
  });
});
