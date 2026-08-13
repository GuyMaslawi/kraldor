import type { CSSProperties } from "react";
import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { DiscordJoin } from "@/components/game/DiscordJoin";
import { discordInviteUrl } from "@/server/discord";
import { COMMUNITY_HIGHLIGHTS, COMMUNITY_RULES } from "@/lib/community";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("קהילה | KRALDOR") };
}

/**
 * Bubbles drifting up behind the banner. Fixed table, never Math.random(): the
 * scene is server-rendered, and a random position would differ between the SSR
 * pass and hydration. Same rule every scene on the site follows.
 */
const BUBBLES = [
  { x: "8%", d: "0s", dur: "13s", s: "1" },
  { x: "22%", d: "3.4s", dur: "16s", s: "0.7" },
  { x: "38%", d: "1.6s", dur: "14.5s", s: "1.2" },
  { x: "54%", d: "5.2s", dur: "17s", s: "0.85" },
  { x: "69%", d: "2.3s", dur: "15s", s: "1.1" },
  { x: "84%", d: "6.1s", dur: "18s", s: "0.75" },
  { x: "94%", d: "4.4s", dur: "14s", s: "0.95" },
];

/**
 * /game/community — where the game points at the room it is played in.
 *
 * Written to render in **both** states, because the channel is being built
 * elsewhere and the site had to be ready first: with `DISCORD_URL` set every
 * call to action is live, and without it the same page says the channel is on
 * its way. There is no third "broken link" state, which is the whole reason the
 * invite is validated rather than trusted (see parseDiscordInvite).
 */
export default async function CommunityPage() {
  const t = await getT();
  const empire = await requireEmpire();
  const discord = discordInviteUrl();

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t("קהילה")}
        ornament={<Icon name="discord" size={20} className="text-crimson" />}
      />

      {/* -------- the banner -------- */}
      <div className="disc-scene panel-gold mx-auto max-w-4xl rounded-2xl p-5 sm:p-7">
        <span className="disc-glow" aria-hidden />
        <span className="disc-bubbles" aria-hidden>
          {BUBBLES.map((b) => (
            <span
              key={b.x}
              style={
                { "--x": b.x, "--d": b.d, "--dur": b.dur, "--s": b.s } as CSSProperties
              }
            />
          ))}
        </span>

        <div className="disc-body text-center">
          <Icon name="discord" size={46} className="disc-mark mx-auto text-[#8b95ff]" />
          <h2 className="mt-3 text-xl font-black tracking-wide text-gold-bright sm:text-2xl">
              {t("הערוץ של קראלדור")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-bone/85">
              {t("הדירוג הוא רק חצי מהמשחק. החצי השני הוא מי שיושב מהצד השני של המסך — בריתות שמתגבשות, טקטיקות שמתחלפות, וכל הכרזה על Happy Hour או סיזן חדש שנוחתת שם קודם.")}


          </p>

          <div className="mt-5 flex flex-col items-center gap-2">
            {discord ? (
              <DiscordLink url={discord} variant="button" label={t("כניסה לערוץ הדיסקורד")} />
            ) : (
              <>
                <span className="inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-black/40 px-5 py-2 text-sm font-bold text-gold-dim">
                  <Icon name="lock" size={16} />
              {t("הערוץ נבנה בימים אלה")}
                </span>
                <p className="text-xs text-zinc-500">
              {t("ברגע שהוא ייפתח, הקישור יופיע כאן ובכל מסכי המשחק.")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* -------- what is in there -------- */}
      <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
        {COMMUNITY_HIGHLIGHTS.map((item) => (
          <div key={item.title} className="panel rounded-xl p-4">
            <h3 className="flex items-center gap-2 font-black text-gold-bright">
              <Icon name={item.icon} size={18} className="shrink-0 text-crimson-bright" />
              {t(item.title)}
            </h3>
            <p className="mt-1.5 text-[0.82rem] leading-relaxed text-zinc-400">
              {t(item.body)}
            </p>
          </div>
        ))}
      </div>

      {/* -------- the welcome purse -------- */}
      <div className="mx-auto max-w-4xl">
        {/* Boolean(), not `!== null`: a stamp that is missing from the object
            entirely — an older generated client, a narrower select in some
            future caller — is "not collected", and `undefined !== null` would
            have quietly shown every player a purse they never took. */}
        <DiscordJoin url={discord} claimed={Boolean(empire.discordJoinedAt)} />
      </div>

      {/* -------- house rules -------- */}
      <div className="panel-inset mx-auto max-w-4xl rounded-xl p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
          <Icon name="shield" size={20} className="text-crimson-bright" />
            {t("כללי הבית")}
        </h2>
        <ul className="space-y-2">
          {COMMUNITY_RULES.map((rule) => (
            <li key={rule} className="flex gap-2.5 text-[0.85rem] leading-relaxed text-bone/85">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-gold-dim" />
              <span>{t(rule)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mx-auto max-w-4xl text-center text-xs text-zinc-500">
          {t("מעדיפים להישאר בתוך המשחק? הצ׳אט החי בפינה השמאלית התחתונה פתוח תמיד — חדר כללי ושיחות פרטיות.")}

      </p>
    </div>
  );
}
