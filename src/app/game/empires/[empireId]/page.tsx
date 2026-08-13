import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireEmpire } from "@/lib/auth";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { isOnline } from "@/lib/game/chat";
import { cityFullName, cityName } from "@/lib/game/cities";
import { MAX_CITIES } from "@/lib/game/constants";
import { Tip } from "@/components/ui/Tip";
import { RankActions } from "@/components/game/RankActions";
import {
  RANK_ACTION_BUTTON_BASE,
  RANK_ACTION_MESSAGE_STYLE,
} from "@/lib/game/actionButtonStyles";
import { SabotagePanel } from "@/components/game/SabotagePanel";
import { SABOTAGE_MISSIONS, type SabotageOption } from "@/lib/game/sabotage";
import { MessageCompose } from "@/components/game/MessageCompose";
import { ShieldBadges } from "@/components/game/ShieldBadges";
import { ActivePotions } from "@/components/game/ActivePotions";
import { getActiveShields } from "@/lib/game/diamondEffects";
import { sharedGuild } from "@/lib/game/guildAllies";
import { isStaffEmpire } from "@/lib/staff";
import { getActivePotionExpiries } from "@/lib/game/potionEffects";
import { SHIELDS } from "@/lib/game/diamondShop";
import { HeroPaperdoll } from "@/components/game/HeroPaperdoll";
import { EmpireMedals } from "@/components/game/EmpireMedals";
import { EmpireBio } from "@/components/game/EmpireBio";
import { WornTitle } from "@/components/ui/WornTitle";
import { getEmpireMedals } from "@/server/empireMedals";
import type { HeroItemView } from "@/components/game/heroItemView";
import { formatNumber, formatDate } from "@/lib/game/format";
import { getI18n, getT } from "@/i18n/server";
import {
  HERO_CLASS_META,
  heroClassImage,
  tierForLevel,
} from "@/lib/game/hero";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("פרופיל אימפריה | קראלדור") };
}

/** The four plunder columns of a battle report, in the order the game shows them. */
// i18n-keys-start: dictionary keys, drawn through t(res.label) in the feud table
const LOOT = [
  { key: "stolenGold", label: "זהב", icon: "gold", tone: "text-gold-bright" },
  { key: "stolenWood", label: "עץ", icon: "wood", tone: "text-amber-600" },
  { key: "stolenIron", label: "ברזל", icon: "iron", tone: "text-slate-300" },
  { key: "stolenStone", label: "אבן", icon: "stone", tone: "text-stone-400" },
] as const;
// i18n-keys-end

/**
 * The whole war between two empires, in numbers: every raid either of them ever
 * launched at the other, summed.
 *
 * Both directions are read the same way — plunder only ever moves attacker-ward,
 * so "what he took from me" is simply the aggregate of the rows where *he* is
 * the attacker. Wins are counted separately from raids: a lost raid still costs
 * turns and still belongs in the tally, it just came home empty.
 */
