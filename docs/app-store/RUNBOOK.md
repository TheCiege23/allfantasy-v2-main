# App Store submission runbook (iOS)

The iOS app is `ios-app/`: a Capacitor 8 shell whose WebView loads
`https://allfantasy.ai/core`. Web deploys need no new binary. Rebuild only when
`ios-app/` itself changes (icon, splash, bundle id, native plugins).

No Mac is needed. `.github/workflows/ios-testflight.yml` builds, signs and
uploads on a GitHub-hosted macOS runner, and it runs only when started by hand.

## One-time setup (~20 min)

1. **Bundle ID.** The project uses `ai.allfantasy.app`, the same as the Play
   Store package. It MUST equal the Bundle ID chosen when the app record was
   created in App Store Connect (App Information → Bundle ID). If the record used
   a different one, change `appId` in `ios-app/capacitor.config.json` and
   `PRODUCT_BUNDLE_IDENTIFIER` (two places) in
   `ios-app/ios/App/App.xcodeproj/project.pbxproj` to match.
2. **API key.** App Store Connect → Users and Access → Integrations → App Store
   Connect API → Team Keys → **+**, role **Admin** (automatic signing creates the distribution
   certificate, which an App Manager key cannot). Download
   the `.p8`. Apple lets you download it only once.
3. **Repository secrets** (GitHub → Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `APPLE_TEAM_ID` | Membership → Team ID (10 characters) |
   | `APP_STORE_CONNECT_KEY_ID` | the key's Key ID |
   | `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID, shown above the key list |
   | `APP_STORE_CONNECT_API_KEY_P8` | the whole `.p8` file, BEGIN/END lines included |

   The `.p8` is a signing credential. It never goes in the repo, a chat, or a
   log. The workflow writes it to the runner's temp directory and deletes it.

## Build and upload (~15 min)

GitHub → Actions → **ios-testflight** → Run workflow → version `1.0`. When it
finishes, the build appears in App Store Connect after processing (10–30 min).
Then go to the version page → **Build** → **+** → pick it. The build number is
the workflow run number, so every run is unique.

Export compliance is pre-answered: `ITSAppUsesNonExemptEncryption = NO` in
`Info.plist` (the app uses only standard HTTPS).

The app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), so only the 6.5" iPhone
screenshots are required, not iPad ones.

## What the website does inside the app

The app appends `AllFantasyiOS/1.0` to its User-Agent, and
`lib/platform/iosApp.ts` keys off that marker:

- **Guideline 3.1.1, no purchases.** Purchase pages redirect to
  `/ios-app/plans`, checkout APIs answer 403 `not_available_in_ios_app`, and
  links to purchase pages are hidden (`html[data-ios-app]` in `globals.css`).
  Anything an account has already bought still works. Adding a new purchase
  page or checkout route means adding it to the lists in `iosApp.ts`.
- **Guideline 4.8, sign-in.** Sign in with Apple is not live, so the
  Google/Facebook/X/Discord/Spotify buttons are hidden and email sign-in
  remains. Google also refuses sign-in inside embedded WebViews, so its button
  would fail there regardless. Once Sign in with Apple is configured
  (`APPLE_CLIENT_ID`/`APPLE_CLIENT_SECRET`), social sign-in can come back.
- **App Review's network.** Apple's corporate range (17.0.0.0/8,
  2620:149::/32) is not treated as a VPN (`lib/geo/appleNetwork.ts`), so a
  reviewer is not sent to `/vpn-blocked`. State rules still apply to it, and an
  address in Apple's Private Relay feed still follows the Relay rule.

## Before pressing "Add for Review"

- **Demo account** under App Review Information: an email/password account (not
  a social login, which is hidden in the app) with 1–2 imported leagues.
- **App Privacy**: "Data Used to Track You", Yes (Meta Pixel and Conversions
  API). Re-measure before each submission; see the Play runbook's data-safety
  notes.
- **Release**: "Manually release this version".

## Known remaining risk

**Guideline 4.2 (minimum functionality).** A WebView shell is the most common
rejection for apps like this. The shell adds a native splash, a native status
bar and a bundled offline screen. The strongest answer is native push
notifications (APNs), which needs a server-side sender and is not built. If
review rejects on 4.2, that is the next piece of work.
