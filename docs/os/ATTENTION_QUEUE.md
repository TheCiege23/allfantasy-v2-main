# Phase OS-B2 — Decision OS Attention Queue

Turns the Attention Queue (a structural placeholder as of OS-B1) into a real, deterministic,
Decision-OS-owned priority engine, per the phase's own architectural rule: **"Commissioner OS is not
Commissioner logic. Commissioner OS consumes Decision OS. Decision OS owns signal generation.
Commissioner OS owns presentation."**

## 1. What was built

- **`lib/decision-os/attentionSignals.ts`** — the reusable Decision OS Attention Signal model. Pure,
  zero-I/O (no Prisma, no network) — every function takes already-resolved inputs and returns a plain
  value, exactly like `leagueFinancialContext.ts`'s own OS-A1 discipline. Two exports:
  - `deriveLeagueAttentionSignals(input)` — derives every real signal for ONE league from its inputs.
  - `sortAttentionSignals(signals)` — deterministic severity-then-recency ordering, reusable by any
    aggregator.
- **`lib/decision-os/attentionQueue.ts`** — the standalone, fully self-contained resolver
  (`resolveAttentionQueueSnapshot`) for any consumer that does NOT already have a `MissionControlSnapshot`
  resident (a future Notification Engine, Daily Brief, Platform OS, a mobile client). Also exports the
  shared `loadUpcomingDraftDates` batched Prisma lookup.
- **`lib/decision-os/commissionerCommandCenter.ts`** (modified) — Commissioner OS's own OS-B1
  composition now derives attention signals INLINE, reusing the `MissionControlSnapshot` it already
  fetches per league, plus a new per-league League Context fetch and the shared batched draft-date
  lookup. `attentionQueue` is now `DecisionOsAttentionSignal[]`, not an ad hoc relabeling of
  `recommendedActions`.
- **`components/decision-os/CommissionerAttentionQueue.tsx`** (modified) — renders severity indicator,
  league, explanation, recommended action (when present), and a formatted timestamp (when present).
  Empty state: *"Everything looks healthy today."*

## 2. The 5 real signal types (and 2 deliberately omitted)

Every signal is derived from data an existing, already-real Decision OS/AF source already produces —
nothing here computes a new intelligence layer.

