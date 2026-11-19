// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ league: vi.fn(), pool: vi.fn(), legality: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findFirst: h.league },
  roster: { findFirst: async () => ({ id: 'r1', playerData: [], faabRemaining: 100 }), findMany: async () => [] },
  leagueWaiverSettings: { findUnique: async () => ({}) },
  sportsPlayer: { findMany: async () => [{ name: 'Nikola Jokic', externalId: '114', source: 'rolling_insights', status: 'ACT', team: 'DEN', fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) }] },
} }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: h.pool }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'faab' }) }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForProjectedRoster: h.legality }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ computePerPlayerKickoffLocks: () => ({ lockedPlayerIds: [] }) }))
import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'
beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ id: 'nba', sport: 'NBA', leagueVariant: 'redraft', isDynasty: false, rosterSize: 10, lockAllMoves: false, lifecycleState: 'setup' })
  h.pool.mockResolvedValue([
    { full_name: 'A.J. Hammons', position: 'C', player_id: 'old', external_source_id: '563' },
    { full_name: 'Nikola Jokic', position: 'C', player_id: 'current', external_source_id: '114' },
  ])
  h.legality.mockResolvedValue(null)
})
describe('authoritative NBA waiver transaction gate', () => {
  it('rejects a retired profile even when submitted directly rather than selected in the UI', async () => {
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId: 'old' })).rejects.toThrow('verified current NBA roster')
    expect(h.legality).not.toHaveBeenCalled()
  })
  it.each(['current', '114'])('retains existing roster-legality checks for verified id %s', async addPlayerId => {
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId })).resolves.toBeUndefined()
    expect(h.legality).toHaveBeenCalledOnce()
  })
  it('does not change non-NBA transaction eligibility', async () => {
    h.league.mockResolvedValue({ ...(await h.league()), sport: 'NFL' })
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId: 'football-player' })).resolves.toBeUndefined()
    expect(h.pool).not.toHaveBeenCalled()
  })
})

describe('an empty starting slot never blocks a claim', () => {
  const legality = (codes: string[]) => ({
    result: {
      blockingReasons: codes.map((code) => ({ code, message: code === 'STARTER_SLOT_EMPTY_WHEN_REQUIRED' ? 'Not enough starters (22/23).' : 'Bench is over its limit.' })),
      irViolations: [], taxiViolations: [], devyViolations: [],
    },
  })
  it('a roster already one starter short can still claim — the gap is reported, not enforced', async () => {
    h.league.mockResolvedValue({ ...(await h.league()), sport: 'NFL' })
    h.legality.mockResolvedValue(legality(['STARTER_SLOT_EMPTY_WHEN_REQUIRED']))
    const notices: string[] = []
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId: 'football-player', onNotice: (n: string) => notices.push(n) } as never)).resolves.toBeUndefined()
    expect(notices).toContain('Not enough starters (22/23).')
  })
  it('every other legality problem still blocks', async () => {
    h.league.mockResolvedValue({ ...(await h.league()), sport: 'NFL' })
    h.legality.mockResolvedValue(legality(['STARTER_SLOT_EMPTY_WHEN_REQUIRED', 'BENCH_OVER_LIMIT']))
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId: 'football-player' })).rejects.toThrow('Bench is over its limit.')
  })
})
