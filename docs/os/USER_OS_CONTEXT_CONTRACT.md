# User OS Context Contract

Date: 2026-07-12/13. `lib/shared-services/league-hub/userOsContext.ts`'s
`UserOsContext` — the only object every domain generator reads from. Built
on top of the existing `resolveActiveLeagueContext` (League Hub Foundation
phase), fail-closed identically: `assembleUserOsContext()` returns `null`
when the caller has no real relationship to the league (not owner, not a
real redraft member, no claimed team) — every generator and the API route
must treat `null` as "no access," never assume access from a league id
alone.

## Never trusts client input

`assembleUserOsRecommendations`'s only inputs are `appUserId` (from the
caller's own resolved session — the API route reads it from
`requireAuth()`, never a request field) and `canonicalLeagueId` (a URL
path param, re-validated server-side on every call via
`resolveActiveLeagueContext`). There is no `teamId`, `rosterId`,
`isCommissioner`, `provider`, or `scoring` parameter anywhere in the public
surface a client could supply — every one of those is resolved from real
`League`/`LeagueTeam`/`Roster` rows inside the context assembler. Verified
by a dedicated test (`userOsRecommendations.test.ts`, "never trusts a
client-supplied teamId/rosterId").

## Fields, and where each real value comes from

| Field | Source |
|---|---|
| `provider`, `sport`, `season`, `scoring`, `teamId`, `rosterId`, `isCommissioner`, `syncFreshness` | `resolveActiveLeagueContext` (unchanged, reused) |
| `isDynasty`, `playoffTeams`, `playoffStartWeek` | Real `League` columns, read directly — never assumed as 6-team/week-14 defaults |
| `currentWeek` | `resolveRedraftCurrentWeek` (existing, reused) — degrades honestly to week 1 when no real week source is available |
| `viewerTeam`, `standings` | Real `LeagueTeam` rows for the whole league — every team's real win/loss/points, not just the viewer's |
| `lineup` | Real `Roster.playerData.lineup_sections` (starters/bench/IR), parsed defensively — `null` when the viewer has no claimed roster, never an empty-but-present placeholder |
| `injuryByPlayerId` | Live `InjuryReportRecord` rows for every player id in the viewer's own lineup — most-recent-per-player kept, never the roster's own (potentially stale) cached status alone |
| `latestForecastWeek`, `playoffForecastByTeamId` | Real, already-persisted `SeasonForecastSnapshot` — read-only, this assembler never triggers a new simulation |
| `unavailableDomains` | Computed, not asserted — see below |

## No raw provider payloads, no credentials

The context never carries a raw Sleeper/ESPN/Yahoo/MFL/Fantrax API response
or a decrypted credential — every field above is a real, already-normalized
canonical value. This matches Part 4's explicit instruction.

## `unavailableDomains` — honest, not silent

Two real reasons a domain lands in `unavailableDomains` this phase:
1. **No claimed team** (`!active.teamId || !lineup`) → `lineup`, `roster`.
2. **Sport not yet supported** — driven by `sportSupport.ts`'s
   `isDomainSupportedForSport()`, the single source of truth (see
   `USER_OS_DOMAIN_SUPPORT_MATRIX.md`) → `lineup`, `waiver` for any
   non-NFL sport this phase.

Generators check this list before producing output; the coordinator maps
an unavailable domain to a real `'unsupported'` `domainStatus` entry — the
API response and the League Hub UI widget both distinguish this from
"ok, genuinely nothing to recommend right now."
