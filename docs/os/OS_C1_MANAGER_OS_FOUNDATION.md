# Phase OS-C1 — Manager Operating System Foundation

The first pivot away from Commissioner OS: bringing the same "operating system" experience to the
person PLAYING in a league, not just the person running it, while reusing Decision OS's existing
Attention Signal / Daily Brief / Notification Engine / Delivery Layer primitives as-is. No new backend
intelligence, no new database tables, no new trade/waiver/lineup algorithms — a composition and
presentation phase, same constraint class as every OS-B phase.

## 1. Scope decision: Deliverables list, not the full Sections list

The kickoff prompt named 7 UI sections (Today's Brief, Attention Queue, Lineup Priorities, Trade
Opportunities, Waiver Priorities, League Switcher, Notification Center) but its own "Deliverables"
list only committed to 5 (landing page, Today's Brief, Attention Queue, Notification Center, League
Switcher) — Lineup/Trade/Waiver Priorities were absent from Deliverables. This phase built to the
Deliverables list only. Investigation found THREE candidate pre-existing systems that could plausibly
back those three sections — `ManagerIntelligenceHub`'s modules (team health/weekly outlook/transaction
readiness, already live at `/league/[leagueId]/manager-hub`), `UserOsSnapshot`'s own
`recommendations`/`activitySummary` fields (`userOs.ts`), and separate trade/waiver/lineup "card
adapters" (`lib/decision-os/{trade,waiver,lineup}/`, currently wired only into unrelated feature API
routes as shadow/parity objects) — and picking the wrong one to reuse would be a real architecture
mistake, not a cosmetic one. Recommended as OS-C2, after a dedicated audit of which one is the right
fit (see §7).

## 2. New Decision OS composition

`lib/decision-os/managerCommandCenter.ts` — `resolveManagerCommandCenterSnapshot(userId, leagueIds,
now)`. Sibling, not wrapper, matching `commissionerCommandCenter.ts`'s own precedent: calls the
already-real, single-league `resolveUserOsSnapshot` (`userOs.ts`) directly per league. Zero new
derivation of manager team-health/recommendation data — every field is either a direct pass-through of
`UserOsSnapshot`'s own already-real output, or a signal produced by the new `deriveManagerAttentionSignals`
(below), which itself only relabels `UserOsSnapshot` fields, never recomputes them. Unlike
`commissionerCommandCenter.ts`, this composition does NOT filter to commissioned leagues — every
league a user belongs to (commissioner, member, or imported) is in scope.

## 3. Attention Signal model extended, not forked

`attentionSignals.ts` gained two new signal types (`manager_engagement_risk`, `manager_recommendation`)
and one new source (`user_os`) — additive to the existing closed unions, not a parallel model. The new
`deriveManagerAttentionSignals(input)` function:

- **`manager_engagement_risk`**: fires only for `medium`/`high`/`critical` retention risk (never for
  `low`, matching `lowLeagueHealthSignal`'s own "healthy states don't queue" precedent), reusing
  `UserOsSnapshot.teamHealth.retentionRisk`'s own already-computed bucket verbatim as the signal
  severity — no new threshold invented.
- **`manager_recommendation`**: one signal per real, already-scored Phase 6.4 manager-tier
  `Recommendation`, reusing each recommendation's own `priority` field verbatim as severity (every
  `RecommendationPriority` value is a valid `AttentionSignalSeverity`), its own `expectedImpact` as the
  explanation, and its own first `recommendedActions[0].action` as the recommended action — never a
  re-derived or paraphrased claim.

## 4. New route and UI

`GET /api/decision-os/manager-command-center` — session-scoped, mirrors
`/api/decision-os/commissioner-command-center`'s exact pattern (`getDashboardLeagueListForUser`, real
`draftsApproachingCount` from the same `LeagueSettings.draftDateUtc` column), but with no
`isCommissioner` filter.

New page: `/manager-hub` (`app/manager-hub/page.tsx` + `ManagerHubPageClient.tsx`) — a NEW, standalone
route, not an addition to the existing `/dashboard` page. `/dashboard`'s own `DashboardShell` is a
large, already-live surface this phase did not audit; Commissioner OS itself got its own dedicated
route (`/commissioner-hub`) rather than being folded into an existing page, and this phase followed
that same precedent. Deliberately minimal — no marketing hero, no legacy stat rows, since this is a
brand-new page with zero existing traffic/expectations to preserve.

