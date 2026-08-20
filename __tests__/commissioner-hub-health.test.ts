import { describe, expect, it } from 'vitest'
import { buildCommissionerHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

const NOW = new Date('2026-09-15T12:00:00.000Z')

function roster(overrides: Record<string, unknown> = {}) {
  return {
    id: 'roster-1',
    platformUserId: 'owner-1',
    updatedAt: NOW,
    playerData: {
      players: ['p1', 'p2', 'p3'],
      starters: ['p1', 'p2'],
      lineup_sections: {
        starters: [
          { id: 'p1', position: 'QB', weekProjection: 18, projectionConfidenceLevel: 'high' },
          { id: 'p2', position: 'RB', weekProjection: 12, projectionConfidenceLevel: 'medium' },
        ],
        bench: [{ id: 'p3', position: 'WR' }],
      },
    },
    ...overrides,
  }
}

describe('commissioner hub health builder', () => {
  it('surfaces missed lineups, inactive teams, and injury risk from roster snapshots', () => {
    const snapshot = buildCommissionerHealthSnapshot({
      now: NOW,
      league: {
        id: 'league-1',
        name: 'Redraft Main',
        sport: 'NFL',
        leagueType: 'redraft',
        season: 2026,
        leagueSize: 4,
        starters: { QB: 1, RB: 1, WR: 1 },
        rosters: [
          roster(),
          roster({
            id: 'roster-2',
            platformUserId: 'owner-2',
            playerData: {
              players: ['p4', 'p5'],
              lineup_sections: {
                starters: [{ id: 'p4', position: 'QB', injuryStatus: 'Questionable', weekProjection: 9, projectionConfidenceLevel: 'low' }],
                bench: [{ id: 'p5', position: 'RB' }],
              },
            },
          }),
          roster({
            id: 'roster-3',
            platformUserId: 'owner-3',
            updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          }),
          roster({
            id: 'roster-4',
            platformUserId: '',
            playerData: { players: [], lineup_sections: { starters: [], bench: [] } },
          }),
        ],
      },
      counts: {
        tradeActivity: 2,
        waiverActivity: 5,
        pendingWaiverClaims: 3,
        pendingTrades: 1,
        chatMessagesLast7Days: 8,
        commissionerActions: 4,
      },
    })

    expect(snapshot.metrics.inactiveTeams).toBe(2)
    expect(snapshot.metrics.missedLineups).toBe(4)
    expect(snapshot.metrics.injuredStarters).toBe(1)
    expect(snapshot.metrics.tradeActivity).toBe(2)
    expect(snapshot.metrics.waiverActivity).toBe(5)
    expect(snapshot.metrics.pendingWaiverClaims).toBe(3)
    expect(snapshot.metrics.pendingTrades).toBe(1)
    expect(snapshot.metrics.lineupSubmissionRate).toBe(0)
    expect(snapshot.metrics.projectionCoveragePct).toBeGreaterThan(0)
    expect(snapshot.metrics.lowConfidenceProjectionStarters).toBe(1)
    expect(snapshot.overallStatus).toMatch(/watch|at_risk|critical/)
  })

  it('builds the commissioner action set and gates pending-only controls', () => {
    const snapshot = buildCommissionerHealthSnapshot({
      now: NOW,
      league: {
        id: 'league-2',
        name: 'Healthy League',
        sport: 'NFL',
        leagueType: 'redraft',
        leagueSize: 2,
        starters: { QB: 1 },
        rosters: [roster(), roster({ id: 'roster-2', platformUserId: 'owner-2' })],
        lockAllMoves: false,
      },
      counts: {
        pendingWaiverClaims: 0,
        pendingTrades: 0,
      },
    })

    const labels = snapshot.actions.map((action) => action.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Force Lineup',
        'Force Add/Drop',
        'Adjust Scores',
        'Reverse Trade',
        'Process Waivers',
        'Lock Rosters',
      ]),
    )
    expect(snapshot.actions.find((action) => action.key === 'process_waivers')?.enabled).toBe(false)
    expect(snapshot.actions.find((action) => action.key === 'reverse_trade')?.enabled).toBe(false)
    expect(snapshot.actions.find((action) => action.key === 'lock_rosters')?.requiresConfirmation).toBe(true)
  })

  it('grounds assistant questions in available commissioner metrics', () => {
    const snapshot = buildCommissionerHealthSnapshot({
      now: NOW,
      league: {
        id: 'league-3',
        name: 'Tuesday League',
        sport: 'NCAAF',
        leagueType: 'redraft',
        leagueSize: 12,
        rosters: [],
      },
      counts: {
        pendingWaiverClaims: 7,
      },
    })

    expect(snapshot.assistantQuestions.map((q) => q.label)).toEqual(
      expect.arrayContaining([
        "Who hasn't set lineups?",
        'Who has the most injuries?',
        "Which owners haven't logged in?",
        'Suggest waiver run now.',
        'Generate league update.',
      ]),
    )
    expect(snapshot.assistantQuestions.find((q) => q.key === 'waiver_run')?.answer).toContain('7 pending claims')
    // A league with ZERO rosters is the least-known state there is. This asserted
    // 'medium' before -- rating the emptiest possible input above the floor.
    expect(snapshot.dataConfidence).toBe('low')
  })

  it('marks dashboard-only snapshots as low confidence fallback data', () => {
    const snapshot = buildCommissionerHealthSnapshot({
      now: NOW,
      source: 'dashboard-fallback',
      league: {
        id: 'league-4',
        name: 'Fallback League',
        sport: 'NFL',
        leagueType: 'redraft',
        leagueSize: 10,
        rosters: [],
      },
    })

    expect(snapshot.source).toBe('dashboard-fallback')
    expect(snapshot.dataConfidence).toBe('low')
    expect(snapshot.metrics.inactiveTeams).toBe(0)
  })

  it('builds healthy metrics from imported Sleeper canonical roster rows', () => {
    const snapshot = buildCommissionerHealthSnapshot({
      now: NOW,
      league: {
        id: 'league-imported',
        // Required for 'high'. Without it the league has never been read, and the
        // metrics below would all be zero-by-absence rather than measured.
        lastSyncedAt: NOW,
        name: 'Imported Sleeper League',
        sport: 'NFL',
        leagueType: 'redraft',
        leagueSize: 1,
        starters: { QB: 1, RB: 1 },
        rosters: [
          {
            id: 'roster-imported',
            platformUserId: 'sleep-123',
            updatedAt: NOW,
            playerData: {
              players: ['p1', 'p2', 'p3', 'p4'],
              starters: ['p1', 'p2'],
              reserve: ['p3'],
              taxi: ['p4'],
              import: {
                provider: 'sleeper',
                sourceLeagueId: '12345',
                sourceManagerId: 'sleep-123',
              },
            },
          },
        ],
      },
    })

    expect(snapshot.source).toBe('database')
    expect(snapshot.dataConfidence).toBe('high')
    expect(snapshot.teamCount).toBe(1)
    expect(snapshot.metrics.activeManagers).toBe(1)
    expect(snapshot.metrics.missedLineups).toBe(0)
  })
})

