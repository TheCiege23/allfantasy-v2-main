/**
 * Commit 11 — Route redirect coverage
 *
 * Verifies that all legacy live-snake draft entry points redirect to
 * /drafts/[draftId], while mock, auction, lottery, and bigscreen behavior
 * is left unchanged.
 *
 * All tests are source-level or unit-level (no DB, no render, no Playwright).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — shared across all route page imports in this file
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() =>
  vi.fn(async () => ({ user: { id: 'user-1' } } as null | { user?: { id?: string } })),
)

const resolveDraftRouteContextMock = vi.hoisted(() => vi.fn(async () => null as any))

const prismaMock = vi.hoisted(() => ({
  draftSession: {
    findFirst: vi.fn(async () => null as any),
    upsert: vi.fn(async () => ({ id: 'session-ds' })),
  },
  league: {
    findFirst: vi.fn(async () => null as any),
  },
}))

const canAccessLeagueMock = vi.hoisted(() => vi.fn(async () => true))
const getDraftIdFromSettingsMock = vi.hoisted(() => vi.fn(() => null as string | null))
const draftBoardMock = vi.hoisted(() => vi.fn((_props: unknown) => null))

class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`)
  }
}

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/draft/resolve-draft-context', () => ({
  resolveDraftRouteContext: (...a: unknown[]) => resolveDraftRouteContextMock(...a),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/draft/access', () => ({
  canAccessLeague: (...a: unknown[]) => canAccessLeagueMock(...a),
}))
vi.mock('@/app/league/[leagueId]/components/league-settings-modal-utils', () => ({
  getDraftIdFromSettings: (s: unknown) => getDraftIdFromSettingsMock(s),
}))
vi.mock('@/components/draft/DraftBoard', () => ({
  DraftBoard: (props: unknown) => draftBoardMock(props),
}))

// ---------------------------------------------------------------------------
// Page imports (after mocks are registered)
// ---------------------------------------------------------------------------

const DraftRouterPage = (await import('@/app/draft/[draftId]/page')).default
const SnakeDraftPage = (await import('@/app/draft/[draftId]/snake/page')).default
const DraftRoomPage = (await import('@/app/draft/room/[draftId]/page')).default
const LiveDraftPage = (await import('@/app/draft/live/[draftId]/page')).default
const LeagueDraftPage = (await import('@/app/league/[leagueId]/draft/page')).default

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const liveSnakeCtx = (overrides: Record<string, unknown> = {}) => ({
  kind: 'live' as const,
  draftId: 'session-1',
  leagueId: 'league-1',
  leagueName: 'My League',
  sport: 'NFL',
  isDynasty: false,
  isCommissioner: false,
  formatType: undefined,
  routeType: 'snake' as const,
  draftType: 'snake',
  status: 'in_progress',
  ...overrides,
})

const mockCtx = () => ({
  kind: 'mock' as const,
  draftId: 'mock-1',
  sport: 'NFL',
  leagueName: 'Mock',
  routeType: 'snake' as const,
  draftType: 'snake',
  status: 'pre_draft',
})

const draftIdCtx = (id = 'session-1') => ({ params: Promise.resolve({ draftId: id }) })

// ---------------------------------------------------------------------------
// /draft/[draftId] — dispatcher
// ---------------------------------------------------------------------------

describe('/draft/[draftId] dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    draftBoardMock.mockReturnValue(null)
  })

  it('redirects live snake draft to /drafts/[draftId]', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeCtx())
    await expect(DraftRouterPage(draftIdCtx())).rejects.toMatchObject({
      to: '/drafts/session-1',
    })
  })

  it('redirects mock draft to /mock-draft?draftId=... (unchanged)', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(mockCtx())
    await expect(DraftRouterPage(draftIdCtx('mock-1'))).rejects.toMatchObject({
      to: '/mock-draft?draftId=mock-1',
    })
  })

  it('redirects auction draft to /draft/[id]/auction (unchanged)', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeCtx({ routeType: 'auction', draftType: 'auction' }))
    await expect(DraftRouterPage(draftIdCtx())).rejects.toMatchObject({
      to: '/draft/session-1/auction',
    })
  })

  it('redirects lottery draft to /draft/[id]/lottery (unchanged)', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeCtx({ routeType: 'lottery' }))
    await expect(DraftRouterPage(draftIdCtx())).rejects.toMatchObject({
      to: '/draft/session-1/lottery',
    })
  })

  it('redirects to /login when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(DraftRouterPage(draftIdCtx('abc'))).rejects.toMatchObject({
      to: '/login?callbackUrl=%2Fdraft%2Fabc',
    })
    expect(resolveDraftRouteContextMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// /draft/[draftId]/snake
// ---------------------------------------------------------------------------

describe('/draft/[draftId]/snake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    draftBoardMock.mockReturnValue(null)
  })

  it('redirects live draft to /drafts/[draftId]', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeCtx())
    await expect(SnakeDraftPage(draftIdCtx())).rejects.toMatchObject({
      to: '/drafts/session-1',
    })
  })

  it('preserves login callback to /draft/[id]/snake', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(SnakeDraftPage(draftIdCtx('abc'))).rejects.toMatchObject({
      to: '/login?callbackUrl=%2Fdraft%2Fabc%2Fsnake',
    })
  })

  it('does not redirect mock draft — renders inline', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(mockCtx())
    const result = await SnakeDraftPage(draftIdCtx('mock-1'))
    // A JSX element is returned, not a redirect
    expect(result).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// /draft/room/[draftId]
// ---------------------------------------------------------------------------

describe('/draft/room/[draftId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    draftBoardMock.mockReturnValue(null)
  })

  it('redirects live draft to /drafts/[draftId]', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeCtx())
    await expect(DraftRoomPage(draftIdCtx())).rejects.toMatchObject({
      to: '/drafts/session-1',
    })
  })

  it('preserves login callback to /draft/room/[id]', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(DraftRoomPage(draftIdCtx('abc'))).rejects.toMatchObject({
      to: '/login?callbackUrl=%2Fdraft%2Froom%2Fabc',
    })
  })

  it('does not redirect mock draft — renders inline', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(mockCtx())
    const result = await DraftRoomPage(draftIdCtx('mock-1'))
    expect(result).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// /draft/live/[draftId]
// ---------------------------------------------------------------------------

describe('/draft/live/[draftId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('redirects to /drafts/[param] when param is a DraftSession id', async () => {
    prismaMock.draftSession.findFirst.mockResolvedValueOnce({ id: 'session-1' })
    await expect(
      LiveDraftPage({ params: { draftId: 'session-1' } })
    ).rejects.toMatchObject({ to: '/drafts/session-1' })
  })

  it('resolves league id to DraftSession id and redirects to /drafts/[sessionId] — not /drafts/[leagueId]', async () => {
    // First findFirst: DraftSession lookup by id — not found (param is a league id)
    prismaMock.draftSession.findFirst
      .mockResolvedValueOnce(null)
      // Third findFirst: DraftSession lookup by leagueId — found
      .mockResolvedValueOnce({ id: 'resolved-session-99' })

    // Second call: League lookup by id — found
    prismaMock.league.findFirst.mockResolvedValueOnce({ id: 'league-abc' })

    await expect(
      LiveDraftPage({ params: { draftId: 'league-abc' } })
    ).rejects.toMatchObject({ to: '/drafts/resolved-session-99' })
  })

  it('does NOT redirect to /drafts/[leagueId] — uses the resolved session id', async () => {
    prismaMock.draftSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ds-xyz' })
    prismaMock.league.findFirst.mockResolvedValueOnce({ id: 'league-xyz' })

    const err = await LiveDraftPage({ params: { draftId: 'league-xyz' } }).catch((e) => e)
    expect(err).toBeInstanceOf(RedirectError)
    expect((err as RedirectError).to).toBe('/drafts/ds-xyz')
    expect((err as RedirectError).to).not.toBe('/drafts/league-xyz')
  })

  it('redirects to /dashboard when no DraftSession found for league', async () => {
    prismaMock.draftSession.findFirst
      .mockResolvedValueOnce(null) // not a session id
      .mockResolvedValueOnce(null) // no session for league
    prismaMock.league.findFirst.mockResolvedValueOnce({ id: 'league-abc' })

    await expect(
      LiveDraftPage({ params: { draftId: 'league-abc' } })
    ).rejects.toMatchObject({ to: '/dashboard' })
  })

  it('redirects to /dashboard when param resolves to nothing', async () => {
    prismaMock.draftSession.findFirst.mockResolvedValueOnce(null)
    prismaMock.league.findFirst.mockResolvedValueOnce(null)

    await expect(
      LiveDraftPage({ params: { draftId: 'unknown' } })
    ).rejects.toMatchObject({ to: '/dashboard' })
  })

  it('redirects to login when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(
      LiveDraftPage({ params: { draftId: 'session-1' } })
    ).rejects.toMatchObject({ to: '/login?callbackUrl=/dashboard' })
  })
})

// ---------------------------------------------------------------------------
// /league/[leagueId]/draft
// ---------------------------------------------------------------------------

describe('/league/[leagueId]/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    canAccessLeagueMock.mockResolvedValue(true)
    getDraftIdFromSettingsMock.mockReturnValue(null)
    prismaMock.league.findFirst.mockResolvedValue({
      id: 'league-1',
      sport: 'NFL',
      leagueSize: 12,
      settings: {},
    })
    prismaMock.draftSession.upsert.mockResolvedValue({ id: 'ds-league-1' })
  })

  it('redirects to /drafts/[sessionId]', async () => {
    await expect(
      LeagueDraftPage({ params: Promise.resolve({ leagueId: 'league-1' }) })
    ).rejects.toMatchObject({ to: '/drafts/ds-league-1' })
  })

  it('redirects to login when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(
      LeagueDraftPage({ params: Promise.resolve({ leagueId: 'league-1' }) })
    ).rejects.toMatchObject({
      to: '/login?callbackUrl=%2Fleague%2Fleague-1%2Fdraft',
    })
  })
})

// ---------------------------------------------------------------------------
// Dashboard overlay — source-level invariant
// ---------------------------------------------------------------------------

const root = resolve(__dirname, '..', '..')

describe('Dashboard overlay iframe src', () => {
  const src = readFileSync(resolve(root, 'app/dashboard/DashboardShell.tsx'), 'utf8')

  it('uses /drafts/ for the draft overlay iframe URL', () => {
    expect(src).toMatch(/`\/drafts\/\$\{encodeURIComponent\(draftIdFromUrl\)\}`/)
  })

  it('does not use /draft/ (legacy) for the draft overlay iframe URL', () => {
    // The only /draft/ reference should be for dispersal-draft or auction/lottery paths,
    // not for the main draftIdFromUrl overlay src.
    const overlayMemo = src.match(/const overlayIframeSrc = useMemo\(\(\) => \{([\s\S]*?)\}, \[draftIdFromUrl/)
    expect(overlayMemo).not.toBeNull()
    const memoBody = overlayMemo![1]
    expect(memoBody).not.toMatch(/`\/draft\/\$\{encodeURIComponent\(draftIdFromUrl\)\}`/)
  })
})

// ---------------------------------------------------------------------------
// Source invariants — legacy route files redirect to /drafts/
// ---------------------------------------------------------------------------

describe('Source invariants — all legacy entry points redirect to /drafts/', () => {
  it('app/draft/[draftId]/page.tsx falls through to /drafts/ for live snake', () => {
    const src = readFileSync(resolve(root, 'app/draft/[draftId]/page.tsx'), 'utf8')
    expect(src).toMatch(/redirect\(`\/drafts\//)
    expect(src).not.toMatch(/redirect\(`\/draft\/\$\{[^`]*\}\/snake/)
  })

  it('app/draft/[draftId]/snake/page.tsx redirects live to /drafts/', () => {
    const src = readFileSync(resolve(root, 'app/draft/[draftId]/snake/page.tsx'), 'utf8')
    expect(src).toMatch(/redirect\(`\/drafts\//)
  })

  it('app/draft/room/[draftId]/page.tsx redirects live to /drafts/', () => {
    const src = readFileSync(resolve(root, 'app/draft/room/[draftId]/page.tsx'), 'utf8')
    expect(src).toMatch(/redirect\(`\/drafts\//)
  })

  it('app/draft/live/[draftId]/page.tsx redirects to /drafts/', () => {
    const src = readFileSync(resolve(root, 'app/draft/live/[draftId]/page.tsx'), 'utf8')
    expect(src).toMatch(/redirect\(`\/drafts\//)
  })

  it('app/league/[leagueId]/draft/page.tsx redirects to /drafts/', () => {
    const src = readFileSync(resolve(root, 'app/league/[leagueId]/draft/page.tsx'), 'utf8')
    expect(src).toMatch(/redirect\(`\/drafts\/\$\{ds\.id\}`\)/)
    expect(src).not.toMatch(/redirect\(`\/draft\/\$\{ds\.id\}`\)/)
  })
})
