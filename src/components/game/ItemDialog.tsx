"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { formatBonus, formatNumber } from "@/lib/game/format";
import { ItemTile } from "@/components/game/ItemTile";
import { uiRarity, type HeroItemView } from "@/components/game/heroItemView";
import {
  discardHeroItem,
  equipHeroItem,
  unequipHeroItem,
  upgradeHeroItem,
} from "@/server/actions/hero";
import type { ActionState } from "@/server/actions/game";
import { FORGE_DISCOUNT_PCT, forgeDiscountedCost } from "@/lib/game/potions";
import { itemSetForLevel } from "@/lib/game/heroSets";
import { useT } from "@/i18n/client";
import {
  HERO_STAT_META,
  RARITY_META,
  SLOT_META,
  atSetCeiling,
  canEquipItem,
  discardWheelSpinChance,
  itemBonusLines,
  itemPrimaryBonus,
  slotPrimaryStat,
  itemDisplayName,
  itemUpgradeCost,
  nextTierLevel,
  tierForLevel,
} from "@/lib/game/hero";

/**
 * Full-screen detail dialog for a single hero item: shows its stats large and
 * offers the three actions — wear/remove, upgrade to the next tier level (for
 * gold), and discard. Opened by clicking a tile in the bag or on the hero.
 * A bag tile can stand for several identical copies (`copies`); the actions
 * still act on the one copy this dialog was opened with.
 */
