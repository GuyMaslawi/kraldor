"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { formatNumber } from "@/lib/game/format";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PlayerLink } from "@/components/ui/PlayerLink";
import type { ShieldState } from "@/components/game/ShieldBadges";
import { useT } from "@/i18n/client";

export type BattleRow = {
  id: string;
  createdAt: string;
  /** Created after the player's last visit to the reports page. */
  isNew: boolean;
  rival: string;
  /** The other empire in the fight — the "יריב" cell links to his dossier. */
  rivalId: string;
  /**
   * The raid shields he is holding *now* — not what he held when this report
   * was written. The history is where retaliation is decided, and a rival who
   * bought a shield after hitting you has nothing left to take back.
   */
  shields?: ShieldState;
  isAttacker: boolean;
  won: boolean;
  attackerPower: number;
  defenderPower: number;
  attackerSoldiersPower: number | null;
  attackerWeaponsPower: number | null;
  defenderSoldiersPower: number | null;
  defenderWeaponsPower: number | null;
  myLossSoldiers: number;
  turnsSpent: number;
  stolenGold: number;
  stolenWood: number;
  stolenIron: number;
  stolenStone: number;
  totalStolen: number;
  plunderIsMine: boolean;
};

export type SpyRow = {
  id: string;
  createdAt: string;
  /** Created after the player's last visit to the reports page. */
  isNew: boolean;
  rival: string;
  /** The other empire in the mission — the "יריב" cell links to his dossier. */
  rivalId: string;
  /** His raid shields right now — see the same field on BattleRow. */
  shields?: ShieldState;
  /** True for missions I sent, false for enemy spies caught in my territory. */
  isAttacker: boolean;
  success: boolean;
  turnsSpent: number;
  finalChance: number | null;
  weaponsBonus: number | null;
  attackerIntel: number | null;
  defenderIntel: number | null;
  revealedGold: number;
  revealedWood: number;
  revealedIron: number;
  revealedStone: number;
  revealedSoldiers: number;
  revealedSpies: number;
  revealedMineSlaves: number;
};

type TabKey = "againstMe" | "myAttacks" | "spiesOnMe" | "mySpies";

// i18n-keys-start: labels stay in Hebrew and go through t() where the tab is drawn
const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: "againstMe", label: "תקיפות עליי", icon: "shield" },
  { key: "myAttacks", label: "תקיפות שלי", icon: "attack" },
  { key: "spiesOnMe", label: "ריגול עליי", icon: "spy" },
  { key: "mySpies", label: "ריגול שלי", icon: "spy" },
];
// i18n-keys-end

function EmptyState({ text }: { text: string }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-zinc-500">{text}</p>
  );
}

function num(value: number) {
  return (
    <span className="nums" dir="ltr">
      {formatNumber(value)}
    </span>
  );
}

function NewPill() {
  const t = useT();
  return (
    <span className="disp-new me-2 inline-block rounded-full bg-red-500 px-1.5 py-px align-middle text-[9px] font-black text-white">
      {t("חדש")}
    </span>
  );
}

