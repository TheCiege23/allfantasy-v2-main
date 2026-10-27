# Google Play billing setup and acceptance tests

Implementation reviewed October 26, 2026 (America/New_York).

## Current state

The Android distribution is a Bubblewrap Trusted Web Activity, package `ai.allfantasy.app`. The repository now implements Google Publisher verification, encrypted receipts with permanent ownership, token fulfillment/reversal, subscription lifecycle updates, authenticated Pub/Sub notifications, restore, native localized prices, renewal cancellation on account deletion and hourly reconciliation. Checkout is disabled by default. Web Stripe and Apple purchase paths remain available.

**Not activated or device verified:** Play products, Publisher credentials and Pub/Sub must be configured, the additive receipt migration must be applied, and a signed internal-track app must pass the device matrix below. The checked-in wrapper template keeps billing disabled; the private `C:/af-twa` manifest already has billing enabled and version code 3, but no generated project or new signed bundle was inspected. Read the actual latest Play version code before building. A website deploy alone cannot complete the Play release.

The first claim of a stock TWA purchase requires the signed-in account's saved checkout authorization; every later restore must match its permanent owner. An unclaimed purchase with lost local authorization needs support review. The released TWA bridge does not sign an AllFantasy account ID, so first-claim binding cannot prove Google-account identity. See the [ownership decision](../architecture/google-play-billing.md).

Do not advertise Android purchases until setup and real device tests pass. Existing subscriptions grant no token bundle on renewal.

## Proposed Console catalog

These identifiers are proposals, not configured products. For the stock TWA bridge, create **eight subscription products**, one per billing interval. Each product should have one eligible auto-renewing base plan (`standard`) with the matching period and no introductory offers at launch. Map the verified product AND base-plan identifier to the internal SKU; never trust a SKU from a client request.

