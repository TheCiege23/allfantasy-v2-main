# Reports Live Integration Report — Phase 3.11

Eighth live Commissioner OS module attempt, following the established
pattern (Mission Control, League Health, Manager Intelligence,
Recommendations Center, Commissioner Workspace, Automation Center, League
Analytics). Scope held to Reports, plus the explicitly-requested
`resolveActiveLeagueId()` extraction evaluation. No adapter contract, UI
file, public interface, or backend endpoint changed.

## Outcome, stated plainly

Reports is a **full structural absence**, like Workspace (3.8) and
Automation Center (3.9) — not the partial-real outcome League Analytics
(3.10) had. All three methods (`getTemplates()`, `getHistory()`,
`getSummary()`) stay on the existing honest placeholder; `live.ts` gets a
documentation-only update. Separately, this phase extracted the
five-times-duplicated `resolveActiveLeagueId()` helper into a shared
module — a real, tested, zero-risk refactor performed proactively once
this audit confirmed Reports itself wouldn't need a sixth copy.

## Core-Concept Check (performed first, per instruction)

**Question:** Does Reports map to any real Decision OS concept — league
intelligence summaries, league trends, manager summaries,
recommendations, narrative signals, historical intelligence, exported
snapshots, scoring history, transaction history — currently ported or
excluded on `g15-event-foundation`?

**Answer: No**, for the concept that actually defines Reports. All the
listed signals (league intelligence, trends, manager summaries,
recommendations, narrative signals) genuinely exist and are already
real, already consumed by other modules (League Health, Recommendations
Center, League Analytics). But Reports' own doc comment states its
actual job precisely: *"Scheduled, shareable, printable packaging of
intelligence already owned elsewhere — never a second copy of the
underlying data."* The packaging layer itself — a persisted-artifact
system with generation status, format, file size, and share links — is
what `GeneratedReport`/`ReportTemplate` actually need, and **that** has
no analog anywhere:

- Checked directly against `lib/decision-os/` (ported and `phase6/`
  excluded) for report/export/template/csv/pdf/digest concepts: zero
  matches beyond incidental word occurrences.
- Checked `prisma/schema.prisma` for any `ReportTemplate`/
  `GeneratedReport`/`ScheduledReport`/`ReportExport`-shaped model: none
  exists anywhere in the app, not just Decision OS.
