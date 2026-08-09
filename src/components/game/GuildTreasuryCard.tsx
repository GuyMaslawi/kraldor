"use client";

import { useActionState, useState } from "react";
import { donateToGuild } from "@/server/actions/guild";
import { GUILD_DONATION_MIN } from "@/lib/game/guild";
import type { ActionState } from "@/server/actions/game";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Tip } from "@/components/ui/Tip";
import { PlayerLink } from "@/components/ui/PlayerLink";
import { formatNumber, formatCompact } from "@/lib/game/format";
import { useT } from "@/i18n/client";

/** One row of the contribution board. */
export interface GuildContributor {
  empireId: string;
  empireName: string;
  donated: number;
  /** The viewer — their own row is marked rather than hidden. */
  isMe: boolean;
}

/**
 * אוצר הברית — the till, the donation form and the contribution board.
 *
 * The board is the point, not the balance. A treasury with an anonymous number
 * on it is a tip jar; a treasury that names who filled it is the thing members
 * actually talk about, and talking to each other is what keeps a guild alive
 * between seasons.
 *
 * Note what is deliberately absent: a withdraw button. Gold that goes in
 * belongs to the guild — the leadership decides what it *buys*, not who gets it
 * back — so there is no control here that could empty the till into a pocket.
 * The server enforces that by simply having no such action.
 */
export function GuildTreasuryCard({
  treasury,
  availableGold,
  contributors,
}: {
  treasury: number;
  /** The viewer's own spendable gold — the donation comes out of it. */
  availableGold: number;
  /** Every member who has given anything, largest first. */
  contributors: GuildContributor[];
}) {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(
    donateToGuild,
    {}
  );
  const [amount, setAmount] = useState("");

  // The quick amounts a player actually reaches for, filtered to what they can
  // afford — an offer to donate ten million when you hold four is not an offer.
  const presets = [10_000, 100_000, 1_000_000, 10_000_000].filter(
    (value) => value <= availableGold
  );

  return (
    <div className="panel rounded-xl p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
          <Icon name="bank" size={18} className="text-gold-bright" />
          {t("אוצר הברית")}
        </h2>
        <Tip tip={t("הזהב שנתרם על ידי חברי הברית — ממנו משולמים שדרוגי הברית")}>
          <span
            className="nums flex items-center gap-1 rounded-full border border-gold/40 bg-panel-inset px-3 py-1 text-xs font-black text-gold-bright"
            dir="ltr"
          >
            {formatNumber(Math.floor(treasury))}{" "}
            <Icon name="gold" size={13} className="text-gold-bright" />
          </span>
        </Tip>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">
        {t("כל חבר יכול לתרום זהב. מנהיג או סגן קונים מהאוצר את שדרוגי הברית. אין משיכה — מה שנכנס נשאר של הברית.")}
      </p>

      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[10rem]">
          <span className="mb-1 block text-[11px] font-bold text-zinc-400">
            {t("סכום לתרומה (מינימום {min})", {
              min: formatCompact(GUILD_DONATION_MIN),
            })}
          </span>
          <Input
            name="amount"
            type="number"
            inputMode="numeric"
            min={GUILD_DONATION_MIN}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            dir="ltr"
            className="nums"
            placeholder={String(GUILD_DONATION_MIN)}
          />
        </label>
        <SubmitButton className="btn btn-dark" pendingText={t("תורם...")}>
          {t("תרום")}
        </SubmitButton>
      </form>

      {presets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(String(value))}
              className="btn btn-ghost px-2.5 py-1 text-[11px] nums"
            >
              {formatCompact(value)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAmount(String(Math.floor(availableGold)))}
            className="btn btn-ghost px-2.5 py-1 text-[11px]"
          >
            {t("הכל")}
          </button>
        </div>
      )}

      <div className="mt-3">
        <FormMessage error={state.error} success={state.success} />
      </div>

      {/* The board. Every member who has given anything, largest first — the
          one number in the guild that says who carried it. */}
      <h3 className="mt-4 mb-2 flex items-center gap-2 text-sm font-bold text-gold-bright">
        <Icon name="rankings" size={15} className="text-crimson" />
        {t("תורמי הברית")}
      </h3>
      {contributors.length === 0 ? (
        <p className="rounded-lg border border-border-subtle bg-black/25 px-3 py-2 text-xs text-zinc-500">
          {t("איש עדיין לא תרם. תהיה הראשון.")}
        </p>
      ) : (
        <ol className="space-y-1">
          {contributors.map((member, index) => (
            <li
              key={member.empireId}
              className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                member.isMe
                  ? "border border-gold/40 bg-gold/8"
                  : "border border-transparent bg-black/20"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-center font-black nums text-zinc-600">
                  {index + 1}
                </span>
                <PlayerLink
                  empireId={member.empireId}
                  name={member.empireName}
                  className="truncate font-bold"
                />
              </span>
              <span className="shrink-0 font-bold nums text-gold" dir="ltr">
                {formatCompact(member.donated)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
