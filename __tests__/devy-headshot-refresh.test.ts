import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * `DevyPlayer.headshotUrl` was 0 of 1,718 and `SportsPlayer` NCAAF was 66 of
 * 73,883, so every college player card rendered blank. The id to fix it was
 * already on the row: `cfbdId` is an ESPN athlete id, and ESPN's public CDN
 * serves college headshots keyed on exactly that.
 *
 * The risk in deriving a URL is that a 404 becomes a stored value — it looks
 * like data, passes every null check, and renders a broken image. These tests
 * pin that a URL is written ONLY when the CDN actually served an image.
 */
const findMany = vi.fn()
const update = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    devyPlayer: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
    sportsPlayer: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}))

const budget = (remainingMs = 240_000) => ({
  exhausted: () => remainingMs <= 0,
  remainingMs: () => remainingMs,
  elapsedMs: () => 0,
})

function headResponse(status: number, type: string, length: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([
      ['content-type', type],
      ['content-length', length],
    ]),
  } as unknown as Response
}

describe('devy headshots', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    findMany.mockReset()
    update.mockReset().mockResolvedValue({})
  })

  it('writes the ESPN url when the CDN really serves an image', async () => {
    findMany.mockResolvedValue([{ id: 'p1', cfbdId: '5079720' }])
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(200, 'image/png', '271665')))

    const { refreshDevyHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    const r = await refreshDevyHeadshots(budget() as never)

    expect(r.written).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    const data = (update.mock.calls[0]?.[0] as { data?: { headshotUrl?: string } })?.data
    expect(data?.headshotUrl).toBe(
      'https://a.espncdn.com/i/headshots/college-football/players/full/5079720.png',
    )
  })

  it('leaves NULL on a 404 rather than storing a broken link', async () => {
    // The measured miss: Tradon Bessinger, id 5282580. A 404 here still returns
    // a body — 1 byte of text/html — so "it responded" is not evidence.
    findMany.mockResolvedValue([{ id: 'p2', cfbdId: '5282580' }])
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(404, 'text/html', '1')))

    const { refreshDevyHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    const r = await refreshDevyHeadshots(budget() as never)

    expect(r.missing).toBe(1)
    expect(r.written).toBe(0)
    expect(update, 'stored a URL that 404s').not.toHaveBeenCalled()
  })

  it('rejects a 200 that is not actually an image', async () => {
    // A CDN that starts serving an HTML error page with status 200 would
    // otherwise fill every row with a link to a placeholder.
    findMany.mockResolvedValue([{ id: 'p3', cfbdId: '999' }])
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(200, 'text/html', '54000')))

    const { refreshDevyHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    const r = await refreshDevyHeadshots(budget() as never)

    expect(r.written).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an image too small to be a photo', async () => {
    findMany.mockResolvedValue([{ id: 'p4', cfbdId: '888' }])
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(200, 'image/png', '43')))

    const { refreshDevyHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    const r = await refreshDevyHeadshots(budget() as never)

    expect(r.written).toBe(0)
  })

  it('treats a network failure as unknown, not as absent', async () => {
    findMany.mockResolvedValue([{ id: 'p5', cfbdId: '777' }])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))

    const { refreshDevyHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    const r = await refreshDevyHeadshots(budget() as never)

    // Row stays NULL, so the next tick retries it. The failure must not be
    // recorded as "this player has no photo".
    expect(update).not.toHaveBeenCalled()
    expect(r.missing).toBe(1)
  })

  it('only ever considers players that still lack a headshot', async () => {
    findMany.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn())

    const { refreshDevyHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    await refreshDevyHeadshots(budget() as never)

    const where = (findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> })?.where
    expect(where?.headshotUrl).toBeNull()
    expect(where?.cfbdId).toEqual({ not: null })
  })

  it('defers instead of starting work it cannot finish', async () => {
    findMany.mockResolvedValue([{ id: 'p6', cfbdId: '123' }])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { refreshDevyHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    const r = await refreshDevyHeadshots(budget(5_000) as never)

    expect(r.deferred).toBe(true)
    expect(fetchMock, 'made requests it had no budget to finish').not.toHaveBeenCalled()
  })
})

describe('college SportsPlayer headshots', () => {
  it('only touches CFBD-sourced rows — RI ids are a DIFFERENT id space', async () => {
    // SportsPlayer.externalId means different things per source. CFBD rows hold
    // the ESPN athlete id; the 68,637 Rolling Insights rows hold RI's own
    // internal id (e.g. '340'). Feeding an RI id to the ESPN CDN either 404s or
    // resolves to somebody else entirely.
    findMany.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn())

    const { refreshCollegeSportsPlayerHeadshots } = await import(
      '@/lib/devy/devyHeadshotRefresh'
    )
    await refreshCollegeSportsPlayerHeadshots(budget() as never)

    const where = (findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> })?.where
    expect(where?.source, 'would have fed RI ids to the ESPN CDN').toBe('cfbd')
    expect(where?.sport).toBe('NCAAF')
    expect(where?.imageUrl).toBeNull()
  })

  it('still refuses a URL the CDN did not serve as an image', async () => {
    findMany.mockResolvedValue([{ id: 'sp1', externalId: '5194306' }])
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(404, 'text/html', '1')))

    const { refreshCollegeSportsPlayerHeadshots } = await import(
      '@/lib/devy/devyHeadshotRefresh'
    )
    const r = await refreshCollegeSportsPlayerHeadshots(budget() as never)
    expect(r.written).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })
})
