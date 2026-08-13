import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { AutoRefresh } from "@/components/game/AutoRefresh";
import {
  MONITOR_WINDOW_HOURS,
  getDiamondGap,
  getFailedLogins,
  getFeed,
  getHotThrottles,
  getPulse,
  getRecentErrors,
  getSharedIpClusters,
  getTurnBurn,
  countErrors,
  type AnomalyRow,
  type FeedKind,
} from "@/server/adminMonitor";
import {
  TICKS_PER_DAY,
  TURNS_UPGRADE_MAX_LEVEL,
} from "@/lib/game/constants";
import { getTunables } from "@/lib/game/config";

export const metadata = { title: "ניטור | ניהול" };
export const dynamic = "force-dynamic";

/**
 * What the whole game can hand one player in turns over 24 hours: the maxed
 * TURNS_PER_REGULAR_UPDATE upgrade on every five-minute tick, plus a generous
 * allowance for the hero's turn gear (paid per daily update, twice a day).
 *
 * The number is a *ceiling*, not a budget — nobody legitimately spends all of
 * it — so a player above it either bought turn packages with diamonds or found
 * something the audits missed. That is exactly the question the row is asking.
 */
const HERO_TURN_ALLOWANCE = 200;
const DAILY_TURN_CEILING =
  TURNS_UPGRADE_MAX_LEVEL * TICKS_PER_DAY + HERO_TURN_ALLOWANCE;

/**
 * Diamonds a player can win over a season without paying — the wheel, the
 * streak, admin gifts. Set loose on purpose: this flag should fire on a mint,
 * not on a lucky player.
 *
 * The *founding grant* is added to it at render time from the live tunables
 * rather than folded in here. It used to be folded in — a flat 1,000 covering
 * "grant plus luck" while the grant was 10 — and that quietly turned into a
 * false-positive machine the moment the opening bundle was raised: every player
 * would have been carrying the grant against the same ceiling, so the row would
 * have flagged ordinary luck and an admin would have learned to ignore it.
 */
const FREE_DIAMOND_LUCK = 1_000;

const nf = (n: number) => Math.round(n).toLocaleString("he-IL");

