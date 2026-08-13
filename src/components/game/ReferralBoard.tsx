"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { Meter } from "@/components/ui/Meter";
import { Tip } from "@/components/ui/Tip";
import { FormMessage } from "@/components/ui/FormMessage";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { formatCompact } from "@/lib/game/format";
import { REWARD_ICON, REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import type { ReferralState, ReferralStanding } from "@/lib/game/referral";
import {
  collectJoinerReward,
  collectReferrerReward,
} from "@/server/actions/referral";
import type { ActionState } from "@/server/actions/game";
import { useT } from "@/i18n/client";

/**
 * /game/referrals — your link and who you brought in.
 *
 * There is no "name the player who invited you" form: the link binds the
 * referrer at sign-up and that is the only way a bond is made. A newcomer who
 * arrived through one still gets a card here to collect their own half, so the
 * joiner reward is never stranded — it just is not something they can declare.
 *
 * The page has one job the copy has to do rather than the layout: make it
 * obvious that nothing is paid for a *signup*. Both halves are gated on the
 * newcomer reaching their third city, and a player who reads this page
 * expecting a bounty per account should leave understanding why there is not
 * one — otherwise the first thing they try is the thing the design is built to
 * make pointless.
 *
 * The second thing it must not do is explain the fraud checks. A referral that
 * is held for review says so, in one line, with no reason: naming the signal
 * would turn this screen into a place to test the checks against, and the
 * honest player whose brother plays too could do nothing with the detail
 * anyway. See src/server/referralGuard.ts.
 */
export function ReferralBoard({ state }: { state: ReferralState }) {
  return (
    <div className="space-y-6">
      <CodeCard state={state} />
      {state.referrerName && (
        <JoinerCard state={state} referrerName={state.referrerName} />
      )}
      <InviteeList state={state} />
    </div>
  );
}

/** A purse as a row of chips — the same treatment the daily board uses. */
function RewardChips({ rewards }: { rewards: readonly Reward[] }) {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {rewards.map((r) => (
        <Tip key={r.kind} tip={t(REWARD_LABEL[r.kind])}>
          <span
            className="inline-flex items-center gap-1 rounded border border-border-subtle bg-black/30 px-1.5 text-[11px] font-bold nums text-bone/90"
            dir="ltr"
          >
            <Icon name={REWARD_ICON[r.kind]} size={11} />
            {formatCompact(r.amount)}
          </span>
        </Tip>
      ))}
    </span>
  );
}

/**
 * "Waiting on a check" / "not approved", and nothing more specific.
 *
 * One component so the wording cannot drift between the two sides of a
 * referral: the newcomer and the referrer must be told the same thing about the
 * same link, or the first thing they do is compare screens and conclude one of
 * them is being cheated.
 */
