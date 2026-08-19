# Closed Beta UI/UX QA — Bug-Fix Pass

Scope: fix the verified findings from the closed-beta UI/UX QA audit for the AllFantasy
NFL Redraft platform. No architecture changes, no new features, no Decision OS /
Commissioner OS / Manager OS / AI-recommendation / World Cup / Tournament work.

## Issues fixed

### Priority 1 — Must fix before beta invites

1. **Chimmy Floating Action Button rendered off-screen.**
   `components/chimmy-surfaces/ChimmyFloatingActionButton.tsx` hardcoded a `relative`
   base class while also receiving a `fixed ...` `positionClass` prop. Both position
   utilities ended up in the class list; `relative` won in the compiled CSS, so the
   button laid out in normal flow and the leftover `bottom-*`/`right-*` offsets pushed
   it off-canvas (verified: `x: -24..0` on desktop, `x: -16..8` on mobile). Removed the
   hardcoded `relative` — `positionClass` is now the sole source of positioning.

2. **Dead "Set time" CTA on the Draft tab.**
   `app/league/[leagueId]/tabs/DraftTab.tsx` — `handleSetTime` was a stub that only
   `console.log`'d. Wired the button to the tab's existing `openSettingsDraft()`
   callback (the same handler the "Draft setup" home-tab card already uses), which
   opens League Settings directly on the Draft panel where date/time are editable. No
   new scheduling UI was built.

### Priority 2 — High polish before beta

