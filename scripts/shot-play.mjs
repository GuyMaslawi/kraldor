// Shots of /play — the landing page a paid click arrives on.
//
//   node scripts/shot-play.mjs /tmp/play
//
// READ ONLY: the route needs no session and writes nothing.
//
// It follows shot-gate.mjs exactly (same HOLD-then-freeze trick, same reason —
// read the long note there before changing anything here), with two additions
// this page needs and the gate does not:
//
//   - **An overflow assertion.** This page is the first thing a stranger sees
//     and most of them see it in an in-app browser on a phone, where a document
//     one pixel wider than the viewport becomes a page that slides sideways
//     under the thumb. It is also the failure a screenshot cannot show you: an
//     RTL page scrolls from the right, so the overflow hides off the *left*
//     edge and the picture looks fine. So the width is measured, not eyeballed.
//   - **A full-page shot**, because unlike the login form this screen is a
//     scroll and the fold is not the whole story.
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? "/tmp/play";
const BASE = process.env.BASE ?? "http://localhost:3000";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Pause every animation from the very first frame — see shot-gate.mjs. */
const HOLD = `*, *::before, *::after { animation-play-state: paused !important }`;

/**
 * Pin every animation to `t` seconds — except the scroll-driven ones, which
 * cannot be.
 *
 * `.lnd-card` and `.lnd-faq` ride `animation-timeline: view()`, and a
 * progress-based animation throws on an absolute `currentTime`: its timeline is
 * the scroll position, not the clock. Left alone they would photograph at
 * whatever progress the current scroll gives them, which for a full-page shot is
 * "everything below the fold is at 0% and therefore invisible" — a picture that
 * would show an empty landing page and be believed.
 *
 * So they are sent to their end state instead. That is also the honest frame:
 * it is what the reader sees at the moment the card is actually in front of
 * them, which is the only moment that matters.
 */
const freeze = (page, t) =>
  page.evaluate((seconds) => {
    for (const a of document.getAnimations()) {
      a.pause();
      try {
        a.currentTime = seconds * 1000;
      } catch {
        a.finish();
      }
    }
  }, t);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});

const shots = [
  { name: "play-desktop", w: 1440, h: 900 },
  { name: "play-tablet", w: 820, h: 1180 },
  { name: "play-phone", w: 390, h: 844 },
  // The narrowest phone still in circulation. If anything overflows, it
  // overflows here first.
  { name: "play-phone-narrow", w: 320, h: 720 },
];

const overflows = [];

for (const s of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "no-preference" },
  ]);
  await page.evaluateOnNewDocument((css) => {
    const inject = () => {
      const style = document.createElement("style");
      style.id = "shot-hold";
      style.textContent = css;
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.documentElement) inject();
    else {
      new MutationObserver((_, obs) => {
        if (document.documentElement) {
          inject();
          obs.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    }
  }, HOLD);

  await page.goto(`${BASE}/play`, { waitUntil: "networkidle0" });

  const held = await page.evaluate(() => ({
    hold: !!document.getElementById("shot-hold"),
    animations: document.getAnimations().length,
  }));
  if (!held.hold) throw new Error("the hold style never landed — every frame below would be a lie");

  // The measurement. `scrollWidth` on the documentElement is the honest width
  // of the laid-out page; anything past the viewport is a sideways scroll.
  // One pixel of slack for sub-pixel rounding, and no more.
  const width = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    view: document.documentElement.clientWidth,
    // The widest offenders, named, so a failure says what to go and fix rather
    // than only that something is wrong.
    culprits: [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().width > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join(".")}`),
  }));
  if (width.doc > width.view + 1) {
    overflows.push(`${s.name}: ${width.doc}px in a ${width.view}px viewport — ${width.culprits.join(", ") || "no single wide element; suspect a min-width in a flex/grid child"}`);
  }

  // 3s: entrances finished, every loop mid-cycle. Ascending only — see the note
  // in shot-gate.mjs about Chrome dropping finished non-filling animations.
  await freeze(page, 3);
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  await page.screenshot({ path: `${OUT}/${s.name}-full.png`, fullPage: true });
  console.log(s.name, `${width.doc}/${width.view}px`, held.animations, "animations");
  await page.close();
}

// The contract everybody forgets: the same screen with motion refused. On this
// page it is load-bearing rather than polite — a section that fades in and never
// arrives is a blank landing page and a wasted click.
const still = await browser.newPage();
await still.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await still.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await still.goto(`${BASE}/play`, { waitUntil: "networkidle0" });
await still.screenshot({ path: `${OUT}/play-phone-reduced-full.png`, fullPage: true });
await still.close();

await browser.close();

if (overflows.length > 0) {
  console.error("\nHORIZONTAL OVERFLOW:\n  " + overflows.join("\n  "));
  process.exit(1);
}
console.log("wrote", fs.readdirSync(OUT).join(", "), "to", OUT);