export function ReportsTabs({
  battles,
  spies,
}: {
  battles: BattleRow[];
  spies: SpyRow[];
}) {
  const t = useT();
  const [tab, setTab] = useState<TabKey>("againstMe");

  const myAttacks = battles.filter((b) => b.isAttacker);
  const againstMe = battles.filter((b) => !b.isAttacker);
  const mySpies = spies.filter((s) => s.isAttacker);
  const spiesOnMe = spies.filter((s) => !s.isAttacker);

  const isSpyTab = tab === "mySpies" || tab === "spiesOnMe";
  const battleRows =
    tab === "myAttacks" ? myAttacks : tab === "againstMe" ? againstMe : [];
  const spyRows = tab === "mySpies" ? mySpies : spiesOnMe;

  const newCount: Record<TabKey, number> = {
    myAttacks: myAttacks.filter((b) => b.isNew).length,
    againstMe: againstMe.filter((b) => b.isNew).length,
    mySpies: mySpies.filter((s) => s.isNew).length,
    spiesOnMe: spiesOnMe.filter((s) => s.isNew).length,
  };

  return (
    <div className="space-y-4">
      {/* tabs */}
      <div className="flex flex-wrap gap-2">
        {/* `tab_`, not `t` — `t` is the translator in this scope. */}
        {TABS.map((tab_) => (
          <button
            key={tab_.key}
            type="button"
            onClick={() => setTab(tab_.key)}
            className={`btn px-4 py-2 text-sm ${
              tab === tab_.key ? "btn-dark" : "btn-ghost"
            }`}
          >
            <Icon name={tab_.icon} size={16} />
            {t(tab_.label)}
            {newCount[tab_.key] > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white nums">
                {newCount[tab_.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* battle table */}
      {!isSpyTab && (
        <div className="panel-gold overflow-x-auto rounded-xl p-0">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-start text-xs text-gold-dim">
                <th className="px-4 py-2.5 font-semibold">{t("זמן")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("יריב")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("כוח התקפה")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("כוח הגנה")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("פרטים")}</th>
              </tr>
            </thead>
            <tbody>
              {battleRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState text={t("אין דוחות קרב בקטגוריה זו.")} />
                  </td>
                </tr>
              ) : (
                battleRows.map((r, i) => (
                  <tr
                    key={r.id}
                    style={{ "--i": Math.min(i, 12) } as CSSProperties}
                    className="disp-row border-b border-border-subtle align-top last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                      {r.isNew && <NewPill />}
                      <span className="nums" dir="ltr">
                        {r.createdAt}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-zinc-100">
                      {/* Reading the history is how you find out who has been
                          hitting you — so the name opens his dossier, where the
                          answer (spy, raid, mail) is one more click. */}
                      <PlayerLink
                        empireId={r.rivalId}
                        name={r.rival}
                        shields={r.shields}
                      />
                    </td>
                    <td className="px-4 py-3 text-red-400">
                      {num(r.attackerPower)}
                    </td>
                    <td className="px-4 py-3 text-sky-300">
                      {num(r.defenderPower)}
                    </td>
                    <td className="px-4 py-3">
                      <p
                        className={`font-bold ${
                          r.won ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {r.isAttacker
                          ? r.won
                            ? t("כבשת את היריב בהצלחה!")
                            : t("התקפתך נהדפה.")
                          : r.won
                            ? t("הדפת את ההתקפה בהצלחה!")
                            : t("היריב פרץ את הגנתך.")}
                      </p>
                      {(r.myLossSoldiers > 0 || r.isAttacker) && (
                        <p className="mt-1 text-xs text-zinc-500">
                          {/* Player battles cost no soldiers — only older
                              reports still carry casualties. */}
                          {r.myLossSoldiers > 0 && (
                            <>
                              {t("האבדות שלך:")} {num(r.myLossSoldiers)} {t("חיילים")}
                            </>
                          )}
                          {r.myLossSoldiers > 0 && r.isAttacker && " · "}
                          {r.isAttacker && (
                            <>
                              {t("עלות:")} {num(r.turnsSpent)} {t("תורות")}
                            </>
                          )}
                        </p>
                      )}
                      {r.totalStolen > 0 && (
                        <p
                          className={`mt-1 text-xs ${
                            r.plunderIsMine ? "text-gold" : "text-zinc-500"
                          }`}
                        >
                          {t("שלל:")} <Icon name="gold" size={14} className="inline-block align-middle text-gold-bright" /> {num(r.stolenGold)} · <Icon name="wood" size={14} className="inline-block align-middle text-amber-600" />{" "}
                          {num(r.stolenWood)} · <Icon name="iron" size={14} className="inline-block align-middle text-slate-300" />{" "}
                          {num(r.stolenIron)} · <Icon name="stone" size={14} className="inline-block align-middle text-stone-400" />{" "}
                          {num(r.stolenStone)}
                        </p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* spy table */}
      {isSpyTab && (
        <div className="space-y-3">
          {tab === "spiesOnMe" && (
            <p className="rounded-lg border border-purple-500/30 bg-purple-950/25 px-3 py-2 text-xs text-purple-200/90">
              {t("כאן מופיעים רק מרגלים שכוחות הביטחון שלך")} <b>{t("תפסו")}</b>{" "}
              {t("— ריגול מוצלח נגדך נשאר חשאי ואינו נרשם.")}
            </p>
          )}
          <div className="panel-gold overflow-x-auto rounded-xl p-0">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-start text-xs text-gold-dim">
                <th className="px-4 py-2.5 font-semibold">{t("זמן")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("יריב")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("תוצאה")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("מידע שנחשף")}</th>
              </tr>
            </thead>
            <tbody>
              {spyRows.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      text={
                        tab === "mySpies"
                          ? t("לא שלחת מרגלים עדיין.")
                          : t("לא נתפסו מרגלים בשטחך.")
                      }
                    />
                  </td>
                </tr>
              ) : (
                spyRows.map((r, i) => (
                  <tr
                    key={r.id}
                    style={{ "--i": Math.min(i, 12) } as CSSProperties}
                    className="disp-row border-b border-border-subtle align-top last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                      {r.isNew && <NewPill />}
                      <span className="nums" dir="ltr">
                        {r.createdAt}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-zinc-100">
                      {/* Reading the history is how you find out who has been
                          hitting you — so the name opens his dossier, where the
                          answer (spy, raid, mail) is one more click. */}
                      <PlayerLink
                        empireId={r.rivalId}
                        name={r.rival}
                        shields={r.shields}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-bold ${
                          // Success is the attacker's outcome — for a spy caught
                          // in my territory the same failure is *my* win.
                          r.success === r.isAttacker
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {r.isAttacker
                          ? r.success
                            ? t("המשימה הצליחה")
                            : t("המרגל נתפס")
                          : t("תפסת את המרגל!")}
                      </span>
                      <p className="mt-1 text-xs text-zinc-500">
                        {r.isAttacker && (
                          <>
                            {t("עלות:")} {num(r.turnsSpent)} {t("תורות")}
                          </>
                        )}
                        {r.attackerIntel !== null && r.defenderIntel !== null ? (
                          <>
                            {r.isAttacker ? " · " : ""}
                            {t("כח מודיעין:")}{" "}
                            <span className="nums">
                              {num(Math.round(r.isAttacker ? r.attackerIntel : r.defenderIntel))}{" "}
                              {t("(שלך) מול")}{" "}
                              {num(Math.round(r.isAttacker ? r.defenderIntel : r.attackerIntel))}
                            </span>
                          </>
                        ) : (
                          r.isAttacker &&
                          r.finalChance !== null && (
                            <>
                              {" "}
                              · {t("סיכוי:")}{" "}
                              <span className="nums" dir="ltr">
                                {Math.round((r.finalChance ?? 0) * 100)}%
                              </span>
                            </>
                          )
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {!r.isAttacker ? (
                        <span className="text-xs text-zinc-500">
                          {t("המרגל חוסל לפני שאסף מידע — לא דלף דבר.")}
                        </span>
                      ) : r.success ? (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-300 sm:grid-cols-3">
                          <span><Icon name="gold" size={14} className="inline-block align-middle text-gold-bright" /> {num(r.revealedGold)}</span>
                          <span><Icon name="wood" size={14} className="inline-block align-middle text-amber-600" /> {num(r.revealedWood)}</span>
                          <span><Icon name="iron" size={14} className="inline-block align-middle text-slate-300" /> {num(r.revealedIron)}</span>
                          <span><Icon name="stone" size={14} className="inline-block align-middle text-stone-400" /> {num(r.revealedStone)}</span>
                          <span><Icon name="army" size={14} className="inline-block align-middle" /> {num(r.revealedSoldiers)}</span>
                          <span><Icon name="spy" size={14} className="inline-block align-middle" /> {num(r.revealedSpies)}</span>
                          <span><Icon name="mine" size={14} className="inline-block align-middle" /> {num(r.revealedMineSlaves)}</span>
                          {/* The row is only the headline — the mission also
                              brought back the vaults, the arsenal, the hero and
                              every running spell. That lives on the report page. */}
                          <Link
                            href={`/game/spy/${r.id}`}
                            className="col-span-2 mt-1 font-semibold text-gold hover:text-gold-bright sm:col-span-3"
                          >
                            {t("התיק המלא")} ←
                          </Link>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-500">
                          {t("המרגל אבד במשימה ולא הושג מידע.")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
