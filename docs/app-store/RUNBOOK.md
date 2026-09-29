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

## Push notifications (optional, ~15 min)

The app build and the server are both ready; three switches turn it on. Until
all three are done, nothing in the app mentions notifications.

1. **App ID.** developer.apple.com → Certificates, Identifiers & Profiles →
   Identifiers → `ai.allfantasy.app` → tick **Push Notifications** → Save. (No
   certificate needed; ignore the "Configure" button.)
2. **APNs key.** Keys → **+** → name it `AllFantasy Push` → tick **Apple Push
   Notifications service (APNs)** → Continue → Register → **Download** the `.p8`
   (once only) and note its **Key ID**. Then set these on the Railway service
   `allfantasy-v2-main` **in one save** (each variable write is a deploy):
   `APNS_KEY_ID` (the Key ID), `APNS_TEAM_ID` (your 10-character Team ID) and
   `APNS_PRIVATE_KEY` (the full `.p8` contents, including the BEGIN/END lines).
   Same rules as the App Store Connect key: never in the repo, a chat or a log.
3. **Build.** Run **ios-testflight** with **push_notifications** ticked. The
   workflow exports the signed app first and refuses to upload if the
   `aps-environment` entitlement did not make it in, so a build that cannot
   receive notifications never reaches TestFlight.

Where it shows: `/core/notifications`, Settings → Notifications, and the
import-done screen, each as a "Game-day alerts → Turn on" card. iOS asks for
permission only when the user taps it. The web code checks that the installed
binary contains the push plugin (`iosAppPushBridge`), so builds from before this
change never see the card.

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
  a social login, which is hidden in the app) with 1–2 imported leagues. Its
  credentials go in App Store Connect's own fields — never in this repo, which is
  public.
- **Notes** under App Review Information: paste the block below. Re-read it
  against the app first; every sentence in it is a claim the reviewer can test.

  ```
  AllFantasy is a companion for season-long fantasy sports leagues people
  already play on Sleeper, ESPN and Fantrax. It imports those leagues read-only
  and shows lineup, matchup, waiver and trade analysis in one place. There is no
  gambling, no betting and no real-money contests in the app.

  SIGN-IN: use the demo account above (email and password). The demo account
  already has imported leagues, so every tab has real data.

  PURCHASES: nothing is sold in the app. Subscriptions and tokens are sold only
  on our website; an account that already bought them there keeps that access in
  the app (guideline 3.1.3(b)). Purchase pages and checkout are unavailable
  inside the app.

  ACCOUNT DELETION: More (bottom bar) > Settings > Account > "Start account
  deletion". Deletion is immediate and permanent after typing DELETE to confirm.

  USER CONTENT: league chat, draft and mock-draft chat, bracket pool chat and
  direct messages. Press and hold a message, or tap its "..." button, to Report
  it or Block its sender; blocked users' messages are hidden. Offensive
  language is filtered, and reports are reviewed within 24 hours (Terms of
  Service, section 11).

  TRACKING: the app does not track users. Ad and analytics pixels used on our
  website do not load inside the app.
  ```

  ⚠ Keep it true. Report/Block now covers league chat (both renderers —
  `LeagueConversation` and the dashboard's `LeagueChatInPanel`), DMs/huddles, the
  live draft room (#1565), the `app/draft` shell's chat, bracket pool chat
  (`PoolChat`) and the mock draft chat; every one of their reads hides blocked senders
  and answers 503 rather than serve an unfiltered list. `RedraftCommunicationPanel`
  shows no member chat (notices and events only; its composer posts into league chat).
  STILL MISSING (census 2026-09-29, all four import forms checked), which is why the
  note does not say "all chat":
  - `app/leagues/[leagueId]/page.tsx` — the bracket league page renders bracket chat
    in two lists with no Report (its read already hides blocked senders);
  - `components/brackets/world-cup/WorldCupBracketShell.tsx` — World Cup challenge
    chat (`/api/brackets/world-cup/[id]/chat`), no Report or Block, own table;
  - `app/af-legacy/page.tsx` → `/api/legacy/chat` — NOT YET CLASSIFIED (may be the AI
    assistant, which is not user content).
  Wire them before widening the sentence. If a purchase surface or a tracker is ever
  added to the app, this block is wrong the same day.
- **App Privacy**: "Data Used to Track You", **No**. Measure it before each
  submission; do not copy last time's answer:

  ```
  node scripts/probe-ios-app-trackers.cjs
  ```

  It loads the public pages as the app and as plain iPhone Safari (the control,
  which must show trackers or the run is blind) and exits 1 if the app contacts
  any ad or tracking host. The answer is No because none of the tracking runs in
  the app: the Meta Pixel, GTM, gtag, TikTok and Reddit loaders, the Conversions
  API (`lib/meta-capi`) and the Facebook SDK all check the app's User-Agent
  marker (`lib/platform/iosApp`).

  ⚠ This line used to say **Yes (Meta Pixel and Conversions API)** — the
  opposite of what the app does. Declaring tracking obliges the app to show
  Apple's App Tracking Transparency prompt (5.1.2), and this app has none, so the
  wrong answer was itself grounds for rejection. PostHog and Sentry still collect
  first-party analytics and diagnostics: declare those under the data the app
  collects, not under tracking. See the Play runbook's data-safety notes.

  🛑 **AND "No" HERE IS NOT "no trackers exist" — THE WEB SITE RUNS FIVE.** Measured
  2026-09-28 on `https://www.allfantasy.ai/` with a normal desktop UA, the hosts
  contacted on first load are `connect.facebook.net`, `www.googletagmanager.com`,
  `analytics.tiktok.com` (+ `analytics-ipv6.tiktokw.us`), `www.redditstatic.com` /
  `pixel-config.reddit.com` / `alb.reddit.com`, `ad.doubleclick.net`, plus
  `static.cloudflareinsights.com` and `sentry.io`. That list is what `/privacy` and
  Play's data-safety form have to match; this App Privacy answer is about the APP,
  and the two are different questions with different correct answers. TikTok and
  Reddit are NOT in this repo — they load from inside the GTM container — so `grep`
  cannot find them, which is how the privacy policy under-disclosed both for weeks.
  ⚠ Measure with `performance.getEntriesByType('resource')`: an in-app-browser
  network panel reported only same-origin requests and none of the ad hosts, which
  reads exactly like "nothing fires".
- **What is verified in production, and what still needs a build.** Verified by
  effect 2026-09-28: `/upgrade` answers **307 → `/ios-app/plans`** for a UA carrying
  `AllFantasyiOS` and **200** for a desktop UA, so the 3.1.1 purchase-page gate is
  live server-side. The tracker half is covered by `probe-ios-app-trackers.cjs`
  above. What neither covers is **hiding the social sign-in buttons**: that is done
  CLIENT-side off the `data-ios-app` flag, so a `curl` with the iOS UA returns
  byte-identical HTML and proves nothing either way. Confirm it on a real TestFlight
  build — the web login page does show Google, Spotify and Discord (Apple reads
  "SOON"), which is exactly the 4.8 shape review would reject if the in-app hiding
  ever silently stopped working.
- **Release**: "Manually release this version".

## Known remaining risk

**Guideline 4.2 (minimum functionality).** A WebView shell is the most common
rejection for apps like this. The shell adds a native splash, a native status
bar and a bundled offline screen. The strongest answer is native push
notifications (APNs), which needs a server-side sender and is not built. If
review rejects on 4.2, that is the next piece of work.
