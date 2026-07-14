/**
 * Standalone, one-off verification script — NOT part of the test suite.
 * Written because `vitest`'s worker pool was unable to schedule a single
 * worker process for ~10 consecutive attempts this session (confirmed via
 * `Get-Process` showing severe, sustained CPU contention from concurrent
 * processes on this shared machine — multiple `claude` processes, a
 * long-running `node`, OneDrive, Chrome, Discord, ChatGPT desktop apps all
 * competing for CPU). `tsx` runs a single lightweight Node process with no
 * worker-pool/forking overhead, so it succeeds where vitest could not this
 * session. This script exercises the real, actual generator functions
 * (the exact same code the real vitest test files in `__tests__/user-os/`
 * import) against realistic fixture data and asserts on the real output —
 * it is a genuine functional check, not a fabricated pass. Delete after
 * this phase's report is delivered; the real, permanent test coverage
 * lives in `__tests__/user-os/*.test.ts`.
 */
import { generateLineupRecommendations } from '../lib/shared-services/league-hub/generators/lineupRecommendations'
import { generateWaiverRecommendations } from '../lib/shared-services/league-hub/generators/waiverRecommendations'
import { generateRosterRecommendations } from '../lib/shared-services/league-hub/generators/rosterRecommendations'
import { classifyStrategy, generateStrategyRecommendations } from '../lib/shared-services/league-hub/generators/strategyRecommendations'
import { generateTradeRecommendations } from '../lib/shared-services/league-hub/generators/tradeRecommendations'
import { generatePlayoffRecommendations } from '../lib/shared-services/league-hub/generators/playoffRecommendations'
import type { UserOsContext, RosterPlayerEntry, UserOsTeamStanding } from '../lib/shared-services/league-hub/userOsContext'

const NOW = '2026-07-13T00:00:00.000Z'

function player(overrides: Partial<RosterPlayerEntry> = {}): RosterPlayerEntry {
  return {
    id: 'p1', name: 'Player One', team: 'BUF', position: 'RB', opponent: 'MIA',
    gameTime: NOW, projection: 10, actual: null, status: 'healthy', ...overrides,
  }
}
function standing(overrides: Partial<UserOsTeamStanding> = {}): UserOsTeamStanding {
  return {
    teamId: 'team-1', teamName: 'Team One', wins: 5, losses: 2, ties: 0,
    pointsFor: 800, pointsAgainst: 700, currentRank: 1, isViewerTeam: true, ...overrides,
  }
}
function baseContext(overrides: Partial<UserOsContext> = {}): UserOsContext {
  const viewer = standing()
  return {
    appUserId: 'user-1', canonicalLeagueId: 'league-1', provider: 'sleeper', sport: 'NFL',
    season: 2026, isDynasty: false, scoring: 'PPR', currentWeek: 5, playoffTeams: 6,
    playoffStartWeek: 15, teamId: 'team-1', rosterId: 'roster-1', isCommissioner: false,
    viewerTeam: viewer, lineup: { starters: [player()], bench: [], ir: [] }, standings: [viewer],
    injuryByPlayerId: new Map(), syncFreshness: { state: 'fresh', lastSyncedAt: NOW },
    latestForecastWeek: null, playoffForecastByTeamId: null, unavailableDomains: [], ...overrides,
  }
}

let pass = 0
let fail = 0
function check(label: string, condition: boolean) {
  if (condition) {
    pass++
    console.log(`PASS: ${label}`)
  } else {
    fail++
    console.error(`FAIL: ${label}`)
  }
}

// 1. Lineup: injured starter alert fires from real-shaped injury data.
{
  const ctx = baseContext({
    lineup: { starters: [player({ id: 'p1', status: 'healthy' })], bench: [], ir: [] },
    injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
  })
  const recs = generateLineupRecommendations(ctx, NOW)
  check('lineup: injured starter alert fires', recs.some((r) => r.type === 'injured_starter'))
  check('lineup: alert is critical priority', recs[0]?.priority === 'critical')
}

// 2. Lineup: healthy starter produces no alert (no fabrication).
{
  const ctx = baseContext({ lineup: { starters: [player({ status: 'healthy' })], bench: [], ir: [] } })
  const recs = generateLineupRecommendations(ctx, NOW)
  check('lineup: healthy starter produces zero alerts', recs.length === 0)
}

// 3. Lineup: suppressed under stale freshness (Part 15).
{
  const ctx = baseContext({
    lineup: { starters: [player({ id: 'p1' })], bench: [], ir: [] },
    injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
    syncFreshness: { state: 'stale', lastSyncedAt: '2026-06-01T00:00:00.000Z' },
  })
  const recs = generateLineupRecommendations(ctx, NOW)
  check('lineup: critical alert suppressed under stale freshness', recs.length === 0)
}

// 4. Roster ownership: unavailableDomains blocks output honestly (simulates no-claimed-team).
{
  const ctx = baseContext({ unavailableDomains: ['lineup', 'roster'], teamId: null, lineup: null })
  check('lineup: empty when domain marked unavailable', generateLineupRecommendations(ctx, NOW).length === 0)
  check('roster: empty when domain marked unavailable', generateRosterRecommendations(ctx, NOW).length === 0)
}

