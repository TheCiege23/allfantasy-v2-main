# Fantasy OS — V8.2 Historical Evidence Expansion & Incremental Sync

**Branch:** `g15-event-foundation` · **Scope:** internal validation tooling (`lib/validation-cohort/`).
No customer-facing OS change, no Decision OS logic change, no presentation change, no backend tenancy.

> **Success condition met:** a restartable, provider-neutral historical evidence corpus containing real
> rosters, matchups, transactions, drafts, and activity evidence, incrementally synchronizable and
> consumable by the existing Fantasy OS — with no speculative Decision OS tuning.

---

## 1. What was built (reuse, not duplicate — Part 1)

V8.1 persisted league *summaries*; V8.2 expands to the full evidence corpus, extending the SAME pipeline
(no second importer). New `lib/validation-cohort/evidence/`:

| File | Role |
| --- | --- |
| `contracts.ts` | Provider-neutral evidence types + the five-way `CategoryStatus` (unavailable/not-fetched/partial/empty/data) |
| `fetchEvidence.ts` | Bounded fetch + normalization of rosters, standings, matchups, transactions (+FAAB), drafts, picks, postseason brackets; fetch-time transaction dedup by provider id |
| `activityEvidence.ts` | Pure activity derivation (counts/frequency/participation/churn/FAAB/inactivity) — evidence only, no inference |
| `decisionOsReadModel.ts` | Read-compat mapping the corpus → the seven OS seams |

The persist orchestrator gained `importEvidence` (attaches the bundle + derived activity, coverage flags
from the bundle status); the store record gained `bundle`/`activity`; the integrity checker gained
severity classification + bundle-level checks; the CLI `--persist` gained `--importEvidence`.

## 2. Evidence categories (Parts 2/4)

**Fetch + persist real data today:** users/membership, roster composition, standings/record, weekly
matchups, completed trades, waivers, free-agent activity, FAAB from completed waiver bids, drafts + draft
metadata + picks, postseason brackets (winners/losers), previous-league continuity.

Every category carries an honest status; a genuinely empty week is `empty`, never a failure. Raw provider
ids (owner_id, draft_id, transaction_id, player_id) stay in ingestion only — the persisted bundle uses
league-local roster slot integers and counts. **Remaining typed-but-secondary:** deeper
lineup-composition and per-player detail are intentionally out of the neutral model.

## 3. Provider-neutral normalization (Part 3)

Deterministic facts only: transaction counts/frequency, participation, roster churn, lineup-participation
rate (points>0 share), trade/waiver/free-agent activity, completed FAAB spend, draft participation, and
inactivity. **Never inferred:** intent, personality, skill, collusion, tanking, or trade-acceptance
probability. `null` means "not derivable", never a fabricated value.

## 4. Incremental sync + restart (Parts 4/5)

Completed seasons are immutable (imported once; the file store refuses to overwrite them); the current
season refreshes each run. The bundle records checkpoints (`latestMatchupWeek`, `latestTransactionWeek`,
`draftComplete`). Bounded concurrency, fetch-time transaction dedup, retries/timeouts (from the V7.1
client), idempotent writes, resumability, overlap prevention, partial-failure isolation, and
last-successful-sync tracking all hold. The integrity checker classifies findings by severity —
informational-coverage-gap / partial-import / recoverable-sync-defect / corrupt-persisted-evidence /
provider-limitation — so a provider limitation is never reported as an application defect.

## 5. Two real bugs the live smoke caught (both in tooling, not Decision OS)

Running against real `theciege24` data surfaced two issues, both fixed:
1. **Unsound duplicate-transaction check.** A normalized-shape duplicate check (type/week/roster/counts)
   false-positived on real data — the neutral model omits player ids, so two genuinely-distinct same-shape
   transactions are indistinguishable. Fixed by moving dedup to **fetch time** (by provider
   `transaction_id`, ingestion-only) and removing the unsound normalized check. `recoverable-sync-defect`
   findings: 2 → 0.
2. **Over-broad leak-scan regex** (matched long camelCase field names). Re-scanned with real id patterns —
   **no provider identifier leaks** in the store.

## 6. Decision OS compatibility (Parts 6/7)

The expanded corpus feeds **all seven** Operating Systems (verified fixture + live-smoke): Commissioner/
League via the existing pure health seam (`probeLeague` on the neutral facts, unchanged); Manager via
roster+matchup context; Trade/Waiver via activity evidence (+FAAB); Draft via draft participation;
Platform via corpus-level aggregation. **No incompatibility, no missing contract, no Decision OS change,
no tuning.** Live smoke `decisionOsCompat` = all seven `true`.

## 7. Live smoke scope + limits (Part 8)

`--persist --importEvidence --username=theciege24 --seasons=2024,2023 --currentSeason=2024
--maxLeaguesPerAccount=3 --evidenceWeeks=4`: 3 real leagues, 0 partial failures, real evidence (e.g. a
league with 44 waivers, 2517 FAAB spent, 91.6% lineup participation, draft complete/18 rosters). Integrity
= 3 informational coverage gaps (capped-import un-imported priors), 0 corrupt. This is **bounded tooling
verification on one public account** — NOT a diverse customer cohort, and NOT full Decision OS validation.

## 8. Tests & typecheck (Part 10)

`__tests__/validation-cohort/evidence.test.ts` (8): normalization, five-way status fetch, activity
derivation, integrity severity + bundle checks, seven-OS read-compat. Full validation-cohort suite +
gateway + white-label + executive-viz: **188/188**, 0 failures. Typecheck **158 (baseline preserved)**, 0
errors in touched files.

## 9. Remaining before diverse-cohort validation

Run the **real supplied username cohort** (still the one outstanding input) through
`--persist --importEvidence`; add the Prisma-backed store for scale; and, if justified, extend the neutral
model for deeper lineup/per-player evidence. No fabricated cohort findings are produced here.
