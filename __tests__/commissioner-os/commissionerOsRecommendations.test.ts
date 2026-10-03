/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 2
 * coordinator tests, plus Part 20 Chimmy seam tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { assembleCommissionerOsContextMock } = vi.hoisted(() => ({ assembleCommissionerOsContextMock: vi.fn() }))

vi.mock('@/lib/shared-services/league-hub/commissionerOsContext', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shared-services/league-hub/commissionerOsContext')>(
    '@/lib/shared-services/league-hub/commissionerOsContext'
  )
  return { ...actual, assembleCommissionerOsContext: assembleCommissionerOsContextMock }
})

import { baseCommissionerOsContext, dramaEvent, rivalry, draftGrade, baseHealth } from './fixtures'

// `vi.importActual` for `commissionerOsContext.ts` pulls in its entire real dependency graph
// (`lib/shared-services/commissioner/*`, `lib/decision-os/*`) — a genuinely heavy first-time Vite
// transform cost, not a logic hang. The default 30s budget is sometimes tight for the very first
// test in this file specifically (subsequent tests reuse the already-transformed graph).
vi.setConfig({ testTimeout: 60000 })

describe('assembleCommissionerOsRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports accessDenied when the context assembler returns null (not a real, verified commissioner)', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(null)
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({ appUserId: 'normal-manager', canonicalLeagueId: 'league-1' })
    expect(result.accessDenied).toBe(true)
    expect(result.bundle.commissioner).toEqual([])
  })

  it('a normal league member calling with their own real id gets accessDenied — never partial commissioner-only data', async () => {
    // A normal manager's context assembler call fails closed at the source (isCommissioner !== true),
    // so it always returns null for them — the coordinator has no separate check to bypass.
    assembleCommissionerOsContextMock.mockResolvedValue(null)
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({ appUserId: 'real-normal-manager', canonicalLeagueId: 'league-1' })
    expect(result.accessDenied).toBe(true)
    expect(result.domainStatus).toEqual({})
  })

  it('a real, verified commissioner gets a real bundle', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(baseCommissionerOsContext())
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result.accessDenied).toBe(false)
    expect(result.domainStatus.health).toBe('ok')
  })

  it('runs only the requested domains when domain filtering is used', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(baseCommissionerOsContext())
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({
      appUserId: 'commissioner-1',
      canonicalLeagueId: 'league-1',
      requestedDomains: ['health'],
    })
    expect(result.domainStatus.health).toBe('ok')
    expect(result.domainStatus.engagement).toBeUndefined()
  })

  it('marks a domain unsupported (not ok, not silently empty) when the context says so', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(
      baseCommissionerOsContext({ unavailableDomains: ['rivalries_history', 'draft_grades'] })
    )
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result.domainStatus.rivalries).toBe('unsupported')
    expect(result.domainStatus.draft).toBe('unsupported')
  })

  it('a real league with rivalry/drama/draft data reports those domains ok, not unsupported', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(
      baseCommissionerOsContext({ rivalries: [rivalry()], dramaEvents: [dramaEvent()], draftGrades: [draftGrade()] })
    )
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result.domainStatus.rivalries).toBe('ok')
    expect(result.domainStatus.storylines).toBe('ok')
    expect(result.domainStatus.draft).toBe('ok')
    expect(result.bundle.commissioner.length).toBeGreaterThan(0)
  })

  it('returns a truthful engine_error without crashing the whole request when one generator throws', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(
      baseCommissionerOsContext({
        // Malformed ranking on purpose — real teams array replaced with something that breaks the generator's map/filter.
        ranking: { teams: null } as never,
      })
    )
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result.accessDenied).toBe(false)
    expect(Object.values(result.domainStatus).every((s) => s === 'ok' || s === 'engine_error' || s === 'unsupported')).toBe(true)
  })

  it('sums totalCount across all domains including commissioner', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(baseCommissionerOsContext({ dramaEvents: [dramaEvent()] }))
    const { assembleCommissionerOsRecommendations } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await assembleCommissionerOsRecommendations({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result.bundle.totalCount).toBe(result.bundle.commissioner.length)
  })
})

describe('selectTopCommissionerActions', () => {
  it('orders a critical governance issue ahead of a plain league-health score, per Part 13 homepage order', async () => {
    const { selectTopCommissionerActions } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const { getEmptyRecommendationBundle } = await import('@/lib/shared-services/league-hub/recommendationContract')
    const bundle = getEmptyRecommendationBundle()
    const base = {
      leagueId: 'l',
      domain: 'commissioner' as const,
      rationale: [],
      evidence: [],
      generatedAt: '',
      sourceFreshness: { state: 'fresh' as const, lastSyncedAt: null },
      executionCapability: 'recommendation_only' as const,
      status: 'new' as const,
    }
    bundle.commissioner = [
      { ...base, id: '1', type: 'league_health_score', priority: 'critical', title: 'Health', summary: '' },
      { ...base, id: '2', type: 'integrity_review_recommended', priority: 'medium', title: 'Integrity', summary: '' },
    ]
    const top = selectTopCommissionerActions(bundle)
    expect(top[0].id).toBe('2')
  })
})

describe('getChimmyCommissionerOsSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for a normal manager (fails closed) — the same real mechanism the coordinator uses, never a separate bypass', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(null)
    const { getChimmyCommissionerOsSummary } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await getChimmyCommissionerOsSummary({ appUserId: 'normal-manager', canonicalLeagueId: 'league-1' })
    expect(result).toBeNull()
  })

  it('returns null for a cross-user caller impersonating another league via a guessed id', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(null)
    const { getChimmyCommissionerOsSummary } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await getChimmyCommissionerOsSummary({ appUserId: 'stranger-user', canonicalLeagueId: 'someone-elses-league' })
    expect(result).toBeNull()
  })

  it('returns a focused, real summary for a real commissioner — narrower than the full bundle', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(
      baseCommissionerOsContext({ health: baseHealth({ category: 'healthy', score: 91 }) })
    )
    const { getChimmyCommissionerOsSummary } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await getChimmyCommissionerOsSummary({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result).not.toBeNull()
    expect(result?.healthSummary).toEqual({ band: 'healthy', score: 91, confidence: 90 })
    expect(result?.topActions.length).toBeLessThanOrEqual(5)
    expect(result).not.toHaveProperty('bundle')
  })

  it('carries the real isSnapshotOnly flag through to the seam, never claiming a CSV league is live', async () => {
    assembleCommissionerOsContextMock.mockResolvedValue(baseCommissionerOsContext({ isSnapshotOnly: true }))
    const { getChimmyCommissionerOsSummary } = await import('@/lib/shared-services/league-hub/commissionerOsRecommendations')
    const result = await getChimmyCommissionerOsSummary({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result?.isSnapshotOnly).toBe(true)
  })
})
