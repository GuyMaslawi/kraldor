// Shots of אתר הבנייה — the isometric build site on /game/monuments.
// Shares the session-cookie recipe with scripts/shot-titles.mjs.
//
//   node scripts/shot-village.mjs /tmp/village
//
// DEV ONLY, and it WRITES to whatever database .env/.env.local point at: it
// sets one empire's five monuments to a spread of levels so every growth stage
// is on screen at once — 0 (surveyed plot), 3, 6, 9 and 12 (finished, lit) —
// then **puts them back** exactly as it found them, deleting rows it created.
// The restore runs in a finally block, so a crash mid-shoot still leaves the
// database as it was.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import puppeteer from "puppeteer-core";

// Plain `=`, not `??=`: PrismaClient's import is hoisted and has already loaded
// .env, and the two files hold different AUTH_SECRETs.
for (const f of [".env", ".env.local"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const prisma = new PrismaClient();
const OUT = process.argv[2] ?? "/tmp/village";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
fs.mkdirSync(OUT, { recursive: true });

// One of every stage, and deliberately not in catalog order — a row of five
// monuments each one step taller would hide a per-shape height bug. Override to
// check a particular combination, e.g. every crowning piece at once:
//
//   VILLAGE_LEVELS=5,12,12,0,9 node scripts/shot-village.mjs /tmp/village
const KEYS = [
  "workers_column",
  "clock_tower",
  "victory_gate",
  "vault_hall",
  "sky_wheel",
];
const LEVELS = (process.env.VILLAGE_LEVELS ?? "12,7,4,12,0")
  .split(",")
  .map((n) => Math.max(0, Math.min(12, Number(n) || 0)));
const STAGE = Object.fromEntries(KEYS.map((key, i) => [key, LEVELS[i] ?? 0]));

const empire = await prisma.empire.findFirst({
  where: { user: { is: {} } },
  select: {
    id: true,
    monuments: { select: { key: true, level: true } },
    user: { select: { id: true, tokenVersion: true } },
  },
});
if (!empire) throw new Error("no empire with a user in this database");

const before = new Map(empire.monuments.map((m) => [m.key, m.level]));

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

try {
  for (const [key, level] of Object.entries(STAGE)) {
    if (level === 0) {
      await prisma.empireMonument.deleteMany({ where: { empireId: empire.id, key } });
      continue;
    }
    await prisma.empireMonument.upsert({
      where: { empireId_key: { empireId: empire.id, key } },
      create: { empireId: empire.id, key, level },
      update: { level },
    });
  }

  const token = await new SignJWT({
    sub: empire.user.id,
    ver: empire.user.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  for (const [width, tag] of [
    [1440, "desktop"],
    [390, "phone"],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 1200, deviceScaleFactor: 2 });
    // Headless Chrome answers `reduce` by default, which would silence the
    // brazier and the wheel in every frame.
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "no-preference" },
    ]);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setCookie", {
      name: "kraldor_session",
      value: token,
      domain: "localhost",
      path: "/",
    });
    await page.goto(`${BASE}/game/monuments`, { waitUntil: "networkidle2" });
    console.log("landed on", page.url());
    await page.addStyleTag({
      content:
        "nextjs-portal{display:none!important}[class*='mgt-']{display:none!important}",
    });
    await page.evaluate(() => {
      for (const el of document.body.querySelectorAll("div")) {
        const s = getComputedStyle(el);
        if (s.position === "fixed" && el.getBoundingClientRect().height > 200) {
          el.remove();
        }
      }
    });

    // Proof the stylesheet actually shipped: a zero here means the CSS chunk is
    // stale, not that a selector is wrong. See the page-scenes note.
    const rules = await page.evaluate(() => {
      let n = 0;
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.cssText?.includes(".vil-")) n += 1;
          }
        } catch {
          /* cross-origin sheet */
        }
      }
      return n;
    });
    console.log(`${tag}: ${rules} .vil- rules loaded`);

    const stage = await page.$(".vil-stage");
    if (stage) await stage.screenshot({ path: `${OUT}/${tag}-stage.png` });
    await page.screenshot({ path: `${OUT}/${tag}-page.png`, fullPage: true });
    await page.close();
    console.log(`${tag} shot`);
  }
} finally {
  await browser.close();
  for (const key of Object.keys(STAGE)) {
    const level = before.get(key);
    if (level === undefined) {
      await prisma.empireMonument.deleteMany({ where: { empireId: empire.id, key } });
    } else {
      await prisma.empireMonument.upsert({
        where: { empireId_key: { empireId: empire.id, key } },
        create: { empireId: empire.id, key, level },
        update: { level },
      });
    }
  }
  await prisma.$disconnect();
  console.log("monuments restored");
}
