# AllFantasy — Build Plan

Turning the approved mockups + investigations into a sequenced roadmap. Ordered by
dependency and value. Each phase says what to **reuse** (already in the repo) vs. **build**,
the key files/systems, and the decisions/risks.

---

## Ground rules (read first)

- **Work on a focused branch** off a known-good point. The current tree churns and reverts
  edits (we saw the Team Settings modal line revert 3×). A stable branch is prerequisite.
- **This cloud session can't run your build/tests**, and edits to *tracked* files through the
  file bridge get reverted while *new* files stick. For real iterative building, run the task
  from the desktop app's **"Run this task → On your computer"** so changes persist and I can
  run `typecheck`/`vitest`/`git` directly. Otherwise I deliver new files + diffs you apply and
  commit.
- **Verify each phase** with `npm run typecheck` + the relevant vitest/playwright suites before
  moving on. No phase is "done" until it's green locally.
- **Reuse is the theme.** Stripe, entitlements, `FeatureGate`, the Legacy engine, the dashboard
  league source, white-label theming, and the i18n provider already exist. Most phases are
  wiring + UI on top of working plumbing, not greenfield.

---

## Phase 0 — Foundation & unblock (do first, ~small)

Goal: land what's already written, and stand up the shared skin everything else depends on.

- **Land the delivered patches** (all in `RANK_AND_IMPORT_FIXES.md` + the Team Settings note):
  - Team Settings modal wiring (the 1-line import + panel swap that keeps reverting).
  - Rank: native AF leagues counting (`deriveNativeLeagueRows.ts` new file + `calculateRank.ts`
    hook) and the two-engine reconciliation.
  - Import gating (ESPN/Yahoo auto-verify + Fantrax/Fleaflicker attestation).
  - Commit each to git so churn can't undo them; run typecheck + `__tests__/rank` + import tests.
- **Shared design tokens** — extract the mockup skin (dark/light CSS variables via
  `data-theme`, the AF palette, the AF shield SVG) into one place the app already has hooks for:
  `tailwind.config.js` + `app/globals.css` + the existing white-label (`resolveTenantBrand`,
  `tenantThemeStyle`). Every new surface (landing, dashboard, paywall) consumes these. This is
  what makes "theme + language work everywhere" real instead of per-page.
- **Confirm the native-rank data dependency**: verify your season-finalize pipeline writes
  `franchise_seasons` rows (with `userId`) for native AF leagues. If not, add that write — it's
  the companion to the rank fix (otherwise native leagues score 0).

Decision: pick the base branch / whether to run on-computer for the rest.

---

## Phase 1 — Landing + no-login guest Legacy (top of funnel)

Goal: the approved landing, and let a visitor run AF Legacy with no account, then land on the
dashboard. Highest visibility; drives everything downstream.

**Reuse:** Legacy engine (`/api/legacy/import`, `worker/run`, `/api/legacy/profile`, legacy
tables, `computeAndSaveRank`); the i18n provider (`LanguageProviderClient` / `useLanguage`) +
your Google Translate integration; white-label theming.

**Build:**
- **Landing page** (`app/page.tsx` or a new marketing route) from the `af-landing` mockup: hero,
  7-platform picker with per-platform step-by-step import panels, B2B "Schedule a demo" band,
  working theme + language dropdowns.
