# Play Store submission runbook (TWA)

The web app is store-ready (manifest, icons, offline-capable shell); what ships to
Google Play is a Trusted Web Activity — a thin Android wrapper that opens
https://allfantasy.ai/core full-screen once Google verifies we own the domain.
This runbook is the full path from this repo to a listed app. There is **no
committed Android project on purpose**: Bubblewrap generates it from
`docs/play-store/twa-manifest.json`, and the generated project + keystore must
NEVER be committed (public repo).

## One-time machine setup (~15 min)

1. Install Node 18+ (already have it) and run: `npm i -g @bubblewrap/cli`
2. First `bubblewrap` run offers to download the JDK and Android SDK for you —
   accept both (~1.5 GB; put them on C:, not F: — F: fills, see repo memory).

## Build the app bundle (~10 min)

```bash
mkdir C:\af-twa && cd C:\af-twa
copy <repo>\docs\play-store\twa-manifest.json .
bubblewrap update   # regenerates the Android project from twa-manifest.json
```

The long-press shortcuts (My Leagues, Trade Analyzer, and since 2026-10-01 **Your career**) come
from `shortcuts` in `twa-manifest.json`, so a shortcut change reaches phones only with the next
Play build. Haptics need no build: the app runs Chrome, and the website calls `navigator.vibrate`
(`lib/platform/haptics.ts`). A home-screen widget is not possible in a Trusted Web Activity
without leaving Bubblewrap's generated project, which is why Android has none.

⚠ **`bubblewrap build` does NOT create the keystore.** This runbook used to say it
prompts to create `android.keystore` on first run. It does not: it prompts for the
PASSWORD, builds the unsigned APK, then dies at the signing step with
`FileNotFoundException: .\android.keystore`. Measured 2026-09-01 with @bubblewrap/cli
on Node 24. Create it first, from `C:\af-twa`:

```bash
& "C:\Users\<you>\.bubblewrap\jdk\jdk-17.0.11+9\bin\keytool.exe" -genkeypair -v -keystore android.keystore -alias android -keyalg RSA -keysize 2048 -validity 10000
```

⚠ At *"Enter key password for &lt;android&gt;"* press **Enter** to reuse the keystore
password. Bubblewrap passes the same value to both `--ks-pass` and `--key-pass`, so a
distinct key password fails in exactly the same way as having no keystore at all.

Certificate fields: use business details. Nothing verifies them, and under Play App
Signing this certificate never reaches a user's device — Google re-signs with its own
app signing key. Then:

```bash
bubblewrap build
```

- The keystore password goes in your password manager, not in any file.
- ⚠ **A FAILED SIGNING STEP ECHOES THE PASSWORD IN PLAINTEXT.** The apksigner command
  it prints on failure contains `--ks-pass pass:"..."`. Scrub build output before
  pasting it anywhere.
- ⚠ Losing this keystore is **recoverable**, contrary to the usual assumption. It is
  the UPLOAD key; under Play App Signing Google holds the app signing key, and a lost
  upload key is reset via Play Console → Protected with Play → Play Store protection →
  Manage Play app signing. Back it up regardless — a reset is a support round-trip in
  the middle of a release.
- Output: `app-release-bundle.aab` (this is what Play wants) and
  `app-release-signed.apk` (sideload this on your phone to smoke-test).
- Keep `C:\af-twa` out of the repo entirely.

## Play Console (~45 min first time)

1. https://play.google.com/console → create app → name **AllFantasy**,
   package `ai.allfantasy.app`, free, App.