- "Exported snapshots" and "historical intelligence" are real (Phase
  3.3's `IntelligenceLeagueSnapshotHistory`), but that's raw historical
  *data*, not a report-generation *artifact* — Reports would need to
  turn that data into a scheduled, statused, shareable file, which is an
  entirely different, unimplemented capability.

## Contract Audit

`ReportTemplate`: `id`, `name`, `description`, `category`,
`sourceModuleIds`, `schedule` (`frequency`/`nextRunAt`). `GeneratedReport`:
`id`, `templateId`, `templateName`, `status`, `format`, `generatedAt`,
`generatedByLabel`, `summary`, `sizeLabel`, `shareStatus`, `shareLink?`,
`relatedLinks`, `failureReason?`. `ReportsSummary`: `headline`,
`scheduledCount`, `readyCount`.

| Field | Classification | Why |
|---|---|---|
| `ReportTemplate.id`/`name`/`description`/`category`/`sourceModuleIds` | (5) Not backed anywhere | Static product-catalog metadata — which report types the product offers — not computed intelligence at all; no Decision OS concept, and no application-layer table defines it either |
| `ReportTemplate.schedule` | (5) Not backed anywhere | Same "no persisted schedule anywhere" gap as Automation Center's `schedule` in Phase 3.9 |
| `GeneratedReport.status` | (5) Not backed anywhere | A persisted generation-job lifecycle (`queued`/`generating`/`ready`/`failed`) — the same structural class of gap as Automation Center's execution status, not a Decision OS concern |
| `GeneratedReport.format`/`sizeLabel`/`shareStatus`/`shareLink` | (5) Not backed anywhere | Artifact-file metadata; no report-generation system exists to produce a real file, size, or share link |
| `GeneratedReport.generatedAt` | (5) Not backed anywhere | Must mean "when this artifact was generated" — a real event that never happened, unlike Recommendations Center's `createdAt` (Phase 3.7), which honestly reinterpreted a real `derivedAt` field. There is no equivalent real timestamp to reinterpret here. |
| `GeneratedReport.generatedByLabel` | (5) Not backed anywhere | Identifies who/what triggered a generation event that doesn't exist |
| `GeneratedReport.summary` | (3) Backed by Commissioner OS/application-layer data only, but not wireable in isolation | Could honestly be built from real League Health/Analytics/Recommendations data — but only as a description *of a specific generated report*, which doesn't exist; a summary string alone doesn't constitute a `GeneratedReport` |
| `GeneratedReport.relatedLinks` | (4) Honestly-empty-capable in isolation | Same as every prior module's `relatedLinks` — real if a report existed, but doesn't rescue the record on its own |
| `GeneratedReport.failureReason` | (5) Not backed anywhere | Optional, but only meaningful for a `status: 'failed'` artifact that doesn't exist |
| `ReportsSummary.headline`/`scheduledCount`/`readyCount` | (5) Not backed anywhere | Aggregates over a report/template system with no real rows to count |

### Applying (and refining) the Phase 3.10 array lesson

`getTemplates(): ReportTemplate[]` and `getHistory(): GeneratedReport[]`
are both arrays — the Phase 3.10 question ("is `[]` an honest value?")
was applied deliberately, not skipped, and the answer here is **no**,
which sharpens last phase's lesson rather than contradicting it. The
distinguishing test: *is the empty array a supplementary fact inside an
otherwise-real response, or is the array the entire payload of the
call?* League Analytics' `competitiveBalance: []` sat alongside real
`kpis`/`trends` — an honest "we checked this specific sub-question and
there's nothing" inside a response that was otherwise genuinely
populated. Here, `getTemplates()`/`getHistory()`'s *only* output is the
array itself — returning `[]` would read as "you have configured zero
report templates" / "you have generated zero reports," a specific,
falsifiable claim about the user's own configured state (the demo
fixture's 4 real, designed templates and 5 real history entries prove
this isn't actually "usually zero"), when the true state is "we have no
way to check at all." The generic `notYetIntegrated()` placeholder
communicates that true state honestly; an empty array would not.

Constructing a report live — summarizing real League Health/
Recommendations Center/Analytics data on the fly as a `summary` string —
was also considered and rejected: doing so would still require
fabricating `status`, `generatedAt` (of a generation event that never
happened), `format`, `sizeLabel`, and `shareLink`, i.e. every field that
actually makes a `GeneratedReport` a *report* rather than just a string.
This is exactly the invention this phase's constraints (and this whole
program) forbid.

## Backend Capability Mapping

None. No currently-ported Intelligence API route maps onto any part of
this contract.

## Live Wiring Completed

None. All three methods (`getTemplates()`, `getHistory()`,
`getSummary()`) remain on the pre-existing honest placeholder. `live.ts`
received a documentation-only update recording this audit's conclusion —
no functional change.

## Placeholders Retained

All of `getTemplates()`, `getHistory()`, and `getSummary()`, in full.

## Excluded Decision OS Capabilities

None. Unlike Manager Intelligence (Phase 6.2) or Recommendations Center
(Phase 6.4), no excluded `phase6/` classifier maps onto reports,
templates, exports, or generation status — checked directly, not
assumed.

## Application-Layer-Only Data

`GeneratedReport.summary` is the one field that could honestly be
constructed from real, already-wired Commissioner OS data (League
Health's `healthNarrative`, Analytics' `kpis`, Recommendations Center's
queue) if a real report-generation system existed to attach it to. It
doesn't rescue either method alone, since a summary string isn't a
`GeneratedReport` without the surrounding artifact metadata (status,
format, size, share link) that has no source anywhere.

## Structural Gaps

Identical in kind to Workspace's and Automation Center's: every
defining field describes a persisted, generated, or scheduled artifact
that Decision OS's recompute-fresh design was never built to hold, and
that doesn't exist as application-layer infrastructure either (no
`ReportTemplate`/`GeneratedReport`-shaped Prisma model anywhere in this
repository, unlike Automation Center's adjacent `lib/automation/` job
engine). This is a genuinely new product capability, not a port and not
an existing-but-unwired application feature.

## Graceful Degradation Behavior

Unchanged and already correct: all three methods return the generic
`notYetIntegrated()` error when `isLiveReady('reports')` is false (its
only reachable state today). No capability-specific degradation path
was added, since no real call is ever attempted — mirroring Workspace
and Automation Center, not the four modules with partial real wiring.

