"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { StoreSeal } from "@/components/game/StoreSeal";
import { Input } from "@/components/ui/Input";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatNumber } from "@/lib/game/format";
import {
  DIAMOND_PACKAGES,
  discountedPrice,
  formatIls,
  isValidBuyerName,
  isValidBuyerPhone,
  packageValuePct,
  STORE_IDLE,
  type DiamondPackage,
  type StoreActionState,
} from "@/lib/game/diamondStore";
import {
  purchaseDiamondPackage,
  startDiamondCheckout,
} from "@/server/actions/diamondStore";
import { useT } from "@/i18n/client";

/**
 * How the active gateway takes money.
 *
 * - `direct` — one server call charges and credits (the mock provider). The
 *   modal is a confirmation and nothing else.
 * - `order` — the buyer pays on the gateway's own hosted page, so the modal
 *   collects what that page demands (a full name and an Israeli mobile) and then
 *   hands the browser over to it.
 */
type CheckoutKind = "direct" | "order";

// i18n-keys-start: dictionary keys, drawn through t(tag.label) / t(SEAL_NOTE)
const TAG_META: Record<
  NonNullable<DiamondPackage["tag"]>,
  { label: string; className: string }
> = {
  popular: {
    label: "הכי פופולרי",
    className: "border-sky-400/60 bg-sky-500/20 text-sky-200",
  },
  best: {
    label: "הכי משתלם",
    className: "border-amber-400/60 bg-amber-500/20 text-amber-200",
  },
};

/** The line on the seal's plate while the store is shut. */
const SEAL_NOTE = "עוד כמה ליטושים והיהלומים מוכנים";
// i18n-keys-end

