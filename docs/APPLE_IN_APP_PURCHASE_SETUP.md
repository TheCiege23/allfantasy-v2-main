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
5. Under **Users and Access → Integrations → In-App Purchase**, create an In-App Purchase key. Record the issuer ID and key ID and securely store the downloaded `.p8` private key.
6. Configure **App Store Server Notifications V2** for production and sandbox to `https://allfantasy.ai/api/monetization/apple/notifications` (or the actual deployment host).

## Server environment

Set these as server-side secrets in the deployment. Never use a `NEXT_PUBLIC_` prefix or commit the private key.

| Variable | Value |
| --- | --- |
| `APPLE_IAP_BUNDLE_ID` | `ai.allfantasy.www` (confirm this matches the App Store Connect app record) |
| `APPLE_IAP_APP_APPLE_ID` | Numeric Apple ID shown for the app in App Store Connect |
| `APPLE_IAP_KEY_ID` | In-App Purchase key ID |
| `APPLE_IAP_ISSUER_ID` | In-App Purchase issuer ID |
| `APPLE_IAP_PRIVATE_KEY` | Contents of the `.p8` key; literal `\n` escapes are accepted |
| `APPLE_IAP_ROOT_CERTIFICATES_BASE64` | Apple PKI root certificates, DER-encoded and base64-encoded, separated by commas |

Download trusted Apple root certificates from [Apple PKI](https://www.apple.com/certificateauthority/) and encode the **DER** files as base64. Apple's official server library validates the full signed certificate chain. Deploy the database migration before enabling purchases.

## iOS wrapper

The PWABuilder Xcode project provided by the owner is in `ios-pwabuilder/src/AllFantasy.xcworkspace`. The owner must copy `GoogleService-Info.plist` from the original PWABuilder ZIP to `ios-pwabuilder/src/AllFantasy/GoogleService-Info.plist` before building; this Firebase configuration is intentionally excluded from the public repository. Its bundle ID is `ai.allfantasy.www`. `ViewController.swift` registers an `apple-iap` script handler for the first-party HTTPS page. It loads StoreKit products, makes purchases with the signed-in user's `appAccountToken`, returns Apple's signed transaction to the web client, and restores entitlements plus unfinished purchases. The web client verifies each transaction with the server before asking StoreKit to finish it. The shared checkout function routes iOS app purchases to this bridge while browsers continue using Stripe. The iOS paywalls show StoreKit localized prices and a Restore Purchases button. Both Stripe checkout API routes reject requests from the PWABuilder iOS shell; an older shell without the bridge displays an update message.

**The build already submitted for review cannot gain this Swift code through a web deployment.** Open the workspace on a Mac with Xcode, set your Apple Developer signing team, build and sandbox-test, then submit a new build. The project build number was raised from 1 to 2; raise it again if build 2 is already used in App Store Connect. PWABuilder's standard wrapper did not include this native purchase bridge. See [PWABuilder's iOS FAQ](https://github.com/pwa-builder/PWABuilder/blob/main/docs/builder/faq.md).

The iOS paywalls include Restore Purchases and Manage Subscriptions. The latter opens Apple's subscription management sheet. The server notification endpoint handles renewals and refunds that happen outside the purchase screen.

## Release checks

- Test every SKU with an Apple Sandbox account, including cancellation, renewal, refund, repeat submission of the same transaction, and sign-in on a second device.
- Confirm one Apple token transaction creates only one token credit, even when client retries and notifications arrive.
- Confirm Apple and Stripe subscribers receive the same feature access, and Apple and Stripe token purchases appear in the same balance.
- Confirm a refunded transaction cannot be resubmitted to regain access.
- In App Review notes, explain that web purchases use Stripe, iOS in-app purchases use StoreKit, and both grant access to the same signed-in account.

Official references: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi), [App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications), [Apple's Node server library](https://github.com/apple/app-store-server-library-node).
