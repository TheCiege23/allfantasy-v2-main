// @vitest-environment node
/**
 * The idol reveal popup's API: the viewer's own unread private idol DMs, and acknowledging one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(),
  db: { leagueChatMessage: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() } },
}))
vi.mock('next-auth', () => ({ getServerSession: mock.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mock.db }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: mock.access }))

import { GET, POST, projectIdolReveal } from '@/server/api-route-modules/league-survivor/idol-reveals/route'

const ctx = { params: Promise.resolve({ leagueId: 'lg' }) }
const get = () => GET(new NextRequest('http://localhost/api/leagues/lg/survivor/idol-reveals'), ctx)
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/leagues/lg/survivor/idol-reveals', { method: 'POST', body: JSON.stringify(body) }), ctx)
const rows = [
  { id: 'm-new', message: '@Chimmy: You drafted LeBron…', createdAt: new Date('2026-10-21T00:00:00Z'), metadata: { survivorIdolReveal: true, idolId: 'i1', playerName: 'LeBron James', idolLabel: 'Immunity idol', idolDescription: 'Votes against you do not count.', expiryText: 'Play it before the merge.', foundInDraft: true } },
  { id: 'm-old', message: '@Chimmy: earlier', createdAt: new Date('2026-10-20T00:00:00Z'), metadata: { survivorIdolReveal: true, acknowledgedAt: '2026-10-20T01:00:00Z' } },
  { id: 'm-ballot', message: 'ballot', createdAt: new Date('2026-10-22T00:00:00Z'), metadata: { survivorBallot: true } },
  { id: 'm-arrival', message: '@Chimmy: arrived', createdAt: new Date('2026-10-19T00:00:00Z'), metadata: { survivorIdolReveal: true, playerName: 'Jalen Green' } },
]

beforeEach(() => {
  vi.clearAllMocks()
  mock.session.mockResolvedValue({ user: { id: 'me' } })
  mock.access.mockResolvedValue(true)
  mock.db.leagueChatMessage.findMany.mockResolvedValue(rows)
  mock.db.leagueChatMessage.findFirst.mockImplementation(async (args: { where: { id: string } }) => rows.find(r => r.id === args.where.id) ?? null)
  mock.db.leagueChatMessage.update.mockResolvedValue({})
})

describe('idol reveals', () => {
  it('lists only unread idol reveals, oldest first, scoped to the viewer', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const { reveals } = await res.json()
    expect(reveals.map((r: { messageId: string }) => r.messageId)).toEqual(['m-arrival', 'm-new'])
    expect(reveals[1]).toMatchObject({ playerName: 'LeBron James', idolLabel: 'Immunity idol', expiryText: 'Play it before the merge.', foundInDraft: true })
    expect(mock.db.leagueChatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'lg', isPrivate: true, visibleToUserId: 'me', messageSubtype: 'chimmy_private' } }))
  })

  it('acknowledging stamps the message and refuses a message that is not an idol reveal', async () => {
    expect((await post({ messageId: 'm-new' })).status).toBe(200)
    expect(mock.db.leagueChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm-new' }, data: { metadata: expect.objectContaining({ survivorIdolReveal: true, acknowledgedAt: expect.any(String) }) } }))
    expect((await post({ messageId: 'm-ballot' })).status).toBe(404)
    expect((await post({})).status).toBe(400)
    expect(mock.db.leagueChatMessage.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ visibleToUserId: 'me' }) }))
  })

  it('requires a session and league access', async () => {
    mock.access.mockResolvedValue(false)
    expect((await get()).status).toBe(403)
    mock.session.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })

  it('projects missing metadata as nulls', () => {
    expect(projectIdolReveal({ id: 'x', message: 'm', createdAt: new Date(0), metadata: null })).toMatchObject({ messageId: 'x', idolLabel: null, playerName: null, foundInDraft: false })
  })
})
