"use client";

import { useActionState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNumber } from "@/lib/game/format";
import {
  TIER_BLURB,
  TIER_LABEL,
  TITLE_PARAMS,
  TITLE_TIERS,
  type TitleTier,
  type TitleView,
  type TitlesState,
} from "@/lib/game/titles";
import { buyTitle, wearTitle } from "@/server/actions/titles";
import { useT } from "@/i18n/client";

/**
 * /game/titles — the two shelves.
 *
 * Earned and bought are drawn as separate sections rather than one filtered
 * grid, and that separation is the feature's whole integrity: a player reading
 * somebody else's dossier has to be able to tell at a glance whether the word
 * under their name was won or paid for. Mixing them on one shelf here would
 * teach exactly the opposite.
 */
export function TitleBoard({ state }: { state: TitlesState }) {
  const t = useT();
  const earned = state.titles.filter((x) => x.kind === "earned");
  const bought = state.titles.filter((x) => x.kind === "bought");

  return (
    <div className="space-y-6">
      <section className="panel-gold rounded-2xl p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-base font-black tracking-wide text-gold-bright">
          <Icon name="laurel" size={20} className="text-crimson-bright" />
          {t("התואר שלך")}
        </h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
          {t("התואר מופיע לצד שמך בכל מקום שבו משווים בין שחקנים: בתיק השחקן, בסולם העיר ובטבלאות המובילים, ברשימת חברי הברית, בזירה, בלוח המלחמה, בפודיום העונה ובשיאי העולם. הוא לא מוסיף כוח, לא משאבים ולא הגנה — הוא רק שלך.")}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <WearForm titleKey="" label={t("ללא תואר")} active={state.worn === null} />
          <span className="text-xs text-zinc-500">
            {t("הושגו {earned} · נרכשו {owned}", {
              earned: state.earnedCount,
              owned: state.ownedCount,
            })}
          </span>
        </div>
      </section>

      <Shelf
        title={t("תארים שמושגים במשחק")}
        blurb={t(
          "אי אפשר לקנות אותם בשום מחיר — רק לשחק ולהשיג. הם מסודרים לפי דרגת קושי: ככל שהדרגה גבוהה יותר, כך קשה יותר להשיג את התואר."
        )}
      >
        {/* Split by tier rather than shown as one grid with a badge on each
            card. The tier is a promise that the requirements get harder as you
            go down the shelf, and a reader only believes that promise if the
            easy ones are physically above the hard ones. */}
        {TITLE_TIERS.map((tier) => {
          const group = earned.filter((entry) => entry.tier === tier);
          if (group.length === 0) return null;
          return (
            <div key={tier} className="mt-4 first:mt-3">
              <p className="flex flex-wrap items-baseline gap-2">
                <TierBadge tier={tier} />
                <span className="text-[11px] text-zinc-500">
                  {t(TIER_BLURB[tier])}
                </span>
              </p>
              <TitleGrid titles={group} />
            </div>
          );
        })}
      </Shelf>

      <Shelf
        title={t("חנות התארים")}
        blurb={t("נרכשים ביהלומים, ואינם מתיימרים להיות הישג. מי שקורא את הדירוג יידע להבדיל.")}
        diamonds={state.diamonds}
        shop
      >
        <TitleGrid titles={bought} diamonds={state.diamonds} shop />
      </Shelf>
    </div>
  );
}

/**
 * Where the dust hangs in the shop case — `left top` pairs plus the delay and
 * period of each speck. Fixed rather than random so the shelf renders the same
 * on the server and on the client, and spread across the whole box so the eye
 * catches one wherever it happens to be resting.
 */
const SHOP_DUST: readonly { x: string; y: string; d: string; dur: string }[] = [
  { x: "8%", y: "22%", d: "0s", dur: "5.2s" },
  { x: "26%", y: "68%", d: "1.4s", dur: "6.1s" },
  { x: "47%", y: "14%", d: "2.6s", dur: "4.8s" },
  { x: "63%", y: "82%", d: "0.7s", dur: "5.9s" },
  { x: "81%", y: "36%", d: "3.3s", dur: "5.1s" },
  { x: "93%", y: "74%", d: "2.0s", dur: "6.4s" },
];

