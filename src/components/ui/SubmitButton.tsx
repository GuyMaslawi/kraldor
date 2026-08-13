"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useT } from "@/i18n/client";

const VARIANTS = {
  primary:
    "bg-gold text-zinc-950 hover:bg-gold-bright disabled:bg-gold-dim font-bold",
  secondary:
    "border border-gold-dim text-gold hover:bg-gold/10 disabled:opacity-50",
  danger:
    "bg-red-800 text-red-50 hover:bg-red-700 disabled:opacity-50 font-bold",
} as const;

export function SubmitButton({
  children,
  variant = "primary",
  className = "",
  // i18n-keys: a default the component runs through t() itself, so callers pass Hebrew
  pendingText = "רק רגע...",
  disabled = false,
  formAction,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: keyof typeof VARIANTS;
  pendingText?: string;
}) {
  const t = useT();
  const { pending, action } = useFormStatus();
  // When several buttons in one form each carry their own formAction, only
  // the button whose action is actually submitting shows its pending text.
  const showPending = pending && (formAction == null || action === formAction);
  return (
    <button
      {...rest}
      type="submit"
      formAction={formAction}
      disabled={pending || disabled}
      className={`rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {showPending ? t(pendingText) : children}
    </button>
  );
}
