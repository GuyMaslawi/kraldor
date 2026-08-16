"use client";

import { useActionState } from "react";
import { addGuildMember } from "@/server/actions/guild";
import type { ActionState } from "@/server/actions/game";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon } from "@/components/ui/Icon";
import { useT } from "@/i18n/client";

export interface GuildAddMemberFormProps {
  /** True when every seat is taken — the form disables instead of failing. */
  full: boolean;
  /** The guild's city tier: the only tier it may recruit from. */
  cityLabel: string;
}

/**
 * Leadership recruitment box: a leader or deputy types a guildless player's
 * empire name and sends them an invitation. The player joins themselves — see
 * addGuildMember for why this is no longer a direct add.
 */
export function GuildAddMemberForm({ full, cityLabel }: GuildAddMemberFormProps) {
  const [state, action] = useActionState<ActionState, FormData>(
    addGuildMember,
    {}
  );

  const t = useT();
  return (
    <form action={action} className="mt-4 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label
            htmlFor="add-member-name"
            className="mb-1.5 block text-xs font-semibold text-gold"
          >
            {t("שם האימפריה להזמנה")}
          </label>
          <input
            id="add-member-name"
            name="name"
            type="text"
            required
            maxLength={60}
            disabled={full}
            placeholder={t("שם מדויק של השחקן")}
            className="w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none disabled:opacity-50"
          />
        </div>
        <SubmitButton
          className="btn btn-dark"
          disabled={full}
          pendingText={t("שולח...")}
        >
          <Icon name="citizens" size={14} className="inline-block align-text-bottom text-bone" />{" "}
          {t("שלח הזמנה")}
        </SubmitButton>
      </div>

      <p className="text-[11px] text-zinc-500">
        {full
          ? t("הברית מלאה — הרחב את הקיבולת כדי להזמין עוד שחקנים.")
          : t("מנהיג וסגן יכולים להזמין שחקנים שאינם בברית אחרת, ולהרחיק חברים. ההזמנה נשלחת לתיבת ההודעות והשחקן בוחר אם להצטרף.")}
        {!full &&
          " " +
            t("ניתן להזמין רק שחקנים שנמצאים ב{city}, עיר הברית.", {
              city: cityLabel,
            })}
      </p>

      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}
