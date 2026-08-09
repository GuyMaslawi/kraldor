"use client";

import { useActionState, useState } from "react";
import type { HeroItemSlot } from "@prisma/client";
import { Icon } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNumber, formatCompact } from "@/lib/game/format";
import { RARITY_META, SLOT_META, tierForLevel } from "@/lib/game/hero";
import {
  COMMISSION_DROPS,
  SHARDS_BY_RARITY,
  type ForgeBagItem,
  type ForgeState,
} from "@/lib/game/forge";
import { commissionHeroItem, temperHeroItem } from "@/server/actions/forge";
import { heroItemArtPath } from "@/lib/game/heroSets";
import { useT } from "@/i18n/client";

/**
 * /game/hero/forge — the two benches.
 *
 * The screen has one job beyond the buttons: say plainly what the forge does
 * *not* do. Players arrive expecting a shop, and a shop that sells power is
 * exactly what this is not — a commission rolls the same rarity table a raid
 * does, and tempering stops at an אגדי like every other road in the gear
 * economy. Both facts are stated on the page rather than left to be discovered
 * by a player who spent four drops' worth of shards on a פשוט.
 */
export function HeroForge({ state }: { state: ForgeState }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <ShardPouch state={state} />
      <CommissionBench state={state} />
      <TemperBench bag={state.bag} shards={state.shards} />

      <p className="mx-auto max-w-3xl text-center text-xs leading-relaxed text-zinc-500">
        {t("כל פריט שאתה מפרק — בתיק או על הגוף — הופך לרסיסים. הנפחייה לא יוצרת ציוד חזק ממה שהמשחק היה נותן לך בלאו הכי: היא רק מכוונת אותו למשבצת שחסרה לך.")}
      </p>
    </div>
  );
}

/* ------------------------------ the pouch ------------------------------ */

function ShardPouch({ state }: { state: ForgeState }) {
  const t = useT();
  return (
    <section className="forge-scene panel-gold rounded-2xl p-4 sm:p-5">
      <span className="forge-embers" aria-hidden>
        {/* A fixed table, never Math.random(): the panel is server-rendered and
            a random position would differ between SSR and hydration. */}
        {["6%", "23%", "41%", "58%", "74%", "89%"].map((x, i) => (
          <span key={x} style={{ left: x, animationDelay: `${i * 1.7}s` }} />
        ))}
      </span>

      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
            <Icon name="factory" size={20} className="text-crimson-bright" />
            {t("נפחיית הגיבור")}
          </h2>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-zinc-400">
            {t("פרק ציוד שאינך זקוק לו לרסיסים, והשתמש בהם כדי להזמין פריט למשבצת שחסרה לך או ללטש פריט קיים לדרגה הבאה.")}
          </p>
        </div>

        <Tip tip={t("רסיסי ציוד — נצברים מפירוק פריטים")}>
          <span className="flex items-center gap-2 rounded-xl border border-gold/50 bg-black/40 px-4 py-2">
            <Icon name="spark" size={22} className="text-purple-300" />
            <span className="text-2xl font-black nums text-gold-bright">
              {formatNumber(state.shards)}
            </span>
            <span className="text-[11px] font-bold text-zinc-500">
              {t("רסיסים")}
            </span>
          </span>
        </Tip>
      </div>

      {/* The exchange rate, stated once. Read off the catalog rather than
          written out, so retuning the drop table moves this line with it. */}
      <ul className="relative mt-4 flex flex-wrap gap-2">
        {(Object.keys(SHARDS_BY_RARITY) as (keyof typeof SHARDS_BY_RARITY)[]).map(
          (rarity) => (
            <li
              key={rarity}
              className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-black/30 px-2.5 py-1 text-[11px] font-bold"
            >
              <span className={RARITY_META[rarity].tone}>
                {t(RARITY_META[rarity].label)}
              </span>
              <span className="text-zinc-600">→</span>
              <span className="nums text-purple-300">
                {SHARDS_BY_RARITY[rarity]}
              </span>
            </li>
          )
        )}
      </ul>
    </section>
  );
}

/* ------------------------------ commission ------------------------------ */