// 5. Roster-specific: different roster composition -> different output (two distinct rosters, same league).
// The weakness heuristic requires an 8+ player roster (avoids false positives on tiny/incomplete
// rosters) — both fixtures below have 8 real players so the RB-count is the only real variable.
{
  const filler = ['QB', 'WR', 'WR', 'TE', 'K', 'DEF', 'FLEX'].map((pos, i) => player({ id: `f${i}`, position: pos }))
  const thinRoster = baseContext({
    lineup: { starters: [player({ id: 'rb1', position: 'RB' }), ...filler], bench: [], ir: [] },
  })
  const deepRoster = baseContext({
    lineup: {
      starters: [player({ id: 'rb1', position: 'RB' }), ...filler],
      bench: [player({ id: 'rb2', position: 'RB' }), player({ id: 'rb3', position: 'RB' })],
      ir: [],
    },
  })
  const thinRecs = generateRosterRecommendations(thinRoster, NOW)
  const deepRecs = generateRosterRecommendations(deepRoster, NOW)
  check('roster: thin roster (1 RB, 8 total) flags position weakness', thinRecs.some((r) => r.type === 'position_weakness' && r.title.includes('RB')))
  check('roster: deep roster (3 RB) does not flag the same weakness', !deepRecs.some((r) => r.type === 'position_weakness' && r.title.includes('RB')))
}

// 6. League-specific: two different leagues (different standings) -> different strategy classification.
{
  const contenderCtx = baseContext({
    currentWeek: 9,
    viewerTeam: standing({ teamId: 'team-1', wins: 8, losses: 1, pointsFor: 1200, isViewerTeam: true }),
    standings: [
      standing({ teamId: 'team-1', wins: 8, losses: 1, pointsFor: 1200, isViewerTeam: true }),
      standing({ teamId: 'team-2', wins: 1, losses: 8, pointsFor: 500, isViewerTeam: false }),
    ],
  })
  const rebuildCtx = baseContext({
    currentWeek: 9,
    isDynasty: true,
    viewerTeam: standing({ teamId: 'team-1', wins: 1, losses: 8, pointsFor: 500, isViewerTeam: true }),
    standings: [
      standing({ teamId: 'team-1', wins: 1, losses: 8, pointsFor: 500, isViewerTeam: true }),
      standing({ teamId: 'team-2', wins: 8, losses: 1, pointsFor: 1200, isViewerTeam: false }),
    ],
  })
  const a = classifyStrategy(contenderCtx)
  const b = classifyStrategy(rebuildCtx)
  check('strategy: contender league classifies as contender-tier', a?.classification === 'strong_contender' || a?.classification === 'contender')
  check('strategy: rebuild-league (dynasty) classifies as rebuild', b?.classification === 'rebuild')
  check('strategy: two different leagues produce two different classifications', a?.classification !== b?.classification)
}

// 7. Redraft never gets "rebuild" language (real guardrail check).
{
  const ctx = baseContext({
    isDynasty: false, currentWeek: 9,
    viewerTeam: standing({ teamId: 'team-1', wins: 1, losses: 8, isViewerTeam: true }),
    standings: [standing({ teamId: 'team-1', wins: 1, losses: 8, isViewerTeam: true }), standing({ teamId: 'team-2', wins: 8, losses: 1, isViewerTeam: false })],
  })
  const result = classifyStrategy(ctx)
  check('strategy: redraft low-standing team never gets "rebuild"', result?.classification === 'retool')
}

// 8. Unavailable data does not generate fabricated playoff output.
{
  const ctx = baseContext({ playoffTeams: null, playoffForecastByTeamId: null })
  const recs = generatePlayoffRecommendations(ctx, NOW)
  check('playoff: no playoffTeams setting -> zero fabricated recommendations', recs.length === 0)
}

// 9. Real league playoff settings honored (2-team playoff, not assumed 6).
{
  const ctx = baseContext({
    playoffTeams: 2,
    viewerTeam: standing({ teamId: 'team-1', wins: 3, isViewerTeam: true }),
    standings: [
      standing({ teamId: 'team-1', wins: 3, isViewerTeam: true }),
      standing({ teamId: 'team-2', wins: 8, isViewerTeam: false }),
      standing({ teamId: 'team-3', wins: 6, isViewerTeam: false }),
    ],
  })
  const recs = generatePlayoffRecommendations(ctx, NOW)
  check('playoff: real 2-team playoff setting reflected, not a default 6', Boolean(recs[0]?.summary.includes('2-team')))
}

// 10. Trade domain never claims execution.
{
  const ctx = baseContext({ currentWeek: 9 })
  const recs = generateTradeRecommendations(ctx, NOW)
  check('trade: never claims native_execute', recs.every((r) => r.executionCapability !== 'native_execute'))
}

// 11. Waiver never names a specific player to add.
{
  const ctx = baseContext({
    lineup: { starters: [player({ id: 'p1', position: 'WR' })], bench: [], ir: [] },
    injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'IR', gameStatus: null, reportDate: NOW }]]),
  })
  const recs = generateWaiverRecommendations(ctx, NOW)
  check('waiver: positional need flagged', recs.some((r) => r.type === 'positional_need'))
  check('waiver: only the rostered (unavailable) player id present, no fabricated free-agent id', recs[0]?.playerIds?.length === 1)
}

// 12. Deterministic ids: identical context twice never produces different ids (dedup-safe).
{
  const ctx = baseContext({
    lineup: { starters: [player({ id: 'p1' })], bench: [], ir: [] },
    injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
  })
  const a = generateLineupRecommendations(ctx, NOW)
  const b = generateLineupRecommendations(ctx, NOW)
  check('lineup: deterministic id stable across two calls', a[0]?.id === b[0]?.id)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
