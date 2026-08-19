/**
 * Beta guardrail: the redraft roster route (GET) coerced `week` with raw
 * `Number(searchParams.week ?? '1')`, so `?week=abc` -> NaN flowed into lineup
 * lock hydration / validation. The shared `parseOptionalRedraftPositiveInteger`
 * guard now rejects malformed weeks with a clean 400 (after the id-required
 * check, before any roster lookup), while a missing week still defaults to 1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const resolveRosterLookupMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { redraftRoster: { findFirst: vi.fn() }, league: { findUnique: vi.fn() } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/adp/computeAllFantasyAdp', () => ({ buildPlayerKey: vi.fn() }))
vi.mock('@/lib/redraft/projectionEngine', () => ({ buildAllFantasyProjection: vi.fn() }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn() }))
vi.mock('@/lib/redraft/lineupValidation', () => ({
  applyRedraftLineupMoves: vi.fn(),
  validateRedraftLineup: vi.fn(),
}))
vi.mock('@/lib/redraft/lineupLock', () => ({ hydrateRedraftLineupLocks: vi.fn() }))
vi.mock('@/lib/redraft/rosterConfigResolver', () => ({ resolveRedraftRosterConfig: vi.fn() }))
vi.mock('@/lib/nfl-data-foundation', () => ({
  getCanonicalNflPlayerByNameTeam: vi.fn(),
  getCanonicalNflPlayerContext: vi.fn(),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: vi.fn() }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: vi.fn() }))
vi.mock('@/lib/players/getTeamLogo', () => ({ getTeamLogo: vi.fn() }))
vi.mock('@/lib/redraft/redraftRosterIdentity', () => ({ resolveRedraftRosterLookup: resolveRosterLookupMock }))
vi.mock('@/lib/redraft/rosterMoveHistory', () => ({ recordRedraftRosterMoveHistory: vi.fn() }))

const get = (qs: string) => createMockNextRequest(`http://localhost/api/redraft/roster${qs}`)

describe('redraft roster route — week input guard (beta)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    // Season/roster not found -> route returns 404, which still proves the guard
    // let a valid/missing week through without touching heavier roster logic.
    resolveRosterLookupMock.mockResolvedValue({ season: null, roster: null })
  })

  it('rejects a non-numeric week with 400 before any roster lookup', async () => {
    const { GET } = await import('@/app/api/redraft/roster/route')
    const res = await GET(get('?rosterId=r1&week=abc'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(resolveRosterLookupMock).not.toHaveBeenCalled()
  })

  it('rejects a fractional week with 400', async () => {
    const { GET } = await import('@/app/api/redraft/roster/route')
    const res = await GET(get('?rosterId=r1&week=2.5'))
    expect(res.status).toBe(400)
    expect(resolveRosterLookupMock).not.toHaveBeenCalled()
  })

  it('accepts a valid week and proceeds past the guard to the roster lookup', async () => {
    const { GET } = await import('@/app/api/redraft/roster/route')
    const res = await GET(get('?rosterId=r1&week=3'))
    expect(res.status).toBe(404) // lookup mocked to not-found; the point is the guard passed
    expect(resolveRosterLookupMock).toHaveBeenCalledTimes(1)
  })

  it('treats a missing week as the default (still passes the guard)', async () => {
    const { GET } = await import('@/app/api/redraft/roster/route')
    const res = await GET(get('?rosterId=r1'))
    expect(res.status).not.toBe(400)
    expect(resolveRosterLookupMock).toHaveBeenCalledTimes(1)
  })

  it('preserves 401 for unauthenticated requests', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { GET } = await import('@/app/api/redraft/roster/route')
    const res = await GET(get('?rosterId=r1&week=abc'))
    expect(res.status).toBe(401)
  })
})
