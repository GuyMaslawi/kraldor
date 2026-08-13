/**
 * One-off: end every *new-player* shield already in the ground at one shared
 * moment — the next 21:00 Jerusalem — instead of at each empire's own
 * registration + 48h.
 *
 *   npx tsx scripts/newbie-shield-end.ts                      # dry run, local DB
 *   npx tsx scripts/newbie-shield-end.ts --prod               # dry run, production
 *   npx tsx scripts/newbie-shield-end.ts --prod --confirm     # execute
 *
 * Why a shared moment and not `createdAt + 2h`: `NEWBIE_PROTECTION_MS` dropped
 * from 48h to 2h, but the shield is stored as an absolute `protectedUntil`, so
 * empires registered under the old rule keep their two days. Clamping each one
 * to its own new window would strip most of them the instant this runs, with no
 * warning; a single announced hour treats everyone the same and is something a
 * player can plan around. Shields that would have ended *before* 21:00 are moved
 * to 21:00 too — that is the point of "everyone at once".
 *
 * Only `Empire.protectedUntil` is touched. The paid raid shields are
 * `DiamondEffect` rows (SHIELD_RESOURCES / SHIELD_SOLDIERS) in a different
 * table and are not read or written here — the script reports how many are
 * active purely so the untouched count is visible in the log.
 *
 * Idempotent: a second run finds every shield already at the target and does
 * nothing.
 */
// Its own client, like every other script here: src/lib/prisma imports
// `server-only`, which tsx cannot resolve outside the Next build.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { formatGameDateTime, nextWallTime } from "../src/lib/game/time";

const confirm = process.argv.includes("--confirm");
const prod = process.argv.includes("--prod");

/** The hour every shield is being moved to, Jerusalem wall clock. */
const SHIELD_END = { hour: 21, minute: 0 };

/**
 * Production lives in `.env.local` (Vercel↔Neon owns the DATABASE_URL name),
 * while `.env` points Prisma at localhost. Read it here rather than asking the
 * caller to inline a URL, so the connection string never lands in shell history.
 */
function prodUrl(): string {
  const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env.local");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

const url = prod ? prodUrl() : process.env.PRISMA_DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Which database this is about to edit — host only, never the credentials. */
function dbHost(): string {
  const m = (url ?? "").match(/@([^/?]+)/);
  return m ? m[1]! : "(no url)";
}

function hours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}ש׳`;
}

async function main() {
  const now = new Date();
  const target = nextWallTime(now, SHIELD_END);

  console.log(`Database host : ${dbHost()}${prod ? "  [PRODUCTION]" : ""}`);
  console.log(`Mode          : ${confirm ? "EXECUTE" : "DRY RUN"}`);
  console.log(`עכשיו         : ${formatGameDateTime(now)}`);
  console.log(`סוף המגן      : ${formatGameDateTime(target)} (בעוד ${hours(target.getTime() - now.getTime())})\n`);

  const shielded = await prisma.empire.findMany({
    where: { protectedUntil: { gt: now } },
    select: { id: true, name: true, createdAt: true, protectedUntil: true, isBot: true },
    orderBy: { createdAt: "asc" },
  });

  let shortened = 0;
  let extended = 0;
  for (const e of shielded) {
    const before = e.protectedUntil!;
    if (before.getTime() === target.getTime()) continue;
    before > target ? shortened++ : extended++;
    console.log(
      `  ${e.name}${e.isBot ? " [bot]" : ""}: מגן עד ${formatGameDateTime(before)} → ${formatGameDateTime(target)}` +
        ` (${before > target ? "־" : "+"}${hours(Math.abs(before.getTime() - target.getTime()))})`
    );
  }

  if (confirm && shortened + extended > 0) {
    // One statement, so nobody is left half-moved if the connection drops.
    const { count } = await prisma.empire.updateMany({
      where: { protectedUntil: { gt: now } },
      data: { protectedUntil: target },
    });
    console.log(`\nעודכנו ${count} שורות.`);
  }

  const paid = await prisma.diamondEffect.count({
    where: {
      kind: { in: ["SHIELD_RESOURCES", "SHIELD_SOLDIERS"] },
      activeUntil: { gt: now },
    },
  });

  console.log();
  console.log(`מוגני מתחיל   : ${shielded.length} (${shortened} קוצרו, ${extended} הוארכו)`);
  console.log(`מגני יהלומים  : ${paid} פעילים — לא נגעתי בהם`);
  if (!confirm && shortened + extended > 0) {
    console.log(`\nDRY RUN — לא שונה כלום. הרץ שוב עם --confirm לביצוע.`);
  }
  if (shortened + extended === 0) {
    console.log("אין מה לעדכן — כל המגנים כבר מסתיימים בשעה הזאת.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Shield update failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
