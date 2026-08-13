import { describe, expect, it } from "vitest";
import { makeT } from "@/i18n/translate";
import { renderMessageText } from "@/lib/game/messageText";

/**
 * The inbox renders in the *reader's* language, from a key plus its values.
 *
 * The thing worth testing here is not the happy path — it is that every way a
 * stored row can be odd degrades to readable text instead of throwing inside a
 * page render, and that rows written before this existed still look exactly as
 * they always did.
 */
describe("the stored-message renderer", () => {
  const he = makeT("he");
  const en = makeT("en");

  it("renders a key and its values in the reader's language", () => {
    const row = {
      title: "⚔️ הותקפת על ידי {attacker} — ההגנה נפרצה",
      titleParams: { attacker: "Varkos" },
      body: "צבאך עמד איתן מול ההתקפה — לא איבדת חיילים או משאבים.",
    };
    expect(renderMessageText(he, row).title).toBe("⚔️ הותקפת על ידי Varkos — ההגנה נפרצה");
    expect(renderMessageText(en, row).title).toBe(
      "⚔️ Varkos attacked you — your defence was breached"
    );
    expect(renderMessageText(en, row).body).toBe(
      "Your army stood firm — you lost no soldiers and no resources."
    );
  });

  it("leaves a row written before the change exactly as it was", () => {
    // The whole reason the migration needed no backfill: an old row holds a
    // finished Hebrew sentence, which matches no key, and t() returns an
    // unmatched key unchanged.
    const legacy = { title: "⚔️ הותקפת על ידי דן — ההגנה נפרצה", body: "נבזזו ממך 500 זהב." };
    expect(renderMessageText(en, legacy)).toEqual(legacy);
  });

  it("translates a param that is itself a key, with its own values", () => {
    const row = {
      title: "💥 חבלה בשטחך!",
      body: '{attacker} ביצע "{mission}" נגדך. בדוק את ההיסטוריה לפרטים.',
      bodyParams: { attacker: "Nox", mission: { key: "שריפת מחסן" } },
    };
    // The mission name resolves inside the sentence rather than arriving
    // pre-rendered in whichever language the attacker happened to be reading.
    expect(renderMessageText(en, row).body).toContain("Nox");
    expect(renderMessageText(en, row).body).not.toContain("{mission}");
  });

  it("composes a sentence from clauses and tidies up after an absent one", () => {
    const row = {
      title: "x",
      body: "{enslavement} {plunder} צבאך לא ספג אבדות. {hero}",
      bodyParams: {
        // No enslavement this time — the clause is simply absent, and the two
        // spaces it leaves behind must not reach the reader.
        enslavement: "",
        plunder: {
          key: "נבזזו ממך {gold} זהב, {wood} עץ, {iron} ברזל ו־{stone} אבן.",
          params: { gold: 10, wood: 20, iron: 30, stone: 40 },
        },
        hero: "",
      },
    };
    const body = renderMessageText(he, row).body;
    expect(body).toBe("נבזזו ממך 10 זהב, 20 עץ, 30 ברזל ו־40 אבן. צבאך לא ספג אבדות.");
    expect(body).not.toMatch(/ {2}/);
  });

  it("treats malformed params as no params rather than throwing", () => {
    // Prisma hands `Json?` back as `unknown`, and a row could hold anything.
    // A page render must not be the place that finds out.
    for (const params of [null, undefined, "nonsense", 42, ["a"], { n: { no: "key" } }]) {
      const out = renderMessageText(he, {
        title: "שלום {n}",
        body: "x",
        titleParams: params,
      });
      expect(out.title).toBe("שלום {n}");
    }
  });
});
