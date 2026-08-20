# AF Launch Certification Checklist — OAuth + League Import

**Scope:** the two audit items that can only be certified in a live/production-like
environment: (1) Google / Spotify / Discord social sign-in, and (2) real
Sleeper / ESPN / Yahoo league import → dashboard.

**Why this can't be done from code review:** buttons and providers are gated on
environment variables and provider-dashboard configuration that don't exist in the
repo. Everything below is grounded in the actual wiring:
`lib/auth.ts`, `lib/auth/SocialProviderResolver.ts`,
`components/auth/NocturneOAuthGrid.tsx`, `lib/league-import/provider-ui-config.ts`,
and `.env.example`.

Run each section against a deployed URL (Vercel/Railway) with production-like env,
not `localhost`, since OAuth callbacks and cookies are origin-sensitive.

---

## 0. Pre-flight (do once, before any provider testing)

- [ ] `NEXTAUTH_URL` is set to the exact deployed origin (scheme + host, no trailing slash), e.g. `https://www.allfantasy.ai`. Mismatch here is the #1 cause of OAuth "redirect_uri_mismatch" and callback failures.
- [ ] `NEXTAUTH_SECRET` is set to a stable, secure random value (not the placeholder).
- [ ] The origin you test in the browser matches `NEXTAUTH_URL` exactly (no `www` vs apex, `http` vs `https`, or `localhost` vs `127.0.0.1` drift).
- [ ] `npm run build` completes clean on the deploy target (this also confirms the SSR landing change is good).

---

## 1. Social sign-in (Google / Spotify / Discord)

### 1a. How a button actually goes live (the gotcha)

A provider button is **live** only when BOTH are true:

1. **Server registration** — `lib/auth.ts` registers the provider only when its
   `*_CLIENT_ID` **and** `*_CLIENT_SECRET` are both present.
2. **Public flag** — the client bundle can't see server-only secrets, so the button's
   live/"Soon" state is driven by `NEXT_PUBLIC_ENABLE_*_AUTH === "true"`
   (see `SocialProviderResolver.isSocialProviderEnabled`).

Consequences to watch for:

- Flag `true` but secrets missing → button looks live but `signIn()` errors on the callback.
- Secrets present but flag `false`/absent → server works, but the button shows **"Soon"** and routes to `/auth/provider-pending` (no dead buttons, but no login either).
- **Both** must be set in production for a working, visible button.

> ⚠️ **Known env gap:** `.env.example` lists `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH`,
> `_APPLE_AUTH`, and `_SPOTIFY_AUTH` but **not** `NEXT_PUBLIC_ENABLE_DISCORD_AUTH`.
> The resolver reads it (`SocialProviderResolver.ts`), so Discord will silently stay
> "Soon" in a client build unless you set it explicitly. (I've added it to
> `.env.example` in the accompanying change — still set it in the deployed env.)

### 1b. Per-provider environment + dashboard setup

