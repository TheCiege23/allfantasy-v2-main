# Phase 8.1 — Intelligence Pipeline Unification

Status: **SCOPED SLICE COMPLETE — 2026-07-01**. Wires League Pulse and two
real, live customer surfaces to a genuinely real Manager DNA + Manager
Recommendation pipeline, reusing 100% existing Decision OS implementations.
No Decision OS logic rewritten, no new derivation math, no AI added.
Architecture Freeze and Stage 1 Soak untouched. Builds directly on
`docs/PHASE_8_LIVE_INTEGRATION_AUDIT.md` (not repeated here).

## An important correction to the audit's premise, found during Step 1 design

Before writing any code, mapping "exactly how the three systems connect
today" (this ticket's Step 1) surfaced a fact the Phase 8.0 audit had
wrong: **the real, live `/dashboard` route does not render
`DashboardContent.tsx` at all.**

`app/dashboard/page.tsx` → `DashboardShell.tsx` → `DashboardOverview.tsx`
(under `app/dashboard/components/`) is the actual production dashboard.
`DashboardContent.tsx` (the file the G24 work and the Phase 8.0 audit both
examined, and where `LeaguePulseCard`/`ManagerDnaCard`/
`DecisionRecommendationsCard` were originally wired) is imported in
exactly one place in the whole repo: the E2E test harness page
(`app/e2e/dashboard-soccer-grouping/page.tsx`). It is real, working code —
just not the code real users see today.

The REAL production dashboard's intelligence surface is
`DashboardIntelligenceRail` (`app/dashboard/components/`), which is a
**fourth, entirely separate intelligence system** — "Chimmy Intelligence,"
under `lib/chimmy-context/`, fetching `/api/ai/intelligence`. It has
nothing to do with Decision OS Phase 5/6/7 or League Pulse. This ticket
does not touch it — unifying a fourth, architecturally distinct system is
out of scope and would be a redesign, not a wiring fix.

**What this means for scope:** the "Dashboard Dead Wire" named in this
ticket's Step 3 is real code with a real defect, but fixing it in
`DashboardContent.tsx` alone would only benefit the E2E harness, not real
customers. The SAME dead-wire pattern (`buildManagerDnaViewModel({source:
null})`, hardcoded, not even reading an unpopulated prop) was independently
confirmed on the **two routes that ARE real and live**:
`app/league/[leagueId]/tabs/LeagueTab.tsx` (League Home,
`/league/[leagueId]`) and `app/commissioner-hub/CommissionerHubPageClient.tsx`
(`/commissioner-hub`). This ticket fixes the wire where it has real
customer impact — League Home — and documents Commissioner Hub as a
deferred, same-class item (see "Remaining disconnected areas" below).

## Previous architecture

Three separate, unconnected intelligence computations existed for "what is
this manager like / what should they do":

1. **`lib/decision-os/league-pulse.ts`** — hand-rolled arithmetic directly
   over raw league/team/commissioner-snapshot inputs. Zero imports from
   Behavioral Intelligence, Phase 6, or Canonical World.
2. **Phase 5.1/5.2 Behavioral Intelligence** (`lib/decision-os/behavioral/`)
   — real, tested, staging-verified, reachable via a real HTTP API
   (`GET /api/v1/intelligence/manager`), but that API was never called by
   any customer-facing page — it existed only as a standalone endpoint.
3. **Phase 6.1/6.2/6.4 Decision Intelligence** (`lib/decision-os/phase6/`)
   — real, tested, pure functions with **zero callers outside unit
   tests**. `ManagerDnaCard`/`DecisionRecommendationsCard` on League Home
   and Commissioner Hub were wired to render, but always received
   `source: null`, hardcoded.

## New execution flow

```
Real Sleeper-imported (or native) league data
   │
   ▼
Phase 5.1 ports (loadWaiverClaimRows / loadLeagueTradeRows /
loadRosterMoveRows / loadDraftRows) — UNCHANGED, the exact same
functions the live Intelligence API already uses
   │
   ▼
Phase 5.1 mappers -> BehavioralEvent[] — UNCHANGED
   │
   ▼
Phase 5.1 assemblers (assembleManagerBehavioralFacts /
assembleLeagueBehavioralFacts) — UNCHANGED
   │
   ▼
Phase 5.2 deriveManagerBehavioralIntelligence — UNCHANGED
   │
   ├──▶ Phase 6.1 detectBehavioralPatterns — UNCHANGED
   │
   ▼
Phase 6.2 assembleManagerDna — UNCHANGED
   │
   ▼
Phase 6.4 assembleManagerRecommendations — UNCHANGED
   │
   ▼
NEW: lib/decision-os/dashboard-intelligence.ts
     resolveManagerIntelligencePayload({leagueId, managerId})
     (the ONLY new composition logic in this ticket — zero new
      derivation, purely wiring)
   │
   ▼
NEW: GET /api/decision-os/manager-intelligence?leagueId=...
     (session -> managerId, read-only, degraded-safe)
   │
   ├──▶ ManagerDnaCard / DecisionRecommendationsCard on League Home
   │    (LeagueTab.tsx — real dead wire, now fixed)
   │
   └──▶ buildLeagueHomePulse's optional `managerDna` parameter
        (League Pulse SURFACES the real signal as one evidence row;
         does not re-derive it)
```

