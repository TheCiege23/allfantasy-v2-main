# Manager DNA De-duplication — Phase 2G: Volume Check + Lineup-History Scope

**Status:** Local analysis + one new test file. No table implemented. No consumer migrated. No `lib/manager-dna.ts` change. No database connection made in this session (see "Methodology" below — a live staging query was considered and explicitly declined by the user in favor of local analysis).
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_MANAGER_DNA_PHASE2F_READINESS_AFTER_REDRAFT_PORT.md`, Phase 2F commit `20e86f5b2`

## TL;DR

**Both Phase 2G blockers are now precisely characterized, and the picture is more nuanced than "just needs more data."** The threshold-sensitivity sweep (real, measured, not estimated) shows trade activity *can* cross into a real identity at high-enough volume (~1.56 trades/week), but free-agent roster activity *never* does, at any volume tested — because the honest `week: null` metadata Phase 2E had to use (the redraft schema has no week column) makes those events invisible to every lineup-based pattern detector, not just "less informative." That's the concrete case for the lineup-history table scoped in §2. Combined with the still-thin real activity evidence available (§1), the verdict is unchanged from Phase 2F: **NO-GO for AI Coach**, but the path to GO is now sharper.

## Methodology note

The task offered a live, read-only staging query (reusing `.env.staging`'s already-present, non-production Neon credentials — the same host `ADR_F5_10_STAGING_VERIFICATION.md` used) as one option for the volume check. **I asked the user which approach to take before touching any live database, since that's a real external system regardless of how "safe" the read-only query would have been.** The user chose local-only analysis. Everything in §1 is therefore built from (a) a new local sensitivity-analysis test measuring the real Phase 6 DNA classifier code against synthetic volumes, and (b) the existing, already-documented `ADR_F5_10` staging snapshot (2026-06-30) — no new database access occurred.

## 1. Volume check — do real managers cross Phase 6 DNA's thresholds?

### 1a. What the classifiers actually require (measured, not estimated)

New test file: `__tests__/decision-os/phase6/manager-dna-threshold-sensitivity.test.ts` (7 tests). Sweeps a range of activity volumes through the real, unmodified pipeline (same mocking approach as Phase 2F's measurement) to find the exact minimum volume needed per signal type, over the default 90-day lookback (`INTELLIGENCE_LOOKBACK_DAYS`, ~12.86 weeks):

| Signal | Volume tested | Result |
|---|---|---|
| Redraft trades | 0 | `transactionStyle: 'passive'`, `primaryIdentity: 'unknown'` (baseline) |
| Redraft trades | 2 (~0.16/week) | `transactionStyle` already flips to `'trade_dominant'` — identity still `'unknown'` |
| Redraft trades | 15 (~1.17/week) | Still `'unknown'` |
| Redraft trades | **20 (~1.56/week)** | **First volume tested that crosses into a real identity: `'serial_trader'`, confidence 0.58** |
| Free-agent roster adds | 6 (~0.47/week) | `decisionStyle: 'decisive'` (baseline) |
| Free-agent roster adds | 7 (~0.54/week) | `decisionStyle` flips to `'methodical'` |
| Free-agent roster adds | **20 (~1.56/week) — the max tested** | **STILL `'unknown'`, confidence 0 — no volume of free-agent-only activity ever crosses a classifier threshold** |

**The free-agent finding is new and important.** Tracing why: `mapRedraftRosterPlayerToLineupSavedEvent` (Phase 2E) honestly sets `metadata.week: null` — `RedraftRosterPlayer` has no week/season columns to source a real value from. `lib/decision-os/phase6/patterns/patterns.ts`'s lineup-based pattern detectors explicitly skip any `lineup_saved` event with `week === null` (confirmed by reading the source — e.g. its window-building logic does `if (week === null) continue`). So free-agent-derived events can shift Phase 5.2-level aggregate rates (which is why `decisionStyle` moves) but can **never** produce a Phase 6.1 pattern, and therefore can never feed the pattern-gated classifiers (`set_and_forget`, `reactive_manager`, `indecisive_tinkerer`) — regardless of how much free-agent activity a manager generates. This is not a "needs more data" gap; it's a "the data literally cannot reach this code path" gap, and it's exactly what §2's lineup-history table would fix.

### 1b. What real volume actually looks like (best available evidence)

No fresh real-count data was gathered this phase (per the methodology note above). The best available evidence remains `ADR_F5_10_STAGING_VERIFICATION.md`'s 2026-06-30 snapshot: **3 `waiver_claims` rows total, across all of staging, concentrated in one league (`s3b-nfl-faab`) and one user (`s3b-member-user`)**; 0 `af_league_trades`. That snapshot predates the Phase 2E redraft tables entirely, so it says nothing directly about `RedraftTradeProposal`/`RedraftRosterPlayer` volumes — but it is the only first-hand evidence of real transactional activity levels in this product that exists anywhere in this repo, and it is dramatically below the ~20-trades/90-days (~1.56/week) level this phase found necessary to cross a trade-based threshold.

**Honest conclusion: real managers likely do NOT cross these thresholds today, based on the only available (if dated and pre-redraft-port) real activity evidence.** This is not certain — the `ADR_F5_10` snapshot measured a small, possibly unrepresentative staging seed, not production-scale usage, and it predates the tables this phase's sweep is about. But it's the only real signal available without either production access (forbidden) or a fresh staging query (declined this session), and it points the same direction as the sensitivity sweep's headline number: the volume needed is high relative to the one real data point we have.

## 2. Redraft lineup-save history table — scope only, not implemented

### 2a. Proposed schema

Modeled directly on the existing `AfRosterMoveHistory` (the table Phase 6 DNA's port already reads for the Af-table product), substituting the redraft-specific foreign keys:

```prisma
model RedraftRosterMoveHistory {
  id          String        @id @default(cuid())
  leagueId    String
  rosterId    String
  seasonId    String
  season      Int
  week        Int
  actorUserId String?       @db.VarChar(128)
  source      String        @db.VarChar(32)   // 'user' | 'commissioner' | 'ai_apply' | 'system'
  moveSummary String?       @db.VarChar(512)
  beforeHash  String?       @db.VarChar(64)
  afterHash   String?       @db.VarChar(64)
  metadata    Json?
  createdAt   DateTime      @default(now())
  league      League        @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  roster      RedraftRoster @relation(fields: [rosterId], references: [id], onDelete: Cascade)
  season      RedraftSeason @relation(fields: [seasonId], references: [id], onDelete: Cascade)

  @@index([leagueId, rosterId, createdAt])
  @@index([leagueId, seasonId, week])
  @@map("redraft_roster_move_history")
}
```

Notes:
- `week`/`season` are real integers here, unlike the free-agent-only signal Phase 2E had to leave null — this directly closes the §1a gap.
- `beforeHash`/`afterHash` mirror `AfRosterMoveHistory`'s existing dedup/audit convention (a hash of the roster's slot assignments before/after the move) rather than inventing a new pattern.
- `source: 'ai_apply'` is new relative to `AfRosterMoveHistory`'s vocabulary, since the redraft product has a distinct AI-apply-lineup endpoint (`app/api/leagues/[leagueId]/roster/ai-apply-lineup/route.ts` — note: that route currently writes to the *other*, Af-table lineup system, not `RedraftRoster`; confirming whether redraft has an equivalent AI-apply path is part of the scoping work below, not assumed here).

### 2b. Write points

The one confirmed, real write point: `app/api/redraft/roster/route.ts`'s `PATCH` handler (the lineup-save endpoint), specifically the transaction at lines 546–551:

```ts
await prisma.$transaction(
  body.moves.map((m) =>
    prisma.redraftRosterPlayer.updateMany({
      where: { rosterId: roster.id, playerId: m.playerId, droppedAt: null },
      data: { slotType: m.toSlot },
    }),
  ),
)
```

This transaction already has, in scope, everything a `RedraftRosterMoveHistory` row would need: `roster.leagueId`, `roster.id`, `roster.season.id`/`roster.season.season`, a real computed `week` (line ~508: `const week = Math.max(1, Math.floor(Number(body.week ?? roster.season.currentWeek ?? 1) || 1))`), and the authenticated `userId`. **Adding a history-row insert to this exact transaction would give it a genuinely real, non-null `week` value — the exact thing missing from Phase 2E's free-agent-only signal.** No new week-resolution logic would be needed; the value already exists at this call site, it's just not persisted anywhere today.

A second candidate write point noted but not confirmed in this phase: whether the redraft product has its own AI-apply-lineup equivalent (distinct from `app/api/leagues/[leagueId]/roster/ai-apply-lineup/route.ts`, which is the Af-table system's route, not redraft's). If one exists, it would need the same instrumentation. This should be confirmed as an early step of implementation, not assumed either way here.

### 2c. Migration risks

- **Schema migration on a live, actively-written table family.** `RedraftRoster`/`RedraftRosterPlayer` are the real, live redraft product's core data — adding a new related table is additive (a new table, no columns added to existing ones) and should be low-risk as a migration, but the write-point change (adding an insert inside the PATCH handler's transaction) touches a live, high-traffic endpoint. Any bug there risks breaking real lineup saves, not just DNA quality — this needs its own careful review and staged rollout, not a "quick win."
- **Volume growth.** Every lineup save currently only updates existing rows (`updateMany`); adding a history table means every save now also *inserts* a row, for every league, every week. At redraft-product scale this could be a meaningfully larger table than `AfRosterMoveHistory` ever became (since the Af-table product's lineup-save feature appears far less used, per the sparse staging snapshot). Retention/pruning policy should be scoped alongside the table, not left implicit.
- **Backfill is not possible.** Historical lineup saves that already happened were never recorded — there is no way to retroactively populate this table for past weeks. Phase 6 DNA would only see lineup-pattern signal accumulate from the day this ships forward, meaning even after implementation, there's a real ramp-up period before there's enough historical depth for pattern detection (which typically needs multiple weeks of history to detect a "streak").
- **Double-instrumentation risk.** If a redraft AI-apply-lineup equivalent exists and isn't found/instrumented at the same time, DNA would see a systematically incomplete lineup-management picture (manual saves only, missing AI-assisted ones) — a new, subtler honesty gap distinct from the one being fixed.

### 2d. How this would improve Phase 6 DNA

Directly closes the §1a finding: once `lineup_saved` events sourced from real redraft lineup saves carry a real `week`, they become visible to `lib/decision-os/phase6/patterns/patterns.ts`'s lineup-based pattern detectors for the first time ever, for the first time enabling:
- `conservative_roster_pattern` (streaks of zero-change weeks) → feeds `set_and_forget` and `risk_averse` classification, currently unreachable for any redraft manager regardless of real behavior.
- `repeated_lineup_indecision` (3+ saves in a week) and `matchup_overreaction`/`bench_regret_repetition` → feed `reactive_manager`, `indecisive_tinkerer`, and `decisionStyle: 'reactive'`/`'indecisive'`, all currently unreachable the same way.

This is a strictly additive improvement to Phase 6 DNA's coverage — it does not change any existing behavior for the free-agent, trade, or waiver signals already wired in Phase 2E.

## 3. Remaining blocker list (updated)

1. **No fresh real-volume evidence for the redraft-specific tables** (§1b) — the sensitivity thresholds are now precisely known; what real managers actually generate is still not measured post-Phase-2E. Closeable with a staging query (declined this session) or a longer local-inference exercise using product config bounds (not attempted here).
2. **Lineup-management activity structurally invisible** (§1a/§2) — now fully scoped (schema, write point, risks) but not implemented. This is real engineering work, not a data question.
3. **Draft events still don't map to per-manager stats** (carried forward from `ADR_F5_10`, unchanged by any phase in this workstream so far) — unresolved, out of scope again this phase.
4. **Legacy `lib/manager-dna.ts`'s own narrow coverage** (Sleeper-linkage + one-time dynasty-import trades) is unchanged and remains a separate, un-migrated system — not addressed by closing canonical's gaps.

## 4. Migration risk rating and go/no-go

**Unchanged from Phase 2F: Medium risk, NO-GO for AI Coach.** Nothing in this phase closes a blocker — it precisely characterizes both remaining ones, converting "not enough data, vaguely" into two concrete, independently schedulable pieces of work (a staging measurement, and a scoped-but-real schema change). That's real progress toward a future GO, not a change in the verdict today.

## 5. Phase 2H implementation prompt

> Phase 2H should pick ONE of the two Phase 2G-scoped workstreams to actually close — not both at once, and not a consumer migration:
>
> **Option A (faster, data-only):** Get the real staging volume measurement that Phase 2G explicitly deferred. With user sign-off to connect to the non-production staging database (`.env.staging`, host `ep-winter-salad`, the same one `ADR_F5_10` already used), run read-only COUNT queries against `redraft_trade_proposals` and `redraft_roster_players` (grouped by `acquisitionType`), scoped per active league/manager over a realistic lookback window. Compare the real distribution against this phase's measured thresholds (~20 trades/90 days for `serial_trader`, and note that free-agent volume alone can never cross a threshold regardless of count). This directly and finally answers §1's open question.
>
> **Option B (slower, real engineering):** Implement the `RedraftRosterMoveHistory` table scoped in §2 — schema migration, the write-point instrumentation in `app/api/redraft/roster/route.ts`'s `PATCH` handler, confirmation of whether a redraft AI-apply-lineup route exists and needs the same instrumentation, and a new Phase 5.1-style port loader + mapper (mirroring the existing `RawRosterMoveRow`/`mapRosterMoveToLineupSavedEvent` pattern exactly, this time with real `week`/`season` values) feeding into `dashboard-intelligence.ts`'s `loadLeagueEvents()` alongside the existing six sources. This is real schema + live-endpoint work and needs its own careful review, staged rollout, and retention-policy decision per §2c — it should not be done as a quick addition inside an otherwise-unrelated change.
>
> Do not touch AI Coach, Trade Analyzer, Trade Proposal Generator, Chimmy, or `lib/manager-dna.ts` in either option. Re-run the readiness check once whichever option is chosen is complete.

## Files changed in this phase

- `__tests__/decision-os/phase6/manager-dna-threshold-sensitivity.test.ts` (new — 7 tests, the volume sensitivity sweep)
- `docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md` (this document, new)

No other file was created, modified, or deleted. No database was queried or connected to.