| Provider | Server env (both required) | Public flag (set `"true"`) | Callback/redirect URI to register in the provider dashboard |
|---|---|---|---|
| **Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH` | `{NEXTAUTH_URL}/api/auth/callback/google` (Authorized redirect URI in Google Cloud Console) |
| **Spotify** | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | `NEXT_PUBLIC_ENABLE_SPOTIFY_AUTH` | `{NEXTAUTH_URL}/api/auth/callback/spotify` (Redirect URI in Spotify Developer Dashboard) |
| **Discord** | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `NEXT_PUBLIC_ENABLE_DISCORD_AUTH` | `{NEXTAUTH_URL}/api/auth/callback/discord` (Redirect in Discord Developer Portal → OAuth2) |

Setup steps per provider:

- [ ] **Google** — In Google Cloud Console → APIs & Services → Credentials, create an OAuth 2.0 Client ID (Web application). Add the callback URI above. Configure the OAuth consent screen (scopes: email, profile). Copy client ID/secret into env; set the public flag.
- [ ] **Spotify** — In the Spotify Developer Dashboard, create an app, add the Redirect URI above under Settings. Copy client ID/secret; set the public flag.
- [ ] **Discord** — In the Discord Developer Portal, use a dedicated NextAuth OAuth2 app (⚠️ **separate** from the existing Discord *bot/account-linking* integration at `/api/auth/discord/callback` — do not reuse those credentials; see the note in `lib/auth.ts`). Add the callback URI above as an **additional** redirect. Scopes: `identify`, `email`. Copy client ID/secret; set the public flag.

### 1c. Per-provider smoke test (run all 8 for EACH of Google, Spotify, Discord)

For each provider, from the deployed `/signup` and `/login`:

- [ ] **1. New-account sign-in** — Sign in with a provider account that has never used AllFantasy. Confirm a new AppUser is created and you land on `/dashboard`.
- [ ] **2. Existing-account sign-in** — Sign out, sign in again with the same provider account. Confirm it resolves to the **same** AppUser (no duplicate), lands on `/dashboard`.
- [ ] **3. Same-email account linking** — With an account that already exists via email/password (or another provider) using email X, sign in with a provider that reports the **same verified** email X. Confirm it links to the existing user rather than creating a second account. (Behavior is enforced in `SocialAccountLinkingService` — verified-email required to link.)
- [ ] **4. Import-intent preservation** — Start from the landing import bar (enter a Sleeper username), get bounced to signup, complete OAuth. Confirm you land on `/import` with the provider + username prefilled, not a bare dashboard.
- [ ] **5. Username onboarding** — For a brand-new OAuth user, confirm a valid unique username is generated (no profanity, no email-derived handle) and the choose-username / onboarding step behaves.
- [ ] **6. Return to the import page** — After onboarding, confirm the preserved import intent still resolves (you can complete the import you started pre-signup).
- [ ] **7. Logout and repeat login** — Log out, log back in with the same provider. Confirm session restores cleanly and no duplicate account is created.
- [ ] **8. Error / cancel behavior** — On the provider consent screen, click Cancel/Deny. Confirm you're returned to an honest error state (not a blank page or infinite spinner). Also test with the public flag OFF: the button should show **"Soon"** and route to `/auth/provider-pending`, never a dead click.

### 1d. Provider sign-off

| Provider | Server creds set | Public flag on | Callback registered | 8-step smoke pass | Certified |
|---|---|---|---|---|---|
| Google | ☐ | ☐ | ☐ | ☐ | ☐ |
| Spotify | ☐ | ☐ | ☐ | ☐ | ☐ |
| Discord | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## 2. Email verification (dependency for credential signup)

Credential (email/password) signup requires email verification before continuing, so
certify the mailer alongside OAuth:

- [ ] `RESEND_API_KEY` (and any `FROM`/domain settings) set in the deployed env; sending domain verified in Resend.
- [ ] Create a fresh email/password account on the deployed site → verification email actually arrives → the verification link completes and lands you signed-in.
- [ ] Owner-notification email (`notifyOwnerOfNewSignup` → `allfantasysportsapp@gmail.com`) is received for a new account, and its failure never blocks signup (it's fire-and-forget by design).

---

## 3. League import → dashboard (Sleeper / ESPN / Yahoo)

**Live providers today** (`provider-ui-config.ts`): Sleeper, ESPN, Yahoo.
MFL / Fantrax / Fleaflicker are `available: false` ("Coming soon") — do not certify.

**Canonical funnel:** landing import bar → enter username/league ID → signup (account
required, no anonymous import) → `/import?provider=…&username=…` (or `&leagueId=…`) →
discovery → preview → commit → `/dashboard`.

### 3a. Sleeper (username-based discovery)

- [ ] From the landing full/mini import form, choose Sleeper, enter a real Sleeper **username**, submit.
- [ ] Complete account creation; confirm you land on `/import` with Sleeper selected and the username prefilled.
- [ ] Discovery lists the user's real leagues; select one.
- [ ] Preview shows real rosters/teams; commit.
- [ ] Redirect lands on `/dashboard`.
- [ ] **Known gap to verify/close:** confirm whether the newly imported league is **auto-selected** in the dashboard. The audit flagged that it is *not* — if still true, the user has to manually pick it. Decide whether that's launch-acceptable or needs a fix.
- [ ] Repeat "Import another league" and confirm a second Sleeper league imports and both appear.

### 3b. ESPN (league ID; private leagues need cookies)

- [ ] Choose ESPN, enter a real **league ID**, submit; complete signup; land on `/import` with ESPN + league ID prefilled.
- [ ] **Public league:** discovery/preview/commit succeeds → `/dashboard`.
- [ ] **Private league:** confirm the ESPN cookie path works — this uses the one-click **browser extension** (`ESPN_EXTENSION_ID` + `NEXT_PUBLIC_ESPN_EXTENSION_ID` must both be set to the same value; see `extension/README.md`) and typically a desktop step. Verify the extension hand-off actually returns valid cookies and the import completes.
- [ ] Confirm imported ESPN rosters are real (not placeholder), then `/dashboard`.

### 3c. Yahoo (OAuth connection)

- [ ] `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, and `YAHOO_REDIRECT_URI` (= `{origin}/api/league/yahoo/callback`) set in env; the same redirect registered in the Yahoo Developer app.
- [ ] Choose Yahoo, submit; complete signup; run the Yahoo connect/authorize flow.
- [ ] Discovery lists the user's Yahoo leagues; select, preview, commit → `/dashboard`.
- [ ] Confirm the Yahoo OAuth token is stored and a re-import/refresh works without re-authing every time.

### 3d. Import sign-off

| Provider | Setup/env | Public league | Private/auth path | Preview real data | Lands on /dashboard | Auto-select verified | Certified |
|---|---|---|---|---|---|---|---|
| Sleeper | ☐ | n/a | ☐ (username) | ☐ | ☐ | ☐ | ☐ |
| ESPN | ☐ | ☐ | ☐ (cookies/ext) | ☐ | ☐ | ☐ | ☐ |
| Yahoo | ☐ | n/a | ☐ (OAuth) | ☐ | ☐ | ☐ | ☐ |

---

## 4. Final launch gate

- [ ] All three OAuth providers certified (§1d).
- [ ] Email verification + owner notification certified (§2).
- [ ] All three import providers certified end-to-end to dashboard (§3d).
- [ ] Auto-select-imported-league decision made (fix or accept).
- [ ] One full "cold" run as a brand-new user: land on `/` → start an import → sign up with Google → finish import → see the league on the dashboard, in one sitting, on a real device.

---

*Prepared as the live-environment companion to the landing-page hardening work
(copy accuracy, five-tier pricing, mobile, Light/Dark/AF theming, five languages,
and SSR — all already committed). Items here need provider dashboards, production env
vars, and real accounts, so they're yours to run; send me any failures and I'll fix
the code path.*
