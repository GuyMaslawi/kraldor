/**
 * Cryptographically secure replacement for `Math.random()` on anything of value.
 *
 * V8 implements `Math.random` as xorshift128+ — fast, but its internal state is
 * recoverable from a modest run of observed outputs, and this game publishes
 * outputs constantly: every wheel spin returns its winning wedge index, and
 * every attack reveals whether an item dropped. Once the state is recovered,
 * future rolls are predictable, which turns "spin when a legendary is due" into
 * a viable strategy against loot, item drops and prize wedges.
 *
 * Uses Web Crypto rather than `node:crypto` so the same module is safe to pull
 * into a Client Component bundle; `crypto.getRandomValues` is a global in Node
 * 18+ and in every browser the app supports.
 *
 * Returns a float in [0, 1) with 32 bits of entropy — the same contract as
 * `Math.random`, so it drops straight into the existing `random: () => number`
 * seams that the game logic already accepts for testability.
 */
export function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

/**
 * A *reproducible* stream, seeded from a string. The deliberate opposite of
 * `secureRandom`, and only ever correct where the output is public and has to
 * be the same for everyone who asks.
 *
 * The one thing it must never be used for is a roll whose result is worth
 * something to the player — loot, wedges, item rarity. A seeded stream is
 * predictable by definition, and the whole point of `secureRandom` above is
 * that those rolls must not be.
 *
 * What it *is* for: deciding today's three missions for an empire, or today's
 * contract for a guild. Both are drawn from (id, period) with no row to write
 * first, which means two requests racing to open the same board independently
 * draw the *same* board — so the unique index can drop the loser and neither
 * player ever sees the missions change under them. Storing a roll would have
 * needed a writer on a read path; this needs nothing.
 *
 * FNV-1a for the seed, mulberry32 for the stream. Both are three lines, both
 * are well-distributed for this, and neither pretends to be a CSPRNG.
 */
export function seededRandom(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * `count` distinct members of `pool`, drawn without replacement from a seeded
 * stream. Returns the whole pool (shuffled) when it is smaller than `count`.
 *
 * A partial Fisher–Yates over a copy: every subset is equally likely, and the
 * draw is stable for a given seed, which is the property the mission board is
 * built on.
 */
export function seededSample<T>(
  pool: readonly T[],
  count: number,
  random: () => number
): T[] {
  const items = [...pool];
  const take = Math.min(Math.max(0, Math.floor(count)), items.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(random() * (items.length - i));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, take);
}
