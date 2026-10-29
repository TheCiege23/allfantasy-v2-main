# Google Play billing ownership and fulfillment

Status: implemented behind disabled configuration; production enablement pending.
Date: October 26, 2026 (America/New_York).

## Context

The Android app is a Bubblewrap Trusted Web Activity. Web Stripe purchases and Apple StoreKit purchases already use the shared entitlement and token ledgers. The site remains free for ordinary use. Subscriptions unlock their documented features without token bundles. Optional packs contain 250, 600 or 1,500 tokens.

## Decision

- Use eight subscription product IDs (a separate monthly and yearly ID), one `standard` auto-renewing base plan each, and no introductory offers. Use the existing Play `af_war_room` product IDs for the customer-facing Legacy tier; do not create duplicate products. Three one-time products share the existing token SKUs.
- Verify every receipt against Publisher `subscriptionsv2` or `productsv2`. Product, type, quantity, base plan and current payment state must match. Never accept price, ownership, status or expiry from the client.
- Store package-scoped receipt hashes with AES-256-GCM encrypted purchase tokens. Raw tokens never enter entitlement metadata, token history, logs or analytics. The encryption key must be retained; key rotation requires re-encryption.
- Bind ownership permanently. The stock released TWA bridge cannot sign an AllFantasy account ID into BillingClient. Require an authenticated, persisted checkout authorization for the first claim, bound to one receipt; check purchase time and reject consumed unclaimed packs. If a native signed account ID is present, validate its hash. Existing receipt restores must match the owner. Linked subscription replacements inherit and verify the original owner.
- The TWA first-claim rule does not prove the Google account identity. An attacker with a stolen fresh purchase token and matching checkout authorization timing could race the first claim. Strict purchase-time binding requires a tested native bridge that calls `setObfuscatedAccountId`; passing an unsupported PaymentRequest property is insufficient. Do not market first-claim binding as native account verification.
- Commit access or token credit before acknowledging/consuming with Google. Shared durable purchase/reversal keys make retries and refunds idempotent. A consume failure leaves fulfillment complete and an acknowledgment retry for the hourly maintenance pass.
- Pending payments grant nothing. Cancellation preserves paid access until expiry. Grace follows Google's expiry; hold, pause and expiry immediately stop access. Renewals extend one entitlement and create no token credit.
- Authenticate Pub/Sub OIDC tokens against Google's keys, the configured audience and verified service-account email. Pin the subscription resource and package. Notifications trigger fresh Publisher reads, so old event timestamps cannot overwrite newer subscription state. Full pack reversals use durable tombstones, including a refund delivered before the receipt. A subscription void triggers a current-state read, preserving a later valid renewal.
- Cancel Play renewals before account erasure; a provider failure prevents deletion. Retain receipt ownership after deletion and refuse any later fulfillment into the anonymized account.
- Reconcile missed notifications and the last 29 days of voided purchases from the existing hourly `reap-sync-runs` maintenance job; bounded batches prioritize the least recently checked receipt. Failures appear in maintenance warnings. A dedicated authenticated endpoint permits manual retry without another cron slot.

## Alternatives considered

A single product with monthly/yearly base plans cannot reliably select the intended option with the released Billing 8 TWA bridge. Client-only acknowledgment loses recovery and ownership guarantees. Reusing Stripe checkout inside the Play app would not implement Google Play billing. A custom native bridge gives stronger account attribution but needs a separately reviewed, signed app update and device tests.

## Release gates

1. Apply the additive, LF-only migration through the guarded production command.
2. Grant Publisher permissions, configure encrypted receipts and authenticated RTDN with a dead-letter queue, then send a Console test notification.
3. Create and validate all 11 products; keep website billing flags disabled during setup.
4. Rebuild with Bubblewrap 1.25.0 or later, ABH billing 1.2.0 / Billing Library 8.3.0 or compatible newer, the existing upload key and an incremented verified version code.
5. Complete the internal-track device matrix before setting both catalog-ready and billing-enabled flags. Stock TWA ownership limitations must be accepted or resolved by a native extension.

## Verification

Isolated ordinary-account PostgreSQL tests exercise purchase/consume ordering, concurrent duplicate receipts, single-use authorization, cross-account restore rejection, pending payments, refunds before/after fulfillment, consumed-pack rejection, cancellation, grace, hold, pause, expiry and renewals with no token bundle. Browser API tests exercise localized billing intervals, cancellations, overlapping clicks and receipt recovery. Signed JWT tests cover Pub/Sub audience, issuer, expiry and service-account claims. These do not substitute for real Play checkout or an Android device.
