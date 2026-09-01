# Avatar upload + mobile notifications — audit, spec and plan

**Opened:** 2026-09-01 · **Status:** audit complete, no code changed yet
**Branch when written:** `commish-os/phase-0-1b`

This file exists so a cold session (or a later one, after a credit break) can
resume without re-deriving anything. Everything under "Measured" was read out of
the tree, not assumed. Everything under "Spec" came from the user on 2026-09-01
and is the authority on intent.

---

## 1. The reported symptom

> "A test user tried to change their avatar and was not able to, and the
> notification system is not wired in at all for mobile."

The test user came **through the Google Play Store**, so they were inside the
Trusted Web Activity wrapper (`docs/play-store/twa-manifest.json`, package
`ai.allfantasy.app`), signed in with Google. That detail is what makes the avatar
failure deterministic rather than flaky — see 2.1.

---

## 2. Measured root causes

### 2.1 Avatar — `403 AGE_REQUIRED` on every Google-OAuth account

The settings page uploads through the **chat** upload route:

- `app/settings/components/sections/ProfileSettingsSection.tsx:67`
  → `POST /api/chat/upload` (multipart: `file`, `type=image`, plus `leagueId`
  **or** `purpose=profile`)
  → then `PATCH /api/user/profile` with `{ avatarUrl, avatarPreset: null }`

`app/api/chat/upload/route.ts:53` calls `requireVerifiedUser()`. That guard
(`lib/auth-guard.ts:146`) rejects with **403 `AGE_REQUIRED`** when
`profile.ageConfirmedAt` is null, and **403 `VERIFICATION_REQUIRED`** when
neither email nor phone is verified.

`ageConfirmedAt` is written in exactly three places:

| Where | Covers |
|---|---|
| `app/api/auth/register/route.ts:464` | email + password signup |
| `app/api/auth/confirm-age/route.ts:59` | explicit confirm-age call |
| `lib/auth/SharedAccountBootstrapService.ts:30` | shared-account bootstrap |