## Step 1 — Design findings

**Duplicated derivation found**: none, once the real pipeline is composed
correctly — every stage above already existed and was already tested.
The actual problem was never duplicated math; it was that Phase 6 had no
caller and League Pulse had no path to receive Phase 6 output.

**Duplicated confidence/evidence logic**: League Pulse computes its own
confidence (0-100, from evidence-array length + input volume) and Manager
DNA computes its own confidence (0-1, from classifier certainty) — these
are legitimately DIFFERENT confidence concepts for different claims (league
health vs. manager identity), not duplicates of the same thing. Chosen
design: keep them separate, have League Pulse **surface** Manager DNA's
confidence as an evidence value rather than blending it into League
Pulse's own health-score arithmetic — this avoids inventing a combined
confidence formula that doesn't exist anywhere in the frozen Decision OS
contracts.

**Smallest wiring change**: one new composition module (pure orchestration,
zero new derivation), one new thin read-only API route, one small
optional-parameter extension to `buildLeagueHomePulse` (backward
compatible — omitted parameter produces byte-identical output, proven by
a dedicated regression test), and a `useEffect`-based fetch replacing a
hardcoded `null` in `LeagueTab.tsx`. No Decision OS file's existing
exported behavior changed.

## Step 2 — League Pulse as a presentation layer

`buildLeagueHomePulse` gained an **optional** `managerDna?: ManagerDnaProfile
| null` parameter. When present and the profile is real (not `'unknown'`,
confidence > 0), League Pulse appends exactly one evidence row (`{label:
'Manager engagement', value: '<confidence>% confidence', detail:
'Decision Intelligence identity: <label>'}`) and one derivation line
noting the real signal was included. **Nothing else changes** — the
health-score formula, status, headline, and every other evidence/metric
computation are byte-identical whether or not `managerDna` is passed
(verified: `withDna.headline === withoutDna.headline`,
`withDna.status === withoutDna.status` in the new test). This is
"consume, don't re-derive" in the most literal sense — League Pulse never
recomputes anything Phase 5/6 already computed; it only surfaces the
number.

`buildDashboardLeaguePulse` and `buildCommissionerLeaguePulse` were NOT
extended in this ticket — `buildDashboardLeaguePulse`'s only real caller
(`DashboardContent.tsx`) isn't a live route (see the correction above), and
`buildCommissionerLeaguePulse` operates over an aggregate of leagues with
no single natural `managerId`/`leagueId` pair to resolve — extending it
correctly needs a design decision (which league's manager context to
show, or a commissioner-tier recommendation set instead of a manager-tier
one) that belongs to a follow-up ticket, not a "smallest wiring change."

## Step 3 — Dashboard dead wire

Fixed on **League Home** (`LeagueTab.tsx`), the real live route with the
same defect: `buildManagerDnaViewModel({source: null})` /
`buildDecisionRecommendationsViewModel({source: null})` were hardcoded,
never reading any payload at all. Replaced with a `useEffect` fetch to the
new `/api/decision-os/manager-intelligence` route (mirroring the exact
client-fetch pattern `DashboardIntelligenceRail`/`DashboardOverview`
already use elsewhere in this codebase — not a new pattern), keyed on
`league.id`. While loading (and on any failure), `managerIntelligence` is
`null`, so both builders receive `source: null` — **the exact same
insufficient-data render as before**, preserved automatically, not
special-cased.

`DashboardContent.tsx`'s own `initialDashboardPayload` dead wire was
**not** touched in this ticket — there is no real page to wire it FROM
(see the correction above). The new `resolveManagerIntelligencePayload`
function is fully reusable if/when `DashboardContent.tsx` (or
`DashboardOverview.tsx`) becomes the live dashboard surface. Commissioner
Hub's identical dead wire is also deferred (documented below), pending the
manager-context design decision.

## Step 4 — Behavior preservation, verified not just claimed

- Confidence values: unchanged formulas everywhere; the new evidence row
  only DISPLAYS Manager DNA's own already-computed confidence.
- Evidence chains / derivation: League Pulse's existing chain is
  unmodified; one new line is appended only when real data exists.
- Deterministic outputs: `resolveManagerIntelligencePayload` performs zero
  randomness; same inputs -> same outputs (matches Phase 5/6's own
  determinism guarantees, which this module only composes).
- Insufficient-data handling: `buildManagerDnaViewModel`/
  `buildDecisionRecommendationsViewModel`'s existing `source: null`
  fallback path is exercised identically during the fetch's loading
  window and on any failure — not reimplemented.
