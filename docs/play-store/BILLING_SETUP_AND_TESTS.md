# Google Play billing setup and acceptance tests

Status reviewed October 25; wrapper compatibility updated October 26, 2026 (America/New_York).

## Current state

The owner confirmed that Play subscriptions are not set up. The Android distribution is a Bubblewrap Trusted Web Activity, package `ai.allfantasy.app`. The repository currently blocks Android checkout; web purchases use Stripe. The TWA manifest has no Play Billing feature enabled. There is no Google purchase verification endpoint, receipt ownership store, renewal/refund notification handler, or restore implementation yet. A website deploy alone cannot provide Play purchases.

This is the next implementation priority. Do not activate Play products for sales or advertise Android purchases until the implementation and device tests below pass. Existing web and Apple entitlements must remain readable across platforms, with purchase source kept for billing management.

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
