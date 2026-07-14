# User OS Recommendation Architecture

Date: 2026-07-12/13. Populates the `LeagueRecommendationBundle` contract
(League Hub Foundation phase) with real, league-specific intelligence for
the first time — the contract itself is extended, not replaced, per this
phase's own explicit guardrail against building a second recommendation
architecture.

## The shape

```
Request (appUserId from session, canonicalLeagueId from route)
    ↓
assembleUserOsContext()          — server-resolved, fail-closed context
    ↓
assembleUserOsRecommendations()  — the one coordinator every consumer calls
    ↓  (parallel, per requested domain)
lineup / waiver / trade / roster / playoff / strategy generators
    ↓
LeagueRecommendationBundle + domainStatus map
```

`lib/shared-services/league-hub/userOsRecommendations.ts`'s
`assembleUserOsRecommendations({ appUserId, canonicalLeagueId,
requestedDomains?, requestTime? })` is the single entry point — the API
route, the League Hub UI widget, and the Chimmy seam all call this one
function, never the individual generators directly. This matches Part 2's
explicit instruction not to require each consumer to call
lineup/waiver/trade/roster services independently.

## Why six real generators, not sixty

This phase's own Part 1 inventory (three parallel research agents, ~90
tool calls, full findings preserved in this phase's completion report)
found a genuinely large amount of existing intelligence — three competing
lineup engines, four competing trade-evaluation stacks, three separate
contender/rebuild classifiers, real FAAB/waiver-scoring engines with
complex multi-field inputs. Two paths were available: deeply re-wire the
richest of these engines (real risk of a shallow, fragile integration
within this phase's budget, since several have substantial input contracts
this phase's context assembler does not populate), or build a smaller set
of genuinely real, safe, testable signals directly from canonical data
already in `UserOsContext`, explicitly disclosing every deeper sub-case not
wired this phase. This program chose the second path — see each
generator's own file header for the specific reasoning and the exact
existing engine it deliberately did not re-integrate, and
`USER_OS_DOMAIN_SUPPORT_MATRIX.md` for the full disclosure table.

## The six generators

| Domain | File | Real data source |
|---|---|---|
| Lineup | `generators/lineupRecommendations.ts` | `Roster.playerData.lineup_sections` + live `InjuryReportRecord` |
| Waiver | `generators/waiverRecommendations.ts` | Same roster/injury data — positional-need signal only, no player-level suggestion (see doc) |
| Trade | `generators/tradeRecommendations.ts` | Real `strategy` classification — points to `/trade-finder`/`/dynasty-trade-analyzer`, never fabricates valuation |
| Roster | `generators/rosterRecommendations.ts` | Full canonical roster (starters+bench+IR), real projections/injury data |
| Playoff | `generators/playoffRecommendations.ts` | Real `SeasonForecastSnapshot` when fresh enough, else honest qualitative standings-based fallback |
| Strategy | `generators/strategyRecommendations.ts` | Real `LeagueTeam` record/standing — new, small, provider-neutral classifier (see file header for why the three existing classifiers weren't reused) |

## Determinism

Every recommendation's `id` is built by `buildRecommendationId()`
(`userOsRecommendationHelpers.ts`) — `${domain}:${type}:${leagueId}:${key}`,
never a random value or a timestamp. The same real conditions always
produce the same id, so refreshing the feed never duplicates an unchanged
recommendation — verified in `userOsRecommendationHelpers` and every
generator's own "deterministic ids" test.

## Recommendation state (Part 18)

Kept transient this phase, by design: every `LeagueRecommendation.status`
starts `'new'` and nothing persists it — no read-back, no write path. This
is the smallest safe choice for a first-wiring phase; persisting status
(viewed/dismissed/accepted/completed) would need at minimum a keyed-by
`(appUserId, recommendationId)` table, which is real but genuinely
deferrable — documented here, not built, per Part 18's own explicit
permission to defer.

## What this phase does NOT touch

No changes to `lib/decision-os/phase6/recommendations/*` (the separate
tier-based manager/commissioner/platform engine), `lib/waiver-ai-engine/*`,
`lib/trade-engine/*`, `lib/trade-finder/*`, `lib/season-forecast/*`,
`lib/dynasty-engine/*`, or `lib/season-strategy.ts` — every one of these
real, existing systems is documented, referenced, and in most cases
deliberately NOT deep-integrated this phase (see per-domain reasoning
above and in each generator file). The Rankings migration remains
untouched, per the explicit guardrail.
