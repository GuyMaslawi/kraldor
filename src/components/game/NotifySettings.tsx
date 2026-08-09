"use client";

import { useState, useTransition } from "react";
import { CardTitle } from "@/components/ui/Card";
import { FormMessage } from "@/components/ui/FormMessage";
import { setRaidNotifications } from "@/server/actions/notify";
import { useT } from "@/i18n/client";

/**
 * The one switch for the only unprompted mail the game sends.
 *
 * A checkbox that saves on change rather than a form with a button: it is a
 * single boolean, and a settings screen that makes you press "save" for one
 * toggle is a settings screen people leave without saving.
 *
 * The optimistic flip is deliberate and safe — the switch is cosmetic until the
 * server agrees, and if it refuses the state is put back and the reason shown.
 * Nothing downstream depends on this being right for the few hundred
 * milliseconds in between.
 */
export function NotifySettings({ enabled }: { enabled: boolean }) {
  const t = useT();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setError(null);
    setOn(next);
    startTransition(async () => {
      const result = await setRaidNotifications(next);
      if (result.error) {
        setOn(!next);
        setError(result.error);
      }
    });
  };

  return (
    <>
      <CardTitle icon="✉️">{t("התראות במייל")}</CardTitle>
      <p className="mb-3 text-sm leading-relaxed text-zinc-400">
        {t("מייל קצר כשמישהו פורץ את ההגנות שלך, שולח תא חבלה או נתפס מרגל בשטחך — כדי שתדע גם כשאתה לא במשחק. לכל היותר מייל אחד ב-6 שעות, והוא לא מפרט מה נלקח.")}
      </p>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 accent-[var(--gold)]"
        />
        <span className="text-sm font-bold text-bone">
          {on ? t("התראות פעילות") : t("התראות כבויות")}
        </span>
      </label>

      {error && (
        <div className="mt-3">
          <FormMessage error={error} />
        </div>
      )}
    </>
  );
}
