import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notStaffOrBot } from "@/lib/bot";
import { formatNumber } from "@/lib/game/format";
import { Icon, type IconName } from "@/components/ui/Icon";

/** How many rows the board shows. */
const TOP = 10;

type SortKey =
  | "slaves"
  | "soldiers"
  | "turns"
  | "diamonds"
  | "citizens"
  | "gold"
  | "power";

const DEFAULT_SORT: SortKey = "power";

interface Row {
  id: string;
  userId: string;
  name: string;
  cities: number;
  gold: number;
  diamonds: number;
  citizens: number;
  turns: number;
  generalPower: number;
  army: { soldiers: number; mineSlaves: number } | null;
}

interface Column {
  key: SortKey;
  label: string;
  icon: IconName;
  tint: string;
  orderBy: Prisma.EmpireOrderByWithRelationInput;
  value: (e: Row) => number;
}

/**
 * The columns, in table order. Each carries its own ORDER BY, and that is the
 * only place a sort key ever becomes a query: the `?top=` param is looked up
 * here and anything unrecognised falls back to power, so no caller-supplied
 * string reaches Prisma.
 */
const COLUMNS: Column[] = [
  {
    key: "slaves",
    label: "עבדים",
    icon: "mine",
    tint: "text-amber-300",
    orderBy: { army: { mineSlaves: "desc" } },
    value: (e) => e.army?.mineSlaves ?? 0,
  },
  {
    key: "soldiers",
    label: "חיילים",
    icon: "army",
    tint: "text-slate-200",
    orderBy: { army: { soldiers: "desc" } },
    value: (e) => e.army?.soldiers ?? 0,
  },
  {
    key: "turns",
    label: "תורות",
    icon: "turns",
    tint: "text-emerald-400",
    orderBy: { turns: "desc" },
    value: (e) => e.turns,
  },
  {
    key: "diamonds",
    label: "יהלומים",
    icon: "diamond",
    tint: "text-cyan-300",
    orderBy: { diamonds: "desc" },
    value: (e) => e.diamonds,
  },
  {
    key: "citizens",
    label: "אזרחים",
    icon: "citizens",
    tint: "text-bone",
    orderBy: { citizens: "desc" },
    value: (e) => e.citizens,
  },
  {
    key: "gold",
    label: "זהב",
    icon: "gold",
    tint: "text-gold-bright",
    orderBy: { gold: "desc" },
    value: (e) => e.gold,
  },
  {
    key: "power",
    label: "עוצמה",
    icon: "attack",
    tint: "text-crimson-bright",
    orderBy: { generalPower: "desc" },
    value: (e) => e.generalPower,
  },
];

function isSortKey(v: string | undefined): v is SortKey {
  return COLUMNS.some((c) => c.key === v);
}

/**
 * טבלת האיזון — the ten biggest holdings in the world, on one screen.
 *
 * It exists to answer a balance question rather than a moderation one: are the
 * leaders sitting on a hundred thousand slaves while everyone else has two
 * hundred, is anybody hoarding turns, has a diamond faucet opened somewhere.
 * That is why every column is sortable — "top ten" means a different ten
 * depending on which number is being watched — and why each column carries the
 * world total and average underneath it. Ten rows without the world behind them
 * say nothing about balance.
 *
 * Bots and staff are excluded (`notStaffOrBot`): a garrison's stockpile is
 * something the admin planted, and a staff empire is not a contestant. Counting
 * either would move exactly the figures this table exists to read.
 */
export async function EconomyBoard({ sort }: { sort?: string }) {
  const active = isSortKey(sort) ? sort : DEFAULT_SORT;
  const column = COLUMNS.find((c) => c.key === active)!;

  const [rows, empireTotals, armyTotals, players] = await Promise.all([
    prisma.empire.findMany({
      where: notStaffOrBot,
      orderBy: column.orderBy,
      take: TOP,
      select: {
        id: true,
        userId: true,
        name: true,
        cities: true,
        gold: true,
        diamonds: true,
        citizens: true,
        turns: true,
        generalPower: true,
        army: { select: { soldiers: true, mineSlaves: true } },
      },
    }),
    prisma.empire.aggregate({
      where: notStaffOrBot,
      _sum: { gold: true, diamonds: true, citizens: true, turns: true, generalPower: true },
    }),
    // The army lives on its own table, so its three sums need their own
    // aggregate — filtered through the relation so the same empires are counted.
    prisma.army.aggregate({
      where: { empire: notStaffOrBot },
      _sum: { soldiers: true, mineSlaves: true },
    }),
    prisma.empire.count({ where: notStaffOrBot }),
  ]);

  const worldTotal: Record<SortKey, number> = {
    slaves: armyTotals._sum.mineSlaves ?? 0,
    soldiers: armyTotals._sum.soldiers ?? 0,
    turns: empireTotals._sum.turns ?? 0,
    diamonds: empireTotals._sum.diamonds ?? 0,
    citizens: empireTotals._sum.citizens ?? 0,
    gold: empireTotals._sum.gold ?? 0,
    power: empireTotals._sum.generalPower ?? 0,
  };

  return (
    <section className="panel rounded-xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-gold-bright">
          📊 טופ {TOP} — כלכלת העולם
        </h3>
        <p className="text-[11px] text-zinc-500">
          מיון לפי <b className="text-zinc-300">{column.label}</b> · לחיצה על כותרת עמודה
          ממיינת מחדש · {players.toLocaleString("he-IL")} שחקנים בעולם (ללא בוטים וצוות)
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-right text-[11px] uppercase tracking-wider text-gold-dim">
              <th className="p-2 font-semibold">#</th>
              <th className="p-2 font-semibold">אימפריה</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="p-2 font-semibold">
                  <Link
                    href={`/admin?top=${c.key}`}
                    scroll={false}
                    className={`inline-flex items-center gap-1 hover:text-gold-bright ${
                      c.key === active ? "text-gold-bright" : ""
                    }`}
                  >
                    <Icon name={c.icon} size={12} className={c.tint} />
                    {c.label}
                    {c.key === active && <span aria-hidden>▾</span>}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr
                key={e.id}
                className="border-b border-border-subtle/50 transition-colors hover:bg-white/5"
              >
                <td className="nums p-2 text-zinc-500" dir="ltr">
                  {i + 1}
                </td>
                <td className="p-2">
                  <Link
                    href={`/admin/users/${e.userId}`}
                    className="font-bold text-gold-bright hover:underline"
                  >
                    {e.name}
                  </Link>
                  <div className="text-[11px] text-zinc-500">עיר {e.cities}</div>
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`nums p-2 ${c.key === active ? "font-bold text-gold-bright" : "text-zinc-300"}`}
                    dir="ltr"
                  >
                    {formatNumber(c.value(e))}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="p-6 text-center text-zinc-500">
                  אין שחקנים עדיין
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-subtle text-[11px]">
              <td colSpan={2} className="p-2 font-bold text-zinc-400">
                סה&quot;כ בעולם
              </td>
              {COLUMNS.map((c) => (
                <td key={c.key} className="nums p-2 font-bold text-zinc-200" dir="ltr">
                  {formatNumber(worldTotal[c.key])}
                </td>
              ))}
            </tr>
            <tr className="text-[11px]">
              <td colSpan={2} className="p-2 font-bold text-zinc-500">
                ממוצע לשחקן
              </td>
              {COLUMNS.map((c) => (
                <td key={c.key} className="nums p-2 text-zinc-400" dir="ltr">
                  {players > 0 ? formatNumber(worldTotal[c.key] / players) : "—"}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
