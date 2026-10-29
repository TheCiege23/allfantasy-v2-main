// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { defaultTribeSlots } from '@/lib/survivor/survivorTribeIdentity'
import { buildSurvivorSettingsSnapshotPatch, normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
const mock = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), lock: vi.fn(),
  db: { league: { findUnique: vi.fn(), update: vi.fn() }, draftSession: { findFirst: vi.fn() }, survivorTribeMember: { count: vi.fn() }, survivorTribe: { findMany: vi.fn() }, survivorLeagueConfig: { upsert: vi.fn() }, survivorAuditEntry: { create: vi.fn() }, $queryRaw: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: mock.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mock.db }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: mock.access }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: mock.lock }))
import { GET, PUT } from '@/app/api/leagues/[leagueId]/survivor-tribe-setup/route'
const ctx = { params: Promise.resolve({ leagueId: 'league' }) }
const request = (slots = defaultTribeSlots(16, 4)) => new NextRequest('http://localhost/api/leagues/league/survivor-tribe-setup', { method: 'PUT', body: JSON.stringify({ tribeCount: 4, slots }) })

describe('Saved tribe setup', () => {
  it('overwrites old top-level count aliases when a saved setup changes', () => {
    const old = { defaultTeamCount: 16, tribeCount: 4 }
    const slots = defaultTribeSlots(16, 3)
    const saved = { ...old, ...buildSurvivorSettingsSnapshotPatch({ ...old, tribeCount: 3, survivorTribeSlots: slots }) }
    expect(normalizeSurvivorFoundationSettings(saved).tribeCount).toBe(3)
    expect(normalizeSurvivorFoundationSettings(saved).survivorTribeSlots).toEqual(slots)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mock.session.mockResolvedValue({ user: { id: 'playing-commissioner' } })
    mock.access.mockResolvedValue({ isLeagueMember: true, isParticipatingCommissioner: true, decisions: { canUpdateSettings: true, canSeePrivateVotes: false } })
    mock.lock.mockImplementation((_id, work) => work(mock.db))
    mock.db.league.findUnique.mockResolvedValue({ sport: 'NBA', survivorMode: true, settings: { defaultTeamCount: 16, tribeCount: 4 } })
    mock.db.draftSession.findFirst.mockResolvedValue({ status: 'pre_draft' })
    mock.db.survivorTribeMember.count.mockResolvedValue(0)
    mock.db.survivorTribe.findMany.mockResolvedValue([])
  })
  it('requires authentication and membership to read setup', async () => {
    mock.session.mockResolvedValue(null)
    expect((await GET(request(), ctx)).status).toBe(401)
    mock.session.mockResolvedValue({ user: { id: 'outsider' } })
    mock.access.mockResolvedValue({ isLeagueMember: false })
    expect((await GET(request(), ctx)).status).toBe(403)
  })
  it('allows playing commissioners to save general setup without private-game access', async () => {
    const slots = defaultTribeSlots(16, 4).map((s, i) => ({ ...s, managerCount: [6, 4, 3, 3][i] }))
    expect((await PUT(request(slots), ctx)).status).toBe(200)
    expect(mock.lock).toHaveBeenCalledWith('league', expect.any(Function))
    const data = mock.db.league.update.mock.calls[0][0].data
    expect(data.settings.survivorTribeSlots).toEqual(slots)
    expect(data.survivorTribeSize).toBe(6)
    expect(mock.db.survivorLeagueConfig.upsert).toHaveBeenCalledOnce()
    expect(mock.db.survivorAuditEntry.create).toHaveBeenCalledOnce()
  })
  it('denies manager writes and invalid or duplicated capacities without mutations', async () => {
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: false } })
    expect((await PUT(request(), ctx)).status).toBe(403)
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: true } })
    expect((await PUT(request(defaultTribeSlots(15, 4)), ctx)).status).toBe(422)
    expect(mock.db.league.update).not.toHaveBeenCalled()
  })
  it.each(['in_progress', 'paused', 'completed'])('locks identities and capacities when the live draft is %s', async status => {
    mock.db.draftSession.findFirst.mockResolvedValue({ status })
    expect((await PUT(request(), ctx)).status).toBe(409)
    expect(mock.db.league.update).not.toHaveBeenCalled()
    expect(mock.db.draftSession.findFirst.mock.calls[0][0].where.sessionKind).toBe('live')
  })
  it('locks already assigned tribes and returns saved identities to members', async () => {
    mock.db.survivorTribeMember.count.mockResolvedValue(16)
    mock.db.survivorTribe.findMany.mockResolvedValue([
      { id: 't0', slotIndex: 0, name: 'Tribe Wolves', catalogId: null, logoUrl: 'https://blob/custom.png', colorHex: '#ff0000', primaryColor: null, secondaryColor: null, members: [{ rosterId: 'r1' }, { rosterId: 'r2' }] },
    ])
    expect((await PUT(request(), ctx)).status).toBe(409)
    const response = await GET(request(), ctx)
    const data = await response.json()
    expect(data.locked).toBe(true)
    expect(data.slots).toEqual(defaultTribeSlots(16, 4))
    expect(data).not.toHaveProperty('votes')
    // The tribes as written at lock: identity for everyone, a custom image kept as-is.
    expect(data.tribes).toEqual([expect.objectContaining({ id: 't0', name: 'Tribe Wolves', colorHex: '#ff0000', crestUrl: 'https://blob/custom.png', customLogo: true, memberCount: 2 })])
  })

  it('a plain member sees tribe identities but not who is in them', async () => {
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: false } })
    mock.db.survivorTribeMember.count.mockResolvedValue(16)
    mock.db.survivorTribe.findMany.mockResolvedValue([
      { id: 't0', slotIndex: 0, name: 'Tribe Wolves', catalogId: null, logoUrl: null, colorHex: null, primaryColor: '#00ff00', secondaryColor: null, members: [{ rosterId: 'r1' }] },
    ])
    const data = await (await GET(request(), ctx)).json()
    expect(data.tribes[0]).toMatchObject({ name: 'Tribe Wolves', colorHex: '#00ff00', memberCount: 1 })
    expect(data.tribes[0].members).toBeUndefined()
  })
})
