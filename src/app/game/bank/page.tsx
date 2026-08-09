import Link from "next/link";
import type { BankTransactionType } from "@prisma/client";
import { requireEmpire } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  EMPIRE_UPGRADE_META,
  allowedDepositsPerDailyPeriod,
  bankInterestRate,
} from "@/lib/game/constants";
import { monumentBonuses, monumentMultiplier } from "@/lib/game/monuments";
import { formatGameTime, nextDailyUpdate } from "@/lib/game/time";
import { formatDate, formatNumber } from "@/lib/game/format";
import { isVip } from "@/lib/game/vip";
import { BankActions } from "@/components/game/BankActions";
import { BankFxProvider } from "@/components/game/BankFx";
import { BankVault } from "@/components/game/BankVault";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("בנק | קראלדור") };
}

const TRANSACTION_META: Record<
  BankTransactionType,
  { label: string; icon: string; sign: string; color: string }
> = {
  DEPOSIT: { label: "הפקדה", icon: "⬇️", sign: "+", color: "text-emerald-400" },
  WITHDRAW: { label: "משיכה", icon: "⬆️", sign: "-", color: "text-red-400" },
  // 📈 rather than a money bag: these three mark the *direction* of a movement,
  // and a coin here would be a second drawing of the gold icon.
  INTEREST: { label: "ריבית", icon: "📈", sign: "+", color: "text-gold" },
};

/** A rate as a percent, to at most one decimal — "6%", "7.4%", never "7.44%". */
function formatRate(rate: number): string {
  const pct = rate * 100;
  return `${Number(pct.toFixed(1))}%`;
}

