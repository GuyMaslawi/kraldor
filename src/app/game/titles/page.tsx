import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { TitleBoard } from "@/components/game/TitleBoard";
import { getTitlesState } from "@/server/actions/titles";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("תארים | KRALDOR") };
}

/**
 * /game/titles — the line under a player's name.
 *
 * See src/lib/game/titles.ts for why earned and bought titles are kept in
 * separate registers, and why a title is the one thing in the game that is
 * completely safe to sell.
 */
export default async function TitlesPage() {
  const t = await getT();
  await requireEmpire();
  const state = await getTitlesState();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("תארים")}
        ornament={<Icon name="laurel" size={20} className="text-crimson" />}
      />

      {state ? (
        <TitleBoard state={state} />
      ) : (
        <p className="panel rounded-xl p-5 text-sm text-zinc-400">
          {t("התארים אינם זמינים כרגע. נסה לרענן.")}
        </p>
      )}
    </div>
  );
}
