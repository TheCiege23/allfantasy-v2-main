# Notification Center Live Integration Report — Phase 3.13

Tenth live Commissioner OS module attempt, following the established
pattern (Mission Control, League Health, Manager Intelligence,
Recommendations Center, Commissioner Workspace, Automation Center, League
Analytics, Reports, Search). Scope held to Notification Center only. No
adapter contract, UI file, or backend endpoint changed.

## Core-Concept Check (performed first, per instruction)

**Question:** Does Notification Center map to a real Decision OS concept,
or is it a Commissioner OS application-layer/event-delivery feature?

**Answer: composition layer**, like Search (3.12), confirmed directly
from the module's own contract doc comment: *"a `CommissionerNotificationPayload`
never duplicates the module data behind it, only enough (`message`,
`sourceModuleId`, an optional `relatedLink`) to know about it and get back
to it."* Checked each inspection point against `demo.ts` (read directly,
not assumed):

- **Decision OS alerts**: none exist as a discrete concept — Decision OS
  computes intelligence, it doesn't emit alerts of its own.
- **Recommendation alerts / narrative signals / deadline signals /
  manager risk signals / league health signals**: all real, but each is
  already owned and exposed by another already-audited module
  (Recommendations Center, League Health, Manager Intelligence). `demo.ts`
  confirms the intended shape: it composes over `demoLeagueHealthClient
  .getRisks()`, `demoRecommendationsClient.getQueue()`,
  `demoAutomationClient.getCatalog()`, and `demoReportsClient.getHistory()`
  — never a second, parallel data path.
- **Application notification models**: none exist — no
  `Notification`/`Alert`-shaped Prisma model anywhere in this repository
  (checked directly).
- **User notification preferences / unread-read lifecycle state**: no
  persisted store exists anywhere for either — confirmed by the module's
  own doc comment: *"Read/unread toggling and mute preferences are local,
  client-persisted state... the `read` flag returned here is only the
  fetched baseline a fresh session starts from."*

## Contract Audit

`CommissionerNotificationPayload`: `id`, `severity`, `message`,
`sourceModuleId`, `createdAt`, `read`, `relatedLink?`.
`NotificationsSummary`: `unreadCount`, `criticalCount`, `headline`.

| Field | Classification | Why |
|---|---|---|
| `id` | (3) Composed from an already-wired Commissioner OS module | Derived from the source item's own real id (`notification-${risk.id}`, etc.) |
| `severity` | (3) Composed from an already-wired Commissioner OS module | Real `SeverityTier` → `CommissionerNotificationSeverity` mapping (`conditionToEventSeverity`) — a deterministic translation of a real field, not a new score |
| `message` | (3) Composed from an already-wired Commissioner OS module | Reuses the source item's own real text (`risk.description`, `rec.title`) or a templated sentence built only from real fields (an automation's `name`, a report's `templateName`/`failureReason`) |
| `sourceModuleId` | (3) Composed from an already-wired Commissioner OS module | Hardcoded to the composing category (`'league-health'`, `'recommendations'`, etc.), matching the module actually being pointed to |
| `createdAt` | (3) Composed from an already-wired Commissioner OS module | Reuses each source's own real timestamp where one exists (`rec.createdAt`, `automation.lastRunAt`, `report.generatedAt`) — the same honest-reinterpretation pattern Recommendations Center used in Phase 3.7. `LeagueHealthRisk` has no timestamp field; falls back to request time (moot today, since `getRisks()` never succeeds) |
| `relatedLink` | (3) Composed from an already-wired Commissioner OS module | Static, real, module-level link — same pattern as every other module's `relatedLinks` |
| `read` | (5) Not backed anywhere, resolved via an honest default | No persisted "was this seen" store exists for any composed source. Defaults to `false` for every composed entry — not a fabricated guess about human behavior, but the structurally accurate statement that a freshly-recomputed notification has no prior read history in a system with no persistence layer for it. See "The `read` field" below for the full reasoning. |
| `NotificationsSummary.*` | (3) Composed from an already-wired Commissioner OS module | Purely derived by filtering/counting the same composed `getNotifications()` result — no separate computation |

### The `read` field — a judgment call, made explicit

