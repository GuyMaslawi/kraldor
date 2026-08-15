import type { ReactNode } from "react";
import { ActionForm } from "@/components/admin/ActionForm";
import { LabeledInput, ResourceFieldLabel } from "@/components/admin/fields";
import { Icon, type IconName } from "@/components/ui/Icon";
import { updateVitals } from "@/server/actions/admin";
import { ADMIN_INT_MAX } from "@/lib/admin";
import { MAX_CITIES } from "@/lib/game/constants";
import { formatNumber } from "@/lib/game/format";
import { GUILD_ROLE_META } from "@/lib/game/guild";
import { VIP_LABEL } from "@/lib/game/vip";
import { isOnline } from "@/lib/game/chat";
import type { GuildRole } from "@prisma/client";

export interface PlayerVitalsProps {
  userId: string;
  /** The player's page, in one row. Everything here is read from the empire the page already loaded. */
  empire: {
    id: string;
    cities: number;
    cityLabel: string;
    gold: number;
    wood: number;
    iron: number;
    stone: number;
    diamonds: number;
    citizens: number;
    turns: number;
    wheelSpins: number;
    bankGold: number;
    soldiers: number;
    spies: number;
    mineSlaves: number;
    heroLevel: number;
    heroHealth: number;
    generalPower: number;
    militaryPower: number;
    spyPower: number;
    vipSince: Date | null;
    protectedUntil: Date | null;
    lastSeenAt: Date | null;
    isBot: boolean;
    isStaff: boolean;
    seasonName: string | null;
    guild: { name: string; role: GuildRole } | null;
  };
  /** The account facts an admin checks before touching anything else. */
  account: {
    isAdmin: boolean;
    banned: boolean;
    banText: string | null;
    emailVerified: boolean;
  };
}

