import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canAccessLeagueIntro: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mocks.getServerSession(...args),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league/intro-access', () => ({
  canAccessLeagueIntro: (...args: unknown[]) => mocks.canAccessLeagueIntro(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntroView: {
      findUnique: (...args: unknown[]) => mocks.findUnique(...args),
      upsert: (...args: unknown[]) => mocks.upsert(...args),
    },
  },
}))

import { GET as getIntroStatus } from '@/app/api/leagues/[leagueId]/intro-status/handler'
import { POST as postIntroSeen } from '@/app/api/leagues/[leagueId]/intro-seen/handler'

describe('league intro routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1', role: 'member', email: 'u@example.com' } })
    mocks.canAccessLeagueIntro.mockResolvedValue(true)
    mocks.findUnique.mockResolvedValue(null)
    mocks.upsert.mockResolvedValue({ id: 'intro-1' })
  })

  it('returns unseen status when no intro row exists', async () => {
    const res = await getIntroStatus(new Request('http://localhost/api/leagues/league-1/intro-status'), {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ seen: false })
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { leagueId_userId: { leagueId: 'league-1', userId: 'user-1' } },
      select: { id: true, seenAt: true },
    })
  })

  it('creates/updates intro seen row on POST', async () => {
    const res = await postIntroSeen(new Request('http://localhost/api/leagues/league-1/intro-seen', { method: 'POST' }), {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId_userId: { leagueId: 'league-1', userId: 'user-1' } },
      }),
    )
  })

  it('rejects requests from users without league/admin access', async () => {
    mocks.canAccessLeagueIntro.mockResolvedValue(false)

    const res = await getIntroStatus(new Request('http://localhost/api/leagues/league-1/intro-status'), {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})
