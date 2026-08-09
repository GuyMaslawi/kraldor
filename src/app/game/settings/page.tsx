import type { CSSProperties } from "react";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CardTitle } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { formatDate } from "@/lib/game/format";
import { logout } from "@/server/actions/auth";
import { AccountSecurity } from "@/components/game/AccountSecurity";
import { NotifySettings } from "@/components/game/NotifySettings";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("הגדרות | קראלדור") };
}

export default async function SettingsPage() {
  const empire = await requireEmpire();
  const { t, locale } = await getI18n();

  // Asked as a count rather than a `select: { passwordHash: true }`, so the
  // digest is never loaded into the render at all — the page only ever needed
  // to know whether one exists. `requireEmpire` deliberately does not carry it
  // (see the select there); this is the one screen that asks.
  const hasPassword =
    (await prisma.user.count({
      where: { id: empire.userId, passwordHash: { not: null } },
    })) > 0;

  // The one preference this screen owns that lives on the *user* rather than
  // the empire — see setRaidNotifications for why.
  const account = await prisma.user.findUnique({
    where: { id: empire.userId },
    select: { notifyRaids: true },
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("הגדרות")}
        ornament={<Icon name="settings" size={22} className="text-crimson" />}
      />

      {/* No scene here on purpose: settings is a page you come to in order to
          change one thing and leave. The motion is a mechanism turning behind
          the panels, and the panels themselves settling into place. */}
      <div className="cog-room mx-auto max-w-xl space-y-4">
        <span className="cog-wheel cog-wheel-a" aria-hidden />
        <span className="cog-wheel cog-wheel-b" aria-hidden />

        <div className="panel cog-panel rounded-xl p-4" style={{ "--i": 0 } as CSSProperties}>
          <CardTitle icon="👑">{t("שם האימפריה")}</CardTitle>
          <p className="panel-inset rounded-lg px-3 py-2 text-sm font-bold text-zinc-100">
            {empire.name}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            {t("שם האימפריה נעול למשך העונה ולא ניתן לשינוי.")}
          </p>
        </div>

        <div className="panel cog-panel rounded-xl p-4" style={{ "--i": 1 } as CSSProperties}>
          <CardTitle icon="👤">{t("פרטי חשבון")}</CardTitle>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between border-b border-border-subtle pb-2.5">
              <dt className="text-zinc-400">{t("שם")}</dt>
              <dd className="font-medium text-zinc-100">{empire.user.name}</dd>
            </div>
            <div className="flex justify-between border-b border-border-subtle pb-2.5">
              <dt className="text-zinc-400">{t("אימייל")}</dt>
              <dd dir="ltr" className="nums font-medium text-zinc-100">
                {empire.user.email}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t("האימפריה נוסדה")}</dt>
              <dd className="nums font-medium text-zinc-100" dir="ltr">
                {formatDate(empire.createdAt, locale)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Only a boolean crosses the client boundary — never the hash itself. */}
        <div className="cog-panel" style={{ "--i": 2 } as CSSProperties}>
          <AccountSecurity hasPassword={hasPassword} />
        </div>

        <div className="panel cog-panel rounded-xl p-4" style={{ "--i": 3 } as CSSProperties}>
          <NotifySettings enabled={account?.notifyRaids ?? true} />
        </div>

        <div className="panel-gold cog-panel rounded-xl p-4" style={{ "--i": 4 } as CSSProperties}>
          <CardTitle icon="🚪">{t("התנתקות")}</CardTitle>
          <p className="mb-4 text-sm text-zinc-400">
            {t("התנתקות מהחשבון במכשיר הזה. ההתקדמות שלך נשמרת.")}
          </p>
          <form action={logout}>
            <button
              type="submit"
              className="btn btn-ghost px-4 py-2 text-sm text-red-400"
            >
              <Icon name="logout" size={16} className="inline-block align-text-bottom" /> {t("התנתק מהמשחק")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