/** One status pill in the top strip. */
function Chip({
  children,
  tone = "text-zinc-300 border-border-subtle",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border bg-panel-inset px-2.5 py-1 text-[11px] font-bold ${tone}`}
    >
      {children}
    </span>
  );
}

/** One read-only figure in the glance grid. */
function Figure({
  label,
  value,
  icon,
  tone = "text-zinc-100",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="panel-inset rounded-lg px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className={`nums truncate text-sm font-black ${tone}`} dir="ltr">
        {value}
      </div>
    </div>
  );
}

/** Resource icon + label, sized for the glance grid. */
function res(name: IconName, className: string) {
  return <Icon name={name} size={12} className={className} />;
}

/**
 * Where the jump links point. Each id is set on the matching section of the
 * player page — keep the two lists in step; a link to a missing id simply does
 * nothing, which is worse than a compile error but better than a wrong scroll.
 */
const JUMP_LINKS: { id: string; label: string }[] = [
  { id: "sec-account", label: "🔑 חשבון" },
  { id: "sec-security", label: "🛡️ אבטחה" },
  { id: "sec-core", label: "🏰 ליבה" },
  { id: "sec-state", label: "⏱️ שעונים" },
  { id: "sec-army", label: "🪖 צבא ובנק" },
  { id: "sec-buildings", label: "🏗️ מבנים" },
  { id: "sec-storage", label: "📦 מחסנים" },
  { id: "sec-weapons", label: "🗡️ נשקים" },
  { id: "sec-hero", label: "⚔️ גיבור" },
  { id: "sec-guild", label: "🤝 ברית" },
  { id: "sec-buffs", label: "🧪 באפים" },
  { id: "sec-progress", label: "📜 התקדמות" },
  { id: "sec-inbox", label: "✉️ דואר" },
  { id: "sec-send", label: "🎁 הודעה ומתנה" },
];

/**
 * מבט מהיר — the player page, above the fold.
 *
 * The page below it is the complete editor: seventeen panels, everything the
 * game stores about an account. That completeness is what makes it slow to use
 * — handing out 500 soldiers meant scrolling past the buildings, the storages,
 * the upgrades and the arsenal to find the army card. This panel answers the
 * two questions that actually open the page ("what does this player have" and
 * "change one number"), and links to the rest rather than duplicating it.
 *
 * The editable fields are exactly those of `updateEmpireCore` + `updateArmy`
 * minus the empire name, and the action clamps them identically — nothing is
 * reachable here that is not reachable below.
 */
export function PlayerVitals({ userId, empire, account }: PlayerVitalsProps) {
  const now = new Date();
  const shielded = empire.protectedUntil != null && empire.protectedUntil > now;
  const online = isOnline(
    { id: empire.id, lastSeenAt: empire.lastSeenAt, isBot: empire.isBot },
    now
  );
  const heroDead = empire.heroHealth <= 0;

  return (
    <section className="panel rounded-xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold tracking-wide text-gold-bright">
          <span aria-hidden>⚡</span> מבט מהיר
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {account.isAdmin && <Chip tone="border-gold/40 text-gold-bright">🛡️ אדמין</Chip>}
          {empire.isStaff && <Chip tone="border-gold/40 text-gold-dim">צוות (מחוץ לדירוגים)</Chip>}
          {empire.isBot && <Chip tone="border-zinc-600 text-zinc-400">🤖 בוט</Chip>}
          {account.banned ? (
            <Chip tone="border-red-500/40 text-red-300">🚫 {account.banText ?? "בבאן"}</Chip>
          ) : (
            <Chip tone="border-emerald-500/30 text-emerald-300">✅ פעיל</Chip>
          )}
          {!account.emailVerified && (
            <Chip tone="border-amber-500/40 text-amber-300">✉️ אימייל לא מאומת</Chip>
          )}
          {empire.vipSince && <Chip tone="border-cyan-400/40 text-cyan-300">👑 {VIP_LABEL}</Chip>}
          {shielded && (
            <Chip tone="border-emerald-500/30 text-emerald-300">
              🛡️ מוגן עד {empire.protectedUntil!.toLocaleString("he-IL")}
            </Chip>
          )}
          {heroDead && <Chip tone="border-red-500/40 text-red-300">💀 גיבור מת</Chip>}
          <Chip tone={online ? "border-emerald-500/30 text-emerald-300" : "border-border-subtle text-zinc-400"}>
            {online ? "🟢 מחובר" : `⚪ ${empire.lastSeenAt ? empire.lastSeenAt.toLocaleString("he-IL") : "לא נראה מעולם"}`}
          </Chip>
        </div>
      </div>

      {/* ---- what he has, at a glance (read-only) ---- */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="עיר" value={empire.cityLabel} icon="🏛️" tone="text-gold-bright" />
        <Figure label="רמת גיבור" value={empire.heroLevel} icon="⚔️" />
        <Figure
          label="חיי גיבור"
          value={empire.heroHealth}
          icon="❤️"
          tone={heroDead ? "text-red-300" : "text-zinc-100"}
        />
        <Figure label="עוצמה כללית" value={formatNumber(empire.generalPower)} icon="💪" tone="text-gold-bright" />
        <Figure label="עוצמה צבאית" value={formatNumber(empire.militaryPower)} icon="🪖" />
        <Figure label="עוצמת ריגול" value={formatNumber(empire.spyPower)} icon="🕵️" />
        <Figure label="זהב בבנק" value={formatNumber(empire.bankGold)} icon={res("gold", "text-gold-bright")} />
        <Figure
          label="ברית"
          value={
            empire.guild
              ? `${empire.guild.name} · ${GUILD_ROLE_META[empire.guild.role].label}`
              : "—"
          }
          icon="🤝"
        />
        <Figure label="עונה" value={empire.seasonName ?? "—"} icon="📅" />
      </div>

      {/* ---- the numbers, editable in one submit ---- */}
      <ActionForm action={updateVitals} submitLabel="💾 שמור מבט מהיר">
        <input type="hidden" name="empireId" value={empire.id} />
        <input type="hidden" name="userId" value={userId} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <LabeledInput label={<ResourceFieldLabel resource="gold" text="זהב" />} name="gold" type="number" min={0} defaultValue={Math.round(empire.gold)} />
          <LabeledInput label={<ResourceFieldLabel resource="wood" text="עץ" />} name="wood" type="number" min={0} defaultValue={Math.round(empire.wood)} />
          <LabeledInput label={<ResourceFieldLabel resource="iron" text="ברזל" />} name="iron" type="number" min={0} defaultValue={Math.round(empire.iron)} />
          <LabeledInput label={<ResourceFieldLabel resource="stone" text="אבן" />} name="stone" type="number" min={0} defaultValue={Math.round(empire.stone)} />
          <LabeledInput label={<ResourceFieldLabel resource="diamonds" text="יהלומים" />} name="diamonds" type="number" min={0} defaultValue={Math.round(empire.diamonds)} />
          <LabeledInput label={<ResourceFieldLabel resource="citizens" text="אזרחים" />} name="citizens" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.citizens} />
          <LabeledInput label={<ResourceFieldLabel resource="turns" text="תורות" />} name="turns" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.turns} />
          <LabeledInput label="🎡 סיבובי גלגל" name="wheelSpins" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.wheelSpins} />
          <LabeledInput label="🪖 חיילים" name="soldiers" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.soldiers} />
          <LabeledInput label="🕵️ מרגלים" name="spies" type="number" min={0} max={ADMIN_INT_MAX} defaultValue={empire.spies} />
          <LabeledInput
            label={<><Icon name="mine" size={13} className="inline align-[-2px]" /> עבדים</>}
            name="mineSlaves"
            type="number"
            min={0}
            max={ADMIN_INT_MAX}
            defaultValue={empire.mineSlaves}
            hint="החלוקה למכרות בפאנל המבנים"
          />
          <LabeledInput
            label="🏛️ ערים"
            name="cities"
            type="number"
            min={1}
            max={MAX_CITIES}
            defaultValue={empire.cities}
            hint={`1–${MAX_CITIES}`}
          />
        </div>
        <p className="text-[11px] text-zinc-500">
          שמירה כאן זהה לשמירה בפאנלים &quot;נתוני אימפריה&quot; ו&quot;צבא&quot; — אותן
          תקרות, ועוצמת האימפריה מחושבת מחדש. שם האימפריה, הבנק והגיבור נערכים בפאנלים שלהם.
        </p>
      </ActionForm>

      {/* ---- and the way down to the rest of the page ---- */}
      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
        {/* Plain anchors, not next/link: these move the scroll position inside
            the page that is already rendered — there is no navigation to do. */}
        {JUMP_LINKS.map((l) => (
          <a
            key={l.id}
            href={`#${l.id}`}
            className="rounded-full border border-border-subtle bg-panel-inset px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-gold/40 hover:text-gold-bright"
          >
            {l.label}
          </a>
        ))}
      </div>
    </section>
  );
}
