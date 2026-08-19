# Phase OS-B3 — Daily Brief Composition Engine

Reframes the recommended sequence after OS-B2: before a Notification Engine with read/dismiss state
(OS-B4) or multi-channel delivery (OS-B5), build the composition layer that decides WHAT gets
delivered. This keeps the eventual Notification Engine thin — it delivers already-composed
information, it never decides what to bundle.

> **Decision OS → Brief/Notification Composition → Delivery Channels**

not

> **Decision OS → Notification Engine (business logic) → Everything else**

## 1. What was built

- **`lib/decision-os/dailyBrief.ts`** — the reusable Daily Brief model. Pure, zero-I/O — `composeDailyBrief(input, now)`
  takes already-resolved Decision OS outputs (an Attention Signal list, per-league trends, and three
  already-aggregated counts) and returns a `DailyBrief`. Never recomputes a health score, a ranking, or
  an Attention Signal — every field is either reused as-is or a straightforward reshaping (sort, filter,
  dedupe, tally) of data the caller already produced.
- **`lib/decision-os/dailyBriefResolver.ts`** — the standalone `resolveDailyBrief(leagueIds, now)` for a
  future consumer with no existing fetched snapshot to compose from (an email digest cron, OS-B4's
  Notification Engine, a mobile client, a Platform OS summary).
- **`components/decision-os/TodaysBriefCard.tsx`** — purely presentational; renders a `DailyBrief` prop.
  No fetch, no state, no derivation.
- **`components/decision-os/CommissionerCommandCenterSection.tsx`** (modified) — composes the brief
  DIRECTLY from the snapshot it already fetches for its other cards (`composeDailyBrief` called with
  `snapshot.attentionQueue`/`snapshot.recentChanges`/etc.), via `useMemo`. Zero additional network
  request. Renders `<TodaysBriefCard>` between the Overview stats and the League Health Ranking.

## 2. The `DailyBrief` shape

| Field | Source | Notes |
| --- | --- | --- |
| `overview.leaguesMonitored` / `.healthyLeagueCount` / `.draftsApproachingCount` | Reused as-is from the caller's input | Never recomputed |
| `overview.leaguesNeedingAttention` | Distinct `leagueId` count across non-informational signals | A tally, not new intelligence — same category as `unavailableLeagueCount` elsewhere in this suite |
| `topPriorityItems` | Top 5 of `sortAttentionSignals(input.signals)` | Same canonical ordering the Attention Queue itself uses |
| `leagueHighlights` | `input.leagueTrends` filtered to `direction !== 'flat'` | "Meaningful activity" = the trend actually moved |
| `positiveHighlights` | `input.signals` filtered to `type === 'high_league_health'` | See below — deliberately the ONLY source |
| `recommendedActions` | Deduplicated, non-null `recommendedAction` values from `topPriorityItems` only | Never a signal outside the top-5 cut, never invented text |
| `isHealthy` | `leaguesNeedingAttention === 0` | |
| `summary` | A deterministic, template-composed sentence | Never AI-generated |

**Positive Highlights deliberately narrow.** This phase's own instructions suggested "healthy leagues,
completed drafts, strong engagement" as examples. Only "healthy leagues" (`high_league_health` signals)
was built. "Completed drafts" has no real, already-computed signal anywhere in this codebase — Mission
Control's `draftPickCount` is an event count within a lookback window, not a "draft finished" flag, and
computing one would require new I/O this phase's own instructions exclude ("consume existing Decision
OS outputs only"). A generic "strong engagement" threshold (e.g. `engagementScore >= 80`) was
considered and rejected — nothing else in this entire Decision OS suite thresholds `engagementScore`
anywhere; inventing a first-ever threshold for it here would be exactly the "recompute a health score"
this phase's own rule prohibits, not a reuse of existing intelligence. Both are documented gaps, not
oversights.

## 3. Priority/composition rules

- `topPriorityItems` is capped at 5 and always re-sorted via the canonical `sortAttentionSignals`
  inside `composeDailyBrief` — it never trusts a caller's ordering.
