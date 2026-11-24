# Commissioner Partner Codes

Commissioners claim their own code (e.g. `TheCiege`) and share it. A friend who
joins with it gets **10% off their first 3 months**. The commissioner unlocks
free plans as their community grows, and earns **10% of what their paid
subscribers pay**, every month.

Everything is behind `PARTNER_CODES_ENABLED`. Nothing is visible and no webhook
side effect runs until it is `1`.

## The rules (all editable at `/admin/partner-codes`)

| Setting | Default | Meaning |
|---|---|---|
| Friend discount | 10% for 3 months | Monthly: 10% off the first 3 bills. Yearly: 10% × 3/12 off the first year, once ($4.00 on AF Supreme yearly). |
| Commission | 10%, flat | Of what the subscriber paid, after processor / store fees and refunds (`net`). Never rises with volume. |
| Cash starts at | 10 paid subscribers | Only payments made after that moment earn. No back pay. |
| AF Commissioner free | 15 active users, held 30 days | |
| AF Supreme free | 50 active users held 30 days, **or** 10 paid subscribers | |
| Grace | 30 days | A free plan stays on 30 days after dropping below its bar. |
| Active user | 4+ days in the last 28 | Free or paid. A paid subscriber always counts as active. |
| Payment clears | 30 days | A subscriber counts on the paid meter, and a payment is paid out, once it is 30 days old with no refund. |
| Minimum payout | $25 | Smaller balances roll over. |
| Per-subscriber cap | none | Optional: stop after N months per subscriber. |
| Code changes | 2 a year | Old codes keep working. |

### Yearly plans, cancels, refunds

- **Yearly** payments are paid out 1/12 a month for 12 months (`planAccrual`).
- **Monthly cancel**: commission stops at the next bill they don't pay. Nothing is taken back.
- **Yearly cancel without refund**: keeps paying out through the paid year.
- **Refund / chargeback**: that payment's commission is reversed in proportion.
  Unpaid slices are cancelled; anything already paid out becomes a negative
  entry on the next statement. A commissioner is never billed — a negative
  balance carries forward (`planReversal`, `buildPayout`).
- **Duplicate webhooks** can't pay twice: ledger rows are unique on
  `(source, sourceRef, installment)`.

All of this is pure code in `lib/partner-codes/{settings,money,meters,code,fraud}.ts`,
and `__tests__/partner-codes/rules.test.ts` is the rulebook.

### A free plan stops the paid one it covers

Owner's rule (2026-11-23). When a commissioner unlocks a free plan, any paid plan it covers stops
renewing (`lib/partner-codes/paidPlanOverlap.ts`). AF Supreme covers paid AF Supreme, AF Commissioner
and AF Pro; AF Commissioner covers paid AF Commissioner. AF Legacy is never touched.

- **Stripe:** `cancel_at_period_end`. They keep what they paid for until the period ends, then the free
  plan carries on. No refund, nothing taken away early. Checked daily, so a plan bought later is caught too.
- **Apple / Google:** we can't cancel a store subscription, so the commissioner is emailed how to,
  once, on the day the free plan unlocks.
- If the free plan later ends, they subscribe again like anyone else.

### App Store and Google Play subscribers

**The friend discount is web-only** (owner's call, 2026-11-23). Apple ties a custom offer code to ONE
subscription product, and Google Play promo codes can only be made by hand, so a code cannot give 10% off
every plan in the apps. Friends get the discount by subscribing on the web through the `/with` link.
Subscribers who pay in the apps still count on both meters and still earn their commissioner commission.

`lib/partner-codes/storeLedger.ts`. Who brought a subscriber comes from their AllFantasy account (the
`/with` link at signup, or a typed code), exactly like web, so commissioners earn on app subscribers
with no store setup. Commission is 10% of what the store pays us: the price paid minus
`storeFeePercent` (15% default, editable in admin).

- **Apple:** App Store Server Notifications. A renewal/new subscription records the payment (keyed on the
  transaction id); a refund reverses it; expiry stops the subscriber counting. Price comes from the
  transaction in USD, else the catalog price. A commissioner's offer code redeemed in Apple's own sheet
  attaches the subscriber to that commissioner.
- **Google Play:** each new order id seen on sync is a payment (keyed on the order id) at the catalog
  price, since Play's subscription state does not carry the price; a voided order reverses it.

### Commissioner logos

`lib/partner-codes/logo.ts`. A commissioner can upload their own logo for their share images
(PNG/JPG/WebP, up to 5 MB, at least 128 px, 5 uploads a day).

- Every upload is re-drawn as a 512×512 PNG before it is stored (Blob / UploadThing, folder
  `partner-logos/`). That strips GPS and camera data, flattens animation, and means we never serve the
  bytes someone sent.
- It then waits for review in **Logos to review** at `/admin/partner-codes`. Nothing shows on a share
  image until it is approved; until then images use initials. A rejection carries a reason the
  commissioner sees (team/brand logo, not appropriate, hard to see).
- There is no automatic image check: the app has no image-moderation service today, so admin review
  is the gate.

### Payouts through Stripe Connect

`lib/partner-codes/connect.ts`. Each commissioner gets a Stripe v2 connected account configured as a
**recipient** (receives transfers only), Express dashboard. "Set up payouts" on `/partner-code` opens
Stripe's hosted onboarding, which collects identity, bank details and US tax info (replacing the hand-kept W-9).

- **Approving a statement sends it** as a transfer from AllFantasy's Stripe balance, keyed on the payout id
  (a retry or double click can never pay twice). Readiness is re-checked first on the v2 path
  `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active'`.
- A failed transfer stays `approved` with the reason (never Stripe's raw text); **Retry send** in admin.
  An empty platform balance is named as such.
- **Send without approval** (`autoSendMaxCents`, default 0 = off): statements up to the cap go out on
  their own when the account is active and no subscriber on them is flagged.
- Statements held for setup are released by the daily job once the account turns active.
- Commissioners not on Connect still work the old way: approve, then **Mark paid** by hand.

**One-time owner setup before this works:** enable Connect on the Stripe account (Dashboard → Connect),
and keep enough available USD balance to cover approved statements. If you want Stripe to file the 1099s,
turn on tax forms for connected accounts in the Connect settings.

## Scheduled work

No cron slot of its own: the repo is at its cron ceiling (`docs/crons.md`). Once a day the existing
`/api/cron/stripe-key-health` job calls `runPartnerScheduled()` (`lib/partner-codes/jobs.ts`):

- **daily** — active-user days, both meters, free plans granted/renewed/removed, the cash unlock, yearly slices coming due.
- **monthly** — last month's statements (`pending_review`, or `held` without a W-9). Idempotent, one per code per month,
  so running daily is safe and catches up a missed 1st. No money moves; an admin approves each one.

It has its own heartbeat (`sync_job_runs` job `partner-codes`), catches its own errors, and never changes
the Stripe key check's status.

## Env vars

| Var | Purpose |
|---|---|
| `PARTNER_CODES_ENABLED=1` | Turns the program on (pages, APIs, webhook hooks, jobs). |
| `PARTNER_DEMO=1` | Shows seeded demo data with a "Demo" banner. Never set in production. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Already used by billing; nothing new. |

## Demo

```
npx tsx scripts/seed-partner-demo.ts
```

Creates commissioner `DEMOCOMMISH` with ~1,250 referrals, 6 months of ledger and
payouts. It refuses to run unless the database is positively not production
(see the script header).

## Stripe CLI check

```
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger invoice.paid
```
