"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { WornTitle } from "@/components/ui/WornTitle";
import { useAfterFirstPaint, useCountUp } from "@/components/ui/motion";
import { formatCompact } from "@/lib/game/format";
import { useT } from "@/i18n/client";
import type { GloryView } from "@/lib/game/achievements";

/**
 * שיאי העולם — the world-records board at the top of the base screen.
 *
 * Five capstones, each pinned to one of the game's real ceilings (all ten
 * cities, citizen intake maxed, hero at 100, mines at 250, every weapon model).
 * For every one it names the **first empire in the game** to reach it, and
 * shows the reader's own standing against it.
 *
 * These are decorations, not rewards: there is deliberately no collect button
 * anywhere on this board. A medal lights up because the condition is met, and
 * the wording follows — "הושג", never "אסוף". The reward ladder that *is*
 * collected lives on its own screen.
 *
 * The two readings are drawn in two different places on purpose: the record
 * holder is a line of text with a crown, the reader's own progress is the ring
 * around the medal and the bar under the name. So the board says "here is what
 * has been conquered, and here is how far you are" without either one having to
 * be read out of the other.
 *
 * Presentational: the server has already resolved progress, goals, earned state
 * and the record holder. The only thing this component decides is how it moves.
 *
 * Motion runs in three registers, loudest first — a capstone whose record the
 * reader *holds* breathes and throws sparks, one they have merely earned glows
 * quietly, and a locked one *fills* (ring and bar rise from empty on the first
 * paint, numbers roll) so progress reads as movement toward something. An
 * unreached record gets its own small pulse: it is the only state that is an
 * invitation rather than a result.
 */

/** Where the sparks sit around a crowned medal, in degrees + delay. */
const SPARKS = [
  { angle: -28, delay: "0s" },
  { angle: 96, delay: "0.9s" },
  { angle: 212, delay: "1.7s" },
];

function GloryCard({ item, index }: { item: GloryView; index: number }) {
  const t = useT();
  const painted = useAfterFirstPaint();
  const crowned = item.record?.isMe === true;
  const won = item.unlocked;
  const open = item.record === null;

  // Both the ring and the bar read this one number. Held at 0 until the first
  // frame has committed, so the fill animates in from empty instead of being
  // painted already full — see useAfterFirstPaint.
  const pct = item.goal > 0 ? Math.min(1, item.progress / item.goal) : 0;
  const fill = painted ? pct : 0;

  // The counter rolls to the live figure. A capstone already earned shows a
  // ribbon instead: it is pinned to full either way, and rolling "10 / 10" on a
  // medal earned weeks ago is noise.
  const rolled = useCountUp(won ? 0 : Math.round(item.progress));

  const state = crowned ? "is-crowned" : won ? "is-won" : "is-locked";

  return (
    <li
      className={`glory-card ${state} ${open ? "is-open" : ""}`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="glory-medal-wrap">
        <span
          className="glory-medal"
          style={{ "--glory-p": fill } as React.CSSProperties}
          aria-hidden
        >
          <span className="glory-medal-face">
            <Icon name={item.icon} size={30} />
          </span>
          {crowned &&
            SPARKS.map((s) => (
              <span
                key={s.angle}
                className="glory-spark"
                style={
                  { "--a": `${s.angle}deg`, "--d": s.delay } as React.CSSProperties
                }
              />
            ))}
        </span>
        {won && (
          <span className="glory-check" aria-hidden>
            <Icon name="crown" size={13} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="glory-name">{t(item.name, item.params)}</h3>
          {won ? (
            <span className="glory-ribbon">{crowned ? t("השיא שלך") : t("הושג")}</span>
          ) : (
            <span className="nums shrink-0 text-[11px] text-zinc-500" dir="ltr">
              {formatCompact(rolled)} / {formatCompact(item.goal)}
            </span>
          )}
        </div>
        <p className="glory-tagline">{t(item.tagline, item.params)}</p>

        {/* The reader's own progress. Stays on an earned card too — full and
            gold, it is the row of light that separates them from the rest. */}
        <span className="glory-bar" aria-hidden>
          <span style={{ transform: `scaleX(${fill})` }} />
        </span>

        {/* The record itself. An open one is named as open rather than left
            blank: "nobody has done this yet" is the most interesting thing the
            board can say, and a blank row says nothing at all. */}
        {item.record ? (
          <p className="glory-record">
            <Icon name="crown" size={12} className="shrink-0" />
            <span className="shrink-0 text-zinc-600">{t("ראשון בעולם:")}</span>
            <Link
              href={`/game/empires/${item.record.empireId}`}
              className="glory-holder"
            >
              {item.record.empireName}
            </Link>
            {/* Seven rows in the whole case, each naming the first player in the
                world to do a thing. If a תואר is worth showing anywhere, it is
                on the line that already says "ראשון בעולם". */}
            <WornTitle titleKey={item.record.title} />
            <span className="nums mr-auto shrink-0 text-zinc-600" dir="ltr">
              {item.record.awardedLabel}
            </span>
          </p>
        ) : (
          <p className="glory-record is-open">
            <Icon name="spark" size={12} className="shrink-0" />
            {t("השיא עדיין פנוי — אף אחד לא הגיע לכאן")}
          </p>
        )}
      </div>
    </li>
  );
}

export function HallOfGlory({
  items,
  daysOnServer,
}: {
  items: GloryView[];
  daysOnServer: number;
}) {
  const t = useT();
  const taken = items.filter((i) => i.record !== null).length;
  const mine = items.filter((i) => i.record?.isMe).length;
  const rolledTaken = useCountUp(taken, 1100);

  return (
    <div className={`glory-board ${taken > 0 ? "is-lit" : ""}`}>
      <div className="glory-head">
        <div className="min-w-0">
          <h2 className="glory-title">
            <Icon name="achievements" size={20} className="text-gold-bright" />
            {t("שיאי העולם")}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {t("שיאי המשחק ומי כבש אותם ראשון — מכל השחקנים בעולם")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <div className="text-center">
            <p className="nums text-2xl font-black text-gold-bright" dir="ltr">
              {rolledTaken}
              <span className="text-base text-gold-dim">/{items.length}</span>
            </p>
            <p className="text-[10px] text-zinc-500">{t("שיאים שנכבשו")}</p>
          </div>
          <div className="text-center">
            <p className="nums text-2xl font-black text-gold" dir="ltr">
              {mine}
            </p>
            <p className="text-[10px] text-zinc-500">{t("על שמך")}</p>
          </div>
          <div className="text-center">
            <p className="nums text-2xl font-black text-bone-dim" dir="ltr">
              {daysOnServer}
            </p>
            <p className="text-[10px] text-zinc-500">{t("ימי שרת")}</p>
          </div>
        </div>
      </div>

      <ul className="glory-grid">
        {items.map((item, i) => (
          <GloryCard key={item.key} item={item} index={i} />
        ))}
      </ul>
    </div>
  );
}
