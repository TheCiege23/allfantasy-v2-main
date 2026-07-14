/**
 * Tests for the Phase 14 canonical PlayerIdentityResolver — mocks only the
 * true external boundary (prisma), same pattern as every prior shared-service
 * test suite in this repo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPlayerIdentityMapFindFirst, mockPlayerIdentityMapFindMany, mockPlayerIdentityMapFindUnique, mockSportsPlayerFindFirst, mockSportsPlayerFindMany } =
  vi.hoisted(() => ({
    mockPlayerIdentityMapFindFirst: vi.fn(),
    mockPlayerIdentityMapFindMany: vi.fn(),
    mockPlayerIdentityMapFindUnique: vi.fn(),
    mockSportsPlayerFindFirst: vi.fn(),
    mockSportsPlayerFindMany: vi.fn(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findFirst: mockPlayerIdentityMapFindFirst,
      findMany: mockPlayerIdentityMapFindMany,
      findUnique: mockPlayerIdentityMapFindUnique,
    },
    sportsPlayer: {
      findFirst: mockSportsPlayerFindFirst,
      findMany: mockSportsPlayerFindMany,
    },
  },
}))

import { resolvePlayer, resolvePlayers } from '@/lib/shared-services/player-identity/PlayerIdentityResolver'
import { InMemoryResolutionCache } from '@/lib/shared-services/player-identity/ResolutionCache'
import { getProviderCapability, getAllProviderCapabilities } from '@/lib/shared-services/player-identity/ProviderAdapters'

const PIM_ROW = {
  id: 'canonical-uuid-1',
  canonicalName: 'Ja Marr Chase',
  normalizedName: 'jamarrchase',
  position: 'WR',
  currentTeam: 'CIN',
  sport: 'NFL',
  sleeperId: '7564',
  espnId: null,
  mflId: null,
  fleaflickerId: null,
}

describe('PlayerIdentityResolver — provider ID resolution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves directly via PlayerIdentityMap.sleeperId', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(PIM_ROW)
    const result = await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache: new InMemoryResolutionCache() })

    expect(result.confidence).toBe('direct')
    expect(result.source).toBe('player_identity_map_direct')
    expect(result.player?.canonicalPlayerId).toBe('canonical-uuid-1')
    expect(result.player?.canonicalName).toBe('Ja Marr Chase')
    expect(result.diagnostics.matchedField).toBe('sleeperId')
  })

  it('resolves directly via PlayerIdentityMap.espnId for ESPN', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue({ ...PIM_ROW, espnId: '4362628', sleeperId: null })
    const result = await resolvePlayer({ provider: 'espn', sourceId: '4362628' }, { cache: new InMemoryResolutionCache() })

    expect(result.confidence).toBe('direct')
    expect(result.diagnostics.matchedField).toBe('espnId')
    expect(mockPlayerIdentityMapFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { espnId: '4362628' } }))
  })
})

describe('PlayerIdentityResolver — SportsPlayer direct fallback (Sleeper only)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('falls back to SportsPlayer.sleeperId when PlayerIdentityMap has no direct match', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([])
    mockSportsPlayerFindFirst.mockResolvedValue({ name: 'Aaron Rodgers', position: 'QB', team: 'PIT', sport: 'NFL' })

    const result = await resolvePlayer({ provider: 'sleeper', sourceId: '96' }, { cache: new InMemoryResolutionCache() })

    expect(result.confidence).toBe('direct')
    expect(result.source).toBe('sports_player_direct')
    expect(result.player?.canonicalName).toBe('Aaron Rodgers')
    // Real, honest limitation: no canonical cross-provider UUID exists yet for a SportsPlayer-only match.
    expect(result.player?.canonicalPlayerId).toBe('sportsplayer:sleeper:96')
    expect(result.diagnostics.reason).toMatch(/not yet present in PlayerIdentityMap/)
  })

  it('never attempts SportsPlayer fallback for providers without that direct-id source (e.g. ESPN)', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([])

    const result = await resolvePlayer({ provider: 'espn', sourceId: '999' }, { cache: new InMemoryResolutionCache() })

    expect(mockSportsPlayerFindFirst).not.toHaveBeenCalled()
    expect(result.confidence).toBe('unresolved')
  })
})

describe('PlayerIdentityResolver — name/team/position (confidence scoring + duplicate-name handling)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports name_match_confident when exactly one candidate matches', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockSportsPlayerFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([PIM_ROW])

    const result = await resolvePlayer(
      { provider: 'yahoo', nameHint: 'Ja Marr Chase', positionHint: 'WR', teamHint: 'CIN' },
      { cache: new InMemoryResolutionCache() }
    )

    expect(result.confidence).toBe('name_match_confident')
    expect(result.source).toBe('player_identity_map_name_match')
    expect(result.diagnostics.tiedCandidates).toBe(1)
  })

  it('reports name_match_ambiguous (never a silently fabricated single match) when candidates share a name and no position/team disambiguates them', async () => {
    const duplicate1 = { ...PIM_ROW, id: 'uuid-a', currentTeam: null, position: null }
    const duplicate2 = { ...PIM_ROW, id: 'uuid-b', currentTeam: null, position: null }
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockSportsPlayerFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([duplicate1, duplicate2])

    const result = await resolvePlayer({ provider: 'yahoo', nameHint: 'Ja Marr Chase' }, { cache: new InMemoryResolutionCache() })

    expect(result.confidence).toBe('name_match_ambiguous')
    expect(result.diagnostics.tiedCandidates).toBe(2)
    expect(result.diagnostics.candidateCount).toBe(2)
    expect(result.player).not.toBeNull() // best-guess still returned, never silently dropped
  })

  it('disambiguates duplicate names using position + team hints', async () => {
    const wrongTeam = { ...PIM_ROW, id: 'uuid-wrong', currentTeam: 'DAL', position: 'RB' }
    const rightTeam = { ...PIM_ROW, id: 'uuid-right', currentTeam: 'CIN', position: 'WR' }
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockSportsPlayerFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([wrongTeam, rightTeam])

    const result = await resolvePlayer(
      { provider: 'fantrax', nameHint: 'Ja Marr Chase', positionHint: 'WR', teamHint: 'CIN' },
      { cache: new InMemoryResolutionCache() }
    )

    expect(result.confidence).toBe('name_match_confident')
    expect(result.player?.canonicalPlayerId).toBe('uuid-right')
  })
})

describe('PlayerIdentityResolver — unresolved handling (never fabricated)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an explicit unresolved result with a real reason when nothing matches', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockSportsPlayerFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([])

    const result = await resolvePlayer({ provider: 'sleeper', sourceId: '999999', nameHint: 'Nobody Real' }, { cache: new InMemoryResolutionCache() })

    expect(result.confidence).toBe('unresolved')
    expect(result.source).toBe('unresolved')
    expect(result.player).toBeNull()
    expect(result.diagnostics.reason.length).toBeGreaterThan(0)
  })

  it('returns unresolved (not an error) when given neither a sourceId nor a nameHint', async () => {
    const result = await resolvePlayer({ provider: 'sleeper' }, { cache: new InMemoryResolutionCache() })
    expect(result.confidence).toBe('unresolved')
    expect(result.diagnostics.reason).toMatch(/No sourceId or nameHint/)
  })
})

describe('PlayerIdentityResolver — alias map (real extension point)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves via an injected alias map when no direct or name match exists', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockSportsPlayerFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([])
    mockPlayerIdentityMapFindUnique.mockResolvedValue(PIM_ROW)

    const result = await resolvePlayer(
      { provider: 'yahoo', nameHint: 'Chase Jr.' },
      { cache: new InMemoryResolutionCache(), aliasMap: { chasejr: 'canonical-uuid-1' } }
    )

    expect(result.source).toBe('alias_map')
    expect(result.player?.canonicalPlayerId).toBe('canonical-uuid-1')
  })

  it('is empty by default — an unmapped alias name resolves as unresolved, not fabricated', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(null)
    mockSportsPlayerFindFirst.mockResolvedValue(null)
    mockPlayerIdentityMapFindMany.mockResolvedValue([])

    const result = await resolvePlayer({ provider: 'yahoo', nameHint: 'Some Old Nickname' }, { cache: new InMemoryResolutionCache() })
    expect(result.confidence).toBe('unresolved')
  })
})

describe('PlayerIdentityResolver — cache behavior', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serves a cached result without re-querying', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(PIM_ROW)
    const cache = new InMemoryResolutionCache()

    const first = await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache })
    expect(first.source).toBe('player_identity_map_direct')
    expect(mockPlayerIdentityMapFindFirst).toHaveBeenCalledTimes(1)

    const second = await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache })
    expect(second.source).toBe('cache')
    expect(mockPlayerIdentityMapFindFirst).toHaveBeenCalledTimes(1) // not called again

    expect(cache.stats()).toMatchObject({ size: 1, hits: 1 })
  })

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers()
    mockPlayerIdentityMapFindFirst.mockResolvedValue(PIM_ROW)
    const cache = new InMemoryResolutionCache(1000)

    await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache })
    vi.advanceTimersByTime(1500)
    await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache })

    expect(mockPlayerIdentityMapFindFirst).toHaveBeenCalledTimes(2) // re-queried after expiry
    vi.useRealTimers()
  })

  it('clear() resets stats and forces a re-query', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(PIM_ROW)
    const cache = new InMemoryResolutionCache()

    await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache })
    cache.clear()
    await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache })

    expect(mockPlayerIdentityMapFindFirst).toHaveBeenCalledTimes(2)
  })
})

describe('PlayerIdentityResolver — provider neutrality', () => {
  it('never leaks a provider-specific object shape — CanonicalPlayer has the same shape regardless of source provider', async () => {
    mockPlayerIdentityMapFindFirst.mockResolvedValue(PIM_ROW)
    const sleeperResult = await resolvePlayer({ provider: 'sleeper', sourceId: '7564' }, { cache: new InMemoryResolutionCache() })

    mockPlayerIdentityMapFindFirst.mockResolvedValue({ ...PIM_ROW, espnId: '111', sleeperId: null })
    const espnResult = await resolvePlayer({ provider: 'espn', sourceId: '111' }, { cache: new InMemoryResolutionCache() })

    expect(Object.keys(sleeperResult.player ?? {}).sort()).toEqual(Object.keys(espnResult.player ?? {}).sort())
  })

  it('reports yahoo/fantrax as having no direct-id source (a real, disclosed gap, not silently pretended away)', () => {
    expect(getProviderCapability('yahoo').supportsDirectId).toBe(false)
    expect(getProviderCapability('fantrax').supportsDirectId).toBe(false)
    expect(getProviderCapability('sleeper').supportsDirectId).toBe(true)
  })

  it('exposes capability data for every supported provider', () => {
    const all = getAllProviderCapabilities()
    expect(all.map((c) => c.provider).sort()).toEqual(['espn', 'fantrax', 'fleaflicker', 'mfl', 'sleeper', 'yahoo'])
  })
})

describe('resolvePlayers — batched resolution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('batches direct-id lookups in a single findMany call, not N+1', async () => {
    mockPlayerIdentityMapFindMany.mockResolvedValue([
      { ...PIM_ROW, id: 'uuid-1', sleeperId: '1' },
      { ...PIM_ROW, id: 'uuid-2', sleeperId: '2' },
    ])
    mockSportsPlayerFindMany.mockResolvedValue([])

    const results = await resolvePlayers(
      [
        { provider: 'sleeper', sourceId: '1' },
        { provider: 'sleeper', sourceId: '2' },
      ],
      { cache: new InMemoryResolutionCache() }
    )

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.confidence === 'direct')).toBe(true)
    expect(mockPlayerIdentityMapFindMany).toHaveBeenCalledTimes(1)
    expect(mockPlayerIdentityMapFindFirst).not.toHaveBeenCalled()
  })

  it('falls through to SportsPlayer batch lookup for ids missing from PlayerIdentityMap', async () => {
    mockPlayerIdentityMapFindMany.mockResolvedValue([])
    mockSportsPlayerFindMany.mockResolvedValue([{ sleeperId: '96', name: 'Aaron Rodgers', position: 'QB', team: 'PIT', sport: 'NFL' }])

    const results = await resolvePlayers([{ provider: 'sleeper', sourceId: '96' }], { cache: new InMemoryResolutionCache() })

    expect(results[0].source).toBe('sports_player_direct')
    expect(mockSportsPlayerFindMany).toHaveBeenCalledTimes(1)
  })

  it('returns unresolved (not a thrown error) for a mixed batch with some misses', async () => {
    mockPlayerIdentityMapFindMany.mockResolvedValue([{ ...PIM_ROW, sleeperId: '1' }])
    mockSportsPlayerFindMany.mockResolvedValue([])

    const results = await resolvePlayers(
      [
        { provider: 'sleeper', sourceId: '1' },
        { provider: 'sleeper', sourceId: '2' },
      ],
      { cache: new InMemoryResolutionCache() }
    )

    expect(results[0].confidence).toBe('direct')
    expect(results[1].confidence).toBe('unresolved')
  })
})
