import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin, ADMIN_INT_MAX } from "@/lib/admin";
import { banLabel, formatBanDate, isBanned } from "@/lib/ban";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { ActionForm } from "@/components/admin/ActionForm";
import {
  LabeledBool,
  LabeledInput,
  LabeledSelect,
  EditorSection,
  ResourceFieldLabel,
} from "@/components/admin/fields";
import {
  BUILDING_META,
  BUILDING_TYPES,
  EMPIRE_UPGRADE_META,
  EMPIRE_UPGRADE_TYPES,
  MINE_MAX_LEVEL,
  MINE_START_LEVEL,
  STORAGE_META,
  STORAGE_TYPES,
  empireUpgradeMaxLevel,
  isProductionBuilding,
} from "@/lib/game/constants";
import {
  WEAPONS,
  WEAPON_CATEGORIES,
  WEAPON_CATEGORY_META,
  TIERS_PER_CATEGORY,
  weaponByKey,
} from "@/lib/game/weapons";
import {
  HERO_CLASS_META,
  HERO_CLASS_ORDER,
  HERO_MAX_HEALTH,
  HERO_MAX_LEVEL,
  RARITY_META,
  UPGRADE_LEVELS,
  heroPointPool,
  tierForLevel,
  SLOT_META,
  SLOT_ORDER,
} from "@/lib/game/hero";
import { itemSetForLevel } from "@/lib/game/heroSets";
import {
  updateUserAccount,
  resetUserPassword,
  deleteUser,
  updateEmpireCore,
  updateArmy,
  updateBank,
  updateBuilding,
  updateStorage,
  updateUpgrade,
  updateWeaponUnlock,
  setWeaponQuantity,
  updateHero,
  grantHeroItem,
  grantHeroSet,
  deleteHeroItem,
  updateHeroItem,
  setGuildMembership,
  sendMessageToEmpire,
  sendGift,
} from "@/server/actions/admin";
import { MAX_CITIES } from "@/lib/game/constants";
import { cityName } from "@/lib/game/cities";
import { GUILD_ROLE_META } from "@/lib/game/guild";
import { PlayerSecurity } from "@/components/admin/user/PlayerSecurity";
import { BanPanel } from "@/components/admin/user/BanPanel";
import { PlayerEmpireState } from "@/components/admin/user/PlayerEmpireState";
import { PlayerBuffs } from "@/components/admin/user/PlayerBuffs";
import { PlayerProgress } from "@/components/admin/user/PlayerProgress";
import { PlayerInbox } from "@/components/admin/user/PlayerInbox";
import { PlayerVitals } from "@/components/admin/user/PlayerVitals";
import { makeT } from "@/i18n/translate";
import { DEFAULT_LOCALE } from "@/i18n/locale";

export const dynamic = "force-dynamic";

const RARITY_OPTIONS = [
  { value: "COMMON", label: "רגיל" },
  { value: "RARE", label: "נדיר" },
  { value: "EPIC", label: "אפי" },
  { value: "LEGENDARY", label: "אגדי" },
];

/**
 * Every rung a piece of gear can sit on (UPGRADE_LEVELS — the band starts drops
 * land on), named the way the player sees it: set, tier, level. This is the only
 * field the whole-set grant asks for, since the rarity follows from the level.
 */
const ITEM_LEVEL_OPTIONS = UPGRADE_LEVELS.map((level) => ({
  value: String(level),
  label: `${itemSetForLevel(level).label} · ${RARITY_META[tierForLevel(level)].label} · רמה ${level}`,
}));

/** Default the set picker to the אגדי of the second set — a solid starter gift. */
const DEFAULT_SET_LEVEL = "20";

/** Totals for the mail/history panel — counts only, never the rows. */
async function empireCounts(empireId: string) {
  const [
    messages,
    unread,
    battleReports,
    spyReports,
    bossFights,
    purchases,
    bankTransactions,
  ] = await Promise.all([
    prisma.message.count({ where: { empireId } }),
    prisma.message.count({ where: { empireId, readAt: null } }),
    prisma.battleReport.count({
      where: { OR: [{ attackerEmpireId: empireId }, { defenderEmpireId: empireId }] },
    }),
    prisma.spyReport.count({
      where: { OR: [{ attackerEmpireId: empireId }, { defenderEmpireId: empireId }] },
    }),
    prisma.bossFight.count({ where: { empireId } }),
    prisma.diamondPurchase.count({ where: { empireId } }),
    prisma.bankTransaction.count({ where: { empireId } }),
  ]);
  return {
    messages,
    unread,
    battleReports,
    spyReports,
    bossFights,
    purchases,
    bankTransactions,
  };
}

