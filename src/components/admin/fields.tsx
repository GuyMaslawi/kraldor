import type { ReactNode } from "react";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";

const INPUT_CLASS =
  "w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-gold/60";

/** Labeled text/number input for admin forms. */
export function LabeledInput({
  label,
  name,
  defaultValue,
  value,
  onValueChange,
  type = "text",
  step,
  min,
  max,
  placeholder,
  required,
  dir,
  hint,
}: {
  label: ReactNode;
  name: string;
  defaultValue?: string | number;
  /**
   * Controlled value. Only for the handful of forms whose *other* fields react
   * to this one (the ban panel's duration); everything else stays uncontrolled
   * and reads the DOM at submit.
   */
  value?: string;
  onValueChange?: (value: string) => void;
  type?: "text" | "number" | "email" | "password" | "datetime-local";
  step?: number | string;
  min?: number | string;
  /**
   * Ceiling for a number field. Advisory only — the browser refuses to submit a
   * larger value, but the server action clamps it again, since a form is not a
   * validator.
   */
  max?: number | string;
  placeholder?: string;
  required?: boolean;
  dir?: "ltr" | "rtl";
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-gold-dim">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        min={min}
        max={max}
        {...(value != null
          ? { value, onChange: (e) => onValueChange?.(e.target.value) }
          : { defaultValue })}
        placeholder={placeholder}
        required={required}
        dir={dir ?? (type === "number" ? "ltr" : undefined)}
        className={INPUT_CLASS}
      />
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

/** Labeled select for admin forms. */
export function LabeledSelect({
  label,
  name,
  defaultValue,
  value,
  onValueChange,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  /** Controlled value — see `LabeledInput`. */
  value?: string;
  onValueChange?: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-gold-dim">{label}</span>
      <select
        name={name}
        {...(value != null
          ? { value, onChange: (e) => onValueChange?.(e.target.value) }
          : { defaultValue })}
        className={INPUT_CLASS}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A yes/no field. A select rather than a checkbox so it round-trips through
 * FormData like every other field here — an unchecked checkbox sends nothing,
 * which reads identically to "field absent" on the server.
 */
export function LabeledBool({
  label,
  name,
  defaultValue,
  trueLabel = "כן",
  falseLabel = "לא",
}: {
  label: string;
  name: string;
  defaultValue?: boolean;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return (
    <LabeledSelect
      label={label}
      name={name}
      defaultValue={defaultValue ? "1" : "0"}
      options={[
        { value: "1", label: trueLabel },
        { value: "0", label: falseLabel },
      ]}
    />
  );
}

/** Read-only "label: value" line, for the state a panel is about to edit. */
export function StatLine({
  label,
  value,
  tone = "text-zinc-200",
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-bold ${tone}`}>{value}</span>
    </p>
  );
}

/**
 * A framed sub-section inside an editor panel.
 *
 * `id` is the anchor the player page's quick-glance jump links point at — see
 * JUMP_LINKS in PlayerVitals. `scroll-mt-4` keeps the heading clear of the top
 * edge when one of them lands.
 */
export function EditorSection({
  id,
  title,
  icon,
  children,
  className = "",
}: {
  id?: string;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`panel scroll-mt-4 rounded-xl p-4 sm:p-5 ${className}`}>
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
        {icon && <span aria-hidden>{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

export const HIDDEN = (name: string, value: string) => (
  <input type="hidden" name={name} value={value} />
);

/**
 * Field label for a resource amount — the same glyph and tint the game screens
 * use, so an admin editing gold sees the icon a player sees.
 */
export function ResourceFieldLabel({ resource, text }: { resource: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon
        name={RESOURCE_ICON[resource]}
        size={13}
        className={RESOURCE_ICON_COLOR[resource]}
      />
      {text}
    </span>
  );
}
