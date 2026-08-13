"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser, logAdmin, type SessionUser } from "@/lib/admin";
import { isBanned } from "@/lib/ban";
import { rateLimit } from "@/lib/rateLimit";
import { getTunables } from "@/lib/game/config";
import {
  DIAMOND_PACKAGES,
  discountedPrice,
  formatIls,
  isValidBuyerName,
  isValidBuyerPhone,
} from "@/lib/game/diamondStore";
import type { StoreActionState } from "@/lib/game/diamondStore";
import { arePurchasesLive, getPaymentProvider } from "@/server/payments";
import type { ChargeInput, PaymentProvider } from "@/server/payments";
import { getT } from "@/i18n/server";

// The `StoreActionState` type and the `STORE_IDLE` idle constant live in the
// client-safe `@/lib/game/diamondStore` module — a `"use server"` file may only
// export async functions, so neither the constant nor a `export type { ... }`
// re-export can originate here (the server-actions loader re-exports every
// binding of this module by name, and a type has no runtime binding — that is
// exactly what threw `ReferenceError: StoreActionState is not defined`).
// Import the type from `@/lib/game/diamondStore` instead.

/** Everything a checkout needs, once the caller has cleared every gate. */
interface CheckoutContext {
  user: SessionUser;
  empire: { id: string; name: string };
  provider: PaymentProvider;
  pkg: (typeof DIAMOND_PACKAGES)[number];
  /** Price after the admin discount — the only amount ever charged. */
  amountIls: number;
  discountPct: number;
  /** Diamonds the package grants. */
  total: number;
}

type Preflight =
  | { ok: true; ctx: CheckoutContext }
  | { ok: false; status: "error" | "unavailable"; message: string };

/**
 * Shared gate for every checkout entry point (one-shot charge and the
 * create-order half of an approval flow): session, ban, verified email, rate
 * limit, empire, and the pre-go-live admin-only gate. The price is computed
 * here from the package id and the live tunables — never taken from the client.
 */
async function preflight(packageId: string, limiterKey: string): Promise<Preflight> {
  const t = await getT();
  const pkg = DIAMOND_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return { ok: false, status: "error", message: t("חבילה לא תקינה") };

  const user = await getSessionUser();
  if (!user) return { ok: false, status: "error", message: t("יש להתחבר כדי לרכוש") };
  if (isBanned(user)) {
    return { ok: false, status: "error", message: t("החשבון חסום") };
  }
  // Every other player-facing action resolves its actor through
  // `getActiveEmpireId`, which refuses unverified accounts. This one resolves
  // the empire itself, so it has to repeat the check — without it, an account
  // created seconds ago against an address nobody owns could reach the
  // real-money checkout, and the `userEmail` snapshot written to the
  // DiamondPurchase audit row (the record a chargeback is argued from) would
  // name an unproven address.
  if (!user.emailVerified) {
    return {
      ok: false,
      status: "error",
      message: t("יש לאמת את כתובת האימייל לפני רכישה"),
    };
  }

  // Rate-limit the checkout itself: every attempt writes a PENDING
  // DiamondPurchase row (and, with an approval-based gateway, opens an order)
  // before any money moves, so an unthrottled caller can inflate the audit
  // table indefinitely.
  if (!(await rateLimit(`${limiterKey}:${user.id}`, 10, 15 * 60 * 1000))) {
    return {
      ok: false,
      status: "error",
      message: t("יותר מדי נסיונות רכישה. נסה שוב מאוחר יותר."),
    };
  }

  const empire = await prisma.empire.findUnique({
    where: { userId: user.id },
    select: { id: true, name: true },
  });
  if (!empire) return { ok: false, status: "error", message: t("לא נמצאה אימפריה") };

  // Interim gate: until a real payment provider is live, only admins may run a
  // (test) purchase — so no regular player earns free diamonds meanwhile.
  if (!arePurchasesLive() && user.role !== "ADMIN") {
    return {
      ok: false,
      status: "unavailable",
      message: t("רכישות יהלומים ייפתחו ברגע שנחבר את מערכת התשלומים. תודה על הסבלנות!"),
    };
  }

  const { diamondStore } = await getTunables();
  const discountPct = Math.min(100, Math.max(0, diamondStore.purchaseDiscountPct));

  return {
    ok: true,
    ctx: {
      user,
      empire,
      provider: getPaymentProvider(),
      pkg,
      amountIls: discountedPrice(pkg.priceIls, discountPct),
      discountPct,
      total: pkg.diamonds,
    },
  };
}

