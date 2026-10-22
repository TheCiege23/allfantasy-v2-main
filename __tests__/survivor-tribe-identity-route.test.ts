// @vitest-environment node
/**
 * PATCH /api/leagues/:leagueId/survivor-tribes/:tribeId — free-text rename and image upload for a
 * tribe (owner's call, 2026-10-20). Commissioner only; a custom image replaces the catalogue crest
 * and `removeLogo` brings the catalogue crest back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), persist: vi.fn(), token: vi.fn(),
  db: {
    survivorTribe: { findFirst: vi.fn(), update: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorChatChannel: { updateMany: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: mock.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mock.db }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: mock.access }))
vi.mock('@/lib/blob/readWriteToken', () => ({ getBlobReadWriteToken: mock.token }))
vi.mock('@/lib/avatar/ProfileImageUploadStorageService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/avatar/ProfileImageUploadStorageService')>()),
  persistProfileImageBytes: mock.persist,
}))

import { PATCH } from '@/app/api/leagues/[leagueId]/survivor-tribes/[tribeId]/route'
import { normalizeSurvivorTribeName } from '@/lib/survivor/survivorTribeName'
import { SURVIVOR_TRIBE_CATALOG } from '@/lib/survivor/survivorTribeIdentity'

const [cat0, cat1, cat2, cat3] = SURVIVOR_TRIBE_CATALOG.map(t => t.id)

const ctx = { params: Promise.resolve({ leagueId: 'lg', tribeId: 't0' }) }
const json = (body: unknown) => new NextRequest('http://localhost/api/leagues/lg/survivor-tribes/t0', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const tribe = { id: 't0', leagueId: 'lg', slotIndex: 0, name: 'Tribe Wolves', catalogId: cat0, logoUrl: '/api/survivor/tribe-emblem/crest?x', colorHex: '#ff0000', primaryColor: null, secondaryColor: null, chatChannelId: 'chan-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mock.session.mockResolvedValue({ user: { id: 'commish' } })
  mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: true } })
  mock.db.survivorTribe.findFirst.mockImplementation(async (args: { where: { id?: string; name?: unknown } }) => (args.where.name ? null : tribe))
  mock.db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings: { defaultTeamCount: 16, tribeCount: 4 } })
  mock.db.survivorTribe.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...tribe, ...args.data }))
  mock.token.mockReturnValue('tok')
  mock.persist.mockResolvedValue({ url: 'https://blob/tribe.png' })
})

describe('tribe names', () => {
  it('trims, collapses whitespace, strips control characters, and bounds the length', () => {
    expect(normalizeSurvivorTribeName('  The   Wolf\tPack \u0007')).toEqual({ ok: true, name: 'The Wolf Pack' })
    expect(normalizeSurvivorTribeName('A').ok).toBe(false)
    expect(normalizeSurvivorTribeName('x'.repeat(33)).ok).toBe(false)
    expect(normalizeSurvivorTribeName(42).ok).toBe(false)
  })
})

describe('PATCH /survivor-tribes/:tribeId', () => {
  it('renames the tribe, its huddle, and records who did it', async () => {
    const res = await PATCH(json({ name: ' Wolf Pack ' }), ctx)
    expect(res.status).toBe(200)
    expect(mock.db.survivorTribe.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't0' }, data: { name: 'Wolf Pack' } }))
    expect(mock.db.survivorChatChannel.updateMany).toHaveBeenCalledWith({ where: { id: 'chan-1', leagueId: 'lg' }, data: { name: 'Wolf Pack Huddle' } })
    expect(mock.db.survivorAuditEntry.create.mock.calls[0][0].data).toMatchObject({ action: 'tribe_identity_updated', actorUserId: 'commish', relatedEntityId: 't0' })
    const body = await res.json()
    expect(body.tribe).toMatchObject({ id: 't0', name: 'Wolf Pack', customLogo: false })
    expect(body.tribe.crestUrl).toMatch(/tribe-emblem\/crest/)
  })

  it('refuses a name another tribe already uses, and a name that is too short', async () => {
    mock.db.survivorTribe.findFirst.mockImplementation(async (args: { where: { name?: unknown } }) => (args.where.name ? { id: 't1' } : tribe))
    expect((await PATCH(json({ name: 'Hawks' }), ctx)).status).toBe(409)
    expect((await PATCH(json({ name: 'H' }), ctx)).status).toBe(400)
    expect(mock.db.survivorTribe.update).not.toHaveBeenCalled()
  })

  it('stores an uploaded image as the tribe logo and drops the catalogue crest', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }))
    const res = await PATCH(new NextRequest('http://localhost/api/leagues/lg/survivor-tribes/t0', { method: 'PATCH', body: form }), ctx)
    expect(res.status).toBe(200)
    expect(mock.persist).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png', keyPrefix: 'survivor-tribes' }))
    expect(mock.db.survivorTribe.update).toHaveBeenCalledWith(expect.objectContaining({ data: { logoUrl: 'https://blob/tribe.png', catalogId: null } }))
    expect((await res.json()).tribe).toMatchObject({ customLogo: true, crestUrl: 'https://blob/tribe.png' })
  })

  it('removeLogo goes back to the catalogue crest chosen at setup', async () => {
    mock.db.survivorTribe.findFirst.mockImplementation(async (args: { where: { name?: unknown } }) => (args.where.name ? null : { ...tribe, catalogId: null, logoUrl: 'https://blob/custom.png' }))
    mock.db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings: { defaultTeamCount: 16, tribeCount: 4, survivorTribeSlots: [{ catalogId: cat1, managerCount: 4 }, { catalogId: cat0, managerCount: 4 }, { catalogId: cat2, managerCount: 4 }, { catalogId: cat3, managerCount: 4 }] } })
    const res = await PATCH(json({ removeLogo: true }), ctx)
    expect(res.status).toBe(200)
    const data = mock.db.survivorTribe.update.mock.calls[0][0].data
    // Slot 0's setup choice, not the first catalogue entry.
    expect(data.catalogId).toBe(cat1)
    expect(String(data.logoUrl)).toMatch(/tribe-emblem\/crest/)
  })

  it('is commissioner-only and needs something to change', async () => {
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: false } })
    expect((await PATCH(json({ name: 'Wolf Pack' }), ctx)).status).toBe(403)
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: true } })
    expect((await PATCH(json({}), ctx)).status).toBe(400)
    expect((await PATCH(json({ name: 'Tribe Wolves' }), ctx)).status).toBe(400)
    expect(mock.db.survivorTribe.update).not.toHaveBeenCalled()
  })
})
