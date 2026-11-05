import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ rules: vi.fn(), team: vi.fn(), identities: vi.fn(), grade: vi.fn(), injury: vi.fn(), lineup: vi.fn(), weekly: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: h.rules }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveAiTeamContext: h.team }))
vi.mock('@/lib/player-identity/resolveRosterPlayerIdentities', () => ({ resolveRosterPlayerIdentities: h.identities }))
vi.mock('@/lib/core-app/rosterGrade', () => ({ getRosterGrade: h.grade }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.injury }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: h.lineup }))
vi.mock('@/lib/chimmy/portfolio/weeklyStrength', () => ({ weeklyLeagueStrength: h.weekly }))
import { loadPortfolioTeam } from '@/lib/chimmy/portfolio/data'

const league = { id: 'a', name: 'KBFL', sport: 'NFL', season: 2026 }
const context = () => ({ ok: true, context: { platform: 'sleeper', sourceType: 'imported_sleeper',
  matchupPeriod: { currentPeriod: 9 }, roster: { starters: ['QB'] }, team: { externalId: '1', platformUserId: 's1' },
  flags: { isDynasty: true, bestBallMode: false }, scoring: { pointsByStat: { pass_td: 6, rec: 0.5 } },
  importHealth: { mappingOk: true, lastSyncedAt: new Date().toISOString() } } })
beforeEach(() => {
  vi.resetAllMocks()
  h.rules.mockResolvedValue(context())
  h.team.mockResolvedValue({ teamName: 'Own team', platformUserId: 's1', starters: [{ playerId: '17', name: 'Josh Allen', position: 'QB', team: 'BUF' }], bench: [], injuredReserve: [], taxi: [], dataGaps: [] })
  h.identities.mockResolvedValue(new Map())
  h.grade.mockResolvedValue({ rank: 2, outOf: 12, pricedPlayers: 1, totalPlayers: 1, weakest: { position: 'QB', rank: 2, outOf: 12 }, basis: { leagueScored: true, capturedAt: new Date().toISOString() } })
  h.injury.mockResolvedValue({ byPlayer: new Map(), coverage: { sourceAvailable: true }, feedStale: false })
  h.lineup.mockResolvedValue({ status: 'unresolved' })
  h.weekly.mockResolvedValue(null)
})

describe('portfolio roster evidence', () => {
  it('reuses the shared rank under verified scoring and correct horizon', async () => {
    const result = await loadPortfolioTeam(league, 'u1', 'season')
    expect(h.grade).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'a', isDynasty: false, scoringSettings: { pass_td: 6, rec: 0.5 } }))
    expect(result.rank).toBe(2)
    expect(result.metrics.find(m => m.key === 'strength')?.value).toBe(91)
    await loadPortfolioTeam(league, 'u1', 'dynasty')
    expect(h.grade).toHaveBeenLastCalledWith(expect.objectContaining({ isDynasty: true }))
  })
  it('does not read rosters when the league rules/membership resolver fails', async () => {
    h.rules.mockResolvedValue({ ok: false })
    const result = await loadPortfolioTeam(league, 'u1', 'season')
    expect(result.status).toBe('unavailable')
    expect(h.team).not.toHaveBeenCalled()
    expect(h.grade).not.toHaveBeenCalled()
  })
  it('marks unclaimed, empty, and not-yet-drafted teams distinctly', async () => {
    h.team.mockResolvedValue(null)
    expect((await loadPortfolioTeam(league, 'u1', 'season')).status).toBe('unclaimed')
    h.team.mockResolvedValue({ starters: [], bench: [], injuredReserve: [], taxi: [] })
    expect((await loadPortfolioTeam(league, 'u1', 'season')).status).toBe('empty')
    expect((await loadPortfolioTeam({ ...league, status: 'pre_draft' }, 'u1', 'season')).status).toBe('not_drafted')
  })
  it('uses the provider identity namespace rather than a colliding numeric Sleeper name', async () => {
    const c = context(); c.context.platform = 'espn'; h.rules.mockResolvedValue(c)
    const result = await loadPortfolioTeam(league, 'u1', 'season')
    expect(h.identities).toHaveBeenCalledWith('espn', 'NFL', ['17'])
    expect(result.status).toBe('partial')
    expect(result.gaps.join(' ')).toContain('could not be fully identified')
    expect(h.injury).toHaveBeenCalledWith({ sport: 'NFL', players: [] })
  })
  it('keeps native teams readable without fabricating an external sync timestamp', async () => {
    const c = context(); c.context.platform = 'manual'; c.context.sourceType = 'native_af'; c.context.importHealth.lastSyncedAt = null as unknown as string
    h.rules.mockResolvedValue(c)
    const result = await loadPortfolioTeam(league, 'u1', 'season')
    expect(result.stale).toBe(false)
    expect(result.lastSyncedAt).toBeNull()
    expect(h.identities).toHaveBeenCalledWith('allfantasy', 'NFL', ['17'])
  })
  it('does not turn an unavailable or stale injury feed into zero injured players', async () => {
    h.injury.mockResolvedValue({ byPlayer: new Map(), coverage: { sourceAvailable: true }, feedStale: true })
    const result = await loadPortfolioTeam(league, 'u1', 'season')
    expect(result.metrics.find(m => m.key === 'injuries')?.value).toBeNull()
    expect(result.gaps.join(' ')).toMatch(/injury feed is stale/)
  })
  it('does not recommend manually setting starters in best ball', async () => {
    const c = context(); c.context.flags.bestBallMode = true; h.rules.mockResolvedValue(c)
    const result = await loadPortfolioTeam(league, 'u1', 'season')
    expect(h.lineup).not.toHaveBeenCalled()
    expect(result.actions.some(a => a.label === 'Review lineup')).toBe(false)
    expect(result.metrics.some(m => m.detail.includes('automatically'))).toBe(true)
  })
})
