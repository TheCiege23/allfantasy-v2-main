# Decision OS Activation Investigation

**Status:** discovery only, no code changes made · **Prepared:** 2026-07-17 · **Branch:**
`claude/decision-os-activation-investigation`

Follow-up to [[blueprint-audit-phase-0-decision-os]] (`docs/BLUEPRINT_AUDIT_PHASE_0_DECISION_OS.md`).
No kill switches flipped, no flags changed — discovery only, as instructed.

## Correction to Phase 0 first

Tracing the actual render path (item 5 below) found that `app/dashboard/DashboardContent.tsx` — the
file Phase 0 cited as evidence of dashboard integration — **is orphaned. It is referenced nowhere in
the entire repo except its own declaration.** `app/dashboard/page.tsx` renders `DashboardShell` →
`DashboardOverview.tsx` (the file this session has actually been editing all along), which has **zero**
decision-os imports. Phase 0's claim that "the main dashboard's `DashboardContent.tsx` imports
LeaguePulseCard/ManagerDnaCard/DecisionRecommendationsCard" was accurate about the file's contents but
wrong to cite as evidence of live wiring — that component never renders for a real user. Full detail in
§5. The `/commissioner-hub` and `/manager-hub` findings from Phase 0 hold up.

---

## 1. Why were the 4 kill switches never flipped?

**Real answer, not a guess: everything found points to "never operationally revisited," not a known
blocker.** Evidence:

- `lib/decision-os/ADR_PHASE4_5_STAGE1_ACTIVATION_READINESS.md` and
  `ADR_PHASE4_CUTOVER_READINESS.md` (both 2026-06-30) are fully operational-ready documents — exact
  env var names, per-slice monitoring checklists, an explicit activation order (Commissioner → Trade →
  Waiver → Lineup) with stated reasoning, rollback instructions ("no deploy required"). This isn't a
  half-finished plan; it reads like a runbook someone would follow, not a proposal waiting on a design
  decision.
- `PRODUCTION_READINESS_CHECKLIST.md`'s Phase 5 soak table has **blank start/pass dates for all 4
  slices** and was **never updated again after 2026-06-30** — confirmed via `git log` — despite decision-os
  work continuing well past that date (Phase 6 on 2026-07-01, Phase 7.5 and F5.9/F5.2/F5.3 into what a
  broader commit search shows reaching **F7.20** by the most recent `lib/decision-os/` commits). Whoever
  kept building did not go back and update the soak tracker, which is consistent with attention moving to
  building more capability rather than operationalizing what already shipped.
- No commit, PR description, or code comment anywhere in `lib/decision-os/` after 2026-06-30 discusses a
  blocker, a pending product call, or a decision to hold off. The absence is notable given how thoroughly
  everything else in this codebase is documented (every phase has an ADR).

**Important caveat, not a hedge — a real precedent that changes how much to trust "never flipped =
safe to flip":** `docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md` documents a directly analogous
"why was this never activated" investigation for a related system
(`runWeeklyRecalibration()`, part of the same broader Trade Learning/Decision OS ecosystem). That
investigation found the same *shape* of answer — "migration gap, not an intentional decision" — but
then, while building the minimal activation wiring, **surfaced a real, verified correctness bug**
(`computeObservedAcceptRate()` compared against lowercase strings while the real Prisma enum is
uppercase — every real outcome row silently read as 0% acceptance) that would have made activation
actively harmful. The lesson isn't "expect the same bug here" — it's that "never revisited" and "safe"
are independent facts, and the first doesn't imply the second. §2 below is the actual correctness check
for these 4 slices, not an assumption.

## 2. What flipping each switch changes, and the risk

All 4 slices follow the **identical, purely additive pattern** — confirmed by reading the ADR and the
actual current route/shadow code, not just the doc:

