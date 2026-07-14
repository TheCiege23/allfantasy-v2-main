# Draft OS — Risk Register (Phase 25, updated Phase 26)

**Status: verified findings, reasonable inferences, and unknowns explicitly separated, per this phase's guardrails.**

## Phase 26 update

Root-caused and narrowly fixed one real defect underlying the 80.1% identity-resolution risk below: `getPlayerPoolForSport()` applied its row limit before deduplication, wasting most of its budget on duplicate rows (measured: 17,257 raw NFL rows for 12,004 distinct names; a `take: 800` query never advanced past "Anthony Jones"). Fixed, tested, verified via a passing unit test that fails against the pre-fix code.

**A second, larger, dominant root cause was found and explicitly NOT fixed this phase**: the pool query's alphabetical-order-with-hard-limit selection strategy itself, which remains the primary reason real, ADP-listed stars (confirmed genuinely present in the underlying tables) don't resolve. This is now the **highest-priority open item** in this risk register — see `FANTASY_OS_DRAFT_IDENTITY_ROOT_CAUSE.md` for full detail. Real before/after measurement showed only a modest +0.7 percentage point improvement (19.9% → 20.6%) for the one real league tested, and zero measurable improvement in recommendation diversity — both reported honestly, not overstated.

## Verified findings (real, measured or directly read from source this phase)

| Risk | Severity | Evidence |
|---|---|---|
| 80.1% player-identity resolution failure rate in the draft candidate pool | **High** | Real measurement: 218/272 unresolved (`FANTASY_OS_DRAFT_IDENTITY_VALIDATION.md`) |
| League-configuration coverage gap — 9 of 11 named configurations unsupported or only cosmetically supported | **High** | Direct source read, zero matches confirmed for scoring/PPR/IDP/keeper/auction handling (`FANTASY_OS_DRAFT_LEAGUE_CONFIG_COVERAGE.md`) |
| Dynasty context does not affect scoring, only explanation text | **Medium-High** | Direct source read, `RecommendationEngine.ts:150-152` |
| No historical/real draft data exists in `.env.test` to validate against | **High** (blocks confident readiness assessment) | Real query: 0 recognized-platform completed drafts (`FANTASY_OS_DRAFT_HISTORICAL_REPLAY_VALIDATION.md`) |
| `lib/shared-services/draft/` (the "Draft OS" migration candidate itself) has zero real callers | **Informational** (by design — shadow mode) | Full-repo grep, confirmed |
| No proactive `DraftPoolCache` invalidation | **Low-Medium** | Confirmed absence via grep; mitigated by 30-min pre-warming cadence |
| `InMemoryDraftShadowResultStore` has no eviction policy | **Low** (currently moot — zero real callers) | Direct source read |
| ADP not cached, read live every call | **Low-Medium** (untested at scale) | Confirmed absence via grep |

## Reasonable inferences (not directly proven this phase)

- The identity-resolution gap likely stems from the same general player-identity fragmentation pattern this whole Fantasy OS effort has found repeatedly elsewhere (multiple independent, non-communicating identity systems) — plausible given `SportPlayerPoolResolver` and the ADP snapshot are two more independently-name-keyed systems, but the exact divergence point between the 770-player pool and the 272 ADP-listed names was not traced this phase.
- The static top-candidate behavior observed in the mechanics exercise is most likely explained by the identity-resolution gap shrinking the effective usable pool, rather than a bug in the scoring formula itself (the formula's individual terms were each independently verified sound) — inferred from the correlation, not proven via isolated testing of the formula against a rich resolved pool.

## Unknowns (explicitly not claimed either way)

- Whether Draft OS handles retired players, mid-season traded players, renamed franchises, or duplicate cross-sport identities correctly — no real data existed to test any of these scenarios this phase.
- Whether recommendation quality is genuinely good against real human draft decisions — no real draft outcome data existed to compare against.
- Full classification of the ~177 draft-related routes not individually traced this phase (only 3 were confirmed live-UI-wired).
- Exact per-stage latency breakdown (DB vs. compute vs. KG lookup) — only wall-clock totals were measured.

## Provider risks

- ADP data source (`readAllFantasyAdpForLeague`) has no historical versioning — a real, previously-disclosed (Phase 8) limitation reconfirmed this phase, meaning any future backtest (even with real draft data) can only compare against *today's* ADP, not the ADP that existed at the time of the historical draft — an inherent accuracy ceiling for backtesting, not a bug.

## Replay limitations

Fully documented in `FANTASY_OS_DRAFT_HISTORICAL_REPLAY_VALIDATION.md` — zero real-provider draft data available in `.env.test`.

## Technical debt

- Two naming-similar-but-functionally-different flags conflated (`isSF` covers both true Superflex and 2QB).
- `formatBoost`'s "TE" term is misleadingly adjacent to "TE Premium" terminology without actually implementing TE Premium scoring logic — a real risk of future confusion for anyone extending this code without re-reading it carefully (as this audit had to).

## Operational risks

- None identified as currently active, since the shared-services module has zero real callers — no live customer-facing risk exists from this module today. All risks above apply to the **live, real, in-production** `computeDraftRecommendation` engine (via `lib/draft-helper/`), which the shared-services module wraps but does not currently protect or gate in any way.
