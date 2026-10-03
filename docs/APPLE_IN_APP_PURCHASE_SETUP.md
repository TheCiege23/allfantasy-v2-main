# Apple In-App Purchase setup for AllFantasy

The web app continues to use Stripe. The iOS App Store app must offer Apple In-App Purchase for the same digital subscriptions and token packs that unlock features in the app. The same signed-in AllFantasy account receives access from either source.

## What this repository provides

- `GET /api/monetization/apple/products` returns the signed-in user's UUID as `appAccountToken` and the allowed product IDs.
- `POST /api/monetization/apple/transactions` accepts `{ "signedTransactionInfo": "<StoreKit JWS>" }` from the signed-in iOS app. The server verifies the JWS, fetches the transaction's current state from Apple, checks the app account token and catalog SKU, and grants the subscription or token pack once.
- `POST /api/monetization/apple/notifications` receives App Store Server Notifications V2. Its signed notification and transaction are verified before subscription renewals, expirations, or refunds affect the account.
- Existing Stripe checkout remains the web purchase path. Apple and Stripe purchases write to the same subscription and token stores.

## App Store Connect configuration

1. Accept the Paid Apps Agreement and complete tax and banking information.
2. For this app's bundle ID, enable the In-App Purchase capability.
3. Create auto-renewable subscriptions with **exactly** these product IDs: `af_pro_monthly`, `af_pro_yearly`, `af_commissioner_monthly`, `af_commissioner_yearly`, `af_war_room_monthly`, `af_war_room_yearly`, `af_supreme_monthly`, `af_supreme_yearly`. Put the monthly and yearly variants for a plan in one subscription group. Because the plan families can coexist, use separate groups for each family.
4. Create consumable In-App Purchases with product IDs `af_tokens_5` (250 tokens), `af_tokens_10` (600 tokens), and `af_tokens_25` (1,500 tokens). Set prices and customer-facing descriptions in App Store Connect. The IDs must match `lib/monetization/catalog.ts`.
   The fill-in sheet below lists the exact price and copy for each product.
5. Under **Users and Access → Integrations → In-App Purchase**, create an In-App Purchase key. Record the issuer ID and key ID and securely store the downloaded `.p8` private key.
6. Configure **App Store Server Notifications V2** for production and sandbox to `https://allfantasy.ai/api/monetization/apple/notifications` (or the actual deployment host).

## App Store Connect fill-in sheet

Prices are the USD `amountUsd` values in `lib/monetization/catalog.ts`, so web (Stripe) and iOS charge the same. The iOS paywall displays the `displayPrice` StoreKit returns, so the price entered here is exactly what iPhone users see. If a price changes in the catalog, change it here and in App Store Connect too.

Apple limits a display name to 30 characters and a description to 45; the catalog's web descriptions are longer, so use the shortened versions below. Product IDs cannot be edited or reused after creation, so copy them exactly.

For each product: set **Subscription Prices** (or **Price Schedule** for tokens) with **United States (USD)** as the base country and let Apple generate other storefronts. Then add the **Localization** (English (U.S.)) and a **Review Screenshot** of the iOS paywall showing that product.

### Subscription groups (auto-renewable)

Create one group per plan family. Give each group an English (U.S.) localization whose display name matches the group name. Put monthly and yearly at the same level (level 1) inside their group.

| Group | Product ID | Reference name | Duration | Price (USD) | Display name | Description |
|---|---|---|---|---:|---|---|
| AF Pro | `af_pro_monthly` | AF Pro | 1 month | 9.99 | AF Pro Monthly | Player & trade analysis, Competitive Edge |
| AF Pro | `af_pro_yearly` | AF Pro Yearly | 1 year | 79.99 | AF Pro Yearly | Player & trade analysis, Competitive Edge |
| AF Commissioner | `af_commissioner_monthly` | AF Commissioner Monthly | 1 month | 14.99 | AF Commissioner Monthly | League health, integrity checks and recaps |
| AF Commissioner | `af_commissioner_yearly` | AF Commissioner Yearly | 1 year | 129.99 | AF Commissioner Yearly | League health, integrity checks and recaps |
| AF Supreme | `af_supreme_monthly` | AF Supreme Monthly | 1 month | 19.99 | AF Supreme Monthly | AF Pro and AF Commissioner in one plan |
| AF Supreme | `af_supreme_yearly` | AF Supreme Yearly | 1 year | 159.99 | AF Supreme Yearly | AF Pro and AF Commissioner in one plan |
| AF Legacy | `af_war_room_monthly` | AF Legacy Monthly | 1 month | 9.99 | AF Legacy Monthly | Draft intel, dynasty tools, priority access |
| AF Legacy | `af_war_room_yearly` | AF Legacy Yearly | 1 year | 79.99 | AF Legacy Yearly | Draft intel, dynasty tools, priority access |

AF Legacy (`af_war_room_*`) was removed from the launch pricing page on 2026-09-24, but it still sells from `/upgrade?plan=war_room` and the iOS shell requests it. If it is not created in App Store Connect, StoreKit omits it and an iOS purchase of Legacy fails with no price shown. Create it unless the plan is being retired.

