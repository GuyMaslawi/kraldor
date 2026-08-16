import "server-only";
import type { DiamondEffectKind, Prisma } from "@prisma/client";
import { bankInterestRate, type StorableResource } from "@/lib/game/constants";
import { cityName } from "@/lib/game/cities";
import { guildCityNote } from "@/lib/game/guild";
import { applyGuildCityRule } from "@/server/guildCity";
import { monumentBonuses, monumentMultiplier } from "@/lib/game/monuments";
import type { T } from "@/i18n/translate";
import {
  BANK_INTEREST_COOLDOWN_MS,
  BANK_INTEREST_SPELL_COST,
  BOOST_DURATION_MS,
  BOOST_MAX_PCT,
  BOOST_STEP_COST,
  BOOST_STEP_PCT,
  CITY_DOWNGRADE_COOLDOWN_HOURS,
  CITY_DOWNGRADE_COOLDOWN_MS,
  CITY_DOWNGRADE_COST,
  CITY_DOWNGRADE_MIN_CITIES,
  RESOURCE_BOOST_KIND,
  SHIELD_RENEW_COOLDOWN_MINUTES,
  SHIELD_RENEW_COOLDOWN_MS,
  SHOP_DISCOUNT_COST,
  SHOP_DISCOUNT_DURATION_MS,
  SHOP_DISCOUNT_PCT,
  TURN_PACKAGES,
  shieldMeta,
  type ShieldKey,
} from "@/lib/game/diamondShop";

/**
 * The effect half of every diamond-shop purchase, with the payment pulled out
 * behind a callback.
 *
 * Two callers cast these: the player, through `server/actions/diamondShop`, who
 * pays diamonds and obeys the cooldowns; and an admin, through the player
 * editor, who casts the same spell on someone's behalf for free. Before this
 * module the admin panel could only *fake* a cast by writing the effect row,
 * which is not the same thing at all — a bank-interest cast pays gold into the
 * bank and writes a ledger row, a turn pack adds turns, the city spell drops a
 * tier. Keeping one implementation is the point: a retuned cooldown or a fixed
 * race has to reach both callers, and a second copy in the admin file would
 * drift within a release.
 *
 * Every function here assumes the caller already opened a transaction, took the
 * empire's row lock and settled the lazy clock (see `lockEmpire` /
 * `applyPendingUpdates`). None of them revalidate — that is the action's job.
 */

export type EffectResult = { success: string } | { error: string };

export interface CastContext {
  tx: Prisma.TransactionClient;
  empireId: string;
  /** One clock for the whole cast, so the guards and the stamps agree. */
  now: Date;
  /**
   * The reader's translator, for the one sentence every cast returns.
   *
   * Passed in rather than resolved here because the two callers read different
   * languages: the player's cast runs on their own request, while an admin cast
   * is written for the admin looking at the editor — the control centre stays
   * Hebrew, so it hands in the source-language translator.
   */
  t: T;
  /**
   * Charge for the cast once every guard has passed and before the first write.
   * Returns false when the purse is short, which aborts the cast without a
   * write. Omitted by admin casts: a cast on a player's behalf is free.
   */
  charge?: (cost: number) => Promise<boolean>;
  /**
   * Cast straight through an existing cooldown and leave none behind.
   *
   * Admin-only. The point of casting for a player is usually that the cooldown
   * (or a bug that set one) is exactly what's in the way, and the editor has
   * its own buttons for the clock — so an admin cast must neither be refused by
   * a cooldown nor quietly impose one. Guards that are *legality* rather than
   * pacing — the last city, the boost ceiling, an empty bank — still hold.
   */
  ignoreCooldown?: boolean;
}

/**
 * Lock this empire's row for the rest of the transaction.
 *
 * The cooldown guards below are check-then-act: they read `readyAt`, then upsert
 * a new one at the end. Under READ COMMITTED two concurrent casts by the same
 * player could both pass the check before either persists, letting a player
 * collect bank interest N times per window or buy a cooldown turn-pack
 * repeatedly. Taking this row lock first serializes a player's own concurrent
 * casts, so the second one blocks until the first commits and then sees the
 * fresh cooldown.
 */
export async function lockEmpire(
  tx: Prisma.TransactionClient,
  empireId: string
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;
}

function effectRow(ctx: CastContext, kind: DiamondEffectKind) {
  return ctx.tx.diamondEffect.findUnique({
    where: { empireId_kind: { empireId: ctx.empireId, kind } },
  });
}

/** Whole minutes left on a clock, or null once it is behind us. */
function minutesLeft(at: Date | null | undefined, now: Date): number | null {
  if (!at || at <= now) return null;
  return Math.ceil((at.getTime() - now.getTime()) / 60_000);
}

