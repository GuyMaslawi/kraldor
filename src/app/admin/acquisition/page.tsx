import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getAcquisitionReport, getCreativeBreakdown } from "@/server/acquisition";

export const dynamic = "force-dynamic";

export const metadata = { title: "רכישת שחקנים | ניהול" };

/** The windows the report can be read over. */
const WINDOWS = [7, 14, 30, 90] as const;
const DEFAULT_WINDOW = 30;

/** `12 / 48` → `25%`. Shows a dash rather than 0% when nothing is eligible. */
function pct(n: number, of: number): string {
  if (of <= 0) return "—";
  return `${Math.round((n / of) * 100)}%`;
}

/**
 * A retention cell, coloured by whether the number is good enough to keep
 * spending on. The thresholds are the ones in docs/marketing/campaign.md — 10%
 * D7 is the line under which the advice is to stop the media and fix the first
 * week of the game instead.
 *
 * A rate over a denominator smaller than five is drawn grey whatever its value:
 * three out of four is 75% and means nothing at all, and colouring it green
 * would invite exactly the decision this report exists to prevent.
 */
function Rate({ n, of, good, weak }: { n: number; of: number; good: number; weak: number }) {
  const rate = of > 0 ? n / of : 0;
  const tone =
    of < 5
      ? "text-zinc-500"
      : rate >= good
        ? "text-emerald-400"
        : rate >= weak
          ? "text-amber-300"
          : "text-red-400";
  return (
    <span className={`nums font-bold ${tone}`} dir="ltr" title={`${n} / ${of}`}>
      {pct(n, of)}
    </span>
  );
}

/**
 * /admin/acquisition — where the advertising money went and what it brought.
 *
 * Every row is a first-touch campaign label (see src/lib/attribution.ts), and
 * the untagged row at the bottom is organic traffic: word of mouth, Discord,
 * direct, and everyone who arrived before any of this was measured.
 *
 * The screen deliberately shows no cost and no CPA. Spend lives in the ad
 * platform, changes hourly, and copying it into a second place is how two
 * numbers start disagreeing; the honest division is done once, by hand, at the
 * end of a campaign. What this side of the join owns is the half the ad platform
 * cannot see — founded, d1, d7 — and that is all it reports.
 */
