import { getLegalOperator } from "@/lib/legal";
import { gameWallParts } from "@/lib/game/time";
import { getT } from "@/i18n/server";

/**
 * The copyright line at the bottom of every public screen.
 *
 * The business behind the game — not the game — is what a copyright notice
 * names, so this reads from the same `LEGAL_OPERATOR_NAME` the policy pages
 * publish rather than hard-coding "קראלדור". One env var moves the credit on
 * every surface at once, and the next site this business builds gets its footer
 * by setting the same variable.
 *
 * Fails closed: while the name is unset `getLegalOperator()` hands back a
 * placeholder label, and "© מפעיל השירות" is worse than no line at all — an
 * unnamed rights-holder is not a claim anyone can act on. So the component
 * renders nothing until the real name is configured.
 *
 * Server component: it reads server-only env. The year comes from the server
 * clock for the same reason — a client-rendered year would differ from the
 * server's markup on New Year's Eve and hydrate mismatched.
 */
export async function OperatorCredit({ className = "" }: { className?: string }) {
  const { name } = getLegalOperator();
  const configured = !!process.env.LEGAL_OPERATOR_NAME?.trim();
  if (!configured) return null;
  const t = await getT();

  return (
    <p className={`text-center text-[11px] text-zinc-600 ${className}`}>
      {/* The name is Latin inside an RTL document: without the isolate the ©
          and the year drift to the wrong side of it. The year is the game's,
          like every other date on the site — `getFullYear` on a UTC server
          rolls over two hours after the players it belongs to do. */}
      <span dir="ltr" className="inline-block">
        © {gameWallParts(new Date()).year} {name}
      </span>
      {" · "}
      {t("כל הזכויות שמורות")}
    </p>
  );
}
