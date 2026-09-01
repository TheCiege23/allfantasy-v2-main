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
- `npm run typecheck`: **145 `error TS` lines, tsc exit 2** — normal for this
  repo's standing baseline. **Zero in any file this phase touched**, and zero in
  any avatar/settings consumer. ⚠ Run in the shared, dirty checkout, so it is not
  an attestation of a commit — re-run detached before handing to the pusher.
- **Positive control run.** The guard was mutated to re-add the age check, the
  mutation was proved applied with `diff -q`, the suite went **red on 2 tests**
  including the differential one, and the restore was verified identical. The
  test can actually fail.

🛑 **ONE CONSEQUENCE TO ACCEPT OR OVERRULE.** `/api/user/profile/avatar` was
session-only before this. It now requires a verified email or phone, per spec
answer #6. That **removes** the age gate (fixing the reported bug) but **adds** a
verification gate on the `/profile` path, which previously had none. Accounts with
no verified email or phone could upload before and cannot now. The comment in
`__tests__/auth-guard-age-vs-verification.test.ts` records that population as
material ("17 of 48 production accounts" at the time it was written — historical,
not a current measurement). If that trade is not wanted, drop
`requireContactVerifiedUser` from the route back to `requireAuth`.

### Phase 2 — Avatar identity scope (spec item 10)

- [ ] Audit every `IdentityImageRenderer` call site (~17 known) and classify each
      as **platform identity** or **league identity**.
- [ ] League surfaces must resolve the league-imported image, never `avatarUrl`.
      Confirm `resolveDashboardAvatarUrl` is not blurring the two.
- [ ] Fix stale `session.user.image` readers — they must read `app_users` or the
      profile hook, never the frozen JWT claim.
- [ ] Test: change the platform avatar; assert AF surfaces update and league
      surfaces do not.

### Phase 3 — Mobile crop/rotate (spec item 9)

- [ ] Add a touch-friendly crop/rotate step to the settings avatar flow.
- [ ] Square output; downscale before upload to keep the payload small.
- [ ] Verify inside the TWA, not just mobile Chrome — the file picker path differs.

### Phase 4 — Make push reachable (unblocks everything in notifications)

- [ ] Set `NEXT_PUBLIC_ENABLE_PWA_SW=1` on preview so push is testable off
      production. **Do this first** — without it Phase 4 cannot be verified.
- [ ] Delete `public/sw-push.js` and `hooks/usePushSubscription.ts` before anyone
      wires the wrong one. Confirm zero importers immediately before deleting —
      check `@/`, relative, dynamic `await import()`, and test mocks, all four.
- [ ] Surface the opt-in in `/core`: render the enable card at the top of
      `/core/notifications` whenever `Notification.permission === 'default'`,
      unconditionally — not gated on `suppressedReason`.
- [ ] Trigger the permission ask on **first meaningful action** (spec item 12).
      Decide and write down what counts — proposal: first completed league import,
      or first lineup change.
- [ ] Add the dismissible game-day banner (spec item 18).
- [ ] Add the install prompt (spec item 13) for browsers supporting
      `beforeinstallprompt`, plus the existing iOS home-screen copy.

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
