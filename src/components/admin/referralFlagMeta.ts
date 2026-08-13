import { REFERRAL_BURST_LIMIT, type ReferralFlag } from "@/lib/game/referral";

/**
 * How the referral queue explains a flag to the admin reading it.
 *
 * These sat in `lib/game/referral.ts` next to the rules they describe, which
 * made them look like game text that had simply been missed by the English
 * pass. They are not: the only reader is `/admin/referrals`, the control centre
 * stays Hebrew on purpose, and a flag's wording is an argument addressed to
 * whoever is about to approve or refuse a payout.
 *
 * So the file tree carries the boundary, exactly as it does for `TUNABLE_META`
 * and the Happy Hour duration labels: staff-facing copy lives under
 * `components/admin/`, and everything left in `lib/game/` is a dictionary key.
 * The *rules* — `ReferralFlag`, `REFERRAL_HARD_FLAGS`, `isHardReferralFlag` —
 * stay where they were; they are game logic, and the game reads them.
 */

/** Short label for the admin queue. */
export const REFERRAL_FLAG_LABEL: Record<ReferralFlag, string> = {
  self: "אותו חשבון",
  cycle: "מעגל הזמנות",
  ineligible: "מזמין לא כשיר",
  device: "אותו דפדפן",
  mailbox: "אותה תיבת דואר",
  shared_ip: "כתובת IP משותפת",
  burst: "ריבוי הזמנות ביום אחד",
  combat: "קרבות בין השניים",
};

/** What the admin needs to know to judge it. */
export const REFERRAL_FLAG_DETAIL: Record<ReferralFlag, string> = {
  self: "המזמין והמוזמן הם אותו משתמש.",
  cycle: "המזמין הוזמן בעצמו, במישרין או בעקיפין, על ידי המוזמן.",
  ineligible: "המזמין הוא חשבון צוות, בוט או חשבון חסום.",
  device:
    "שני החשבונות נכנסו למשחק מאותו פרופיל דפדפן. זה הסימן החזק ביותר לחשבון שני של אותו אדם.",
  mailbox: "שתי כתובות הדוא״ל מגיעות לאותה תיבה (נקודות או ‎+תווית ב-Gmail).",
  shared_ip:
    "שני החשבונות נרשמו או התחברו מאותה כתובת IP. זה גם המצב של אחים, שותפים לדירה, משרד או רשת סלולרית — ולכן זה מגיע לבדיקה ולא לחסימה.",
  burst:
    "יותר מ-" +
    REFERRAL_BURST_LIMIT +
    " מוזמנים נקשרו למזמין הזה ביממה האחרונה. יכול להיות פוסט מוצלח בקבוצה, ויכול להיות סקריפט.",
  combat:
    "השניים תקפו, ריגלו או חיבלו זה בזה. שחקנים אמיתיים עושים את זה, אבל זו גם הדרך להעביר משאבים בין שני חשבונות של אותו אדם.",
};
