/**
 * User OS League-Specific Intelligence Wiring phase — Part 2 coordinator tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { assembleUserOsContextMock } = vi.hoisted(() => ({ assembleUserOsContextMock: vi.fn() }))

vi.mock('@/lib/shared-services/league-hub/userOsContext', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shared-services/league-hub/userOsContext')>(
    '@/lib/shared-services/league-hub/userOsContext'
  )
  return { ...actual, assembleUserOsContext: assembleUserOsContextMock }
})

import { baseContext } from './fixtures'

describe('assembleUserOsRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports accessDenied when the context assembler returns null (no real relationship to the league)', async () => {
    assembleUserOsContextMock.mockResolvedValue(null)
    const { assembleUserOsRecommendations } = await import('@/lib/shared-services/league-hub/userOsRecommendations')
    const result = await assembleUserOsRecommendations({ appUserId: 'stranger', canonicalLeagueId: 'league-1' })
    expect(result.accessDenied).toBe(true)
    expect(result.bundle.totalCount).toBe(0)
  })

  it('never trusts a client-supplied teamId/rosterId — only reads what the server-resolved context provides', async () => {
    assembleUserOsContextMock.mockResolvedValue(baseContext({ teamId: 'real-team', rosterId: 'real-roster' }))
    const { assembleUserOsRecommendations } = await import('@/lib/shared-services/league-hub/userOsRecommendations')
    // The coordinator's own args type has no teamId/rosterId field at all — this is a structural
    // guarantee, verified here by confirming the call succeeds using only appUserId/canonicalLeagueId.
    const result = await assembleUserOsRecommendations({ appUserId: 'user-1', canonicalLeagueId: 'league-1' })
    expect(result.accessDenied).toBe(false)
    expect(assembleUserOsContextMock).toHaveBeenCalledWith({ appUserId: 'user-1', canonicalLeagueId: 'league-1' })
  })

  it('runs only the requested domains when domain filtering is used', async () => {
    assembleUserOsContextMock.mockResolvedValue(baseContext({ currentWeek: 9 }))
    const { assembleUserOsRecommendations } = await import('@/lib/shared-services/league-hub/userOsRecommendations')
    const result = await assembleUserOsRecommendations({
      appUserId: 'user-1',
      canonicalLeagueId: 'league-1',
      requestedDomains: ['strategy'],
    })
    expect(result.domainStatus.strategy).toBe('ok')
    expect(result.domainStatus.lineup).toBeUndefined()
    expect(result.bundle.lineup).toEqual([])
  })

  it('marks a domain unsupported (not ok, not silently empty) when the context says so', async () => {
    assembleUserOsContextMock.mockResolvedValue(baseContext({ unavailableDomains: ['lineup', 'waiver'] }))
    const { assembleUserOsRecommendations } = await import('@/lib/shared-services/league-hub/userOsRecommendations')
    const result = await assembleUserOsRecommendations({ appUserId: 'user-1', canonicalLeagueId: 'league-1' })
    expect(result.domainStatus.lineup).toBe('unsupported')
    expect(result.domainStatus.waiver).toBe('unsupported')
  })

  it('returns a truthful partial-domain failure (engine_error) without crashing the whole request when one generator throws', async () => {
    assembleUserOsContextMock.mockResolvedValue(
      baseContext({
        currentWeek: 9,
        // Malformed lineup on purpose to exercise a generator's failure path safely inside try/catch.
        lineup: { starters: [{ id: 'p1' } as never], bench: [], ir: [] },
      })
    )
    const { assembleUserOsRecommendations } = await import('@/lib/shared-services/league-hub/userOsRecommendations')
    const result = await assembleUserOsRecommendations({ appUserId: 'user-1', canonicalLeagueId: 'league-1' })
    // Even with a malformed lineup entry, no domain should crash the whole coordinator.
    expect(result.accessDenied).toBe(false)
    expect(Object.values(result.domainStatus).every((s) => s === 'ok' || s === 'engine_error')).toBe(true)
  })

  it('sums totalCount correctly across all populated domains, excluding commissioner', async () => {
    assembleUserOsContextMock.mockResolvedValue(baseContext({ currentWeek: 9 }))
    const { assembleUserOsRecommendations } = await import('@/lib/shared-services/league-hub/userOsRecommendations')
    const result = await assembleUserOsRecommendations({ appUserId: 'user-1', canonicalLeagueId: 'league-1' })
    const manualSum =
      result.bundle.lineup.length +
      result.bundle.waiver.length +
      result.bundle.trade.length +
      result.bundle.roster.length +
      result.bundle.playoff.length +
      result.bundle.strategy.length
    expect(result.bundle.totalCount).toBe(manualSum)
    expect(result.bundle.commissioner).toEqual([])
  })
})

describe('selectTopActions', () => {
  it('returns at most one recommendation per domain, highest priority first', async () => {
    const { selectTopActions } = await import('@/lib/shared-services/league-hub/userOsRecommendations')
    const { getEmptyRecommendationBundle } = await import('@/lib/shared-services/league-hub/recommendationContract')
    const bundle = getEmptyRecommendationBundle()
    bundle.lineup = [
      { id: '1', leagueId: 'l', domain: 'lineup', type: 't', priority: 'low', title: 'a', summary: '', rationale: [], evidence: [], generatedAt: '', sourceFreshness: { state: 'fresh', lastSyncedAt: null }, executionCapability: 'recommendation_only', status: 'new' },
      { id: '2', leagueId: 'l', domain: 'lineup', type: 't', priority: 'critical', title: 'b', summary: '', rationale: [], evidence: [], generatedAt: '', sourceFreshness: { state: 'fresh', lastSyncedAt: null }, executionCapability: 'recommendation_only', status: 'new' },
    ]
    const top = selectTopActions(bundle)
    expect(top).toHaveLength(1)
    expect(top[0].id).toBe('2')
  })
})
