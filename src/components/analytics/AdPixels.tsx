import Script from "next/script";

/**
 * The advertising pixels — Meta and TikTok — and nothing else.
 *
 * ## They only exist while a campaign is running
 *
 * Both are gated on an env var holding the pixel id. Unset (which is the state
 * of every local checkout, every preview deploy, and production between
 * campaigns) renders literally nothing: no script tag, no third-party request,
 * no cookie. This is deliberate and is the reason the gate is an id rather than
 * a boolean — you cannot half-configure it, and turning the campaign off is
 * deleting one variable rather than remembering to also flip a flag.
 *
 *   NEXT_PUBLIC_META_PIXEL_ID      Meta (Facebook/Instagram) — Events Manager
 *   NEXT_PUBLIC_TIKTOK_PIXEL_ID    TikTok — Events Manager
 *
 * ## Why `afterInteractive` and not `beforeInteractive`
 *
 * A pixel is measurement, not function. Nothing on the page waits for it, and
 * loading it before hydration would put a third-party script in front of the
 * game's own first paint to save a few hundred milliseconds of reporting
 * latency that nobody reads. `afterInteractive` still fires the PageView.
 *
 * ## What this does not do
 *
 * No consent banner. Israeli law does not require an opt-in cookie wall, and
 * the privacy policy discloses these two by name (see /privacy). If the game
 * ever takes EU traffic in earnest that changes, and this component is the one
 * place that would have to learn to wait for consent.
 *
 * A server component: it reads the env vars at render and emits the tags. The
 * conversion event itself is fired from a client component — see
 * `RegistrationPixel`.
 */
export function AdPixels() {
  const meta = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const tiktok = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;
  if (!meta && !tiktok) return null;

  return (
    <>
      {meta && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${meta}');fbq('track','PageView');`}
        </Script>
      )}

      {tiktok && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";
ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;
ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");
o.type="text/javascript";o.async=!0;o.src=r+"?sdkid="+e+"&lib="+t;
var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
ttq.load('${tiktok}');ttq.page();}(window,document,'ttq');`}
        </Script>
      )}
    </>
  );
}
