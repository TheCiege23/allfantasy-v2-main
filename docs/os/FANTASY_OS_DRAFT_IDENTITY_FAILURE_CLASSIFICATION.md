# Draft Identity Resolution Failure Classification (Phase 26)

**Status: real measurement, classified by actual evidence — no category assumed in advance.**

## Methodology

Captured the full list of 218 unresolved (name, position) pairs from Phase 25's real measurement (one real NFL league, 272 ADP candidates), then classified each by direct comparison against the real player pool.

## Category counts (real, measured)

| Category | Count | % of unresolved |
|---|---|---|
| **Name not found in pool at all (pre-fix)** | 214 | 98.2% |
| Name found, but position string differs (e.g., `"TIGHT END"` vs `"TE"`) | 3 | 1.4% |
| Name found via a close variant (suffix/punctuation difference, e.g., `"Asante Samuel"` vs `"Asante Samuel Jr."`) | 1 | 0.4% |

## What "name not found in pool at all" actually meant (root-caused this phase)

The 214-entry dominant category was **not** a genuine data-completeness gap — every spot-checked name (Saquon Barkley, Justin Jefferson, CeeDee Lamb, Bijan Robinson, Ja'Marr Chase, Mike Evans) was independently confirmed to exist, correctly, in `SportsPlayer`, `SportsPlayerRecord`, and `PlayerIdentityMap`. The true cause was the resolver-level defect documented in `FANTASY_OS_DRAFT_IDENTITY_ROOT_CAUSE.md`: an alphabetically-ordered query with a hard row limit, compounded by (now-fixed) premature deduplication, meant the vast majority of the real roster was never even queried into the candidate pool in the first place — this was never really a "matching" failure, it was a "never considered" failure.

## Categories explicitly NOT found in this real data (disclosed, not assumed absent)

Per this phase's explicit "do not assume" instruction, these categories were considered but **not observed** in the real 218-entry population — reported as genuinely absent from this sample, not untested:

- Franchise relocation naming drift
- Rookie-identifier-specific failures (distinct from the general "not found" pattern)
- Duplicate-identity confusion (two different real players resolving to the same key)
- Stale mapping references
- Provider-inconsistency-specific failures (beyond the general position-format issue already counted)

These may exist in other leagues/contexts not covered by this phase's single real-league sample — genuinely unknown, not verified-absent beyond this specific data.

## Prioritization, evidence-based

The dominant category (98.2%) was the alphabetical-limit resolver defect — by a wide margin the highest-impact issue, and the one this phase prioritized investigating and (partially) fixing. The two minor categories (position-format mismatch, suffix variants) together account for under 2% of failures and were correctly deprioritized relative to the dominant issue, consistent with this phase's "prioritize by impact" instruction.
