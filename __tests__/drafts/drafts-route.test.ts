/**
 * /drafts/[draftId] — Phase 2A Commit 9
 *
 * Locks down the new canonical full-screen draft route:
 *   - login required
 *   - canonical resolver used (no second engine)
 *   - mock / auction / lottery delegate to existing routes
 *   - live snake builds initial snapshot via buildSessionSnapshot(leagueId, now, userId)
 *     and renders the canonical DraftBoard with initialSnapshot
 *   - canAccessLeagueDraft gates non-members
 *   - notFound when draftId resolves to nothing
 *   - never reads from legacy DraftRoomStateRow / DraftRoomPickRecord / DraftRoomUserQueue
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() =>
  vi.fn(async () => ({ user: { id: 'user-1' } } as null | { user?: { id?: string } })),
)
const resolveDraftRouteContextMock = vi.hoisted(() => vi.fn(async () => null as any))
const canAccessLeagueDraftMock = vi.hoisted(() => vi.fn(async () => true))
const buildSessionSnapshotMock = vi.hoisted(() =>
  vi.fn(async () => ({ id: 'session-1', leagueId: 'league-1' } as any)),
)
const draftBoardMock = vi.hoisted(() => vi.fn((_props: unknown) => null))

class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`)
  }
}
class NotFoundError extends Error {
  constructor() {
    super('NEXT_NOT_FOUND')
  }
}

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to)
  },
  notFound: () => {
    throw new NotFoundError()
  },
}))
vi.mock('@/lib/draft/resolve-draft-context', () => ({
  resolveDraftRouteContext: (...a: unknown[]) => resolveDraftRouteContextMock(...a),
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: (...a: unknown[]) => canAccessLeagueDraftMock(...a),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: (...a: unknown[]) => buildSessionSnapshotMock(...a),
}))
vi.mock('@/components/draft/DraftBoard', () => ({
  DraftBoard: (props: unknown) => draftBoardMock(props),
}))

const Page = (await import('@/app/drafts/[draftId]/page')).default
const { DraftBoard: DraftBoardMockedComponent } = await import('@/components/draft/DraftBoard')

/**
 * Walks the returned React element tree and returns the props of the first
 * element whose type matches the mocked DraftBoard. Server pages return JSX
 * — the underlying function component isn't invoked until render, so we
 * inspect the element directly.
 */
function findDraftBoardProps(element: any): Record<string, unknown> | null {
  if (!element || typeof element !== 'object') return null
  if (element.type === DraftBoardMockedComponent) return element.props as Record<string, unknown>
  const children = element.props?.children
  if (!children) return null
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findDraftBoardProps(child)
      if (found) return found
    }
    return null
  }
  return findDraftBoardProps(children)
}

const liveSnakeContext = (overrides: Record<string, unknown> = {}) => ({
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

const ctx = (draftId = 'session-1') => ({ params: Promise.resolve({ draftId }) })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/drafts/[draftId] — Commit 9 route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeContext())
    canAccessLeagueDraftMock.mockResolvedValue(true)
    buildSessionSnapshotMock.mockResolvedValue({ id: 'session-1', leagueId: 'league-1' })
    draftBoardMock.mockReturnValue(null)
  })

  // Rule 1: login required
  it('redirects to /login when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(Page(ctx('abc-draft-id'))).rejects.toMatchObject({
      to: '/login?callbackUrl=%2Fdrafts%2Fabc-draft-id',
    })
    expect(resolveDraftRouteContextMock).not.toHaveBeenCalled()
  })

  it('redirects to /login when session has no user id', async () => {
    getServerSessionMock.mockResolvedValue({ user: {} })
    await expect(Page(ctx())).rejects.toBeInstanceOf(RedirectError)
  })

  // Rule 5: missing draft → notFound
  it('returns notFound when resolver returns null', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(null)
    await expect(Page(ctx())).rejects.toBeInstanceOf(NotFoundError)
    expect(buildSessionSnapshotMock).not.toHaveBeenCalled()
    expect(draftBoardMock).not.toHaveBeenCalled()
  })

  // Rule 6: mock redirects to existing mock URL family
  it('redirects mock drafts to /mock-draft?draftId=...', async () => {
    resolveDraftRouteContextMock.mockResolvedValue({
      kind: 'mock',
      draftId: 'mock-1',
      sport: 'NFL',
      leagueName: 'Mock',
      routeType: 'snake',
      draftType: 'snake',
      status: 'pre_draft',
    })
    await expect(Page(ctx('mock-1'))).rejects.toMatchObject({
      to: '/mock-draft?draftId=mock-1',
    })
    expect(buildSessionSnapshotMock).not.toHaveBeenCalled()
    expect(draftBoardMock).not.toHaveBeenCalled()
  })

  // Rule 5 (auction/lottery): preserve existing routes
  it('redirects auction drafts to /draft/[id]/auction', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(
      liveSnakeContext({ routeType: 'auction', draftType: 'auction' }),
    )
    await expect(Page(ctx('session-1'))).rejects.toMatchObject({
      to: '/draft/session-1/auction',
    })
    expect(buildSessionSnapshotMock).not.toHaveBeenCalled()
  })

  it('redirects lottery drafts to /draft/[id]/lottery', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeContext({ routeType: 'lottery' }))
    await expect(Page(ctx('session-1'))).rejects.toMatchObject({
      to: '/draft/session-1/lottery',
    })
    expect(buildSessionSnapshotMock).not.toHaveBeenCalled()
  })

  // Rule 7: non-member → notFound (do not reveal existence)
  it('returns notFound when canAccessLeagueDraft is false', async () => {
    canAccessLeagueDraftMock.mockResolvedValue(false)
    await expect(Page(ctx())).rejects.toBeInstanceOf(NotFoundError)
    expect(buildSessionSnapshotMock).not.toHaveBeenCalled()
  })

  // Rule 3: live → builds snapshot & renders canonical board
  it('builds snapshot for the resolved league and renders canonical DraftBoard', async () => {
    const tree = await Page(ctx('session-1'))
    expect(canAccessLeagueDraftMock).toHaveBeenCalledWith('league-1', 'user-1')
    const props = findDraftBoardProps(tree)
    expect(props).not.toBeNull()
    expect(props!.kind).toBe('live')
    expect(props!.draftId).toBe('session-1')
    expect(props!.leagueId).toBe('league-1')
    expect(props!.initialSnapshot).toEqual({ id: 'session-1', leagueId: 'league-1' })
  })

  it('passes (leagueId, Date, viewerUserId) to buildSessionSnapshot', async () => {
    await Page(ctx())
    expect(buildSessionSnapshotMock).toHaveBeenCalledTimes(1)
    const args = buildSessionSnapshotMock.mock.calls[0]
    expect(args[0]).toBe('league-1')
    expect(args[1]).toBeInstanceOf(Date)
    expect(args[2]).toBe('user-1')
  })

  it('uses the authenticated session user, never the URL/context userId', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'real-viewer' } })
    await Page(ctx())
    // resolver receives the session userId
    expect(resolveDraftRouteContextMock).toHaveBeenCalledWith('session-1', 'real-viewer')
    // snapshot built with the session userId
    expect(buildSessionSnapshotMock.mock.calls[0][2]).toBe('real-viewer')
  })

  it('passes redraft_snake presentationVariant for non-dynasty snake live drafts', async () => {
    const tree = await Page(ctx())
    const props = findDraftBoardProps(tree)
    expect(props?.presentationVariant).toBe('redraft_snake')
  })

  it('passes default presentationVariant for dynasty snake live drafts', async () => {
    resolveDraftRouteContextMock.mockResolvedValue(liveSnakeContext({ isDynasty: true }))
    const tree = await Page(ctx())
    const props = findDraftBoardProps(tree)
    expect(props?.presentationVariant).toBe('default')
  })
})

