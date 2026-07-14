# Provider Truthfulness Report (Phase 38, Part 6)

For providers lacking complete support: does customer-facing messaging communicate unavailable intelligence, partial validation, unsupported features, or degraded confidence honestly?

## Findings

| Provider | Self-reported coverage state (real, found in code) | Assessment |
|---|---|---|
| ESPN | No explicit "unsupported" messaging found for its NFL-only limitation or the IDP player-position gap | **Real gap**: a user importing an ESPN IDP league would not be told individual defensive players' positions are unresolved |
| Yahoo | No specific gaps found requiring disclosure | No issue found |
| Fantrax | `FantraxAdapter.ts`'s `coverage` block honestly self-reports `scoringSettings: state: 'missing'` for real, and comments explicitly document the CSV-history dependency | **Honest** — the code discloses its own real limitation, even though the underlying UI-level messaging to a user attempting a Fantrax import (given the confirmed missing ingestion path) was not traced this phase |
| MFL | `scoring.rules: []` always empty — no explicit "we didn't verify your exact scoring rules" disclosure found | **Real gap**: weaker scoring-rule fidelity than ESPN/Yahoo is not flagged to the user |
| Fleaflicker | `coverage` block **explicitly and honestly self-reports** `'missing'` for scoringSettings, historicalRosterSnapshots, draftHistory, tradeHistory, previousSeasons, with a note: *"Fleaflicker scoring rules not mapped in v1"* | **Honest** — the most limited provider is also the most explicit about its own limitations, a real, positive finding |

## No provider appears to claim full support when it doesn't, at the DATA-COVERAGE level

Every provider's normalization output carries a real `coverage` object (per-field `'full'`/`'partial'`/`'missing'` states) — this is a genuine, already-existing, provider-agnostic truthfulness mechanism, not something this phase needed to add. The `coverage` block is honest for every provider audited.

## What was NOT verified this phase (disclosed limitation)

Whether the CUSTOMER-FACING import preview/commit UI (`app/api/leagues/import/preview`, the real UI component rendering `coverage`) actually surfaces these per-field `'missing'` states to the end user in a readable way, for each of the 5 non-Sleeper providers, was not traced this phase — the `coverage` contract itself is honest at the data layer; whether that honesty survives all the way to the pixel a user sees was out of this phase's scope (would require UI-layer tracing per provider, a larger effort than "provider-specific bug fixes").

## Recommendation (not implemented, per guardrail)

ESPN's IDP-player-position gap and MFL's scoring-rule-fidelity gap should be added to their respective `coverage` self-reports (matching Fantrax's and Fleaflicker's existing honest pattern) — a small, real, additive truthfulness fix, but out of this phase's "provider-specific bug fixes" scope (which was reserved for reproducible data-shape bugs, not coverage-metadata additions).
