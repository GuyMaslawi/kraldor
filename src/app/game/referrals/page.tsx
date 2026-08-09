import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { ReferralBoard } from "@/components/game/ReferralBoard";
import { getReferralState } from "@/server/actions/referral";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("הזמנת חברים | KRALDOR") };
}

/**
 * /game/referrals — the one growth loop the game can run without a budget.
 *
 * See src/lib/game/referral.ts for why the referrer is named here rather than
 * on the sign-up form, and why nothing is paid until the newcomer's third city.
 */
export default async function ReferralsPage() {
  const t = await getT();
  await requireEmpire();
  const state = await getReferralState();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("הזמנת חברים")}
        ornament={<Icon name="gift" size={20} className="text-crimson" />}
      />

      {state ? (
        <ReferralBoard state={state} />
      ) : (
        <p className="panel rounded-xl p-5 text-sm text-zinc-400">
          {t("העמוד אינו זמין כרגע. נסה לרענן.")}
        </p>
      )}
    </div>
  );
}
