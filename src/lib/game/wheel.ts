// i18n-keys-file: a data module — every Hebrew string in it is a dictionary
// key, rendered through t() by whoever reads it. Nothing here renders, so a
// literal below is finished work, not a missed one. Verified by --keyless:
// a declared key the English dictionary does not hold is reported, not excused.

import type { GameSeason } from "@prisma/client";
import type { IconName } from "@/components/ui/Icon";
import { dailyUpdatesBetween } from "./time";
import { secureRandom } from "./random";

/**
 * Wheel-of-fortune prize table.
 *
 * Every `amount` prize is defined by three things — where it opens on the
 * season's first update, where it lands on the season's **last** one, and the
 * shape of the curve between them. Nothing else: there is no per-update step, no
 * doubling period and no ceiling to bump into, because the two endpoints and the
 * season's own length already determine the whole ladder.
 *
 * That is a deliberate replacement for the ladder this file used to hold, which
 * doubled the resource wedges once a day and clamped them at a cap. It produced
 * two artefacts a player could see: a payout that *tripled overnight* in the last
 * week (2.6B → 5.2B in one update), and a flat plateau for the final third of the
 * season where the wheel stopped growing at all. Interpolating instead spreads
 * the same start and the same finish evenly over every update in between — the
 * wheel gets a little better twice a day, every day, right up to the closing bell.
 *
 * The two curves:
 *
 * - `"geometric"` — the four resources, which multiply by a constant factor each
 *   update. Resource income in this game is itself multiplicative (mines × slaves
 *   × cities), so a linear wheel would be enormous on day 2 and pocket change on
 *   day 30. Over a 30-day season the factor works out at about ×1.31 an update,
 *   i.e. ×1.72 a day.
 * - `"linear"` — diamonds and citizens, which add a constant amount each update.
 *   These are the scarce currencies: diamonds price the real-money store and
 *   citizens convert straight into army, so neither may compound. They no longer
 *   share one ladder and pay the identical number — an end-of-season citizen
 *   wedge has to be worth a city's intake, while a diamond wedge must never
 *   approach a store pack.
 *
 * Because the curve is pinned to the season's own length, *any* season — 10 days
 * or 90 — opens on the base and closes on the final amount. A short season simply
 * climbs faster. The one unit prize (a hero item) is always a single rolled grant.
 */

/** Payout of every resource wedge — gold, iron, stone and wood alike — on day 1. */
export const WHEEL_RESOURCE_BASE = 5000;

/**
 * What a single resource wedge pays on the season's final daily update. The
 * largest single payout in the game, and deliberately so: it is the last spin of
 * a season no one carries anything out of.
 */
export const WHEEL_RESOURCE_FINAL = 50_000_000_000;

/**
 * The diamond wedge, first update to last.
 *
 * The finish was 150 until 2026-08-15, and the audit that moved it counted the
 * *spins* rather than the wedge. A wedge is 1/{@link WHEEL_PRIZES}.length, so the
 * only figure that matters is diamonds-per-spin × spins-per-day, and the spin
 * supply had quietly grown well past what this number was set against: three from
 * the daily update, five a night to every member of the winning guild, forty a
 * week from the world boss, plus the streak and the weekly mission. That is ~9.5
 * spins a day for a player in a top guild, which at 150 was 204💎 a day at the end
 * of a season — about ₪3.3 a day of store value handed out free, against a
 * DIAMOND_PACKAGES entry price of 650💎 for ₪19.9.
 *
 * **70 rather than the 60 the retune asked for, and the floor is arithmetic.**
 * This wedge is `growth: "linear"` at `step: 1`, and the suite holds an invariant
 * that every daily update pays strictly more than the one before it — no jump and
 * no plateau. Over a 61-update season that needs at least sixty integer steps
 * between base and final, so anything under 69 makes the wedge pay the same
 * figure two days running: at 60 the curve stalls nine separate times. 70 is the
 * lowest finish that still climbs every single day, and the ~15% it costs against
 * the intended 60 is far less than what the same retune took back by cutting the
 * spin supply. Move BASE down before pushing FINAL under 70.
 *
 * With the spin supply cut alongside it (guild war 5 → 1 a night), a member of
 * the winning guild now draws ~5.5 spins a day: ~64💎 a day at the season's
 * finish against the 204 measured before this pass, and ~52 for a player in no
 * guild at all. The base is left at 9 — the opening of a season was never the
 * problem, the slope was.
 */
