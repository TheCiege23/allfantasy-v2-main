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
