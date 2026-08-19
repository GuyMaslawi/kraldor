import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ActionForm } from "@/components/admin/ActionForm";
import { EditorSection } from "@/components/admin/fields";
import { MiniGameCreator } from "@/components/admin/MiniGameCreator";
import {
  prizeText,
  costText,
  eventCost,
  eventExtraCost,
  MINIGAME_TYPE_META,
  MAX_LIVE_MINIGAMES,
} from "@/lib/game/minigame";
import { makeT } from "@/i18n/translate";
import { DEFAULT_LOCALE } from "@/i18n/locale";
import {
  createMiniGame,
  activateMiniGame,
  deactivateMiniGame,
  deleteMiniGame,
} from "@/server/actions/admin";

export const dynamic = "force-dynamic";

/**
 * The control centre stays Hebrew on purpose (see src/i18n/), so the one helper
 * here that now takes a translator is handed the source language explicitly
 * rather than the reader's — an admin who switched the *game* to English still
 * reads this panel in the language the rest of it is written in.
 */
const he = makeT(DEFAULT_LOCALE);

export default async function AdminMiniGamePage() {
  await requireAdmin();
  const now = new Date();
  const games = await prisma.miniGameEvent.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { entries: true } } },
  });

  // A game whose deadline has passed is no longer running, whatever its flag
  // still says — the flag is flipped lazily, on the first player read after the
  // deadline. Same arithmetic the row below does, so the two can never disagree.
  const liveCount = games.filter(
    (g) => g.isActive && (g.endsAt === null || g.endsAt.getTime() > now.getTime())
  ).length;
  const full = liveCount >= MAX_LIVE_MINIGAMES;

  return (
    <div className="space-y-6">
      <SectionHeading title="מיני-משחק" ornament="🎯" />

      <p className="panel-inset rounded-xl p-4 text-center text-sm text-zinc-400">
        בחר סוג, קבע פרס — ולחץ <span className="font-bold text-gold-bright">🚀 צור והפעל מיד</span> כדי לשחרר לכולם בלחיצה אחת.
        כותרת ריקה מקבלת אוטומטית את שם המשחק. התשובה מוגרלת מחדש בכל הפעלה.
        קביעת <span className="font-bold text-gold-bright">משך בדקות</span> תסגור את המשחק לבד בתום הזמן.
      </p>

      {/* Several releases can run side by side — this is the only place the
          ceiling is visible, and the count is what tells an admin whether the
          next "שחרר לכולם" will be refused. */}
      <p
        className={`rounded-xl border p-3 text-center text-sm ${
          full
            ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
            : "border-border-subtle bg-panel-inset text-zinc-400"
        }`}
      >
        אפשר להריץ עד{" "}
        <span className="nums font-bold text-gold-bright" dir="ltr">
          {MAX_LIVE_MINIGAMES}
        </span>{" "}
        מיני-משחקים במקביל — שחרור משחק נוסף לא עוצר את הקודמים, וכולם מופיעים
        זה לצד זה בשורת הפיקוד של השחקנים.{" "}
        <span className="font-bold">
          רצים כרגע{" "}
          <span className="nums" dir="ltr">
            {liveCount}
          </span>
          {full && " — עצור אחד כדי לשחרר עוד"}
        </span>
      </p>

      <EditorSection title="משחק חדש" icon="➕">
        <MiniGameCreator action={createMiniGame} />
      </EditorSection>

      <div className="space-y-3">
        {games.map((g) => {
          // A timed release is over once its deadline passes; the isActive flag
          // is only flipped lazily on the next player read, so the deadline —
          // not the flag — is what this screen reports.
          const minutesLeft =
            g.isActive && g.endsAt
              ? Math.ceil((g.endsAt.getTime() - now.getTime()) / 60_000)
              : null;
          const live = g.isActive && (minutesLeft === null || minutesLeft > 0);

          return (
          <div
            key={g.id}
            className={`panel rounded-xl p-4 ${live ? "ring-1 ring-emerald-500/50" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold text-gold-bright">
                  <span aria-hidden>{MINIGAME_TYPE_META[g.type].icon}</span>
                  {g.title}
                  {live && (
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      פעיל עכשיו
                    </span>
                  )}
                  {live && minutesLeft !== null && (
                    <span className="rounded bg-gold/20 px-2 py-0.5 text-[10px] font-bold text-gold-bright">
                      ⏳ נותרו {minutesLeft} דק׳
                    </span>
                  )}
                  {g.isActive && !live && (
                    <span className="rounded bg-zinc-700/40 px-2 py-0.5 text-[10px] font-bold text-zinc-300">
                      הזמן תם
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-zinc-400">
                  {MINIGAME_TYPE_META[g.type].label} · פרס:{" "}
                  <span className="text-amber-200" dir="ltr">
                    {prizeText(he, g)}
                  </span>{" "}
                  · {g.maxAttempts} ניסיונות ·{" "}
                  {(() => {
                    const fee = eventCost(g);
                    const extra = eventExtraCost(g);
                    if (!fee && !extra) return "חינם";
                    return [
                      fee ? `🎟️ כניסה: ${costText(he, fee.resource, fee.amount)}` : "כניסה חופשית",
                      extra
                        ? `עד ${g.maxExtraAttempts} נוספים ב־${costText(he, extra.resource, extra.amount)} כ״א`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                  })()}{" "}
                  · {g.maxWinners === 0 ? "זוכים ללא הגבלה" : `עד ${g.maxWinners} זוכים`} · זכו עד כה{" "}
                  <span className="nums" dir="ltr">
                    {g.winnersCount}
                  </span>{" "}
                  · {g._count.entries} משתתפים ·{" "}
                  {g.durationMinutes > 0 ? `משך ${g.durationMinutes} דק׳` : "ללא הגבלת זמן"}
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                {live ? (
                  <ActionForm action={deactivateMiniGame} submitLabel="⏹ הפסק" submitVariant="danger" submitClassName="text-xs">
                    <input type="hidden" name="id" value={g.id} />
                  </ActionForm>
                ) : (
                  <ActionForm action={activateMiniGame} submitLabel="🚀 שחרר לכולם" submitClassName="text-xs">
                    <input type="hidden" name="id" value={g.id} />
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <span>למשך</span>
                      <input
                        name="durationMinutes"
                        type="number"
                        min={0}
                        defaultValue={g.durationMinutes}
                        dir="ltr"
                        className="w-16 rounded border border-border-subtle bg-panel-inset px-2 py-1 text-center text-xs text-zinc-100 outline-none focus:border-gold/60"
                      />
                      <span>דק׳ (0=∞)</span>
                    </label>
                  </ActionForm>
                )}
                <ActionForm
                  action={deleteMiniGame}
                  submitLabel="🗑 מחק"
                  submitVariant="secondary"
                  submitClassName="text-xs"
                  confirm="למחוק את המיני-משחק?"
                >
                  <input type="hidden" name="id" value={g.id} />
                </ActionForm>
              </div>
            </div>
          </div>
          );
        })}
        {games.length === 0 && (
          <p className="panel-inset rounded-xl p-6 text-center text-zinc-500">אין מיני-משחקים עדיין</p>
        )}
      </div>
    </div>
  );
}