export default async function BankPage() {
  const empire = await requireEmpire();
  const { t, locale } = await getI18n();

  const availableGold = Math.floor(empire.gold);
  const bankGold = Math.floor(empire.bankAccount?.goldBalance ?? 0);
  const storedGold = Math.floor(
    empire.storages.find((s) => s.resourceType === "GOLD")?.storedAmount ?? 0
  );

  const interestLevel =
    empire.upgrades.find((u) => u.type === "BANK_DAILY_INTEREST")?.level ?? 1;
  const depositLevel =
    empire.upgrades.find((u) => u.type === "BANK_DEPOSIT_COUNT")?.level ?? 1;

  // בית הגנזים multiplies the rate the upgrade bought — the same product
  // `applyPendingUpdates` credits at the daily update. Read here rather than
  // recomputed: what this card promises has to be what the clock pays, or the
  // monument looks like it does nothing (which is exactly how it looked).
  const monumentInterestPct = monumentBonuses(empire.monuments).interest;
  const baseRate = bankInterestRate(interestLevel);
  const rate = baseRate * monumentMultiplier(monumentInterestPct);
  // The upgrade ladder is 1% a rung, so its own rate is always whole — but the
  // monument multiplies it into fractions (6% × 1.24 = 7.44%), and rounding
  // those to whole percents is what would hide a level or two of בית הגנזים.
  const ratePercent = formatRate(rate);
  const nextInterest = Math.floor(bankGold * rate);

  const allowedDeposits = allowedDepositsPerDailyPeriod(depositLevel);
  const usedDeposits = empire.bankAccount?.depositsUsedInCurrentPeriod ?? 0;
  const remainingDeposits = Math.max(0, allowedDeposits - usedDeposits);

  const nextDailyLabel = formatGameTime(nextDailyUpdate(new Date()));

  const transactions = await prisma.bankTransaction.findMany({
    where: { empireId: empire.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("בנק")}
        ornament={<Icon name="bank" size={22} className="text-crimson" />}
      />

      {/* The vault drawing and the transfer form share an effect bus, so a
          settled deposit rains coins into the vault beside it. */}
      <BankFxProvider>
        <div className="space-y-6">
          {/* -------- central bank card -------- */}
          <BankVault
            bankGold={bankGold}
            availableGold={availableGold}
            storedGold={storedGold}
            nextInterest={nextInterest}
            ratePercent={ratePercent}
            interestLevel={interestLevel}
          />

          {/* -------- deposit / withdraw + daily stats -------- */}
          <div className="grid items-start gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <BankActions
                availableGold={availableGold}
                bankGold={bankGold}
                storedGold={storedGold}
                remainingDeposits={remainingDeposits}
                isVip={isVip(empire)}
              />
            </div>

            <Card variant="gold" className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
                <Icon name="upgrades" size={18} className="text-crimson" />
                {t("תשואה יומית")}
              </h3>
              <p className="nums text-2xl font-black text-emerald-400">
                <span dir="ltr">+{formatNumber(nextInterest)}</span>
                <span className="mr-1 text-sm font-semibold text-emerald-400/70">
                  {t("זהב/יום")}
                </span>
              </p>

              {/* compounding curve — draws itself in, purely decorative */}
              <svg
                className="h-14 w-full"
                viewBox="0 0 120 40"
                preserveAspectRatio="none"
                aria-hidden
              >
                <defs>
                  <linearGradient id="yield-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#35d39a" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#35d39a" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  className="gold-spark-area"
                  d="M0 38 C 26 36, 46 32, 62 24 S 96 8, 120 3 L120 40 L0 40 Z"
                  fill="url(#yield-area)"
                />
                <path
                  className="gold-spark-line"
                  d="M0 38 C 26 36, 46 32, 62 24 S 96 8, 120 3"
                  fill="none"
                  stroke="#35d39a"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>

              <div className="rule-gold" />
              <p className="text-sm text-zinc-300">
                {t("ריבית נוכחית:")}{" "}
                <span className="nums font-bold text-gold" dir="ltr">
                  {ratePercent}
                </span>
              </p>
              {/* Only when it is actually earning something: the line exists to
                  prove the monument is in the number above, and a "+0%" row
                  would be noise on every screen that has not built it. */}
              {monumentInterestPct > 0 && (
                <p className="text-xs text-gold-dim">
                  {t("כולל {monument} — {base} +{pct}%", {
                    monument: t("בית הגנזים"),
                    base: formatRate(baseRate),
                    pct: monumentInterestPct,
                  })}
                </p>
              )}
              <p className="text-sm text-zinc-300">
                {t("הפקדות זמינות להיום:")}{" "}
                <span className="nums font-bold text-gold-bright" dir="ltr">
                  {remainingDeposits.toLocaleString("en-US")} /{" "}
                  {allowedDeposits.toLocaleString("en-US")}
                </span>
              </p>
              {/* one pip per deposit in the daily allowance */}
              <div className="flex flex-wrap gap-1.5" aria-hidden>
                {Array.from({ length: allowedDeposits }).map((_, index) => (
                  <span
                    key={index}
                    className={`deposit-pip ${
                      index < remainingDeposits ? "deposit-pip-on" : ""
                    }`}
                    style={{ "--i": index } as React.CSSProperties}
                  />
                ))}
              </div>
              <p className="text-sm text-zinc-300">
                {t("העדכון היומי הבא:")}{" "}
                <span className="nums font-bold text-gold-bright" dir="ltr">
                  {nextDailyLabel}
                </span>
              </p>
            </Card>
          </div>
        </div>
      </BankFxProvider>

      {/* -------- bank upgrades summary + transaction history -------- */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="upgrades" size={18} className="text-crimson" />
            {t("שדרוגי בנק")}
          </h3>
          <ul className="space-y-3 text-sm">
            <li className="panel-inset flex flex-col gap-0.5 rounded-lg p-3">
              <span className="font-semibold text-zinc-100">
                <Icon
                  name={EMPIRE_UPGRADE_META.BANK_DEPOSIT_COUNT.icon}
                  size={14}
                  className="inline align-[-2px] text-gold-bright"
                />{" "}
                {t(EMPIRE_UPGRADE_META.BANK_DEPOSIT_COUNT.label)} — {t("רמה")}{" "}
                <span className="nums" dir="ltr">
                  {depositLevel}
                </span>
              </span>
              <span className="text-xs text-gold-dim">
                {EMPIRE_UPGRADE_META.BANK_DEPOSIT_COUNT.effectLabel(t, depositLevel)}
              </span>
            </li>
            <li className="panel-inset flex flex-col gap-0.5 rounded-lg p-3">
              <span className="font-semibold text-zinc-100">
                <Icon
                  name={EMPIRE_UPGRADE_META.BANK_DAILY_INTEREST.icon}
                  size={14}
                  className="inline align-[-2px] text-gold-bright"
                />{" "}
                {t(EMPIRE_UPGRADE_META.BANK_DAILY_INTEREST.label)} — {t("רמה")}{" "}
                <span className="nums" dir="ltr">
                  {interestLevel}
                </span>
              </span>
              <span className="text-xs text-gold-dim">
                {EMPIRE_UPGRADE_META.BANK_DAILY_INTEREST.effectLabel(t, interestLevel)}
              </span>
            </li>
          </ul>
          <Link
            href="/game/upgrades"
            className="btn btn-ghost mt-4 px-4 py-2 text-sm"
          >
            {t("עבור לשדרוגים")}
          </Link>
        </Card>

        <Card>
          <h3 className="mb-4 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
            <Icon name="reports" size={18} className="text-crimson" />
            {t("תנועות אחרונות")}
          </h3>
          {transactions.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("אין עדיין תנועות בבנק.")}</p>
          ) : (
            <ul className="divide-y divide-border-subtle text-sm">
              {transactions.map((transaction, index) => {
                const meta = TRANSACTION_META[transaction.type];
                return (
                  <li
                    key={transaction.id}
                    className="bank-row flex items-center justify-between gap-3 py-2"
                    style={{ "--i": index } as React.CSSProperties}
                  >
                    <span className="flex items-center gap-2 text-zinc-300">
                      <span aria-hidden>{meta.icon}</span>
                      {t(meta.label)}
                    </span>
                    <span className="flex flex-col items-end">
                      <span className={`nums font-bold ${meta.color}`} dir="ltr">
                        {meta.sign}
                        {formatNumber(transaction.amount)}
                      </span>
                      <span className="nums text-xs text-zinc-500">
                        <span dir="ltr">{formatDate(transaction.createdAt, locale)}</span> · {t("יתרה:")}{" "}
                        <span dir="ltr">{formatNumber(transaction.balanceAfter)}</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
