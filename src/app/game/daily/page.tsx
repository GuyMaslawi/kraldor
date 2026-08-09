import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { DailyBoard } from "@/components/game/DailyBoard";
import { getDailyState } from "@/server/dailyState";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("לוח היום | KRALDOR") };
}

/**
 * /game/daily — לוח היום.
 *
 * The one screen in the game whose whole content expires. Everything on it is
 * scoped to a Jerusalem calendar day or week: the muster roll, the three daily
 * missions, the three weekly ones, and the guild's contract. Nothing here is
 * cached, and nothing here is prefetched from the nav for that reason.
 *
 * This is also the only page that *opens* a board — see the note at the head of
 * server/dailyState.ts for why that write is confined to one place, and what
 * the nav badge does instead.
 */
export default async function DailyPage() {
  const t = await getT();
  const empire = await requireEmpire();
  const state = await getDailyState(empire.id);

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("לוח היום")}
        ornament={<Icon name="quest" size={20} className="text-crimson" />}
      />

      {state ? (
        <DailyBoard state={state} serverNow={state.serverNow} />
      ) : (
        <p className="panel rounded-xl p-5 text-sm text-zinc-400">
          {t("לוח היום אינו זמין כרגע. נסה לרענן.")}
        </p>
      )}
    </div>
  );
}
