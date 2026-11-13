// @vitest-environment node
/**
 * The legacy POST /api/league/sync upserts the CALLER's row. For a league someone else imported
 * that handed a member their own owned copy, and an owner reads as the commissioner everywhere.
 * It must refuse instead, before any provider call or credential decrypt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; userId: string; platform: string; platformLeagueId: string; season: number }>,
  teams: [] as Array<{ leagueId: string; claimedByUserId: string | null }>,
  syncLeague: vi.fn(),
  getDecryptedAuth: vi.fn(),
  session: { user: { id: 'alice' } } as { user: { id: string } } | null,
}))

vi.mock('@/lib/prisma', () => {
  const where = (row: any, w: any) =>
    Object.entries(w).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k])
      return row[k] === v
    })
  return {
    prisma: {
      league: {
        findMany: vi.fn(async ({ where: w }: any) => h.leagues.filter((l) => where(l, w))),
        updateMany: vi.fn(),
      },
      leagueTeam: { findMany: vi.fn(async ({ where: w }: any) => h.teams.filter((t) => where(t, w))) },
    },
  }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => '1.1.1.1' }))
vi.mock('@/lib/league-sync-core', () => ({ syncLeague: h.syncLeague, getDecryptedAuth: h.getDecryptedAuth }))
vi.mock('@/lib/resend-client', () => ({ getResendClient: vi.fn() }))

import { POST } from '@/app/api/league/sync/route'
import { resolveLeagueCopyTarget } from '@/lib/league-import/existingLeagueCopy'
import { SYSTEM_LEAGUE_OWNER_ID } from '@/lib/league-import/systemLeagueOwner'

const post = (body: unknown) =>
  POST({ json: async () => body, headers: new Headers() } as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.leagues = []
  h.teams = []
  h.session = { user: { id: 'alice' } }
  h.syncLeague.mockResolvedValue({ success: true, leagueId: 'L-new' })
  h.getDecryptedAuth.mockResolvedValue({ espnSwid: 'x', espnS2: 'y' })
})

describe('resolveLeagueCopyTarget', () => {
  it("is the caller's own row, or nobody's yet", async () => {
    expect(await resolveLeagueCopyTarget({ userId: 'alice', platform: 'sleeper', platformLeagueId: '9' })).toEqual({ kind: 'own' })
    h.leagues.push(
      { id: 'L-dana', userId: 'dana', platform: 'sleeper', platformLeagueId: '9', season: 2026 },
      { id: 'L-alice', userId: 'alice', platform: 'sleeper', platformLeagueId: '9', season: 2026 },
    )
    expect(await resolveLeagueCopyTarget({ userId: 'alice', platform: 'sleeper', platformLeagueId: '9' })).toEqual({ kind: 'own' })
  })

  it('prefers the system-owned row when the caller holds a team in several', async () => {
    h.leagues.push(
      { id: 'L-dana', userId: 'dana', platform: 'espn', platformLeagueId: '9', season: 2026 },
      { id: 'L-sys', userId: SYSTEM_LEAGUE_OWNER_ID, platform: 'espn', platformLeagueId: '9', season: 2026 },
    )
    h.teams.push({ leagueId: 'L-dana', claimedByUserId: 'alice' }, { leagueId: 'L-sys', claimedByUserId: 'alice' })
    expect(await resolveLeagueCopyTarget({ userId: 'alice', platform: 'espn', platformLeagueId: '9' })).toEqual({
      kind: 'member',
      ownerUserId: SYSTEM_LEAGUE_OWNER_ID,
      leagueId: 'L-sys',
    })
  })
})

describe('POST /api/league/sync', () => {
  it("still syncs the caller's own league", async () => {
    h.leagues.push({ id: 'L-alice', userId: 'alice', platform: 'sleeper', platformLeagueId: '9', season: 2026 })
    const res = await post({ platform: 'sleeper', platformLeagueId: '9' })
    expect(res.status).toBe(200)
    expect(h.syncLeague).toHaveBeenCalledWith('alice', 'sleeper', '9')
  })

  it('a member of a league someone else imported gets no copy of their own', async () => {
    h.leagues.push({ id: 'L-dana', userId: 'dana', platform: 'sleeper', platformLeagueId: '9', season: 2026 })
    h.teams.push({ leagueId: 'L-dana', claimedByUserId: 'alice' })
    const res = await post({ platform: 'sleeper', platformLeagueId: '9' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ alreadyInLeague: true, leagueId: 'L-dana' })
    expect(h.syncLeague).not.toHaveBeenCalled()
  })

  it('an outsider is refused before any credential is decrypted', async () => {
    h.leagues.push({ id: 'L-sys', userId: SYSTEM_LEAGUE_OWNER_ID, platform: 'espn', platformLeagueId: '9', season: 2026 })
    const res = await post({ platform: 'espn', platformLeagueId: '9' })
    expect(res.status).toBe(409)
    expect(h.getDecryptedAuth).not.toHaveBeenCalled()
    expect(h.syncLeague).not.toHaveBeenCalled()
  })
})