/** Take payment when there is a payer; an admin cast is always free. */
async function paid(ctx: CastContext, cost: number): Promise<boolean> {
  return ctx.charge ? ctx.charge(cost) : true;
}

/** The cooldown stamp to write — none at all when the caster ignores cooldowns. */
function cooldownAt(ctx: CastContext, ms: number): Date | null {
  return ctx.ignoreCooldown ? null : new Date(ctx.now.getTime() + ms);
}

/* ------------------------------ resource boost ------------------------------ */

/** One +25% production step for a resource, 24h, stacking to +200%. */
export async function castResourceBoost(
  ctx: CastContext,
  resource: StorableResource
): Promise<EffectResult> {
  const kind = RESOURCE_BOOST_KIND[resource];
  const existing = await effectRow(ctx, kind);
  const activePct =
    existing?.activeUntil && existing.activeUntil > ctx.now ? existing.magnitude : 0;
  if (activePct >= BOOST_MAX_PCT) {
    return {
      error: ctx.t("הבונוס כבר בתקרה (+{max}%)", { max: BOOST_MAX_PCT }),
    };
  }

  if (!(await paid(ctx, BOOST_STEP_COST))) {
    return { error: ctx.t("אין מספיק יהלומים") };
  }

  const magnitude = Math.min(BOOST_MAX_PCT, activePct + BOOST_STEP_PCT);
  const activeUntil = new Date(ctx.now.getTime() + BOOST_DURATION_MS);
  await ctx.tx.diamondEffect.upsert({
    where: { empireId_kind: { empireId: ctx.empireId, kind } },
    create: { empireId: ctx.empireId, kind, magnitude, activeUntil },
    update: { magnitude, activeUntil, readyAt: null },
  });

  return {
    success: ctx.t("בונוס תפוקה עלה ל־+{pct}% ל־24 שעות!", { pct: magnitude }),
  };
}

/* ------------------------------ shop discount ------------------------------ */

/** 20% off weapons + upgrades for 24 hours. */
export async function castShopDiscount(ctx: CastContext): Promise<EffectResult> {
  const existing = await effectRow(ctx, "SHOP_DISCOUNT");
  // "Already running" is pacing, not legality: an admin cast refreshes it.
  if (!ctx.ignoreCooldown && existing?.activeUntil && existing.activeUntil > ctx.now) {
    return { error: ctx.t("ההנחה כבר פעילה") };
  }

  if (!(await paid(ctx, SHOP_DISCOUNT_COST))) {
    return { error: ctx.t("אין מספיק יהלומים") };
  }

  const activeUntil = new Date(ctx.now.getTime() + SHOP_DISCOUNT_DURATION_MS);
  await ctx.tx.diamondEffect.upsert({
    where: { empireId_kind: { empireId: ctx.empireId, kind: "SHOP_DISCOUNT" } },
    create: {
      empireId: ctx.empireId,
      kind: "SHOP_DISCOUNT",
      magnitude: SHOP_DISCOUNT_PCT,
      activeUntil,
    },
    update: { magnitude: SHOP_DISCOUNT_PCT, activeUntil, readyAt: null },
  });

  return {
    success: ctx.t("הנחת {pct}% על נשק ושדרוגים פעילה ל־24 שעות!", {
      pct: SHOP_DISCOUNT_PCT,
    }),
  };
}

/* ------------------------------ raid shields ------------------------------ */

/**
 * Raise a raid shield for one of its two sale durations.
 *
 * The duration is looked up in the shield's own table rather than trusted from
 * the caller, so a hand-rolled POST can't ask for 48 hours at the 24-hour price
 * (or for a duration that was never on sale at all).
 */
