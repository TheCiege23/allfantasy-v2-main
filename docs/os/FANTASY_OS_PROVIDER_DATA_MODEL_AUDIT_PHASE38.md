# Provider Data Model Audit (Phase 38, Part 4)

## The real, confirmed, high-confidence finding: `roster_positions` shape divergence

**Sleeper** produces a flat array, one entry per roster slot: `['QB','RB','RB','WR','WR','TE','FLEX','BN','BN',...,'IR']` — confirmed via `SleeperLeagueMapper.ts:102` (passes `league.roster_positions` straight through unmodified).

**ESPN, Yahoo, and MFL** all instead produce AGGREGATED `"SLOT:count"` strings — confirmed via direct code read of all three adapters:
- ESPN: `` `${slot.slot}:${slot.count}` `` (`EspnAdapter.ts:167`)
- Yahoo: `` `${slot.position}:${slot.count}` `` (`YahooAdapter.ts:172`)
- MFL: `` `${slot.position}:${slot.count}` `` (`MflAdapter.ts:156`)

**Fleaflicker** never populates `roster_positions` at all (hardcoded `[]`).

This is a real, confirmed, previously-undetected instance of exactly the pattern this phase was chartered to find: `lib/league-import/canonicalImportNormalizer.ts`'s bench-slot computation was written against Sleeper's flat-array shape (exact string match against `'BN'`/`'IR'`/`'TAXI'`) and never adapted when ESPN/Yahoo/MFL support was added — see Provider-Specific Bug Fixes for the fix.

## Real, provider-specific reserve-slot vocabulary (confirmed via code, not guessed)

| Provider | Bench label(s) | IR label | Taxi label | Source |
|---|---|---|---|---|
| Sleeper | `BN` | `IR` | `TAXI` | Native Sleeper convention |
| ESPN | `BE` (slot id 20) | `IR` (slot id 21) | *(none — ESPN has no taxi concept)* | `ESPN_SLOT_LABELS`, `EspnLeagueFetchService.ts` |
| Yahoo | `BN`, `BE` | `IR`, `IL` | *(covered by `NA`/`DL` reserve labels)* | `YAHOO_RESERVE_POSITIONS`, `YahooLeagueFetchService.ts:16` |
| MFL | *(implicit — MFL's "starters" export only lists real starter positions)* | *(not separately modeled)* | `TAXI` (appended by the mapper itself) | `MflLeagueFetchService.ts:350-352` |
| Fleaflicker | N/A | N/A | N/A | `roster_positions` never populated |

## Other real, confirmed provider-shape differences (non-bug, documented for awareness)

- **Sport support**: ESPN and MFL are real, hardcoded NFL-only (MFL is a genuine provider constraint — MFL's own API is football-only; ESPN's is a code choice, not confirmed as a provider limitation). Yahoo and Fleaflicker are real multi-sport. Sleeper is real multi-sport (already extensively validated).
- **Scoring-rule fidelity**: ESPN and Yahoo parse real per-stat scoring rules (reception-point detection from actual statId rules). MFL falls back to string-matching league name/scoring-type text for PPR detection — weaker, but real. Fleaflicker parses zero scoring rules at all (self-reported `'missing'` in its own coverage block).
- **IDP player identity**: ESPN recognizes IDP roster *slots* (`DT/DE/LB/DL/CB/S/DB/DP`) but its `ESPN_POSITION_LABELS` lookup (used to resolve individual *players'* positions) only covers `{QB,RB,WR,TE,K,D/ST}` — IDP players' positions resolve to `'N/A'`, a real, disclosed, narrower gap than the roster-slot-level bug fixed this phase.
- **Fantrax's real gap is architectural, not a shape-parsing bug**: no confirmed code path populates the `FantraxLeague`/`FantraxUser` tables its own real import/normalize code reads from — this is a genuine missing-ingestion-mechanism gap, not a data-shape mismatch, and is out of this phase's "provider-specific bug fixes" scope (fixing it would mean building a new ingestion mechanism, not fixing a shape-parsing bug).

## Where assumptions currently rely on Sleeper-specific behavior (audit finding, not all fixed)

The `roster_positions` bench-slot bug (fixed this phase) was the one CONFIRMED, HIGH-CONFIDENCE instance found via direct code audit. The research agent also flagged, but did not confirm with the same certainty, that Fantrax's `FantraxLeagueMapper`'s own `roster_positions` output wasn't traced to the same depth — disclosed as an open question for a future phase, not asserted as a second bug.
