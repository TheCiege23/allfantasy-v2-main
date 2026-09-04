# Recommendations Center Live Integration Report — Phase 3.7

Fourth live Commissioner OS module attempt, following the established
pattern (Mission Control, League Health, Manager Intelligence). Scope
held to Recommendations Center only. No adapter contract, UI file, or
public interface changed.

## Contract Audit

`RecommendationsClient` has a single method, `getQueue()`, returning
`CommissionerRecommendationContract[]` — the identical shared contract
League Health's `getRecommendations()` needed in Phase 3.5:
`id`, `title`, `rationale`, `severity`, `confidence`, `expectedImpact`,
`primaryActionLabel`, `status`, `category`, `sourceModuleId`, `createdAt`.
Recommendations Center's own doc comment frames it as "the canonical
queue every recommendation, regardless of which module generated it,
lives in" — a cross-module aggregation, not just league-scoped facts.

| Field | Verdict | Why |
|---|---|---|
| `id` | ✅ Real | `recommendationId` from `/league`'s `recommendations[]` |
| `title` | ❌ No analog | `/league` has only `message` (one string, no title/rationale split); Phase 6.4 (see below) has no title field either |
| `rationale` | ✅ Real | `message` maps directly |
| `severity` | ✅ Real (derivable) | Mappable from `priority` (critical→urgent, high→elevated, etc.), same pattern used for Mission Control's `activeRisks` |
| `confidence` | ❌ No analog in `/league` | Present in unported Phase 6.4 |
| `expectedImpact` | ❌ No analog in `/league` | Present in unported Phase 6.4 |
| `primaryActionLabel` | ❌ No analog in `/league` | Phase 6.4's `recommendedActions[0].action` could satisfy this if ported |
| `status` | ❌ **No analog anywhere** | No persisted recommendation lifecycle exists in Decision OS at all — ported or not. Recommendations are recomputed fresh from the current event window every request. |
| `category` | ✅ Real | `category` maps directly (different enum values, but `category: string` is untyped here, no mismatch) |
| `sourceModuleId` | ✅ Real (static) | Always `'recommendations'` for this client, matching the calling module |
| `createdAt` | ✅ Real (reasonable interpretation) | `derivedAt` — "when this was computed," not "when first created," but an honest interpretation, not fabrication |

Because `title` and `status` are required and have no analog **anywhere**
— not in the base `/league` route, and not even in the unported Phase
6.4 Recommendation Engine — `getQueue()` cannot be honestly completed
regardless of what gets ported in the future, unless Decision OS
eventually adds persisted recommendation lifecycle tracking specifically
(a capability that doesn't exist in any form today).

## Backend Capability Mapping

`GET /api/v1/intelligence/league?leagueId=` → `recommendations: LeagueRecommendationV1[]`
(`recommendationId`, `priority`, `category`, `message`) is the only
currently-ported source with any relevant data. It was called and its
result genuinely used to prove the pipeline — the return value is
discarded only because it can't honestly complete the contract, not
because the call failed or wasn't attempted.

## Live Wiring Completed

None observable in the final output — same shape as Manager Intelligence
(Phase 3.6). The real, tested pipeline: `isLiveReady('recommendations')`
gate → active-league resolution → real `/league` call → recommendation
extraction. All genuinely execute; nothing here is dead code. Completing
this method later requires either (a) Phase 6.4 being ported (closes
`confidence`/`expectedImpact`/`primaryActionLabel`, still leaves
`title`/`status` open) or (b) a genuinely new lifecycle-tracking
capability for `status` and a `title`-generation convention — likely
both, given `title`/`status` block completion independent of Phase 6.4.

## Placeholder Justification

`title` and `status` are the hard blockers — required fields, no analog
in any Decision OS surface (ported, unported, or hypothetically ported).
The honest degradation message names this precisely: "does not yet
expose recommendation title, confidence, impact, action, or lifecycle
status data" — not a generic "not integrated" message, so a future
engineer reading logs knows exactly what's still missing.

## Excluded Decision OS Capabilities

**Phase 6.4 "Recommendation Engine"** (`lib/decision-os/phase6/recommendations/`
on `g15-event-foundation`) was checked directly, not assumed. Its
`Recommendation` type has real analogs for 3 of the 4 currently-missing
fields:

- `confidence: RecommendationConfidence` ('high'|'medium'|'low') — direct match
- `expectedImpact: string` — direct match
- `recommendedActions: RecommendedAction[]` (`{ action, rationale }`) — `recommendedActions[0].action` could satisfy `primaryActionLabel`

But it has **no `title` field and no `status` field either** — even this
richer, unported system doesn't close the whole gap. It was deliberately
excluded from the Phase 3.1 port manifest (grouped with the rest of
`phase6/` as "richer classifiers... confirmed not imported by the
approved Intelligence API path"), depends on Phase 6.1 Behavioral Pattern
Detection as an input (also unported), and has no exposed route today.
Per this phase's explicit instruction, it was **not ported** — documented
only.

## Graceful Degradation Behavior

Verified by test: a fully successful `/league` call carrying real
recommendation data still returns the specific capability-gap error, not
a fabricated queue. An empty recommendations array degrades identically
(no special-casing that would create an inconsistency). A genuine
transport failure (401, 5xx, timeout) passes straight through unmodified,
never masked by the capability-gap message — these are two distinctly
different honest states and the code (and tests) keep them distinct.

## Architectural Findings

- This is the second time (after Manager Intelligence in Phase 3.6) that
  the blocking gap traces to a genuinely-existing-but-unported Phase 6
  capability that *still* wouldn't fully close the gap even if ported.
  Worth treating as a pattern: modules whose contracts include a
  **persisted lifecycle** (`status`, `ageInDays`, similar) hit a wall no
  currently-known Decision OS capability — ported or not — can close,
  since the whole behavioral-intelligence pipeline is recompute-fresh,
  not stateful.
- `resolveActiveLeagueId()` is now duplicated verbatim in **four**
  `live.ts` files (Mission Control, League Health, Manager Intelligence,
  Recommendations Center). This was a deliberate, documented choice each
  time ("follow the pattern, don't refactor it"), but four copies is a
  strong signal it should be extracted into a shared helper before a
  fifth module needs it — flagged again here, more urgently.

## Future Port Candidates

1. **Phase 6.4 Recommendation Engine** — would close `confidence`/
   `expectedImpact`/`primaryActionLabel` for both this module and League
   Health's `getRecommendations()` simultaneously (same shared contract).
   Still would not close `title`/`status`.
2. **A genuinely new capability**: persisted recommendation lifecycle
   status. This is not "port an existing thing" — nothing like it exists
   anywhere in Decision OS today, ported or not. Worth flagging to
   whoever owns Decision OS's roadmap as a real, identified product gap,
   not just a porting backlog item.

## Verification Summary

| Suite | Result |
|---|---|
| `commissioner-os-recommendations-live-integration.test.ts` | 8/8 passing |
| Full Commissioner OS suite (26 files) | **346/346 passing** |
| Decision OS behavioral suite (port worktree, unaffected — confirmed) | 696/696 passing |
| Full-repo typecheck | **3156 — exactly at the required baseline**, zero new errors |

New tests prove: the placeholder path when the flag is off; active-league
resolution and correct URL encoding; that a *successful* `/league` call
with real recommendation data still returns the specific capability-gap
error, never a fabricated queue; that an empty list degrades identically;
and that a real transport failure passes straight through, distinctly
different from the capability-gap message.
