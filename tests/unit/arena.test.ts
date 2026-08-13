import { describe, expect, it } from "vitest";
import {
  ARENA_CONSOLATION,
  ARENA_ENTRY_TURNS,
  ARENA_LUCK,
  ARENA_MAX_ENTRANTS,
  ARENA_PODIUM,
  ARENA_PODIUM_MIN_ENTRANTS,
  arenaPodiumPays,
  arenaReward,
  duelSeed,
  duelWinner,
  rankArena,
  resolveArena,
} from "@/lib/game/arena";
import { seededRandom } from "@/lib/game/random";
import { MAX_CITIES } from "@/lib/game/constants";

/**
 * A card with enough entrants to pay its podium. Every purse assertion below is
 * about the *shape* of the table rather than about the thin-tier rule, so they
 * all quote a real tournament; the thin-tier rule has its own block.
 */
const FULL_CARD = ARENA_PODIUM_MIN_ENTRANTS;

describe("duelWinner", () => {
  const strong = { id: "strong", power: 1_000_000 };
  const weak = { id: "weak", power: 10_000 };

  it("favours the stronger empire", () => {
    let wins = 0;
    for (let i = 0; i < 2_000; i += 1) {
      if (duelWinner(strong, weak, seededRandom(`d${i}`)) === "strong") wins += 1;
    }
    expect(wins / 2_000).toBeGreaterThan(0.7);
  });

  it("still lets the weaker one take fights", () => {
    // The whole reason anybody below the top of the tier enters. An arena the
    // favourite sweeps is an arena with one entrant.
    let wins = 0;
    for (let i = 0; i < 2_000; i += 1) {
      if (duelWinner(strong, weak, seededRandom(`d${i}`)) === "weak") wins += 1;
    }
    expect(wins / 2_000).toBeGreaterThan(0.05);
  });

  it("is a coin toss between equals", () => {
    const a = { id: "a", power: 50_000 };
    const b = { id: "b", power: 50_000 };
    let aWins = 0;
    for (let i = 0; i < 4_000; i += 1) {
      if (duelWinner(a, b, seededRandom(`e${i}`)) === "a") aWins += 1;
    }
    expect(aWins / 4_000).toBeGreaterThan(0.45);
    expect(aWins / 4_000).toBeLessThan(0.55);
  });

  it("never returns a fighter who was not in the duel", () => {
    for (let i = 0; i < 200; i += 1) {
      const winner = duelWinner(strong, weak, seededRandom(`f${i}`));
      expect(["strong", "weak"]).toContain(winner);
    }
  });

  it("handles an empire with no army at all", () => {
    // A brand-new entrant must not divide by zero or win by accident.
    const empty = { id: "empty", power: 0 };
    for (let i = 0; i < 200; i += 1) {
      expect(["strong", "empty"]).toContain(
        duelWinner(strong, empty, seededRandom(`g${i}`))
      );
    }
    expect(ARENA_LUCK).toBeGreaterThan(0);
    expect(ARENA_LUCK).toBeLessThan(1);
  });
});

describe("duelSeed", () => {
  it("is the same however the pair is ordered", () => {
    // Otherwise the loop order would decide who was the favourite.
    expect(duelSeed("arena", "a", "b")).toBe(duelSeed("arena", "b", "a"));
  });

  it("differs between arenas and between pairs", () => {
    expect(duelSeed("arena1", "a", "b")).not.toBe(duelSeed("arena2", "a", "b"));
    expect(duelSeed("arena", "a", "b")).not.toBe(duelSeed("arena", "a", "c"));
  });
});

