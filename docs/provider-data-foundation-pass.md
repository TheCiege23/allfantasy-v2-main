# Provider Data Foundation Pass

## Scope

This pass audits and extends the redraft provider foundation for NFL and NCAAF without production writes.

It covers:

- NFL Rolling Insights normalization verification.
- NCAAF CFBD ingestion into normalized AllFantasy models where provider data exists.
- Provider media normalization for team logos and player headshots.
- Write-safety guards for provider scripts.
- UI/AI contract notes so product surfaces consume normalized AllFantasy rows, not raw provider payloads.

## Safety

Provider writes are refused unless both markers are present:

- `APP_ENV=redraft-v1-data-test` or `APP_ENV=provider-assets-data-test`
- `DATABASE_BRANCH=redraft-v1-data-test` or `DATABASE_BRANCH=provider-assets-data-test`

Write mode also refuses `.env.local`. Use an ignored staging env file such as `.env.redraft-test`.

Dry-run/read-only commands are safe without markers:

```powershell
node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-ncaaf-cfbd-foundation.ts -- --season=2026 --week=1 --json
node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-provider-media-assets.ts -- --sport=ALL --limit=250 --json
node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/audit-provider-data-foundation.ts -- --season=2026 --week=1 --json
```

Write commands for a test Neon branch only:

```powershell
node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-ncaaf-cfbd-foundation.ts -- --season=2026 --week=1 --write --json
node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-provider-media-assets.ts -- --sport=ALL --limit=250 --write --json
```

Production was not touched by this branch.

## NFL Rolling Insights

Previously verified on `redraft-v1-data-test`:

- Schedules: 305
- Weekly projections: 1,267
- ROS projections: 1,267
- Injuries: 1,289
- Depth charts: 571 refreshed
- Projection snapshots: 2,534
- Trade values: 4 refreshed
- Rolling Insights identity match: 100%
- Stale warnings: none
- Missing warnings: none

Normalized target models:

- `SportsPlayer`
- `SportsTeam`
- `GameSchedule`
- `DepthChart`
- `PlayerSeasonStats`
- `SportsInjury`
- `FantasyProjection`
- `AFProjectionSnapshot`
- `PlayerIdentityMap`
- `SportsPlayerRecord` trade values

The NFL sync script now reports sanitized write-safety state and refuses unsafe provider writes.

## NCAAF CFBD

CFBD-backed normalized surfaces added or hardened:

- Teams into `SportsTeam`
- Team logos into `TeamAsset` when CFBD media exists
- Schedules/scores into `SportsGame` and `GameSchedule`
- Rosters into `SportsPlayer`
- Identity map rows using the available provider id slot without overwriting stronger identities
- Player season stats into `PlayerSeasonStats`
- Team season stats into `TeamSeasonStats`
- Rankings/records as provider availability evidence

Explicit provider limitations:

- CFBD fantasy projections are unavailable.
- CFBD injury data is unavailable in this integration.
- CFBD rankings are team rankings, not fantasy ADP.
- Game-log ingestion is not wired in this pass.

Fallback projection behavior:

- Weekly and ROS rows are generated into `AFProjectionSnapshot`.
- Source is labeled `allfantasy_cfbd_fallback`.
- `providerBacked=false`.
- `fallbackGenerated=true`.
- Confidence is reduced when stats or schedule data are missing.
- Chimmy/War Room should explain fallback status and not claim CFBD provided fantasy projections.

## Media Assets

Sources:

- TheSportsDB
- API-Sports, including `SPORTS_API_KEY` alias support
- Existing provider image fields from CFBD/Rolling Insights/SportsPlayer where available

Rules:

- Do not write placeholder, data URI, blank, non-HTTP, or team-logo-as-headshot URLs.
- Do not overwrite a better image with a lower-quality source.
- Prefer TheSportsDB transparent/badge assets for logos where available.
- Prefer actual player headshots over placeholder UI fallbacks.
- Store provider/source metadata on normalized rows.
- Missing images remain a UI fallback concern, not fake provider data.

Audit output reports:

- NFL team logos
- NCAAF team logos
- NFL player headshots
- NCAAF player headshots
- Missing logo/headshot counts
- Stale image count
- Provider source distribution

## UI And AI Consumers

Provider data should be consumed through normalized AllFantasy models by:

- Draft room
- Mock draft room
- Players tab
- Waiver wire
- Trade Center
- War Room
- Player cards/details
- League roster
- Commissioner Hub
- Chimmy grounding context

AI context rules:

- Include provider-backed vs fallback-generated status.
- Include confidence and last refreshed timestamps where available.
- Include missing/unavailable provider status.
- Do not send raw Rolling Insights or CFBD payloads directly to prompts.
- Do not invent unavailable NCAAF projections, injuries, ADP, or player images.

## Remaining Gaps

- NCAAF exact DB coverage counts require a write/audit on a safe test Neon branch.
- The local read-only audit was attempted against `.env.redraft-test`, but the Neon test branch was unreachable from this environment; no counts should be inferred from that blocked run.
- CFBD injury feed is unavailable.
- CFBD fantasy projections are unavailable; only labeled AllFantasy fallback projections are generated.
- CFBD team rankings are not fantasy ADP/rankings.
- NCAAF game logs are not implemented in this pass.
- Provider media write coverage needs a safe test-branch run before production promotion.

## Validation Status

Focused tests added:

- CFBD NCAAF normalization.
- CFBD unsupported projections/injuries behavior.
- NCAAF fallback projection labeling/confidence.
- Provider media null/placeholder/headshot/logo decisions.
- Better-image overwrite protection.
- Unsafe write guard rejection.
- Dry-run defaults and safe write command documentation.
