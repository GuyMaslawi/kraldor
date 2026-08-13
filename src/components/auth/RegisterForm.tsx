"use client";

import { useActionState } from "react";
import Link from "next/link";
import { register, type AuthState } from "@/server/actions/auth";
import { Input } from "@/components/ui/Input";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon } from "@/components/ui/Icon";
import { GoogleSignInButton, AuthDivider } from "@/components/auth/GoogleSignInButton";
import { HeroClassPicker } from "@/components/auth/HeroClassPicker";
import { SupportPrompt } from "@/components/support/SupportPrompt";
import { useT } from "@/i18n/client";

export function RegisterForm({
  /**
   * The empire whose invite link brought this visitor here, if any.
   *
   * A banner rather than a form field, and read-only, because the link is not
   * something the registrant chooses: it was resolved from the cookie `/r/<code>`
   * parked, and it is attached server-side once the empire exists. An editable
   * "who invited you" input would be a fifth field on the most abandoned screen
   * in any game, and one anybody could put any name into.
   */
  invitedBy = null,
}: {
  invitedBy?: string | null;
}) {
  const [state, action] = useActionState<AuthState, FormData>(register, {});

  const t = useT();
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-zinc-100">{t("הקמת אימפריה חדשה")}</h2>
      {invitedBy && (
        <p className="flex items-center gap-2 rounded-xl border border-gold/45 bg-gold/8 px-3 py-2 text-sm text-bone/90">
          <Icon name="gift" size={16} className="shrink-0 text-crimson-bright" />
          <span>
            {t("הוזמנת על ידי {name}. שניכם תקבלו פרס כשתגיע ל-3 ערים.", {
              name: invitedBy,
            })}
          </span>
        </p>
      )}
      <GoogleSignInButton />
      <AuthDivider />
      <form action={action} className="space-y-4">
        {/* Four short fields in one column made the panel taller than the
            viewport on a laptop and pushed the class picker — the one thing on
            this screen worth looking at — under the fold. The shell is already
            wide for the picker, so the pairs share its width: who you are on
            one row, how you sign in on the next. Single column below sm. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t("השם שלך")}
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={40}
            placeholder={t("למשל: דוד")}
          />
          <Input
            label={t("שם האימפריה")}
            name="empireName"
            type="text"
            required
            minLength={2}
            maxLength={40}
            placeholder={t("למשל: ממלכת הברזל")}
          />
          <Input
            label={t("אימייל")}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            dir="ltr"
          />
          <Input
            label={t("סיסמה")}
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t("לפחות 8 תווים")}
            dir="ltr"
          />
        </div>
        <HeroClassPicker />
        <FormMessage error={state.error} />
        <SubmitButton className="w-full" pendingText={t("מקים אימפריה...")}>
          {t("הקם אימפריה")}{" "}
          <Icon name="crown" size={16} className="inline-block align-text-bottom" />
        </SubmitButton>
      </form>
      <p className="text-center text-sm text-zinc-400">
        {t("כבר יש לך אימפריה?")}{" "}
        <Link href="/login" className="font-semibold text-gold hover:text-gold-bright">
          {t("התחבר")}
        </Link>
      </p>
      {/* A registration that will not go through is a player lost before they
          ever saw the game — and the taken-name / rejected-address refusals are
          the ones that are worth a human's five seconds. */}
      <SupportPrompt error={state.error} where={t("מסך ההרשמה")} />
    </div>
  );
}