describe("resolveArena", () => {
  const fighters = [
    { id: "a", power: 900_000 },
    { id: "b", power: 400_000 },
    { id: "c", power: 100_000 },
    { id: "d", power: 20_000 },
    { id: "e", power: 5_000 },
  ];

  it("plays every pair exactly once", () => {
    const results = resolveArena("arena", fighters);
    const n = fighters.length;
    expect(results).toHaveLength(n);
    for (const r of results) expect(r.wins + r.losses).toBe(n - 1);
    const totalWins = results.reduce((sum, r) => sum + r.wins, 0);
    expect(totalWins).toBe((n * (n - 1)) / 2);
  });

  it("is reproducible — the same card resolves the same way twice", () => {
    // A resolution that raced itself must not be able to write two tables.
    expect(resolveArena("arena", fighters)).toEqual(
      resolveArena("arena", fighters)
    );
  });

  it("does not depend on the order the rows came back in", () => {
    const shuffled = [...fighters].reverse();
    const byId = (list: ReturnType<typeof resolveArena>) =>
      Object.fromEntries(list.map((r) => [r.id, r.wins]));
    expect(byId(resolveArena("arena", shuffled))).toEqual(
      byId(resolveArena("arena", fighters))
    );
  });

  it("gives a different card a different table", () => {
    const byId = (list: ReturnType<typeof resolveArena>) =>
      JSON.stringify(byId0(list));
    const byId0 = (list: ReturnType<typeof resolveArena>) =>
      Object.fromEntries(list.map((r) => [r.id, r.wins]));
    const a = byId(resolveArena("arena-1", fighters));
    const b = byId(resolveArena("arena-2", fighters));
    // Not guaranteed different for any single pair, but across a five-way card
    // an identical table would mean the arena id is not in the seed at all.
    expect(a === b).toBe(false);
  });

  it("copes with the degenerate cards", () => {
    expect(resolveArena("arena", [])).toEqual([]);
    const solo = resolveArena("arena", [{ id: "only", power: 1 }]);
    expect(solo).toEqual([{ id: "only", wins: 0, losses: 0 }]);
  });

  it("tends to place the strongest entrant near the top", () => {
    // Over many cards the favourite should usually win the table. Not always —
    // that is what ARENA_LUCK is for.
    let firsts = 0;
    for (let i = 0; i < 60; i += 1) {
      const powerById = new Map(fighters.map((f) => [f.id, f.power]));
      const ranked = rankArena(resolveArena(`arena-${i}`, fighters), powerById);
      if (ranked[0].id === "a") firsts += 1;
    }
    expect(firsts).toBeGreaterThan(30);
    expect(firsts).toBeLessThan(60);
  });
});

