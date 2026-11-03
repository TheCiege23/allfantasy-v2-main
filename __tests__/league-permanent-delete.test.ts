import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), find: vi.fn(), findFirst: vi.fn(), tournament: vi.fn(), transaction: vi.fn(), claims: vi.fn(), remove: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: mocks.find, findFirst: mocks.findFirst },
  legacyTournamentLeague: { findUnique: mocks.tournament },
  $transaction: mocks.transaction,
} }))
vi.mock('@/lib/league-delete/leagueTombstones', () => ({ recordLeagueTombstone: vi.fn() }))
import { DELETE } from '@/app/api/league/[leagueId]/route'

const native = { id: 'l1', userId: 'owner', platform: 'allfantasy', name: 'My league' }
const call = (name: unknown = 'My league', permanent = true) => DELETE(
  new Request(`http://localhost/api/league/l1${permanent ? '?permanent=1' : ''}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueName: name }),
  }), { params: Promise.resolve({ leagueId: 'l1' }) },
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.find.mockResolvedValue(native)
  mocks.findFirst.mockResolvedValue(native)
  mocks.tournament.mockResolvedValue(null)
  mocks.claims.mockResolvedValue({ count: 2 })
  mocks.remove.mockResolvedValue({ count: 1 })
  mocks.transaction.mockImplementation((f: (tx: unknown) => unknown) => f({ leagueManagerClaim: { deleteMany: mocks.claims }, league: { deleteMany: mocks.remove } }))
})

describe('permanent native league deletion', () => {
  it('deletes claims and the league together when the owner confirms its exact name', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deletedLeague: true })
    expect(mocks.claims).toHaveBeenCalledWith({ where: { leagueId: 'l1' } })
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'l1', userId: 'owner', platform: 'allfantasy', name: 'My league' } })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
  it('rejects other users, incorrect names, and imported leagues without deleting anything', async () => {
    mocks.session.mockResolvedValueOnce({ user: { id: 'other' } })
    expect((await call()).status).toBe(403)
    expect((await call('wrong')).status).toBe(400)
    mocks.find.mockResolvedValueOnce({ ...native, platform: 'sleeper' })
    expect((await call()).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('refuses tournament feeder leagues and unconfirmed legacy native deletes', async () => {
    mocks.tournament.mockResolvedValueOnce({ id: 'link' })
    expect((await call()).status).toBe(409)
    expect((await call('My league', false)).status).toBe(409)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('reports failure when the league changed before deletion', async () => {
    mocks.remove.mockResolvedValueOnce({ count: 0 })
    expect((await call()).status).toBe(500)
  })
})
