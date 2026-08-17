/**
 * Where a player came from — first-touch ad attribution.
 *
 * A paid campaign that cannot tell which ad produced the players who *stayed*
 * is a campaign that learns nothing: cost-per-signup is knowable from the ad
 * platform alone, but cost-per-player-still-here-on-day-7 needs the two halves
 * joined, and only this app holds the second half. Four columns on User and a
 * cookie in between are the whole mechanism.
 *
 * ## First touch, not last
 *
 * The cookie is written once and never overwritten while it lives (see
 * src/proxy.ts). A visitor who clicks the ad, reads the manual, leaves, and
 * comes back a week later through a Google search is credited to **the ad** —
 * that is the click that was paid for. Last-touch would hand every one of those
 * signups to "direct" and make the campaign look worthless.
 *
 * ## What is stored, and what deliberately is not
 *
 * Only the four `utm_*` labels *we* put on our own ad links, plus a source
 * inferred from a click id. The click ids themselves (`fbclid`, `gclid`,
 * `ttclid`) are **not** persisted: they identify a single click to the ad
 * network and are the one part of an ad URL that is genuinely personal. We want
 * to know that a player came from the Meta retargeting ad, not which impression
 * they were. Everything kept here is a campaign label chosen by us and shared by
 * hundreds of visitors, so the row says "meta / paid / season-12-launch" and
 * nothing about the person.
 *
 * Values are clamped hard (length and character set) because they arrive from
 * the query string, which anybody can write, and they end up grouped in an
 * admin report.
 */

export type Attribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
};

/** The first-touch cookie. httpOnly — nothing client-side reads it. */
export const ATTRIBUTION_COOKIE = "kr_attr";

/**
 * Thirty days, which is one season.
 *
 * Longer would keep crediting an ad after the campaign it belonged to is over
 * and after the world it advertised has been wiped; shorter would lose the
 * visitor who clicks during the pre-season warm-up phase and signs up on
 * opening night, which is precisely the journey the campaign is built around.
 */
export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 30;

/** Per-value ceiling. Long enough for `season-12-launch-nostalgia-25-45`. */
const MAX_LEN = 60;

/**
 * Click ids, and the source each implies.
 *
 * A correctly tagged ad link carries `utm_source` and never needs this. It
 * exists for the link that lost its tags on the way — a creative published
 * without them, an organic reshare of an ad, a platform that rewrites the URL —
 * where the click id is the only surviving evidence of which network sent the
 * visitor. Inferred rows are marked `medium: "paid"` and no campaign, so they
 * are visibly coarser than a properly tagged one in the report.
 */
const CLICK_IDS: ReadonlyArray<readonly [param: string, source: string]> = [
  ["fbclid", "facebook"],
  ["gclid", "google"],
  ["ttclid", "tiktok"],
  ["twclid", "twitter"],
  ["msclkid", "bing"],
];

/**
 * One query-string value, made safe to store and to group by.
 *
 * Lower-cased so `Meta`, `meta` and `META` are one row in the report rather than
 * three; anything outside the campaign-label alphabet is dropped rather than
 * escaped, because a label is something we choose and it never legitimately
 * contains punctuation. That also means nothing that reaches the database from
 * here can carry markup, a quote, or a newline.
 */
function clean(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.\-|]/g, "")
    .slice(0, MAX_LEN);
  return value.length > 0 ? value : null;
}

/**
 * Read an incoming URL's ad tags, or null if it carries none.
 *
 * Null is the important return: the overwhelming majority of requests to the
 * site have no ad tags at all, and they must not cost a cookie write.
 */
export function readAttributionParams(params: URLSearchParams): Attribution | null {
  const source = clean(params.get("utm_source"));
  const medium = clean(params.get("utm_medium"));
  const campaign = clean(params.get("utm_campaign"));
  const content = clean(params.get("utm_content"));

  if (source || medium || campaign || content) {
    return { source, medium, campaign, content };
  }

  // No utm tags — fall back to whatever click id survived, if any.
  for (const [param, inferred] of CLICK_IDS) {
    if (params.get(param)) {
      return { source: inferred, medium: "paid", campaign: null, content: null };
    }
  }

  return null;
}

/**
 * Pack for the cookie.
 *
 * `URLSearchParams` rather than JSON so the value stays short and needs no
 * try/catch to read back — a cookie is attacker-writable and the parse must not
 * be able to throw on the hot path.
 */
export function serializeAttribution(a: Attribution): string {
  const params = new URLSearchParams();
  if (a.source) params.set("s", a.source);
  if (a.medium) params.set("m", a.medium);
  if (a.campaign) params.set("c", a.campaign);
  if (a.content) params.set("n", a.content);
  return params.toString();
}

/**
 * Unpack a cookie written by `serializeAttribution`.
 *
 * Every field is re-`clean`ed on the way out, not merely on the way in: the
 * cookie is client-side storage and a player can put anything in it by hand, so
 * the value that reaches a Prisma insert must be sanitised at the point it is
 * *read*, not only at the point we happened to write it.
 */
export function parseAttribution(raw: string | undefined | null): Attribution | null {
  if (!raw) return null;
  const params = new URLSearchParams(raw.slice(0, 400));
  const attr: Attribution = {
    source: clean(params.get("s")),
    medium: clean(params.get("m")),
    campaign: clean(params.get("c")),
    content: clean(params.get("n")),
  };
  if (!attr.source && !attr.medium && !attr.campaign && !attr.content) return null;
  return attr;
}

/** The four columns, shaped for a `user.create`. Safe to spread when null. */
export function attributionColumns(attr: Attribution | null) {
  return {
    utmSource: attr?.source ?? null,
    utmMedium: attr?.medium ?? null,
    utmCampaign: attr?.campaign ?? null,
    utmContent: attr?.content ?? null,
  };
}
