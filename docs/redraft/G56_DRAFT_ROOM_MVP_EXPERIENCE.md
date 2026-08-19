# G56 — NFL & NCAAF Draft Room MVP Experience

## Executive summary

G56 completed a focused customer-experience hardening pass over the existing AllFantasy live draft room. It did not change pick authority, persistence, realtime architecture, provider wiring, league data, or draft rules.

The current room already had a strong source foundation from earlier phases: an AllFantasy War Room shell, sticky/current-pick board treatment, virtualized player pool, search/filter/sort controls, rich player cards, queue ordering, roster views, Draft Assist reasons, chat, responsive workspaces, mobile navigation, loading/error states, and reduced-motion-aware board following.

G56 addressed remaining source-verifiable rough edges:

- Added a persistent clear-queue action with explicit destructive confirmation.
- Added a visible and screen-reader queue count.
- Added polite current-pick announcements and accessible board navigation labels.
- Marked the current manager header semantically.
- Connected the real player-pool loading-stage message to the customer UI.
- Replaced internal Draft Assist feature names with customer-safe language.
- Improved the Draft Assist empty state.
- Removed two unnecessary memo dependencies in touched player/queue paths.
- Added focused regression contracts.

Authenticated multiplayer and live-provider certification remain separate gates. The local in-app browser could not establish a trusted control connection, so no 390×844 visual certification is claimed.

## UX improvements

### Queue

- Queue header now displays the live queue count.
- Customers can clear the full queue without removing players one at a time.
- Clear is protected by an inline confirmation showing the exact affected count.
- Cancelling the confirmation leaves the queue untouched.
- Confirming persists an empty queue through the same existing canonical queue-save endpoint.
- Existing drag/drop and keyboard up/down ordering remain intact.
- Existing queue filters, ADP/AI ranking display, injury/rookie badges, auto-pick state, away mode, next-player drafting, and persistence are preserved.

### Player pool

- The loading state now displays the actual stage supplied by the draft-room orchestrator instead of always saying only “Loading player pool.”
- Existing virtualization, memoized filtering/sorting, drafted-state suppression, search, sport position groups, team/pool filters, watchlist, rookie/veteran filters, ADP, projections, injury state, headshots, and NCAAF school/class fallbacks were verified in source.

### Draft Assist

Internal-facing labels were removed from the customer surface:

| Previous label | Customer label |
| --- | --- |
| Chimmy Ready | Draft assistant |
| Live Brain | Live recommendations |
| AI ADP | Market rankings |
| Queue Reorder | Smart queue |

The empty state now explains that recommendations and player context appear once sufficient draft data exists. Existing recommendation labels, confidence, stack opportunity, bye conflict, safety/upside treatment, and per-player reasons remain intact.

## Visual improvements

The source audit confirmed the board already contains:

- Strong current-pick emphasis and latest-pick styling.
- Sticky manager headers with initials and current-owner emphasis.
- Distinct round headers and snake-direction indicators.
- Traded-pick count, color treatment, and history affordances.
- Single-round focus, all-round view, previous/next navigation, and jump-to-current.
- Smooth current-pick following that respects reduced-motion preferences.
- Late-round horizontal readability through minimum column widths and snap scrolling.
- AllFantasy cyan/amber/emerald status hierarchy and restrained gradients.

G56 added semantic current-owner state and a live current-pick announcement without altering this presentation.

## Mobile improvements

- Clear queue and auto-pick controls remain reachable in the compact queue header.
- Clear confirmation wraps instead of overflowing narrow panels.
- Queue count is visible without opening secondary AI options.
- Existing keyboard-accessible up/down controls provide a mobile alternative to drag-and-drop.
- Existing player pool actions use 44-pixel minimum touch targets.
- Existing mobile board scrolling, sticky clock/current-pick rail, workspace tabs, and queue/player/helper/chat entry points were preserved.

Physical 390×844 browser QA was not completed. Browser setup failed because the local browser control connection was not trusted by the host session. No fixture screenshot is presented as authenticated runtime evidence.

## Accessibility improvements

- Draft board now has a descriptive accessible label.
- Current overall pick and owning slot are announced through a polite live region.
- Previous/next round icon buttons have explicit accessible names.
- The active team header uses `aria-current`.
- Queue count exposes a complete “players queued” accessible label.
- Clear-queue confirmation uses an alert role and explicit Keep/Clear actions.
- Existing queue remove and reorder actions retain player-specific accessible labels.
- Existing current-pick auto-scroll continues to honor `prefers-reduced-motion`.

