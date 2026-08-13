import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { Card, CardTitle } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { PlayerLink } from "@/components/ui/PlayerLink";
import {
  BUILDING_META,
  STORAGE_TYPES,
  storageCapacityForLevel,
  type StorableResource,
} from "@/lib/game/constants";
import { productionPerTick } from "@/lib/game/resources";
import { heroBonuses } from "@/lib/game/hero";
import { getActiveGuildBuffPct } from "@/lib/game/guildBuffs";
import { getGuildAidBonus } from "@/lib/game/guildAid";
import { GUILD_ROLE_META } from "@/lib/game/guild";
import { attackPowerBreakdown, defensePowerBreakdown } from "@/lib/game/power";
import { PowerSummary } from "@/components/game/PowerSummary";
import { WheelCard } from "@/components/game/WheelCard";
import { HallOfGlory } from "@/components/game/HallOfGlory";
import { getAchievementsState } from "@/server/achievementState";
import { getGloryChampions, stampGloryAwards } from "@/server/gloryBoard";
import { selectGlory } from "@/lib/game/achievements";
import { wheelClock } from "@/lib/game/wheel";
import { formatNumber, formatCompact, formatDate } from "@/lib/game/format";
import { getI18n, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("בסיס | KRALDOR") };
}

export default async function BasePage() {
  const empire = await requireEmpire();
  const { t, locale } = await getI18n();

  const [
    recentBattles,
    recentSpies,
    recentBankTransactions,
    season,
    guildAttackPct,
    guildDefensePct,
    guildAid,
    guildMembership,
  ] = await Promise.all([
      prisma.battleReport.findMany({
        where: {
          OR: [{ attackerEmpireId: empire.id }, { defenderEmpireId: empire.id }],
        },
        orderBy: { createdAt: "desc" },
        take: 3,
        include: { attackerEmpire: true, defenderEmpire: true },
      }),
      prisma.spyReport.findMany({
        where: { attackerEmpireId: empire.id },
        orderBy: { createdAt: "desc" },
        take: 3,
        include: { defenderEmpire: true },
      }),
      prisma.bankTransaction.findMany({
        where: { empireId: empire.id },
        orderBy: { createdAt: "desc" },
        take: 2,
      }),
      empire.seasonId
        ? prisma.gameSeason.findUnique({ where: { id: empire.seasonId } })
        : null,
      getActiveGuildBuffPct(empire.id, "ATTACK"),
      getActiveGuildBuffPct(empire.id, "DEFENSE"),
      getGuildAidBonus(empire.id),
      prisma.guildMember.findUnique({
        where: { empireId: empire.id },
        select: { role: true, guild: { select: { name: true } } },
      }),
    ]);

  // Real battle power for the attack/defense cards: same hero + guild
  // multipliers the fight itself applies, so the numbers match combat.
  const heroBonus = heroBonuses(empire.hero);
  const attackBreakdown = attackPowerBreakdown({
    army: empire.army,
    weapons: empire.weapons,
    heroAttackPct: heroBonus.totalPct.attack,
    guildAttackPct,
    guildAid,
  });
  const defenseBreakdown = defensePowerBreakdown({
    army: empire.army,
    weapons: empire.weapons,
    heroDefensePct: heroBonus.totalPct.defense,
    guildDefensePct,
    guildAid,
  });

  /* ---- production per regular update, grouped by resource ---- */
  const productionByResource = new Map<StorableResource, number>();
  for (const building of empire.buildings) {
    const produced = BUILDING_META[building.type].producedResource;
    if (!produced) continue;
    productionByResource.set(
      produced,
      (productionByResource.get(produced) ?? 0) + productionPerTick(building)
    );
  }

  const bankGold = Math.floor(empire.bankAccount?.goldBalance ?? 0);

  const totalStored = empire.storages.reduce((sum, s) => sum + s.storedAmount, 0);
  const totalCapacity = STORAGE_TYPES.reduce((sum, type) => {
    const level = empire.storages.find((s) => s.resourceType === type)?.level ?? 1;
    return sum + storageCapacityForLevel(level);
  }, 0);

  const hasActivity =
    recentBattles.length > 0 ||
    recentSpies.length > 0 ||
    recentBankTransactions.length > 0;

  /* ---- world records: automatic capstone decorations ----
     Nothing here is collected — a capstone lights up the moment the empire
     meets it, so loading this screen is also what *stamps* the arrival (see
     src/server/gloryBoard.ts). The stamp has to land before the records are
     read, or an empire that just qualified would not appear on its own board.

     None of it is expensive. `getAchievementsState` is React-cached and the
     game layout already calls it on every screen for the "rewards waiting"
     badge, so the conditions cost nothing extra here; the stamp is one indexed
     read that usually writes nothing; the records are a single DISTINCT ON that
     returns seven rows, read live so a record set seconds ago is already here.

     The strip that used to live in this slot was gated on
     `empire.level >= 5..10` — a column no gameplay path increments, so all five
     of its milestones were locked forever, for everyone. */
  const achievements = await getAchievementsState(empire.id);
  // Stamped before the records are read, so an empire that just qualified can
  // take the record on this very load.
  if (achievements) await stampGloryAwards(empire.id, achievements);
  const gloryRecords = await getGloryChampions();
  const glory = achievements
    ? selectGlory(achievements, gloryRecords, empire.id, locale)
    : [];

  const resourceTiles = [
    { icon: <Icon name="turns" size={14} className="text-emerald-400" />, label: t("תורות"), value: empire.turns, tone: "text-emerald-400" },
    { icon: <Icon name="iron" size={14} className="text-slate-300" />, label: t("ברזל"), value: empire.iron, tone: "text-zinc-200" },
    { icon: <Icon name="wood" size={14} className="text-amber-600" />, label: t("עץ"), value: empire.wood, tone: "text-amber-200/90" },
    { icon: <Icon name="gold" size={14} className="text-gold-bright" />, label: t("זהב"), value: empire.gold, tone: "text-gold-bright" },
    { icon: <Icon name="bank" size={14} className="text-gold" />, label: t("בבנק"), value: bankGold, tone: "text-gold" },
    { icon: <Icon name="diamond" size={14} className="text-cyan-300" />, label: t("יהלומים"), value: empire.diamonds, tone: "text-sky-300" },
    { icon: <Icon name="stone" size={14} className="text-stone-400" />, label: t("אבן"), value: empire.stone, tone: "text-zinc-200" },
    { icon: <Icon name="citizens" size={14} className="text-bone" />, label: t("אזרחים"), value: empire.citizens, tone: "text-zinc-200" },
  ];

  // Server component renders once per request, so reading the clock here is safe.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const daysOnServer = Math.max(
    1,
    Math.ceil((nowMs - new Date(empire.createdAt).getTime()) / 86_400_000)
  );
  // Wheel prizes grow with the season — the first update pays the base amounts
  // and the last one the published finals, spread evenly over every update between.
  const clock = wheelClock(season, nowMs);

  return (
    <div className="space-y-6">
      <SectionHeading title={t("מרכז הפיקוד")} ornament={<Icon name="base" size={22} className="text-crimson" />} />

      {/* World records lead the screen: they are the one thing here about the
          whole game rather than about this one empire. */}
      {glory.length > 0 && (
        <HallOfGlory items={glory} daysOnServer={daysOnServer} />
      )}

      {/* announcement + wheel */}
      {/* Both halves are the same short band — `auto` lets the wheel size to its
          own content instead of holding a fixed 220px column open. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto]">
        <div className="relative flex items-center overflow-hidden rounded-lg border border-border-subtle bg-gradient-to-l from-transparent to-gold/5 pr-4">
          <span className="absolute inset-y-0 right-0 w-1 bg-gold" />
          <div className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="flex items-center gap-2 text-sm">
              <span aria-hidden>📣</span>
              <span className="font-bold text-gold-bright">
                {season ? t("{season} התחילה!", { season: season.name }) : t("העונה פעילה")}
              </span>
              <span className="text-zinc-400">{t("— בהצלחה לכולם בעונה החדשה!")} <Icon name="attack" size={14} className="inline-block align-middle" /></span>
            </p>
            {season && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Icon name="turns" size={14} className="text-emerald-400" />
                {t("סיום עונה:")}
                <span className="font-bold text-gold nums" dir="ltr">
                  {formatDate(season.endsAt, locale)}
                </span>
              </p>
            )}
          </div>
        </div>
        <WheelCard spinsAvailable={empire.wheelSpins} clock={clock} />
      </div>

      {/* empire power */}
      <PowerSummary
        army={empire.army}
        weapons={empire.weapons}
        attackBreakdown={attackBreakdown}
        defenseBreakdown={defenseBreakdown}
      />

      {/* base details + resources */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle><Icon name="base" size={20} className="text-crimson-bright" />{t("פרטי בסיס")}</CardTitle>
          <dl className="space-y-3 text-sm">
            {/* "דירוג עולמי" used to sit here reading `empire.level` — a column
                gameplay never writes, so it printed 1 on every account. The real
                standing lives on /game/rankings; a fake one is worse than none. */}
            <div className="flex items-center justify-between border-b border-border-subtle pb-2">
              <dt className="text-zinc-400">{t("עונה")}</dt>
              <dd className="font-bold text-gold">{season?.name ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">{t("ברית")}</dt>
              {guildMembership ? (
                <dd className="flex items-center gap-1.5 font-bold text-gold">
                  <span>{guildMembership.guild.name}</span>
                  <span className="text-xs font-normal text-zinc-400">
                    {GUILD_ROLE_META[guildMembership.role].icon}{" "}
                    {t(GUILD_ROLE_META[guildMembership.role].label)}
                  </span>
                </dd>
              ) : (
                <dd className="font-bold text-red-400">{t("ללא")}</dd>
              )}
            </div>
          </dl>
          <Link href="/game/guild" className="btn btn-ghost mt-4 w-full py-2 text-sm">
            <Icon name="guild" size={16} className="inline-block align-middle" />{" "}
            {guildMembership ? t("לעמוד הברית") : t("הצטרף לברית")}
          </Link>
        </Card>

        <Card variant="gold">
          <div className="mb-4 flex items-center justify-between">
            <CardTitle className="mb-0"><Icon name="gold" size={20} className="text-crimson-bright" />{t("משאבים")}</CardTitle>
            <span className="text-xs text-zinc-400">
              {t("מאוחסן:")}{" "}
              <span className="font-bold text-zinc-200 nums" dir="ltr">
                {formatCompact(totalStored)}/{formatCompact(totalCapacity)}
              </span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {resourceTiles.map((tile) => (
              <div key={tile.label} className="panel-inset rounded-lg px-3 py-2.5 text-center">
                <p className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
                  <span aria-hidden>{tile.icon}</span>
                  {tile.label}
                </p>
                <p className={`mt-0.5 text-sm font-black nums ${tile.tone}`} dir="ltr">
                  {formatCompact(tile.value)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* recent activity */}
      <Card>
        <CardTitle><Icon name="reports" size={20} className="text-crimson-bright" />{t("פעילות אחרונה")}</CardTitle>
        {!hasActivity ? (
          <p className="text-sm text-zinc-400">
            {t("אין דיווחים עדיין. היכנס לפרופיל אימפריה מעמוד הדירוג כדי לרגל או לתקוף.")}
          </p>
        ) : (
          <ul className="space-y-2.5 text-sm">
            {recentBattles.map((r) => {
              const isAttacker = r.attackerEmpireId === empire.id;
              const won = r.winnerEmpireId === empire.id;
              const rival = isAttacker ? r.defenderEmpire.name : r.attackerEmpire.name;
              const rivalId = isAttacker ? r.defenderEmpireId : r.attackerEmpireId;
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2 last:border-0">
                  <span className="text-zinc-300">
                    {isAttacker ? (
                      <><Icon name="attack" size={16} className="inline-block align-middle" /> {t("תקפת את")}</>
                    ) : (
                      <><Icon name="shield" size={16} className="inline-block align-middle" /> {t("הותקפת על ידי")}</>
                    )}{" "}
                    <PlayerLink empireId={rivalId} name={rival} className="font-semibold" /> —{" "}
                    <span className={won ? "text-emerald-400" : "text-red-400"}>
                      {won ? t("ניצחון") : t("הפסד")}
                    </span>
                  </span>
                  <span className="text-xs text-zinc-500">{formatDate(r.createdAt, locale)}</span>
                </li>
              );
            })}
            {recentSpies.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2 last:border-0">
                <span className="text-zinc-300">
                  <Icon name="spy" size={16} className="inline-block align-middle" /> {t("ריגלת אחרי")}{" "}
                  <PlayerLink
                    empireId={r.defenderEmpireId}
                    name={r.defenderEmpire.name}
                    className="font-semibold"
                  />{" "}
                  —{" "}
                  <span className={r.success ? "text-emerald-400" : "text-red-400"}>
                    {r.success ? t("הצלחה") : t("כישלון")}
                  </span>
                </span>
                <span className="text-xs text-zinc-500">{formatDate(r.createdAt, locale)}</span>
              </li>
            ))}
            {recentBankTransactions.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2 last:border-0">
                <span className="text-zinc-300">
                  <Icon name="bank" size={16} className="inline-block align-middle" />{" "}
                  {tx.type === "DEPOSIT"
                    ? t("הפקדה לבנק")
                    : tx.type === "WITHDRAW"
                      ? t("משיכה מהבנק")
                      : t("ריבית מהבנק")}{" "}
                  —{" "}
                  <span className="font-semibold nums" dir="ltr">
                    {tx.type === "WITHDRAW" ? "-" : "+"}
                    {formatNumber(tx.amount)}
                  </span>
                </span>
                <span className="text-xs text-zinc-500">{formatDate(tx.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/game/reports" className="btn btn-ghost mt-4 w-full py-2 text-sm">
          {t("לכל הדוחות ←")}
        </Link>
      </Card>
    </div>
  );
}
