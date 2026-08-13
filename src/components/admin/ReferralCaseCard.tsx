"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import {
  REFERRAL_GOAL_CITIES,
  isHardReferralFlag,
  type ReferralCase,
  type ReferralFlag,
  type ReferralParty,
} from "@/lib/game/referral";
import {
  REFERRAL_FLAG_DETAIL,
  REFERRAL_FLAG_LABEL,
} from "@/components/admin/referralFlagMeta";
import { decideReferral } from "@/server/actions/adminReferral";
import type { AdminActionState } from "@/server/actions/admin";

/**
 * One flagged referral, with everything the checks saw.
 *
 * The layout puts the two accounts side by side because that is the shape of
 * the actual question — "are these one person?" is answered by reading two
 * columns against each other, not by reading a verdict. Values that match
 * between the columns are the whole point, so the ones that can match (address,
 * mailbox) are printed verbatim and LTR even where the page is RTL.
 */
export function ReferralCaseCard({ item }: { item: ReferralCase }) {
  const [state, action] = useActionState<AdminActionState, FormData>(
    decideReferral,
    {}
  );

  const tone =
    item.review === "HELD"
      ? "border-amber-700/60 bg-amber-950/15"
      : item.review === "APPROVED"
        ? "border-emerald-800/50 bg-emerald-950/15"
        : "border-red-900/50 bg-red-950/15";

  return (
    <li className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-black text-gold-bright">
          {item.referrer.empireName} <span className="text-zinc-500">→</span>{" "}
          {item.joiner.empireName}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-zinc-500">
          <StatusChip review={item.review} />
          <span dir="ltr">
            {item.referredAt ? item.referredAt.toLocaleString("he-IL") : "—"}
          </span>
          <span>{item.via === "link" ? "קישור" : "הוקלד ידנית"}</span>
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PartyColumn title="המזמין" party={item.referrer} paid={item.referrerPaid} />
        <PartyColumn title="המוזמן" party={item.joiner} paid={item.joinerPaid} />
      </div>

      <p className="mt-3 text-[11px] text-zinc-500">
        {item.earned
          ? `המוזמן הגיע ל-${REFERRAL_GOAL_CITIES} ערים — ההחלטה הזו משחררת (או חוסמת) כסף עכשיו.`
          : `המוזמן עוד לא הגיע ל-${REFERRAL_GOAL_CITIES} ערים, אז שום צד לא יכול לאסוף בכל מקרה.`}
      </p>

      <ul className="mt-3 space-y-1.5">
        {item.flags.length === 0 ? (
          <li className="text-xs text-zinc-500">
            אין סימנים פעילים כרגע — ייתכן שהסימן שהחזיק את ההזמנה כבר לא מתקיים.
          </li>
        ) : (
          item.flags.map((flag) => <FlagRow key={flag} flag={flag} />)
        )}
      </ul>

      <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="empireId" value={item.joiner.empireId} />
        <SubmitButton
          name="verdict"
          value="APPROVED"
          variant="primary"
          className="px-3 py-1.5 text-xs"
        >
          אשר
        </SubmitButton>
        <SubmitButton
          name="verdict"
          value="REJECTED"
          variant="danger"
          className="px-3 py-1.5 text-xs"
        >
          דחה
        </SubmitButton>
        <FormMessage error={state.error} success={state.success} />
      </form>
    </li>
  );
}

function StatusChip({ review }: { review: ReferralCase["review"] }) {
  const label =
    review === "HELD" ? "ממתין" : review === "APPROVED" ? "אושר" : review === "REJECTED" ? "נדחה" : "תקין";
  const tone =
    review === "HELD"
      ? "bg-amber-500/20 text-amber-200"
      : review === "APPROVED"
        ? "bg-emerald-500/20 text-emerald-200"
        : "bg-red-500/20 text-red-200";
  return (
    <span className={`rounded px-1.5 py-px text-[10px] font-black ${tone}`}>
      {label}
    </span>
  );
}

function FlagRow({ flag }: { flag: ReferralFlag }) {
  const hard = isHardReferralFlag(flag);
  return (
    <li className="rounded-lg border border-border-subtle bg-black/25 px-2.5 py-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-px text-[10px] font-black ${
            hard ? "bg-red-600/25 text-red-200" : "bg-amber-500/20 text-amber-200"
          }`}
        >
          {hard ? "חמור" : "לבדיקה"}
        </span>
        <span className="text-xs font-bold text-bone/90">
          {REFERRAL_FLAG_LABEL[flag]}
        </span>
      </span>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        {REFERRAL_FLAG_DETAIL[flag]}
      </p>
    </li>
  );
}

function PartyColumn({
  title,
  party,
  paid,
}: {
  title: string;
  party: ReferralParty;
  paid: boolean;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-black/25 p-2.5">
      <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-zinc-400">
        {title}
        {party.banned && (
          <span className="rounded bg-red-600/25 px-1.5 text-[10px] font-black text-red-200">
            חסום
          </span>
        )}
        {paid && (
          <span className="rounded bg-emerald-500/20 px-1.5 text-[10px] font-black text-emerald-200">
            כבר נאסף
          </span>
        )}
      </p>
      <p className="mt-1 truncate text-sm font-black text-bone/90">
        {party.empireName}
      </p>
      <dl className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
        <Row label="דוא״ל" value={party.email} />
        <Row label="IP הרשמה" value={party.signupIp ?? "—"} />
        <Row label="IP אחרון" value={party.lastLoginIp ?? "—"} />
        <Row label="ערים" value={String(party.cities)} />
        <Row label="נוצר" value={party.joinedAt.toLocaleString("he-IL")} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 truncate font-semibold text-zinc-300" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
