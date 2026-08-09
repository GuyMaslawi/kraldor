import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { getSessionUserId } from "@/lib/auth";
import { ensureDeviceId } from "@/lib/device";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { normalizeReferralCode } from "@/lib/game/referral";
import { stashPendingReferral } from "@/server/referralGuard";

/**
 * `/r/<code>` — the invite link.
 *
 * A route handler rather than a page because its entire job is to write two
 * cookies and send the visitor on, and cookies cannot be written during a page
 * render. Nothing is displayed here; the "you were invited by X" line belongs on
 * the sign-up form, which is where the visitor lands.
 *
 * ## It never says whether the code was real
 *
 * Every request redirects to the same place. A bad code, a retired one, a
 * perfectly good one — same status, same destination, no message. That is what
 * keeps this from being an oracle: at 60 bits a code cannot be guessed, but an
 * endpoint that answered differently for a hit would still let anyone confirm a
 * code they had *seen* (in a screenshot, over someone's shoulder, in a chat log
 * they were forwarded) and, worse, would let a scraper with a leaked list map it
 * onto real accounts. The player who was sent a working link finds out it worked
 * because the sign-up form greets them by their friend's name.
 *
 * ## Two cookies, two jobs
 *
 * The pending-referral cookie carries the code to whichever screen eventually
 * founds an empire — the password form, or Google's onboarding two hops later.
 * The device cookie is minted here rather than at sign-up on purpose: someone
 * opening *their own* link to farm a second account touches this route from the
 * browser they already play in, and that is the moment worth recording.
 */

// Prisma is not reached here, but cookies and the shared rate limiter are, and
// nothing about this may be cached or prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ code: string }> }
): Promise<never> {
  const { code: raw } = await ctx.params;

  // Unauthenticated and trivially scriptable. The throttle is not protecting a
  // secret — see above — it bounds how fast one origin can make this app set
  // cookies and run a regex, which is the only cost here. Generous, because a
  // successful invite post drops a whole group chat onto this route at once,
  // frequently from one carrier NAT.
  const ip = await clientIp();
  await rateLimit(`invite:${ip}`, 120, 60 * 60 * 1000);

  // A player who is already in the game does not need the sign-up form, and
  // their visit must not park a code either: the cookie lives for a month, and
  // a phone whose owner idly opened a link would otherwise hand that referrer
  // to whoever next registers on it. Send them to the referrals screen, where a
  // code they were curious enough to click can still be typed in while their
  // naming window is open — and where they will find their own link to send on.
  if (await getSessionUserId()) redirect("/game/referrals");

  const code = normalizeReferralCode(raw);
  if (code) {
    await stashPendingReferral(code);
    // Minted now rather than at sign-up: someone opening *their own* link to
    // farm a second account touches this route from the browser they already
    // play in, and that is the moment worth being able to recognise.
    await ensureDeviceId();
  }

  redirect("/register");
}
