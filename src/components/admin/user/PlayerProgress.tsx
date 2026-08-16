import { ActionForm } from "@/components/admin/ActionForm";
import {
  EditorSection,
  LabeledBool,
  LabeledInput,
  LabeledSelect,
  StatLine,
} from "@/components/admin/fields";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_KEY,
  GLORY_KEYS,
  GLORY_NAME,
} from "@/lib/game/achievements";
import { SEASON_PASS_TIER_COUNT, tierForXp } from "@/lib/game/seasonPass";
import { heroQuestDurationLabel } from "@/lib/game/heroQuests";
import { formatNumber } from "@/lib/game/format";
import { formatGameDateTime } from "@/lib/game/time";
import { makeT } from "@/i18n/translate";
import { DEFAULT_LOCALE } from "@/i18n/locale";
import {
  manageHeroQuest,
  toggleAchievement,
  toggleGloryAward,
  updateSeasonPass,
} from "@/server/actions/admin";

export interface PlayerProgressProps {
  empireId: string;
  userId: string;
  seasonPass: { premium: boolean; xp: number; claimedFree: number[]; claimedPremium: number[] } | null;
  heroQuest: {
    tier: number;
    endsAt: Date;
    turnsSpent: number;
    rewardGold: number;
    rewardWood: number;
    rewardIron: number;
    rewardStone: number;
    rewardCitizens: number;
    rewardSlaves: number;
    rewardXp: number;
  } | null;
  claimedAchievements: string[];
  gloryKeys: string[];
}

/**
 * The three ladders a player climbs outside the empire itself — the pass, the
 * achievement catalog and the world-record board — plus the hero's expedition.
 *
 * Granting a rung here writes the receipt and nothing else: no gold, no
 * diamonds, no citizens. That is deliberate, because the same button is used to
 * *fix* a ladder (the player earned it, the row is missing) far more often than
 * to gift one, and a fix that silently paid the prize a second time would be
 * worse than useless. Pair it with the gift panel when a payout is intended.
 */
