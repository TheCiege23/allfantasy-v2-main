# Phase 8.2 — Commissioner Hub Intelligence Wiring

Status: **SCOPED SLICE COMPLETE — 2026-07-01**. Fixes the confirmed live
Commissioner Hub dead wire, reusing the Phase 8.1 pipeline exactly as
designed — no new intelligence logic, no second composer, no UI redesign.
Architecture Freeze and Stage 1 Soak untouched. Builds directly on
`docs/PHASE_8_1_PIPELINE_UNIFICATION.md` (not repeated here) and does not
revisit the commit `5af53c2e7` hygiene audit (kept as-is, per the prior
decision).

## Step 1 — Audit findings (verified fresh, not assumed from League Home)

`app/commissioner-hub/CommissionerHubPageClient.tsx` (the real, live
`/commissioner-hub` route — confirmed via `app/commissioner-hub/page.tsx`)
had the **same dead-wire pattern** as League Home did before Phase 8.1,
independently re-verified line-by-line rather than assumed:

```tsx
const managerDna = useMemo(() => buildManagerDnaViewModel({ source: null }), [])
const recommendations = useMemo(() => buildDecisionRecommendationsViewModel({ source: null }), [])
```

Hardcoded `null`, never reading any prop or fetch result — identical in
shape to League Home's pre-Phase-8.1 defect. `LeaguePulseCard`,
`ManagerDnaCard`, and `DecisionRecommendationsCard` were all already
imported and rendered (lines 30-32, 908/911-912), so the dead wire is a
pure data-source gap, not a missing UI integration.

**One real difference from League Home, requiring a design decision**:
Commissioner Hub aggregates `commissionerLeagues: UserLeague[]` (every
league the signed-in user commissions), not a single league. There is no
one natural `leagueId` for a manager-tier profile the way League Home's
per-league page has. Resolved by reusing an **already-established
precedent in this exact file**: `buildMissionQueue()` (defined above the
main component) already picks `commLeagues[0]` as the representative
league for its own single-league CTA. This ticket's fix uses the same
`commissionerLeagues[0]?.id` anchor — not a new heuristic, a direct reuse
of an existing in-file convention.

## Step 2 — Reused the Phase 8.1 composer unchanged

No second composer was created. `lib/decision-os/dashboard-intelligence.ts`'s
`resolveManagerIntelligencePayload({leagueId, managerId})` and
`app/api/decision-os/manager-intelligence/route.ts` (both built in Phase
8.1) are used exactly as-is — zero changes to either file in this ticket.
Commissioner Hub calls the identical endpoint League Home calls, just with
`leagueId = commissionerLeagues[0]?.id` instead of a per-page `league.id`.

## Step 3 — Real payload wiring

```tsx
const representativeLeagueId = commissionerLeagues[0]?.id ?? null
const [managerIntelligence, setManagerIntelligence] = useState<ManagerIntelligencePayload | null>(null)
useEffect(() => {
  if (!representativeLeagueId) { setManagerIntelligence(null); return }
  // fetch /api/decision-os/manager-intelligence?leagueId=... (same pattern as LeagueTab.tsx)
}, [representativeLeagueId])
```

When `commissionerLeagues.length === 0` (no managed leagues — the demo/
empty state), the fetch is skipped entirely and `managerIntelligence`
stays `null` — no wasted request, no fabricated data, honest
insufficient-data render exactly as before. While loading and on any
fetch failure, the same `null` fallback path both view-model builders
already handle is exercised — not special-cased for this ticket.

## Step 4 — Commissioner League Pulse variant

`buildCommissionerLeaguePulse` gained the same **optional** parameter
pattern as `buildLeagueHomePulse` did in Phase 8.1:

```ts
managerDna?: ManagerDnaProfile | null
```

When present and real (not `'unknown'`, confidence > 0), it appends one
evidence row — `{label: 'Manager engagement', value: '<confidence>%
confidence', detail: 'Decision Intelligence identity: <label>'}` — and one
derivation line. Nothing else in the function changes: the averaged
health score, engagement score, inactive/missed-lineup/pending counts,
status, headline, and metrics are computed identically whether or not
`managerDna` is passed. Verified directly: `withDna.metrics` equals
`withoutDna.metrics` exactly, and `withDna.headline`/`withDna.status`
equal `withoutDna.headline`/`withoutDna.status` (new test, see Step 5).
No visual redesign — `LeaguePulseCard`'s rendering logic is untouched;
it already renders whatever evidence array it's given.

## Step 5 — Tests

New test added to the existing `__tests__/league-pulse-decision-os.test.tsx`
(no new test file — avoids duplicate coverage of the already-tested Phase
8.1 pipeline composition, which `dashboard-intelligence-pipeline.test.ts`
already covers exhaustively and is reused unchanged here):

- **Real composed intelligence surfaced**: a real `ManagerDnaProfile`
  (`waiver_hawk`, confidence 0.74) produces exactly one new evidence row
  with the correct rounded percentage and identity label.
