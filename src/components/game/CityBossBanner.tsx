"use client";

// Client, because it translates with `useT()`. It reads no request state of its
// own — the whole banner is computed server-side into the serializable
// `CityBossState` prop — but a hook is a hook: without this directive the
// component renders on the server and `useT()` is a client reference there,
// which throws ("Attempted to call useT() from the server") and takes the whole
// rankings screen down with it.

import Link from "next/link";
import { Icon, RESOURCE_ICON, RESOURCE_ICON_COLOR } from "@/components/ui/Icon";
import { Tip } from "@/components/ui/Tip";
import { formatNumber } from "@/lib/game/format";
import { BOSS_REWARD_RESOURCES, bossImage } from "@/lib/game/bosses";
import {
  BOSS_CASUALTIES,
  BOSS_CHIP_SHARE,
  BOSS_GRADE_BONUS,
  BOSS_KILL_SHARE,
  BOSS_MOVE_META,
  BOSS_MOVE_COUNTER,
  BOSS_READ_CHANCE_MAX,
  BOSS_ROUT_LOSS_FRACTION,
  BOSS_TACTIC_META,
} from "@/lib/game/bossBattle";
import { cityFullName, cityName } from "@/lib/game/cities";
import { RESOURCE_META } from "@/lib/game/constants";
import { BossAttackButton } from "@/components/game/BossAttackButton";
import { BossCountdown } from "@/components/game/BossCountdown";
import { LivingPortrait } from "@/components/game/LivingPortrait";
import type { CityBossState } from "@/server/bossState";
import { useDir, useT } from "@/i18n/client";

/**
 * The city boss, as a compact slab above the rankings ladder.
 *
 * It has been on a diet. The first version was a double power gauge answering "am
 * I ready yet?", because the fight was one all-or-nothing comparison; the second
 * added a health bar, a sortie projection and a tactic legend, and ran tall enough
 * to push the ladder — the actual subject of this screen — under the fold.
 *
 * Now that the assault runs itself there are only four things a player needs here,
 * and they fit in one row each: who he is, how much life is left, when he comes
 * back if he is dead, and the one button. Everything explanatory — the haul, how
 * the army fights, the lore, the honour roll — is behind the disclosure, which is
 * where reference material belongs when it is read once and never again.
 */
