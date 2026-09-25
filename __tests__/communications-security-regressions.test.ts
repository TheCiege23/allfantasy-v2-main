import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ member: vi.fn(), message: vi.fn(), update: vi.fn(), link: vi.fn(), mapping: vi.fn(), post: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  platformChatThreadMember: { findFirst: h.member },
  platformChatMessage: { findFirst: h.message, updateMany: h.update },
  leagueChatMessage: { findUnique: h.message },
  discordLeagueChannel: { findFirst: h.mapping },
  discordMessageLink: { findFirst: h.link, create: h.create },
} }))
vi.mock('@/lib/discord/bot', () => ({ isBotConfigured: () => true, postLeagueChatEmbed: h.post }))
import { mutatePlatformPoll, visiblePlatformPoll } from '@/lib/chat-core/platformPolls'
import { deliverOutboundLeagueChat as syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'
import { POST } from '@/app/api/discord/sync/outbound/route'

const poll = { question: 'Pick one', closeAt: '2099-01-01', anonymous: true, options: [{ id: 'a', text: 'A', votes: ['other'] }, { id: 'b', text: 'B', votes: [] }] }
beforeEach(() => {
  vi.clearAllMocks()
  h.member.mockResolvedValue({ id: 'member' })
  h.message.mockResolvedValue({ id: 'm', body: 'Pick one', metadata: { poll }, senderUserId: 'author', updatedAt: new Date(0) })
  h.update.mockResolvedValue({ count: 1 })
  h.mapping.mockResolvedValue({ channelId: 'channel', guildId: 'guild', league: { name: 'League' } })
  h.link.mockResolvedValue(null)
  h.post.mockResolvedValue('discord-message')
})
describe('private thread polls', () => {
  it('redacts other voter identities but preserves counts', () => {
    const safe = visiblePlatformPoll('Pick one', { poll }, 'me')
    expect(JSON.stringify(safe)).not.toContain('other')
    expect((safe.metadata?.poll as typeof poll).options[0].votes).toHaveLength(1)
  })
  it('rejects non-members before reading the message', async () => {
    h.member.mockResolvedValue(null)
    expect(await mutatePlatformPoll('me', 't', 'm', 'b')).toBe(false)
    expect(h.message).not.toHaveBeenCalled()
  })
  it('records a vote with a compare-and-swap update', async () => {
    expect(await mutatePlatformPoll('me', 't', 'm', 'b')).toBe(true)
    expect(h.update.mock.calls[0][0].where.updatedAt).toEqual(new Date(0))
    expect(h.update.mock.calls[0][0].data.metadata.poll.options[1].votes).toEqual(['me'])
  })
  it('retries an overlapping write', async () => {
    h.update.mockResolvedValueOnce({ count: 0 })
    expect(await mutatePlatformPoll('me', 't', 'm', 'b')).toBe(true)
    expect(h.update).toHaveBeenCalledTimes(2)
  })
  it('only permits the author to close', async () => {
    expect(await mutatePlatformPoll('me', 't', 'm', null)).toBe(false)
    expect(await mutatePlatformPoll('author', 't', 'm', null)).toBe(true)
  })
  it('rejects expired polls', async () => {
    h.message.mockResolvedValue({ body: '', metadata: { poll: { ...poll, closeAt: '2000-01-01' } } })
    expect(await mutatePlatformPoll('me', 't', 'm', 'b')).toBe(false)
  })
  it('does not vote on or reopen a deleted poll', async () => {
    h.message.mockResolvedValue({ body: '', metadata: { poll, deletedAt: '2026-09-13' } })
    expect(await mutatePlatformPoll('me', 't', 'm', 'b')).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })
})
describe('Discord authorization', () => {
  const input = { leagueId: 'l', messageId: 'm', authorName: 'Forged', authorAvatarUrl: null, text: 'Forged' }
  it('does not accept a browser session instead of the server secret', async () => {
    vi.stubEnv('DISCORD_SYNC_INTERNAL_SECRET', 'server-secret')
    const res = await POST(new Request('https://example.test/api/discord/sync/outbound', { method: 'POST', body: JSON.stringify(input) }))
    expect(res.status).toBe(401)
    expect(h.post).not.toHaveBeenCalled()
  })
  it.each([null, { leagueId: 'other' }, { leagueId: 'l', isPrivate: true }, { leagueId: 'l', sourceDiscord: true }, { leagueId: 'l', visibleToUserId: 'me' }, { leagueId: 'l', source: 'tribe_private' }, { leagueId: 'l', source: 'draft' }])('refuses invalid or private messages: %j', async message => {
    h.message.mockResolvedValue(message)
    expect((await syncOutboundLeagueChat(input)).synced).toBe(false)
    expect(h.post).not.toHaveBeenCalled()
  })
  it('uses stored identity and content rather than client claims', async () => {
    h.message.mockResolvedValue({ id: 'm', leagueId: 'l', message: 'Stored', metadata: {}, user: { displayName: 'Real', avatarUrl: null } })
    await syncOutboundLeagueChat(input)
    expect(h.post).toHaveBeenCalledWith('channel', expect.objectContaining({ authorName: 'Real', text: 'Stored' }))
  })
})
