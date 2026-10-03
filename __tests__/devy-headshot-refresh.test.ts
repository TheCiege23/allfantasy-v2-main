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
const identityFindFirst = vi.fn()
const playerFindUnique = vi.fn()
const playerUpdate = vi.fn()
const writePrimaryPlayerImage = vi.fn()
const isPlaceholderHeadshot = vi.fn()

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
    playerProviderIdentity: { findFirst: (...a: unknown[]) => identityFindFirst(...a) },
    player: {
      findUnique: (...a: unknown[]) => playerFindUnique(...a),
      update: (...a: unknown[]) => playerUpdate(...a),
    },
  },
}))
vi.mock('@/lib/player-assets/playerImageStore', () => ({
  PLAYER_IMAGE_TYPE_HEADSHOT: 'headshot',
  writePrimaryPlayerImage: (...a: unknown[]) => writePrimaryPlayerImage(...a),
}))
vi.mock('@/lib/player-assets/apiSportsPlaceholder', () => ({
  isPlaceholderHeadshot: (...a: unknown[]) => isPlaceholderHeadshot(...a),
}))

const ESPN = (id: string) => `https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png`
const API_SPORTS = 'https://media.api-sports.io/american-football/players/60595.png'

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
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    findMany.mockReset()
    update.mockReset().mockResolvedValue({})
    identityFindFirst.mockReset().mockResolvedValue({ playerId: 'ncaaf-player-1' })
    playerFindUnique.mockReset().mockResolvedValue({ imageUrl: API_SPORTS })
    playerUpdate.mockReset().mockResolvedValue({})
    writePrimaryPlayerImage.mockReset().mockResolvedValue({ written: true })
    isPlaceholderHeadshot.mockReset().mockResolvedValue(false)
  })

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
  })

  it('selects rows holding an api-sports URL, not only empty ones', async () => {
    // 4,728 of 5,226 CFBD rows held a name-matched api-sports URL — mostly its stock
    // "image not available" picture — so a NULL-only drain never reached them.
    findMany.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn())

    const { refreshCollegeSportsPlayerHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    await refreshCollegeSportsPlayerHeadshots(budget() as never)

    const args = findMany.mock.calls[0]?.[0] as {
      where?: { OR?: unknown[] }
      orderBy?: Record<string, string>
    }
    expect(args.where?.OR).toEqual([
      { imageUrl: null },
      { imageUrl: { startsWith: 'https://media.api-sports.io/' } },
    ])
    // Rotation: misses are touched (below), so ordering must be by updatedAt.
    expect(args.orderBy).toEqual({ updatedAt: 'asc' })
  })

  it('still refuses a URL the CDN did not serve as an image', async () => {
    findMany.mockResolvedValue([{ id: 'sp1', externalId: '5194306', imageUrl: null }])
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(404, 'text/html', '1')))

    const { refreshCollegeSportsPlayerHeadshots } = await import(
      '@/lib/devy/devyHeadshotRefresh'
    )
    const r = await refreshCollegeSportsPlayerHeadshots(budget() as never)
    expect(r.written).toBe(0)
    expect(r.missing).toBe(1)
    // The miss is touched so it rotates to the back — but no URL is stored.
    expect(update).toHaveBeenCalledTimes(1)
    expect((update.mock.calls[0]?.[0] as { data: { imageUrl: unknown } }).data.imageUrl).toBeNull()
    expect(writePrimaryPlayerImage).not.toHaveBeenCalled()
  })

  it('replaces an api-sports URL with the verified ESPN photo, and the canonical cache too', async () => {
    findMany.mockResolvedValue([{ id: 'sp2', externalId: '4880203', imageUrl: API_SPORTS }])
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(200, 'image/png', '261636')))

    const { refreshCollegeSportsPlayerHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    const r = await refreshCollegeSportsPlayerHeadshots(budget() as never)

    expect(r.written).toBe(1)
    expect(update.mock.calls[0]?.[0]).toEqual({ where: { id: 'sp2' }, data: { imageUrl: ESPN('4880203') } })
    // Linked by the cfbd identity row, never by name.
    expect((identityFindFirst.mock.calls[0]?.[0] as { where: unknown }).where).toEqual({
      provider: 'cfbd',
      sportKey: 'NCAAF',
      providerPlayerId: '4880203',
      playerId: { not: null },
    })
    expect(playerUpdate).toHaveBeenCalledWith({
      where: { id: 'ncaaf-player-1' },
      data: { imageUrl: ESPN('4880203') },
    })
    expect(writePrimaryPlayerImage).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'ncaaf-player-1', url: ESPN('4880203'), provider: 'espn' }),
    )
  })

  it('does not overwrite a canonical image that came from somewhere else', async () => {
    findMany.mockResolvedValue([{ id: 'sp3', externalId: '4590295', imageUrl: null }])
    playerFindUnique.mockResolvedValue({
      imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/abc.png',
    })
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(200, 'image/png', '254626')))

    const { refreshCollegeSportsPlayerHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    await refreshCollegeSportsPlayerHeadshots(budget() as never)

    expect(playerUpdate, 'clobbered a non-api-sports canonical image').not.toHaveBeenCalled()
  })

  it('on an ESPN miss, drops a CONFIRMED placeholder', async () => {
    findMany.mockResolvedValue([{ id: 'sp4', externalId: '5198328', imageUrl: API_SPORTS }])
    isPlaceholderHeadshot.mockResolvedValue(true)
    vi.stubGlobal('fetch', vi.fn(async () => headResponse(404, 'text/html', '1')))

    const { refreshCollegeSportsPlayerHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
    await refreshCollegeSportsPlayerHeadshots(budget() as never)

    expect(update).toHaveBeenCalledWith({ where: { id: 'sp4' }, data: { imageUrl: null } })
  })

  it('on an ESPN miss, KEEPS an api-sports URL that is real or could not be checked', async () => {
    for (const verdict of [false, null]) {
      update.mockClear()
      findMany.mockResolvedValue([{ id: 'sp5', externalId: '5198328', imageUrl: API_SPORTS }])
      isPlaceholderHeadshot.mockResolvedValue(verdict)
      vi.stubGlobal('fetch', vi.fn(async () => headResponse(404, 'text/html', '1')))

      const { refreshCollegeSportsPlayerHeadshots } = await import('@/lib/devy/devyHeadshotRefresh')
      await refreshCollegeSportsPlayerHeadshots(budget() as never)

      expect(update, `verdict ${verdict}`).toHaveBeenCalledWith({
        where: { id: 'sp5' },
        data: { imageUrl: API_SPORTS },
      })
    }
  })
})
