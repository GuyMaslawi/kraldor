import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ActionForm } from "@/components/admin/ActionForm";
import { EditorSection, LabeledInput, LabeledSelect, StatLine } from "@/components/admin/fields";
import { TUNABLE_META } from "@/components/admin/tunableMeta";
import { DEFAULT_TUNABLES, getTunables } from "@/lib/game/config";
import { formatNumber } from "@/lib/game/format";
import { gameWeek } from "@/lib/game/time";
import { MAX_CITIES } from "@/lib/game/constants";
import { bossForCity, bossPower, bossReviveMs } from "@/lib/game/bosses";
import { bossSiegeMaxHp } from "@/lib/game/bossBattle";
import { WORLD_BOSSES, WORLD_BOSS_BY_KEY } from "@/lib/game/worldBoss";
import {
  killWorldBoss,
  resetWorldBoss,
  reviveCityBosses,
  reviveWorldBoss,
  saveBossTunables,
  saveWorldBoss,
  spawnWorldBoss,
} from "@/server/actions/admin";

export const dynamic = "force-dynamic";

const INPUT_CLASS =
  "w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none focus:border-gold/60";

/** One row of the city-boss overview — the newest life of each empire's tyrant. */
interface TierRow {
  tier: number;
  lives: number;
  alive: number;
  dead: number;
}

/**
 * /admin/bosses — the control room for both bosses.
 *
 * The two halves look different because the two features are: the city boss is
 * one private life per player per tier, so it is edited in bulk by scope, while
 * מפלצת העולם is a single shared row a week and is edited directly. See the
 * note above the actions in server/actions/admin.ts.
 */
