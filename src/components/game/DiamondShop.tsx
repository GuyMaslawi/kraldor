"use client";

import { useActionState, type ReactNode } from "react";
import type { StorableResource } from "@/lib/game/constants";
import { RESOURCE_META } from "@/lib/game/constants";
import type { ActionState } from "@/server/actions/game";
import {
  buyRaidShield,
  buyResourceBoost,
  buyShopDiscount,
  buyTurns,
  castBankInterestSpell,
  castCityDowngradeSpell,
  resetHeroPointsWithDiamonds,
} from "@/server/actions/diamondShop";
import {
  BOOST_MAX_PCT,
  BOOST_STEP_COST,
  BOOST_STEP_PCT,
  BANK_INTEREST_SPELL_COST,
  CITY_DOWNGRADE_COOLDOWN_HOURS,
  CITY_DOWNGRADE_COST,
  CITY_DOWNGRADE_MIN_CITIES,
  HERO_POINTS_RESET_COST,
  SHIELDS,
  SHIELD_RENEW_COOLDOWN_MINUTES,
  SHOP_DISCOUNT_COST,
  SHOP_DISCOUNT_PCT,
  TURN_PACKAGES,
  type ShieldKey,
} from "@/lib/game/diamondShop";
import { cityName } from "@/lib/game/cities";
import type { GuildCityStake } from "@/lib/game/guild";
import { GuildCityWarning } from "@/components/game/GuildCityWarning";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { SHIELD_ICON, SHIELD_TONE } from "@/components/game/ShieldBadges";
import { formatNumber } from "@/lib/game/format";
import { useLocale, useT } from "@/i18n/client";
import { LOCALE_TAG, type Locale } from "@/i18n/locale";
import type { T } from "@/i18n/translate";

/**
 * Date + time of an ISO timestamp, e.g. "20.07 · 14:30" — the day is shown so a
 * next-day expiry isn't mistaken for today. Deterministic — no Date.now in render.
 */
function whenLabel(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const tag = LOCALE_TAG[locale];
  const date = d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit" });
  // 24-hour on both sides: these chips are narrow, and an "AM"/"PM" suffix
  // wraps them onto a second line.
  const time = d.toLocaleTimeString(tag, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} · ${time}`;
}

function ActiveBadge({ label }: { label: string }) {
  return (
    <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-xs font-semibold text-emerald-400">
      {label}
    </span>
  );
}

function SectionTitle({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
        <span aria-hidden>{icon}</span>
        {title}
      </h2>
      <span className="hidden h-px flex-1 bg-gradient-to-l from-transparent via-gold-dim/40 to-transparent sm:block" />
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </div>
  );
}

/** Price chip used on every buy button: "40 💎". */
function Price({ cost }: { cost: number }) {
  return (
    <span className="nums inline-flex items-center gap-1" dir="ltr">
      {cost}
      <Icon name="diamond" size={14} className="text-cyan-300" />
    </span>
  );
}

/**
 * Shared card shell for every shop item — a titled header, a fixed-height
 * description block and an action pinned to the bottom. The uniform structure
 * is what keeps a grid row from developing ragged holes: every card in a row
 * stretches to the same height and its button sits on the same baseline.
 */
function ShopCard({
  icon,
  title,
  badge,
  desc,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  desc: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="panel-inset flex h-full flex-col rounded-xl p-3.5 transition-colors hover:border-gold/30">
      <div className="flex items-start justify-between gap-2">
        {/* The title wraps rather than truncates: in two columns on a phone
            these cards are ~150px wide, and "תוספת זהב" clipped to "תוספת …"
            makes all four boost cards read the same. */}
        <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-zinc-100">
          <span className="shrink-0" aria-hidden>
            {icon}
          </span>
          <span className="min-w-0">{title}</span>
        </p>
        {badge}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{desc}</p>
      <div className="mt-auto grid gap-1.5 pt-3">{children}</div>
    </div>
  );
}

/* ------------------------------ resource boost ------------------------------ */

/**
 * The rungs of a boost, drawn as one pip per purchase. The card's own "+0%"
 * badge says where you are but not that there is anywhere to go — the ladder is
 * what makes "this stacks, eight times, up to +200%" readable at a glance.
 * No dir override: the pips fill from the start edge, so they fill rightwards
 * in English and leftwards in Hebrew.
 */
function BoostLadder({ pct }: { pct: number }) {
  const steps = Math.round(BOOST_MAX_PCT / BOOST_STEP_PCT);
  const filled = Math.round(pct / BOOST_STEP_PCT);
  return (
    <span className="mt-2 flex items-center gap-2">
      <span className="flex min-w-0 flex-1 gap-[3px]" aria-hidden>
        {Array.from({ length: steps }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i < filled ? "bg-emerald-400" : "bg-zinc-700/70"
            }`}
          />
        ))}
      </span>
      <span className="nums shrink-0 text-[10px] font-bold text-zinc-400" dir="ltr">
        {pct}/{BOOST_MAX_PCT}%
      </span>
    </span>
  );
}