export const WHEEL_DIAMOND_BASE = 9;
export const WHEEL_DIAMOND_FINAL = 70;

/**
 * The citizen wedge, first update to last. Ten times the diamond finish because
 * citizens are spent by the thousand and are worthless outside the season they
 * are won in.
 */
export const WHEEL_CITIZEN_BASE = 10;
export const WHEEL_CITIZEN_FINAL = 500;

/**
 * Spins granted on each daily update. Spins bank without limit — there is
 * deliberately no cap, so time away is never wasted. The live value is the
 * admin tunable `daily.wheelSpins` (see lib/game/config.ts); this is the
 * reference default.
 */
export const WHEEL_DAILY_SPINS = 3;

export type WheelPrizeKind = "amount" | "unit";

/** Which curve an `amount` prize follows from `base` to `final` — see the header. */
export type WheelGrowth = "geometric" | "linear";

export interface WheelPrizeDef {
  key: string;
  label: string;
  /** Shared icon-set name — resource wedges resolve through `RESOURCE_ICON`. */
  icon: IconName;
  /**
   * Accent tint for this wedge. The wheel face is obsidian across the board —
   * this colour is only mixed into the outer band of the wedge and into its
   * icon glow, which is what keeps seven wedges legible without the wheel
   * turning into a pie chart of saturated primaries.
   */
  color: string;
  kind: WheelPrizeKind;
  /** Amount on the season's first daily update; ignored for unit prizes. */
  base: number;
  /** Amount on the season's last daily update; ignored for unit prizes. */
  final?: number;
  /** Curve between `base` and `final`; ignored for unit prizes. */
  growth?: WheelGrowth;
  /**
   * Granularity the interpolated amount is rounded to. Resources round to three
   * significant figures instead (see `wheelPrizeAmount`) — this is their floor,
   * and the exact quantum for the two counted prizes.
   */
  step: number;
  /** Extra requirement text shown in the wheel modal, if any. */
  note?: string;
}

/**
 * 6 wedges (360/6° each), going clockwise from the top pointer. Everything that
 * draws or rolls the wheel derives its geometry and its odds from this array's
 * length, so adding or removing a wedge is a one-line change here.
 *
 * Deliberately only resources, diamonds and citizens: army weapons are earned in
 * the factory, never handed out here, and there is no mixed "loot" pack — it paid
 * the same four resources the plain wedges do, so it only added a wedge the
 * player had to decode. Each wedge carries the tint its resource wears everywhere
 * else in the game (gold amber, iron steel, stone grey, wood umber, diamonds
 * ice).
 *
 * ## The hero-item wedge, removed 2026-08-15
 *
 * There was a seventh wedge that paid a rolled hero item, and it was the game's
 * third source of gear without ever being counted as one. Gear is meant to come
 * from won attacks (ITEM_DROP_CHANCE, 19% of a *winning* attack) and from the
 * hero shop — both of which cost turns and risk an army. A wedge is a flat
 * 1-in-N, so at seven wedges it dropped 14.3% of *every* spin, no fight required;
 * at ~9.5 spins a day for a member of the winning guild that was 1.36 items a
 * day, the equivalent of seven winning attacks, won by pressing a button. The
 * bag filled itself faster than the battlefield could fill it, which made the
 * one source that is supposed to reward fighting the slow one.
 *
 * Removing it also deletes the wedge's whole tail of special cases — it was the
 * only `"unit"` prize, the only one that could fail (a full bag or no hero) and
 * therefore the only one needing a gold consolation and a hero-row lock against
 * two concurrent spins overflowing HERO_BAG_CAPACITY. `WheelPrizeKind` keeps its
 * `"unit"` arm on purpose: it costs nothing and the next non-amount prize will
 * want it.
 */
export const WHEEL_PRIZES: WheelPrizeDef[] = [
  { key: "diamonds", label: "יהלומים", icon: "diamond", color: "#7ad7e8", kind: "amount", base: WHEEL_DIAMOND_BASE, final: WHEEL_DIAMOND_FINAL, growth: "linear", step: 1 },
  { key: "gold", label: "זהב", icon: "gold", color: "#e4c35a", kind: "amount", base: WHEEL_RESOURCE_BASE, final: WHEEL_RESOURCE_FINAL, growth: "geometric", step: 50 },
  { key: "iron", label: "ברזל", icon: "iron", color: "#a9b6c6", kind: "amount", base: WHEEL_RESOURCE_BASE, final: WHEEL_RESOURCE_FINAL, growth: "geometric", step: 50 },
  { key: "stone", label: "אבן", icon: "stone", color: "#8e8a80", kind: "amount", base: WHEEL_RESOURCE_BASE, final: WHEEL_RESOURCE_FINAL, growth: "geometric", step: 50 },
  { key: "wood", label: "עץ", icon: "wood", color: "#b0793c", kind: "amount", base: WHEEL_RESOURCE_BASE, final: WHEEL_RESOURCE_FINAL, growth: "geometric", step: 50 },
  { key: "citizens", label: "אזרחים", icon: "citizens", color: "#d8c9a6", kind: "amount", base: WHEEL_CITIZEN_BASE, final: WHEEL_CITIZEN_FINAL, growth: "linear", step: 1 },
];

