// TEMPORARY — photographs the mini-game overlays on phone viewports via the
// /devoverlay harness (no DB, no session).
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? "/tmp/mg";
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

const CASES = [
  { id: "takeover-safe", type: "CRACK_SAFE", open: false },
  { id: "board-safe", type: "CRACK_SAFE", open: true },
  { id: "board-cups", type: "FIND_BALL", open: true },
  { id: "board-map", type: "TREASURE_MAP", open: true },
  { id: "board-riddle", type: "RIDDLE", open: true },
  { id: "takeover-cups", type: "FIND_BALL", open: false },
];

for (const vp of VIEWPORTS) {
  const label = `${vp.width}x${vp.height}`;
  console.log(`\n── ${label} ──`);
  for (const c of CASES) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:3000/devoverlay?type=${c.type}`, {
      waitUntil: "networkidle2",
    });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle2" });
    await page.addStyleTag({ content: "nextjs-portal,#nextjs-portal{display:none!important}" });
    // The takeover is queued 600ms after mount.
    await new Promise((r) => setTimeout(r, 1600));

    if (c.open) {
      // Dismiss the takeover, then open the board from its pill.
      await page.evaluate(() => document.querySelector(".mgt")?.click());
      await new Promise((r) => setTimeout(r, 700));
      await page.evaluate(() => document.querySelector(".mg-pill")?.click());
      await new Promise((r) => setTimeout(r, 700));
    }

    // Scroll the overlay to its end — the point of a sticky ✕ is that it is
    // still there once the player has read to the bottom.
    await page.evaluate(() => {
      const n = document.querySelector("[role='dialog'], [role='alertdialog']");
      if (n) n.scrollTop = n.scrollHeight;
    });
    await new Promise((r) => setTimeout(r, 300));

    const report = await page.evaluate(() => {
      const vh = window.innerHeight;
      const node = document.querySelector("[role='dialog'], [role='alertdialog']");
      if (!node) return { missing: true };
      const r = node.getBoundingClientRect();
      // Every control that can dismiss this overlay, and whether it is on screen.
      const closers = [...node.querySelectorAll("button")]
        .filter((b) => /✕|סגור|סגירה|אחר כך|קדימה/.test(b.textContent + " " + (b.getAttribute("aria-label") ?? "")))
        .map((b) => {
          const br = b.getBoundingClientRect();
          return {
            text: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 24),
            w: Math.round(br.width),
            h: Math.round(br.height),
            onScreen: br.top >= -1 && br.bottom <= vh + 1 && br.width > 0,
          };
        });
      return {
        box: { top: Math.round(r.top), bottom: Math.round(r.bottom), vh },
        overflows: r.bottom > vh + 1 || r.top < -1,
        scrollTop: node.scrollTop,
        scrollHidden: Math.round(node.scrollHeight - node.clientHeight),
        closers,
      };
    });
    console.log(`${c.id.padEnd(16)} ${JSON.stringify(report)}`);
    await page.screenshot({ path: path.join(OUT, `${c.id}-${label}.png`) });
    await page.close();
  }
}

await browser.close();
console.log("\nshots in", OUT);
