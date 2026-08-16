import type { DiamondEffectKind, GuildSpellType, PotionKind } from "@prisma/client";
import { ActionForm } from "@/components/admin/ActionForm";
import { EditorSection, LabeledInput, LabeledSelect, StatLine } from "@/components/admin/fields";
import { DiamondSpellActions } from "@/components/admin/user/DiamondSpellActions";
import { POTION_KINDS, POTION_META } from "@/lib/game/potions";
import { GUILD_SPELL_META, GUILD_SPELL_TYPES } from "@/lib/game/guild";
import {
  BOOST_MAX_PCT,
  BOOST_STEP_PCT,
  SHOP_DISCOUNT_PCT,
  TURN_PACKAGES,
  shieldMeta,
} from "@/lib/game/diamondShop";
import {
  clearGuildBuff,
  clearGuildBuffs,
  grantGuildBuff,
  setDiamondEffect,
  setPotionEffect,
  setPotionStack,
} from "@/server/actions/admin";
import { formatGameDateTime } from "@/lib/game/time";

/**
 * Every timed thing running on the empire, in one place.
 *
 * The three tables behind this panel are unrelated in the schema (potions,
 * diamond effects, guild spells) but identical to the player: a buff with a
 * clock on it. An admin chasing "why is this empire producing double" has to
 * be able to see all three at once, so they share a panel.
 */
export interface PlayerBuffsProps {
  empireId: string;
  userId: string;
  potionStacks: { kind: PotionKind; count: number }[];
  potionEffects: { kind: PotionKind; expiresAt: Date }[];
  diamondEffects: {
    id: string;
    kind: DiamondEffectKind;
    magnitude: number;
    activeUntil: Date | null;
    readyAt: Date | null;
  }[];
  guildBuffs: { id: string; type: GuildSpellType; bonusPct: number; expiresAt: Date }[];
}

interface DiamondSpellMeta {
  label: string;
  /** What pressing "הטל בשבילו" actually does to the empire. */
  hint: string;
  /** Durations on sale, for the pair of shields; nothing else offers a choice. */
  hourOptions?: number[];
  /** Casting it takes something away, so the button confirms first. */
  destructive?: boolean;
}

/**
 * The diamond store as the admin panel sees it: every effect kind, its Hebrew
 * name, and what a cast on the player's behalf hands over.
 *
 * The numbers are read off the shop's own tables rather than written out again,
 * so a retuned package or a new shield duration reaches this panel by itself.
 */
const DIAMOND_SPELLS: Record<DiamondEffectKind, DiamondSpellMeta> = {
  RESOURCE_BOOST_GOLD: {
    label: "בונוס הפקת זהב",
    hint: `+${BOOST_STEP_PCT}% הפקה ל-24 שעות, עד +${BOOST_MAX_PCT}%`,
  },
  RESOURCE_BOOST_WOOD: {
    label: "בונוס הפקת עץ",
    hint: `+${BOOST_STEP_PCT}% הפקה ל-24 שעות, עד +${BOOST_MAX_PCT}%`,
  },
  RESOURCE_BOOST_IRON: {
    label: "בונוס הפקת ברזל",
    hint: `+${BOOST_STEP_PCT}% הפקה ל-24 שעות, עד +${BOOST_MAX_PCT}%`,
  },
  RESOURCE_BOOST_STONE: {
    label: "בונוס הפקת אבן",
    hint: `+${BOOST_STEP_PCT}% הפקה ל-24 שעות, עד +${BOOST_MAX_PCT}%`,
  },
  SHOP_DISCOUNT: {
    label: "הנחה בחנות",
    hint: `${SHOP_DISCOUNT_PCT}% הנחה על נשק ושדרוגים ל-24 שעות`,
  },
  BANK_INTEREST: {
    label: "קסם ריבית בנק",
    hint: "מזכה מיד תשלום ריבית אחד לחשבון הבנק",
  },
  TURN_PACK_1: {
    label: "חבילת תורות 1",
    hint: `${TURN_PACKAGES[0].turns.toLocaleString("he-IL")} תורות`,
  },
  TURN_PACK_2: {
    label: "חבילת תורות 2",
    hint: `${TURN_PACKAGES[1].turns.toLocaleString("he-IL")} תורות`,
  },
  TURN_PACK_3: {
    label: "חבילת תורות 3",
    hint: `${TURN_PACKAGES[2].turns.toLocaleString("he-IL")} תורות`,
  },
  TURN_PACK_4: {
    label: "חבילת תורות 4",
    hint: `${TURN_PACKAGES[3].turns.toLocaleString("he-IL")} תורות`,
  },
  SHIELD_RESOURCES: {
    label: "מגן משאבים",
    hint: "חוסם ביזת משאבים בתקיפות",
    hourOptions: shieldMeta("resources").durations.map((d) => d.hours),
  },
  SHIELD_SOLDIERS: {
    label: "מגן חיילים",
    hint: "חוסם שעבוד חיילים בתקיפות",
    hourOptions: shieldMeta("soldiers").durations.map((d) => d.hours),
  },
  CITY_DOWNGRADE: {
    label: "קסם ירידת עיר",
    hint: "מוריד לשחקן עיר אחת — לא הפיך, ואין החזר",
    destructive: true,
  },
};

