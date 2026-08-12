# Open items — what still needs fixing

The running list of everything known-and-not-fixed, carried across the seven
security audits (2026-07-23 → 2026-08-01). Anything already fixed lives in the
audit notes, not here. Order is by what it costs you if it goes wrong, not by
how hard it is.

Nothing on this list is a live exploit. The code-level defects found in each
audit were fixed in that audit; what is left is infrastructure that only you can
touch, compliance that needs your real details, and design calls that are yours
to make.

---

## 1. Infrastructure — only you can do these

### 1.1 Rotate the Neon production password · **highest severity, open since 07-25**

The credential in `.env.local` was read by a subagent during the 07-25 audit and
is still valid. It grants full read/write to the production database: every
account, every purchase record, every balance.

Neon console → reset the role password → update `PRISMA_DATABASE_URL` and
`PRISMA_DIRECT_URL` (and the Vercel↔Neon integration's own `DATABASE_URL`) on
Vercel → redeploy. Nothing in the repo needs to change.

### 1.2 Publish the operator identity · **five fields, gateway-independent**

Five values are required before the store may open. Gateway underwriting asks
for them by name, but the consumer-protection rule behind them is ours
regardless — which is why the list has survived every change of gateway
unchanged:

| Variable | Status |
| --- | --- |
| `LEGAL_OPERATOR_NAME` | set locally + on Vercel (`GM-business`) |
| `LEGAL_CONTACT_EMAIL` | set locally + on Vercel |
| `LEGAL_OPERATOR_TAX_ID` | set locally, **not on Vercel** |
| `LEGAL_CONTACT_PHONE` | **empty — new** |
| `LEGAL_OPERATOR_ADDRESS` | **empty — new**, full postal address |

`LEGAL_OPERATOR_CITY` is retired: it published a city only, which satisfied the
consumer-protection rule but not the gateway. It still answers as a fallback so a
mid-migration deploy does not drop the place of business off the page, but it no
longer counts toward `complete`.

All five print publicly on `/terms`, `/refund` and `/privacy`, and for a
home-run עוסק פטור the address is a home address and the tax id is a ת.ז. If
that is not acceptable, a **תא דואר** satisfies the address requirement and a
second number (Google Voice, a cheap SIM) satisfies the phone — both are normal
and neither weakens the disclosure.

**The exposure itself is now closed by construction** — selling without naming
the merchant is what the law and the gateways care about, so that state can no
longer happen:

- `arePurchasesLive()` carries a third interlock: no operator, no store. Players
  see the store chained shut; admins still get the checkout for testing.
- `/terms`, `/refund` and `/privacy` say the details are pending instead of
  printing the placeholder as though it were a real merchant.
- The buy screen tells an admin exactly which of the three go-live conditions is
  missing, by env var name.

What is left is the input only you have: set the remaining values on Vercel (and
in `.env` for local work) — the name and the dealer number are the two the
interlock still waits on — and the pages fill themselves in, the interlock opens.
For an עוסק פטור the dealer number is your ת.ז. See `src/lib/legal.ts`.

### 1.3 Confirm `TRUSTED_PROXY_HOPS` matches Vercel's edge

`clientIp()` reads the client address `TRUSTED_PROXY_HOPS` entries from the
*right* of `X-Forwarded-For` (default 1), because everything to the left is
attacker-controllable. If Vercel's header shape differs from that assumption,
every per-IP limiter (login, register, client-error) is keyed on a value a
client can rotate at will — which silently removes the brute-force ceiling.

Verify once against a known address in production (log it, or read it back from
a `RateLimitBucket` key) and set the env var if the default is wrong. Cheap to
check, expensive to be wrong about.

### 1.4 Finish the Grow connection · **connected 08-12; one real charge still owed**

**Status.** The credentials are set and deployed to production, and the live
config was confirmed from outside: a POST to `/api/pay/grow/<secret>` answers 200
while a wrong secret answers 404, and `growConfig()` returns non-null only when
all three variables are valid — so that 200 proves the whole set is loaded and
the store is off the mock provider. What it does *not* prove is that `userId` and
`pageCode` are values Grow accepts; only a real `createPaymentProcess` will.

**The account is shared with Allura** — same עוסק פטור, a second payment page
("Kraldor diamonds") under the same merchant. Allura reaches Grow through a Make
scenario and holds no API credentials; kraldor calls the Light API directly.
Same account, different integration — do not assume a setting from one applies to
the other. Two consequences that are not code: the עוסק פטור annual ceiling is
now shared between subscription revenue and diamond sales, and the activity Grow
underwrote was SaaS, not virtual game currency.

**Still owed before `DIAMOND_PURCHASES_LIVE=true`:**

1. In the panel, page → **עמוד תודה**, set the two URLs (below). The code sends
   both per transaction, so this is a backstop, not the mechanism.
2. One real ₪19.90 "ניצוץ" purchase as an admin — admins bypass the live gate, so
   the store stays shut to players while this runs. Confirm the money in the
   **Grow merchant dashboard**, not in the app: Grow's sandbox once reported a
   fully successful payment for Allura with no money anywhere, which is why
   sandbox was skipped entirely here.
3. Answer the receipts question below.

**The gateway is Grow**, sole and unambiguous: `getPaymentProvider()` selects it
or falls back to the mock, and no other gateway exists anywhere in the tree. The
previous gateway was removed in full on 2026-08-09 when a better offer moved the
account — provider module, callback route, tests and env vars all deleted.

Nothing else moved with it. `src/server/orderSettle.ts`, `src/server/purchases.ts`
and the checkout UI never named a gateway, which is the whole point of the
`OrderPaymentProvider` seam and why the swap was a one-file change in each
direction.

What is left on our side is **credentials, not code**. `src/server/grow.ts` and
the callback at `/api/pay/grow/<secret>` are written and unit-tested
(`tests/unit/grow.test.ts`), and `tests/unit/payments.test.ts` covers the seam
above them — which provider is selected, and each go-live interlock asserted from
the closed side.

Set on Vercel (and in `.env` for local work — `npm run vercel:env` pushes them):

| Variable | Where it comes from |
| --- | --- |
| `GROW_USER_ID` | Decoded from the payment link — see below |
| `GROW_PAGE_CODE` | Decoded from the payment link — see below |
| `GROW_CALLBACK_SECRET` | **You invent it.** `openssl rand -hex 24`; ≥24 chars, `[A-Za-z0-9]` only |
| `GROW_ENV` | `production` since 08-12. `sandbox` is the code default and was deliberately never used |
| `GROW_PAYMENT_METHODS` | optional; default `1,6,13,14` = card, Bit, Apple Pay, Google Pay |

**The panel never shows `userId` or `pageCode` as labelled fields.** Both are
encoded in the link a payment page issues, which is the only place to read them:

```
grow.link/<base64 userId>-<pageCode>-<base64 linkId>
```

The page itself is a **עמוד קבוע**, not a לינק חד־פעמי (that is per-transaction,
and is what Make creates for Allura). It is set to **סכום פתוח** because the
server supplies `sum` per package — a closed amount would mean one page, and one
`pageCode`, per price, re-created in the panel on every price change. The page's
own "the customer fills in the amount" behaviour never reaches a player: they
arrive on a process URL created with the amount already set, and
`settleDiamondPurchase` refuses to credit a capture below the row's `priceIls`
regardless. Payment options are **תשלום אחד**; never הוראת קבע, never J5 (an
authorisation without capture leaves every purchase stuck PENDING).

Then, in the Grow panel, set the callback (`notifyUrl`) to:

```
https://<your-domain>/api/pay/grow/<GROW_CALLBACK_SECRET>
```

The secret lives in the **path**, not a query string, because Grow rejects
special characters (`?`, `=`) in `notifyUrl`. It is compared in constant time and
a wrong one gets a 404, so probing cannot even establish that the endpoint
exists.

**Grow does not sign its callbacks** — so the secret URL is one of only two
things protecting the endpoint, and the second is the one that actually
matters: the amount is never read out of the callback body. Both the
callback and the browser's return re-ask Grow through `getPaymentProcessInfo`
what the order is worth, and only that answer reaches `settleDiamondPurchase`. A
caller who *learns* the secret still cannot mint a diamond.

Two things marked `VERIFY:` in `src/server/grow.ts` to confirm against the panel
before the first real charge:

1. **The order-lookup parameters.** `getPaymentProcessInfo` is called with
   `pageCode` + `processId` + `processToken`, which is the documented shape
   everywhere it appears, but Grow's public docs do not pin it down.
2. **The paid status code.** The code trusts `statusCode === "2"` (`שולם`).

Both fail **closed**: anything unrecognised leaves the purchase PENDING and
visible in `/admin/purchases` rather than crediting diamonds. A real payment
stuck PENDING is recoverable; the opposite default is not.

**Receipts are not wired for Grow.** `fetchDocuments` is optional on the provider
seam and `GrowProvider` does not implement it, so the `ReceiptButton` in the
**קבלה** column of `/admin/purchases` and on `/game/diamonds/buy/success` will
answer **"עדיין לא הונפק מסמך"** for every Grow purchase. Nothing is broken — the
seam degrades to `none` rather than erroring — but it also means the app cannot
prove a document was issued without looking in the Grow panel or a buyer's inbox.
An עוסק פטור still has to issue a receipt per sale, so before go-live decide
which of these it is:

- Grow issues the document itself (its invoicing module, if included in the new
  offer) → confirm it in the panel, and optionally implement `fetchDocuments`
  against Grow's invoice API to turn the button back on;
- an external invoicing company issues it → nothing to build; or
- you issue it manually per sale → workable at low volume, and the sale data is
  all in `/admin/purchases`.

The VAT question travels with it: the operator is an **עוסק פטור**, so no
document may break out VAT. Whatever ends up issuing the document has to be told
that — a gateway left on its default will happily print a VAT line on every
receipt, and that is a wrong tax document per sale to unwind with רשות המסים
afterwards. Confirm it on the first issued receipt, not on the hundredth.

Order of operations for go-live: Grow approves the account → fill the four
variables → sandbox test purchase → check the row in `/admin/purchases` →
`GROW_ENV=production` → one real ₪ purchase, confirm the money lands in the bank
and that a receipt was issued → `DIAMOND_PURCHASES_LIVE=true`. The interlocks in
`arePurchasesLive()` enforce that ordering; they do not enforce that you actually
looked at your bank account.

Still outstanding on the commercial side, against Grow's terms: the
per-transaction rate and any flat per-sale fee, whether there is a **minimum
monthly commission**, whether a **rolling reserve** applies to virtual-currency
merchants, and whether Bit is included. None of them block the
code — but the flat-fee answer is the one that priced the catalogue: see the
note on the entry package in `src/lib/game/diamondStore.ts`, which was raised
₪13.90 → ₪19.90 specifically because of Grow's ₪1-per-transaction fee past 20
sales a month. If the new offer changes that fee, that decision is worth
re-reading before it is re-made.

### 1.5 Edge rules for unauthenticated floods

The poll ceilings added on 07-30 and 08-01 are per-instance, in-process, and
per-empire — they blunt one hostile *signed-in* client. A distributed or
unauthenticated flood is not something app code can answer; that is Vercel WAF /
firewall rules. Configuration, not code.

---

## 2. Product decisions I did not make for you

### 2.1 Presence is a targeting oracle again

The 07-30 audit blinded `searchChatPlayers` because a name lookup answering
*"is this empire at the keyboard right now?"* is sharper intel than a spy
mission — knowing a rival is away means their gold is not banked and they will
not re-shield.

Since then the dot was deliberately added to the city ladder, the global boards
and the rival dossier. The consequence worth knowing: **the search blinding no
longer buys anything** — search by name → empire id → open the profile → read
the dot. Either the dot is intended intel everywhere (in which case putting it
back on search costs nothing) or it is not (in which case the three new places
are the leak). Right now the game is halfway between the two positions.

### 2.2 `getInboxPulse` cadence · **performance, not security**

Every signed-in player polls it every **4 seconds on every screen**, and a round
costs ~9 queries — roughly 135 queries/minute per active player, ~225 qps at 100
concurrent. The ceiling added on 08-01 stops a looping client; it does not touch
this baseline.

`VISIBLE_MS` in `src/components/game/inboxPulse.ts`: 4s → 6s cuts the hottest
path in the app by a third, for a latency change nobody will feel. Your call
whether live badges are worth the current bill on a free Neon tier.

### 2.3 Economy calls carried from earlier audits

None of these are bugs — the code does exactly what it says. They are balance
positions nobody has ruled on:

- **The wheel doubles daily**, capped at `WHEEL_MAX_DOUBLINGS` 20 → ~5.24B per
  spin from day 21, at ~6 spins/day. And `wheelPrizeAmount` keys off the *season*
  day, not the account's age, so **an account created on day 30 gets
  5.24B-a-spin prizes on its first daily update**. Clamp to account age, or lower
  the ceiling, or accept it.
- **The wheel pays diamonds** — the real-money currency — at a day-scaling rate.
- **Turns are both the cost of earning pass XP and a pass reward** (attacking is
  roughly breakeven on day 1 and runaway by day 60).
- **Tier-8 premium is a guaranteed LEGENDARY every cycle**, with no
  once-per-season guard.
- **Founding a city opens a fresh full-health boss life immediately**, bypassing
  the hourly revive, because the life is keyed `(empireId, cityTier)`. Bounded by
  the city gold wall and `MAX_CITIES` 10, so at most ten extra hauls a season.
- **Weapons are strictly better than soldiers at the boss**: the blood price is
  proportional to soldiers held while damage comes from soldiers *and* weapons,
  so the optimal build is a token garrison plus a big arsenal (measured: 200
  soldiers + weapons lost 3 where 60,000 soldiers at the same power lost 938, for
  the same haul and the same grade).
- **Per-target attack cooldown / daily hit cap** — explicitly declined on 07-23;
  turns are the only limit on attacking. Listed so the decision stays visible,
  not to reopen it.

### 2.4 Registration answers whether an email is registered

Decided on 2026-08-01 to leave it. Closing it properly means signup stops
creating a session, `verifyEmailToken` creates it instead, and resend works off a
short-lived cookie — a rebuild of the most critical path in a live app that takes
money, to close an oracle already capped at 5 attempts/hour/IP. Login itself is
fully enumeration-hardened. **Do not "fix" this without deciding to do the whole
rebuild.**

---

## 3. Latent — no action needed yet, but do not lose it

### 3.1 Google ID tokens are accepted without a nonce

`verifyGoogleIdToken` checks issuer, audience, expiry and `email_verified`,
which is correct for a single-origin GIS button. A replayed token from another
origin becomes reachable the moment the OAuth client gains a **second authorised
origin** (a staging domain, a mobile app, a custom domain added alongside
`imperium-rho.vercel.app`). Add the nonce round-trip *before* adding that origin,
not after.

### 3.2 Keep the privacy policy in step with the schema

The `signupIp`/`lastLoginIp` columns landed on 07-31 and the policy still
described IPs as rate-limiter-only until 08-01. **Adding a column that holds
personal data means editing `src/app/privacy/page.tsx` and bumping
`LEGAL_UPDATED.privacy` in the same change** — a published policy that no longer
describes what the database holds is the kind of gap that is only ever found by
the wrong person.

### 3.3 The shared rate limiter fails open

`rateLimit` returns `true` when Postgres is unreachable, deliberately: a limiter
that takes signup and login down with the database is a worse outage than the one
it prevents, and the in-process pre-filter still caps what one instance passes
through. Documented here so it is a known position rather than a discovery.

---

## Where the detail lives

Each item's full reasoning, measurements and the code it touches are in the
audit notes for the pass that found it: 07-23 (pre-launch), 07-25, 07-26, 07-27,
07-29, 07-30 and 08-01.
