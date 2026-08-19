# Phase OS-B4.5 — Platform OS Attention Signal Alignment

Closes the real gap [`OS_B_ARCHITECTURE_AUDIT.md`](OS_B_ARCHITECTURE_AUDIT.md) §3 found: `platformOs.ts`
(Phase D Increment 4) predates the Attention Signal model (OS-B2) and had never been migrated onto it —
it had its own older, bespoke `interventionQueue` concept built by hand-filtering `recommendedActions`
for `priority === 'urgent'`. This phase migrates it onto the shared `DecisionOsAttentionSignal` model,
without changing Notification Engine behavior (`notifications.ts`/`notificationResolver.ts` are
untouched — Platform OS still does not produce or consume `DecisionOsNotification`).

## 1. What changed

- **`PlatformOsSnapshot.interventionQueue: PlatformOsInterventionEntry[]`** → **`attentionQueue:
  DecisionOsAttentionSignal[]`**. `PlatformOsInterventionEntry` is deleted — Platform OS now surfaces
  the exact same signal shape Commissioner OS's own `attentionQueue` uses, across all 5 signal types
  (draft approaching, league context incomplete, low/high league health, league requires review), not
  just a hand-filtered subset of urgent recommended actions.
- **`resolvePlatformOsSnapshot`'s per-league loop** now also fetches League Context
  (`resolveLeagueFinancialContextSafely`) and a batched draft-date lookup (`loadUpcomingDraftDates`,
  shared from `attentionQueue.ts`) and calls `deriveLeagueAttentionSignals` inline — the exact same
  pattern `commissionerCommandCenter.ts` already established, including surfacing signals for a league
  whose Mission Control health is unavailable (League Context/draft date are independent tables).
- **`components/admin/PlatformOsOperatorPanel.tsx`**: "Intervention queue" section renamed "Attention
  queue," rendering real signal severity/title/explanation instead of `urgentActionCount`/`sampleMessage`.
- **`scripts/decision-os-suite-conformance.ts`**: updated its one log line referencing the old field name.

## 2. Consolidation: fixed the audit's own "minor duplication" finding

The audit flagged `resolveFinancialContextSafely` (a 6-line try/catch wrapper) as duplicated verbatim in
`attentionQueue.ts` and `commissionerCommandCenter.ts`. Migrating `platformOs.ts` would have made it a
THIRD copy — the same "rule of three" reasoning `SEVERITY_DOT_CLASS` was consolidated under in OS-B4.
Instead:

- **`resolveLeagueFinancialContextSafely`** is now a single, shared, exported function in
  `leagueContext.ts` itself (the module that already owns `resolveLeagueFinancialContext`). All three
  composition files (`attentionQueue.ts`, `commissionerCommandCenter.ts`, `platformOs.ts`) import it
  instead of each declaring their own local copy.
- **`ATTENTION_QUEUE_CAP`** (previously a `= 20` constant re-declared identically in two files, now
  needed in a third) is now a single exported constant in `attentionSignals.ts`.

## 3. Architectural decision: no double-fetch on an already-live route

Unlike OS-B2/OS-B3/OS-B4's own standalone resolvers (which had zero real callers besides tests when
built), `resolvePlatformOsSnapshot` backs an ALREADY-LIVE admin route
(`GET /api/decision-os/platform-os`) with real traffic. `platformOs.ts` therefore deliberately does NOT
call the standalone `resolveAttentionQueueSnapshot` (`attentionQueue.ts`) — that would fetch Mission
Control a second time per league on every real request to this route. Instead it derives signals inline
using the `MissionControlSnapshot` its own loop already fetches, the identical discipline
`commissionerCommandCenter.ts` follows for the same reason.

## 4. A real bug found and fixed during migration (test-infrastructure, not runtime)

Consolidating `resolveFinancialContextSafely` into `leagueContext.ts` as `resolveLeagueFinancialContextSafely`
broke 3 existing test files that mocked the WRONG function. They mocked `resolveLeagueFinancialContext`
(the inner function `resolveLeagueFinancialContextSafely` calls internally) via
`vi.mock('@/lib/decision-os/leagueContext', () => ({...actual, resolveLeagueFinancialContext: vi.fn()}))`
— but `{...actual, x: vi.fn()}` does NOT rebind one export's internal call to a sibling export in the
same module (`resolveLeagueFinancialContextSafely`, copied verbatim from `actual`, still closed over the
REAL `resolveLeagueFinancialContext`). The mock silently never took effect, and the real store-unavailable
path kicked in instead, degrading every league to `financialStatus: 'UNKNOWN'` — corrupting 4 previously-
passing test assertions with a spurious extra `league_context_incomplete` signal.

Fixed by mocking `resolveLeagueFinancialContextSafely` directly (the function actually called by the
composition under test) in `attention-queue-resolver.test.ts`, `commissioner-command-center-composition.test.ts`,
and the new `platform-os.test.ts` — matching how `resolveMissionControlSnapshot` was already mocked
(the function actually invoked, not an inner primitive it might delegate to).

**A related, genuine (if unlikely) production robustness gap surfaced by this**: none of the three
composition files wrapped their call to the financial-context helper in its own `.catch()` — they relied
solely on the callee's own internal try/catch. Since the callee is now imported across a module boundary,
a future change that broke that internal try/catch would propagate an unhandled rejection into each
`Promise.all`. Fixed by adding `.catch(() => null)` at all three call sites, matching the existing
`resolveMissionControlSnapshot(...).catch(() => null)` pattern already used alongside it — genuine
belt-and-suspenders, not just a test-satisfying change.

## 5. Verification

- **4 new tests**: 2 in `platform-os.test.ts` (a real `league_context_incomplete` signal from an
  UNKNOWN financial status; signals surviving an unavailable league) + 2 in
  `league-context-resolver.test.ts` (`resolveLeagueFinancialContextSafely`'s own direct coverage). One
  existing `platform-os.test.ts` test was corrected — it originally asserted the old, narrower
  "one urgent-only entry" shape; the real, migrated behavior correctly produces a `medium`-severity
  `league_requires_review` signal for a standard-priority recommended action too (something the old
  `interventionQueue` never surfaced), so the test now asserts both.
- **Full suite: 131 test files, 2935/2935 passing**, zero regressions.
- **158/158 baseline typecheck errors unchanged** — confirmed via a direct diff against the OS-B4
  baseline log (byte-identical error set).
- **Live browser verification**: not run this phase — `PlatformOsOperatorPanel.tsx` is an admin-gated
  UI with no live session available in this sandbox (the same limitation noted when it was originally
  built, Phase D Increment 12); verified via its updated component test instead.

## 6. Boundaries honored

Notification Engine (`notifications.ts`/`notificationResolver.ts`, OS-B4) is completely unchanged —
Platform OS does not produce or consume `DecisionOsNotification`. No new Decision OS signal types were
added. No database schema changes. No changes to Manager OS or Commissioner OS's own Attention
Queue/Daily Brief/Notification Center.

## 7. Remaining gap (unchanged from the audit)

Manager OS (`userOs.ts`) still does not consume the Attention Signal model — it remains a clean slate,
not a migration debt, since it never built a competing concept. Not addressed this phase (out of the
audit's own stated scope, which named Platform OS specifically as the real finding).
