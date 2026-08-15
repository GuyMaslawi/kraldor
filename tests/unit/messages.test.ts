import { describe, expect, it } from "vitest";

import { MESSAGE_BODY_MAX, normalizeMailBody } from "@/lib/game/messages";

/**
 * A letter used to be `trim()` and nothing else, which was survivable while it
 * only ever rendered in its own card in the mailbox. It is not survivable now
 * that the same text is also a line in the shared transcript with the recipient
 * (see `deliverPlayerMail`), where the layout tricks the chat has always
 * defended against work exactly as well.
 *
 * The interesting half of these cases is what mail keeps that chat does not: a
 * letter is allowed paragraphs, and collapsing it to a single line the way
 * `normalizeChatBody` does would rewrite what somebody wrote.
 */
describe("normalizeMailBody", () => {
  it("keeps ordinary text intact", () => {
    expect(normalizeMailBody("  שלום לך  ")).toBe("שלום לך");
    expect(normalizeMailBody("want to ally?")).toBe("want to ally?");
  });

  it("keeps a paragraph break, which is the whole difference from a chat line", () => {
    expect(normalizeMailBody("שורה\n\nפסקה")).toBe("שורה\n\nפסקה");
    expect(normalizeMailBody("a\nb")).toBe("a\nb");
    expect(normalizeMailBody("a\r\nb")).toBe("a\nb");
  });

  it("collapses the runs that scroll a transcript clean", () => {
    // Forty blank rows push everyone else's conversation off the screen; a
    // letter falls back to one blank line rather than to none.
    expect(normalizeMailBody("a\n\n\n\n\n\nb")).toBe("a\n\nb");
    expect(normalizeMailBody("a\n \n\t\n \nb")).toBe("a\n\nb");
    expect(normalizeMailBody("a" + " ".repeat(40) + "b")).toBe("a  b");
  });

  it("strips invisible and direction-flipping characters", () => {
    // A body of nothing but zero-width joiners passed every length check.
    expect(normalizeMailBody("​​​")).toBe("");
    expect(normalizeMailBody("a​b")).toBe("ab");
    // An unpaired RLO would reverse everything rendered after it.
    expect(normalizeMailBody("‮משהו")).toBe("משהו");
  });

  it("leaves compound emoji whole", () => {
    expect(normalizeMailBody("נתראה בקרב 👨‍👩‍👧 🏳️‍🌈 👍🏽")).toBe(
      "נתראה בקרב 👨‍👩‍👧 🏳️‍🌈 👍🏽"
    );
  });

  it("never returns more than the stored length", () => {
    expect(normalizeMailBody("x".repeat(MESSAGE_BODY_MAX + 50))).toHaveLength(
      MESSAGE_BODY_MAX
    );
  });

  it("is measured in characters, so a wall of emoji is not over-long twice", () => {
    // Counted in UTF-16 units this is 2× the cap; counted the way a player
    // counts it, it is exactly the cap and must survive whole.
    const body = "🙂".repeat(MESSAGE_BODY_MAX);
    expect([...normalizeMailBody(body)]).toHaveLength(MESSAGE_BODY_MAX);
  });
});
