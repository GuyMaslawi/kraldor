import { prisma } from "@/lib/prisma";
import { requireAdmin, ADMIN_INT_MAX } from "@/lib/admin";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ActionForm } from "@/components/admin/ActionForm";
import {
  LabeledInput,
  LabeledSelect,
  EditorSection,
  ResourceFieldLabel,
} from "@/components/admin/fields";
import { TargetPicker } from "@/components/admin/TargetPicker";
import { broadcastMessage, sendGift } from "@/server/actions/admin";
import { isDiscordAnnouncerConfigured } from "@/server/discord";
import { BROADCAST_DEFAULTS, GIFT_DEFAULTS } from "@/lib/adminBroadcast";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastPage() {
  await requireAdmin();
  // Two rooms, two webhooks, and either one can be missing on its own — the
  // broadcast form talks about the updates room and the gift form about the
  // events one, so each says whether *its* room is wired rather than whether
  // "Discord" is.
  const discordUpdates = isDiscordAnnouncerConfigured("updates");
  const discordEvents = isDiscordAnnouncerConfigured("events");

  const [seasons, guilds, empires] = await Promise.all([
    prisma.gameSeason.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    prisma.guild.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.empire.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <SectionHeading title="שידור ומתנות" ornament="📣" />

      <div className="grid gap-4 lg:grid-cols-2">
        <EditorSection title="שידור הודעה" icon="📣">
          <p className="mb-3 text-xs text-zinc-400">
            שלח הודעה לכל השחקנים, לפעילים בלבד, לעונה, לברית או לשחקן בודד. בסוג
            &quot;הכרזה&quot; (ברירת המחדל) ההודעה נפתחת כדיאלוג גדול במרכז המסך — פעם אחת לכל
            שחקן, ברגע שהוא טוען עמוד או תוך שניות אם הוא כבר במשחק. בשאר הסוגים היא מגיעה
            כהתראה בפינה, כמו קודם. בכל מקרה היא נשמרת בתיבת ההודעות.
          </p>
          {/* An admin typing a broadcast has no other way to know it is about
              to be reposted publicly — and the rule (all-players only) is not
              guessable from the form. It is stated here, next to the field. */}
          <p
            className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              discordUpdates || discordEvents
                ? "border-[#5865F2]/45 bg-[#5865F2]/10 text-[#c7ccff]"
                : "border-border-subtle bg-black/25 text-zinc-500"
            }`}
          >
            {discordUpdates || discordEvents
              ? "שידור לכל השחקנים או לפעילים מתפרסם אוטומטית גם בדיסקורד — אותו נוסח בדיוק, כדי שתישלח התראה לטלפון — בערוץ שנבחר למטה. שידור לעונה, לברית או לשחקן בודד — לא."
              : "פרסום אוטומטי לדיסקורד כבוי (וובהוקים לא מוגדרים)."}
          </p>
          <ActionForm action={broadcastMessage} submitLabel="שדר הודעה">
            <TargetPicker seasons={seasons} guilds={guilds} empires={empires} />
            {/* The one thing about the post the admin actually decides. Default
                is the updates room: a broadcast typed by hand is usually news
                about the game, and an event releases itself. */}
            <LabeledSelect
              label="ערוץ דיסקורד"
              name="discordChannel"
              defaultValue="updates"
              options={[
                {
                  value: "updates",
                  label: `עדכונים ופיתוחים${discordUpdates ? "" : " (לא מוגדר)"}`,
                },
                {
                  value: "events",
                  label: `אירועים${discordEvents ? "" : " (לא מוגדר)"}`,
                },
              ]}
            />
            {/* The only choice here that changes *how loudly* the message
                lands, so it says so in the labels rather than only in a
                colour. הכרזה is the default: a broadcast typed by hand is
                nearly always news somebody has to actually receive. */}
            <LabeledSelect
              label="סוג"
              name="kind"
              defaultValue="ANNOUNCEMENT"
              options={[
                { value: "ANNOUNCEMENT", label: "הכרזה — דיאלוג גדול במרכז המסך (עדכונים ובאגים)" },
                { value: "SYSTEM", label: "מערכת (זהב) — התראה בפינה" },
                { value: "BATTLE", label: "קרב (אדום) — התראה בפינה" },
                { value: "SPY", label: "ריגול (סגול) — התראה בפינה" },
              ]}
            />
            {/* Pre-filled rather than placeheld: an announcement that only has
                to say "there is news" should cost one click, and anything more
                specific is typed over the default. */}
            <LabeledInput
              label="כותרת"
              name="title"
              required
              defaultValue={BROADCAST_DEFAULTS.title}
            />
            <LabeledInput label="קישור (אופציונלי)" name="href" dir="ltr" placeholder="/game/base" />
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-gold-dim">תוכן</span>
              <textarea
                name="body"
                rows={4}
                required
                defaultValue={BROADCAST_DEFAULTS.body}
                className="w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none focus:border-gold/60"
              />
            </label>
          </ActionForm>
        </EditorSection>

        <EditorSection title="שליחת מתנה / פרס" icon="🎁">
          <p className="mb-3 text-xs text-zinc-400">
            הענק משאבים, יהלומים, אזרחים, תורות וסיבובי גלגל. ברירת המחדל: שחקנים שנכנסו ב-24 השעות האחרונות. אפשר לצרף הודעה שתישלח יחד עם המתנה.
          </p>
          {/* Same rule as the broadcast, said again next to the form that
              obeys it — an admin attaching a note to a gift has no other way to
              know that note is also about to be posted publicly. */}
          <p
            className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              discordEvents
                ? "border-[#5865F2]/45 bg-[#5865F2]/10 text-[#c7ccff]"
                : "border-border-subtle bg-black/25 text-zinc-500"
            }`}
          >
            {discordEvents
              ? "ההודעה המצורפת מתפרסמת אוטומטית גם בערוץ האירועים בדיסקורד, באותו נוסח — אם המתנה נשלחת לכל השחקנים או לפעילים. בלי הודעה מצורפת אין פרסום."
              : "פרסום אוטומטי לדיסקורד כבוי (DISCORD_WEBHOOK_URL_EVENTS לא מוגדר)."}
          </p>
          <ActionForm action={sendGift} submitLabel="שלח מתנה" submitVariant="secondary">
            {/* Opens on the last day's players: a gift is a reason to come
                back tonight, and handing one to an account nobody has opened
                in a month is inflation with no player on the other end. */}
            <TargetPicker
              seasons={seasons}
              guilds={guilds}
              empires={empires}
              defaultScope="active"
              defaultActiveHours={24}
            />
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
            <LabeledInput
              label="כותרת הודעה מצורפת (רוקן כדי לשלוח בלי הודעה)"
              name="title"
              defaultValue={GIFT_DEFAULTS.title}
            />
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-gold-dim">תוכן ההודעה</span>
              <textarea
                name="body"
                rows={3}
                defaultValue={GIFT_DEFAULTS.body}
                className="w-full rounded-lg border border-border-subtle bg-panel-inset px-3 py-2 text-sm text-zinc-100 outline-none focus:border-gold/60"
              />
            </label>
          </ActionForm>
        </EditorSection>
      </div>
    </div>
  );
}
