"use client";

import { ItemTile } from "@/components/game/ItemTile";
import { formatBonus } from "@/lib/game/format";
import { catalogKey, itemDetails, uiRarityForLevel } from "@/components/game/heroItemView";
import { Icon } from "@/components/ui/Icon";
import {
  HERO_STAT_META,
  ITEM_DROP_CHANCE,
  ITEM_DROP_CHANCE_BY_RARITY,
  ITEM_LEVELS,
  RARITY_META,
  RARITY_ORDER,
  SLOT_META,
  SLOT_ORDER,
  itemPrimaryBonus,
  itemStatBonus,
  slotStatIsFlat,
  slotPrimaryStat,
} from "@/lib/game/hero";
import { HERO_ITEM_SETS } from "@/lib/game/heroSets";
import { useT } from "@/i18n/client";

/** "12%" / "1.5%" — a decimal only when the odds are not a whole percent. */
function formatDropChance(chance: number): string {
  const pct = chance * 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/**
 * The complete item catalog: every slot at every tier level (1,3,8,10,…,100).
 * An item's tier (its colour and name) is derived from its level — the named
 * series פשוט → מתקדם → אליט → אגדי repeats every 10 levels — so each slot
 * simply renders its full level progression, showing what exists, what the
 * player owns, and what their hero can already wear.
 */
export function ItemCatalog({
  heroLevel,
  ownedKeys,
  equippedKeys,
}: {
  heroLevel: number;
  /** catalogKey() of every item in the player's possession. */
  ownedKeys: string[];
  equippedKeys: string[];
}) {
  const t = useT();
  const owned = new Set(ownedKeys);
  const equipped = new Set(equippedKeys);

  return (
    <div className="space-y-5">
      {/* how the tier series works */}
      <div className="panel-inset rounded-lg p-3 text-xs leading-relaxed text-zinc-400">
        <p>
          {t("🎯 חפצים נלכדים בניצחון בתקיפה (סיכוי")}{" "}
          <span className="nums text-gold" dir="ltr">
            {Math.round(ITEM_DROP_CHANCE * 100)}%
          </span>{" "}
          {t("ללכידה). ככל שהדרגה נדירה יותר, כך היא נופלת לעיתים רחוקות יותר — הסיכוי בכל תקיפה מנצחת:")}{" "}
          {RARITY_ORDER.map((r, i) => (
            <span key={r}>
              {i > 0 && " · "}
              <span className={RARITY_META[r].tone}>{t(RARITY_META[r].label)}</span>{" "}
              <span className="nums text-zinc-300" dir="ltr">
                {formatDropChance(ITEM_DROP_CHANCE_BY_RARITY[r])}
              </span>
            </span>
          ))}
        </p>
        <p className="mt-1">
          {t("⬆ שדרוג מעלה את רמת החפץ לדרגה הבאה בתוך הסט (וגם את הסטטים), ונעצר באגדי — הסט הבא מגיע רק כשלל · 🔒 = הגיבור שלך (רמה")}{" "}
          <span className="nums text-gold-bright" dir="ltr">
            {heroLevel}
          </span>
          {t(") עדיין לא יכול ללבוש · ✓ = נמצא ברשותך")}
        </p>
        {/* the sets — the visible half of the ladder */}
        <p className="mt-1">
          {t("✦ כל עשר רמות מתחלף הסט וכל תשעת החפצים מקבלים מראה חדש, יקר וחזק יותר:")}{" "}
          {HERO_ITEM_SETS.map((s, i) => (
            <span key={s.dir}>
              {i > 0 && " · "}
              <span className={i === HERO_ITEM_SETS.length - 1 ? "text-gold-bright" : "text-zinc-300"}>
                {t(s.label)}
              </span>{" "}
              <span className="nums" dir="ltr">
                {s.from}–{s.to}
              </span>
            </span>
          ))}
        </p>
      </div>

      {/* one section per slot, full level progression */}
      {SLOT_ORDER.map((slot) => {
        const slotMeta = SLOT_META[slot];
        const statMeta = HERO_STAT_META[slotPrimaryStat(slot)];
        const maxBonus = itemPrimaryBonus(slot, 100);
        // One entry per extra stat (not per resource line), deduped, so the
        // header reads "ועוד משאבים · אזרחים" rather than repeating "משאבים"
        // once for each of the four resources a legendary piece covers.
        const extras = SLOT_META[slot].stats
          .slice(1)
          .map((s) => ({
            stat: s.stat,
            flat: slotStatIsFlat(slot, s.stat),
            value: itemStatBonus(slot, 100, s.stat),
          }));
        return (
          <section key={slot} className="panel rounded-xl p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-gold-bright">
                {slotMeta.icon} {t(slotMeta.label)}
              </h2>
              <span className="text-[11px] text-zinc-500">
                <Icon name={statMeta.icon} size={12} className="inline align-[-2px]" />{" "}
                {t(statMeta.label)} {t("— עד")}{" "}
                <span className="nums text-emerald-400" dir="ltr">
                  +{formatBonus(maxBonus.value)}
                  {maxBonus.flat ? "" : "%"}
                </span>{" "}
                {t("ברמה 100")}
                {/* the extras this slot carries alongside its headline stat */}
                {extras.length > 0 && (
                  <span className="text-zinc-600">
                    {t(" · ועוד ")}
                    {extras
                      .map(
                        (e) =>
                          `${t(HERO_STAT_META[e.stat].label)} +${formatBonus(e.value)}${e.flat ? "" : "%"}`
                      )
                      .join(" · ")}
                  </span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-7 lg:grid-cols-11">
              {ITEM_LEVELS.map((level) => {
                const key = catalogKey(slot, level);
                const isOwned = owned.has(key);
                const isEquipped = equipped.has(key);
                return (
                  <div key={level} tabIndex={0} className="outline-none">
                    <ItemTile
                      slug={slotMeta.slug}
                      icon={slotMeta.icon}
                      level={level}
                      rarity={uiRarityForLevel(level)}
                      // 9 slots × 40 rungs = 360 tiles on one page. The tile
                      // shimmer is per-tile animation (a sweep, twinkles with
                      // stacked drop-shadows, a breathing box-shadow), and at
                      // this count it repaints the whole page every frame.
                      // The catalog is a reference table — it reads still.
                      still
                      details={itemDetails(t, { slot, level }, heroLevel, {
                        owned: isOwned,
                        equipped: isEquipped,
                        hint: isOwned
                          ? undefined
                          : t("נלכד בניצחון בתקיפה על שחקן אחר"),
                      })}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