## `resolveActiveLeagueId()` Extraction

**Evaluated and executed.** The helper was duplicated verbatim across
five `live.ts` files (Mission Control, League Health, Manager
Intelligence, Recommendations Center, League Analytics), flagged with
increasing urgency in every phase's report since Phase 3.5. This
phase's audit found Reports needs **zero** active-league resolution —
every field is either static catalog metadata or persisted-artifact
metadata, neither of which requires a league lookup — so Reports itself
never triggers a sixth copy. Rather than deferring the decision again,
the five existing copies were verified byte-identical
(`diff`-equivalent read of all five function bodies) and extracted to
`lib/commissioner-os/resolveActiveLeagueId.ts`, a new shared module
following the existing `featureFlags.ts`/`liveReadiness.ts` precedent
for top-level cross-module utilities. All five `live.ts` files now
import it instead of defining it locally; the pre-existing doc comment
explaining the `Roster`-vs-broken-`LeagueMember`-route rationale
(originally in Mission Control's copy) was preserved in the new shared
file rather than lost. This was a zero-risk moment to do it: no
module's own wiring work depended on the refactor landing correctly,
and all five pre-existing live-integration test suites (59 tests total)
pass unmodified against the extracted version, proving the refactor is
behaviorally transparent.

## Files Modified

| File | Change |
|---|---|
| `lib/commissioner-os/resolveActiveLeagueId.ts` | New — the extracted, shared active-league resolution helper |
| `lib/commissioner-os/decision-os-client/live.ts` (Mission Control) | Import shared helper; local copy removed |
| `lib/commissioner-os/league-health/decision-os-client/live.ts` | Import shared helper; local copy removed |
| `lib/commissioner-os/managers/decision-os-client/live.ts` | Import shared helper; local copy removed (kept its own `prisma` import for `appUser.findMany`) |
| `lib/commissioner-os/recommendations/decision-os-client/live.ts` | Import shared helper; local copy removed |
| `lib/commissioner-os/analytics/decision-os-client/live.ts` | Import shared helper; local copy removed |
| `lib/commissioner-os/reports/decision-os-client/live.ts` | Documentation only — no functional change |

No new test file for Reports: no functional behavior changed, and the
existing `commissioner-os-live-integration-foundation.test.ts` already
covers `liveReportsClient` structurally. The five pre-existing
live-integration test files for the refactored modules were re-run
unmodified and continue to pass (59/59), proving the extraction didn't
change behavior.

## Verification Summary

| Suite | Result |
|---|---|
| 5 pre-existing live-integration test files (post-extraction) | **59/59 passing**, unmodified |
| Full Commissioner OS suite (27 files) | **359/359 passing** — unchanged from Phase 3.10 |
| Decision OS behavioral suite (port worktree) | Unaffected — confirmed via clean `git status` and unchanged HEAD (`62cfa9ce3`) |
| Full-repo typecheck | **3156 — exactly at the required baseline**, zero new errors, including in every touched file |

## Notes for Search / Phase 3.12

1. **Check whether Search's contract is "packaging" or "data."** Reports'
   defining lesson this phase: a module that exists to *package* or
   *reference* other modules' real intelligence (via `summary` strings
   and `relatedLinks`) still needs its own artifact-specific metadata
   (status, generation event, etc.) that nothing provides — packaging
   layers are a distinct risk category from data layers. If Search
   indexes/searches across other modules' content rather than computing
   anything new itself, expect a similar "the underlying content is
   real, but Search's own metadata (relevance score? result ranking?
   index freshness?) may not be."
2. **The refined array lesson matters again here if Search returns
   arrays.** Before assuming `[]` is a safe placeholder for an empty
   result set, ask: is this array one fact among several in an otherwise
   real response, or is it the entire payload of the call? Only the
   former is a safe honest-empty candidate (per this phase's
   refinement of Phase 3.10's rule).
3. `resolveActiveLeagueId()` is now available at
   `lib/commissioner-os/resolveActiveLeagueId.ts` — if Search needs
   active-league resolution, import it directly rather than adding a
   sixth duplicate.
4. Search is plausibly the first module that queries *across* other
   modules' already-wired data (recommendations, manager summaries,
   help articles) rather than calling Decision OS directly itself —
   worth checking whether that means no new `callDecisionOS` calls at
   all, only composition of what other modules already fetch.