New components:
- `ManagerCommandCenterOverview.tsx` — 4-stat-chip mirror of `CommissionerCommandCenterOverview.tsx`.
- `ManagerLeagueSwitcher.tsx` — mirrors `CommissionerLeagueSwitcher.tsx`, but navigates via a real
  `<Link href="/league/[id]">` instead of Commissioner Hub's in-page `onSelect` state toggle. That
  pattern exists there because Commissioner Hub keeps League Focus on the SAME page; Manager OS's
  team-focused experience already has its own real, established route (`/league/[leagueId]`), so a
  real navigation is the lower-risk choice — this component touches zero existing single-league code,
  satisfying "selecting a league should transition into the existing team-focused experience without
  regression" by construction (nothing about that existing experience was touched).
- `ManagerCommandCenterSection.tsx` — composes the fetch + `composeDailyBrief`/`composeNotificationFeed`/
  `resolveDeliveryPlan`, same zero-extra-fetch discipline as `CommissionerCommandCenterSection.tsx`.

**Reused completely unchanged**: `TodaysBriefCard`, `NotificationCenter`, and `CommissionerAttentionQueue`
— all three already take fully generic props (`DailyBrief`, `DecisionOsNotification[]`,
`DecisionOsAttentionSignal[]`, keyed by `leagueId`/`leagueNameById`), confirmed via direct inspection
before writing any new code. `CommissionerAttentionQueue`'s own name is a pre-existing naming artifact
(it predates Manager OS) — reusing it on the Manager page is intentional, not an oversight; renaming it
to something neutral is a separate, low-risk future cleanup this phase deliberately did not take on to
avoid touching a component with existing call sites/tests for a purely cosmetic reason.

## 5. Testing

37 new tests across 6 new files: `manager-attention-signals.test.ts` (11, pure-function coverage of
`deriveManagerAttentionSignals`), `manager-command-center.test.ts` (9, aggregation/bucketing/capping),
`manager-command-center-route-contract.test.ts` (5, auth/scoping/draft-count contract), `manager-command-center-section.test.tsx` (5, end-to-end composition + reuse verification), `manager-league-switcher.test.tsx` (3), `manager-command-center-overview.test.tsx` (1).

## 6. Verification

- Targeted new-test run: 31/31 passing on first write (0 iteration needed — a signal the composition
  design correctly followed established precedent throughout).
- Full `__tests__/decision-os/` suite + commissioner-hub wiring test: 141 files / 3010 tests, zero
  failures.
- Typecheck (`npm run typecheck`, the project's own memory-safe invocation): 158/158 baseline
  unchanged, zero new errors — confirmed via a targeted grep for every new/changed file name against
  the full error log.
- **Live browser verification** against a real dev server (not fixtures) — this sandbox's session is
  signed out (no stored credentials), which exercises the same honest empty-state path as OS-B7's own
  verification:
  - `GET /manager-hub` → 200 OK, page title "Manager Hub | AllFantasy".
  - DOM snapshot confirmed: "Manager Hub" badge, real headline/subhead copy, a "Sign In" link (correct
    unauthenticated state), and `ManagerCommandCenterSection`'s honest empty state ("Your multi-league
    overview will appear here… Import or create a league to begin receiving Decision OS insights…") —
    zero fabricated content, matching OS-B7's own truthfulness standard from the very first line of
    new code.
  - Console: only the same pre-existing, documented Facebook-SDK-over-HTTP sandbox noise carried since
    Phase E/OS-B6 — zero new console errors.
  - **Not verified live**: the authenticated, populated-leagues path (real Today's Brief/Attention
    Queue/Notification Center/League Switcher content). Same honest, documented limitation as OS-B7 —
    no stored credentials in this sandbox session. Covered instead by
    `manager-command-center-section.test.tsx`'s real-fixture render tests.

## 7. Explicitly deferred: OS-C2 candidate

Before building Lineup Priorities / Trade Opportunities / Waiver Priorities, audit which of the three
candidate systems named in §1 is the intended reuse target — recommend starting from
`UserOsSnapshot.activitySummary`/`recommendations` (already flowing through this phase's own
composition) if the goal is consistency with the Attention Queue/Daily Brief model, or from
`ManagerIntelligenceHub`'s existing modules if the goal is richer, already-built single-league detail.
Building on the trade/waiver/lineup card adapters directly would require first confirming they're
safe/intended for direct manager-facing rendering (today they're wired only into unrelated internal
feature routes as shadow/parity objects, not customer-facing cards).
