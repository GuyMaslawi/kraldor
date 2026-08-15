import type { CSSProperties, ReactNode } from "react";

/**
 * Embers rising off the brazier: `[left %, delay s, duration s, drift px]`.
 * A fixed table, never `Math.random()` — the server and the first client render
 * have to agree on every one of these numbers.
 */
const EMBERS: [number, number, number, number][] = [
  [38, 0, 5.4, -14],
  [46, 1.7, 6.2, 9],
  [54, 3.1, 5.8, -7],
  [61, 0.9, 6.6, 13],
  [44, 4.3, 5.1, 16],
  [57, 2.4, 6.9, -11],
];

/**
 * The hall at the top of every guild view: war banners on the wall, a hearth
 * in the middle of the table and one pennant per seat the guild has bought.
 *
 * The seat row is the whole reason the scene is worth drawing — it is live
 * data, not decoration. A lit pennant is a member, a dark one is a vacancy,
 * and the brightest one is you. A player with no guild yet gets the same hall
 * cold and empty, so the recruiting screen never looks like a hall he already
 * owns.
 *
 * It lives out here rather than inside /game/guild because the dossier of
 * *another* guild draws the same hall — a rival's hall has to look like the
 * one you sit in, or the screen reads as a different kind of thing entirely.
 * A plain component with no hooks and no queries: both screens are server ones.
 */
export function GuildHall({
  seats,
  taken,
  mySeat,
  children,
}: {
  seats: number;
  taken: number;
  /** Index of the viewer's own seat, or -1 when the hall is not his. */
  mySeat: number;
  children: ReactNode;
}) {
  return (
    <div className={`panel-gold gd-hall rounded-2xl p-4${taken === 0 ? " is-empty" : ""}`}>
      <span className="gd-banner gd-banner-r" aria-hidden />
      <span className="gd-banner gd-banner-l" aria-hidden />
      <span className="gd-hearth" aria-hidden />
      {/* Sparks off the brazier — they only rise once someone is seated. */}
      {EMBERS.map(([left, delay, duration, drift], i) => (
        <span
          key={i}
          className="gd-ember"
          aria-hidden
          style={
            {
              left: `${left}%`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              "--drift": `${drift}px`,
            } as CSSProperties
          }
        />
      ))}

      <div className="gd-body text-center">
        {children}
        <div className="mt-3 flex items-end justify-center gap-1.5" aria-hidden>
          {Array.from({ length: seats }).map((_, i) => (
            <span
              key={i}
              className={`gd-seat${i < taken ? " is-taken" : ""}${
                i === mySeat ? " is-me" : ""
              }`}
              style={{ "--i": i } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
