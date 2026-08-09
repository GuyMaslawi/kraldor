"use client";

import { useActionState, useState } from "react";
import type { MiniGameType } from "@prisma/client";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { LabeledInput, ResourceFieldLabel } from "@/components/admin/fields";
import { Icon } from "@/components/ui/Icon";
import {
  CUPS_MIN,
  CUPS_MAX,
  SAFE_DIGITS_MIN,
  SAFE_DIGITS_MAX,
  MAP_SIZE_MIN,
  MAP_SIZE_MAX,
  RIDDLE_ANSWER_MAX,
  RIDDLE_QUESTION_MAX,
  attemptsRange,
} from "@/lib/game/minigame";
import type { AdminActionState } from "@/server/actions/admin";

type Action = (
  prev: AdminActionState,
  formData: FormData
) => Promise<AdminActionState>;

const TYPES: { value: MiniGameType; label: string; icon: string; hint: string }[] = [
  { value: "FIND_BALL", label: "מצא את הכדור", icon: "🥤", hint: "מרימים כוס ומקווים לטוב" },
  { value: "CRACK_SAFE", label: "פריצת הכספת", icon: "🔐", hint: "מפצחים קוד סודי לפי רמזים" },
  { value: "TREASURE_MAP", label: "מפת האוצר", icon: "🗺️", hint: "חופרים על רשת, כל חפירה מגלה כמה קרוב" },
  { value: "RIDDLE", label: "חידה", icon: "❓", hint: "שאלה שאתה כותב, תשובה במילים" },
];

const PRIZE_FIELDS = [
  { name: "prizeGold", resource: "gold", label: "זהב" },
  { name: "prizeWood", resource: "wood", label: "עץ" },
  { name: "prizeIron", resource: "iron", label: "ברזל" },
  { name: "prizeStone", resource: "stone", label: "אבן" },
  { name: "prizeDiamonds", resource: "diamonds", label: "יהלומים" },
  { name: "prizeCitizens", resource: "citizens", label: "אזרחים" },
  { name: "prizeTurns", resource: "turns", label: "תורות" },
  { name: "prizeWheelSpins", resource: null, label: "סיבובים" },
] as const;

/**
 * A compact, type-aware creator for mini-games. The type toggle hides the
 * irrelevant config fields, the title defaults to the type name, and the
 * primary button both creates AND launches the game to everyone in one click.
 */
