// Shots of שיאי העולם — the world-records hall at the top of /game/base.
// Shares the session-cookie recipe with scripts/shot-profile.mjs.
//
//   node scripts/shot-glory.mjs /tmp/glory
//
// DEV ONLY, and it WRITES to whatever database .env/.env.local point at: the
// board is interesting only when its five capstones are in *different* states,
// and on a dev database they are usually all open. So it stamps a couple of
// EmpireGloryAward rows — one to the viewer (a crowned niche), one to another
// empire (a taken niche) — and **deletes exactly the rows it created** in a
// finally block, leaving the rest of the board as it found it.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import puppeteer from "puppeteer-core";

for (const f of [".env", ".env.local"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const prisma = new PrismaClient();
const OUT = process.argv[2] ?? "/tmp/glory";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
fs.mkdirSync(OUT, { recursive: true });

const empires = await prisma.empire.findMany({
  where: { user: { is: {} }, isStaff: false },
  select: { id: true, name: true, user: { select: { id: true, tokenVersion: true } } },
  orderBy: { createdAt: "asc" },
  take: 2,
});
const me = empires[0];
const other = empires[1] ?? me;
console.log("viewer:", me.name, "| rival:", other.name);

// One record on the viewer's name, one on somebody else's — the two loudest
// states the hall has to keep apart. The rest stay open or locked.
const DRESS = [
  { empireId: me.id, key: "cities_10" },
  { empireId: other.id, key: "herolvl_100" },
];
const minted = [];

const tokenFor = (u) =>
  new SignJWT({ sub: u.id, ver: u.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

try {
  for (const row of DRESS) {
    const has = await prisma.empireGloryAward.findFirst({ where: row });
    if (has) continue;
    // `prizePaidAt` is stamped up front so the base screen does NOT settle a
    // purse for a fabricated arrival: a world record now pays real diamonds,
    // turns and citizens to whoever holds the plaque (GLORY_PRIZE), and the
    // finally below deletes the row — which would erase the receipt and leave
    // the capstone payable a second time to whoever really gets there.
    await prisma.empireGloryAward.create({ data: { ...row, prizePaidAt: new Date() } });
    minted.push(row);
  }
  if (minted.length) console.log(`stamped ${minted.length} award(s) for the shoot`);

  // `hover` shoots the caption — the one place the sentence version of a
  // capstone still lives, and the only state a static shot would miss.
  for (const vp of [
    { width: 1440, height: 1400 },
    { width: 1440, height: 1400, hover: 2 },
    { width: 1024, height: 1200 },
    { width: 390, height: 900 },
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setCookie", {
      name: "kraldor_session",
      value: await tokenFor(me.user),
      domain: "localhost",
      path: "/",
    });
    // SHOT_LANG=en checks the hall in English, where the engraved nouns are
    // longer than the Hebrew they were laid out for.
    if (process.env.SHOT_LANG) {
      await cdp.send("Network.setCookie", {
        name: "kraldor_lang",
        value: process.env.SHOT_LANG,
        domain: "localhost",
        path: "/",
      });
    }
    await page.goto(`${BASE}/game/base`, { waitUntil: "networkidle2" });
    await page.addStyleTag({
      content:
        "nextjs-portal{display:none!important}[class*='mgt-']{display:none!important}",
    });
    // The mini-game takeover and the live toasts are fixed overlays over the
    // whole page — same removal the other shot scripts do.
    await page.evaluate(() => {
      for (const el of document.body.querySelectorAll("div")) {
        const s = getComputedStyle(el);
        if (s.position === "fixed" && el.getBoundingClientRect().height > 200) {
          el.remove();
        }
      }
    });
    // Let the entrance choreography finish before the shutter.
    await new Promise((r) => setTimeout(r, 1800));
    const board = await page.$(".glory-board");
    if (vp.hover !== undefined) {
      const arch = (await page.$$(".glory-arch"))[vp.hover];
      if (arch) await arch.hover();
      await new Promise((r) => setTimeout(r, 400));
    }
    const name = `glory-${vp.width}${vp.hover !== undefined ? "-hover" : ""}.png`;
    // SHOT_FULL=1 shoots the whole base screen instead — the hall in its place
    // at the top of the page, which is the only way to judge how much of the
    // screen it is spending.
    await (process.env.SHOT_FULL ? page : board ?? page).screenshot({
      path: `${OUT}/${name}`,
      fullPage: Boolean(process.env.SHOT_FULL),
    });
    console.log(`  ✓ ${name}${board ? "" : " (board not found — full page)"}`);
    await page.close();
  }
} finally {
  await browser.close();
  for (const row of minted) {
    await prisma.empireGloryAward.deleteMany({ where: row });
  }
  if (minted.length) console.log("restored: fabricated awards deleted");
  await prisma.$disconnect();
}
