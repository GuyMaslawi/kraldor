// Shots of the mine cards on /game/production. READ ONLY — it never writes.
//
//   node scripts/shot-mines.mjs /tmp/mines
//
// Shares the session-cookie recipe with scripts/shot-village.mjs.
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
const OUT = process.argv[2] ?? "/tmp/mines";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
fs.mkdirSync(OUT, { recursive: true });

// Prefer an empire that actually has bonuses running (more than one city), so
// the folded breakdown shows a full receipt rather than a base line on its own.
const where = { user: { is: {} }, buildings: { some: { slavesAssigned: { gt: 0 } } } };
const empire =
  (await prisma.empire.findFirst({
    where: { ...where, cities: { gt: 1 } },
    orderBy: { cities: "desc" },
    select: { id: true, user: { select: { id: true, tokenVersion: true } } },
  })) ??
  (await prisma.empire.findFirst({
    where,
    select: { id: true, user: { select: { id: true, tokenVersion: true } } },
  }));
if (!empire) throw new Error("no empire with a crewed mine in this database");

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

try {
  const token = await new SignJWT({
    sub: empire.user.id,
    ver: empire.user.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  for (const [width, tag] of [
    [1600, "desktop"],
    [390, "phone"],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 1400, deviceScaleFactor: 2 });
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
    await page.goto(`${BASE}/game/production`, { waitUntil: "networkidle2" });
    console.log("landed on", page.url());

    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    // The daily-gift dialog parks itself over the first load of the day.
    await page.evaluate(() => {
      for (const el of document.body.querySelectorAll("div")) {
        const s = getComputedStyle(el);
        if (s.position === "fixed" && el.getBoundingClientRect().height > 200) {
          el.remove();
        }
      }
    });

    // Both states of the fold, so the shot proves what is hidden and what is not.
    for (const open of [false, true]) {
      await page.evaluate((o) => {
        for (const d of document.querySelectorAll("details")) d.open = o;
      }, open);
      await new Promise((r) => setTimeout(r, 400));
      const grid = await page.$(".grid.gap-4");
      const shot = `${OUT}/${tag}-${open ? "open" : "folded"}.png`;
      await (grid ?? page).screenshot({ path: shot });
      console.log("wrote", shot);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await prisma.$disconnect();
}