function Shelf({
  title,
  blurb,
  diamonds,
  shop = false,
  children,
}: {
  title: string;
  blurb: string;
  /** Present only on the shop shelf. */
  diamonds?: number;
  /**
   * The shop shelf is dressed as a lit display case — see `.title-shop` in
   * globals.css for why only this one shelf is allowed to shine. The earned
   * shelf stays plain on purpose: its titles sell themselves by being hard.
   */
  shop?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`panel rounded-2xl p-4 sm:p-5 ${shop ? "title-shop" : ""}`}>
      {shop && (
        <span className="title-dust" aria-hidden="true">
          {SHOP_DUST.map((speck, i) => (
            <span
              key={i}
              style={
                {
                  "--x": speck.x,
                  "--y": speck.y,
                  "--d": speck.d,
                  "--dur": speck.dur,
                } as CSSProperties
              }
            />
          ))}
        </span>
      )}
      <h3 className="relative flex flex-wrap items-center gap-2 text-base font-black tracking-wide text-gold-bright">
        {shop && <Icon name="diamond" size={18} className="text-cyan-300" />}
        {title}
        {diamonds != null && (
          <span
            className="nums flex items-center gap-1 rounded-full border border-cyan-400/40 bg-black/30 px-2.5 py-0.5 text-xs font-bold text-cyan-300"
            dir="ltr"
          >
            {formatNumber(Math.floor(diamonds))}
            <Icon name="diamond" size={12} />
          </span>
        )}
      </h3>
      <p className="relative mt-1 text-xs leading-relaxed text-zinc-400">{blurb}</p>
      {children}
    </section>
  );
}

function TitleGrid({
  titles,
  diamonds,
  shop = false,
}: {
  titles: TitleView[];
  diamonds?: number;
  shop?: boolean;
}) {
  return (
    <ul className="relative mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {titles.map((entry, i) => (
        <TitleCard
          key={entry.key}
          entry={entry}
          diamonds={diamonds}
          shop={shop}
          index={i}
        />
      ))}
    </ul>
  );
}

/** The one word that says how hard a shelf — or a single card — is. */
const TIER_CHIP: Record<TitleTier, string> = {
  common: "border-zinc-600/60 bg-black/30 text-zinc-300",
  rare: "border-sky-400/50 bg-sky-500/10 text-sky-300",
  legendary: "border-amber-400/60 bg-amber-500/10 text-amber-300",
};

