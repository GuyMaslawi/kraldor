import { NavLink } from "@/components/ui/NavLink";
import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { HeroForge } from "@/components/game/HeroForge";
import { getForgeState } from "@/server/actions/forge";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("נפחייה | KRALDOR") };
}

/**
 * /game/hero/forge — נפחיית הגיבור.
 *
 * A sub-page of the hero rather than a nav entry of its own: it is only ever
 * reached with gear in hand, and the sidebar is already seventeen rows long.
 * See src/lib/game/forge.ts for what the two benches may and may not do.
 */
export default async function ForgePage() {
  const t = await getT();
  await requireEmpire();
  const state = await getForgeState();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("נפחייה")}
        ornament={<Icon name="factory" size={20} className="text-crimson" />}
      />

      <div className="flex justify-center">
        <NavLink
          href="/game/hero"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-400 transition-colors hover:text-gold-bright"
        >
          <Icon name="hero" size={14} />
          {t("חזרה לגיבור")}
        </NavLink>
      </div>

      {state ? (
        <HeroForge state={state} />
      ) : (
        <p className="panel rounded-xl p-5 text-sm text-zinc-400">
          {t("הנפחייה אינה זמינה כרגע. נסה לרענן.")}
        </p>
      )}
    </div>
  );
}
