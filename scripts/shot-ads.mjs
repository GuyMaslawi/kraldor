// The paid-social creatives — three concepts × three aspect ratios.
//
//   node scripts/shot-ads.mjs
//
// Renders brand/src/ad.html nine times and writes brand/ads/. Touches no
// database, no dev server and no network: the page is a local file and the font
// is base64 inside heebo.css, so a shot taken on a plane is byte-identical to
// one taken at a desk.
//
// Naming is not decoration — `kraldor-ad-<concept>-<ratio>.png` is the same
// `<concept>` that goes in the ad's `utm_content`, which is what makes
// /admin/acquisition able to say which of these three pictures actually
// produced players. Rename a file here and that link is quietly cut.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "brand/src/ad.html");
const OUT = path.join(ROOT, "brand/ads");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Where each ratio goes, so the README can be generated from one table. */
const RATIOS = [
  { key: "1x1", w: 1080, h: 1080, use: "פיד פייסבוק/אינסטגרם, כרטיסייה ריבועית" },
  { key: "4x5", w: 1080, h: 1350, use: "פיד אינסטגרם — התופס הכי הרבה מסך בנייד" },
  { key: "9x16", w: 1080, h: 1920, use: "סטוריז, ריאלס, TikTok" },
];

const CONCEPTS = ["reset", "nostalgia", "alliance"];

fs.mkdirSync(OUT, { recursive: true });

for (const concept of CONCEPTS) {
  for (const r of RATIOS) {
    const file = path.join(OUT, `kraldor-ad-${concept}-${r.key}.png`);
    execFileSync(
      CHROME,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        // The stage is authored at 1080 wide. Any other DPR doubles the export.
        "--force-device-scale-factor=1",
        `--window-size=${r.w},${r.h}`,
        `--screenshot=${file}`,
        // Generous: the font is inlined but the SVG skyline is built in script,
        // and a shot taken before it runs is a blank gradient.
        "--virtual-time-budget=5000",
        `file://${SRC}?c=${concept}&r=${r.key}`,
      ],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
    const { size } = fs.statSync(file);
    // A creative that came out under ~40KB is a blank gradient — the script
    // failed and the screenshot caught the empty stage. Better to fail here
    // than to find out in Ads Manager.
    if (size < 40_000) {
      throw new Error(`${path.basename(file)} is only ${size}B — the stage never rendered`);
    }
    console.log(`${path.basename(file)}  ${r.w}×${r.h}  ${(size / 1024).toFixed(0)}KB`);
  }
}

console.log(`\n${CONCEPTS.length * RATIOS.length} creatives → ${OUT}`);
