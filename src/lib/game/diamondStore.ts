/**
 * Diamond store — the real-money purchase catalogue shown on the "רכישת
 * יהלומים" page. Prices are in ILS. The admin can apply a global percentage
 * discount to every package from the balance panel
 * (`diamondStore.purchaseDiscountPct`); {@link discountedPrice} applies it.
 *
 * Client-safe (no server-only imports) so the store card component can share
 * these definitions with the server page.
 */

/**
 * Currency every package is priced and charged in. Whatever gateway is wired
 * gets told this code on every charge, and the amount stored on the audit row
 * is compared against the settled currency before any diamonds are credited.
 */
export const STORE_CURRENCY = "ILS";

export interface DiamondPackage {
  id: string;
  /** Hebrew display name shown on the store card. */
  name: string;
  /**
   * Diamonds granted. One number, and the only number — there is no bonus tier
   * and no "+X בונוס" split any more (see the catalogue note below).
   */
  diamonds: number;
  /** Full price in ILS, before any admin discount. */
  priceIls: number;
  /** Optional highlight tag. */
  tag?: "popular" | "best";
  /** Emoji shown on the package card. */
  emoji: string;
}

/**
 * The catalogue.
 *
 * **Only the entry price moved on 2026-08-03, and the gateway is why.** Grow's
 * Light plan charges 1% *plus a flat ₪1 per transaction* once the month passes
 * 20 sales. A flat per-sale fee is regressive, and at ₪13.90 it was eating 9.7%
 * of the ticket (VAT included) where the top package loses 1.6% — the smallest
 * buyers were paying three times the processing rate of the largest.
 *
 * | package | price | processing cost past 20 sales/mo |
 * | ------- | ----- | -------------------------------- |
 * | ניצוץ   | 13.9 → **19.9** | 9.7% → **7.1%** |
 * | פיקדון  | 34.9 | 4.6% |
 * | ארגז    | 69.9 | 2.9% |
 * | כספת    | 139.9 | 2.0% |
 * | כתר     | 279.9 | 1.6% |
 *
 * The other four are untouched **on purpose**, and that is the part worth not
 * undoing later. A first pass raised פיקדון and ארגז too, on a reading of Grow's
 * terms where each sale burned an included transaction *and* an included
 * document (₪2, not ₪1). Grow confirmed ₪1, which collapsed the case for those
 * two: raising ארגז from 69.9 to 74.9 moved its processing cost from 2.9% to
 * 2.8%, buying nothing while putting 7% onto the price of the package that
 * carries the "הכי פופולרי" tag. Do not re-raise them without a fee change that
 * actually justifies it.
 *
 * **ניצוץ's diamond count moved on 2026-08-13, and only its diamond count.**
 * Priced against the competing Hebrew title, our diamond was the cheaper one at
 * every tier but the first: their ₪20 entry pack pays 30💎/₪ where ours paid
 * 20.1, so the one number a player compares before he has spent anything was the
 * one number we lost on. 650💎 at the same ₪19.90 puts the entry tier at
 * 32.7💎/₪ — ahead of theirs — without touching the price, which is what the
 * flat-fee table above is actually about.
 *
 * The cost is the value curve: `packageValuePct` is measured against the entry
 * tier, so a richer ניצוץ shrinks every "+X% ערך" badge above it (ארגז drops
 * from ~149% to ~53%). That badge is the nudge up the ladder, and the flat fee is
 * why the nudge matters — one ₪280 sale is cheaper to process than twenty ₪14
 * ones. Accepted anyway: a badge only persuades someone already in the store,
 * and the entry rate is what decides whether he walks in. If the ladder needs its
 * pull back, add diamonds to the *upper* packages rather than taking them off
 * this one.
 *
 * **The bonus split is gone as of 2026-08-13 — every package is one flat
 * number.** A package used to carry `diamonds` plus a `bonus` on top, shown as
 * "3,000 +500 בונוס", and the pair was always a presentation of a single total
 * nobody could buy separately: the checkout charged for the sum, credited the
 * sum, and the split existed only to dress the sum up. Deleting it changed no
 * price and no grant except at the top tier, which was rounded 30,000 → 28,000.
 * Do not reintroduce a bonus field to make a package *look* generous; move the
 * diamond count itself, where a player can compare it against a competitor's.
 *
 * `DiamondPurchase` keeps its `baseDiamonds`/`bonusDiamonds` columns, and new
 * rows write the whole grant to `baseDiamonds` with 0 bonus. The columns stay
 * because purchases already settled under the old catalogue snapshot a real
 * split, and a receipt must keep saying what was actually sold.
 *
 * Prices are consumer-facing and therefore VAT-inclusive if the operator ever
 * becomes an עוסק מורשה. Changing one here changes only what future buyers pay:
 * every `DiamondPurchase` row snapshots `basePriceIls` and `priceIls` at
 * purchase time, so past receipts keep saying what was actually charged.
 */
