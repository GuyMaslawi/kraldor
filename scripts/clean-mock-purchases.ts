/**
 * Remove play-money purchases and the diamonds they credited.
 *
 * Test purchases made against the mock provider are real rows with real
 * diamonds — the balance does not know they were free. Left in place they
 * inflate an empire and sit in /admin/purchases looking like sales, which is
 * exactly the confusion that makes a revenue figure untrustworthy later.
 *
 * Matches on `provider: "mock"` AND `isTest: true` together. Both are set from
 * the provider's own flags at purchase time, so this cannot reach a charge that
 * actually moved money — the narrow filter is the whole safety of the script.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/clean-mock-purchases.ts
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/clean-mock-purchases.ts --apply
 *
 * Without `--apply` it only reports. Run it that way first.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

// The Vercel↔Neon integration owns DATABASE_URL in .env.local; `override` makes
// it win over the .env copy, so this always targets the same database the
// deployed app does.
config({ path: ".env.local", override: true });

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const mock = await prisma.diamondPurchase.findMany({
    where: { provider: "mock", isTest: true },
    select: {
      id: true,
      status: true,
      diamonds: true,
      empireId: true,
      priceIls: true,
      createdAt: true,
    },
  });

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — נמצאו ${mock.length} רכישות דמה`);
  for (const p of mock) {
    console.log(
      `  ${p.createdAt.toISOString()}  ${p.status.padEnd(7)}  ${p.diamonds} יהלומים  ₪${p.priceIls}`
    );
  }
  if (mock.length === 0) {
    await prisma.$disconnect();
    return;
  }

  // Only PAID rows ever moved a balance; a FAILED or PENDING one credited
  // nothing and must not be clawed back.
  const perEmpire = new Map<string, number>();
  for (const p of mock) {
    if (p.status !== "PAID" || !p.empireId) continue;
    perEmpire.set(p.empireId, (perEmpire.get(p.empireId) ?? 0) + p.diamonds);
  }

  for (const [empireId, amount] of perEmpire) {
    const empire = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { name: true, diamonds: true },
    });
    if (!empire) continue;
    // Clamped: the diamonds may already have been spent, and a negative balance
    // would be a worse artefact than an under-corrected one.
    const take = Math.min(amount, empire.diamonds);
    console.log(`\n${empire.name}: ${empire.diamonds} − ${take} = ${empire.diamonds - take}`);
    if (APPLY) {
      await prisma.empire.update({
        where: { id: empireId },
        data: { diamonds: { decrement: take } },
      });
    }
  }

  if (APPLY) {
    const del = await prisma.diamondPurchase.deleteMany({
      where: { provider: "mock", isTest: true },
    });
    console.log(`\nנמחקו ${del.count} שורות.`);
  } else {
    console.log(`\n(dry run — הרץ שוב עם --apply כדי לבצע)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
