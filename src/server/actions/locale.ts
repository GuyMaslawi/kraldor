"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  toLocale,
} from "@/i18n/locale";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

/**
 * Switch the site's language.
 *
 * Deliberately the shallowest action in the codebase: no session, no rate
 * limit, no empire. Choosing a language is not an authenticated act — the
 * landing page, the login form and the legal pages all need the switch, and
 * gating it would leave a logged-out visitor stuck in a language they cannot
 * read on the one screen that is meant to let them in.
 *
 * `httpOnly: false` for the same reason: nothing here is a secret, and a
 * readable cookie lets a future client-side render pick the language up without
 * a round trip. `sameSite: "lax"` keeps it off cross-site requests anyway.
 *
 * The value is narrowed through `toLocale`, so an unknown string from a forged
 * form lands on Hebrew rather than being written back verbatim and reflected
 * into `<html lang>`.
 *
 * `revalidatePath("/", "layout")` is what makes the change appear: every screen
 * renders on the server from `getT()`, so the cached render of the current page
 * is in the *old* language and has to be thrown away. Scoped to the root layout
 * because the switch itself lives there — one action, every page.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const locale = toLocale(formData.get("locale"));
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
  });

  // Mirrored onto the account, when there is one, for the messages the game
  // writes while the player is *not* here: a raid notification is sent off the
  // back of the attacker's request, and the only cookie in hand there belongs to
  // the attacker. See `User.locale` — the cookie above stays the authority for
  // anything rendered during a request, and this is only ever read when there is
  // no request to read it from.
  //
  // Best-effort on purpose, and after the cookie: choosing a language must work
  // for a signed-out visitor on the login screen, so nothing here may throw the
  // switch. A write that fails leaves the account on its previous preference,
  // which costs at most one email in the wrong language.
  try {
    const userId = await getSessionUserId();
    if (userId) {
      await prisma.user.updateMany({ where: { id: userId }, data: { locale } });
    }
  } catch {
    // No session, or the row moved under us. Neither is worth failing a
    // language switch over.
  }

  revalidatePath("/", "layout");
}
