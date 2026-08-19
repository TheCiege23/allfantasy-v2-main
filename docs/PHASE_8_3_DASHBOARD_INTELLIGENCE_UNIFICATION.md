# Phase 8.3 — Dashboard Intelligence Unification

Status: **SCOPED SLICE COMPLETE — 2026-07-01**. Wires the real, live
`/dashboard` route (`DashboardOverview.tsx`) to the same Phase 8.1
composition pipeline already proven on League Home and Commissioner Hub.
Chimmy's own intelligence system is untouched and unreplaced. Architecture
Freeze and Stage 1 Soak untouched. Builds on `docs/PHASE_8_1_PIPELINE_UNIFICATION.md`
and `docs/PHASE_8_2_COMMISSIONER_HUB_INTELLIGENCE_WIRING.md`; does not
revisit either.

## Step 1 — Wiring map (produced before any code was written)

```
app/dashboard/page.tsx (server: session, userId, initial league list)
  → DashboardShell.tsx (client chrome: AppShell, left/right panels)
    → DashboardOverview.tsx (client, THE real production dashboard content)
        │
        ├─ DashboardIntelligenceRail — Chimmy-specific.
        │    Gated by NEXT_PUBLIC_CHIMMY_INTELLIGENCE_RAIL, which is NOT
        │    set anywhere in this repo's env config (.env*, vercel.json) —
        │    confirmed by a repo-wide search; the flag check fails closed
        │    and the component returns null. Even if the flag were set,
        │    its fetch target (`/api/ai/intelligence`) does not exist
        │    anywhere in this codebase (verified: only `/api/intelligence/
        │    global` and `/api/intelligence/snapshot` exist, neither
        │    matching) — the fetch would 404 and the rail would render its
        │    own "temporarily unavailable" state. **This system is dormant
        │    in the current shipped configuration.** It draws on
        │    `lib/chimmy-context/intel/*` (coachingAdaptation,
        │    competitiveContext, opponentStrength, projection,
        │    recommendationPriority, rosterWeakness, strategicRisk,
        │    urgency) — an LLM-prompt-context assembly system, genuinely
        │    different in purpose from Decision OS's deterministic
        │    Manager DNA / Recommendations. Left completely untouched.
        │
        ├─ Today Strip, Power Rankings / Injury / War Room / Matchup Prep
        │    mini-cards, Rankings Card, Legacy Snapshot — real, working,
        │    already-shipped operational widgets (counts, rankings, direct
        │    data displays). Not evidence/confidence-shaped, not Decision
        │    OS, not duplicative of anything this ticket adds. Untouched.
        │
        ├─ useDashboardToolLeague(leagues) — an EXISTING hook, already
        │    used by this exact page to scope the mini-cards and AI Tools
        │    Grid to one selected league ("Single selected league for
        │    dashboard 'League Intelligence' + Global AI Tools grid" per
        │    its own doc comment). REUSED as the anchor for Manager DNA /
        │    Recommendations — not a new heuristic, the page's own
        │    established selector.
        │
        └─ leagues: UserLeague[] — structurally compatible with
             LeaguePulseLeagueInput[] (same optional fields:
             id/name/sport/format/platform/teamCount/status/
             lifecycleState/currentWeek/draftDate/importedAt/
             isCommissioner). Passed directly to buildDashboardLeaguePulse,
             already exported and already used elsewhere (DashboardContent.tsx,
             the e2e-harness-only component) — just never wired into the
             real DashboardOverview.tsx until this ticket.
```

**Conclusion**: nothing on the real Dashboard currently duplicates
Decision OS output, because nothing intelligence-shaped is rendering
there today. The safe integration point is additive: render the same
three-card trio (`LeaguePulseCard`, `ManagerDnaCard`,
`DecisionRecommendationsCard`) already proven on League Home and
Commissioner Hub, inside the page's existing "League Intelligence"
section (`t('dashboard.overview.leagueIntelligenceTitle')`), which already
exists specifically for per-league intelligence widgets.

## Step 2/3 — Reused the Phase 8.1 composition unchanged, wired real payloads

Zero changes to `lib/decision-os/dashboard-intelligence.ts` or
`app/api/decision-os/manager-intelligence/route.ts` — both reused exactly
as Phase 8.1 built them. `DashboardOverview.tsx` gained the identical
fetch pattern used on League Home and Commissioner Hub, anchored on
`selectedLeagueId` (the page's own existing selector) instead of a new
one:

```tsx
useEffect(() => {
  if (!selectedLeagueId) { setManagerIntelligence(null); return }
  // fetch /api/decision-os/manager-intelligence?leagueId=... (identical to Phase 8.1/8.2)
}, [selectedLeagueId])
```

`buildDashboardLeaguePulse` (previously called only by the e2e-harness-only
`DashboardContent.tsx`) is now called for real inside `DashboardOverview.tsx`
with the page's actual `leagues` array — its own internal logic is
completely unchanged, it was simply never wired into the real page before.

## Step 4 — League Pulse gained the same optional evidence parameter

For full consistency with League Home and Commissioner Hub,
`buildDashboardLeaguePulse` gained the same additive pattern:

```ts
managerDna?: ManagerDnaProfile | null
```

One important implementation detail specific to this function (not present
in the other two): `buildDashboardLeaguePulse`'s `confidence` score is
computed from `evidence.length` (`clamp(56 + evidence.length * 7 + ...)`).
Appending the new Manager DNA row naively would have silently changed the
confidence score whenever real data was present — a violation of "nothing
else recomputed." Fixed by computing `confidence` from the base 4-item
evidence array **before** the optional row is pushed, so the score is
identical whether or not `managerDna` is supplied. Verified directly by a
new test asserting `withDna.confidence === withoutDna.confidence`.

No UI redesign — `LeaguePulseCard`, `ManagerDnaCard`, and
`DecisionRecommendationsCard` render exactly as they already do; only the
data source changed.

## Preserving UX (Step 4's second half)

No Decision OS internals, behavioral event names, or provider mechanics
are exposed — the cards render the same polished evidence/confidence/
next-action language already proven on the other two surfaces. Customers
simply see the three cards appear where they didn't before; no existing
widget was removed, resized, or reordered — the new cards were inserted
inside the pre-existing "League Intelligence" section, after the existing
mini-cards grid.

## Step 5 — Validation

- **New test**: `__tests__/league-pulse-decision-os.test.tsx` — one new
  case mirroring the Phase 8.1/8.2 pattern for `buildDashboardLeaguePulse`
  (real evidence surfaced, omitted-parameter output unchanged, `'unknown'`
  identity never surfaced, and the confidence-computation-order fix
  specifically verified). **7/7 in that file.**
- **Full `__tests__/decision-os` + League Pulse**: **2344/2344 green**
  across 71 files (2343 at the end of Phase 8.2 + this 1 new test).
- **Existing Dashboard tests** (`dashboard-shell-layout.test.tsx` and
  related): unaffected, still green.
- **Typecheck**: `npm run typecheck` (the project's correct 8GB-heap
  script — a bare `tsc --noEmit` reliably OOMs on this repo, documented in
  Phase 8.2) — the same 60 pre-existing errors in
  `server/api-route-modules/*`/`server/services/*` persist (confirmed
  unrelated to this ticket by direct grep: zero matches for
  `league-pulse`, `DashboardOverview`, `dashboard-intelligence`, or
  `manager-intelligence` anywhere in the error output). **Zero new
  errors from this ticket.**
- **Playwright**: `e2e/unified-dashboard-click-audit.spec.ts` — **2 passed
  (3.9m)**. Important scoping note: this spec's dashboard test exercises
  `DashboardContent.tsx` via the `/e2e/dashboard-soccer-grouping` harness
  route, not `DashboardOverview.tsx` directly — `DashboardContent.tsx` was
  already correctly wired before this ticket (G24-era work) and remains
  unmodified here. No authenticated e2e spec exists for the real
  `/dashboard` route in this sandbox (no live DB/session available,
  consistent with the same limitation already documented for League
  Home's real route in Phase 8.1).
- **Direct compile verification of the real component** (in place of an
  authenticated browser test): started the dev server, navigated to
  `/dashboard`. Server log: `✓ Compiled /dashboard in 33s (2416 modules)`
  — zero errors, zero warnings beyond the known unrelated Meta CAPI
  placeholder noise. This is the actual Next.js bundler resolving every
  new import (`LeaguePulseCard`, `ManagerDnaCard`,
  `DecisionRecommendationsCard`, `buildDashboardLeaguePulse`,
  `buildManagerDnaViewModel`, `buildDecisionRecommendationsViewModel`,
  `ManagerIntelligencePayload`) through the entire real
  `DashboardPage → DashboardShell → DashboardOverview` tree. The
  unauthenticated visit correctly redirected to the marketing landing page
  (auth guard working as expected) — full authenticated visual
  confirmation was not possible in this sandbox, honestly noted rather
  than claimed.

## Files changed

- `app/dashboard/components/DashboardOverview.tsx` — added the three-card
  render + the fetch wiring, inside the existing "League Intelligence"
  section. No other logic touched.
- `lib/decision-os/league-pulse.ts` — `buildDashboardLeaguePulse` gained
  the same optional `managerDna` parameter the other two builders have,
  plus the confidence-computation-order fix specific to this function.
- `__tests__/league-pulse-decision-os.test.tsx` — one new test.

No changes to `lib/decision-os/dashboard-intelligence.ts` or
`app/api/decision-os/manager-intelligence/route.ts` — both reused as-is,
confirming "no duplicate derivation" was met structurally across all
three surfaces (League Home, Commissioner Hub, Dashboard) now sharing one
composer.

## Remaining Chimmy-specific responsibilities (untouched, by design)

`lib/chimmy-context/*` in its entirety — event/context providers
(League/Matchup/Roster/Standings/Ranking/Subscription/User/ImportHistory/
LeagueDifficulty/SportsSchedule), the `intel/*` derivation layer, intent
classification, prompt composition, and telemetry. This is architecturally
a prompt-context-assembly system for an LLM, not a deterministic
evidence/confidence system — correctly out of scope per this ticket's own
explicit "do not replace Chimmy" rule, and genuinely serves a different
purpose than Decision OS. `DashboardIntelligenceRail`'s dormant state
(missing backend route) is documented here as a factual finding, not
something this ticket fixes.

## Remaining disconnected intelligence (carried over, unchanged)

Everything Phase 8.1/8.2 already documented as deferred remains deferred:
Platform Intelligence, League Archetypes, Platform Benchmarking, Company
Intelligence (still zero real callers outside tests), the Phase 6.5
`leagueBenchmark` input, and `DashboardContent.tsx` itself (still e2e-
harness-only — though its own dead wire was never touched by any Phase
8.x ticket, since it has no real page to serve).

## Readiness impact

**Unchanged.** NFL Engine 93%, Overall Platform 90%. This is composition/
wiring on already-real, already-tested Decision OS layers. Full-fidelity
customer-facing proof would require an authenticated browser session this
sandbox cannot provide — the honest evidence available (clean real
compilation of the actual component tree, full unit regression, and
Playwright proof of the equivalent already-shipped surface) supports the
wiring being correct, but does not by itself justify a readiness move per
the standing readiness-credit rule (browser/staging proof against a real
authenticated session is the bar for that).