**`lib/auth.ts` never sets it on an OAuth sign-in.** Google sign-in sets
`emailVerified` (via `resolveOAuthEmailVerifiedFromCallback`, `lib/auth.ts:566`,
which reads Google's `email_verified`) but never `ageConfirmedAt`. So any Google
account that has not separately hit `/api/auth/confirm-age` fails the guard and
**cannot upload an avatar from `/settings`** — deterministically, for everyone in
that population.

The user is shown the raw code. `ProfileSettingsSection.tsx:70` returns
`data.error` verbatim, so the copy on screen reads `AGE_REQUIRED`.

⚠ The `/profile` page does NOT have this bug. It goes through
`lib/avatar/ProfileImageUploadService.ts` → `POST /api/user/profile/avatar`,
which only requires a session. **Two doors, one locked, no sign on either.**

🛑 **AND THERE WERE TWO BLOCKED POPULATIONS, NOT ONE — WHICH IS WHY THE FINAL GATE
HAD TO BE SESSION-ONLY.** Established late, after a peer session pointed out that
the Play Store tester may have been a reviewer account created with email +
password rather than Google. Checked rather than assumed:

`app/api/auth/register/route.ts` sets `ageConfirmedAt: now` — but contains **zero
`emailVerified` assignments**, and sets `phoneVerifiedAt` only when the method is
PHONE. So an email+password account that has not yet clicked its verification link
has age confirmed and **no verified contact**. On `/api/chat/upload` that is a 403
`VERIFICATION_REQUIRED`.

| signup path | `ageConfirmedAt` | verified contact | old failure |
|---|---|---|---|
| Google / OAuth | ❌ never set | ✅ from `email_verified` | 403 `AGE_REQUIRED` |
| email + password, link unclicked | ✅ set at register | ❌ | 403 `VERIFICATION_REQUIRED` |

**Two populations, two different codes, one route.** The first fix
(`requireContactVerifiedUser`) would have repaired only the top row and left an
unverified reviewer account still unable to set a picture. The user's "do not
narrow" instruction is what makes the fix cover both — it was load-bearing, not a
preference. Any future re-gating of this route must survive **both** rows.

### 2.2 Avatar — three routes, three limits, two auth models

| Route | Callers | Limit | Auth |
|---|---|---|---|
| `app/api/user/avatar/route.ts` | **none — dead code** | 2 MB | session |
| `app/api/user/profile/avatar/route.ts` | `/profile` | 3 MB | session |
| `app/api/chat/upload/route.ts` (`purpose=profile`) | `/settings` | 25 MB | `requireVerifiedUser` |

The client in `ProfileImageUploadService.ts:16` pre-rejects >3 MB, so if anything
is ever pointed at `/api/user/avatar` a 2.5 MB file passes the client check and
fails on the server.

### 2.3 Avatar — other sharp edges

- **Save can null an upload.** Both editors send
  `avatarUrl: avatarSelectionTouched ? null : undefined`. Picking a preset sets
  the flag, so preset-then-Save discards a previously uploaded image silently.
  (`ProfileSettingsSection.tsx:52`, `app/profile/EditableProfileFormController.tsx:69`)
- **`session.user.image` is frozen at sign-in.** `lib/auth.ts:741` sets
  `token.picture` once. `/core` (`app/core/[[...screen]]/page.tsx:948`) and
  `app/league/[leagueId]/page.tsx:330` correctly re-read `app_users`; anything
  else reading the session shows a stale avatar forever.
- **No mobile entry point.** The `af-rail-profile` tile → `/settings` is the only
  route in, and on phones `components/core-app/af-core-shell.css:686` turns the
  rail into a horizontal scroller, pushing it off-screen. The bottom bar
  (`MOBILE_BAR_KEYS`, `components/core-app/AfCoreShell.tsx:626`) has no profile
  entry.
- All three routes 503 `Storage not configured` without `BLOB_READ_WRITE_TOKEN`.
  **User confirmed it IS set in production**, so this is not the active cause.

### 2.4 Notifications — the pipeline is complete; the opt-in is unreachable

This was the surprise. The server side is **not** missing:

- `sendPushToUser` is called from `lib/notifications/NotificationDispatcher.ts:166`,
  `lib/notifications/outboxRelay.ts:122`,
  `lib/trade-intel/tradeNotifyService.ts:222`,
  `app/api/cron/alert-sweep/route.ts:276`.
- `cron-schedule.json` schedules both `/api/cron/notification-outbox-relay` and
  `/api/cron/alert-sweep`.
- `public/sw.js` has working `push` + `notificationclick` handlers and IS
  registered, by `components/shell/SafeGlobalChrome.tsx:88`.
- `lib/push-notifications/useWebPushSubscription.ts` is solid: bounded SW waits,
  rollback on server failure, correct iOS home-screen detection.
- The TWA is correctly configured: `enableNotifications: true`,
  `public/.well-known/assetlinks.json` carries four SHA-256 fingerprints, and
  `middleware.ts:54` correctly refuses to redirect `/.well-known/`.

**The entire delivery chain runs and delivers into an empty subscription table.**

`components/notifications/EnableWebPushCard.tsx` is the only thing in the repo
that ever calls `Notification.requestPermission()`. It is rendered in exactly one
place — `app/settings/components/sections/NotificationsSettingsSection.tsx:286`.
`/core` never renders it, never prompts, and links to it only from a footer in
`components/core-app/screens/NotificationsCenter.tsx:295` that renders **only when
`data.push.suppressedReason` is truthy**. A mobile user with nothing suppressed
has no path to enabling push at all.

⚠ A TWA with `enableNotifications: true` only DELEGATES display. The web page must
still call `requestPermission()` and `pushManager.subscribe()`. So the wrapper
being correct does not rescue this.

### 2.5 Notifications — dead code that will be found and used

- `public/sw-push.js` is registered by nothing that ships.
- `hooks/usePushSubscription.ts:45` registers `/sw-push.js` at scope `/`, which
  would **fight `/sw.js` for the same scope**. It has zero callers. It is a loaded
  footgun sitting under an obvious name.
- Two hooks do one job: the unused `hooks/usePushSubscription.ts` and the live
  `lib/push-notifications/useWebPushSubscription.ts`.
- The `href` vs `url` payload drift documented in
  `lib/push-notifications/types.ts:11` is a scar from this same split.

### 2.6 Notifications — untestable off production

`lib/pwa/shouldRegisterServiceWorker.ts:5` returns true only when
`NODE_ENV === 'production'` or `NEXT_PUBLIC_ENABLE_PWA_SW` is `1`/`true`. Without
it there is no service worker, so the hook's 10s timeout fires and reports "the
background service worker did not start" — which reads as broken code rather than
a missing flag. **This is very likely why it felt "not wired in at all".**

---

## 3. Spec (from the user, 2026-09-01)

Answers to the 20 scoping questions. These are the authority on intent.

### Avatar

1. Surface where it failed: unknown → **fix all surfaces**.
2. Test user came via **Google Play Store** (TWA + Google sign-in).
3. What they saw: unclear → **fix the error copy everywhere**.
4. `BLOB_READ_WRITE_TOKEN` **is set** in production.
5. Avatar editing **lives in Settings** (not a new `/core` screen).
6. Verified email **should** be required to upload. → Keep a gate, but the gate
   must be reachable: age confirmation has to be obtainable for OAuth users, and
   the failure must be actionable copy, not a code.
7. Presets vs uploads: **best judgement.**
8. Max size: **best judgement.**
9. **Add crop/rotate on mobile.**
10. 🛑 **Scope rule.** A changed avatar shows everywhere on AllFantasy **except
    league pages**. League surfaces keep showing the **imported** image from that
    league (Sleeper/ESPN/etc). Two identities — platform identity and league
    identity — and they must not be conflated.

### Notifications

11. **Both**: native wrapper delivery (TWA) **and** web push.
12. Ask for permission on **first meaningful action**.
13. **Add an install prompt.** (iOS App Store submission is pending Apple.)
14. Push-worthy: injuries (today), trades, waivers, chat mentions, and
    **on-the-clock draft alerts eventually**.
15. **Global on/off by default, plus per-league override in league settings.**
16. **Quiet hours — yes**, exposed in the main settings menu, and users should be
    told the option exists.
17. Badge counting: **best judgement.**
18. Nagging: **dismissible banner during game days.**
19. Test account available: `cjabar.henson@gmail.com`. Open question: whether an
    Android/Play tester device is also needed — see §6.
20. Sign-off = **all of**: a real push landing on a phone from production, the
    subscription row appearing, and a green test send.

---

## 4. Project plan

Phases are ordered so each is independently landable and verifiable.
**Do not batch these into one commit.**

### Phase 1 — Unblock avatar upload ✅ DONE (uncommitted at time of writing)

- [x] **Gate decided, and NOT the way this plan first proposed.** The original
      recommendation — stamp `ageConfirmedAt` during OAuth sign-in — is wrong and
      was dropped. `/api/auth/confirm-age` says in its own header that the signup
      tick never reached the server, so a ticker is indistinguishable from a
      non-ticker and stamping them all "would fabricate a legal attestation".
      `AgeConfirmationPrompt` is mounted globally and deliberately dismissible
      because "the real feature gates still protect the surfaces that require
      confirmation" — bracket entry and the legal panel. **A profile picture was
      never meant to be one of them.** New guard `requireContactVerifiedUser` in
      `lib/auth-guard.ts`: contact verification, no age check.
- [x] Repointed `ProfileSettingsSection.tsx` off `/api/chat/upload` onto
      `uploadProfileImage()` → `/api/user/profile/avatar`. One route, one auth
      model, for both editors.
- [x] Deleted `app/api/user/avatar/route.ts` (zero callers) and its directory.
- [x] One size limit in `lib/avatar/profileImageLimits.ts`, raised 3 MB → 8 MB,
      with every message derived from `MAX_PROFILE_IMAGE_MB` so they cannot drift.
      ⚠ The limits had to live in their own module: `ProfileImageUploadStorageService`
      imports `@vercel/blob` and node `crypto`, so client code cannot import the
      constant from it. The storage service re-exports, so server importers are
      untouched.
- [x] `lib/avatar/AvatarUploadErrorCopy.ts` maps codes to prose; unknown strings
      pass through, because the routes also return already-human messages.
- [x] `__tests__/avatar-upload-gate.test.ts` — 13 tests.

**Measured, not assumed:**
- 22 tests pass across the new file plus the two existing suites it touches
  (`profile-image-upload-storage-service`, `auth-guard-age-vs-verification`).
- Typecheck of the **first** commit (`062d5cbf6`), run detached against its parent
  `97c95d5e8`: **145 `error TS` lines and tsc exit 2 on BOTH**, and the two outputs
  were **byte-identical** (59381 bytes) — so that commit introduced no new
  diagnostic anywhere, consumers included. The gate revert was measured again on
  the follow-up commit.
- **Positive control, twice.** First the guard was mutated to re-add the age check
  (suite went red). Then, after the revert, the ROUTE was mutated back onto
  `requireVerifiedUser` and the route-level test failed with exactly
  `"error": "AGE_REQUIRED"` — the reported bug, reproduced on demand. Both
  mutations were proved applied with `diff -q` and both restores verified identical.

⚠ **The first version of the test did not test the route at all.** It asserted on
the guards only, so it would have stayed green if someone re-gated the route — the
precise regression the file exists to catch. `it('the ROUTE itself uploads for the
worst-case account')` drives the real POST handler and is the one that matters.

⚠ **And that route test cannot build its multipart body from `new File(...)` or
`new Blob(...)`.** undici's FormData validates against its OWN File class, and
neither global here is it; appending either trips a webidl assert that the route's
catch turns into an opaque **500 that reads exactly like a gate refusal**. `req.formData()`
is stubbed instead. Do not "improve" it into a real FormData.

🛑 **THE GATE WAS NARROWED, FLAGGED, AND THEN WIDENED AGAIN — SETTLED AS
SESSION-ONLY.** The first cut used a new `requireContactVerifiedUser` guard
(contact verification, no age check). That fixed the Google population but **added**
a verification requirement to the `/profile` path, which had none before, shutting
out every account with no verified email or phone. The user's answer #6 had said to
require a verified email; shown the actual cost, they overruled it with **"do not
narrow"**. The later, more specific instruction wins.

**Final gate: `requireAuth` — signed in, nothing more.** `requireContactVerifiedUser`
was **deleted** rather than left in place, because an unused exported guard is the
same footgun as `hooks/usePushSubscription.ts` in §2.5: the next person finds it by
name and wires it up. The reasoning it carried now lives in the route's own header.

⚠ `requireAuth` does **not** create a `userProfile` row, unlike the stricter guards,
which is why the preset clear uses `updateMany` (a no-op on a missing row) rather
than `update` (a throw). Do not "tidy" that into `update`.

### Phase 2 — Avatar identity scope ✅ DONE (uncommitted at time of writing)

**The headline: the league half of the rule was ALREADY CORRECT, and the bug was
on the platform half.** The audit expected to find league surfaces leaking the
AllFantasy avatar. They do not.

- [x] **Audited the data layer rather than the ~17 render sites**, which is where
      the answer actually lives. Every core-app league module — `leagueScoreboard`,
      `leagueActivity`, `allPlay`, `leaguePairing`, `matchup` — selects `avatarUrl`
      off the **`LeagueTeam`** row, the image imported from Sleeper/ESPN. **None of
      them falls back to `AppUser.avatarUrl`** (grepped for it; zero hits).
      `lib/core-app/career.ts:150` already documents the split from the other side.
- [x] Confirmed `resolveDashboardAvatarUrl` is **platform identity only** — the
      "you" avatar in the top nav. `/league/[leagueId]` feeds it into
      `LeagueShellClient` → `AdaptiveTopNav` → `<Avatar>`, i.e. account chrome, NOT
      the league's own manager rows. So that call site is correct in principle.
- [x] **The real defect, and it was one argument.** That page called
      `resolveDashboardAvatarUrl(session.user.image, dbUser?.avatarUrl)` — session
      FIRST. `lib/auth.ts:741` sets `token.picture` once at sign-in, so the JWT
      value is frozen. `/core` already passed `null`. Net effect: after changing
      your picture, **the league page showed the old one and `/core` showed the new
      one — same account, two answers, one app.**
- [x] Fixed by **deleting the `sessionImage` parameter**, not by passing `null` at
      the second call site. Both callers now pass the DB value only, and the stale
      value is unpassable rather than merely discouraged.
- [x] `__tests__/avatar-identity-scope.test.ts` — 8 tests. Includes an **arity
      assertion** (`resolveDashboardAvatarUrl.length === 1`) that fails if the
      parameter is ever re-added, and source-level guards on both call sites,
      because a unit test of the resolver structurally cannot see which argument a
      page hands it.

**Measured:** 8 tests pass. Positive control: the league page was mutated back to
the two-argument stale form, the mutation proved applied with `diff -q`, the suite
failed on exactly the league-page case, and the restore verified identical.

⚠ **Still open, and deliberately not done here:** a runtime test that changes a
platform avatar and asserts league surfaces do not move. The guards above are
structural. The league half currently holds by construction, so the value of a
heavier integration test is lower than it looks — but it is the only thing that
would catch a NEW league surface built against the wrong field.

### Phase 3 — Mobile crop/rotate ✅ DONE (uncommitted at time of writing)

- [x] `components/identity/AvatarCropDialog.tsx` — square crop, pinch/drag pan, zoom
      slider, 90° rotate. Built on `AppModal` (Radix: focus trap, Escape, scroll
      lock) rather than a bespoke overlay, and on the same
      `createImageBitmap → canvas → toBlob` shape as
      `lib/chimmy-chat/prepareImageForChimmyUpload.ts`. **No new dependency.**
- [x] Square 512px output, downscaled client-side.
- [x] Wired into **both** editors — settings and `/profile` — from one component.
      Parity is deliberate: those two doing the same job differently is what
      produced the original bug.
- [ ] ⚠ **NOT verified inside the TWA.** Requires a Play internal-test install on
      a physical Android device, which this session had no access to. Verified in
      mobile-emulated Chrome instead (see below). **The file picker path genuinely
      differs in a TWA, so this box stays open.**

**Three decisions worth keeping:**

- **`paint()` is shared by the preview and the export**, parameterised only by
  size (`k = size / VIEWPORT_PX`). The classic cropper bug is a preview drawn by
  one path and an export by another, so the saved image is subtly not what was
  framed. Here that is impossible by construction.
- **GIFs bypass the cropper entirely** (`shouldCropBeforeUpload`). Drawing one to
  a canvas keeps frame one and silently discards the animation — a worse outcome
  than an uncropped avatar.
- **EXIF orientation is requested explicitly** (`imageOrientation: 'from-image'`),
  with a fallback for engines that reject the option. Without it every portrait
  photo from a phone loads sideways and the user has to fix our bug by hand.

**Measured — 39 tests pass across the five avatar suites.** Positive control:
`coverScale` was mutated from `Math.min` to `Math.max` (cover → contain), the
mutation proved applied with `diff -q`, and **3 tests went red** including the
no-gutter invariant; restore verified identical.

**Verified in a real browser**, not just unit tests, via a throwaway harness route
that was **deleted before commit** — this repo is at ~1949 of Vercel's hard 2048
route ceiling, so a permanent dev-preview route costs real headroom:

| check | result |
|---|---|
| painted fraction of the crop square | **1.0** — no gutters, at load, after rotate, after zoom 2.6×, and after a full 360° turn |
| exported file | **512×512, square, `image/jpeg`, 5,004 bytes** from a 4000×3000 source |
| mobile 375×812 | canvas 288px fits, dialog 343×494 fits, no horizontal page scroll |
| `touch-action` on the canvas | `none` — without it the browser scrolls the page instead of panning the crop |
| console errors from the component | none (only pre-existing local Sentry-DSN and Facebook-SDK noise) |

### Phase 4 — Make push reachable ✅ CODE DONE (uncommitted at time of writing)

- [ ] 🛑 **`NEXT_PUBLIC_ENABLE_PWA_SW=1` ON PREVIEW — USER ACTION, NOT DONE.** This
      is a Vercel project setting (Preview scope) and the Vercel CLI is not
      installed in this session. Without it `shouldRegisterServiceWorker()` returns
      false off production, so there is no service worker, so **push cannot be
      tested on any preview deploy** — the hook's 10s wait times out and reports
      "the background service worker did not start", which reads as broken code
      rather than a missing flag. Everything below is verifiable only in production
      until this is set.
- [x] Deleted `public/sw-push.js` and `hooks/usePushSubscription.ts` after a
      **four-form census** (alias, relative, dynamic `await import()`, test mock)
      returned zero importers. The three comments that referenced them were
      rewritten, not left pointing at deleted files.
- [x] `EnableWebPushCard` now renders at the top of `/core/notifications`,
      **unconditionally** — not behind `data.push.suppressedReason`, which was the
      bug: a user with nothing suppressed had no route to enabling alerts at all.
- [x] **First meaningful action = a completed league import** (spec item 12). The
      card renders on `ImportDone`. Before an import a permission prompt is asking
      a stranger for their lock screen on behalf of a league we cannot name; after
      it we can say which league and why. Same component, not a second ask.
- [x] Dismissible game-day banner (spec item 18) —
      `components/notifications/GameDayAlertsBanner.tsx`, mounted in `AfCoreShell`
      beside `GeoRestrictionNotice` so every `/core` screen inherits it. Renders
      null off game days, once permission is decided either way, and for the rest
      of the week after dismissal. **Dismissal is week-scoped, not permanent** —
      someone waving it away in September has said "not now", not "never".
- [x] Install prompt (spec item 13): the existing `InstallButton` surfaced beside
      the alerts ask, with a new `hideWhenInstalled` prop. Installing is a
      *prerequisite* for notifications on iPhone, not a parallel feature.

**🛑 TWO THINGS THE WORK UNCOVERED THAT WERE NOT ON THIS LIST.**

1. **`initPWA` was mounted only on auth routes.** It attaches the
   `beforeinstallprompt` listener, and its sole caller — `ServiceWorkerRegistration`
   — is rendered only by `AuthRouteGlobalChrome` (`/login`, `/signup`). The browser
   fires that event once, early, so a signed-in user on `/core` never had it
   captured: `canInstallApp()` was permanently false and every install affordance
   degraded to a manual instructions `alert()`. Now called from `SafeGlobalChrome`.
   **Same shape as the push opt-in itself: built, correct, mounted where it could
   not work.**

2. 🛑 **`LeftChatPanel` fired an unprompted `Notification.requestPermission()` from
   a bare mount effect** — no user gesture, no explanation — and it is mounted on
   the **league page**. Two consequences, and the second is severe: browsers
   penalise gesture-less permission requests (quieter UI or auto-block), and **a
   denial is sticky and cannot be re-asked from script**, so one reflexive "Block"
   there permanently disabled web push for that user — including the game-day
   alerts this entire phase exists to deliver. One panel could poison the feature
   for the whole app. Deleted; the DM notification below it is gated on
   `permission === 'granted'` and still works for users who opted in properly.

**Measured — 52 tests pass across the six avatar + push suites.** Positive control:
a second `Notification.requestPermission()` call was planted as real code in the
banner, the mutation proved applied with `diff -q`, **both** invariant tests went
red, and the restore verified identical.

⚠ **The repo-wide "exactly one permission flow" test reported ITSELF as a violation
three times before it was right**, each time a different comment style: a JSDoc
block explaining why the banner does not call it, the note recording the removed
call in `LeftChatPanel`, and a `{/* … */}` JSX comment. Prefix heuristics caught
two and missed the third. It now strips block comments statefully. **A guard that
matches documentation of the rule is not a guard.**

### Phase 5 — Notification preferences (spec items 14, 15, 16)

- [ ] Global on/off (exists) + **per-league override in league settings**.
- [ ] Category toggles: injuries, trades, waivers, mentions; draft on-the-clock
      staged for later.
- [ ] **Quiet hours** in the main settings menu, with copy telling users it exists.
- [ ] Server must honour all three (global, per-league, quiet hours) in
      `NotificationDispatcher` / `outboxRelay` — not just in the UI.

### Phase 6 — Verification (spec item 20: all of the below)

- [ ] Subscription row appears in `WebPushSubscription` after enabling.
- [ ] Green test send from the server.
- [ ] A real push lands on a physical phone from production, in the TWA.
- [ ] Same three verified on Android in the Play build specifically.

---

## 5. Rules that apply to landing this work

From `CLAUDE.md`, and not optional here:

- **Cherry-pick onto `main` in a detached worktree. Never merge in the shared tree.**
- **Do not push.** Hand the SHA plus the base SHA you built on to the designated
  pusher (`npm run push:pusher` shows who holds the role).
- **Attest to the COMMIT, not the working tree** — check the SHA out detached and
  re-run. Give the error TOTAL against a baseline, never "none in my files".
- The repo carries a standing typecheck error baseline, so a non-zero exit is
  normal. An empty `tsc` run has four distinct causes — verify the file under test
  is actually in the compile set.
- Stage explicit paths; never `git add -A`. Read the staged set in its own call
  before committing.

---

## 6. Open questions

- **Testing access.** The user offered `cjabar.henson@gmail.com`. Unresolved
  whether a Play Store internal-test device is also needed for Phase 6. A browser
  test will NOT prove TWA notification delegation.
- **Which meaningful action** triggers the permission ask (Phase 4).
- **Badge semantics** (spec 17, left to judgement): today
  `app/core/[[...screen]]/page.tsx:948` counts stored `platformNotification` rows
  only, excluding derived "act today" items. Proposal: keep it, so the badge
  matches what tapping through actually shows as unread.
- **Preset vs upload precedence** (spec 7, left to judgement). Proposal: an upload
  always wins and clears the preset; picking a preset clears the upload. Make the
  destructive direction explicit in the UI instead of silent.

---

## 7. Fast resume

Picking this up cold:

1. Read §2.1 and §2.4 — those two are the whole problem.
2. Phase 1, and the first box of Phase 4, are the highest value per line changed.
3. Nothing has been changed yet. `git status` should show no edits from this work.