export const DIAMOND_PACKAGES: readonly DiamondPackage[] = [
  { id: "spark", name: "ניצוץ", emoji: "✨", diamonds: 650, priceIls: 19.9 },
  { id: "pouch", name: "פיקדון", emoji: "💠", diamonds: 1300, priceIls: 34.9 },
  { id: "chest", name: "ארגז אוצר", emoji: "🧰", diamonds: 3500, priceIls: 69.9, tag: "popular" },
  { id: "vault", name: "כספת הקיסר", emoji: "🏆", diamonds: 9000, priceIls: 139.9, tag: "best" },
  { id: "hoard", name: "אוצר הכתר", emoji: "👑", diamonds: 28000, priceIls: 279.9 },
];

/**
 * Diamonds granted per shekel — the raw value of a package.
 *
 * This is the one number the catalogue is actually tuned on, and it has to keep
 * rising with the price: 32.7 → 37.2 → 50.1 → 64.3 → 100.1 💎/₪. A package that
 * pays less per shekel than a cheaper one is a trap, not a tier.
 */
export function packageRate(pkg: DiamondPackage): number {
  return pkg.diamonds / pkg.priceIls;
}

/**
 * How much more value a package gives per shekel than the entry tier, in
 * percent (0 for the entry tier itself). Drives the "+X% ערך" badge.
 */
export function packageValuePct(pkg: DiamondPackage): number {
  const base = packageRate(DIAMOND_PACKAGES[0]);
  if (base <= 0) return 0;
  return Math.max(0, Math.round((packageRate(pkg) / base - 1) * 100));
}

/** Apply the admin discount % to a package price, rounded to agorot. */
export function discountedPrice(priceIls: number, discountPct: number): number {
  if (discountPct <= 0) return priceIls;
  const clamped = Math.min(100, Math.max(0, discountPct));
  return Math.round(priceIls * (1 - clamped / 100) * 100) / 100;
}

/** Price formatted as "₪9.90". */
export function formatIls(priceIls: number): string {
  return `₪${priceIls.toFixed(2)}`;
}

/**
 * Result of a diamond-package checkout.
 * - `unavailable`: purchases are gated (no real provider yet) and the caller
 *   isn't an admin — shown as a friendly "coming soon", not an error.
 * - `redirect`: an order was opened with a hosted-checkout gateway and the buyer
 *   has to finish paying on its page. Nothing has been charged yet, and no
 *   diamonds exist until the gateway confirms the payment server-side.
 *
 * Lives here (a client-safe module) rather than in the `"use server"` action
 * file: a `"use server"` file may only export async functions, so the
 * `STORE_IDLE` constant below cannot be exported from there.
 */
export interface StoreActionState {
  status: "idle" | "success" | "error" | "unavailable" | "redirect";
  message?: string;
  /** Total diamonds credited on a successful purchase. */
  diamonds?: number;
  /** Hosted payment page to send the buyer to (only on `redirect`). */
  url?: string;
}

export const STORE_IDLE: StoreActionState = { status: "idle" };

/**
 * Validation of the buyer details a hosted gateway demands, shared by the
 * checkout form and the server action so the browser can catch a typo before a
 * PENDING purchase row is opened for it.
 *
 * Neither rule is ours: Grow's payment page rejects a single-word name outright,
 * and an עוסק פטור has to name a real customer on the receipt it issues per
 * sale. The phone accepts what people actually type — spaces, dashes, +972.
 */
export function isValidBuyerName(raw: string): boolean {
  return raw.trim().split(/\s+/).filter((part) => part.length > 0).length >= 2;
}

export function isValidBuyerPhone(raw: string): boolean {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  return /^05\d{8}$/.test(digits);
}
