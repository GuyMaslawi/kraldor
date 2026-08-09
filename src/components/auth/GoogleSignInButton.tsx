"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { googleSignIn } from "@/server/actions/auth";
import { FormMessage } from "@/components/ui/FormMessage";
import { useT, useLocale } from "@/i18n/client";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** Google Identity Services will not render a button wider than this. */
const MAX_WIDTH = 400;
const MIN_WIDTH = 200;
/** The gold frame around the button — `.gauth`'s padding and border, both
 *  sides. The button is asked for the width that is left inside it, or the
 *  frame is the thing that overflows the panel. */
const FRAME = 8;

// Minimal shape of the pieces of the Google Identity Services SDK we touch.
interface GsiCredentialResponse {
  credential?: string;
}
interface GsiClient {
  accounts: {
    id: {
      initialize: (opts: {
        client_id: string;
        callback: (res: GsiCredentialResponse) => void;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        opts: Record<string, unknown>
      ) => void;
    };
  };
}

/**
 * "Continue with Google", backed by Google Identity Services.
 *
 * ## Do not paint anything over this button. It stops working.
 *
 * This component briefly rendered GIS's button at `opacity: 0` with a skin of
 * our own on top of it (`pointer-events: none`, so the clicks still landed on
 * Google's button underneath). It looked right and it was completely dead: the
 * button rendered, the pointer went to the right element, and clicking it did
 * nothing at all — no request, no popup, no console error.
 *
 * The reason is that in production GIS does not render a button into our DOM at
 * all. Once the origin is authorised it renders an **iframe** on
 * accounts.google.com (`/gsi/button?...&is_fedcm_supported=true`) and the sign
 * -in is driven from inside it by FedCM. Sign-in UI that a page can position,
 * hide or cover is the exact attack FedCM exists to end, so a click arriving at
 * a button that cannot be seen buys nothing. The whole trick only ever appeared
 * to be plausible in development, where the origin is *not* authorised, GIS
 * falls back to rendering plain DOM, and there is no FedCM in the picture.
 *
 * (The origin, the client id and the permission delegation are all fine — the
 * same FedCM call made from a real, visible button of ours opens Chrome's
 * account chooser normally.)
 *
 * So Google's button is the button. Everything of ours — the gold rim, the lit
 * edge, the glow — is drawn *around* it by the wrapper, never across it, and
 * the wrapper must stay clear of the button's own rectangle. See the `gauth-`
 * block in globals.css, which says the same thing from the other side.
 *
 * If the game's own obsidian-and-gold surface is ever wanted here, the
 * supported route is the OAuth 2.0 code flow (`google.accounts.oauth2
 * .initCodeClient`), which any button of ours may call — it needs a client
 * secret and a server-side code exchange, which is the price of the skin.
 *
 * GIS takes its width in pixels and caps it at 400, so the width is measured
 * from the host element and the button re-rendered when that changes.
 *
 * Renders nothing when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset, so the page
 * still works before Google is configured.
 */
export function GoogleSignInButton() {
  const t = useT();
  const locale = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [width, setWidth] = useState(0);
  // Two separate facts, and the button needs BOTH before it can be rendered:
  // the SDK has loaded, and the host has been measured. The SDK half is a flag
  // set from <Script onReady> rather than the render call itself, because
  // next/script keeps the handler from the render that created it — that
  // closure held `width: 0` forever, so the one call that had the SDK bailed
  // out on the width and every call that had the width ran before the SDK
  // existed. Nothing was ever rendered and the skin sat over a hole.
  //
  // `onReady` (not `onLoad`) is also what covers a client-side navigation
  // between /login and /register: it fires on every mount of this component,
  // including when the script is already on the page.
  const [sdkReady, setSdkReady] = useState(false);
  // Set once GIS has actually put a button under the skin.
  const [ready, setReady] = useState(false);

  const handleCredential = useCallback((res: GsiCredentialResponse) => {
    const credential = res.credential;
    if (!credential) {
      setError(t("התחברות Google נכשלה, נסה שוב"));
      return;
    }
    setError(undefined);
    startTransition(async () => {
      // On success the action redirects (throws NEXT_REDIRECT) and never returns
      // here; a returned value always carries an error to show.
      const result = await googleSignIn(credential);
      if (result?.error) setError(result.error);
    });
    // `t` is memoised on the locale (see useT), so this callback is still
    // stable for the whole life of a page in one language.
  }, [t]);

  // The panel is 400px of usable width on the login screen and wider on the
  // registration screen, where the button stays centred at its 400px cap.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () =>
      setWidth(
        // MAX_WIDTH is the ceiling for the whole block, frame included, so it
        // still ends level with the divider under it.
        Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, Math.round(host.clientWidth)) - FRAME
        )
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const g = (window as unknown as { google?: GsiClient }).google;
    if (!sdkReady || !g || !btnRef.current || !CLIENT_ID || !width) return;
    g.accounts.id.initialize({ client_id: CLIENT_ID, callback: handleCredential });
    // renderButton appends, so a re-render on a width or locale change would
    // stack a second button under the skin.
    btnRef.current.replaceChildren();
    g.accounts.id.renderButton(btnRef.current, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width,
      // Google renders the button's own wording ("Continue with Google"), and
      // it takes a locale rather than inheriting the document's. Pinned to
      // "he" it stayed Hebrew on an otherwise English screen. Invisible now,
      // but it is still the button's accessible name.
      locale,
    });
    setReady(true);
  }, [sdkReady, handleCredential, locale, width]);

  if (!CLIENT_ID) return null;

  return (
    <div className="space-y-2">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
      />
      <div ref={hostRef} className="flex justify-center">
        <div className="gauth" data-pending={pending || undefined}>
          {/* Google's own button, visible and unobstructed. Nothing may be
              drawn on top of this element — see the note above. */}
          <div ref={btnRef} className="gauth-real" />
          {/* Until GIS has rendered there is nothing here to click, and an
              empty gap is worse than a frame that is visibly waking up. This is
              the one overlay allowed, and only because it is gone by the time
              there is a button under it. */}
          {!ready && <span aria-hidden className="gauth-wait" />}
        </div>
      </div>
      {/* The pending line lives under the button rather than on it, for the
          same reason: the button's face belongs to Google. */}
      {pending && (
        <p className="text-center text-xs text-bone-dim">
          {t("מתחבר עם Google...")}
        </p>
      )}
      <FormMessage error={error} />
    </div>
  );
}

/**
 * The rule between the Google button and the email/password form. A gold
 * hairline that fades out from a diamond, rather than two flat grey lines —
 * it is the only piece of furniture between the screen's two ways in.
 */
export function AuthDivider() {
  const t = useT();
  if (!CLIENT_ID) return null;
  return (
    <div className="gauth-divider">
      <span className="gauth-rule" />
      <span className="gauth-or">{t("או")}</span>
      <span className="gauth-rule" />
    </div>
  );
}
