# Follow-up: Post-signup onboarding flow

**Status:** ✅ BUILT (2026-07-17) — extended the pre-existing `/onboarding` profile-completion stage rather than building a new route. What shipped:
- `app/onboarding/OnboardingForm.tsx` — rewritten into Nocturne with username (live availability + suggest), display name, avatar (preset grid + upload), timezone, language, and optional phone.
- `app/api/auth/complete-profile/route.ts` — extended to validate + persist username (case-insensitive uniqueness), avatar (preset or upload), timezone, and preferredLanguage, alongside the existing name/phone, then set `profileComplete=true`. Verification gate unchanged.
- `lib/signup/OnboardingProfileResolver.ts` — pure validation/normalization (14 unit tests in `lib/signup/__tests__/`).
- `app/onboarding/page.tsx` — Nocturne restyle + loads the current username/avatar/timezone/language as defaults.
- Routing hook: `app/api/auth/register/route.ts` now appends `returnTo=/onboarding` to the verification email link, so only the new-signup cohort is routed into onboarding after verifying (existing users untouched; `/onboarding` self-guards).
- Left untouched: the separate `/onboarding/funnel` product tour (welcome/sports/tools/league).

**Why this exists:** The redesigned signup form intentionally stopped collecting username, phone, avatar, timezone, and language. Those need a home. This is that home.

## Background / current state

- `/signup` (`app/signup/SignupContent.tsx`, Nocturne design) now collects **only** full name, email, password, confirm, and one consent checkbox.
- On registration, `POST /api/auth/register` **auto-generates an internal placeholder username server-side** (`lib/signup/AutoUsernameGenerator.ts`) and creates the account with `UserProfile.profileComplete = false`.
- There is currently **no onboarding UI**, so `profileComplete` stays `false` and users keep their auto-generated handle (e.g. `jordan_rivera` or `manager_4821`). The real name is preserved as `displayName`, so most of the app already shows something sensible — but the user never got to choose their username or set the other profile fields.

## What to build

An onboarding flow (e.g. `/onboarding` or `/welcome`) that runs after email verification + first sign-in for accounts with `profileComplete === false`, collecting:

1. **Username selection with live availability checking** — reuse `/api/auth/check-username` + `/api/auth/suggest-username` and `lib/auth/username-validation.ts`. Pre-fill the auto-generated handle as an editable suggestion. Persist the chosen username to `AppUser.username`.
2. **Phone verification** — reuse `lib/auth/PhoneVerificationService` + the Twilio verify flow the old signup used (see git history of `SignupContent.tsx` / `components/auth/AdvancedOptionsSection.tsx`).
3. **Avatar** (preset picker + upload) — reuse `lib/signup/AvatarPickerService` + `lib/avatar/ProfileImageUploadStorageService`.
4. **Timezone** — reuse `lib/signup/timezones` + `TimezoneSelectorService`.
5. **Language / preferences** — reuse the i18n `LanguageToggle` + `preferredLanguage`.

## Requirements

- On completion, set `UserProfile.profileComplete = true`.
- Add a redirect/guard (middleware or a dashboard-entry check) that sends `profileComplete === false` users into onboarding after sign-in, and lets completed users skip it.
- Match the Nocturne visual system used by the new auth pages (`components/auth/nocturne-auth.css`, `components/auth/NocturneAuthShell.tsx`).
- Include tests.
- **Salvage, don't rebuild:** the old field-collection UI still exists in git history — the previous `app/signup/SignupContent.tsx` + `components/auth/AdvancedOptionsSection.tsx` have working components for every one of these fields.

## Related

- Redesign summary: memory `nocturne-auth-redesign`.
- Generator: `lib/signup/AutoUsernameGenerator.ts` (+ `lib/signup/__tests__/AutoUsernameGenerator.test.ts`).