/** A concrete quantity actually granted by a spin, in the prize's own unit. */
export interface WheelGrant {
  /** A `WHEEL_PRIZES` key — the display icon/label is resolved from that def. */
  key: string;
  amount: number;
}

const PRIZE_BY_KEY: Record<string, WheelPrizeDef> = Object.fromEntries(
  WHEEL_PRIZES.map((p) => [p.key, p])
);

/** Resolve the prize definition (icon/label/kind) behind a grant's key. */
export function wheelPrizeByKey(key: string): WheelPrizeDef | undefined {
  return PRIZE_BY_KEY[key];
}

/**
 * The wheel's growth clock: which daily-update cycle the season is on, and how
 * many it holds in total. Both 1-based, so a season that has only just opened
 * reads `{ cycle: 1, total: 61 }` on a 30-day season.
 *
 * DAILY_UPDATE_TIMES fires twice a day, so cycle 1 is the season's opening,
 * cycle 2 starts at the next daily update that evening, and so on. `cycle` is
 * clamped to `total`, so a season sitting past its end keeps paying its final
 * amounts instead of growing forever; with no season active the clock stands
 * still at 1 of 1 and every prize pays its base.
 *
 * Both halves come from one place because they are only meaningful together —
 * a cycle number says nothing about how rich a spin should be until you know
 * how much season is left to run.
 */
export interface WheelClock {
  cycle: number;
  total: number;
}

export function wheelClock(
  season: Pick<GameSeason, "startsAt" | "endsAt"> | null | undefined,
  now: number
): WheelClock {
  if (!season) return { cycle: 1, total: 1 };
  const elapsed = dailyUpdatesBetween(season.startsAt, new Date(now)).length + 1;
  const total = Math.max(
    dailyUpdatesBetween(season.startsAt, season.endsAt).length + 1,
    1
  );
  return { cycle: Math.min(Math.max(elapsed, 1), total), total };
}

/** Round to three significant figures, so a huge payout reads as a number. */
function readable(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 2);
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Amount a prize pays on a given daily-update cycle. Unit prizes always pay 1.
 *
 * The prize walks from `base` to `final` across the season: cycle 1 pays exactly
 * the base and the last cycle pays exactly the final amount, with every update
 * in between one even step along the curve. `"linear"` prizes add a constant
 * amount per update, `"geometric"` ones multiply by a constant factor — so
 * neither ever jumps, and neither ever flattens out early. `progress` is the
 * whole of the season clock a prize needs; nothing here knows about days.
 *
 * Resources are rounded to three significant figures rather than to `step`,
 * because at the top of the ladder a payout accurate to 50 units is 9 digits of
 * noise. The rounding is applied to the interpolated value, never to a running
 * total, so it can't drift — and at progress 1 it is exact by construction
 * (`final` is already a 1- or 2-significant-figure number).
 */
export function wheelPrizeAmount(
  prize: WheelPrizeDef,
  clock: WheelClock
): number {
  if (prize.kind === "unit") return 1;
  const final = prize.final ?? prize.base;
  const span = Math.max(clock.total - 1, 1);
  const progress = Math.min(Math.max(clock.cycle - 1, 0) / span, 1);

  if (prize.growth === "geometric" && prize.base > 0 && final > 0) {
    const grown = prize.base * (final / prize.base) ** progress;
    return Math.min(Math.max(readable(grown), prize.step), final);
  }
  const grown = prize.base + (final - prize.base) * progress;
  return Math.min(
    Math.max(Math.round(grown / prize.step) * prize.step, prize.step),
    final
  );
}

/** Uniformly pick a winning wedge index. The server owns this roll. */
export function pickWheelPrizeIndex(random: () => number = secureRandom): number {
  return Math.floor(random() * WHEEL_PRIZES.length);
}