// ---------------------------------------------------------------------------
// Source-level invariants — cheap regression locks
// ---------------------------------------------------------------------------

const root = resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

describe('/drafts/[draftId] — source invariants', () => {
  const src = read('app/drafts/[draftId]/page.tsx')

  it('does not reference legacy DraftRoomStateRow / DraftRoomPickRecord / DraftRoomUserQueue', () => {
    expect(src).not.toMatch(/DraftRoomStateRow/)
    expect(src).not.toMatch(/DraftRoomPickRecord/)
    expect(src).not.toMatch(/DraftRoomUserQueue/)
  })

  it('does not call legacy /api/draft/room', () => {
    expect(src).not.toMatch(/\/api\/draft\/room/)
  })

  it('uses the canonical buildSessionSnapshot helper', () => {
    expect(src).toMatch(/buildSessionSnapshot/)
    expect(src).toMatch(/from '@\/lib\/live-draft-engine\/DraftSessionService'/)
  })

  it('uses canonical canAccessLeagueDraft for non-member gating', () => {
    expect(src).toMatch(/canAccessLeagueDraft/)
  })

  it('uses the shared resolveDraftRouteContext (no second resolver)', () => {
    expect(src).toMatch(/resolveDraftRouteContext/)
  })
})

describe('legacy /draft/[draftId]/snake page (updated in Commit 11)', () => {
  const src = read('app/draft/[draftId]/snake/page.tsx')

  it('still imports DraftBoard from @/components/draft/DraftBoard', () => {
    expect(src).toMatch(/from '@\/components\/draft\/DraftBoard'/)
  })

  it('still resolves via resolveDraftRouteContext', () => {
    expect(src).toMatch(/resolveDraftRouteContext/)
  })

  it('redirects live drafts to /drafts/ (Commit 11)', () => {
    expect(src).toMatch(/redirect\(`\/drafts\//)
  })
})

describe('DraftBoard live branch threads initialSnapshot', () => {
  const src = read('components/draft/DraftBoard.tsx')

  it('exposes initialSnapshot on LiveDraftBoardProps', () => {
    expect(src).toMatch(/initialSnapshot\?: DraftSessionSnapshot/)
  })

  it('forwards initialSnapshot into DraftRoomPageClient', () => {
    expect(src).toMatch(/initialSnapshot=\{props\.initialSnapshot/)
  })
})

describe('DraftRoomPageClient accepts initialSnapshot', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('declares initialSnapshot on the props type', () => {
    expect(src).toMatch(/initialSnapshot\?: DraftSessionSnapshot \| null/)
  })

  it('seeds session state from initialSnapshot when provided', () => {
    expect(src).toMatch(/useState<DraftSessionSnapshot \| null>\(initialSnapshot \?\? null\)/)
  })

  it('skips the initial loading flash when initialSnapshot is provided', () => {
    expect(src).toMatch(/useState\(initialSnapshot \? false : true\)/)
  })

  it('still imports the live-sync helpers (poll behaviour preserved)', () => {
    expect(src).toMatch(/mergeDraftSessionSnapshot/)
  })
})
