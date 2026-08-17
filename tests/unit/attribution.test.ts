import { describe, expect, it } from "vitest";
import {
  attributionColumns,
  parseAttribution,
  readAttributionParams,
  serializeAttribution,
} from "@/lib/attribution";

const q = (s: string) => new URLSearchParams(s);

describe("readAttributionParams", () => {
  it("returns null for the ordinary request, which carries no ad tags", () => {
    // The common case by an enormous margin — and the one that must not cost a
    // cookie write. See the note in src/proxy.ts.
    expect(readAttributionParams(q(""))).toBeNull();
    expect(readAttributionParams(q("page=2&sort=power"))).toBeNull();
  });

  it("reads the four labels off a properly tagged ad link", () => {
    expect(
      readAttributionParams(
        q("utm_source=meta&utm_medium=paid&utm_campaign=s12-launch&utm_content=nostalgia-1x1")
      )
    ).toEqual({
      source: "meta",
      medium: "paid",
      campaign: "s12-launch",
      content: "nostalgia-1x1",
    });
  });

  it("takes a partial tagging rather than discarding it", () => {
    // An organic post tagged only with a source is still worth attributing.
    expect(readAttributionParams(q("utm_source=discord"))).toEqual({
      source: "discord",
      medium: null,
      campaign: null,
      content: null,
    });
  });

  it("falls back to a click id when the utm tags were lost on the way", () => {
    expect(readAttributionParams(q("fbclid=IwAR0abcdef"))).toEqual({
      source: "facebook",
      medium: "paid",
      campaign: null,
      content: null,
    });
    expect(readAttributionParams(q("ttclid=E.C.P.xyz"))?.source).toBe("tiktok");
    expect(readAttributionParams(q("gclid=Cj0KCQ"))?.source).toBe("google");
  });

  it("never stores the click id itself, only the network it implies", () => {
    // The click id is the one part of an ad URL that identifies a person rather
    // than a campaign. Nothing in the returned object may carry it.
    const attr = readAttributionParams(q("fbclid=IwAR0-personally-identifying"));
    expect(JSON.stringify(attr)).not.toContain("IwAR0");
  });

  it("prefers explicit tags over the click id sitting beside them", () => {
    const attr = readAttributionParams(
      q("utm_source=meta&utm_campaign=retarget&fbclid=IwAR0abc")
    );
    expect(attr).toEqual({
      source: "meta",
      medium: null,
      campaign: "retarget",
      content: null,
    });
  });
});

describe("value hygiene", () => {
  it("lower-cases, so one campaign is one row in the report", () => {
    expect(readAttributionParams(q("utm_source=Meta&utm_campaign=Launch"))).toEqual({
      source: "meta",
      medium: null,
      campaign: "launch",
      content: null,
    });
  });

  it("strips anything outside the campaign-label alphabet", () => {
    // These arrive from the query string, which anybody can write, and end up
    // rendered in an admin table.
    expect(readAttributionParams(q("utm_source=%3Cscript%3Ealert(1)%3C/script%3E"))).toEqual({
      source: "scriptalert1script",
      medium: null,
      campaign: null,
      content: null,
    });
  });

  it("drops a value that is nothing but punctuation rather than storing an empty label", () => {
    expect(readAttributionParams(q("utm_source=%20%20%21%21"))).toBeNull();
  });

  it("clamps a long value instead of handing it to the database", () => {
    const attr = readAttributionParams(q(`utm_campaign=${"a".repeat(500)}`));
    expect(attr?.campaign).toHaveLength(60);
  });
});

describe("the cookie round trip", () => {
  it("survives serialize → parse unchanged", () => {
    const attr = {
      source: "meta",
      medium: "paid",
      campaign: "s12-launch",
      content: "nostalgia-1x1",
    };
    expect(parseAttribution(serializeAttribution(attr))).toEqual(attr);
  });

  it("keeps the nulls null rather than turning them into empty strings", () => {
    const attr = { source: "discord", medium: null, campaign: null, content: null };
    expect(parseAttribution(serializeAttribution(attr))).toEqual(attr);
  });

  it("returns null for a missing, empty or meaningless cookie", () => {
    expect(parseAttribution(undefined)).toBeNull();
    expect(parseAttribution("")).toBeNull();
    expect(parseAttribution("s=&m=&c=&n=")).toBeNull();
  });

  it("re-sanitises on the way out, because the cookie is client-writable", () => {
    // A player can hand-edit this. The value that reaches a Prisma insert has to
    // be cleaned where it is *read*, not only where we happened to write it.
    const parsed = parseAttribution(`s=${encodeURIComponent("<b>meta</b>")}`);
    expect(parsed?.source).toBe("bmetab");
  });

  it("does not throw on a cookie full of rubbish", () => {
    expect(() => parseAttribution("%%%&&&===")).not.toThrow();
    expect(() => parseAttribution("x".repeat(10_000))).not.toThrow();
  });
});

describe("attributionColumns", () => {
  it("writes four explicit nulls for organic traffic", () => {
    // Spread unconditionally into user.create — an untagged signup must take
    // the same code path as a tagged one.
    expect(attributionColumns(null)).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
    });
  });

  it("maps the four labels onto the four columns", () => {
    expect(
      attributionColumns({
        source: "meta",
        medium: "paid",
        campaign: "s12",
        content: "a",
      })
    ).toEqual({
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "s12",
      utmContent: "a",
    });
  });
});