- **Guest import path.** Today `/api/legacy/import` requires `requireVerifiedUser()`. Add a
  guest variant: a signed guest-session cookie, run the Sleeper import into a guest-scoped record
  (or compute read-only + cache), expose `/api/legacy/profile` for the guest. Sleeper data is
  public, so no user auth is needed to fetch it.
  - **Abuse protection** (required, since it's public): rate-limit per IP/session, cache by
    username+season, and a light bot check on submit.
- **Language + theme persistence & real translation.** Wire the dropdowns to your Google
  Translate API for live translation of the whole surface (not just baked strings), and persist
  the choice (cookie for guests, `UserProfile` for accounts). Confirm mode + language compose.
- **Route to dashboard** after import (guest state).

Decision: which surface is the marketing landing vs. app root; how long guest data lives.

---

## Phase 2 — Universal dashboard (real) + Legacy integration

Goal: the dashboard we mocked, on real data, with Legacy folded in and a guest/preview state.

**Reuse:** `getDashboardLeagueListForUser` (already returns all leagues across platforms +
native, with the native-rank fix now feeding it); the existing `/dashboard/universal` prototype
we shipped; `FeatureGate`.

**Build:**
- **Re-skin `/dashboard/universal`** to the approved mockup using the Phase-0 tokens: two-row
  header, sport + search, Operating Systems launcher, "Live data connected", tabbed chat
  (DMs / Huddle / Chimmy with the league-context switch), Settings menu (profile/avatar,
  subscription + token balance, connections, log out), Priority-by-Platform row, Dynasty Planet
  search wired to your player-search + roster data.
- **Fold in Legacy tabs** — Overview/Legacy Score, Compare/rivalry, Rankings — as dashboard
  modules (reusing the working `/af-legacy` logic), so the profile lives inside the dashboard,
  not a separate 18k-line page.
- **Guest/preview state** — full dashboard visible; premium modules wrapped in `FeatureGate`
  showing the blurred-panel + "Unlock with AF Pro/Commissioner/War Room" treatment from the
  mockup.
- Promote `/dashboard/universal` toward the primary dashboard (or make it the default view).

Decision: replace the current 3-panel dashboard vs. run universal alongside it first.

---

## Phase 3 — Monetization & gating

Goal: the tiered paywall live, gating the premium surfaces, with guest→account conversion.

**Reuse:** Stripe (already a dep), `useEntitlements` / `useSubscriptionGate` / `SubscriptionGate
Provider`, `FeatureGate`, `hasAfCommissionerSub`, and the `/pricing` `/upgrade` `/wallet`
`/tokens` `/subscription` routes.

**Build:**
- **Tier → entitlement matrix** for AF Free / Pro / Commissioner / War Room / Supreme + Tokens.
  This is a product decision — define exactly what each unlocks (draft from the mockup).
- **Stripe products/prices** (monthly + annual per tier) and map webhooks → entitlements.
- **Wrap gated features** in `FeatureGate` with the preview + upgrade states (Decision OS,
  Commissioner OS, War Room, advanced Legacy/Dynasty Planet).
- **Paywall / pricing page** from the mockup.
- **Guest → account claim**: on signup, associate the guest import/session with the new
  `AppUser` (link `LegacyUser`, migrate the guest-scoped data) so "sign up to save" actually
  saves what they imported.
- **Tokens**: à-la-carte purchase + spend hooks on heavy intelligence actions (you already have
  the token/share-reward primitive).

Decision: final pricing; exact free-vs-paid feature split.

---

## Phase 4 — Import adapters (breadth behind the step UI)

Goal: make the per-platform step flows real. Today only **Sleeper** fully imports.

**Reuse:** the unified `/api/leagues/import/preview` + `/commit` pipeline, `commissionerGate`
(now tightened), the normalization/persistence services, the step-by-step UI from the mockup.

**Build (priority order by reach/effort):**
1. **ESPN** — currently read-only; add persistence into the legacy/live tables + feed rank
   (League ID + SWID/espn_s2 for private leagues). Highest user count after Sleeper.
2. **Yahoo** — OAuth connect → league pick → commit (OAuth scaffolding partly exists).
3. **MFL** — League ID + API key → commit (membership check exists in the gate).
4. **Fantrax** — already parses CSV to a separate schema; route it into the legacy/rank tables.
5. **Underdog** — new adapter (account connect / draft link → best-ball entries).
6. **League Tycoon** — new adapter (league link/ID → history).

Each: wire its mockup steps to the real preview/commit, apply commissioner gating, feed
`franchise_seasons`/legacy so it counts toward rank + dashboard.

Decision: confirm each platform's real auth mechanism before building its adapter.

---

## Phase 5 — Virality (compounding growth)

Goal: turn one import into many, and make shares actually spread. (Detailed in the AF Legacy
review.)

**Build:**
- **Dynamic share/OG images** (satori / Next `ImageResponse`) — career card, championship,
  rivalry, draft-grade — that download *and* render as rich previews when a link is pasted.
  The single biggest virality gap today (no image generation exists).
- **Public `/career/[username]`** no-login page with the OG image + one "build yours" CTA (the
  same surface as the Phase-1 guest landing).
- **Compare / rivalry** → "challenge a friend" links + rivalry cards.
- **League-wide import** → one commissioner imports the whole league's history → all-time
  Hall of Fame / dynasty rankings that *name every manager* and notify them (1 import → N
  invites). Ties into Commissioner OS.
- **Referral attribution + rewards** (tokens) with a visible "X imported from your shares" stat.

---

## Phase 6 — B2B OS

Goal: the enterprise side — the "Schedule a demo" promise made real.

**Reuse:** white-label/tenant system (`resolveTenantBrand`, `canAccessFantasyOS`, the
`/fantasy-os` gateway + `/fantasy-os/executive`), and the parked B2B OS modules.

**Build:**
- **B2B marketing + "Schedule a demo"** flow (from the landing band).
- **Executive OS / Client OS / Retention OS / Growth OS** surfaces (much is built/parked — wire
  the real KPIs: DAU/MAU, retention, churn, engagement, league health, share-driven signups).
- **Tenant onboarding** — a B2B client provides users/leagues/commissioners; AF supplies the
  intelligence layer + shareable career profiles as their retention/acquisition feature.

---

## Suggested sequence & first move

`Phase 0` (land patches + tokens) → `Phase 1` (landing + guest Legacy) → `Phase 2` (dashboard +
Legacy) → `Phase 3` (gating) → then `4/5/6` in parallel tracks.

**Immediate first move:** Phase 0 — get the delivered patches committed and green, cut the
focused branch, and stand up the shared design tokens. It's small, unblocks everything, and
converts work that's already written into landed value.

**Recommended:** run the actual build from the desktop app "On your computer" so edits persist
and tests run locally — the reverting-bridge problem goes away and iteration is far faster.