function StandingNote({ standing }: { standing: ReferralStanding }) {
  const t = useT();
  if (standing === "ok") return null;
  const held = standing === "held";
  return (
    <p
      className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
        held
          ? "border-amber-700/50 bg-amber-950/25 text-amber-200/90"
          : "border-red-900/50 bg-red-950/25 text-red-200/90"
      }`}
    >
      {held
        ? t("ההזמנה הזו ממתינה לבדיקה של הצוות. הפרס נשמר עד שתאושר.")
        : t("ההזמנה הזו לא אושרה. אם לדעתך זו טעות, פנה לתמיכה.")}
    </p>
  );
}

/* ------------------------------ the link ------------------------------ */

function CodeCard({ state }: { state: ReferralState }) {
  const t = useT();
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const copy = (what: "link" | "code") => {
    const text = what === "link" ? state.link : state.code;
    // navigator.clipboard is absent over plain HTTP and inside some in-app
    // browsers. Both values are on screen either way, so a failure is a silent
    // no-op rather than an error the player has to dismiss.
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(null), 2_000);
      },
      () => {}
    );
  };

  const pitch = t("בוא לשחק איתי בקראלדור — הקם אימפריה, כבוש ערים ותפוס מקום בטבלה: {link}", {
    link: state.link,
  });

  return (
    <section className="panel-gold rounded-2xl p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="gift" size={20} className="text-crimson-bright" />
        {t("הזמן חבר")}
      </h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
        {t("שלח את הקישור שלך. מי שנרשם דרכו נקשר אליך אוטומטית, וכשהוא מגיע ל-{goal} ערים כל אחד מכם אוסף את חלקו. אין פרס על הרשמה בלבד: זה מה שהופך את זה למשהו ששווה לעשות.", {
          goal: state.goalCities,
        })}
      </p>

      {/* The link is the product of this screen, so it gets the whole row and an
          LTR box of its own — a URL laid out RTL is unreadable, and it breaks
          mid-path on a phone if it is not allowed to overflow-scroll. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto rounded-xl border border-gold/50 bg-black/40 px-3 py-2"
          dir="ltr"
        >
          <Icon name="link" size={15} className="shrink-0 text-crimson-bright" />
          <span className="whitespace-nowrap text-sm font-bold text-gold-bright">
            {state.link}
          </span>
        </span>
        <button
          type="button"
          onClick={() => copy("link")}
          className="btn btn-gold shrink-0 px-3 py-2 text-xs"
        >
          {copied === "link" ? t("הועתק!") : t("העתק קישור")}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(pitch)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-ghost shrink-0 gap-1.5 px-3 py-2 text-xs"
        >
          <Icon name="share" size={13} />
          {t("שתף")}
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span className="flex items-center gap-2">
          {t("או תן לו את הקוד:")}
          <button
            type="button"
            onClick={() => copy("code")}
            className="rounded border border-border-subtle bg-black/30 px-2 py-0.5 font-black tracking-[0.2em] text-bone/90 hover:text-gold-bright"
            dir="ltr"
          >
            {copied === "code" ? t("הועתק!") : state.code}
          </button>
        </span>
        <span className="flex items-center gap-2">
          {t("על כל חבר:")}
          <RewardChips rewards={state.referrerReward} />
        </span>
      </div>

      {state.paidThisSeason > 0 && (
        <p className="mt-2 text-[11px] nums text-zinc-500" dir="rtl">
          {t("נאספו {paid} מתוך {cap} הזמנות לעונה הזו.", {
            paid: state.paidThisSeason,
            cap: state.seasonCap,
          })}
        </p>
      )}
    </section>
  );
}

/* ------------------------------ who brought me ------------------------------ */

function JoinerCard({
  state,
  referrerName,
}: {
  state: ReferralState;
  referrerName: string;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  const collect = () => {
    setMessage({});
    startTransition(async () => {
      const result = await collectJoinerReward();
      setMessage({ error: result.error, success: result.success });
    });
  };

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="hero" size={19} className="text-crimson-bright" />
        {t("מי הזמין אותך")}
      </h3>

      <p className="mt-1 text-sm text-bone/90">
        {t("הצטרפת דרך {name}.", { name: referrerName })}
      </p>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2 text-[11px] font-semibold">
          <span className="text-zinc-400">{t("ההתקדמות שלך")}</span>
          <span className="nums text-gold-bright" dir="ltr">
            {state.cities}/{state.goalCities} {t("ערים")}
          </span>
        </div>
        <Meter
          value={Math.min(state.cities, state.goalCities)}
          max={state.goalCities}
          tone="xp"
          className="mt-1 w-full"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <RewardChips rewards={state.joinerReward} />
        {state.joinerClaimed ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300">
            <Icon name="check" size={15} />
            {t("נאסף")}
          </span>
        ) : state.joinerClaimable ? (
          <button
            type="button"
            onClick={collect}
            disabled={pending}
            className="btn btn-gold px-4 py-2 text-sm disabled:opacity-60"
          >
            {pending ? t("אוסף…") : t("אסוף")}
          </button>
        ) : state.standing === "ok" ? (
          <span className="text-xs text-zinc-500">
            {t("נפתח ב-{goal} ערים", { goal: state.goalCities })}
          </span>
        ) : null}
      </div>

      <StandingNote standing={state.standing} />

      <div className="mt-3">
        <FormMessage error={message.error} success={message.success} />
      </div>
    </section>
  );
}

/* ------------------------------ who I brought ------------------------------ */

function InviteeList({ state }: { state: ReferralState }) {
  const t = useT();
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="citizens" size={19} className="text-crimson-bright" />
        {t("החברים שהבאת")}
        {state.collectable > 0 && (
          <span className="rounded bg-gold px-1.5 text-[10px] font-black nums text-black">
            {state.collectable}
          </span>
        )}
      </h3>

      {state.invitees.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border-subtle bg-black/25 px-3 py-3 text-sm text-zinc-500">
          {t("עדיין לא הבאת אף אחד. שלח את הקישור שלך לחבר.")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {state.invitees.map((invitee) => (
            <InviteeRow
              key={invitee.empireId}
              invitee={invitee}
              goal={state.goalCities}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteeRow({
  invitee,
  goal,
}: {
  invitee: ReferralState["invitees"][number];
  goal: number;
}) {
  const t = useT();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    collectReferrerReward,
    {}
  );
  const blocked = invitee.standing !== "ok";

  return (
    <li
      className={`rounded-xl border p-3 ${
        invitee.claimed
          ? "border-emerald-800/40 bg-emerald-950/20"
          : blocked
            ? "border-border-subtle bg-black/25"
            : invitee.earned
              ? "border-gold/60 bg-gold/8"
              : "border-border-subtle bg-black/25"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <PlayerLink
            empireId={invitee.empireId}
            name={invitee.empireName}
            className="truncate font-bold"
          />
          <span className="shrink-0 text-[11px] font-bold nums text-zinc-500" dir="ltr">
            {invitee.cities}/{goal} {t("ערים")}
          </span>
        </span>

        {invitee.claimed ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
            <Icon name="check" size={14} />
            {t("נאסף")}
          </span>
        ) : blocked ? (
          <span
            className={`text-[11px] font-bold ${
              invitee.standing === "held" ? "text-amber-300/90" : "text-red-300/80"
            }`}
          >
            {invitee.standing === "held" ? t("בבדיקה") : t("לא אושר")}
          </span>
        ) : invitee.earned ? (
          <form action={action}>
            <input type="hidden" name="empireId" value={invitee.empireId} />
            <button
              type="submit"
              disabled={pending}
              className="btn btn-gold px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {pending ? t("אוסף…") : t("אסוף")}
            </button>
          </form>
        ) : (
          <span className="text-[11px] text-zinc-600">
            {t("ממתין ל-{goal} ערים", { goal })}
          </span>
        )}
      </div>

      <StandingNote standing={invitee.standing} />

      {(state.error || state.success) && (
        <div className="mt-2">
          <FormMessage error={state.error} success={state.success} />
        </div>
      )}
    </li>
  );
}
