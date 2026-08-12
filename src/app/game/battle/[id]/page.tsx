import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { formatNumber, formatDate } from "@/lib/game/format";
import { ItemTile } from "@/components/game/ItemTile";
import { AttackAgainButton } from "@/components/game/AttackAgainButton";
import { Tip } from "@/components/ui/Tip";
import { itemDetails, uiRarityForLevel } from "@/components/game/heroItemView";
import { SLOT_META, itemDisplayName } from "@/lib/game/hero";
import { PotionBottle } from "@/components/game/PotionBottle";
import { POTION_META, potionDurationLabel } from "@/lib/game/potions";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PlayerLink } from "@/components/ui/PlayerLink";
import {
  battlePowerLedger,
  type BattlePowerSources,
  type LedgerRow,
} from "@/lib/game/battleLedger";
import { sharedGuild } from "@/lib/game/guildAllies";
import { ShieldGlyph } from "@/components/game/ShieldBadges";
import { shieldMeta } from "@/lib/game/diamondShop";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("תוצאת קרב | KRALDOR") };
}

const RES = [
  { key: "stolenGold", icon: <Icon name="gold" size={14} className="inline-block align-middle text-gold-bright" />, label: "זהב" },
  { key: "stolenWood", icon: <Icon name="wood" size={14} className="inline-block align-middle text-amber-600" />, label: "עץ" },
  { key: "stolenIron", icon: <Icon name="iron" size={14} className="inline-block align-middle text-slate-300" />, label: "ברזל" },
  { key: "stolenStone", icon: <Icon name="stone" size={14} className="inline-block align-middle text-stone-400" />, label: "אבן" },
] as const;

/** Explains the number in the banner's XP badge. */
const HERO_XP_TIP =
  "ניסיון לגיבור מהקרב הזה. רק תקיפה מנצחת מזכה בניסיון — הדפת התקפה לא, הפרס עליה הוא שלא נלקח ממך דבר. הכמות תלויה בפער הרמות (כל איפוס של היריב נחשב 100 רמות, ולכן גם יריב ברמה 1 אחרי איפוס משלם יפה) ובעד כמה הקרב היה צמוד: מחיקת יריב חלש ונמוך ממך מזכה במעט, ניצחון מול יריב שווה או גבוה ממך מזכה בהרבה. כשמצטבר מספיק — הגיבור עולה רמה ומקבל נקודת גיבור ו-25 אזרחים לאימפריה.";

/**
 * One fact from the aftermath — icon, label, number — sized to sit inline with
 * its siblings in a single strip rather than owning a panel.
 */
function StatChip({
  icon,
  label,
  value,
  tone,
  tip,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone: string;
  tip?: string;
}) {
  const body = (
    <span className={`inline-flex items-center gap-1.5 text-sm ${tip ? "cursor-help" : ""}`}>
      <Icon name={icon} size={15} className={tone} />
      <span className="text-xs text-zinc-400">{label}</span>
      <span className={`nums font-black ${tone}`} dir="ltr">
        {value}
      </span>
    </span>
  );
  return tip ? <Tip tip={tip}>{body}</Tip> : body;
}