describe("rankArena", () => {
  it("orders by wins, then by power", () => {
    const results = [
      { id: "low", wins: 3, losses: 1 },
      { id: "highPower", wins: 3, losses: 1 },
      { id: "best", wins: 4, losses: 0 },
    ];
    const power = new Map([
      ["low", 10],
      ["highPower", 1_000],
      ["best", 5],
    ]);
    expect(rankArena(results, power).map((r) => r.id)).toEqual([
      "best",
      "highPower",
      "low",
    ]);
  });

  it("is stable and total even with no power recorded", () => {
    const results = [
      { id: "b", wins: 1, losses: 0 },
      { id: "a", wins: 1, losses: 0 },
    ];
    expect(rankArena(results, new Map()).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("arenaReward", () => {
  it("pays the podium more than the field", () => {
    const total = (place: number) =>
      arenaReward(place, 0, 3, FULL_CARD).reduce((sum, r) => sum + r.amount, 0);
    expect(total(1)).toBeGreaterThan(total(2));
    expect(total(2)).toBeGreaterThan(total(3));
    expect(total(3)).toBeGreaterThan(total(4));
  });

  it("puts diamonds on the podium only", () => {
    // This repeats daily for every city tier; a diamond payout below the
    // podium would be a faucet with as many spouts as the game has tiers.
    for (let place = 1; place <= ARENA_PODIUM.length; place += 1) {
      expect(arenaReward(place, 0, 1, FULL_CARD).some((r) => r.kind === "diamonds")).toBe(true);
    }
    for (const place of [ARENA_PODIUM.length + 1, 10, 50]) {
      expect(arenaReward(place, 0, 1, FULL_CARD).some((r) => r.kind === "diamonds")).toBe(false);
    }
  });

  it("never leaves an entrant poorer than the entry cost", () => {
    // An arena a mid-table player leaves down on turns is an arena they enter
    // once. The consolation purse has to beat the ticket.
    const turns = ARENA_CONSOLATION.find((r) => r.kind === "turns")!.amount;
    expect(turns).toBeGreaterThan(ARENA_ENTRY_TURNS);
    const last = arenaReward(ARENA_MAX_ENTRANTS, 0, 1, FULL_CARD);
    expect(last.find((r) => r.kind === "turns")!.amount).toBeGreaterThan(
      ARENA_ENTRY_TURNS
    );
  });

  it("pays for wins, so fourth place is not last place", () => {
    const gold = (wins: number) =>
      arenaReward(8, wins, 1, FULL_CARD).find((r) => r.kind === "gold")!.amount;
    expect(gold(30)).toBeGreaterThan(gold(2));
  });

  it("rides the city curve on its resource half only", () => {
    const diamonds = (cities: number) =>
      arenaReward(1, 0, cities, FULL_CARD).find((r) => r.kind === "diamonds")!.amount;
    const gold = (cities: number) =>
      arenaReward(1, 0, cities, FULL_CARD).find((r) => r.kind === "gold")!.amount;
    expect(diamonds(MAX_CITIES)).toBe(diamonds(1));
    expect(gold(MAX_CITIES)).toBeGreaterThan(gold(1));
  });

  it("keeps the daily podium a rationed faucet", () => {
    // The card runs every day for every city tier. The weekly purse was 60
    // diamonds; paying that seven times a week is the failure mode this
    // ceiling exists to make loud rather than gradual. See ARENA_PODIUM.
    const diamonds = ARENA_PODIUM.map(
      (purse) => purse.find((r) => r.kind === "diamonds")?.amount ?? 0
    );
    expect(diamonds[0]).toBeGreaterThan(0);
    expect(diamonds[0]).toBeLessThanOrEqual(20);
    // And strictly descending, or second place is not worse than first.
    expect(diamonds[0]).toBeGreaterThan(diamonds[1]);
    expect(diamonds[1]).toBeGreaterThan(diamonds[2]);
  });

  it("bounds the card so a round-robin stays cheap", () => {
    // O(N²) duels resolved in one transaction; the ceiling is the whole reason
    // that is affordable.
    expect(ARENA_MAX_ENTRANTS).toBeGreaterThan(10);
    expect(ARENA_MAX_ENTRANTS).toBeLessThanOrEqual(100);
  });
});

describe("a thin tier does not mint diamonds", () => {
  /**
   * The hole this closes. A city tier is not a room full of people — it is
   * however many empires happen to hold that many cities today, and at the
   * top of the ladder that is routinely one. A round-robin of one entrant is
   * zero duels and a table of one row, so that entrant is ranked first by
   * arithmetic and, before the floor, collected the winner's diamonds every
   * card forever for the price of the entry turns. Two accounts parked in the
   * same empty tier took first *and* second. A daily card leaks seven times as
   * fast, which is why the floor was deliberately NOT lowered when the period
   * shrank.
   */
  it("pays a lone entrant no diamonds for placing first", () => {
    expect(arenaReward(1, 0, 1, 1).some((r) => r.kind === "diamonds")).toBe(false);
  });

  it("pays no diamonds anywhere below the entrant floor", () => {
    for (let entrants = 1; entrants < ARENA_PODIUM_MIN_ENTRANTS; entrants += 1) {
      for (let place = 1; place <= ARENA_PODIUM.length; place += 1) {
        expect(
          arenaReward(place, 0, MAX_CITIES, entrants).some(
            (r) => r.kind === "diamonds"
          )
        ).toBe(false);
      }
    }
  });

  it("opens the podium the moment the card is a real tournament", () => {
    expect(
      arenaReward(1, 0, 1, ARENA_PODIUM_MIN_ENTRANTS).some(
        (r) => r.kind === "diamonds"
      )
    ).toBe(true);
  });

  it("still pays a thin card its earned half, so it is never a dead screen", () => {
    // The consolation purse and the per-win gold are earned rather than
    // awarded, so they are not withheld — only the diamonds are.
    const solo = arenaReward(1, 0, 1, 1);
    expect(solo.find((r) => r.kind === "turns")!.amount).toBeGreaterThan(
      ARENA_ENTRY_TURNS
    );
    const withWins = (wins: number) =>
      arenaReward(1, wins, 1, 2).find((r) => r.kind === "gold")!.amount;
    expect(withWins(9)).toBeGreaterThan(withWins(0));
  });

  it("agrees with the predicate the screen renders from", () => {
    // The preview and the payout must never be able to disagree about this.
    for (const entrants of [0, 1, 4, 5, 6, 60]) {
      const pays = arenaPodiumPays(entrants);
      const hasDiamonds = arenaReward(1, 0, 1, entrants).some(
        (r) => r.kind === "diamonds"
      );
      expect(hasDiamonds).toBe(pays);
    }
  });
});

describe("the purse the screen shows is the purse that is paid", () => {
  it("returns one line per kind", () => {
    // Both the podium table and the per-win bonus pay gold. payRewards merges
    // before it credits, so an unmerged list here would show the player one
    // figure and hand them another — the classic "the preview lied" bug.
    for (const place of [1, 2, 3, 9]) {
      const kinds = arenaReward(place, 12, 4, FULL_CARD).map((r) => r.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it("includes the per-win gold in that single line", () => {
    const gold = (wins: number) =>
      arenaReward(9, wins, 1, FULL_CARD).find((r) => r.kind === "gold")!.amount;
    expect(gold(30)).toBeGreaterThan(gold(0));
  });
});
