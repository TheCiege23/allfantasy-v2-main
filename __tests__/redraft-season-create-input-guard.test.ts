/**
 * Beta guardrail: POST /api/redraft/season (commissioner season creation) read
 * `season` / `totalWeeks` / `playoffStartWeek` straight off the JSON body (typed
 * `number` but arbitrary at runtime) and passed them into `prisma.redraftSeason
 * .create` (Int columns) and `generateSchedule(...)`. A malformed value (abc / 2.5
 * / 0) reached Prisma / the schedule generator -> 500 or a corrupt season with a
 * garbage week count. The shared `parseOptionalRedraftPositiveInteger` guard now
 * rejects each with a clean 400 before the create transaction; missing fields
 * still fall back to their existing defaults.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const prismaMock = {
  league: { findFirst: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: assertLeagueMemberMock }))
vi.mock('@/lib/post-draft', () => ({ ensurePostDraftFinalized: vi.fn() }))
vi.mock('@/lib/redraft/scheduleEngine', () => ({ generateSchedule: vi.fn(() => []) }))
vi.mock('@/lib/redraft/sportKey', () => ({ leagueSportToConfigSport: vi.fn(() => 'nfl') }))
vi.mock('@/lib/sportConfig', () => ({
  tryGetSportConfig: vi.fn(() => ({ defaultSeasonWeeks: 17, defaultPlayoffStartWeek: 15 })),
}))

const post = (body: unknown) =>
  createMockNextRequest('http://localhost/api/redraft/season', { method: 'POST', body })

describe('redraft season create route — numeric setup input guard (beta)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    prismaMock.league.findFirst.mockResolvedValue({
      id: 'L',
      sport: 'NFL',
      season: 2026,
      medianGame: false,
      userId: 'user-1',
      teams: [],
    })
    // $transaction mock ignores the callback and returns a season, so the create
    // pipeline (generateSchedule / tx.*.create) never runs — we only assert the guard.
    prismaMock.$transaction.mockResolvedValue({ id: 'rs1', rosters: [] })
  })

  it('rejects a non-numeric totalWeeks with 400 before the create transaction', async () => {
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ leagueId: 'L', totalWeeks: 'abc' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'totalWeeks must be a positive integer' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric season with 400', async () => {
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ leagueId: 'L', season: 'abc' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'season must be a positive integer' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a non-positive playoffStartWeek (0) with 400', async () => {
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ leagueId: 'L', playoffStartWeek: 0 }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'playoffStartWeek must be a positive integer' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a fractional totalWeeks with 400', async () => {
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ leagueId: 'L', totalWeeks: 2.5 }))
    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('accepts valid numeric setup fields and runs the create transaction', async () => {
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ leagueId: 'L', season: 2026, totalWeeks: 17, playoffStartWeek: 15 }))
    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('treats missing numeric fields as defaults (still creates the season)', async () => {
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ leagueId: 'L' }))
    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('preserves 401 for unauthenticated requests', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ leagueId: 'L', totalWeeks: 'abc' }))
    expect(res.status).toBe(401)
  })

  it('preserves 400 for a missing leagueId (guard does not shadow it)', async () => {
    const { POST } = await import('@/app/api/redraft/season/route')
    const res = await POST(post({ totalWeeks: 'abc' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'leagueId required' })
  })
})
