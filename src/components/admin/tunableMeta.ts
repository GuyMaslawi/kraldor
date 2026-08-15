import type { GameTunables } from "@/lib/game/config";

/**
 * Field labels for the balance editor.
 *
 * These live under `components/admin/` rather than beside the tunables
 * themselves because they are **admin chrome, not game data**. The control
 * centre is staff-only and stays Hebrew on purpose (see src/i18n/), and the
 * i18n coverage report reads that boundary off the file tree — a label sitting
 * in `lib/game/` reads as a player-facing string still waiting to be
 * translated, which is exactly what it is not.
 */

/**
 * Keyed to `GameTunables` field by field, not `Record<string, …>`.
 *
 * The balance page renders `Object.entries(meta.fields)` and nothing else, so a
 * tunable with no entry here is not a tunable with a missing label — it is a
 * tunable that **does not appear in the admin panel at all**, still merged and
 * still live, editable only by a deploy. A loose index signature let that happen
 * silently; this mapped type makes it a compile error, so adding a tunable and
 * shipping its knob are the same commit.
 */
export const TUNABLE_META: {
  [G in keyof GameTunables]: {
    label: string;
    icon: string;
    fields: { [F in keyof GameTunables[G]]: { label: string; step?: number } };
  };
} = {
  starting: {
    label: "אימפריה חדשה — חבילת פתיחה",
    icon: "🌱",
    fields: {
      gold: { label: "זהב התחלתי" },
      wood: { label: "עץ התחלתי" },
      iron: { label: "ברזל התחלתי" },
      stone: { label: "אבן התחלתית" },
      diamonds: { label: "יהלומים התחלתיים" },
      citizens: { label: "אזרחים התחלתיים" },
      turns: { label: "תורות התחלתיות" },
      soldiers: { label: "חיילים התחלתיים" },
      spies: { label: "מרגלים התחלתיים" },
      mineSlaves: { label: "עבדי מכרות התחלתיים" },
      slavesPerMine: { label: "עבדים משובצים לכל מכרה" },
      wheelSpins: { label: "סיבובי גלגל התחלתיים" },
    },
  },
  daily: {
    label: "עדכון יומי — כלכלה",
    icon: "🌅",
    fields: {
      citizensBase: { label: "אזרחים בסיס לעדכון יומי" },
      citizensPerLevel: { label: "אזרחים נוספים לכל רמת שדרוג" },
      wheelSpins: { label: "סיבובי גלגל לעדכון יומי" },
    },
  },
  battle: {
    label: "קרב וריגול",
    icon: "⚔️",
    fields: {
      defenseBonus: { label: "בונוס מגן (1.2 = +20%)", step: 0.05 },
      plunderRate: { label: "אחוז ביזה מהמגן (0.1 = 10%)", step: 0.01 },
      enslaveRate: { label: "אחוז שעבוד חיילים (0.1 = 10%)", step: 0.01 },
      enslaveMinSoldiers: { label: "מינימום חיילים לשעבוד" },
      attackTurnCost: { label: "עלות תורות לתקיפה" },
      spyTurnCost: { label: "עלות תורות לריגול" },
    },
  },
  economy: {
    label: "כלכלה גלובלית",
    icon: "🏭",
    fields: {
      mineProductionMultiplier: { label: "מכפיל תפוקת מכרות גלובלי", step: 0.1 },
    },
  },
  boss: {
    label: "בוס העיר",
    icon: "👹",
    fields: {
      powerMultiplier: { label: "מכפיל כוח הבוס (1 = ברירת מחדל)", step: 0.05 },
      rewardMultiplier: { label: "מכפיל שלל הבוס (1 = ברירת מחדל)", step: 0.05 },
      hpMultiplier: { label: "מכפיל חיי הבוס (1 = ברירת מחדל)", step: 0.05 },
      slaveMultiplier: { label: "מכפיל עבדים מהבוס (1 = ברירת מחדל)", step: 0.05 },
      heroXpMultiplier: { label: "מכפיל XP לגיבור מהבוס (1 = ברירת מחדל)", step: 0.05 },
      reviveMinutes: { label: "דקות עד שבוס שנפל קם לתחייה" },
      enabled: { label: "בוס פתוח (1 = כן, 0 = סגור)" },
    },
  },
  worldBoss: {
    label: "מפלצת העולם",
    icon: "🐋",
    fields: {
      enabled: { label: "זירת מפלצת העולם פתוחה (1 = כן, 0 = סגור)" },
      hpMultiplier: { label: "מכפיל חיים למפלצת חדשה (1 = ברירת מחדל)", step: 0.05 },
      damageMultiplier: { label: "מכפיל נזק של מכת שחקן (1 = ברירת מחדל)", step: 0.05 },
      rewardMultiplier: { label: "מכפיל שלל משותף (1 = ברירת מחדל)", step: 0.05 },
      killDiamonds: { label: "יהלומים למכה שמפילה" },
      maxStrikes: { label: "מכות לשחקן בשבוע" },
      strikeTurns: { label: "עלות תורות למכה" },
    },
  },
  heroQuest: {
    label: "מסעות הגיבור",
    icon: "🧭",
    fields: {
      rewardMultiplier: { label: "מכפיל שלל המסעות (1 = ברירת מחדל)", step: 0.05 },
      enabled: { label: "לוח המסעות פתוח (1 = כן, 0 = סגור)" },
    },
  },
  diamondStore: {
    label: "חנות יהלומים — רכישה",
    // 🛒 (the storefront), not 💎: a gem here would be a second, emoji drawing
    // of the diamond the whole game renders from the shared icon set.
    icon: "🛒",
    fields: {
      // The label carries the warning because this is the one tunable whose
      // save is *also* a send: raising it announces the sale to every player
      // and to Discord (see `heraldDiamondSale`). Lowering it, or re-saving the
      // same number, is silent — which is what makes the panel's habit of
      // submitting every field at once safe.
      purchaseDiscountPct: {
        label: "אחוז הנחה על מחירי חבילות יהלומים (0-100) — העלאה מכריזה אוטומטית לכל השחקנים ובדיסקורד",
      },
    },
  },
  season: {
    label: "מחזור העונות — אוטומטי",
    icon: "🔄",
    fields: {
      breakHours: { label: "שעות הפסקה בין עונה לעונה" },
      lengthDays: { label: "אורך העונה הבאה (ימים)" },
      autoNext: { label: "פתיחת העונה הבאה אוטומטית (1 = כן, 0 = לא)" },
      autoRestart: { label: "איפוס העולם בפתיחת עונה (1 = כן, 0 = לא)" },
      openBots: { label: "בוטים בעיר הראשונה בפתיחת עונה (0 = בלי)" },
    },
  },
};

