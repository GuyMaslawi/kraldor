import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The pre-launch gate is one boolean and one comparison, and four separate
 * places lean on it: `login`, `googleSignIn`, `requireEmpire` and
 * `getActiveEmpireId`. Both halves are worth pinning.
 *
 * The **default** is the safety property. The flag is deliberately "shut unless
 * told otherwise", so that a deploy with nothing configured — or with the
 * variable misspelt, or dropped by a `vercel env rm` that took more than it was
 * asked to — keeps the doors closed rather than quietly opening the game. A test
 * that only ever ran with the variable set would not notice that inverting.
 *
 * The **admin exemption** is the other half: `/admin` is reachable only through
 * `/login`, so a gate that turned everyone away would lock the operator out of
 * the one panel that can open it.
 *
 * `PRELAUNCH` is read at module load, so each case re-imports the module with a
 * fresh registry rather than trying to mutate the constant.
 */
async function loadWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.PRELAUNCH;
  else process.env.PRELAUNCH = value;
  return import("@/lib/prelaunch");
}

const ORIGINAL = process.env.PRELAUNCH;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PRELAUNCH;
  else process.env.PRELAUNCH = ORIGINAL;
});

describe("PRELAUNCH", () => {
  it("is on when nothing is configured — a bare deploy stays shut", async () => {
    const { PRELAUNCH } = await loadWith(undefined);
    expect(PRELAUNCH).toBe(true);
  });

  it("is off only for the exact opt-out value", async () => {
    expect((await loadWith("0")).PRELAUNCH).toBe(false);
  });

  it("stays on for anything else, including plausible near-misses", async () => {
    for (const value of ["", "1", "false", "off", "no", "FALSE", " 0"]) {
      expect((await loadWith(value)).PRELAUNCH).toBe(true);
    }
  });
});

describe("prelaunchShut", () => {
  it("turns away a player while the game has not opened", async () => {
    const { prelaunchShut } = await loadWith(undefined);
    expect(prelaunchShut("USER")).toBe(true);
  });

  it("lets an admin through — /admin is only reachable past this gate", async () => {
    const { prelaunchShut } = await loadWith(undefined);
    expect(prelaunchShut("ADMIN")).toBe(false);
  });

  it("turns away a caller with no role at all", async () => {
    const { prelaunchShut } = await loadWith(undefined);
    expect(prelaunchShut(null)).toBe(true);
    expect(prelaunchShut(undefined)).toBe(true);
  });

  it("bars nobody once the game is open", async () => {
    const { prelaunchShut } = await loadWith("0");
    expect(prelaunchShut("USER")).toBe(false);
    expect(prelaunchShut(null)).toBe(false);
  });
});