export function PlayerProgress({
  empireId,
  userId,
  seasonPass,
  heroQuest,
  claimedAchievements,
  gloryKeys,
}: PlayerProgressProps) {
  // The control centre stays Hebrew on purpose, so this reads the source
  // language rather than whatever the admin set the *game* to.
  const t = makeT(DEFAULT_LOCALE);
  const claimed = new Set(claimedAchievements);
  const glory = new Set(gloryKeys);
  const passTier = seasonPass ? tierForXp(seasonPass.xp) : 0;

  return (
    <>
      {/* ---------------- season pass + hero quest ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <EditorSection title="דרך התהילה" icon="🏅">
          <ActionForm action={updateSeasonPass} submitLabel="שמור דרך תהילה">
            <input type="hidden" name="empireId" value={empireId} />
            <input type="hidden" name="userId" value={userId} />
            <StatLine
              label="דרגה נוכחית"
              value={`${passTier} / ${SEASON_PASS_TIER_COUNT}`}
            />
            <StatLine
              label="נאספו במחזור"
              value={`${seasonPass?.claimedFree.length ?? 0} חינם · ${
                seasonPass?.claimedPremium.length ?? 0
              } פרימיום`}
            />
            <div className="grid grid-cols-3 gap-3">
              <LabeledBool
                label="מסלול פרימיום"
                name="premium"
                defaultValue={seasonPass?.premium ?? false}
              />
              <LabeledInput
                label="XP במחזור"
                name="xp"
                type="number"
                min={0}
                defaultValue={seasonPass?.xp ?? 0}
              />
              <LabeledBool label="אפס איסופים" name="clearClaims" defaultValue={false} />
            </div>
          </ActionForm>
        </EditorSection>

        <EditorSection title="מסע הגיבור" icon="🗺️">
          {heroQuest ? (
            <div className="space-y-3">
              <div className="panel-inset space-y-1 rounded-lg p-3">
                <StatLine
                  label="מסע"
                  value={`דרגה ${heroQuest.tier} · ${heroQuestDurationLabel(t, heroQuest.tier)}`}
                />
                <StatLine label="מסתיים" value={formatGameDateTime(heroQuest.endsAt)} />
                <StatLine label="תורות שהושקעו" value={heroQuest.turnsSpent} />
                <StatLine
                  label="שלל שנעול"
                  value={`${formatNumber(
                    heroQuest.rewardGold +
                      heroQuest.rewardWood +
                      heroQuest.rewardIron +
                      heroQuest.rewardStone
                  )} משאבים · ${heroQuest.rewardCitizens} אזרחים · ${
                    heroQuest.rewardSlaves
                  } עבדים · ${heroQuest.rewardXp} XP`}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm
                  action={manageHeroQuest}
                  submitLabel="סיים מיידית"
                  submitVariant="secondary"
                  submitClassName="w-full text-xs"
                >
                  <input type="hidden" name="empireId" value={empireId} />
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="op" value="finish" />
                </ActionForm>
                <ActionForm
                  action={manageHeroQuest}
                  submitLabel="בטל מסע"
                  submitVariant="danger"
                  submitClassName="w-full text-xs"
                  confirm="לבטל את המסע? השלל והתורות שהושקעו יאבדו."
                >
                  <input type="hidden" name="empireId" value={empireId} />
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="op" value="cancel" />
                </ActionForm>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">הגיבור אינו במסע.</p>
          )}
        </EditorSection>
      </div>

      {/* ---------------- achievements ---------------- */}
      <EditorSection title="הישגים" icon="🎖️">
        <p className="mb-3 text-[11px] text-zinc-500">
          הענקה מסמנת את ההישג כנאסף בלבד — הפרס עצמו לא משולם. לתשלום פרס
          השתמש בפאנל המתנות.
        </p>

        {claimedAchievements.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {claimedAchievements.map((key) => (
              <ActionForm
                key={key}
                action={toggleAchievement}
                submitLabel="✕"
                submitVariant="danger"
                submitClassName="!px-2 !py-1 text-xs"
                className="panel-inset flex items-center gap-2 rounded-lg p-2"
              >
                <input type="hidden" name="empireId" value={empireId} />
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="grant" value="0" />
                <span className="text-[11px] text-zinc-300">
                  {ACHIEVEMENT_BY_KEY.get(key)?.name ?? key}
                </span>
              </ActionForm>
            ))}
          </div>
        )}

        <ActionForm action={toggleAchievement} submitLabel="הענק הישג" className="panel rounded-lg p-3">
          <input type="hidden" name="empireId" value={empireId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="grant" value="1" />
          <LabeledSelect
            label="הישג"
            name="key"
            options={ACHIEVEMENTS.filter((a) => !claimed.has(a.key)).map((a) => ({
              value: a.key,
              label: a.name,
            }))}
          />
        </ActionForm>
      </EditorSection>

      {/* ---------------- world records ---------------- */}
      <EditorSection title="שיאי עולם" icon="👑">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GLORY_KEYS.map((key) => {
            const has = glory.has(key);
            return (
              <ActionForm
                key={key}
                action={toggleGloryAward}
                submitLabel={has ? "בטל שיא" : "הענק שיא"}
                submitVariant={has ? "danger" : "secondary"}
                submitClassName="w-full text-xs"
                className="panel-inset rounded-lg p-3"
              >
                <input type="hidden" name="empireId" value={empireId} />
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="grant" value={has ? "0" : "1"} />
                <p className="text-xs font-bold text-gold-bright">
                  {GLORY_NAME[key] ?? key}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {has ? "רשום על שם השחקן" : "לא הושג"}
                </p>
              </ActionForm>
            );
          })}
        </div>
      </EditorSection>
    </>
  );
}