export default async function AdminAcquisitionPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAdmin();

  const raw = Number((await searchParams).days);
  const days = (WINDOWS as readonly number[]).includes(raw) ? raw : DEFAULT_WINDOW;

  const [report, creatives] = await Promise.all([
    getAcquisitionReport(days),
    getCreativeBreakdown(days),
  ]);

  return (
    <div className="space-y-6">
      <SectionHeading title="רכישת שחקנים" ornament="📈" />

      <p className="panel-inset rounded-xl p-4 text-sm leading-relaxed text-zinc-400">
        כל שורה כאן היא קמפיין — התיוג שהיה על הקישור שדרכו החשבון הגיע, נשמר
        במגע הראשון ולא מוחלף אחר כך. השורה בלי תיוג היא תנועה אורגנית: דיסקורד,
        חבר שסיפר לחבר, כניסה ישירה, וכל מי שנרשם לפני שהמדידה הזו הייתה קיימת.
        <br />
        <span className="font-bold text-bone/90">
          המספר שמחליט אם להמשיך לשפוך תקציב הוא D7, לא כמות הנרשמים.
        </span>{" "}
        קריאייטיב זול שמביא 200 נרשמים עם D7 של 5% שווה פחות מקריאייטיב יקר
        שמביא 60 עם D7 של 30%. מתחת ל-10% העצה היא לעצור את המדיה ולתקן את השבוע
        הראשון במשחק — לא את המודעה.
        <br />
        אחוזי החזרה מחושבים רק על מי שכבר הספיק להגיע לנקודה: מי שנרשם אתמול לא
        נספר כמי ש״לא חזר ביום 7״. לכן המכנה מופיע לצד כל אחוז, ואחוז שמחושב על
        פחות מ-5 חשבונות נצבע אפור בכוונה.
        <br />
        עלות לא מוצגת כאן — היא חיה בפאנל של Meta ומשתנה כל שעה. החלוקה נעשית
        ידנית בסוף קמפיין, מול <Link href="/admin/purchases" className="font-semibold text-gold hover:text-gold-bright">רכישות והכנסות</Link>.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-zinc-500">חלון:</span>
        {WINDOWS.map((w) => (
          <Link
            key={w}
            href={`/admin/acquisition?days=${w}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
              w === days
                ? "border-gold/60 bg-gold/12 text-gold-bright"
                : "border-border-subtle text-zinc-400 hover:border-gold/40 hover:text-gold-bright"
            }`}
          >
            {w} ימים
          </Link>
        ))}
      </div>

      {report.truncated && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-bold text-amber-200">
          החלון הזה חרג מתקרת הדוח — המספרים למטה הם חלק מהתקופה, לא כולה. קצרו
          את החלון.
        </p>
      )}

      {report.rows.length === 0 ? (
        <p className="panel rounded-xl p-5 text-sm text-zinc-500">
          אין הרשמות בחלון הזה.
        </p>
      ) : (
        <div className="panel overflow-x-auto rounded-xl">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-right text-[11px] font-bold text-zinc-500">
                <th className="px-3 py-2">קמפיין</th>
                <th className="px-3 py-2">נרשמו</th>
                <th className="px-3 py-2">אימתו</th>
                <th className="px-3 py-2">הקימו אימפריה</th>
                <th className="px-3 py-2">D1</th>
                <th className="px-3 py-2">D7</th>
                <th className="px-3 py-2">פעילים ‎72ש׳</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => {
                const key = `${r.source}|${r.medium}|${r.campaign}`;
                const untagged = !r.source && !r.medium && !r.campaign;
                return (
                  <tr
                    key={key}
                    className="border-b border-border-subtle/50 last:border-0"
                  >
                    <td className="px-3 py-2">
                      {untagged ? (
                        <span className="font-bold text-zinc-400">אורגני / ללא תיוג</span>
                      ) : (
                        <>
                          <span className="font-bold text-gold-bright" dir="ltr">
                            {r.source ?? "?"}
                          </span>
                          <span className="block text-[11px] text-zinc-500" dir="ltr">
                            {[r.medium, r.campaign].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="nums px-3 py-2 font-bold text-zinc-100" dir="ltr">
                      {r.signups}
                    </td>
                    <td className="nums px-3 py-2 text-zinc-300" dir="ltr">
                      {r.verified}
                      <span className="mr-1 text-[11px] text-zinc-600">
                        {pct(r.verified, r.signups)}
                      </span>
                    </td>
                    <td className="nums px-3 py-2 text-zinc-300" dir="ltr">
                      {r.founded}
                      <span className="mr-1 text-[11px] text-zinc-600">
                        {pct(r.founded, r.signups)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Rate n={r.d1} of={r.d1Eligible} good={0.35} weak={0.2} />
                      <span className="nums mr-1 text-[11px] text-zinc-600" dir="ltr">
                        {r.d1}/{r.d1Eligible}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Rate n={r.d7} of={r.d7Eligible} good={0.2} weak={0.1} />
                      <span className="nums mr-1 text-[11px] text-zinc-600" dir="ltr">
                        {r.d7}/{r.d7Eligible}
                      </span>
                    </td>
                    <td className="nums px-3 py-2 font-bold text-emerald-300" dir="ltr">
                      {r.active}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gold/25 bg-black/20 text-sm font-bold">
                <td className="px-3 py-2 text-zinc-300">סה״כ</td>
                <td className="nums px-3 py-2 text-zinc-100" dir="ltr">
                  {report.totals.signups}
                </td>
                <td className="nums px-3 py-2 text-zinc-300" dir="ltr">
                  {report.totals.verified}
                </td>
                <td className="nums px-3 py-2 text-zinc-300" dir="ltr">
                  {report.totals.founded}
                </td>
                <td className="px-3 py-2">
                  <Rate
                    n={report.totals.d1}
                    of={report.totals.d1Eligible}
                    good={0.35}
                    weak={0.2}
                  />
                </td>
                <td className="px-3 py-2">
                  <Rate
                    n={report.totals.d7}
                    of={report.totals.d7Eligible}
                    good={0.2}
                    weak={0.1}
                  />
                </td>
                <td className="nums px-3 py-2 text-emerald-300" dir="ltr">
                  {report.totals.active}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* -------- which creative -------- */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-gold-bright">לפי קריאייטיב</h2>
        <p className="text-xs text-zinc-500">
          התג <code className="text-zinc-400">utm_content</code> — התמונה או
          הווידאו עצמם. זה מה שמחליט לאיזה קריאייטיב להעביר את התקציב שנשאר.
        </p>
        {creatives.length === 0 ? (
          <p className="panel rounded-xl p-4 text-sm text-zinc-500">
            אף הרשמה בחלון הזה לא הגיעה עם תיוג קריאייטיב.
          </p>
        ) : (
          <ul className="panel divide-y divide-border-subtle/50 rounded-xl">
            {creatives.map((c) => (
              <li key={c.content} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm text-zinc-200" dir="ltr">
                  {c.content}
                </span>
                <span className="nums text-sm font-bold text-gold-bright" dir="ltr">
                  {c.signups}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
