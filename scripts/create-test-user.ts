/**
 * Create a ready-to-play account without the email round trip.
 *
 * For the times someone outside the project has to be handed working
 * credentials — a payment provider's merchant review, an app-store reviewer, a
 * tester — where the normal signup cannot work: the verification mail goes to
 * an address we do not control, and until it is clicked `requireEmpire`
 * redirects every game page to /verify-email (see src/lib/auth.ts).
 *
 * The account it writes is an ordinary player, not staff: the same starter
 * empire `register` builds, through the same `newEmpireData`, with
 * `emailVerified` already stamped. Deliberately NOT staff-flagged — `isStaff`
 * takes an empire out of the rankings, off the target lists and out of the
 * mini-games (see src/lib/staff.ts), so a reviewer holding one would be shown a
 * game noticeably unlike the one players get.
 *
 * SAFETY
 *  - dry run by default: prints what it would create and exits;
 *  - --confirm is required to write anything;
 *  - prints the database host it is about to touch — read it before confirming;
 *  - refuses to reuse a taken email or empire name rather than mutating the
 *    account already there.
 *
 * USAGE
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/create-test-user.ts \
 *     --email tester@example.com --empire "שם האימפריה" --name "שם השחקן"
 *
 *   …plus --confirm to execute. `--password` is optional; one is generated and
 *   printed when it is omitted. `--class` is one of WARLORD (default),
 *   GUARDIAN, MERCHANT, SHADOW.
 *
 * The --tsconfig flag is required — it teaches Node the `@/*` and `server-only`
 * mappings the imported app modules rely on. See scripts/tsconfig.json.
 *
 * Reads PRISMA_DATABASE_URL from the environment (the Prisma CLI loads `.env`).
 * To target production, pass that environment's URL explicitly rather than
 * relying on whichever .env happens to load first:
 *
 *   PRISMA_DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require" \
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/create-test-user.ts …
 */
import { randomInt } from "node:crypto";
import { PrismaClient, type HeroClass } from "@prisma/client";
import { newEmpireData } from "@/lib/game/createEmpire";
import { mergeTunables } from "@/lib/game/config";
import { hashPassword } from "@/lib/password";

const prisma = new PrismaClient();

const HERO_CLASSES: HeroClass[] = ["WARLORD", "GUARDIAN", "MERCHANT", "SHADOW"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function dbHost(): string {
  const url = process.env.PRISMA_DATABASE_URL ?? "";
  const m = url.match(/@([^/?]+)/);
  return m ? m[1]! : "(PRISMA_DATABASE_URL not set)";
}

/**
 * A password meant to be read off a page and typed by hand, so no characters
 * that survive a copy badly (no l/1/O/0, no quotes a mail client may curl).
 * Still 4 words of CSPRNG-drawn entropy over a 24-symbol alphabet plus digits.
 */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (s: string) => s[randomInt(s.length)]!;
  const block = () => Array.from({ length: 4 }, () => pick(alphabet)).join("");
  return `${block()}-${block()}-${Array.from({ length: 3 }, () => pick(digits)).join("")}`;
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();
  const empireName = arg("empire")?.trim();
  const name = arg("name")?.trim();
  const heroClass = (arg("class")?.trim().toUpperCase() ?? "WARLORD") as HeroClass;
  const password = arg("password") ?? generatePassword();
  const confirm = has("confirm");

  if (!email || !empireName || !name) {
    console.error("Usage: --email <address> --empire <empire name> --name <player name> [--password <pw>] [--class WARLORD] [--confirm]");
    process.exit(1);
  }
  if (!HERO_CLASSES.includes(heroClass)) {
    console.error(`--class must be one of ${HERO_CLASSES.join(", ")}`);
    process.exit(1);
  }
  // The same floor registerSchema enforces, so a password minted here is one
  // the account's owner could also have chosen at signup — and could still set
  // from the reset form later.
  if (password.length < 8) {
    console.error("--password must be at least 8 characters");
    process.exit(1);
  }

  const [existingUser, existingEmpire, season, configRow] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.empire.findUnique({ where: { name: empireName }, select: { id: true } }),
    prisma.gameSeason.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, endsAt: true, closedAt: true },
    }),
    prisma.gameConfig.findUnique({ where: { id: "singleton" } }),
  ]);

  console.log(`Database host : ${dbHost()}`);
  console.log(`Email         : ${email}`);
  console.log(`Player name   : ${name}`);
  console.log(`Empire        : ${empireName}`);
  console.log(`Hero class    : ${heroClass}`);
  console.log(`Password      : ${password}`);
  console.log(
    `Season        : ${season ? `${season.name}${season.closedAt ? " (CLOSED)" : ""}` : "(none active — the empire will be season-less)"}`
  );

  if (existingUser) {
    console.error(`\nThat email already has an account on this database. Pick another address, or delete that account first.`);
    process.exit(1);
  }
  if (existingEmpire) {
    console.error(`\nThat empire name is taken on this database. Pick another.`);
    process.exit(1);
  }
  // Not fatal — the account is still created and can log in — but whoever is
  // being handed these credentials will hit /season instead of the game, and
  // should be told to wait for the next season to open.
  if (season?.closedAt || (season && season.endsAt <= new Date())) {
    console.warn(`\n⚠ The season has ended: the site is sealed behind /season until the next one opens, so this account cannot reach a game screen yet.`);
  }

  if (!confirm) {
    console.log(`\nDry run — nothing written. Re-run with --confirm to create the account.`);
    return;
  }

  const tunables = mergeTunables(configRow?.data);
  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      // `emailVerified` is the whole point of this script: it is what the
      // verification link would have written, and without it every game route
      // bounces to /verify-email. No signupIp — this account was not born of a
      // request, and a fake address would pollute the shared-IP clustering the
      // admin monitor reports on.
      data: { email, passwordHash, name, emailVerified: new Date() },
    });
    await tx.empire.create({
      data: newEmpireData(created.id, empireName, season?.id, tunables.starting, heroClass),
    });
    return created;
  });

  console.log(`\n✔ Created user ${user.id} with empire "${empireName}".`);
  console.log(`  Sign in at ${process.env.NEXT_PUBLIC_APP_URL ?? "the site"} with the email and password above.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