- **Insufficient-data fallback preserved**: omitting `managerDna` produces
  byte-identical evidence to the pre-Phase-8.2 output (`expect.not
  .arrayContaining` on the new label).
- **No fabrication**: an `'unknown'` identity (confidence 0) is never
  surfaced as evidence, matching the same rule Phase 8.1 established for
  League Home.
- **Deterministic**: `withDna.metrics` equals `withoutDna.metrics`
  exactly — the aggregate health/engagement/pending calculations are
  unaffected by the new optional parameter.
- **Card prop contracts stable**: not re-tested here — `ManagerDnaCard`/
  `DecisionRecommendationsCard`/`LeaguePulseCard`'s prop types
  (`profile`/`model`/`pulse`) were not touched by this ticket at all;
  their existing render tests (already covering `variant="commissioner"`)
  continue to pass unmodified.

Result: 6/6 in `league-pulse-decision-os.test.tsx` (5 pre-existing + 1
new). Full `__tests__/decision-os` + League Pulse: **2343/2343 green**
across 71 files (2342 at the end of Phase 8.1 + this 1 new test).

## Step 6 — Browser proof

Local dev server infrastructure (fixed in the earlier G24-adjacent
investigation) made this directly runnable. Ran the closest existing e2e
coverage — `e2e/unified-dashboard-click-audit.spec.ts`, which already
contains `"audits commissioner Decision OS card framing"` (navigates to
`/commissioner-hub`, asserts all three Decision OS cards are visible with
`variant="commissioner"` testids, and asserts the honest
`"No grounded moves are ready yet."` / `"Commissioner use"` copy):

```
npx playwright test e2e/unified-dashboard-click-audit.spec.ts --project=chromium --reporter=line --workers=1
```

**Result: 2 passed (2.1m)** — both the dashboard test and the commissioner
card-framing test. Because the e2e harness has no authenticated session,
the new `/api/decision-os/manager-intelligence` fetch either 401s or is
skipped, and `managerIntelligence` stays `null` — this real, in-browser
outcome is the **direct proof** that the insufficient-data fallback
renders correctly end-to-end (not just in a unit test), exactly matching
Step 3's requirement.

## Step 7 — Files changed

- `app/commissioner-hub/CommissionerHubPageClient.tsx` — wired the dead
  wire to a real fetch (mirrors `LeagueTab.tsx`'s Phase 8.1 pattern
  exactly); no other logic touched.
- `lib/decision-os/league-pulse.ts` — `buildCommissionerLeaguePulse`
  gained the same optional `managerDna` parameter `buildLeagueHomePulse`
  already has.
- `__tests__/league-pulse-decision-os.test.tsx` — one new test.

No changes to `lib/decision-os/dashboard-intelligence.ts` or
`app/api/decision-os/manager-intelligence/route.ts` — both reused as-is,
confirming Step 2's "do not duplicate the pipeline" requirement was met
structurally, not just by intent.

## Remaining disconnected intelligence systems (unchanged from Phase 8.1)

Everything Phase 8.1 documented as deferred remains deferred — this
ticket did not touch `DashboardContent.tsx`/`DashboardOverview.tsx`, the
separate `lib/chimmy-context/` "Chimmy Intelligence Rail" system, Platform
Intelligence, League Archetypes, Platform Benchmarking, Company
Intelligence, or the Phase 6.5 `leagueBenchmark` input. One new, small
observation: Commissioner Hub's representative-league anchor
(`commissionerLeagues[0]`) means a commissioner managing multiple leagues
only sees their manager-tier intelligence for ONE of them — a real,
honest limitation (not a bug) worth a future ticket if commissioners with
many leagues report it feeling incomplete; not fabricated or hidden, just
scoped.

## An environment finding surfaced during this ticket (documented, not fixed)

`npm run typecheck` (the project's own script, `node
--max-old-space-size=8192 tsc --noEmit`) now reports **60 real,
reproducible errors** in `server/api-route-modules/*` and
`server/services/*` (survivor-pool routes, legacy trade/waiver/playoff
routes, matchup/playoff/standings/weekly-processor engines) — a
completely different error set than the "3 pre-existing LeagueShell.tsx
parse errors" seen consistently in every Phase 7/8 checkpoint before this
one. **None of these 60 errors reference any file this ticket (or Phase
8.1) touched** — confirmed by reading the full, untruncated 60-line
output. This appears to be fallout from the same concurrent background
work already documented in the `5af53c2e7` commit hygiene audit, not a
regression from Phase 8.1/8.2. Also worth noting for future sessions: the
bare `npx tsc --noEmit` invocation (without the project's `typecheck`
script) undersizes the heap and reliably OOMs on this repo's current
size — always use `npm run typecheck`, which sets `--max-old-space-size=8192`.

## Readiness impact

**Unchanged.** NFL Engine 93%, Overall Platform 90%. This ticket is
wiring/composition on top of already-real, already-tested Decision OS
layers, browser-proven for the insufficient-data path — but does not
constitute the kind of new customer-facing capability proof that would
justify a readiness move per the standing readiness-credit rule.
