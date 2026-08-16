import type { CSSProperties } from "react";
import Link from "next/link";
import { getTunables } from "@/lib/game/config";
import {
  BANK_DAILY_INTEREST_MAX_LEVEL,
  BANK_INTEREST_COST_GROWTH,
  BANK_INTEREST_MAX_RATE,
  BANK_INTEREST_PER_LEVEL,
  BANK_DEPOSIT_MAX,
  CITIZEN_GROWTH_LEVELS_PER_CITY,
  DAILY_UPDATE_TIMES,
  EMPIRE_UPGRADE_META,
  EMPIRE_UPGRADE_TYPES,
  INTELLIGENCE_MAX_LEVEL,
  MAX_CITIES,
  MINE_MAX_LEVEL,
  MINE_UPGRADE_COST_GROWTH,
  NEWBIE_PROTECTION_MS,
  REGULAR_TICK_MINUTES,
  RESOURCE_META,
  SOLDIER_POWER,
  SPY_POWER,
  STORAGE_CAPACITY_PER_LEVEL,
  STORAGE_GROWTH,
  TICKS_PER_DAY,
  TURNS_UPGRADE_COST_GROWTH,
  TURNS_UPGRADE_MAX_LEVEL,
  UNIT_META,
  WHEEL_LUCK_COST_GROWTH,
  WHEEL_LUCK_MAX_LEVEL,
  bankInterestUpgradeCost,
  cityCost,
  cityHeroLevelRequired,
  citizensPerDailyUpdate,
  empireUpgradeCostFor,
  empireUpgradeMaxLevel,
  mineUpgradeCost,
  storageCapacityForLevel,
  storageUpgradeCost,
  turnsUpgradeCost,
  wheelLuckBonus,
  wheelLuckUpgradeCost,
  type ActiveEmpireUpgradeType,
} from "@/lib/game/constants";
import { cityAt } from "@/lib/game/cities";
import { formatNumber, formatShort } from "@/lib/game/format";
import { formatWaitDuration } from "@/lib/game/time";
import {
  INITIAL_WEAPON_UNLOCKED_TIER,
  TIERS_PER_CATEGORY,
  WEAPON_CATEGORY_META,
  WEAPON_COST_GROWTH,
  WEAPON_GATE_EVERY,
  WEAPON_POWER_GROWTH,
  weaponTierGate,
  weaponTierUnlockCost,
  weaponsOfCategory,
} from "@/lib/game/weapons";
import {
  flatCurveGrowth,
  HERO_BAG_CAPACITY,
  HERO_CLASS_META,
  HERO_CLASS_ORDER,
  HERO_DAMAGE_PER_LOST_DEFENSE,
  HERO_MAX_HEALTH,
  HERO_MAX_LEVEL,
  HERO_RESET_CITIZENS,
  HERO_RESET_POINTS,
  HERO_RESET_TURNS,
  heroPointPool,
  HERO_REVIVE_HOURS,
  ITEM_DROP_CHANCE,
  ITEM_DROP_CHANCE_BY_RARITY,
  MAX_LEVEL_GAP_XP_FACTOR,
  MIN_LEVEL_GAP_XP_FACTOR,
  MAX_WINS_PER_LEVEL,
  MIN_RESET_GAP_XP_FACTOR,
  RESET_LEVEL_EQUIV,
  RARITY_META,
  RARITY_ORDER,
  SLOT_META,
  SLOT_ORDER,
  CITIZENS_PER_LEVEL,
  UPGRADE_COST_AT_LEVEL_10,
  UPGRADE_COST_AT_LEVEL_100,
  UPGRADE_COST_GROWTH,
  flatStatPerDay,
  heroClassBonusLines,
  heroClassImage,
  itemPrimaryBonus,
  itemBonusLines,
  itemStatBonus,
  xpToNextLevel,
} from "@/lib/game/hero";
import { HERO_ITEM_SETS, heroItemArtPath } from "@/lib/game/heroSets";
import {
  FERVOR_CAP,
  FERVOR_DECAY_MS,
  FERVOR_MAX_HOT_ATTACKS,
  FERVOR_TIERS,
} from "@/lib/game/fervor";
import {
  POTION_DROP_CHANCE,
  POTION_KINDS,
  POTION_META,
  potionDurationLabel,
  type PotionShape,
} from "@/lib/game/potions";
import {
  HERO_QUESTS,
  HERO_QUEST_FORTUNES,
  HERO_QUEST_PEOPLE_CITY_MULTIPLIER,
  HERO_QUEST_REWARD_CITY_MULTIPLIER,
  HERO_QUEST_TURNS_PER_CITY,
  HERO_QUEST_TURNS_PER_HOUR_BASE,
  HERO_QUEST_TURNS_PER_HOUR_DROP,
  heroQuestCityCostFactor,
  heroQuestDurationLabel,
  heroQuestTurnCost,
  heroQuestXp,
} from "@/lib/game/heroQuests";
import {
  BOSS_BASE_POWER,
  BOSS_HERO_XP_BASE,
  BOSS_HERO_XP_PER_TIER,
  BOSS_ITEM_RARITY_FLOOR,
  BOSS_POWER_TIER_MULTIPLIER,
  BOSS_TURN_COST_BASE,
  CITY_BOSSES,
  bossPower,
  bossReviveMs,
} from "@/lib/game/bosses";
import {
  BOSS_ASSAULT_DURATION_MS,
  BOSS_CHIP_SHARE,
  BOSS_GRADE_BONUS,
  BOSS_GRADE_MIN_DECISIONS,
  BOSS_HP_PER_POWER,
  BOSS_KILL_SHARE,
  BOSS_MOVE_META,
  BOSS_MOVE_COUNTER,
  BOSS_READ_CHANCE_BASE,
  BOSS_READ_CHANCE_MAX,
  BOSS_CASUALTIES,
  BOSS_READ_CHANCE_NO_HERO,
  BOSS_LOSS_ENGAGEMENT_FLOOR,
  BOSS_ROUT_LOOT_PENALTY,
  BOSS_ROUT_LOSS_FRACTION,
  BOSS_SORTIE_ROUNDS,
  BOSS_TACTIC_META,
  bossSiegeMaxHp,
  bossSortiesToKill,
} from "@/lib/game/bossBattle";
import {
  GUILD_AID_MAX_LEVEL,
  GUILD_CREATION_COST_DIAMONDS,
  GUILD_DONATION_MIN,
  GUILD_SPELL_META,
  GUILD_SPELL_TYPES,
  aidUpgradeCostGold,
  capacityUpgradeCostGold,
  guildCapacity,
  spellCastCostDiamonds,
  spellUpgradeCostDiamonds,
} from "@/lib/game/guild";
import {
  GUILD_CONTRACTS,
  GUILD_CONTRACT_MAX_PER_MEMBER,
  GUILD_CONTRACT_MIN_GOAL,
  guildContractGoal,
} from "@/lib/game/guildContract";
import {
  MISSIONS_PER_BOARD,
  MISSION_SHAPES,
  missionGoal,
  missionRewards,
} from "@/lib/game/missions";
import {
  STREAK_CYCLE_DAYS,
  STREAK_LADDER,
  STREAK_WEEK_DIAMONDS,
} from "@/lib/game/streak";
import {
  REWARD_CITY_MULTIPLIER,
  REWARD_ICON,
  REWARD_LABEL,
  type Reward,
} from "@/lib/game/rewards";
import {
  ACHIEVEMENT_BY_KEY,
  GLORY_ICON,
  GLORY_KEYS,
  GLORY_NAME,
  gloryPrize,
} from "@/lib/game/achievements";
import {
  MONUMENTS,
  MONUMENT_COST_GROWTH,
  MONUMENT_MAX_LEVEL,
  MONUMENT_PCT_PER_LEVEL,
  monumentCost,
  monumentTotalCost,
} from "@/lib/game/monuments";
import {
  SABOTAGE_INTEL_MARGIN,
  SABOTAGE_MISSIONS,
} from "@/lib/game/sabotage";
import {
  COMMISSION_DROPS,
  COMMISSION_SHARDS,
  SHARDS_BY_RARITY,
  SHARDS_PER_DROP,
  TEMPER_SHARDS,
  commissionGoldCost,
} from "@/lib/game/forge";
import {
  ARENA_CONSOLATION,
  ARENA_ENTRY_TURNS,
  ARENA_GOLD_PER_WIN,
  ARENA_LUCK,
  ARENA_MAX_ENTRANTS,
  ARENA_MIN_ENTRANTS,
  ARENA_PODIUM,
  ARENA_PODIUM_MIN_ENTRANTS,
} from "@/lib/game/arena";
import {
  WORLD_BOSSES,
  WORLD_BOSS_DAMAGE_PER_POWER,
  WORLD_BOSS_DAMAGE_SPREAD,
  WORLD_BOSS_FLOOR_SHARE,
  WORLD_BOSS_HP_MIN,
  WORLD_BOSS_HP_PER_EMPIRE,
  WORLD_BOSS_PHASES,
  WORLD_BOSS_PURSE,
} from "@/lib/game/worldBoss";
import {
  REFERRAL_BURST_LIMIT,
  REFERRAL_GOAL_CITIES,
  REFERRAL_JOINER_PURSE,
  REFERRAL_NAME_MAX_CITIES,
  REFERRAL_REFERRER_PURSE,
  REFERRAL_SEASON_CAP,
} from "@/lib/game/referral";
import { TIER_LABEL, TITLES, TITLE_PARAMS } from "@/lib/game/titles";
import {
  SEASON_PASS_PREMIUM_PRICE,
  SEASON_PASS_TIER_COUNT,
  SEASON_PASS_XP,
  SEASON_PASS_XP_PER_TIER,
  SEASON_PASS_DAY1_PEAK,
  SEASON_PASS_FINAL_PEAK,
} from "@/lib/game/seasonPass";
import {
  WHEEL_CITIZEN_BASE,
  WHEEL_CITIZEN_FINAL,
  WHEEL_DIAMOND_BASE,
  WHEEL_DIAMOND_FINAL,
  WHEEL_PRIZES,
  WHEEL_RESOURCE_BASE,
  WHEEL_RESOURCE_FINAL,
} from "@/lib/game/wheel";
import {
  CHAT_BODY_MAX,
  CHAT_BURST_LIMIT,
  CHAT_BURST_WINDOW_MS,
  CHAT_DIRECT_LIMIT,
  CHAT_GLOBAL_LIMIT,
  CHAT_PAIR_LIMIT,
  CHAT_REPEAT_WINDOW_MS,
  PRESENCE_ONLINE_MS,
} from "@/lib/game/chat";
import { COMMUNITY_HIGHLIGHTS, DISCORD_JOIN_DIAMONDS } from "@/lib/community";
import {
  BOOST_MAX_PCT,
  BOOST_STEP_COST,
  BOOST_STEP_PCT,
  CITY_DOWNGRADE_COOLDOWN_HOURS,
  CITY_DOWNGRADE_COST,
  CITY_DOWNGRADE_MIN_CITIES,
  HERO_POINTS_RESET_COST,
  HERO_REVIVE_COST,
  SHIELDS,
  SHIELD_RENEW_COOLDOWN_MINUTES,
  TURN_PACKAGES,
} from "@/lib/game/diamondShop";
import { VIP_COST, VIP_LABEL } from "@/lib/game/vip";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon, resourceIcon, type IconName } from "@/components/ui/Icon";
import { BackToTop, GuideToc, type TocEntry } from "@/components/game/guide/GuideToc";
import { getT, type T } from "@/i18n/server";
import { RichText } from "@/components/ui/RichText";
import {
  BankCalc,
  BattleCalc,
  BossLadder,
  HeroXpCalc,
  ItemUpgradeCalc,
  ProductionCalc,
  SpyCalc,
} from "@/components/game/guide/GuideCalc";
import {
  Cost,
  Fact,
  Formula,
  GuideSection,
  Lead,
  N,
  Note,
  O,
  R,
  TableWrap,
  V,
  type GuideSectionMeta,
} from "@/components/game/guide/GuideUi";


/* ------------------------------------------------------------------ *
 * The manual's spine. The order here drives the numerals, the table
 * of contents and the scroll-spy, so a section is added in exactly one
 * place.
 * ------------------------------------------------------------------ */
// i18n-keys-start: `title` is a dictionary key. The manual translates the whole
// table once per render (see `sections` below) rather than at each of the ~32
// call sites, so a section is still added in exactly one place.
const SECTIONS = {
  overview: { id: "overview", title: "מבט על", sub: "the loop", icon: "crown" },
  clock: { id: "clock", title: "שעון המשחק", sub: "the clock", icon: "turns" },
  daily: { id: "daily", title: "לוח היום", sub: "the daily board", icon: "check" },
  resources: { id: "resources", title: "משאבים", sub: "resources", icon: "gold" },
  mines: { id: "mines", title: "מכרות ותפוקה", sub: "production", icon: "mine" },
  cities: { id: "cities", title: "ערים", sub: "cities", icon: "base" },
  storage: { id: "storage", title: "מחסנים", sub: "warehouses", icon: "storage" },
  bank: { id: "bank", title: "בנק", sub: "the bank", icon: "bank" },
  army: { id: "army", title: "צבא ואזרחים", sub: "the army", icon: "army" },
  weapons: { id: "weapons", title: "מפעל הנשק", sub: "the foundry", icon: "factory" },
  upgrades: { id: "upgrades", title: "שדרוגי אימפריה", sub: "upgrades", icon: "upgrades" },
  monuments: { id: "monuments", title: "מבנים", sub: "monuments", icon: "stone" },
  battle: { id: "battle", title: "קרב", sub: "war", icon: "attack" },
  fervor: { id: "fervor", title: "להט הקרב", sub: "battle fervor", icon: "spark" },
  spy: { id: "spy", title: "ריגול", sub: "espionage", icon: "spy" },
  sabotage: { id: "sabotage", title: "חבלה", sub: "sabotage", icon: "unlocked" },
  hero: { id: "hero", title: "הגיבור", sub: "the hero", icon: "hero" },
  items: { id: "items", title: "חפצים", sub: "gear", icon: "spark" },
  forge: { id: "forge", title: "נפחיית הגיבור", sub: "the forge", icon: "iron" },
  potions: { id: "potions", title: "שיקויים", sub: "potions", icon: "potion" },
  quests: { id: "quests", title: "מסעות הגיבור", sub: "expeditions", icon: "quest" },
  bosses: { id: "bosses", title: "שליטי הערים", sub: "city bosses", icon: "shield" },
  arena: { id: "arena", title: "הזירה", sub: "the arena", icon: "laurel" },
  worldboss: { id: "worldboss", title: "מפלצת העולם", sub: "world boss", icon: "heart" },
  guild: { id: "guild", title: "ברית", sub: "guilds", icon: "guild" },
  chat: { id: "chat", title: "צ׳אט", sub: "live chat", icon: "chat" },
  community: { id: "community", title: "קהילה", sub: "community", icon: "discord" },
  referrals: { id: "referrals", title: "הזמנת חברים", sub: "referrals", icon: "gift" },
  titles: { id: "titles", title: "תארים", sub: "titles", icon: "achievements" },
  rewards: { id: "rewards", title: "גלגל, פס עונה ואירועים", sub: "rewards", icon: "wheel" },
  diamonds: { id: "diamonds", title: "יהלומים", sub: "diamonds", icon: "diamond" },
  roadmap: { id: "roadmap", title: "מסלול התקדמות", sub: "roadmap", icon: "rankings" },
} as const satisfies Record<string, GuideSectionMeta>;
// i18n-keys-end

const ORDER = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[];
const INDEX = Object.fromEntries(ORDER.map((k, i) => [k, i + 1])) as Record<
  keyof typeof SECTIONS,
  number
>;
/**
 * The section table in the reader's language.
 *
 * Built once per render and handed to both readers of it — the numbered
 * headers and the table of contents — so `SECTIONS` above stays a plain
 * catalogue of keys and no call site has to remember to translate.
 */
function translateSections(t: T): Record<keyof typeof SECTIONS, GuideSectionMeta> {
  return Object.fromEntries(
    ORDER.map((k) => [k, { ...SECTIONS[k], title: t(SECTIONS[k].title) }])
  ) as Record<keyof typeof SECTIONS, GuideSectionMeta>;
}

/** The bosses whose art bleeds behind the banner, left to right. */
const BANNER_ART = ["varkos", "morgeth", "tharos", "serpina", "nox", "volgaris"];

/**
 * Bottle silhouettes, so a brew is known by shape alone — the same distinction
 * the potion belt makes (see PotionMeta.shape).
 */
const POTION_SHAPE: Record<PotionShape, { className: string; style?: CSSProperties }> = {
  vial: { className: "h-14 w-7 rounded-b-[999px] rounded-t-sm" },
  orb: { className: "h-12 w-12 rounded-full" },
  flask: {
    className: "h-13 w-12",
    style: { clipPath: "polygon(36% 0, 64% 0, 64% 30%, 100% 100%, 0 100%, 36% 30%)" },
  },
  crystal: { className: "h-10 w-10 rotate-45 rounded-md" },
};

/** The five beats of the core loop, in the order the overview walks them. */
// i18n-keys-start: dictionary keys, drawn through t(node.title) / t(node.text)
const LOOP_NODES: { icon: IconName; title: string; text: string }[] = [
  { icon: "mine", title: "מייצרים", text: "מכרות + עבדים = משאבים בכל 5 דקות" },
  { icon: "upgrades", title: "משדרגים", text: "מכרות, מחסנים, שדרוגי אימפריה, ערים" },
  { icon: "factory", title: "מתחמשים", text: "חיילים, מרגלים ונשקים במפעל" },
  { icon: "attack", title: "תוקפים", text: "ביזה, שבויים, ניסיון וחפצים" },
  { icon: "hero", title: "מתחזקים", text: "הגיבור עולה רמות ומחזק את הכל" },
];
// i18n-keys-end

const nf = (v: number) => Math.round(v).toLocaleString("he-IL");

/**
 * A purse, as a row of chips.
 *
 * Every board added in the daily wave — missions, the muster roll, the guild
 * contract, the arena, the world boss, the referral — pays a `Reward[]` quoted
 * at one city, and the manual quotes them all in the same shape so a reader
 * comparing two of them is comparing the same thing. `REWARD_ICON` and
 * `REWARD_LABEL` are the game's own tables, so a new reward kind reaches the
 * guide without a second list to keep in step.
 */
function Purse({ rewards }: { rewards: readonly Reward[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 align-middle">
      {rewards.map((reward) => (
        <span key={reward.kind} className="flex items-center gap-1 whitespace-nowrap">
          <Icon name={REWARD_ICON[reward.kind]} size={13} className="text-gold" />
          <span className="nums text-[0.78rem] text-zinc-300" dir="ltr">
            {formatShort(reward.amount)}
          </span>
          <span className="text-[0.7rem] text-zinc-500">{REWARD_LABEL[reward.kind]}</span>
        </span>
      ))}
    </span>
  );
}

/** Fill the `{goal}`-style placeholders the mission and title catalogs carry. */
const fillParams = (text: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, String(value)),
    text
  );

/**
 * Everything an empire pays to take an upgrade from its starting level 1 up to
 * `maxLevel`. The table used to quote a single rung (5 → 6), which said nothing
 * about a geometric ladder — and named a purchase that does not exist for the
 * five-level turns upgrade. Uncapped upgrades have no total, so they print "—".
 */
function upgradeLadderTotal(
  type: ActiveEmpireUpgradeType,
  maxLevel: number | undefined
) {
  const total = { gold: 0, wood: 0, iron: 0, stone: 0 };
  if (maxLevel === undefined) return undefined;
  for (let level = 1; level < maxLevel; level++) {
    const rung = empireUpgradeCostFor(type, level);
    total.gold += rung.gold;
    total.wood += rung.wood;
    total.iron += rung.iron;
    total.stone += rung.stone;
  }
  return total;
}

/**
 * The manual itself, rendered in two places.
 *
 * `/game/guide` puts it inside the game shell for a player who is already in;
 * `/guide` puts it in the public shell for somebody deciding whether to sign up.
 * The words and every number in them are identical — a manual that says
 * something different to a visitor than to a player is a brochure, and the point
 * of publishing it is that a stranger can read exactly what they are about to
 * join.
 *
 * The gate lives on the two routes, never here: this component reads nothing
 * about the caller, only the live tunables.
 */