function ResourceBoostCard({
  resource,
  pct,
  activeUntil,
  diamonds,
}: {
  resource: StorableResource;
  pct: number;
  activeUntil: string | null;
  diamonds: number;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(buyResourceBoost, {});
  const meta = RESOURCE_META[resource];
  const atCap = pct >= BOOST_MAX_PCT;

  return (
    <ShopCard
      icon={
        <Icon
          name={RESOURCE_ICON[resource]}
          size={18}
          className={RESOURCE_ICON_COLOR[resource]}
        />
      }
      title={t("תוספת {resource}", { resource: t(meta.label) })}
      badge={
        <span
          className={`nums shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-black ${
            pct > 0
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : "border-border-subtle bg-panel text-zinc-500"
          }`}
          dir="ltr"
        >
          +{pct}%
        </span>
      }
      desc={
        <>
          {t("אפשר לשדרג שוב ושוב — כל רכישה +{step}% מצטברים, עד +{max}% · 24ש׳", {
            step: BOOST_STEP_PCT,
            max: BOOST_MAX_PCT,
          })}
          <BoostLadder pct={pct} />
          {activeUntil && (
            <span className="mt-1 block text-emerald-400/90">
              {t("✨ פעיל עד {when}", { when: whenLabel(activeUntil, locale) })}
            </span>
          )}
        </>
      }
    >
      <form>
        <input type="hidden" name="resource" value={resource} />
        {atCap ? (
          <span className="flex items-center justify-center gap-1 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-center text-xs font-semibold text-gold">
            <Icon name="rankings" size={14} />{" "}
            {t("בתקרה (+{max}%)", { max: BOOST_MAX_PCT })}
          </span>
        ) : (
          <SubmitButton
            className="btn btn-gold w-full px-3 py-2 text-[13px]"
            formAction={action}
            disabled={diamonds < BOOST_STEP_COST}
            pendingText={t("רוכש...")}
          >
            {/* The target total, not the step: on a card that already sits at
                +75%, a bare "+25%" reads like the boost you'd be buying. */}
            {t("שדרג ל־+{next}%", { next: pct + BOOST_STEP_PCT })} ·{" "}
            <Price cost={BOOST_STEP_COST} />
          </SubmitButton>
        )}
      </form>
      {/* Once the boost is running the card says so itself ("✨ פעיל עד …" plus
          the +% badge), so the action's success line would only repeat it. */}
      <FormMessage error={state.error} success={activeUntil ? undefined : state.success} />
    </ShopCard>
  );
}

/* ------------------------------ shop discount ------------------------------ */

function DiscountCard({
  activeUntil,
  diamonds,
}: {
  activeUntil: string | null;
  diamonds: number;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(buyShopDiscount, {});
  return (
    <ShopCard
      icon={<span className="text-lg">🏷️</span>}
      title={t("הנחת חנות {pct}%", { pct: SHOP_DISCOUNT_PCT })}
      desc={t(
        "{pct}% הנחה על רכישת נשק וכל השדרוגים (מכרות, מחסנים, שדרוגי אימפריה) למשך 24 שעות.",
        { pct: SHOP_DISCOUNT_PCT }
      )}
    >
      <form>
        {activeUntil ? (
          <ActiveBadge
            label={t("✨ פעיל עד {when}", { when: whenLabel(activeUntil, locale) })}
          />
        ) : (
          <SubmitButton
            className="btn btn-gold w-full px-3 py-2 text-sm"
            formAction={action}
            disabled={diamonds < SHOP_DISCOUNT_COST}
            pendingText={t("רוכש...")}
          >
            {t("הפעל הנחה")} · <Price cost={SHOP_DISCOUNT_COST} />
          </SubmitButton>
        )}
      </form>
      <FormMessage error={state.error} success={activeUntil ? undefined : state.success} />
    </ShopCard>
  );
}

/* ------------------------------ turn packages ------------------------------ */

/**
 * "12 שעות" / "45 דקות" from a whole number of hours.
 *
 * Takes the translator rather than returning a rendered string, for the reason
 * every duration label in the game does: the branch between the two units is
 * part of the sentence, not a value a dictionary can carry.
 */
function cooldownLabel(t: T, hours: number): string {
  return hours >= 1
    ? t("{hours} שעות", { hours })
    : t("{minutes} דקות", { minutes: Math.round(hours * 60) });
}

/** One turn package as a card, sized to match the rest of the shop grid. */
function TurnPackageCard({
  index,
  turns,
  cost,
  cooldownHours,
  readyAt,
  diamonds,
}: {
  index: number;
  turns: number;
  cost: number;
  cooldownHours: number;
  readyAt: string | null;
  diamonds: number;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(buyTurns, {});

  return (
    <div className="panel-inset flex h-full flex-col items-center rounded-xl p-3.5 text-center transition-colors hover:border-gold/30">
      <Icon name="turns" size={26} className="text-crimson-bright" />
      <p className="nums mt-2 text-2xl font-black leading-none text-amber-300" dir="ltr">
        {formatNumber(turns)}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">{t("תורות")}</p>
      <p className="mt-2 text-[11px] text-zinc-500">
        {t("זמין אחת ל־{cooldown}", { cooldown: cooldownLabel(t, cooldownHours) })}
      </p>

      <div className="mt-auto grid w-full gap-1.5 pt-3">
        <form>
          <input type="hidden" name="packageIndex" value={index} />
          {readyAt ? (
            <span className="block rounded-lg border border-zinc-600/40 bg-zinc-700/10 px-2 py-2 text-center text-[11px] font-semibold text-zinc-400">
              {t("זמין ב־{when}", { when: whenLabel(readyAt, locale) })}
            </span>
          ) : (
            <SubmitButton
              className="btn btn-gold w-full px-3 py-2 text-sm"
              formAction={action}
              disabled={diamonds < cost}
              pendingText={t("רוכש...")}
            >
              {t("קנה")} · <Price cost={cost} />
            </SubmitButton>
          )}
        </form>
        <FormMessage error={state.error} success={state.success} />
      </div>
    </div>
  );
}

/* ------------------------------ raid shields ------------------------------ */

/**
 * One raid shield with a buy button per duration. A running shield can be
 * neither renewed nor extended — the buttons come back only once it has expired
 * and its ten-minute cooldown has run out, which is the window in which the
 * city gets its chance to raid.
 */
function ShieldCard({
  shieldKey,
  activeUntil,
  readyAt,
  diamonds,
}: {
  shieldKey: ShieldKey;
  activeUntil: string | null;
  /** When the next purchase unlocks, while the cooldown is still running. */
  readyAt: string | null;
  diamonds: number;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(buyRaidShield, {});
  const meta = SHIELDS.find((s) => s.key === shieldKey)!;

  return (
    <ShopCard
      icon={
        <span className={`inline-flex items-center gap-0.5 ${SHIELD_TONE[shieldKey]} rounded-md border px-1`}>
          <Icon name="shield" size={15} />
          <Icon name={SHIELD_ICON[shieldKey]} size={15} />
        </span>
      }
      title={t(meta.label)}
      badge={
        activeUntil ? (
          <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-black text-emerald-300">
            {t("פעיל")}
          </span>
        ) : null
      }
      desc={
        <>
          {t(meta.desc)}{" "}
          {t("התקיפה עצמה עדיין מתרחשת. לא ניתן לחדש בזמן שהמגן פעיל — רק {minutes} דקות אחרי שהוא נגמר.", {
            minutes: SHIELD_RENEW_COOLDOWN_MINUTES,
          })}
          {activeUntil && (
            <span className="mt-1 block text-emerald-400/90">
              {t("🛡️ מגן עד {when}", { when: whenLabel(activeUntil, locale) })}
            </span>
          )}
        </>
      }
    >
      {activeUntil ? (
        <ActiveBadge
          label={t("🛡️ פעיל עד {when}", { when: whenLabel(activeUntil, locale) })}
        />
      ) : readyAt ? (
        <span className="block rounded-lg border border-zinc-600/40 bg-zinc-700/10 px-3 py-2 text-center text-[11px] font-semibold text-zinc-400">
          {t("חלון חשוף · ניתן לחדש ב־{when}", { when: whenLabel(readyAt, locale) })}
        </span>
      ) : (
        // A form per duration rather than one form with two submitters: the
        // hours then travel as a plain hidden field, which survives both React's
        // action dispatch and a no-JS submit.
        <div className="grid grid-cols-2 gap-1.5">
          {meta.durations.map((d) => (
            <form key={d.hours} action={action}>
              <input type="hidden" name="shield" value={shieldKey} />
              <input type="hidden" name="hours" value={d.hours} />
              <SubmitButton
                className="btn btn-gold w-full px-2 py-2 text-xs"
                disabled={diamonds < d.cost}
                pendingText={t("רוכש...")}
              >
                {t("{hours}ש׳", { hours: d.hours })} · <Price cost={d.cost} />
              </SubmitButton>
            </form>
          ))}
        </div>
      )}
      <FormMessage error={state.error} success={activeUntil ? undefined : state.success} />
    </ShopCard>
  );
}

/* ------------------------------ hero points reset ------------------------------ */

function HeroResetCard({
  allocatedPoints,
  used,
  diamonds,
}: {
  allocatedPoints: number;
  used: boolean;
  diamonds: number;
}) {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(
    resetHeroPointsWithDiamonds,
    {}
  );
  return (
    <ShopCard
      icon={<span className="text-lg">🔄</span>}
      title={t("איפוס נקודות גיבור")}
      badge={
        <span
          className="nums shrink-0 rounded-full border border-border-subtle bg-panel px-2.5 py-0.5 text-xs font-black text-gold-bright"
          dir="ltr"
        >
          {allocatedPoints}
        </span>
      }
      desc={t("משחרר את כל הנקודות שהקצית (התקפה/הגנה/משאבים) חזרה לנקודות פנויות, בלי לגעת ברמה. פעם אחת בעונה.")}
    >
      <form>
        {used ? (
          <span className="block rounded-lg border border-zinc-600/40 bg-zinc-700/10 px-3 py-2 text-center text-xs font-semibold text-zinc-400">
            {t("כבר נוצל העונה")}
          </span>
        ) : (
          <SubmitButton
            className="btn btn-gold w-full px-3 py-2 text-sm"
            formAction={action}
            disabled={diamonds < HERO_POINTS_RESET_COST || allocatedPoints === 0}
            pendingText={t("מאפס...")}
          >
            {t("אפס")} · <Price cost={HERO_POINTS_RESET_COST} />
          </SubmitButton>
        )}
      </form>
      <FormMessage error={state.error} success={state.success} />
    </ShopCard>
  );
}

/* ------------------------------ bank interest spell ------------------------------ */

function BankInterestCard({
  preview,
  readyAt,
  diamonds,
}: {
  preview: number;
  readyAt: string | null;
  diamonds: number;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(
    castBankInterestSpell,
    {}
  );
  return (
    <ShopCard
      icon={<Icon name="bank" size={18} className="text-gold" />}
      title={t("קסם ריבית בנק")}
      badge={
        <span
          className="nums inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-panel px-2.5 py-0.5 text-xs font-black text-emerald-400"
          dir="ltr"
        >
          <Icon name="gold" size={13} className="text-gold-bright" />
          {formatNumber(preview)}
        </span>
      }
      desc={t("צובר מיידית תשלום ריבית אחד לבנק, לפי הרמה שלך. ניתן להטיל אחת ל־24 שעות.")}
    >
      <form>
        {readyAt ? (
          <span className="block rounded-lg border border-zinc-600/40 bg-zinc-700/10 px-3 py-2 text-center text-xs font-semibold text-zinc-400">
            {t("בקירור · זמין ב־{when}", { when: whenLabel(readyAt, locale) })}
          </span>
        ) : (
          <SubmitButton
            className="btn btn-gold w-full px-3 py-2 text-sm"
            formAction={action}
            disabled={diamonds < BANK_INTEREST_SPELL_COST || preview <= 0}
            pendingText={t("מטיל...")}
          >
            {t("הטל")} · <Price cost={BANK_INTEREST_SPELL_COST} />
          </SubmitButton>
        )}
      </form>
      <FormMessage error={state.error} success={state.success} />
    </ShopCard>
  );
}

/* ------------------------------ city downgrade spell ------------------------------ */

/**
 * The one card that sells a *loss*. Below CITY_DOWNGRADE_MIN_CITIES there is no
 * button at all — an empire holding a single city has nothing to give up — and
 * the card says so in place of the price, rather than offering a purchase the
 * server would only refuse.
 */
function CityDowngradeCard({
  cities,
  readyAt,
  diamonds,
  guildStake,
}: {
  cities: number;
  /** When the hourly cooldown lifts, while it is still running. */
  readyAt: string | null;
  diamonds: number;
  /** What the drop would cost the caster's guild, or null if nothing. */
  guildStake: GuildCityStake | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(
    castCityDowngradeSpell,
    {}
  );
  const eligible = cities >= CITY_DOWNGRADE_MIN_CITIES;
  const target = cities - 1;

  return (
    <ShopCard
      icon={<Icon name="base" size={18} className="text-crimson" />}
      title={t("קסם ירידת עיר")}
      badge={
        <span
          className="nums shrink-0 rounded-full border border-border-subtle bg-panel px-2.5 py-0.5 text-xs font-black text-gold-bright"
          dir="ltr"
        >
          {eligible ? `${cities} → ${target}` : cities}
        </span>
      }
      /* The name already carries its own "(tier)" — printing the bare number
         again here would nest one parenthesis inside another. */
      desc={t(
        "מוריד אותך עיר אחת בלבד — מעיר {from} ל{to}. אין החזר משאבים, והדרך חזרה היא ייסוד העיר מחדש במחיר המלא. ניתן להטיל אחת ל־{hours} שעה.",
        {
          from: cityName(t, cities),
          to: cityName(t, eligible ? target : cities),
          hours: CITY_DOWNGRADE_COOLDOWN_HOURS,
        }
      )}
    >
      {/* Down is a city change too: the same guild rule applies, and the
          diamonds are gone either way. */}
      {eligible && <GuildCityWarning stake={guildStake} />}
      <form>
        {!eligible ? (
          <span className="block rounded-lg border border-zinc-600/40 bg-zinc-700/10 px-3 py-2 text-center text-[11px] font-semibold text-zinc-400">
            {t("זמין מעיר {min} ומעלה — אין לך עיר לוותר עליה", {
              min: CITY_DOWNGRADE_MIN_CITIES,
            })}
          </span>
        ) : readyAt ? (
          <span className="block rounded-lg border border-zinc-600/40 bg-zinc-700/10 px-3 py-2 text-center text-xs font-semibold text-zinc-400">
            {t("בקירור · זמין ב־{when}", { when: whenLabel(readyAt, locale) })}
          </span>
        ) : (
          <SubmitButton
            className="btn btn-gold w-full px-3 py-2 text-sm"
            formAction={action}
            disabled={diamonds < CITY_DOWNGRADE_COST}
            pendingText={t("מטיל...")}
          >
            {t("רד לעיר {target}", { target })} · <Price cost={CITY_DOWNGRADE_COST} />
          </SubmitButton>
        )}
      </form>
      <FormMessage error={state.error} success={state.success} />
    </ShopCard>
  );
}

/* ------------------------------ shop shell ------------------------------ */

export interface DiamondShopProps {
  diamonds: number;
  boosts: { resource: StorableResource; pct: number; activeUntil: string | null }[];
  turnReadyAt: (string | null)[];
  discountActiveUntil: string | null;
  allocatedPoints: number;
  pointsResetUsed: boolean;
  interestPreview: number;
  bankReadyAt: string | null;
  /** Current city tier — the city-downgrade spell reads (and spends) it. */
  cities: number;
  /** When the city-downgrade spell comes off cooldown, while it is running. */
  cityDowngradeReadyAt: string | null;
  /** What a city change would cost the player's guild, or null if nothing. */
  guildStake: GuildCityStake | null;
  /**
   * Per raid shield: when it expires (null where none is running) and, once it
   * has, when the renewal cooldown lifts.
   */
  shields: Record<ShieldKey, { activeUntil: string | null; readyAt: string | null }>;
}

export function DiamondShop({
  diamonds,
  boosts,
  turnReadyAt,
  discountActiveUntil,
  allocatedPoints,
  pointsResetUsed,
  interestPreview,
  bankReadyAt,
  cities,
  cityDowngradeReadyAt,
  guildStake,
  shields,
}: DiamondShopProps) {
  const t = useT();
  return (
    <div className="space-y-7">
      <section>
        <SectionTitle
          icon={<Icon name="mine" size={20} className="text-crimson" />}
          title={t("בונוס תפוקת משאבים")}
          hint={t("רכישות מצטברות — עד +{max}% לכל משאב · 24ש׳", { max: BOOST_MAX_PCT })}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {boosts.map((b) => (
            <ResourceBoostCard key={b.resource} {...b} diamonds={diamonds} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          icon={<Icon name="shield" size={20} className="text-crimson" />}
          title={t("מגני תקיפה")}
          hint={t("24 או 48 שעות · חידוש רק {minutes} דקות אחרי שנגמר", {
            minutes: SHIELD_RENEW_COOLDOWN_MINUTES,
          })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {SHIELDS.map((s) => (
            <ShieldCard
              key={s.key}
              shieldKey={s.key}
              activeUntil={shields[s.key].activeUntil}
              readyAt={shields[s.key].readyAt}
              diamonds={diamonds}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          icon={<Icon name="turns" size={20} className="text-crimson" />}
          title={t("חבילות תורות")}
          hint={t("לכל חבילה קירור משלה")}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {TURN_PACKAGES.map((pkg, i) => (
            <TurnPackageCard
              key={pkg.cooldownKind}
              index={i}
              turns={pkg.turns}
              cost={pkg.cost}
              cooldownHours={pkg.cooldownHours}
              readyAt={turnReadyAt[i] ?? null}
              diamonds={diamonds}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          icon={<Icon name="spark" size={20} className="text-crimson" />}
          title={t("קסמים ושירותים")}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DiscountCard activeUntil={discountActiveUntil} diamonds={diamonds} />
          <BankInterestCard
            preview={interestPreview}
            readyAt={bankReadyAt}
            diamonds={diamonds}
          />
          <HeroResetCard
            allocatedPoints={allocatedPoints}
            used={pointsResetUsed}
            diamonds={diamonds}
          />
          <CityDowngradeCard
            cities={cities}
            readyAt={cityDowngradeReadyAt}
            diamonds={diamonds}
            guildStake={guildStake}
          />
        </div>
      </section>
    </div>
  );
}
