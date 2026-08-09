// Shots of the תואר wherever it is drawn: the title shelves, a dossier, the
// city ladder, the global leaderboards. Shares the session-cookie recipe with
// scripts/shot-profile.mjs and scripts/shot-vip.mjs.
//
//   node scripts/shot-titles.mjs /tmp/titles
//
// DEV ONLY, and it WRITES to whatever database .env/.env.local point at: it
// dresses the first few non-staff empires in titles so the ladders have
// something to draw, then **puts every one of them back** to whatever it was
// wearing before — including null. The restore runs in a finally block, so a
// crash mid-shoot still leaves the database as it found it.
//
// It deliberately covers one of each kind: an earned title that breathes
// (`emperor`), a plain earned one, and a bought one — the three treatments the
// styling has to keep apart at a glance.
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
const OUT = process.argv[2] ?? "/tmp/titles";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
fs.mkdirSync(OUT, { recursive: true });

// One breathing earned title, one flat earned one, one bought — in that order,
// so the top of the ladder is the interesting row.
const DRESS = ["emperor", "warlord", "raider", "rich", "shadow", "gambler"];

const empires = await prisma.empire.findMany({
  where: { user: { is: {} }, isStaff: false },
  select: {
    id: true,
    name: true,
    title: true,
    cities: true,
    user: { select: { id: true, tokenVersion: true } },
  },
  orderBy: { militaryPower: "desc" },
  take: DRESS.length,
});
if (empires.length === 0) throw new Error("no non-staff empires in this database");

const me = empires[0];
const before = new Map(empires.map((e) => [e.id, e.title]));

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

try {
  for (const [i, empire] of empires.entries()) {
    await prisma.empire.update({
      where: { id: empire.id },
      data: { title: DRESS[i] },
    });
  }
  // A bought title needs its receipt or the wear guard would have refused it —
  // and `buildTitlesState` reads the same row to decide the shop shows "owned".
  for (const [i, empire] of empires.entries()) {
    if (!["rich", "gambler"].includes(DRESS[i])) continue;
    await prisma.empireTitle.upsert({
      where: { empireId_key: { empireId: empire.id, key: DRESS[i] } },
      create: { empireId: empire.id, key: DRESS[i] },
      update: {},
    });
  }

  // Claim name and cookie name both matter and neither is guessable: `ver`, not
  // `tv`, and `kraldor_session`. Same recipe as scripts/shot-profile.mjs.
  const token = await new SignJWT({ sub: me.user.id, ver: me.user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const shots = [
    ["titles", "/game/titles"],
    ["dossier", `/game/empires/${me.id}`],
    ["rankings", "/game/rankings"],
    ["leaderboards", "/game/leaderboards"],
    ["guild", "/game/guild"],
  ];

  for (const [width, tag] of [
    [1440, "desktop"],
    [390, "phone"],
  ]) {
    for (const [name, path] of shots) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 1200, deviceScaleFactor: 2 });
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      // Through CDP, not page.setCookie: the plain API drops the cookie on a
      // redirect to a page that has not been visited yet.
      const cdp = await page.createCDPSession();
      await cdp.send("Network.enable");
      await cdp.send("Network.setCookie", {
        name: "kraldor_session",
        value: token,
        domain: "localhost",
        path: "/",
      });
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
      // The dev overlay, the mini-game takeover and the chat dock all sit above
      // the page; every one of them is fixed-position.
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
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: true });
      await page.close();
      console.log(`${tag}-${name}.png`);
    }
  }
} finally {
  await browser.close();
  for (const [id, title] of before) {
    await prisma.empire.update({ where: { id }, data: { title } });
  }
  await prisma.$disconnect();
  console.log("titles restored");
}
