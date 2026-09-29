/**
 * Milestone 32 guard: manager characterisation labels are shown to nobody.
 *
 * The drama engine used to write profile labels into REBUILD_PROGRESS prose, and
 * relationship insights returned whole profiles (labels, trait scores, behaviour
 * heat) to the client and to LLM prompts. Each test here first proves its path
 * actually ran (a positive control), then asserts no label vocabulary survives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_LABELS } from '@/lib/psychological-profiles/types'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  seasonResultFindMany: vi.fn(),
  matchupFactFindMany: vi.fn(),
  simulationFindMany: vi.fn(),
  dynastyProjectionFindMany: vi.fn(),
  dynastySeasonFindMany: vi.fn(),
  tradeHistoryFindMany: vi.fn(),
  dramaEventFindMany: vi.fn(),
  dramaEventFindUnique: vi.fn(),
  dramaTimelineFindFirst: vi.fn(),
  listRivalries: vi.fn(),
  listProfilesByLeague: vi.fn(),
  getDramaCentralTeams: vi.fn(),
  buildLeagueRelationshipProfile: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    seasonResult: { findMany: mocks.seasonResultFindMany },
    matchupFact: { findMany: mocks.matchupFactFindMany },
    seasonSimulationResult: { findMany: mocks.simulationFindMany },
    dynastyProjection: { findMany: mocks.dynastyProjectionFindMany },
    leagueDynastySeason: { findMany: mocks.dynastySeasonFindMany },
    leagueTradeHistory: { findMany: mocks.tradeHistoryFindMany },
    dramaEvent: { findMany: mocks.dramaEventFindMany, findUnique: mocks.dramaEventFindUnique },
    dramaTimelineRecord: { findFirst: mocks.dramaTimelineFindFirst },
  },
}))
vi.mock('@/lib/rivalry-engine/RivalryQueryService', () => ({ listRivalries: mocks.listRivalries }))
vi.mock('@/lib/psychological-profiles/ManagerBehaviorQueryService', () => ({
  listProfilesByLeague: mocks.listProfilesByLeague,
}))
vi.mock('@/lib/league-intelligence-graph/GraphQueryService', () => ({
  getDramaCentralTeams: mocks.getDramaCentralTeams,
}))
vi.mock('@/lib/league-intelligence-graph', () => ({
  buildLeagueRelationshipProfile: mocks.buildLeagueRelationshipProfile,
}))
vi.mock('@/lib/relationship-insights/GraphRivalryBridge', () => ({
  syncRivalryEdgesIntoGraph: vi.fn().mockResolvedValue(null),
}))

const LEGACY_SUMMARY =
  'Behavior profile (patient rebuilder, rookie-heavy, win-now) now aligns with upward competitive signals.'

function profile(managerId: string) {
  return {
    id: `profile-${managerId}`,
    leagueId: 'league-1',
    managerId,
    sport: 'NFL',
    sportLabel: 'NFL',
    profileLabels: [...PROFILE_LABELS],
    aggressionScore: 71,
    activityScore: 82,
    tradeFrequencyScore: 64,
    waiverFocusScore: 43,
    riskToleranceScore: 58,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }
}

function dramaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'drama-1',
    leagueId: 'league-1',
    sport: 'NFL',
    season: 2026,
    dramaType: 'REBUILD_PROGRESS',
    headline: 'Rebuild watch: mgr-1 is gaining traction',
    summary: LEGACY_SUMMARY,
    relatedManagerIds: ['mgr-1'],
    relatedTeamIds: ['mgr-1'],
    relatedMatchupId: null,
    dramaScore: 61,
    createdAt: new Date('2026-09-02T00:00:00Z'),
    ...overrides,
  }
}

function findLabels(text: string): string[] {
  const lower = text.toLowerCase()
  return PROFILE_LABELS.filter((label) => lower.includes(label))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leagueFindUnique.mockResolvedValue({
    id: 'league-1',
    season: 2026,
    platform: 'espn',
    platformLeagueId: null,
    teams: [{ id: 'team-1', externalId: 'mgr-1', teamName: 'Team One', ownerName: 'Owner One' }],
  })
  mocks.seasonResultFindMany.mockResolvedValue([])
  mocks.matchupFactFindMany.mockResolvedValue([])
  mocks.simulationFindMany.mockResolvedValue([
    { weekOrPeriod: 5, teamId: 'mgr-1', playoffProbability: 0.45, createdAt: new Date() },
    { weekOrPeriod: 4, teamId: 'mgr-1', playoffProbability: 0.2, createdAt: new Date() },
  ])
  mocks.dynastyProjectionFindMany.mockResolvedValue([])
  mocks.dynastySeasonFindMany.mockResolvedValue([])
  mocks.tradeHistoryFindMany.mockResolvedValue([])
  mocks.dramaEventFindMany.mockResolvedValue([dramaRow()])
  mocks.dramaEventFindUnique.mockResolvedValue(dramaRow())
  mocks.dramaTimelineFindFirst.mockResolvedValue(null)
  mocks.listRivalries.mockResolvedValue([])
  mocks.listProfilesByLeague.mockResolvedValue([profile('mgr-1')])
  mocks.getDramaCentralTeams.mockResolvedValue([])
  mocks.buildLeagueRelationshipProfile.mockResolvedValue({
    strongestRivalries: [],
    influenceLeaders: [],
    centralManagers: [],
  })
})

describe('drama engine — no profile label reaches a drama summary', () => {
  it('a newly detected REBUILD_PROGRESS event states the measured odds, never the labels', async () => {
    const { detectDramaEvents } = await import('@/lib/drama-engine/DramaEventDetector')
    const candidates = await detectDramaEvents({ leagueId: 'league-1', sport: 'NFL', season: 2026 })
    const rebuild = candidates.find((c) => c.dramaType === 'REBUILD_PROGRESS')
    // Positive control: the label-keyed path genuinely ran.
    expect(rebuild).toBeDefined()
    expect(rebuild!.summary).toBe('Playoff odds moved from 20% to 45% since the previous simulation.')
    for (const c of candidates) {
      expect(findLabels(`${c.headline} ${c.summary}`)).toEqual([])
    }
  })

  it('a stored legacy summary is projected label-free on every read path', async () => {
    const { listDramaEvents, getDramaEventById } = await import('@/lib/drama-engine/DramaQueryService')
    const { buildTimelineForLeague } = await import('@/lib/drama-engine/DramaTimelineBuilder')
    const listed = await listDramaEvents('league-1')
    const single = await getDramaEventById('drama-1')
    const timeline = await buildTimelineForLeague('league-1')
    for (const event of [...listed, single!, ...timeline]) {
      expect(event.summary).toBe('Competitive signals are trending upward.')
      expect(findLabels(event.summary ?? '')).toEqual([])
    }
  })

  it('leaves unrelated drama prose untouched', async () => {
    const { publicDramaSummary } = await import('@/lib/drama-engine/publicNarrative')
    const prose = 'An aggressive comeback: Team One 132 – 98 Team Two.'
    expect(publicDramaSummary(prose)).toBe(prose)
    expect(publicDramaSummary(null)).toBeNull()
  })
})

describe('relationship insights — coverage and facts only', () => {
  it('the API payload carries no labels, trait scores or behaviour heat', async () => {
    mocks.listRivalries.mockResolvedValue([
      { id: 'rivalry-1', managerAId: 'mgr-1', managerBId: 'mgr-2', rivalryScore: 74, rivalryTier: 'heated', sport: 'NFL' },
    ])
    const { getUnifiedRelationshipInsights } = await import('@/lib/relationship-insights/RelationshipQueryService')
    const insights = await getUnifiedRelationshipInsights({ leagueId: 'league-1', season: 2026 })
    // Positive control: a profiled manager with linked drama, and a storyline whose
    // score behaviour heat still feeds, are in the payload.
    expect(insights.storylines.length).toBeGreaterThan(0)
    expect(insights.profiles).toEqual([{ id: 'profile-mgr-1', managerId: 'mgr-1' }])
    expect(insights.behaviorDramaContext[0]?.managerId).toBe('mgr-1')
    expect(insights.behaviorDramaContext[0]?.dramaEvents.length).toBeGreaterThan(0)
    const json = JSON.stringify(insights)
    expect(findLabels(json)).toEqual([])
    expect(json).not.toMatch(/profileLabels|aggressionScore|activityScore|riskToleranceScore|behaviorHeat|Behavior heat/)
  })

  it('the LLM prompt context carries no labels, trait scores or behaviour heat', async () => {
    const { buildAIRelationshipContext } = await import('@/lib/relationship-insights/AIRelationshipContextResolver')
    const { promptContext } = await buildAIRelationshipContext({ leagueId: 'league-1', season: 2026 })
    expect(promptContext).toContain('"managerId":"mgr-1"')
    expect(findLabels(promptContext)).toEqual([])
    expect(promptContext).not.toMatch(/labels|activityScore|behaviorHeat/)
  })
})
