# G31 Create League Video Tile Interactions

## Audit

- G30 Create League sport and league-type choices were plain button cards in `CreateLeagueWizard`.
- Draft selection remained a native select, which G30 Playwright coverage depends on.
- Existing deterministic media registries already map sport, league-type, and draft MP4/poster assets under `public/media/create-league`.
- Existing Create League proof covers SSR dark cookie, Spanish language cookie, mobile layout, import modal, and AF Commissioner advanced setup.

## Implementation

- Added `CreateLeagueVideoTile` as a reusable client component for sport, league-type, draft, and future concept tiles.
- Videos are muted, inline, looped, and metadata-preloaded only; they play on hover/focus/touch pointer preview and pause/reset on leave/blur.
- Reduced-motion disables preview playback and leaves the static poster/icon surface.
- Missing video sources fail closed; the tile still renders and remains selectable.
- Selected state stays above the media layer with a persistent border/check indicator.
- Sport and league-type cards now use shipped media registry MP4s/posters.
- Draft formats now have preview tiles while preserving the existing select for G30 create-flow compatibility.

## Verification

- `cmd /c npx vitest run __tests__/create-league-video-tile.test.tsx __tests__/create-league-media-registry.test.ts --reporter=dot`
  - Passed: 2 files, 11 tests.
- `cmd /c npx vitest run __tests__/create-league-video-tile.test.tsx __tests__/create-league-media-registry.test.ts __tests__/create-league-g30-simple-create.test.ts __tests__/create-league-v2-form-completion.test.ts __tests__/create-league-v2-submit-api-leagues.test.ts --reporter=dot`
  - Passed: 5 files, 37 tests.
- `PLAYWRIGHT_PORT=3111 AF_NEXT_DIST_DIR=.next-playwright-3111 npx playwright test e2e/create-league-g31-video-tiles.spec.ts --project=chromium --reporter=line --workers=1`
  - Passed: 3 tests.
  - Covered page load, hover/focus video playback, selection after hover, reduced-motion no autoplay, mobile/touch pointer selection, dark cookie rendering, and import modal.
- `PLAYWRIGHT_PORT=3112 AF_NEXT_DIST_DIR=.next-playwright-3112 npx playwright test e2e/create-league-g30-simple-flow.spec.ts --project=chromium --reporter=line --workers=1`
  - Passed: 4 tests.

## Remaining Gaps

- A targeted `tsc -p tsconfig.g31.tmp.json` attempt still traversed shared auth/prisma imports and failed on existing unrelated repo-wide type errors in `lib/auth.ts` and `lib/prisma.ts`.
- Playwright server shutdown continues to print existing `ECONNRESET`/Meta CAPI placeholder noise after successful runs.
- Readiness remains unchanged.
