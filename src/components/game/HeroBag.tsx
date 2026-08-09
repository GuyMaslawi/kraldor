"use client";

import { useState, useTransition } from "react";
import type { HeroRarity } from "@prisma/client";
import Link from "next/link";
import { discardHeroItems, upgradeHeroItems } from "@/server/actions/hero";
import type { ActionState } from "@/server/actions/game";
import { ItemTile } from "@/components/game/ItemTile";
import { ItemDialog } from "@/components/game/ItemDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { formatNumber } from "@/lib/game/format";
import { Tip } from "@/components/ui/Tip";
import {
  HERO_BAG_CAPACITY,
  RARITY_META,
  RARITY_ORDER,
  SLOT_META,
  canUpgradeItem,
  itemUpgradeCost,
} from "@/lib/game/hero";
import { FORGE_DISCOUNT_PCT, forgeDiscountedCost } from "@/lib/game/potions";
import { itemDetails, uiRarity, type HeroItemView } from "@/components/game/heroItemView";
import { useT } from "@/i18n/client";

/**
 * The hero's bag: unequipped items in a 5×3 grid of slots with rarity filters.
 * One item per slot — duplicates are not merged, because each copy really does
 * occupy a slot and the free-slot count has to be honest. Clicking an item
 * opens its detail dialog (wear / upgrade / discard). A selection mode lets the
 * player mark many items and discard or upgrade them all at once.
 */