export async function castRaidShield(
  ctx: CastContext,
  key: ShieldKey,
  hours: number
): Promise<EffectResult> {
  const meta = shieldMeta(key);
  const duration = meta.durations.find((d) => d.hours === hours);
  if (!duration) return { error: ctx.t("משך מגן לא תקין") };

  // A shield has to run its course before it can be bought again: no renewing
  // and no extending while one is up, and then a further
  // SHIELD_RENEW_COOLDOWN_MINUTES in which the empire is exposed. Otherwise a
  // paying player could chain shields back to back and never be raidable.
  const existing = await effectRow(ctx, meta.kind);
  if (!ctx.ignoreCooldown) {
    if (existing?.activeUntil && existing.activeUntil > ctx.now) {
      return {
        error: ctx.t(
          "{shield} עדיין פעיל — ניתן לרכוש מחדש רק {minutes} דקות אחרי שיסתיים",
          { shield: ctx.t(meta.label), minutes: SHIELD_RENEW_COOLDOWN_MINUTES }
        ),
      };
    }
    const cooling = minutesLeft(existing?.readyAt, ctx.now);
    if (cooling !== null) {
      return {
        error: ctx.t("{shield} בקירור — ניתן לחדש בעוד כ־{minutes} דקות", {
          shield: ctx.t(meta.label),
          minutes: cooling,
        }),
      };
    }
  }

  if (!(await paid(ctx, duration.cost))) {
    return { error: ctx.t("אין מספיק יהלומים") };
  }

  // Both stamps are written together: `activeUntil` is the protection,
  // `readyAt` is when the next purchase unlocks — the exposed window is the gap
  // between them.
  const activeUntil = new Date(ctx.now.getTime() + duration.hours * 3_600_000);
  const readyAt = ctx.ignoreCooldown
    ? null
    : new Date(activeUntil.getTime() + SHIELD_RENEW_COOLDOWN_MS);
  await ctx.tx.diamondEffect.upsert({
    where: { empireId_kind: { empireId: ctx.empireId, kind: meta.kind } },
    create: { empireId: ctx.empireId, kind: meta.kind, activeUntil, readyAt },
    update: { activeUntil, readyAt },
  });

  return {
    success: ctx.t("{shield} פעיל ל־{hours} השעות הבאות!", {
      shield: ctx.t(meta.label),
      hours: duration.hours,
    }),
  };
}

/* ------------------------------ turn packages ------------------------------ */

/** Hand over one turn package and start its own cooldown. */
export async function castTurnPackage(
  ctx: CastContext,
  index: number
): Promise<EffectResult> {
  const pkg = TURN_PACKAGES[index];
  if (!pkg) return { error: ctx.t("חבילה לא תקינה") };

  // Each package has its own cooldown; the bigger the package the longer it
  // stays locked (largest → once per 12h).
  const existing = await effectRow(ctx, pkg.cooldownKind);
  if (!ctx.ignoreCooldown) {
    const mins = minutesLeft(existing?.readyAt, ctx.now);
    if (mins !== null) {
      const label =
        mins >= 60
          ? ctx.t("כ־{count} שעות", { count: Math.ceil(mins / 60) })
          : ctx.t("כ־{count} דקות", { count: mins });
      return {
        error: ctx.t("החבילה בקירור — זמינה בעוד {wait}", { wait: label }),
      };
    }
  }

  if (!(await paid(ctx, pkg.cost))) {
    return { error: ctx.t("אין מספיק יהלומים") };
  }

  await ctx.tx.empire.update({
    where: { id: ctx.empireId },
    data: { turns: { increment: pkg.turns } },
  });

  const readyAt = cooldownAt(ctx, pkg.cooldownHours * 3_600_000);
  await ctx.tx.diamondEffect.upsert({
    where: { empireId_kind: { empireId: ctx.empireId, kind: pkg.cooldownKind } },
    create: { empireId: ctx.empireId, kind: pkg.cooldownKind, readyAt },
    update: { readyAt, activeUntil: null },
  });

  return {
    success: ctx.t("נוספו {turns} תורות!", {
      turns: pkg.turns.toLocaleString("en-US"),
    }),
  };
}

/* ------------------------------ bank interest spell ------------------------------ */

/** The settled empire, as much of it as the bank spell reads. */
export interface BankInterestEmpire {
  bankAccount: { id: string; goldBalance: number } | null;
  upgrades: { type: string; level: number }[];
  monuments?: readonly { key: string; level: number }[] | null;
}

/** Pay one interest instalment into the bank on the spot. */
export async function castBankInterest(
  ctx: CastContext,
  empire: BankInterestEmpire
): Promise<EffectResult> {
  const existing = await effectRow(ctx, "BANK_INTEREST");
  if (!ctx.ignoreCooldown) {
    const mins = minutesLeft(existing?.readyAt, ctx.now);
    if (mins !== null) {
      return {
        error: ctx.t("הקסם בקירור — זמין בעוד כ־{minutes} דקות", { minutes: mins }),
      };
    }
  }

  const bank = empire.bankAccount;
  if (!bank || bank.goldBalance <= 0) {
    return { error: ctx.t("אין יתרה בבנק לצבירת ריבית") };
  }

  const interestLevel =
    empire.upgrades.find((u) => u.type === "BANK_DAILY_INTEREST")?.level ?? 1;
  // The spell sells "one interest payment" — so it has to be the payment the
  // clock would make, בית הגנזים included. Paying the bare ladder rate here
  // made the monument silently worthless to anyone who bought the spell.
  const interest = Math.floor(
    bank.goldBalance *
      bankInterestRate(interestLevel) *
      monumentMultiplier(monumentBonuses(empire.monuments).interest)
  );
  if (interest <= 0) return { error: ctx.t("הריבית הנוכחית אפסית") };

  if (!(await paid(ctx, BANK_INTEREST_SPELL_COST))) {
    return { error: ctx.t("אין מספיק יהלומים") };
  }

  const balanceAfter = bank.goldBalance + interest;
  // Increment (not absolute set) so a bank deposit/withdraw committing between
  // the read above and this write is not clobbered (lost update).
  await ctx.tx.bankAccount.update({
    where: { id: bank.id },
    data: { goldBalance: { increment: interest } },
  });
  await ctx.tx.bankTransaction.create({
    data: {
      bankAccountId: bank.id,
      empireId: ctx.empireId,
      type: "INTEREST",
      amount: interest,
      balanceAfter,
      createdAt: ctx.now,
    },
  });

  const readyAt = cooldownAt(ctx, BANK_INTEREST_COOLDOWN_MS);
  await ctx.tx.diamondEffect.upsert({
    where: { empireId_kind: { empireId: ctx.empireId, kind: "BANK_INTEREST" } },
    create: { empireId: ctx.empireId, kind: "BANK_INTEREST", readyAt },
    update: { readyAt, activeUntil: null },
  });

  return {
    success: ctx.t("נצברה ריבית של {gold} זהב לבנק!", {
      gold: interest.toLocaleString("en-US"),
    }),
  };
}

