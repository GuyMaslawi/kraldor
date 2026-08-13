import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { DEFAULT_TUNABLES, getTunables } from "@/lib/game/config";
import { splitBreakHours } from "@/lib/game/seasonCycle";
import { BREAK_UNITS, formatBreakHours } from "@/components/admin/seasonBreak";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ActionForm } from "@/components/admin/ActionForm";
import { LabeledBool, LabeledInput, EditorSection } from "@/components/admin/fields";
import { LocalTime, SeasonSchedule, SeasonEndPicker } from "@/components/admin/DateTimeField";
import {
  createSeason,
  updateSeason,
  activateSeason,
  shortenSeason,
  deleteSeason,
  resetSeason,
  saveSeasonCycle,
} from "@/server/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminSeasonsPage() {
  await requireAdmin();

  const [seasons, counts, archived, tunables] = await Promise.all([
    prisma.gameSeason.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.empire.groupBy({ by: ["seasonId"], _count: { _all: true } }),
    // Which seasons already have a record in the hall. Read off the archive
    // table rather than a relation — SeasonChampion holds none, so that a
    // deleted season keeps its champions.
    prisma.seasonChampion.groupBy({ by: ["seasonId"], _count: { _all: true } }),
    getTunables(),
  ]);
  const countBySeason = new Map(counts.map((c) => [c.seasonId, c._count._all]));
  const archivedBySeason = new Map(archived.map((a) => [a.seasonId, a._count._all]));
  const totalEmpires = counts.reduce((sum, c) => sum + c._count._all, 0);
  const cycle = tunables.season;
  // The stored hours, back in the unit they were most likely typed in, so the
  // field reopens saying "3 ימים" rather than "72 שעות".
  const breakField = splitBreakHours(cycle.breakHours);

  // The season the cycle will open next: the earliest unclosed one booked to
  // start from here on. The same row `getSeasonGate` will pick up when its hour
  // comes, so what this panel promises is what actually happens.
  const now = new Date();
  const upcoming = seasons
    .filter((s) => !s.isActive && !s.closedAt && s.startsAt >= now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  return (
    <div className="space-y-6">
      <SectionHeading title="עונות" ornament="📅" />

      {/* -------- the cycle that runs without an admin -------- */}
      <EditorSection title="מחזור העונות — אוטומטי" icon="🔄">
        <p className="text-[12px] leading-relaxed text-zinc-400">
          כשהשעון של העונה הפעילה מגיע לתאריך הסיום, המשחק ננעל <strong className="text-red-300">לכל
          השחקנים</strong> מיד: כל דף באתר מוביל לדף סיום העונה, עם המובילים וספירה לאחור. אחרי
          ההפסקה שמוגדרת כאן העונה הבאה נפתחת מעצמה — המספר עולה באחד (למשל
          <span dir="ltr"> עונה 3 ← עונה 4</span>), והעולם מתאפס: כל אימפריה נבנית מחדש,
          הגילדות מתפרקות, ו<strong className="text-emerald-300">רק יתרת היהלומים</strong> עוברת
          עם השחקן (גם VIP וארנק הקהילה מתאפסים). אין צורך בשום פעולה ידנית.
        </p>
        <ActionForm action={saveSeasonCycle} submitLabel="שמור הגדרות מחזור">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* The break: any number, in whichever unit the admin is thinking
                in. Stored as hours either way (see breakToHours) — the pair is
                a typing convenience, not a second source of truth. */}
            <div className="space-y-1">
              <span className="text-xs font-semibold text-gold-dim">ההפסקה בין עונות</span>
              <div className="flex gap-2">
                <input
                  name="season.breakValue"
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={breakField.value}
                  dir="ltr"
                  className="w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-gold/60"
                />
                <select
                  name="season.breakUnit"
                  defaultValue={breakField.unit}
                  className="rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-gold/60"
                >
                  {BREAK_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className="block text-[11px] text-zinc-500">
                כמה זמן המשחק סגור. 0 = העונה הבאה נפתחת מיד.
              </span>
            </div>
            <LabeledInput
              label="אורך העונה הבאה (ימים)"
              name="season.lengthDays"
              type="number"
              min={1}
              max={3650}
              step="any"
              defaultValue={cycle.lengthDays}
              hint={`כל מספר ימים. ברירת מחדל: ${DEFAULT_TUNABLES.season.lengthDays}`}
            />
            <LabeledBool
              label="לפתוח את העונה הבאה אוטומטית?"
              name="season.autoNext"
              defaultValue={cycle.autoNext >= 1}
              trueLabel="כן — המחזור ממשיך"
              falseLabel="לא — נשאר סגור"
            />
            <LabeledBool
              label="לאפס את העולם בפתיחת עונה?"
              name="season.autoRestart"
              defaultValue={cycle.autoRestart >= 1}
              trueLabel="כן — כולם מתחילים מאפס"
              falseLabel="לא — ממשיכים כרגיל"
            />
          </div>
        </ActionForm>
        {/* What those numbers actually booked. A schedule an admin cannot see is
            a schedule they cannot trust. */}
        <div className="space-y-2 rounded-lg border border-border-subtle bg-panel-inset p-3 text-[12px] text-zinc-400">
          {/* The settings above, read back as a sentence. A number field can be
              misread; "הפסקה של יומיים, ואז עונה של 30 ימים" cannot. */}
          <p>
            כרגע:{" "}
            <strong className="text-gold-bright">{formatBreakHours(cycle.breakHours)}</strong>{" "}
            הפסקה, ואז עונה של{" "}
            <strong className="text-gold-bright">{cycle.lengthDays}</strong> ימים.
            {/* The seeding is a season-opening effect, so it belongs in the
                sentence that says what opening a season does — even though the
                number itself is edited on the balance screen. */}
            {cycle.autoRestart >= 1 && (
              <>
                {" "}
                בפתיחה יישתלו{" "}
                <strong className="text-gold-bright">{cycle.openBots}</strong> בוטים בעיר
                הראשונה, כדי שהסולם לא ייפתח עם שורה אחת.
              </>
            )}
          </p>
          <p>
            {upcoming ? (
              <>
                העונה הבאה בתור:{" "}
                <strong className="text-gold-bright">{upcoming.name}</strong> — נפתחת ב־
                <LocalTime iso={upcoming.startsAt.toISOString()} /> ומסתיימת ב־
                <LocalTime iso={upcoming.endsAt.toISOString()} />.
              </>
            ) : cycle.autoNext >= 1 ? (
              "עדיין לא נקבעה עונה הבאה — היא תיווצר אוטומטית ברגע שהעונה הפעילה תסתיים."
            ) : (
              "פתיחה אוטומטית כבויה — כשהעונה הפעילה תסתיים המשחק יישאר סגור עד שתפעיל עונה ידנית."
            )}
          </p>
        </div>
      </EditorSection>

      <EditorSection title="עונה חדשה" icon="➕">
        <ActionForm action={createSeason} submitLabel="צור עונה">
          <div className="grid gap-3 sm:max-w-xs">
            <LabeledInput label="שם" name="name" required placeholder="עונה 1" />
          </div>
          <SeasonSchedule />
        </ActionForm>
      </EditorSection>

      <div className="space-y-4">
        {seasons.map((s) => (
          <div key={s.id} className="panel rounded-xl p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-gold-bright">
                {s.name}
                {s.isActive && (
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    פעילה
                  </span>
                )}
                {/* A closed season is not a label — it is the state that shuts
                    the whole game until the next season starts. */}
                {s.closedAt && (
                  <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                    נסגרה <LocalTime iso={s.closedAt.toISOString()} />
                  </span>
                )}
                {(archivedBySeason.get(s.id) ?? 0) > 0 && (
                  <span className="rounded bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-gold">
                    בהיכל התהילה
                  </span>
                )}
              </h3>
              <span className="text-[11px] text-zinc-500">
                {countBySeason.get(s.id) ?? 0} אימפריות
              </span>
            </div>

            <ActionForm action={updateSeason} submitLabel="שמור" submitVariant="secondary">
              <input type="hidden" name="id" value={s.id} />
              <div className="grid gap-3 sm:max-w-xs">
                <LabeledInput label="שם" name="name" defaultValue={s.name} required />
              </div>
              <SeasonSchedule
                startISO={s.startsAt.toISOString()}
                endISO={s.endsAt.toISOString()}
              />
            </ActionForm>

            {/* Ending a running season early. Offered on the active season
                only — a season nobody is playing has nothing to cut short, and
                its dates are editable in the form above. */}
            {s.isActive && !s.closedAt && (
              <div className="mt-3 rounded-lg border border-border-subtle bg-panel-inset p-3">
                <h4 className="mb-2 text-xs font-bold text-gold-dim">⏱️ קיצור העונה</h4>
                <ActionForm
                  action={shortenSeason}
                  submitLabel="קצר את העונה"
                  submitVariant="danger"
                  submitClassName="text-xs"
                  confirm="לקצר את העונה? אם המועד שנבחר כבר עבר, העונה תסתיים מיד: הדירוג יישמר בהיכל התהילה והמשחק יינעל עד תחילת העונה הבאה."
                  className="sm:max-w-xs"
                >
                  <input type="hidden" name="id" value={s.id} />
                  <SeasonEndPicker
                    startISO={s.startsAt.toISOString()}
                    endISO={s.endsAt.toISOString()}
                  />
                </ActionForm>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {!s.isActive && (
                <ActionForm
                  action={activateSeason}
                  submitLabel="הפעל עונה"
                  submitClassName="text-xs"
                  confirm="להפעיל את העונה הזו? העונה הפעילה כעת תיסגר כאילו הסתיימה — הדירוג שלה יישמר בהיכל התהילה, דרך התהילה תתאפס לכל השחקנים, וכל האימפריות יעברו לעונה החדשה עם כל הרכוש שלהן."
                >
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              )}
              {/* The standings are derived from live empires, so a season
                  about to be deleted is the last moment they can be read. */}
              <ActionForm
                action={deleteSeason}
                submitLabel="מחק עונה"
                submitVariant="danger"
                submitClassName="text-xs"
                confirm="למחוק את העונה? אימפריות משויכות יאבדו את שיוך העונה."
                className="min-w-[14rem]"
              >
                <input type="hidden" name="id" value={s.id} />
                <LabeledBool
                  label="לשמור את הדירוג בהיכל התהילה?"
                  name="archive"
                  defaultValue={false}
                  trueLabel="כן — שמור טופ 3"
                  falseLabel="לא"
                />
              </ActionForm>
            </div>
          </div>
        ))}
        {seasons.length === 0 && (
          <p className="panel-inset rounded-xl p-6 text-center text-zinc-500">אין עונות עדיין</p>
        )}
      </div>

      {/* Danger zone — full season reset. */}
      <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-4 sm:p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-red-300">
          💥 איפוס עונה
        </h3>
        <p className="mb-3 text-[12px] leading-relaxed text-zinc-400">
          מאפס את <strong className="text-red-300">כל {totalEmpires} השחקנים</strong> ומתחיל עונה
          מחדש: כל אימפריה נבנית מאפס (משאבים, מבנים, צבא, שדרוגים, נשק, גיבור ובנק), וכל הגילדות
          נמחקות. חשבונות המשתמשים נשמרים, וכל שחקן <strong className="text-emerald-300">שומר את
          יתרת היהלומים</strong> שלו. פעולה זו בלתי הפיכה.
        </p>
        <ActionForm
          action={resetSeason}
          submitLabel="אפס את העונה"
          submitVariant="danger"
          confirm={`לאפס את כל ${totalEmpires} השחקנים ולהתחיל עונה מחדש? פעולה בלתי הפיכה!`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput
              label='להקלדת אישור, כתוב "אפס"'
              name="confirm"
              required
              placeholder="אפס"
            />
            {/* Read before the wipe, or not at all — the podium is derived from
                the very empires this button deletes. */}
            <LabeledBool
              label="לשמור את הדירוג הסופי בהיכל התהילה?"
              name="archive"
              defaultValue={false}
              trueLabel="כן — שמור טופ 3"
              falseLabel="לא"
            />
          </div>
          <p className="text-[11px] text-zinc-500">
            שמירה רושמת את שלושת המובילים של העונה הפעילה בהיכל התהילה. היא אינה
            סוגרת את העונה — המשחק ממשיך לפעול מיד אחרי האיפוס.
          </p>
        </ActionForm>
      </div>
    </div>
  );
}