export function MiniGameCreator({ action }: { action: Action }) {
  const [state, formAction] = useActionState<AdminActionState, FormData>(action, {});
  const [type, setType] = useState<MiniGameType>("FIND_BALL");
  const [size, setSize] = useState(String(MAP_SIZE_MIN));
  const meta = TYPES.find((t) => t.value === type)!;

  // The shape drives the attempt budget, so these three fields are controlled
  // together — see attemptsRange for why an attempt count only means something
  // next to the number of cups / digits it is guessing at.
  const [cups, setCups] = useState(String(CUPS_MIN));
  const [digits, setDigits] = useState(String(SAFE_DIGITS_MIN));
  const range = attemptsRange(type, {
    cups: Number(cups),
    digits: Number(digits),
    size: Number(size),
  });

  // The budget follows the shape until the admin types their own, and is pulled
  // back into range whenever the shape moves under it. Reconciled on the *shape
  // key* rather than every render, so a half-typed number is left alone —
  // clamping on each keystroke fights the admin's cursor, and the server clamps
  // the submission again regardless.
  const [attempts, setAttempts] = useState(String(range.fallback));
  const [pinned, setPinned] = useState(false);
  const shapeKey = `${type}:${range.min}-${range.max}:${range.fallback}`;
  const [lastShape, setLastShape] = useState(shapeKey);
  if (lastShape !== shapeKey) {
    setLastShape(shapeKey);
    const typed = Math.round(Number(attempts));
    setAttempts(
      pinned && Number.isFinite(typed) && typed > 0
        ? String(Math.min(range.max, Math.max(range.min, typed)))
        : String(range.fallback)
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="type" value={type} />

      {/* Type picker */}
      <div className="grid grid-cols-2 gap-2">
        {TYPES.map((t) => {
          const active = t.value === type;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-right transition-colors ${
                active
                  ? "border-gold bg-gold/12 text-gold-bright"
                  : "border-border-subtle bg-panel-inset text-zinc-300 hover:border-gold-dim hover:text-zinc-100"
              }`}
            >
              <span aria-hidden className="text-xl">{t.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{t.label}</span>
                <span className="block text-[11px] text-zinc-500">{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Title (optional) + shared settings */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <LabeledInput
          label="כותרת (רשות)"
          name="title"
          placeholder={meta.label}
          hint="ריק = שם המשחק"
        />
        <LabeledInput
          label="ניסיונות לשחקן"
          name="maxAttempts"
          type="number"
          min={range.min}
          max={range.max}
          value={attempts}
          onValueChange={(v) => {
            setPinned(true);
            setAttempts(v);
          }}
          hint={
            type === "FIND_BALL"
              ? `${range.min}–${range.max} · יותר מזה = די להרים את כל הכוסות`
              : type === "TREASURE_MAP"
                ? `${range.min}–${range.max} · מומלץ ${range.fallback} לרשת ${size}×${size}`
                : type === "RIDDLE"
                  ? `${range.min}–${range.max} · לחידה אין רמזים, הניסיונות הם רק הזדמנויות`
                  : `${range.min}–${range.max} · מומלץ ${range.fallback} לקוד בן ${digits} ספרות`
          }
        />
        <LabeledInput label="מקס׳ זוכים (0=∞)" name="maxWinners" type="number" min={0} defaultValue={0} />
        <LabeledInput
          label="⏳ משך המשחק (דקות)"
          name="durationMinutes"
          type="number"
          min={0}
          defaultValue={0}
          hint="0 = עד שתפסיק ידנית"
        />
      </div>

      {/* Type-specific config */}
      {type === "TREASURE_MAP" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="גודל הרשת"
            name="size"
            type="number"
            min={MAP_SIZE_MIN}
            max={MAP_SIZE_MAX}
            value={size}
            onValueChange={setSize}
            hint={`${MAP_SIZE_MIN}–${MAP_SIZE_MAX} · רשת ${size}×${size} = ${Number(size) * Number(size)} תאים`}
          />
        </div>
      ) : type === "RIDDLE" ? (
        <div className="grid gap-3">
          <LabeledInput
            label="השאלה"
            name="question"
            hint={`מה שהשחקנים יראו · עד ${RIDDLE_QUESTION_MAX} תווים`}
          />
          <LabeledInput
            label="התשובה"
            name="answer"
            hint={`עד ${RIDDLE_ANSWER_MAX} תווים · ההשוואה מתעלמת מרישיות, רווחים כפולים, ניקוד וגרשיים — אבל לא ממילה אחרת`}
          />
        </div>
      ) : type === "FIND_BALL" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="מספר כוסות"
            name="cups"
            type="number"
            min={CUPS_MIN}
            max={CUPS_MAX}
            value={cups}
            onValueChange={setCups}
            hint={`${CUPS_MIN}–${CUPS_MAX} · יותר כוסות = סיכוי נמוך, ועוד ניסיון`}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="אורך הקוד"
            name="digits"
            type="number"
            min={SAFE_DIGITS_MIN}
            max={SAFE_DIGITS_MAX}
            value={digits}
            onValueChange={setDigits}
            hint={`${SAFE_DIGITS_MIN}–${SAFE_DIGITS_MAX} ספרות · 4 ומעלה דורש הרבה ניסיונות`}
          />
        </div>
      )}

      {/* Prize */}
      <div>
        <p className="mb-2 text-xs font-semibold text-gold-dim">פרס לזוכים</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRIZE_FIELDS.map((p) => (
            <LabeledInput
              key={p.name}
              label={
                p.resource ? (
                  <ResourceFieldLabel resource={p.resource} text={p.label} />
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="wheel" size={13} className="text-gold-bright" /> {p.label}
                  </span>
                )
              }
              name={p.name}
              type="number"
              min={0}
              placeholder="0"
            />
          ))}
        </div>
      </div>

      {/* Actions — launch is the primary path */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <SubmitButton name="activate" value="1" className="flex-1 sm:flex-none">
          🚀 צור והפעל מיד
        </SubmitButton>
        <SubmitButton name="activate" value="0" variant="secondary">
          שמור בלבד
        </SubmitButton>
      </div>

      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}
