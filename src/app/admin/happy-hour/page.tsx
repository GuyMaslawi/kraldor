import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ActionForm } from "@/components/admin/ActionForm";
import { EditorSection } from "@/components/admin/fields";
import { HappyHourLauncher } from "@/components/admin/HappyHourLauncher";
import { GAME_TIMEZONE } from "@/lib/game/constants";
import { activeEffects, multiplierLabel } from "@/lib/game/happyHour";
import { durationLabel } from "@/components/admin/happyHourDuration";
import {
  createHappyHour,
  startHappyHour,
  stopHappyHour,
  deleteHappyHour,
} from "@/server/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminHappyHourPage() {
  await requireAdmin();
  const now = new Date();
  const events = await prisma.happyHour.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    take: 40,
  });

  return (
    <div className="space-y-6">
      <SectionHeading title="Happy Hour" ornament="🔥" />

      <p className="panel-inset rounded-xl p-4 text-center text-sm text-zinc-400">
        בונוס אחד — <span className="font-bold text-gold-bright">לכל השחקנים בו-זמנית</span>. בזמן
        ה-Happy Hour כל ניסיון בקרב, כל ביזה מאויב או משליט עיר וכל תפוקת מכרה מוכפלים במספר שתבחר.
        לחיצה על הכפתור מדליקה מסך פתיחה ענק אצל כל שחקן שנמצא במשחק, ובאנר בוער מעל כל מסך עד
        שהזמן נגמר.
      </p>

      <EditorSection title="שחרר Happy Hour" icon="🚀">
        <HappyHourLauncher action={createHappyHour} />
      </EditorSection>

      <div className="space-y-3">
        {events.map((event) => {
          // The clock is the rule, not the flag: a timed window is over the
          // moment its deadline passes, and `isActive` is only flipped lazily on
          // the next read (see server/actions/happyHour.ts).
          const expired = event.endsAt != null && event.endsAt <= now;
          const live = event.isActive && !expired;
          const minutesLeft =
            live && event.endsAt
              ? Math.ceil((event.endsAt.getTime() - now.getTime()) / 60_000)
              : null;
          const effects = activeEffects(event);

          return (
            <div
              key={event.id}
              className={`panel rounded-xl p-4 ${live ? "ring-1 ring-amber-400/60" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-bold text-gold-bright">
                    <span aria-hidden>🔥</span>
                    {event.title}
                    <span className="nums rounded bg-gold/20 px-2 py-0.5 text-xs font-black" dir="ltr">
                      {multiplierLabel(event.bonusPct)}
                    </span>
                    {live && (
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        באוויר עכשיו
                      </span>
                    )}
                    {live && minutesLeft !== null && (
                      <span className="rounded bg-gold/20 px-2 py-0.5 text-[10px] font-bold text-gold-bright">
                        ⏳ נותרו {minutesLeft} דק׳
                      </span>
                    )}
                    {event.isActive && expired && (
                      <span className="rounded bg-zinc-700/40 px-2 py-0.5 text-[10px] font-bold text-zinc-300">
                        הזמן תם
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {effects.map((e) => `${e.icon} ${e.short}`).join(" · ") || "ללא הטבות"} ·{" "}
                    {durationLabel(event.durationMinutes)}
                    {event.startsAt && (
                      <>
                        {" "}
                        · שוחרר{" "}
                        <span dir="ltr">
                          {event.startsAt.toLocaleString("he-IL", {
                            timeZone: GAME_TIMEZONE,
                          })}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  {live ? (
                    <ActionForm
                      action={stopHappyHour}
                      submitLabel="⏹ עצור עכשיו"
                      submitVariant="danger"
                      submitClassName="text-xs"
                      confirm="לעצור את ה-Happy Hour לכל השחקנים?"
                    >
                      <input type="hidden" name="id" value={event.id} />
                    </ActionForm>
                  ) : (
                    <ActionForm
                      action={startHappyHour}
                      submitLabel="🔥 שחרר שוב"
                      submitClassName="text-xs"
                    >
                      <input type="hidden" name="id" value={event.id} />
                      <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <span>למשך</span>
                        <input
                          name="durationMinutes"
                          type="number"
                          min={0}
                          defaultValue={event.durationMinutes}
                          dir="ltr"
                          className="w-16 rounded border border-border-subtle bg-panel-inset px-2 py-1 text-center text-xs text-zinc-100 outline-none focus:border-gold/60"
                        />
                        <span>דק׳ (0=∞)</span>
                      </label>
                    </ActionForm>
                  )}
                  {!event.startsAt && (
                    <ActionForm
                      action={deleteHappyHour}
                      submitLabel="🗑 מחק"
                      submitVariant="secondary"
                      submitClassName="text-xs"
                      confirm="למחוק את ה-Happy Hour?"
                    >
                      <input type="hidden" name="id" value={event.id} />
                    </ActionForm>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {events.length === 0 && (
          <p className="panel-inset rounded-xl p-6 text-center text-zinc-500">
            עוד לא שוחרר אף Happy Hour
          </p>
        )}
      </div>
    </div>
  );
}
