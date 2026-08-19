# G34 - Draft Runtime and Smart Draft Room

## Scope

G34 adds a canonical NFL redraft draft-runtime layer on top of the G33 league runtime contract. The goal is to make the draft room consumable by Decision OS, League Intelligence, Manager Intelligence, and Commissioner Intelligence without bypassing canonical league rules.

This pass does not claim a readiness increase. Full readiness should wait for browser proof of a complete live draft through roster assignment in an authenticated league.

## Audit Summary

- Existing live draft services already cover draft sessions, pick submission, roster assignment, auto-pick, commissioner controls, draft chat, post-draft artifacts, and completion.
- `PickSubmissionService` remains the transactional authority for real pick writes.
- `DraftSessionService` remains the session snapshot and completion authority.
- G33 canonical runtime introduced `canonicalLeagueRules`, `leagueRuntimeEvents`, and Decision OS runtime-event derivation.
- Existing draft services still contain older direct settings reads, so G34 adds a canonical facade instead of refactoring the full draft engine.
- Existing draft room browser specs provide harness proof for the draft room, queue, commissioner controls, post-draft summary, mobile navigation, and API controls.

## Runtime Additions

### `lib/draft-runtime/canonicalDraftRuntime.ts`

Pure deterministic runtime helpers:

- Builds canonical draft state from `CanonicalLeagueRules` plus a draft-session snapshot.
- Computes snake, linear, auction, and third-round reversal order.
- Tracks current pick, clock state, completed picks, disconnected managers, offline managers, queue counts, and runtime invariants.
- Validates picks against canonical draft status, on-clock authority, duplicate players, roster capacity, eligible positions, blocking rule mismatches, and premium substitute-manager entitlement.
- Produces Smart Recommendations from deterministic player evidence: roster need, market rank, projected production, remaining position supply, injury status, and scoring context.
- Detects Draft Flow signals: position runs, scarcity, tier cliffs, expired-clock pace.
- Emits canonical draft runtime events through `toCanonicalLeagueRuntimeEvent`.

### `lib/draft-runtime/resolveNflRedraftDraftRuntime.ts`

Server-side facade for current and future route/UI/OS connection:

- Resolves `CanonicalLeagueRules`.
- Gates to NFL redraft only.
- Reads the live draft snapshot through `buildSessionSnapshot`.
- Reads the normalized draft pool through `getResolvedDraftPoolForLeague`.
- Converts normalized draft-pool entries into runtime-player evidence without requiring provider-specific fields.
- Returns canonical state, recommendations, draft-runtime intelligence, and data-coverage counts.

### `lib/decision-os/draft-runtime-intelligence.ts`

Decision OS adapter for draft-room surfaces:

- Commissioner cards: Draft Readiness, Draft Health, Offline Manager Risk, Commissioner Action Center.
- Manager cards: Best Available, Roster Need, Draft Value, Position Run Alerts, Team Construction, Trade-Up Opportunities.
- All cards include evidence, confidence, source event types, and insufficient-evidence behavior.
- Customer-facing copy uses Decision OS / Intelligence / Smart Recommendation language, not assistant-led product wording.

## Canonical Events

G34 extends canonical runtime events with draft-specific activity:

- `draft.scheduled`
- `draft.pick.submitted`
- `draft.queue.selected`
- `draft.autopick`
- `draft.substitute_pick`
- `draft.player_drafted`
- `draft.manager.disconnected`
- `draft.manager.reconnected`
- `draft.recommendation.viewed`
- `draft.trade_opportunity.generated`
- `draft.chat.message`
- `draft.chat.mirrored`
- `draft.recap.generated`

Legacy aliases normalize into these canonical events so older draft routes can be bridged incrementally. Internal legacy event names are not customer-facing copy.

## Server Enforcement Model

G34 intentionally keeps real draft mutations with existing server services. The new validator is a canonical rules layer that can be called before or alongside those services.

Required enforcement for future route wiring:

- Pick submission must still write through `PickSubmissionService`.
- Draft completion must still flow through existing completion/finalization services.
- Substitute manager picks must require the premium Commissioner Intelligence entitlement before persistence.
- Locked or unavailable premium settings must not persist for unpaid leagues.
- Recommendation cards remain recommendation-only unless a real draft/pick/trade route executes the action.

## OS Integration Contract

Claude-side OS work can consume G34 through:

- `resolveNflRedraftDraftRuntime({ leagueId, viewerRosterId })`
- `buildCanonicalDraftRuntimeState(...)`
- `buildSmartDraftRecommendations(...)`
- `deriveDraftRuntimeIntelligence(...)`
- `deriveDecisionOsSignalsFromRuntimeEvents(...)`

The contract is deterministic, evidence-first, and does not fabricate live data, stats, projections, or confidence.

## Remaining Gaps

- Existing draft routes are not yet fully refactored to call `validateCanonicalDraftPick` before every mutation.
- Full authenticated browser proof from draft start to final roster assignment remains a later readiness gate.
- Full repository typecheck is still blocked by known unrelated repo-wide issues/OOM behavior from earlier milestones.
- Some existing draft UI copy/tests still use older internal feature names; G34 only avoids adding new customer-facing assistant-led product language.

## Verification

- Passed: `cmd /c npx vitest run __tests__/g34-draft-runtime.test.ts --reporter=verbose`
- Passed: `cmd /c npx vitest run __tests__/g33-canonical-league-runtime.test.ts __tests__/g34-draft-runtime.test.ts --reporter=verbose`
- Passed: `cmd /c npx vitest run __tests__/live-draft-engine/draft-core-behavior.test.ts --reporter=verbose`
- Passed: `cmd /c npx vitest run __tests__/league/draft-to-roster-sync.test.ts --reporter=verbose`
- Passed: `cmd /c npx vitest run __tests__/draft/draftSliceALifecycle.test.ts __tests__/draft/draftSliceBTimer.test.ts __tests__/draft/draftSliceCPlayerPick.test.ts --reporter=verbose`
- Passed: `cmd /c npx playwright test e2e/draft-room-click-audit.spec.ts --project=chromium --grep "draft room harness loads shell|draft intel queue panel renders and top-choice CTA is wired|post-draft summary, replay, AI recap, and share actions are wired|mobile navigation between board and player/queue/chat works" --reporter=line`
- Passed: `cmd /c npx playwright test e2e/draft-api-actions.spec.ts --project=chromium --reporter=line`
- Limited: targeted `tsc` through a temporary G34-only config still walked imported canonical/live service dependencies and stopped on pre-existing repo-wide strict-type errors in unrelated modules such as `lib/prisma.ts`, survivor/zombie/guillotine guards, player-data serialization, and rankings services. No G34 file-specific type errors appeared before those imported-module failures.

Browser proof notes:

- The draft-room harness covered shell load, Smart Draft/Intel queue CTA, post-draft summary/replay/share surfaces, and mobile board/player/queue/chat navigation.
- The commissioner action harness covered pause/resume POST payloads from `CommissionerDraftControls`.
- Playwright completed successfully, but the Next dev server still emitted known post-run `ECONNRESET` / `Error: aborted` noise after tests passed.
