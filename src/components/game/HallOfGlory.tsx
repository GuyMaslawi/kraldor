"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { WornTitle } from "@/components/ui/WornTitle";
import { useAfterFirstPaint, useCountUp } from "@/components/ui/motion";
import { formatCompact } from "@/lib/game/format";
import { useT } from "@/i18n/client";
import type { GloryView } from "@/lib/game/achievements";

/**
 * שיאי העולם — the world-records hall at the top of the base screen.
 *
 * Five capstones, each pinned to one of the game's real ceilings (all ten
 * cities, citizen intake maxed, hero at 100, mines at 250, every weapon model).
 * For every one it names the **first empire in the game** to reach it, and
 * shows the reader's own standing against it.
 *
 * These are decorations, not rewards: there is deliberately no collect button
 * anywhere on this board. A niche lights up because the condition is met, and
 * the wording follows — never "אסוף". The reward ladder that *is* collected
 * lives on its own screen.
 *
 * ## It is a room, not a list
 *
 * Each capstone is an **arched alcove cut into the wall**: a relic lit by a
 * shaft of light, the ceiling itself engraved under it as a figure and a noun
 * (10 ערים, 250 רמת מכרה), and a plaque bolted underneath naming whoever got
 * there first. That is the whole card — the sentence version of the goal and
 * the mechanic behind it live in the hover caption and are read out to screen
 * readers, but they are not on the wall. Five taglines, five names, five
 * progress fractions and five record lines was a page of prose where the
 * subject is five numbers.
 *
 * ## Three readings, three places, no overlap
 *
 * - **The world**: who holds the record — the plaque, and only the plaque. An
 *   unheld record leaves the plaque unengraved rather than blank, because
 *   "nobody has done this yet" is the most interesting thing the hall can say.
 * - **The reader**: their own progress — the gold light rising inside the
 *   alcove to `--glory-p` of its height, plus one small fraction at the floor.
 *   Never written out anywhere else.
 * - **The ceiling itself**: the engraved figure, which is the same for everyone
 *   and never moves.
 *
 * Presentational: the server has already resolved progress, goals, earned state
 * and the record holder. The only thing this component decides is how it moves.
 *
 * Motion runs in three registers, loudest first — an alcove whose record the
 * reader *holds* wears a crown at the keystone, breathes and throws sparks; one
 * they have merely earned holds a lit relic; and an unreached one *fills* (the
 * tide and the counter rise from empty on the first paint) so progress reads as
 * movement toward something. An unclaimed plaque gets its own small pulse: it
 * is the only state that is an invitation rather than a result.
 */

/** Where the sparks sit around a crowned relic, in degrees + delay. */
const SPARKS = [
  { angle: -28, delay: "0s" },
  { angle: 96, delay: "0.9s" },
  { angle: 212, delay: "1.7s" },
];

function GloryNiche({ item, index }: { item: GloryView; index: number }) {
  const t = useT();
  const painted = useAfterFirstPaint();
  const crowned = item.record?.isMe === true;
  const won = item.unlocked;
  const open = item.record === null;

  // The tide and the counter read this one number. Held at 0 until the first
  // frame has committed, so the alcove fills from empty instead of being
  // painted full — see useAfterFirstPaint.
  const pct = item.goal > 0 ? Math.min(1, item.progress / item.goal) : 0;
  const fill = painted ? pct : 0;

  // The counter rolls to the live figure. A capstone already earned shows a
  // check instead: it is pinned to full either way, and rolling "10 / 10" on a
  // ceiling reached weeks ago is noise.
  const rolled = useCountUp(won ? 0 : Math.round(item.progress));

  return (
    <li
      className={`glory-niche ${crowned ? "is-crowned" : ""} ${
        won ? "is-won" : ""
      } ${open ? "is-open" : ""} ${pct <= 0 ? "is-dry" : ""}`}
      style={{ "--i": index, "--glory-p": fill } as React.CSSProperties}
    >
      {/* The keystone at the apex of the arch — a plain lozenge, or the crown
          itself once the reader's own name is on the plaque below. */}
      <span
        className={`glory-keystone ${crowned ? "is-crowned" : ""}`}
        aria-hidden
      >
        {crowned && <Icon name="crown" size={11} />}
      </span>

      <div className="glory-arch">
        <span className="glory-beam" aria-hidden />
        <span className="glory-tide" aria-hidden />

        <span className="glory-relic" aria-hidden>
          <Icon name={item.icon} size={30} />
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

        {/* The ceiling, engraved. The number is never written in a dictionary —
            it is the goal itself, so retuning one moves the engraving with it. */}
        <p className="glory-figure nums" dir="ltr">
          {formatCompact(item.goal)}
        </p>
        <p className="glory-unit">{t(item.unit)}</p>

        {/* The reader's own standing, small, at the floor of the alcove. */}
        <span className="glory-tally" dir="ltr">
          {won ? (
            <span className="glory-done" aria-label={t("הושג")}>
              <Icon name="check" size={11} />
            </span>
          ) : (
            <span className="nums">
              {formatCompact(rolled)} / {formatCompact(item.goal)}
            </span>
          )}
        </span>

        {/* The sentence version, kept off the wall: revealed on hover or when
            the plaque's link takes focus, and always present for a reader who
            is listening rather than looking. */}
        <span className="glory-caption">
          <strong>{t(item.name, item.params)}</strong>
          <span>{t(item.tagline, item.params)}</span>
          {item.record && (
            <span className="nums glory-caption-date" dir="ltr">
              {item.record.awardedLabel}
            </span>
          )}
        </span>
      </div>

      {/* The plaque: the world's half of the reading, and the only place a
          record holder is named. */}
      <div className="glory-plaque">
        {item.record ? (
          <>
            {/* No crown beside the name, deliberately: every engraved plaque in
                the hall is a world record, so the mark would be on all of them
                — and at the narrow end of the hall it was the icon and its gap
                that pushed a perfectly short name onto a second line. The crown
                is reserved for the keystone, where it means "yours". */}
            <Link
              href={`/game/empires/${item.record.empireId}`}
              className="glory-holder"
            >
              {item.record.empireName}
            </Link>
            {/* Five plaques in the whole hall, each naming the first player in
                the world to do a thing. If a תואר is worth showing anywhere, it
                is here. */}
            <WornTitle titleKey={item.record.title} className="glory-worn" />
          </>
        ) : (
          <span className="glory-vacant">
            <Icon name="spark" size={11} className="shrink-0" />
            {t("עדיין פנוי")}
          </span>
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
        <h2 className="glory-title">
          <span className="glory-rule" aria-hidden />
          <span>{t("שיאי העולם")}</span>
          <span className="glory-rule" aria-hidden />
        </h2>
        <p className="glory-sub">
          {t("שיאי המשחק ומי כבש אותם ראשון — מכל השחקנים בעולם")}
        </p>
        <div className="glory-tallies">
          <span className="glory-count">
            <b className="nums" dir="ltr">
              {rolledTaken}
              <i>/{items.length}</i>
            </b>
            {t("שיאים שנכבשו")}
          </span>
          <span className="glory-count">
            <b className="nums" dir="ltr">
              {mine}
            </b>
            {t("על שמך")}
          </span>
          <span className="glory-count">
            <b className="nums" dir="ltr">
              {daysOnServer}
            </b>
            {t("ימי שרת")}
          </span>
        </div>
      </div>

      <ul className="glory-hall">
        {items.map((item, i) => (
          <GloryNiche key={item.key} item={item} index={i} />
        ))}
      </ul>
    </div>
  );
}
