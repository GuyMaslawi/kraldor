// Shots of the empire dossier: the world-records case, the blurb panel and its
// editor, seen by the owner and by a visitor. Shares the session-cookie recipe
// with scripts/shot-vip.mjs.
//
//   node scripts/shot-profile.mjs /tmp/profile
//
// DEV ONLY, and it WRITES to whatever database .env/.env.local point at: it
// sets a bio on the oldest non-staff empire, and — if that empire holds no
// world record — stamps two EmpireGloryAward rows so the case has something to
// draw. Those stamps are fabricated records: they show up on /game/base's
// records board too, so delete them again when you are done shooting.
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
const OUT = process.argv[2] ?? "/tmp/profile";
fs.mkdirSync(OUT, { recursive: true });

const empires = await prisma.empire.findMany({
  where: { user: { is: {} }, isStaff: false },
  select: { id: true, name: true, cities: true, user: { select: { id: true, tokenVersion: true } } },
  orderBy: { createdAt: "asc" },
  take: 20,
});
const me = empires[0];
// Anybody else will do as the visitor — the read-only half of the panel is the
// same whoever is looking, and on a small dev database there may be only one
// non-staff account to be the owner.
const visitor = await prisma.empire.findFirst({
  where: { user: { is: {} }, id: { not: me.id } },
  select: { id: true, name: true, user: { select: { id: true, tokenVersion: true } } },
  orderBy: { createdAt: "asc" },
});
console.log("owner:", me.name, "| visitor:", visitor?.name ?? "(none)");

await prisma.empire.update({
  where: { id: me.id },
  data: {
    bio: "קיסר תדמור, בונה מכרות ולא מתנצל.\n\nלא תוקף מתחת לרמה שלי, לא שולח מרגלים לבני ברית.\nמי שגונב ממני — מקבל את זה בחזרה כפול.",
  },
});
// Give the case something to show if this empire holds no record yet.
const held = await prisma.empireGloryAward.count({ where: { empireId: me.id } });
if (held === 0) {
  await prisma.empireGloryAward.createMany({
    // `prizePaidAt` stamped up front for the same reason shot-glory.mjs does it:
    // a fabricated arrival must not settle a real world-record purse on the
    // holder's next base-screen load (see GLORY_PRIZE).
    data: [
      { empireId: me.id, key: "cities_10", prizePaidAt: new Date() },
      { empireId: me.id, key: "herolvl_100", prizePaidAt: new Date() },
    ],
    skipDuplicates: true,
  });
  console.log("stamped two glory awards for the shot");
}

const tokenFor = (u) =>
  new SignJWT({ sub: u.id, ver: u.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

const CASES = [
  { id: "own", as: me, target: me },
  { id: "own-editing", as: me, target: me, click: "ערוך" },
  ...(visitor ? [{ id: "visitor", as: visitor, target: me }] : []),
];
const VIEWPORTS = [{ width: 1440, height: 1200 }, { width: 390, height: 844 }];

for (const vp of VIEWPORTS) {
  for (const c of CASES) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 2 });
    await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setCookie", {
      name: "kraldor_session",
      value: await tokenFor(c.as.user),
      domain: "localhost",
      path: "/",
    });
    await page.goto(`http://localhost:3000/game/empires/${c.target.id}`, {
      waitUntil: "networkidle2",
    });
    // The dev overlay and the mini-game takeover both cover the whole page.
    await page.addStyleTag({
      content:
        "nextjs-portal{display:none!important}[class*='mgt-']{display:none!important}",
    });
    // The mini-game takeover and the live toasts both cover the page; both are
    // fixed-position overlays, so anything fixed above the page is dropped.
    await page.evaluate(() => {
      for (const el of document.body.querySelectorAll("div")) {
        const s = getComputedStyle(el);
        if (s.position === "fixed" && el.getBoundingClientRect().height > 200) {
          el.remove();
        }
      }
    });
    await new Promise((r) => setTimeout(r, 1200));
    if (c.click) {
      const ok = await page.evaluate((text) => {
        const el = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === text
        );
        if (!el) return false;
        el.click();
        return true;
      }, c.click);
      if (!ok) console.log(`  ! could not click "${c.click}"`);
      await new Promise((r) => setTimeout(r, 500));
    }
    const name = `${c.id}-${vp.width}.png`;
    await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
    console.log(`  ✓ ${name}`);
    await page.close();
  }
}

await browser.close();
await prisma.$disconnect();