## Performance improvements

- Queue metadata resolution is stabilized with `useCallback`, avoiding a changing dependency during derived queue sorting.
- The player filter memo no longer depends on an unused AI ADP toggle.
- Existing long player lists remain virtualized with sport/presentation-specific row estimates and overscan.
- No secondary intelligence or image work was added to the pick submission path.

## Screens and components updated

- `components/app/draft-room/DraftBoard.tsx`
- `components/app/draft-room/QueuePanel.tsx`
- `components/app/draft-room/PlayerPanel.tsx`
- `components/app/draft-room/DraftHelperIntelligence.tsx`
- `components/app/draft-room/DraftRoomPageClient.tsx`
- `__tests__/draft-room/g56-customer-experience.test.ts`
- `docs/redraft/G56_DRAFT_ROOM_MVP_EXPERIENCE.md`

The repository was already heavily modified. Unrelated user files and existing draft-room edits were preserved.

## Validation results

All Vitest commands used `--pool=threads --maxWorkers=1`.

### Passing tests

1. G56 and queue UX:
   - Final G56 contract: 1 file, 4 tests passed.
   - Queue UX contract: 4 tests passed in the preceding bounded run.
2. Board/queue regression group:
   - 4 files, 11 tests passed.
   - `draft-queue-unified-display.test.ts`
   - `draft-board-layout.test.ts`
   - `draft-board-unified-display.test.ts`
   - `draft-pick-action-visibility.test.ts`
3. Player pool/state regression group:
   - 5 files, 47 tests passed before the final loading-copy rerun.
   - `player-pool-position-counts.test.ts`
   - `pool-loading-state.test.ts`
   - `draft-room-ui-state.test.ts`
   - `floating-dock-visibility.test.ts`
   - `adp-readiness-copy.test.ts`
4. Final changed loading/queue/G56 rerun:
   - 3 files, 26 tests passed.

Distinct validated coverage: **11 files, 66 tests passed, 0 failures, 0 skips, 0 retries**.

One initial six-file aggregate run timed out at approximately 124 seconds amid concurrent repository Node workers. It is not counted as passing. Its groups subsequently passed in bounded split runs. A later chained test-plus-lint command also timed out during lint and is not counted; both portions subsequently passed independently.

### Static validation

- Targeted ESLint over all touched UI/test files: **PASS**, 0 errors, 0 warnings.
- `git diff --check` over G56 files: **PASS**; only line-ending notices were emitted.
- Targeted TypeScript dependency graph: the G56 `loadingMessage` contract error discovered on the first run was fixed. The rerun reported only four existing repository-baseline failures:
  - Three session-user augmentation errors in `lib/auth.ts` (`username`, `id`, `spotifyAccount`).
  - Missing `web-push` declarations in `lib/push-notifications/push-service.ts`.
  - No G56 component emitted a TypeScript error after remediation.
- Visual browser validation: **BLOCKED** because the in-app browser connection could not be established as trusted. No alternate browser was used to bypass that boundary.

## Remaining visual work

- Physical authenticated 390×844 and desktop design review.
- Mobile keyboard-open behavior for player search and chat.
- Modal focus-trap and screen-reader traversal certification.
- Real long-draft performance profile with late-round board and large provider pools.
- Authenticated multi-user validation of current-pick movement, queue persistence, pick feed, chat, and commissioner controls.
- Live-provider completeness/freshness validation for projections, injury data, news, rankings, and images.

## Recommended next phase

Run a customer design review against the explicit local harness and then the trusted authenticated development draft when browser access is available. The review should cover desktop and 390×844, exercise queue clearing and persistence, verify timer/pick reachability, and record screenshots plus console/network evidence. It must not be treated as G53B multiplayer certification unless multiple authenticated users and real database writes are actually exercised.

Published readiness remains unchanged:

- NFL Redraft: **95%**
- NCAAF Redraft: **80%**
- August 10 Controlled Beta: **70%**

```text
G56 DRAFT ROOM MVP EXPERIENCE: PARTIAL
DRAFT BOARD POLISHED: YES
PLAYER EXPERIENCE IMPROVED: YES
DRAFT ASSIST IMPROVED: YES
QUEUE EXPERIENCE IMPROVED: YES
MOBILE EXPERIENCE IMPROVED: PARTIAL
READY FOR CUSTOMER DESIGN REVIEW: YES
```