export default async function BattleResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  const me = await requireEmpire();

  const report = await prisma.battleReport.findUnique({
    where: { id },
    include: { attackerEmpire: true, defenderEmpire: true },
  });
  if (!report) notFound();

  const iAmAttacker = report.attackerEmpireId === me.id;
  const iAmDefender = report.defenderEmpireId === me.id;
  if (!iAmAttacker && !iAmDefender) notFound();

  const iWon = report.winnerEmpireId === me.id;
  const myName = iAmAttacker ? report.attackerEmpire.name : report.defenderEmpire.name;
  const foe = iAmAttacker ? report.defenderEmpire : report.attackerEmpire;

  // My/foe totals + share of the power bar.
  const myPower = iAmAttacker ? report.attackerPower : report.defenderPower;
  const foePower = iAmAttacker ? report.defenderPower : report.attackerPower;
  const total = myPower + foePower;
  const myShare = total > 0 ? (myPower / total) * 100 : 50;

  const mySoldiersLost = iAmAttacker ? report.attackerSoldiersLost : report.defenderSoldiersLost;
  const foeSoldiersLost = iAmAttacker ? report.defenderSoldiersLost : report.attackerSoldiersLost;
  // Player battles no longer kill soldiers, but reports written before that
  // change still carry casualties — show the panels only when there were any.
  const hadCasualties = mySoldiersLost > 0 || foeSoldiersLost > 0;

  // A report outlives the feud: if the two of you have joined the same guild
  // since, the rematch button is gone (see lib/game/guildAllies.ts).
  const allied = await sharedGuild(me.id, foe.id);

  // Plunder: attacker gains it on a win, defender loses it.
  const plunderTotal = report.stolenGold + report.stolenWood + report.stolenIron + report.stolenStone;

  // A won raid that came home empty: the defender's diamond shields held. Shown
  // to both sides — the attacker learns why there was no haul, the defender
  // sees what the purchase actually saved.
  const shieldsHeld = [
    ...(report.defenderResourceShielded ? (["resources"] as const) : []),
    ...(report.defenderSoldierShielded ? (["soldiers"] as const) : []),
  ];

  /**
   * Turn one ledger row into the line the reader sees. The arithmetic lives in
   * lib/game/battleLedger.ts; this is only the wording.
   */
  const describe = (row: LedgerRow) => {
    const pct = Math.round(row.pct ?? 0);
    switch (row.kind) {
      case "soldiers":
        return {
          label: t("כוח חיילים"),
          value: formatNumber(row.value),
          tip: t("כוח הלחימה של החיילים בלבד (10 כוח לחייל)."),
        };
      case "weapons":
        return {
          label: t("כוח נשקים"),
          value: formatNumber(row.value),
          tip: t("תוספת הכוח מהנשקים במחסן — נשקי התקפה לתוקף, נשקי הגנה למגן. נשק מהקטגוריה הלא־נכונה לא משתתף בקרב הזה."),
        };
      case "subtotal":
        return {
          label: t("סך כוח בסיס"),
          value: formatNumber(row.value),
          tip: t("חיילים + נשקים. כל הבונוסים שמתחת מוכפלים על הסכום הזה, בזה אחר זה."),
          strong: true,
        };
      case "defense":
        return {
          label: t("יתרון המגן +{pct}%", { pct }),
          value: `+${formatNumber(row.value)}`,
          tip: t("הצד המתגונן נלחם בשטח שלו ומקבל תוספת קבועה של {pct}% על כוח הבסיס — לפני הגיבור ולפני קסמי הברית. התוקף לא מקבל אותה.", { pct }),
        };
      case "hero":
        return {
          label: t("בונוס גיבור +{pct}%", { pct }),
          value: `+${formatNumber(row.value)}`,
          tip: t("הגיבור מגדיל את כל כוח הצד שלו: נקודות התקפה/הגנה שהוקצו + אחוזי החפצים הלבושים (כל נקודה ואחוז = 1%). גיבור מת תורם 0%."),
        };
      case "guildSpell":
        return {
          label: t("קסם ברית +{pct}%", { pct }),
          value: `+${formatNumber(row.value)}`,
          tip: t("קסם ברית פעיל שהוטל מראש — קסם התקפה לתוקף, קסם הגנה למגן. פועל 24 שעות מרגע ההטלה."),
        };
      case "guildAid":
        return {
          label: t("עזרת ברית"),
          value: `+${formatNumber(row.value)}`,
          tip: t("עזרה פסיבית: הברית מחזקת כל חבר בקרב ב־{pct}% מהכוח הצבאי המשולב של כל חבריה. זו תוספת שטוחה שנוספת בסוף, אחרי כל הכפולות — ולכן היא גדלה עם הברית, לא עם הצבא שלך.", { pct }),
        };
      case "residual":
        return {
          label: t("לא פורט בדוח זה"),
          value: `${row.value > 0 ? "+" : ""}${formatNumber(row.value)}`,
          tip: t("הקרב הזה נרשם לפני שהדוח התחיל לתעד את כל מרכיבי הכוח (יתרון המגן ועזרת הברית). ההפרש מוצג כדי שהסכום יישאר נכון."),
        };
    }
  };

  const ledger = (side: BattlePowerSources) =>
    battlePowerLedger(side).map(describe);

  const attackerLedgerInput: BattlePowerSources = {
    soldiers: report.attackerSoldiersPower,
    weapons: report.attackerWeaponsPower,
    heroBonusPct: report.attackerHeroBonusPct,
    guildBonusPct: report.attackerGuildBonusPct,
    guildAidPct: report.attackerGuildAidPct,
    guildAidPower: report.attackerGuildAidPower,
    // The attacker never gets it — the null is the statement, not a gap.
    defenseBonusPct: null,
    total: report.attackerPower,
  };
  const defenderLedgerInput: BattlePowerSources = {
    soldiers: report.defenderSoldiersPower,
    weapons: report.defenderWeaponsPower,
    heroBonusPct: report.defenderHeroBonusPct,
    guildBonusPct: report.defenderGuildBonusPct,
    guildAidPct: report.defenderGuildAidPct,
    guildAidPower: report.defenderGuildAidPower,
    defenseBonusPct: report.defenseBonusPct,
    total: report.defenderPower,
  };

  const mySide = ledger(iAmAttacker ? attackerLedgerInput : defenderLedgerInput);
  const foeSide = ledger(iAmAttacker ? defenderLedgerInput : attackerLedgerInput);

  // Hero rewards from this battle, viewer-perspective. Only a winning attack
  // pays XP now, so the defender's side is 0 on every new report — it is still
  // read rather than hardcoded, so reports written when defending did pay keep
  // showing what was actually earned.
  const myHeroXp = iAmAttacker ? report.attackerHeroXp : report.defenderHeroXp;
  const capturedItem =
    iAmAttacker && report.droppedItemSlot && report.droppedItemLevel && report.droppedItemRarity
      ? {
          slot: report.droppedItemSlot,
          level: report.droppedItemLevel,
          rarity: report.droppedItemRarity,
        }
      : null;
  // A winning attack can also award a wheel-of-fortune spin (wheel-luck upgrade).
  const wonWheelSpin = iAmAttacker && report.wonWheelSpin;
  // …and a potion, which goes straight to the belt under the bag.
  const capturedPotion = iAmAttacker ? report.droppedPotionKind : null;

  return (
    <div className="space-y-6">
      {/* -------- actions (kept on top, ready for the next strike) -------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {allied ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold-bright">
              <Icon name="guild" size={14} />
              {t("אתם בברית {guild} מאז הקרב הזה — אין תקיפות בין חברי ברית.", { guild: allied.name })}
            </p>
          ) : (
            <AttackAgainButton
              targetEmpireId={foe.id}
              currentTurns={me.turns}
              label={iAmAttacker ? t("⚔️ תקוף שוב") : t("⚔️ נקום")}
            />
          )}
          <Link href={`/game/empires/${foe.id}`} className="btn btn-ghost px-5 py-2 text-sm">
            <Icon name="crown" size={16} className="inline-block align-middle" /> {t("לפרופיל היריב")}
          </Link>
          <Link href="/game/base" className="btn btn-ghost px-5 py-2 text-sm"><Icon name="base" size={16} className="inline-block align-middle" /> {t("חזרה לבסיס")}</Link>
          <Link href="/game/reports" className="btn btn-ghost px-5 py-2 text-sm"><Icon name="reports" size={16} className="inline-block align-middle" /> {t("היסטוריה")}</Link>
        </div>
        <p className="text-xs text-zinc-500 nums" dir="ltr">{formatDate(report.createdAt, locale)}</p>
      </div>

      {/* -------- VS banner -------- */}
      <div className="relative overflow-hidden rounded-xl border border-border-gold/40 bg-gradient-to-b from-[#1a1210] to-[#0c0908] p-4 sm:p-6">
        {/* The banner clips its overflow, so the two name columns have to be
            allowed to shrink (min-w-0) and wrap: a phone leaves them ~90px
            each, and an empire name is routinely wider than that. */}
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* my side */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-emerald-500/50 bg-gradient-to-b from-emerald-900/30 to-black text-4xl shadow-[0_0_30px_-8px_rgba(52,211,153,0.5)]">
              <Icon name="hero" size={36} className="text-emerald-300" />
            </div>
            <p className="w-full break-words font-black text-emerald-300">{myName}</p>
            <p className="text-[11px] text-zinc-500">{iAmAttacker ? t("תוקף") : t("מתגונן")}</p>
          </div>

          {/* verdict */}
          <div className="flex shrink-0 flex-col items-center">
            <p
              className={`text-3xl font-black sm:text-4xl ${
                iWon ? "text-emerald-400" : "text-red-500"
              }`}
              style={{ textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}
            >
              {iWon ? t("ניצחון") : t("תבוסה")}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{t("מול")}</p>
          </div>

          {/* foe side */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-red-500/50 bg-gradient-to-b from-red-950/40 to-black text-4xl shadow-[0_0_30px_-8px_rgba(239,68,68,0.5)]">
              <Icon name="crown" size={36} className="text-red-300" />
            </div>
            <p className="w-full break-words font-black text-red-300">
              <PlayerLink empireId={foe.id} name={foe.name} />
            </p>
            <p className="text-[11px] text-zinc-500">{iAmAttacker ? t("מתגונן") : t("תוקף")}</p>
          </div>
        </div>

        {/* power bar */}
        <div className="mt-6">
          <div className="flex h-3 overflow-hidden rounded-full border border-black/60">
            <span style={{ width: `${myShare}%` }} className="bg-gradient-to-l from-emerald-400 to-emerald-600" />
            <span style={{ width: `${100 - myShare}%` }} className="bg-gradient-to-r from-red-500 to-red-700" />
          </div>
          <div className="mt-1.5 flex justify-between text-xs">
            <span className="nums font-bold text-emerald-300" dir="ltr">{formatNumber(myPower)}</span>
            <span className="text-zinc-500">{t("כוח קרב")}</span>
            <span className="nums font-bold text-red-300" dir="ltr">{formatNumber(foePower)}</span>
          </div>
        </div>

        {/* The XP rides inside the banner rather than down in the aftermath
            strip: it is what the player came to see after a win, and on a phone
            the plunder panel alone pushed the strip off the first screen. */}
        {myHeroXp > 0 && (
          <div className="mt-4 flex justify-center">
            <Tip tip={t(HERO_XP_TIP)}>
              <span className="inline-flex cursor-help items-center gap-2 rounded-full border border-purple-400/40 bg-purple-500/10 px-4 py-1.5 shadow-[0_0_24px_-10px_rgba(192,132,252,0.9)]">
                <Icon name="spark" size={16} className="text-purple-300" />
                <span className="nums text-base font-black text-purple-200" dir="ltr">
                  +{formatNumber(myHeroXp)}
                </span>
                <span className="text-xs font-bold text-purple-300/90">{t("ניסיון לגיבור")}</span>
              </span>
            </Tip>
          </div>
        )}
      </div>

      {/* -------- the haul, straight under the verdict --------
          This is the reason the raid was sent. It used to close the page, below
          two power ledgers, so on a phone the number the player actually came
          for was three screens down; everything else here is explanation. */}
      {shieldsHeld.length > 0 && (
        <div className="panel-inset rounded-xl border-emerald-500/40 p-4">
          <div className="flex flex-wrap items-center justify-center gap-2 text-center text-sm">
            {shieldsHeld.map((key) => (
              <ShieldGlyph key={key} shieldKey={key} size={14} />
            ))}
            <span className="font-bold text-emerald-300">
              {iAmAttacker ? t("היעד היה מוגן") : t("המגן שלך עמד")}
            </span>
            <span className="text-zinc-400">
              {shieldsHeld.map((key) => t(shieldMeta(key).label)).join(t(" ו"))} {t("חסמו")}{" "}
              {shieldsHeld
                .map((key) => (key === "resources" ? t("את הביזה") : t("את השעבוד")))
                .join(t(" ו"))}
              {iAmAttacker ? t(" — הקרב נוצח, אך לא נלקח דבר.") : t(" — לא נלקח ממך דבר.")}
            </span>
          </div>
        </div>
      )}

      {plunderTotal > 0 && (
        <div className="panel-gold rounded-xl p-4">
          <h3 className="mb-3 text-sm font-bold text-gold-bright">
            {iAmAttacker ? (
              <><Icon name="gold" size={16} className="inline-block align-middle text-gold-bright" /> {t("שלל הביזה")}</>
            ) : (
              t("💸 נבזז ממך")
            )}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RES.map((r) => (
              <div key={r.key} className="panel-inset rounded-lg p-3 text-center">
                <p className="text-[11px] text-zinc-400">{r.icon} {t(r.label)}</p>
                <p className={`nums mt-0.5 font-black ${iAmAttacker ? "text-emerald-400" : "text-red-400"}`} dir="ltr">
                  {iAmAttacker ? "+" : "−"}{formatNumber(report[r.key])}
                </p>
              </div>
            ))}
          </div>
          {/* Why the haul was bigger than the usual tenth. Shown to both sides:
              the attacker learns what the meter bought him, and the defender
              learns why this raid hurt more than the last one — a number that
              changes the loot and is never explained is read as a bug. */}
          {report.attackerFervorPct != null && (
            <p className="mt-3 text-center text-[11px] text-orange-300/90">
              <Icon name="spark" size={13} className="inline-block align-middle" />{" "}
              {iAmAttacker
                ? t("להט הקרב הגדיל את הביזה ב-{pct}%", {
                    pct: report.attackerFervorPct,
                  })
                : t("התוקף היה בלהט קרב — הביזה גדלה ב-{pct}%", {
                    pct: report.attackerFervorPct,
                  })}
            </p>
          )}
        </div>
      )}

      {/* -------- aftermath: turns and casualties on one line --------
          These are one-number facts. Given a panel each they ate a full screen
          of height above the report that actually matters, so they ride in a
          single strip; the explanations moved into their tooltips. */}
      <div className="panel flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-xl px-4 py-2.5">
        <StatChip icon="turns" label={t("תורות")} value={formatNumber(report.turnsSpent)} tone="text-gold" />
        {hadCasualties ? (
          <>
            <StatChip icon="army" label={t("אבדות שלך")} value={`−${formatNumber(mySoldiersLost)}`} tone="text-red-400" />
            <StatChip icon="army" label={t("אבדות היריב")} value={`−${formatNumber(foeSoldiersLost)}`} tone="text-emerald-400" />
          </>
        ) : (
          <StatChip
            icon="army"
            label={t("אבדות")}
            value={t("אין")}
            tone="text-zinc-400"
            tip={t("קרבות אינם גורמים לאבדות בחיילים — לא מול שחקנים ולא מול בוס עיר. חייל שמשועבד לא נהרג: הוא עובר לעבדי המכרות של התוקף.")}
          />
        )}
        {report.enslavedSoldiers > 0 && (
          <StatChip
            icon="mine"
            label={t("שועבדו למכרות")}
            value={`${iAmAttacker ? "+" : "−"}${formatNumber(report.enslavedSoldiers)}`}
            tone={iAmAttacker ? "text-emerald-400" : "text-red-400"}
            tip={t("ניצחון על מגן עם 20+ חיילים משעבד חלק מהם — ככל שצבאו גדול יותר, כך נשבים יותר. המשועבדים מצטרפים לעבדי המכרות הפנויים של התוקף (לא לאזרחים).")}
          />
        )}
        {wonWheelSpin && (
          <Link
            href="/game/base"
            className="inline-flex items-center gap-1.5 text-sm font-black text-gold-bright transition hover:text-gold"
          >
            {t("🎡 זכית בסיבוב גלגל מזל!")}
          </Link>
        )}
      </div>

      {/* -------- what the battle dropped (only when something did) -------- */}
      {(capturedItem || capturedPotion) && (
        <div className="panel rounded-xl p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright"><Icon name="gift" size={18} className="text-crimson-bright" /> {t("נלכד בקרב")}</h3>
          <div className="flex flex-wrap items-center gap-4">
            {capturedPotion && (
              <div className="flex items-center gap-3">
                <div className="w-16">
                  <PotionBottle kind={capturedPotion} className="w-full" />
                </div>
                <div>
                  <p
                    className={`text-sm font-black ${POTION_META[capturedPotion].tone}`}
                  >
                    <Icon name="potion" size={16} className="inline-block align-middle" />{" "}
                    {t("נלכד שיקוי: {potion}", { potion: t(POTION_META[capturedPotion].label) })}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {POTION_META[capturedPotion].tagline} ·{" "}
                    {potionDurationLabel(t, capturedPotion)} · {t("נוסף לתרמיל")}
                  </p>
                  <Link href="/game/hero" className="btn btn-ghost mt-2 px-3 py-1 text-xs">
                    <Icon name="potion" size={14} className="inline-block align-middle" /> {t("לשיקויים")}
                  </Link>
                </div>
              </div>
            )}
            {capturedItem && (
              <div className="flex items-center gap-3">
                <div className="w-20">
                  <ItemTile
                    slug={SLOT_META[capturedItem.slot].slug}
                    icon={SLOT_META[capturedItem.slot].icon}
                    level={capturedItem.level}
                    rarity={uiRarityForLevel(capturedItem.level)}
                    details={itemDetails(t, capturedItem, me.hero?.level ?? 1)}
                  />
                </div>
                <div>
                  <p className="text-sm font-black text-gold-bright">
                    <Icon name="gift" size={16} className="inline-block align-middle" /> {t("נלכד חפץ: {item}", { item: itemDisplayName(t, capturedItem.slot, capturedItem.level) })}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {t("רמת פריט")}{" "}
                    <span className="nums" dir="ltr">
                      {capturedItem.level}
                    </span>{" "}
                    · {t("נוסף לתיק הגיבור")}
                  </p>
                  <Link href="/game/hero" className="btn btn-ghost mt-2 px-3 py-1 text-xs">
                    <Icon name="attack" size={14} className="inline-block align-middle" /> {t("לציוד הגיבור")}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* -------- power breakdowns (details, below the critical stats) -------- */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-bright">
          <Icon name="attack" size={18} className="text-crimson-bright" />
          {t("מאיזה כוח הורכב הקרב")}
        </h3>
        {/* Both columns, itemised — the attacker's attack and the defender's
            defence, each term with the power it actually added. Reading them
            side by side is the point: the verdict was `attackerPower >
            defenderPower` and nothing else, so the row where the two columns
            diverge is the row that decided the battle. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              title: myName,
              role: iAmAttacker ? t("כוח ההתקפה שלך") : t("כוח ההגנה שלך"),
              tone: "emerald",
              rows: mySide,
              total: myPower,
            },
            {
              title: foe.name,
              role: iAmAttacker ? t("כוח ההגנה של היריב") : t("כוח ההתקפה של היריב"),
              tone: "red",
              rows: foeSide,
              total: foePower,
            },
          ].map((side) => (
            <div key={side.title} className="panel rounded-xl p-4">
              <div className="mb-3 border-b border-border-subtle pb-2">
                <h4
                  className={`text-sm font-bold ${
                    side.tone === "emerald" ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {side.title}
                </h4>
                <p className="mt-0.5 text-[11px] text-zinc-500">{side.role}</p>
              </div>
              <dl className="space-y-2 text-sm">
                {side.rows.map((r) => (
                  <div
                    key={r.label}
                    className={`flex items-center justify-between gap-2 ${
                      r.strong ? "border-t border-border-subtle/60 pt-2" : ""
                    }`}
                  >
                    <Tip tip={r.tip}>
                      <dt
                        className={`cursor-help ${
                          r.strong ? "font-semibold text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        {r.label}
                      </dt>
                    </Tip>
                    <dd
                      className={`nums shrink-0 font-semibold ${
                        r.strong ? "text-zinc-100" : "text-zinc-200"
                      }`}
                      dir="ltr"
                    >
                      {r.value}
                    </dd>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border-subtle pt-2">
                  <dt className="font-bold text-zinc-300">{t("סה״כ כוח בקרב")}</dt>
                  <dd className="nums font-black text-gold-bright" dir="ltr">
                    {formatNumber(side.total)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          {t("הקרב הוכרע בהשוואה ישירה בין שני הסכומים — התוקף מנצח רק אם כוחו גדול ממש מכוח המגן. שוויון נחשב הדיפה.")}

        </p>
      </div>

    </div>
  );
}