async function loadFeud(meId: string, foeId: string) {
  const sums = {
    stolenGold: true,
    stolenWood: true,
    stolenIron: true,
    stolenStone: true,
    enslavedSoldiers: true,
  } as const;

  const [mine, theirs, myWins, theirWins] = await Promise.all([
    prisma.battleReport.aggregate({
      where: { attackerEmpireId: meId, defenderEmpireId: foeId },
      _sum: sums,
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.battleReport.aggregate({
      where: { attackerEmpireId: foeId, defenderEmpireId: meId },
      _sum: sums,
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.battleReport.count({
      where: { attackerEmpireId: meId, defenderEmpireId: foeId, winnerEmpireId: meId },
    }),
    prisma.battleReport.count({
      where: { attackerEmpireId: foeId, defenderEmpireId: meId, winnerEmpireId: foeId },
    }),
  ]);

  const side = (
    agg: typeof mine,
    wins: number
  ) => ({
    raids: agg._count._all,
    wins,
    last: agg._max.createdAt,
    captives: Math.floor(agg._sum.enslavedSoldiers ?? 0),
    loot: {
      stolenGold: Math.floor(agg._sum.stolenGold ?? 0),
      stolenWood: Math.floor(agg._sum.stolenWood ?? 0),
      stolenIron: Math.floor(agg._sum.stolenIron ?? 0),
      stolenStone: Math.floor(agg._sum.stolenStone ?? 0),
    },
  });

  return { mine: side(mine, myWins), theirs: side(theirs, theirWins) };
}

/**
 * A dossier is one panel: the hero, what he wears, and the buttons you came to
 * press. The banner, the stat tiles, the power breakdown and the "what this
 * dossier reveals" card all used to stack above it, and between them they said
 * less than the figure itself does — a rival's numbers are intel, learned by
 * spying or fighting, and they live on that report rather than here.
 */
export default async function EmpireProfilePage({
  params,
}: {
  params: Promise<{ empireId: string }>;
}) {
  const { t, locale } = await getI18n();
  const { empireId } = await params;
  const myEmpire = await requireEmpire();

  // `user` is selected down to the display name on purpose. This is a *rival's*
  // dossier: `include: { user: true }` pulled his email, password digest, Google
  // id, token version and both of his recorded IP addresses into the render, all
  // to print one name in the subtitle. Nothing here ever crossed to the browser,
  // but the row sat one prop away from doing so on the one page in the game that
  // every player opens about somebody else.
  const empire = await prisma.empire.findUnique({
    where: { id: empireId },
    include: {
      user: { select: { name: true } },
      hero: { include: { items: { where: { equipped: true } } } },
    },
  });
  if (!empire) notFound();

  const hero = empire.hero;
  const heroLevel = hero?.level ?? 1;
  const heroResets = hero?.resets ?? 0;
  const heroClassKey = hero?.heroClass ?? "WARLORD";
  // The paperdoll is a client component, so the rows have to cross as plain
  // data. Tier is always derived from level — never read off the row.
  const equippedView: HeroItemView[] = (hero?.items ?? []).map(({ id, slot, level }) => ({
    id,
    slot,
    level,
    rarity: tierForLevel(level),
  }));

  const isMe = empire.id === myEmpire.id;
  // Espionage and combat are confined to your own city — an empire is "in your
  // city" when it holds the same number of cities as you.
  const sameCity = empire.cities === myEmpire.cities;
  // Staff are not targets at all (src/lib/staff.ts). The server refuses the
  // action either way — this only keeps the buttons from being offered, so the
  // page says why instead of spending the click to find out.
  const staffTarget = isStaffEmpire(empire);
  const canEngage = !isMe && sameCity && !staffTarget;

  // The sabotage bench, priced against what the viewer actually holds and
  // against the target's paid shields. Only assembled when the two are in the
  // same city — the panel is not rendered otherwise, and the shield lookup is a
  // query nobody should pay for on a dossier they cannot act on.
  const targetShields = canEngage
    ? await getActiveShields(empire.id)
    : null;
  const sabotageOptions: SabotageOption[] = SABOTAGE_MISSIONS.map((mission) => ({
    kind: mission.kind,
    name: mission.name,
    blurb: mission.blurb,
    icon: mission.icon,
    accent: mission.accent,
    spies: mission.spies,
    turns: mission.turns,
    pct: Math.round(mission.share * 100),
    affordable:
      myEmpire.turns >= mission.turns &&
      (myEmpire.army?.spies ?? 0) >= mission.spies,
    shielded: Boolean(targetShields?.[mission.shield]),
  }));
  // Guildmates never raid each other (see lib/game/guildAllies.ts). Only the
  // attack half is off — a spy mission against an ally still runs.
  const allied = isMe ? null : await sharedGuild(myEmpire.id, empire.id);

  // Raid shields are public knowledge — no spy report needed. Knowing there is
  // nothing to take is precisely what should stop you wasting turns here.
  const shields = await getActiveShields(empire.id);
  const activeShields = SHIELDS.filter((s) => shields[s.key] !== null);

  // Running brews are the other half of that intel: a defender under שיקוי
  // החסינות will not lose a scratch of hero health to your raid, and one under
  // שיקוי השפע is farming twice as fast as the ladder makes him look. Public,
  // like shields — knowing what is in force is exactly what should decide
  // whether this hour is the hour to hit him.
  const now = new Date();

  // Is he at the keyboard right now? `lastSeenAt` is a plain scalar on the row
  // above, and it is collapsed to a boolean here — the timestamp itself never
  // becomes a prop, or the dossier would ship "away since 03:14" to every rival.
  // Your own dossier always reads online: you are demonstrably here, and your own
  // heartbeat can be up to PRESENCE_TOUCH_MS old.
  const online = isMe || isOnline(empire, now);

  const potionExpiries = isMe
    ? {}
    : await getActivePotionExpiries(empire.id, undefined, now);
  const potionActiveUntil = Object.fromEntries(
    Object.entries(potionExpiries).map(([kind, at]) => [kind, at.getTime()])
  );
  const potionsRunning = Object.keys(potionActiveUntil).length > 0;

  // The records case: only capstones this empire was *first in the world* to
  // reach, which is one bounded query and no per-empire read at all — see
  // src/server/empireMedals.ts for why the milestone wall that used to be here
  // said nothing.
  const medals = await getEmpireMedals(empire.id);

  // The dossier's own history: everything the two of you ever took off each other.
  const feud = isMe ? null : await loadFeud(myEmpire.id, empire.id);
  const foughtBefore = feud !== null && feud.mine.raids + feud.theirs.raids > 0;
  // The newer of the two sides' last raid — whichever of you swung most recently.
  const lastClash = [feud?.mine.last, feud?.theirs.last]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="space-y-6">
      {/* With the banner gone, the heading is what names the empire.
          The presence dot rides the sub-line beside the player's name, labelled:
          this is the one page you open *about* somebody, and whether he is at the
          keyboard decides whether the raid below finds a bank account or an empty
          treasury. */}
      <SectionHeading
        title={
          // The staff dossier is the one place a player lands after clicking a
          // shimmering name in chat, so the name has to still be shimmering
          // when they get here — otherwise the treatment reads as a chat badge
          // rather than as who this account is.
          staffTarget ? <span className="staff-name">{empire.name}</span> : empire.name
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span>{empire.user.name}</span>
            {/* The תואר, in its own ink. Cosmetic only — it multiplies nothing
                (see src/lib/game/titles.ts) — and it resolves to nothing at all
                for a key that has fallen out of the catalog, so retiring a
                title quietly clears it from every dossier. */}
            <WornTitle titleKey={empire.title} />
            {staffTarget && (
              <span className="shrink-0 rounded-full border border-gold/40 bg-gold/15 px-2 py-0.5 text-xs font-black text-gold-bright">
                {t("הנהלת המשחק")}
              </span>
            )}
            {/* The city used to ride here as a bare name after a middot —
                "דן · תדמור" — which reads as part of the player's name unless
                you already know the catalog. It is labelled and tiered now,
                because it is the fact that decides everything below it: the
                war actions are dead on a dossier from another city. */}
            <Tip
              className="shrink-0"
              tip={t("{city} — מתוך {max} ערים. {standing}", {
                city: cityFullName(t, empire.cities),
                max: MAX_CITIES,
                standing: isMe
                  ? t("זו העיר שלך.")
                  : sameCity
                    ? t("זו גם העיר שלך — ריגול ותקיפה פתוחים.")
                    : t("עיר אחרת משלך — אין ריגול ואין תקיפה, רק דואר."),
              })}
            >
              <span
                className={`cursor-help whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${
                  sameCity
                    ? "border-gold/40 bg-gold/10 text-gold"
                    : "border-border-subtle bg-panel-inset text-zinc-400"
                }`}
              >
                <Icon name="base" size={12} className="inline-block align-middle text-crimson-bright" />{" "}
                {t("עיר")}{" "}
                <span className="font-bold text-bone">{cityName(t, empire.cities)}</span>
              </span>
            </Tip>
            <PresenceDot online={online} label />
          </span>
        }
        ornament={<Icon name="crown" size={22} className="text-crimson" />}
      />

      {/* -------- the dossier proper, and the side column beside it --------
          The column is placed *after* the hero in the DOM and lands at the
          start of the flex line, which on this RTL screen is the left edge —
          the same order a phone reads top-down, hero first and the rest under
          it. It carries the two things about the *player* rather than about
          his army: the world records he holds, and then, under them, what he
          says about himself. The feud ledger stays out of this row and spans
          the page below: its table is four number columns wide and has nothing
          to gain from sharing the line with a 288px column. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="panel min-w-0 flex-1 rounded-xl p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
              <Icon name="attack" size={20} className="text-crimson-bright" />
              {t("הגיבור וציודו")}
            </h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-panel-inset px-2.5 py-0.5 text-xs font-bold text-gold">
              <Icon name="attack" size={14} /> {t("גיבור רמה")}{" "}
              <span className="nums" dir="ltr">
                {heroLevel}
              </span>
              {heroResets > 0 && (
                <span className="nums text-purple-300" dir="ltr">
                  ↻×{heroResets}
                </span>
              )}
            </span>
          </div>

          {/* Figure at the start edge, war actions filling the band beside it —
              the space the paperdoll's 320px cap leaves open on desktop. Below
              `lg` they stack, buttons under the hero. */}
          <div className="flex flex-wrap items-start gap-6">
            {/* The sockets carry a 54px floor, so a frame much under 240px is all
                medallion and no hero. Read-only: dressing him stays on the hero
                page. */}
            {/* Centred on your own dossier: there are no war actions to fill the
                band beside the figure, and a paperdoll pinned to the start edge
                of an otherwise empty panel is most of why this page read as
                half-drawn. */}
            {/* 16rem on a phone, same as the hero page's own figure: at 320px
                the 13/19 frame is 467px tall and the dossier under it starts
                below the fold. */}
            <div
              className={`mx-auto w-full max-w-[16rem] sm:max-w-[320px] ${
                isMe ? "" : "sm:mx-0"
              }`}
            >
              <HeroPaperdoll
                readOnly
                portrait={heroClassImage(heroClassKey)}
                portraitAlt={HERO_CLASS_META[heroClassKey].label}
                portraitAccent={HERO_CLASS_META[heroClassKey].accent}
                equipped={equippedView}
                heroLevel={heroLevel}
              />
              {equippedView.length === 0 && (
                <p className="mt-3 text-xs text-zinc-600">
                  {isMe
                    ? t(
                        "הגיבור שלך עדיין לא לובש ציוד — לכוד חפצים בתקיפות ולבש אותם בעמוד הגיבור."
                      )
                    : t("הגיבור הזה יוצא לקרב בלי ציוד — תשעת הסלוטים שלו ריקים.")}
                </p>
              )}
              {isMe && equippedView.length > 0 && (
                <Link
                  href="/game/hero"
                  className="mt-3 inline-block text-sm font-semibold text-gold hover:text-gold-bright"
                >
                  {t("ניהול הגיבור ←")}
                </Link>
              )}
            </div>

            {/* -------- war actions, on every dossier but your own --------
                Mail crosses cities and levels even where turns cannot, so the
                message button survives the `canEngage` gate that guards the rest. */}
            {!isMe && (
              <div className="min-w-[240px] flex-1 space-y-3">
                {/* Spelled out above the buttons, not just as a pill: turns spent
                    on a shielded target buy XP and loot rolls, but never spoils. */}
                {/* An ally is announced before anything else on the dossier —
                    it is the reason the attack button is dead. */}
                {allied && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold-bright">
                    <Icon name="guild" size={14} />
                    <span>
                      {t(
                        "בן ברית — שניכם חברים בברית {guild}. אין תקיפות בין חברי ברית",
                        { guild: allied.name }
                      )}
                      {canEngage ? t("ריגול ודואר עדיין פתוחים.") : "."}
                    </span>
                  </div>
                )}

                {canEngage && activeShields.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    <ShieldBadges shields={shields} />
                    <span>
                      {t(
                        "לאימפריה הזו {shields} — ניצחון עליה לא יניב {spoils}. התקיפה עצמה עדיין אפשרית (ניסיון, חפצים ושיקויים).",
                        {
                          shields: activeShields
                            .map((s) => t(s.label))
                            .join(t(" ו")),
                          spoils: activeShields
                            .map((s) => (s.key === "resources" ? t("שלל") : t("שבויים")))
                            .join(t(" או ")),
                        }
                      )}
                    </span>
                  </div>
                )}

                {/* What is bent in his favour right now, and for how much longer.
                    The strip counts itself down and refreshes the page when a
                    window closes, so the dossier never claims a dead buff. */}
                <div className="rounded-lg border border-border-subtle bg-panel-inset px-3 py-2">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                    <Icon name="potion" size={14} className="text-violet-300" />
                    {t("שיקויים פעילים")}
                  </p>
                  {potionsRunning ? (
                    <ActivePotions
                      activeUntil={potionActiveUntil}
                      serverNow={now.getTime()}
                      href={null}
                    />
                  ) : (
                    <p className="text-xs text-zinc-500">
                      {t("אין שיקוי פעיל — הוא נלחם בלי חיזוקים כרגע.")}
                    </p>
                  )}
                </div>

                {canEngage ? (
                  <>
                    <RankActions
                      targetEmpireId={empire.id}
                      currentTurns={myEmpire.turns}
                      attackBlockedReason={allied ? t("בן ברית — אין תקיפה") : null}
                      messageAction={
                        <MessageCompose
                          lockedRecipient={{ id: empire.id, name: empire.name }}
                          triggerLabel={t("הודעה")}
                          triggerClassName={`${RANK_ACTION_BUTTON_BASE} ${RANK_ACTION_MESSAGE_STYLE}`}
                        />
                      }
                    />
                    {/* The third verb. Allied empires keep the raid block but
                        not this one on purpose: a guild's own members can still
                        be scouted today, and sabotage sits on the same side of
                        that line — it is an espionage action, and the alliance
                        rule the game enforces is about armies. */}
                    <SabotagePanel
                      targetEmpireId={empire.id}
                      targetName={empire.name}
                      missions={sabotageOptions}
                    />
                  </>
                ) : staffTarget ? (
                  <p className="text-sm text-zinc-400">
                    {t(
                      "אין כאן פעולות מלחמה — האימפריה הזו שייכת להנהלת המשחק ואינה משתתפת בו: אי אפשר לתקוף אותה או לרגל אחריה, והיא אינה נספרת בשום טבלת מובילים. דואר, לעומת זאת, עובר: אפשר לכתוב להנהלה מכאן."
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-zinc-400">
                    {t(
                      "אין כאן פעולות מלחמה — האימפריה הזו יושבת בעיר אחרת. דואר, לעומת זאת, עובר בכל מצב: אפשר לכתוב לכל שחקן במשחק, בכל עיר ובכל רמה."
                    )}
                  </p>
                )}

                {/* When there is a war row the mail trigger lives inside it,
                    beside spying. Without one it is the only verb on the page,
                    so it stands on its own — same green skin either way. */}
                {!canEngage && (
                  <MessageCompose
                    lockedRecipient={{ id: empire.id, name: empire.name }}
                    triggerLabel={t("שלח הודעה")}
                    triggerClassName={`${RANK_ACTION_BUTTON_BASE} ${RANK_ACTION_MESSAGE_STYLE} sm:w-56`}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* The side column exists when either half has something to show: a
            visitor's dossier with no record and no blurb renders neither, and
            the hero panel takes the full width back. */}
        {(medals.length > 0 || isMe || empire.bio) && (
          <div className="w-full space-y-4 lg:w-[288px] lg:shrink-0">
            {medals.length > 0 && <EmpireMedals items={medals} isMe={isMe} />}
            <EmpireBio bio={empire.bio} isMe={isMe} />
          </div>
        )}
      </div>

      {/* -------- the ledger of the feud --------
          A rival's dossier used to end at his hero, which said nothing about
          the one thing that actually makes him *your* rival: what the two of
          you have taken off each other. Every raid ever launched in either
          direction, summed per resource, from your side of the field. */}
      {feud && (
        <div className="panel rounded-xl p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-base font-bold tracking-wide text-gold-bright">
              <Icon name="gold" size={20} className="text-gold-bright" />
              {t("מאזן הביזה ביניכם")}
            </h3>
            {lastClash && (
              <span className="text-xs text-zinc-500">
                {t("עימות אחרון: {when}", { when: formatDate(lastClash, locale) })}
              </span>
            )}
          </div>

          {!foughtBefore ? (
            <p className="text-sm text-zinc-400">
              {t("עוד לא נפגשתם בשדה הקרב — אף אחד מכם לא לקח מהשני דבר.")}
              {canEngage && ` ${t("התקיפה הראשונה פתוחה מכאן.")}`}
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="panel-inset rounded-lg p-3">
                  <p className="text-[11px] text-zinc-400">{t("תקפתי אותו")}</p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-400">
                    <span className="nums" dir="ltr">
                      {feud.mine.raids}
                    </span>{" "}
                    {t("תקיפות")} ·{" "}
                    <span className="nums" dir="ltr">
                      {feud.mine.wins}
                    </span>{" "}
                    {t("ניצחונות")}
                  </p>
                </div>
                <div className="panel-inset rounded-lg p-3">
                  <p className="text-[11px] text-zinc-400">{t("הוא תקף אותי")}</p>
                  <p className="mt-0.5 text-sm font-bold text-red-400">
                    <span className="nums" dir="ltr">
                      {feud.theirs.raids}
                    </span>{" "}
                    {t("תקיפות")} ·{" "}
                    <span className="nums" dir="ltr">
                      {feud.theirs.wins}
                    </span>{" "}
                    {t("ניצחונות")}
                  </p>
                </div>
              </div>

              {/* Four narrow number columns will not fold onto a phone, so the
                  table scrolls inside its own box rather than pushing the page
                  sideways. */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                      <th className="px-2 py-1.5 text-start font-bold">{t("משאב")}</th>
                      <th className="px-2 py-1.5 text-end font-bold">{t("לקחתי ממנו")}</th>
                      <th className="px-2 py-1.5 text-end font-bold">{t("לקח ממני")}</th>
                      <th className="px-2 py-1.5 text-end font-bold">{t("מאזן")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LOOT.map((res) => {
                      const took = feud.mine.loot[res.key];
                      const lost = feud.theirs.loot[res.key];
                      const net = took - lost;
                      return (
                        <tr key={res.key} className="border-t border-border-subtle">
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            <Icon
                              name={res.icon}
                              size={14}
                              className={`inline-block align-middle ${res.tone}`}
                            />{" "}
                            {t(res.label)}
                          </td>
                          {/* dir="ltr" belongs on the digits, not the cell: on
                              the cell it flips `text-end` to the physical right
                              while the RTL header above it ends on the left, and
                              the column and its title drift apart. */}
                          <td className="nums px-2 py-1.5 text-end font-bold text-emerald-400">
                            <span dir="ltr">
                              {took > 0 ? `+${formatNumber(took)}` : "—"}
                            </span>
                          </td>
                          <td className="nums px-2 py-1.5 text-end font-bold text-red-400">
                            <span dir="ltr">
                              {lost > 0 ? `−${formatNumber(lost)}` : "—"}
                            </span>
                          </td>
                          <td
                            className={`nums px-2 py-1.5 text-end font-black ${net > 0
                                ? "text-emerald-400"
                                : net < 0
                                  ? "text-red-400"
                                  : "text-zinc-500"
                              }`}
                          >
                            <span dir="ltr">
                              {net === 0
                                ? "0"
                                : `${net > 0 ? "+" : "−"}${formatNumber(Math.abs(net))}`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Captives are not a resource column, but they were taken in the
                  same raids and a player counts them the same way. */}
              {feud.mine.captives + feud.theirs.captives > 0 && (
                <p className="mt-3 text-xs text-zinc-400">
                  <Icon name="citizens" size={14} className="inline-block align-middle text-zinc-300" />{" "}
                  {t("שבויים: שביתי ממנו")}{" "}
                  <span className="nums font-bold text-emerald-400" dir="ltr">
                    {formatNumber(feud.mine.captives)}
                  </span>{" "}
                  · {t("הוא שבה ממני")}{" "}
                  <span className="nums font-bold text-red-400" dir="ltr">
                    {formatNumber(feud.theirs.captives)}
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
