// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { IconName } from "@/components/ui/Icon";
import type { T } from "@/i18n/translate";

/**
 * ------------------------------ VIP · חותם המלוכה ------------------------------
 *
 * A one-off purchase that buys **time, not power**.
 *
 * The pass does not add actions to the game. It unlocks the one-click "do it to
 * everything" buttons the game already has — הפקד הכל in the bank, הפקד/משוך הכל
 * on a warehouse, הצב הכל / חלק שווה on the mine crew, שדרג למקסימום on a mine.
 * A player without it still reaches every one of those states: he types the
 * amount, he presses per warehouse, he buys the mine a level at a time. Nothing
 * here produces a resource, adds a point of power, blocks an attack or shortens
 * a cooldown — a paying player ends a session in exactly the state a patient one
 * does, just with fewer presses between him and it.
 *
 * That line is the whole reason the pass can be sold at all, and it is worth
 * defending: the moment a VIP button reaches a state a free player cannot reach
 * at any click count, the shop stops selling convenience and starts selling the
 * ladder.
 *
 * It never expires. Not a subscription and not a timed buff — there is no
 * `vipUntil`, no countdown in the command bar and no expiry mail to write. It
 * lives on `Empire.vipSince`, so it lasts as long as the empire does (a world
 * reset rebuilds empires and takes it with them, exactly like every other thing
 * an empire owns).
 */

/** Diamonds for the pass. One purchase, forever. */
export const VIP_COST = 1000;

export const VIP_LABEL = "חותם המלוכה";
export const VIP_SHORT = "VIP";

/** Anything holding a `vipSince` stamp — an empire row, or a select of one. */
export interface VipHolder {
  vipSince: Date | null;
}

/** Whether this empire holds the pass. The column is the entitlement. */
export function isVip(empire: VipHolder | null | undefined): boolean {
  return empire?.vipSince != null;
}

/**
 * The refusal every gated action returns without the pass.
 *
 * Shared, because the gate lives in three files (bank, game, vip) and a player
 * who hits it from two different screens must be told the same thing.
 */
export function vipRequiredError(t: T): string {
  return t("הפעולה הזו נפתחת עם {vip} — לחיצה על הכפתור הנעול פותחת את הרכישה", {
    vip: t(VIP_LABEL),
  });
}

/** The perks, as the shop card and the guide list them. */
export interface VipPerk {
  icon: IconName;
  title: string;
  desc: string;
}

export const VIP_PERKS: VipPerk[] = [
  {
    icon: "bank",
    title: "בנק · הפקד הכל · משוך הכל",
    desc: "כל הזהב הזמין נכנס לחיסכון (או חוזר ממנו) בלי להקליד סכום.",
  },
  {
    icon: "storage",
    title: "מחסנים · הפקד הכל · משוך הכל",
    desc: "כל מחסן מתמלא או מתרוקן בלחיצה, במקום הקלדת כמות בכל אחד מהארבעה.",
  },
  {
    icon: "mine",
    title: "מכרות · הצב הכל · חלק שווה · שדרג למקסימום",
    desc: "כל עבדי המכרות למשאב אחד או בחלוקה שווה, ומכרה שעולה רמות עד שנגמר התקציב.",
  },
  {
    icon: "spark",
    title: "מפקדה בכל מסך",
    desc: "כפתור בסרגל העליון שפותח את כל הפעולות האלה מכל עמוד במשחק.",
  },
];

/** The one-liner shown wherever a locked VIP control explains itself. */
export function vipLockHint(t: T): string {
  return t("נעול · נפתח עם {vip}", { vip: t(VIP_LABEL) });
}
