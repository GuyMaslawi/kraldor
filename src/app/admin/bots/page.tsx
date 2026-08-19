import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { ActionForm } from "@/components/admin/ActionForm";
import { EditorSection, LabeledInput, ResourceFieldLabel } from "@/components/admin/fields";
import { BotPlanter, type BotCityStat } from "@/components/admin/BotPlanter";
import { botsPerCity, listBots, playersPerCity } from "@/server/bots";
import {
  createBotEmpires,
  deleteBotEmpire,
  rearmBotEmpire,
  updateBotEmpire,
} from "@/server/actions/admin";
import {
  BOT_ONLINE_SHARE,
  BOT_RESTORE_MS,
  BOT_SEED_CITY,
  BOT_SOLDIERS,
  botOnline,
} from "@/lib/game/bots";
import { cityAt } from "@/lib/game/cities";
import { HERO_MAX_LEVEL } from "@/lib/game/hero";
import {
  ENSLAVE_MIN_SOLDIERS,
  MAX_CITIES,
  MINE_MAX_LEVEL,
  isProductionBuilding,
} from "@/lib/game/constants";
import { getTunables } from "@/lib/game/config";
import { formatCompact, formatNumber } from "@/lib/game/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "בוטים | ניהול" };

export default async function AdminBotsPage() {
  await requireAdmin();

  const [players, bots, rows, tunables] = await Promise.all([
    playersPerCity(),
    botsPerCity(),
    listBots(),
    getTunables(),
  ]);
  // Read live, not from DEFAULT_TUNABLES: an admin who lowered the seeding on
  // the balance screen must see the number that will actually be planted.
  const openBots = tunables.season.openBots;

  const stats: BotCityStat[] = Array.from({ length: MAX_CITIES }, (_, i) => i + 1).map(
    (cities) => ({
      cities,
      players: players.get(cities) ?? 0,
      bots: bots.get(cities) ?? 0,
    })
  );

  // One clock for the whole list, so two bots refilled in the same second do not
  // come back with different countdowns — and so the presence column is a single
  // snapshot of the rota rather than a different instant per row.
  const nowDate = new Date();
  const now = nowDate.getTime();
  const stranded = stats.filter((s) => s.players === 1 && s.bots === 0);

  return (
    <div className="space-y-6">
      <SectionHeading title="בוטים" ornament="🤖" />

      <p className="panel-inset rounded-xl p-4 text-sm leading-relaxed text-zinc-400">
        קרב וריגול מוגבלים לעיר שלך בלבד. שחקן שטיפס לעיר גבוהה לפני כולם נשאר
        לבד בסולם — אין לו את מי לתקוף ואין לו את מי לרגל, וכל מערכת הקרב פשוט
        נסגרת בפניו. <span className="font-bold text-gold-bright">בוט</span> הוא
        תושב שנשתל בעיר הזו: הוא עומד בדירוג העיר, אפשר לתקוף ולרגל אותו, יש לו
        מכרות שמייצרים שלל אמיתי, והוא מתאושש בעצמו — חיל המצב שלו נבנה מחדש
        לכל היותר פעם ב-{Math.round(BOT_RESTORE_MS / 60_000)} דקות, ברגע
        שמישהו טוען אותו כמטרה.
        <br />
        חיל המצב זהה לכל הבוטים ובכל הערים:{" "}
        <span className="font-bold text-gold-bright">{BOT_SOLDIERS} חיילים</span>{" "}
        בלבד, בלי מרגלים ובלי נשק — פחות מהמינימום שממנו תקיפה מנצחת משעבדת
        חיילים, כך שאי אפשר לחקלא בוטים לעבדים.
        <br />
        בוטים אינם מתחרים: הם מסוננים מהפודיום ומפרסי העונה, מהיכל התהילה, משיאי
        העולם ומכל הלוחות הגלובליים, והם לא מקבלים שידורים ולא מתנות.
        <br />
        <span className="font-bold text-gold-bright">
          פתיחת עונה שותלת בעצמה{" "}
          <span className="nums" dir="ltr">
            {openBots}
          </span>{" "}
          בוטים ב{cityAt(BOT_SEED_CITY).name}
        </span>{" "}
        (הערך <span className="text-zinc-300">בוטים בעיר הראשונה בפתיחת עונה</span> במסך
        האיזון) — כי אחרי איפוס העולם כל השחקנים חוזרים לעיר אחת, וזו העיר היחידה
        שחייבת להיראות מיושבת מהדקה הראשונה. השתילה כאן היא לערים הגבוהות, כשמישהו
        מטפס ונשאר שם לבד.
        <br />
        לבוט אין דפדפן, ולכן הנוכחות שלו מחושבת ולא נמדדת:{" "}
        <span className="nums" dir="ltr">
          {Math.round(BOT_ONLINE_SHARE * 100)}%
        </span>{" "}
        מהם מוצגים מחוברים בכל רגע, וההרכב מתחלף לאורך היום — לכן העמודה{" "}
        <span className="text-emerald-300">מחובר</span> ברשימה למטה משתנה בין רענון
        לרענון. זה בדיוק מה שהשחקנים רואים בצ׳אט ובדירוג.
      </p>

      {stranded.length > 0 && (
        <p className="rounded-xl border border-crimson/40 bg-crimson/10 p-4 text-sm text-red-100">
          <span className="font-bold">שחקן בודד בעיר:</span>{" "}
          {stranded.map((s) => `${cityAt(s.cities).name} (${s.cities})`).join(" · ")} — אין
          שם למי לתקוף.
        </p>
      )}

      <EditorSection title="שתילת בוטים" icon="🌱">
        <BotPlanter action={createBotEmpires} stats={stats} />
      </EditorSection>

      <EditorSection title={`בוטים קיימים (${rows.length})`} icon="📋">
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">אין בוטים במשחק.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((bot) => {
              const empire = bot.empire;
              const city = cityAt(empire.cities);
              // A bot planted before the garrison was fixed still carries the
              // arsenal it was built with, until it is re-armed or the repair
              // script is run — so this is read from the row, not assumed.
              const weapons = bot.attackWeapons + bot.defenseWeapons + bot.spyWeapons;
              // Soldiers below the stored garrison mean it has been raided since
              // its last refill — the one number that says whether this bot is
              // still doing its job.
              const soldiers = empire.army?.soldiers ?? 0;
              const raided = soldiers < bot.soldiers;
              const readyIn = Math.max(
                0,
                Math.ceil((bot.restoredAt.getTime() + BOT_RESTORE_MS - now) / 60_000)
              );
              // The same call the chat dock and the ladder make — so this badge
              // is what a player is looking at right now, not an admin-only
              // approximation of it.
              const online = botOnline(empire.id, nowDate);
              // Every production building carries the same level and staffing
              // (updateBot writes them as one), so the first stands for all.
              const mine = empire.buildings.find((b) => isProductionBuilding(b.type));
              const resets = empire.hero?.resets ?? 0;

              return (
                <div key={bot.id} className="panel rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-bold text-gold-bright">
                        <span aria-hidden>🤖</span>
                        <Link
                          href={`/game/empires/${empire.id}`}
                          className="hover:underline"
                        >
                          {empire.name}
                        </Link>
                        <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-bold text-zinc-300">
                          {city.name} ({empire.cities})
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            online
                              ? "bg-emerald-500/20 text-emerald-200"
                              : "bg-white/5 text-zinc-500"
                          }`}
                        >
                          {online ? "● מחובר" : "○ לא מחובר"}
                        </span>
                        {raided && (
                          <span className="rounded bg-crimson/25 px-2 py-0.5 text-[10px] font-bold text-red-200">
                            נשדד · מתאושש בעוד {readyIn} דק׳
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        כוח{" "}
                        <span className="nums font-bold text-zinc-200" dir="ltr">
                          {formatCompact(empire.militaryPower)}
                        </span>{" "}
                        · גיבור רמה{" "}
                        <span className="nums" dir="ltr">
                          {empire.hero?.level ?? 1}
                        </span>
                        {resets > 0 && (
                          <span className="text-zinc-500">
                            {" "}
                            (+
                            <span className="nums" dir="ltr">
                              {resets}
                            </span>{" "}
                            ריסטים)
                          </span>
                        )}{" "}
                        ·{" "}
                        <span className="nums" dir="ltr">
                          {formatNumber(soldiers)}
                        </span>
                        {raided && (
                          <span className="nums text-zinc-500" dir="ltr">
                            {" "}
                            / {formatNumber(bot.soldiers)}
                          </span>
                        )}{" "}
                        חיילים ·{" "}
                        <span className="nums" dir="ltr">
                          {formatNumber(empire.army?.spies ?? 0)}
                        </span>{" "}
                        מרגלים ·{" "}
                        {weapons === 0 ? (
                          "ללא נשק"
                        ) : (
                          <span className="text-red-300">
                            נשק ישן:{" "}
                            <span className="nums" dir="ltr">
                              {formatNumber(weapons)}
                            </span>{" "}
                            (דרג{" "}
                            <span className="nums" dir="ltr">
                              {bot.weaponTier}
                            </span>
                            )
                          </span>
                        )}{" "}
                        · באוצר{" "}
                        <span className="nums text-gold-dim" dir="ltr">
                          {formatCompact(empire.gold)}
                        </span>{" "}
                        <Icon name="gold" size={11} className="inline-block align-middle text-gold" />
                      </p>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      <ActionForm
                        action={rearmBotEmpire}
                        submitLabel="🔁 חדש חיל מצב"
                        submitVariant="secondary"
                        submitClassName="text-xs"
                      >
                        <input type="hidden" name="empireId" value={empire.id} />
                      </ActionForm>
                      <ActionForm
                        action={deleteBotEmpire}
                        submitLabel="🗑 מחק"
                        submitVariant="danger"
                        submitClassName="text-xs"
                        confirm={`למחוק את ${empire.name}?`}
                      >
                        <input type="hidden" name="empireId" value={empire.id} />
                      </ActionForm>
                    </div>
                  </div>

                  {/* ---- the individual editor ---- */}
                  <details className="mt-3 border-t border-border-subtle pt-3">
                    <summary className="cursor-pointer select-none text-xs font-bold text-gold-dim transition-colors hover:text-gold-bright">
                      ✏️ עריכה אישית — רמה, ריסטים, צבא, מכרות ומשאבים
                    </summary>
                    <ActionForm
                      action={updateBotEmpire}
                      submitLabel="💾 שמור בוט"
                      submitClassName="text-xs"
                      className="mt-3"
                    >
                      <input type="hidden" name="empireId" value={empire.id} />
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                        <LabeledInput
                          label="🏛️ עיר"
                          name="cities"
                          type="number"
                          min={1}
                          max={MAX_CITIES}
                          defaultValue={empire.cities}
                          hint={`1–${MAX_CITIES}`}
                        />
                        <LabeledInput
                          label="⚔️ רמת גיבור"
                          name="heroLevel"
                          type="number"
                          min={1}
                          max={HERO_MAX_LEVEL}
                          defaultValue={empire.hero?.level ?? 1}
                          hint={`1–${HERO_MAX_LEVEL}`}
                        />
                        <LabeledInput
                          label="🔄 ריסטים"
                          name="heroResets"
                          type="number"
                          min={0}
                          defaultValue={resets}
                          hint="מעלה את הרמה האפקטיבית"
                        />
                        <LabeledInput
                          label="🪖 חיילים"
                          name="soldiers"
                          type="number"
                          min={0}
                          defaultValue={bot.soldiers}
                          hint={`מ-${ENSLAVE_MIN_SOLDIERS} ומעלה ניתן לשעבוד`}
                        />
                        <LabeledInput
                          label="🕵️ מרגלים"
                          name="spies"
                          type="number"
                          min={0}
                          defaultValue={bot.spies}
                        />
                        <LabeledInput
                          label="⛏️ רמת מכרות"
                          name="mineLevel"
                          type="number"
                          min={1}
                          max={MINE_MAX_LEVEL}
                          defaultValue={mine?.level ?? 1}
                          hint="תפוקה = רמה ×2 לעבד"
                        />
                        <LabeledInput
                          label="⛓️ עבדים בכל מכרה"
                          name="slavesPerMine"
                          type="number"
                          min={0}
                          defaultValue={mine?.slavesAssigned ?? 0}
                        />
                        <LabeledInput
                          label={<ResourceFieldLabel resource="gold" text="זהב" />}
                          name="gold"
                          type="number"
                          min={0}
                          defaultValue={Math.round(empire.gold)}
                        />
                        <LabeledInput
                          label={<ResourceFieldLabel resource="wood" text="עץ" />}
                          name="wood"
                          type="number"
                          min={0}
                          defaultValue={Math.round(empire.wood)}
                        />
                        <LabeledInput
                          label={<ResourceFieldLabel resource="iron" text="ברזל" />}
                          name="iron"
                          type="number"
                          min={0}
                          defaultValue={Math.round(empire.iron)}
                        />
                        <LabeledInput
                          label={<ResourceFieldLabel resource="stone" text="אבן" />}
                          name="stone"
                          type="number"
                          min={0}
                          defaultValue={Math.round(empire.stone)}
                        />
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        החיילים והמרגלים שנקבעים כאן הם גם חיל המצב שהבוט משתקם
                        אליו אחרי שדידה — העריכה מחזיקה מעמד, לא נמחקת בריענון
                        השעתי. המשאבים הם היתרה הזמינה (מה ששוד מגיע אליו),
                        והמכרות ממשיכים לייצר מעליה. שינוי עיר/רמה מעדכן גם את
                        דרג הנשק שדוח ריגול מציג.
                      </p>
                    </ActionForm>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </EditorSection>
    </div>
  );
}