/**
 * The confidence ladder is a claim about whether anyone has READ this league.
 *
 * Regression cover for the production case recorded in `lib/core-app/todayStrip.ts`:
 * 873 rosters across 69 leagues with `lastSyncedAt` null on all 98, which the engine
 * reported as "high confidence, 57, DRIFTING". Row count is not readership.
 */
describe('commissioner health: confidence reflects readership, not row count', () => {
  const leagueWith = (over: Record<string, unknown>) => ({
    id: 'lg-ladder',
    name: 'Ladder League',
    sport: 'NFL',
    leagueType: 'redraft',
    leagueSize: 12,
    starters: { QB: 1 },
    rosters: [
      {
        id: 'r1',
        platformUserId: 'u1',
        updatedAt: NOW,
        playerData: { players: ['p1'], starters: ['p1'] },
      },
    ],
    ...over,
  })

  it('NEVER synced is low, even with roster rows present', () => {
    const snap = buildCommissionerHealthSnapshot({
      now: NOW,
      league: leagueWith({ lastSyncedAt: null }) as never,
    })
    expect(snap.dataConfidence).toBe('low')
  })

  it('synced but stale is medium, not high', () => {
    const stale = new Date(NOW.getTime() - 8 * 86_400_000) // 8d > the 7d threshold
    const snap = buildCommissionerHealthSnapshot({
      now: NOW,
      league: leagueWith({ lastSyncedAt: stale }) as never,
    })
    expect(snap.dataConfidence).toBe('medium')
  })

  it('recently synced with rosters is high', () => {
    const snap = buildCommissionerHealthSnapshot({
      now: NOW,
      league: leagueWith({ lastSyncedAt: new Date(NOW.getTime() - 3_600_000) }) as never,
    })
    expect(snap.dataConfidence).toBe('high')
  })

  it('a fresh sync does NOT rescue a league with no rosters', () => {
    const snap = buildCommissionerHealthSnapshot({
      now: NOW,
      league: leagueWith({ lastSyncedAt: NOW, rosters: [] }) as never,
    })
    expect(snap.dataConfidence).toBe('low')
  })

  it('accepts an ISO string as well as a Date', () => {
    const snap = buildCommissionerHealthSnapshot({
      now: NOW,
      league: leagueWith({ lastSyncedAt: NOW.toISOString() }) as never,
    })
    expect(snap.dataConfidence).toBe('high')
  })

  it('an unparseable timestamp is treated as never synced, never as fresh', () => {
    const snap = buildCommissionerHealthSnapshot({
      now: NOW,
      league: leagueWith({ lastSyncedAt: 'not-a-date' }) as never,
    })
    expect(snap.dataConfidence).toBe('low')
  })
})
