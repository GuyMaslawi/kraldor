"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { useState, useTransition } from "react";
import type { HeroItemSlot, HeroRarity } from "@prisma/client";
import { ItemTile } from "@/components/game/ItemTile";
import { formatBonus } from "@/lib/game/format";
import { LivingPortrait } from "@/components/game/LivingPortrait";
import { ItemDialog } from "@/components/game/ItemDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Tip, useTip } from "@/components/ui/Tip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { equipHeroItem } from "@/server/actions/hero";
import type { ActionState } from "@/server/actions/game";
import { useT } from "@/i18n/client";
import {
  HERO_STAT_META,
  SLOT_META,
  canEquipItem,
  itemDisplayName,
  itemPrimaryBonus,
  slotPrimaryStat,
} from "@/lib/game/hero";
import {
  itemDetails,
  uiRarity,
  type HeroItemView,
} from "@/components/game/heroItemView";

/**
 * Where every slot's medallion sits on the portrait — percentages of the frame,
 * measured to the node's centre. The pieces the hero *wears* run down one rail
 * at their body height (helmet at the head, boots at the feet) and the gear he
 * *carries* down the other; the relic floats above the head. Tooltips float in
 * a portal and place themselves, so anchors only describe geometry.
 */
type Anchor = {
  x: number;
  y: number;
  /** Which way the hairline connector reaches towards the body. */
  reach: "left" | "right" | "down";
};

const SLOT_ANCHORS: Record<HeroItemSlot, Anchor> = {
  RELIC: { x: 50, y: 7, reach: "down" },
  // worn pieces (right rail in the artwork, head → feet)
  HELMET: { x: 86, y: 22, reach: "left" },
  ARMOR: { x: 86, y: 43, reach: "left" },
  PANTS: { x: 86, y: 64, reach: "left" },
  BOOTS: { x: 86, y: 85, reach: "left" },
  // carried gear (left rail)
  WINGS: { x: 14, y: 22, reach: "right" },
  SWORD: { x: 14, y: 43, reach: "right" },
  SHIELD: { x: 14, y: 64, reach: "right" },
  GAUNTLETS: { x: 14, y: 85, reach: "right" },
};

const PAPERDOLL_SLOTS = Object.keys(SLOT_ANCHORS) as HeroItemSlot[];

const CONNECTOR: Record<Anchor["reach"], string> = {
  left: "top-1/2 right-full mr-1 h-px w-[50%] bg-gradient-to-l from-gold/45 to-transparent",
  right:
    "top-1/2 left-full ml-1 h-px w-[50%] bg-gradient-to-r from-gold/45 to-transparent",
  down: "top-full left-1/2 mt-1 h-[45%] w-px -translate-x-1/2 bg-gradient-to-b from-gold/45 to-transparent",
};

/** Identical bag items (same slot+level) merged into one pickable stack. */
type PickStack = {
  key: string;
  level: number;
  rarity: HeroRarity;
  ids: string[];
};

/**
 * The hero's living equipment sheet: the class portrait with all nine pieces
 * worn *on* the figure instead of in a detached 3×3 grid. Clicking a worn piece
 * opens its detail dialog; clicking an empty socket opens a picker of the
 * matching items waiting in the bag, so dressing the hero never leaves the page.
 *
 * `readOnly` strips every action and leaves the picture: the same figure and the
 * same nine sockets, but nothing to click and no bag behind them. That is the
 * mode a dossier wants — a profile shows *what* the hero wears, and managing it
 * stays on the hero page.
 */
