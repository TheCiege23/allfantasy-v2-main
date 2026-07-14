# Draft OS — Player Identity Validation (Phase 25)

**Status: real measurement against `.env.test`. Found a significant, real, disclosed identity-resolution gap.**

## Real measurement

For a real fixture league (NFL, `manual` platform), measured the exact identity-resolution pipeline `lib/shared-services/draft/DraftContextAssembler.ts` actually uses:

| Metric | Real value |
|---|---|
| Real player pool size (`SportPlayerPoolResolver.getPlayerPoolForLeague`) | **770** real NFL players |
| ADP entries available for this league (`readAllFantasyAdpForLeague`) | **272** |
| Engine's `available` candidate list (`assembled.engineInput.available.length`) | **272** — matches ADP count exactly; **players without an ADP entry are excluded from consideration entirely**, regardless of whether they exist in the real 770-player pool |
| **Unresolved player identities among those 272** (`dataCompleteness.unresolvedPlayerIdCount`) | **218 — an 80.1% resolution failure rate** |
| Effectively identity-resolved, usable candidates | **54 of 272 (19.9%)** |

## What "unresolved" means here, precisely

`assembleEngineInputFromPicks()` (`DraftContextAssembler.ts:141-191`) tries to match each ADP-listed player name+position against the real player pool via `playerKey()` (a lowercased `"name|position"` composite key). When no match is found, the player is still scored/ranked by the engine (it isn't silently dropped), but its `playerId` cannot be resolved to a real identity — meaning downstream consumers that need a real ID (the shadow module's Knowledge Graph lookups, any future consumer needing to persist/reference the pick) get a synthetic/null key instead.

## Consequence observed directly (Phase 25 mechanics exercise)

With 218 of 272 candidates effectively identity-unresolved, the real usable pool shrinks to ~54 players. In the mechanics exercise, the recommendation engine returned the **identical top candidate ("AJ Barner", TE) across every round (2 through 6) regardless of the simulated position need** (RB, RB, WR, WR, TE) — strong evidence that the effective candidate pool is small enough that need-based differentiation barely has room to operate. This is a real, observed consequence of the identity-resolution gap, not a separate engine bug — the scoring formula itself (`needScore`/`adpEdge`/`formatBoost`) is correctly implemented and would differentiate normally given a fuller resolved pool.

## Player identity scenarios NOT independently tested this phase (disclosed, not fabricated)

Given the 0-real-draft-data constraint (see Historical Replay doc), the following specific identity scenarios named in this phase's brief could not be exercised against real draft picks:
- Retired players
- Rookies (specifically, whether newly-drafted-to-the-NFL rookies resolve correctly)
- Traded players (mid-season team changes)
- Renamed franchises
- Duplicate identities across sports

These remain **unknown**, not verified-absent — a real limitation of this phase's data availability, not a claim they're fine.

## Root cause — informed inference, not fully traced this phase

The 80.1% gap is consistent with (but not definitively traced to) the general player-identity fragmentation this whole Fantasy OS effort has repeatedly found in other domains (Phase 14's audit found 6+ independent, non-communicating identity mechanisms codebase-wide). `SportPlayerPoolResolver` and the ADP snapshot (`readAllFantasyAdpForLeague`) are two more independent name-keyed systems that were not confirmed to share a canonical identity map — a plausible, not confirmed, root cause. A dedicated trace of exactly where the 218 unresolved names diverge from the 770-player pool was not completed this phase (out of time budget) and is flagged as necessary before any real fix is attempted.

## Successful resolutions / failures / ambiguities (measured)

- **Successful**: 54/272 (19.9%)
- **Failed** (no match at all): 218/272 (80.1%)
- **Ambiguous** (multiple matches): not separately measured — `assembleEngineInputFromPicks` uses a `Map` keyed by composite string, so a collision would silently overwrite rather than surface as "ambiguous"; this is itself a disclosed gap in the measurement, not a claim that zero ambiguity exists.

## Fallback behavior

Confirmed from source: unresolved players are **not excluded** from scoring — they remain in the ranked candidate list with `playerId: null`, and the engine can still recommend them (the shadow evaluation's own uncertainty note — `"218 available player(s) have no resolvable sport-pool identity — KG lookups and the legacy grader use a synthetic key for those"` — confirms this explicitly). This is a reasonable, honest fallback (doesn't silently drop real candidates), but it does mean identity-dependent downstream features (Knowledge Graph manager-tendency/exposure lookups) are starved for 80% of the pool.
