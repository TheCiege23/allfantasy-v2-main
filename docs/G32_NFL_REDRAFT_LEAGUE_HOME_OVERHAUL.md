# G32 NFL Redraft League Home Overhaul

## What Changed

- Added a focused NFL redraft League Home dashboard for the first league surface after creation.
- Updated NFL redraft tabs to: Home, Draft, Roster, Matchups, Waivers, Trades, Standings, League Chat, Commissioner.
- Kept Commissioner visible only for commissioner/co-commissioner surfaces.
- Added a deterministic G32 browser harness for the new League Home dashboard and intro proof.
- Added replay support for the redraft intro through a scoped `af:replay-league-intro` event.
- Added reduced-motion handling for intro video overlays so autoplay is replaced with a static preview.

## Language Shift

Customer-facing G32 copy now leads with Decision OS and intelligence language instead of AI-forward wording.

- League Home uses Decision OS, League Intelligence, Manager Intelligence, Commissioner Intelligence, smart recommendations, league health, draft readiness, trade health, and league helper language.
- Settings labels now use Decision OS, Commissioner Intelligence, League Health, Trade Health, Manager Engagement, Fair Play Monitoring, Draft Readiness, Automation, Advanced Rule Support, and Weekly League Report.
- Chimmy remains secondary as Ask Chimmy / League helper / Draft guide language.
- Existing internal ids such as `aiDraftRecs` and `commissioner_ai_tools` were preserved to avoid breaking storage, routes, and entitlements.

## Access Model

- Free commissioners see Commissioner HQ, basic setup actions, member readiness, rules, chat, and locked Commissioner Intelligence previews.
- AF Commissioner and Supreme users see Commissioner Command Center and unlocked League Intelligence / Decision OS shortcuts.
- Free managers see Draft HQ, roster prep, rules, chat, and locked Manager Intelligence previews.
- AF Pro and Supreme users see unlocked Manager Intelligence and personal Decision OS messaging.
- Server-side settings mutation now rejects premium commissioner intelligence fields unless AF Commissioner or Supreme entitlement is present.
- Basic league helper settings remain separate from premium controls.

## Settings Coverage

The main settings modal language now covers standard fantasy settings:

- General
- Draft
- Roster
- Scoring
- Waivers
- Trades
- Playoffs
- Members
- Notifications
- Permissions

Premium commissioner settings are labeled as:

- Commissioner Intelligence
- Decision OS
- League Health
- Trade Health
- Manager Engagement
- Fair Play Monitoring
- Draft Readiness
- Automation
- Advanced Rule Support
- Weekly League Report

## Tabs Verified

G32 Playwright proof covers tab visibility and interaction for:

- Home
- Draft
- Roster
- Matchups
- Waivers
- Trades
- Standings
- League Chat
- Commissioner where the viewer is a commissioner

## Draft, Mock, And Scoring Status

- Draft tab routing remains wired through existing LeagueShell tab routing.
- Mock Draft was not rebuilt in G32.
- Scoring calculator/preview behavior was not changed in G32; existing scoring settings tests remain the source of truth.
- No fake draft data, scoring data, confidence, or live activity was added.

## Verification Run

- `cmd /c npx vitest run __tests__/g32-nfl-redraft-home-dashboard.test.tsx __tests__/g32-league-home-contract.test.ts --reporter=verbose` passed.
- `cmd /c npx playwright test e2e/g32-nfl-redraft-league-home.spec.ts --project=chromium --reporter=line` passed.
- `cmd /c npx playwright test e2e/create-league-g31-video-tiles.spec.ts --project=chromium --reporter=line` passed.

## Remaining Gaps

- `cmd /c npm run typecheck` is blocked by stale generated `.next-playwright-3101/types/**/*.ts` entries referenced by `tsconfig.json`; it fails before G32 files are checked.
- The broad `e2e/league-creation-click-audit-unified-defaults.spec.ts` failed because the current Create League page headline is `Create a league in minutes`, while the older spec waits for `/create league/i`. The G31 Create League browser proof passed.
- Full authenticated `/league/[leagueId]` browser coverage for saving basic settings, co-commissioner save, normal-user mutation denial, and every real tab body remains outside this scoped harness.
- G32 did not change scoring calculator logic; no new scoring calculator assertion was added beyond source contracts and existing tests.
