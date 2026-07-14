# Manager DNA De-duplication — Phase 2D Real-Data Readiness Audit

**Status:** Audit only. No code changed. No AI consumer touched. No `lib/manager-dna.ts` change. No database connection made in this session (see "Methodology" below for why, and what was used instead).
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_MANAGER_DNA_DEDUP_AUDIT.md`, `docs/DECISION_OS_MANAGER_DNA_PHASE2C_PARITY_FINDINGS.md`, Phase 2C commit `ef1daf921`

## TL;DR

**Not safe to migrate any AI consumer yet — and the reason is more specific and more fixable than "not enough data has accrued yet."**

Canonical Phase 6 DNA's real-data pipeline reads from a *different table family* than the one the live redraft product actually writes to for trades and lineup/roster moves. This isn't a sparse-data problem that improves over time — it's a **structural coverage gap**: real redraft trades and lineup saves are, today, invisible to Phase 6 DNA's port layer regardless of how much real activity happens, because they're persisted to different Prisma models than the ones the port reads. Only waiver-claim activity from the real redraft product actually reaches Phase 6 DNA. Legacy `lib/manager-dna.ts` has its own, different narrow-coverage problem (detailed below) — this is not a case of "legacy sees everything, canonical sees nothing." Phase 2E's job is to close the specific table-coverage gap identified below, not to wait longer or add more consumer-migration scaffolding.

## Methodology

This audit combines two evidence sources, neither of which required touching production data:

1. **Static analysis of live route source code** — grepping every real, currently-deployed route that writes trade/waiver/lineup data, to determine exactly which Prisma model each one targets, and comparing that against which models `lib/decision-os/behavioral/port.ts` (Phase 6 DNA's real data source) actually reads. This required no database connection at all.
2. **A previously-completed, already-documented staging data inventory** — `lib/decision-os/behavioral/api/ADR_F5_10_STAGING_VERIFICATION.md`, dated 2026-06-30, which ran the real behavioral-intelligence pipeline in-process against the staging Neon database (`ep-winter-salad` branch) and recorded real row counts. This session did not re-run that query.

**A production database URL is present in this checkout's `.env`/`.env.local` files** (host `ep-curly-block`, which `ADR_F5_10` itself documents as "HARD-REFUSED; never connect"). No script, query, or command in this session connected to it, consistent with the task's "do not require production secrets" constraint and the existing ADR's own safety rule. Nothing in this audit required it.

## 1. Real data source comparison

| | Legacy `lib/manager-dna.ts` | Canonical Phase 6 DNA |
|---|---|---|
| **Trade data source** | Prisma `LeagueTradeHistory` — populated **only** by `lib/dynasty-import/normalize-historical.ts`, a one-time historical-trade import/normalization step for imported dynasty leagues. Native AllFantasy-created leagues and non-dynasty leagues have no rows here at all. | Prisma `AfLeagueTrade` (via `lib/decision-os/behavioral/port.ts`'s `loadLeagueTradeRows`), written only by `lib/league-trade-engine/tradeService.ts`, called from `app/api/leagues/[leagueId]/trades/*`. **This is a different route family and a different Prisma model than the one the live redraft product uses** (`app/api/redraft/trade-proposals/route.ts` writes to `RedraftTradeProposal`/`RedraftTradeAsset` — confirmed by direct grep of that route's own source). Real redraft trades never populate `AfLeagueTrade`. |
| **Waiver data source** | Live Sleeper API call (`getLeagueTransactions(leagueId, week)`, called for every week 1–18) at request time — requires the manager's league to be Sleeper-linked. No local persistence; every legacy DNA computation re-fetches from Sleeper. | Prisma `WaiverClaim` (via `loadWaiverClaimRows`), written by `lib/waiver-wire/claim-service.ts`, which **is** called from the real, live redraft waiver flow (`app/api/redraft/waivers/route.ts`, `app/api/redraft/waiver-runtime/route.ts`). **This is the one domain where the real redraft product's data actually reaches Phase 6 DNA.** |
| **Lineup / roster-move data source** | Not modeled at all — legacy has no lineup/roster-move signal in its `DNAMetrics`. | Prisma `AfRosterMoveHistory` (via `loadRosterMoveRows`), written by `lib/roster-lineup-engine/lineupService.ts` (`recordAfRosterMoveHistory`), called from `app/api/leagues/roster/save/route.ts`. **Again, a different route than the real redraft lineup-save flow** (`app/api/redraft/roster/route.ts` writes to `RedraftRoster`/`RedraftRosterPlayer` — confirmed by direct grep). Real redraft lineup saves never populate `AfRosterMoveHistory`. |
| **Draft data source** | Not modeled at all. | Prisma `DraftSession`/`DraftPick` (via `loadDraftRows`). Per `ADR_F5_10`, staging had 39 real draft sessions — this table **is** populated by real activity. But the same ADR documents that `DraftPick.rosterId` isn't joined to a `userId`, so draft events "contribute to league-level stats but not per-manager stats" — meaning even where the data exists, it doesn't currently feed an individual manager's DNA profile. |
| **Requires a specific integration to have any data at all** | Yes — Sleeper account link (waivers, live) + a completed dynasty-import normalization pass (trades, one-time). No coverage for native, non-Sleeper leagues. | No integration required in principle (native Prisma tables), but see above: the specific tables read belong to a separate/older "generic leagues" engine (`Af*` prefix), not the live redraft product's own tables (`Redraft*` prefix). |

## 2. Which pipeline has better coverage today

**Neither pipeline comprehensively covers the live redraft product** — they have different, mostly non-overlapping gaps, not a simple "one is better" relationship:

- **For a native (non-Sleeper-imported) redraft league:** legacy has **zero** trade coverage (no `LeagueTradeHistory` rows possible — that table only gets populated by the dynasty-import step) and **zero** waiver coverage (no Sleeper league ID to call the API against). Canonical has **zero** trade coverage and **zero** lineup coverage (wrong tables), but **real, live** waiver coverage.
- **For a Sleeper-imported league:** legacy gets real live waiver data (direct Sleeper API) and, if it went through dynasty-import normalization, real historical trade data. Canonical still only gets waiver coverage from the redraft product's own waiver flow (`WaiverClaim`) — Sleeper-imported leagues' *original* Sleeper trade/waiver history does not appear to feed `AfLeagueTrade`/`WaiverClaim` at all (those are native-AllFantasy-action tables, not imported-history tables); this session did not fully trace whether import normalization also back-fills `WaiverClaim`, and that's worth confirming before relying on it.

**Practical takeaway:** for the specific case this task cares about — migrating AI Coach / Trade Analyzer / Trade Proposal Generator for the live redraft product — **canonical's only real signal today is waiver-claim behavior.** Trade behavior and lineup-management behavior, the two dimensions that matter most for exactly the three consumers this migration is meant to eventually serve, are structurally absent from Phase 6 DNA's current data source for real redraft leagues.

## 3. Where Phase 6 DNA goes silent

Given the coverage gap in §1–2, most real redraft managers today would see one of these outcomes from `assembleManagerDna()`:

- **`'unknown'`** (and `formatManagerDnaForPrompt()` returning `''`) whenever a manager's `completeness` falls under `MIN_COMPLETENESS` (20) — very plausible for any manager whose only real signal is a handful of waiver claims, since `computeProfileCompleteness` starts at 100 only when `ManagerSignalInput` is present, and that signal's own `completeness` field (Phase 5.2's `mi.completeness`) is itself computed from the same restricted event set.
- **A misleadingly "inactive"-looking classification** (`ghost_manager`, or `engagementReliability: 'unreliable'`/`'inconsistent'`, or `transactionStyle: 'passive'`) for managers who are genuinely active traders and lineup-setters in the real product, purely because their trade and lineup activity is invisible to the port — **this is a more serious failure mode than silence.** A manager who trades every week and tinkers with their lineup constantly could be classified as passive/inactive, which is the opposite of the truth, not just an honest "we don't know."
- The three-scenario synthetic parity harness from Phase 2C (`docs/DECISION_OS_MANAGER_DNA_PHASE2C_PARITY_FINDINGS.md`) already demonstrated the mechanics of the `'unknown'` fallback in isolation; this phase adds the real-data context for *how often* that fallback would actually fire for real redraft managers — essentially "almost always, for trade and lineup dimensions specifically," per the table-coverage gap above.

## 4. Where legacy overstates confidence

Two distinct issues, one carried over from Phase 2C and one new to this phase:

1. **(Carried over, Phase 2C finding)** Legacy's zero-signal defaults (`patience` defaults to 0.82, `riskTolerance` defaults to 0, when there's no trade history) satisfy `"The Architect"`'s check rather than the true no-match fallback (`"The Balanced GM"`). A manager with *no data at all* gets a specific, confident-reading archetype label; the only honest signal is a separately-computed `confidence` that a caller has to know to check independently.
2. **(New) Legacy has no visibility into whether its own inputs cover this manager at all.** Because legacy silently returns empty arrays/zero counts for leagues with no `LeagueTradeHistory` rows or no Sleeper linkage (rather than surfacing "this league has no trade-import history" or "no Sleeper league ID provided" as an explicit warning, the way `warnings: string[]` does in Phase 6's contract), a native, never-imported redraft league's manager gets exactly the same shape of confident-sounding output (an archetype string, `confidence: 0`) as any other manager — there's no field a caller can check to distinguish "we have real data and it's thin" from "this league has structurally no path to ever have trade data." Canonical's `warnings` array (e.g., `'no_patterns_detected: identity derived from aggregate signals only'`, `'missing_aggregate_signals: identity derived from patterns only'`) is a strictly more honest contract, even though — per §3 — canonical's underlying real coverage for the same manager may be worse in practice today.

## 5. Whether AI Coach can be migrated next

**No — not yet, and not primarily because of a temporary data-sparseness the pipeline will naturally outgrow.** The blocking issue is structural: Phase 6 DNA's real data port reads Prisma tables (`AfLeagueTrade`, `AfRosterMoveHistory`) that the live redraft product's trade and lineup features do not write to (`RedraftTradeProposal`, `RedraftRoster`/`RedraftRosterPlayer` instead). Migrating AI Coach today would mean:

- Trading a legacy formatter that (per Phase 2C findings) sometimes over-claims confidence for a canonical formatter that would go silent (`''`) for nearly every manager on trade/lineup dimensions, and could occasionally mislabel a genuinely active manager as passive/inactive — a regression in perceived personalization quality for the majority of real users, not an improvement.
- This is true **regardless of how long Decision OS's behavioral pipeline has been live** — more elapsed time does not fix a port that reads the wrong tables.

**What would make it safe:** extending the Phase 5.1 port (and its mappers) to also read from the tables the live redraft product actually writes to (`RedraftTradeProposal`/`RedraftTradeAsset` for trades, `RedraftRoster`/`RedraftRosterPlayer` mutation history for lineup moves), re-running the same kind of in-process staging verification `ADR_F5_10` already established a template for, and then re-running this readiness check. That is real, scoped engineering work — Phase 2E, below — not a "wait and see" phase.

## 6. Phase 2E implementation prompt

Since migration is **not** currently safe, Phase 2E should be the coverage-extension prerequisite identified in §5, not a consumer migration:

> Implement Phase 2E per `docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md` §5–§6: extend `lib/decision-os/behavioral/port.ts` with new read-only loader functions (`loadRedraftTradeRows`, `loadRedraftRosterMoveRows` or equivalent) that read from the tables the live redraft product actually writes to — `RedraftTradeProposal`/`RedraftTradeAsset` (trades, mirroring `app/api/redraft/trade-proposals/route.ts`'s writes) and whatever table records `RedraftRoster`/`RedraftRosterPlayer` mutations over time (lineup/roster moves, mirroring `app/api/redraft/roster/route.ts`'s writes — note this may require a new persisted history table if roster mutations aren't currently logged anywhere, which should be confirmed and scoped explicitly before implementation, not assumed). Add corresponding mapper functions (mirroring `lib/decision-os/behavioral/mappers.ts`'s existing `mapLeagueTradesToEvents`/`mapRosterMovesToEvents` pattern) producing the same `BehavioralEvent` shapes Phase 6.1/6.2 already consume unchanged. Do not modify `assemble.ts`, `manager-intelligence.ts`, Phase 6.1, or Phase 6.2 — this is purely a new, additive data source feeding the existing, unchanged pipeline. Add tests proving the new loaders/mappers produce valid `BehavioralEvent`s from realistic `RedraftTradeProposal`/roster-mutation fixtures. Do not touch AI Coach, Trade Analyzer, Trade Proposal Generator, Chimmy, or `lib/manager-dna.ts`. Once this lands, re-run this readiness audit (or an updated version of it) before considering any consumer migration — coverage, not elapsed time, is the gate.

## Files changed in this phase

- `docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md` (this document, new)

No other file was created, modified, or deleted. No database was queried or connected to.
