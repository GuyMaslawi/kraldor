import "server-only";
import type { HeroClass, Prisma } from "@prisma/client";
import {
  BUILDING_TYPES,
  EMPIRE_UPGRADE_TYPES,
  MINE_START_LEVEL,
  NEWBIE_PROTECTION_MS,
  STORAGE_TYPES,
  isProductionBuilding,
} from "./constants";
import { DEFAULT_TUNABLES, type GameTunables } from "./config";
import { INITIAL_WEAPON_UNLOCKED_TIER, WEAPON_CATEGORIES } from "./weapons";
import { computePower } from "@/server/empirePower";

/**
 * New-player starting balance: enough resources for the first upgrades and
 * a few tier-1 weapons, citizens to train units, turns for several spy (5)
 * and attack (10) actions, and a small working army — spies so spying works
 * immediately, mine slaves (pre-assigned 5 per mine) so production works
 * immediately.
 */
/**
 * Data for creating a fresh empire: starter buildings, an army with a few
 * soldiers, one level-1 warehouse per resource, all empire upgrades at
 * level 1, an empty bank account, and the first two weapon tiers unlocked
 * in every category.
 * Used by registration and by the seed script. The starting bundle is
 * admin-tunable — pass the live tunables (defaults mirror the original
 * hard-coded values).
 *
 * `isStaff` must be carried by every path that *rebuilds* an existing empire
 * (a progress reset, a season reset) — those delete the row and create a fresh
 * one, and defaulting it to false there would quietly put an admin back into
 * the competition. See src/lib/staff.ts.
 */
export function newEmpireData(
  userId: string,
  name: string,
  seasonId?: string,
  starting: GameTunables["starting"] = DEFAULT_TUNABLES.starting,
  heroClass: HeroClass = "WARLORD",
  isStaff: boolean = false
): Prisma.EmpireCreateInput {
  return {
    user: { connect: { id: userId } },
    ...(seasonId ? { season: { connect: { id: seasonId } } } : {}),
    name,
    isStaff,
    gold: starting.gold,
    wood: starting.wood,
    iron: starting.iron,
    stone: starting.stone,
    diamonds: starting.diamonds,
    citizens: starting.citizens,
    turns: starting.turns,
    wheelSpins: starting.wheelSpins,
    // Written explicitly (client-side UTC) rather than relying on the DB's
    // CURRENT_TIMESTAMP default, which follows the server timezone and can
    // land "in the future" relative to Prisma-written UTC timestamps.
    reportsSeenAt: new Date(),
    // New-player shield — see NEWBIE_PROTECTION_MS. Cleared early on first attack/spy.
    protectedUntil: new Date(Date.now() + NEWBIE_PROTECTION_MS),
    buildings: {
      create: BUILDING_TYPES.map((type) => ({
        // Every building — mines included — starts built at level 1. Mines used
        // to start at level 0, which yields nothing: a new player assigned
        // slaves, watched the rig animation stay dead and had no way to tell
        // that the mine simply wasn't built yet. Level 1 produces from the
        // first tick, so training and assigning slaves visibly does something.
        type,
        level: isProductionBuilding(type) ? MINE_START_LEVEL : 1,
        slavesAssigned: isProductionBuilding(type) ? starting.slavesPerMine : 0,
      })),
    },
    army: {
      create: {
        soldiers: starting.soldiers,
        spies: starting.spies,
        mineSlaves: starting.mineSlaves,
      },
    },
    // The denormalised power figures, written with the army that produces them.
    //
    // They are not zero on a fresh empire — the starting bundle is a small
    // working army, and 10 soldiers plus 2 spies is a real (small) ranking. Left
    // at the column default they read as an empire with nothing, which is what
    // emptied כוח כללי and הריגול הגבוה ביותר for a whole new season: those
    // boards drop rows whose value is 0, so every player was filtered out until
    // his first settle happened to repair the column. See server/empirePower.ts
    // — every write that changes an army writes these in the same breath, and
    // creation is a write that changes an army.
    ...computePower({ soldiers: starting.soldiers, spies: starting.spies }, []),
    storages: {
      create: STORAGE_TYPES.map((resourceType) => ({ resourceType, level: 1 })),
    },
    upgrades: {
      create: EMPIRE_UPGRADE_TYPES.map((type) => ({ type, level: 1 })),
    },
    bankAccount: { create: { goldBalance: 0 } },
    hero: { create: { heroClass } },
    weaponUnlocks: {
      create: WEAPON_CATEGORIES.map((category) => ({
        category,
        unlockedTier: INITIAL_WEAPON_UNLOCKED_TIER,
      })),
    },
    messages: {
      create: [
        {
          kind: "SYSTEM",
          // i18n-keys-start: keys, not a rendered sentence. Founding runs on the
          // new player's own request, so their language *is* readable here — but
          // storing it rendered would freeze the welcome letter in whichever
          // language they happened to sign up in, and this is the one message a
          // player still has months later. renderMessageText resolves it every
          // time the inbox is opened.
          title: "📣 ברוך הבא לקראלדור!",
          body: "האימפריה שלך נוסדה. אמן חיילים, שדרג מכרות ופתח במלחמה — הכל מתחיל בבסיס.",
          // i18n-keys-end
          href: "/game/base",
        },
      ],
    },
  };
}