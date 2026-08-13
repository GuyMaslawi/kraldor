/**
 * Wipe the game world, keeping one admin account.
 *
 * Intended for a pre-launch reset: every player, empire, guild, season, report
 * and message goes, so the game restarts from an empty world with the operator's
 * own login still working.
 *
 * WHY THE LIST BELOW IS LONGER THAN "USERS AND EMPIRES"
 *  Deleting the users takes everything that hangs off one, by cascade. But a
 *  handful of tables hang off nothing that is being deleted, so they quietly
 *  outlive the world they belong to:
 *   - ChatMessage.sender is `SetNull`, not `Cascade` (a line has to survive its
 *     author being deleted mid-conversation) — so the global chat kept the
 *     backlog of a world that no longer exists;
 *   - WorldBoss, Arena, GuildWar, HappyHour and MiniGameEvent are top-level
 *     rows owned by the world rather than by any player, so nothing cascades to
 *     them at all.
 *  A "wiped" database that still opens on six chat lines from deleted empires
 *  and a live boss fight is not wiped, so all of them go explicitly.
 *
 * DELIBERATELY PRESERVED
 *  - the admin User row named by --email (its empire is removed, so the next
 *    sign-in goes through /onboarding and builds a fresh one);
 *  - settled real-money purchases (status PAID, isTest false). These are
 *    financial records — receipts, refunds, chargebacks, tax. Pass
 *    --purge-purchases only if you are certain every row is a mock/test charge.
 *  - GameConfig, the balance tunables singleton. It is configuration, not
 *    player data; reset it from /admin/balance if you want defaults back.
 *  - ErrorLog. Diagnostics are the operator's own record of what has been going
 *    wrong, and they read the same before and after a reset. Pass --purge-logs
 *    to drop them along with the rate-limiter buckets.
 *  - support conversations (see server/actions/support.ts). They are not the
 *    game world: half of them were written by people who never had an account,
 *    and the ones that were are the correspondence *about* the purchases the
 *    line above keeps — a refund argued in the chat and a receipt in the
 *    purchases table are one record between them. Pass --purge-support to drop
 *    them anyway (a dev database full of test tickets is the case for it).
 *
 * SAFETY
 *  - dry run by default: prints what WOULD be deleted and exits;
 *  - --confirm is required to touch anything;
 *  - refuses to run unless the target account exists AND is role ADMIN;
 *  - prints the database host it is about to hit — read it before confirming.
 *
 * USAGE
 *   npx tsx scripts/wipe-data.ts --email you@example.com                # dry run
 *   npx tsx scripts/wipe-data.ts --email you@example.com --confirm      # execute
 *   ... --confirm --purge-purchases --purge-support --purge-logs        # leave nothing
 *
 * Reads PRISMA_DATABASE_URL from the environment. To target production, run it
 * with that environment's URL explicitly — do not rely on whichever .env happens
 * to load first (the Prisma CLI reads .env, the Next app reads .env.local).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function dbHost(): string {
  // Must match the datasource in prisma/schema.prisma, otherwise this banner
  // reports a different database than the one the script is about to wipe.
  const url = process.env.PRISMA_DATABASE_URL ?? "";
  const m = url.match(/@([^/?]+)/);
  return m ? m[1]! : "(PRISMA_DATABASE_URL not set)";
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();
  const confirm = has("confirm");
  const purgePurchases = has("purge-purchases");
  const purgeSupport = has("purge-support");
  const purgeLogs = has("purge-logs");

  if (!email) {
    console.error("Missing --email <admin address to keep>");
    process.exit(1);
  }

  console.log(`Database host : ${dbHost()}`);
  console.log(`Keeping admin : ${email}`);
  console.log(`Purchases     : ${purgePurchases ? "PURGE ALL" : "keep settled real-money rows"}`);
  console.log(`Support chats : ${purgeSupport ? "PURGE ALL" : "keep every conversation"}`);
  console.log(`Error log     : ${purgeLogs ? "PURGE (with rate-limit buckets)" : "keep"}`);
  console.log(`Mode          : ${confirm ? "EXECUTE" : "DRY RUN"}\n`);

  const keeper = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, email: true },
  });
  if (!keeper) {
    console.error(`No user with email ${email}. Refusing to wipe — you would lock yourself out.`);
    process.exit(1);
  }
  if (keeper.role !== "ADMIN") {
    console.error(`User ${email} has role ${keeper.role}, not ADMIN. Refusing to wipe.`);
    process.exit(1);
  }

  const keptPurchaseFilter = { status: "PAID" as const, isTest: false };

  const [
    users, empires, guilds, seasons, minigames, audit, purchases, keptPurchases,
  ] = await Promise.all([
    prisma.user.count({ where: { id: { not: keeper.id } } }),
    prisma.empire.count(),
    prisma.guild.count(),
    prisma.gameSeason.count(),
    prisma.miniGameEvent.count(),
    prisma.adminAuditLog.count(),
    prisma.diamondPurchase.count(),
    prisma.diamondPurchase.count({ where: keptPurchaseFilter }),
  ]);
  const supportThreads = await prisma.supportThread.count();

  // The world-owned rows nothing cascades to — see the note at the top.
  const [chat, happyHours, bosses, arenas, wars, errors] = await Promise.all([
    prisma.chatMessage.count(),
    prisma.happyHour.count(),
    prisma.worldBoss.count(),
    prisma.arena.count(),
    prisma.guildWar.count(),
    prisma.errorLog.count(),
  ]);

  console.log("Will delete:");
  console.log(`  users (other than the keeper) : ${users}`);
  console.log(`  empires (incl. the keeper's)  : ${empires}`);
  console.log(`  guilds                        : ${guilds}`);
  console.log(`  seasons                       : ${seasons}`);
  console.log(`  mini-game events              : ${minigames}`);
  console.log(`  chat messages                 : ${chat}`);
  console.log(`  happy hours                   : ${happyHours}`);
  console.log(`  world bosses                  : ${bosses}`);
  console.log(`  arenas                        : ${arenas}`);
  console.log(`  guild wars                    : ${wars}`);
  console.log(`  admin audit entries           : ${audit}`);
  console.log(
    `  error-log entries             : ${purgeLogs ? errors : 0}` +
      (purgeLogs ? "  (ALL)" : `  (keeping ${errors})`)
  );
  console.log(
    `  diamond purchases             : ${purgePurchases ? purchases : purchases - keptPurchases}` +
      (purgePurchases ? "  (ALL)" : `  (keeping ${keptPurchases} settled real-money rows)`)
  );
  console.log(
    `  support conversations         : ${purgeSupport ? supportThreads : 0}` +
      (purgeSupport ? "  (ALL)" : `  (keeping ${supportThreads})`)
  );
  console.log(
    "\nEverything owned by a deleted user or empire (army, buildings, hero, items,\n" +
      "bank, reports, messages, season-pass progress) goes with it via cascade."
  );

  if (!confirm) {
    console.log("\nDRY RUN — nothing was changed. Re-run with --confirm to execute.");
    return;
  }

  console.log("\nExecuting...");

  // Users first: the cascade takes their empires and everything underneath.
  const delUsers = await prisma.user.deleteMany({ where: { id: { not: keeper.id } } });
  console.log(`  deleted users            : ${delUsers.count}`);

  // The keeper's own empire (the account itself stays).
  const delKeeperEmpire = await prisma.empire.deleteMany({ where: { userId: keeper.id } });
  console.log(`  deleted keeper's empire  : ${delKeeperEmpire.count}`);

  // Anything left that is not owned through a user. Entries, strikes and clashes
  // cascade from the row above them (WorldBossStrike→WorldBoss,
  // ArenaEntry→Arena, GuildWarEntry/Clash→GuildWar, MiniGameEntry→MiniGameEvent),
  // so only the parents are named here.
  const delGuilds = await prisma.guild.deleteMany({});
  const delMinis = await prisma.miniGameEvent.deleteMany({});
  const delSeasons = await prisma.gameSeason.deleteMany({});
  const delAudit = await prisma.adminAuditLog.deleteMany({});
  const delChat = await prisma.chatMessage.deleteMany({});
  const delHappy = await prisma.happyHour.deleteMany({});
  const delBosses = await prisma.worldBoss.deleteMany({});
  const delArenas = await prisma.arena.deleteMany({});
  const delWars = await prisma.guildWar.deleteMany({});
  console.log(`  deleted guilds           : ${delGuilds.count}`);
  console.log(`  deleted mini-games       : ${delMinis.count}`);
  console.log(`  deleted seasons          : ${delSeasons.count}`);
  console.log(`  deleted audit entries    : ${delAudit.count}`);
  console.log(`  deleted chat messages    : ${delChat.count}`);
  console.log(`  deleted happy hours      : ${delHappy.count}`);
  console.log(`  deleted world bosses     : ${delBosses.count}`);
  console.log(`  deleted arenas           : ${delArenas.count}`);
  console.log(`  deleted guild wars       : ${delWars.count}`);

  if (purgeLogs) {
    const delErrors = await prisma.errorLog.deleteMany({});
    // Throttle counters, not records. Clearing them hands everybody a fresh
    // budget, which is what you want on the day the doors open.
    const delBuckets = await prisma.rateLimitBucket.deleteMany({});
    console.log(`  deleted error-log rows   : ${delErrors.count}`);
    console.log(`  deleted rate-limit rows  : ${delBuckets.count}`);
  }

  const delPurchases = purgePurchases
    ? await prisma.diamondPurchase.deleteMany({})
    : await prisma.diamondPurchase.deleteMany({
        where: { NOT: keptPurchaseFilter },
      });
  console.log(`  deleted purchases        : ${delPurchases.count}`);

  if (purgeSupport) {
    // Messages go with the thread — SupportMessage cascades on threadId.
    const delSupport = await prisma.supportThread.deleteMany({});
    console.log(`  deleted support chats    : ${delSupport.count}`);
  }

  // The keeper must not be locked out by the new email-verification gate: they
  // demonstrably control this address (it is the configured admin), and there
  // may be no mail provider wired up yet to send them a link.
  await prisma.user.update({
    where: { id: keeper.id },
    data: {
      emailVerified: new Date(),
      failedLogins: 0,
      lockedUntil: null,
    },
  });
  console.log(`  keeper marked verified & unlocked`);

  const [usersLeft, empiresLeft, purchasesLeft, chatLeft] = await Promise.all([
    prisma.user.count(),
    prisma.empire.count(),
    prisma.diamondPurchase.count(),
    prisma.chatMessage.count(),
  ]);
  console.log(
    `\nDone. users=${usersLeft} empires=${empiresLeft} purchases=${purchasesLeft} chat=${chatLeft}`
  );
  console.log(
    `Sign in as ${keeper.email}; with no empire you will be routed to /onboarding.`
  );
}

main()
  .catch((e) => {
    console.error("Wipe failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
