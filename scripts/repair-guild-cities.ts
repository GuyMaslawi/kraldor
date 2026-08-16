/**
 * One-off repair for guilds whose members are spread over several city tiers.
 *
 * A guild holds exactly one city — see src/server/guildCity.ts for why, and for
 * the two rules the running game now enforces (recruiting is city-local, and a
 * city change re-tests the mover). Neither rule existed before, so the live
 * database holds rosters that span tiers, and nothing re-tests a roster on its
 * own: those guilds stay mixed until somebody happens to move.
 *
 * WHAT IT DOES
 *  The guild's city is its leader's. Every member standing in a different tier
 *  is removed from the roster and told why. The guild itself is left standing —
 *  disbanding guilds that were legal when they were built would be a punishment
 *  for a rule that did not exist yet, and evicting the strays is the smallest
 *  edit that reaches a legal state.
 *
 *  A headless guild is repaired the way `ensureGuildLeader` would repair it —
 *  the most senior member (deputies first) defines the city — so run
 *  `npm run db:guild-leaders` first if you would rather crown them for real.
 *
 * SAFETY
 *  - dry run by default: prints every eviction it would make and exits;
 *  - --confirm is required to touch anything;
 *  - prints the database host it is about to hit — read it before confirming.
 *
 * USAGE
 *   npx tsx scripts/repair-guild-cities.ts             # dry run
 *   npx tsx scripts/repair-guild-cities.ts --confirm   # execute
 *
 * Idempotent: a guild that already stands in one city is skipped.
 */
// Its own client, like every other script here: src/lib/prisma imports
// `server-only`, which tsx cannot resolve outside the Next build.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const confirm = process.argv.includes("--confirm");

function dbHost(): string {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  try {
    return new URL(url).host || "(unknown)";
  } catch {
    return "(unparseable)";
  }
}

async function main() {
  console.log(`Database: ${dbHost()}`);
  console.log(confirm ? "Mode: EXECUTE\n" : "Mode: dry run (pass --confirm to apply)\n");

  const guilds = await prisma.guild.findMany({
    select: {
      id: true,
      name: true,
      members: {
        // Rank order then seniority — the same order ensureGuildLeader crowns
        // in, so a headless guild's city is the one it is about to have.
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          role: true,
          empireId: true,
          empire: { select: { name: true, cities: true } },
        },
      },
    },
  });

  let mixedGuilds = 0;
  let evicted = 0;

  for (const guild of guilds) {
    if (guild.members.length === 0) continue;
    const leader = guild.members.find((m) => m.role === "LEADER") ?? guild.members[0]!;
    const city = leader.empire.cities;
    const strays = guild.members.filter((m) => m.empire.cities !== city);
    if (strays.length === 0) continue;

    mixedGuilds++;
    console.log(
      `"${guild.name}" — city ${city} (leader ${leader.empire.name}); ${strays.length} member(s) elsewhere:`
    );
    for (const stray of strays) {
      console.log(
        `   ${stray.empire.name} (${stray.role}) stands in city ${stray.empire.cities}`
      );
      if (!confirm) continue;

      await prisma.$transaction(async (tx) => {
        await tx.guildMember.delete({ where: { id: stray.id } });
        await tx.message.create({
          data: {
            empireId: stray.empireId,
            kind: "SYSTEM",
            title: "🏰 עזבת את הברית",
            body: `ברית מאחדת שחקנים מאותה העיר בלבד. אתה בעיר ${stray.empire.cities} והברית "${guild.name}" בעיר ${city}, ולכן פרשת ממנה.`,
            href: "/game/guild",
          },
        });
      });
      evicted++;
    }
  }

  if (mixedGuilds === 0) {
    console.log(`Checked ${guilds.length} guild(s) — every one stands in a single city.`);
    return;
  }
  console.log(
    confirm
      ? `\nRemoved ${evicted} member(s) from ${mixedGuilds} guild(s).`
      : `\n${mixedGuilds} guild(s) span more than one city. Re-run with --confirm to apply.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Repair failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