/** Open the PENDING audit row that a charge settles against. */
async function openPurchaseRow(ctx: CheckoutContext) {
  return prisma.diamondPurchase.create({
    data: {
      empireId: ctx.empire.id,
      userId: ctx.user.id,
      userEmail: ctx.user.email,
      empireName: ctx.empire.name,
      packageId: ctx.pkg.id,
      diamonds: ctx.total,
      baseDiamonds: ctx.pkg.diamonds,
      // The catalogue has no bonus tier any more — the whole grant is the base.
      // The column stays for the purchases settled back when it did.
      bonusDiamonds: 0,
      priceIls: ctx.amountIls,
      basePriceIls: ctx.pkg.priceIls,
      discountPct: ctx.discountPct,
      currency: "ILS",
      provider: ctx.provider.name,
      // No real money moves in test mode (the mock provider) — flag it so real
      // revenue reports separately from test purchases.
      isTest: ctx.provider.isTestMode,
      status: "PENDING",
    },
  });
}

/** Admin test purchases (pre-go-live) leave a trail in the admin audit log. */
async function logTestPurchase(input: {
  user: SessionUser;
  provider: PaymentProvider;
  empireId: string | null;
  packageId: string;
  diamonds: number;
  priceIls: number;
}): Promise<void> {
  if (!input.provider.isTestMode || input.user.role !== "ADMIN") return;
  await logAdmin(
    { id: input.user.id, email: input.user.email },
    {
      action: "diamondStore.testPurchase",
      targetType: "empire",
      targetId: input.empireId ?? "",
      // i18n-exempt: an admin audit-log line, read only in the control centre.
      summary: `רכישת בדיקה: ${input.diamonds} יהלומים (${input.packageId}) תמורת ${formatIls(input.priceIls)}`,
      details: {
        packageId: input.packageId,
        diamonds: input.diamonds,
        priceIls: input.priceIls,
        provider: input.provider.name,
      },
    }
  );
}

/**
 * Buy a diamond package for real money. The price is recomputed server-side
 * (never trusted from the client), each attempt is recorded as a rich
 * {@link "@prisma/client".DiamondPurchase} audit row (buyer + empire snapshots,
 * diamonds granted, list vs. charged price, currency), and on a successful
 * charge the diamonds are credited in the same transaction that flips the row
 * to PAID. Payment goes through the swappable {@link getPaymentProvider} seam —
 * a mock provider today, whose charges are flagged `isTest`. Until a real
 * provider is live ({@link arePurchasesLive}), only admins can complete a
 * purchase, and every such test purchase is also written to the admin audit log.
 */
export async function purchaseDiamondPackage(
  _prev: StoreActionState,
  formData: FormData
): Promise<StoreActionState> {
  const t = await getT();
  try {
    const gate = await preflight(String(formData.get("packageId") ?? ""), "purchase");
    if (!gate.ok) return { status: gate.status, message: gate.message };
    const ctx = gate.ctx;

    // An approval-based provider cannot be charged from a single server call —
    // the buyer has to approve on the gateway's own page first. No such
    // provider is wired today, so reaching here means a stale page or a
    // hand-rolled request; refuse rather than pretend the charge went through.
    if (ctx.provider.kind !== "direct") {
      return {
        status: "error",
        message: t("יש להשלים את התשלום בעמוד הסליקה. רענן את הדף ונסה שוב."),
      };
    }

    // Record the attempt up front (rich snapshot) so even a declined/abandoned
    // charge is fully audited.
    const purchase = await openPurchaseRow(ctx);

    const charge: ChargeInput = {
      empireId: ctx.empire.id,
      packageId: ctx.pkg.id,
      amountIls: ctx.amountIls,
      // i18n-exempt: the line the payment provider prints on the charge, in
      // the operator's language — not something the buyer reads in the game.
      description: `רכישת ${ctx.total} יהלומים (${ctx.pkg.id})`,
    };
    const result = await ctx.provider.charge(charge);

    if (!result.ok) {
      await prisma.diamondPurchase.update({
        where: { id: purchase.id },
        data: { status: "FAILED", failureReason: result.reason },
      });
      return { status: "error", message: t("התשלום נכשל — לא חויבת. נסה שוב.") };
    }

    // Settle atomically, guarding the PENDING→PAID transition so the diamonds
    // are credited only if *this* call is the one that flipped the row. A
    // retried/duplicated settlement finds the row already PAID and credits
    // nothing — see `settleDiamondPurchase` for the same guard on the
    // approval-based path.
    await prisma.$transaction(async (tx) => {
      const settled = await tx.diamondPurchase.updateMany({
        where: { id: purchase.id, status: "PENDING" },
        data: {
          status: "PAID",
          providerRef: result.providerRef,
          paidAt: new Date(),
        },
      });
      if (settled.count === 0) return;
      await tx.empire.update({
        where: { id: ctx.empire.id },
        data: { diamonds: { increment: ctx.total } },
      });
    });

    await logTestPurchase({
      user: ctx.user,
      provider: ctx.provider,
      empireId: ctx.empire.id,
      packageId: ctx.pkg.id,
      diamonds: ctx.total,
      priceIls: ctx.amountIls,
    });

    revalidatePath("/game", "layout");
    return {
      status: "success",
      diamonds: ctx.total,
      message: ctx.provider.isTestMode
        ? t("רכישת בדיקה: נזקפו {diamonds} יהלומים.", {
            diamonds: ctx.total.toLocaleString("en-US"),
          })
        : t("נזקפו {diamonds} יהלומים לחשבונך!", {
            diamonds: ctx.total.toLocaleString("en-US"),
          }),
    };
  } catch {
    return { status: "error", message: t("אירעה שגיאה, נסה שוב") };
  }
}

