import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { banLabel, isBanned } from "@/lib/ban";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { formatNumber } from "@/lib/game/format";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  // One clock for the whole table, so two rows never disagree about an expiry
  // that lapsed mid-render.
  const now = new Date();

  const users = await prisma.user.findMany({
    where: {
      // Real players only. A bot is a planted garrison, not an account anybody
      // administers from here — everything about it (planting, re-arming,
      // deleting) lives on /admin/bots, and its synthetic user row would only
      // pad this table and the count under it. Written as a `NOT … is` on the
      // relation rather than `empire: { isBot: false }` so that a user with no
      // empire at all still shows up.
      NOT: { empire: { is: { isBot: true } } },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { empire: { name: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      bannedAt: true,
      bannedUntil: true,
      empire: {
        select: { name: true, level: true, gold: true, diamonds: true, turns: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        title="שחקנים"
        ornament={<Icon name="citizens" size={22} className="text-crimson" />}
      />

      <form className="flex gap-2" action="/admin/users">
        <input
          name="q"
          defaultValue={query}
          placeholder="חיפוש לפי שם, אימייל או שם אימפריה…"
          className="flex-1 rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none focus:border-gold/60"
        />
        <button type="submit" className="btn btn-gold px-4 py-2 text-sm">
          חיפוש
        </button>
        {query && (
          <Link href="/admin/users" className="btn btn-ghost px-4 py-2 text-sm">
            ניקוי
          </Link>
        )}
      </form>

      <p className="text-xs text-zinc-500">
        מציג {users.length} שחקנים{users.length >= 200 ? " (מוגבל ל-200 — צמצם עם חיפוש)" : ""}.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-right text-[11px] uppercase tracking-wider text-gold-dim">
              <th className="p-2 font-semibold">אימפריה</th>
              <th className="p-2 font-semibold">משתמש</th>
              <th className="p-2 font-semibold">רמה</th>
              <th className="p-2 font-semibold">זהב</th>
              <th className="p-2 font-semibold">יהלומים</th>
              <th className="p-2 font-semibold">תורות</th>
              <th className="p-2 font-semibold">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="border-b border-border-subtle/50 transition-colors hover:bg-white/5"
              >
                <td className="p-2">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="font-bold text-gold-bright hover:underline"
                  >
                    {u.empire?.name ?? "— ללא אימפריה —"}
                  </Link>
                </td>
                <td className="p-2">
                  <div className="text-zinc-200">{u.name}</div>
                  <div className="text-[11px] text-zinc-500" dir="ltr">
                    {u.email}
                  </div>
                </td>
                <td className="p-2 nums text-zinc-300" dir="ltr">
                  {u.empire?.level ?? "—"}
                </td>
                <td className="p-2 nums text-zinc-300" dir="ltr">
                  {u.empire ? formatNumber(u.empire.gold) : "—"}
                </td>
                <td className="p-2 nums text-zinc-300" dir="ltr">
                  {u.empire ? formatNumber(u.empire.diamonds) : "—"}
                </td>
                <td className="p-2 nums text-zinc-300" dir="ltr">
                  {u.empire?.turns ?? "—"}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {u.role === "ADMIN" && (
                      <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-gold-bright">
                        אדמין
                      </span>
                    )}
                    {isBanned(u, now) ? (
                      <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                        {banLabel(u, now)}
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                        פעיל
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-zinc-500">
                  לא נמצאו שחקנים
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
