# Commissioner OS Surface Alignment — Phase B

**Audit + incremental, safe alignments. PR #183 (Decision OS Phase A) stays draft, untouched, not
merged.** No Redraft/Start-Draft/PR-#166 work. No fake demo data. Primary business target:
**Commissioner OS as one product in the broader client-agnostic Fantasy OS Suite** (The
Replacements is the first prospective conversation, not the product's boundary — see the Phase D
note below).

**Date:** 2026-07-08 · **Branch:** `g15-event-foundation`. **Status: Increments 1–8 landed** (7 was
docs-only Phase C kickoff; 8 is "Demo Breadth Increment 4" — a Phase B-style code increment done
under the Phase C umbrella, see §4g).

**Phase D reframing note (2026-07-08):** the work in this document (Commissioner OS: imported
activity, trend, League Health federation, snapshot scheduling, Mission Control, League Analytics)
is now understood as **one OS product within a broader, client-agnostic Fantasy OS Suite**
(Decision OS as the core brain; Commissioner OS, User OS/Manager OS, Platform OS, and a future DFS
OS as presentation layers on top of it). See
[`FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md`](FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md) for the
full reframing, what each OS must answer, and the roadmap to a genuinely client-agnostic, multi-role
(commissioner + manager-only) Sleeper proof path. Nothing already built or documented in this file
changes as a result — this is a positioning update, not a rearchitecture.

**Phase OS-A1 note (2026-07-09):** a new, separate workstream — Fantasy OS Operating-System Alignment
— has begun, updating Commissioner/User/Platform OS so they read and behave like an operating system
(multi-league command center, AI as background infrastructure) rather than a single-league AI
dashboard. Its first increment, League Context Foundation, adds a provider-agnostic model for what
Decision OS believes about a league's financial state (free/paid/verified-paid, confidence),
deliberately separate from this doc's own `LeagueFinance`/payout work (an AF-native Stripe/PayPal
treasury system) — see
[`LEAGUE_CONTEXT_FOUNDATION.md`](LEAGUE_CONTEXT_FOUNDATION.md) and
[`FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md`](FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md) §24.
Nothing in this document's own Mission Control/League Analytics work changes as a result.