- `recommendedActions` only ever draws from `topPriorityItems`, never the full signal list — a
  recommendation attached to a signal that didn't make the brief doesn't get surfaced either.
- The empty/fully-healthy case is a real, valid `DailyBrief` (`isHealthy: true`, `summary: "Every league
  looks healthy today."`), never a special-cased error or null state.

## 4. Architectural decisions

- **No double-fetch on the page Commissioner Hub already renders.** `TodaysBriefCard` does not
  self-fetch. `CommissionerCommandCenterSection.tsx` composes the brief from data it already fetched for
  its sibling cards (Overview, League Health Ranking, Attention Queue, Recent Changes) — the same
  "avoid a second Mission Control fetch per league on one page load" discipline OS-B2 already
  established for `commissionerCommandCenter.ts` vs. `attentionQueue.ts`.
- **The standalone `dailyBriefResolver.ts` accepts a real, documented double-fetch tradeoff.** It calls
  `resolveAttentionQueueSnapshot` (reusing OS-B2's signal derivation, never re-deriving it) AND
  separately fetches Mission Control per league for `healthyLeagueCount`/league trends — meaning Mission
  Control is fetched twice within this resolver's own execution. This is accepted because
  `resolveDailyBrief` targets callers with no existing page-load context (a background job), not a
  request already carrying fetched data. It is NOT used by the Commissioner Hub UI for exactly that
  reason.
- **`draftsApproachingCount` is derived from `draft_approaching` signals, not a second query.**
  `resolveAttentionQueueSnapshot`'s own output already applies the real 14-day window
  (`attentionSignals.ts`'s single source of truth for that window) — counting its signals avoids a
  second, independently-drifting count.
- **`dailyBrief.ts` is safe to import into a client component.** Zero I/O, zero server-only imports —
  confirmed by the fact `CommissionerCommandCenterSection.tsx` (a `'use client'` component) already
  imports and calls `composeDailyBrief` directly, with no build/bundle issue.

## 5. Verification

- **30 new tests**: 17 pure-composition tests (`daily-brief.test.ts` — empty/healthy brief, priority
  ordering/capping, recommended-action dedup and cut-off enforcement, positive-highlight source
  restriction, league-highlight flat-filtering, multi-league aggregation, determinism) + 6 resolver
  tests (`daily-brief-resolver.test.ts` — empty-list degradation, signal reuse, healthy-count
  derivation, draft-count derivation, trend collection, per-league failure isolation) + 6 component
  tests (`todays-brief-card.test.tsx` — honest empty render, priority items, recommended actions,
  positive highlights, league highlights, league-id fallback) + 1 new section-wiring test (Today's
  Brief renders from the already-fetched snapshot with zero extra request; the existing
  "renders every module" test gained brief-specific assertions). `__tests__/decision-os` went from
  2868 → **2898/2898 passing**, zero regressions.
- **158/158 baseline typecheck errors unchanged, zero new errors** — confirmed via a full `tsc --noEmit`
  run; the error set is byte-identical to the OS-B2 baseline (diffed directly, not just counted).
- **Live browser verification**: not run this phase — fixture/component-test verification only, which
  this phase's own instructions explicitly accept ("Fixture-based verification is acceptable for UI
  composition"). No new server-side I/O boundary was introduced (the UI composes client-side from data
  already live-verified in OS-B1/OS-B2); the same sandbox JS-execution-on-localhost limitation carried
  since Phase E still blocks a full authenticated visual render.

## 6. Boundaries honored

Did not implement: email delivery, push notifications, notification persistence/read-dismiss state,
background jobs, scheduling, new Decision OS intelligence, or provider-specific behavior. No changes to
Decision OS's health-scoring/ranking/signal-derivation logic — `dailyBrief.ts` only reshapes what those
already produce.

## 7. Recommended next phase

**OS-B4 — Notification Engine.** `resolveDailyBrief` (`dailyBriefResolver.ts`) is the standalone entry
point a notification job would call to get "what should today's notification say" without owning any
composition logic itself — matching this phase's own architecture goal. Read/dismiss state and delivery
channel selection remain OS-B4/OS-B5's job, not built here.
