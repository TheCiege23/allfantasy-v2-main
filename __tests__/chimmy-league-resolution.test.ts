import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaLeagueFindManyMock = vi.fn()
const getAiMemoryMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: prismaLeagueFindManyMock,
    },
  },
}))

vi.mock('@/lib/ai-memory/ai-memory-store', () => ({
  getAiMemory: getAiMemoryMock,
}))

function makeLeague(overrides: Partial<{
  id: string
  name: string | null
  season: number
  platform: string
  platformLeagueId: string
  timezone: string | null
  lastSyncedAt: Date | null
  teams: Array<{ ownerName: string; teamName: string }>
}> = {}) {
  return {
    id: overrides.id ?? 'league-1',
    name: overrides.name ?? 'Dynasty Kings',
    season: overrides.season ?? 2026,
    platform: overrides.platform ?? 'sleeper',
    platformLeagueId: overrides.platformLeagueId ?? 'pl-1',
    timezone: overrides.timezone ?? 'America/New_York',
    lastSyncedAt: overrides.lastSyncedAt ?? new Date('2026-04-25T12:00:00.000Z'),
    teams: overrides.teams ?? [{ ownerName: 'Alex Kim', teamName: 'Kings Court' }],
  }
}

describe('chimmy league resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaLeagueFindManyMock.mockResolvedValue([])
    getAiMemoryMock.mockResolvedValue(null)
  })

  it('selects by alias from coaching_profile.leagueAliases', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      makeLeague({ id: 'league-a', name: 'Dynasty Kings' }),
      makeLeague({ id: 'league-b', name: 'Sunday Squad' }),
    ])
    getAiMemoryMock.mockResolvedValueOnce({
      leagueAliases: {
        dk: 'league-a',
      },
    })

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({
      userId: 'user-1',
      message: 'what is the draft order in dk?',
    })

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') throw new Error('expected selected')
    expect(result.leagueId).toBe('league-a')
    expect(result.source).toBe('alias')
    expect(result.confidence).toBe(0.97)
  })

  it('returns ambiguous when top scores are too close', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      makeLeague({ id: 'league-a', name: 'Kings League' }),
      makeLeague({ id: 'league-b', name: 'Kings Legacy' }),
      makeLeague({ id: 'league-c', name: 'Other League' }),
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({
      userId: 'user-1',
      message: 'kings',
    })

    expect(result.kind).toBe('ambiguous')
    if (result.kind !== 'ambiguous') throw new Error('expected ambiguous')
    expect(result.choices.length).toBeGreaterThan(1)
    /*
     * ⚠ THE MESSAGE MUST NAME THEM. It used to say only "I found multiple
     * league matches", which is a question the reader cannot answer — the
     * candidate names were computed into `choices` and then thrown away. This
     * asserts the INTENT (the names are in the sentence) rather than a fixed
     * wording, so improving the phrasing does not turn it red again.
     */
    for (const choice of result.choices) {
      expect(result.message).toContain(choice.leagueName)
    }
    expect(result.message).toMatch(/which of those/i)
  })

  it('falls back to the only accessible league when no textual match', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      makeLeague({ id: 'league-only', name: 'Only League' }),
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({
      userId: 'user-1',
      message: 'what happened this week?',
    })

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') throw new Error('expected selected')
    expect(result.leagueId).toBe('league-only')
    expect(result.source).toBe('fallback_single')
    expect(result.confidence).toBe(0.86)
  })

  it('asks for league when user has multiple leagues and no match', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      makeLeague({ id: 'league-a', name: 'Dynasty Kings' }),
      makeLeague({ id: 'league-b', name: 'Sunday Squad' }),
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({
      userId: 'user-1',
      message: 'help me with waivers',
    })

    expect(result.kind).toBe('ask')
    if (result.kind !== 'ask') throw new Error('expected ask')
    expect(result.choices.length).toBe(2)
    expect(result.message).toMatch(/which league/i)
  })
})

describe('chimmy manager ambiguity', () => {
  it('returns ambiguous when multiple managers match the same token', async () => {
    const { detectManagerAmbiguity } = await import('@/lib/chimmy/chimmy-league-resolution')

    const result = detectManagerAmbiguity({
      message: "alex's team trade history",
      league: {
        teams: [
          { ownerName: 'Alex Kim', teamName: 'Kings Court' },
          { ownerName: 'Alex Reed', teamName: 'Reed Raiders' },
          { ownerName: 'Jordan Cole', teamName: 'Cole Train' },
        ],
      },
    })

    expect(result.kind).toBe('ambiguous')
    if (result.kind !== 'ambiguous') throw new Error('expected ambiguous')
    expect(result.options.length).toBe(2)
    expect(result.message).toMatch(/multiple manager matches/i)
  })

  it('returns ok when manager token does not map to multiple teams', async () => {
    const { detectManagerAmbiguity } = await import('@/lib/chimmy/chimmy-league-resolution')

    const result = detectManagerAmbiguity({
      message: 'show manager jordan trade history',
      league: {
        teams: [
          { ownerName: 'Alex Kim', teamName: 'Kings Court' },
          { ownerName: 'Jordan Cole', teamName: 'Cole Train' },
        ],
      },
    })

    expect(result).toEqual({ kind: 'ok' })
  })
})

describe('chimmy staleness and source references', () => {
  it('returns staleness warning when sync is older than intent threshold', async () => {
    const { buildChimmyStalenessWarning } = await import('@/lib/chimmy/chimmy-league-resolution')

    const result = buildChimmyStalenessWarning({
      lastSyncedAt: new Date('2026-04-25T11:45:00.000Z'),
      intent: 'trade',
      now: new Date('2026-04-25T12:00:00.000Z'),
    })

    expect(result.thresholdMinutes).toBe(5)
    expect(result.staleMinutes).toBe(15)
    expect(result.warning).toMatch(/may be stale|stale/i)
  })

  it('returns no warning when data is within freshness threshold', async () => {
    const { buildChimmyStalenessWarning } = await import('@/lib/chimmy/chimmy-league-resolution')

    const result = buildChimmyStalenessWarning({
      lastSyncedAt: new Date('2026-04-25T11:58:00.000Z'),
      intent: 'draft',
      now: new Date('2026-04-25T12:00:00.000Z'),
    })

    expect(result.thresholdMinutes).toBe(15)
    expect(result.staleMinutes).toBe(2)
    expect(result.warning).toBeNull()
  })

  it('builds intent-specific source references', async () => {
    const { buildChimmySourceReferences } = await import('@/lib/chimmy/chimmy-league-resolution')

    const refs = buildChimmySourceReferences({ leagueId: 'league-123', intent: 'trade' })

    expect(refs).toEqual(
      expect.arrayContaining([
        { label: 'League Home', href: '/league/league-123' },
        { label: 'League Settings', href: '/league/league-123/settings' },
        { label: 'Trade Center', href: '/league/league-123?tab=trades' },
      ]),
    )
  })
})
