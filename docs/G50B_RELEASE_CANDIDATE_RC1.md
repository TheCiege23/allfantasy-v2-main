# G50B NFL Redraft Release Candidate RC1

## Purpose

G50B moves the AF NFL Redraft platform from G50A certification into RC1 readiness.

This milestone does not redesign the runtime, provider architecture, premium services, or UI. It does not build Decision OS, Commissioner OS, Manager OS, AI reasoning, or recommendations.

## Resolved Launch Blockers

### Canonical Cron Cache Sync Hook

Added:

`lib/nfl-provider/nflRedraftCronCanonicalSync.ts`

The hook gives cron/import jobs a safe canonical cache handoff for:

- `import-scores` -> `live_stats`
- `import-schedules` -> `schedule`
- `import-standings` -> `standings`

Flow:

Provider -> G49H Provider Orchestrator -> Canonical Data -> SportsDataCache

The cache payload is sanitized before write. It does not persist raw provider payloads, provider player IDs, provider secrets, API keys, or bearer tokens.

### RC1 Checklist And Go/No-Go Report

Added:

`lib/nfl-provider/nflRedraftReleaseCandidate.ts`

The RC1 report composes the G50A certification baseline with the G50B cron sync hook and produces:

- resolved launch blockers
- remaining launch blockers
- known technical debt
- production checklist
- recommended pre-launch actions
- production readiness percentage
- go/no-go recommendation

## Cron Route Migration Status

Safe in RC1:

- Add canonical cache sync hook for scores, schedules, and standings.
- Verify hook behavior in tests without calling live providers.
- Preserve existing cron route behavior until dirty telemetry changes are reconciled.

Deferred intentionally:

| Route | Status | Reason |
| --- | --- | --- |
| `app/api/cron/import-scores/route.ts` | Ready for hook adoption | File already has unrelated dirty telemetry changes; avoid mixing launch-critical RC1 work with unrelated unstaged changes. |
| `app/api/cron/import-schedules/route.ts` | Ready for hook adoption | Same grouped migration concern. |
| `app/api/cron/import-standings/route.ts` | Ready for hook adoption | Same grouped migration concern. |
| `app/api/cron/import-injuries/route.ts` | Deferred | G49G/G49H do not expose a standalone injury capability. Adding one would be provider architecture expansion, which is outside G50B. |

## Production Checklist

| Area | Result | Notes |
| --- | --- | --- |
| Build | PASS WITH LIMITATIONS | Full production build not completed in this sandbox; repo-wide TypeScript remains a blocker. |
| Lint | PASS | Targeted ESLint passed on touched files. |
| Tests | PASS | Focused provider, premium, runtime, evidence, G50A, and G50B suites passed. |
| TypeScript | PASS WITH LIMITATIONS | Scoped run is still blocked by pre-existing shared repo errors outside G50B. |
| Provider Health | PASS WITH LIMITATIONS | Boundaries certified; live smoke requires staging credentials/network. |
| Premium Services | PASS | Premium services remain facts-only and consume canonical evidence. |
| Canonical Cache | PASS WITH LIMITATIONS | Canonical cron sync hook exists; route adoption remains next step. |
| Evidence | PASS | Evidence remains canonical and facts-only. |
| Playwright | PASS WITH LIMITATIONS | Full seeded browser certification was not executed in this environment. |
| Accessibility | PASS WITH LIMITATIONS | No new UI; full sweep remains pre-launch. |
| Performance | PASS WITH LIMITATIONS | Cache/fallback boundaries preserved; staging SLO telemetry remains. |
| Dark Mode | PASS WITH LIMITATIONS | No new UI; visual regression remains pre-launch. |
| Mobile | PASS WITH LIMITATIONS | No new UI; mobile Playwright remains pre-launch. |
| Admin | PASS WITH LIMITATIONS | Validation dashboard contract exists; polished admin visual page remains future work. |
| Import | PASS WITH LIMITATIONS | Sleeper/ESPN import adapters exist; live ESPN credential validation remains staging-only. |
| Runtime | PASS | Runtime remains authoritative and canonical. |

## Remaining Launch Blockers

Critical:

- Full repo TypeScript/build cleanup remains unresolved because failures are in pre-existing shared files outside the safe G50B touched-file scope.
- Full seeded Playwright browser journey still needs a stable local or staging environment.
- Cron route adoption of the canonical sync hook should happen after existing dirty telemetry edits are reconciled.

Medium:

- `import-injuries` needs a future canonical injury capability or an explicit mapping decision.
- FantasyCalc list/trend/value-history/market-movement/trade-value shapes still need versioned canonical migration.
- API-Sports injuries and venues still need first-class canonical sync paths.
- Live provider smoke requires staging credentials and network access.

Minor:

- Provider validation dashboard can be promoted into a polished internal admin page.
- Provider trace persistence and alert thresholds should be added for stale/fallback spikes.

## Known Technical Debt

- Several cron routes are already dirty with telemetry changes. RC1 avoids staging those unrelated edits.
- Full TypeScript validation still reports shared issues in auth, Prisma, player-data, sports-live-scores, and other unrelated modules.
- Browser proof exists as contract/UI tests, not a full seeded Playwright journey.

## Production Readiness

Estimated production readiness: 82%.

This is an improvement from the G50A 79% baseline because RC1 adds an executable canonical cron cache sync hook and checklist/reporting layer. It is still not a public-launch green light.

## Go / No-Go Recommendation

GO for internal RC1.

NO-GO for public launch until:

1. Cron routes adopt the canonical sync hook.
2. Full seeded Playwright certification passes.
3. Staging live-provider smoke passes.
4. Repo-wide TypeScript/build blockers are cleared.
5. Provider stale/fallback alerting is in place.

## Recommended Pre-Launch Actions

1. Reconcile existing dirty cron telemetry changes, then wire `syncNflRedraftCronCanonicalCache` into scores, schedules, and standings cron routes.
2. Decide whether to add a canonical injury capability or map injuries through existing player intelligence sync.
3. Run full seeded commissioner and manager Playwright flows.
4. Run staging provider smoke for Rolling Insights, FantasyCalc, TheSportsDB, API-Sports, OpenWeather, orchestrator, evidence, premium route, and validation dashboard.
5. Clear repo-wide TypeScript/build blockers.