/* ------------------------------ city downgrade spell ------------------------------ */

/**
 * Give up exactly one city tier — the only cast that makes the empire smaller.
 *
 * The floor is legality, not pacing, so it holds for an admin cast too: below
 * CITY_DOWNGRADE_MIN_CITIES the last city can never be surrendered (an empire
 * with zero cities has no production multiplier, no population ceiling and no
 * boss tier — the value simply isn't legal). And the decrement is pinned to the
 * exact city count the check ran against, so a cast racing a `foundCity` (which
 * pins the same column) can only ever move the empire by one tier: the loser of
 * the race matches zero rows and the whole transaction — payment included —
 * rolls back rather than silently costing a second city.
 *
 * Nothing is refunded; see CITY_DOWNGRADE_COST for why. Upgrades already bought
 * above the new tier's ceiling (CITIZEN_GROWTH is capped at 10 levels per city)
 * are deliberately left standing — they were paid for — they simply cannot be
 * raised again until the city is founded back.
 */
export async function castCityDowngrade(
  ctx: CastContext,
  empire: { cities: number }
): Promise<EffectResult> {
  if (empire.cities < CITY_DOWNGRADE_MIN_CITIES) {
    return {
      error: ctx.t("הקסם זמין רק מעיר {min} ומעלה — אין עיר לוותר עליה", {
        min: CITY_DOWNGRADE_MIN_CITIES,
      }),
    };
  }

  const existing = await effectRow(ctx, "CITY_DOWNGRADE");
  if (!ctx.ignoreCooldown) {
    const mins = minutesLeft(existing?.readyAt, ctx.now);
    if (mins !== null) {
      return {
        error: ctx.t("הקסם בקירור — זמין בעוד כ־{minutes} דקות", { minutes: mins }),
      };
    }
  }

  if (!(await paid(ctx, CITY_DOWNGRADE_COST))) {
    return {
      error: ctx.t("דרושים {cost} יהלומים להטלת הקסם", {
        cost: CITY_DOWNGRADE_COST,
      }),
    };
  }

  // Pinned to the snapshot tier: exactly one city, and only from the tier the
  // guards above were checked against.
  const dropped = await ctx.tx.empire.updateMany({
    where: { id: ctx.empireId, cities: empire.cities },
    data: { cities: { decrement: 1 } },
  });
  if (dropped.count === 0) throw new Error("city downgrade conflict");

  const readyAt = cooldownAt(ctx, CITY_DOWNGRADE_COOLDOWN_MS);
  await ctx.tx.diamondEffect.upsert({
    where: { empireId_kind: { empireId: ctx.empireId, kind: "CITY_DOWNGRADE" } },
    create: { empireId: ctx.empireId, kind: "CITY_DOWNGRADE", readyAt },
    update: { readyAt, activeUntil: null },
  });

  // Down is a city change like any other, and a guild lives in exactly one
  // city — see server/guildCity.ts. Same transaction as the decrement.
  const guild = await applyGuildCityRule(ctx.tx, ctx.empireId, empire.cities);

  const to = empire.cities - 1;
  const tail = ctx.ignoreCooldown
    ? ""
    : ctx.t(" הקסם יהיה זמין שוב בעוד {hours} שעה.", {
        hours: CITY_DOWNGRADE_COOLDOWN_HOURS,
      });
  return {
    success:
      ctx.t("ירדת ל{city}.{tail}", { city: cityName(ctx.t, to), tail }) +
      guildCityNote(ctx.t, guild),
  };
}
