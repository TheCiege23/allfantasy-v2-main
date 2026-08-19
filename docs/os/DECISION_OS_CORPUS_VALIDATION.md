# Fantasy OS — V8.3 Persisted-Corpus Decision OS Validation

**Branch:** `g15-event-foundation` · **Scope:** internal validation tooling. No customer-facing OS change,
**no Decision OS logic change**, no presentation change, no backend tenancy.

> **Success condition met:** the existing Decision OS was exercised against the persisted provider-neutral
> corpus; its recommendations are traceable to observed evidence; counterfactual fixtures prove
> evidence-responsive behavior; the seven-OS representation is stated honestly; and **zero code changes
> were made to Decision OS** because no reproducible defect was proven.

---

## 1. Part 1 audit — semantic execution vs compatibility (the honest correction)

V8.2 reported "all seven OS compatible." That is a **compatibility boolean** — the evidence *shape* can
feed a seam — and, as this phase demanded, it is **not** proof that the product Decision OS actually runs
over the file corpus. Tracing the real paths:

| Decision OS entry point | Runnable over the file corpus? | Why |
| --- | --- | --- |
| `monitorLeagueHealth` (League/Commissioner health + interventions) | ✅ **real derivation** | Pure function; inputs built from the neutral facts |
| `deriveLeagueAttentionSignals` (attention signals) | ✅ **real derivation** | Pure; inputs are the health output (financial-status/draft-date honestly `UNKNOWN`/`null`) |
| Mission Control, Manager Command Center, Daily Brief, full recommendation composition | ⛔ **not run** | Pure builders, but their inputs are assembled by **DB-backed resolvers** the file corpus does not reconstruct; no compatibility adapter was built (would be speculative) |

So V8.3 validates the two entry points genuinely runnable over the corpus, and is explicit that the
composed subsystems remain DB-backed and un-exercised here.

## 2. Parts 2–3 — the report-only runner + provenance

`lib/validation-cohort/validation/corpusRunner.ts` (`runCorpusValidation`) is **report-only** — it consumes
an already-persisted corpus and never fetches. Per league it runs `monitorLeagueHealth` +
`deriveLeagueAttentionSignals` + the neutral activity evidence, and emits `RecommendationRecord`s with full
**provenance** (`provenance.ts`): type, source subsystem, evidence categories, observed facts, missing
evidence (disclosed), a deterministic input fingerprint, and availability. Deterministic: identical corpus
⇒ identical report. CLI: `--validate --store=<dir> [--dataSource=…]` (report-only; no fetch).

## 3. Parts 4–5 — diversity + over/under-firing (real finding, no defect)

Live report-only run over the 6-league `theciege24` corpus: **22 recommendations, 3.67/league**, types
`league-health-intervention` (6), `attention-signal:league_context_incomplete` (6),
`high_league_health` (4), `league_requires_review` (6).

**Over-firing observed and traced (Part 5):** `league_context_incomplete` and `league_requires_review`
fire in **all six** leagues. Root cause: the corpus legitimately lacks **financial-status and draft-date**
evidence (the public provider API never exposes them), so `league_context_incomplete` *correctly* reports
that context is incomplete, and `league_requires_review` follows from the health-derived recommended
actions. This is a **partial-/unavailable-evidence artifact, not a Decision OS defect** — the signal is
telling the truth about the corpus. Per Part 7 (no tuning without a proven defect), **no change was made**.
Reducing its frequency would suppress a truthful signal.

## 4. Part 6 — counterfactual responsiveness (the core proof)

`__tests__/validation-cohort/corpus-validation.test.ts` varies **one factor at a time** and proves the
runnable derivations are causally evidence-responsive:

- **Trade volume:** a low-trade league fires the trade-stimulation health intervention; a high-trade league
  does not. (Note: the *attention* layer legitimately also reacts to transaction volume via a
  `requires_review` signal — a real coupling, documented, not asserted against.)
- **Manager inactivity:** a mostly-inactive league is rated worse (different severities, ≥ as many
  recommendations) than a fully-active one.
- **Waiver activity:** a quiet-waiver league produces a different recommendation set than a very-active one.
- **Isolation:** toggling an irrelevant factor (TE-premium, which the health engine does not consume)
  changes **no** recommendation — proving the responsiveness is causal, not incidental.

## 5. Part 8 — seven-OS validation (honest)

| OS | Representation from the corpus |
| --- | --- |
| Commissioner / League | **Real derivation** — health/engagement/fairness + interventions + attention signals |
| Platform | Real corpus-level aggregation of the above |
| Manager | Evidence available (roster/matchup context) — but the product Manager Command Center engine is DB-backed, not run here |
| Trade / Waiver / Draft | Activity evidence available (trades/waivers/FAAB/draft participation) — the product recommendation engines are DB-backed, not run here |

Empty/partial/unavailable states are represented honestly (e.g. `UNKNOWN` financial status → the
context-incomplete signal; no fabricated playoff odds, ADP, value curves, or acceptance probabilities).

## 6. Parts 9 & 11 — ownership + provider-neutrality

Every runner recommendation is **league-scoped from a single named subsystem** (test-enforced), preserving
one-home ownership; the executive one-home rule remains enforced by the V3.1 consistency test. The
validation report contains **no provider identifiers** (test-enforced JSON scan); the persisted corpus and
rendered `/fantasy-os` route were previously leak-scanned clean.

## 7. Defects, fixes, Decision OS changes

**Proven Decision OS defects: none. Decision OS code changes: none.** Two *test-logic* issues in my own
fixtures were corrected during development (an over-strong stability assumption; a provenance assertion that
didn't account for attention-signal records). The one behavioral observation (context-incomplete
over-firing) was traced to unavailable evidence and is an expected artifact, not a defect.

## 8. Live smoke scope + limits (Part 12)

`theciege24`, 6 real leagues, report-only validate. This is **bounded one-account tooling verification** —
**not** diverse-user validation, cohort calibration, recommendation-quality-across-portfolios, or pilot
completion. No diverse cohort file was supplied.

## 9. Tests & typecheck

`corpus-validation.test.ts` (9: provenance, determinism, over-firing, three counterfactuals + isolation,
ownership, leak). Full targeted **197/197** (validation-cohort + gateway + white-label + executive-viz), 0
failures. Typecheck **158 (baseline preserved)**, 0 errors in touched files.

## 10. Remaining before diverse-cohort commercial validation

The one outstanding input remains the **real multi-account username cohort**. Additionally, exercising the
DB-backed composed subsystems (Mission Control / Manager Command Center / Daily Brief) over the corpus would
require a DB-backed store implementation or a compatibility adapter — neither built here (would be
speculative without the cohort to justify it).
