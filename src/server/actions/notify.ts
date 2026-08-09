"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveEmpireId } from "@/lib/auth";
import type { ActionState } from "./game";
import { logError } from "@/server/errorLog";
import { getT } from "@/i18n/server";

/**
 * The opt-out switch for raid notifications.
 *
 * Scoped through `getActiveEmpireId` rather than taking a user id, for the
 * reason every action in this codebase does: that helper is where the ban and
 * the verification gates live, and an endpoint that took an id would be an
 * endpoint that could switch somebody else's mail off.
 *
 * Note it writes the *user*, not the empire — a preference about email belongs
 * to the account, and it must survive a season restart, which rebuilds every
 * empire row from scratch.
 */
export async function setRaidNotifications(
  enabled: boolean
): Promise<ActionState> {
  const t = await getT();
  try {
    const empireId = await getActiveEmpireId();
    if (empireId === null) return { error: t("לא מחובר") };

    const empire = await prisma.empire.findUnique({
      where: { id: empireId },
      select: { userId: true },
    });
    if (!empire) return { error: t("אירעה שגיאה, נסה שוב") };

    await prisma.user.update({
      where: { id: empire.userId },
      data: { notifyRaids: Boolean(enabled) },
    });

    revalidatePath("/game/settings");
    return {
      success: enabled ? t("התראות הופעלו.") : t("התראות בוטלו."),
    };
  } catch (err) {
    await logError("notify.setRaidNotifications", err);
    return { error: t("אירעה שגיאה, נסה שוב") };
  }
}