export function ItemDialog({
  item,
  heroLevel,
  gold,
  equipped,
  copies = 1,
  wheelSpinBonus = 0,
  forgeDiscount = false,
  onClose,
}: {
  item: HeroItemView;
  heroLevel: number;
  gold: number;
  /**
   * How many identical copies the player holds — the bag draws them as one
   * stacked tile. Every action here still touches a single copy, so the dialog
   * says so rather than letting the stack imply otherwise.
   */
  copies?: number;
  /** Whether this item is currently worn (shows "remove" instead of "wear"). */
  equipped: boolean;
  /** Wheel-luck upgrade bonus (fraction) added to the discard spin chance. */
  wheelSpinBonus?: number;
  /** Whether שיקוי הנפח is running — halves the upgrade price quoted here. */
  forgeDiscount?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Local level copy: upgrading keeps the dialog open, so it must reflect the
  // new level itself (the parent still holds the pre-upgrade snapshot).
  const [level, setLevel] = useState(item.level);

  const slotMeta = SLOT_META[item.slot];
  const statMeta = HERO_STAT_META[slotPrimaryStat(item.slot)];
  const bonusLines = itemBonusLines(item.slot, level);
  const rarity = tierForLevel(level);
  const rarityMeta = RARITY_META[rarity];
  const bonus = itemPrimaryBonus(item.slot, level);
  const unit = bonus.flat ? "" : "%";

  const upgradeToLevel = nextTierLevel(level);
  const fullUpgradeCost = itemUpgradeCost(level);
  // The forge brew halves the price for as long as it runs; the struck-through
  // full price stays visible so the discount is the thing the player sees.
  const upgradeCost =
    fullUpgradeCost === null
      ? null
      : forgeDiscountedCost(fullUpgradeCost, forgeDiscount);
  const nextTier = upgradeToLevel != null ? tierForLevel(upgradeToLevel) : null;
  const nextBonus =
    upgradeToLevel != null ? itemPrimaryBonus(item.slot, upgradeToLevel).value : null;
  const canAfford = upgradeCost != null && gold >= upgradeCost;
  // An אגדי is the top of its set — finished, but not the top of the game.
  const setCapped = atSetCeiling(level);
  // Can't upgrade an item past the hero's own level.
  const meetsUpgradeLevel = upgradeToLevel != null && heroLevel >= upgradeToLevel;

  const meetsLevel = canEquipItem(heroLevel, level);
  // Worn despite being over the hero's level — kept through a prestige reset.
  const grandfathered = equipped && !meetsLevel;
  const [confirmUnequip, setConfirmUnequip] = useState(false);

  const run = (
    action: (prev: ActionState, fd: FormData) => Promise<ActionState>
  ) => {
    const fd = new FormData();
    fd.set("itemId", item.id);
    startTransition(async () => {
      const res = await action({}, fd);
      if (res.success) onClose();
      else setMsg(res);
    });
  };

  // Throwing an item away may reward a wheel spin (🎡 in the success text). On a
  // win keep the dialog open so the player actually sees the reward; otherwise
  // close as usual.
  const doDiscard = () => {
    const fd = new FormData();
    fd.set("itemId", item.id);
    startTransition(async () => {
      const res = await discardHeroItem({}, fd);
      if (res.success?.includes("🎡")) setMsg(res);
      else if (res.success) onClose();
      else setMsg(res);
    });
  };

  const doUpgrade = () => {
    const target = upgradeToLevel;
    if (target == null) return;
    const fd = new FormData();
    fd.set("itemId", item.id);
    startTransition(async () => {
      const res = await upgradeHeroItem({}, fd);
      setMsg(res);
      if (res.success) setLevel(target);
    });
  };

  const titleId = `item-dialog-${item.id}`;

  return (
    <Dialog open onClose={onClose} labelledBy={titleId}>
      {/* header */}
      <div className="flex items-start gap-4">
        <div className="w-24 shrink-0">
          <ItemTile
            slug={slotMeta.slug}
            icon={slotMeta.icon}
            level={level}
            rarity={uiRarity(rarity)}
            size="lg"
          />
        </div>
        <div className="flex-1 pt-1">
          <h2 id={titleId} className={`text-lg font-black ${rarityMeta.tone}`}>
            {itemDisplayName(t, item.slot, level)}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {t("דרגה:")} <span className={rarityMeta.tone}>{t(rarityMeta.label)}</span>
            {" · "}
            {t("רמת פריט:")} <span className="nums text-zinc-200">{level}</span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {t("סט:")}{" "}
            <span className="text-zinc-300">{t(itemSetForLevel(level).label)}</span>
          </p>
          {/* Only while this copy is still part of the stack: an upgrade here
              lifts it to a level of its own, and the count stops applying. */}
          {copies > 1 && level === item.level && (
            <p className="nums mt-1 text-[11px] font-bold text-gold-dim">
              {t("×{count} בתיק — כל פעולה כאן חלה על עותק אחד", { count: copies })}
            </p>
          )}
        </div>
        <CloseButton onClick={onClose} className="-mt-1" />
      </div>

      <div className="rule-gold my-4" />

      {/* stats — the headline first, then everything else the piece carries */}
      <div className="space-y-2 text-sm">
        <div className="space-y-1">
          {bonusLines.map((line, i) => (
            <div
              key={`${line.label}-${i}`}
              className={`flex items-center justify-between ${
                line.primary ? "" : "text-xs"
              }`}
            >
              <span
                className={`inline-flex items-center gap-1.5 ${
                  line.primary ? "text-zinc-300" : "text-zinc-500"
                }`}
              >
                <Icon
                  name={
                    line.resource
                      ? RESOURCE_ICON[line.resource]
                      : HERO_STAT_META[line.stat].icon
                  }
                  size={line.primary ? 14 : 13}
                  className={line.resource ? RESOURCE_ICON_COLOR[line.resource] : ""}
                />
                {t(line.label, line.labelParams)}
              </span>
              <span
                className={`nums font-black ${
                  line.primary ? "text-emerald-400" : "text-emerald-500/80"
                }`}
                dir="ltr"
              >
                +{formatBonus(line.value)}
                {line.flat ? "" : "%"}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          {t(statMeta.description)}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">{t("דרישת רמה")}</span>
          <span
            className={`nums text-xs font-bold ${
              meetsLevel ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {meetsLevel ? "✓" : "✗"} {t("גיבור רמה {level}", { level })}
          </span>
        </div>
      </div>

      {/* upgrade preview */}
      {upgradeToLevel != null && nextTier != null && (
        <div className="panel-inset mt-4 rounded-lg p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">{t("שדרוג לרמה")}</span>
            <span className={`font-black ${RARITY_META[nextTier].tone}`}>
              <span className="nums" dir="ltr">{upgradeToLevel}</span> ·{" "}
              {t(RARITY_META[nextTier].label)}
            </span>
          </div>
          {/* the one upgrade in each decade that also changes how the piece looks */}
          {itemSetForLevel(upgradeToLevel).index !== itemSetForLevel(level).index && (
            <div className="mt-1 flex items-center justify-between">
              <span className="text-zinc-500">{t("סט חדש")}</span>
              <span className="font-black text-gold-bright">
                {t(itemSetForLevel(upgradeToLevel).label)} ✦
              </span>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between">
            <span className="text-zinc-500">{t("בונוס לאחר שדרוג")}</span>
            <span className="nums font-bold text-emerald-300" dir="ltr">
              +{formatBonus(bonus.value)}{unit} → +{formatBonus(nextBonus ?? 0)}{unit}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-zinc-500">{t("עלות")}</span>
            <span
              className={`nums font-bold ${canAfford ? "text-gold-bright" : "text-red-400"}`}
              dir="ltr"
            >
              {forgeDiscount && fullUpgradeCost != null && (
                <span className="me-1.5 text-zinc-500 line-through">
                  {formatNumber(fullUpgradeCost)}
                </span>
              )}
              <Icon name="gold" size={14} className="inline align-[-2px] text-gold-bright" /> {upgradeCost != null ? formatNumber(upgradeCost) : ""}
            </span>
          </div>
          {forgeDiscount && (
            <p className="nums mt-1.5 text-[11px] font-semibold text-violet-300">
              {t("🧪 שיקוי הנפח פעיל — {pct}% הנחה על השדרוג", {
                pct: FORGE_DISCOUNT_PCT,
              })}
            </p>
          )}
          {!meetsUpgradeLevel && (
            <p className="nums mt-2 text-[11px] font-semibold text-red-400">
              {t("דרוש גיבור רמה {required} כדי לשדרג (אתה ברמה {level})", {
                required: upgradeToLevel,
                level: heroLevel,
              })}
            </p>
          )}
        </div>
      )}

      {/* nothing left to buy — say which of the two ceilings this is */}
      {upgradeToLevel == null && (
        <div className="panel-inset mt-4 rounded-lg p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">{t("שדרוג")}</span>
            <span className="font-black text-gold-bright">
              {setCapped ? t("שיא הסט ✦") : t("רמה מקסימלית ✦")}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            {setCapped ? (
              <>
                {t("אגדי הוא הרמה הגבוהה בסט")}{" "}
                <b className="text-zinc-300">{t(itemSetForLevel(level).label)}</b>{" "}
                {t("— אין לאן לשדרג אותו יותר. הסט הבא (")}
                <b className="text-zinc-300">{t(itemSetForLevel(level + 1).label)}</b>
                {t(") מגיע רק כשלל מתקיפה מנצחת.")}
              </>
            ) : (
              <>
                {t("רמה")} <b className="nums text-zinc-300">{level}</b>{" "}
                {t("— אין ציוד גבוה מזה במשחק.")}
              </>
            )}
          </p>
        </div>
      )}

      {(msg.error || msg.success) && (
        <p
          className={`mt-3 text-xs font-semibold ${
            msg.error ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {msg.error ?? msg.success}
        </p>
      )}

      {/* Gear worn from before a prestige reset keeps working, but the level
          gate still guards equipping — so removing it is a one-way door until
          the hero climbs back. Say so, and make the player confirm. */}
      {grandfathered && (
        <p className="mt-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-200">
          <Icon name="spark" size={13} className="inline align-[-2px] " />{" "}
          {t("החפץ נשמר עליך מהאיפוס וממשיך להעניק את הבונוס המלא. אם תסיר אותו — לא תוכל ללבוש אותו שוב עד שהגיבור יחזור לרמה")}{" "}
          <b className="nums">{level}</b>.
        </p>
      )}

      {/* actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {equipped ? (
          <button
            onClick={() =>
              grandfathered && !confirmUnequip
                ? setConfirmUnequip(true)
                : run(unequipHeroItem)
            }
            disabled={pending}
            className={`col-span-2 py-2 text-sm ${
              confirmUnequip ? "btn btn-gold" : "btn btn-ghost"
            }`}
          >
            {confirmUnequip
              ? t("אישור — הסר ונעל עד רמה {level}", { level })
              : t("הסר לתיק")}
          </button>
        ) : (
          <button
            onClick={() => run(equipHeroItem)}
            disabled={pending || !meetsLevel}
            title={meetsLevel ? undefined : t("עלה לרמה {level} כדי ללבוש", { level })}
            className="btn btn-gold col-span-2 py-2 text-sm"
          >
            {meetsLevel ? t("לבש") : t("דרוש רמה {level}", { level })}
          </button>
        )}

        <button
          onClick={doUpgrade}
          disabled={pending || upgradeToLevel == null || !meetsUpgradeLevel || !canAfford}
          title={
            upgradeToLevel == null
              ? setCapped
                ? t("אגדי הוא שיא הסט {set} — הסט הבא מגיע כשלל", {
                    set: t(itemSetForLevel(level).label),
                  })
                : t("הפריט כבר ברמה הגבוהה ביותר")
              : !meetsUpgradeLevel
                ? t("דרוש גיבור רמה {level} כדי לשדרג", { level: upgradeToLevel })
                : !canAfford
                  ? t("אין מספיק זהב")
                  : undefined
          }
          className="btn btn-dark py-2 text-sm"
        >
          {upgradeToLevel == null
            ? setCapped
              ? t("שיא הסט")
              : t("רמה מקסימלית")
            : !meetsUpgradeLevel
              ? t("דרוש רמה {level}", { level: upgradeToLevel })
              : t("שדרג")}
        </button>

        {confirmDiscard ? (
          <button
            onClick={doDiscard}
            disabled={pending}
            className="btn py-2 text-sm font-black text-white"
            style={{ background: "linear-gradient(180deg,#b91c1c,#7f1d1d)" }}
          >
            {t("אישור זריקה")}
          </button>
        ) : (
          <button
            onClick={() => setConfirmDiscard(true)}
            disabled={pending}
            className="btn btn-ghost py-2 text-sm text-red-300"
          >
            {t("זרוק")}
          </button>
        )}
      </div>

      {confirmDiscard && (
        <p className="nums mt-2 text-center text-xs text-amber-300/80">
          {t("🎡 סיכוי {pct}% לזכות בסיבוב גלגל מזל מהזריקה", {
            pct: Math.round((discardWheelSpinChance(level) + wheelSpinBonus) * 100),
          })}
        </p>
      )}
    </Dialog>
  );
}