| Type | Fires when | Severity | Source |
| --- | --- | --- | --- |
| `draft_approaching` | A real `LeagueSettings.draftDateUtc` falls within 14 days (AF-native leagues only) | high ≤3d, medium 4–7d, low 8–14d | `league_settings_draft_date` |
| `league_context_incomplete` | League Context's `financialStatus` is `UNKNOWN` | low | `league_context` |
| `low_league_health` | League health engine's `overallStatus` is `watch`/`at_risk`/`critical` | medium/high/critical | `league_health_engine` |
| `high_league_health` | `overallStatus` is `excellent` (a deliberately strict threshold — "healthy" alone doesn't fire this, to avoid flooding a multi-league queue with routine-positive noise) | informational | `league_health_engine` |
| `league_requires_review` | One signal per Mission Control `recommendedActions` entry (already-deduplicated urgent/standard alerts from the health engine's own threshold rules — abandoned teams, unresolved disputes, inactive-manager rate) | urgent → high, standard → medium | `league_health_engine` |

**Deliberately NOT built**: "Trade Activity Change" and "Waiver Activity Change" (both originally
suggested). Neither has a real data source — `LeagueActivityTrendSummary`
(`dashboard-intelligence.ts`) only tracks an AGGREGATE event-count delta across every activity type
combined; no per-type historical trend exists anywhere in this codebase. Claiming "trade activity
increased" from that data would be a fabrication. Omitted per this phase's own instruction ("use only
existing data already available... otherwise omit"), not an oversight.

"League Requires Review" is not a new rule — it's the exact `recommendedActions` behavior OS-B1
already had, upgraded into the new signal shape (severity/explanation/timestamp/id) rather than
discarded.

## 3. Priority model

`SEVERITY_RANK` (large, sparse gaps, room for future finer-grained severities without renumbering):
`critical=500 > high=400 > medium=300 > low=200 > informational=100`. Within an identical score, the
newest `timestamp` sorts first (`Array.prototype.sort` is spec-guaranteed stable since ES2019, so an
exact tie on both score and timestamp preserves the caller's deterministic insertion order — never
random). Capping (20 entries) happens only AFTER the full cross-league comparison, never per-league
during the fetch loop — a genuine fix from OS-B1's own incremental-cap behavior, which could have let
an early low-priority league crowd out a later high-priority one.

For most signal types, `timestamp` is "when Decision OS detected this" (`now`, since no per-signal
historical detection timestamp is tracked anywhere yet). `draft_approaching` is the one exception: its
timestamp is the real, underlying draft date itself.

## 4. Architectural decisions

- **No double-fetch.** `commissionerCommandCenter.ts` deliberately does NOT call the standalone
  `resolveAttentionQueueSnapshot` — that would fetch `MissionControlSnapshot` a second time per league
  on the same Commissioner Hub page load. It calls the pure `deriveLeagueAttentionSignals` directly,
  reusing the snapshot already in hand. It DOES reuse `attentionQueue.ts`'s small
  `loadUpcomingDraftDates` batched lookup (not a duplicate of anything expensive) and adds a genuinely
  new per-league League Context fetch (not previously fetched by this composition).
- **Independent signal sources survive an unavailable league.** A league whose Mission Control health
  is unavailable (`leagueHealth.available === false`) can still surface `draft_approaching` and
  `league_context_incomplete` signals — those come from independent tables (`LeagueSettings`,
  `DecisionOsLeagueContext`), not from the health engine. A freshly created AF-native league with zero
  activity but a real draft date scheduled is exactly the case this matters for.
- **No fabricated split of `explanation` vs. `recommendedAction`.** `league_requires_review`'s
  `recommendedAction` is `null` — the health engine's own alert messages (e.g. "URGENT: Unresolved
  disputes accumulating. Commissioner action required.") already read as complete actionable
  statements; splitting them into a separate paraphrased "action" field would fabricate a distinction
  that doesn't exist in the source data. `high_league_health`'s `recommendedAction` is also `null` —
  there is genuinely nothing to do.
- **Provider-agnostic, id-only, unchanged from every other Decision OS output.** No signal carries a
  league display name. `leagueNameById` is zipped on by the UI layer, the same convention every sibling
  Commissioner OS component already uses.

## 5. Verification

- **39 new tests**: 28 pure-function tests (`attention-signals.test.ts` — every signal type's real-data
  gate, severity mapping, ordering/stability, multi-signal aggregation, provider-agnostic contract) + 7
  resolver tests (`attention-queue-resolver.test.ts` — empty-list degradation, multi-league aggregation,
  per-league failure isolation, provider-agnostic output, `loadUpcomingDraftDates`'s own degradation) +
  4 new composition tests (`commissioner-command-center-composition.test.ts` — league-context-incomplete
  derivation, draft-approaching derivation, signals surviving an unavailable league, cross-league
  capping). `__tests__/decision-os` went from 2819 → **2858/2858 passing**; combined with the
  unchanged 10 OS-B1 wiring tests, **2868/2868 passing**, zero regressions anywhere.
- **158/158 baseline typecheck errors unchanged, zero new errors** — confirmed via a full
  `tsc --noEmit` run; none of the pre-existing errors touch any OS-B2 file.
- **Live browser verification**: not run this phase — the underlying data path (Mission Control,
  League Context, `LeagueSettings`) was already live-verified in Phase E/OS-A3/OS-B1, and this phase
  adds no new I/O boundary beyond what those phases already proved works against the real Phase E
  non-prod database. The same JS-execution-on-localhost sandbox restriction carried since Phase E still
  blocks a full authenticated visual render of a *populated* queue — tracked as the same open item
  OS-B1 already logged, not a new gap this phase introduced.

## 6. Boundaries honored

Did not implement: email/push notifications, Daily Brief, LeagueSafe integration, any new database
schema, any new provider integration, any AI-generated signal, or a placeholder/fabricated signal type.

## 7. Recommended next phase

**OS-B3 — Notification Engine.** `CommissionerAttentionQueue.tsx` and `DecisionOsAttentionSignal`
(especially its deterministic `id`, useful for "have I already notified on this?" dedup) were built
with this consumer in mind from the start. `resolveAttentionQueueSnapshot` (`attentionQueue.ts`) is
already the standalone entry point a notification job would call. After that: OS-B4 (Daily Brief digest).
