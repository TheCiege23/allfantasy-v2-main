/**
 * POST /api/leagues/import/batch takes its Sleeper identity from the caller's OWN saved link.
 *
 * It used to prefer `sleeperUserId` from the request body and upsert it onto the caller's
 * profile with no Sleeper lookup — and Sleeper user ids are public, so any signed-in caller
 * could bind any Sleeper account to their login. These pin the three outcomes that replaced it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  profileFindUniqueMock,
  profileUpsertMock,
  profileUpdateMock,
  getUserLeaguesMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  profileFindUniqueMock: vi.fn(),
  profileUpsertMock: vi.fn(),
  profileUpdateMock: vi.fn(),
  getUserLeaguesMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: {
      findUnique: profileFindUniqueMock,
      upsert: profileUpsertMock,
      update: profileUpdateMock,
    },
    league: { upsert: vi.fn(), findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: vi.fn(() => ({ success: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/sleeper-client', () => ({
  getUserLeagues: getUserLeaguesMock,
  getLeagueRosters: vi.fn(async () => []),
}))
vi.mock('@/lib/rank/calculateRank', () => ({ calculateAndSaveRank: vi.fn(async () => undefined) }))
vi.mock('@/lib/league-delete/leagueTombstones', () => ({ isLeagueTombstoned: vi.fn(async () => false) }))

import { POST } from '@/app/api/leagues/import/batch/route'

const LINKED = '111111111111111111'
const SOMEONE_ELSE = '999999999999999999'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/leagues/import/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  )
}

describe('POST /api/leagues/import/batch — Sleeper identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'af-user-1' } })
    getUserLeaguesMock.mockResolvedValue([])
  })

  it('refuses a body sleeperUserId that is not the linked one, and writes no link', async () => {
    profileFindUniqueMock.mockResolvedValue({ sleeperUserId: LINKED, sleeperUsername: 'me' })

    const res = await post({ season: 2025, leagues: [], sleeperUserId: SOMEONE_ELSE })

    expect(res.status).toBe(403)
    expect(profileUpsertMock).not.toHaveBeenCalled()
    expect(profileUpdateMock).not.toHaveBeenCalled()
    expect(getUserLeaguesMock).not.toHaveBeenCalled()
  })

  it('refuses a caller with no linked Sleeper account even when the body names one', async () => {
    profileFindUniqueMock.mockResolvedValue({ sleeperUserId: null, sleeperUsername: null })

    const res = await post({ season: 2025, leagues: [], sleeperUserId: SOMEONE_ELSE })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/Link your Sleeper account first/)
    expect(profileUpsertMock).not.toHaveBeenCalled()
    expect(getUserLeaguesMock).not.toHaveBeenCalled()
  })

  it('reads leagues for the LINKED account, with or without a matching body id', async () => {
    profileFindUniqueMock.mockResolvedValue({ sleeperUserId: LINKED, sleeperUsername: 'me' })

    for (const body of [
      { season: 2025, leagues: [] },
      { season: 2025, leagues: [], sleeperUserId: LINKED },
    ]) {
      getUserLeaguesMock.mockClear()
      const res = await post(body)
      expect(res.status).toBe(200)
      expect(getUserLeaguesMock).toHaveBeenCalled()
      for (const call of getUserLeaguesMock.mock.calls) expect(call[0]).toBe(LINKED)
    }
    expect(profileUpsertMock).not.toHaveBeenCalled()
  })
})