This is the one field in this program's history where "not backed
anywhere" didn't default to a whole-method placeholder, and it deserves
scrutiny rather than a rote rule. The ticket explicitly names "notification
status" as something never to invent. `read: false` for every composed
entry was chosen deliberately, not as a shortcut: a notification, in this
architecture, is not a persisted entity a user could have previously
"opened" — it is recomputed fresh from another module's current state on
every request, with zero notification-specific storage anywhere. There is
no true fact being hidden or guessed at ("did this specific person see
this specific alert") — there is no alert that persisted long enough for
that question to have an answer. Defaulting to `false` is the same class
of honest baseline as a brand-new mailbox: everything in it is, by
construction, unread. The alternative (fabricating a specific true/false
per item, the way `demo.ts` does for narrative variety) would be the
actual invention this ticket warns against; a uniform, structurally
justified default is not.

## Backend Capability Mapping

None directly. `getNotifications()`/`getSummary()` call zero Decision OS
endpoints — they call four other modules' own already-audited `live.ts`
exports directly (`liveLeagueHealthClient.getRisks()`,
`liveRecommendationsClient.getQueue()`, `liveAutomationClient.getCatalog()`,
`liveReportsClient.getHistory()`), each owning its own Decision OS
relationship independently.

## Live Wiring Completed

Both methods fully implemented: gate on `isLiveReady('notifications')`
(already valid — Phase 3.12 widened `isLiveReady`'s type to
`CommissionerErrorAttributableId`, which already includes
`'notifications'`, so no further infrastructure change was needed),
compose real notifications from the four sources with real, field-based
filters (every risk; every recommendation; automations with
`health !== 'positive'` or `lastRunResult === 'failure'`; reports with
`status === 'failed'`), and return a genuinely successful response.

## Placeholders Retained

None as a whole-method placeholder. All four composed sources
independently contribute zero notifications today (each already
concluded, in its own phase's report, to have no real analog for its own
required fields), so `getNotifications()` returns `data: []` — an honest
success, reasoned through explicitly below, not a placeholder.

### Why `[]` is honest here (distinct from Reports' conclusion, 3.11)

A notification is a *recomputed observation* about another module's
current state, never a persisted, user-generated artifact. "0
currently-derivable alerts" doesn't assert anything false about a
commissioner's own past actions (unlike Reports' "0 generated reports,"
which would misrepresent irretrievable user history) — it only reflects
that no source module currently has anything real to surface, which is
literally, structurally true. An empty inbox is also a completely
normal, expected state for any real notification system at any given
moment, unlike Reports' fixed, always-populated template catalog.

## Excluded Decision OS Capabilities

None. Notification Center has no direct Decision OS relationship to
audit for excluded capabilities — moot, per the core-concept check.

## Application-Layer-Only Data

None beyond what's already covered by the four composed source modules'
own reports.

## Structural Gaps

None specific to Notification Center itself. Every gap a user will
observe today (an empty inbox) is entirely inherited from the four
source modules' own, already-documented structural gaps — nothing new
is introduced or discovered by this phase.

## Graceful Degradation Behavior

Verified by test: `isLiveReady('notifications')` false → generic
placeholder, matching every other module. Once live-ready: an honestly
empty inbox when all sources are null; real entries filtered and
projected correctly per source (a healthy automation or a ready/queued
report contributes nothing); `read` uniformly `false`; real timestamps
reused, never invented.

## Files Modified

| File | Change |
|---|---|
| `lib/commissioner-os/notifications/decision-os-client/severityMapping.ts` | New — extracted `conditionToEventSeverity`, shared by demo and live |
| `lib/commissioner-os/notifications/decision-os-client/demo.ts` | Import the shared mapping instead of a local copy; no behavior change |
| `lib/commissioner-os/notifications/decision-os-client/live.ts` | Full rewrite — real composition over four modules' live clients |
| `__tests__/commissioner-os-notifications-live-integration.test.ts` | New — 9 tests |

## Verification Summary

| Suite | Result |
|---|---|
| `commissioner-os-notifications-live-integration.test.ts` | 9/9 passing |
| Full Commissioner OS suite (30 files, combined with Phase 3.14) | **382/382 passing** |
| Decision OS behavioral suite (port worktree) | Unaffected — confirmed via clean `git status` and unchanged HEAD (`62cfa9ce3`) |
| Full-repo typecheck | **3156 — exactly at the required baseline**, zero new errors |

## Notes carried into Phase 3.14 (Activity Stream)

Activity Stream's own contract doc comment already signals the identical
composition-layer shape, generalized to five sources instead of four
(adding Workspace tasks) — addressed directly in its own report.