export function HeroBag({
  items,
  heroLevel,
  gold,
  wheelSpinBonus = 0,
  forgeDiscount = false,
}: {
  items: HeroItemView[];
  heroLevel: number;
  gold: number;
  /** Wheel-luck upgrade bonus (fraction) added to the discard spin chance. */
  wheelSpinBonus?: number;
  /** Whether שיקוי הנפח is running — halves every upgrade price quoted. */
  forgeDiscount?: boolean;
}) {
  const [filter, setFilter] = useState<HeroRarity | null>(null);
  const [openItem, setOpenItem] = useState<HeroItemView | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmUpgrade, setConfirmUpgrade] = useState(false);
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});

  const rarityRank = (r: HeroRarity) => RARITY_ORDER.indexOf(r);

  const sorted = [...items].sort(
    (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.level - a.level
  );
  const visible = filter ? sorted.filter((i) => i.rarity === filter) : sorted;
  // Every slot the bag has is drawn, so a full bag reads as full at a glance.
  const emptySlots = Math.max(0, HERO_BAG_CAPACITY - items.length);
  const bagFull = items.length >= HERO_BAG_CAPACITY;

  // Drop ids of items that are already gone (discarded / equipped elsewhere).
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const selectedIdSet = new Set(selectedIds);

  const allVisibleSelected =
    visible.length > 0 && visible.every((i) => selected.has(i.id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((i) => i.id)));

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const runBulk = (
    action: (prev: ActionState, fd: FormData) => Promise<ActionState>
  ) => {
    if (selectedIds.length === 0) return;
    const fd = new FormData();
    fd.set("itemIds", selectedIds.join(","));
    startTransition(async () => {
      const res = await action({}, fd);
      setMsg(res);
      if (res.success) exitSelect();
    });
  };

  const selectedCount = selectedIds.length;
  // Selected items that can still be upgraded — not yet maxed, and whose next
  // level the hero is high enough to reach — with the gold each costs; the
  // total drives the confirmation dialog.
  const selectedUpgrades = items
    .filter((i) => selectedIdSet.has(i.id) && canUpgradeItem(heroLevel, i.level))
    .map((i) => ({
      item: i,
      cost: forgeDiscountedCost(itemUpgradeCost(i.level) ?? 0, forgeDiscount),
    }));
  const selectedUpgradeable = selectedUpgrades.length;
  const totalUpgradeCost = selectedUpgrades.reduce((sum, u) => sum + u.cost, 0);
  const canAffordAll = gold >= totalUpgradeCost;

  const confirmUpgradeAll = () => {
    setConfirmUpgrade(false);
    runBulk(upgradeHeroItems);
  };

  return (
    /* No panel of its own: the bag is the left column *inside* the hero panel,
       so the page owns its frame. */
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tip tip={t("חפצים שנלכדו בקרבות וממתינים בתיק. לחיצה על חפץ פותחת את פרטיו — שם אפשר ללבוש, לשדרג או לזרוק.")}>
          <h2 className="cursor-help text-base font-bold tracking-wide text-gold-bright">
            {t("התיק")}
          </h2>
        </Tip>
        <div className="flex items-center gap-2">
          {items.length > 0 &&
            (selecting ? (
              <button
                onClick={exitSelect}
                className="btn btn-ghost px-2.5 py-1 text-xs"
              >
                {t("בטל")}
              </button>
            ) : (
              <button
                onClick={() => setSelecting(true)}
                className="btn btn-ghost px-2.5 py-1 text-xs"
              >
                {t("בחירה")}
              </button>
            ))}
          {/* The forge sits beside the catalog rather than in the sidebar: it
              is only ever wanted with gear in hand, and this is where the gear
              is. See src/lib/game/forge.ts. */}
          <Tip
            tip={t("נפחייה: פרק ציוד לרסיסים, הזמן פריט למשבצת שחסרה לך, ולטש פריט קיים")}
            side="bottom"
          >
            <Link
              href="/game/hero/forge"
              prefetch={false}
              className="btn btn-ghost px-2.5 py-1 text-xs"
            >
              {t("נפחייה")}
            </Link>
          </Tip>
          <Tip
            tip={t("הקטלוג המלא: כל החפצים הקיימים במשחק, מרמה 1 עד 100 בכל הדרגות")}
            side="bottom"
          >
            <Link href="/game/hero/items" className="btn btn-ghost px-2.5 py-1 text-xs">
              {t("לכל הפריטים")}
            </Link>
          </Tip>
        </div>
      </div>

      {/* rarity filters */}
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        <button
          onClick={() => setFilter(null)}
          className={`btn px-2.5 py-1 text-[11px] ${
            filter === null ? "btn-gold" : "btn-ghost text-zinc-300"
          }`}
        >
          {t("הכל")} ({items.length})
        </button>
        {RARITY_ORDER.map((r) => {
          const count = items.filter((i) => i.rarity === r).length;
          return (
            <button
              key={r}
              onClick={() => setFilter(filter === r ? null : r)}
              className={`btn px-2.5 py-1 text-[11px] ${
                filter === r ? "btn-gold" : `btn-ghost ${RARITY_META[r].tone}`
              }`}
            >
              {t(RARITY_META[r].label)} ({count})
            </button>
          );
        })}
      </div>

      {/* the grid never stretches — a fixed, readable slot size, centred so the
          panel stays symmetric instead of hugging one edge */}
      <div className="mt-4">
        <div className="mx-auto w-full max-w-[25rem]">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            {selecting ? (
              <button
                onClick={selectAll}
                disabled={visible.length === 0}
                className="btn btn-ghost px-3 py-1 text-xs"
              >
                {allVisibleSelected ? t("נקה בחירה") : t("סמן הכל")}
              </button>
            ) : (
              <Tip
                tip={t("מקום בתיק: {slots} סלוטים (5 על 3). כשהתיק מלא — לא נלכדים חפצים חדשים בקרב ואי אפשר להסיר ציוד מהגיבור!", {
                  slots: HERO_BAG_CAPACITY,
                })}
              >
                <span className="cursor-help">{t("סלוטים")}</span>
              </Tip>
            )}
            <span
              className={`nums ${bagFull ? "font-black text-red-400" : ""}`}
            >
              {selecting
                ? t("{count} נבחרו", { count: selectedCount })
                : `${items.length}/${HERO_BAG_CAPACITY}`}
            </span>
          </div>

          {bagFull && !selecting && (
            <p className="mt-2 text-[11px] font-semibold text-amber-300">
              {t("התיק מלא — חפצים חדשים לא ייכנסו. זרוק או שדרג כדי לפנות מקום.")}
            </p>
          )}

          <div className="mt-2 grid grid-cols-5 gap-2">
            {visible.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    selecting ? toggleSelect(item.id) : setOpenItem(item)
                  }
                  className={`relative block w-full rounded-xl transition ${
                    selecting && isSelected
                      ? "ring-2 ring-gold ring-offset-2 ring-offset-black"
                      : ""
                  }`}
                  aria-label={t("{slot} רמה {level}", {
                    slot: t(SLOT_META[item.slot].label),
                    level: item.level,
                  })}
                >
                  <ItemTile
                    slug={SLOT_META[item.slot].slug}
                    icon={SLOT_META[item.slot].icon}
                    level={item.level}
                    rarity={uiRarity(item.rarity)}
                    size="sm"
                    details={
                      selecting
                        ? undefined
                        : itemDetails(t, item, heroLevel, { hint: t("לחץ לפרטים") })
                    }
                  />
                  {selecting && (
                    <span
                      aria-hidden
                      className={`absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-black ${
                        isSelected
                          ? "border-gold bg-gold text-black"
                          : "border-white/50 bg-black/70 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="panel-inset flex aspect-square items-center justify-center rounded-xl text-zinc-700"
              >
                <span aria-hidden className="text-base">
                  ◇
                </span>
              </div>
            ))}
          </div>

          {(msg.error || msg.success) && (
            <p
              className={`mt-3 text-xs font-semibold ${
                msg.error ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {msg.error ?? msg.success}
            </p>
          )}

          {/* bulk action bar */}
          {selecting && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => runBulk(discardHeroItems)}
                disabled={pending || selectedCount === 0}
                className="btn py-2 text-sm font-black text-white disabled:opacity-45"
                style={{ background: "linear-gradient(180deg,#b91c1c,#7f1d1d)" }}
              >
                {t("זרוק הכל")} ({selectedCount})
              </button>
              <button
                onClick={() => setConfirmUpgrade(true)}
                disabled={pending || selectedUpgradeable === 0}
                title={
                  selectedUpgradeable === 0
                    ? t("אין פריטים לשדרוג מבין הנבחרים")
                    : undefined
                }
                className="btn btn-dark py-2 text-sm"
              >
                {t("שדרג הכל")} ({selectedUpgradeable})
              </button>
            </div>
          )}
        </div>

        <p className="mx-auto mt-4 max-w-md text-center text-[11px] leading-relaxed text-zinc-500">
          {t("חפצים נלכדים בניצחון בתקיפה על שחקנים אחרים — ככל שהחפץ נדיר יותר, כך קשה יותר ללכוד אותו.")}
        </p>
      </div>

      {openItem && (
        <ItemDialog
          item={openItem}
          heroLevel={heroLevel}
          gold={gold}
          equipped={false}
          wheelSpinBonus={wheelSpinBonus}
          forgeDiscount={forgeDiscount}
          onClose={() => setOpenItem(null)}
        />
      )}

      {confirmUpgrade && (
        <Dialog
          open
          onClose={() => setConfirmUpgrade(false)}
          labelledBy="confirm-upgrade-title"
        >
          <h2
            id="confirm-upgrade-title"
            className="text-lg font-black text-gold-bright"
          >
            {t("שדרוג חפצים")}
          </h2>
          <p className="nums mt-2 text-sm text-zinc-300">
            {t("עומדים לשדרג {count} חפצים לדרגה הבאה.", {
              count: selectedUpgradeable,
            })}
          </p>

          <div className="panel-inset mt-4 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">{t("עלות כוללת")}</span>
              <span
                className={`nums font-black ${
                  canAffordAll ? "text-gold-bright" : "text-red-400"
                }`}
                dir="ltr"
              >
                <Icon name="gold" size={14} className="inline align-[-2px] text-gold-bright" /> {formatNumber(totalUpgradeCost)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-zinc-500">{t("הזהב שלך")}</span>
              <span className="nums text-xs font-bold text-zinc-300" dir="ltr">
                <Icon name="gold" size={14} className="inline align-[-2px] text-gold-bright" /> {formatNumber(gold)}
              </span>
            </div>
          </div>

          {forgeDiscount && (
            <p className="mt-3 text-xs font-semibold text-violet-300">
              {t("🧪 שיקוי הנפח פעיל — המחירים כאן כבר כוללים {pct}% הנחה.", {
                pct: FORGE_DISCOUNT_PCT,
              })}
            </p>
          )}

          {!canAffordAll && (
            <p className="mt-3 text-xs font-semibold text-amber-300">
              {t("אין מספיק זהב לשדרוג הכל — ישודרגו הזולים ביותר עד שייגמר הזהב.")}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => setConfirmUpgrade(false)}
              disabled={pending}
              className="btn btn-ghost py-2 text-sm"
            >
              {t("ביטול")}
            </button>
            <button
              onClick={confirmUpgradeAll}
              disabled={pending}
              className="btn btn-gold py-2 text-sm"
            >
              {pending ? t("משדרג…") : t("אישור שדרוג")}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
