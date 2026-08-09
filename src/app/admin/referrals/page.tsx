import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ReferralCaseCard } from "@/components/admin/ReferralCaseCard";
import { listReferralCases } from "@/server/referralQueue";
import {
  REFERRAL_BURST_LIMIT,
  REFERRAL_GOAL_CITIES,
  REFERRAL_SEASON_CAP,
} from "@/lib/game/referral";

export const dynamic = "force-dynamic";

export const metadata = { title: "הזמנות חברים | ניהול" };

/**
 * /admin/referrals — the review queue for flagged referrals.
 *
 * The screen exists because the alternative was worse. הזמנת חבר pays diamonds,
 * so it has to be policed; but the sharpest cheap signal available — two
 * accounts on one IP — is also what a household, a dorm, an office and a mobile
 * carrier's NAT look like, and blocking on it automatically would refuse more
 * real friendships than farms. So a soft signal buys a human look instead, and
 * this is where the human looks.
 */
export default async function AdminReferralsPage() {
  await requireAdmin();
  const cases = await listReferralCases();
  const waiting = cases.filter((c) => c.review === "HELD");

  return (
    <div className="space-y-6">
      <SectionHeading title="הזמנות חברים" ornament="🎁" />

      <p className="panel-inset rounded-xl p-4 text-sm leading-relaxed text-zinc-400">
        הזמנת חבר משלמת יהלומים, ולכן היא גם הדבר הכי משתלם לזייף במשחק. רוב
        ההזמנות עוברות לבד ולא מגיעות לכאן בכלל. מה שמגיע לכאן הוא הזמנה שהדליקה
        סימן.
        <br />
        סימן <span className="font-bold text-red-300">חמור</span> — אותו חשבון,
        אותה תיבת דואר, אותו דפדפן, מעגל הזמנות — כבר נחסם אוטומטית ולא נוצר ממנו
        קישור בכלל, אז אם הוא מופיע כאן זה אומר שהוא התחיל להתקיים אחרי הקישור.
        סימן <span className="font-bold text-amber-300">לבדיקה</span> — בעיקר IP
        משותף — <span className="font-bold text-bone/90">לא נחסם בכוונה</span>:
        אחים, שותפים לדירה, משרד ורשת סלולרית נראים בדיוק ככה, וזה גם המקרה הכי
        נפוץ של הזמנה אמיתית.
        <br />
        אישור מחזיר את ההזמנה למסלול הרגיל — שני הצדדים אוספים בעצמם מהמסך שלהם
        ברגע שהמוזמן מגיע ל-{REFERRAL_GOAL_CITIES} ערים. דחייה סוגרת אותה לתמיד.
        בשני המקרים ההחלטה סופית מול הבדיקות האוטומטיות: הן לא יבטלו אותה אחר כך.
        <br />
        גם בלי כל זה יש שתי תקרות: יותר מ-{REFERRAL_BURST_LIMIT} מוזמנים למזמין
        אחד ביממה עוברים לבדיקה, ולכל היותר {REFERRAL_SEASON_CAP} פרסי הזמנה
        משולמים לשחקן אחד בעונה.
      </p>

      {cases.length === 0 ? (
        <p className="panel rounded-xl p-5 text-sm text-zinc-500">
          אין הזמנות מסומנות. כל ההזמנות שנוצרו עד עכשיו עברו נקי.
        </p>
      ) : (
        <>
          <p className="text-xs font-bold text-zinc-400">
            {waiting.length > 0
              ? `${waiting.length} ממתינות להחלטה`
              : "אין הזמנות שממתינות להחלטה"}{" "}
            <span className="font-normal text-zinc-600">
              · {cases.length} מסומנות בסך הכל
            </span>
          </p>
          <ul className="space-y-3">
            {cases.map((item) => (
              <ReferralCaseCard key={item.joiner.empireId} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
