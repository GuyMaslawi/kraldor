import { ActionForm } from "@/components/admin/ActionForm";
import {
  EditorSection,
  LabeledInput,
  LabeledSelect,
  StatLine,
} from "@/components/admin/fields";
import { formatNumber } from "@/lib/game/format";
import {
  recomputeEmpirePower,
  resetEmpireProgress,
  setEmpireSeason,
  setEmpireVip,
  updateEmpireClocks,
  updateEmpireProtection,
} from "@/server/actions/admin";
import { VIP_LABEL } from "@/lib/game/vip";
import { formatGameDateTime } from "@/lib/game/time";

export interface PlayerEmpireStateProps {
  empire: {
    id: string;
    seasonId: string | null;
    protectedUntil: Date | null;
    /** When VIP was bought (or granted) — null for a player without it. */
    vipSince: Date | null;
    lastRegularUpdateAt: Date;
    lastDailyUpdateAt: Date;
    reportsSeenAt: Date;
    militaryPower: number;
    generalPower: number;
    spyPower: number;
  };
  userId: string;
  seasons: { id: string; name: string; isActive: boolean }[];
}

function fmt(d: Date | null): string {
  return d ? formatGameDateTime(d) : "—";
}

/** Whole hours since `d`, for the "how stale is this clock" readout. */
function hoursSince(d: Date): string {
  return `לפני ${((Date.now() - d.getTime()) / 3_600_000).toFixed(1)} שעות`;
}

/**
 * The empire's machinery rather than its contents: the shield, the two lazy
 * update clocks, the season it is ranked in, the denormalised power columns,
 * and the button that starts the whole thing over.
 */