export async function GuideContent({
  /**
   * Rendered for a logged-out reader.
   *
   * The only thing it changes is where the "go and do it" buttons point. Every
   * `/game/*` route redirects a stranger to `/login` and then, once they sign
   * in, to wherever the redirect chain drops them — so on the public copy those
   * buttons go to registration, which is the step that actually stands between
   * the reader and the screen the button names.
   */
  publicView = false,
}: {
  publicView?: boolean;
} = {}) {
  const t = await getT();
  const tunables = await getTunables();
  // The manual quotes the game as it is *tuned*, not as it shipped — the same
  // rule every other figure on this page follows. Both bosses grew admin dials
  // with /admin/bosses, so these three derive from them rather than from the
  // constants beside them.
  const reviveMinutes = Math.round(bossReviveMs(tunables.boss.reviveMinutes) / 60_000);
  const worldBossPurse = WORLD_BOSS_PURSE.map((r) => ({
    ...r,
    amount: Math.max(0, Math.round(r.amount * tunables.worldBoss.rewardMultiplier)),
  }));
  const sections = translateSections(t);
  const toc: TocEntry[] = ORDER.map((k) => ({
    id: sections[k].id,
    title: sections[k].title,
    icon: sections[k].icon,
  }));

  /** Where an in-game link goes for this reader. See `publicView`. */
  const gameHref = (path: string) => (publicView ? "/register" : path);

  const dailyTimes = DAILY_UPDATE_TIMES.map(
    (t) => `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("מדריך המשחק")}
        ornament={<Icon name="reports" size={22} className="text-crimson" />}
      />

      {/* ------------------------------- banner ------------------------------- */}
      <header className="guide-hero rounded-xl px-5 py-8 text-center sm:px-10 sm:py-12">
        <div className="guide-hero-art" aria-hidden>
          {BANNER_ART.map((key) => (
            <figure key={key}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/boss/${key}.jpg`} alt="" />
            </figure>
          ))}
        </div>
        <div className="guide-hero-veil" aria-hidden />

        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-gold-dim">
          everything, explained
        </p>
        <h2 className="mt-2 text-2xl font-black tracking-wide text-gold-bright sm:text-4xl">{t("כל מה שצריך לדעת כדי לשלוט")}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-bone/85">{t("כל חוק, כל נוסחה וכל מספר במשחק — כפי שהשרת באמת מחשב אותם. המדריך חי: הערכים שמוצגים כאן נקראים מהאיזון הפעיל של השרת, ובכל מקום שיש בו חישוב מחכה לך מחשבון שאפשר לשחק איתו.")}</p>

        <div className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact
            icon="turns"
            label={t("עדכון רגיל")}
            value={t("{minutes} דק׳", { minutes: REGULAR_TICK_MINUTES })}
            hint={t("תפוקה + תורות")}
          />
          <Fact
            icon="base"
            label={t("עדכון יומי")}
            value={<span className="text-base">{dailyTimes.join(" · ")}</span>}
            hint={t("אזרחים, ריבית, גלגל")}
          />
          <Fact
            icon="crown"
            label={t("ערים")}
            value={`×${MAX_CITIES}`}
            hint={t("כל עיר מכפילה תפוקה")}
            tone="text-bone-bright"
          />
          <Fact
            icon="hero"
            label={t("רמת גיבור")}
            value={HERO_MAX_LEVEL}
            hint={t("ואז איפוס ליוקרה")}
            tone="text-purple-300"
          />
        </div>
      </header>

      {/* ------------------------------- body ------------------------------- */}
      <GuideToc entries={toc} />
      <BackToTop />

      <div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-10 pt-2">
            {/* ============================ 01 overview ============================ */}
            <GuideSection meta={sections.overview} index={INDEX.overview}>
              <Lead>{t('קראלדור הוא משחק אסטרטגיה של אימפריות שרצות על שעון אמיתי. אתה לא "משחק תור" — האימפריה שלך מייצרת, גדלה ונשדדת גם כשאתה לא מחובר. כל מה שתעשה מסתובב בלולאה אחת קבועה:')}</Lead>

              <div className="grid gap-4 md:grid-cols-5 md:gap-6">
                {LOOP_NODES.map((node, i, arr) => (
                  <div
                    key={node.title}
                    className={`guide-loop-node p-3 text-center ${i === arr.length - 1 ? "is-last" : ""}`}
                  >
                    <Icon name={node.icon} size={26} className="mx-auto mb-1 text-crimson-bright" />
                    <p className="text-sm font-black text-gold-bright">{t(node.title)}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{t(node.text)}</p>
                  </div>
                ))}
              </div>

              <Note tone="green" icon="shield" title={t("הגנת שחקן חדש")}><RichText text={t("אימפריה טרייה מוגנת מתקיפה ומריגול למשך  <0> מהרישום. המגן נשבר ברגע שאתה עצמך תוקף או מרגל — אי אפשר להסתתר מאחוריו ולפעול בתוקפנות באותו הזמן.")} slots={[<><b>{formatWaitDuration(t, NEWBIE_PROTECTION_MS)}</b></>]} /></Note>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact icon="gold" label={t("זהב פתיחה")} value={formatShort(tunables.starting.gold)} />
                <Fact icon="citizens" label={t("אזרחים פתיחה")} value={nf(tunables.starting.citizens)} />
                <Fact icon="turns" label={t("תורות פתיחה")} value={nf(tunables.starting.turns)} />
                <Fact
                  icon="army"
                  label={t("עבדי מכרות פתיחה")}
                  value={nf(tunables.starting.mineSlaves)}
                  hint={t("{p0} בכל מכרה", { p0: tunables.starting.slavesPerMine })}
                />
              </div>
            </GuideSection>

            {/* ============================ 02 clock ============================ */}
            <GuideSection meta={sections.clock} index={INDEX.clock}>
              <Lead>{t("לשרת שני קצבים, ולכל אחד תפקיד אחר. הכול מתעדכן על שעון גלובלי — כל האימפריות בעולם מתקדמות באותו רגע, גם אם אף אחד לא מחובר. נכנסת אחרי לילה שלם? כל העדכונים שהוחמצו מסודרים בבת אחת ברגע הכניסה.")}</Lead>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> עדכון רגיל — כל {p0} דקות", { p0: REGULAR_TICK_MINUTES })} slots={[<><Icon name="turns" size={18} /></>]} /></p>
                  <ul className="space-y-1.5 text-[0.8rem] text-zinc-300">
                    <li>{t("• תפוקת כל המכרות (לפי עבדים, רמה, ערים ובונוסים)")}</li>
                    <li>{t('• תורות משדרוג "קבלת תורות" (+1 לכל רמה)')}</li>
                    <li>{t("• משאבים קבועים מחפצי הגיבור (פרי־שטן, מכנסיים ועוד)")}</li>
                    <li>{t("• תורות מחפצי הגיבור (כנפיים, קסדה, מגן, נעליים)")}</li>
                  </ul>
                  <p className="mt-2 text-[11px] text-zinc-500"><RichText text={t("העדכון נופל על שעות עגולות — <0>")} slots={[<><span className="nums" dir="ltr">XX:00, XX:05, XX:10…</span></>]} /></p>
                </div>

                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> עדכון יומי — {p0}", { p0: dailyTimes.join(t(" ו־")) })} slots={[<><Icon name="base" size={18} /></>]} /></p>
                  <ul className="space-y-1.5 text-[0.8rem] text-zinc-300">
                    <li>{t("• אזרחים חדשים — בלי תקרה, כולל כל הצבירה שהחמצת")}</li>
                    <li>{t("• ריבית על הזהב שבבנק, ופתיחת מכסת הפקדות חדשה")}</li>
                    <li><RichText text={t("• <0> סיבובי גלגל מזל")} slots={[<><b className="nums">{tunables.daily.wheelSpins}</b></>]} /></li>
                    <li>{t("• איפוס דרך התהילה ומכסת הניצחונות על שליט העיר")}</li>
                    <li>{t("• אזרחים ויהלומים מחפצי הגיבור — ורק הם; כל שאר בונוסי החפצים מגיעים בעדכון הרגיל")}</li>
                  </ul>
                  <p className="mt-2 text-[11px] text-zinc-500">{t("שעון ישראל, פעמיים ביום.")}</p>
                </div>
              </div>

              <Formula
                label={t("אזרחים בכל עדכון יומי")}
                expr={
                  <>
                    <N>{tunables.daily.citizensBase}</N>
                    <O>+</O>
                    <V>{t("רמת שדרוג קבלת אזרחים")}</V>
                    <O>×</O>
                    <N>{tunables.daily.citizensPerLevel}</N>
                    <O>=</O>
                    <R>{t("אזרחים")}</R>
                    <O>{t("× עדכונים שהוחמצו")}</O>
                  </>
                }
                example={
                  <>
                    {t("ברמת שדרוג")} <N>10</N> {t("תקבל")}{" "}
                    <N>{citizensPerDailyUpdate(10, tunables.daily)}</N> {t("אזרחים בכל עדכון —")}{" "}
                    <N>{citizensPerDailyUpdate(10, tunables.daily) * 2}</N> {t("ביממה. אם לא נכנסת שבוע, כל העדכונים שהוחמצו נצברים ומשולמים בכניסה הבאה.")}
                  </>
                }
              />

              <Note tone="green" icon="citizens" title={t("אין תקרת אוכלוסייה")}>{t('אזרחים נצברים בלי גבול, בדיוק כמו משאבים — שום עדכון לא הולך לאיבוד אם לא רוקנת את המאגר. עדיין כדאי להמיר אותם: אזרח שיושב במאגר לא כורה, לא נלחם ולא מרגל. הערים כבר לא מגבילות כמה יש לך, רק כמה מהר הם מגיעים — דרך רמות שדרוג "קבלת אזרחים" שהן פותחות.')}</Note>
            </GuideSection>

            {/* ============================ 03 daily ============================ */}
            <GuideSection meta={sections.daily} index={INDEX.daily}>
              <Lead><RichText text={t("<0>  הוא המסך היחיד שכל תוכנו פג. עליו ארבעה דברים:  <1> (רצף הכניסה),  <2> משימות יומיות,  <3> שבועיות, ו<4>  המשותף. הכול נמדד ב<5> — חצות עד חצות — ולא בפעמון העדכון היומי.")} slots={[<><Link href={gameHref("/game/daily")} className="text-gold underline"> {t("לוח היום")} </Link></>, <><b>{t("מפקד הנאמנים")}</b></>, <><b className="nums">{MISSIONS_PER_BOARD}</b></>, <><b className="nums">{MISSIONS_PER_BOARD}</b></>, <><b>{t("חוזה הברית")}</b></>, <><b>{t("יום לוח ירושלמי")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="check"
                  label={t("משימות בלוח")}
                  value={`${MISSIONS_PER_BOARD}+${MISSIONS_PER_BOARD}`}
                  hint={t("יומיות + שבועיות")}
                />
                <Fact
                  icon="turns"
                  label={t("מחזור הרצף")}
                  value={STREAK_CYCLE_DAYS}
                  hint={t("ימים, ואז מתחיל מחדש")}
                  tone="text-emerald-300"
                />
                <Fact
                  icon="diamond"
                  label={t("יהלומים ביום השביעי")}
                  value={STREAK_WEEK_DIAMONDS}
                  hint={t("הפרס היחיד ביהלומים בלוח")}
                  tone="text-cyan-300"
                />
                <Fact
                  icon="gold"
                  label={t("מכפיל לפי ערים")}
                  value={`×${REWARD_CITY_MULTIPLIER}`}
                  hint={t("לכל עיר, על המשאבים בלבד")}
                  tone="text-gold-bright"
                />
              </div>

              <Formula
                label={t("התקדמות במשימה")}
                expr={
                  <>
                    <V>{t("המונה שלך עכשיו")}</V>
                    <O>−</O>
                    <V>{t("המונה ברגע שהלוח נפתח")}</V>
                    <O>=</O>
                    <R>{t("ההתקדמות")}</R>
                  </>
                }
                legend={[
                  {
                    term: t("הלוח נפתח בכניסה הראשונה"),
                    desc: t("אין מונה שרץ ברקע. הלוח מצלם את המונים שלך ברגע שאתה פותח אותו, ומודד את ההפרש — לכן פתח אותו בתחילת היום, לא בסופו."),
                  },
                  {
                    term: t("מה שנעשה לפני הפתיחה לא נספר"),
                    desc: t("עשר תקיפות ב-08:00 ולוח שנפתח ב-22:00 מתחילות מאפס. זה המחיר של השיטה, והיא זו שמונעת ספירה כפולה."),
                  },
                  {
                    term: t("רק מונים שעולים"),
                    desc: t("כל משימה נמדדת לפי מונה מצטבר לכל החיים — תקיפות, ביזה, ריגולים. אף משימה לא נמדדת לפי יתרה, כדי שפשיטה עליך לא תוריד לך בר."),
                  },
                  {
                    term: t("יעדים שגדלים איתך"),
                    desc: t("משימות שנמדדות במשאבים או בגופות מוכפלות ב־×{p0} לכל עיר — כמו הפרס. משימות שנספרות במעשים (שלוש תקיפות) זהות בכל גודל.", { p0: REWARD_CITY_MULTIPLIER }),
                  },
                ]}
                example={
                  <>
                    {t("אותה משימה בדיוק —")}{" "}
                    <b>
                      {fillParams(MISSION_SHAPES[0].name, {
                        goal: missionGoal(MISSION_SHAPES[0], "DAY", 1),
                      })}
                    </b>{" "}
                    {t("— משלמת")} <b className="nums">{nf(missionRewards(MISSION_SHAPES[0], "DAY", 1)[0].amount)}</b>{" "}
                    {REWARD_LABEL[missionRewards(MISSION_SHAPES[0], "DAY", 1)[0].kind]} {t("בעיר אחת, ו־")}
                    <b className="nums">{nf(missionRewards(MISSION_SHAPES[0], "DAY", 5)[0].amount)}</b>{" "}
                    {REWARD_LABEL[missionRewards(MISSION_SHAPES[0], "DAY", 5)[0].kind]} {t("בעיר חמש.")}
                  </>
                }
              />

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("יום")}</th>
                      <th>{t("השלב")}</th>
                      <th>{t("מה מחכה שם")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STREAK_LADDER.map((rung) => (
                      <tr key={rung.day} className={rung.day === STREAK_CYCLE_DAYS ? "font-bold" : ""}>
                        <td className="nums text-gold-bright" dir="ltr">
                          {rung.day}
                        </td>
                        <td className="whitespace-nowrap text-bone">{rung.name}</td>
                        <td>
                          <Purse rewards={rung.rewards} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <div className="grid gap-3 sm:grid-cols-2">
                <Note tone="red" icon="turns" title={t("יום שהוחמץ שובר את הרצף")}><RichText text={t("הרצף חוזר ל־<0>, והשיא האישי נשמר לצידו. אין דרך לקנות את הפער בחזרה — רצף שאפשר לשלם עליו הוא לא סיבה לחזור מחר.")} slots={[<><b className="nums">1</b></>]} /></Note>
                <Note tone="green" icon="guild" title={t("חוזה הברית")}><RichText text={t("יעד יומי אחד לכל ברית, שנמדד ב<0>. הוא ננעל לפי מספר החברים ברגע שנפתח (מינימום  <1> משימות, ולכל היותר  <2> לחבר), וכשהוא נסגר  <3> מקבל את מלוא הפרס — לא חלק ממנו.")} slots={[<><b>{t("משימות היומיות שהחברים סיימו")}</b></>, <><b className="nums">{GUILD_CONTRACT_MIN_GOAL}</b></>, <><b className="nums">{GUILD_CONTRACT_MAX_PER_MEMBER}</b></>, <><b>{t("כל חבר שהיה בברית באותו רגע")}</b></>]} /></Note>
              </div>

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("חוזה")}</th>
                      <th>{t("יעד לברית של 5")}</th>
                      <th>{t("לכל חבר")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GUILD_CONTRACTS.map((contract) => (
                      <tr key={contract.key}>
                        <td className="whitespace-nowrap">
                          <Icon name={contract.icon} size={13} className="ms-1 inline text-gold" />
                          <b className="text-bone">{contract.name}</b>
                          <p className="text-[0.7rem] text-zinc-500">{contract.lore}</p>
                        </td>
                        <td className="nums text-gold-bright" dir="ltr">
                          {guildContractGoal(contract, 5)}
                        </td>
                        <td>
                          <Purse rewards={contract.reward} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </GuideSection>

            {/* ============================ 04 resources ============================ */}
            <GuideSection meta={sections.resources} index={INDEX.resources}>
              <Lead>{t('שבעה מאזנים מנהלים את האימפריה. ארבעה מהם נאגרים ונבזזים, אחד נקנה בכסף אמיתי, ושניים הם "דלק" — כוח אדם וזמן פעולה.')}</Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    // i18n-keys-start: dictionary keys, drawn through t(text) below
                    ["gold", "המטבע המרכזי — נשקים, שדרוגים, שדרוג חפצים ובנק."],
                    ["wood", "חומר בנייה לשדרוגים ולנשקים."],
                    ["iron", "הבסיס לכל כלי הנשק."],
                    ["stone", "חומות, מבנים וביצורים."],
                    ["diamonds", "מטבע פרימיום: בריתות, קסמים, החייאת גיבור וחבילות."],
                    ["citizens", "כוח אדם גולמי — הופך לחיילים, מרגלים או עבדי מכרות."],
                    ["turns", "דלק הפעולה: כל תקיפה, ריגול וקרב בוס עולה תורות."],
                    // i18n-keys-end
                  ] as const
                ).map(([key, text]) => {
                  const ic = resourceIcon(key);
                  return (
                    <div key={key} className="panel-inset flex gap-3 rounded-xl p-3">
                      <Icon name={ic.name} size={26} className={`shrink-0 ${ic.className}`} />
                      <div className="min-w-0">
                        <p className="font-black text-bone-bright">
                          {RESOURCE_META[key].label}
                        </p>
                        <p className="text-[11px] leading-snug text-zinc-400">{text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Note tone="gold" icon="storage" title={t("זמין מול מאוחסן")}>
                {t("לכל משאב יש שתי יתרות:")} <b>{t("זמין")}</b> {t("(מה שאפשר להוציא — וגם מה שנבזז בתקיפה) ו")}<b>{t("מאוחסן")}</b> {t("במחסן (מוגן לחלוטין מביזה, אבל לא ניתן להוציא אותו עד שתמשוך). ראה")}{" "}
                <a href={`#${SECTIONS.storage.id}`} className="text-gold underline">
                  {t("מחסנים")}
                </a>
                .
              </Note>
            </GuideSection>

            {/* ============================ 05 mines ============================ */}
            <GuideSection meta={sections.mines} index={INDEX.mines}>
              <Lead><RichText text={t("ארבעת המכרות הם מנוע הכלכלה. מכרה לא מייצר כלום מעצמו — הוא מייצר לפי כמות <0> שהצבת בו, כפול התפוקה לעבד שנקבעת מרמת המכרה.")} slots={[<><b>{t("עבדי המכרות")}</b></>]} /></Lead>

              <Formula
                label={t("תפוקת מכרה בכל עדכון רגיל")}
                expr={
                  <>
                    <V>{t("עבדים")}</V>
                    <O>×</O>
                    <O>(</O>
                    <V>{t("רמת המכרה")}</V>
                    <O>×</O>
                    <N>2</N>
                    <O>)</O>
                    <O>×</O>
                    <V>{t("ערים")}</V>
                    <O>×</O>
                    <V>{t("בונוס גיבור")}</V>
                    <O>×</O>
                    <V>{t("קסם ברית")}</V>
                    <O>×</O>
                    <V>{t("שיקוי")}</V>
                    <O>+</O>
                    <V>{t("חפץ")}</V>
                  </>
                }
                legend={[
                  { term: t("רמה × 2"), desc: t("כמה מפיק כל עבד. רמה {p0} = {p1} ליחידה — התקרה.", { p0: MINE_MAX_LEVEL, p1: MINE_MAX_LEVEL * 2 }) },
                  { term: t("ערים"), desc: t("מכפיל ליניארי: ×1 בעיר אחת, ×{p0} בעשר.", { p0: MAX_CITIES }) },
                  {
                    term: t("בונוס גיבור"),
                    desc: t("נקודות משאבים + בונוס מקצוע הסוחר + חרב ומגן, שמוסיפים אחוזים לתפוקה."),
                  },
                  {
                    term: t("חפץ"),
                    desc: t("פרי שטן, מכנסיים ונעליים מוסיפים כמות קבועה מעל המכפיל — לא אחוז."),
                  },
                ]}
                example={
                  <>
                    <N>60</N> {t("עבדים במכרה ברמה")} <N>40</N> ={" "}
                    <N>{nf(60 * 80)}</N> {t("בבסיס; עם")} <N>3</N> {t("ערים ובונוס גיבור")}{" "}
                    <N>20%</N> — <R>{nf(60 * 80 * 3 * 1.2)}</R> {t("בכל 5 דקות, כלומר")}{" "}
                    <R>{formatShort(60 * 80 * 3 * 1.2 * 288)}</R> {t("ביממה.")}
                  </>
                }
              />

              <ProductionCalc globalMultiplier={tunables.economy.mineProductionMultiplier} />

              <div>
                <p className="mb-2 text-sm font-black text-gold-bright">{t("מחיר שדרוג מכרה")}</p>
                <p className="mb-2 text-xs text-zinc-400"><RichText text={t("כל מכרה משודרג <0> — מכרה זהב בזהב, מחצבת אבן באבן. כל רמה עולה פי {p0} מקודמתה, כך שהדרגות הראשונות זולות והטיפוס לרמה {p1} הוא פרויקט של עונה.", { p0: MINE_UPGRADE_COST_GROWTH, p1: MINE_MAX_LEVEL })} slots={[<><b>{t("במשאב שלו בלבד")}</b></>]} /></p>
                <TableWrap maxHeight={320}>
                  <table className="guide-table">
                    <thead>
                      <tr>
                        <th className="text-right">{t("רמה")}</th>
                        <th className="text-right">{t("תפוקה לעבד")}</th>
                        <th className="text-right">{t("מכרה זהב")}</th>
                        <th className="text-right">{t("מכרה עץ")}</th>
                        <th className="text-right">{t("מכרה ברזל")}</th>
                        <th className="text-right">{t("מחצבת אבן")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 5, 10, 25, 50, 75, 100, 150, 200, 249].map((lvl) => (
                        <tr key={lvl}>
                          <td className="nums font-bold text-bone-bright" dir="ltr">
                            {lvl} → {lvl + 1}
                          </td>
                          <td className="nums text-emerald-300" dir="ltr">
                            {(lvl + 1) * 2}
                          </td>
                          {(["gold", "wood", "iron", "stone"] as const).map((res) => (
                            <td key={res}>
                              <Cost amounts={[{ key: res, value: mineUpgradeCost(lvl, res)[res] }]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </div>

              <Note tone="gold" icon="mine" title={t("עבדים או רמה?")}>{t("שני הגורמים מוכפלים זה בזה, אז המכפלה גדלה הכי מהר כשהם מתקדמים יחד. עבדי מכרות עולים אזרח אחד בלבד ומגיעים גם כשבויים מתקיפות מנצחות — אבל רמת המכרה היא זו שמכפילה את כל העבדים בבת אחת.")}</Note>
            </GuideSection>

            {/* ============================ 06 cities ============================ */}
            <GuideSection meta={sections.cities} index={INDEX.cities}>
              <Lead>{t("עיר היא קפיצת המדרגה הגדולה במשחק. כל עיר מכפילה את תפוקת המכרות, פותחת עוד {p0} רמות לשדרוג קבלת האזרחים — ופותחת דרגות נשק חדשות במפעל. לכל אחת מעשר הערים שם משלה, מ {p1} שעל הגבול ועד {p2}, והדירוג שאתה רואה הוא תמיד זה של העיר שבה אתה יושב.", { p0: CITIZEN_GROWTH_LEVELS_PER_CITY, p1: cityAt(1).name, p2: cityAt(MAX_CITIES).name })}</Lead>

              <TableWrap maxHeight={400}>
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th className="text-right">{t("עיר")}</th>
                      <th className="text-right">{t("מכפיל תפוקה")}</th>
                      <th className="text-right">{t("אזרחים לעדכון")}</th>
                      <th className="text-right">{t("רמת גיבור נדרשת")}</th>
                      <th className="text-right">{t("עלות המעבר")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: MAX_CITIES }, (_, i) => i + 1).map((city) => {
                      const cost = city < MAX_CITIES ? cityCost(city) : null;
                      return (
                        <tr key={city}>
                          {/* The tier is the mechanic, the name is the place —
                              the table is the one screen that owes the player
                              both, since it is where they plan the climb. */}
                          <td className="font-black text-gold-bright">
                            <span className="nums" dir="ltr">
                              {city}
                            </span>{" "}
                            <span className="font-bold text-bone">{cityAt(city).name}</span>
                            <span className="block text-[11px] font-normal text-zinc-500">
                              {cityAt(city).epithet}
                            </span>
                          </td>
                          <td className="nums text-sky-300" dir="ltr">
                            ×{city}
                          </td>
                          <td className="nums text-bone" dir="ltr">
                            {nf(
                              citizensPerDailyUpdate(
                                city * CITIZEN_GROWTH_LEVELS_PER_CITY,
                                tunables.daily
                              )
                            )}
                          </td>
                          <td className="nums text-purple-300" dir="ltr">
                            {city === 1 ? "—" : cityHeroLevelRequired(city - 1)}
                          </td>
                          <td>
                            {cost ? (
                              <Cost
                                amounts={[
                                  { key: "gold", value: cost.gold },
                                  { key: "wood", value: cost.wood },
                                  { key: "iron", value: cost.iron },
                                  { key: "stone", value: cost.stone },
                                  { key: "soldiers", value: cost.soldiers },
                                ]}
                              />
                            ) : (
                              <span className="text-[11px] text-zinc-500">{t("העיר האחרונה")}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>

              <Formula
                label={t("מחיר עיר")}
                expr={
                  <>
                    <V>{t("מחיר העיר השנייה")}</V>
                    <O>×</O>
                    <N>2.5</N>
                    <sup className="text-gold-dim">{t("(דרגה)")}</sup>
                    <O>—</O>
                    <V>{t("גם המשאבים וגם דרישת החיילים")}</V>
                  </>
                }
                legend={[
                  { term: t("חיילים"), desc: t("דרישת חיל מצב — הם נבדקים, לא נלקחים.") },
                  { term: t("רמת גיבור"), desc: t("עיר מספר N דורשת רמת גיבור (N−1) × 10.") },
                ]}
                example={
                  <>
                    {t("העיר השנייה:")} <N>{formatShort(cityCost(1).gold)}</N> {t("זהב +")}{" "}
                    <N>{formatShort(cityCost(1).wood)}</N> {t("מכל שאר המשאבים +")}{" "}
                    <N>{cityCost(1).soldiers}</N> {t("חיילים. העיר העשירית כבר עולה")}{" "}
                    <N>{formatShort(cityCost(9).gold)}</N> {t("זהב.")}
                  </>
                }
              />
            </GuideSection>

            {/* ============================ 07 storage ============================ */}
            <GuideSection meta={sections.storage} index={INDEX.storage}>
              <Lead><RichText text={t("מחסן הוא הכספת מפני תוקפים. משאב שהופקד במחסן <0> — אבל גם לא ניתן להוציא אותו עד שתמשוך אותו בחזרה ליתרה הזמינה.")} slots={[<><b>{t("לא נבזז לעולם")}</b></>]} /></Lead>

              <div className="grid gap-4 md:grid-cols-2">
                <Formula
                  label={t("קיבולת מחסן")}
                  expr={
                    <>
                      <V>{t("רמת המחסן")}</V>
                      <O>×</O>
                      <N>{nf(STORAGE_CAPACITY_PER_LEVEL)}</N>
                      <O>×</O>
                      <N>{STORAGE_GROWTH}</N>
                      <sup className="text-[10px]">{t("רמה−1")}</sup>
                      <O>=</O>
                      <R>{t("קיבולת מוגנת")}</R>
                    </>
                  }
                  example={
                    <>
                      {t("מחסן ברמה")} <N>25</N> {t("מגן על")}{" "}
                      <N>{formatShort(storageCapacityForLevel(25))}</N> {t("יחידות מהמשאב שלו.")}
                    </>
                  }
                />
                <div className="panel-inset rounded-xl p-4">
                  <p className="mb-2 text-sm font-black text-gold-bright">{t("עלות שדרוג")}</p>
                  <table className="guide-table">
                    <thead>
                      <tr>
                        <th className="text-right">{t("רמה")}</th>
                        <th className="text-right">{t("קיבולת")}</th>
                        <th className="text-right">{t("עלות")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 5, 10, 25, 50].map((lvl) => {
                        const c = storageUpgradeCost(lvl);
                        return (
                          <tr key={lvl}>
                            <td className="nums" dir="ltr">
                              {lvl} → {lvl + 1}
                            </td>
                            <td className="nums text-emerald-300" dir="ltr">
                              {formatShort(storageCapacityForLevel(lvl + 1))}
                            </td>
                            <td>
                              <Cost
                                amounts={[
                                  { key: "gold", value: c.gold },
                                  { key: "wood", value: c.wood },
                                  { key: "iron", value: c.iron },
                                  { key: "stone", value: c.stone },
                                ]}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <Note tone="red" icon="attack" title={t("הכלל החשוב ביותר לפני שינה")}><RichText text={t("תוקף לוקח  <0> מכל משאב <1> שלך. לפני שאתה מתנתק — הפקד במחסנים ובבנק. מה שנשאר בחוץ הוא הזמנה פתוחה.")} slots={[<><b className="nums">{Math.round(tunables.battle.plunderRate * 100)}%</b></>, <><b>{t("זמין")}</b></>]} /></Note>
            </GuideSection>

            {/* ============================ 08 bank ============================ */}
            <GuideSection meta={sections.bank} index={INDEX.bank}>
              <Lead><RichText text={t("הבנק מקבל <0>, מגן עליו מביזה, ומשלם עליו ריבית דריבית בכל עדכון יומי — פעמיים ביום. זה הנכס היחיד במשחק שגדל מעצמו.")} slots={[<><b>{t("זהב בלבד")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-3">
                <Fact
                  icon="gold"
                  label={t("ריבית מקסימלית")}
                  value={`${Math.round(BANK_INTEREST_MAX_RATE * 100)}%`}
                  hint={t("{p0}% לכל רמת שדרוג · עד רמה {p1}", { p0: Math.round(BANK_INTEREST_PER_LEVEL * 100), p1: BANK_DAILY_INTEREST_MAX_LEVEL })}
                />
                <Fact
                  icon="bank"
                  label={t("הפקדות בין עדכונים")}
                  value={t("עד {max}", { max: BANK_DEPOSIT_MAX })}
                  hint={t("1 + רמת שדרוג")}
                  tone="text-bone-bright"
                />
                <Fact
                  icon="turns"
                  label={t("תדירות זיכוי")}
                  value={t("×2 ביום")}
                  hint={t("בכל עדכון יומי")}
                  tone="text-emerald-300"
                />
              </div>

              <Formula
                label={t("ריבית בעדכון יומי")}
                expr={
                  <>
                    <V>{t("יתרה")}</V>
                    <O>×</O>
                    <O>min(</O>
                    <N>{`${Math.round(BANK_INTEREST_MAX_RATE * 100)}%`}</N>
                    <O>,</O>
                    <V>{t("רמת שדרוג")}</V>
                    <O>×</O>
                    <N>{`${Math.round(BANK_INTEREST_PER_LEVEL * 100)}%`}</N>
                    <O>)</O>
                    <O>=</O>
                    <R>{t("ריבית")}</R>
                    <O>{t("(מעוגל כלפי מטה)")}</O>
                  </>
                }
                legend={[
                  { term: t("ריבית דריבית"), desc: t("כל עדכון מחושב על היתרה החדשה, לא על הקרן.") },
                  { term: t("משיכה"), desc: t("חופשית תמיד — רק ההפקדות מוגבלות במכסה.") },
                ]}
              />

              <BankCalc />
            </GuideSection>

            {/* ============================ 09 army ============================ */}
            <GuideSection meta={sections.army} index={INDEX.army}>
              <Lead><RichText text={t("אימון יחידות לא עולה משאבים — הוא עולה <0>. כל אזרח הופך ליחידה אחת, וההחלטה מה לאמן היא הבחירה האסטרטגית האמיתית: כוח, מודיעין או כלכלה.")} slots={[<><b>{t("אזרחים")}</b></>]} /></Lead>

              <div className="grid gap-3 md:grid-cols-3">
                {(Object.keys(UNIT_META) as (keyof typeof UNIT_META)[]).map((key) => {
                  const unit = UNIT_META[key];
                  const power = key === "soldiers" ? SOLDIER_POWER : key === "spies" ? SPY_POWER : 0;
                  return (
                    <div key={key} className="panel-gold rounded-xl p-4">
                      <p className="flex items-center gap-2 font-black text-gold-bright">
                        <Icon name={unit.icon} size={20} className="text-crimson-bright" />
                        {unit.labelPlural}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                        {unit.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded bg-black/50 px-2 py-0.5 text-bone">
                          {t("עלות:")} <b className="nums">{unit.citizenCost}</b> {t("אזרח")}
                        </span>
                        {power > 0 && (
                          <span className="rounded bg-black/50 px-2 py-0.5 text-red-300">
                            {t("כוח:")} <b className="nums">{power}</b>
                          </span>
                        )}
                        {key === "mineSlaves" && (
                          <span className="rounded bg-black/50 px-2 py-0.5 text-emerald-300">
                            {t("תפוקה במכרה")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <Note tone="purple" icon="army" title={t("חיילים לא מתים בקרב")}>
                <RichText
                  text={t(
                    "אף צד לא מאבד חיילים — לא בקרב מול שחקן{p0}. הסיכון היחיד הוא התורות, ולמגן גם הביזה והשבויים.",
                    { p0: BOSS_CASUALTIES ? "" : ` ${t("ולא בקרב מול שליט עיר")}` }
                  )}
                />
                {BOSS_CASUALTIES && (
                  <>
                    {" "}
                    <RichText text={t("חיילים **כן** מתים בקרב מול שליט עיר.")} />
                  </>
                )}{" "}
                {t("חייל שנלקח בשעבוד לא מת — הוא עובר להיות עבד מכרות אצל התוקף.")}
              </Note>
            </GuideSection>

            {/* ============================ 10 weapons ============================ */}
            <GuideSection meta={sections.weapons} index={INDEX.weapons}>
              <Lead><RichText text={t("נשק הוא הדרך להפוך משאבים לכוח. יש  <0> דרגות בכל אחת משלוש הקטגוריות — התקפה, הגנה וריגול. בכל דרגה המחיר  <1> (×{p0}) אבל הכוח גדל  <2> — ולכן כל דרגה נותנת  <3>  יותר כוח לכל זהב מזו שמתחתיה. תמיד שווה לקנות את הדרגה הגבוהה ביותר שנפתחה לך.", { p0: WEAPON_COST_GROWTH })} slots={[<><b className="nums">{TIERS_PER_CATEGORY}</b></>, <><b>{t("מוכפל")}</b></>, <><b>×{WEAPON_POWER_GROWTH}</b></>, <><b className="nums"> {Math.round((WEAPON_POWER_GROWTH / WEAPON_COST_GROWTH - 1) * 100)}% </b></>]} /></Lead>

              <Formula
                label={t("דרגה t")}
                expr={
                  <>
                    <V>{t("כוח")}</V>
                    <O>=</O>
                    <N>5</N>
                    <O>×</O>
                    <N>{WEAPON_POWER_GROWTH}</N>
                    <sup className="text-gold-dim">(t−1)</sup>
                    <O>|</O>
                    <V>{t("מחיר")}</V>
                    <O>=</O>
                    <N>50</N>
                    <O>×</O>
                    <N>{WEAPON_COST_GROWTH}</N>
                    <sup className="text-gold-dim">(t−1)</sup>
                    <V> {t("זהב")}</V>
                    <O>+</O>
                    <N>25</N>
                    <O>×</O>
                    <N>{WEAPON_COST_GROWTH}</N>
                    <sup className="text-gold-dim">(t−1)</sup>
                    <V> {t("מכל שאר")}</V>
                  </>
                }
                legend={[
                  {
                    term: t("היחס משתפר"),
                    desc: t("התקפה והגנה: 1 כוח לכל 10 זהב בדרגה 1, ובכל דרגה מעליה ×{p0} כוח לאותו זהב.", { p0: WEAPON_POWER_GROWTH / WEAPON_COST_GROWTH }),
                  },
                  { term: t("ריגול"), desc: t("בסיס 4 במקום 5 — מתחיל ב־1 כוח לכל 12.5 זהב, ומשתפר באותו קצב.") },
                  {
                    term: t("למה לשדרג"),
                    desc: t("אותו זהב בדרגה גבוהה = יותר כוח, ופחות פריטים לקנות. אין שום סיבה להישאר בדרגה ישנה."),
                  },
                ]}
                example={
                  <>
                    {t("דרגה")} <N>1</N>: <N>5</N> {t("כוח ב־")}<N>50</N> {t("זהב. דרגה")} <N>20</N>:{" "}
                    <N>{formatShort(Math.round(5 * WEAPON_POWER_GROWTH ** 19))}</N> {t("כוח ב־")}
                    <N>{formatShort(50 * WEAPON_COST_GROWTH ** 19)}</N> {t("זהב — פי")}{" "}
                    <N>
                      {formatShort(
                        (WEAPON_POWER_GROWTH / WEAPON_COST_GROWTH) ** 19
                      )}
                    </N>{" "}
                    {t("כוח לכל זהב.")}
                  </>
                }
              />

              <div>
                <p className="mb-2 text-sm font-black text-gold-bright">{t("סולם הדרגות — כוח, מחיר ותנאי פתיחה")}</p>
                <p className="mb-2 text-xs text-zinc-400"><RichText text={t("פתיחת דרגה היא <0> — פתחת דרגה 7? היא נפתחה להתקפה, להגנה ולריגול יחד. מתחילים עם דרגות  <1> פתוחות, וכל  <2> דרגות נדרשת רמת עיר גבוהה יותר ורמת גיבור גבוהה יותר.")} slots={[<><b>{t("משותפת לשלוש הקטגוריות")}</b></>, <><span className="nums">1–{INITIAL_WEAPON_UNLOCKED_TIER}</span></>, <><span className="nums">{WEAPON_GATE_EVERY}</span></>]} /></p>
                <TableWrap maxHeight={420}>
                  <table className="guide-table">
                    <thead>
                      <tr>
                        <th className="text-right">{t("דרגה")}</th>
                        <th className="text-right">{t("נשק התקפה")}</th>
                        <th className="text-right">{t("כוח (התקפה/הגנה)")}</th>
                        <th className="text-right">{t("כוח ריגול")}</th>
                        <th className="text-right">{t("מחיר ליחידה")}</th>
                        <th className="text-right">{t("פתיחת הדרגה")}</th>
                        <th className="text-right">{t("דרישות")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weaponsOfCategory("ATTACK").map((w, i) => {
                        const gate = weaponTierGate(w.tier);
                        const unlock = weaponTierUnlockCost(w.tier - 1);
                        // Read the spy figure off the real definition rather
                        // than scaling the attack one — power is rounded, so
                        // the two ladders are not an exact 4/5 of each other.
                        const spyPower = weaponsOfCategory("SPY")[i]?.power ?? 0;
                        return (
                          <tr key={w.tier}>
                            <td className="nums font-black text-gold-bright" dir="ltr">
                              {w.tier}
                            </td>
                            <td className="whitespace-nowrap text-bone">{w.name}</td>
                            <td className="nums text-red-300" dir="ltr">
                              {formatShort(w.power)}
                            </td>
                            <td className="nums text-purple-300" dir="ltr">
                              {formatShort(spyPower)}
                            </td>
                            <td>
                              <Cost
                                amounts={[
                                  { key: "gold", value: w.cost.gold },
                                  { key: "wood", value: w.cost.wood },
                                  { key: "iron", value: w.cost.iron },
                                  { key: "stone", value: w.cost.stone },
                                ]}
                              />
                            </td>
                            <td>
                              {w.tier <= INITIAL_WEAPON_UNLOCKED_TIER ? (
                                <span className="text-[11px] text-emerald-400">{t("פתוח מההתחלה")}</span>
                              ) : (
                                <Cost
                                  amounts={[
                                    { key: "gold", value: unlock.gold },
                                    { key: "wood", value: unlock.wood },
                                    { key: "iron", value: unlock.iron },
                                    { key: "stone", value: unlock.stone },
                                  ]}
                                />
                              )}
                            </td>
                            <td className="whitespace-nowrap text-[11px]">
                              <span className="text-sky-300 nums">{t("עיר")} {gate.cities}</span>
                              {gate.heroLevel > 0 && (
                                <span className="text-purple-300 nums"> {t("· גיבור")} {gate.heroLevel}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(WEAPON_CATEGORY_META) as (keyof typeof WEAPON_CATEGORY_META)[]).map(
                  (cat) => (
                    <div key={cat} className="panel-inset rounded-xl p-3 text-center">
                      <p className="text-lg">{WEAPON_CATEGORY_META[cat].icon}</p>
                      <p className="font-black text-gold-bright">
                        {WEAPON_CATEGORY_META[cat].label}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {WEAPON_CATEGORY_META[cat].powerLabel}
                      </p>
                    </div>
                  )
                )}
              </div>
            </GuideSection>

            {/* ============================ 11 upgrades ============================ */}
            <GuideSection meta={sections.upgrades} index={INDEX.upgrades}>
              <Lead>{t("שישה שדרוגים גלובליים שמשנים כללים, לא מספרים בודדים. רובם חסומים בתקרה — כדי שלא תשקיע לנצח במשהו שכבר מיצה את עצמו.")}</Lead>

              <TableWrap>
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th className="text-right">{t("שדרוג")}</th>
                      <th className="text-right">{t("מה הוא עושה")}</th>
                      <th className="text-right">{t("תקרה")}</th>
                      <th className="text-right">{t("עלות כל הסולם עד התקרה")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EMPIRE_UPGRADE_TYPES.map((type) => {
                      const meta = EMPIRE_UPGRADE_META[type];
                      const max = empireUpgradeMaxLevel(type, MAX_CITIES);
                      const cost = upgradeLadderTotal(type, max);
                      return (
                        <tr key={type}>
                          <td className="whitespace-nowrap">
                            <span className="flex items-center gap-1.5 font-black text-gold-bright">
                              <Icon name={meta.icon} size={15} className="text-crimson" />
                              {meta.label}
                            </span>
                          </td>
                          <td className="text-[11px] leading-snug text-zinc-400">
                            {meta.description}
                          </td>
                          <td className="nums whitespace-nowrap text-sky-300" dir="ltr">
                            {max ?? "∞"}
                          </td>
                          <td>
                            {cost ? (
                              <Cost
                                amounts={[
                                  { key: "gold", value: cost.gold },
                                  { key: "wood", value: cost.wood },
                                  { key: "iron", value: cost.iron },
                                  { key: "stone", value: cost.stone },
                                ]}
                              />
                            ) : (
                              <span className="text-zinc-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>

              <div className="grid gap-3 sm:grid-cols-3">
                <Fact
                  icon="spy"
                  label={t("מודיעין")}
                  value={`+${INTELLIGENCE_MAX_LEVEL * 10}%`}
                  hint={t("10% לרמה, עד רמה {p0}", { p0: INTELLIGENCE_MAX_LEVEL })}
                  tone="text-purple-300"
                />
                <Fact
                  icon="citizens"
                  label={t("קבלת אזרחים")}
                  value={t("עד רמה {max}", {
                    max: MAX_CITIES * CITIZEN_GROWTH_LEVELS_PER_CITY,
                  })}
                  hint={t("{p0} רמות לכל עיר", { p0: CITIZEN_GROWTH_LEVELS_PER_CITY })}
                  tone="text-bone-bright"
                />
                <Fact
                  icon="wheel"
                  label={t("מזל הגלגל")}
                  value={`+${Math.round(wheelLuckBonus(WHEEL_LUCK_MAX_LEVEL) * 100)}%`}
                  hint={t("סיכוי לסיבוב חינם מתקיפה מנצחת")}
                  tone="text-emerald-300"
                />
              </div>

              <Formula
                label={t("עלות שדרוג רגיל (רמה → רמה+1)")}
                expr={
                  <>
                    <N>1,700</N>
                    <O>×</O>
                    <V>{t("רמה")}</V>
                    <V> {t("זהב")}</V>
                    <O>+</O>
                    <N>900</N>
                    <O>×</O>
                    <V>{t("רמה")}</V>
                    <V> {t("עץ/ברזל")}</V>
                    <O>+</O>
                    <N>600</N>
                    <O>×</O>
                    <V>{t("רמה")}</V>
                    <V> {t("אבן")}</V>
                  </>
                }
                legend={[
                  {
                    term: t("שלושה יוצאים מהכלל"),
                    desc: t("הנוסחה הזו היא של השדרוגים הרגילים. שלושה שדרוגים מתומחרים גיאומטרית — כל רמה עולה פי כמה מקודמתה — כי מה שהם נותנים לא נגמר לעולם."),
                  },
                  {
                    term: t("קבלת תורות"),
                    desc: t("תור אחד לעדכון רגיל הוא {p0} תורות ביום, לתמיד. לכן: {p1} זהב לרמה הראשונה, וכל רמה אחריה פי {p2} — עד רמה {p3}.", { p0: nf(TICKS_PER_DAY), p1: nf(turnsUpgradeCost(1).gold), p2: TURNS_UPGRADE_COST_GROWTH, p3: TURNS_UPGRADE_MAX_LEVEL }),
                  },
                  {
                    term: t("ריבית בנק"),
                    desc: t("{p0} זהב לרמה הראשונה וכל רמה אחריה פי {p1}, כי ריבית עובדת על זהב שאי אפשר לבזוז ומצטברת פעמיים ביום. {p2}% הוא פרס של סוף עונה.", { p0: nf(bankInterestUpgradeCost(1).gold), p1: BANK_INTEREST_COST_GROWTH, p2: Math.round(BANK_INTEREST_MAX_RATE * 100) }),
                  },
                  {
                    term: t("מזל הגלגל"),
                    desc: t("היקר במשחק: {p0} זהב לרמה הראשונה, וכל רמה אחריה פי {p1} — {p2} לרמה {p3}. סיבובי גלגל הם המטבע הנדיר במשחק, ולכן כל אחוז כואב.", { p0: nf(wheelLuckUpgradeCost(1).gold), p1: WHEEL_LUCK_COST_GROWTH, p2: nf(wheelLuckUpgradeCost(WHEEL_LUCK_MAX_LEVEL - 1).gold), p3: WHEEL_LUCK_MAX_LEVEL }),
                  },
                ]}
              />
            </GuideSection>

            {/* ============================ 12 monuments ============================ */}
            <GuideSection meta={sections.monuments} index={INDEX.monuments}>
              <Lead><RichText text={t("בשליש האחרון של עונה השדרוגים נגמרים והזהב ממשיך להיערם. מבנה הוא התשובה לזה, והוא הסוג היחיד של תשובה שמחזיק לנצח:  <0>. חמישה מבנים,  <1> רמות לכל אחד,  <2> לרמה.")} slots={[<><b>{t("בור זהב שמשלם באחוזים")}</b></>, <><b className="nums">{MONUMENT_MAX_LEVEL}</b></>, <><b className="nums">+{MONUMENT_PCT_PER_LEVEL}%</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {MONUMENTS.map((monument) => (
                  <div key={monument.key} className="panel-gold rounded-xl p-4">
                    <p className="flex items-center gap-2 font-black text-gold-bright">
                      <Icon name={monument.icon} size={18} className="text-crimson-bright" />
                      {monument.name}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                      {monument.lore}
                    </p>
                    <p className="mt-2 text-[11px] text-emerald-300">{t("{p0}  (בשיא)", { p0: fillParams(monument.effectLabel, {
                        pct: MONUMENT_PCT_PER_LEVEL * MONUMENT_MAX_LEVEL,
                      }) })}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="stone"
                  label={t("רמות בכל מבנה")}
                  value={MONUMENT_MAX_LEVEL}
                  hint={t("+{p0}% לרמה", { p0: MONUMENT_PCT_PER_LEVEL })}
                />
                <Fact
                  icon="gold"
                  label={t("הרמה הראשונה")}
                  value={formatShort(monumentCost(0) ?? 0)}
                  hint={t("זהב")}
                  tone="text-gold-bright"
                />
                <Fact
                  icon="gold"
                  label={t("הרמה האחרונה")}
                  value={formatShort(monumentCost(MONUMENT_MAX_LEVEL - 1) ?? 0)}
                  hint={t("×{p0} בכל רמה", { p0: MONUMENT_COST_GROWTH.toFixed(2) })}
                  tone="text-crimson-bright"
                />
                <Fact
                  icon="crown"
                  label={t("כל החמישה, מלאים")}
                  value={formatShort(monumentTotalCost() * MONUMENTS.length)}
                  hint={t("פרויקט של עונה שלמה")}
                  tone="text-purple-300"
                />
              </div>

              <Formula
                label={t("למה הסולם לא בורח")}
                expr={
                  <>
                    <V>{t("מחיר")}</V>
                    <O>×</O>
                    <N>{MONUMENT_COST_GROWTH.toFixed(2)}</N>
                    <O>{t("לרמה, מול")}</O>
                    <V>{t("תשואה")}</V>
                    <O>+</O>
                    <N>{MONUMENT_PCT_PER_LEVEL}</N>
                    <O>{t("נקודות אחוז לרמה")}</O>
                  </>
                }
                legend={[
                  {
                    term: t("המחיר גיאומטרי, התשואה קווית"),
                    desc: t("כל רמה עולה פי שניים בערך מקודמתה ומשלמת בדיוק אותן שתי נקודות אחוז — לכן מבנה אף פעם לא מחזיר את עצמו מהר יותר משהוא עולה."),
                  },
                  {
                    term: t("אבל הוא גם לא מתיישן"),
                    desc: t("בגלל שהפרס הוא אחוז, הוא גדל יחד עם ההכנסה שקנתה אותו. פרס קבוע היה הופך לחסר ערך בעוד שבועיים; אחוז לא."),
                  },
                  {
                    term: t("הכול נכנס בעדכון"),
                    desc: t("כל חמשת האפקטים מוחלים על ידי שעון המשחק בלבד — אין כפתור להפעיל ואין תפוגה לעקוב אחריה."),
                  },
                ]}
              />

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("רמה")}</th>
                      <th>{t("מחיר הרמה")}</th>
                      <th>{t("הבונוס אחריה")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: MONUMENT_MAX_LEVEL }, (_, held) => (
                      <tr key={held}>
                        <td className="nums" dir="ltr">
                          {held} → {held + 1}
                        </td>
                        <td>
                          <Cost amounts={[{ key: "gold", value: monumentCost(held) ?? 0 }]} />
                        </td>
                        <td className="nums text-emerald-300" dir="ltr">
                          +{MONUMENT_PCT_PER_LEVEL * (held + 1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <Note tone="gold" icon="attack" title={t("אף מבנה לא נוגע בקרב")}><RichText text={t("לא בתקיפה, לא בהגנה ולא בריגול. מבנה קונה <0> — מכרות, תורות, אזרחים, ריבית וסיבובי גלגל — והקריאה הישרה של זה היא שזהב קנה לך עוד זהב, לא ניצחון. דוח הקרב מפרט כל מרכיב של חישוב הכוח, ומודיפייר שהיה מסתתר מחוץ לדוח היה הופך אותו לשקר.")} slots={[<><b>{t("הכנסה")}</b></>]} /></Note>
            </GuideSection>

            {/* ============================ 13 battle ============================ */}
            <GuideSection meta={sections.battle} index={INDEX.battle}>
              <Lead><RichText text={t("קרב בקראלדור הוא <0> — אין קובייה ואין מזל. שני מספרים מושווים, והגדול מנצח. זה אומר שכל תקיפה ניתנת לחישוב מראש, וזה בדיוק מה שהמחשבון למטה עושה.")} slots={[<><b>{t("דטרמיניסטי")}</b></>]} /></Lead>

              <div className="grid gap-4 md:grid-cols-2">
                <Formula
                  label={t("כוח התוקף")}
                  expr={
                    <>
                      <O>(</O>
                      <V>{t("חיילים")}</V>
                      <O>×</O>
                      <N>{SOLDIER_POWER}</N>
                      <O>+</O>
                      <V>{t("נשקי התקפה")}</V>
                      <O>)</O>
                      <O>×</O>
                      <V>{t("גיבור")}</V>
                      <O>×</O>
                      <V>{t("קסם ברית")}</V>
                      <O>+</O>
                      <V>{t("עזרת ברית")}</V>
                    </>
                  }
                />
                <Formula
                  label={t("כוח המגן")}
                  expr={
                    <>
                      <O>(</O>
                      <V>{t("חיילים")}</V>
                      <O>×</O>
                      <N>{SOLDIER_POWER}</N>
                      <O>+</O>
                      <V>{t("נשקי הגנה")}</V>
                      <O>)</O>
                      <O>×</O>
                      <N>{tunables.battle.defenseBonus}</N>
                      <O>×</O>
                      <V>{t("גיבור")}</V>
                      <O>×</O>
                      <V>{t("קסם ברית")}</V>
                      <O>+</O>
                      <V>{t("עזרת ברית")}</V>
                    </>
                  }
                  legend={[
                    {
                      term: `×${tunables.battle.defenseBonus}`,
                      desc: t("בונוס המגן — {p0}% מתנה קבועה לצד המתגונן.", { p0: Math.round((tunables.battle.defenseBonus - 1) * 100) }),
                    },
                  ]}
                />
              </div>

              <div className="panel-inset rounded-xl px-4 py-3 text-center text-sm">
                <span className="font-black text-red-300">{t("כוח התקפה")}</span>
                <span className="mx-2 text-2xl font-black text-gold-bright">&gt;</span>
                <span className="font-black text-sky-300">{t("כוח הגנה")}</span>
                <span className="mx-3 text-zinc-500">⟵</span>
                <span className="text-zinc-300">{t("שוויון = המגן מנצח")}</span>
              </div>

              <BattleCalc
                defenseBonus={tunables.battle.defenseBonus}
                plunderRate={tunables.battle.plunderRate}
                enslaveRate={tunables.battle.enslaveRate}
                enslaveMin={tunables.battle.enslaveMinSoldiers}
              />

              <div>
                <p className="mb-2 text-sm font-black text-gold-bright">{t("מה מקבלים בניצחון")}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact
                    icon="gold"
                    label={t("ביזה")}
                    value={`${Math.round(tunables.battle.plunderRate * 100)}%`}
                    hint={t("מכל משאב זמין של המגן")}
                  />
                  <Fact
                    icon="army"
                    label={t("שבויים")}
                    value={`${Math.round(tunables.battle.enslaveRate * 100)}%`}
                    hint={t("אם למגן {p0}+ חיילים", { p0: tunables.battle.enslaveMinSoldiers })}
                    tone="text-bone-bright"
                  />
                  <Fact
                    icon="spark"
                    label={t("סיכוי לחפץ")}
                    value={`${(ITEM_DROP_CHANCE * 100).toFixed(1)}%`}
                    hint={t("מתוכם 0.5% אגדי")}
                    tone="text-purple-300"
                  />
                  <Fact
                    icon="potion"
                    label={t("סיכוי לשיקוי")}
                    value={`${Math.round(POTION_DROP_CHANCE * 100)}%`}
                    hint={t("שעה של חוק שבור")}
                    tone="text-emerald-300"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Note tone="gold" icon="turns" title={t("עלות")}><RichText text={t("תקיפה עולה <0> תורות, בין אם ניצחת ובין אם נהדפת. ריגול עולה  <1>.")} slots={[<><b className="nums">{tunables.battle.attackTurnCost}</b></>, <><b className="nums">{tunables.battle.spyTurnCost}</b></>]} /></Note>
                <Note tone="red" icon="heart" title={t("הגנה שנפרצת פוגעת בגיבור")}><RichText text={t("כל תקיפה שפורצת את ההגנה שלך מורידה  <0> נקודות חיים מהגיבור. באפס — הוא מת, וכל הבונוסים שלו כבים.")} slots={[<><b className="nums">{HERO_DAMAGE_PER_LOST_DEFENSE}</b></>]} /></Note>
              </div>
            </GuideSection>

            {/* ========================== 14 fervor ========================== */}
            <GuideSection meta={sections.fervor} index={INDEX.fervor}>
              <Lead><RichText text={t("התורות שלך נצברות כרגיל גם כשאתה לא מחובר — זה לא משתנה, ולא ישתנה. להט הקרב לא נותן לך יותר תורות; הוא קובע כמה כל תורה שאתה מוציא <0>. כל פעולה שאתה עושה מחממת את המד, וכשהוא לוהט — הביזה שאתה לוקח מאימפריה מובסת גדולה יותר.")} slots={[<><b> {t("שווה")}</b></>]} /></Lead>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> איך מחממים")} slots={[<><Icon name="spark" size={18} /></>]} /></p>
                  <ul className="space-y-1.5 text-[0.8rem] text-zinc-300">
                    <li>{t("• כל פעולה מוסיפה נקודה — תקיפה, ריגול, שדרוג, אימון, מיני-משחק, גלגל, מסע")}</li>
                    <li><RichText text={t("• נקודה דועכת כל  <0> דקות")} slots={[<><b className="nums">{FERVOR_DECAY_MS / 60_000}</b></>]} /></li>
                    <li><RichText text={t("• המד עוצר ב-<0> נקודות — אי אפשר לאגור חום להמשך היום")} slots={[<><b className="nums">{FERVOR_CAP}</b></>]} /></li>
                  </ul>
                  <p className="mt-2 text-[11px] text-zinc-500">{t("לשבת עם החלון פתוח לא שווה כלום. רק פעולות מחממות.")}</p>
                </div>

                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> הדרגות")} slots={[<><Icon name="gold" size={18} /></>]} /></p>
                  <ul className="space-y-1.5 text-[0.8rem] text-zinc-300">
                    {FERVOR_TIERS.map((tier) => (
                      <li key={tier.key}><RichText text={t("• <0> — מ-<1>  נקודות:  <2>  ביזה")} slots={[<><b>{tier.label}</b></>, <><span className="nums">{tier.min}</span></>, <><b className="nums text-amber-300" dir="ltr"> ×{tier.mult} </b></>]} /></li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-zinc-500">{t("המד יושב בשורה העליונה, ליד שעון העדכון.")}</p>
                </div>
              </div>

              <Formula
                label={t("ביזה בתקיפה מנצחת")}
                expr={
                  <>
                    <N>{Math.round(tunables.battle.plunderRate * 100)}%</N>
                    <O>×</O>
                    <V>{t("להט הקרב")}</V>
                    <O>×</O>
                    <V>{t("שיקוי השפע")}</V>
                    <O>×</O>
                    <V>{t("שעה שמחה")}</V>
                    <O>=</O>
                    <R>{t("אחוז מהמשאבים הלא-מופקדים של המגן")}</R>
                  </>
                }
                example={
                  <RichText
                    text={t(
                      "בלי להט תיקח <0>. ב**שריפה** תיקח <1> — מאויב עם <2> זהב זה ההבדל בין <3> ל־<4>."
                    )}
                    slots={[
                      <N key="cold">{Math.round(tunables.battle.plunderRate * 100)}%</N>,
                      <N key="hot">
                        {Math.round(
                          tunables.battle.plunderRate *
                            FERVOR_TIERS[FERVOR_TIERS.length - 1].mult *
                            100
                        )}
                        %
                      </N>,
                      <N key="pot">10,000</N>,
                      <R key="from">
                        {nf(10_000 * tunables.battle.plunderRate)}
                      </R>,
                      <R key="to">
                        {nf(
                          10_000 *
                            tunables.battle.plunderRate *
                            FERVOR_TIERS[FERVOR_TIERS.length - 1].mult
                        )}
                      </R>,
                    ]}
                  />
                }
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Note tone="gold" icon="attack" title={t("עד {p0} תקיפות ביום", { p0: FERVOR_MAX_HOT_ATTACKS })}><RichText text={t("הלהט משלם על  <0> תקיפות מנצחות ביום, ולא יותר. אם לא הגעת למספר הזה — הוא לא נוגע בך בכלל, וכל פשיטה שלך לוהטת. תקיפה שהפסדת, או שלא הביאה כלום, לא מבזבזת מהמכסה.")} slots={[<><b className="nums">{FERVOR_MAX_HOT_ATTACKS}</b></>]} /></Note>
                <Note tone="green" icon="turns" title={t("לא מפסידים כלום בהיעדרות")}>{t("יצאת ליומיים? כל התורות ממתינות לך, עד האחרונה. להט הקרב לא לוקח ממך שום דבר שהיה לך — הוא רק מוסיף למי שנמצא כאן עכשיו. שחקן שנכנס פעם ביום מבצע בדיוק את אותן תקיפות.")}</Note>
              </div>
            </GuideSection>

            {/* ============================ 15 spy ============================ */}
            <GuideSection meta={sections.spy} index={INDEX.spy}>
              <Lead>{t("ריגול נפתר בדיוק כמו קרב — השוואת מספרים, בלי הגרלה. ההבדל: המגן מתגונן רק עם המרגלים, נשקי הריגול ושדרוג המודיעין שלו — בלי בונוס גיבור ובלי קסמים.")}</Lead>

              <Formula
                label={t("כוח מודיעין")}
                expr={
                  <>
                    <O>(</O>
                    <V>{t("מרגלים")}</V>
                    <O>×</O>
                    <N>{SPY_POWER}</N>
                    <O>+</O>
                    <V>{t("נשקי ריגול")}</V>
                    <O>)</O>
                    <O>×</O>
                    <O>(</O>
                    <N>1</N>
                    <O>+</O>
                    <V>{t("רמת מודיעין")}</V>
                    <O>×</O>
                    <N>0.1</N>
                    <O>+</O>
                    <V>{t("גיבור%")}</V>
                    <O>)</O>
                  </>
                }
                legend={[
                  { term: t("התוקף בלבד"), desc: t("בונוס הגיבור נספר רק לתוקף.") },
                  { term: t("תיקו נכשל"), desc: t("צריך להיות גדול ממש מכוח המודיעין של היעד.") },
                ]}
                example={
                  <>
                    <N>300</N> {t("מרגלים +")} <N>8,000</N> {t("כוח נשק =")}{" "}
                    <N>11,000</N>{t("; עם מודיעין רמה")} <N>8</N> {t("ובונוס גיבור")}{" "}
                    <N>15%</N> — <R>{nf(11000 * (1.8 + 0.15))}</R> {t("כוח מודיעין.")}
                  </>
                }
              />

              <SpyCalc />

              <div className="grid gap-3 sm:grid-cols-2">
                <Note tone="purple" icon="spy" title={t("הצלחה = התיק המלא")}><RichText text={t("ריגול מוצלח מביא <0>: משאבים גלויים ומחסנים, יתרת הבנק, כל פריט נשק, המבנים, השדרוגים, הצבא, הגיבור וציודו — וכל קסם, שיקוי ומגן שפועלים עליו, עם <1>. <2>.")} slots={[<><b>{t("הכל")}</b></>, <><b>{t("הזמן שנותר לכל אחד")}</b></>, <><b>{t("והיעד לא יודע שרוגל")}</b></>]} /></Note>
                <Note tone="red" icon="messages" title={t("כישלון = התראה")}>{t("מרגל שנתפס מפעיל התראה אצל היעד, שרואה מי ניסה. זה גם מה שפותח לו את האפשרות לשלוח לך הודעה.")}</Note>
              </div>
            </GuideSection>

            {/* ============================ 15 sabotage ============================ */}
            <GuideSection meta={sections.sabotage} index={INDEX.sabotage}>
              <Lead><RichText text={t("ריגול רגיל רק מסתכל. <0> היא מה שהמרגלים שלך עושים כשאתה מפסיק לבקש מהם להסתכל: שלוש משימות שיוצאות מאותו לוח דוסיה של היעד, נפתרות לפי אותה השוואת מודיעין, ולוקחות משהו אמיתי. הן חולקות כל כלל של ריגול — אותה דרגת ערים בלבד, אותו מגן שחקן חדש, ותקיפה שמפילה את המגן שלך.")} slots={[<><b>{t("חבלה")}</b></>]} /></Lead>

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("משימה")}</th>
                      <th>{t("מרגלים")}</th>
                      <th>{t("תורות")}</th>
                      <th>{t("מה נלקח")}</th>
                      <th>{t("נחסמת על ידי")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SABOTAGE_MISSIONS.map((mission) => (
                      <tr key={mission.kind}>
                        <td className="whitespace-nowrap">
                          <Icon name={mission.icon} size={13} className="ms-1 inline text-gold" />
                          <b className="text-bone">{mission.name}</b>
                          <p className="max-w-xs whitespace-normal text-[0.7rem] text-zinc-500">
                            {mission.blurb}
                          </p>
                        </td>
                        <td className="nums" dir="ltr">
                          {mission.spies}
                        </td>
                        <td className="nums" dir="ltr">
                          {mission.turns}
                        </td>
                        <td className="nums text-crimson-bright" dir="ltr">
                          {Math.round(mission.share * 100)}%
                        </td>
                        <td className="text-zinc-400">
                          {mission.shield === "resources" ? t("מגן משאבים") : t("מגן חיילים")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <Formula
                label={t("האם המשימה נכנסת")}
                expr={
                  <>
                    <V>{t("המודיעין שלך")}</V>
                    <O>&gt;</O>
                    <V>{t("המודיעין של היעד")}</V>
                    <O>×</O>
                    <N>{SABOTAGE_INTEL_MARGIN}</N>
                  </>
                }
                legend={[
                  {
                    term: t("יתרון, לא ניצחון בשערה"),
                    desc: t("ריגול רגיל מספיק לו להיות גדול ב־1. חבלה דורשת שליש יותר מודיעין — לשרוף מחסן זו לא אותה שליחות כמו לספור חיילים."),
                  },
                  {
                    term: t("כישלון עולה במרגלים"),
                    desc: t("המרגלים שהתחייבת אליהם אבודים, והתורות יורדות בכל מקרה. חבלה היא הימור, לא סריקה."),
                  },
                  {
                    term: t("השבר תמיד לטובת היעד"),
                    desc: t("הכמות מעוגלת כלפי מטה — מי שמחזיק תשע יחידות מאבד אחת ב־12%, לא שתיים."),
                  },
                  {
                    term: t("שוד הגנזך לוקח לכיס שלך"),
                    desc: t("הזהב עובר אליך; ההצתה וההרעלה רק משמידות. לכן שריפה פוגעת במלאי המוגן במחסנים, וגניבה ביתרה הזמינה."),
                  },
                ]}
              />

              <Note tone="red" icon="army" title={t("חבלה לעולם לא נוגעת בצבא")}><RichText text={t("לא בחיילים, לא בנשקים ולא בכוח. הסיבה היא החוזה של המשחק מול השחקנים: צבא נהרס בקרבות שיש עליהם <0>. מרגל שיכול היה למחוק צבא בשקט היה הופך את הדירוג ללא קריא ואת הדוחות לשקר. מה שנלקח הוא הכלכלה — מלאי, זהב ועבדי מכרות — והיא חוזרת.")} slots={[<><b>{t("דוח")}</b></>]} /></Note>
            </GuideSection>

            {/* ============================ 16 hero ============================ */}
            <GuideSection meta={sections.hero} index={INDEX.hero}>
              <Lead>{t("הגיבור הוא המכפיל האישי שלך: הוא לא נלחם בעצמו, הוא מחזק את כל מה שיש לך. הוא עולה רמות מקרבות, מקצה נקודות, לובש חפצים — וגם מת.")}</Lead>

              <div>
                <p className="mb-2 text-sm font-black text-gold-bright">{t("ארבעת המקצועות — נבחרים בהרשמה, ולתמיד")}</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {HERO_CLASS_ORDER.map((cls) => {
                    const meta = HERO_CLASS_META[cls];
                    return (
                      <article
                        key={cls}
                        className="overflow-hidden rounded-xl border"
                        style={{
                          borderColor: `rgb(${meta.accent} / 0.4)`,
                          background: `linear-gradient(180deg, rgb(${meta.accent} / 0.12), rgba(10,9,12,0.92))`,
                        }}
                      >
                        <div className="relative h-40 overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={heroClassImage(cls)}
                            alt={meta.label}
                            loading="lazy"
                            className="h-full w-full object-cover object-[50%_18%]"
                          />
                          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#0a090c] to-transparent" />
                          <p
                            className="absolute bottom-2 right-3 text-lg font-black"
                            style={{ color: `rgb(${meta.accent})` }}
                          >
                            {meta.label}
                          </p>
                        </div>
                        <div className="p-3">
                          <p className="text-[11px] italic text-zinc-400">{t("״{p0}״", { p0: meta.tagline })}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                            {meta.description}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {heroClassBonusLines(cls).map((b) => (
                              <span
                                key={b.label}
                                className="flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300"
                              >
                                <Icon name={b.icon} size={11} />+{b.pct}% {b.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <Formula
                label={t("ניסיון לרמה הבאה")}
                expr={
                  <>
                    <N>120</N>
                    <O>+</O>
                    <O>(</O>
                    <V>{t("רמה")}</V>
                    <O>−</O>
                    <N>1</N>
                    <O>)</O>
                    <O>×</O>
                    <N>35</N>
                  </>
                }
                legend={[
                  {
                    term: t("נקודה לרמה"),
                    desc: t("כל רמה = נקודה אחת = +1% התקפה/הגנה/תפוקה. גיבור רמה 16 מחזיק 16 נקודות, ורמה 100 — 100."),
                  },
                  { term: t("+{p0} אזרחים", { p0: CITIZENS_PER_LEVEL }), desc: t("כל עליית רמה מביאה גם אזרחים.") },
                ]}
                example={
                  <RichText
                    text={t(
                      "רמה <0> דורשת <1> נק׳, רמה <2> דורשת <3>, ורמה <4> דורשת <5>."
                    )}
                    slots={[
                      <N key="l1">1</N>,
                      <N key="x1">{xpToNextLevel(1)}</N>,
                      <N key="l50">50</N>,
                      <N key="x50">{nf(xpToNextLevel(50))}</N>,
                      <N key="l99">99</N>,
                      <N key="x99">{nf(xpToNextLevel(99))}</N>,
                    ]}
                  />
                }
              />

              <Formula
                label={t("ניסיון מתקיפה מנצחת")}
                expr={
                  <>
                    <O>(</O>
                    <N>40</N>
                    <O>+</O>
                    <V>{t("רמת הגיבור שלך")}</V>
                    <O>×</O>
                    <N>10</N>
                    <O>)</O>
                    <O>×</O>
                    <V>{t("פער רמות")}</V>
                    <O>×</O>
                    <V>{t("פער איפוסים")}</V>
                    <O>×</O>
                    <V>{t("יחס קרב")}</V>
                    <O>,</O>
                    <V>{t("ולפחות הרצפה")}</V>
                  </>
                }
                legend={[
                  {
                    term: t("רמה אפקטיבית"),
                    desc: t("רמה + איפוסים × {p0}. איפוס מחזיר לרמה 1 אך הוותק נשאר, ולכן יריב ברמה 1 אחרי איפוס אחד נחשב רמה {p1}.", { p0: RESET_LEVEL_EQUIV, p1: RESET_LEVEL_EQUIV + 1 }),
                  },
                  {
                    term: t("פער רמות"),
                    desc: t("0.25 + (הרמה האפקטיבית של היריב ÷ שלך) × 0.75, חסום ב־{p0}–{p1}. יריב שקול = ×1, גבוה ממך = יותר, נמוך ממך = קצת.", { p0: MIN_LEVEL_GAP_XP_FACTOR, p1: MAX_LEVEL_GAP_XP_FACTOR }),
                  },
                  {
                    term: t("פער איפוסים"),
                    desc: t("יריב עם מספר האיפוסים שלך או יותר משלם ניסיון מלא. על כל איפוס שאתה מעליו — הניסיון נחתך בחצי, עד רצפה של ×{p0}. אחרי איפוס אתה מטפס מחדש מול בני המשקל שלך: לרמוס מי שמעולם לא איפס כמעט לא מקדם אותך.", { p0: MIN_RESET_GAP_XP_FACTOR }),
                  },
                  {
                    term: t("יחס קרב"),
                    desc: t("0.3 + שורש שלישי של (כוח היריב ÷ כוחך) × 1.4, חסום ב־0.3–2.0. השורש קורא את הפער בסדרי גודל ולא באחוזים — כך שגם קרב שבו היריב חלש ממך פי כמה עדיין משלם יותר מהמינימום."),
                  },
                  {
                    term: t("רצפת ניצחון"),
                    desc: t("כל ניצחון משלם לפחות חלק אחד מ־{p0} מהניסיון הדרוש לרמה שאתה עומד בה — לא משנה כמה איפוסים מאחוריך, באיזו רמה אתה ומי היריב. ארבעת המקדמים קובעים כמה ניצחון שווה; הם לעולם לא קובעים שהוא לא שווה כלום.", { p0: MAX_WINS_PER_LEVEL }),
                  },
                  {
                    term: t("רק תקיפה משלמת"),
                    desc: t("הדיפת התקפה לא מזכה בניסיון כלל — הפרס על הגנה הוא שלא נלקח ממך דבר. הגיבור מתקדם רק כשיוצאים לקרב."),
                  },
                ]}
              />

              <HeroXpCalc />

              <div className="grid gap-3 md:grid-cols-3">
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-1 flex items-center gap-2 font-black text-red-300"><RichText text={t("<0> חיים ומוות")} slots={[<><Icon name="heart" size={18} /></>]} /></p>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
                    <li><RichText text={t("• מתחיל ב־<0>")} slots={[<><b className="nums">{HERO_MAX_HEALTH}</b></>]} /></li>
                    <li><RichText text={t("• <0> בכל הגנה שנפרצת")} slots={[<><b className="nums">−{HERO_DAMAGE_PER_LOST_DEFENSE}</b></>]} /></li>
                    <li>{t("• באפס: כל הבונוסים כבים — נקודות, חפצים ומקצוע")}</li>
                    <li><RichText text={t("• קם לתחייה אחרי <0> שעה, או מיידית ב־<1> יהלומים — בכפתור שבראש עמוד הגיבור")} slots={[<><b className="nums">{HERO_REVIVE_HOURS}</b></>, <><b className="nums">{HERO_REVIVE_COST}</b></>]} /></li>
                  </ul>
                </div>
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-1 flex items-center gap-2 font-black text-purple-300"><RichText text={t("<0> איפוס (יוקרה ↻)")} slots={[<><Icon name="crown" size={18} /></>]} /></p>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
                    <li><RichText text={t("• זמין ברמה <0>")} slots={[<><b className="nums">{HERO_MAX_LEVEL}</b></>]} /></li>
                    <li><RichText text={t("• חוזר לרמה 1 עם <0> אזרחים ו־<1> תורות")} slots={[<><b className="nums">+{nf(HERO_RESET_CITIZENS)}</b></>, <><b className="nums">+{nf(HERO_RESET_TURNS)}</b></>]} /></li>
                    <li><RichText text={t("• כל איפוס מוסיף <0> נקודות פתיחה לצמיתות: אחרי איפוס אחד מגיעים לרמה {p0} עם  <1> נקודות, אחרי שניים עם <2>", { p0: HERO_MAX_LEVEL })} slots={[<><b className="nums">+{HERO_RESET_POINTS}</b></>, <><b className="nums">{heroPointPool(HERO_MAX_LEVEL, 1)}</b></>, <><b className="nums">{heroPointPool(HERO_MAX_LEVEL, 2)}</b></>]} /></li>
                    <li>{t("• הציוד הלבוש נשאר עליך וממשיך לפעול — אך חפץ שתסיר יינעל בתיק עד שתחזור לרמתו")}</li>
                    <li>{t("• תג ↻ קבוע — וכל איפוס נחשב {p0} רמות בחישוב הניסיון, כך שגם ברמה 1 מי שמנצח אותך מקבל ניסיון של יריב ותיק", { p0: RESET_LEVEL_EQUIV })}</li>
                    <li>{t("• הטיפוס מחדש הוא מול בני המשקל שלך: תקיפת יריב עם פחות איפוסים ממך משלמת חצי ניסיון על כל איפוס שאתה מעליו")}</li>
                    <li>{t("• אבל אף פעם לא כלום: כל ניצחון משלם לפחות חלק אחד מ־{p0} מהרמה שאתה עומד בה, בכל מספר איפוסים", { p0: MAX_WINS_PER_LEVEL })}</li>
                  </ul>
                </div>
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-1 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> נקודות ותיק")} slots={[<><Icon name="shop" size={18} /></>]} /></p>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
                    <li>{t("• 1 נקודה = +1% התקפה / הגנה / תפוקת מכרות")}</li>
                    <li><RichText text={t("• התיק מחזיק <0> חפצים לא לבושים — תיק מלא חוסם שלל חדש")} slots={[<><b className="nums">{HERO_BAG_CAPACITY}</b></>]} /></li>
                    <li><RichText text={t("• איפוס הקצאת נקודות: <0>  יהלומים")} slots={[<><b className="nums">{HERO_POINTS_RESET_COST}</b></>]} /></li>
                  </ul>
                </div>
              </div>
            </GuideSection>

            {/* ============================ 17 items ============================ */}
            <GuideSection meta={sections.items} index={INDEX.items}>
              <Lead>{t("תשעה מקומות על הגיבור, כל אחד עם סטטיסטיקה משלו. חפץ נקבע לחלוטין מהמקום והרמה שלו — שני חפצים באותה משבצת ובאותה רמה זהים תמיד.")}</Lead>

              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
                {SLOT_ORDER.map((slot) => {
                  const meta = SLOT_META[slot];
                  const cap = itemPrimaryBonus(slot, HERO_MAX_LEVEL);
                  return (
                    <div key={slot} className="panel-inset rounded-xl p-2 text-center">
                      <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
                        <span className="absolute text-2xl opacity-60" aria-hidden>
                          {meta.icon}
                        </span>
                        {/* the top set, matching the level-100 caps quoted below */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={heroItemArtPath(meta.slug, HERO_MAX_LEVEL)}
                          alt={meta.label}
                          loading="lazy"
                          className="relative h-full w-full object-contain"
                        />
                      </div>
                      <p className="mt-1 text-[11px] font-black text-bone-bright">
                        {t(meta.label)}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        <RichText
                          text={t("עד <0>")}
                          slots={[
                            <>
                              <span className="nums text-emerald-300">
                                {cap.flat ? `+${cap.value}` : `+${cap.value}%`}
                              </span>
                            </>,
                          ]}
                        />
                        {itemBonusLines(slot, HERO_MAX_LEVEL).filter((l) => !l.primary).length > 0 && (
                          <span className="mt-0.5 block text-[9px] text-zinc-600">
                            {"+ "}
                            {[
                              ...new Set(
                                itemBonusLines(slot, HERO_MAX_LEVEL)
                                  .filter((l) => !l.primary)
                                  .map((l) => t(l.label))
                              ),
                            ].join(" · ")}
                          </span>
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* the ten sets — one look per decade of item level */}
              <div className="panel-inset rounded-xl p-4">
                <p className="mb-2 text-sm font-black text-gold-bright">{t("עשרת הסטים")}</p>
                <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">{t("כל עשר רמות מתחלף הסט: תשעת החפצים מצוירים מחדש בחומר יקר יותר, מעור ונחושת ועד לזהב לבן זוהר. הרמה קובעת את הבונוס — הסט קובע איך זה נראה על הגיבור.")}</p>
                <p className="mb-3 text-[11px] leading-relaxed text-amber-300/90"><RichText text={t("<0> זהב מעלה חפץ רק בתוך הסט שלו — פשוט → מתקדם → אליט → אגדי — ושם הוא נעצר. אגדי לא משודרג יותר, ולא משנה באיזו רמה הוא. הדרך היחידה לסט הבא היא לשלול חפץ ממנו בקרב.")} slots={[<><b>{t("לכל סט יש מקסימום משלו:")}</b></>]} /></p>
                <div className="grid grid-cols-5 gap-2 lg:grid-cols-10">
                  {HERO_ITEM_SETS.map((set) => (
                    <div key={set.dir} className="text-center">
                      <div className="relative mx-auto flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={heroItemArtPath(SLOT_META.SWORD.slug, set.to)}
                          alt={set.label}
                          loading="lazy"
                          className="h-full w-full object-contain p-0.5"
                        />
                      </div>
                      <p className="mt-1 text-[10px] font-black text-bone-bright">{set.label}</p>
                      <p className="nums text-[10px] text-zinc-500" dir="ltr">
                        {set.from}–{set.to}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel-inset rounded-xl p-4">
                  <p className="mb-2 text-sm font-black text-gold-bright">{t("דרגות איכות")}</p>
                  <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">{t("הדרגה נגזרת מהרמה, והסדרה חוזרת על עצמה בכל עשור רמות: רמות 1–2 פשוט, 3–7 מתקדם, 8–9 אליט, 10 אגדי — ואז שוב, עשור אחד גבוה יותר. אגדי סוגר את הסט: אין לאן לשדרג אותו.")}</p>
                  <table className="guide-table">
                    <thead>
                      <tr>
                        <th className="text-right">{t("דרגה")}</th>
                        <th className="text-right">{t("מיקום בעשור")}</th>
                        <th className="text-right">{t("סיכוי בתקיפה מנצחת")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RARITY_ORDER.map((r) => {
                        const chance = ITEM_DROP_CHANCE_BY_RARITY[r] * 100;
                        return (
                          <tr key={r}>
                            <td>
                              <span className={`flex items-center gap-2 font-black ${RARITY_META[r].tone}`}>
                                <span className="guide-rarity-dot" />
                                {RARITY_META[r].label}
                              </span>
                            </td>
                            <td className="nums text-zinc-400" dir="ltr">
                              {r === "COMMON" ? "1–2" : r === "RARE" ? "3–7" : r === "EPIC" ? "8–9" : "10"}
                            </td>
                            <td className="nums font-bold text-gold-bright" dir="ltr">
                              {Number.isInteger(chance) ? chance : chance.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td className="font-black text-bone-bright">{t("סה״כ")}</td>
                        <td />
                        <td className="nums font-black text-emerald-300" dir="ltr">
                          {(ITEM_DROP_CHANCE * 100).toFixed(1)}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <Formula
                  label={t("הבונוס של חפץ — משאבים בסולם גיאומטרי, אחוזים בקו ישר")}
                  expr={
                    <>
                      <V>{t("ערך בדרגה 1")}</V>
                      <O>×</O>
                      <V>{flatCurveGrowth("resources")!.toFixed(3)}</V>
                      <sup className="text-gold-dim">{t("דרגה − 1")}</sup>
                      <O>×</O>
                      <V>{t("משקל (ראשי / משני)")}</V>
                    </>
                  }
                  legend={[
                    { term: t("ראשי"), desc: t("הסטט שהמשבצת קיימת בשבילו — משקל מלא.") },
                    {
                      term: t("משני"),
                      desc: t("חצי מהמשקל במשבצת מתמחה (כפפות, שריון), או 0.35 ו־0.25 במשבצת שמפצלת בין שניים."),
                    },
                    {
                      term: t("משאבים"),
                      desc: t("כל שדרוג מכפיל את הכמות פי {p0} — אותם +{p1}% בכל דרגה, מהראשונה ועד הארבעים. חפץ ראשי ברמה 1 נותן {p2} לעדכון רגיל, ברמה 50 כבר {p3}, וברמה 100 {p4}. הסולם הזה עולה כמעט בדיוק בקצב שבו מחיר השדרוג עולה, ולכן הזהב קונה אותו ערך בכל נקודה בסולם.", { p0: flatCurveGrowth("resources")!.toFixed(3), p1: Math.round((flatCurveGrowth("resources")! - 1) * 100), p2: formatNumber(itemPrimaryBonus("RELIC", 1).value), p3: formatNumber(itemPrimaryBonus("RELIC", 50).value), p4: formatNumber(itemPrimaryBonus("RELIC", HERO_MAX_LEVEL).value) }),
                    },
                    {
                      term: t("אחוזים"),
                      desc: t("לא בחזקה — 1% לכל דרגה, ישר: +{p0}% ברמה 100 כראשי, +{p1}% כמשני. אחוז שווה חלק יחסי מהצבא שלך, ולכן הוא הגיוני באותה מידה בכל רמה.", { p0: itemPrimaryBonus("SWORD", HERO_MAX_LEVEL).value, p1: itemStatBonus("GAUNTLETS", HERO_MAX_LEVEL, "defense") }),
                    },
                    {
                      term: t("אזרחים ותורות"),
                      desc: t("אלה לא רצים עם הכלכלה — בניין הגידול משלם כמות קבועה בכל עדכון יומי, ושדרוג התורות משלם רמה אחת בכל עדכון רגיל — ולכן שניהם עולים בחזקת הדרגה ובתקרה נמוכה בכוונה. נעליים רמה 1 נותנות {p0} אזרחים בכל עדכון יומי, רמה 10 נותנות {p1}, ורמה 100 נותנות {p2}. כנפיים רמה 100 נותנות {p3} תורות בכל עדכון רגיל — בדיוק כמו שדרוג התורות המלא, ולא יותר. חפץ לא אמור להחליף את הבניין או את השדרוג שקיימים בשביל זה.", { p0: itemStatBonus("BOOTS", 1, "citizens"), p1: itemStatBonus("BOOTS", 10, "citizens"), p2: itemPrimaryBonus("BOOTS", HERO_MAX_LEVEL).value, p3: itemPrimaryBonus("WINGS", HERO_MAX_LEVEL).value }),
                    },
                    {
                      term: t("כוח קרב"),
                      desc: t("לצד כל אחוז לחימה יש גם כוח קבוע, באותו משקל. הוא נספר יחד עם החיילים והנשקים — לא מעליהם — ולכן כל האחוזים מוכפלים גם עליו. חרב ראשית נותנת {p0} ברמה 1, {p1} ברמה 50 ו־{p2} ברמה 100; חפץ שנותן את הסטט כמשני נותן רבע עד חצי מזה. נעליים הן המשבצת היחידה בלי כוח קרב — היא לא נלחמת.", { p0: formatNumber(itemStatBonus("SWORD", 1, "attackPower")), p1: formatNumber(itemStatBonus("SWORD", 50, "attackPower")), p2: formatNumber(itemStatBonus("SWORD", HERO_MAX_LEVEL, "attackPower")) }),
                    },
                    {
                      term: t("יהלומים"),
                      desc: t("מכנסיים הן המשבצת היחידה שמזקקת יהלומים, וכמשני בלבד: {p0} בכל עדכון יומי ברמה 1, {p1} ברמה 50 ו־{p2} ברמה 100 — כלומר {p3} יהלומים ביום בציוד המקסימלי. זה טפטוף מכוון — יהלומים הם מטבע אמיתי, ולא אמורים להיות הכנסה, ולכן הם היחידים (יחד עם האזרחים) שממתינים לעדכון היומי.", { p0: itemStatBonus("PANTS", 1, "diamonds"), p1: itemStatBonus("PANTS", 50, "diamonds"), p2: itemStatBonus("PANTS", HERO_MAX_LEVEL, "diamonds"), p3: flatStatPerDay("diamonds", itemStatBonus("PANTS", HERO_MAX_LEVEL, "diamonds")) ?? 0 }),
                    },
                    {
                      term: t("משאבים — שני כלים"),
                      desc: t("פרי שטן, מכנסיים ונעליים נותנים כמות קבועה בכל עדכון רגיל (עד +{p0}), וככל שהדרגה גבוהה יותר סוגי משאבים. לכל משבצת סדר משלה: פרי שטן פותח בזהב, מכנסיים באבן, נעליים בברזל. חרב ומגן פועלים הפוך — הם מכפילים את תפוקת כל המכרות באחוזים (עד +{p1}%), קטן בהתחלה ומשמעותי בסוף.", { p0: formatNumber(itemPrimaryBonus("RELIC", HERO_MAX_LEVEL).value), p1: itemStatBonus("SWORD", HERO_MAX_LEVEL, "resources") }),
                    },
                  ]}
                  example={
                    <RichText
                      text={t(
                        "פרי שטן ברמה <0> = דרגה <1> מתוך <2>, ובכל זאת <3> זהב בכל עדכון רגיל — יותר ממה שמכרה של אימפריה בת עיר אחת מפיק. חרב ברמה <4> = דרגה <5>, כלומר <6> מהתקרה באחוזים: <7> התקפה, ועוד <8> תפוקת מכרות ו־<9> אזרחים כמשניים; אותה רמה בכנפיים = <10> תורות בכל עדכון רגיל."
                      )}
                      slots={[
                        <N key="rl">1</N>,
                        <N key="rs">1</N>,
                        <N key="rt">40</N>,
                        <R key="rv">+{formatNumber(itemPrimaryBonus("RELIC", 1).value)}</R>,
                        <N key="sl">50</N>,
                        <N key="ss">20</N>,
                        <N key="half">{t("חצי")}</N>,
                        <R key="atk">+{itemPrimaryBonus("SWORD", 50).value}%</R>,
                        <R key="res">+{itemStatBonus("SWORD", 50, "resources")}%</R>,
                        <R key="cit">+{itemStatBonus("SWORD", 50, "citizens")}</R>,
                        <R key="wng">+{itemPrimaryBonus("WINGS", 50).value}</R>,
                      ]}
                    />
                  }
                />
              </div>

              <Formula
                label={t("מחיר שדרוג חפץ — סולם גיאומטרי")}
                expr={
                  <>
                    <N>{formatShort(UPGRADE_COST_AT_LEVEL_10)}</N>
                    <O>×</O>
                    <N>{UPGRADE_COST_GROWTH.toFixed(4)}</N>
                    <sup className="text-gold-dim">{t("(רמת יעד − 10)")}</sup>
                    <O>=</O>
                    <R>{t("זהב")}</R>
                  </>
                }
                legend={[
                  { term: t("העוגן התחתון"), desc: t("שדרוג לרמה 10 עולה {p0} זהב.", { p0: formatShort(UPGRADE_COST_AT_LEVEL_10) }) },
                  { term: t("העוגן העליון"), desc: t("שדרוג לרמה 100 עולה {p0} זהב.", { p0: formatShort(UPGRADE_COST_AT_LEVEL_100) }) },
                  { term: "≈ ×3.95", desc: t("לכל עשור רמות — לזהב של סוף המשחק יש מה לקנות.") },
                ]}
              />

              <ItemUpgradeCalc />

              <div className="flex flex-wrap justify-center gap-3">
                <Link href={gameHref("/game/hero/items")} className="btn btn-ghost px-4 py-2 text-sm">
                  <Icon name="spark" size={16} className="inline align-[-2px]" /> {t("קטלוג החפצים המלא")}
                </Link>
                <Link href={gameHref("/game/hero")} className="btn btn-gold px-4 py-2 text-sm">
                  <Icon name="hero" size={16} className="inline align-[-2px]" /> {t("לגיבור שלי")}
                </Link>
              </div>
            </GuideSection>

            {/* ============================ 18 forge ============================ */}
            <GuideSection meta={sections.forge} index={INDEX.forge}>
              <Lead><RichText text={t("חפצים נופלים בדרגה אקראית, ולכן לכל שחקן יש בסוף תשע חרבות ואפס מגפיים.  <0>  היא שער החליפין בין שתי העובדות האלה, והיא עושה דבר אחד:  <1>. מפרקים חפצים שאין בהם צורך לרסיסים, ומזמינים בהם חפץ <2>.")} slots={[<><Link href={gameHref("/game/hero/forge")} className="text-gold underline"> {t("הנפחייה")} </Link></>, <><b>{t("הופכת רוחב לכיוון")}</b></>, <><b>{t("במשבצת שאתה בוחר")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="iron"
                  label={t("רסיסים להזמנה")}
                  value={COMMISSION_SHARDS}
                  hint={t("כ־{p0} נפילות", { p0: COMMISSION_DROPS })}
                />
                <Fact
                  icon="spark"
                  label={t("רסיסים לנפילה")}
                  value={SHARDS_PER_DROP.toFixed(1)}
                  hint={t("בממוצע, לפי טבלת הנדירות")}
                  tone="text-violet-300"
                />
                <Fact
                  icon="gold"
                  label={t("זהב להזמנה ברמה 50")}
                  value={formatShort(commissionGoldCost(50))}
                  hint={t("השדרוג הזול בעשור שלך")}
                  tone="text-gold-bright"
                />
                <Fact
                  icon="hero"
                  label={t("הדרגה שמוגרלת")}
                  value={t("כמו נפילה")}
                  hint={t("סביב רמת הגיבור שלך")}
                  tone="text-emerald-300"
                />
              </div>

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("נדירות")}</th>
                      <th>{t("פירוק נותן")}</th>
                      <th>{t("ליטוש לדרגה הבאה")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RARITY_ORDER.map((rarity) => (
                      <tr key={rarity}>
                        <td className={`font-bold ${RARITY_META[rarity].tone}`}>
                          {RARITY_META[rarity].label}
                        </td>
                        <td className="nums text-bone-bright" dir="ltr">
                          {SHARDS_BY_RARITY[rarity]}
                        </td>
                        <td className="nums text-gold-bright" dir="ltr">
                          {rarity === "LEGENDARY"
                            ? "—"
                            : TEMPER_SHARDS[rarity as keyof typeof TEMPER_SHARDS]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <Formula
                label={t("שני הספסלים")}
                expr={
                  <>
                    <V>{t("הזמנה")}</V>
                    <O>=</O>
                    <N>{COMMISSION_SHARDS}</N>
                    <V> {t("רסיסים")}</V>
                    <O>+</O>
                    <V>{t("זהב")}</V>
                    <O>→</O>
                    <R>{t("משבצת לבחירתך")}</R>
                  </>
                }
                legend={[
                  {
                    term: t("אתה קונה משבצת, לא כוח"),
                    desc: t("הדרגה והנדירות מוגרלות בדיוק באותה פונקציה ובאותה טבלה של נפילה רגילה. אגדי מהנפחייה נדיר כמו אגדי מפשיטה."),
                  },
                  {
                    term: t("ליטוש הוא הדרך השנייה"),
                    desc: t("מעלה חפץ קיים דרגה אחת בתוך העשור שלו תמורת רסיסים בלבד — {p0}/{p1}/{p2} — ועוצר באגדי, בדיוק כמו שדרוג הזהב.", { p0: TEMPER_SHARDS.COMMON, p1: TEMPER_SHARDS.RARE, p2: TEMPER_SHARDS.EPIC }),
                  },
                  {
                    term: t("ערך הרסיס קבוע"),
                    desc: t("פשוט שווה רסיס אחד בין אם הוא מהעשור הראשון או העשירי, והזמנה עולה אותו דבר תמיד. אין קצה זול לחקור ואין ארביטראז׳."),
                  },
                  {
                    term: t("הזהב הוא הבור שגדל"),
                    desc: t("מחיר ההזמנה נלקח מסולם שדרוגי החפצים — השדרוג הזול ביותר בעשור שהגיבור שלך עומד בו — כך שהנפחייה מתייקרת יחד עם שאר כלכלת הציוד."),
                  },
                ]}
              />

              <Note tone="gold" icon="spark" title={t("אגדי הוא התקרה של הסט שלו")}><RichText text={t("שום כמות של זהב או רסיסים לא מעבירה חפץ לסט שמעליו. הדרך היחידה לעשור הבא היא <0> חפץ ממנו — והנפחייה לא נועדה לעקוף את זה, אלא לחסוך לך את החרב העשירית.")} slots={[<><b>{t("למצוא")}</b></>]} /></Note>
            </GuideSection>

            {/* ============================ 19 potions ============================ */}
            <GuideSection meta={sections.potions} index={INDEX.potions}>
              <Lead><RichText text={t("שיקוי הוא לא ציוד — הוא <0>. נופל מתקיפות מנצחות בסיכוי  <1>, ושתייה בזמן שהחלון כבר פתוח מאריכה אותו במקום לבזבז בקבוק.")} slots={[<><b>{t("חלון זמן שבו חוק אחד במשחק מתעקם")}</b></>, <><b className="nums">{Math.round(POTION_DROP_CHANCE * 100)}%</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {POTION_KINDS.map((kind) => {
                  const meta = POTION_META[kind];
                  return (
                    <article
                      key={kind}
                      className="rounded-xl border p-4"
                      style={{
                        borderColor: `${meta.liquid.glow}55`,
                        background: `linear-gradient(180deg, ${meta.liquid.glow}18, rgba(10,9,12,0.9))`,
                      }}
                    >
                      <div className="mb-2 flex h-16 items-center justify-center" aria-hidden>
                        <div
                          className={`border ${POTION_SHAPE[meta.shape].className}`}
                          style={{
                            background: `linear-gradient(180deg, ${meta.liquid.from}, ${meta.liquid.to})`,
                            borderColor: `${meta.liquid.glow}88`,
                            boxShadow: `0 0 22px -4px ${meta.liquid.glow}`,
                            ...POTION_SHAPE[meta.shape].style,
                          }}
                        />
                      </div>
                      <p className={`text-center font-black ${meta.tone}`}>{meta.label}</p>
                      <p className="mt-0.5 text-center text-[11px] text-zinc-400">{meta.tagline}</p>
                      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                        {meta.description}
                      </p>
                      <p className="mt-2 text-center text-[11px] font-bold text-gold-bright">{t("משך: {p0}", { p0: potionDurationLabel(t, kind) })}</p>
                    </article>
                  );
                })}
              </div>
            </GuideSection>

            {/* ============================ 20 hero quests ============================ */}
            <GuideSection meta={sections.quests} index={INDEX.quests}>
              <Lead><RichText text={t("בין קרב לקרב הגיבור לא חייב לשבת בבית. מסע שולח אותו לזמן אמת ומשלם כשהוא חוזר — <0>, כי יש גיבור אחד. כל עיר שאתה מקים פותחת דרגה ארוכה יותר, מ<1> ועד <2>, והדרגות הישנות נשארות פתוחות.")} slots={[<><b>{t("מסע אחד בכל פעם")}</b></>, <><b>{t("שעה")}</b></>, <><b>{t("יממה")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="quest"
                  label={t("מסעות בלוח")}
                  value={HERO_QUESTS.length}
                  hint={t("דרגה אחת לכל עיר")}
                  tone="text-gold-bright"
                />
                <Fact
                  icon="turns"
                  label={t("תורות לשעת מסע")}
                  value={`${HERO_QUEST_TURNS_PER_HOUR_BASE}→${(
                    HERO_QUEST_TURNS_PER_HOUR_BASE -
                    HERO_QUEST_TURNS_PER_HOUR_DROP * (HERO_QUESTS.length - 1)
                  ).toFixed(1)}`}
                  hint={t("יורד עם הדרגה")}
                  tone="text-emerald-300"
                />
                <Fact
                  icon="spark"
                  label={t("סיכוי לחפץ")}
                  value={`${Math.round(HERO_QUESTS[0].itemChance * 100)}–${Math.round(
                    HERO_QUESTS[HERO_QUESTS.length - 1].itemChance * 100
                  )}%`}
                  hint={t("הגרלה נפרדת לשיקוי")}
                  tone="text-violet-300"
                />
                <Fact
                  icon="heart"
                  label={t("הבונוסים של הגיבור")}
                  value={t("פועלים")}
                  hint={t("גם כשהוא בדרכים")}
                  tone="text-red-300"
                />
              </div>

              <Formula
                label={t("השלל של מסע")}
                expr={
                  <>
                    <V>{t("תשלום לשעה")}</V>
                    <O>×</O>
                    <V>{t("שעות המסע")}</V>
                    <O>×</O>
                    <N>{HERO_QUEST_REWARD_CITY_MULTIPLIER}</N>
                    <sup className="text-gold-dim">{t("(ערים−1)")}</sup>
                    <O>×</O>
                    <V>{t("צמיחת העונה")}</V>
                    <O>×</O>
                    <V>{t("מזל המסע")}</V>
                    <O>=</O>
                    <R>{t("שלל")}</R>
                  </>
                }
                legend={[
                  {
                    term: t("אין מספר שאפשר לראות מראש"),
                    desc: t("הלוח לא מציג שלל, וזה לא הסתרה: השלל מוגרל ברגע היציאה. אותה דרגה, אותה אימפריה, אותו יום — ובכל זאת שני מסעות לא יחזרו עם אותו שק."),
                  },
                  {
                    term: t("לפי ערים, לא לפי דרגה"),
                    desc: t("הממוצע נגזר ממספר הערים שלך — לכן כל הדרגות משלמות אותו ממוצע לשעה, ומסע של שעה לא מתיישן לעולם."),
                  },
                  {
                    term: t("מזל המסע"),
                    desc: t("מגלגל פעם אחת לכל יציאה, מ-×0.55 ועד ×3.6, ואותה טבלה בדיוק לכל הדרגות — מסע ארוך לא קונה מזל טוב יותר, רק יותר שעות."),
                  },
                  {
                    term: t("וגם בתוך השק"),
                    desc: t("כל משאב מתנדנד בנפרד, ובכל מסע יש משאב אחד שחזר בשפע ואחד שכמעט לא חזר — לכן היחס בין זהב לעץ אף פעם לא נראה אותו דבר."),
                  },
                  {
                    term: t("מה קונות הדרגות הארוכות"),
                    desc: t("פחות תורות לכל שעת מסע, וסיכויי שלל גבוהים בהרבה בסיום."),
                  },
                  {
                    term: t("אזרחים ועבדים"),
                    desc: t("גדלים לפי ערים (×{p0}) אבל לא לפי יום העונה, ומהמזל הם מקבלים רק את השורש — הם משאבים במרחק צעד אחד, ומסע לא אמור להיות הדרך לאכלס עיר.", { p0: HERO_QUEST_PEOPLE_CITY_MULTIPLIER }),
                  },
                ]}
                example={
                  <>
                    {t("מסע של")} <b>{heroQuestDurationLabel(t, 3)}</b> {t("מביא בממוצע פי שלושה ממסע של שעה באותן ערים — אבל שעה עם")} <b>{t("מזל אגדי")}</b> {t("תכה בקלות שלוש שעות של דרך קשה.")}
                  </>
                }
              />

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("מזל המסע")}</th>
                      <th>{t("סיכוי")}</th>
                      <th>{t("מכפיל השלל")}</th>
                      <th>{t("מה זה אומר")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {HERO_QUEST_FORTUNES.map((band) => (
                      <tr key={band.key}>
                        <td className="whitespace-nowrap font-bold text-bone">
                          {band.label}
                        </td>
                        <td className="nums" dir="ltr">
                          {Math.round(
                            (band.weight /
                              HERO_QUEST_FORTUNES.reduce((sum, f) => sum + f.weight, 0)) *
                              100
                          )}
                          %
                        </td>
                        <td className="nums text-gold-bright" dir="ltr">
                          ×{band.min}–×{band.max}
                        </td>
                        <td className="text-zinc-400">{band.lore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <TableWrap maxHeight={420}>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("מסע")}</th>
                      <th>{t("משך")}</th>
                      <th>{t("תורות — עיר 1")}</th>
                      <th>{t("תורות — {p0} ערים", { p0: MAX_CITIES })}</th>
                      <th>{t("תורות לשעה")}</th>
                      <th>{t("ניסיון")}</th>
                      <th>{t("חפץ / שיקוי")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {HERO_QUESTS.map((quest) => (
                      <tr key={quest.key}>
                        <td className="whitespace-nowrap">
                          <span aria-hidden className="ms-1">
                            {quest.sigil}
                          </span>
                          {quest.name}
                        </td>
                        <td className="nums" dir="ltr">
                          {heroQuestDurationLabel(t, quest.tier)}
                        </td>
                        <td className="nums" dir="ltr">
                          {nf(heroQuestTurnCost(quest.tier))}
                        </td>
                        <td className="nums text-amber-300" dir="ltr">
                          {nf(heroQuestTurnCost(quest.tier, MAX_CITIES))}
                        </td>
                        <td className="nums text-zinc-400" dir="ltr">
                          {(heroQuestTurnCost(quest.tier) / quest.hours).toFixed(1)}
                        </td>
                        <td className="nums text-gold-bright" dir="ltr">
                          {nf(heroQuestXp(quest.tier))}
                        </td>
                        <td className="nums text-violet-300" dir="ltr">
                          {Math.round(quest.itemChance * 100)}% /{" "}
                          {Math.round(quest.potionChance * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <Note tone="green" icon="quest"><RichText text={t("שליחה עולה תורות בלבד — הגיבור <0> גם בזמן שהוא בדרכים, ומסע שכבר יצא לדרך מסתיים גם אם הגיבור נופל בינתיים. מה שהוא לא יכול לעשות זה לצאת למסע כשהוא מת.")} slots={[<><b>{t("ממשיך להעניק את כל הבונוסים שלו")}</b></>]} /></Note>

              <Note tone="gold" icon="turns" title={t("המחיר עולה עם האימפריה")}><RichText text={t("השלל של מסע גדל עם מספר הערים שלך, ולכן גם המחיר: כל עיר מוסיפה <0> למחיר התורות, כך שאימפריה בת {p0} ערים משלמת <1> על אותו מסע עצמו. בעיר אחת אין תוספת כלל — הטבלה למעלה מראה את שני הקצוות. זה מה שמחזיר את לוח המסעות למקומו: הכנסה משנית ללא סיכון, שמשתלמת פחות לתור מאשר מצור על שליט.", { p0: MAX_CITIES })} slots={[<><b className="nums">+{Math.round(HERO_QUEST_TURNS_PER_CITY * 100)}%</b></>, <><b className="nums">×{heroQuestCityCostFactor(MAX_CITIES).toFixed(2)}</b></>]} /></Note>

              <Note tone="gold" icon="hero">{t("השלל מוגרל ונחתם ברגע היציאה — האימפריה שממנה שלחת אותו היא זו שמשלמת, גם אם הקמת (או איבדת) עיר בזמן שהוא היה בדרך. מה שהוגרל שמור אצל הגיבור בלבד: אין דרך להציץ בשק לפני שהוא נכנס בשער, ואין דרך לגלגל אותו מחדש.")}</Note>
            </GuideSection>

            {/* ============================ 21 bosses ============================ */}
            <GuideSection meta={sections.bosses} index={INDEX.bosses}>
              <Lead><RichText text={t("לכל אחת מעשר דרגות הערים יש שליט אחד — קיר PvE שכוחו  <0>, והוא <6>. לוחצים <1> פעם אחת, והצבא יוצא לקרב של  <2> סבבים שרץ כ־ <3> שניות בזמן אמת. אפשר לצפות, ואפשר לעבור לדף אחר ולהמשיך לשחק — כשהקרב נגמר מגיעה הודעה עם כל השלל. לבוס יש <4>, וכשהוא נופל הוא קם לתחייה אחרי  <5> דקות.")} slots={[<><b>{t("פומבי וקבוע")}</b></>, <><b>{t("תקיפה")}</b></>, <><b className="nums">{BOSS_SORTIE_ROUNDS}</b></>, <><b className="nums">{Math.round(BOSS_ASSAULT_DURATION_MS / 1000)}</b></>, <><b>{t("מאגר חיים שנשמר בין תקיפות")}</b></>, <><b className="nums">{reviveMinutes}</b></>, <><b>{t("משותף לכל שחקני העיר")}</b></>]} /></Lead>

              <Note tone="red" icon="attack" title={t("שליט הוא מצור, לא לחיצה")}><RichText text={t("אף שליט לא נופל בתקיפה אחת. צבא שעומד <0> צריך בערך <1> תקיפות כדי לרוקן מנה אחת מהמאגר, צבא בכפול מהכוח — <2>, ובפי שלושה — <3>. גיבור ברמה גבוהה חוסך תקיפה שלמה מהמניין. צבא מתחת לקיר פשוט מכרסם לאורך יותר תקיפות, <4>: השלל משולם לפי הנזק, כך שאף תקיפה לא הולכת לאיבוד.")} slots={[<><b>{t("בדיוק על הכוח המודפס שלו")}</b></>, <><b className="nums">{bossSortiesToKill(bossPower(1), bossSiegeMaxHp(1), 1, true)}</b></>, <><b className="nums">{bossSortiesToKill(bossPower(1) * 2, bossSiegeMaxHp(1), 1, true)}</b></>, <><b className="nums">{bossSortiesToKill(bossPower(1) * 3, bossSiegeMaxHp(1), 1, true)}</b></>, <><b>{t("ומקבל שלל על כל אחת מהן")}</b></>]} /></Note>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="attack"
                  label={t("כוח שליט העיר הראשונה")}
                  value={formatShort(BOSS_BASE_POWER * tunables.boss.powerMultiplier)}
                  hint={t("×{p0} בכל דרגת עיר", { p0: BOSS_POWER_TIER_MULTIPLIER })}
                  tone="text-red-300"
                />
                <Fact
                  icon="heart"
                  label={t("מאגר חיים")}
                  value={`×${BOSS_HP_PER_POWER}`}
                  hint={t("מהכוח שלו — נשמר בין תקיפות")}
                  tone="text-bone-bright"
                />
                <Fact
                  icon="turns"
                  label={t("תורות לתקיפה")}
                  value={`${BOSS_TURN_COST_BASE}+`}
                  hint={t("+200 לכל דרגת עיר · אין מכסת תקיפות")}
                  tone="text-emerald-300"
                />
                <Fact
                  icon="hero"
                  label={t("סיכוי קריאה נכונה")}
                  value={`${Math.round(BOSS_READ_CHANCE_BASE * 100)}–${Math.round(BOSS_READ_CHANCE_MAX * 100)}%`}
                  hint={t("לפי רמת הגיבור — זה מה שהוא תורם לקרב")}
                  tone="text-purple-300"
                />
              </div>

              {/* The whole skill of the fight is these three lines. */}
              <div className="grid gap-2 sm:grid-cols-3">
                {(["SMASH", "SWEEP", "EXPOSED"] as const).map((move) => {
                  const meta = BOSS_MOVE_META[move];
                  const counter = BOSS_TACTIC_META[BOSS_MOVE_COUNTER[move]];
                  return (
                    <div key={move} className="panel-gold rounded-xl p-4">
                      <p className={`flex items-center gap-2 font-black ${meta.tone}`}>
                        <span aria-hidden className="text-lg">
                          {meta.icon}
                        </span>
                        {meta.label}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                        {meta.telegraph}
                      </p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-emerald-300"><RichText text={t("<0> התשובה הנכונה: {p0}", { p0: counter.label })} slots={[<><span aria-hidden>{counter.icon}</span></>]} /></p>
                    </div>
                  );
                })}
              </div>

              <Formula
                label={t("חלוקת השלל של המחזור")}
                expr={
                  <>
                    <N>{Math.round(BOSS_CHIP_SHARE * 100)}%</N>
                    <O>×</O>
                    <O>(</O>
                    <V>{t("הנזק שגרמת")}</V>
                    <O>÷</O>
                    <V>{t("המנה שלך")}</V>
                    <O>)</O>
                    <O>×</O>
                    <O>(</O>
                    <N>{Math.round(BOSS_CHIP_SHARE * 100)}%</N>
                    <O>+</O>
                    <N>{Math.round(BOSS_KILL_SHARE * 100)}%</N>
                    <O>×</O>
                    <V>{t("דירוג ההפלה")}</V>
                    <O>)</O>
                  </>
                }
                legend={[
                  {
                    term: t("עריץ אחד לכל העיר"),
                    desc: t("כל שחקני הדרגה תוקפים את אותו שליט ואת אותו מאגר חיים, בדיוק כמו מפלצת העולם. המאגר נקבע בלידתו לפי מספר השחקנים הפעילים בדרגה (מי שנראה במשחק בשבוע האחרון) — מנה אחת לכל אחד — וכל מה שאתה מקבל נמדד מול המנה שלך בלבד. לכן אותה תקיפה שווה בדיוק אותו דבר בעיר צפופה ובעיר ריקה."),
                  },
                  {
                    term: t("שלל בדרך"),
                    desc: t("{p0}% מהמנה משולמים לפי הנזק שהספקת לגרום — גם בתקיפה שלא הפילה אותו. תקיפה שלא סיימה את העבודה עדיין משתלמת.", { p0: Math.round(BOSS_CHIP_SHARE * 100) }),
                  },
                  {
                    term: t("אוצר ההפלה"),
                    desc: t("{p0}% נשמרים לרגע הנפילה ומתחלקים בין כל מי שפצע את השליט, לפי הנזק שכל אחד גרם. הם גדלים עד ×{p1} בדירוג S — שנקבע לפי הקריאות הנכונות{p2} של המכה האחרונה, ודורש לפחות {p3} סבבים: הפלה במכה אחת לא מגיעה ל־S.", { p0: Math.round(BOSS_KILL_SHARE * 100), p1: BOSS_GRADE_BONUS.S, p2: BOSS_CASUALTIES ? ` ${t("והצבא ששרד")}` : "", p3: BOSS_GRADE_MIN_DECISIONS }),
                  },
                  // Both casualty entries stand or fall with the mechanic itself:
                  // put blood back in BOSS_ROUND_LOSS_BASE and the guide grows
                  // its price-of-blood section back on the same deploy.
                  ...(BOSS_CASUALTIES
                    ? [
                        {
                          term: t("אבדות לפי הכוח"),
                          desc: t("האבדות נגבות ביחס לכוח שלך מול כוח הבוס: צבא בחצי מהכוח משלם חצי מהמחיר בדם, בדיוק כמו שהוא מקבל בערך חצי מהשלל. מתחת ל־{p0}% מכוח הבוס המחיר נעצר ולא יורד יותר — אבל אף פעם לא תשלם מחיר מלא על נגיסה קטנה.", { p0: Math.round(BOSS_LOSS_ENGAGEMENT_FLOOR * 100) }),
                        },
                        {
                          term: t("שבירת הצבא"),
                          desc: t("אם הצבא מאבד {p0}% מכוחו הוא נסוג באמצע הקרב, ו-{p1}% מהשלל שנצבר אובד. בפועל זה מאיים רק על צבא שנלחם מול בוס בסדר הגודל שלו.", { p0: Math.round(BOSS_ROUT_LOSS_FRACTION * 100), p1: Math.round((1 - BOSS_ROUT_LOOT_PENALTY) * 100) }),
                        },
                      ]
                    : [
                        {
                          term: t("בלי אבדות"),
                          desc: t("הקרב מול השליט לא עולה באף חייל — הצבא חוזר שלם מכל תקיפה, מוצלחת או לא. המחיר היחיד הוא התורות, ולכן תמיד שולחים את כל הצבא."),
                        },
                      ]),
                  {
                    term: t("אין מכסה"),
                    desc: t("אפשר לתקוף שוב ושוב — התורות הן הגבול היחיד. השלל חסום על ידי המנה שלך, כך שתקיפות נוספות קונות התקדמות, לא כפל שלל. שליט שנופל חוזר אחרי {p0} דקות עם מאגר חדש — לכל העיר יחד.", { p0: reviveMinutes }),
                  },
                  {
                    term: t("ציוד מובטח"),
                    desc: t("שליט שנופל מפיל תמיד חפץ — ברצפת דרגה {p0} ומעלה, ובדירוג S דרגה אחת מעל זה. החפץ הולך למי שהנחית את המכה האחרונה בלבד; הזהב מתחלק בין כולם, אבל שריון אי אפשר לחלק.", { p0: RARITY_META[BOSS_ITEM_RARITY_FLOOR].label }),
                  },
                  {
                    term: t("ניסיון"),
                    desc: t("{p0} + {p1} לכל דרגת עיר, על אותה חלוקה כמו השלל.", { p0: nf(BOSS_HERO_XP_BASE), p1: nf(BOSS_HERO_XP_PER_TIER) }),
                  },
                ]}
              />

              <BossLadder
                powerMultiplier={tunables.boss.powerMultiplier}
                rewardMultiplier={tunables.boss.rewardMultiplier}
                slaveMultiplier={tunables.boss.slaveMultiplier}
                heroXpMultiplier={tunables.boss.heroXpMultiplier}
                hpMultiplier={tunables.boss.hpMultiplier}
              />

              <Note tone="gold" icon="rankings"><RichText text={t("כל {p0} השליטים מוצגים בדף  <0>  עם הכוח המדויק שלהם — אפשר לתכנן מולם מראש. מד הזעם של הגיבור נטען בכל סבב, וברגע שהוא מתמלא הגיבור משתחרר מעצמו במכה אחת גדולה.", { p0: CITY_BOSSES.length })} slots={[<><Link href={gameHref("/game/rankings")} className="text-gold underline"> {t("הדירוג")} </Link></>]} /></Note>

              <Note tone="red" icon="heart" title={t("אל תשלח צבא בלי גיבור")}><RichText text={t("גיבור מת לא קורא את השליט ולא משחרר זעם: הקריאה יורדת מ־ {p0}–{p1}% לניחוש עיוור של  <0> — אחד משלושה — וכל סבב שנקרא לא נכון  {p2}. תחייה לפני התקיפה, לא אחריה.", { p0: Math.round(BOSS_READ_CHANCE_BASE * 100), p1: Math.round(BOSS_READ_CHANCE_MAX * 100), p2: BOSS_CASUALTIES ? t("גם מכפיל את האבדות") : t("מוריד את הנזק לשליש") })} slots={[<><b className="nums">{Math.round(BOSS_READ_CHANCE_NO_HERO * 100)}%</b></>]} /></Note>
            </GuideSection>

            {/* ============================ 22 arena ============================ */}
            <GuideSection meta={sections.arena} index={INDEX.arena}>
              <Lead><RichText text={t("הדירוג אומר לך איפה אתה עומד; הוא אף פעם לא אומר לך אם היית  <0>.  <1>  היא הקרב ההוגן הזה, <2>, לכל מי שנרשם: בחצות (שעון ישראל) כל נרשם פוגש <3>, והטבלה היא התוצאה. אף אחד לא לוחץ תקיפה ואף אחד לא צריך להיות מחובר.")} slots={[<><b>{t("מנצח")}</b></>, <><Link href={gameHref("/game/arena")} className="text-gold underline"> {t("הזירה")} </Link></>, <><b>{t("כל יום")}</b></>, <><b>{t("כל נרשם אחר בדיוק פעם אחת")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="turns"
                  label={t("דמי כניסה")}
                  value={ARENA_ENTRY_TURNS}
                  hint={t("תורות, פעם ביום")}
                  tone="text-emerald-300"
                />
                <Fact
                  icon="laurel"
                  label={t("נרשמים לזירה")}
                  value={t("עד {max}", { max: ARENA_MAX_ENTRANTS })}
                  hint={t("זירה אחת לכל דרגת ערים, כל יום")}
                />
                <Fact
                  icon="dice"
                  label={t("משקל המזל")}
                  value={`${Math.round(ARENA_LUCK * 100)}%`}
                  hint={t("השאר הוא כוח")}
                  tone="text-purple-300"
                />
                <Fact
                  icon="diamond"
                  label={t("סף הפודיום")}
                  value={ARENA_PODIUM_MIN_ENTRANTS}
                  hint={t("נרשמים, אחרת אין יהלומים")}
                  tone="text-cyan-300"
                />
              </div>

              <Formula
                label={t("הסיכוי לנצח דו־קרב")}
                expr={
                  <>
                    <V>{t("חלקך")}</V>
                    <O>=</O>
                    <V>{t("√כוחך")}</V>
                    <O>÷</O>
                    <O>(</O>
                    <V>{t("√כוחך")}</V>
                    <O>+</O>
                    <V>{t("√כוחו")}</V>
                    <O>)</O>
                    <O>,</O>
                    <R>{t("סיכוי")}</R>
                    <O>=</O>
                    <V>{t("חלקך")}</V>
                    <O>×</O>
                    <N>{(1 - ARENA_LUCK).toFixed(2)}</N>
                    <O>+</O>
                    <N>{(0.5 * ARENA_LUCK).toFixed(3)}</N>
                  </>
                }
                legend={[
                  {
                    term: t("שורש, לא כוח גולמי"),
                    desc: t("בתוך דרגת ערים אחת הפערים בכוח הם סדרי גודל. השורש דוחס אותם לטווח שבו למזל עדיין יש מה לומר, ובלעדיו כל דו־קרב בין לא־שווים היה פורמליות."),
                  },
                  {
                    term: t("{p0}% מזל", { p0: Math.round(ARENA_LUCK * 100) }),
                    desc: t("אימפריה עם חצי מהכוח של יריבתה עדיין לוקחת בערך דו־קרב אחד מכל חמישה — מספיק כדי שכדאי להיכנס מכל מקום בטבלה, ורחוק מלהפוך את זה להגרלה."),
                  },
                  {
                    term: t("התוצאה קבועה מראש"),
                    desc: t("כל דו־קרב מוגרל מזרע שנגזר מהזירה ומשני המזהים, ולכן חישוב חוזר של אותה טבלה מחזיר בדיוק את אותן תוצאות — וסדר החישוב לא מיטיב עם אף צד."),
                  },
                  {
                    term: t("שוויון נשבר לפי כוח"),
                    desc: t("שני נרשמים עם אותו מספר ניצחונות שלא נפגשו — החזק מביניהם מדורג גבוה יותר."),
                  },
                ]}
              />

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("מקום")}</th>
                      <th>{t("הפרס (בעיר אחת, לכל קלף)")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ARENA_PODIUM.map((purse, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap font-bold text-gold-bright">{t("מקום {p0}", { p0: i + 1 })}</td>
                        <td>
                          <Purse rewards={purse} />
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="whitespace-nowrap text-bone">{t("כל השאר")}</td>
                      <td>
                        <Purse rewards={ARENA_CONSOLATION} />
                      </td>
                    </tr>
                    <tr>
                      <td className="whitespace-nowrap text-bone">{t("ובנוסף, לכל ניצחון")}</td>
                      <td>
                        <Purse rewards={[{ kind: "gold", amount: ARENA_GOLD_PER_WIN }]} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </TableWrap>

              <div className="grid gap-3 sm:grid-cols-2">
                <Note tone="green" icon="turns" title={t("כניסה אף פעם לא הפסד")}><RichText text={t("פרס ההשתתפות שווה יותר מ־<0>  התורות שעלתה הכניסה, וקלף חזק של שלושים ניצחונות שווה יותר זהב מהפודיום עצמו — הפודיום מוכר את היהלומים, הניצחונות מוכרים את העבודה.")} slots={[<><b className="nums">{ARENA_ENTRY_TURNS}</b></>]} /></Note>
                <Note tone="gold" icon="diamond" title={t("למה צריך חמישה נרשמים")}><RichText text={t("דרגת ערים גבוהה היא לפעמים אימפריה אחת בעולם, ומקום ראשון בטבלה של שורה אחת הוא ברז יהלומים בלי יריב ובלי סיכון — וקלף יומי פותח את הברז הזה כל בוקר מחדש. מתחת ל־ <0> נרשמים הזירה עדיין רצה ועדיין משלמת — פרס השתתפות וזהב לכל ניצחון — אבל בלי יהלומים.")} slots={[<><b className="nums">{ARENA_PODIUM_MIN_ENTRANTS}</b></>]} /></Note>
                <Note tone="purple" icon="turns" title={t("נרשמת לבד? הקלף מתבטל")}><RichText text={t("טורניר של נרשם אחד הוא אפס דו־קרבות, ומקום ראשון בו לא אומר כלום. מתחת ל־ <0> נרשמים הזירה מבוטלת: אין פרס בכלל, ובמקומו חוזרות אליך  <1>  התורות שההרשמה עלתה, בדיוק כמו שהן — אף פעם לא תפסיד תורות על יום שבו לא היה נגד מי להילחם. גם מלחמת הבריתות מתבטלת כשנרשמה רק ברית אחת, ושם ההרשמה ממילא לא עולה כלום.")} slots={[<><b className="nums">{ARENA_MIN_ENTRANTS}</b></>, <><b className="nums">{ARENA_ENTRY_TURNS}</b></>]} /></Note>
              </div>
            </GuideSection>

            {/* ============================ 23 worldboss ============================ */}
            <GuideSection meta={sections.worldboss} index={INDEX.worldboss}>
              <Lead><RichText text={t("כל קרב אחר במשחק הוא בין שני שחקנים או בין שחקן לשליט העיר שלו.  <0>  היא המקום היחיד שבו <1>: מפלצת אחת ליום, מאגר חיים משותף שגדל עם מספר האימפריות, וכל אימפריה שהנחיתה מכה מקבלת חלק בשלל. אין כפתור מנהלים — היא עולה על השעון בחצות, לבד.")} slots={[<><Link href={gameHref("/game/worldboss")} className="text-gold underline"> {t("מפלצת העולם")} </Link></>, <><b>{t("כל השרת נמצא באותו צד")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="turns"
                  label={t("מכה עולה")}
                  value={tunables.worldBoss.strikeTurns}
                  hint={t("תורות — כארבע תקיפות")}
                  tone="text-emerald-300"
                />
                <Fact
                  icon="attack"
                  label={t("מכות ליום")}
                  value={tunables.worldBoss.maxStrikes}
                  hint={t("לכל אימפריה, בלי קשר לתורות")}
                />
                <Fact
                  icon="heart"
                  label={t("חיים לכל אימפריה")}
                  value={formatShort(WORLD_BOSS_HP_PER_EMPIRE)}
                  hint={t("מינימום {p0}", { p0: formatShort(WORLD_BOSS_HP_MIN) })}
                  tone="text-crimson-bright"
                />
                <Fact
                  icon="diamond"
                  label={t("מכת המוות")}
                  value={tunables.worldBoss.killDiamonds}
                  hint={t("יהלומים, למי שהפיל אותה")}
                  tone="text-cyan-300"
                />
              </div>

              <Formula
                label={t("נזק של מכה")}
                expr={
                  <>
                    <V>{t("√הכוח הצבאי שלך")}</V>
                    <O>×</O>
                    <N>{WORLD_BOSS_DAMAGE_PER_POWER}</N>
                    <O>×</O>
                    <O>(</O>
                    <N>1</N>
                    <O>±</O>
                    <N>{Math.round(WORLD_BOSS_DAMAGE_SPREAD * 100)}%</N>
                    <O>)</O>
                    <O>=</O>
                    <R>{t("נזק")}</R>
                  </>
                }
                legend={[
                  {
                    term: t("שורש, שוב"),
                    desc: t("פי מאה כוח שווה קצת יותר מפי שלושה נזק. בלי זה, הלוח היה נסגר לפני שהאימפריות הקטנות הספיקו לטעון את הדף, וחלקן בשלל היה מתעגל לאפס."),
                  },
                  {
                    term: t("למה ±{p0}%", { p0: Math.round(WORLD_BOSS_DAMAGE_SPREAD * 100) }),
                    desc: t("הדף מפרסם את החיים שנשארו למפלצת. בלי פיזור, מי שיודע לחשב את הנזק שלו היה יושב וממתין שהמד ירד בדיוק אל מתחת למכה שלו — ולוקח את היהלומים כל יום בוודאות. הפיזור הופך את המכה האחרונה למרוץ."),
                  },
                  {
                    term: t("רצפה של נזק אחד"),
                    desc: t("אימפריה טרייה בלי צבא בכלל עדיין מזיזה את המד. זה ההבדל בין ״עזרתי״ ל״למה הדף הזה קיים״."),
                  },
                  {
                    term: t("מאגר החיים ננעל בהופעה"),
                    desc: t("הוא מחושב פעם אחת לפי מספר האימפריות באותו רגע ולא מחושב מחדש — מפלצת שהתחזקה כי מישהו נרשם ביום חמישי הייתה עונש על גדילה."),
                  },
                ]}
              />

              <Formula
                label={t("חלוקת השלל")}
                expr={
                  <>
                    <N>{WORLD_BOSS_FLOOR_SHARE}</N>
                    <O>÷</O>
                    <V>{t("מספר המשתתפים")}</V>
                    <O>+</O>
                    <N>{(1 - WORLD_BOSS_FLOOR_SHARE).toFixed(1)}</N>
                    <O>×</O>
                    <V>{t("חלקך בנזק")}</V>
                    <O>=</O>
                    <R>{t("חלקך בקופה")}</R>
                  </>
                }
                legend={[
                  {
                    term: t("חצי על ההופעה"),
                    desc: t("מתחלק שווה בשווה בין כל מי שהנחית מכה. זה המספר שמחליט אם הפיקסצ׳ר שווה את הזמן של אימפריה קטנה, והוא נדיב בכוונה."),
                  },
                  {
                    term: t("חצי על הנזק"),
                    desc: t("מי שנשא את הקרב עדיין מרוויח מזה שנשא אותו."),
                  },
                  {
                    term: t("הקופה המלאה (בעיר אחת)"),
                    desc: <Purse rewards={worldBossPurse} />,
                  },
                  {
                    term: t("מי שלא הכה לא מקבל"),
                    desc: t("אין פרס נוכחות. יש רצפה למי שהשתתף."),
                  },
                  {
                    term: t("השלל משולם מעצמו"),
                    desc: t("ברגע שהמפלצת נופלת, החלק של כל מי שהכה בה נכנס לאוצר שלו ומגיעה הודעה לתיבה עם הפירוט. אין מה ללחוץ ואין חלון שנסגר — גם מי שלא היה מחובר באותו רגע מקבל את חלקו המלא."),
                  },
                ]}
              />

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("מצב")}</th>
                      <th>{t("חיים")}</th>
                      <th>{t("מה קורה")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WORLD_BOSS_PHASES.map((phase, index) => {
                      const from = WORLD_BOSS_PHASES[index - 1]?.from ?? 1;
                      return (
                        <tr key={phase.key}>
                          <td className="whitespace-nowrap font-bold text-bone">
                            {phase.label}
                          </td>
                          <td className="nums whitespace-nowrap text-crimson-bright" dir="ltr">
                            {Math.round(phase.from * 100)}–{Math.round(from * 100)}%
                          </td>
                          <td className="text-zinc-400">
                            {t(
                              // i18n-keys: the fallback is the key t() looks up
                              phase.cry ?? "המצב שבו הקרב נפתח."
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>

              <Note tone="purple" icon="heart" title={t("המצב משתנה, המספרים לא")}><RichText text={t("ככל שהמפלצת נשחקת היא עוברת בין ארבעה מצבים, וכל השרת חוצה כל סף יחד — מי שהמכה שלו שברה את הסף הוא שרואה את ההכרזה. המצב משנה איך הזירה נראית ומה היא אומרת, ו<0>: לא את מאגר החיים, לא את הנזק ולא את הקופה. זו החלטה ולא השמטה — כל השלושה מכוילים זה מול זה, ו״זעם״ שהיה מכפיל חיים באמצע הקרב היה מכייל מחדש את הפיקסצ׳ר דווקא לשרת שכבר מפגר.")} slots={[<><b>{t("לא משנה שום מספר")}</b></>]} /></Note>

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("המפלצת")}</th>
                      <th>{t("קושי")}</th>
                      <th>{t("הסיפור")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WORLD_BOSSES.map((boss) => (
                      <tr key={boss.key}>
                        <td className="whitespace-nowrap font-bold text-bone">
                          <span aria-hidden className="ms-1">
                            {boss.sigil}
                          </span>
                          {boss.name}
                        </td>
                        <td className="nums text-crimson-bright" dir="ltr">
                          ×{boss.toughness}
                        </td>
                        <td className="text-zinc-400">{boss.lore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <Note tone="purple" icon="turns" title={t("יום אחד, מפלצת אחת")}>{t("איזו מפלצת מופיעה נגזר מהיום עצמו, כך שכל שחקן בעולם רואה את אותה מפלצת בלי שאף אחד ״פתח״ אותה — והיא עולה בחצות בלי שאף אחד צריך להיכנס לזירה. מה שלא הופל עד חצות פשוט נעלם, ומחר עולה אחרת (אף פעם לא זו של אתמול) — עם מאגר חיים חדש ומכסת מכות חדשה.")}</Note>
            </GuideSection>

            {/* ============================ 24 guild ============================ */}
            <GuideSection meta={sections.guild} index={INDEX.guild}>
              <Lead><RichText text={t("ברית היא כוח משותף. הקמה עולה  <0> יהלומים, והיא נותנת שני דברים שונים לגמרי: <1> אישיים שנמשכים שעות ספורות, ו <2> שמחזקת כל חבר בכל קרב.")} slots={[<><b className="nums">{GUILD_CREATION_COST_DIAMONDS}</b></>, <><b>{t("קסמים")}</b></>, <><b>{t("עזרה פסיבית")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {GUILD_SPELL_TYPES.map((type) => {
                  const meta = GUILD_SPELL_META[type];
                  return (
                    <div key={type} className="panel-gold rounded-xl p-4">
                      <p className="flex items-center gap-2 font-black text-gold-bright">
                        <Icon name={meta.icon} size={18} className="text-crimson-bright" />
                        {meta.label}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                        {meta.description}
                      </p>
                      <p className="mt-2 text-[11px] text-emerald-300">{t("{p0} (בשיא)", { p0: meta.effectLabel(t, meta.maxLevel) })}</p>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Formula
                  label={t("קסם ברית")}
                  expr={
                    <>
                      <V>{t("רמת הקסם")}</V>
                      <O>=</O>
                      <V>{t("אחוז הבונוס")}</V>
                      <O>·</O>
                      <V>{t("הטלה")}</V>
                      <O>=</O>
                      <N>10</N>
                      <O>+</O>
                      <V>{t("אחוז")}</V>
                      <O>×</O>
                      <N>2</N>
                      <V> {t("יהלומים")}</V>
                    </>
                  }
                  legend={[
                    {
                      term: t("תקרה"),
                      desc: t("{p0}% — רמת הקסם היא הבונוס עצמו.", { p0: GUILD_SPELL_META.ATTACK.maxLevel }),
                    },
                    { term: t("שדרוג"), desc: t("{p0} יהלומים לרמה 2, וכן הלאה (40 × הרמה הבאה).", { p0: nf(spellUpgradeCostDiamonds(1)) }) },
                    {
                      term: t("הטלה בשיא"),
                      desc: t("{p0} יהלומים ל־{p1} שעות.", { p0: spellCastCostDiamonds("ATTACK", GUILD_SPELL_META.ATTACK.maxLevel), p1: GUILD_SPELL_META.ATTACK.buffHours }),
                    },
                  ]}
                />
                <Formula
                  label={t("עזרת ברית (פסיבית)")}
                  expr={
                    <>
                      <V>{t("רמת עזרה %")}</V>
                      <O>×</O>
                      <V>{t("הכוח הצבאי הכולל של הברית")}</V>
                      <O>=</O>
                      <R>{t("כוח קבוע לכל חבר")}</R>
                    </>
                  }
                  legend={[
                    { term: t("תקרה"), desc: t("{p0}% מכוח הברית כולה.", { p0: GUILD_AID_MAX_LEVEL }) },
                    { term: t("מתי"), desc: t("גם בתקיפה וגם בהגנה, מתווסף אחרי כל המכפילים.") },
                    {
                      term: t("מחיר"),
                      desc: t("{p0} זהב לרמה הראשונה, ומשולם מאוצר הברית — לכן רק מנהיג או סגן יכולים לקנות אותו.", { p0: formatShort(aidUpgradeCostGold(0)) }),
                    },
                  ]}
                />
              </div>

              <TableWrap>
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th className="text-right">{t("רמת הרחבה")}</th>
                      <th className="text-right">{t("מקומות בברית")}</th>
                      <th className="text-right">{t("עלות ההרחבה")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 3, 5, 7, 9].map((lvl) => (
                      <tr key={lvl}>
                        <td className="nums" dir="ltr">
                          {lvl}
                        </td>
                        <td className="nums font-bold text-bone-bright" dir="ltr">
                          {guildCapacity(lvl)}
                        </td>
                        <td>
                          <Cost amounts={[{ key: "gold", value: capacityUpgradeCostGold(lvl) }]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <Note tone="gold" icon="guild" title={t("אוצר הברית")}><RichText text={t("קופת זהב משותפת שממנה נקנות שתי הסולמות שלמעלה — <0>. כל חבר יכול לתרום (מינימום  <1> זהב לתרומה, כדי שלוח התורמים ימדוד נתינה ולא לחיצות), ומה שנתת נרשם על שמך לתמיד גם אחרי שהאוצר מתרוקן. <2>: זהב שנכנס שייך לברית, וההנהגה מחליטה מה הוא <3> — לא מי מקבל אותו בחזרה.")} slots={[<><b>{t("ההרחבה והעזרה")}</b></>, <><b className="nums">{formatShort(GUILD_DONATION_MIN)}</b></>, <><b>{t("אין משיכה")}</b></>, <><b>{t("קונה")}</b></>]} /></Note>

              <Note tone="green" icon="check" title={t("חוזה יומי")}><RichText text={t("לכל ברית יש יעד יומי משותף שנמדד במשימות היומיות של החברים, והוא משלם לכל חבר בנפרד. הוא מופיע גם כאן וגם על  <0> .")} slots={[<><Link href={gameHref("/game/daily")} className="text-gold underline"> {t("לוח היום")} </Link></>]} /></Note>

              <Note tone="red" icon="base" title={t("ברית אחת, עיר אחת")}><RichText text={t("כל חברי הברית עומדים ב <0> — עיר הברית היא עיר המנהיג, ואפשר להזמין רק שחקנים שנמצאים בה. לכן <1>: מי שאינו מנהיג פורש מהברית אוטומטית, ומנהיג לוקח איתו את עיר הברית — הברית מתפרקת על אוצרה ושדרוגיה. מנהיג שמתכוון לעלות עיר צריך <2> לפני שהוא זז.")} slots={[<><b>{t("אותה עיר")}</b></>, <><b>{t("שינוי עיר מוציא אותך מהברית")}</b></>, <><b>{t("להעביר את ההנהגה")}</b></>]} /></Note>

              <Note tone="gold" icon="guild" title={t("אין תקיפות בין חברי ברית")}><RichText text={t("חבר לברית אינו יעד: כפתור התקיפה בפרופיל שלו כבוי, וגם שליחה ישירה נחסמת. הסיבה פשוטה — עזרת הברית והקסמים מחזקים את שני הצדדים, כך שקרב פנימי הוא שוד של הכוח שלכם עצמכם. <0> נשארים פתוחים, ומי שעוזב את הברית חוזר להיות יעד לגיטימי.")} slots={[<><b>{t("ריגול ודואר")}</b></>]} /></Note>
            </GuideSection>

            {/* ============================ 25 chat ============================ */}
            <GuideSection meta={sections.chat} index={INDEX.chat}>
              <Lead><RichText text={t("בפינה השמאלית התחתונה של כל מסך יושב <0>. הוא לא דף אלא חלונית צפה: אפשר לדבר תוך כדי בנייה, תקיפה או קריאת דוח, והיא נשארת פתוחה גם כשעוברים מסך. שתי לשוניות — <1> שכל השרת רואה, ו <2> אחד על אחד.")} slots={[<><b>{t("הצ׳אט")}</b></>, <><b>{t("החדר הפומבי")}</b></>, <><b>{t("שיחות פרטיות")}</b></>]} /></Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="chat"
                  label={t("אורך הודעה")}
                  value={CHAT_BODY_MAX}
                  hint={t("תווים — צעקה, לא מכתב")}
                />
                <Fact
                  icon="messages"
                  label={t("נמען פרטי")}
                  value={t("כל שחקן")}
                  hint={t("חיפוש לפי שם, בלי צורך לתפוס אותו מרגל")}
                  tone="text-purple-300"
                />
                <Fact
                  icon="turns"
                  label={t("נקודה ירוקה")}
                  value={t("{minutes} דק׳", {
                    minutes: Math.round(PRESENCE_ONLINE_MS / 60000),
                  })}
                  hint={t("מאז שהמשחק היה פתוח אצלו — גם ליד כל שם בדירוג")}
                  tone="text-emerald-300"
                />
                <Fact
                  icon="spark"
                  label={t("קצב")}
                  value={t("{count}/{seconds}ש׳", {
                    count: CHAT_BURST_LIMIT,
                    seconds: Math.round(CHAT_BURST_WINDOW_MS / 1000),
                  })}
                  hint={t("בלם הצפה — ראה למטה")}
                  tone="text-bone-bright"
                />
              </div>

              <Formula
                label={t("מה מותר לשלוח")}
                expr={
                  <>
                    <N>{CHAT_BURST_LIMIT}</N>
                    <O> {t("הודעות ב־")}</O>
                    <N>{Math.round(CHAT_BURST_WINDOW_MS / 1000)}</N>
                    <O> {t("שניות")}</O>
                    <O>·</O>
                    <N>{CHAT_GLOBAL_LIMIT}</N>
                    <V> {t("בחדר לדקה")}</V>
                    <O>·</O>
                    <N>{CHAT_DIRECT_LIMIT}</N>
                    <V> {t("בפרטי לדקה")}</V>
                    <O>·</O>
                    <N>{CHAT_PAIR_LIMIT}</N>
                    <V> {t("לאותו שחקן")}</V>
                  </>
                }
                legend={[
                  {
                    term: t("שתי מכסות"),
                    desc: t("הבלם המהיר עוצר הדבקה בלולאה, ומכסת הדקה עוצרת הצפה מתמשכת. לחדר ולשיחות פרטיות מכסות נפרדות — שיחה ארוכה לא גוזלת את הזכות שלך לדבר בחדר."),
                  },
                  {
                    term: t("מכסה לכל שיחה"),
                    desc: t("{p0} הודעות בדקה לכל בן שיח, כדי שלא יהיה אפשר להפנות דקה שלמה לשחקן אחד. המכסה נספרת על הצמד, אז החלפת תפקידים לא מאפסת אותה.", { p0: CHAT_PAIR_LIMIT }),
                  },
                  {
                    term: t("כפילות"),
                    desc: t("אותה הודעה בדיוק לאותו יעד חסומה ל־{p0} שניות. אותן מילים בחדר ובשיחה פרטית נחשבות לשתי אמירות שונות.", { p0: Math.round(CHAT_REPEAT_WINDOW_MS / 1000) }),
                  },
                  {
                    term: t("מי מקליד"),
                    desc: t("מתחת לחלונית רואים בזמן אמת מי כותב עכשיו — בחדר ובשיחה — והנקודה ליד השם מראה מי מחובר."),
                  },
                ]}
              />

              <Note tone="purple" icon="messages" title={t("צ׳אט מול תיבת הדואר — שני פתחים, שיחה אחת")}>{t("השיחה הפרטית בין שני שחקנים היא אותה שיחה בשני המקומות. הודעה ששלחת מדף ההודעות או מהדוסיה מופיעה גם בשיחה הפרטית בצ׳אט, מסומנת ב־✉, וכל מה שנאמר בצ׳אט מופיע כשלוחצים על השב בתיבה — אין שתי היסטוריות ואין מה לסנכרן. ההבדל היחיד הוא הרעש: הודעה שנשלחה כדואר נוחתת גם בתיבת הנמען ומדליקה לו מונה שם, כי היא נכתבה למי שאולי לא ליד המקלדת; שורת צ׳אט מדליקה רק את המונה של הצ׳אט. התיבה נשארת הארכיון — דוחות קרב, ריגול ושלל שליטי ערים ממתינים בה בלי קשר לשיחות.")}</Note>

              <Note tone="red" icon="shield" title={t("מנהל יכול להסתיר שורה")}>{t("הסתרה, לא מחיקה: השורה נעלמת מהחדר של כולם ונרשמת ביומן הניהול עם השם של מי שהסתיר אותה. שחקן חסום לא מופיע ברשימה ואי אפשר לכתוב אליו.")}</Note>
            </GuideSection>

            {/* ============================ 26 community ============================ */}
            <GuideSection meta={sections.community} index={INDEX.community}>
              <Lead>{t("מחוץ למשחק יש ערוץ דיסקורד — שם יושבות ההכרזות, גיוס לבריתות, שאלות טקטיקה ודיווחי באגים. אפשר לשחק בלעדיו לגמרי; פשוט תדעו על Happy Hour אחרי כולם.")}</Lead>

              <div className="grid gap-3 sm:grid-cols-2">
                {COMMUNITY_HIGHLIGHTS.map((item) => (
                  <div key={item.title} className="panel-inset rounded-xl p-4">
                    <p className="flex items-center gap-2 font-black text-gold-bright">
                      <Icon
                        name={item.icon}
                        size={17}
                        className="shrink-0 text-crimson-bright"
                      />
                      {item.title}
                    </p>
                    <p className="mt-1 text-[0.8rem] leading-relaxed text-zinc-400">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>

              <Note tone="green" icon="gift" title={t("מתנת הצטרפות חד־פעמית")}><RichText text={t("אימפריה שמצטרפת לערוץ אוספת <0>  יהלומים, פעם אחת בחיי החשבון. אין בוט שבודק — הכפתור עובד על אמון. מתנת פתיחה, כל עוד הערוץ צעיר. הכפתור נמצא בעמוד הקהילה.")} slots={[<><b className="nums">{DISCORD_JOIN_DIAMONDS}</b></>]} /></Note>

              <Note tone="red" icon="shield" title={t("אף אחד מהצוות לא יבקש סיסמה")}>{t("לא בדיסקורד, לא בצ׳אט של המשחק ולא בהודעה פרטית. כל בקשה כזו — גם אם היא מגיעה משם שנראה מוכר — היא ניסיון גניבת חשבון. אותו כלל חל על קודי אימות ופרטי תשלום.")}</Note>

              <div className="flex justify-center">
                <Link href={gameHref("/game/community")} className="btn btn-gold px-5 py-2 text-sm">
                  <Icon name="discord" size={16} className="inline align-[-2px]" /> {t("לעמוד הקהילה")}
                </Link>
              </div>
            </GuideSection>

            {/* ============================ 27 referrals ============================ */}
            <GuideSection meta={sections.referrals} index={INDEX.referrals}>
              <Lead><RichText text={t("<0> הוא נמצא ב <1>  — שולחים אותו, ומי שנרשם דרכו נקשר אליך לבד. אין מה למלא בטופס ההרשמה. מי שקיבל רק את הקוד או את שם האימפריה יכול לרשום אותו ידנית באותו עמוד, כל עוד הוא בתחילת הדרך. שני הצדדים מקבלים את הפרס רק כשהחדש מגיע ל־ <2> ערים — כלומר כששחקן אמיתי נשאר, לא כשנפתח חשבון.")} slots={[<><b>{t("לכל שחקן יש קישור הזמנה משלו.")}</b></>, <><Link href={gameHref("/game/referrals")} className="text-gold underline"> {t("דף ההזמנות")} </Link></>, <><b className="nums">{REFERRAL_GOAL_CITIES}</b></>]} /></Lead>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> למזמין")} slots={[<><Icon name="gift" size={18} /></>]} /></p>
                  <Purse rewards={REFERRAL_REFERRER_PURSE} />
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-400"><RichText text={t("החצי הגדול, ונגבה בנפרד לכל מוזמן שהגיע ליעד — עד  <0> פרסי הזמנה בעונה.")} slots={[<><b className="nums">{REFERRAL_SEASON_CAP}</b></>]} /></p>
                </div>
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> למוזמן")} slots={[<><Icon name="citizens" size={18} /></>]} /></p>
                  <Purse rewards={REFERRAL_JOINER_PURSE} />
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{t("פחות יהלומים ויותר ממה שאימפריה צעירה באמת צריכה — תורות ואנשים.")}</p>
                </div>
              </div>

              <Formula
                label={t("החלון לרישום מזמין")}
                expr={
                  <>
                    <V>{t("הערים שלך")}</V>
                    <O>≤</O>
                    <N>{REFERRAL_NAME_MAX_CITIES}</N>
                    <O>→</O>
                    <R>{t("אפשר לרשום מזמין")}</R>
                  </>
                }
                legend={[
                  {
                    term: t("פעם אחת, ואי אפשר לשנות"),
                    desc: t("אחרי {p0} ערים החלון נסגר — בערך הערב הראשון. מספיק זמן כדי שחבר יזכיר את זה אחרי המשחק הראשון, וקצר מספיק כדי ששחקן ותיק לא יסחר בנאמנות שלו.", { p0: REFERRAL_NAME_MAX_CITIES }),
                  },
                  {
                    term: t("לא בעיגול ולא לצוות"),
                    desc: t("אי אפשר לרשום מישהו שכבר רשם אותך — גם לא דרך שרשרת ארוכה יותר — ואי אפשר לרשום חשבון צוות או חשבון מוצב."),
                  },
                  {
                    term: t("היעד נמדד חי"),
                    desc: t("הפרס נבדק מול מספר הערים שהחדש מחזיק עכשיו — {p0} ערים זה ימים של משחק אמיתי, ולא חותמת שנרשמה פעם.", { p0: REFERRAL_GOAL_CITIES }),
                  },
                  {
                    term: t("עונה חדשה, קשר חדש"),
                    desc: t("איפוס עונה מוחק ובונה מחדש כל אימפריה, ולכן הקשר לא שורד אותו. הקישור עצמו כן שורד — הוא שייך לחשבון, לא לאימפריה. הקריאה הנכונה של זה: להחזיר חבר שנטש בדיוק לעונה החדשה זו בדיוק ההתנהגות ששווה לשלם עליה שוב."),
                  },
                ]}
              />

              <Note tone="red" icon="shield" title={t("חשבון שני שלך הוא לא חבר")}>
                {t("הזמנה משלמת יהלומים, ולכן היא נבדקת. שני חשבונות שהם בבירור אותו אדם — אותה תיבת דואר (כולל תעלולי נקודות ו־")}<span dir="ltr">{t("+תווית")}</span>{" "}
                {t("בג׳ימייל), או שניהם נכנסו למשחק מאותו דפדפן — לא נקשרים בכלל, והפרס פשוט לא נוצר.")}
                <br />
                {t("דברים שרק")} <b>{t("נראים")}</b> {t("חשודים מטופלים אחרת בכוונה. שני שחקנים מאותה כתובת IP הם לרוב אחים, שותפים לדירה, משרד או פשוט אותה רשת סלולרית — וזה גם המקרה הכי נפוץ של הזמנה אמיתית. במצב כזה הקישור נוצר וההתקדמות נספרת, אבל הפרס ממתין לאישור אנושי לפני שהוא משולם. אותו דבר קורה ליותר מ־")}
                <b className="nums">{REFERRAL_BURST_LIMIT}</b> {t("מוזמנים ביממה אחת, או כששני הצדדים מתחילים לתקוף ולרגל אחד את השני.")}
              </Note>
            </GuideSection>

            {/* ============================ 28 titles ============================ */}
            <GuideSection meta={sections.titles} index={INDEX.titles}>
              <Lead><RichText text={t("<0>  הוא השורה שמתחת לשם שלך — בדוסיה ובדירוגים. הוא <1>, וזה כל העניין: זו הדרך הבטוחה היחידה למכור משהו, כי הוא לא משנה שום מספר במשחק. שני סוגים, וההבדל ביניהם מכוון להיות ברור מהניסוח:  <2>  <3> ולא נמכרים בשום מחיר, ו־ <4>  <5> וכתובים כהתרברבות ולא כהישג. הנצברים מסודרים בשלוש דרגות קושי — <6>, <7> ו<8> — ובכל דרגה הדרישה גדולה יותר מזו שמעליה בטבלה.")} slots={[<><Link href={gameHref("/game/titles")} className="text-gold underline"> {t("תואר")} </Link></>, <><b>{t("לא מכפיל כלום")}</b></>, <><b className="nums">{TITLES.filter((title) => title.kind === "earned").length}</b></>, <><b>{t("נצברים")}</b></>, <><b className="nums">{TITLES.filter((title) => title.kind === "bought").length}</b></>, <><b>{t("נקנים")}</b></>, <><b>{t("רגיל")}</b></>, <><b>{t("נדיר")}</b></>, <><b>{t("אגדי")}</b></>]} /></Lead>

              <TableWrap>
                <table className="guide-table w-full text-right text-[0.78rem]">
                  <thead>
                    <tr>
                      <th>{t("תואר")}</th>
                      <th>{t("דרגה")}</th>
                      <th>{t("איך משיגים")}</th>
                      <th>{t("מחיר")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TITLES.map((title) => (
                      <tr key={title.key}>
                        <td
                          className="title-worn-inline whitespace-nowrap font-black"
                          data-kind={title.kind}
                          data-tier={title.tier}
                          style={{ "--accent": title.accent } as CSSProperties}
                        >
                          {title.label}
                        </td>
                        <td className="whitespace-nowrap text-zinc-400">
                          {title.tier ? TIER_LABEL[title.tier] : "—"}
                        </td>
                        <td className="text-zinc-400">
                          {fillParams(title.hint, TITLE_PARAMS)}
                        </td>
                        <td>
                          {title.kind === "earned" ? (
                            <span className="text-emerald-300">{t("נצבר")}</span>
                          ) : (
                            <Cost amounts={[{ key: "diamonds", value: title.price }]} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <div className="grid gap-3 sm:grid-cols-2">
                <Note tone="gold" icon="achievements" title={t("תואר נצבר לא נמכר")}><RichText text={t("התנאים שלו נבדקים מחדש בכל טעינה מול אותם מוני חיים שההישגים והמשימות קוראים — אין מה למלא ואין מה לגבות. הם מכוונים <0> מדרגת ההישג המקבילה, כי תואר צריך להיות נדיר יותר מסולם הפרסים או שהדירוג הופך לקיר של אותה כותרת: <1> יושב מעל אמצע סולם ההישגים,  <2> בקצה העליון שלו, ו<3> מעבר לסולם כולו.")} slots={[<><b>{t("גבוה יותר")}</b></>, <><b>{t("רגיל")}</b></>, <><b>{t("נדיר")}</b></>, <><b>{t("אגדי")}</b></>]} /></Note>
                <Note tone="purple" icon="crown" title={t("עונדים אחד בכל פעם")}>{t("אפשר להחזיק כמה שרוצים ולענוד אחד. תואר שהוסר מהמשחק פשוט מפסיק להופיע מתחת לשם, בלי לשבור שום דירוג.")}</Note>
                <Note tone="gold" icon="rankings" title={t("איפה התואר נראה")}><RichText text={t("בכל מקום שבו <0>: בדוסיה, בסולם העיר ובטבלאות המובילים, ברשימת חברי הברית, בזירה ובלוח מלחמת הבריתות, בפודיום העונה ובשיאי העולם. הוא <1> מופיע בצ׳אט, בדואר ובהיסטוריית הקרבות והריגול — מילה צבועה בכל שורה של פיד נגללת מפסיקה להיות הבחנה.")} slots={[<><b>{t("משווים בין שחקנים")}</b></>, <><b>{t("לא")}</b></>]} /></Note>
                <Note tone="red" icon="spark" title={t("נצבר זוהר, נקנה לא")}><RichText text={t("תואר נצבר נמשך בהילה משלו וקנוי נצבע בצבע שטוח בלבד, כדי שמי שקורא דירוג יבדיל בלי להכיר את הקטלוג. נדיר בוער חזק יותר מרגיל, ושלושת האגדיים  <0>  — פעימה איטית בצבע התואר. אין תואר קנוי שנושם: הדבר היחיד שיהלומים לא קונים כאן הוא מראה של הישג.")} slots={[<><span className="title-worn-inline" data-kind="earned" data-tier="legendary" style={{ "--accent": "228 195 90" } as CSSProperties} > {t("נושמים")} </span></>]} /></Note>
              </div>
            </GuideSection>

            {/* ============================ 29 rewards ============================ */}
            <GuideSection meta={sections.rewards} index={INDEX.rewards}>
              <Lead>{t("שלושה מקורות פרסים שמתחדשים מעצמם — כולם על אותו שעון של העדכון היומי, וכולם גדלים ככל שהעונה מתקדמת.")}</Lead>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> גלגל המזל")} slots={[<><Icon name="wheel" size={18} /></>]} /></p>
                  <p className="text-[11px] leading-relaxed text-zinc-400"><RichText text={t("<0> סיבובים בכל עדכון יומי, נצברים בלי הגבלה — שבוע היעדרות לא מבזבז כלום.  {p0} פרסים, וכל פרס <1> מהערך שלו ביום הראשון עד הערך שלו בעדכון האחרון של העונה — בלי קפיצות ובלי תקרה שנתקעים בה באמצע. ארבעת המשאבים הולכים מ־ <2> ל־ <3> כל אחד (גדילה מוכפלת, כמו הכלכלה עצמה), היהלומים מ־ <4> ל־ <5> והאזרחים מ־ <6> ל־ <7> (תוספת קבועה בכל עדכון). עונה קצרה יותר פשוט מטפסת מהר יותר — הסוף תמיד אותו סוף.", { p0: WHEEL_PRIZES.length })} slots={[<><b className="nums">{tunables.daily.wheelSpins}</b></>, <><b>{t("גדל בכל עדכון יומי")}</b></>, <><b className="nums">{nf(WHEEL_RESOURCE_BASE)}</b></>, <><b className="nums">{nf(WHEEL_RESOURCE_FINAL)}</b></>, <><b className="nums">{WHEEL_DIAMOND_BASE}</b></>, <><b className="nums">{WHEEL_DIAMOND_FINAL}</b></>, <><b className="nums">{WHEEL_CITIZEN_BASE}</b></>, <><b className="nums">{WHEEL_CITIZEN_FINAL}</b></>]} /></p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {WHEEL_PRIZES.map((p) => (
                      <span
                        key={p.key}
                        className="flex items-center gap-1 rounded border border-border-subtle bg-black/40 px-2 py-0.5 text-[10px] font-bold text-zinc-300"
                      >
                        <Icon name={p.icon} size={11} className="text-gold" />
                        {p.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="panel-gold rounded-xl p-4">
                  <p className="mb-2 flex items-center gap-2 font-black text-gold-bright"><RichText text={t("<0> דרך התהילה")} slots={[<><Icon name="gift" size={18} /></>]} /></p>
                  <p className="text-[11px] leading-relaxed text-zinc-400"><RichText text={t("<0> דרגות, כל אחת ב־ <1> נקודות ניסיון —  <2> לסבב מלא. הסולם <3>, כלומר שני סבבים מלאים ביום. הפרסים גדלים לאורך העונה: הדרגה הגבוהה בסולם משלמת <4> זהב ביום הראשון ו־ <5> ביום האחרון. המסלול הפרימיום נקנה פעם אחת לעונה ב־ <6> יהלומים.")} slots={[<><b className="nums">{SEASON_PASS_TIER_COUNT}</b></>, <><b className="nums">{SEASON_PASS_XP_PER_TIER}</b></>, <><b className="nums">{SEASON_PASS_TIER_COUNT * SEASON_PASS_XP_PER_TIER}</b></>, <><b>{t("מתאפס בכל עדכון יומי")}</b></>, <><b className="nums">{formatNumber(SEASON_PASS_DAY1_PEAK.gold)}</b></>, <><b className="nums">{formatNumber(SEASON_PASS_FINAL_PEAK.gold)}</b></>, <><b className="nums">{nf(SEASON_PASS_PREMIUM_PRICE)}</b></>]} /></p>
                  <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-3">
                    {(
                      [
                        // i18n-keys-start: dictionary keys, drawn through t(label) below
                        ["תקיפה", SEASON_PASS_XP.attack],
                        ["קרב בוס", SEASON_PASS_XP.bossFight],
                        ["ייסוד עיר", SEASON_PASS_XP.foundCity],
                        ["שדרוג אימפריה", SEASON_PASS_XP.empireUpgrade],
                        ["ריגול", SEASON_PASS_XP.spy],
                        ["מיני־משחק", SEASON_PASS_XP.miniGame],
                        // i18n-keys-end
                      ] as const
                    ).map(([label, xp]) => (
                      <span
                        key={label}
                        className="flex items-center justify-between rounded bg-black/40 px-2 py-1"
                      >
                        <span className="text-zinc-400">{label}</span>
                        <b className="nums text-gold-bright">+{xp}</b>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* The one prize on this screen that does not renew: five records
                  for a whole season, one player each. Built off GLORY_KEYS and
                  GLORY_PRIZE rather than written out, so retuning a purse moves
                  the guide with it — the question this answers ("what do I get
                  for a world record?") is the one players kept asking. */}
              <div className="panel-gold rounded-xl p-4">
                <p className="mb-2 flex items-center gap-2 font-black text-gold-bright">
                  <RichText text={t("<0> שיאי העולם")} slots={[<><Icon name="crown" size={18} /></>]} />
                </p>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  <RichText
                    text={t("חמישה שיאים, ולכל אחד <0> בעולם כולו. הראשון שמגיע ליעד מקבל את הפרס <1>, והשם שלו נחרט על הלוח שבראש הבסיס עד סוף העונה. אין מה לאסוף ואין מה ללחוץ — הפרס נכנס לחשבון בכניסה הבאה לבסיס, ומגיע גם הודעה לתיבה. בעונה חדשה כל חמשת השיאים נפתחים מחדש.")}
                    slots={[<><b>{t("זוכה אחד")}</b></>, <><b>{t("אוטומטית")}</b></>]}
                  />
                </p>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {GLORY_KEYS.map((key) => (
                    <span
                      key={key}
                      className="flex items-start justify-between gap-3 rounded bg-black/40 px-2.5 py-1.5 text-[11px]"
                    >
                      {/* Wraps rather than truncates: the guide is where a
                          player comes to read the goal in full, and two of the
                          five names are a whole sentence. */}
                      <span className="flex min-w-0 items-start gap-1.5 leading-snug text-zinc-400">
                        <Icon
                          name={GLORY_ICON[key] ?? ACHIEVEMENT_BY_KEY.get(key)?.icon ?? "crown"}
                          size={13}
                          className="mt-px shrink-0 text-gold"
                        />
                        <span>{t(GLORY_NAME[key] ?? key)}</span>
                      </span>
                      {/* Spelled out, like the band on the board itself: the
                          reader is here precisely because they did not know
                          what the prize was. */}
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-zinc-400">
                        {gloryPrize(key).map((r) => (
                          <span key={r.kind} className="whitespace-nowrap">
                            <b className="nums text-gold-bright">{nf(r.amount)}</b>{" "}
                            {t(REWARD_LABEL[r.kind])}
                          </span>
                        ))}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Note tone="purple" icon="dice" title={t("מיני־משחקים")}><RichText text={t('אירועים שהמנהלים פותחים בזמן אמת, בארבעה טעמים:  <0> (הרם את הכוס הנכונה),  <1> (פצח קוד; כל ניסיון מסמן איזו ספרה נכונה במקומה, איזו נכונה במקום אחר ואיזו לא בקוד כלל), <2> (חפור במשבצת ברשת, וכל חפירה חוזרת עם "חם או קר" לפי המרחק) ו<3>  (שאלה אחת, תשובה אחת). כשמשחק נפתח מופיע כפתור זהוב בסרגל העליון עם שעון וספירת הניסיונות שנותרו — לחיצה פותחת את המשחק, לוח המתחרים ורשימת הזוכים. מספר הניסיונות נגזר מהמשחק: בכוסות זה כמעט תמיד ניסיון אחד; בכספת ובמפה כל ניסיון הוא רמז, ולכן יש כמה — אבל אף פעם לא מספיק כדי לסרוק את הלוח.')} slots={[<><b>{t("מצא את הכדור")}</b></>, <><b>{t("פריצת הכספת")}</b></>, <><b>{t("מפת האוצר")}</b></>, <><b>{t("חידה")}</b></>]} /></Note>
                <Note tone="gold" icon="achievements" title={t("הישגים")}><RichText text={t("ציוני דרך שנפתחים מעצמם תוך כדי משחק ומחכים לאיסוף. תג זהוב בסרגל העליון אומר שיש פרס שממתין —  <0> .")} slots={[<><Link href={gameHref("/game/achievements")} className="text-gold underline"> {t("לדף ההישגים")} </Link></>]} /></Note>
              </div>
            </GuideSection>

            {/* ============================ 30 diamonds ============================ */}
            <GuideSection meta={sections.diamonds} index={INDEX.diamonds}>
              <Lead>{t("יהלומים הם המטבע הנדיר. הם לא נופלים ממכרות ולא מהעונה — רק מווג׳ אחד בגלגל המזל, מטפטוף של המכנסיים בעדכון היומי, ומרכישה אמיתית. לכן כל הוצאה שלהם היא החלטה.")}</Lead>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="turns"
                  label={t("חבילת תורות")}
                  value={`${TURN_PACKAGES[0].cost}💎`}
                  hint={t("{p0} תורות · עד {p1} בחבילה הגדולה", { p0: TURN_PACKAGES[0].turns, p1: nf(TURN_PACKAGES[TURN_PACKAGES.length - 1].turns) })}
                />
                <Fact
                  icon="mine"
                  label={t("בוסט תפוקה")}
                  value={`${BOOST_STEP_COST}💎`}
                  hint={t("+{p0}% למשאב, עד +{p1}% ל־24 שעות", { p0: BOOST_STEP_PCT, p1: BOOST_MAX_PCT })}
                  tone="text-emerald-300"
                />
                <Fact
                  icon="heart"
                  label={t("החייאת גיבור")}
                  value={`${HERO_REVIVE_COST}💎`}
                  hint={t("בעמוד הגיבור בלבד, כשהוא מת — החלופה חינם, רק צריך סבלנות")}
                  tone="text-red-300"
                />
                <Fact
                  icon="guild"
                  label={t("הקמת ברית")}
                  value={`${GUILD_CREATION_COST_DIAMONDS}💎`}
                  hint={t("ואז קסמים והרחבות")}
                  tone="text-purple-300"
                />
                <Fact
                  icon="base"
                  label={t("קסם ירידת עיר")}
                  value={`${CITY_DOWNGRADE_COST}💎`}
                  hint={t("עיר אחת בלבד למטה · מעיר {p0} ומעלה · אחת ל־{p1} שעה · בלי החזר", { p0: CITY_DOWNGRADE_MIN_CITIES, p1: CITY_DOWNGRADE_COOLDOWN_HOURS })}
                  tone="text-crimson-bright"
                />
                {SHIELDS.map((shield) => (
                  <Fact
                    key={shield.key}
                    icon="shield"
                    label={shield.label}
                    value={`${shield.durations[0].cost}💎`}
                    hint={t("{p0} שעות · {p1}💎 ל־{p2} שעות", { p0: shield.durations[0].hours, p1: shield.durations[1].cost, p2: shield.durations[1].hours })}
                    tone="text-emerald-300"
                  />
                ))}
                <Fact
                  icon="crown"
                  label={`${VIP_LABEL} (VIP)`}
                  value={`${VIP_COST}💎`}
                  hint={t("רכישה חד־פעמית · לא פג תוקף · פותח את כפתורי ״הכל״ במשחק")}
                  tone="text-gold-bright"
                />
              </div>

              <Note tone="green" icon="shield" title={t("מה מגן באמת קונה לך")}>{t("מגן משאבים ומגן חיילים לא הופכים אותך לבלתי ניתן לתקיפה — הם מוציאים את הרכוש מהישג ידו של התוקף: מי שינצח אותך לא ייקח משאבים (מגן משאבים) ולא ישעבד חיילים (מגן חיילים). הקרב עצמו עדיין מתרחש, הגיבור שלך עדיין סופג, והתוקף עדיין מרוויח ניסיון. כל שחקן בעיר רואה בדירוג שיש לך מגן — וזה בדיוק מה שמרתיע תוקפים מלבזבז עליך תורות.")}</Note>

              <Note tone="red" icon="turns" title={t("אי אפשר לחיות מאחורי מגן")}><RichText text={t("מגן לא ניתן לחידוש ולא להארכה כל עוד הוא פעיל — צריך לתת לו להיגמר, ואז עוברות עוד <0>  דקות שבהן אתה חשוף לגמרי לפני שאפשר לקנות מחדש. זה מכוון: מגנים רצופים היו הופכים שחקן משלם לבלתי ניתן לתקיפה לצמיתות, וחלון החשיפה הזה הוא ההזדמנות של שאר העיר. אם אתה מתכנן להיות מוגן — שים לב מתי המגן נגמר, כי בדיוק אז תוקפים ממתינים.")} slots={[<><b className="nums">{SHIELD_RENEW_COOLDOWN_MINUTES}</b></>]} /></Note>

              <Note tone="gold" icon="crown" title={t("מה {p0} קונה — ומה לא", { p0: VIP_LABEL })}>{t("הוא לא מוסיף למשחק שום פעולה חדשה — הוא פותח את כפתורי ״הכל״ שכבר יש בו: ״הפקד הכל״ ו״משוך הכל״ בבנק, ״הפקד הכל״ ו״משוך הכל״ בכל מחסן, ״הצב הכל״ ו״חלק שווה״ בעבדי המכרות ו״שדרג למקסימום״ במכרה — ועוד כפתור ״מפקדה״ בסרגל העליון שמפעיל את כולם מכל מסך. בלי החותם אותן פעולות עדיין פתוחות לך ידנית: מקליד סכום ומפקיד, מציב עבדים מכרה־מכרה, קונה למכרה רמה בכל לחיצה — ומגיע בדיוק לאותו מצב. החותם לא נותן משאב אחד, לא נקודת עוצמה אחת, לא מקצר קירור ולא מגן על האימפריה.")}</Note>

              <Note tone="green" icon="diamond" title={t("למה יש רק ווג׳ אחד של יהלומים")}><RichText text={t("דרך התהילה ושליטי הערים לא מחלקים יהלומים בכוונה, והגלגל מחלק אותם מווג׳ יחיד שעולה לאט: <0> ביום הראשון, ועולה בהדרגה עד  <1> בעדכון האחרון של העונה. בכוונה זו תוספת קבועה ולא הכפלה כמו המשאבים: מקור חוזר ומתפוצץ של מטבע פרימיום היה מרוקן מתוכן כל מה שנקנה בו.")} slots={[<><b className="nums">{WHEEL_DIAMOND_BASE}</b></>, <><b className="nums">{WHEEL_DIAMOND_FINAL}</b></>]} /></Note>

              <div className="flex justify-center">
                <Link href={gameHref("/game/diamonds")} className="btn btn-gold px-5 py-2 text-sm">
                  <Icon name="diamond" size={16} className="inline align-[-2px]" /> {t("לחנות היהלומים")}
                </Link>
              </div>
            </GuideSection>

            {/* ============================ 31 roadmap ============================ */}
            <GuideSection meta={sections.roadmap} index={INDEX.roadmap}>
              <Lead>{t("אם אתה לא יודע מה לעשות עכשיו — זה הסדר שעובד. כל שלב פותח את הבא אחריו.")}</Lead>

              <ol className="space-y-3">
                {[
                  {
                    title: t("השעתיים הראשונות — בונים, לא נלחמים"),
                    body: t("אתה מוגן. נצל את זה: הצב את כל עבדי המכרות, שדרג מכרות (כל אחד במשאב שלו), והשאר את התורות לצבירה. תקיפה ראשונה שוברת את המגן."),
                  },
                  {
                    title: t("רוקן את מאגר האזרחים בכל עדכון"),
                    body: t("אזרח שיושב סתם הוא תפוקה שלא קרתה. חלק אותם: עבדי מכרות לכלכלה, חיילים להגנה, מרגלים למודיעין."),
                  },
                  {
                    title: t("שדרג את המחסנים לפני שיש מה לגנוב"),
                    body: t("מחסן מלא הוא ביטוח. תוקף לוקח רק מהיתרה הזמינה — מה שמאוחסן לא נוגעים בו."),
                  },
                  {
                    title: t("הבנק לפני הנשק"),
                    body: t("ריבית עובדת פעמיים ביום, בריבית דריבית, גם כשאתה ישן. זהב שיושב זמין לא עושה כלום ורק מסכן אותך."),
                  },
                  {
                    title: t("פתח דרגות נשק — הן משותפות"),
                    body: t("פתיחה אחת מקדמת התקפה, הגנה וריגול יחד. כל 4 דרגות תצטרך לעלות עיר ורמת גיבור גבוהה יותר, אז העיר והגיבור הם התנאי האמיתי."),
                  },
                  {
                    title: t("בחר יעדים חכם — לא חלשים"),
                    body: t("הניסיון של הגיבור נגזר מפער הרמות ומיחס הכוחות: לרמוס חלש משלם מינימום. יריב שקול משלם מלא, וחזק ממך — או כזה שכבר עבר איפוס — משלם הרבה יותר."),
                  },
                  {
                    title: t("עיר, ואז שליט העיר"),
                    body: t("כל עיר מכפילה את כל הכלכלה שלך. אחריה מגיע השליט: אין מכסת תקיפות ואין צורך להפיל אותו במכה אחת — כל יציאה מורידה מהחיים שלו ומשלמת שלל לפי הנזק, וההפלה עצמה מוסיפה את הפרס הגדול וחפץ מובטח."),
                  },
                  {
                    title: t("הצטרף לברית"),
                    body: t("עזרת ברית פסיבית מחזקת אותך בכל קרב בלי לעשות כלום, והקסמים נותנים עד 30% נוספים ל־24 שעות."),
                  },
                ].map((step, i) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="guide-num shrink-0" aria-hidden>
                      <span className="nums">{i + 1}</span>
                    </span>
                    <div className="panel-inset flex-1 rounded-xl px-4 py-3">
                      <p className="font-black text-gold-bright">{step.title}</p>
                      <p className="mt-0.5 text-[0.8rem] leading-relaxed text-zinc-400">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <Link href={gameHref("/game/base")} className="btn btn-gold px-5 py-2 text-sm">
                  <Icon name="base" size={16} className="inline align-[-2px]" /> {t("חזרה לבסיס")}
                </Link>
                <Link href={gameHref("/game/rankings")} className="btn btn-ghost px-5 py-2 text-sm">
                  <Icon name="rankings" size={16} className="inline align-[-2px]" /> {t("למצוא יעד")}
                </Link>
              </div>
            </GuideSection>
          </div>
        </div>
      </div>
    </div>
  );
}
