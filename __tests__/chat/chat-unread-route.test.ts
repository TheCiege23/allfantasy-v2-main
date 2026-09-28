import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as { user?: { id?: string } } | null,
  access: {} as unknown,
  badge: vi.fn(),
  seen: vi.fn(),
  markLeague: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: async () => h.access }))
vi.mock('@/lib/chat-core/chatBadge', () => ({ getChatBadge: h.badge, markChimmyProactiveSeen: h.seen }))
vi.mock('@/lib/chat-core/leagueChatRead', () => ({ markLeagueChatRead: h.markLeague }))

import { GET, POST } from '@/app/api/chat/unread/route'

const post = (body: unknown) => POST(new Request('https://x.test/api/chat/unread', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.session = { user: { id: 'u1' } }
  h.access = { role: 'member' }
  h.badge.mockReset().mockResolvedValue({ total: 5, mentions: 1, dm: 2, league: 2, chimmy: 1 })
  h.seen.mockReset()
  h.markLeague.mockReset()
})

describe('/api/chat/unread', () => {
  it('returns the signed-in person’s badge, uncached', async () => {
    const res = await GET()
    expect(await res.json()).toEqual({ total: 5, mentions: 1, dm: 2, league: 2, chimmy: 1 })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(h.badge).toHaveBeenCalledWith('u1')
  })

  it('needs a sign-in for everything', async () => {
    h.session = null
    expect((await GET()).status).toBe(401)
    expect((await post({ scope: 'chimmy' })).status).toBe(401)
  })

  it('marks a league read only for a member of it', async () => {
    expect((await post({ scope: 'league', leagueId: 'L1' })).status).toBe(200)
    expect(h.markLeague).toHaveBeenCalledWith('u1', 'L1')
    h.access = null
    expect((await post({ scope: 'league', leagueId: 'L9' })).status).toBe(403)
    expect(h.markLeague).toHaveBeenCalledTimes(1)
  })

  it('clears Chimmy’s weekly checks, and refuses anything else', async () => {
    expect((await post({ scope: 'chimmy' })).status).toBe(200)
    expect(h.seen).toHaveBeenCalledWith('u1')
    expect((await post({ scope: 'everything' })).status).toBe(400)
  })
})

describe('league chat marks itself read only when asked', () => {
  it('the GET handler marks read behind markRead=1, and nowhere else in the file', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/league/chat/route.ts'), 'utf8')
    const calls = src.match(/^\s*void markLeagueChatRead\(userId, leagueId\)$/gm) ?? []
    expect(calls).toHaveLength(1)
    const getStart = src.indexOf('export async function GET(')
    const nextHandler = src.indexOf('export async function', getStart + 10)
    const at = src.search(/^\s*if \(req\.nextUrl\.searchParams\?\.get\('markRead'\) === '1'\) \{$/m)
    expect(at).toBeGreaterThan(getStart)
    expect(at).toBeLessThan(nextHandler)
  })
})
