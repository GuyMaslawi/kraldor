// Screenshot the להט הקרב gauge at each rung, on desktop and phone.
// Follows the session-cookie recipe in scripts/shot-overlays.mjs.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import puppeteer from "puppeteer-core";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient();
const OUT = process.argv[2] ?? "/tmp/fervor";
fs.mkdirSync(OUT, { recursive: true });

const empire = await prisma.empire.findFirst({
  where: { user: { is: {} } },
  select: { id: true, name: true, user: { select: { id: true, tokenVersion: true } } },
  orderBy: { createdAt: "asc" },
});
console.log("empire:", empire.name);

const token = await new SignJWT({ sub: empire.user.id, ver: empire.user.tokenVersion })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

// gameDay(now) — Jerusalem calendar day, matching lib/game/time.ts
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(new Date());
const get = (t) => Number(parts.find((p) => p.type === t).value);
const today = Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86400000);

const CASES = [
  { id: "0-cold", points: 0, at: null, hot: 0 },
  { id: "1-flame", points: 6, at: new Date(), hot: 0 },
  { id: "2-bonfire", points: 14, at: new Date(), hot: 0 },
  { id: "3-blaze", points: 25, at: new Date(), hot: 31 },
  { id: "4-spent", points: 25, at: new Date(), hot: 45 },
];

// Warm-up load: the unread-message toast fires on the first game screen of a
// session and would sit on top of the header row in whichever case ran first.
{
  const page = await browser.newPage();
  const cdp = await page.target().createCDPSession();
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await cdp.send("Network.setCookie", { name: "kraldor_session", value: token, domain: "localhost", path: "/" });
  await page.goto("http://localhost:3000/game/base", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));
  await page.close();
}

for (const c of CASES) {
  await prisma.empire.update({
    where: { id: empire.id },
    data: {
      fervorPoints: c.points,
      fervorAt: c.at,
      fervorDay: today,
      fervorHotAttacks: c.hot,
      // Sign today's muster roll so DailyGift renders null — otherwise its
      // modal (and its blurred backdrop) covers the header row we came for.
      streakDay: today,
    },
  });

  for (const [device, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    const cdp = await page.target().createCDPSession();
    await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
    await cdp.send("Network.setCookie", {
      name: "kraldor_session",
      value: token,
      domain: "localhost",
      path: "/",
    });
    await page.goto("http://localhost:3000/game/base", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: `${OUT}/${c.id}-${device}.png`, clip: { x: 0, y: 0, width, height: device === "phone" ? 320 : 260 } });
    await page.close();
  }
  console.log("shot", c.id);
}

await browser.close();
await prisma.$disconnect();