Do not combine monthly and yearly base plans under one product with this wrapper. The current Digital Goods bridge exposes the first eligible plan/offer, so it cannot reliably offer both intervals for one product. Verify the returned billing period before purchase. See [Google's Billing 8 migration guide](https://github.com/GoogleChrome/android-browser-helper/blob/main/playbilling/docs/play-billing-library-8-migration.md).

| Proposed Play product IDs (monthly / yearly) | Display name | Base plan on each | Current US catalog monthly / yearly | Internal SKUs |
| --- | --- | --- | --- | --- |
| `af_pro_monthly` / `af_pro_yearly` | AF Pro | `standard` | $9.99 / $79.99 | `af_pro_monthly` / `af_pro_yearly` |
| `af_commissioner_monthly` / `af_commissioner_yearly` | AF Commissioner | `standard` | $14.99 / $129.99 | `af_commissioner_monthly` / `af_commissioner_yearly` |
| `af_legacy_monthly` / `af_legacy_yearly` | AF Legacy | `standard` | $9.99 / $79.99 | `af_war_room_monthly` / `af_war_room_yearly` |
| `af_supreme_monthly` / `af_supreme_yearly` | AF Supreme | `standard` | $19.99 / $159.99 | `af_supreme_monthly` / `af_supreme_yearly` |

Supreme includes Pro and Commissioner for new purchases. Legacy remains separate. Preserve benefits already grandfathered onto existing subscribers. Plans grant feature access and their published Chimmy allowance; they do not mint token packs each renewal.

For one-time consumable products, propose:

| Proposed product ID / internal SKU | Tokens | Current US catalog price |
| --- | ---: | ---: |
| `af_tokens_5` | 250 | $4.99 |
| `af_tokens_10` | 600 | $8.99 |
| `af_tokens_25` | 1,500 | $19.99 |

Use Play's localized price returned by the Digital Goods API for the Android confirmation screen. Store currency conversion, taxes, and base-plan pricing can differ by region; never present a web USD price as the amount Play will charge.

## Implementation and operator setup

1. In Play Console for `ai.allfantasy.app`, set up the eight subscription products and their single base plans above, descriptions, availability, and pricing. Record the actual identifiers after creation.
2. Configure Android Publisher API service-account access with the permissions needed to verify purchases, acknowledge subscriptions, consume fulfilled packs, and reconcile voided purchases. The existing install-report service account is not evidence that these purchase permissions exist. Keep credentials in deployment secrets.
3. Implement a server-only verified receipt store with globally unique purchase identity, immutable AllFantasy account ownership, protected purchase tokens, authoritative product/state/expiry, and fulfillment status. Never place raw purchase tokens in user-visible token history, responses, logs, or analytics.
4. Implement Digital Goods API + Payment Request checkout, pending/cancelled handling, retryable verification, and restore from `listPurchases()`. Verify with Publisher API before granting anything. Grant a pack exactly once, then consume; an acknowledgment/consumption retry must never mint more tokens. Subscriptions are acknowledged after durable entitlement creation. Google requires timely acknowledgment; unacknowledged test purchases are refunded quickly.
5. Implement authenticated real-time developer notifications (RTDN) using Pub/Sub and the Publisher API as the current source of truth, including duplicates and out-of-order events. Cancellation stops future renewals and keeps access until expiry; expiry, hold, pause, or revocation must follow authoritative state. Add reconciliation for missed notifications and voided one-time purchases.
6. Account binding needs explicit design. The current TWA bridge does not provide the native BillingClient `setObfuscatedAccountId` API; an arbitrary Payment Request property does not make Google sign an account identifier. At minimum, bind the first verified receipt claim immutably to the authenticated AllFantasy account and reject transfers. Preserve unfinished purchase receipts so a connection failure cannot lose fulfillment. If strict purchase-time account attribution is required, implement and verify native bridge support first. See the [browser-helper issue](https://github.com/GoogleChrome/android-browser-helper/issues/583).
7. Rebuild with Bubblewrap 1.25.0 or newer and verify the generated billing dependency uses Android Browser Helper billing 1.2.0 / Play Billing Library 8.3.0 or a compatible newer release. Published migration guidance requires Billing 8 for new updates. `listPurchaseHistory()` now returns an empty list; historical fulfillment must live on the server. Set `features.playBilling.enabled=true` in the Android wrapper manifest only when the server/client paths are ready. Regenerate the private Android project, increment the actual current version code, sign with the existing upload key, and upload an internal testing build. Follow [RUNBOOK.md](./RUNBOOK.md); never commit the generated Android project or keystore.
8. Add the Google account used on the Android device to the internal test track and Play license testers. The Play tester address must identify that Google account. AllFantasy login may use a different verified email. Neither email nor password belongs in public test fixtures.

The provided AllFantasy review account exists, is verified, and has no active paid subscription. Its current token balance is 10. It was inspected read-only and not modified. Live runtime bypass and checkout still require a signed-in walkthrough; isolated tests use ordinary disposable accounts without bypasses.

## Deployment configuration and internal testing

Keep private values in hosting secrets. No credential, purchase token, keystore or tester password belongs in this public repository.

| Setting | Required value |
| --- | --- |
| `GOOGLE_PLAY_BILLING_SERVICE_ACCOUNT_JSON` | Android Publisher service-account JSON or base64. The existing install-report key is a fallback, but its purchase permissions must be verified. |
| `GOOGLE_PLAY_PURCHASE_ENCRYPTION_KEY` | Random 32-byte key encoded as 64 hex characters. Retain it for receipt recovery; rotation requires re-encryption. |
| `GOOGLE_PLAY_RTDN_AUDIENCE` | `https://www.allfantasy.ai/api/webhooks/google-play` (match Pub/Sub OIDC audience exactly). |
| `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` | Service account used by Pub/Sub to sign push requests. Require verified email. |
| `GOOGLE_PLAY_PUBSUB_SUBSCRIPTION` | Exact `projects/PROJECT/subscriptions/SUBSCRIPTION` resource. |
| `GOOGLE_PLAY_CATALOG_READY` | `true` only after all products and intervals are verified. |
| `GOOGLE_PLAY_BILLING_TEST_USER_IDS` | Comma-separated ordinary AllFantasy user IDs allowed to run license tests while public billing remains off. These are app users, not the Google license-tester emails. |
| `GOOGLE_PLAY_BILLING_ENABLED` | Keep `false` until the internal-track device matrix passes; then set `true` for public checkout. |

Enable Publisher API and grant app-scoped permissions to view purchases, manage orders/subscriptions, acknowledge/consume, cancel on account deletion, and list voided purchases. Configure a Pub/Sub topic for Play RTDN, grant Google's Play notifications service publishing access, and create an authenticated HTTPS push subscription with a dead-letter topic. Set that topic in Play Console and send its test notification; the webhook must return 200 only for the expected signed identity, audience, resource and package.

The existing hourly `/api/cron/reap-sync-runs` runs Play reconciliation after configuration is present and reports failures in maintenance warnings. `/api/cron/google-play-billing` permits an explicit retry with `Authorization: Bearer <CRON_SECRET>`; it adds no scheduled job. Track consume/acknowledgment failures before Google's acknowledgment deadline. Voided purchases are re-read over a rolling 29-day overlap. A long outage beyond that window requires an operator backfill.

Apply `20261027010000_google_play_billing_receipts` using the guarded production migration command after reviewing pending migrations. Keep SQL LF-only. Deploy the website with billing disabled. Test with ordinary allowlisted app accounts and Google license-test payment methods on an internal-track installation before public activation. Do not use real cards to prove the integration.

Local verification includes 14 isolated PostgreSQL Play lifecycle cases, state validation, browser API checkout/recovery tests, and signed Pub/Sub JWT tests. Those are simulated Publisher responses and do not constitute real Play purchase, refund, restore or renewal tests.

## Device acceptance matrix (pending)

Use the app installed through the internal Play track and Google's test payment methods; do not purchase a live product with a real card for this check.

| Scenario | Required result |
| --- | --- |
| Free account | Dashboard, notifications, community chat and useful analysis summaries remain available; two detailed Chimmy answers/day; paid depth shows its price before consent. |
| Monthly versus yearly | Separate products return and charge the selected period and localized price; reject unexpected periods before purchase. |
| Successful subscription | One verified entitlement; correct family/base plan, localized charge, 100 Chimmy answers only for eligible plans; no token bundle minted. |
| Token purchase | Exactly 250/600/1,500 tokens, as selected; consume after durable credit. |
| Declined / cancelled / pending payment | No entitlement, debit, or token credit before a verified purchase. |
| Network loss after payment | Retry/restore fulfills the paid receipt once without a second purchase. |
| Reinstall / restore / second device | Active subscription returns to its bound account; spent or consumed token packs do not refill. |
| Different AllFantasy account | An already claimed receipt cannot transfer or mint another pack. |
| Exact token spend | Quoted amount equals the ledger debit; changed quote requires new consent. |
| Tool failure and retry | Failed work refunds exactly the original debit once; successful retry cannot double-charge. |
| Full pack refund / void | Remove recoverable tokens once, release unbacked holds, preserve non-negative balance; delayed purchase events cannot regrant. |
| Subscription cancellation | Access through the paid expiry; no future billing unless restarted. |
| Accelerated renewal | New paid period extends access once; duplicate/delayed notifications do not roll access backward or grant tokens. |
| Grace / hold / expiry / recovery | Entitlement follows authoritative state, recovers only after valid payment, and cannot be revived by stale notifications. |

Official references: [TWA Play Billing integration](https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing), [Play billing tests](https://developer.android.com/google/play/billing/test), [subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions), [one-time purchase lifecycle](https://developer.android.com/google/play/billing/lifecycle/one-time).