/**
 * Open a hosted-checkout order and hand the browser the page to pay on.
 *
 * The create half of an approval-based gateway (Grow): the price is recomputed
 * here from the package id and the live tunables, a PENDING
 * {@link "@prisma/client".DiamondPurchase} row is opened for it, and the order
 * is created against that fixed amount. **Nothing is charged and no diamonds are
 * credited by this call** — settlement happens only after the gateway is asked,
 * server to server, what the buyer actually paid (see `@/server/orderSettle`).
 *
 * The buyer's name and phone are collected rather than derived: the gateway
 * requires both on its payment page, and the receipt an עוסק פטור issues per
 * sale has to name a real customer. They are passed straight through and not
 * stored — the audit row already snapshots the email and empire name.
 */
export async function startDiamondCheckout(
  _prev: StoreActionState,
  formData: FormData
): Promise<StoreActionState> {
  const t = await getT();
  try {
    const buyerName = String(formData.get("buyerName") ?? "").trim();
    const buyerPhone = String(formData.get("buyerPhone") ?? "").trim();
    // Validated before the gate so a typo costs nothing: the rate limiter below
    // spends a token per attempt, and a rejected name would otherwise burn the
    // buyer's ten attempts on a missing surname.
    if (!isValidBuyerName(buyerName)) {
      return { status: "error", message: t("יש להזין שם פרטי ושם משפחה") };
    }
    if (!isValidBuyerPhone(buyerPhone)) {
      return {
        status: "error",
        message: t("מספר טלפון נייד לא תקין (למשל 0501234567)"),
      };
    }

    const gate = await preflight(String(formData.get("packageId") ?? ""), "checkout");
    if (!gate.ok) return { status: gate.status, message: gate.message };
    const ctx = gate.ctx;

    // A direct provider (the mock) charges in one server call and has no page to
    // send anyone to. Reaching here with one means a stale client bundle.
    if (ctx.provider.kind !== "order") {
      return {
        status: "error",
        message: t("אמצעי התשלום השתנה. רענן את הדף ונסה שוב."),
      };
    }

    const purchase = await openPurchaseRow(ctx);

    const order = await ctx.provider.createOrder({
      purchaseId: purchase.id,
      empireId: ctx.empire.id,
      packageId: ctx.pkg.id,
      amountIls: ctx.amountIls,
      // i18n-exempt: the line the payment provider prints on the charge, in
      // the operator's language — not something the buyer reads in the game.
      description: `${ctx.total} יהלומים KRALDOR`,
      buyer: { name: buyerName, phone: buyerPhone, email: ctx.user.email },
    });

    if (!order.ok) {
      await prisma.diamondPurchase.update({
        where: { id: purchase.id },
        data: { status: "FAILED", failureReason: order.reason },
      });
      // The gateway's own wording is not shown: it is English, operational, and
      // occasionally quotes the request back. The reason is on the audit row for
      // /admin/purchases, which is where it belongs.
      return {
        status: "error",
        message: t("לא הצלחנו לפתוח את עמוד התשלום. נסה שוב."),
      };
    }

    // The order id and its lookup token are stored *before* the buyer is sent
    // anywhere, because the callback can arrive while the redirect is still in
    // flight — and a callback that finds no `providerRef` has no row to settle.
    await prisma.diamondPurchase.update({
      where: { id: purchase.id },
      data: { providerRef: order.orderId, providerToken: order.token ?? null },
    });

    return { status: "redirect", url: order.redirectUrl };
  } catch {
    return { status: "error", message: "אירעה שגיאה, נסה שוב" };
  }
}