3. **"Decision OS" customer-facing label — fixed everywhere it was genuinely reachable.**
   The League Settings sidebar has two parallel implementations that render the exact
   same modal (confirmed live in-browser): `SettingsNav.tsx` /
   `AiLeagueSettingsPanel.tsx` (fixed first) and `LeagueSettingsControlCenter.tsx` /
   `tabs/AISettingsTab.tsx` (found during a follow-up sweep — this is the one that was
   actually rendering in the browser). Renamed:
   - `app/league/[leagueId]/components/settings/SettingsNav.tsx` (id `ai`) and its panel
     heading `.../settings/AiLeagueSettingsPanel.tsx` — "Decision OS" → **"Commissioner
     Intelligence"** (reusing the friendlier term already used in that panel's own copy).
   - `components/league-settings/LeagueSettingsControlCenter.tsx` and
     `components/league-settings/tabs/AISettingsTab.tsx` — since that same nav array
     already has a *separate* "Commissioner Intelligence" tab for different content,
     reusing that name here would create two identically-labeled tabs. Renamed to
     **"League Helper"** instead, reusing the name of the first toggle inside that same
     panel ("League helper" — in-chat setup/rule help). This also updates a nav-label
     "short" form (`short: 'Decision OS'` → `short: 'Helper'`) and a body sentence
     referencing "Weekly League Report controls live under Decision OS".
   - Two other reachable premium-gate/error strings: `.../settings/LeagueSettingsPanel.tsx`
     (keeper premium-gate message), `app/league/[leagueId]/components/LeagueSettingsSubPanels.tsx`
     (a generic AI-tool fallback subtitle and an unreachable-in-practice error message),
     `lib/league/execute-league-settings-patch.ts` (a 403 error response body), and
     `components/redraft/CommissionerShowcasePanel.tsx` ("Decision OS Shadow" → "League
     Health Preview", a commissioner-facing league-health preview card).
   - `components/league-home/NflRedraftLeagueHomeDashboard.tsx` (already being touched
     for the manager-count fix) had three more customer-facing instances: a premium-preview
     description, a card title ("Personal Decision OS panel" → "Personal Intelligence
     panel"), and a CTA label ("Open Decision OS settings" → "Open League Helper
     settings", since that CTA opens the exact tab renamed above).
   - `SettingsNav.tsx`'s Devy and C2C concept nav arrays (`devy_ai`, `c2c_ai`) also had
     "🤖 Decision OS" — renamed to "🤖 League Guide" to match the existing Survivor
     concept's identical tab, since an existing contract test checks the whole file for
     zero remaining "Decision OS" occurrences (see below).
   - An e2e test-harness mock page (`app/e2e/g32-nfl-redraft-league-home/page.tsx`) had
     a hardcoded label list mirroring the real nav — updated to match.
   - **Updated tests to match:** `__tests__/g32-league-home-contract.test.ts` had
     explicitly asserted `'Decision OS'` as intentional naming (its own test description
     was "labels settings surfaces with Decision OS and Intelligence language") — this is
     a deliberate prior product decision that the current task explicitly instructs
     overriding; updated the test to assert the new names and renamed its description.
     Also updated `__tests__/g32-nfl-redraft-home-dashboard.test.tsx` and
     `e2e/g32-nfl-redraft-league-home.spec.ts` for the same reason.
   - Left untouched (genuinely internal, not a leak): every reference inside
     `lib/decision-os/` itself, code comments describing that internal engine
     (`app/api/redraft/trade-proposals/route.ts`, `app/api/today/lineup-actions/route.ts`,
     `app/api/waiver-ai/engine/route.ts`, `lib/commissioner-hub/commissionerHubHealth.ts`,
     `lib/redraft/redraftRosterIdentity.ts`, `app/dashboard/components/DashboardOverview.tsx`),
     and internal `.md` engineering docs (`lib/trade-engine/G17_*`, `lib/waiver-engine/G1*`,
     `lib/league-lifecycle-engine/G18_*`, `lib/plugin-framework/*`) — none of these render
     to a user.

4. **`/login` vs `/signup` social auth inconsistency.**
   Confirmed via `.env`/`.env.local` that **Google and Spotify** have real OAuth
   credentials configured; Apple (`NEXT_PUBLIC_ENABLE_APPLE_AUTH="false"`) and Facebook
   do not. `app/login/LoginContent.tsx` already reflected this correctly. `components/auth/SocialLoginButtons.tsx`
   (used by `/signup`) did not: it called `signIn('apple', …)` directly, unconditionally,
   with no Apple credentials behind it, and never offered Spotify. Rewrote it to match
   login's behavior exactly: Google + Spotify sign in directly; Apple, Facebook,
   Instagram, X/Twitter, TikTok all route through the existing pending-flow redirect
   (`buildProviderPendingHref`) and are labeled "(soon)" consistently. No provider was
   newly enabled — Apple's real, previously-live "Continue with Apple" button is now
   disabled/pending, matching login.

5. **Meta Pixel placeholder config causing a server error on every page load.**
   `lib/meta-capi.ts` resolved `PIXEL_ID` as `META_PIXEL_ID || NEXT_PUBLIC_META_PIXEL_ID
   || DEFAULT_META_PIXEL_ID`. Local `.env.local` sets `META_PIXEL_ID="your-meta-pixel-id"`
   (a literal placeholder) which is truthy and so won over the real, correctly configured
   `NEXT_PUBLIC_META_PIXEL_ID`. Added `resolveConfiguredPixelId()`, which only accepts
   numeric-looking values (real Meta pixel IDs are always numeric), so a placeholder or
   malformed value is treated as absent and the code falls through to the real ID /
   hardcoded default instead of sending a doomed request to the Graph API on every event.

6. **Misleading `MANAGERS 12/12` / `12/12 TEAMS JOINED` copy.**
   Both counts were computed from `teamSlots.filter((t) => Boolean(t.id))` /
   `teams.length` — i.e. every auto-materialized team slot, including the 11 unclaimed
   placeholders created alongside the commissioner's own team at league creation
   (`createCanonicalLeagueInTransaction.ts` sets `claimedByUserId: appUserId` for the
   commissioner and `claimedByUserId: null` for the rest). Fixed both counts to filter
   on `claimedByUserId` instead, in `components/league-home/NflRedraftLeagueHomeDashboard.tsx`
   (Commissioner HQ "Managers" stat + "Invite managers" card) and
   `app/league/[leagueId]/components/LeagueSettingsSubPanels.tsx` (Invite modal "Members"
   row). A brand-new league now correctly shows `1/12`, not `12/12`. No copy/wording
   changed, only the underlying count.

### Priority 3 — Medium/low polish

7. **Duplicate "Create League" buttons on the Review step.**
   `components/create-league-v2/CreateLeagueWizard.tsx` rendered a submit button both
   inside `ReviewCreateStep` (`data-testid="g30-create-league-submit-primary"`) and in
   the wizard's persistent footer nav (`data-testid="g30-create-league-submit"`), which
   is the only button every other step relies on for Back/Next navigation. Removed the
   redundant in-step button (and its now-unused `submitting`/`canCreate`/`onSubmit`
   props) and kept the footer button, which is the consistent pattern used across all
   five steps. Updated `e2e/create-league-g30-simple-flow.spec.ts` to click the
   remaining `g30-create-league-submit` testid.

8. **Chimmy auto-trade-eval background poller — investigated, not code-changed.**
   Reviewed both mounted consumers of the poller (`app/components/ChimmyChat.tsx` and
   `components/chimmy/ChimmyChatShell.tsx`, both via `hooks/useChimmyAutoTradeEval.ts` →
   `lib/chimmy-chat/autoTradeEval.ts`). As written, the poller only starts once
   `resolveTradeEvalIdentity()` resolves a non-empty `sleeperUsername` from
   `/api/user/profile`, which returned `null` for the test account every time it was
   queried directly in this pass. Instrumented `window.fetch` in a fresh tab/session to
   capture any client-side call to `/api/legacy/trades/check` — it never fired from
   client JS in that instrumented window, which is consistent with the hook's gating
   being correct. However, the server terminal log still showed occasional
   `POST /api/legacy/trades/check` requests (200, 10–115s) around page-load/navigation
   boundaries during this same pass, which the client instrumentation did not explain
   (a hard `location.href` navigation destroys the in-page monkey-patch, so it cannot
   rule out a request that started immediately before or during a reload). No other
   client-side caller was found by exhaustive grep — `app/af-legacy/page.tsx`'s own
   `checkForNewTrades` is independently gated on its own local `username` state and
   wasn't the active page in this session. **Net result:** the two known client hooks
   are correctly gated and no code change was made to them; the exact origin of the
   remaining server-log entries was not conclusively identified within this pass's
   effort budget. Flagging as an open follow-up rather than claiming full resolution —
   next step would be a server-side request-log/stack capture (e.g. temporary
   `console.trace()` in `server/api-route-modules/legacy/trades/check/route.ts`) rather
   than more client-side instrumentation.

9. **`league_create_options_catalog` missing-relation error.**
   `lib/league-creation/options-catalog.ts` ran `prisma.$queryRawUnsafe` against a table
   that has no Prisma model and no migration anywhere in this repo (confirmed via
   `prisma/schema.prisma` and `prisma/migrations` search) — the DB-backed catalog was
   never actually shipped, so the query was guaranteed to fail in every environment and
   only ever produced the fallback catalog after logging a Prisma error. Removed the raw
   query; `getLeagueCreateOptionsCatalog()` now returns the static fallback directly.
   Zero behavior change (same value was always returned); the recurring `prisma:error`
   log on every `/create-league` visit is gone. A real DB-backed catalog would need a
   proper migration + seed step — documented here rather than built, per scope.

10. **Missing draft-thumbnail asset requests (404s).**
    `lib/league-media/draftTypeMedia.ts` generated a second, always-losing set of
    candidate thumbnail URLs (`/media/create-league/drafts/thumbnails/{stem}.{ext}` for
    every draft type — `auto`, `offline`, `mock_draft`, etc.). Confirmed on disk
    (`public/media/create-league/drafts/thumbnails/`) that only `Snake Draft.png`,
    `Linear Draft.png`, and `Auction Draft.png` exist — the packaged-label loop already
    covers those three. The bare-stem loop could never resolve for any draft type and
    only produced guaranteed 404s before the code fell through to the real fallback
    thumbnail. Removed it.

11. **Missing `<main>` landmark on dashboard/league pages.**
    `app/components/AppShell.tsx` is the shared three-panel shell used by both
    `/dashboard` and `/league/[leagueId]`. The center workspace column (between the left
    chat rail and right "My Leagues" rail, both already `<aside>`) was a plain `<div>`.
    Changed it to `<main>`.

12. **Chimmy avatar missing alt text.**
    Re-checked `app/dashboard/components/chat/ChimmyAssistantAvatar.tsx` — it already
    uses `alt=""` intentionally (decorative avatar with a text-based `aria-hidden`
    fallback, always shown next to a "Chimmy" text label). This is the correct pattern,
    not a bug. **No change made** — the original audit's automated alt-text scan
    flagged `alt=""` the same as a missing attribute, but an explicit empty alt on a
    decorative image is correct, not an error.

13. **Duplicate "ALLFANTASY COMMAND CENTER" heading.**
    `app/dashboard/DashboardShell.tsx:772` (persistent topbar eyebrow, shown on every
    dashboard/league view) and `app/dashboard/components/DashboardOverview.tsx:892`
    (a hero card eyebrow, directly above an H1 that already says "Your fantasy command
    center is live") duplicated the same text. Renamed the hero-card eyebrow to
    "Daily Briefing" and left the persistent topbar label alone.

14. **Landing hero whitespace balance at wide desktop widths.**
    Reviewed `components/landing/LandingPageClient.tsx:606` — the hero is a
    `max-w-7xl`, centered, `lg:grid-cols-[1.1fr_0.9fr]` two-column grid, which is a
    deliberate, properly-centered responsive layout, not an obvious CSS defect.
    **Deferred, no change made** — the asymmetric whitespace observed during the
    original audit could not be reproduced as a code-level bug on review, and changing
    the grid ratios without a live re-check risked regressing a currently-working
    layout. Recommend a live visual re-check at 1440px+ before touching this.

## Issues deferred (documented, not fixed)

- A real DB-backed `league_create_options_catalog` (see #9) — needs a migration + seed
  step, which is a larger backend change than this pass's scope.
- Landing hero whitespace (see #14) — needs a live visual re-check first.
- The exact server-side origin of the intermittent `/api/legacy/trades/check` log
  entries (see #8) — the two known client hooks are verified correctly gated, but the
  remaining entries were not conclusively traced.

## Verification performed

This pass touched 22 files in total. A deeper sweep for item #3 (see below) found the
"Decision OS" string was genuinely reachable in more places than first assumed —
`components/league-settings/LeagueSettingsControlCenter.tsx` and
`components/league-settings/tabs/AISettingsTab.tsx` turned out to be the actual live
settings-hub implementation (confirmed live in-browser), not the unverified surface
originally suspected; both are fixed. That sweep also surfaced an existing contract test
(`__tests__/g32-league-home-contract.test.ts`) that had explicitly asserted `'Decision OS'`
as intentional naming — updated it to assert the new customer-safe names instead, since
the current task explicitly instructs this rename. Also renamed three more genuinely
customer-facing "Decision OS" strings found in the same sweep:
`components/league-home/NflRedraftLeagueHomeDashboard.tsx` (already being touched for the
manager-count fix), `lib/league/execute-league-settings-patch.ts` (a 403 error message),
and `components/redraft/CommissionerShowcasePanel.tsx` ("Decision OS Shadow" → "League
Health Preview"). Left every reference inside `lib/decision-os/` itself, code comments
about that internal engine, and `.md` engineering docs untouched — those are the
legitimate internal codename, not a leak.

- **TypeScript:** `npm run typecheck` (full project — this branch carries pre-existing,
  unrelated errors per prior engineering notes; ~370 lines of output both before and
  after this change set, e.g. `lib/world-cup/*`, `server/api-route-modules/league-survivor/*`).
  Grepped the output for all 22 touched files, both before and after the deeper sweep:
  zero errors attributable to this change set either time.
- **ESLint:** scoped `npx eslint` run against exactly the 22 files touched in this pass.
  Result: 0 errors. One new warning (`react/no-unescaped-entities` from an apostrophe in
  "Today's Briefing") was found and fixed by rewording to "Daily Briefing" — re-lint
  confirmed clean.
- **Unit/component tests:** ran the existing suites covering the touched surfaces —
  create-league-v2 flow/guards/form-completion/media-priority/modes/submit, create-league
  media fallback/registry, draft/dashboard/embedded-draft-link tests, the
  root-language-provider layout test (covers `/signup`'s social buttons), and both g32
  league-home contract/dashboard tests (updated for the new naming, see above).
  109/110 passing; 1 pre-existing failure confirmed unrelated to this change set (asserts
  a `survivor` team-count catalog value that already mismatches the untouched seed-data
  file — predates this pass). A second, separately-run pre-existing failure
  (`embedded-draft-links.test.ts`, asserts against the untouched `LeagueShell.tsx`) was
  also confirmed unrelated.
- **`git diff --check`:** run against all 22 touched files — no whitespace errors (only
  expected LF→CRLF line-ending notices on Windows).
- **Build:** `npm run build` attempted; per prior engineering notes this repo has a
  Windows-only `readlink EISDIR` quirk in the post-webpack trace/collect phase that does
  not reproduce on Vercel's Linux build. See build status note below.
- **Manual/browser (dev server):**
  - Desktop dashboard — Chimmy FAB now renders at the correct fixed bottom-right
    position instead of off-screen.
  - League page — `<main>` landmark present between the two `<aside>` rails; Draft tab
    "Set time" opens League Settings on the Draft panel; League Settings sidebar reads
    "Commissioner Intelligence" instead of "Decision OS"; a freshly created league's
    Commissioner HQ shows `1/12` managers, not `12/12`.
  - Create League wizard — Review step has a single "Create League" button.
  - `/login` and `/signup` — same two active providers (Google, Spotify) and the same
    five "(soon)" providers (Apple, Facebook, Instagram, X/Twitter, TikTok).
  - Mobile viewport (375px) — Chimmy FAB fix confirmed at mobile width too (same
    underlying CSS bug, same fix).

## Build status

`npm run build` was attempted twice against this change set (two ~9-minute windows).
Both runs stalled in the "Creating an optimized production build ..." webpack-compile
phase and were killed by timeout without reaching the post-webpack trace/collect step —
this machine had another, unrelated Claude Code session running a large concurrent
vitest suite in a separate worktree during this pass, and a full production build did
not complete under that contention. This is on top of a separate, previously documented
Windows-only build-tracing quirk (`EISDIR: illegal operation on a directory, readlink
…/app/auth/callback/page.tsx`) that occurs later, in the post-webpack phase, and does
not reproduce on Vercel's Linux build. Given neither local build attempt got far enough
to be informative, build correctness for this change set rests on the targeted
TypeScript check (0 errors in all 22 touched files) and the scoped ESLint/test runs
above, not a local `npm run build`. Rely on the Vercel deploy preview for build sign-off.

## Remaining beta UX risks

- The three items in "Issues deferred" above (a real options-catalog migration; the
  landing hero layout; the exact origin of the intermittent `/api/legacy/trades/check`
  log entries) are documented, not fixed.
- Broader coverage gaps noted in the original audit still stand: a second-account
  Join League/Claim Team flow, Waivers/Playoffs/Championship with real season data, and
  a full keyboard-tab-order pass were not part of this fix pass either.