export function HeroPaperdoll({
  portrait,
  portraitAlt,
  portraitAccent,
  equipped,
  bag = [],
  heroLevel,
  gold = 0,
  wheelSpinBonus = 0,
  forgeDiscount = false,
  readOnly = false,
}: {
  /** Class artwork src (832×1216, so the frame keeps a 13/19 ratio). */
  portrait: string;
  portraitAlt: string;
  /** rgb triple — the class's own light on the embers and halo. */
  portraitAccent?: string;
  equipped: HeroItemView[];
  /** Unequipped items — the pool the socket picker offers. Unused when readOnly. */
  bag?: HeroItemView[];
  heroLevel: number;
  gold?: number;
  /** Wheel-luck upgrade bonus (fraction) added to the discard spin chance. */
  wheelSpinBonus?: number;
  /** Whether שיקוי הנפח is running — halves every upgrade price quoted. */
  forgeDiscount?: boolean;
  /** Show-only: no equipping, no dialogs — just the dressed figure. */
  readOnly?: boolean;
}) {
  const t = useT();
  const [openItem, setOpenItem] = useState<HeroItemView | null>(null);
  const [pickSlot, setPickSlot] = useState<HeroItemSlot | null>(null);

  const bySlot = new Map(equipped.map((item) => [item.slot, item]));

  return (
    <div className="relative aspect-[13/19] w-full">
      {/* ---- artwork layer (clipped; the nodes above it are not) ---- */}
      <LivingPortrait
        src={portrait}
        alt={portraitAlt}
        className="absolute inset-0 rounded-2xl"
        accent={portraitAccent}
        embers={7}
        tilt={10}
        drift={28}
        sheen
        rich
      >
        {/* darken the edges so the medallions read against the art */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/45" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.65)_100%)]" />
        <div className="absolute inset-y-0 left-0 hidden w-20 bg-gradient-to-l from-transparent to-[var(--panel)] md:block" />
      </LivingPortrait>

      {/* ---- the nine sockets, worn on the figure ---- */}
      {PAPERDOLL_SLOTS.map((slot) => {
        const a = SLOT_ANCHORS[slot];
        const meta = SLOT_META[slot];
        const statMeta = HERO_STAT_META[slotPrimaryStat(slot)];
        const item = bySlot.get(slot);
        const waiting = bag.filter((i) => i.slot === slot).length;

        return (
          <div
            key={slot}
            // The floor keeps a medallion tappable in a narrow frame; on a phone
            // the frame itself is only ~16rem wide, and a 54px floor there eats
            // so far into the middle that the figure is all sockets and no hero.
            className="absolute w-[17%] min-w-[46px] -translate-x-1/2 -translate-y-1/2 sm:min-w-[54px]"
            style={{ left: `${a.x}%`, top: `${a.y}%` }}
          >
            <span aria-hidden className={`absolute ${CONNECTOR[a.reach]}`} />

            {readOnly ? (
              item ? (
                <ItemTile
                  slug={meta.slug}
                  icon={meta.icon}
                  level={item.level}
                  rarity={uiRarity(item.rarity)}
                  details={itemDetails(t, item, heroLevel, { worn: true })}
                />
              ) : (
                <EmptySocket
                  label={t(meta.label)}
                  icon={meta.icon}
                  statIcon={statMeta.icon}
                  statLabel={t(statMeta.label)}
                  waiting={0}
                  readOnly
                />
              )
            ) : item ? (
              <button
                type="button"
                onClick={() => setOpenItem(item)}
                className="relative block w-full"
                aria-label={t("{slot} רמה {level} — פרטים", {
                  slot: t(meta.label),
                  level: item.level,
                })}
              >
                {/* no "לבוש" flag — an item sitting in a body socket is
                    self-evidently worn */}
                <ItemTile
                  slug={meta.slug}
                  icon={meta.icon}
                  level={item.level}
                  rarity={uiRarity(item.rarity)}
                  details={itemDetails(t, item, heroLevel, {
                    worn: true,
                    hint: t("לחץ לפרטים"),
                  })}
                />
                {/* a stronger piece of the same kind is sitting in the bag */}
                {bag.some(
                  (b) =>
                    b.slot === slot &&
                    b.level > item.level &&
                    canEquipItem(heroLevel, b.level),
                ) && (
                  <span
                    aria-label={t("יש חפץ חזק יותר בתיק")}
                    className="absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-black text-black shadow-[0_0_10px_rgba(52,211,153,0.8)]"
                  >
                    ↑
                  </span>
                )}
              </button>
            ) : (
              <EmptySocket
                label={t(meta.label)}
                icon={meta.icon}
                statIcon={statMeta.icon}
                statLabel={t(statMeta.label)}
                waiting={waiting}
                onPick={() => setPickSlot(slot)}
              />
            )}
          </div>
        );
      })}

      {/* worn counter */}
      <div className="absolute inset-x-0 bottom-3 flex justify-center">
        <Tip
          tip={
            readOnly
              ? t("תשעת חלקי הציוד שהגיבור לובש, כל אחד במקומו על הגוף. ריחוף מעל חפץ מציג את דרגתו והבונוסים שהוא מעניק. הלבשה והשדרוג נעשים בעמוד הגיבור.")
              : t("תשעת חלקי הציוד שהגיבור לובש, כל אחד במקומו על הגוף. לחיצה על סלוט ריק בוחרת חפץ מהתיק; לחיצה על חפץ לבוש פותחת את פרטיו. הבונוסים שלהם מרוכזים ב'סך הכל מהגיבור' שלמטה.")
          }
        >
          <span className="cursor-help rounded-full border border-gold/40 bg-black/75 px-3 py-1 text-[11px] font-bold text-gold-dim">
            {t("ציוד לבוש")}{" "}
            <span className="nums text-gold-bright" dir="ltr">
              {equipped.length}/9
            </span>
          </span>
        </Tip>
      </div>

      {openItem && (
        <ItemDialog
          item={openItem}
          heroLevel={heroLevel}
          gold={gold}
          equipped
          wheelSpinBonus={wheelSpinBonus}
          forgeDiscount={forgeDiscount}
          onClose={() => setOpenItem(null)}
        />
      )}

      {pickSlot && (
        <SlotPicker
          slot={pickSlot}
          bag={bag.filter((i) => i.slot === pickSlot)}
          heroLevel={heroLevel}
          onClose={() => setPickSlot(null)}
        />
      )}
    </div>
  );
}

/**
 * An unfilled socket on the portrait: the dashed medallion plus a floating
 * tooltip explaining what belongs there and whether the bag holds a candidate.
 */
function EmptySocket({
  label,
  icon,
  statIcon,
  statLabel,
  waiting,
  onPick,
  readOnly = false,
}: {
  label: string;
  icon: string;
  statIcon: IconName;
  statLabel: string;
  /** How many matching items are waiting in the bag. */
  waiting: number;
  onPick?: () => void;
  /** Draw the socket without offering to fill it (dossier view). */
  readOnly?: boolean;
}) {
  const t = useT();
  const { triggerProps, node } = useTip(
    <>
      <span className="block text-sm font-black text-zinc-300">{label}</span>
      <span className="mt-0.5 block text-[10px] text-zinc-500">{t("סלוט ריק")}</span>
      <span className="mt-2 block text-xs text-zinc-300">
        <Icon name={statIcon} size={12} className="inline align-[-2px]" /> {statLabel}
      </span>
      {!readOnly && (
        <span className="mt-2 block border-t border-white/10 pt-1.5 text-[10px] text-gold-dim">
          {waiting > 0
            ? t("{count} בתיק — לחץ לבחירה", { count: waiting })
            : t("אין חפץ כזה בתיק — לכוד אחד בתקיפה")}
        </span>
      )}
    </>,
    { className: "w-44 p-3", bare: true },
  );

  // A dossier's sockets are a fact, not an offer — no button, no hover promise.
  const Frame = readOnly ? "div" : "button";

  return (
    <Frame
      {...(readOnly
        ? { "aria-label": t("סלוט {slot} ריק", { slot: label }) }
        : {
            type: "button" as const,
            onClick: onPick,
            "aria-label": t("סלוט {slot} ריק — בחר חפץ", { slot: label }),
          })}
      className="group relative block w-full"
      {...triggerProps}
    >
      <div
        className={`relative flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-gold/25 bg-black/55 backdrop-blur-[2px] transition ${
          readOnly ? "" : "group-hover:border-gold/70 group-hover:bg-black/75"
        }`}
      >
        <span aria-hidden className="text-3xl opacity-30 grayscale">
          {icon}
        </span>
        {waiting > 0 && (
          <span
            className="nums absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-[10px] font-black text-black shadow-[0_0_10px_rgba(212,168,67,0.7)]"
            dir="ltr"
          >
            {waiting}
          </span>
        )}
      </div>
      {node}
    </Frame>
  );
}

/**
 * "What goes in this socket?" — the bag items matching one slot, best first.
 * Picking one equips it straight away (the server action swaps out whatever is
 * already worn in that slot).
 */
function SlotPicker({
  slot,
  bag,
  heroLevel,
  onClose,
}: {
  slot: HeroItemSlot;
  bag: HeroItemView[];
  heroLevel: number;
  onClose: () => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});
  const meta = SLOT_META[slot];
  const statMeta = HERO_STAT_META[slotPrimaryStat(slot)];

  // Same slot+level items look and perform identically — show one tile per level.
  const stackMap = new Map<string, PickStack>();
  for (const it of bag) {
    const key = String(it.level);
    const cur = stackMap.get(key);
    if (cur) cur.ids.push(it.id);
    else
      stackMap.set(key, {
        key,
        level: it.level,
        rarity: it.rarity,
        ids: [it.id],
      });
  }
  const stacks = [...stackMap.values()].sort((a, b) => b.level - a.level);

  const wear = (itemId: string) => {
    const fd = new FormData();
    fd.set("itemId", itemId);
    startTransition(async () => {
      const res = await equipHeroItem({}, fd);
      if (res.success) onClose();
      else setMsg(res);
    });
  };

  const titleId = `slot-picker-${slot}`;

  return (
    <Dialog open onClose={onClose} labelledBy={titleId}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-lg font-black text-gold-bright">
            <span aria-hidden>{meta.icon}</span> {t(meta.label)}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            <Icon name={statMeta.icon} size={12} className="inline align-[-2px]" />{" "}
            {t("{stat} — בחר חפץ מהתיק כדי ללבוש אותו", { stat: t(statMeta.label) })}
          </p>
        </div>
        <CloseButton onClick={onClose} className="-mt-1" />
      </div>

      <div className="rule-gold my-4" />

      {stacks.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">
          {t("אין חפצי {slot} בתיק.", { slot: t(meta.label) })}
          <br />
          <span className="text-xs text-zinc-500">
            {t("חפצים נלכדים בניצחון בתקיפה על שחקנים אחרים.")}
          </span>
        </p>
      ) : (
        // dvh, and `overscroll-contain` so flicking past the last row does not
        // hand the gesture to the dialog behind this grid.
        <div className="grid max-h-[50dvh] grid-cols-3 gap-3 overflow-y-auto overscroll-contain pr-0.5">
          {stacks.map((stack) => {
            const bonus = itemPrimaryBonus(slot, stack.level);
            const allowed = canEquipItem(heroLevel, stack.level);
            return (
              <button
                key={stack.key}
                type="button"
                onClick={() => wear(stack.ids[0])}
                disabled={pending || !allowed}
                title={
                  allowed
                    ? t("לבש {item}", { item: itemDisplayName(t, slot, stack.level) })
                    : t("דרוש גיבור רמה {level}", { level: stack.level })
                }
                className="relative block w-full rounded-xl text-center transition hover:brightness-110 disabled:cursor-not-allowed"
              >
                <ItemTile
                  slug={meta.slug}
                  icon={meta.icon}
                  level={stack.level}
                  rarity={uiRarity(stack.rarity)}
                />
                {stack.ids.length > 1 && (
                  <span
                    aria-hidden
                    className="nums absolute left-1 top-1 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-black text-gold-bright"
                    dir="ltr"
                  >
                    ×{stack.ids.length}
                  </span>
                )}
                <span
                  className={`nums mt-1 block text-[11px] font-black ${
                    allowed ? "text-emerald-400" : "text-red-400"
                  }`}
                  dir="ltr"
                >
                  {allowed
                    ? `+${formatBonus(bonus.value)}${bonus.flat ? "" : "%"}`
                    : `🔒 ${stack.level}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {msg.error && (
        <p className="mt-3 text-xs font-semibold text-red-400">{msg.error}</p>
      )}
    </Dialog>
  );
}
