"use client";

import { useActionState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNumber } from "@/lib/game/format";
import { TITLE_PARAMS, type TitleView, type TitlesState } from "@/lib/game/titles";
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
        blurb={t("אי אפשר לקנות אותם בשום מחיר. זה בדיוק מה שנותן להם ערך.")}
        titles={earned}
      />

      <Shelf
        title={t("חנות התארים")}
        blurb={t("נרכשים ביהלומים, ואינם מתיימרים להיות הישג. מי שקורא את הדירוג יידע להבדיל.")}
        titles={bought}
        diamonds={state.diamonds}
      />
    </div>
  );
}

function Shelf({
  title,
  blurb,
  titles,
  diamonds,
}: {
  title: string;
  blurb: string;
  titles: TitleView[];
  /** Present only on the shop shelf. */
  diamonds?: number;
}) {
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-black tracking-wide text-gold-bright">
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
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{blurb}</p>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {titles.map((entry) => (
          <TitleCard key={entry.key} entry={entry} diamonds={diamonds} />
        ))}
      </ul>
    </section>
  );
}

function TitleCard({
  entry,
  diamonds,
}: {
  entry: TitleView;
  diamonds?: number;
}) {
  const t = useT();
  const [buyState, buyAction, buying] = useActionState<
    { error?: string; success?: string },
    FormData
  >(buyTitle, {});

  const forSale = entry.kind === "bought" && !entry.owned;
  const affordable = diamonds != null && diamonds >= entry.price;

  return (
    <li
      style={{ "--accent": entry.accent } as CSSProperties}
      className={`title-card rounded-xl border p-3 ${
        entry.worn
          ? "title-card-worn"
          : entry.unlocked
            ? "border-border-subtle bg-black/25"
            : "border-border-subtle bg-black/10 opacity-60"
      }`}
    >
      {/* Drawn with the same two data-attributes the title carries beside a name
          (see WornTitle.tsx), so the card is a true preview: what a player picks
          off this shelf is exactly what the rankings will show. */}
      <p className="title-name font-black" data-kind={entry.kind}>
        {t(entry.label)}
        {entry.rare && (
          <span
            className="title-worn-inline ms-2 align-middle text-[10px]"
            data-kind="earned"
            data-rare="1"
          >
            {t("נדיר")}
          </span>
        )}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        {t(entry.hint, TITLE_PARAMS)}
      </p>

      <div className="mt-2.5">
        {forSale ? (
          <form action={buyAction}>
            <input type="hidden" name="key" value={entry.key} />
            <button
              type="submit"
              disabled={buying || !affordable}
              className="btn btn-gold flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
            >
              <Icon name="diamond" size={12} />
              <span className="nums">{entry.price}</span>
            </button>
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
