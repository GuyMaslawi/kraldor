import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderRich } from "@/components/ui/RichText";

/**
 * The three markers a translated sentence may carry.
 *
 * Worth testing on its own because the manual leans on it several hundred
 * times, and every failure mode here is *silent*: a mis-parsed marker does not
 * throw, it prints `**` or `<0>` into the middle of a paragraph.
 */
const parts = (text: string, slots?: unknown[]) =>
  renderRich(text, "strong-class", "link-class", slots as never);

const type = (node: unknown) =>
  isValidElement(node) ? (node as ReactElement).type : typeof node;

describe("rich text", () => {
  it("leaves a plain sentence as one string", () => {
    expect(parts("שום סימון כאן")).toEqual(["שום סימון כאן"]);
  });

  it("turns **…** into an element and keeps the text around it", () => {
    const out = parts("לפני **מודגש** אחרי");
    expect(out[0]).toBe("לפני ");
    expect(type(out[1])).toBe("strong");
    expect(out[2]).toBe(" אחרי");
  });

  it("turns [label](href) into a link", () => {
    const out = parts("ראה את [תנאי השימוש](/terms).");
    const link = out[1] as ReactElement<{ href: string; children: string }>;
    expect(link.props.href).toBe("/terms");
    expect(link.props.children).toBe("תנאי השימוש");
  });

  it("fills a <0> slot from the array, in the sentence's own order", () => {
    // The point of a slot: English may put the number where Hebrew did not, and
    // the marker travels inside the key so the translator decides.
    const out = parts("עד <1> ומ־<0>", ["FIRST", "SECOND"]);
    const rendered = out
      .map((node) =>
        isValidElement(node)
          ? (node as ReactElement<{ children: unknown }>).props.children
          : node
      )
      // `split` leaves an empty string wherever a marker ends the sentence;
      // React renders nothing for it.
      .filter((node) => node !== "");
    expect(rendered).toEqual(["עד ", "SECOND", " ומ־", "FIRST"]);
  });

  it("renders nothing for a slot with no entry", () => {
    // A sentence that lost its number reads as a wording bug; a visible `<0>`
    // reads as a broken page.
    const out = parts("עד <3>", ["only one"]);
    const last = out[1] as ReactElement<{ children: unknown }>;
    expect(last.props.children).toBeUndefined();
    expect(out.join("")).not.toContain("<3>");
  });

  it("does not treat a lone asterisk or an angle bracket as a marker", () => {
    expect(parts("2 * 3 < 7")).toEqual(["2 * 3 < 7"]);
  });
});