export function PlayerEmpireState({
  empire,
  userId,
  seasons,
}: PlayerEmpireStateProps) {
  const shielded = empire.protectedUntil != null && empire.protectedUntil > new Date();

  return (
    <EditorSection title="מצב האימפריה ושעונים" icon="⏱️">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---- protection ---- */}
        <ActionForm
          action={updateEmpireProtection}
          submitLabel="קבע הגנה"
          submitVariant="secondary"
          submitClassName="w-full text-xs"
          className="panel-inset rounded-lg p-3"
        >
          <input type="hidden" name="empireId" value={empire.id} />
          <input type="hidden" name="userId" value={userId} />
          <StatLine
            label="הגנת שחקן חדש"
            value={shielded ? fmt(empire.protectedUntil) : "לא מוגן"}
            tone={shielded ? "text-emerald-300" : "text-zinc-400"}
          />
          <LabeledInput
            label="שעות הגנה מעכשיו"
            name="hours"
            type="number"
            min={0}
            defaultValue={0}
            hint="0 מסיר את ההגנה לחלוטין"
          />
        </ActionForm>

        {/* ---- clocks ---- */}
        <ActionForm
          action={updateEmpireClocks}
          submitLabel="הזז שעונים"
          submitVariant="secondary"
          submitClassName="w-full text-xs"
          className="panel-inset rounded-lg p-3"
        >
          <input type="hidden" name="empireId" value={empire.id} />
          <input type="hidden" name="userId" value={userId} />
          <StatLine label="עדכון רגיל אחרון" value={hoursSince(empire.lastRegularUpdateAt)} />
          <StatLine label="עדכון יומי אחרון" value={hoursSince(empire.lastDailyUpdateAt)} />
          <StatLine label="דוחות נצפו" value={hoursSince(empire.reportsSeenAt)} />
          {/*
            Winding a clock back hands the player the ticks in between: the next
            page load settles everything from the stored instant to now.
          */}
          <div className="grid grid-cols-3 gap-2">
            <LabeledInput label="רגיל (שעות אחורה)" name="regularHoursAgo" type="number" placeholder="—" />
            <LabeledInput label="יומי (שעות אחורה)" name="dailyHoursAgo" type="number" placeholder="—" />
            <LabeledInput label="דוחות (שעות אחורה)" name="reportsHoursAgo" type="number" placeholder="—" />
          </div>
          <p className="text-[11px] text-zinc-500">
            השאר ריק כדי לא לגעת. הערך מגדיר את השעון למספר שעות אחורה מעכשיו —
            ככל שגדול יותר, כך יצטברו לשחקן יותר עדכונים לגבייה בכניסה הבאה.
          </p>
        </ActionForm>

        {/* ---- season + power ---- */}
        <div className="space-y-3">
          <ActionForm
            action={setEmpireSeason}
            submitLabel="שייך לעונה"
            submitVariant="secondary"
            submitClassName="w-full text-xs"
            className="panel-inset rounded-lg p-3"
          >
            <input type="hidden" name="empireId" value={empire.id} />
            <input type="hidden" name="userId" value={userId} />
            <LabeledSelect
              label="עונה"
              name="seasonId"
              defaultValue={empire.seasonId ?? ""}
              options={[
                { value: "", label: "ללא עונה" },
                ...seasons.map((s) => ({
                  value: s.id,
                  label: `${s.name}${s.isActive ? " (פעילה)" : ""}`,
                })),
              ]}
            />
          </ActionForm>

          {/* ---- VIP ----
              One button, whichever way it is currently set. A grant is not a
              sale and a revocation is not a refund: neither touches diamonds. */}
          <ActionForm
            action={setEmpireVip}
            submitLabel={empire.vipSince ? `בטל ${VIP_LABEL}` : `הענק ${VIP_LABEL}`}
            submitVariant="secondary"
            submitClassName="w-full text-xs"
            className="panel-inset rounded-lg p-3"
          >
            <input type="hidden" name="empireId" value={empire.id} />
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="grant" value={empire.vipSince ? "0" : "1"} />
            <StatLine
              label={`${VIP_LABEL} (VIP)`}
              value={empire.vipSince ? fmt(empire.vipSince) : "אין"}
              tone={empire.vipSince ? "text-gold-bright" : "text-zinc-400"}
            />
            <p className="text-[11px] text-zinc-500">
              פותח את הפעולות המהירות בלבד. אינו משנה יהלומים לאף כיוון.
            </p>
          </ActionForm>

          <ActionForm
            action={recomputeEmpirePower}
            submitLabel="חשב עוצמה מחדש"
            submitVariant="secondary"
            submitClassName="w-full text-xs"
            className="panel-inset rounded-lg p-3"
          >
            <input type="hidden" name="empireId" value={empire.id} />
            <input type="hidden" name="userId" value={userId} />
            <StatLine label="עוצמה צבאית" value={formatNumber(empire.militaryPower)} />
            <StatLine label="עוצמה כללית" value={formatNumber(empire.generalPower)} />
            <StatLine label="עוצמת ריגול" value={formatNumber(empire.spyPower)} />
          </ActionForm>
        </div>
      </div>

      {/* ---- full reset ---- */}
      <div className="mt-4 rounded-lg border border-red-500/40 bg-red-950/20 p-3">
        <ActionForm
          action={resetEmpireProgress}
          submitLabel="אפס את האימפריה להתחלה"
          submitVariant="danger"
          confirm="לאפס את האימפריה? כל ההתקדמות, הצבא, הגיבור, הדוחות וההודעות יימחקו."
        >
          <input type="hidden" name="empireId" value={empire.id} />
          <input type="hidden" name="userId" value={userId} />
          <p className="text-xs text-red-200">
            מוחק את האימפריה ובונה חדשה באותו שם ובאותה עונה: משאבי פתיחה, צבא
            התחלתי, גיבור חדש. הדוחות, ההודעות, ההישגים, הפריטים והרכישות
            נמחקים. החשבון עצמו נשמר.
          </p>
          <LabeledInput label="הקלד RESET לאישור" name="confirm" dir="ltr" placeholder="RESET" />
        </ActionForm>
      </div>
    </EditorSection>
  );
}
