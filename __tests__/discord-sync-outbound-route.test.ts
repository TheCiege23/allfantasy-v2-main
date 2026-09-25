/**
 * POST /api/discord/sync/outbound — the body names a message; it never supplies what
 * to post. It used to post caller-supplied text under a caller-supplied name into any
 * league's Discord channel for any signed-in account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), findUnique: vi.fn(), sync: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueChatMessage: { findUnique: h.findUnique } } }))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: h.sync }))

import { POST } from '@/app/api/discord/sync/outbound/route'

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/discord/sync/outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

const stored = {
  leagueId: 'L1',
  userId: 'author',
  message: 'the words actually stored',
  metadata: { gifUrl: 'https://media.example/g.gif' },
  user: { displayName: 'Marcus', username: 'marcusw', avatarUrl: 'https://cdn.example/a.png' },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_SYNC_INTERNAL_SECRET', 'internal-secret-value')
  h.session.mockResolvedValue({ user: { id: 'author' } })
  h.findUnique.mockResolvedValue(stored)
  h.sync.mockResolvedValue({ synced: true, discordMessageId: 'd1' })
})
afterEach(() => vi.unstubAllEnvs())

describe('what gets posted comes from the stored message', () => {
  it('ignores text, author name and avatar in the body', async () => {
    const res = await post({
      leagueId: 'L1',
      messageId: 'm1',
      text: '@everyone free crypto',
      authorName: 'League Commissioner',
      authorAvatarUrl: 'https://evil.example/x.png',
    })
    expect(res.status).toBe(200)
    expect(h.sync).toHaveBeenCalledWith({
      leagueId: 'L1',
      messageId: 'm1',
      authorName: 'Marcus',
      authorAvatarUrl: 'https://cdn.example/a.png',
      text: 'the words actually stored',
      gifUrl: 'https://media.example/g.gif',
    })
  })
})

describe('who may call it', () => {
  it('lets a signed-in author re-send their own message', async () => {
    expect((await post({ leagueId: 'L1', messageId: 'm1' })).status).toBe(200)
  })

  it('refuses a signed-in account that did not write the message', async () => {
    h.session.mockResolvedValue({ user: { id: 'somebody-else' } })
    const res = await post({ leagueId: 'L1', messageId: 'm1' })
    expect(res.status).toBe(403)
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller', async () => {
    h.session.mockResolvedValue(null)
    expect((await post({ leagueId: 'L1', messageId: 'm1' })).status).toBe(401)
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('accepts the internal secret without a session', async () => {
    h.session.mockResolvedValue(null)
    const res = await post({ leagueId: 'L1', messageId: 'm1' }, { 'x-discord-sync-secret': 'internal-secret-value' })
    expect(res.status).toBe(200)
    expect(h.sync).toHaveBeenCalled()
  })

  it('treats a wrong secret as no secret', async () => {
    h.session.mockResolvedValue(null)
    const res = await post({ leagueId: 'L1', messageId: 'm1' }, { 'x-discord-sync-secret': 'internal-secret-valuX' })
    expect(res.status).toBe(401)
  })

  it('404s a message from another league, the same as a missing one', async () => {
    h.findUnique.mockResolvedValue({ ...stored, leagueId: 'OTHER' })
    const res = await post({ leagueId: 'L1', messageId: 'm1' })
    expect(res.status).toBe(404)
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('reports a Discord refusal as 502 without throwing', async () => {
    h.sync.mockRejectedValue(new Error('postMessage: 403'))
    const res = await post({ leagueId: 'L1', messageId: 'm1' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ synced: false, error: 'Discord did not take the message' })
  })
})
