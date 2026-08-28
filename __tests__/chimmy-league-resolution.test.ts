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
    /*
     * ⚠ THIS DEFAULTED TO A SHARED 'pl-1' FOR EVERY LEAGUE, which is not what
     * production looks like: `platformLeagueId` is the PROVIDER's league id and
     * is unique per league. Once the resolver started collapsing duplicate
     * imports on that id, the shared default made three distinct leagues in a
     * fixture read as one. Deriving it from the id keeps distinct leagues
     * distinct; tests that mean to model one league imported twice set it
     * explicitly.
     */
    platformLeagueId: overrides.platformLeagueId ?? `pl-${overrides.id ?? 'league-1'}`,
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

/*
 * ⚠ ONE REAL LEAGUE IMPORTED TWICE PRODUCED A QUESTION NOBODY COULD ANSWER.
 *
 * Asked "is Bauer Sharp on waivers in KBFL?", Chimmy replied:
 *   I found more than one league that could match: "KBFL" (2026), "KBFL" (2026).
 *   Which of those do you mean?
 * followed by "Chimmy could not read your league for this answer." Two identical
 * labels, no way to choose, conversation dead-ended.
 *
 * Both production rows carry platformLeagueId 1338541390891606016 and season
 * 2026 — the same Sleeper league imported by two different accounts.
 * `getPortfolio` already collapsed this; the resolver never learned to.
 */
describe('one real league imported twice is one league', () => {
  const READER = 'user-1'

  function kbfl(over: Record<string, unknown> = {}) {
    return makeLeague({
      id: 'kbfl-mine',
      name: 'KBFL',
      season: 2026,
      platformLeagueId: '1338541390891606016',
      ...over,
    } as never)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getAiMemoryMock.mockResolvedValue(null)
  })

  it('does not ask the reader to choose between two identical labels', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      { ...kbfl({ id: 'kbfl-theirs' }), userId: 'someone-else' },
      { ...kbfl(), userId: READER },
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({
      userId: READER,
      message: 'is Bauer Sharp on waivers in KBFL?',
    })

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') throw new Error('expected selected')
    expect(result.leagueId).toBe('kbfl-mine')
  })

  /* The reader's own import is the one their other surfaces already use. */
  it('keeps the copy the reader imported', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      { ...kbfl({ id: 'kbfl-theirs' }), userId: 'someone-else' },
      { ...kbfl(), userId: READER },
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({ userId: READER, message: 'KBFL' })
    if (result.kind !== 'selected') throw new Error('expected selected')
    expect(result.leagueId).toBe('kbfl-mine')
  })

  /*
   * ⚠ TWO COPIES ALSO DEFEATED `fallback_single`, the rule that answers without
   * a name when the reader has exactly one league. Collapsing at the loader
   * restores it.
   */
  it('restores the single-league fallback', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      { ...kbfl(), userId: READER },
      { ...kbfl({ id: 'kbfl-theirs' }), userId: 'someone-else' },
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({
      userId: READER,
      message: 'what happened this week?',
    })

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') throw new Error('expected selected')
    expect(result.source).toBe('fallback_single')
  })

  /*
   * ⚠ COLLAPSE ON THE PROVIDER'S ID, NEVER THE NAME. Measured 2026-08-28: only
   * two production groups share a platform id, but SEVEN name+season groups
   * exist — "AF Test ADP #002" has five copies with five DISTINCT platform ids.
   * Those are real separate leagues and merging them would hide four.
   */
  it('does not merge same-named leagues with different platform ids', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      { ...makeLeague({ id: 'a', name: 'AF Test ADP #002', platformLeagueId: 'p-1' } as never), userId: READER },
      { ...makeLeague({ id: 'b', name: 'AF Test ADP #002', platformLeagueId: 'p-2' } as never), userId: READER },
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({ userId: READER, message: 'AF Test ADP #002' })

    expect(result.kind).not.toBe('selected')
    if (result.kind === 'selected') throw new Error('must stay ambiguous')
    expect(result.choices.length).toBe(2)
  })

  /* Season is in the key: a provider reusing an id across years is two leagues. */
  it('keeps different seasons of the same platform league', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      { ...kbfl(), userId: READER },
      { ...kbfl({ id: 'kbfl-2025', season: 2025 }), userId: READER },
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({ userId: READER, message: 'KBFL' })

    if (result.kind === 'selected') throw new Error('two seasons must not collapse')
    expect(result.choices.length).toBe(2)
  })

  /* No provider id means no evidence two rows are the same thing. */
  it('never collapses rows with no platformLeagueId', async () => {
    prismaLeagueFindManyMock.mockResolvedValueOnce([
      { ...makeLeague({ id: 'a', name: 'KBFL', platformLeagueId: '' } as never), userId: READER },
      { ...makeLeague({ id: 'b', name: 'KBFL', platformLeagueId: '' } as never), userId: READER },
    ])

    const { resolveChimmyLeagueSelection } = await import('@/lib/chimmy/chimmy-league-resolution')
    const result = await resolveChimmyLeagueSelection({ userId: READER, message: 'KBFL' })

    if (result.kind === 'selected') throw new Error('must stay ambiguous')
    expect(result.choices.length).toBe(2)
  })
})