- Regression proof: 4 pre-existing League Pulse tests pass **unchanged**;
  a new test explicitly asserts `withoutDna` output is unaffected by the
  new parameter's existence.

## Step 5 — Validation against real data

`resolveManagerIntelligencePayload` was validated with real-shaped
fixtures (the same `RawWaiverClaimRow`/`RawLeagueTradeRow`/
`RawRosterMoveRow` shapes `intelligence-api-real-provider.test.ts` already
uses to validate the live Intelligence API against real staging data) —
this module calls the identical port functions, so the same real-data
validation Phase 5.10 already ran against a genuine imported Sleeper
league (`50d5c56d`, "KBI Smoke Black") transitively covers this
composition's data-loading correctness. Confirmed structurally:

- Manager/League Intelligence, League Pulse, Manager DNA, and
  Recommendations now execute through **one real call chain** for League
  Home — verified by the new test asserting the same 4 ports are called
  with the correct `leagueId` and `since` Date, matching the live
  Intelligence API's own call shape exactly.
- Platform Intelligence was **not** touched — it has no per-manager
  concept and wasn't in this ticket's wiring target (Manager DNA +
  Manager Recommendations for one viewer).

## Step 6 — Regression

- New tests: `__tests__/decision-os/dashboard-intelligence-pipeline.test.ts`
  (5 tests: real activity produces a real profile, zero activity produces
  an honest zero-activity profile not a skip, a port throwing degrades to
  honest nulls, another manager's activity never leaks into the target's
  profile, and the exact same 4 ports are called with the same arguments
  the live Intelligence API uses) — all green.
- `__tests__/league-pulse-decision-os.test.tsx`: 1 new test (evidence
  surfaced when real, omitted when absent, unknown identity never
  surfaced, core score/status/headline unchanged either way) — 5/5 green
  (4 pre-existing + 1 new).
- Full `__tests__/decision-os` + League Pulse: **2342/2342 green** across
  71 files.
- `__tests__/sdk-runtime` (unrelated to this ticket, confirmed untouched):
  **831/831 green** across 52 files.
- Full project typecheck: same 3 pre-existing, unrelated `LeagueShell.tsx`
  parse errors seen throughout this entire session — unchanged, zero new
  errors from this ticket's changes.
- Playwright: not run for this ticket — the change is API-route + data-
  wiring, not new rendered UI structure (the cards already rendered;
  only their data source changed). The existing dashboard/league-home
  Playwright specs (already fixed and passing per the prior infrastructure
  investigation) don't assert on Manager DNA card CONTENT, only its
  presence, so they remain valid without modification.

## Remaining disconnected areas (honest, not fixed here)

1. **`DashboardContent.tsx` / `DashboardOverview.tsx`** — the real dead
   wire's origin story is moot until one of these becomes the actual
   rendered `/dashboard` page. `resolveManagerIntelligencePayload` is
   ready to be wired in whenever that happens.
2. **The real production dashboard's actual intelligence rail**
   (`DashboardIntelligenceRail` / `lib/chimmy-context/`) remains a fourth,
   fully separate system, untouched. Whether it should eventually consume
   the same Decision OS pipeline this ticket unified, or whether it's a
   deliberately different product surface, is a real product decision —
   not something to silently decide inside a wiring ticket.
3. **Commissioner Hub's Manager DNA/Recommendations dead wire** — same
   defect, same fix pattern is directly reusable, but needs a design
   decision about which league's manager context a commissioner-aggregate
   page should show (or a switch to commissioner-tier recommendations
   instead of manager-tier).
4. **`buildDashboardLeaguePulse`/`buildCommissionerLeaguePulse`** were not
   extended to accept real intelligence — same reasoning as item 3.
5. **Platform Intelligence, League Archetypes, Platform Benchmarking,
   Company Intelligence** — still have zero real callers outside unit
   tests. Out of this ticket's scope (Manager DNA + Manager
   Recommendations only).
6. **`leagueBenchmark` (Phase 6.5) input to Manager DNA/Recommendations**
   — intentionally omitted; requires platform-wide cross-league data, a
   heavier composition than this ticket's scope.

## Technical debt retired

- The literal hardcoded `source: null` on League Home is gone — replaced
  with a real, live, tested data path.
- Phase 6 (Manager DNA + Manager Recommendations) now has its first real
  caller outside a test file, closing the single largest "built but never
  executed against reality" gap the Phase 8.0 audit identified.
- League Pulse now has a proven, tested, backward-compatible extension
  point for consuming Decision Intelligence output — the pattern
  (optional parameter, additive evidence row, zero change to existing
  score arithmetic) is directly reusable for the deferred items above.

## Intentionally deferred work

Everything in "Remaining disconnected areas" above, plus: no attempt was
made in this ticket to unify or even audit `lib/chimmy-context/` against
Decision OS — that is a different system with a different name for a
reason, and merging it was never implied by "unify the three [Decision OS]
systems the audit identified."
