"use client";

import { useState, useTransition } from "react";

import { useT } from "@/i18n/client";

import { getPurchaseReceipt, type ReceiptResult } from "@/server/actions/receipts";

/**
 * "הורד קבלה" — fetches the tax document for one purchase and links to it.
 *
 * On demand rather than on render, because the link is signed and expiring and
 * the document is issued asynchronously by the gateway's invoicing company. A
 * page that fetched it up front would either serve a dead link or wait on a
 * third party to render, and would do it once per row on the admin table.
 *
 * The empty answer gets its own wording. "לא נמצא מסמך" is the state an operator
 * is actually in whenever no invoicing module is connected to the gateway — a
 * receipt that was never issued, not one that failed to load — and reading it as
 * an error sends them looking in the wrong place.
 *
 * That is the state today: the active provider does not implement
 * `fetchDocuments` at all, so every click here answers "not issued". It is
 * deliberately still a button rather than hidden — the moment the gateway's
 * invoicing is wired, this starts returning links with no change on this side.
 */
export function ReceiptButton({
  purchaseId,
  compact = false,
}: {
  purchaseId: string;
  compact?: boolean;
}) {
  const t = useT();
  const [result, setResult] = useState<ReceiptResult | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      setResult(await getPurchaseReceipt(purchaseId));
    });
  };

  if (result?.status === "ok") {
    return (
      <span className="flex flex-col items-center gap-1">
        {result.documents.map((doc, i) => (
          <a
            key={`${doc.url}-${i}`}
            href={doc.url}
            target="_blank"
            // A signed document link is a credential in a query string: keep it
            // out of the Referer header on the way to the invoicing company.
            rel="noopener noreferrer"
            className={`text-emerald-300 underline hover:text-emerald-200 ${
              compact ? "text-[11px]" : "text-sm"
            }`}
          >
            📄 {doc.type || t("קבלה")}
            {doc.date && <span className="text-zinc-500"> · {doc.date}</span>}
          </a>
        ))}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={load}
        disabled={pending}
        className={`cursor-pointer text-gold underline hover:text-gold-bright disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? "text-[11px]" : "text-sm"
        }`}
      >
        {pending ? t("טוען...") : t("הצג קבלה")}
      </button>
      {result?.status === "none" && (
        <span className={`text-zinc-500 ${compact ? "text-[10px]" : "text-xs"}`}>
          {t("עדיין לא הונפק מסמך")}
        </span>
      )}
      {result?.status === "error" && (
        <span className={`text-red-400 ${compact ? "text-[10px]" : "text-xs"}`}>
          {result.message}
        </span>
      )}
    </span>
  );
}