function clock(d: Date): string {
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function when(d: Date, now: Date): string {
  const mins = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return `לפני ${Math.round(hours / 24)} ימים`;
}

/* ------------------------------ atoms ------------------------------ */

function Stat({
  label,
  value,
  hint,
  tone = "gold",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "gold" | "good" | "warn" | "bad";
}) {
  const colour = {
    gold: "text-gold-bright",
    good: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-400",
  }[tone];
  return (
    <div className="panel rounded-xl p-3 text-center">
      <div className={`nums truncate text-2xl font-black ${colour}`} dir="ltr">
        {typeof value === "number" ? nf(value) : value}
      </div>
      <div className="mt-0.5 text-xs text-zinc-400">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

function Panel({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel rounded-xl p-4">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
        <span aria-hidden>{icon}</span>
        {title}
      </h2>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-5 text-center text-sm text-zinc-500">{children}</p>;
}

function AnomalyTable({
  rows,
  unit,
  againstLabel,
}: {
  rows: AnomalyRow[];
  unit: string;
  againstLabel: string;
}) {
  if (rows.length === 0) return <Empty>אין נתונים בחלון הזה.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-right text-[11px] text-gold-dim">
            <th className="py-2 font-semibold">אימפריה</th>
            <th className="py-2 font-semibold">{unit}</th>
            <th className="py-2 font-semibold">{againstLabel}</th>
            <th className="py-2 font-semibold">הערה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.empireId}
              className={`border-b border-border-subtle last:border-b-0 ${
                row.flagged ? "bg-red-500/5" : ""
              }`}
            >
              <td className="py-2 pl-2 font-semibold text-zinc-200">
                {row.flagged && <span className="ml-1 text-red-400">⚠</span>}
                {row.name}
              </td>
              <td className="nums py-2 pl-2 font-bold text-gold-bright" dir="ltr">
                {nf(row.value)}
              </td>
              <td className="nums py-2 pl-2 text-zinc-400" dir="ltr">
                {nf(row.against)}
              </td>
              <td className="py-2 text-[11px] text-zinc-500">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FEED_ICON: Record<FeedKind, string> = {
  battle: "⚔️",
  spy: "🕵️",
  boss: "👹",
  purchase: "💳",
  signup: "🎉",
  guild: "🤝",
};

/* ------------------------------ page ------------------------------ */

export default async function AdminMonitorPage() {
  await requireAdmin();
  const now = new Date();

  // The opening bundle is admin-editable, so the "unexplained diamonds" ceiling
  // has to follow it — read live, before the panels fan out.
  const freeDiamonds = (await getTunables()).starting.diamonds + FREE_DIAMOND_LUCK;

  // Every panel is independent, so they load together rather than in sequence.
  const [
    pulse,
    throttles,
    failedLogins,
    altClusters,
    turnBurn,
    diamondGap,
    feed,
    errors,
    errorCount,
  ] = await Promise.all([
    getPulse(now),
    getHotThrottles(now),
    getFailedLogins(),
    getSharedIpClusters(),
    getTurnBurn(now, DAILY_TURN_CEILING),
    getDiamondGap(freeDiamonds),
    getFeed(now),
    getRecentErrors(),
    countErrors(now),
  ]);

  const flagged =
    turnBurn.filter((r) => r.flagged).length +
    diamondGap.filter((r) => r.flagged).length;

  return (
    <div className="space-y-6">
      {/* The screen is a live view; nothing here is worth a manual reload. */}
      <AutoRefresh intervalMs={30_000} />
      <SectionHeading
        title="ניטור האתר"
        ornament={<Icon name="spy" size={22} className="text-crimson" />}
      />

      <p className="text-sm text-zinc-500">
        כל המספרים כאן נמדדים על חלון של {MONITOR_WINDOW_HOURS} שעות, מתוך מה
        שהשחקנים <strong>עשו</strong> — המשחק לא שומר צילומי מצב של יתרות, אז
        &quot;הזהב שלו הוכפל בלילה&quot; היא לא שאלה שאפשר לשאול את הדאטהבייס.
        המסך מתרענן לבד כל 30 שניות.
      </p>

      {(flagged > 0 || errorCount > 0) && (
        <div className="space-y-2">
          {errorCount > 0 && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              🛠 {nf(errorCount)} שגיאות נרשמו ב-{MONITOR_WINDOW_HOURS} השעות
              האחרונות — הפירוט למטה.
            </div>
          )}
          {flagged > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
              ⚠ {flagged} שורות מסומנות בטבלאות החריגות למטה — שווה מבט.
            </div>
          )}
        </div>
      )}

      {/* -------- pulse -------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="פעילים בשעה האחרונה"
          value={pulse.playersActive1h}
          hint="ביצעו פעולה, לא רק גלשו"
          tone="good"
        />
        <Stat label={`פעילים ב-${MONITOR_WINDOW_HOURS} שעות`} value={pulse.playersActive24h} />
        <Stat label="סה״כ אימפריות" value={pulse.totalEmpires} />
        <Stat label="נרשמו היום" value={pulse.signups24h} />
        <Stat
          label="ממתינים לאימות מייל"
          value={pulse.awaitingVerification}
          hint={pulse.awaitingVerification > 0 ? "לא יכולים לשחק עד שיאמתו" : undefined}
          tone={pulse.awaitingVerification > 0 ? "warn" : "gold"}
        />
        <Stat label="קרבות" value={pulse.attacks24h} />
        <Stat label="ריגולים" value={pulse.spies24h} />
        <Stat
          label="חשבונות נעולים כרגע"
          value={pulse.lockedOut}
          tone={pulse.lockedOut > 0 ? "warn" : "gold"}
        />
        <Stat label="בבאן" value={pulse.banned} tone={pulse.banned > 0 ? "bad" : "gold"} />
        <Stat label="הכנסות היום" value={`₪${pulse.revenue24hIls.toFixed(2)}`} tone="good" />
      </div>

      {/* -------- security -------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="חסימות קצב פעילות"
          icon="🚦"
          hint="דליים שנחסמים ברגע זה. ריבוי פגיעות ב״התחברות לחשבון מסוים״ = ניסיון פריצה בעיצומו."
        >
          {throttles.length === 0 ? (
            <Empty>שקט. אף מגבלת קצב לא נלחצת כרגע.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {throttles.map((t) => (
                <li
                  key={`${t.family}:${t.subject}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-black/30 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-zinc-200">{t.label}</span>{" "}
                    <span className="text-[11px] text-zinc-600" dir="ltr">
                      {t.subject}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="nums font-black text-amber-300" dir="ltr">
                      ×{t.count}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      עד {clock(t.resetAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="התחברויות שנכשלו"
          icon="🔐"
          hint="נמחק ברגע שההתחברות מצליחה או שהסיסמה מוחלפת."
        >
          {failedLogins.length === 0 ? (
            <Empty>אף חשבון לא צובר כישלונות.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {failedLogins.map((u) => (
                <li
                  key={u.userId}
                  className="flex items-center justify-between gap-3 rounded-lg bg-black/30 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/users/${u.userId}`}
                    className="min-w-0 truncate font-semibold text-zinc-200 hover:text-gold-bright"
                  >
                    {u.name}{" "}
                    <span className="text-[11px] text-zinc-600" dir="ltr">
                      {u.email}
                    </span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="nums font-black text-amber-300" dir="ltr">
                      ×{u.failedLogins}
                    </span>
                    {u.lockedUntil && u.lockedUntil > now && (
                      <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-bold text-red-300">
                        נעול עד {clock(u.lockedUntil)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* -------- alt clusters -------- */}
      <Panel
        title="חשבונות שחולקים כתובת"
        icon="👥"
        hint="חשבונות שנרשמו או התחברו מאותה כתובת IP — לרוב חווה של שחקן אחד. זה רמז לבדיקה, לא הוכחה: גם בית, מעונות או רשת סלולרית נראים ככה. שקול לפני חסימה."
      >
        {altClusters.length === 0 ? (
          <Empty>אף כתובת לא משותפת ליותר מחשבון אחד.</Empty>
        ) : (
          <ul className="space-y-2.5">
            {altClusters.map((c) => (
              <li key={c.ip} className="rounded-lg bg-black/30 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="nums text-xs text-zinc-500" dir="ltr">
                    {c.ip}
                  </span>
                  <span
                    className={`rounded px-1.5 text-[10px] font-black ${
                      c.count >= 3
                        ? "bg-red-500/15 text-red-300"
                        : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {c.count} חשבונות
                  </span>
                </div>
                <ul className="space-y-1">
                  {c.accounts.map((a) => (
                    <li
                      key={a.userId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <Link
                        href={`/admin/users/${a.userId}`}
                        className="min-w-0 truncate text-zinc-200 hover:text-gold-bright"
                      >
                        {a.empireName ?? a.name}{" "}
                        <span className="text-[11px] text-zinc-600" dir="ltr">
                          {a.email}
                        </span>
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        {a.banned && (
                          <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-bold text-red-300">
                            בבאן
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-600">
                          {a.createdAt.toLocaleDateString("he-IL")}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* -------- anomalies -------- */}
      <Panel
        title="קצב פעולה מול תקרת התורות"
        icon="⏱"
        hint={`תורות שנשרפו על תקיפות וריגולים ב-${MONITOR_WINDOW_HOURS} שעות. התקרה (${nf(
          DAILY_TURN_CEILING
        )}) היא כל מה שהמשחק מייצר ביום לשחקן אחד — מי שמעליה או קנה חבילות תורות, או מצא משהו.`}
      >
        <AnomalyTable rows={turnBurn} unit="תורות שנשרפו" againstLabel="תקרה יומית" />
      </Panel>

      <Panel
        title="יהלומים מול רכישות"
        icon="💎"
        hint="יהלומים הם מטבע הכסף האמיתי. יתרה גדולה בלי רכישה מאחוריה היא הצורה שבה ייראה ניצול שמדפיס מטבע — אבל הגלגל ומתנות אדמין גם משלמים, אז שתי העמודות מוצגות ולא רק אחת."
      >
        <AnomalyTable rows={diamondGap} unit="יהלומים ביד" againstLabel="נרכשו בכסף" />
      </Panel>

      {/* -------- errors -------- */}
      <Panel
        title="שגיאות אחרונות"
        icon="🛠"
        hint="כל שגיאה שהאתר בלע — כולל אלה שהשחקן ראה כ״אירעה שגיאה, נסה שוב״. שורות זהות מתאחדות ונספרות, כך שבאג אחד רועש לא מסתיר ארבעה שקטים."
      >
        {errors.length === 0 ? (
          <Empty>לא נרשמה אף שגיאה. 🎉</Empty>
        ) : (
          <ul className="space-y-1.5">
            {errors.map((e) => (
              <li key={e.id} className="rounded-lg bg-black/30 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-mono text-[11px] text-amber-300" dir="ltr">
                    {e.source}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {e.count > 1 && (
                      <span className="nums rounded bg-red-500/20 px-1.5 text-[10px] font-black text-red-300" dir="ltr">
                        ×{nf(e.count)}
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-600">{when(e.lastSeen, now)}</span>
                  </span>
                </div>
                <p className="mt-0.5 break-words text-xs text-zinc-300" dir="ltr">
                  {e.message}
                </p>
                {e.path && (
                  <p className="mt-0.5 text-[10px] text-zinc-600" dir="ltr">
                    {e.path}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* -------- feed -------- */}
      <Panel
        title="מה קרה עכשיו"
        icon="📡"
        hint="קרבות, ריגולים, בוסים, רכישות, הרשמות והצטרפויות לבריתות — הכל בזרם אחד, החדש למעלה."
      >
        {feed.length === 0 ? (
          <Empty>שקט מוחלט. אף אחד לא עשה כלום.</Empty>
        ) : (
          <ul className="max-h-[36rem] space-y-1 overflow-y-auto pl-1">
            {feed.map((item) => {
              const body = (
                <>
                  <span aria-hidden className="shrink-0">
                    {FEED_ICON[item.kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.text}</span>
                  <span className="shrink-0 text-[10px] text-zinc-600">
                    {when(item.at, now)}
                  </span>
                </>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-zinc-300">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="text-center text-[11px] text-zinc-600">
        פעולות שאתה עצמך מבצע בפאנל נרשמות בנפרד ב־
        <Link href="/admin/audit" className="text-gold hover:text-gold-bright">
          יומן הפעולות
        </Link>
        .
      </p>
    </div>
  );
}