| Slice | Adds to response | Legacy fields | Failure mode |
|---|---|---|---|
| Commissioner | `decisionOsShadow` on health snapshots | Unchanged | try/catch, isolated per-snapshot |
| Trade | `decisionOs` on proposal-creation response | Unchanged | try/catch, absent on failure, proposal creation unaffected |
| Waiver | `decisionOs` on waiver engine response | Unchanged, token refund logic untouched | try/catch, absent on failure |
| Lineup | `decisionOs` on today lineup-actions response | Unchanged | try/catch, UI renders correctly when `decisionOs` is null |

None of the 4 **replace** anything — Stage 1 (what these switches control) only appends an optional
field. Full replacement is Stage 2 ("UI reads Decision OS first, legacy as fallback"), which per the
Cutover Readiness ADR requires **its own separate ADR** and has not been designed yet, let alone built.
Rollback for all 4 is a Vercel env var change, no deploy.

**Known, named gap** (from the decision registry's own notes, not discovered here): `manager.trade.evaluate`
is two-team only in the legacy evaluator; the DCO models `participants[]` for 3+-team trades but they
degrade to `unsupported_by_legacy_evaluator` — "honest four answers, no fabricated grade." This is
handled safely (explicit degradation, not silent wrong output), not a blocker, but real users running
3+-team trades would see a decision object admitting it can't grade the trade rather than a real grade.

**Pre-activation gates that need confirming, not assumed clean:** Trade's ADR explicitly requires
confirming `AdpDataRecord` rows are fresh (within 7 days) and `FantasyProjection` has current-week rows
*in production* before flipping — this session's [[live-data-cron-audit]] memory says the projections
cron gap was closed, but that memory is 13 days old and doesn't specifically confirm ADP freshness at
this moment. This is a live-data check, not something resolvable from code alone.

**On the 679 tests:** genuinely comprehensive for what they test — conformance scripts proved
origin-blindness and shadow parity zero-diff on both native and imported real leagues in staging
(`ep-winter-salad`), and the multi-team trade limitation is explicitly modeled and tested for, not
missed. What they do NOT and cannot cover: production-scale telemetry gates (parity_failed thresholds,
p99 latency) and live ADP/projection freshness — those are the actual remaining unknowns before
activation, not code correctness.

## 3. Cross-reference against the dashboard audit's open questions

The Canonical World fact contract (`lib/decision-os/world/facts.ts`) already captures nearly everything
the dashboard league-data-binding audit is asking about, read directly from the type definitions:

| Dashboard audit question | Decision OS coverage | Where |
|---|---|---|
| Roster | `RawRosterRow.playerData`, `faabRemaining`, `waiverPriority`, provenance-tagged source (`Roster` vs `RedraftRoster`) | `world/facts.ts` |
| League managers | `RawTeamRow.ownerName`, `teamName`, `isCommissioner`, `isCoCommissioner`, `claimedByUserId`, `isOrphan` | `world/facts.ts` |
| Scoring settings | `RawLeagueRow.scoring`, `scoringPresetId`, `rosterSize`, `starters`, `irSlots`, `taxiSlots`, `waiverType/Budget/MinBid/Hours`, `tradeReviewHours`, `tradeDeadlineWeek` | `world/facts.ts` |
| Draft results | Not in the base fact contract, but a full separate draft-intelligence layer exists (`draft-runtime-intelligence.ts` — `draft_readiness`/`draft_health`/`draft_pace`/`best_available`/`position_run`/`draft_value` categories) consuming `CanonicalDraftRuntimeState` from `lib/draft-runtime/` | `draft-runtime-intelligence.ts` |
| Season state | Partial — `lastSyncedAt`, `syncStatus`, per-week `RawPerformanceRow` exist; no single explicit "season phase" field in the base contract | `world/facts.ts` |
| Injury impact | Separate enrichment layer, not the base contract | `world/injuryEnrichedWorld.ts` (F2.3) |
| League selector actually driving data | N/A — the real dashboard doesn't call decision-os at all (§5) | — |

**What this means concretely:** for roster, managers, and scoring specifically, the dashboard audit's
"exists-and-just-not-wired-in vs. genuinely-not-built-yet" question has a clear answer for those three —
**exists, and not wired to the dashboard.** Draft results and injury impact exist too, just in separate
modules the dashboard would need to call in addition to (not instead of) the base world resolver. Season
state is the one area that's genuinely partial even within decision-os itself.

**The one thing this does NOT resolve:** none of this is reachable through `DashboardOverview.tsx`
today (§5). Wiring it in is real work — resolving a league's Canonical World, mapping it to whatever
shape the dashboard cards expect, handling the loading/error states — not zero-effort, but it is
**assembly of already-computed, already-tested facts**, not new intelligence that needs to be designed
and built. This changes the dashboard audit's likely shape: for at least roster/managers/scoring, expect
"exists-but-not-wired" findings rather than "needs building."

## 4. Phase 6 — smaller gap than its own docs claim

Phase 0 reported Phase 6's completion checkpoint as self-documenting zero API exposure. That's true **as
of the checkpoint doc's own date (2026-07-01)** — but this investigation found later work closes it, at
least partially:

**`app/api/decision-os/manager-intelligence/route.ts`** (comment: *"Decision OS — Phase 8.1 real Manager
DNA + Recommendations"*) is a real, authenticated (`getServerSession`), authorized (`authorizeLeagueRead`
gate), production route. Traced its full call chain directly:

```
GET /api/decision-os/manager-intelligence?leagueId=...
  → resolveManagerIntelligencePayload() (lib/decision-os/dashboard-intelligence.ts)
    → loadLeagueEvents() — real Prisma reads: waiver claims, league trades, roster moves,
      draft rows, redraft trades/rosters, imported (Sleeper) activity
    → assembleManagerBehavioralFacts() (Phase 5 behavioral layer)
    → assembleManagerDna() (Phase 6.2 — genuinely called, not stubbed)
    → assembleManagerRecommendations() (Phase 6.4 — genuinely called, not stubbed)
```

This closes exactly the two gaps Phase 6's own doc named as blocking (6a data pipeline, 6b API route) —
for Manager DNA and the Recommendation Engine specifically. It does **not** close them for Phase 6.1
(behavioral patterns as a standalone output), 6.3 (league archetype), 6.5 (benchmarking), or 6.6 (company
intelligence) — no route was found exposing those directly, though `assembleManagerDna`'s pipeline likely
computes 6.1 patterns internally as an input (not independently confirmed).

**7 more routes exist under `app/api/decision-os/`** (`commissioner-command-center`,
`league-analytics`, `league-context`, `manager-command-center`, `mission-control`, `platform-os`,
`user-os`) — not individually traced in this pass; each is a candidate for the same "already closed, just
not where you'd look" pattern. Worth a dedicated sweep before assuming any of them need building.

**So the smallest real gap for "one live data source + one API route,"** per the user's framing, turns
out to already exist for the two most product-relevant Phase 6 outputs. The actual remaining gap is
narrower than Phase 6's own docs suggest: **surfacing this on the main dashboard**, not building new
backend connectivity.

## 5. UI-wiring — corrected finding, more nuanced than Phase 0 reported

**`DashboardContent.tsx` is dead code.** Confirmed exhaustively: `grep -rn "DashboardContent"` across
`app/`, `components/`, `lib/` finds exactly one match — its own `export default function
DashboardContent(...)` declaration. `app/dashboard/page.tsx` renders `DashboardShell`, which renders
`DashboardOverview` (`app/dashboard/components/DashboardOverview.tsx` — the actual file this session has
edited three times already). `DashboardOverview.tsx` has **zero** references to `decision-os` in any
form — no imports, no `/api/decision-os/*` fetches. Its "today actions"/priority surface
(`/api/dashboard/today-actions` → `lib/today-actions-engine/`) is a **completely separate, independently
built system** that doesn't touch Decision OS at all — confirmed by reading `runTodayActions.ts`'s full
import list (`computeLineupActionsForUser`, `fetchWaiverDashboard`, `fetchTradesDashboard`,
`runWarRoomCommandCenter`, none from `lib/decision-os/`). This is the exact "each feature invents its
own ad hoc todo representation independently" pattern the original blueprint's Phase 0 question asked
about — confirmed true for the one surface a real user actually sees today.

**`/commissioner-hub` and `/league/[leagueId]` are genuinely live and do reach real data — but require
a user action first, not automatic on page load.** Traced `CommissionerHubPageClient.tsx`: `[managerIntelligence, setManagerIntelligence] = useState(null)`, populated by a `useEffect` that fetches
`/api/decision-os/manager-intelligence?leagueId=...` — but only fires once `selectedLeagueId` is set, and
the only two places that set it are `onSelectLeague={setSelectedLeagueId}` (a user click) and a reset-to-null
handler. **No default/auto-selected league** was found in this file. So on first load of
`/commissioner-hub`, the Manager DNA and Recommendations cards render their null/insufficient-data state;
they populate with real data only after the user picks a specific league from whatever selector renders
this callback. `LeagueTab.tsx` (`/league/[leagueId]`) uses the same builder functions
(`buildLeagueHomePulse`, `buildManagerDnaViewModel`, `buildDecisionRecommendationsViewModel`) — this
pass did not trace whether its `managerIntelligence`-equivalent source populates automatically or also
needs explicit selection; flagging as unresolved rather than assuming either way.

**One more real surface found, not in Phase 0:** `TodaysBriefCard`/Command Center components are
confirmed live at `/commissioner-hub` and `/manager-hub` (Phase 0's finding holds), separate from the
dead `DashboardContent.tsx` path.

**A distinct, adjacent system worth flagging so it isn't confused with Decision OS:** `/fantasy-os` and
its `executive` sub-route use a **completely different module tree**
(`lib/fantasy-os/exec-data/`, `lib/fantasy-os/exec-intelligence/`), not `lib/decision-os/` at all, and
`FantasyOsGateway.tsx` imports a `DemoStateBadge` component — this surface appears to be explicitly
demo-labeled, consistent with this session's [[decision-os-demo-layer]] memory ("PARKED... do not build
more"). Don't fold findings about `/fantasy-os` into Decision OS conclusions; they're separate systems
sharing a naming convention.

---

## What this means for the two decisions still ahead

1. **Rewriting the dashboard audit brief around this discovery, vs. running it as originally scoped:**
   §3 shows real, tested backend coverage for roster/managers/scoring/draft/injury already exists; §5
   shows the actual dashboard component doesn't reach any of it. A rescoped brief could skip straight to
   "how do we wire `DashboardOverview.tsx` to the Canonical World resolver and/or
   `/api/decision-os/manager-intelligence`" rather than re-discovering that the data exists.
2. **Flipping one low-risk switch as a fast, visible win:** Commissioner Health is the ADR's own
   recommended first slice (lowest traffic, read-only, shadow already zero-diff, no cron dependency) —
   but "flip it" only adds a field to an API response; it would not, by itself, make anything new appear
   on `DashboardOverview.tsx` or any other real page, since nothing in the live UI currently reads
   `decisionOsShadow`. The two are separable: activating a Stage-1 slice and wiring a UI surface to
   consume decision-os data are different pieces of work, and neither depends on the other.

## Explicitly not done in this pass

No kill switch flipped, no flag changed. No live verification (browser or production telemetry) of
whether `/commissioner-hub`'s or `/league/[leagueId]`'s data-fetch actually succeeds for a real session —
this is a code-tracing finding (the wiring exists and looks correct) not a runtime-confirmed one. ADP/
projection freshness in production not checked (would need live DB or Vercel log access). The 7
untraced `/api/decision-os/*` routes not individually verified. `LeagueTab.tsx`'s exact data-population
trigger not resolved.
