import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { ArenaBoard } from "@/components/game/ArenaBoard";
import { getArenaState } from "@/server/actions/arena";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("הזירה | KRALDOR") };
}

/**
 * /game/arena — the daily tournament.
 *
 * This page both opens today's card and *resolves* any whose day has ended:
 * see the note at the head of server/actions/arena.ts for why the whole
 * fixture runs on the clock with nothing scheduled behind it.
 */
export default async function ArenaPage() {
  const t = await getT();
  await requireEmpire();
  const state = await getArenaState();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("הזירה")}
        subtitle={t("טורניר יומי · כולם נגד כולם · נלחם לבד")}
        ornament={<Icon name="laurel" size={20} className="text-crimson" />}
      />

      {state ? (
        <ArenaBoard state={state} />
      ) : (
        <p className="panel rounded-xl p-5 text-sm text-zinc-400">
          {t("הזירה אינה זמינה כרגע. נסה לרענן.")}
        </p>
      )}
    </div>
  );
}
