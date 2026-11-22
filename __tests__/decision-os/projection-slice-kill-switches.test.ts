import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Hub operability, 2026-11-20 re-score: `rosterProjections` and `leaguePlayerMetrics` stopped only when the whole
 * `projections` feed was killed. Each has its own switch now; killing one never touches the other or `projections`.
 */

const basis = vi.fn(async () => null)
const metrics = vi.fn(async () => null)
const projectionsFor = vi.fn(async () => null)

vi.mock('@/lib/decision-os/grounding/decisionBridge', () => ({
  loadWaiverDecisionSlice: vi.fn(async () => null),
  loadCommissionerHealthDecisionSlice: vi.fn(async () => null),
}))
vi.mock('@/lib/decision-os/grounding/rosterLeagueProjections', async (orig) => ({
  ...(await orig<object>()),
  loadRosterProjectionBasis: basis,
}))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: metrics }))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({ authorizeLeagueRead: vi.fn(async () => ({ authorized: true })) }))
vi.mock('@/lib/decision-os/import-os', () => ({ createImportOsLoaders: () => ({ loadAssertions: vi.fn(async () => null) }) }))
vi.mock('@/lib/decision-os/league-os', () => ({ createLeagueOsLoaders: () => ({ loadRules: vi.fn(async () => null) }) }))
vi.mock('@/lib/decision-os/value-os', () => ({
  createValueOsLoaders: () => ({ loadMarket: vi.fn(async () => null), loadDevy: vi.fn(async () => null) }),
}))
vi.mock('@/lib/decision-os/projection-os', () => ({ createProjectionOsLoaders: () => ({ loadFor: projectionsFor }) }))
vi.mock('@/lib/chimmy-context/ChimmyContextEngine', () => ({
  ChimmyContextEngine: class {
    loadContext = vi.fn(async () => {
      throw new Error('not under test')
    })
  },
}))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveCommissionerGroundingOutcome: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({ resolveLeagueIntelligenceGrounding: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({ resolvePortfolioGrounding: vi.fn(async () => null) }))
const killedFeeds = new Set<string>()
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: (f: string) => !killedFeeds.has(f), killed: [...killedFeeds] }),
}))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { DECISION_OS_FEEDS, decisionOsFeedEnvName } = await vi.importActual<typeof import('@/lib/decision-os/flags')>('@/lib/decision-os/flags')

const build = () =>
  buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, week: 11, want: { projections: true } })

describe('roster projections and league player metrics each have their own switch', () => {
  beforeEach(() => {
    killedFeeds.clear()
    basis.mockClear()
    metrics.mockClear()
    projectionsFor.mockClear()
  })

  it('are feeds an operator can switch, by their own env names', () => {
    expect(DECISION_OS_FEEDS).toContain('rosterProjections')
    expect(DECISION_OS_FEEDS).toContain('leaguePlayerMetrics')
    expect(decisionOsFeedEnvName('rosterProjections')).toBe('DECISION_OS_FEED_ROSTER_PROJECTIONS')
    expect(decisionOsFeedEnvName('leaguePlayerMetrics')).toBe('DECISION_OS_FEED_LEAGUE_PLAYER_METRICS')
  })

  it('control: with nothing killed, both read', async () => {
    await build()
    expect(basis).toHaveBeenCalled()
    expect(metrics).toHaveBeenCalled()
  })

  it('rosterProjections killed: a disabled gap, its reads skipped, metrics and projections untouched', async () => {
    killedFeeds.add('rosterProjections')
    const p = await build()
    expect(p.rosterProjections).toMatchObject({ present: false, gap: { reason: 'disabled' } })
    expect(basis).not.toHaveBeenCalled()
    expect(metrics).toHaveBeenCalled()
    expect(projectionsFor).toHaveBeenCalled()
  })

  it('leaguePlayerMetrics killed: its read skipped, roster projections and projections untouched', async () => {
    killedFeeds.add('leaguePlayerMetrics')
    await build()
    expect(metrics).not.toHaveBeenCalled()
    expect(basis).toHaveBeenCalled()
    expect(projectionsFor).toHaveBeenCalled()
  })

  it('projections killed still stops both, as before', async () => {
    killedFeeds.add('projections')
    await build()
    expect(basis).not.toHaveBeenCalled()
    expect(metrics).not.toHaveBeenCalled()
  })
})
