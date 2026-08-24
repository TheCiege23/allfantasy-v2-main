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
bubblewrap build    # prompts to create android.keystore on first run — let it
```

- The keystore password goes in your password manager, not in any file.
- Output: `app-release-bundle.aab` (this is what Play wants) and
  `app-release-signed.apk` (sideload this on your phone to smoke-test).
- Keep `C:\af-twa` out of the repo entirely.

## Play Console (~45 min first time)

1. https://play.google.com/console → create app → name **AllFantasy**,
   package `ai.allfantasy.app`, free, App.
2. **App content** section (all required before review):
   - Privacy policy: `https://allfantasy.ai/privacy`
   - Data safety form: we collect email + optional phone (account), usage
     analytics; data encrypted in transit; users can request deletion at
     `https://allfantasy.ai/data-deletion`.
   - Content rating questionnaire → category Utility/Sports → this GENERATES
     the real IARC rating (the old manifest carried an invented one; it has
     been removed).
   - Ads: No (the app itself serves no ads).
3. **Store listing** assets:
   - Icon 512×512: `public/icons/icon-512.png` ✓ (already in repo)
   - Feature graphic 1024×500: needs creating (screenshot of the /core board
     with the wordmark works).
   - Phone screenshots (min 2, 1080×1920+): take from a phone or Chrome
     devtools device mode — /core home with triage, Player Finder, live
     matchups, the Legacy profile.
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
developer account. iOS has no TWA equivalent — the Capacitor wrapper is a
separate later project (Apple Developer enrollment for BROWN PIG LLC is already
in flight per the D-U-N-S paperwork).

## When the site changes

The TWA is a shell; web deploys need nothing. Rebuild + re-upload the AAB only
when changing: package id, start URL, icons/colors, or Android-level features
(notification delegation etc.). Bump `appVersionCode` each upload.