const DIAMOND_EFFECT_KINDS = Object.keys(DIAMOND_SPELLS) as DiamondEffectKind[];

function fmt(d: Date | null): string {
  return d ? formatGameDateTime(d) : "—";
}

/** Minutes left on a clock, or "פג" once it is behind us. */
function remaining(d: Date | null): string {
  if (!d) return "—";
  const min = Math.round((d.getTime() - Date.now()) / 60_000);
  return min > 0 ? `עוד ${min} דק׳` : "פג";
}

export function PlayerBuffs({
  empireId,
  userId,
  potionStacks,
  potionEffects,
  diamondEffects,
  guildBuffs,
}: PlayerBuffsProps) {
  return (
    <>
      {/* ---------------- potions ---------------- */}
      <EditorSection title="שיקויים" icon="🧪">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {POTION_KINDS.map((kind) => {
            const meta = POTION_META[kind];
            const stack = potionStacks.find((s) => s.kind === kind);
            const effect = potionEffects.find((e) => e.kind === kind);
            return (
              <div key={kind} className="panel-inset space-y-3 rounded-lg p-3">
                <div>
                  <p className={`text-xs font-bold ${meta.tone}`}>{meta.label}</p>
                  <p className="text-[11px] text-zinc-500">{meta.tagline}</p>
                </div>
                <StatLine
                  label="פעיל"
                  value={remaining(effect?.expiresAt ?? null)}
                  tone={effect ? "text-emerald-300" : "text-zinc-500"}
                />

                <ActionForm
                  action={setPotionStack}
                  submitLabel="שמור מלאי"
                  submitVariant="secondary"
                  submitClassName="w-full text-xs"
                >
                  <input type="hidden" name="empireId" value={empireId} />
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="kind" value={kind} />
                  <LabeledInput
                    label="בקבוקים בתיק"
                    name="count"
                    type="number"
                    min={0}
                    defaultValue={stack?.count ?? 0}
                  />
                </ActionForm>

                <ActionForm
                  action={setPotionEffect}
                  submitLabel="הפעל אפקט"
                  submitVariant="secondary"
                  submitClassName="w-full text-xs"
                >
                  <input type="hidden" name="empireId" value={empireId} />
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="kind" value={kind} />
                  <LabeledInput
                    label="דקות פעילות"
                    name="minutes"
                    type="number"
                    min={0}
                    defaultValue={0}
                    hint="0 מבטל את האפקט"
                  />
                </ActionForm>
              </div>
            );
          })}
        </div>
      </EditorSection>

      {/* ---------------- diamond spells, shields and cooldowns ---------------- */}
      <EditorSection title="קסמי יהלומים, מגנים וצינונים" icon="💎">
        <p className="mb-3 text-[11px] text-zinc-500">
          כל קסם בחנות היהלומים, עם מצבו הנוכחי אצל השחקן. ״הטל בשבילו״ מריץ את
          הקסם עצמו — בלי לחייב יהלומים, בלי להיחסם על ידי צינון ובלי להשאיר
          צינון חדש. ״בטל צינון״ נוגע רק בשעון ומשאיר באפ פעיל על כנו.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DIAMOND_EFFECT_KINDS.map((kind) => {
            const meta = DIAMOND_SPELLS[kind];
            const fx = diamondEffects.find((e) => e.kind === kind);
            const active = fx?.activeUntil != null && fx.activeUntil > new Date();
            const cooling = fx?.readyAt != null && fx.readyAt > new Date();
            return (
              <div key={kind} className="panel-inset space-y-3 rounded-lg p-3">
                <div>
                  <p className="text-xs font-bold text-gold-bright">{meta.label}</p>
                  <p className="text-[11px] text-zinc-500">{meta.hint}</p>
                </div>

                {fx?.magnitude ? (
                  <StatLine label="עוצמה" value={`${fx.magnitude}%`} />
                ) : null}
                <StatLine
                  label="פעיל עד"
                  value={
                    fx?.activeUntil
                      ? `${fmt(fx.activeUntil)} (${remaining(fx.activeUntil)})`
                      : "—"
                  }
                  tone={active ? "text-emerald-300" : "text-zinc-500"}
                />
                <StatLine
                  label="צינון עד"
                  value={
                    fx?.readyAt ? `${fmt(fx.readyAt)} (${remaining(fx.readyAt)})` : "—"
                  }
                  tone={cooling ? "text-amber-300" : "text-zinc-500"}
                />

                <DiamondSpellActions
                  empireId={empireId}
                  userId={userId}
                  kind={kind}
                  label={meta.label}
                  hourOptions={meta.hourOptions}
                  destructive={meta.destructive}
                  hasCooldown={fx?.readyAt != null}
                  hasEffect={fx != null}
                />
              </div>
            );
          })}
        </div>

        <ActionForm
          action={setDiamondEffect}
          submitLabel="הגדר אפקט"
          className="panel mt-4 rounded-lg p-3"
        >
          <input type="hidden" name="empireId" value={empireId} />
          <input type="hidden" name="userId" value={userId} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LabeledSelect
              label="סוג"
              name="kind"
              options={DIAMOND_EFFECT_KINDS.map((k) => ({
                value: k,
                label: DIAMOND_SPELLS[k].label,
              }))}
            />
            <LabeledInput label="עוצמה באחוזים" name="magnitude" type="number" min={0} defaultValue={0} />
            <LabeledInput label="דקות פעילות" name="activeMinutes" type="number" min={0} defaultValue={0} />
            <LabeledInput label="דקות צינון" name="cooldownMinutes" type="number" min={0} defaultValue={0} />
          </div>
          <p className="text-[11px] text-zinc-500">
            כוונון ידני, כשצריך משך או צינון שאינם אלה של החנות. בונוסים ומגנים
            משתמשים ב״דקות פעילות״; ריבית הבנק וחבילות התורות משתמשות ב״דקות
            צינון״. אפס בכל השדות מוחק את האפקט.
          </p>
        </ActionForm>
      </EditorSection>

      {/* ---------------- guild spell buffs ---------------- */}
      <EditorSection title="קסמי ברית פעילים" icon="✨">
        {guildBuffs.length > 0 ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guildBuffs.map((b) => (
              <ActionForm
                key={b.id}
                action={clearGuildBuff}
                submitLabel="בטל קסם"
                submitVariant="danger"
                submitClassName="w-full text-xs"
                className="panel-inset rounded-lg p-3"
                confirm={`לבטל את ${GUILD_SPELL_META[b.type].label} לשחקן?`}
              >
                <input type="hidden" name="empireId" value={empireId} />
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="type" value={b.type} />
                <p className="text-[11px] text-zinc-300">
                  {GUILD_SPELL_META[b.type].label} · +{b.bonusPct}% ·{" "}
                  {remaining(b.expiresAt)}
                </p>
              </ActionForm>
            ))}
          </div>
        ) : (
          <p className="mb-4 text-xs text-zinc-500">אין קסמים פעילים.</p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm
            action={grantGuildBuff}
            submitLabel="הענק קסם"
            submitVariant="secondary"
            className="panel rounded-lg p-3"
          >
            <input type="hidden" name="empireId" value={empireId} />
            <input type="hidden" name="userId" value={userId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <LabeledSelect
                label="קסם"
                name="type"
                options={GUILD_SPELL_TYPES.map((t) => ({
                  value: t,
                  label: GUILD_SPELL_META[t].label,
                }))}
              />
              <LabeledInput label="בונוס %" name="bonusPct" type="number" min={0} defaultValue={10} />
              <LabeledInput label="שעות" name="hours" type="number" min={0} defaultValue={24} />
            </div>
          </ActionForm>

          <ActionForm
            action={clearGuildBuffs}
            submitLabel="הסר את כל הקסמים"
            submitVariant="danger"
            className="panel rounded-lg p-3"
            confirm="להסיר את כל קסמי הברית מהאימפריה?"
          >
            <input type="hidden" name="empireId" value={empireId} />
            <input type="hidden" name="userId" value={userId} />
          </ActionForm>
        </div>
      </EditorSection>
    </>
  );
}
