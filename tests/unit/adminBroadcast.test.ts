import { describe, expect, it } from "vitest";
import {
  BROADCAST_DEFAULTS,
  GIFT_DEFAULTS,
  isGameWideScope,
} from "@/lib/adminBroadcast";
import {
  DIAMOND_SALE_ANNOUNCEMENT,
  clampDiscountPct,
  isDiscountRelease,
} from "@/lib/game/diamondStore";
import { makeT } from "@/i18n/translate";
import { renderMessageText } from "@/lib/game/messageText";

describe("isGameWideScope", () => {
  it("treats both everyone-scopes as public", () => {
    expect(isGameWideScope("all")).toBe(true);
    expect(isGameWideScope("active")).toBe(true);
  });

  // The privacy rule the Discord mirror rests on: a targeted send must never
  // be reposted into a room its target may not even be in.
  it("keeps targeted sends private", () => {
    expect(isGameWideScope("season")).toBe(false);
    expect(isGameWideScope("guild")).toBe(false);
    expect(isGameWideScope("empire")).toBe(false);
    expect(isGameWideScope("")).toBe(false);
  });
});

describe("form defaults", () => {
  // They are pre-filled into required fields — an empty default would make the
  // form unsubmittable until the admin noticed why.
  it("are non-empty for every field they fill", () => {
    for (const text of [
      BROADCAST_DEFAULTS.title,
      BROADCAST_DEFAULTS.body,
      GIFT_DEFAULTS.title,
      GIFT_DEFAULTS.body,
    ]) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  // The same string is posted to Discord verbatim, and Discord rejects the
  // whole POST over its ceilings (256 / 4000).
  it("fit inside a Discord embed", () => {
    expect(BROADCAST_DEFAULTS.title.length).toBeLessThanOrEqual(256);
    expect(GIFT_DEFAULTS.title.length).toBeLessThanOrEqual(256);
    expect(BROADCAST_DEFAULTS.body.length).toBeLessThanOrEqual(4000);
    expect(GIFT_DEFAULTS.body.length).toBeLessThanOrEqual(4000);
  });
});

/**
 * The one announcement no admin types: opening a diamond sale from the balance
 * panel announces itself. What is tested here is when it stays quiet — the panel
 * re-submits every tunable on every save, so a predicate that fired on "the
 * discount is 50" instead of "the discount went up to 50" would push a dialog
 * onto every player each time an unrelated number was edited.
 */
describe("a diamond sale announces itself", () => {
  it("announces a sale being opened, or deepened", () => {
    expect(isDiscountRelease(0, 50)).toBe(true);
    expect(isDiscountRelease(25, 50)).toBe(true);
    // Clamped first: a mis-typed 500 is a 100% sale, and it is still news.
    expect(isDiscountRelease(0, 500)).toBe(true);
  });

  it("stays quiet on a save that did not improve the deal", () => {
    // The common case by far — an admin edits battle turns and the store's
    // unchanged discount rides along in the same form submission.
    expect(isDiscountRelease(50, 50)).toBe(false);
    expect(isDiscountRelease(0, 0)).toBe(false);
    // Trimming a sale, ending one, or correcting a typo downward.
    expect(isDiscountRelease(50, 25)).toBe(false);
    expect(isDiscountRelease(50, 0)).toBe(false);
    expect(isDiscountRelease(500, 100)).toBe(false);
    // Nothing meaningful was submitted.
    expect(isDiscountRelease(0, Number.NaN)).toBe(false);
  });

  // The row stores the key and the number; the sentence is assembled when each
  // player opens their inbox. A placeholder that survives into the rendered
  // title is the failure this catches — the announcement is fired by machinery
  // nobody proof-reads before it reaches every player at once.
  it.each(["he", "en"] as const)("renders the sale in %s", (locale) => {
    const { title, body } = renderMessageText(makeT(locale), {
      title: DIAMOND_SALE_ANNOUNCEMENT.title,
      titleParams: { pct: 50 },
      body: DIAMOND_SALE_ANNOUNCEMENT.body,
    });
    expect(title).toContain("50");
    expect(title).not.toContain("{pct}");
    expect(body.trim().length).toBeGreaterThan(0);
    // Both halves are posted to Discord verbatim as well.
    expect(title.length).toBeLessThanOrEqual(256);
    expect(body.length).toBeLessThanOrEqual(4000);
  });

  it("links straight at the packages", () => {
    expect(DIAMOND_SALE_ANNOUNCEMENT.href.startsWith("/game/")).toBe(true);
  });

  it("never treats a nonsense percentage as a price", () => {
    expect(clampDiscountPct(-50)).toBe(0);
    expect(clampDiscountPct(500)).toBe(100);
    expect(clampDiscountPct(Number.NaN)).toBe(0);
    expect(clampDiscountPct(50)).toBe(50);
  });
});