export default async function AdminBossesPage() {
  await requireAdmin();

  const now = new Date();
  const week = gameWeek(now);
  const tunables = await getTunables();

  const boss = await prisma.worldBoss.findUnique({ where: { week } });
  const definition = boss ? WORLD_BOSS_BY_KEY.get(boss.key) : null;

  const [damage, participants, board, tiers] = await Promise.all([
    boss
      ? prisma.worldBossStrike.aggregate({
          where: { bossId: boss.id },
          _sum: { damage: true },
        })
      : null,
    boss ? prisma.worldBossStrike.count({ where: { bossId: boss.id } }) : 0,
    boss
      ? prisma.worldBossStrike.findMany({
          where: { bossId: boss.id },
          orderBy: { damage: "desc" },
          take: 10,
          select: {
            damage: true,
            hits: true,
            claimed: true,
            empire: { select: { name: true } },
          },
        })
      : [],
    // The newest life of every (empire, tier) pair, folded to one row a tier.
    // `DISTINCT ON` rather than a read-and-group in JS: this is the same shape
    // `currentLife` picks on the write path, and doing it in the database keeps
    // the page one bounded query instead of one row per player.
    // `NOW() AT TIME ZONE 'UTC'` because these columns are zone-less timestamps
    // holding UTC — a bare NOW() would be compared through the session's zone.
    prisma.$queryRaw<TierRow[]>`
      SELECT s."cityTier" AS tier,
             COUNT(*)::int AS lives,
             COUNT(*) FILTER (WHERE s."killedAt" IS NULL AND s.hp > 0)::int AS alive,
             COUNT(*) FILTER (WHERE s."revivesAt" > (NOW() AT TIME ZONE 'UTC'))::int AS dead
      FROM (
        SELECT DISTINCT ON ("empireId", "cityTier") *
        FROM "BossSiege"
        ORDER BY "empireId", "cityTier", "createdAt" DESC
      ) s
      GROUP BY s."cityTier"
      ORDER BY s."cityTier"
    `,
  ]);

  const totalDamage = damage?._sum.damage ?? 0;
  const hpPct = boss && boss.maxHp > 0 ? (boss.hp / boss.maxHp) * 100 : 0;
  const byTier = new Map(tiers.map((row) => [row.tier, row]));
  const reviveMinutes = Math.round(bossReviveMs(tunables.boss.reviveMinutes) / 60_000);

  return (
    <div className="space-y-6">
      <SectionHeading title="בוסים ומפלצת העולם" ornament="🐋" />

      <p className="panel-inset rounded-xl p-4 text-center text-sm text-zinc-400">
        כאן נקבעים החיים, הכוח והשלל של <span className="font-bold text-gold-bright">שליטי הערים</span>{" "}
        ושל <span className="font-bold text-gold-bright">מפלצת העולם</span>, וכאן מחזירים אותם לחיים.
        חשבונות הנהלה ובוטים אינם יכולים לתקוף אף אחד מהשניים — הם רואים את הזירה אך אינם משתתפים בה.
      </p>

      {/* ============================ world boss ============================ */}
      <EditorSection title="מפלצת העולם — השבוע" icon="🐋">
        {boss && definition ? (
          <div className="space-y-4">
            <div className="panel-inset rounded-xl p-4">
              <p className="flex flex-wrap items-center gap-2 text-lg font-black text-gold-bright">
                <span aria-hidden>{definition.sigil}</span>
                {definition.name}
                <span className="nums rounded bg-black/40 px-2 py-0.5 text-xs font-bold text-zinc-300" dir="ltr">
                  {definition.key}
                </span>
                {boss.defeatedAt ? (
                  <span className="rounded bg-crimson/25 px-2 py-0.5 text-[10px] font-bold text-crimson-bright">
                    הופלה
                  </span>
                ) : (
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    עומדת
                  </span>
                )}
              </p>

              <div className="mt-3 h-3 overflow-hidden rounded-full border border-border-subtle bg-black/50">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-crimson to-crimson-bright"
                  style={{ width: `${Math.max(0, Math.min(100, hpPct))}%` }}
                />
              </div>

              <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <StatLine
                  label="חיים"
                  value={
                    <span dir="ltr">
                      {formatNumber(Math.round(boss.hp))} / {formatNumber(boss.maxHp)} (
                      {Math.round(hpPct)}%)
                    </span>
                  }
                />
                <StatLine label="קושי המפלצת (toughness)" value={definition.toughness} />
                <StatLine label="שבוע" value={<span dir="ltr">{boss.week}</span>} />
                <StatLine label="מכים" value={participants} />
                <StatLine label="נזק מצטבר" value={<span dir="ltr">{formatNumber(totalDamage)}</span>} />
                <StatLine
                  label="מי הפילה"
                  value={boss.slayerName ?? "—"}
                  tone={boss.slayerName ? "text-gold-bright" : "text-zinc-500"}
                />
              </div>
            </div>

            <ActionForm action={saveWorldBoss} submitLabel="שמור את המפלצת החיה">
              <div className="grid gap-3 sm:grid-cols-3">
                <LabeledSelect
                  label="איזו מפלצת עומדת השבוע"
                  name="key"
                  defaultValue={boss.key}
                  options={WORLD_BOSSES.map((b) => ({
                    value: b.key,
                    label: `${b.sigil} ${b.name} (קושי ${b.toughness})`,
                  }))}
                />
                <LabeledInput
                  label="מאגר חיים מלא"
                  name="maxHp"
                  type="number"
                  min={1}
                  defaultValue={boss.maxHp}
                  hint="בדרך כלל מוקפא ביצירה — כאן אפשר לשנות אותו באמצע השבוע"
                />
                <LabeledInput
                  label="חיים עכשיו"
                  name="hp"
                  type="number"
                  min={0}
                  defaultValue={Math.round(boss.hp)}
                  hint="0 = המפלצת נופלת והשלל נפתח לכל המכים"
                />
              </div>
            </ActionForm>

            <div className="flex flex-wrap items-end gap-3">
              <ActionForm
                action={reviveWorldBoss}
                submitLabel="❤️ החזר לחיים מלאים"
                submitClassName="text-xs"
                confirm="להחזיר את המפלצת לחיים מלאים? לוח הנזק נשמר."
              />
              <ActionForm
                action={killWorldBoss}
                submitLabel="💀 הפל עכשיו"
                submitVariant="secondary"
                submitClassName="text-xs"
                confirm="להפיל את המפלצת עכשיו? השלל ייפתח לכל מי שהכה השבוע, ואף אחד לא יקבל את יהלומי המכה האחרונה."
              />
              <ActionForm
                action={resetWorldBoss}
                submitLabel="🧹 אפס את השבוע"
                submitVariant="danger"
                submitClassName="text-xs"
                confirm="לאפס את השבוע? המפלצת תחזור לחיים מלאים וכל לוח הנזק יימחק — מי שכבר אסף שלל יוכל לאסוף שוב."
              />
            </div>

            {board.length > 0 && (
              <div className="panel-inset rounded-xl p-3">
                <p className="mb-2 text-xs font-bold text-gold-dim">לוח הנזק</p>
                <ol className="space-y-1">
                  {board.map((row, index) => (
                    <li
                      key={`${row.empire.name}-${index}`}
                      className="flex items-center justify-between gap-2 text-xs text-zinc-300"
                    >
                      <span className="truncate">
                        <span className="nums text-zinc-500">{index + 1}.</span> {row.empire.name}
                        {row.claimed && <span className="text-emerald-400"> · אסף</span>}
                      </span>
                      <span className="nums shrink-0 font-bold text-gold-bright" dir="ltr">
                        {formatNumber(row.damage)} · {row.hits} מכות
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="panel-inset rounded-lg p-3 text-sm text-zinc-400">
              עוד לא נוצרה מפלצת לשבוע {week}. היא נוצרת מעצמה ברגע שהשחקן הראשון פותח את הזירה —
              או עכשיו, בכפתור הזה.
            </p>
            <ActionForm action={spawnWorldBoss} submitLabel="🐋 צור את מפלצת השבוע" />
          </div>
        )}
      </EditorSection>

      {/* ============================ city bosses ============================ */}
      <EditorSection title="שליטי הערים" icon="👹">
        <p className="mb-3 text-xs text-zinc-400">
          לכל שחקן יש חיים משלו של שליט העיר שבדרגתו. הטבלה מראה את החיים הנוכחיים בכל דרגה —
          כמה עומדים וכמה נפלו וסופרים לתחייה (כרגע: {formatNumber(reviveMinutes)} דקות).
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-right text-xs">
            <thead className="text-gold-dim">
              <tr>
                <th className="px-2 py-1 font-semibold">דרגה</th>
                <th className="px-2 py-1 font-semibold">השליט</th>
                <th className="px-2 py-1 font-semibold">כוח</th>
                <th className="px-2 py-1 font-semibold">מאגר חיים</th>
                <th className="px-2 py-1 font-semibold">עומדים</th>
                <th className="px-2 py-1 font-semibold">מתים</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: MAX_CITIES }, (_, i) => i + 1).map((tier) => {
                const row = byTier.get(tier);
                return (
                  <tr key={tier} className="border-t border-border-subtle/60 text-zinc-300">
                    <td className="px-2 py-1.5 nums" dir="ltr">
                      {tier}
                    </td>
                    <td className="px-2 py-1.5 font-bold text-gold-bright">
                      {bossForCity(tier).name}
                    </td>
                    <td className="px-2 py-1.5 nums" dir="ltr">
                      {formatNumber(bossPower(tier, tunables.boss.powerMultiplier))}
                    </td>
                    <td className="px-2 py-1.5 nums" dir="ltr">
                      {formatNumber(
                        bossSiegeMaxHp(
                          tier,
                          tunables.boss.powerMultiplier,
                          tunables.boss.hpMultiplier
                        )
                      )}
                    </td>
                    <td className="px-2 py-1.5 nums text-emerald-300" dir="ltr">
                      {row?.alive ?? 0}
                    </td>
                    <td className="px-2 py-1.5 nums text-crimson-bright" dir="ltr">
                      {row?.dead ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="panel-inset rounded-lg p-3">
            <p className="mb-2 text-xs font-bold text-gold-dim">החזרה לחיים מלאים — לפי דרגה</p>
            <ActionForm
              action={reviveCityBosses}
              submitLabel="❤️ החזר לחיים"
              submitClassName="text-xs"
              confirm="להחזיר את שליטי הערים בטווח שנבחר לחיים מלאים? מי שכבר הפיל אותם יוכל להפיל שוב ולקבל שלל נוסף."
            >
              <LabeledInput
                label="דרגת עיר (0 = כל הדרגות)"
                name="cityTier"
                type="number"
                min={0}
                max={MAX_CITIES}
                defaultValue={0}
                hint="החיים מתמלאים, ומי שנפל קם מיד — בלי להמתין לשעון התחייה"
              />
            </ActionForm>
          </div>

          <div className="panel-inset rounded-lg p-3">
            <p className="mb-2 text-xs font-bold text-gold-dim">החזרה לחיים — לשחקן אחד</p>
            <ActionForm
              action={reviveCityBosses}
              submitLabel="❤️ החזר לשחקן"
              submitClassName="text-xs"
            >
              <LabeledInput
                label="מזהה אימפריה (empireId)"
                name="empireId"
                dir="ltr"
                placeholder="cly..."
                hint="מהעמוד של השחקן ב/admin/users"
              />
            </ActionForm>
          </div>
        </div>
      </EditorSection>

      {/* ============================ the knobs ============================ */}
      <ActionForm action={saveBossTunables} submitLabel="שמור איזון בוסים">
        <div className="space-y-4">
          {(["boss", "worldBoss"] as const).map((group) => {
            const meta = TUNABLE_META[group];
            const values = tunables[group] as Record<string, number>;
            const defaults = DEFAULT_TUNABLES[group] as Record<string, number>;
            return (
              <EditorSection key={group} title={meta.label} icon={meta.icon}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {Object.entries(meta.fields).map(([field, fMeta]) => (
                    <label key={field} className="block space-y-1">
                      <span className="text-xs font-semibold text-gold-dim">{fMeta.label}</span>
                      <input
                        type="number"
                        step={fMeta.step ?? 1}
                        name={`${group}.${field}`}
                        defaultValue={values[field]}
                        dir="ltr"
                        className={INPUT_CLASS}
                      />
                      <span className="block text-[11px] text-zinc-500">
                        ברירת מחדל: <span dir="ltr">{defaults[field]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </EditorSection>
            );
          })}
        </div>
      </ActionForm>

      <p className="panel-inset rounded-xl p-4 text-center text-[11px] text-zinc-500">
        מכפילי החיים והנזק של מפלצת העולם חלים על מפלצת <b>חדשה</b> — מאגר החיים מוקפא ביצירה, ולכן
        כדי לשנות מפלצת שכבר עומדת יש לערוך אותה למעלה. מכפיל השלל, יהלומי ההפלה, מספר המכות ועלות
        המכה חלים מיד על כולם.
      </p>
    </div>
  );
}