### Consumables (token packs)

| Product ID | Reference name | Price (USD) | Display name | Description |
|---|---|---:|---|---|
| `af_tokens_5` | Tokens 250 | 4.99 | Starter Tokens (250) | 250 tokens for premium one-off actions |
| `af_tokens_10` | Tokens 600 | 8.99 | Plus Tokens (600) | 600 tokens for premium one-off actions |
| `af_tokens_25` | Tokens 1500 | 19.99 | Token Pack (1,500) | 1,500 tokens for premium one-off actions |

The token amount granted comes from `tokenAmount` in the catalog, not from App Store Connect. The display name only has to describe it accurately.

### Submitting

The first subscription group and the first consumables must be submitted **with a new app version**. On that version's page, under **In-App Purchases and Subscriptions**, select all of the products above before submitting the build. **Add for Review** on an individual subscription only queues it; it does not submit it.

## Server environment

Set these as server-side secrets in the deployment. Never use a `NEXT_PUBLIC_` prefix or commit the private key.

| Variable | Value |
| --- | --- |
| `APPLE_IAP_BUNDLE_ID` | `ai.allfantasy.app` — the App Store Connect app record's Bundle ID and `appId` in `ios-app/capacitor.config.json`. The server rejects every transaction signed for any other bundle. |
| `APPLE_IAP_APP_APPLE_ID` | Numeric Apple ID shown for the app in App Store Connect |
| `APPLE_IAP_KEY_ID` | In-App Purchase key ID |
| `APPLE_IAP_ISSUER_ID` | In-App Purchase issuer ID |
| `APPLE_IAP_PRIVATE_KEY` | Contents of the `.p8` key; literal `\n` escapes are accepted |
| `APPLE_IAP_ROOT_CERTIFICATES_BASE64` | Apple PKI root certificates, DER-encoded and base64-encoded, separated by commas |

Download trusted Apple root certificates from [Apple PKI](https://www.apple.com/certificateauthority/) and encode the **DER** files as base64. Apple's official server library validates the full signed certificate chain. Deploy the database migration before enabling purchases.

## iOS app

The app is the Capacitor shell in `ios-app/` (bundle ID `ai.allfantasy.app`). An earlier PWABuilder wrapper (`ios-pwabuilder/`, bundle `ai.allfantasy.www`) carried the first version of this bridge; it never shipped under the App Store Connect record and was removed when the bridge moved here.

- `ios-app/ios/App/App/AppleIAPHandler.swift` is registered by `AppBridgeViewController` as the WebView's `apple-iap` script message handler, accepting messages only from the main frame of `https://www.allfantasy.ai` / `https://allfantasy.ai`. It loads StoreKit products, purchases with the signed-in user's `appAccountToken`, returns Apple's signed transaction to the page, restores entitlements plus unfinished purchases, and opens Apple's Manage Subscriptions sheet. It finishes a transaction only when the page reports that our server granted it. It also listens to `Transaction.updates` from launch: renewals are finished there (the notification endpoint grants them); consumables are left unfinished for Restore Purchases to grant.
- The app appends `AllFantasyiOS/1.1 AFIAP/1` to its User-Agent (`ios-app/capacitor.config.json`). `AFIAP` tells the website this build can buy: middleware reopens `/upgrade`, `/pricing`, `/commissioner-upgrade` and `/tokens`, and `html[data-ios-iap]` unhides their links and the `data-ios-purchase` copy (`lib/platform/iosApp.ts`, `app/globals.css`). A 1.0 build has no `AFIAP` and keeps the full no-purchase gate. Stripe checkout, the billing portal, donations, the marketplace and league dues stay refused in every build.
- `lib/monetization/checkout-client.ts` sends any purchase made inside the app to the bridge; browsers keep Stripe. Both Stripe checkout routes also refuse the app's User-Agent (`isAppleIosShellRequest`). The paywalls show StoreKit's localized prices, Restore Purchases and Manage Subscriptions.

**A web deploy cannot add the Swift code to a build already in App Store Connect.** Run the **ios-testflight** workflow (no Mac needed — see `docs/app-store/RUNBOOK.md`) with the version that is open in App Store Connect (`1.0` while it has never been released — the `1.1` in the User-Agent is only a label), sandbox-test, then submit that build with the in-app purchases.

The iOS paywalls include Restore Purchases and Manage Subscriptions. The latter opens Apple's subscription management sheet. The server notification endpoint handles renewals and refunds that happen outside the purchase screen.

## Release checks

- Test every SKU with an Apple Sandbox account, including cancellation, renewal, refund, repeat submission of the same transaction, and sign-in on a second device.
- Confirm one Apple token transaction creates only one token credit, even when client retries and notifications arrive.
- Confirm Apple and Stripe subscribers receive the same feature access, and Apple and Stripe token purchases appear in the same balance.
- Confirm a refunded transaction cannot be resubmitted to regain access.
- In App Review notes, explain that web purchases use Stripe, iOS in-app purchases use StoreKit, and both grant access to the same signed-in account.

Official references: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi), [App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications), [Apple's Node server library](https://github.com/apple/app-store-server-library-node).
