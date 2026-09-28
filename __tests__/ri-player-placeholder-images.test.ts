import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE BUG THIS PINS: filtering the INCOMING headshot is not enough to heal a stored one.
 *
 * Rolling Insights answers a missing headshot with the literal `contact_support`. Filtering it
 * on the way in stops new bad rows, but `syncRollingInsightsPlayersToDb` only writes `imageUrl`
 * when the vendor sent a real one — so a row that already holds `contact_support` is never
 * overwritten, because the vendor never sends a picture for that player. 9,555 NFL rows on
 * production (2026-09-25) would have stayed broken forever.
 */

const { riFetchRowsMock, updateManyMock, upsertMock } = vi.hoisted(() => ({
  riFetchRowsMock: vi.fn(),
  updateManyMock: vi.fn(),
  upsertMock: vi.fn(),
}))

vi.mock('@/lib/workers/providers/rollingInsightsRest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workers/providers/rollingInsightsRest')>()
  return { ...actual, riFetchRows: riFetchRowsMock }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsTeam: { upsert: vi.fn().mockResolvedValue({}) },
    sportsPlayer: { upsert: upsertMock, updateMany: updateManyMock },
  },
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

type StrFilter = { not?: null; startsWith?: string; mode?: 'insensitive' }
type Where = {
  sport: string
  source: string
  imageUrl: StrFilter
  NOT: Array<{ imageUrl: StrFilter }>
}

/** Evaluate the subset of Prisma's string filter this module uses, the way Postgres would. */
function matchesString(value: string | null, f: StrFilter): boolean {
  if ('not' in f && f.not === null && value === null) return false
  if (f.startsWith != null) {
    if (value == null) return false
    return f.mode === 'insensitive'
      ? value.toLowerCase().startsWith(f.startsWith.toLowerCase())
      : value.startsWith(f.startsWith)
  }
  return true
}

function wouldClear(where: Where, row: { sport: string; source: string; imageUrl: string | null }): boolean {
  if (row.sport !== where.sport || row.source !== where.source) return false
  if (!matchesString(row.imageUrl, where.imageUrl)) return false
  return where.NOT.every((n) => !matchesString(row.imageUrl, n.imageUrl))
}

async function whereClause(): Promise<Where> {
  updateManyMock.mockResolvedValue({ count: 0 })
  const { clearPlaceholderRiImageUrls } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')
  await clearPlaceholderRiImageUrls('NFL')
  return updateManyMock.mock.calls[0]![0].where as Where
}

describe('clearPlaceholderRiImageUrls — which stored values it clears', () => {
  const row = (imageUrl: string | null, over: Partial<{ sport: string; source: string }> = {}) => ({
    sport: 'NFL',
    source: 'rolling_insights',
    imageUrl,
    ...over,
  })

  it.each([
    ['contact_support'],
    ['N/A'],
    ['null'],
    ['3f2a1c9e-1111-2222-3333-444455556666.png'],
    ['headshot.png'],
  ])('clears a non-URL value %j', async (value) => {
    expect(wouldClear(await whereClause(), row(value))).toBe(true)
  })

  it.each([
    ['https://cdn.example.test/p/1.png'],
    ['HTTPS://CDN.EXAMPLE.TEST/P/1.PNG'],
    ['http://cdn.example.test/p/1.png'],
    ['/images/players/1.png'],
    ['//cdn.example.test/p/1.png'],
    ['data:image/png;base64,AAAA'],
  ])('keeps a real image link %j', async (value) => {
    expect(wouldClear(await whereClause(), row(value))).toBe(false)
  })

  it('leaves an already-empty headshot alone (no pointless write)', async () => {
    expect(wouldClear(await whereClause(), row(null))).toBe(false)
  })

  it('never touches another provider or another sport', async () => {
    const where = await whereClause()
    expect(wouldClear(where, row('contact_support', { source: 'espn' }))).toBe(false)
    expect(wouldClear(where, row('contact_support', { sport: 'NBA' }))).toBe(false)
  })

  it('only ever writes null', async () => {
    await whereClause()
    expect(updateManyMock.mock.calls[0]![0].data).toEqual({ imageUrl: null })
  })
})

describe('syncRollingInsightsPlayersToDb heals stored placeholders', () => {
  it('clears before the sweep and reports the count', async () => {
    updateManyMock.mockResolvedValue({ count: 9555 })
    upsertMock.mockResolvedValue({})
    riFetchRowsMock.mockResolvedValue({ rows: [], notModified: false, error: null })

    const { syncRollingInsightsPlayersToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')
    const res = await syncRollingInsightsPlayersToDb({ sport: 'nfl' })

    expect(updateManyMock).toHaveBeenCalledTimes(1)
    expect(updateManyMock.mock.calls[0]![0].where).toMatchObject({ sport: 'NFL', source: 'rolling_insights' })
    expect(res.placeholderImagesCleared).toBe(9555)
    expect(res.errors).toEqual([])
  })

  it('a failed cleanup is reported and does not stop the sweep', async () => {
    updateManyMock.mockRejectedValue(new Error('db down'))
    upsertMock.mockResolvedValue({})
    riFetchRowsMock.mockResolvedValue({
      rows: [{ player_id: '1', player: 'A Player', img: 'https://cdn.example.test/1.png' }],
      notModified: false,
      error: null,
    })

    const { syncRollingInsightsPlayersToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')
    const res = await syncRollingInsightsPlayersToDb({ sport: 'NFL' })

    expect(res.placeholderImagesCleared).toBe(0)
    expect(res.errors.some((e) => e.includes('clear placeholder images: db down'))).toBe(true)
    expect(res.written).toBe(1)
  })
})