2. **App content** section (all required before review):
   - Privacy policy: `https://allfantasy.ai/privacy` — submit after the 2026-10
     rewrite (PR #2130) is live, so review reads the policy this form matches.
   - Data safety form. Measured against the live site and code on 2026-09-25;
     re-check before each submission, because a new SDK or a PostHog project
     setting changes the answer without touching this file:
     - **Personal info:** email address; name/username; phone number (optional,
       for verification codes and opt-in SMS). Required for account management.
     - **Location:** approximate location from IP (state-law compliance gates).
     - **App activity:** app interactions (PostHog analytics, heatmaps, dead
       clicks and **session recordings**, inputs masked, console not captured).
     - **App info and performance:** crash logs (Sentry, PostHog exception
       capture); diagnostics (PostHog network timing).
     - **Shared with third parties for advertising:** the Meta Pixel, Google Tag
       Manager and **the TikTok and Reddit pixels GTM loads** run on every page,
       Google Ads conversion tracking AND remarketing fire, Google Analytics 4
       collects usage (declare App activity as shared with Google for analytics
       too), and the server
       sends Meta Conversions API events (`CompleteRegistration`, `Lead`,
       `Subscribe`, `Purchase`). Declare it as shared, not only collected.
     - 🛑 **THE AD PARTNER LIST CANNOT BE DERIVED FROM THIS REPO.** TikTok and
       Reddit load from inside the GTM container, configured in Google's UI, so
       `grep` finds nothing and both were missing from the policy and this form
       for weeks. Re-measure from the LIVE site before every submission, and use
       `performance.getEntriesByType('resource')` — a devtools network panel in
       the in-app browser reported only same-origin requests and showed none of
       these hosts, which reads exactly like "no trackers fire".
     - Measured 2026-10-06 on `https://www.allfantasy.ai/` (no GPC, no opt-out
       cookie), third-party hosts on first load: `connect.facebook.net`,
       `www.facebook.com` (the Facebook SDK's `/x/oauth/status`),
       `www.googletagmanager.com`, `analytics.google.com` + `stats.g.doubleclick.net`
       (**Google Analytics 4**, new since 09-28), `googleads.g.doubleclick.net` +
       `www.google.com/rmkt/collect` + `/pagead/1p-user-list` (**Google Ads
       remarketing**, account 18431392427, new since 09-28), `ad.doubleclick.net`,
       `analytics.tiktok.com` (+ `analytics-ipv6.tiktokw.us`),
       `www.redditstatic.com`, `pixel-config.reddit.com`, `alb.reddit.com`,
       `static.cloudflareinsights.com`, `sentry.io`, `fonts.googleapis.com`.
       ⚠ The Meta config that loads is for dataset **1607977376870461**, not the
       1595613188959043 named in `app/layout.tsx` — confirm which one GTM carries.
     - Still UNIDENTIFIED: `mpc2-prod-27-is5qnl632q-uk.a.run.app` — a `fetch` to
       `/events?cee=…`, 7 ms after the Facebook SDK's status check. It is NOT in
       `gtm.js`, `gtag/js`, TikTok's `events.js` or the Facebook SDK (searched); the
       scripts that could not be read cross-origin are Reddit's `pixel.js`, Meta's
       `fbevents.js` + signals config, and TikTok's `main.*.js`. Most likely Meta.
       Name it before certifying the form; it is a third party either way.
     - ✅ `/privacy` (2026-10 rewrite) names Meta, Google — including Google
       Analytics and Google Ads remarketing — TikTok and Reddit in its Section 5
       table, says the Android app runs these tools as the website does, and says
       PostHog receives email and name with the account id.
     - **Users can now opt out of the advertising sharing**, at
       `https://allfantasy.ai/privacy/choices` or with Global Privacy Control
       (`lib/privacy/adMeasurementOptOut`). It is opt-OUT: the tags still load by
       default, so keep "shared for advertising" = **yes** and do not mark that data
       optional. In the TWA a GPC signal only exists if the user's Chrome sends one.
     - Data encrypted in transit; users delete in-app at **Settings → Account →
       Start account deletion**, or by email via
       `https://allfantasy.ai/data-deletion` if locked out. Deletion also deletes
       saved connected-platform credentials (2026-10).
     - **App Store Connect → App Privacy takes the SAME categories and the OPPOSITE
       tracking answer, and that is not an inconsistency.** Contact Info (email,
       phone, name), Location (coarse), Usage Data (product interaction), Diagnostics
       (crash, performance) — but "Data Used to Track You" = **No** there. See
       `docs/app-store/RUNBOOK.md`: every ad loader checks the iOS app's User-Agent
       marker (`lib/platform/iosApp`), so none of them runs inside that app, and
       declaring tracking would oblige an App Tracking Transparency prompt (5.1.2)
       the app does not have.
     - 🛑 **THE ANDROID APP HAS NO SUCH MARKER, SO THIS FORM IS THE OPPOSITE CASE.**
       The Play build is a Bubblewrap TWA loading the same web pages as a browser —
       the Meta Pixel, GTM and the TikTok/Reddit tags it carries all run in it.
       "Shared with third parties for advertising" = **yes** here is correct, and
       copying iOS's "No" onto this form would be a false declaration. One codebase,
       two apps, two honest answers.
   - Content rating questionnaire → category Utility/Sports → this GENERATES
     the real IARC rating (the old manifest carried an invented one; it has
     been removed).
   - Ads: No (the app itself serves no ads).
3. **Store listing** assets:
   - Icon 512×512: **`docs/play-store/play-store-icon-512.png`** ✓ — NOT
     `public/icons/icon-512.png`. Play requires a 32-bit PNG; the web icons are
     deliberately 24-bit (iOS/App Store reject icon alpha), so this is the same
     tile with a fully opaque alpha channel added. Both come from
     `node scripts/build-pwa-icons.mjs`. Play rounds the corners itself (30%);
     upload the square as-is.
   - Feature graphic 1024×500: **`docs/play-store/feature-graphic-1024x500.png`** ✓
     (24-bit, no alpha — the opposite of the icon rule). The live homepage
     headline lifted in its real font, beside the demo "Your leagues" card, on
     brand navy. Built by `node scripts/build-play-feature-graphic.mjs`; add
     `--capture` to re-shoot the public homepage first (it records where the
     h1 and card are, so nothing is hand-positioned). Deliberately NOT used:
     the crest (Play: no branding similar to the icon), pure black (blends into
     Play's UI), and the homepage launch countdown (no promo/price content).
     Alt text for the asset: *"Play fantasy sports. All in one place. An
     example Your leagues card showing four Sleeper and ESPN leagues with their
     scores and the one thing each needs: set flex, waivers, trade, or all set."*
   - Phone screenshots (min 2 to publish; **4+ at 1080×1920 for promotion**):
     taken BY HAND on a phone, then made compliant by a script. Why by hand:
     they should show the app (`/core`), which needs a sign-in, and the public
     pages a script can reach gave only two usable shots on 2026-10-01.
     1. Sign in as the **demo account** — never a real league: other managers'
        names would end up in a public listing.
     2. Take them **after Oct 15**. Before launch, /core shows the "free until
        Oct 15" countdown, and Play forbids price/promo content and anything
        time-sensitive.
     3. Shot list, in this order (dark mode, no notifications pending):
        `/core` home (what needs you), `/core/my-team`, `/core/matchup`,
        `/core/players` (Player Finder), `/core/trades`, `/core/career`.
     4. Put the files in one folder, named in the order you want, then:
        `node scripts/prepare-play-screenshots.mjs <folder>`
        → `docs/play-store/screenshots/phone-N.png`. A modern phone shoots
        20:9 (1080×2400), which Play REJECTS (longest side over 2× the
        shortest); the script crops to 9:16 below the status bar, outputs
        exactly 1080×1920 and strips alpha. It warns if a shot is soft.
     No device frames, no added captions over 20% of the image, no
     "download"/"install" call-to-action (Play rules).
4. **Release** → Internal testing → upload the `.aab` → enroll in
   **Play App Signing** when prompted (always yes).

## The domain-verification step (the one that breaks for everyone)

After the first upload: Play Console → **Setup → App signing** → copy the
**SHA-256 certificate fingerprint** (the *App signing key certificate*, NOT the
upload key). Then in this repo:

1. Open `public/.well-known/assetlinks.json`
2. Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FROM_PLAY_CONSOLE` with the
   fingerprint (keep the colon-separated uppercase hex format).
3. If you smoke-test the sideloaded APK before Play processes the upload, add
   the **upload key** fingerprint as a second array entry (get it with
   `keytool -list -v -keystore android.keystore`).
4. Merge + deploy, then verify: https://allfantasy.ai/.well-known/assetlinks.json
   returns the JSON, and Google's checker approves:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://allfantasy.ai&relation=delegate_permission/common.handle_all_urls`

Until this file carries the real fingerprint, the installed app opens with
browser chrome (URL bar) instead of full-screen — that's the tell.

## Review + rollout

Internal testing → invite yourself → confirm full-screen open, login, and the
/core home → promote to Production. First review typically 1–7 days for a new
developer account. iOS has no TWA equivalent; its Capacitor shell lives in
`ios-app/` and has its own runbook, `docs/app-store/RUNBOOK.md`.

## When the site changes

The TWA is a shell; web deploys need nothing. Rebuild + re-upload the AAB only
when changing: package id, start URL, icons/colors, or Android-level features
(notification delegation etc.). Bump `appVersionCode` each upload.

### Refreshing the launcher icon (done for the traced crest, 2026-10-01)

The launcher icon is NOT in this repo's Android project — there isn't one.
`bubblewrap update` DOWNLOADS `iconUrl` / `maskableIconUrl` from the live site,
so the order is fixed: deploy the new `public/icons/*` to production FIRST,
confirm the live files are the new ones, THEN rebuild. Rebuilding before the
deploy bakes the old icon into the bundle with nothing to warn you.

1. Confirm production serves the new icons (both must be the navy tile):
   https://www.allfantasy.ai/icons/icon-512.png and
   https://www.allfantasy.ai/icons/icon-maskable-512.png
2. In your existing `C:\af-twa`, set `appVersionCode` ABOVE the last bundle you
   uploaded (Play Console → **App bundle explorer** lists it; Play rejects a
   reused code). ⚠ The copy of `twa-manifest.json` in this repo still says `1`
   and is not kept in sync with uploads — do not re-copy it over a project that
   has already shipped without fixing the code.
3. `bubblewrap update` then `bubblewrap build`, upload the `.aab` to Internal
   testing, and check the home-screen icon on a phone.
4. The **store-listing** icon is separate and needs no build: Play Console →
   **Grow → Store presence → Main store listing** → upload
   `docs/play-store/play-store-icon-512.png`.

An installed app keeps the icon from the bundle it was installed from, so phones
show the new one only after updating to the new release.