export default async function AdminUserDetail({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  // Admin chrome stays in the source language — see the i18n note.
  const t = makeT(DEFAULT_LOCALE);
  await requireAdmin();
  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      empire: {
        include: {
          army: true,
          bankAccount: true,
          buildings: true,
          storages: true,
          upgrades: true,
          weapons: true,
          weaponUnlocks: true,
          hero: { include: { items: true } },
          guildMembership: { include: { guild: true } },
          season: true,
          // The rest of the empire: every timed buff, every ladder, and the
          // head of the mailbox. All of it is editable further down the page,
          // and none of it was reachable from any other admin screen.
          potions: true,
          potionEffects: true,
          diamondEffects: true,
          guildBuffs: { orderBy: { expiresAt: "desc" } },
          seasonPass: true,
          heroQuest: true,
          achievements: { select: { key: true } },
          gloryAwards: { select: { key: true } },
          messages: {
            take: 25,
            orderBy: { createdAt: "desc" },
            include: { sender: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!user) notFound();
  // A bot never opens here. This page is the full player editor — gifts, bans,
  // resets, mail — and none of that means anything for a garrison; a reset would
  // even strand it (see resetEmpireProgress). Any stale link to one lands on the
  // single screen that does own bots.
  if (user.empire?.isBot) redirect("/admin/bots");
  const empire = user.empire;

  // Hero stat points the player is entitled to at his current standing: one per
  // level he stands at plus 25 for every reset behind him. `updateHero` fills
  // exactly this pool — the form only mirrors it.
  const heroPoints = heroPointPool(empire?.hero?.level ?? 1, empire?.hero?.resets ?? 0);

  // Pickers and counters for the panels below. Guilds and seasons are small
  // tables; the history counts are indexed and only the totals are needed, so
  // none of the (potentially huge) report rows are loaded.
  const [seasons, guilds, counts] = await Promise.all([
    prisma.gameSeason.findMany({
      orderBy: { startsAt: "desc" },
      // endsAt rides along for the ban panel's "until the season ends" option.
      select: { id: true, name: true, isActive: true, endsAt: true },
    }),
    prisma.guild.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    empire ? empireCounts(empire.id) : null,
  ]);
  const activeSeason = seasons.find((s) => s.isActive && s.endsAt > new Date()) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/users" className="btn btn-ghost px-3 py-1.5 text-xs">
          → כל השחקנים
        </Link>
        <div className="text-left text-[11px] text-zinc-500" dir="ltr">
          user: {user.id}
          {empire && <> · empire: {empire.id}</>}
        </div>
      </div>

      <SectionHeading
        title={empire?.name ?? user.name}
        subtitle={user.email}
        ornament={<Icon name="iron" size={22} className="text-crimson" />}
      />

      {/* The page below is the complete editor; this is the part an admin
          opened it for. See PlayerVitals. */}
      {empire && (
        <PlayerVitals
          userId={user.id}
          empire={{
            id: empire.id,
            cities: empire.cities,
            cityLabel: cityName(t, empire.cities),
            gold: empire.gold,
            wood: empire.wood,
            iron: empire.iron,
            stone: empire.stone,
            diamonds: empire.diamonds,
            citizens: empire.citizens,
            turns: empire.turns,
            wheelSpins: empire.wheelSpins,
            bankGold: empire.bankAccount?.goldBalance ?? 0,
            soldiers: empire.army?.soldiers ?? 0,
            spies: empire.army?.spies ?? 0,
            mineSlaves: empire.army?.mineSlaves ?? 0,
            heroLevel: empire.hero?.level ?? 1,
            heroHealth: empire.hero?.health ?? 0,
            generalPower: empire.generalPower,
            militaryPower: empire.militaryPower,
            spyPower: empire.spyPower,
            vipSince: empire.vipSince,
            protectedUntil: empire.protectedUntil,
            lastSeenAt: empire.lastSeenAt,
            isBot: empire.isBot,
            isStaff: empire.isStaff,
            seasonName: empire.season?.name ?? null,
            guild: empire.guildMembership
              ? {
                  name: empire.guildMembership.guild.name,
                  role: empire.guildMembership.role,
                }
              : null,
          }}
          account={{
            isAdmin: user.role === "ADMIN",
            banned: isBanned(user),
            banText: isBanned(user) ? banLabel(user) : null,
            emailVerified: user.emailVerified != null,
          }}
        />
      )}

      {/* ---------------- account ---------------- */}
      <EditorSection id="sec-account" title="חשבון משתמש" icon="🔑">
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={updateUserAccount} submitLabel="שמור פרטי חשבון">
            <input type="hidden" name="userId" value={user.id} />
            <LabeledInput label="שם" name="name" defaultValue={user.name} required />
            <LabeledInput label="אימייל" name="email" type="email" defaultValue={user.email} dir="ltr" required />
            <LabeledSelect
              label="תפקיד"
              name="role"
              defaultValue={user.role}
              options={[
                { value: "USER", label: "שחקן" },
                { value: "ADMIN", label: "אדמין" },
              ]}
            />
          </ActionForm>

          <div className="space-y-4">
            <BanPanel
              userId={user.id}
              banned={isBanned(user)}
              hasBanRow={user.bannedAt != null}
              bannedSince={user.bannedAt ? formatBanDate(user.bannedAt) : null}
              bannedUntil={user.bannedUntil ? formatBanDate(user.bannedUntil) : null}
              season={
                activeSeason
                  ? { name: activeSeason.name, endsAt: formatBanDate(activeSeason.endsAt) }
                  : null
              }
            />

            <ActionForm action={resetUserPassword} submitLabel="אפס סיסמה" submitVariant="secondary">
              <input type="hidden" name="userId" value={user.id} />
              <LabeledInput label="סיסמה חדשה" name="password" type="password" dir="ltr" placeholder="לפחות 6 תווים" />
            </ActionForm>

            <ActionForm
              action={deleteUser}
              submitLabel="מחק משתמש לצמיתות"
              submitVariant="danger"
              confirm="למחוק את המשתמש והאימפריה לצמיתות? פעולה בלתי הפיכה."
            >
              <input type="hidden" name="userId" value={user.id} />
              <LabeledInput label="הקלד DELETE לאישור" name="confirm" dir="ltr" placeholder="DELETE" />
            </ActionForm>
          </div>
        </div>
      </EditorSection>

      <div id="sec-security" className="scroll-mt-4">
        <PlayerSecurity
          user={{
            id: user.id,
            emailVerified: user.emailVerified,
            lockedUntil: user.lockedUntil,
            failedLogins: user.failedLogins,
            googleId: user.googleId,
            hasPassword: user.passwordHash != null,
            bannedAt: user.bannedAt,
            createdAt: user.createdAt,
            hasEmpire: empire != null,
          }}
        />
      </div>

      {!empire ? (
        <div className="panel-inset rounded-xl p-6 text-center text-zinc-400">
          למשתמש זה אין אימפריה.
        </div>
      ) : (
        <>
          {/* ---------------- core stats ---------------- */}
          <EditorSection id="sec-core" title="נתוני אימפריה" icon="🏰">
            <ActionForm action={updateEmpireCore} submitLabel="שמור נתוני אימפריה">
              <input type="hidden" name="empireId" value={empire.id} />
              <input type="hidden" name="userId" value={user.id} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <LabeledInput label="שם אימפריה" name="name" defaultValue={empire.name} required />
                {/* The empire's own "level" column is vestigial — nothing in the
                    game reads it — so it is shown here, not edited: an editable
                    field saved happily and changed nothing the player saw. The
                    level a player has is the hero's, in the גיבור panel below. */}
                <div className="block space-y-1">
                  <span className="text-xs font-semibold text-gold-dim">רמה</span>
                  <p className="rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-300">
                    {empire.hero?.level ?? 1}
                  </p>
                  <span className="block text-[11px] text-zinc-500">
                    רמת הגיבור — נערכת בפאנל &quot;גיבור&quot;
                  </span>
                </div>
                <LabeledInput label={<ResourceFieldLabel resource="gold" text="זהב" />} name="gold" type="number" min={0} defaultValue={Math.round(empire.gold)} />
                <LabeledInput label={<ResourceFieldLabel resource="wood" text="עץ" />} name="wood" type="number" min={0} defaultValue={Math.round(empire.wood)} />
                <LabeledInput label={<ResourceFieldLabel resource="iron" text="ברזל" />} name="iron" type="number" min={0} defaultValue={Math.round(empire.iron)} />
                <LabeledInput label={<ResourceFieldLabel resource="stone" text="אבן" />} name="stone" type="number" min={0} defaultValue={Math.round(empire.stone)} />
                <LabeledInput label={<ResourceFieldLabel resource="diamonds" text="יהלומים" />} name="diamonds" type="number" min={0} defaultValue={Math.round(empire.diamonds)} />
                <LabeledInput label={<ResourceFieldLabel resource="citizens" text="אזרחים" />} name="citizens" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.citizens} />
                <LabeledInput label={<ResourceFieldLabel resource="turns" text="תורות" />} name="turns" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.turns} />
                <LabeledInput label="🎡 סיבובי גלגל" name="wheelSpins" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.wheelSpins} />
                {/* Cities drive the citizen cap, the quest board and the
                    ranking bucket — the single most load-bearing number here. */}
                <LabeledInput
                  label="🏛️ ערים"
                  name="cities"
                  type="number"
                  min={1}
                  max={MAX_CITIES}
                  defaultValue={empire.cities}
                  hint={`1–${MAX_CITIES} · כרגע: ${cityName(t, empire.cities)}`}
                />
              </div>
            </ActionForm>
          </EditorSection>

          <div id="sec-state" className="scroll-mt-4">
            <PlayerEmpireState
              empire={{
                id: empire.id,
                seasonId: empire.seasonId,
                protectedUntil: empire.protectedUntil,
                vipSince: empire.vipSince,
                lastRegularUpdateAt: empire.lastRegularUpdateAt,
                lastDailyUpdateAt: empire.lastDailyUpdateAt,
                reportsSeenAt: empire.reportsSeenAt,
                militaryPower: empire.militaryPower,
                generalPower: empire.generalPower,
                spyPower: empire.spyPower,
              }}
              userId={user.id}
              seasons={seasons}
            />
          </div>

          {/* ---------------- army + bank ---------------- */}
          <div id="sec-army" className="grid scroll-mt-4 gap-4 lg:grid-cols-2">
            <EditorSection title="צבא" icon="🪖">
              <ActionForm action={updateArmy} submitLabel="שמור צבא">
                <input type="hidden" name="empireId" value={empire.id} />
                <input type="hidden" name="userId" value={user.id} />
                <div className="grid grid-cols-3 gap-3">
                  <LabeledInput label="🪖 חיילים" name="soldiers" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.army?.soldiers ?? 0} />
                  <LabeledInput label="🕵️ מרגלים" name="spies" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.army?.spies ?? 0} />
                  <LabeledInput label={<><Icon name="mine" size={13} className="inline align-[-2px]" /> עבדים</>} name="mineSlaves" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.army?.mineSlaves ?? 0} />
                </div>
              </ActionForm>
            </EditorSection>

            <EditorSection title="בנק" icon="🏦">
              <ActionForm action={updateBank} submitLabel="שמור בנק">
                <input type="hidden" name="empireId" value={empire.id} />
                <input type="hidden" name="userId" value={user.id} />
                <LabeledInput
                  label={<ResourceFieldLabel resource="gold" text="יתרת זהב בבנק" />}
                  name="goldBalance"
                  type="number"
                  min={0}
                  defaultValue={Math.round(empire.bankAccount?.goldBalance ?? 0)}
                />
              </ActionForm>
            </EditorSection>
          </div>

          {/* ---------------- buildings ---------------- */}
          <EditorSection id="sec-buildings" title="מבנים" icon="🏗️">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {BUILDING_TYPES.map((type) => {
                const meta = BUILDING_META[type];
                const b = empire.buildings.find((x) => x.type === type);
                // Same ceilings the server clamps to, so the form can't even
                // offer a value that would be silently cut down on save: mines
                // stop at MINE_MAX_LEVEL (the barracks/spy center are never
                // upgraded past 1), and slaves are limited to the pool the army
                // actually owns minus what the other mines already hold.
                const isMine = isProductionBuilding(type);
                const slavePool = Math.max(
                  0,
                  (empire.army?.mineSlaves ?? 0) -
                    empire.buildings
                      .filter((x) => x.type !== type && isProductionBuilding(x.type))
                      .reduce((sum, x) => sum + x.slavesAssigned, 0)
                );
                return (
                  <ActionForm
                    key={type}
                    action={updateBuilding}
                    submitLabel="שמור"
                    submitVariant="secondary"
                    submitClassName="w-full text-xs"
                    className="panel-inset rounded-lg p-3"
                  >
                    <input type="hidden" name="empireId" value={empire.id} />
                    <input type="hidden" name="userId" value={user.id} />
                    <input type="hidden" name="type" value={type} />
                    <p className="flex items-center gap-1.5 text-xs font-bold text-gold-bright">
                      <Icon name={meta.icon} size={14} /> {meta.label}
                    </p>
                    <div className={`grid gap-2 ${meta.supportsSlaves ? "grid-cols-2" : "grid-cols-1"}`}>
                      <LabeledInput
                        label="רמה"
                        name="level"
                        type="number"
                        min={1}
                        max={isMine ? MINE_MAX_LEVEL : 1}
                        defaultValue={b?.level ?? MINE_START_LEVEL}
                        hint={isMine ? `${MINE_START_LEVEL}–${MINE_MAX_LEVEL}` : "תמיד 1"}
                      />
                      {meta.supportsSlaves && (
                        <LabeledInput
                          label="עבדים"
                          name="slavesAssigned"
                          type="number"
                          min={0}
                          max={slavePool}
                          defaultValue={b?.slavesAssigned ?? 0}
                          hint={`פנויים ${slavePool.toLocaleString("he-IL")}`}
                        />
                      )}
                    </div>
                  </ActionForm>
                );
              })}
            </div>
          </EditorSection>

          {/* ---------------- storages + upgrades ---------------- */}
          <div id="sec-storage" className="grid scroll-mt-4 gap-4 lg:grid-cols-2">
            <EditorSection title="מחסנים" icon="📦">
              <div className="grid gap-3 sm:grid-cols-2">
                {STORAGE_TYPES.map((type) => {
                  const meta = STORAGE_META[type];
                  const s = empire.storages.find((x) => x.resourceType === type);
                  return (
                    <ActionForm
                      key={type}
                      action={updateStorage}
                      submitLabel="שמור"
                      submitVariant="secondary"
                      submitClassName="w-full text-xs"
                      className="panel-inset rounded-lg p-3"
                    >
                      <input type="hidden" name="empireId" value={empire.id} />
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="resourceType" value={type} />
                      <p className="flex items-center gap-1.5 text-xs font-bold text-gold-bright">
                        <Icon name={meta.icon} size={14} /> {meta.label}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <LabeledInput label="רמה" name="level" type="number" min={1} defaultValue={s?.level ?? 1} />
                        <LabeledInput label="מאוחסן" name="storedAmount" type="number" min={0} defaultValue={Math.round(s?.storedAmount ?? 0)} />
                      </div>
                    </ActionForm>
                  );
                })}
              </div>
            </EditorSection>

            <EditorSection title="שדרוגים" icon="📈">
              <div className="grid gap-3 sm:grid-cols-2">
                {EMPIRE_UPGRADE_TYPES.map((type) => {
                  const meta = EMPIRE_UPGRADE_META[type];
                  const u = empire.upgrades.find((x) => x.type === type);
                  // CITIZEN_GROWTH's ceiling moves with the city count, so it is
                  // read per empire rather than from the metadata.
                  const maxLevel = empireUpgradeMaxLevel(type, empire.cities);
                  return (
                    <ActionForm
                      key={type}
                      action={updateUpgrade}
                      submitLabel="שמור"
                      submitVariant="secondary"
                      submitClassName="w-full text-xs"
                      className="panel-inset rounded-lg p-3"
                    >
                      <input type="hidden" name="empireId" value={empire.id} />
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="type" value={type} />
                      <p className="flex items-center gap-1.5 text-xs font-bold text-gold-bright">
                        <Icon name={meta.icon} size={14} /> {meta.label}
                      </p>
                      <LabeledInput
                        label="רמה"
                        name="level"
                        type="number"
                        min={1}
                        max={maxLevel}
                        defaultValue={u?.level ?? 1}
                        hint={maxLevel ? `מקסימום ${maxLevel}` : undefined}
                      />
                    </ActionForm>
                  );
                })}
              </div>
            </EditorSection>
          </div>

          {/* ---------------- weapon unlocks ---------------- */}
          <EditorSection id="sec-weapons" title="פתיחת נשקים" icon="🔓">
            <div className="grid gap-3 sm:grid-cols-3">
              {WEAPON_CATEGORIES.map((category) => {
                const unlock = empire.weaponUnlocks.find((x) => x.category === category);
                return (
                  <ActionForm
                    key={category}
                    action={updateWeaponUnlock}
                    submitLabel="שמור"
                    submitVariant="secondary"
                    submitClassName="w-full text-xs"
                    className="panel-inset rounded-lg p-3"
                  >
                    <input type="hidden" name="empireId" value={empire.id} />
                    <input type="hidden" name="userId" value={user.id} />
                    <input type="hidden" name="category" value={category} />
                    <p className="text-xs font-bold text-gold-bright">
                      {WEAPON_CATEGORY_META[category].icon} {WEAPON_CATEGORY_META[category].label}
                    </p>
                    <LabeledInput
                      label="טיר פתוח"
                      name="unlockedTier"
                      type="number"
                      min={1}
                      max={TIERS_PER_CATEGORY}
                      defaultValue={unlock?.unlockedTier ?? 2}
                      hint={`מקסימום ${TIERS_PER_CATEGORY}`}
                    />
                  </ActionForm>
                );
              })}
            </div>
          </EditorSection>

          {/* ---------------- arsenal ---------------- */}
          <EditorSection title="מלאי נשקים" icon="🗡️">
            {empire.weapons.length > 0 && (
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {empire.weapons.map((w) => {
                  const def = weaponByKey(w.weaponKey);
                  return (
                    <ActionForm
                      key={w.id}
                      action={setWeaponQuantity}
                      submitLabel="עדכן"
                      submitVariant="secondary"
                      submitClassName="w-full text-xs"
                      className="panel-inset rounded-lg p-3"
                    >
                      <input type="hidden" name="empireId" value={empire.id} />
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="weaponKey" value={w.weaponKey} />
                      <p className="text-xs font-bold text-gold-bright">
                        {def ? `${def.name} (טיר ${def.tier})` : w.weaponKey}
                      </p>
                      <LabeledInput label="כמות (0 = מחיקה)" name="quantity" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={w.quantity} />
                    </ActionForm>
                  );
                })}
              </div>
            )}
            <ActionForm action={setWeaponQuantity} submitLabel="הוסף / הגדר נשק" className="panel rounded-lg p-3">
              <input type="hidden" name="empireId" value={empire.id} />
              <input type="hidden" name="userId" value={user.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledSelect
                  label="נשק"
                  name="weaponKey"
                  options={WEAPONS.map((w) => ({
                    value: w.key,
                    label: `${WEAPON_CATEGORY_META[w.category].icon} ${w.name} (טיר ${w.tier})`,
                  }))}
                />
                <LabeledInput label="כמות" name="quantity" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={1} />
              </div>
            </ActionForm>
          </EditorSection>

          {/* ---------------- hero ---------------- */}
          <EditorSection id="sec-hero" title="גיבור" icon="🛡️">
            {/* Stat points the hero is entitled to: one per level he stands at,
                plus 25 for every reset behind him. The server fills the four
                fields from this pool in allocation order and hands whatever is
                left over to "נק' פנויות", so the row always holds the full pool. */}
            <p className="mb-3 text-xs text-zinc-400">
              נקודות זמינות לחלוקה:{" "}
              <b className="nums text-gold-bright">{heroPoints}</b> — סכום ארבעת
              שדות הנקודות לא יעלה על זה, וכל יתרה תיזקף לנקודות הפנויות.
            </p>
            <ActionForm action={updateHero} submitLabel="שמור גיבור" className="mb-4">
              <input type="hidden" name="empireId" value={empire.id} />
              <input type="hidden" name="userId" value={user.id} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                <LabeledSelect
                  label="דמות"
                  name="heroClass"
                  defaultValue={empire.hero?.heroClass ?? "WARLORD"}
                  options={HERO_CLASS_ORDER.map((c) => ({
                    value: c,
                    label: HERO_CLASS_META[c].label,
                  }))}
                />
                <LabeledInput
                  label="רמה"
                  name="level"
                  type="number"
                  min={1}
                  max={HERO_MAX_LEVEL}
                  defaultValue={empire.hero?.level ?? 1}
                  hint={`מקסימום ${HERO_MAX_LEVEL}`}
                />
                <LabeledInput label="ניסיון" name="xp" type="number" min={0} defaultValue={empire.hero?.xp ?? 0} />
                <LabeledInput label="נק' פנויות" name="unspentPoints" type="number" min={0} max={heroPoints} defaultValue={empire.hero?.unspentPoints ?? 0} />
                <LabeledInput label="נק' התקפה" name="attackPoints" type="number" min={0} max={heroPoints} defaultValue={empire.hero?.attackPoints ?? 0} />
                <LabeledInput label="נק' הגנה" name="defensePoints" type="number" min={0} max={heroPoints} defaultValue={empire.hero?.defensePoints ?? 0} />
                <LabeledInput label="נק' משאבים" name="resourcePoints" type="number" min={0} max={heroPoints} defaultValue={empire.hero?.resourcePoints ?? 0} />
                <LabeledInput label="איפוסים" name="resets" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.hero?.resets ?? 0} />
                {/* 0 = הגיבור מת (וכל הבונוסים שלו מושבתים); כל ערך גבוה יותר מחייה אותו */}
                <LabeledInput label="חיים (0=מת)" name="health" type="number" min={0} max={HERO_MAX_HEALTH} defaultValue={empire.hero?.health ?? HERO_MAX_HEALTH} />
              </div>
            </ActionForm>

            {empire.hero && empire.hero.items.length > 0 && (
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {empire.hero.items.map((item) => (
                  <div key={item.id} className="panel-inset space-y-2 rounded-lg p-3">
                    {/* Editable in place: the whole point of gear support here
                        is retuning a bad drop, not only deleting it. */}
                    <ActionForm
                      action={updateHeroItem}
                      submitLabel="שמור פריט"
                      submitVariant="secondary"
                      submitClassName="w-full text-xs"
                    >
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="userId" value={user.id} />
                      <div className="grid grid-cols-2 gap-2">
                        <LabeledSelect
                          label="מיקום"
                          name="slot"
                          defaultValue={item.slot}
                          options={SLOT_ORDER.map((s) => ({
                            value: s,
                            label: SLOT_META[s].label,
                          }))}
                        />
                        <LabeledSelect
                          label="נדירות"
                          name="rarity"
                          defaultValue={item.rarity}
                          options={RARITY_OPTIONS}
                        />
                        <LabeledInput
                          label="רמה"
                          name="level"
                          type="number"
                          min={1}
                          max={HERO_MAX_LEVEL}
                          defaultValue={item.level}
                        />
                        <LabeledBool label="חבוש" name="equipped" defaultValue={item.equipped} />
                      </div>
                    </ActionForm>
                    <ActionForm
                      action={deleteHeroItem}
                      submitLabel="🗑 מחק פריט"
                      submitVariant="danger"
                      submitClassName="w-full text-xs"
                      confirm="למחוק את הפריט?"
                    >
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="userId" value={user.id} />
                    </ActionForm>
                  </div>
                ))}
              </div>
            )}

            {/* The one-click gift: nine pieces of one set, rarity derived from
                the level so the grant always matches what a drop would look
                like. The per-slot form below stays for surgical fixes. */}
            <ActionForm
              action={grantHeroSet}
              submitLabel={`⚔️ הענק סט מלא (${SLOT_ORDER.length} פריטים)`}
              className="panel mb-3 rounded-lg p-3"
            >
              <input type="hidden" name="empireId" value={empire.id} />
              <input type="hidden" name="userId" value={user.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledSelect
                  label="סט ורמה"
                  name="level"
                  defaultValue={DEFAULT_SET_LEVEL}
                  options={ITEM_LEVEL_OPTIONS}
                />
                <LabeledBool
                  label="לחבוש מיד"
                  name="equip"
                  defaultValue
                  trueLabel="כן — הציוד הישן יעבור לתיק"
                  falseLabel="לא — הכל לתיק"
                />
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                נוצרים {SLOT_ORDER.length} פריטים באותה רמה — הנדירות נגזרת מהרמה
                שנבחרה. ציוד קיים לא נמחק, רק מוסר לתיק.
              </p>
            </ActionForm>

            <ActionForm action={grantHeroItem} submitLabel="הענק פריט גיבור" className="panel rounded-lg p-3">
              <input type="hidden" name="empireId" value={empire.id} />
              <input type="hidden" name="userId" value={user.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <LabeledSelect
                  label="מיקום"
                  name="slot"
                  options={SLOT_ORDER.map((s) => ({ value: s, label: SLOT_META[s].label }))}
                />
                <LabeledSelect label="נדירות" name="rarity" options={RARITY_OPTIONS} />
                <LabeledInput
                  label="רמה"
                  name="level"
                  type="number"
                  min={1}
                  max={HERO_MAX_LEVEL}
                  defaultValue={1}
                  hint={`מקסימום ${HERO_MAX_LEVEL}`}
                />
              </div>
            </ActionForm>
          </EditorSection>

          {/* ---------------- guild ---------------- */}
          <EditorSection id="sec-guild" title="ברית" icon="🤝">
            <p className="mb-3 text-sm text-zinc-300">
              {empire.guildMembership ? (
                <>
                  חבר בברית{" "}
                  <span className="font-bold text-gold-bright">
                    {empire.guildMembership.guild.name}
                  </span>{" "}
                  בתפקיד {GUILD_ROLE_META[empire.guildMembership.role].label}
                </>
              ) : (
                <span className="text-zinc-500">האימפריה אינה חברה בברית.</span>
              )}
            </p>
            {/* Capacity is intentionally not enforced here — see setGuildMembership. */}
            <ActionForm action={setGuildMembership} submitLabel="שמור שיוך לברית">
              <input type="hidden" name="empireId" value={empire.id} />
              <input type="hidden" name="userId" value={user.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledSelect
                  label="ברית"
                  name="guildId"
                  defaultValue={empire.guildMembership?.guildId ?? ""}
                  options={[
                    { value: "", label: "ללא ברית (הסרה)" },
                    ...guilds.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
                <LabeledSelect
                  label="תפקיד"
                  name="role"
                  defaultValue={empire.guildMembership?.role ?? "MEMBER"}
                  options={(["LEADER", "DEPUTY", "MEMBER"] as const).map((r) => ({
                    value: r,
                    label: `${GUILD_ROLE_META[r].icon} ${GUILD_ROLE_META[r].label}`,
                  }))}
                />
              </div>
            </ActionForm>
          </EditorSection>

          <div id="sec-buffs" className="scroll-mt-4">
            <PlayerBuffs
              empireId={empire.id}
              userId={user.id}
              potionStacks={empire.potions}
              potionEffects={empire.potionEffects}
              diamondEffects={empire.diamondEffects}
              guildBuffs={empire.guildBuffs}
            />
          </div>

          <div id="sec-progress" className="scroll-mt-4">
            <PlayerProgress
              empireId={empire.id}
              userId={user.id}
              seasonPass={empire.seasonPass}
              heroQuest={empire.heroQuest}
              claimedAchievements={empire.achievements.map((a) => a.key)}
              gloryKeys={empire.gloryAwards.map((g) => g.key)}
            />
          </div>

          {counts && (
            <div id="sec-inbox" className="scroll-mt-4">
              <PlayerInbox
                empireId={empire.id}
                userId={user.id}
                messages={empire.messages}
                counts={counts}
              />
            </div>
          )}

          {/* ---------------- message + gift to this player ---------------- */}
          <div id="sec-send" className="grid scroll-mt-4 gap-4 lg:grid-cols-2">
            <EditorSection title="שלח הודעה לשחקן" icon="✉️">
              <ActionForm action={sendMessageToEmpire} submitLabel="שלח הודעה">
                <input type="hidden" name="empireId" value={empire.id} />
                <input type="hidden" name="userId" value={user.id} />
                <LabeledInput label="כותרת" name="title" required />
                <LabeledInput label="קישור (אופציונלי)" name="href" dir="ltr" placeholder="/game/base" />
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-gold-dim">תוכן</span>
                  <textarea
                    name="body"
                    rows={3}
                    required
                    className="w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none focus:border-gold/60"
                  />
                </label>
              </ActionForm>
            </EditorSection>

            <EditorSection title="שלח מתנה לשחקן" icon="🎁">
              <ActionForm action={sendGift} submitLabel="שלח מתנה" submitVariant="secondary">
                <input type="hidden" name="scope" value="empire" />
                <input type="hidden" name="scopeId" value={empire.id} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <LabeledInput label={<ResourceFieldLabel resource="gold" text="זהב" />} name="gold" type="number" min={0} placeholder="0" />
                  <LabeledInput label={<ResourceFieldLabel resource="wood" text="עץ" />} name="wood" type="number" min={0} placeholder="0" />
                  <LabeledInput label={<ResourceFieldLabel resource="iron" text="ברזל" />} name="iron" type="number" min={0} placeholder="0" />
                  <LabeledInput label={<ResourceFieldLabel resource="stone" text="אבן" />} name="stone" type="number" min={0} placeholder="0" />
                  <LabeledInput label={<ResourceFieldLabel resource="diamonds" text="יהלומים" />} name="diamonds" type="number" min={0} placeholder="0" />
                  <LabeledInput label={<ResourceFieldLabel resource="citizens" text="אזרחים" />} name="citizens" type="number" min={0} max={ADMIN_INT_MAX} placeholder="0" />
                  <LabeledInput label={<ResourceFieldLabel resource="turns" text="תורות" />} name="turns" type="number" min={0} max={ADMIN_INT_MAX} placeholder="0" />
                  <LabeledInput label="🎡 סיבובים" name="wheelSpins" type="number" min={0} max={ADMIN_INT_MAX} placeholder="0" />
                </div>
                <LabeledInput label="כותרת הודעה מצורפת (אופציונלי)" name="title" placeholder="🎁 מתנה מההנהלה" />
                <LabeledInput label="תוכן ההודעה" name="body" placeholder="קבל את המתנה שלך!" />
              </ActionForm>
            </EditorSection>
          </div>
        </>
      )}
    </div>
  );
}
