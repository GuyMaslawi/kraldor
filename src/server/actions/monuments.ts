"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import { applyPendingUpdates } from "@/lib/game/updates";
import { formatNumber } from "@/lib/game/format";
import {
  MONUMENT_BY_KEY,
  MONUMENT_MAX_LEVEL,
  buildMonumentsState,
  monumentCost,
  monumentPct,
  type MonumentsState,
} from "@/lib/game/monuments";
import { awardSeasonPassXp } from "@/server/seasonPassXp";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT } from "@/i18n/server";

/**
 * מונומנטים — founding one and raising it.
 *
 * A single action does both, because they are the same act: a monument that has
 * no row is at level 0, and "raise it from 0" is "found it". Splitting them
 * would have meant two endpoints that differ only in whether an INSERT or an
 * UPDATE runs, and two chances to get the guard wrong.
 *
 * The guard is the interesting part, and it is a `create`-or-guarded-`updateMany`
 * pair rather than an upsert. An upsert would have to name an update branch of
 * `{ level: { increment: 1 } }` with no level condition on it — so two
 * simultaneous clicks would both increment, raising the monument two levels for
 * one payment. Pinning the level that was *read* means the loser matches no row
 * and its gold is handed back.
 */

async function requireOwnEmpireId(): Promise<string> {
  const empireId = await getActiveEmpireId();
  // i18n-exempt: thrown, never rendered — the catch returns a translated line.
  if (empireId === null) throw new Error("לא מחובר");
  return empireId;
}

/** Everything the monuments screen renders. */
export async function getMonumentsState(): Promise<MonumentsState | null> {
  const empireId = await getActiveEmpireId();
  if (empireId === null) return null;

  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    select: { gold: true, monuments: { select: { key: true, level: true } } },
  });
  if (!empire) return null;
  return buildMonumentsState(empire.gold, empire.monuments);
}

const raiseSchema = z.object({ key: z.string().min(1).max(64) });

/** Found a monument, or raise one already standing, paying the gold. */
export async function raiseMonument(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getT();
  const parsed = raiseSchema.safeParse({ key: formData.get("key") });
  if (!parsed.success) return { error: t("מונומנט לא תקין") };
  const definition = MONUMENT_BY_KEY.get(parsed.data.key);
  if (!definition) return { error: t("מונומנט לא תקין") };

  try {
    const empireId = await requireOwnEmpireId();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empire" WHERE id = ${empireId} FOR UPDATE`;

      // Settle first: the gold that pays for this may still be sitting in an
      // unsettled backlog of mine ticks, and a player who was away for a night
      // should be able to spend what that night earned.
      await applyPendingUpdates(empireId, tx);

      const existing = await tx.empireMonument.findUnique({
        where: { empireId_key: { empireId, key: definition.key } },
        select: { id: true, level: true },
      });
      const level = existing?.level ?? 0;

      if (level >= MONUMENT_MAX_LEVEL) {
        return { error: t("{monument} עומד במלוא גובהו.", { monument: t(definition.name) }) };
      }

      const cost = monumentCost(level);
      if (cost === null) {
        return { error: t("{monument} עומד במלוא גובהו.", { monument: t(definition.name) }) };
      }

      const notEnough = {
        error: t("הרמה הבאה של {monument} עולה {gold} זהב.", {
          monument: t(definition.name),
          gold: formatNumber(cost),
        }),
      };

      // Guarded debit — the house rule for every spend in this codebase. A
      // concurrent purchase can never drive gold negative.
      const paid = await tx.empire.updateMany({
        where: { id: empireId, gold: { gte: cost } },
        data: { gold: { decrement: cost } },
      });
      if (paid.count === 0) return notEnough;

      let raised = false;
      if (existing) {
        // Pinned to the level that was read: a second concurrent click matches
        // nothing and is refunded below rather than buying a free level.
        const bumped = await tx.empireMonument.updateMany({
          where: { id: existing.id, level: existing.level },
          data: { level: existing.level + 1 },
        });
        raised = bumped.count > 0;
      } else {
        try {
          await tx.empireMonument.create({
            data: { empireId, key: definition.key, level: 1 },
          });
          raised = true;
        } catch {
          // Lost the founding race. NOT rethrown: in Postgres a failed
          // statement poisons the whole transaction, so the unique violation
          // has to be caught here and turned into a refund — the same trap
          // documented at awardSeasonPassXp and in the 2026-07-27 audit.
          raised = false;
        }
      }

      if (!raised) {
        await tx.empire.update({
          where: { id: empireId },
          data: { gold: { increment: cost } },
        });
        return { error: t("המונומנט השתנה בינתיים — נסה שוב.") };
      }

      // Rated as an empire upgrade: it is the same act at a larger scale, and
      // the ladder should not pay more for a monument simply because it costs
      // more — the gold is the point, not the XP.
      await awardSeasonPassXp(tx, empireId, "empireUpgrade");

      const newLevel = level + 1;
      return {
        success: t("{monument} הועלה לרמה {level} — {effect}.", {
          monument: t(definition.name),
          level: newLevel,
          effect: t(definition.effectLabel, { pct: monumentPct(newLevel) }),
        }),
      };
    });

    revalidatePath("/game", "layout");
    return result;
  } catch (err) {
    await logError("monuments.raiseMonument", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
