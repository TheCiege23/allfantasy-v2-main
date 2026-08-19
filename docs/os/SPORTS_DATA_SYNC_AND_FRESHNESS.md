# Sports Data Sync & Freshness (Fantasy OS Phase 5)

Builds on the Phase 4 season-aware synchronizer (`lib/fantasy-os/sync/`). The gateway is the collection target:
scheduled runs call `gateway` adapter methods (via the runner's scope fetchers) instead of direct provider HTTP.

## Cadence (from `sync/season.ts`)
Preseason/regular/postseason = **30 min**; offseason = **4h**; unknown = 4h + warning. DST-invariant.

## Capability sub-cadences (within the max schedule)
- live_scores during active games — eligible every 30 min (in season)
- injuries — every 30 min in season
- schedules — infrequent unless changed
- static player identity / team branding — cache aggressively
- historical stats — immutable after certification (never refetched; `immutableScopes` in the runner)

## Snapshots vs events (Part 9)
- **Certified snapshots** — stable reads for dashboards/intelligence: player directory, schedule, injury,
  projection, statistics. A new version carries its own checksum/provenance; a partial/failed run never certifies.
- **Incremental events** (`SportsDataEvent<T>`) — timely OS reactions: player ruled out, game postponed,
  depth-chart change, trade/waiver processed, new injury designation, score update, projection materially changed.
  Deterministic `eventId` supports dedup.

## Freshness (`SportsDataContext`, separate from truth labels)
Season-aware thresholds (in season current ≤45m; offseason ≤5h). Subsystem responses show
`current/delayed/partial/unavailable` + last successful provider update. Stale REAL data stays its truth label
(e.g. Live/Derived) with a truthful **Delayed** — never relabeled Presentation Preview.

## Failure behavior
Failed/partial runs do not delete verified data, fabricate content, mark success, advance the certified
checkpoint, or corrupt totals — the prior certified snapshot remains available.
