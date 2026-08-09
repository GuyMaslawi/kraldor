"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Meter } from "@/components/ui/Meter";
import { Tip } from "@/components/ui/Tip";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { formatCompact } from "@/lib/game/format";
import { REWARD_ICON, REWARD_LABEL, type Reward } from "@/lib/game/rewards";
import type { ReferralState } from "@/lib/game/referral";
import {
  collectJoinerReward,
  collectReferrerReward,
  nameReferrer,
} from "@/server/actions/referral";
import type { ActionState } from "@/server/actions/game";
import { useT } from "@/i18n/client";

/**
 * /game/referrals — your code, who you brought in, and who brought you.
 *
 * The page has one job the copy has to do rather than the layout: make it
 * obvious that nothing is paid for a *signup*. Both halves are gated on the
 * newcomer reaching their third city, and a player who reads this page
 * expecting a bounty per account should leave understanding why there is not
 * one — otherwise the first thing they try is the thing the design is built to
 * make pointless.
 */
export function ReferralBoard({ state }: { state: ReferralState }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <CodeCard state={state} />
      {(state.mayName || state.referrerName) && <JoinerCard state={state} />}
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

/* ------------------------------ the code ------------------------------ */

function CodeCard({ state }: { state: ReferralState }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // navigator.clipboard is absent over plain HTTP and inside some in-app
    // browsers. The name is on screen either way, so a failure is a silent
    // no-op rather than an error the player has to dismiss.
    void navigator.clipboard?.writeText(state.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      },
      () => {}
    );
  };

  return (
    <section className="panel-gold rounded-2xl p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="gift" size={20} className="text-crimson-bright" />
        {t("הזמן חבר")}
      </h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
        {t("שם האימפריה שלך הוא הקוד. מי שמצטרף מציין אותו בעמוד הזה אצלו, וכששניכם — כשהוא מגיע ל-{goal} ערים — כל אחד מכם אוסף את חלקו. אין פרס על הרשמה בלבד: זה מה שהופך את זה למשהו ששווה לעשות.", {
          goal: state.goalCities,
        })}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 rounded-xl border border-gold/50 bg-black/40 px-4 py-2">
          <Icon name="crown" size={16} className="text-crimson-bright" />
          <span className="text-lg font-black text-gold-bright">{state.code}</span>
        </span>
        <button
          type="button"
          onClick={copy}
          className="btn btn-ghost px-3 py-1.5 text-xs"
        >
          {copied ? t("הועתק!") : t("העתק")}
        </button>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {t("על כל חבר:")}
          <RewardChips rewards={state.referrerReward} />
        </span>
      </div>
    </section>
  );
}

/* ------------------------------ who brought me ------------------------------ */

function JoinerCard({ state }: { state: ReferralState }) {
  const t = useT();
  const [nameState, nameAction] = useActionState<ActionState, FormData>(
    nameReferrer,
    {}
  );
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

      {state.referrerName ? (
        <>
          <p className="mt-1 text-sm text-bone/90">
            {t("הצטרפת דרך {name}.", { name: state.referrerName })}
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
            ) : (
              <span className="text-xs text-zinc-500">
                {t("נפתח ב-{goal} ערים", { goal: state.goalCities })}
              </span>
            )}
          </div>

          <div className="mt-3">
            <FormMessage error={message.error} success={message.success} />
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {t("מישהו הביא אותך לכאן? רשום את שם האימפריה שלו. אפשר פעם אחת בלבד, ורק בתחילת הדרך.")}
          </p>
          <form action={nameAction} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1">
              <span className="mb-1 block text-[11px] font-bold text-zinc-400">
                {t("שם האימפריה שהזמינה אותך")}
              </span>
              <Input name="name" type="text" maxLength={30} autoComplete="off" />
            </label>
            <SubmitButton className="btn btn-dark" pendingText={t("רושם...")}>
              {t("רשום")}
            </SubmitButton>
          </form>
          <div className="mt-3">
            <FormMessage error={nameState.error} success={nameState.success} />
          </div>
        </>
      )}
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
          {t("עדיין לא הבאת אף אחד. שלח את שם האימפריה שלך לחבר.")}
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

  return (
    <li
      className={`rounded-xl border p-3 ${
        invitee.claimed
          ? "border-emerald-800/40 bg-emerald-950/20"
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

      {(state.error || state.success) && (
        <div className="mt-2">
          <FormMessage error={state.error} success={state.success} />
        </div>
      )}
    </li>
  );
}
