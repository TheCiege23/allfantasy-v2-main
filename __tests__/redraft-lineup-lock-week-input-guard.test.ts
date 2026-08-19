/**
 * Beta guardrail: the redraft lineup-lock route validated `week` with a weak
 * inline `Number.isFinite` check that (a) let fractional weeks like 2.5 through
 * and (b) only ran for manual_lock/unlock actions, so `emergency_unlock` with a
 * malformed week stored NaN. Swapping to the shared
 * `parseOptionalRedraftPositiveInteger` guard rejects abc/2.5/0/negatives with a
 * clean 400 before any settings write, for every action.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const prismaMock = {
  redraftSeason: { findFirst: vi.fn() },
  league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  redraftRoster: { findFirst: vi.fn() },
  redraftLeagueTransaction: { create: vi.fn() },
}
const readLineupLockSettingsMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/prisma-json', () => ({ toPrismaJsonInput: (v: unknown) => v }))
vi.mock('@/lib/redraft/lineupLock', () => ({
  readLineupLockSettings: readLineupLockSettingsMock,
}))

const post = (body: unknown) =>
  createMockNextRequest('http://localhost/api/redraft/lineup-lock', { method: 'POST', body })

describe('redraft lineup-lock route — week input guard (beta)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    prismaMock.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L' })
    prismaMock.league.findFirst.mockResolvedValue({ userId: 'user-1', teams: [] })
    prismaMock.league.findUnique.mockResolvedValue({ settings: {} })
    prismaMock.league.update.mockResolvedValue({})
    readLineupLockSettingsMock.mockReturnValue({ mode: 'manual', manualLockedWeeks: new Set(), overrides: [] })
  })

  it('rejects a non-numeric week with 400 before persisting', async () => {
    const { POST } = await import('@/app/api/redraft/lineup-lock/route')
    const res = await POST(post({ seasonId: 's1', action: 'manual_lock_week', week: 'abc' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(prismaMock.league.update).not.toHaveBeenCalled()
  })

  it('rejects a fractional week with 400 (tightened from the old Number.isFinite check)', async () => {
    const { POST } = await import('@/app/api/redraft/lineup-lock/route')
    const res = await POST(post({ seasonId: 's1', action: 'manual_lock_week', week: 2.5 }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(prismaMock.league.update).not.toHaveBeenCalled()
  })

  it('rejects a provided-but-malformed week even for emergency_unlock (no NaN stored)', async () => {
    const { POST } = await import('@/app/api/redraft/lineup-lock/route')
    const res = await POST(post({ seasonId: 's1', action: 'emergency_unlock', week: 'abc' }))
    expect(res.status).toBe(400)
    expect(prismaMock.league.update).not.toHaveBeenCalled()
  })

  it('accepts a valid week and persists the setting', async () => {
    const { POST } = await import('@/app/api/redraft/lineup-lock/route')
    const res = await POST(post({ seasonId: 's1', action: 'manual_lock_week', week: 3 }))
    expect(res.status).toBe(200)
    expect(prismaMock.league.update).toHaveBeenCalledTimes(1)
  })

  it('preserves 401 for unauthenticated requests', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/redraft/lineup-lock/route')
    const res = await POST(post({ seasonId: 's1', action: 'manual_lock_week', week: 'abc' }))
    expect(res.status).toBe(401)
  })
})
