"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { getEmpireStats } from "@/server/achievementState";
import {
  TITLE_BY_KEY,
  TITLE_PARAMS,
  buildTitlesState,
  titleUnlocked,
  type TitlesState,
} from "@/lib/game/titles";
import { UniqueRaceLost, uniqueRaceMessage } from "@/server/uniqueRace";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT } from "@/i18n/server";

/**
 * תארים — buying one and putting one on.
 *
 * Both actions re-derive the unlock through `titleUnlocked`, the same function
 * the screen renders from. That is the whole safety story for a feature whose
 * client can post any string it likes: an earned title's condition is checked
 * against a fresh stats snapshot at the moment it is worn, and a bought one is
 * checked against its receipt row.
 *
 * Note what neither action can do: grant anything. A title multiplies nothing,
 * so the worst a bug here could produce is somebody wearing a word they did not
 * earn — which is why this is the one thing in the game that is safe to sell.
 */

async function requireOwnEmpireId(): Promise<string> {
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the catch returns a translated line.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

/** Everything the titles screen renders. */
export async function getTitlesState(): Promise<TitlesState | null> {
  const empireId = await getActiveEmpireId();
  if (empireId === null) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: {
      diamonds: true,
      title: true,
      titles: { select: { key: true } },
    },
  });
  if (!empire) return null;

  // Memoised per request, and shared with the achievements badge the layout
  // already asked for — see getEmpireStats.
  const stats = await getEmpireStats(empireId);

  return buildTitlesState(
    stats,
    new Set(empire.titles.map((t) => t.key)),
    empire.title,
    empire.diamonds
  );
}

const keySchema = z.object({ key: z.string().min(1).max(64) });

/* ------------------------------ buy ------------------------------ */

/**
 * Buy a title.
 *
 * The insert is the receipt *and* the guard: it runs unconditionally and the
 * unique index drops a double-click, so nobody is charged twice. The diamonds
 * are debited first, under the usual `gte` guard, and refunded if the insert
 * turns out to be the losing half of a race — a failed statement poisons a
 * Postgres transaction, so the violation has to be caught here rather than
 * thrown.
 */
export async function buyTitle(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = keySchema.safeParse({ key: formData.get("key") });
  if (!parsed.success) return { error: t("תואר לא תקין") };
  const definition = TITLE_BY_KEY.get(parsed.data.key);
  if (!definition) return { error: t("תואר לא תקין") };

  if (definition.kind !== "bought") {
    // Not a price check — earned titles have no price. This is the line that
    // keeps the two kinds from collapsing into one: an earned title must never
    // be obtainable for money, or every earned title on the board is worth less.
    return { error: t("את התואר הזה משיגים במשחק, לא בקנייה.") };
  }

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      const owned = await tx.empireTitle.findUnique({
        where: { empireId_key: { empireId, key: definition.key } },
        select: { id: true },
      });
      if (owned) return { error: t("התואר הזה כבר שלך.") };

      const notEnough = {
        error: t("התואר עולה {price} יהלומים — אין לך מספיק.", {
          price: definition.price,
        }),
      };
      const paid = await tx.empire.updateMany({
        where: { id: empireId, diamonds: { gte: definition.price } },
        data: { diamonds: { decrement: definition.price } },
      });
      if (paid.count === 0) return notEnough;

      try {
        await tx.empireTitle.create({
          data: { empireId, key: definition.key, paid: definition.price },
        });
      } catch {
        // Lost the race with another tab. The diamonds come back through the
        // rollback this throw causes: the violation has already aborted the
        // transaction, so a refund written here would never execute. See
        // server/uniqueRace.ts.
        throw new UniqueRaceLost(t("התואר הזה כבר שלך."));
      }

      return {
        success: t('התואר "{title}" נרכש. אפשר לענוד אותו עכשיו.', {
          title: t(definition.label),
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    // A double-click on the buy button is an outcome, not a fault: the rollback
    // has already returned the diamonds.
    const raced = uniqueRaceMessage(err);
    if (raced) return { error: raced };
    await logError("titles.buyTitle", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}

/* ------------------------------ wear ------------------------------ */

/**
 * Put a title on, or take one off with an empty key.
 *
 * This is where the *entitlement* is enforced, and it is the only place that
 * matters: `wornTitle` deliberately does not re-check a condition when it
 * renders somebody else's dossier, because that would be a stats query per row
 * on the rankings page. Earned conditions are monotonic, so a title checked
 * once here stays true.
 */
export async function wearTitle(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const raw = formData.get("key");
  const key = typeof raw === "string" ? raw.trim() : "";

  try {
    const empireId = await requireOwnEmpireId();

    // Taking a title off needs no entitlement check at all.
    if (key === "") {
      await prisma.empire.update({
        where: { id: empireId },
        data: { title: null },
      });
      revalidatePath("/game", "layout");
      return { success: t("הסרת את התואר.") };
    }

    const definition = TITLE_BY_KEY.get(key);
    if (!definition) return { error: t("תואר לא תקין") };

    const [stats, owned] = await Promise.all([
      getEmpireStats(empireId),
      prisma.empireTitle.findMany({
        where: { empireId },
        select: { key: true },
      }),
    ]);

    if (!titleUnlocked(definition, stats, new Set(owned.map((o) => o.key)))) {
      return {
        error:
          definition.kind === "bought"
            ? t("התואר הזה עדיין לא נרכש.")
            : t("עדיין לא עמדת בתנאי של התואר הזה: {hint}", {
                hint: t(definition.hint, TITLE_PARAMS),
              }),
      };
    }

    await prisma.empire.update({
      where: { id: empireId },
      data: { title: definition.key },
    });

    revalidatePath("/game", "layout");
    return {
      success: t('ענדת את התואר "{title}".', { title: t(definition.label) }),
    };
  } catch (err) {
    await logError("titles.wearTitle", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