export function DiamondStore({
  discountPct,
  purchasesLive = false,
  locked = false,
  testMode = false,
  checkoutKind = "direct",
}: {
  discountPct: number;
  /** Whether real-money purchases are open to everyone (real provider wired). */
  purchasesLive?: boolean;
  /**
   * This viewer cannot pay yet, so the whole grid is chained shut instead of
   * taking a click that only ever ends in a "coming soon" modal.
   */
  locked?: boolean;
  /** Charges are play money (the mock provider). */
  testMode?: boolean;
  /** Shape of the active gateway — decides what the checkout modal asks for. */
  checkoutKind?: CheckoutKind;
}) {
  const t = useT();
  const hasDiscount = discountPct > 0;
  const [pending, setPending] = useState<DiamondPackage | null>(null);

  /* The "best value" package headlines the store as a full-width card; the rest
     fill an exact 2×2 / 1×4 grid so no row is ever left with an empty slot. */
  const featured =
    DIAMOND_PACKAGES.find((p) => p.tag === "best") ?? DIAMOND_PACKAGES[0];
  const rest = DIAMOND_PACKAGES.filter((p) => p.id !== featured.id);

  return (
    <div className="space-y-4">
      {hasDiscount && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-l from-amber-500/15 via-amber-400/5 to-transparent px-5 py-4">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 animate-pulse rounded-full bg-amber-400/20 blur-3xl"
          />
          <div className="relative flex items-center gap-4">
            <span aria-hidden className="text-4xl">
              🔥
            </span>
            <div className="min-w-0">
              <p className="text-lg font-black text-amber-200">
                {t("מבצע לזמן מוגבל!")}
              </p>
              {/* "נצל את זה עכשיו" in front of a chained store is a promise
                  the page cannot keep. */}
              <p className="nums text-sm text-amber-100/80">
                {locked
                  ? t("כל חבילות היהלומים ב־{pct}% הנחה — מחכה לך ברגע שהחנות תיפתח.", {
                      pct: discountPct,
                    })
                  : t("כל חבילות היהלומים ב־{pct}% הנחה. הזמן מוגבל — נצל את זה עכשיו.", {
                      pct: discountPct,
                    })}
              </p>
            </div>
            <span
              className="nums mr-auto shrink-0 rounded-full border border-amber-400/60 bg-amber-400/15 px-3 py-1.5 text-base font-black text-amber-200"
              dir="ltr"
            >
              −{discountPct}%
            </span>
          </div>
        </div>
      )}

      {/* Locked: the cards stay legible — the prices are the advertisement —
          but they go grey behind the chains and their buttons go dead, so the
          seal is the only thing on the page that answers a click. */}
      <div className={locked ? "seal-wrap rounded-2xl" : undefined}>
        <div className={locked ? "seal-body space-y-4" : "space-y-4"}>
          <FeaturedPackage
            pkg={featured}
            discountPct={discountPct}
            locked={locked}
            onBuy={() => setPending(featured)}
          />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {rest.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                discountPct={discountPct}
                locked={locked}
                onBuy={() => setPending(pkg)}
              />
            ))}
          </div>
        </div>

        {locked && <StoreSeal note={t(SEAL_NOTE)} />}
      </div>

      <p className="text-center text-xs text-zinc-500">
        {locked
          ? t("החנות תיפתח ברגע שמערכת התשלומים תסיים את ההרצה. עד אז אפשר להרוויח יהלומים במשחק עצמו.")
          : purchasesLive
            ? t("התשלומים מעובדים בצורה מאובטחת. היהלומים נזקפים לחשבונך מיד לאחר הרכישה.")
            : t("מערכת התשלומים בהרצה אחרונה. היהלומים נזקפים אוטומטית לחשבונך מיד עם סיום הרכישה.")}
      </p>

      {pending && (
        <CheckoutModal
          pkg={pending}
          discountPct={discountPct}
          testMode={testMode}
          checkoutKind={checkoutKind}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------ package cards ------------------------------ */

/** "+123% ערך" — how much more each shekel buys vs the entry package. */
function ValueBadge({ pct, className = "" }: { pct: number; className?: string }) {
  const t = useT();
  if (pct <= 0) return null;
  return (
    <span
      className={`nums rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-300 ${className}`}
    >
      <span dir="ltr">+{pct}%</span> {t("ערך")}
    </span>
  );
}

/** Old price / new price, stacked inline. */
function PriceTag({
  pkg,
  discountPct,
  size = "sm",
}: {
  pkg: DiamondPackage;
  discountPct: number;
  size?: "sm" | "lg";
}) {
  const hasDiscount = discountPct > 0;
  const net = discountedPrice(pkg.priceIls, discountPct);
  return (
    <span className="flex items-baseline justify-center gap-2">
      {hasDiscount && (
        <span className="nums text-xs text-zinc-500 line-through" dir="ltr">
          {formatIls(pkg.priceIls)}
        </span>
      )}
      <span
        className={`nums font-black ${size === "lg" ? "text-3xl" : "text-xl"} ${
          hasDiscount ? "text-emerald-300" : "text-gold-bright"
        }`}
        dir="ltr"
      >
        {formatIls(net)}
      </span>
    </span>
  );
}

/** The headline "best value" package — a wide banner card. */
function FeaturedPackage({
  pkg,
  discountPct,
  locked,
  onBuy,
}: {
  pkg: DiamondPackage;
  discountPct: number;
  locked: boolean;
  onBuy: () => void;
}) {
  const t = useT();
  const total = pkg.diamonds;
  const tag = pkg.tag ? TAG_META[pkg.tag] : null;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-amber-400/50 bg-gradient-to-l from-amber-500/12 via-panel to-panel p-4 shadow-[0_0_40px_-14px_rgba(251,191,36,0.5)] sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-400/20 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-right">
        <span aria-hidden className="text-5xl drop-shadow-lg sm:text-6xl">
          {pkg.emoji}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {tag && (
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-black ${tag.className}`}
              >
                {t(tag.label)}
              </span>
            )}
            <ValueBadge pct={packageValuePct(pkg)} />
          </div>
          <p className="mt-1.5 text-base font-black text-amber-100">{t(pkg.name)}</p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
            <Icon name="diamond" size={24} className="text-cyan-300" />
            <span className="nums text-3xl font-black text-sky-200" dir="ltr">
              {formatNumber(total)}
            </span>
            <span className="text-xs font-semibold text-zinc-400">{t("יהלומים")}</span>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-2 sm:w-auto">
          <PriceTag pkg={pkg} discountPct={discountPct} size="lg" />
          <button
            type="button"
            onClick={onBuy}
            disabled={locked}
            tabIndex={locked ? -1 : undefined}
            className="btn btn-gold w-full px-6 py-2.5 text-sm sm:w-auto"
          >
            {locked ? t("בקרוב") : t("רכישה מיידית")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One standard package tile. */
function PackageCard({
  pkg,
  discountPct,
  locked,
  onBuy,
}: {
  pkg: DiamondPackage;
  discountPct: number;
  locked: boolean;
  onBuy: () => void;
}) {
  const t = useT();
  const total = pkg.diamonds;
  const tag = pkg.tag ? TAG_META[pkg.tag] : null;
  const valuePct = packageValuePct(pkg);

  return (
    <div
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border p-3.5 text-center transition-transform duration-200 ${
        locked ? "" : "hover:-translate-y-1"
      } ${
        tag
          ? "border-sky-400/50 bg-gradient-to-b from-sky-500/12 via-panel to-panel"
          : "border-sky-400/20 bg-gradient-to-b from-sky-500/5 via-panel to-panel"
      }`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-sky-400/12 blur-3xl"
      />

      {/* badge row — always rendered so every tile shares one baseline */}
      <div className="relative flex h-5 items-center justify-center">
        {tag ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${tag.className}`}
          >
            {t(tag.label)}
          </span>
        ) : (
          <ValueBadge pct={valuePct} />
        )}
      </div>

      <p className="relative mt-1.5 text-xs font-bold text-zinc-300">{t(pkg.name)}</p>
      <span aria-hidden className="relative mt-1 text-3xl drop-shadow-lg">
        {pkg.emoji}
      </span>

      <div className="relative mt-2 flex items-center justify-center gap-1.5">
        <Icon name="diamond" size={20} className="text-cyan-300" />
        <span className="nums text-xl font-black text-sky-200" dir="ltr">
          {formatNumber(total)}
        </span>
      </div>

      <div className="relative mt-auto grid gap-2 pt-3">
        <PriceTag pkg={pkg} discountPct={discountPct} />
        <button
          type="button"
          onClick={onBuy}
          disabled={locked}
          tabIndex={locked ? -1 : undefined}
          className="btn btn-ghost w-full px-3 py-2 text-sm"
        >
          {locked ? t("בקרוב") : t("רכישה")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ checkout modal ------------------------------ */

function CheckoutModal({
  pkg,
  discountPct,
  testMode,
  checkoutKind,
  onClose,
}: {
  pkg: DiamondPackage;
  discountPct: number;
  testMode: boolean;
  checkoutKind: CheckoutKind;
  onClose: () => void;
}) {
  const t = useT();
  const hosted = checkoutKind === "order";
  const [state, action] = useActionState<StoreActionState, FormData>(
    hosted ? startDiamondCheckout : purchaseDiamondPackage,
    STORE_IDLE
  );
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");

  const total = pkg.diamonds;
  const net = discountedPrice(pkg.priceIls, discountPct);
  const hasDiscount = discountPct > 0;
  const credited = state.status === "success" ? (state.diamonds ?? total) : null;
  const redirecting = state.status === "redirect" && !!state.url;

  // A full-page navigation, not a router push: the destination is the gateway's
  // own origin, and the buyer must actually leave our app to pay.
  useEffect(() => {
    if (state.status === "redirect" && state.url) {
      window.location.href = state.url;
    }
  }, [state]);

  // The gateway rejects these itself, but only after a PENDING purchase row has
  // been opened and the buyer has watched a spinner — so the button stays dead
  // until both are plausible.
  const detailsReady =
    !hosted || (isValidBuyerName(buyerName) && isValidBuyerPhone(buyerPhone));

  return (
    <div
      // dvh, and z-100 with it: this is a modal, and the modal rung is 100 (see
      // the stacking order in globals.css) — at z-50 the chat dock sat on top of
      // the purchase card. Height in dvh so the "אשר רכישה" button at the foot
      // of the card is not behind the phone's URL bar. See ui/Dialog.
      className="fixed inset-x-0 top-0 z-[100] flex h-[100dvh] items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        // Same omission the wheel had: a modal that takes real money and was
        // announced to a screen reader as an anonymous div.
        role="dialog"
        aria-modal="true"
        aria-label={t("אישור רכישה")}
        className="relative max-h-full w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-sky-400/30 bg-panel p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-sky-400/15 blur-3xl"
        />

        {redirecting ? (
          <div className="relative space-y-3 text-center">
            <span aria-hidden className="block animate-pulse text-5xl">
              🔐
            </span>
            <h3 className="text-lg font-black text-sky-200">
              {t("מעביר לתשלום מאובטח…")}
            </h3>
            <p className="text-sm text-zinc-400">
              {t("עוד רגע תועבר לעמוד הסליקה. אל תסגור את החלון.")}
            </p>
          </div>
        ) : credited !== null ? (
          <div className="relative space-y-3 text-center">
            <span aria-hidden className="block text-5xl">
              ✅
            </span>
            <h3 className="text-lg font-black text-emerald-300">{t("התשלום בוצע!")}</h3>
            <p className="nums text-sm text-zinc-300">
              {t("נזקפו {count} יהלומים לחשבונך.", {
                count: formatNumber(credited || total),
              })}
            </p>
            <button type="button" onClick={onClose} className="btn btn-gold w-full">
              {t("מעולה!")}
            </button>
          </div>
        ) : state.status === "unavailable" ? (
          <div className="relative space-y-3 text-center">
            <span aria-hidden className="block text-5xl">
              🚧
            </span>
            <h3 className="text-lg font-black text-sky-200">{t("התשלום בקרוב!")}</h3>
            <p className="text-sm text-zinc-400">
              {state.message ??
                t("רכישות יהלומים ייפתחו ברגע שנחבר את מערכת התשלומים. תודה על הסבלנות!")}
            </p>
            <button type="button" onClick={onClose} className="btn btn-gold w-full">
              {t("הבנתי")}
            </button>
          </div>
        ) : (
          <div className="relative space-y-4">
            <div className="flex flex-col items-center gap-1 text-center">
              <span aria-hidden className="text-5xl drop-shadow-lg">
                {pkg.emoji}
              </span>
              <h3 className="text-lg font-black text-sky-100">{t("אישור רכישה")}</h3>
              <p className="text-xs font-bold text-zinc-400">{t(pkg.name)}</p>
            </div>

            <div className="space-y-2 rounded-xl border border-border-subtle bg-panel-inset p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">{t("יהלומים")}</span>
                <span className="nums inline-flex items-center gap-1 font-black text-sky-200" dir="ltr">
                  <Icon name="diamond" size={16} className="text-cyan-300" />
                  {formatNumber(total)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border-subtle pt-2">
                <span className="text-zinc-400">{t("לתשלום")}</span>
                <span className="flex items-baseline gap-2">
                  {hasDiscount && (
                    <span className="nums text-xs text-zinc-500 line-through" dir="ltr">
                      {formatIls(pkg.priceIls)}
                    </span>
                  )}
                  <span
                    className={`nums text-xl font-black ${
                      hasDiscount ? "text-emerald-300" : "text-gold-bright"
                    }`}
                    dir="ltr"
                  >
                    {formatIls(net)}
                  </span>
                </span>
              </div>
            </div>

            {state.status === "error" && state.message && (
              <p className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
                {state.message}
              </p>
            )}

            <form className="grid gap-2">
              <input type="hidden" name="packageId" value={pkg.id} />

              {hosted && (
                <div className="grid gap-2 pb-1">
                  {/* Required by the gateway's payment page, and by the receipt
                      an עוסק פטור issues per sale — not by us. Said out loud so
                      it does not read as arbitrary data collection. */}
                  <p className="text-[11px] text-zinc-500">
                    {t("פרטים אלה נדרשים על ידי חברת הסליקה ולהפקת הקבלה.")}
                  </p>
                  <Input
                    label={t("שם מלא")}
                    name="buyerName"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    autoComplete="name"
                    placeholder={t("ישראל ישראלי")}
                  />
                  <Input
                    label={t("טלפון נייד")}
                    name="buyerPhone"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="0501234567"
                    dir="ltr"
                    className="text-left"
                  />
                </div>
              )}

              <SubmitButton
                className="btn btn-gold w-full"
                formAction={action}
                disabled={!detailsReady}
                pendingText={hosted ? t("פותח עמוד תשלום...") : t("מעבד תשלום...")}
              >
                {hosted
                  ? t("המשך לתשלום {price}", { price: formatIls(net) })
                  : t("שלם {price}", { price: formatIls(net) })}
              </SubmitButton>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost w-full text-sm"
              >
                {t("ביטול")}
              </button>
            </form>

            <p className="text-center text-[11px] leading-relaxed text-zinc-500">
              {t("בהשלמת הרכישה אתה מאשר את")}{" "}
              <Link href="/terms" target="_blank" className="text-gold underline">
                {t("תנאי השימוש")}
              </Link>{" "}
              {t("ואת")}{" "}
              <Link href="/refund" target="_blank" className="text-gold underline">
                {t("מדיניות הביטולים")}
              </Link>
              .
            </p>

            {testMode && (
              <p className="text-center text-[11px] text-zinc-500">
                {t("מצב הדגמה — לא מתבצע חיוב אמיתי עד לחיבור ספק התשלומים.")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
