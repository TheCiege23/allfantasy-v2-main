import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveCanonicalPlayerIdMock, resolveCanonicalPlayerIdsMock } = vi.hoisted(() => ({
  resolveCanonicalPlayerIdMock: vi.fn(),
  resolveCanonicalPlayerIdsMock: vi.fn(),
}))

vi.mock('@/lib/league-import/playerIdResolver', () => ({
  resolveCanonicalPlayerId: resolveCanonicalPlayerIdMock,
  resolveCanonicalPlayerIds: resolveCanonicalPlayerIdsMock,
}))

describe('resolvePlayerIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps a direct Sleeper match to its matchedField', async () => {
    resolveCanonicalPlayerIdMock.mockResolvedValue({ canonicalId: 'player-abc', confidence: 'direct' })

    const { resolvePlayerIdentity } = await import('@/lib/shared-services/identity/PlayerIdentityService')
    const result = await resolvePlayerIdentity({ provider: 'sleeper', sourceId: '4046' })

    expect(result).toMatchObject({
      canonicalPlayerId: 'player-abc',
      confidence: 'direct',
      matchedProvider: 'sleeper',
      matchedField: 'sleeperId',
    })
    expect(result.sourceAttribution.sourceTable).toBe('PlayerIdentityMap')
  })

  it('maps a direct ESPN match to espnId', async () => {
    resolveCanonicalPlayerIdMock.mockResolvedValue({ canonicalId: 'player-xyz', confidence: 'direct' })

    const { resolvePlayerIdentity } = await import('@/lib/shared-services/identity/PlayerIdentityService')
    const result = await resolvePlayerIdentity({ provider: 'espn', sourceId: '999' })

    expect(result.matchedField).toBe('espnId')
  })

  it('reports no matchedField for a name-match fallback', async () => {
    resolveCanonicalPlayerIdMock.mockResolvedValue({ canonicalId: 'player-def', confidence: 'name_match' })

    const { resolvePlayerIdentity } = await import('@/lib/shared-services/identity/PlayerIdentityService')
    const result = await resolvePlayerIdentity({
      provider: 'yahoo',
      sourceId: 'yahoo-123',
      nameHint: 'Josh Allen',
    })

    expect(result.canonicalPlayerId).toBe('player-def')
    expect(result.confidence).toBe('name_match')
    expect(result.matchedField).toBeNull()
  })

  it('reports a miss with no canonical id and no matchedField', async () => {
    resolveCanonicalPlayerIdMock.mockResolvedValue({ canonicalId: null, confidence: 'miss' })

    const { resolvePlayerIdentity } = await import('@/lib/shared-services/identity/PlayerIdentityService')
    const result = await resolvePlayerIdentity({ provider: 'fantrax', sourceId: 'unknown-1' })

    expect(result.canonicalPlayerId).toBeNull()
    expect(result.confidence).toBe('miss')
    expect(result.matchedField).toBeNull()
  })
})

describe('resolvePlayerIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves per-source-id results across a bulk resolution', async () => {
    resolveCanonicalPlayerIdsMock.mockResolvedValue({
      'src-1': { canonicalId: 'player-1', confidence: 'direct' },
      'src-2': { canonicalId: null, confidence: 'miss' },
    })

    const { resolvePlayerIdentities } = await import('@/lib/shared-services/identity/PlayerIdentityService')
    const results = await resolvePlayerIdentities({ provider: 'mfl', sourceIds: ['src-1', 'src-2'] })

    expect(results['src-1']).toMatchObject({ canonicalPlayerId: 'player-1', matchedField: 'mflId' })
    expect(results['src-2']).toMatchObject({ canonicalPlayerId: null, matchedField: null })
  })
})
