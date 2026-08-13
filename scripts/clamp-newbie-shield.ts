/**
 * One-off: shorten the new-player shields that were granted under the old
 * 48-hour window to the current `NEWBIE_PROTECTION_MS` (2 hours).
 *
 *   npx tsx scripts/clamp-newbie-shield.ts             # dry run (default)
 *   npx tsx scripts/clamp-newbie-shield.ts --confirm   # execute
 *
 * The shield is stored as an absolute `protectedUntil`, so lowering the
 * constant only affects empires registered from now on. This clamps the rows
 * already in the ground to `createdAt + NEWBIE_PROTECTION_MS` — the shield the
 * same player would get if they registered today — and clears it outright once
 * that moment has passed.
 *
 * Only ever lowers: a shield already shorter than the new window (an admin
 * hand-out, or a player who broke it by attacking) is left exactly as it is.
 * Idempotent — a second run reports nothing to do.
 */
// Its own client, like every other script here: src/lib/prisma imports
// `server-only`, which tsx cannot resolve outside the Next build.
import { PrismaClient } from "@prisma/client";
import { NEWBIE_PROTECTION_MS } from "../src/lib/game/constants";

const prisma = new PrismaClient();
const confirm = process.argv.includes("--confirm");

/** Which database this is about to edit — same datasource as the schema. */
function dbHost(): string {
  const m = (process.env.PRISMA_DATABASE_URL ?? "").match(/@([^/?]+)/);
  return m ? m[1]! : "(PRISMA_DATABASE_URL not set)";
}

function hours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}ש׳`;
}

async function main() {
  console.log(`Database host : ${dbHost()}`);
  console.log(`Mode          : ${confirm ? "EXECUTE" : "DRY RUN"}`);
  console.log(`New window    : ${hours(NEWBIE_PROTECTION_MS)}\n`);

  const now = new Date();
  const shielded = await prisma.empire.findMany({
    where: { protectedUntil: { gt: now } },
    select: { id: true, name: true, createdAt: true, protectedUntil: true, isBot: true },
    orderBy: { createdAt: "asc" },
  });

  let changed = 0;
  for (const e of shielded) {
    const target = new Date(e.createdAt.getTime() + NEWBIE_PROTECTION_MS);
    if (target >= e.protectedUntil!) continue; // already at or under the new window
    changed++;
    const age = now.getTime() - e.createdAt.getTime();
    const left = e.protectedUntil!.getTime() - now.getTime();
    const leftAfter = Math.max(0, target.getTime() - now.getTime());
    console.log(
      `  ${e.name}${e.isBot ? " [bot]" : ""}: גיל ${hours(age)} · מגן נותר ${hours(left)} → ${
        target <= now ? "נגמר עכשיו" : hours(leftAfter)
      }`
    );
    if (confirm) {
      await prisma.empire.update({
        where: { id: e.id },
        data: { protectedUntil: target <= now ? null : target },
      });
    }
  }

  console.log();
  console.log(`מוגנים כרגע : ${shielded.length}`);
  if (changed === 0) {
    console.log("אין מה לקצר — כל המגנים כבר בתוך החלון החדש.");
    return;
  }
  console.log(
    confirm
      ? `קוצרו ${changed} מגנים.`
      : `${changed} מגנים ארוכים מהחלון החדש. DRY RUN — לא שונה כלום. הרץ שוב עם --confirm לביצוע.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Clamp failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
