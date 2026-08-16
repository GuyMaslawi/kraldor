import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { GAME_TIMEZONE } from "@/lib/game/constants";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  await requireAdmin();

  const entries = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        title="יומן פעולות"
        ornament={<Icon name="reports" size={22} className="text-crimson" />}
      />
      <p className="text-xs text-zinc-500">מציג {entries.length} רשומות אחרונות.</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-right text-[11px] uppercase tracking-wider text-gold-dim">
              <th className="p-2 font-semibold">זמן</th>
              <th className="p-2 font-semibold">אדמין</th>
              <th className="p-2 font-semibold">פעולה</th>
              <th className="p-2 font-semibold">תיאור</th>
              <th className="p-2 font-semibold">יעד</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border-subtle/50">
                <td className="p-2 text-[11px] text-zinc-500 nums" dir="ltr">
                  {e.createdAt.toLocaleString("he-IL", { timeZone: GAME_TIMEZONE })}
                </td>
                <td className="p-2 text-[11px] text-zinc-400" dir="ltr">
                  {e.adminEmail}
                </td>
                <td className="p-2">
                  <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-mono text-gold-dim" dir="ltr">
                    {e.action}
                  </span>
                </td>
                <td className="p-2 text-zinc-200">{e.summary ?? "—"}</td>
                <td className="p-2 text-[11px]">
                  {e.targetType === "user" || e.targetType === "empire" ? (
                    e.targetId ? (
                      <span className="text-zinc-500" dir="ltr">
                        {e.targetType}:{e.targetId.slice(0, 8)}
                      </span>
                    ) : (
                      "—"
                    )
                  ) : (
                    <span className="text-zinc-500" dir="ltr">
                      {e.targetType ?? "—"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-zinc-500">
                  אין פעולות מתועדות עדיין
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Link href="/admin" className="inline-block text-xs text-gold hover:underline">
        ← חזרה ללוח הבקרה
      </Link>
    </div>
  );
}