**Phase OS-B1 note (2026-07-09):** Commissioner Hub's default view is no longer a single,
automatically-picked league — a new "Multi-League Overview" (distinct from this document's own
Mission Control/League Analytics work AND from `CommissionerShowcasePanel`'s pre-existing "Commissioner
Command Center" widget, a real naming collision found and resolved during this increment) now shows
what needs attention across every league a commissioner runs, before drilling into any one of them via
explicit selection. Mission Control/League Analytics/League Context themselves are completely
unchanged — they now render only after a league is selected ("League Focus"), instead of always
defaulting to the first commissioner league. See
[`COMMISSIONER_COMMAND_CENTER.md`](COMMISSIONER_COMMAND_CENTER.md) for full detail.

**Increment 7 note:** The Replacements Commissioner OS demo package now exists —
[`THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md`](THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md).
Documentation only (no code changes, no tests to run) — a demo walkthrough script, current
built-surface inventory, real-vs-unavailable-vs-future breakdown, the integration inputs The
Replacements would need to provide, an integration architecture sketch, a proposed (not committed)
pilot plan, a licensing-tier sketch, and the concrete engineering gaps before a live pilot. Makes no
ROI/retention-lift claims anywhere.

**Phase C Increment 5 note:** a final, consolidated demo-readiness checklist + runbook now exists —
[`THE_REPLACEMENTS_DEMO_READINESS_CHECKLIST.md`](THE_REPLACEMENTS_DEMO_READINESS_CHECKLIST.md).
Documentation only. Pulls the demo package, adapter plan, technical discovery handoff, and call
script into one pre-call checklist: current demo-ready surfaces, what to show/avoid, a pre-demo
technical + talking-points checklist, honest-unavailable-states reference, a demo script order, and
a Go/No-Go checklist.

**Phase C has begun (Commissioner OS External Licensing, successor to Phase B):** Increment 1 —
[`THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md`](THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md) — the
technical adapter plan (minimum data contract, identity/league/manager/roster/transaction/waiver/
trade/draft mapping, sync/live-update strategy, auth/tenant requirements, a pilot validation
checklist, and concrete questions for the next call with The Replacements). Documentation only — no
adapter code, no `IMPORT_PROVIDERS` change, no code touched at all this increment.

---

## 1. Executive summary

**Finding: Commissioner OS is not one system today — it is at least four separate, non-interoperating
"intelligence" subsystems**, each with its own storage and its own surfaces. Decision OS Phase A
(Increments 1–5: imported activity, behavioral events, snapshots/trends) is **real and tested**, and
each Phase B increment has connected one more real surface to it — but most of the matrix still reads
one of three *other*, older systems.

**Each increment implements exactly one safe, high-leverage alignment** (per the "implement only the
first safe alignment" instruction) and otherwise **stops at the audit** for anything requiring its
own architecture decision — per the "if too many surfaces are misaligned, produce the sequence
instead of guessing" instruction.

- ✅ **Increment 1:** `lib/decision-os/dashboard-intelligence.ts` — the composition that **already
  powers live UI** (Commissioner Hub, Dashboard Overview, `LeagueTab`) — now merges Decision OS Phase
  A's imported/external-league activity into the same behavioral-facts pipeline it already used.
  Improves Manager Activity, Trade/Waiver/Roster/Draft activity, and Recommendations for **every
  manager, including ones with no AllFantasy account.**
- ✅ **Increment 2:** wired Phase A's already-built snapshot/trend module (Increment 5) into the
  same surface — an additive `leagueTrend` field showing real activity-volume direction/delta over
  time, honestly `unavailable` until real history accumulates.
- ✅ **Increment 3:** **League Health federated with Decision OS** (`lib/decision-os/leagueHealthAlignment.ts`)
  — the existing, untouched `monitorLeagueHealth` scoring engine now runs on real trade/waiver/
  manager/trend counts via an explicit opt-in route contract; the legacy explicit-metrics contract
  is fully preserved.
- ✅ **Increment 4:** the already-built snapshot writer (Phase A Increment 5) is now reachable from a
  safe, authorized, on-demand/batch job path — `/api/cron/decision-os-snapshot-capture` — so trend
  history can start accumulating for real. **Not registered in `vercel.json`**, i.e. **not scheduled
  to run automatically yet** — that is a separate, deliberate deployment decision (§4d).
- ✅ **Increment 5:** the **first minimal Mission Control surface** — `lib/decision-os/missionControl.ts`
  + `GET /api/decision-os/mission-control?leagueId=` — composed entirely from Increments 3/2's
  already-federated League Health + trend, with zero new derivation logic (§4e).
- ✅ **Increment 6:** **Mission Control is now visible** — `MissionControlCard` renders inside the
  already-live Commissioner Hub dashboard, reusing the SAME `decisionOsCardClassName` card system
  (§4f). No new visual system, no new page, no rebuild of the hub.
- ✅ **Increment 8 (Demo Breadth):** **League Analytics is now visible** — a second, sibling surface
  to Mission Control: `LeagueAnalyticsCard` renders directly after it on the Commissioner Hub
  dashboard, reusing the SAME card system, composed from the SAME federated League Health data,
  but answering a different question ("what's happening over time" vs. Mission Control's "what
  should I do now") (§4g).
- ⛔ **Still needing their own architecture decision, not a guess:** the Commissioner Intelligence
  Hub's 7 modules (a *third* system), Manager Hub's P2–P4 contracts (a *fourth* system), and a real
  retention-risk *derivation* at the platform level.

---

## 2. The four subsystems (what "Decision OS output" currently means, depending who you ask)

| # | Subsystem | Storage | Consumers |
| --- | --- | --- | --- |
| **A. Decision OS behavioral pipeline** (Phase A's target) | `BehavioralEvent`s derived live from `WaiverClaim`/`AfLeagueTrade`/`AfRosterMoveHistory`/`DraftPick` + **redraft** tables + (as of this increment) `DecisionOsImportedActivity` | `lib/decision-os/behavioral/*` → `assemble.ts`/`manager-intelligence.ts` | `real-data-provider.ts` (flag-gated, **not called by any UI found**) AND `dashboard-intelligence.ts` (✅ **live UI**: Commissioner Hub, Dashboard Overview, `LeagueTab`) |
| **B. Phase 6 Decision Intelligence Layer** | Derived in-memory from subsystem A's output (no independent storage) | `lib/decision-os/phase6/*` (DNA, Recommendations, Archetype, Benchmarking) | `LeaguePulseCard`/`ManagerDnaCard`/`DecisionRecommendationsCard` on the Commissioner Hub dashboard — **via `dashboard-intelligence.ts`, so it inherits this increment's alignment too** |
| **C. G15 DomainEvent / IntelligenceQueryService** | `IntelligenceLeagueSnapshot` (single row per league, latest-state only, no history) + `IntelligenceManagerSnapshot` + `AuditFeedEntry` | `lib/intelligence/IntelligenceQueryService.ts` | **All 7 Commissioner Intelligence Hub modules** (`/league/[id]/intelligence`): Activity, Health, ActionItems, AuditFeed, Stories, **and** Trade Review + Rule Settings (both also read `IntelligenceLeagueSnapshot` under the hood) |
| **D. Manager Intelligence Platform (P2–P4)** | Own contracts (`lib/decision-os/manager-intelligence/{team-health,weekly-outlook,transaction-readiness}`) | Own resolvers, largely independent of A/B/C | Manager Hub (`/league/[id]/manager-hub`) |

**Plus, separately: `lib/league-health.ts`'s `monitorLeagueHealth`** — used by `/api/league-health`,
has **zero relationship** to any of the four subsystems above (confirmed in the Phase A audit).

None of these four subsystems currently read from each other in a coordinated way. Subsystem A is the
only one Decision OS Phase A extends; subsystems B/C/D are separate, older, independently-storaged
systems that predate Phase A.

---

## 3. Surface-readiness matrix

| Surface | Current source | Real Decision OS (subsystem A) available? | Gap | Needed implementation | Demo priority |
| --- | --- | --- | --- | --- | --- |
| **Mission Control** | ✅ `lib/decision-os/missionControl.ts` + `GET /api/decision-os/mission-control` (Increment 5) + `MissionControlCard` rendered on the Commissioner Hub dashboard (Increment 6, §4f) — composes Increment 3's federated League Health + Increment 2's trend | ✅ Yes — federated from real subsystem A data via subsystems' existing alignment | None for the read path. Only shown on the Commissioner Hub dashboard so far — not (yet) on `/league/[id]/intelligence` or a dedicated Mission Control page/route | Done for composition + route + first visible card. Remaining: decide if/when Mission Control gets its own page, vs. staying a Commissioner Hub card | High (named target) — **composition + route + visible UI done** |
| **League Analytics** | ✅ `lib/decision-os/leagueAnalytics.ts` + `GET /api/decision-os/league-analytics` + `LeagueAnalyticsCard` rendered on the Commissioner Hub dashboard (Increment 8, §4g) — composes the SAME federated League Health/trend Mission Control uses, reshaped for counts-over-time instead of actions | ✅ Yes — federated from real subsystem A data | None for the "minimal viable" scope. No historical/season-over-season charting, no cross-league comparison — just current counts + the same single-league trend Mission Control already shows | Done for a first minimal version. Remaining: a genuinely broader analytics surface (season history, cross-league comparison) if ever prioritized — explicitly NOT attempted this increment | High (named target) — **first minimal version done** |
| **League Health** (`app/api/league-health`) | `monitorLeagueHealth` (`lib/league-health/*`) — a pure scoring function; **fed by real Decision OS counts as of Increment 3** via `lib/decision-os/leagueHealthAlignment.ts` (opt-in `source: 'decision_os'`, legacy explicit-body contract unchanged) | ✅ **Yes — federated this increment** | ~~Totally separate system~~ Resolved: **federate, not replace** (§4c) — the scoring engine itself was never touched | Done. Remaining: no live UI caller yet (same as before this increment — the route was already orphaned) | High — ✅ **decision made + implemented (federate)** |
| **Manager Intelligence** — Commissioner Hub / Dashboard Overview / `LeagueTab` (`dashboard-intelligence.ts`) | Subsystem A (behavioral pipeline) directly | **Yes — was already the real source** | Was missing the Phase A imported-activity merge (external managers invisible) | ✅ **DONE this increment** | **Highest — directly serves the Replacements case** |
| **Recommendations** (`DecisionRecommendationsCard`, dashboard) | Subsystem B (Phase 6), derived from subsystem A via `dashboard-intelligence.ts` | Yes, indirectly | Inherits the same gap as above | ✅ **Fixed as a side effect of the same change** (same composition function) | High |
| **Manager Intelligence Hub** (`/manager-hub`, Team Health / Weekly Outlook / Transaction Readiness) | Subsystem D (own contracts) | No — separate system | Doesn't read subsystem A at all | Needs its own audit of what P2–P4 actually read before any alignment (out of scope to guess this increment) | Medium |
| **Commissioner Intelligence Hub** — Activity module | Subsystem C (`IntelligenceQueryService` → `IntelligenceLeagueSnapshot`) | No | Different storage, different event taxonomy (G15 DomainEvents, not `BehavioralEvent`) | Requires a decision: migrate subsystem C onto subsystem A, or keep both and reconcile counts | High (named: "Activity") — **needs a decision** |
| Commissioner Intelligence Hub — **Health** module | Subsystem C | No | Same as above | Same as above | High (named: overlaps "league health") |
| Commissioner Intelligence Hub — Action Items | Subsystem C | No | Same as above | Same as above | Medium |
| Commissioner Intelligence Hub — Trade Review | Subsystem C (`IntelligenceLeagueSnapshot` trade counts) | No | Same as above | Same as above | High (named: "trade activity") |
| Commissioner Intelligence Hub — Rule Settings | Subsystem C-adjacent (stored config, not activity) | N/A | Not an activity/facts surface — out of scope for this alignment | None needed | Low |
| Commissioner Intelligence Hub — Stories | Subsystem C (`IntelligenceQueryService` + `StoryEngine`) | No | Same as above | Same as above | High (named: "storylines / narrative") |
| Commissioner Intelligence Hub — Audit Feed | Subsystem C (`AuditFeedEntry`) | No | Same as above | Same as above | Medium |
| **Reports** | ❌ no dedicated surface found | N/A | Not built | Undetermined — not requested to build | Low (not named as a hard requirement) |
| **Automations** | ❌ no unified surface; only scattered per-feature toggles (survivor challenges, waiver automation, etc.) | N/A | Not a Commissioner OS surface today | Undetermined | Low |
| **Notifications** | `app/alerts` — a user-facing alert-*settings* page, not an intelligence surface | N/A | Different purpose entirely; not a Decision OS consumer | N/A | Low |
| **Retention risk** | ❌ no discrete signal found anywhere (subsystem A/B/C/D) | No | This isn't a "wrong source" gap — **the signal itself doesn't exist yet** | New derivation needed in subsystem A or B (a Decision OS *feature* gap, not a surface-wiring gap) | High (named target) — **needs Decision OS work first, not surface wiring** |
| **Trend movement over time** | Phase A Increment 5 (`lib/decision-os/snapshot/*`) | ✅ **Yes — wired this increment** (Increment 2, §4b): `dashboard-intelligence.ts`'s `leagueTrend` field | Read path was live; **write path now exists too** (§4d, `/api/cron/decision-os-snapshot-capture`) but is **not scheduled to run automatically** — it must be invoked (on demand, or registered as a cron) for real history to accumulate | ✅ Job/route built. Remaining: register a schedule + supply `CRON_SECRET` in a real environment | High (named target) — **wiring + write path done; scheduling is a deployment decision, not a code gap** |

---

## 4. What was aligned this increment (implemented)

**`lib/decision-os/dashboard-intelligence.ts`** — the `loadLeagueEvents` composition (already
independently duplicating `real-data-provider.ts`'s event-loading shape, plus its own additional
redraft sources) now also merges imported/external-league activity:

```
loadLeagueEvents(leagueId, since):
  Promise.all([ waivers, trades, rosterMoves, draft, redraftTrades, redraftRosterPlayers,
                redraftRosterMoves, importedActivity ])   // ← new, additive
  → map each to BehavioralEvent[] → spread into one array (unchanged shape/order otherwise)
```

- Reuses the **exact same** honestly-degrading loader `real-data-provider.ts` already uses
  (`defaultLoadImportedActivityRows`, now exported for this reuse) — no duplicated degradation logic,
  no new failure mode.
- **Purely additive**: if a league has no imported activity, the merge contributes `[]` and behavior
  is byte-identical to before (proven by a regression test).
- This is the composition **`resolveManagerIntelligencePayload`** calls, and that function is what
  powers the **already-live** Commissioner Hub dashboard, Dashboard Overview, and `LeagueTab` — so this
  one change reaches real, currently-rendered UI, not a dead code path.
- **Honest degradation preserved:** an external-only manager with real imported activity gets a real
  profile; a manager (AF or external) with zero activity still gets the same honest zero-activity
  baseline as before (`primaryIdentity: 'unknown'`, `confidence: 0`) — never fabricated.

## 4b. Increment 2 — behavioral snapshot/trend history wired into the same surface (implemented)

**Goal:** make "is this league's activity trending up or down over time" visible, using Phase A's
already-built, already-tested snapshot/trend module (Increment 5) — which, per §7 item 1 below (from
Increment 1's own recommendation), was **built but consumed by nothing.**

- **`lib/decision-os/snapshot/prismaBehavioralSnapshotStore.ts`** gains
  `defaultListLeagueBehavioralTrend(leagueId, options?)` — a default reader mirroring Increment 3's
  `defaultLoadImportedActivityRows` exactly: if the `decisionOsBehavioralSnapshot` model isn't
  generated/migrated, or the read fails, it returns `[]` — **never throws, never fabricates a point.**
- **`lib/decision-os/dashboard-intelligence.ts`** gains `resolveLeagueActivityTrend(leagueId)` (a
  standalone, independently-testable function) and an additive `leagueTrend` field on
  `ManagerIntelligencePayload` — the same payload `resolveManagerIntelligencePayload` already returns
  to the **already-live** Commissioner Hub / Dashboard Overview / `LeagueTab` composition.
- **Honest by construction, not just by accident:** `direction` describes **activity-volume movement**
  (period-over-period event count), explicitly `'increasing' | 'decreasing' | 'flat'` — **not**
  `'improving' | 'declining'`, because this codebase's actual *health score* is subsystem C
  (`monitorLeagueHealth`/`IntelligenceLeagueSnapshot`), a separate, still-unaligned system (§3/§7
  item 2). Naming it "increasing/decreasing" avoids implying a value judgment the data doesn't
  support — the same honest-degradation discipline this whole workstream has followed.
- **Availability contract** (mirrors `deriveEventCountDelta`'s own "< 2 points → `null`" rule):
  - 0 captured periods → `{ available: false, reason: 'no_snapshots' }`
  - 1 captured period → `{ available: false, reason: 'insufficient_history' }`
  - ≥2 captured periods → `{ available: true, periodsTracked, earliestPeriodKey, latestPeriodKey,
    latestEventCount, latestManagerCount, eventCountDelta, direction }`
- **Decoupled failure domains:** `leagueTrend` is resolved **independently** of the
  DNA/Recommendations computation (not inside the same `try/catch`) — a trend-read hiccup can never
  suppress a real `managerDna`/`recommendations` result, and a DNA/Recommendations failure can never
  hide a real trend result. Both directions are tested.
- **Imported/external activity flows through:** since Increment 5's snapshots already capture
  `activeManagerIds` from the full behavioral event stream (which, after Increment 1's alignment,
  includes imported/external-league managers), `latestManagerCount` on the trend honestly reflects
  external-only managers too — tested directly.

### Tests added (Increment 2)

`dashboard-intelligence-pipeline.test.ts` gains 9 tests (31/31 total in this file, up from 22/22):
empty league → `no_snapshots`; one snapshot → `insufficient_history`; two-plus snapshots → a real
`increasing` trend with correct delta/period fields; a declining count → `decreasing`; an unchanged
count → `flat`; an external-only manager's activity reflected in `latestManagerCount`; existing
managerDna/recommendations behavior unchanged when there's no trend history (regression guard); a
trend-store failure never affects managerDna/recommendations (decoupled-failure proof); and a wiring
proof that the reader is called with the league id, league-scope (no managerId).

**Full suite run:** `dashboard-intelligence-pipeline.test.ts` (31/31) + the full decision-os ingestion
suite (Increments 1–5, 78/78) — **109/109 total, zero regressions.** Full-repo typecheck: 158 baseline
errors (unchanged from Increment 1), **zero in any file this increment touched.** No schema change,
no migration, no Neon proof needed (pure read-composition wiring; the model + migration already
shipped in Phase A Increment 5).

## 4c. Increment 3 — League Health: FEDERATE, not replace (implemented)

**Audit finding that decided the question:** `monitorLeagueHealth`
(`lib/league-health/league-health-engine.ts`) is a **pure, already-deterministic scoring function
over an explicit input struct** — it performs zero data access of its own; the route
(`/api/league-health`) requires the caller to supply every metric by hand. Two more facts settled
"replace vs federate":
- **No live UI caller exists.** The "League Health Check" card on the AI Tools page
  (`app/ai/tools/AIToolsPageClient.tsx`) links to a **Chimmy chat prompt**, not this route.
- **No existing tests.** There was no tested live behavior at risk.

Given a working, self-contained scoring algorithm with no live consumers to break, **replacing it
would be pure risk with no offsetting safety benefit — federating it is strictly lower-risk** and
was chosen. `monitorLeagueHealth`'s scoring code is **untouched, byte-for-byte** (proven by a test
asserting the same explicit input still classifies as `'excellent'`).

**`lib/decision-os/leagueHealthAlignment.ts`** — `resolveDecisionOsLeagueHealth(leagueId)`:
- Reuses `loadLeagueEvents` (Increment 1, includes imported/external activity) →
  `assembleLeagueBehavioralFacts` for real league-wide counts: `activityEventCount`, `tradeCount`
  (`totalTradeCount`), `waiverClaimCount` (`totalWaiverClaimCount`), `draftPickCount`,
  `commissionerActionCount` (`totalCommissionerActionCount`), `activeManagerCount`.
- Computes **per-manager** `assembleManagerBehavioralFacts` → `deriveManagerBehavioralIntelligence`
  (the same computation `resolveManagerIntelligencePayload` already does) for two demo-named
  signals with no other source: **`inactiveManagerCount`** (real `isInactive` count) and
  **`managersAtRetentionRisk`** (managers at `'high'`/`'critical'` `retentionRisk`, with their real
  `retentionRiskReasons`) — the "inactivity risk" and "commissioner action opportunities" the demo
  asks for. Also sums `lineupEngagement.eventCount` across managers into `rosterActivityCount` — a
  real "roster activity" signal `LeagueBehavioralFacts` doesn't track at league scope on its own.
- Reuses `resolveLeagueActivityTrend` (Increment 2) directly for `decisionOs.trend`.
- Maps only the fields it has a real source for into `LeagueHealthInput`
  (`activeManagers`/`inactiveManagers`/`totalTradesThisSeason`/`totalWaiverClaims`/
  `commissionerActionsThisSeason`) and calls the **unchanged** `monitorLeagueHealth` — every other
  field (league settings like `numTeams`/`waiverType`, or signals with no source yet like
  `chatMessageCount`/`disputeCount`) keeps the engine's own schema default.
- **`fieldProvenance`** explicitly labels every `LeagueHealthInput` field `'decision_os'` or
  `'schema_default'` — so a caller (or the demo) can never mistake a schema-default zero for a
  measured zero. This is the literal mechanism behind "never fake a health score."
- **Never throws.** A read failure degrades to the same honest all-zero `decisionOs` context (and
  the engine still returns its normal schema-default-driven result — an honest "no data yet"
  baseline, not an error page).

**`app/api/league-health/route.ts`** — additive, dual-contract: the **legacy explicit-metrics body
is completely unchanged** (same schema validation, same `monitorLeagueHealth` call, tested to still
classify identically); a new, **explicit opt-in** `{ leagueId, source: 'decision_os', overrides? }`
body routes to `resolveDecisionOsLeagueHealth` instead. No implicit/guessed dispatch — the
discriminator is explicit, matching this workstream's established contract style (e.g. Increment
1–4's `activityType` discriminants).

### Tests added (Increment 3)

- `__tests__/decision-os/league-health-alignment.test.ts` (9/9): real trade/waiver/manager counts
  reach the engine and are exposed under `decisionOs`; retention-risk managers surfaced with real
  reasons; `fieldProvenance` correctly splits decision_os vs schema_default; trend available at 2+
  snapshots with correct fields; `insufficient_history` at 1 snapshot; `no_snapshots` at 0; an empty
  league resolves to an honest zero context (not a crash); a read failure degrades the same honest
  way; the untouched engine still classifies a manually-supplied high-activity input as `'excellent'`
  (proof the scoring algorithm was never modified).
- `__tests__/decision-os/league-health-route-contract.test.ts` (5/5): 401 without a session; the
  legacy body still returns the plain engine result and **never** calls the new composition; an
  invalid legacy body still 400s; the new `source: 'decision_os'` body calls
  `resolveDecisionOsLeagueHealth` with the league id (+ `overrides`, when supplied).

**Full suite run:** 123/123 (14 new + the full decision-os regression suite, Increments 1–5 +
Phase B 1–2, 109 unchanged). **Zero regressions.** Full-repo typecheck: 158 baseline errors
(unchanged), **zero in any file this increment touched.** No schema change, no migration, no Neon
proof needed (pure composition + route wiring over models Phase A already shipped).

## 4d. Increment 4 — snapshot writer wired to a safe, repeatable job/route (implemented)

**Goal:** trend data (§4b/§4c) has been *readable* since Increment 2, but nothing wrote real
snapshot rows anywhere — every trend read has honestly reported `no_snapshots` in practice. This
increment wires the already-built writer (`captureAndWriteBehavioralSnapshots`, Phase A Increment 5)
into a callable job/route, without changing any capture/store logic.

**Scheduling approach chosen:** mirror the repo's existing cron convention exactly
(`app/api/cron/waivers/route.ts`) rather than invent a new auth/scheduling pattern —
`Authorization: Bearer ${CRON_SECRET}`, with a non-production `?secret=` query fallback for local
smoke tests; `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`; a `dryRun` query flag; per-league
try/catch isolation; the same `{ ok, dryRun, discovered, processed, failed, results }` response
shape. This was the lowest-risk option because it reuses an already-audited, already-production
auth convention instead of adding a second one.

**Deliberate scope limit:** the route captures an **explicit** list of leagues
(`?leagueId=<id>` for one, `?leagueIds=<id1>,<id2>,...` for a batch) — it does **not** auto-discover
"every league on the platform." Building a platform-wide league-discovery query is a separate, larger
scope decision (which table(s) count as "in scope," pagination, rate limiting against a real
schedule) that this increment did not need to make to satisfy "capture one league on demand" +
"capture multiple leagues in a batch."

**New files:**
- **`lib/decision-os/snapshot/captureLeagueSnapshotJob.ts`** — the reusable job unit.
  `captureLeagueSnapshotJob(leagueId, { store, now?, lookbackDays? })` composes the SAME
  `loadLeagueEvents`/`lookbackDays`/`sinceDate` (Increment 1/3's exports, already merging imported
  activity) with the unchanged `captureAndWriteBehavioralSnapshots` writer — zero new derivation
  logic, pure orchestration. Never throws: returns `{ leagueId, ok: false, error }` on failure.
  `captureLeagueSnapshotsBatchJob(leagueIds, deps)` runs the single-league job per id, isolating one
  league's failure from the rest (matches `waivers/route.ts`'s per-league try/catch exactly).
- **`lib/decision-os/snapshot/prismaBehavioralSnapshotStore.ts`** gains
  `createDefaultBehavioralSnapshotStore()` — the write-side counterpart to Increment 2's
  `defaultListLeagueBehavioralTrend`. Returns `null` (not an in-memory store) when the
  `decisionOsBehavioralSnapshot` Prisma delegate isn't present, so a caller can honestly report
  "store unavailable" instead of silently discarding a capture and claiming success.
- **`app/api/cron/decision-os-snapshot-capture/route.ts`** — `GET`, auth-gated exactly like
  `waivers/route.ts`. Parses `leagueId`/`leagueIds`, short-circuits on `dryRun`, returns
  `snapshot_store_unavailable` (503) honestly if the store factory returns `null`, otherwise calls
  the single-league or batch job and reports `{ ok, dryRun, discovered, processed, failed, results }`.
  **Deliberately NOT added to `vercel.json`'s `crons` array** — the route exists, is fully authorized
  and testable, but nothing schedules it yet. Enabling automatic scheduling is a separate deployment
  decision (needs `CRON_SECRET` set + a `vercel.json` entry in a real environment).

**Idempotency and honesty are inherited, not re-implemented:** `upsertByPeriod`'s
`findUnique`-before-`upsert` (Increment 5) already guarantees one row per `(leagueId, managerId,
periodKey)`; `assembleLeagueBehavioralFacts` already emits `warnings: ['no_events']` for a zero-event
capture. This increment's job function doesn't touch either — it only proves the *orchestration*
converges correctly when called repeatedly or with different `now` values.

### Tests added (Increment 4)

- `__tests__/decision-os/capture-league-snapshot-job.test.ts` (6/6): one-league capture calls the
  writer correctly (league + manager rows land in the store, keyed to today's period); a repeated
  same-day capture **updates** the existing league/manager rows (`status: 'updated'`, row count
  unchanged); a next-day capture **appends** a new trend row (`listTrend` returns both period keys in
  order); an empty league still persists an honest zero snapshot with `facts.warnings` containing
  `'no_events'` and zero manager rows; an event-loading failure degrades to `{ ok: false, error }`
  without writing anything; a batch capture isolates one league's failure from another's success.
- `__tests__/decision-os/decision-os-snapshot-capture-route-contract.test.ts` (12/12): unauthorized
  (no secret, wrong bearer, unset `CRON_SECRET` even with a matching query param) all 401; no
  league(s) specified → 400 `no_leagues_specified`; `dryRun` short-circuits before touching the store
  or job; `snapshot_store_unavailable` → 503 when the store factory returns `null` (never calls the
  job); a single `leagueId` calls the single-league job (not the batch job) and reports
  processed/failed correctly on both success and failure; `leagueIds=a,b,c` parses an explicit
  comma-separated batch (including a stray space) and calls the batch job, reporting a partial
  failure's `failed` count honestly; the non-production `?secret=` fallback works and is rejected in
  `NODE_ENV=production`.

**Full suite run:** 18 new (6 job + 12 route-contract) + the full decision-os regression suite
(Increments 1–5 + Phase B 1–3) — **2652/2652 total in `__tests__/decision-os`, zero regressions.**
Full-repo typecheck: run against the same 158-error baseline, **zero new errors in any file this
increment touched** (confirmed via `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit`). No
schema/migration change — this increment is code + tests only, reusing Phase A Increment 5's
already-shipped `DecisionOsBehavioralSnapshot` model.

**How trend data becomes live over time:** calling `GET /api/cron/decision-os-snapshot-capture
?leagueId=<id>` (with a valid `CRON_SECRET` bearer token) on two or more different UTC calendar days
for the same league is now sufficient to produce a real `leagueTrend`/League-Health-trend
(`available: true`) instead of `no_snapshots`/`insufficient_history` — the read path (Increment 2)
and this write path converge on the same store. Doing this manually (or via a temporary schedule) for
one or two demo leagues ahead of the Replacements demo is enough to prove real trend movement without
touching production defaults.

**Remaining deployment/env requirements (not part of this increment, intentionally):**
- `CRON_SECRET` must be set in whatever environment this is invoked from (already required for the
  existing `waivers`/other cron routes — no new secret introduced).
- The `decisionOsBehavioralSnapshot` Prisma model must be migrated + the client generated in that
  environment (Phase A Increment 5 shipped the migration; it has never been generated in this shared
  dev environment per established practice — see Phase A's own notes). Until then, the route honestly
  returns `snapshot_store_unavailable` rather than silently doing nothing.
- Actually registering a schedule (a `vercel.json` `crons` entry, or an external scheduler hitting
  this route periodically) is a deliberate, separate action — not done here, per "no production
  enablement by default."

## 4e. Increment 5 — first minimal Mission Control surface (implemented)

**Goal:** a single, real, composed snapshot a commissioner or client operator can read: league
health, activity trend, active/inactive counts, trade/waiver/draft/roster activity, retention-risk
managers, recommended commissioner actions, and snapshot/trend availability — all honest, none
fabricated.

**Zero new derivation logic — this is composition, not a new intelligence layer.** Every field comes
from Increments 2/3's already-tested outputs:

```
resolveMissionControlSnapshot(leagueId):
  resolveDecisionOsLeagueHealth(leagueId)   // Increment 3 — engine + decisionOs (incl. Increment 2's trend)
    → reshape into a flat, UI-ready snapshot
    → relabel engine.urgentAlerts/interventionRecommendations as recommendedActions
```

**New file: `lib/decision-os/missionControl.ts`** — `resolveMissionControlSnapshot(leagueId, now?)`
returns `MissionControlSnapshot`: `leagueHealth` (the full federated `DecisionOsLeagueHealthResult`,
wrapped in an `{available: true, result}` / `{available: false, reason}` envelope), `trend`,
`managerCounts` (`activeManagers`/`inactiveManagers`), `activity`
(`tradeCount`/`waiverClaimCount`/`draftPickCount`/`rosterActivityCount`), `managersAtRetentionRisk`,
`recommendedActions`, and `fieldProvenance`.

**A real architecture-boundary decision was made and is worth recording:** "recommended commissioner
actions" could have come from three different places. Two were deliberately NOT used:
- **Phase 5.3's `deriveLeagueBehavioralIntelligence`** (`lib/decision-os/behavioral/league-intelligence.ts`)
  already produces a customer-facing, deterministic `recommendations: LeagueCommissionerRecommendation[]`
  field — but its own ADR (`ADR_F5_3_LEAGUE_BEHAVIORAL_INTELLIGENCE.md`) explicitly states it is
  **"shadow-only — not wired to any production route until a Phase 5.4 cutover ADR is written."**
  Wiring it into Mission Control would silently open that gate without the cutover ADR it names as
  its own prerequisite — out of scope for a "safe, minimal" increment.
- **Phase 6.4's `assembleCommissionerRecommendations`** produces richer output but needs
  archetype/benchmark inputs (Phase 6.3/6.5) this increment does not assemble; wiring it well would
  mean composing three more subsystems, not a minimal increment.
- **What was used instead:** the federated `monitorLeagueHealth` engine (Increment 3) already
  computes real, now-real-data-driven `urgentAlerts` + `interventionRecommendations` (the engine's
  own scoring code was never touched — only its *inputs* are real as of Increment 3). This module
  only relabels those two arrays with a `priority: 'urgent' | 'standard'` tag and de-duplicates any
  message appearing in both — a reshape, not a new recommendation.

**Honest degradation:**
- `resolveDecisionOsLeagueHealth` itself never throws (Increment 3's own contract) — but
  `resolveMissionControlSnapshot` wraps the call in its **own** outer try/catch anyway, a
  defense-in-depth boundary distinct from that dependency's contract: a future change to it (or any
  unexpected failure) degrades to an explicit `leagueHealth: { available: false, reason:
  'league_health_unavailable' }` state — never a crash, never fabricated data — plus the same
  all-zero `managerCounts`/`activity`/`managersAtRetentionRisk: []`/`recommendedActions: []`/
  `fieldProvenance: null` used elsewhere in this workstream for a fully-unavailable source.
  This is a **different** failure mode from "available but all real counts are honestly zero" (a
  real, quiet league) — the two are never conflated.
- No activity → real zero counts (not this module's own fabrication; inherited honestly from
  Increment 3).
- No captured snapshots → `trend: { available: false, reason: 'no_snapshots' }`; exactly one
  snapshot → `reason: 'insufficient_history'` (both pass through Increment 2/3 unchanged).
- No managers at risk → `managersAtRetentionRisk: []` (never invented).

**New route: `app/api/decision-os/mission-control/route.ts`** (`GET`) — mirrors the existing
`/api/decision-os/manager-intelligence` route's contract exactly: session-gated (401 without a
session), `leagueId` required (400 without it), otherwise calls the composition and returns it
verbatim. Chosen over inventing a new auth pattern for the same reason Increment 4 mirrored the
waivers cron.

**UI deliberately deferred, per instruction ("do not build broad visual polish yet", "prefer
reusing existing containers if possible").** A structured survey of the two existing Commissioner
surfaces found they use **two different, non-interchangeable card systems**: the Commissioner Hub
dashboard uses `decisionOsCardClassName`/`DecisionOsEmptyState`/`DecisionOsInsufficientDataCallout`
(`components/decision-os/DecisionOsCardPrimitives.tsx`), while the separate Commissioner Intelligence
Hub (`/league/[id]/intelligence`, subsystem C, 7 modules) uses its own local `Card`/`StateMessage`/
`useResource` pattern (`components/commissioner-intelligence/CommissionerIntelligenceHub.tsx`).
Picking one over the other — or building a third — is a real design decision the increment
instructions didn't ask this pass to make; building the read API first (this increment) means a
future UI increment can bind to a stable, already-tested contract without that choice blocking it.

### Tests added (Increment 5)

- `__tests__/decision-os/mission-control.test.ts` (8/8): a healthy populated league maps every real
  field through honestly; a no-activity league produces an honest all-zero snapshot; `no_snapshots`
  trend availability passes through; `insufficient_history` trend availability passes through;
  managers at retention risk surface with real reasons unmodified; recommended actions relabel +
  dedupe the federated engine's `urgentAlerts`/`interventionRecommendations` correctly (urgent
  first); the dependency failing degrades to an explicit `league_health_unavailable` state (not a
  throw) with the same honest all-zero shape; a wiring proof that `resolveDecisionOsLeagueHealth` is
  called with the given league id.
- `__tests__/decision-os/mission-control-route-contract.test.ts` (3/3): 401 without a session; 400
  without `leagueId`; a valid request calls the composition with the league id and returns its
  snapshot verbatim.

**Full suite run:** 11 new (8 composition + 3 route-contract) + the full decision-os regression
suite (Increments 1–5 + Phase B 1–4) — **2663/2663 total in `__tests__/decision-os`, zero
regressions.** Full-repo typecheck: run against the same 158-error baseline, zero new errors in any
file this increment touched. No schema/migration change — this increment is pure composition + a
thin route over already-shipped models and already-tested functions.

## 4f. Increment 6 — Mission Control made visible on the Commissioner Hub dashboard (implemented)

**Goal:** make Mission Control demoable, not just fetchable — without building a third card system
or rebuilding the Commissioner Hub.

**Placement decision:** the existing Commissioner Hub dashboard was chosen as the lowest-risk
placement, per the increment's own instruction ("use the existing Commissioner Hub dashboard card
system unless the audit proves it cannot safely support the payload"). The audit (re-confirmed this
increment) found the dashboard already runs the exact fetch-on-mount → `useState` → render pattern
Mission Control needed: `CommissionerHubPageClient.tsx` already fetches
`/api/decision-os/manager-intelligence` for `representativeLeagueId` (the commissioner's first
managed league) inside a `useEffect`, stores it in state, and renders `LeaguePulseCard`/
`ManagerDnaCard`/`DecisionRecommendationsCard` from it using the shared `decisionOsCardClassName`
card system (`components/decision-os/DecisionOsCardPrimitives.tsx`). Mission Control's payload
(counts, arrays of strings, an availability-tagged trend) is materially simpler to render than any
of those three — nothing about the payload shape required a different system. The separate
Commissioner Intelligence Hub (`/league/[id]/intelligence`, subsystem C, 7 modules) was read only
for comparison, per instruction, and was NOT touched or extended — it uses a different, local
`Card`/`StateMessage`/`useResource` pattern, and mixing card systems inside one increment was
explicitly out of scope.

**New file: `components/decision-os/MissionControlCard.tsx`** — a presentation-only component over
`MissionControlSnapshot` (Increment 5's type, imported directly — no separate view-model layer was
added, since the payload is already display-shaped: counts, an availability-tagged trend, and two
arrays of small structs). Built entirely from existing primitives
(`decisionOsCardClassName`, `DecisionOsBadge`, `DecisionOsPanel`, `DecisionOsUpdatedStamp`,
`DecisionOsEmptyState`, `DecisionOsInsufficientDataCallout`) — zero new visual system. Renders:
- League health status badge (`engine.overallStatus`) + the engine's own `summary` line.
- Six stat chips: active/inactive managers, trades, waiver claims, draft picks, roster activity.
- Activity trend: direction + delta + tracked periods when available.
- Managers at retention risk: a list with each manager's real retention-risk level + reasons.
- Recommended commissioner actions: `urgent`/`standard`-tagged list from Increment 5's relabeled
  engine alerts/interventions.

**Honest degradation, all reusing existing primitives/contracts — nothing new invented:**
- `snapshot === null` (still loading) → `DecisionOsEmptyState` ("Mission Control is loading") —
  the same honest "not yet data, not fake data" pattern the sibling cards already use while their
  own fetch is in flight.
- `trend.available === false` → renders the literal `reason` string (`no_snapshots` or
  `insufficient_history`) plus a plain-language explanation — never a fabricated chart or line.
- `leagueHealth.available === false` → an explicit "League health unavailable" badge +
  `DecisionOsInsufficientDataCallout`, distinct from a real "healthy"/"watch"/etc. status.
- `managersAtRetentionRisk.length === 0` → the exact required copy, **"No managers currently
  flagged"** — not an empty div, not omitted.
- `recommendedActions.length === 0` → "No recommended actions right now" — same honest-empty
  discipline.

**Wiring into `app/commissioner-hub/CommissionerHubPageClient.tsx`:** one more `useState`/`useEffect`
pair, structurally identical to the existing `managerIntelligence` fetch (same
`representativeLeagueId`, same `credentials: 'same-origin'`/`cache: 'no-store'`/cancellation-guard
shape) — fetches `/api/decision-os/mission-control?leagueId=`, then renders `<MissionControlCard
snapshot={missionControl} variant="commissioner" compact />` directly after the existing
`ManagerDnaCard`/`DecisionRecommendationsCard` section, before `LeagueHealthDashboard`. Purely
additive: no existing card, fetch, or layout was changed.

### Tests added (Increment 6)

- `__tests__/decision-os/mission-control-card.test.tsx` (7/7): a populated league renders health
  status, counts, an available trend, real retention-risk managers with reasons, and recommended
  actions; the honest `no_snapshots` trend state renders; the honest `insufficient_history` trend
  state renders; an unavailable league-health state renders its own explicit badge/callout instead
  of fake values; "No managers currently flagged" renders when the list is empty; the honest empty
  state renders when there are no recommended actions; the `null`-snapshot loading shell renders
  honestly (not a spinner over fabricated data).
- `__tests__/commissioner-hub-mission-control-wiring.test.ts` (3/3) — a lightweight source-scan test
  (matching the existing `commissioner-hub-auth-links.test.ts` convention, since this page isn't
  fully rendered in tests) proving the import, the fetch call, and the render call are all actually
  wired into the page — not just built in isolation.

**Full suite run:** 10 new (7 card + 3 wiring) + the full decision-os regression suite (Increments
1–6) + the existing `commissioner-hub-auth-links.test.ts` — **2676/2676 total, zero regressions.**
Full-repo typecheck: run against the same 158-error baseline, zero new errors in any file this
increment touched. No schema/migration change. No browser/live-session verification was performed —
this page requires a real authenticated session + real league data neither available nor safe to
fabricate in this sandbox; verification here follows the same Vitest/RTL + full-repo-typecheck
method every prior increment in this workstream has used.

## 4g. Increment 8 (Demo Breadth) — first minimal League Analytics surface (implemented)

**Goal:** give the demo a second visible surface beyond Mission Control. Mission Control answers
"what should the commissioner do right now?" (health status, named at-risk managers, recommended
actions). League Analytics answers **"what is happening in this league over time?"** — activity
counts, manager counts, activity trend, and a bare retention-risk count.

**Confirmed nothing existed:** re-searched the codebase — the only prior mention of "League
Analytics" anywhere was a forward-looking doc comment in `behavioralTrend.ts` describing a future
consumer; no page, component, or route existed under that name.

**Zero new derivation logic — same discipline as Mission Control.** New
**`lib/decision-os/leagueAnalytics.ts`** — `resolveLeagueAnalyticsSnapshot(leagueId, now?)` — is a
**sibling**, not a wrapper, of `missionControl.ts`: both independently call the SAME
`resolveDecisionOsLeagueHealth` (Increment 3) directly, so neither depends on the other and either
can evolve or degrade without affecting the other. League Analytics reshapes the identical
`decisionOs` context into a leaner, counts-and-trend-only shape:
- `trend` (reused `LeagueActivityTrendSummary` type, unchanged).
- `managerCounts` (active/inactive).
- `activity` (trade/waiver/draft/roster counts).
- `retentionRiskCount` — **a bare number only.** Named managers + their specific reasons stay
  Mission Control's job; League Analytics deliberately never repeats that list, keeping the two
  surfaces' framing distinct (a count belongs to "what's happening," a named list + reasons belongs
  to "what to do about it").

**Honest degradation, mirroring Mission Control's own contract exactly:**
- `resolveDecisionOsLeagueHealth` itself never throws, but `resolveLeagueAnalyticsSnapshot` wraps
  the call in its own outer try/catch anyway (the same defense-in-depth reasoning as Mission
  Control) — degrades to an explicit `{ available: false, reason: 'league_health_unavailable' }`,
  never a crash, never a fabricated number.
- No captured snapshots → `trend: { available: false, reason: 'no_snapshots' }`; exactly one
  snapshot → `insufficient_history` (both pass through unchanged from Increments 2/3).
- No activity → real honest zero counts, not this module's own fabrication.

**New component: `components/decision-os/LeagueAnalyticsCard.tsx`** — reuses the exact same
`DecisionOsCardPrimitives` as `MissionControlCard` (`decisionOsCardClassName`, `DecisionOsBadge`,
`DecisionOsPanel`, `DecisionOsEmptyState`, `DecisionOsInsufficientDataCallout`,
`DecisionOsUpdatedStamp`) — **zero new visual system.** Deliberately **leaner** than
`MissionControlCard`: six stat chips + a trend panel + a single retention-risk **count** (with a
line pointing to Mission Control for names/reasons) — no recommended-actions list, no named
at-risk-manager list. This is what keeps the two surfaces visually and conceptually distinct rather
than duplicating each other.

**New route: `app/api/decision-os/league-analytics/route.ts`** (`GET`) — mirrors
`/api/decision-os/mission-control`'s contract exactly (session-gated 401, `leagueId` required 400,
otherwise calls the composition and returns it verbatim).

**Wired into `app/commissioner-hub/CommissionerHubPageClient.tsx`:** one more additive
`useState`/`useEffect` pair (identical shape to the `missionControl` fetch) + one new `<section>`
rendered directly after `<MissionControlCard>`, before `LeagueHealthDashboard`. Confirmed via
`git diff` to touch nothing else on the page.

### Tests added (Increment 8)

- `__tests__/decision-os/league-analytics.test.ts` (7/7): a populated league maps trend/counts/
  retention-risk count through honestly; `no_snapshots`/`insufficient_history` trend states pass
  through; a no-activity league produces an honest all-zero snapshot; the retention-risk field is
  proven to be a bare count (no named-manager list on this type at all); a dependency failure
  degrades to an explicit unavailable state; a wiring proof the composition calls
  `resolveDecisionOsLeagueHealth` with the league id.
- `__tests__/decision-os/league-analytics-route-contract.test.ts` (3/3): 401 without a session; 400
  without `leagueId`; a valid request calls the composition and returns its snapshot verbatim.
- `__tests__/decision-os/league-analytics-card.test.tsx` (6/6): a populated league renders counts,
  an available trend, and the retention-risk count; the honest `no_snapshots` state renders; the
  honest `insufficient_history` state renders; an honest all-zero state renders "No managers
  currently flagged"; an explicit unavailable state renders instead of fake values; the `null`
  loading shell renders honestly.
- `__tests__/commissioner-hub-league-analytics-wiring.test.ts` (3/3) — the same source-scan
  convention as the Mission Control wiring test: proves the import, fetch, and render calls are
  actually wired into the page (and that `LeagueAnalyticsCard` renders after `MissionControlCard`,
  preserving the intended reading order).

**Full suite run:** 19 new (7 composition + 3 route-contract + 6 card + 3 wiring) + the full
decision-os regression suite + existing commissioner-hub tests — **2695/2695 total, zero
regressions.** Full-repo typecheck: run against the same 158-error baseline, zero new errors in any
file this increment touched. No schema/migration change. No browser/live-session verification
performed, for the same reason as Increment 6 (needs a real authenticated session + real league
data, neither available/safe to fabricate in this sandbox).

## 5. Preserved honest degradation (Do #6)

- No imported activity for a league → the merge contributes nothing; existing AF-native/redraft-only
  behavior is unchanged (regression-tested).
- Imported-activity loader failing → caught by the existing outer `try/catch` in
  `resolveManagerIntelligencePayload`, resolves to `{ managerDna: null, recommendations: null }` —
  the same honest-failure contract every other source already has (tested).
- ~~Trend data is not yet wired to any surface~~ **Wired in Increment 2** (§4b) — and while
  wired-but-empty (no captured snapshot history yet, since no scheduler writes them), it reports
  `no_snapshots` honestly rather than a fabricated trend line.

## 6. Tests added

`__tests__/decision-os/dashboard-intelligence-pipeline.test.ts` (existing 16 tests untouched, still
green) gains:
- Regression: zero imported activity ⇒ unchanged existing behavior.
- Imported Sleeper trade activity **alone** (no AF-native/redraft data) now produces a real,
  non-baseline profile (`transactionStyle: 'trade_dominant'`).
- **An external-only manager (no AllFantasy account) gets a real profile keyed to their stable
  provider id** — the core Replacements-demo proof.
- Empty imported activity still yields the exact same honest zero-activity baseline as before (no
  demo-metric fabrication).
- Degraded-safe: the imported-activity loader throwing still resolves honestly (`null`/`null`), not a
  rejected promise.
- Wiring proof: `defaultLoadImportedActivityRows` is called with the league id + a since `Date`,
  alongside the other real sources.

**Full suite run:** `dashboard-intelligence-pipeline.test.ts` (22/22) + the full decision-os ingestion
suite (Increments 1–5, 78/78) — **100/100 total, zero regressions.** Full-repo typecheck: 158 baseline
errors (unchanged), **zero in any file this increment touched.**

## 7. Recommended implementation sequence (per "too many misaligned surfaces → produce a sequence")

Most of the matrix's gaps are **not** safe to guess at — each is a real architecture decision:

1. ~~Increment 2 (clean, low-risk, high demo value): wire Phase A's trend history into a surface.~~
   **✅ DONE (§4b)** — `leagueTrend` is now on the same payload the live dashboard/Commissioner Hub
   composition already returns. **Note carried forward:** no scheduler yet writes snapshot rows in any
   real environment, so this will report `no_snapshots` until Increment 5's writer is scheduled — that
   remains open (see Phase A's own remaining-work list).
2. ~~Increment 3 (architecture decision required): League Health.~~ **✅ DONE (§4c) — federated,
   not replaced.** The scoring engine was never touched; real Decision OS counts + trend now feed
   it via an explicit opt-in route contract. **Remaining note carried forward:** the route still has
   no live UI caller (unchanged from before this increment) — wiring a real surface to call it is a
   separate, future step, not part of this alignment.
~~3. Increment 4: schedule the Phase A snapshot writer.~~ **✅ DONE (§4d, actually executed as
   Increment 4)** — real data can now accumulate for the trend this sequence's item 1 wired.
~~4. Build Mission Control on a now-coherent source set.~~ **✅ DONE (§4e, actually executed as
   Increment 5, ahead of items 5–7 below)** — the user's own explicit recommendation prioritized
   Mission Control once trend scheduling (item 3) existed, over auditing subsystems C/D first. This
   was safe specifically because Mission Control composes ONLY subsystem A (via the already-federated
   League Health + trend) — it does not touch subsystems B/C/D, so it isn't exposed to their
   still-open migration/audit questions below.
5. **Commissioner Intelligence Hub migration (larger, needs sign-off).** All 7 modules
   (Activity/Health/ActionItems/TradeReview/Stories/AuditFeed, +RuleSettings unaffected) trace to
   subsystem C (`IntelligenceQueryService`/`IntelligenceLeagueSnapshot`), a different event taxonomy
   than subsystem A. Migrating this is a real, multi-module undertaking — not a "prefer re-pointing"
   one-liner — and should get its own dedicated audit + explicit go-ahead, not be guessed here.
6. **Manager Intelligence Hub (P2–P4) audit.** Subsystem D hasn't been examined deeply enough this
   pass to know its exact gap; needs its own look before touching it.
7. **Retention risk signal.** This is a **Decision OS feature gap**, not a surface-wiring problem —
   no subsystem currently derives it. Needs a Phase-A-style derivation increment before any surface
   can show it. (Mission Control currently surfaces `managersAtRetentionRisk` from Increment 3's
   per-manager derivation — a real signal, but still narrower than a dedicated league-level
   retention-risk feature would be.)
~~8. Mission Control's own UI.~~ **✅ DONE (§4f, actually executed as Increment 6)** —
   `MissionControlCard` now renders on the Commissioner Hub dashboard, reusing the existing
   `decisionOsCardClassName` system (the "two incompatible systems" question from item 4's earlier
   note was resolved by choosing the Commissioner Hub's system and NOT touching the Commissioner
   Intelligence Hub's — see §4f).
~~9. League Analytics.~~ **✅ DONE (§4g, actually executed as "Demo Breadth Increment 4"/Increment
   8)** — a first minimal version, deliberately scoped to reuse the SAME federated data Mission
   Control already has (no new derivation, no historical/season charting, no cross-league
   comparison). A genuinely broader analytics surface remains open if ever prioritized.
10. **Commissioner Intelligence Hub migration and Manager Intelligence Hub audit (items 5–6 above)
   remain the largest open architecture decisions** — neither Mission Control's nor League
   Analytics' success composing only subsystem A reduces their scope; they still require their own
   dedicated passes.

## 8. Boundaries honored
- PR #183 untouched, still draft, not merged.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work.
- No third/new card or visual system created at any point — Mission Control (§4f) and League
  Analytics (§4g) both reuse the existing Commissioner Hub `decisionOsCardClassName` primitives
  exactly; the Commissioner Hub itself was never rebuilt, only additively extended (one new
  `useState`/`useEffect` + one new `<section>`, twice).
- No fake/demo data; all new tests assert honest degradation, not fabricated metrics.
- No production DB touched (Increment 8 is code + tests only — no migration, no Neon proof needed).
- No production cron enabled (unrelated to this increment — Increment 4's cron route remains
  unregistered in `vercel.json`, unchanged).