export function CityBossBanner({ state, cities }: { state: CityBossState; cities: number }) {
  const t = useT();
  const dir = useDir();
  const {
    boss,
    power,
    myPower,
    turnCost,
    myTurns,
    hp,
    maxHp,
    participants,
    share,
    sorties,
    myDamage,
    besiegers,
    slayerName,
    revivesAt,
    reviveMs,
    serverNow,
    lifeHaul,
    heroXp,
    expectedSortieDamage,
    sortiesToKill,
    sortiesPerShare,
    roundsPerSortie,
    readChance,
    soldiers,
    expectedSortieLosses,
    expectedSortieLoot,
    armyPower,
    weaponPower,
    heroBonusPct,
    guildBonusPct,
    guildAidPower,
    heroLevel,
    heroAlive,
    activeBattleId,
    activeEndsAt,
    canAttack,
    blocked,
    myKills,
    conquerors,
  } = state;

  const hpPct = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  const woundedPct = 100 - hpPct;
  const outOfTurns = myTurns < turnCost;
  const dead = revivesAt != null;

  // The trade, priced before anything is spent. `bitePct` is measured against one
  // empire's *share* of the pool rather than against the pool itself: the pool is
  // as deep as the city is wide, so a bite out of the whole thing would read as
  // 3% for an army that is doing perfectly well — and the share is what the loot
  // is actually paid on.
  const bitePct = share > 0 ? Math.min(100, (expectedSortieDamage / share) * 100) : 0;
  const lossPct = soldiers > 0 ? (expectedSortieLosses / soldiers) * 100 : 0;
  // Three assaults *per share* is what an army standing at the printed wall pays
  // (see BOSS_HP_PER_POWER), so this fires exactly for the armies that are under
  // it: past that the honest advice is to grow first, and say why. Measured on the
  // share and never on the shared pool, which a lone player could not empty in a
  // city of ten however strong they were.
  const outmatched = soldiers > 0 && sortiesPerShare > 3;
  const myPct = maxHp > 0 ? Math.min(100, (myDamage / maxHp) * 100) : 0;

  const bossName = t(boss.name);
  // `blocked` first: it is the only reason here that never clears, so it must
  // not be shadowed by a countdown or a turn shortfall that suggests waiting.
  const disabledReason = blocked
    ? t("חשבונות הנהלה אינם תוקפים את שליט העיר.")
    : dead
      ? t("{boss} מת — הוא קם לתחייה בעוד רגע", { boss: bossName })
      : activeBattleId
        ? t("הקרב הנוכחי עוד רץ")
        : outOfTurns
          ? t("חסרות לך {turns} תורות", { turns: formatNumber(turnCost - myTurns) })
          : t("אין לך צבא — אמן חיילים קודם");

  return (
    <section
      dir={dir}
      style={{ ["--boss-accent" as string]: boss.accent }}
      className="relative overflow-hidden rounded-2xl border border-[rgb(var(--boss-accent))]/45 bg-[#0a0709] shadow-[0_0_0_1px_rgba(0,0,0,0.8),0_20px_60px_-30px_rgb(var(--boss-accent)/0.55)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_85%_0%,rgb(var(--boss-accent)/0.26),transparent_60%)]"
      />

      {/* Two columns from sm up, stacked below it. On a phone the portrait
          column was taking 112px of a ~270px content width, which left the
          dossier ~140px: the name truncated, every loot figure broke onto its
          own line and the assault button was clipped. Stacked, the tyrant keeps
          a full-width band and the dossier gets the whole width for the four
          rows it actually has to say. */}
      <div className="relative grid grid-cols-1 sm:grid-cols-[150px_1fr] lg:grid-cols-[180px_1fr]">
        {/* ---------------- portrait ----------------
            The tyrant is the subject of this block, so he gets the room to read
            as a character rather than as a list bullet: a wide column with a
            floor under it, so the art keeps its presence even when the dossier
            beside it collapses to four short rows. At this size the portrait is
            also finally worth the expensive tier — every boss ships a depth map
            (public/boss/*-depth.png), so `rich` buys real volume here where it
            would have been wasted on the 76px strip this used to be.

            Stacked on a phone that column was a 390×168 letterbox over art that
            is 3:4, and `cover` threw away nearly two thirds of the tyrant —
            what survived was a strip of helmet with no face under it. So below
            `sm` the portrait is not a band at all: it is a card cut to the
            artwork's own ratio, centred on the accent wash, holding the whole
            figure in about the height the letterbox cost. At `sm` the column is
            tall enough for the bleed again and the card dissolves into it. */}
        <div className="relative flex h-[188px] items-center justify-center sm:block sm:h-auto sm:min-h-[240px]">
          <div className="relative h-[172px] w-[129px] overflow-hidden rounded-xl border border-[rgb(var(--boss-accent))]/35 sm:absolute sm:inset-0 sm:h-auto sm:w-auto sm:rounded-none sm:border-0">
            {/* Crest underlay: a missing portrait file still reads as deliberate art
                rather than as a broken image. */}
            <div
              aria-hidden
              className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[rgb(var(--boss-accent)/0.35)] to-black"
            >
              <Icon name="attack" size={56} className="text-black/40" />
            </div>
            <LivingPortrait
              src={bossImage(boss.key)}
              alt={`${bossName} — ${t(boss.title)}`}
              className={`absolute inset-0 ${dead ? "grayscale" : ""}`}
              accent={boss.accent}
              embers={dead ? 0 : 8}
              tilt={9}
              drift={20}
              rich={!dead}
            >
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25"
              />
              {/* The seam into the dossier: only once the two sit side by side —
                  on the phone card there is no edge to blend into. */}
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 hidden w-10 bg-gradient-to-l from-transparent to-[#0a0709] sm:block"
              />
            </LivingPortrait>
          </div>
          {myKills > 0 && (
            <div className="absolute inset-x-0 bottom-1.5 flex justify-center">
              <Tip
                tip={t("הפלת את {boss} {count} פעמים בעיר הזו.", {
                  boss: bossName,
                  count: myKills,
                })}
              >
                <span className="nums rounded border border-gold/60 bg-black/85 px-1.5 text-[10px] font-black text-gold-bright">
                  ☠ ×{myKills}
                </span>
              </Tip>
            </div>
          )}
        </div>

        {/* ---------------- dossier ---------------- */}
        <div className="flex min-w-0 flex-col gap-2 p-3 sm:p-3.5">
          {/* identity — one line */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <p className="min-w-0 truncate text-lg font-black leading-tight text-[rgb(var(--boss-accent))]">
              {bossName}
              <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.2em] text-bone-dim">
                {t(boss.title)}
              </span>
            </p>
            <Tip
              tip={t("{boss} שולט ב{city}.", {
                boss: bossName,
                city: cityFullName(t, cities),
              })}
            >
              <span className="cursor-help shrink-0 rounded border border-[rgb(var(--boss-accent))]/60 bg-black/60 px-1.5 py-0.5 text-[10px] font-black text-[rgb(var(--boss-accent))]">
                {t("עיר {city}", { city: cityName(t, cities) })}
              </span>
            </Tip>
          </div>

          {/* ---------------- the hoard ----------------
              The bait, and the first thing under his name. Everything else in
              this slab is a price — turns, blood, how many marches it takes —
              and the one number that answers "why would I pay it" used to live
              folded away behind a disclosure nobody opens, while the row on
              screen quoted the *chip* a single assault takes off (800 gold,
              against the 750,000 he is actually sitting on). That reads as a
              tyrant who is not worth the walk.

              So the pile comes first, at the size of the pile — the whole life's
              haul, gear and captives included — and the assault projection below
              it is re-read for what it is: the bite you take out of this, per
              march. Quoted live: `lifeHaul` already carries the season day, the
              city tier, the admin multiplier and a running Happy Hour. */}
          <div className="relative overflow-hidden rounded-lg border border-gold/45 bg-black/50 px-2.5 py-2">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(212,165,74,0.22),transparent_65%)]"
            />
            {/* Label and pile share one row wherever they fit: the slab was put
                on a diet once already so it would not push the ladder under the
                fold, and the hoard has to earn its height back. */}
            <div className="relative">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-gold-bright">
                  <Icon name="gift" size={13} /> {t("{boss} יושב על", { boss: bossName })}
                </span>
                {BOSS_REWARD_RESOURCES.map((res) => (
                  <Tip key={res} tip={t(RESOURCE_META[res].label)}>
                    <span className="nums inline-flex cursor-help items-center gap-1 text-sm font-black text-zinc-100">
                      <Icon
                        name={RESOURCE_ICON[res]}
                        size={15}
                        className={RESOURCE_ICON_COLOR[res]}
                      />
                      <span dir="ltr">{formatNumber(lifeHaul[res])}</span>
                    </span>
                  </Tip>
                ))}
                <Tip
                  tip={t("שבויים ששוחררו ממכלאות הבוס — מצטרפים למאגר עבדי המכרות הפנוי שלך.")}
                >
                  <span className="nums inline-flex cursor-help items-center gap-1 text-sm font-black text-emerald-300">
                    <Icon name="mine" size={15} />
                    <span dir="ltr">{formatNumber(lifeHaul.slaves)}</span>
                  </span>
                </Tip>
                <Tip
                  tip={t(
                    "הבוס תמיד מפיל ציוד גיבור — ולעולם לא ציוד פשוט. דירוג קרב מושלם (S) מעלה את הרצפה בדרגה."
                  )}
                >
                  <span className="inline-flex cursor-help items-center gap-1 rounded border border-purple-500/50 bg-purple-950/50 px-1.5 py-0.5 text-[11px] font-black text-purple-300">
                    <Icon name="spark" size={12} /> {t("ציוד מובטח")}
                  </span>
                </Tip>
                <span className="nums inline-flex items-center gap-1 text-[11px] font-black text-gold">
                  <Icon name="hero" size={13} />
                  <span dir="ltr">+{formatNumber(heroXp)}</span>
                  <span className="font-normal text-zinc-500">{t("ניסיון")}</span>
                </span>
              </div>
              <p className="nums mt-1 text-[11px] leading-relaxed text-zinc-400">
                {t(
                  "זה מה ששווה מנה אחת — שלך. {chip}% ממנה משולמים לפי הנזק שאתה גורם, על כל תקיפה, גם כזו שלא הפילה אותו. את השאר ({kill}%) מתחלקים כשהוא נופל בין כל מי שפצע אותו, לפי הנזק. הציוד הולך למי שמנחית את המכה האחרונה.",
                  {
                    chip: Math.round(BOSS_CHIP_SHARE * 100),
                    kill: Math.round(BOSS_KILL_SHARE * 100),
                  }
                )}
              </p>
            </div>
          </div>

          {/* health, or the revive clock in its place — one row either way */}
          {dead ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-gold/30 bg-black/40 px-2.5 py-2">
              <span className="text-xs font-bold text-gold-bright">
                <Icon name="crown" size={13} className="inline-block align-middle" />{" "}
                {slayerName
                  ? t("{slayer} הפיל את {boss}", { slayer: slayerName, boss: bossName })
                  : t("{boss} הופל", { boss: bossName })}
              </span>
              <span className="text-xs text-zinc-400">{t("— קם לתחייה בעוד")}</span>
              <BossCountdown
                endsAt={revivesAt.getTime()}
                serverNow={serverNow}
                totalMs={reviveMs}
              />
            </div>
          ) : (
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="text-[11px] font-bold text-[rgb(var(--boss-accent))]">
                  {t("חיי הבוס")}
                  {/* The one fact that changes how this bar should be read: the
                      health above is the whole city's problem, not this player's.
                      Without it a lone player sees a pool ten times what their
                      neighbour in a quiet city sees and reads it as a nerf. */}
                  <Tip
                    tip={t(
                      "עריץ אחד לכל העיר, בדיוק כמו מפלצת העולם: כל שחקני {city} תוקפים את אותו מאגר חיים. המאגר נקבע לפי {count} השחקנים הפעילים בדרגה — מנה של {share} לכל אחד — והשלל שלך נמדד מול המנה שלך, לא מול המאגר כולו.",
                      {
                        city: cityName(t, cities),
                        count: participants,
                        share: formatNumber(Math.round(share)),
                      }
                    )}
                  >
                    <span className="mr-1.5 cursor-help rounded border border-[rgb(var(--boss-accent))]/50 bg-black/50 px-1 py-px text-[10px] font-black text-[rgb(var(--boss-accent))]">
                      {t("משותף · {count} שחקנים", { count: participants })}
                    </span>
                  </Tip>
                </span>
                <span className="nums text-xs font-black text-zinc-100" dir="ltr">
                  {formatNumber(Math.round(hp))} / {formatNumber(maxHp)}
                </span>
              </div>
              {/* Two bars in one: the city's progress, and inside it the slice this
                  player has personally carved off — which is the number their own
                  loot is paid on and the only part of the bar they control. */}
              <div className="relative h-2 overflow-hidden rounded-full border border-black/60 bg-white/5">
                <span
                  className="block h-full rounded-full bg-gradient-to-l from-[rgb(var(--boss-accent))] to-[rgb(var(--boss-accent)/0.35)]"
                  style={{ width: `${Math.max(0, Math.min(100, hpPct))}%` }}
                />
                {myPct >= 0.5 && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-gold/70"
                    style={{ width: `${myPct}%` }}
                  />
                )}
              </div>
              {woundedPct >= 1 && (
                <p className="nums mt-1 text-[11px] text-zinc-500">
                  {sorties === 1
                    ? t("פצוע ב־{pct}% מתקיפה אחת — הפצעים נשארים עד שהוא נופל", {
                        pct: Math.round(woundedPct),
                      })
                    : t("פצוע ב־{pct}% מ־{sorties} תקיפות של העיר — הפצעים נשארים עד שהוא נופל", {
                        pct: Math.round(woundedPct),
                        sorties,
                      })}
                  {myDamage > 0 &&
                    t(" · הנזק שלך: {damage} ({pct}%)", {
                      damage: formatNumber(Math.round(myDamage)),
                      pct: myPct < 1 ? myPct.toFixed(1) : Math.round(myPct),
                    })}
                </p>
              )}
            </div>
          )}

          {/* ---------------- the trade, before you pay for it ----------------
              Both halves of it, side by side. The blood used to be invisible
              until the report — you marched, lost a fifth of the army and found
              out afterwards, which is exactly how a fight starts reading as a
              scam. Damage, loot and casualties are all projections from the same
              formulas the assault resolves with (see bossExpectedSortie*).

              The casualty column only exists while casualties do: with the
              assault bloodless it would quote a permanent "~0 ⚔", which reads as
              a mechanic that might yet bite rather than one that is gone. */}
          {!dead && !activeBattleId && soldiers > 0 && (
            <div
              className={`grid gap-x-3 gap-y-1.5 rounded-lg border border-border-subtle bg-black/40 px-2.5 py-2 text-[11px] ${
                BOSS_CASUALTIES ? "sm:grid-cols-3" : "sm:grid-cols-2"
              }`}
            >
              <div>
                <p className="font-bold text-gold-dim">{t("תקיפה אחת תוריד לו")}</p>
                <p className="nums mt-0.5 text-right font-black text-gold-bright" dir="ltr">
                  ~{formatNumber(Math.round(expectedSortieDamage))}
                  <span className="font-normal text-zinc-500"> ({Math.round(bitePct)}%)</span>
                </p>
              </div>
              <div>
                <p className="font-bold text-gold-dim">{t("ותכניס לך מהאוצר")}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {BOSS_REWARD_RESOURCES.map((res) => (
                    <span
                      key={res}
                      className="nums inline-flex items-center gap-0.5 font-bold text-zinc-200"
                    >
                      <Icon
                        name={RESOURCE_ICON[res]}
                        size={11}
                        className={RESOURCE_ICON_COLOR[res]}
                      />
                      <span dir="ltr">{formatNumber(expectedSortieLoot[res])}</span>
                    </span>
                  ))}
                  {expectedSortieLoot.slaves > 0 && (
                    <span className="nums inline-flex items-center gap-0.5 font-bold text-emerald-300">
                      <Icon name="mine" size={11} />
                      <span dir="ltr">{expectedSortieLoot.slaves}</span>
                    </span>
                  )}
                </div>
              </div>
              {BOSS_CASUALTIES && (
                <div>
                  <p className="font-bold text-gold-dim">{t("ותעלה לך")}</p>
                  <p className="nums mt-0.5 text-right font-black text-red-300" dir="ltr">
                    ~{formatNumber(Math.round(expectedSortieLosses))} ⚔
                    <span className="font-normal text-zinc-500"> ({Math.round(lossPct)}%)</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* The one sentence a player under the wall was never told: this is a
              bad trade *right now*, and here is the lever that changes it. */}
          {!dead && !activeBattleId && outmatched && (
            <p className="nums rounded-lg border border-amber-500/30 bg-amber-950/20 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/90">
              <b>{t("{boss} עדיין חזק ממך.", { boss: bossName })}</b>{" "}
              {t("בקצב הזה צריך כ־{sorties} תקיפות רק כדי לסיים את המנה שלך, וכל אחת עולה {turns} תורות", {
                sorties: Number.isFinite(sortiesPerShare) ? sortiesPerShare : "∞",
                turns: formatNumber(turnCost),
              })}
              {BOSS_CASUALTIES &&
                t(" ובערך {soldiers} חיילים", {
                  soldiers: formatNumber(Math.round(expectedSortieLosses)),
                })}
              {t(
                ". אתה עדיין מקבל שלל על כל נזק, ובני העיר נלחמים באותו עריץ יחד — אבל עדיף לגדל צבא ולהעלות את הגיבור, ואז לתקוף."
              )}
            </p>
          )}

          {/* the one button */}
          <div className="flex flex-wrap items-center gap-2">
            {activeBattleId && activeEndsAt ? (
              <Link
                href="/game/boss/battle"
                className="btn btn-gold inline-flex items-center gap-2 px-4 py-2 text-sm font-black"
              >
                <Icon name="attack" size={16} className="inline-block align-middle" />{" "}
                {t("הקרב רץ — צפה בו")}
                <BossCountdown endsAt={activeEndsAt.getTime()} serverNow={serverNow} compact />
              </Link>
            ) : (
              <BossAttackButton
                bossName={bossName}
                disabled={!canAttack}
                disabledReason={disabledReason}
                turnCost={turnCost}
                wounded={woundedPct >= 1 && !dead}
              />
            )}

            <Tip
              tip={t(
                "תקיפה עולה {cost} תורות ורצה כדקה. הצבא נלחם לבד {rounds} סבבים — תקבל הודעה עם השלל כשהקרב נגמר, גם אם עברת לדף אחר.",
                { cost: formatNumber(turnCost), rounds: roundsPerSortie }
              )}
            >
              <span className="nums inline-flex cursor-help items-center gap-1.5 rounded-full border border-border-subtle bg-panel-inset px-2.5 py-1 text-xs text-zinc-300">
                <Icon name="turns" size={13} className="text-emerald-400" />
                <b className={outOfTurns ? "text-red-400" : "text-gold-bright"} dir="ltr">
                  {formatNumber(turnCost)}
                </b>{" "}
                {t("תורות")}
              </span>
            </Tip>
            {!canAttack && !dead && !activeBattleId && (
              <span className="text-[11px] font-semibold text-red-400">{disabledReason}</span>
            )}
          </div>

          {/* ---------------- everything read once, folded away ---------------- */}
          <details className="group border-t border-border-subtle pt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-bold text-gold-dim transition-colors hover:text-gold-bright [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden
                className="inline-block transition-transform group-open:rotate-90 rtl:-scale-x-100"
              >
                ▸
              </span>
              {t("איך הקרב עובד, איך מתחלק האוצר, וסיפור הרקע")}
              {conquerors.length > 0 && <> · {t("מפילי {boss}", { boss: bossName })}</>}
            </summary>

            <div className="mt-3 space-y-3.5">
              {/* -------- how the fight goes, now that it fights itself -------- */}
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-dim">
                  <Icon name="attack" size={13} /> {t("איך הקרב עובד")}
                </p>
                <p className="nums text-xs leading-relaxed text-zinc-400">
                  {t(
                    "לוחצים תקיפה פעם אחת. הצבא יוצא ל־{rounds} סבבים לאורך כדקה, ובכל סבב הקצינים מנסים לקרוא את המהלך של {boss} ולענות עליו. קריאה נכונה מכפילה את הנזק",
                    { rounds: roundsPerSortie, boss: bossName }
                  )}
                  {BOSS_CASUALTIES && t(" ומבטלת כמעט את האבדות")}
                  {t("; קריאה שגויה עושה את ההפוך. הסיכוי לקרוא נכון תלוי")}{" "}
                  <b>{t("ברמת הגיבור שלך")}</b> —{" "}
                  {t("כרגע")}{" "}
                  <b className="nums text-gold-bright" dir="ltr">
                    {Math.round(readChance * 100)}%
                  </b>
                  .{" "}
                  {BOSS_CASUALTIES ? (
                    t("אבדות של {pct}% מבריחות את הצבא באמצע הקרב.", {
                      pct: Math.round(BOSS_ROUT_LOSS_FRACTION * 100),
                    })
                  ) : (
                    <b className="text-emerald-300">
                      {t("הקרב לא עולה לך אף חייל — הצבא חוזר שלם תמיד, והמחיר היחיד הוא התורות.")}
                    </b>
                  )}
                </p>
                <ul className="mt-2 space-y-1">
                  {(["SMASH", "SWEEP", "EXPOSED"] as const).map((move) => {
                    const meta = BOSS_MOVE_META[move];
                    const counter = BOSS_TACTIC_META[BOSS_MOVE_COUNTER[move]];
                    return (
                      <li
                        key={move}
                        className="flex flex-wrap items-center gap-x-2 rounded border border-border-subtle bg-panel-inset px-2 py-1 text-[11px]"
                      >
                        <span aria-hidden>{meta.icon}</span>
                        <b className={meta.tone}>{t(meta.label)}</b>
                        <span aria-hidden className="text-zinc-600">
                          ←
                        </span>
                        <span aria-hidden>{counter.icon}</span>
                        <b className="text-zinc-200">{t(counter.label)}</b>
                      </li>
                    );
                  })}
                </ul>
                <p className="nums mt-1.5 text-[11px] text-zinc-500">
                  {t("תקיפה אחת שלך מורידה בממוצע {damage} חיים —", {
                    damage: formatNumber(Math.round(expectedSortieDamage)),
                  })}{" "}
                  {!Number.isFinite(sortiesPerShare)
                    ? t("אמן צבא כדי להתחיל")
                    : sortiesPerShare === 1
                      ? t("תקיפה אחת מסיימת את המנה שלך")
                      : t("כ־{sorties} תקיפות למנה שלך", { sorties: sortiesPerShare })}
                  {Number.isFinite(sortiesToKill) &&
                    t(", וכ־{sorties} תקיפות להפיל אותו לבד", { sorties: sortiesToKill })}
                  {t(". כוח הבוס {bossPower} מול כוח התקיפה שלך {myPower}.", {
                    bossPower: formatNumber(power),
                    myPower: formatNumber(Math.round(myPower)),
                  })}
                </p>
              </div>

              {/* -------- the two levers, and where the player stands on each --------
                  "What do I do to win?" had no answer anywhere in the game. It
                  has exactly two, and they are not interchangeable: attack power
                  is how hard a round can hit, and the hero is how often it hits
                  that hard — the reads, and the fury they charge. (While the
                  assault drew blood the hero was also the whole casualty side;
                  with it bloodless, both levers now point at damage.) */}
              <div className="border-t border-border-subtle pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-dim">
                  <Icon name="spark" size={13} /> {t("איך מגדילים את הסיכויים")}
                </p>

                <div className="grid gap-2 sm:grid-cols-2">
                  {/* damage side */}
                  <div className="rounded-lg border border-border-subtle bg-panel-inset p-2.5">
                    <p className="text-[11px] font-bold text-emerald-300">
                      <Icon name="attack" size={12} className="inline-block align-middle" />{" "}
                      {t("כדי לפגוע בו יותר — כוח תקיפה")}
                    </p>
                    <p className="nums mt-1 text-[11px] leading-relaxed text-zinc-400">
                      {t("(חיילים")}{" "}
                      <b className="text-zinc-200" dir="ltr">
                        {formatNumber(armyPower)}
                      </b>{" "}
                      {t("+ נשקי תקיפה")}{" "}
                      <b className="text-zinc-200" dir="ltr">
                        {formatNumber(weaponPower)}
                      </b>
                      {t(") × גיבור")}{" "}
                      <b className="text-zinc-200" dir="ltr">
                        +{Math.round(heroBonusPct)}%
                      </b>{" "}
                      {t("× גילדה")}{" "}
                      <b className="text-zinc-200" dir="ltr">
                        +{Math.round(guildBonusPct)}%
                      </b>
                      {guildAidPower > 0 && (
                        <>
                          {" "}
                          {t("+ סיוע")}{" "}
                          <b className="text-zinc-200" dir="ltr">
                            {formatNumber(Math.round(guildAidPower))}
                          </b>
                        </>
                      )}{" "}
                      ={" "}
                      <b className="text-gold-bright" dir="ltr">
                        {formatNumber(Math.round(myPower))}
                      </b>
                    </p>
                    <p className="nums mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                      {t(
                        "הנזק בכל סבב הוא אחוז מהכוח הזה — כל 100 חיילים מוסיפים 1,000 כוח, ונשקי תקיפה מוסיפים כוח"
                      )}
                      {BOSS_CASUALTIES
                        ? t(" בלי לעלות בדם")
                        : t(" בלי לאמן אף חייל")}
                      {t(". שיקוי כוח, באפ גילדה וציוד גיבור נספרים גם הם.")}
                    </p>
                  </div>

                  {/* the reads — the hero's whole contribution to the fight */}
                  <div className="rounded-lg border border-border-subtle bg-panel-inset p-2.5">
                    <p className="text-[11px] font-bold text-sky-300">
                      <Icon name="hero" size={12} className="inline-block align-middle" />{" "}
                      {BOSS_CASUALTIES
                        ? t("כדי לספוג פחות — הגיבור")
                        : t("כדי לפגוע בכל סבב — הגיבור")}
                    </p>
                    <p className="nums mt-1 text-[11px] leading-relaxed text-zinc-400">
                      {BOSS_CASUALTIES
                        ? t("אבדות נקבעות רק לפי אם הקצינים קראו את המהלך נכון. גיבור רמה")
                        : t("כמה נזק ייצא מהסבב נקבע לפי אם הקצינים קראו את המהלך נכון. גיבור רמה")}{" "}
                      <b className="nums text-zinc-200" dir="ltr">
                        {heroLevel}
                      </b>{" "}
                      {t("קורא נכון")}{" "}
                      <b className="nums text-gold-bright" dir="ltr">
                        {Math.round(readChance * 100)}%
                      </b>{" "}
                      {t("מהמהלכים")}
                      {BOSS_CASUALTIES
                        ? t(", וסבב שנקרא נכון עולה כשליש מהדם של סבב שגוי — ומכפיל את הנזק.")
                        : t(", וסבב שנקרא נכון מכפיל את הנזק מול סבב שנקרא לא נכון.")}
                    </p>
                    {!heroAlive ? (
                      <p className="mt-1.5 rounded border border-red-500/40 bg-red-950/30 px-2 py-1 text-[11px] font-bold text-red-300">
                        {t("הגיבור שלך מת — הקצינים מנחשים ואין זעם")}
                        {BOSS_CASUALTIES && t(", והאבדות כמעט מוכפלות")}
                        {t(". החייה אותו לפני שתתקוף.")}
                      </p>
                    ) : (
                      <p className="nums mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                        {t(
                          "כל רמה מוסיפה לסיכוי הקריאה (עד {max}%) ומחזקת את מכת הזעם. גיבור מת מאבד את שניהם.",
                          { max: Math.round(BOSS_READ_CHANCE_MAX * 100) }
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* -------- how the hoard is split --------
                  The pile itself is printed above, unfolded, where it can pull
                  somebody into the fight; what is left here is the fine print
                  behind it — the grade bonus and what makes the pile grow —
                  which is read once and never again. */}
              <div className="border-t border-border-subtle pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-dim">
                  <Icon name="gift" size={13} /> {t("איך מתחלק האוצר")}
                </p>
                <p className="nums text-xs leading-relaxed text-zinc-400">
                  {t(
                    "העריץ משותף לכל העיר, אבל השלל אישי: מאגר החיים שלו הוא מנה לכל שחקן בדרגה, וכל מה שאתה מקבל נמדד מול המנה שלך בלבד — כך שאותה תקיפה שווה בדיוק אותו דבר בעיר מלאה ובעיר ריקה. {chip}% מהמנה משולמים לפי הנזק שאתה גורם, מיד בסוף כל תקיפה. את {kill}% הנותרים — אוצר ההפלה, שגדל עד ×{grade} לפי איכות המכה האחרונה — מחלקים ברגע שהוא נופל בין כל מי שפצע אותו, לפי הנזק. השלל גדל עם התקדמות העונה ועם מספר הערים שלך.",
                    {
                      chip: Math.round(BOSS_CHIP_SHARE * 100),
                      kill: Math.round(BOSS_KILL_SHARE * 100),
                      grade: BOSS_GRADE_BONUS.S,
                    }
                  )}
                </p>
              </div>

              {/* -------- who else is on it right now --------
                  The half of a shared fixture a private one never had: the boss
                  banner used to answer "how far along am I", and the only honest
                  answer now is "how far along are we, and who is carrying it".
                  Kept inside the disclosure with the rest of the reference
                  material — the bar above already says the fight is shared. */}
              {besiegers.length > 0 && (
                <div className="border-t border-border-subtle pt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-dim">
                    <Icon name="attack" size={13} /> {t("מי צר על {boss} עכשיו", { boss: bossName })}
                  </p>
                  <ul className="space-y-1">
                    {besiegers.map((b) => (
                      <li
                        key={b.empireId}
                        className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] ${
                          b.isMe
                            ? "border-gold/50 bg-gold/10"
                            : "border-border-subtle bg-panel-inset"
                        }`}
                      >
                        <Link
                          href={`/game/empires/${b.empireId}`}
                          className="min-w-0 truncate font-semibold text-zinc-200 transition-colors hover:text-gold-bright"
                        >
                          {b.empireName}
                          {b.isMe && (
                            <span className="mr-1.5 text-[10px] font-black text-gold">
                              {t("(אתה)")}
                            </span>
                          )}
                        </Link>
                        <span className="nums shrink-0 text-zinc-400" dir="ltr">
                          {formatNumber(Math.round(b.damage))}
                          <span className="text-zinc-600"> · {b.sorties}⚔</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="border-t border-border-subtle pt-3 text-xs leading-relaxed text-zinc-400">
                {t(boss.lore)}
              </p>

              {/* -------- honour roll -------- */}
              {conquerors.length > 0 && (
                <div className="border-t border-border-subtle pt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-dim">
                    <Icon name="rankings" size={13} />{" "}
                    {t("מפילי {boss}", { boss: bossName })}
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {conquerors.map((c) => (
                      <li key={c.empireId}>
                        <Link
                          href={`/game/empires/${c.empireId}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/5 px-2.5 py-1 text-xs text-zinc-200 transition-colors hover:border-gold/60 hover:text-gold-bright"
                        >
                          <Icon name="crown" size={13} className="text-gold" />
                          <span className="font-semibold">{c.empireName}</span>
                          <span className="nums text-[10px] text-gold-dim" dir="ltr">
                            ×{c.kills}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