function TierBadge({ tier }: { tier: TitleTier }) {
  const t = useT();
  return (
    <span
      // The glow is killed explicitly: text-shadow inherits, and the badge sits
      // *inside* `.title-name`, which is either glowing or breathing.
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-black [text-shadow:none] ${TIER_CHIP[tier]}`}
    >
      {t(TIER_LABEL[tier])}
    </span>
  );
}

function TitleCard({
  entry,
  diamonds,
  shop = false,
  index = 0,
}: {
  entry: TitleView;
  diamonds?: number;
  shop?: boolean;
  /** Only used to stagger the glitter — six cards twinkling on one beat reads
      as a strobe, on six beats it reads as a case full of jewels. */
  index?: number;
}) {
  const t = useT();
  const [buyState, buyAction, buying] = useActionState<
    { error?: string; success?: string },
    FormData
  >(buyTitle, {});

  const forSale = entry.kind === "bought" && !entry.owned;
  const affordable = diamonds != null && diamonds >= entry.price;
  const missing = diamonds != null ? entry.price - Math.floor(diamonds) : 0;

  return (
    <li
      style={
        { "--accent": entry.accent, "--i": index } as CSSProperties
      }
      className={`title-card rounded-xl border p-3 ${
        entry.worn
          ? "title-card-worn"
          : forSale
            ? "title-card-sale"
            : entry.unlocked
              ? "border-border-subtle bg-black/25"
              : "border-border-subtle bg-black/10 opacity-60"
      }`}
    >
      {/* The glitter only ever goes on something that is still for sale. On a
          title already bought it would be advertising to a customer who has
          already paid, and on the earned shelf it would be selling something
          that is not for sale at all. */}
      {shop && forSale && (
        <span aria-hidden="true">
          <span className="title-spark title-spark-a" />
          <span className="title-spark title-spark-b" />
          <span className="title-spark title-spark-c" />
        </span>
      )}
      {/* Drawn with the same two data-attributes the title carries beside a name
          (see WornTitle.tsx), so the card is a true preview: what a player picks
          off this shelf is exactly what the rankings will show — including the
          אגדי breath. */}
      <p
        className="title-name flex flex-wrap items-baseline gap-2 font-black"
        data-kind={entry.kind}
        data-tier={entry.tier ?? undefined}
      >
        {t(entry.label)}
        {/* Repeated on the card even though the group above already says it:
            a card is what gets looked at once a player is choosing between two
            of them, and the heading has scrolled away by then. */}
        {entry.tier && <TierBadge tier={entry.tier} />}
      </p>
      {/* The flavour where there is one — a bought title's `hint` reads "נקנה
          בחנות התארים", which on this shelf tells the reader where they already
          are. See TitleDefinition.flavor. */}
      <p
        className={`relative mt-0.5 text-[11px] leading-relaxed ${
          entry.flavor ? "text-zinc-400" : "text-zinc-500"
        }`}
      >
        {t(entry.flavor ?? entry.hint, TITLE_PARAMS)}
      </p>

      <div className="mt-2.5">
        {forSale ? (
          <form action={buyAction}>
            <input type="hidden" name="key" value={entry.key} />
            <button
              type="submit"
              disabled={buying || !affordable}
              className="btn btn-gold title-buy flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
            >
              <span>{t("קנה")}</span>
              <span className="nums">{entry.price}</span>
              <Icon name="diamond" size={12} />
            </button>
            {/* The one thing that actually stops a sale, answered on the card
                rather than leaving the player to work out the shortfall from a
                balance chip at the top of the shelf. */}
            {!affordable && missing > 0 && (
              <p className="mt-1.5 text-[11px] text-zinc-400">
                {t("יש לך")}{" "}
                <span className="nums">{Math.floor(diamonds ?? 0)}</span>{" "}
                {t("יהלומים — חסרים")} <span className="nums">{missing}</span>.{" "}
                <Link
                  href="/game/diamonds/buy"
                  className="whitespace-nowrap font-bold text-cyan-300 underline decoration-dotted underline-offset-2"
                >
                  {t("לרכישת יהלומים")}
                </Link>
              </p>
            )}
          </form>
        ) : entry.worn ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
            <Icon name="check" size={14} />
            {t("ענוד")}
          </span>
        ) : entry.unlocked ? (
          <WearForm titleKey={entry.key} label={t("ענוד")} active={false} />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-600">
            <Icon name="lock" size={13} />
            {t("נעול")}
          </span>
        )}
      </div>

      {(buyState.error || buyState.success) && (
        <div className="mt-2">
          <FormMessage error={buyState.error} success={buyState.success} />
        </div>
      )}
    </li>
  );
}

/**
 * The "put it on" control. Also serves "take it off" with an empty key, which
 * is why it is its own component rather than inlined into the card — the header
 * needs exactly the same form with nothing in it.
 */
function WearForm({
  titleKey,
  label,
  active,
}: {
  titleKey: string;
  label: string;
  active: boolean;
}) {
  const t = useT();
  const [state, action, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(wearTitle, {});

  return (
    <span className="inline-block">
      <form action={action}>
        <input type="hidden" name="key" value={titleKey} />
        <button
          type="submit"
          disabled={pending || active}
          className={`btn px-3 py-1.5 text-xs disabled:opacity-60 ${
            active ? "btn-gold" : "btn-ghost"
          }`}
        >
          {pending ? t("עונד…") : label}
        </button>
      </form>
      {(state.error || state.success) && (
        <span className="mt-2 block">
          <FormMessage error={state.error} success={state.success} />
        </span>
      )}
    </span>
  );
}
