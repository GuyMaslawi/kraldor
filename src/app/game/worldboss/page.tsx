import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { WorldBossArena } from "@/components/game/WorldBossArena";
import { getWorldBossState } from "@/server/actions/worldBoss";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("מפלצת העולם | KRALDOR") };
}

/**
 * /game/worldboss — the one fight the whole server shares.
 *
 * This page is also what *spawns* the week's boss: `getWorldBossState` creates
 * the row on the first look of the week (see the note at openWorldBoss). There
 * is no scheduler and no admin button behind it — see lib/game/worldBoss.ts for
 * why a clock fixture was the right shape.
 */
export default async function WorldBossPage() {
  const t = await getT();
  await requireEmpire();
  const state = await getWorldBossState();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("מפלצת העולם")}
        ornament={<Icon name="attack" size={20} className="text-crimson" />}
      />

      {state ? (
        <WorldBossArena state={state} />
      ) : (
        <p className="panel rounded-xl p-5 text-sm text-zinc-400">
          {t("הזירה אינה זמינה כרגע. נסה לרענן.")}
        </p>
      )}
    </div>
  );
}
