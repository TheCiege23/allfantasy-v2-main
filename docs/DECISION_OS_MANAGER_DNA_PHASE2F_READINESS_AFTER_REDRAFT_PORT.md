# Manager DNA De-duplication — Phase 2F Readiness Verification (Post Redraft Port)

**Status:** Verification + one new measurement test file. No consumer migrated. No `lib/manager-dna.ts` change. No database connection made in this session.
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md`, `docs/DECISION_OS_MANAGER_DNA_PHASE2C_PARITY_FINDINGS.md`, Phase 2E commit `cb5570603`

## TL;DR

**Meaningful, measured improvement — but still NO-GO for AI Coach.** The Phase 2E port extension genuinely works: a realistic combined-activity scenario that would have produced `'unknown'` (confidence 0, completeness 50) before Phase 2E now produces `'committed_grinder'` (confidence 0.55, completeness 95) after it — measured empirically in this session, not asserted. That closes the structural gap Phase 2D found. What's still missing is **real-world volume evidence**: this measurement used synthetic activity levels I chose to safely cross known classifier thresholds, not measured medians from actual redraft leagues, and lineup-management activity (as opposed to free-agent roster churn) remains completely invisible to Phase 6 DNA regardless of this phase's work. Both are closeable in a scoped Phase 2G, detailed below — this is not a "wait indefinitely" verdict.

## 1. Verify the new redraft loaders are actually in the live composition path

Confirmed via direct inspection of the current, committed code (not memory of the Phase 2E summary):

```
$ grep -n "loadRedraftTradeRows\|loadRedraftRosterPlayerRows\|mapRedraftTradesToEvents\|mapRedraftRosterPlayersToEvents" lib/decision-os/dashboard-intelligence.ts
40:  loadRedraftTradeRows,
41:  loadRedraftRosterPlayerRows,
48:  mapRedraftTradesToEvents,
49:  mapRedraftRosterPlayersToEvents,
97:      loadRedraftTradeRows(leagueId, since),
98:      loadRedraftRosterPlayerRows(leagueId, since),
105:    ...mapRedraftTradesToEvents(redraftTradeRows),
106:    ...mapRedraftRosterPlayersToEvents(redraftRosterPlayerRows),
```

`loadLeagueEvents()` inside `resolveManagerIntelligencePayload` — the one function reachable from the one live route that runs the full Phase 5→6.1→6.2 pipeline — composes all six sources (four original + two new) into a single `Promise.all`. Confirmed the route:

```
app/api/decision-os/manager-intelligence/route.ts:4:import { resolveManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
app/api/decision-os/manager-intelligence/route.ts:25:  const payload = await resolveManagerIntelligencePayload({ leagueId, managerId: userId })
```

is the only consumer of `resolveManagerIntelligencePayload` in the repo. **The wiring is real and live**, not merely present as unused library code.

(`lib/decision-os/behavioral/api/real-data-provider.ts` — the separate Phase 5.8 provider behind the env-gated `/api/v1/intelligence/*` routes — was deliberately left untouched in Phase 2E and remains so; it only reaches Phase 5.4 behavioral intelligence and never runs Phase 6 DNA, so it's out of scope for this whole workstream.)

## 2. Verify the new loaders fail safely

`resolveManagerIntelligencePayload`'s entire body is one `try`/`catch` that returns `{ managerDna: null, recommendations: null }` on any failure — this was true before Phase 2E and applies unchanged to the two new loaders, since they're just two more entries in the same `Promise.all`. Re-ran the existing Phase 2E regression test proving this specifically for the new sources:

```
__tests__/decision-os/dashboard-intelligence-pipeline.test.ts
  ✓ is degraded-safe when specifically the NEW redraft loaders fail (missing redraft data fails safely)
```

Also re-ran the full `behavioral-redraft-port-loaders.test.ts` suite (7 tests, mocked Prisma client) proving both loaders return `[]` — not throw — for leagues with zero matching rows. All green, no changes needed.

## 3. Measure whether real redraft activity now produces fewer `'unknown'` profiles

New test file this phase: `__tests__/decision-os/phase6/manager-dna-real-data-readiness-scenarios.test.ts` (5 tests). Unlike Phase 2E's tests (which prove the mechanism works), this file measures the **actual before/after delta** by running the same real, unmodified pipeline twice per scenario — once with the two new loaders mocked empty (simulating the exact pre-Phase-2E composition) and once with real fixture data active — against identical underlying activity.

| Scenario | Before (pre-Phase-2E composition) | After (Phase 2E active) |
|---|---|---|
| Active redraft trader, 8 trades, zero Af*/waiver data | `transactionStyle: 'passive'`, `primaryIdentity: 'unknown'` | `transactionStyle: 'trade_dominant'` |
| Free-agent roster tinkerer, 10 free-agent adds | `decisionStyle: 'decisive'` (default) | `decisionStyle: 'methodical'` |
| **Combined: 6 trades + 8 free-agent adds, zero Af*/waiver data** | `primaryIdentity: 'unknown'`, `confidence: 0`, `completeness: 50` (measured directly, see below) | `primaryIdentity: 'committed_grinder'`, `confidence: 0.55`, `completeness: 95`, `warnings: []` (measured directly) |
| Control: true zero activity across every source | identical to after | identical to before — proves no fabrication |
| Control: real waiver-only activity (no redraft data) | identical to after | proves the extension changes nothing when there's nothing new to see |

The combined-scenario numbers were captured with a forced-failure diagnostic assertion to read the real object rather than asserting a hand-guessed value (the same discipline used in every prior phase of this workstream) — both the "before" and "after" figures above are actual `resolveManagerIntelligencePayload` output, not derived.

**What this proves:** the mechanism genuinely works — real redraft trade and free-agent-roster data, once visible, is enough to flip a manager from `'unknown'` to a specific, evidence-backed identity with high completeness and zero warnings.

**What this does NOT prove:** that *typical* real redraft managers generate 6+ trades and 8+ free-agent adds within a 90-day window. I chose those volumes because I could verify from reading `dna.ts`'s classifier thresholds (`deriveTransactionStyle`'s `TRANSACTION_ACTIVE_RATE = 0.15`/week, `deriveDecisionStyle`'s `< 0.5`/week cutoff) that they'd safely cross the relevant lines — not because I measured what real leagues actually look like. That's the one piece of evidence still missing, and it can't be produced without either real staging/production data (out of scope here, same constraint as Phase 2D) or a domain judgment call from someone who knows typical redraft league activity levels.

## 4. Remaining gaps versus legacy `lib/manager-dna.ts`

Carrying forward and updating the Phase 2D comparison now that trades and free-agent roster activity are real:

| Dimension | Legacy `lib/manager-dna.ts` | Canonical Phase 6 DNA (post Phase 2E) |
|---|---|---|
| Trades | Only leagues that completed a one-time dynasty-import normalization (`lib/dynasty-import/normalize-historical.ts`). Zero coverage for native or non-dynasty leagues. | **Real, live** for any redraft league via `RedraftTradeProposal`. Better managerId attribution than legacy ever had (both proposer and receiver resolved via a real join; legacy's `AfLeagueTrade` mapper and its own trade history model don't attribute the receiver at all). |
| Waivers | Live Sleeper API call, requires Sleeper linkage. No coverage for native leagues. | **Real, live** for any redraft league via `WaiverClaim` — unaffected by this phase, already real before Phase 2E. |
| Lineup / roster management | Not modeled at all — legacy has no lineup signal in `DNAMetrics`. | **Partial and narrow.** Only `acquisitionType === 'free_agent'` roster additions are visible — genuine lineup start/bench management is still completely invisible, because (confirmed in Phase 2D) `app/api/redraft/roster/route.ts`'s lineup-save handler overwrites `slotType` in place with **no timestamp at all**. A manager who diligently sets their lineup every week but rarely trades or picks up free agents can still look inactive to Phase 6 DNA today. This is the single largest remaining gap and it is architectural (no data exists to read), not a port-composition problem this phase could have fixed. |
| Draft | Not modeled. | Real (`DraftSession`/`DraftPick` exist and are populated — confirmed 39 sessions on staging per `ADR_F5_10`), but per that same ADR, draft events still don't map to per-manager stats due to a missing roster→user join at the port layer. Unresolved, unchanged by this phase. |
| Coverage for native (non-Sleeper) leagues | **Zero** — no data source exists for these leagues at all. | **Now meaningfully real** for trades and waivers; still gapped on lineup management (above). |
| Failure-mode honesty | Silently defaults to a specific, confident-sounding archetype (`'The Architect'`) for zero-signal managers (Phase 2C finding) — a caller has to separately check `confidence` to notice. | Explicit `'unknown'` + `warnings[]` when data is insufficient. Strictly more honest, unchanged by this phase. |

**Net position:** for native redraft leagues specifically — the primary product surface — canonical is now clearly ahead of legacy on trade and waiver coverage (legacy has zero data source there at all), and behind only on lineup-management signal, which legacy never modeled either. For Sleeper-linked leagues, legacy may still have fresher/more complete waiver data (live API vs. batch port read) and trade history if dynasty-import ran — this session did not attempt to quantify that comparison further, as it wasn't the point of this phase.

## 5. Migration risk rating and go/no-go for AI Coach

**Risk rating: Medium (down from High in Phase 2D).** The structural blocker Phase 2D identified — Phase 6 DNA's port reading tables the live redraft product doesn't write to — is closed. What remains is a data-volume question and one persistent, honestly-scoped blind spot, not an architecture problem.

**Go/no-go: NO-GO for AI Coach, for now.** Two concrete, closeable reasons:

1. **No real-world volume evidence.** This phase measured that the mechanism works at activity levels I chose to safely cross known thresholds — not what real redraft managers' actual trade/waiver/free-agent cadence looks like. If real managers typically generate far less than 6 trades / 8 free-agent adds per 90 days, most real profiles could still land on `'unknown'` even after this fix, and I have no basis to claim otherwise without either a real data snapshot or a domain judgment call.
2. **Lineup-management activity is still completely invisible**, and that's arguably one of the things AI Coach most wants to speak to ("based on how you've been setting your lineup..."). A manager who is genuinely diligent about lineups but quiet on trades/waivers would still risk being under-profiled today.

Neither of these is a "wait an indeterminate amount of time" problem — both have a scoped next step (Phase 2G, below).

## 6. Phase 2G implementation prompt

Since this is a **NO-GO**, Phase 2G should close the two gaps identified above — not migrate a consumer:

> Implement Phase 2G per `docs/DECISION_OS_MANAGER_DNA_PHASE2F_READINESS_AFTER_REDRAFT_PORT.md` §5. Two independent, either-order workstreams:
>
> **(a) Real-volume evidence.** Using the same non-prod, in-process verification pattern `ADR_F5_10_STAGING_VERIFICATION.md` already established (staging Neon branch only, never `ep-curly-block`, no writes), measure real `RedraftTradeProposal` and `RedraftRosterPlayer` (`acquisitionType='free_agent'`) row counts per active manager over a realistic lookback window, and report what fraction of real, active redraft managers would cross the classifier thresholds this phase identified (`TRANSACTION_ACTIVE_RATE = 0.15`/week for trades, `< 0.5`/week for lineup edits in `lib/decision-os/phase6/dna/dna.ts`). This directly answers the open question in this document's §3 and §5.
>
> **(b) Lineup-management visibility.** Scope (do not yet implement without further review) what it would take to give Phase 6 DNA a real lineup-save signal for redraft leagues — likely a new persisted history table alongside `RedraftRoster`/`RedraftRosterPlayer`'s slot mutations, written from `app/api/redraft/roster/route.ts`'s existing lineup-save transaction (`prisma.redraftRosterPlayer.updateMany` in that route currently touches only `slotType`, with no timestamp). This is real product/schema work, not just a port change, and should get its own scoping document before implementation — do not build it opportunistically inside a "quick fix."
>
> Do not touch AI Coach, Trade Analyzer, Trade Proposal Generator, Chimmy, or `lib/manager-dna.ts` in either workstream. Re-run this readiness check (or an updated version) once both are addressed before reconsidering any consumer migration.

## Files changed in this phase

- `__tests__/decision-os/phase6/manager-dna-real-data-readiness-scenarios.test.ts` (new — 5 tests, the before/after measurement harness)
- `docs/DECISION_OS_MANAGER_DNA_PHASE2F_READINESS_AFTER_REDRAFT_PORT.md` (this document, new)

No other file was created, modified, or deleted. No database was queried or connected to — all measurement in §3 used mocked Prisma port functions against synthetic, hand-constructed fixture data, exactly as in every prior phase of this workstream.