function CommissionBench({ state }: { state: ForgeState }) {
  const t = useT();
  const [slot, setSlot] = useState<HeroItemSlot | null>(null);
  const [result, formAction, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(commissionHeroItem, {});

  const canPay = state.shards >= state.shardCost && state.gold >= state.goldCost;
  const bagFull = state.bagFree <= 0;

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="shop" size={20} className="text-crimson-bright" />
        {t("הזמנת ציוד")}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        {t("בחר משבצת ושלם. הנדירות והרמה נקבעות בדיוק לפי אותה טבלה שממנה נופל ציוד בקרב — הדבר היחיד שאתה קונה הוא המשבצת. שווה ערך ל-{drops} פריטים שפורקו.", {
          drops: COMMISSION_DROPS,
        })}
      </p>

      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {state.slots.map((option) => {
          const chosen = slot === option.slot;
          return (
            <li key={option.slot}>
              <button
                type="button"
                onClick={() => setSlot(chosen ? null : option.slot)}
                aria-pressed={chosen}
                className={`flex w-full flex-col items-center gap-1 rounded-lg border p-2 transition-colors ${
                  chosen
                    ? "border-gold bg-gold/12"
                    : option.owned === 0
                      ? // An empty slot is the whole reason to be here, so it
                        // announces itself rather than waiting to be counted.
                        "border-crimson/50 bg-crimson/8 hover:border-crimson"
                      : "border-border-subtle bg-black/25 hover:border-gold-dim"
                }`}
              >
                <Icon
                  name="shield"
                  size={18}
                  className={option.owned === 0 ? "text-crimson-bright" : "text-bone-dim"}
                />
                <span className="text-center text-[10px] font-bold leading-tight text-bone/90">
                  {t(SLOT_META[option.slot].label)}
                </span>
                <span className="text-[9px] font-bold nums text-zinc-500">
                  {option.owned === 0
                    ? t("ריק")
                    : t("×{count}", { count: option.owned })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="slot" value={slot ?? ""} />
        <button
          type="submit"
          disabled={pending || slot === null || !canPay || bagFull}
          className="btn btn-gold px-5 py-2 text-sm disabled:opacity-50"
        >
          {pending
            ? t("מחשל…")
            : slot === null
              ? t("בחר משבצת")
              : t("הזמן {slot}", { slot: t(SLOT_META[slot].label) })}
        </button>

        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`flex items-center gap-1 font-bold nums ${
              state.shards >= state.shardCost ? "text-purple-300" : "text-red-400"
            }`}
          >
            <Icon name="spark" size={13} />
            {formatNumber(state.shardCost)}
          </span>
          <span
            className={`flex items-center gap-1 font-bold nums ${
              state.gold >= state.goldCost ? "text-gold" : "text-red-400"
            }`}
          >
            <Icon name="gold" size={13} />
            {formatCompact(state.goldCost)}
          </span>
          <span className="text-zinc-500">
            {t("· סדרה {decade} (רמת גיבור {level})", {
              decade: state.decade,
              level: state.heroLevel,
            })}
          </span>
        </span>
      </form>

      {bagFull && (
        <p className="mt-2 text-xs font-bold text-amber-400">
          {t("התיק מלא — פרק או לבש פריט לפני שתזמין חדש.")}
        </p>
      )}

      <div className="mt-3">
        <FormMessage error={result.error} success={result.success} />
      </div>
    </section>
  );
}

/* ------------------------------ temper ------------------------------ */

function TemperBench({ bag, shards }: { bag: ForgeBagItem[]; shards: number }) {
  const t = useT();
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        <Icon name="upgrades" size={20} className="text-crimson-bright" />
        {t("ליטוש")}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        {t("העלה פריט לדרגה הבאה בתוך הסדרה שלו — אותה מדרגה שהשדרוג בזהב קונה, רק שכאן משלמים ברסיסים. פריט אגדי הוא שיא הסדרה שלו ואינו ניתן לליטוש.")}
      </p>

      {bag.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border-subtle bg-black/25 px-3 py-3 text-sm text-zinc-500">
          {t("התיק ריק. ציוד נופל מתקיפות שניצחת וממסעות הגיבור.")}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {bag.map((item) => (
            <TemperRow key={item.id} item={item} shards={shards} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TemperRow({ item, shards }: { item: ForgeBagItem; shards: number }) {
  const t = useT();
  const [result, formAction, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(temperHeroItem, {});

  const rarity = RARITY_META[tierForLevel(item.level)];
  const capped = item.temperCost === null;
  const affordable = item.temperCost !== null && shards >= item.temperCost;

  return (
    <li className="rounded-xl border border-border-subtle bg-black/25 p-2.5">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- the gear art is
            a static file picked by slug+level; next/image buys nothing for a
            36px sprite and costs an optimizer round trip per row. */}
        <img
          src={heroItemArtPath(SLOT_META[item.slot].slug, item.level)}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded object-contain"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-bone">
            {t(SLOT_META[item.slot].label)}{" "}
            <span className={rarity.tone}>{t(rarity.label)}</span>
          </p>
          <p className="text-[10px] font-bold nums text-zinc-500" dir="ltr">
            {t("רמה {level}", { level: item.level })} ·{" "}
            <span className="text-purple-300">
              {t("פירוק: {shards}", { shards: item.shards })}
            </span>
          </p>
        </div>

        {capped ? (
          <Tip tip={t("פריט אגדי הוא שיא הסדרה שלו")}>
            <span className="shrink-0">
              <Icon name="crown" size={18} className="text-gold-bright" />
            </span>
          </Tip>
        ) : (
          <form action={formAction} className="shrink-0">
            <input type="hidden" name="itemId" value={item.id} />
            <button
              type="submit"
              disabled={pending || !affordable}
              className="btn btn-gold flex items-center gap-1 px-2.5 py-1.5 text-xs disabled:opacity-50"
            >
              <Icon name="spark" size={12} />
              <span className="nums">{item.temperCost}</span>
            </button>
          </form>
        )}
      </div>

      {(result.error || result.success) && (
        <div className="mt-2">
          <FormMessage error={result.error} success={result.success} />
        </div>
      )}
    </li>
  );
}
