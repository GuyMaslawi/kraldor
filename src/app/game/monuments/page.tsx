import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { Monuments } from "@/components/game/Monuments";
import { getMonumentsState } from "@/server/actions/monuments";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("מונומנטים | KRALDOR") };
}

/**
 * /game/monuments — the capital's skyline, and the endgame's gold sink.
 *
 * See src/lib/game/monuments.ts for why a percentage sink is the only kind that
 * stays worth building, and for the rule that keeps every monument out of the
 * combat calculation.
 */
export default async function MonumentsPage() {
  const t = await getT();
  await requireEmpire();
  const state = await getMonumentsState();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("מונומנטים")}
        ornament={<Icon name="crown" size={20} className="text-crimson" />}
      />

      {state ? (
        <Monuments state={state} />
      ) : (
        <p className="panel rounded-xl p-5 text-sm text-zinc-400">
          {t("המונומנטים אינם זמינים כרגע. נסה לרענן.")}
        </p>
      )}
    </div>
  );
}
