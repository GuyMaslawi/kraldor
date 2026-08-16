import type { ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { bannedWhere } from "@/lib/ban";
import { notBot } from "@/lib/bot";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { GAME_TIMEZONE } from "@/lib/game/constants";
import { formatIls } from "@/lib/game/diamondStore";
import { EconomyBoard } from "@/components/admin/EconomyBoard";

export const dynamic = "force-dynamic";

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="panel rounded-xl p-4 text-center">
      <div className="text-2xl" aria-hidden>
        {icon}
      </div>
      <div className="nums mt-1 truncate text-2xl font-black text-gold-bright" dir="ltr">
        {typeof value === "number" ? value.toLocaleString("he-IL") : value}
      </div>
      <div className="text-xs text-zinc-400">{label}</div>
    </div>
  );
}

export default async function AdminDashboard({
  searchParams,
}: {
  // `?top=` picks the column the balance board is sorted by — see EconomyBoard.
  searchParams: Promise<{ top?: string }>;
}) {
  await requireAdmin();
  const { top } = await searchParams;

  const [
    users,
    admins,
    banned,
    empires,
    bots,
    guilds,
    seasons,
    activeSeason,
    recentUsers,
    recentAudit,
    resources,
    revenue,
  ] = await Promise.all([
    // Bots hold a User row apiece so that `Empire.userId` has something to point
    // at, but they are not people and must not be counted as players — see
    // src/lib/bot.ts. Their own tally gets a card of its own below.
    prisma.user.count({ where: { NOT: { empire: { is: { isBot: true } } } } }),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.count({ where: bannedWhere() }),
    prisma.empire.count({ where: notBot }),
    prisma.empire.count({ where: { isBot: true } }),
    prisma.guild.count(),
    prisma.gameSeason.count(),
    prisma.gameSeason.findFirst({ where: { isActive: true }, select: { name: true } }),
    prisma.user.findMany({
      where: { NOT: { empire: { is: { isBot: true } } } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, name: true, email: true, createdAt: true, empire: { select: { name: true } } },
    }),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, adminEmail: true, summary: true, action: true, createdAt: true },
    }),
    prisma.empire.aggregate({
      _sum: { gold: true, diamonds: true },
    }),
    prisma.diamondPurchase.aggregate({
      where: { status: "PAID", isTest: false },
      _sum: { priceIls: true },
      _count: true,
    }),
  ]);

  return (
    <div className="space-y-6">
      <SectionHeading
        title="לוח בקרה"
        ornament={<Icon name="shield" size={22} className="text-crimson" />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="שחקנים" value={users} icon="👥" />
        <StatCard label="אימפריות" value={empires} icon="🏰" />
        <StatCard label="אדמינים" value={admins} icon="🛡️" />
        <StatCard label="בבאן" value={banned} icon="🚫" />
        <Link href="/admin/bots" className="contents">
          <StatCard label="בוטים" value={bots} icon="🤖" />
        </Link>
        <StatCard label="בריתות" value={guilds} icon="🤝" />
        <StatCard label="עונות" value={seasons} icon="📅" />
        <StatCard label="עונה פעילה" value={activeSeason?.name ?? "—"} icon="⭐" />
        <StatCard
          label='סה"כ יהלומים'
          value={Math.round(resources._sum.diamonds ?? 0)}
          icon={<Icon name="diamond" size={26} className="text-cyan-300" />}
        />
        <Link href="/admin/purchases" className="contents">
          <StatCard
            label="הכנסות"
            value={formatIls(revenue._sum.priceIls ?? 0)}
            icon="💳"
          />
        </Link>
      </div>

      <EconomyBoard sort={top} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel rounded-xl p-4 sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright">
            🆕 הרשמות אחרונות
          </h3>
          <ul className="space-y-2 text-sm">
            {recentUsers.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/admin/users/${u.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg panel-inset px-3 py-2 hover:border-gold/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-zinc-100">
                      {u.empire?.name ?? u.name}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500" dir="ltr">
                      {u.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500 nums" dir="ltr">
                    {u.createdAt.toLocaleDateString("he-IL", { timeZone: GAME_TIMEZONE })}
                  </span>
                </Link>
              </li>
            ))}
            {recentUsers.length === 0 && <li className="text-zinc-500">אין שחקנים עדיין</li>}
          </ul>
        </section>

        <section className="panel rounded-xl p-4 sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright">
            <Icon name="reports" size={18} /> פעולות אדמין אחרונות
          </h3>
          <ul className="space-y-2 text-sm">
            {recentAudit.map((a) => (
              <li key={a.id} className="rounded-lg panel-inset px-3 py-2">
                <div className="text-zinc-200">{a.summary ?? a.action}</div>
                <div className="text-[11px] text-zinc-500" dir="ltr">
                  {a.adminEmail} ·{" "}
                  {a.createdAt.toLocaleString("he-IL", { timeZone: GAME_TIMEZONE })}
                </div>
              </li>
            ))}
            {recentAudit.length === 0 && <li className="text-zinc-500">אין פעולות עדיין</li>}
          </ul>
          <Link href="/admin/audit" className="mt-3 inline-block text-xs text-gold hover:underline">
            לכל היומן →
          </Link>
        </section>
      </div>
    </div>
  );
}
