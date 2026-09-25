/**
 * `syncOutboundLeagueChat` — the one gate every AllFantasy → Discord copy goes through.
 *
 * The real `lib/discord/bot.ts` runs against a stubbed fetch, so "nothing was posted"
 * means no request was built at all, and the retry is the real retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  channelFindFirst: vi.fn(),
  messageFindUnique: vi.fn(),
  linkCreate: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    discordLeagueChannel: { findFirst: h.channelFindFirst },
    leagueChatMessage: { findUnique: h.messageFindUnique },
    discordMessageLink: { create: h.linkCreate },
  },
}))

import { syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'
import { DiscordApiError } from '@/lib/discord/bot'

const CHANNEL = '1200000000000000002'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const input = {
  leagueId: 'L1',
  messageId: 'msg1',
  authorName: 'Marcus',
  authorAvatarUrl: null,
  text: 'Anyone moving a RB before the deadline?',
}

const publicMessage = {
  leagueId: 'L1',
  sourceDiscord: false,
  isPrivate: false,
  visibleToUserId: null,
  source: null,
  metadata: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_BOT_TOKEN', 'test-bot-token')
  vi.stubGlobal('fetch', h.fetch)
  h.fetch.mockResolvedValue(json({ id: 'discord-msg-1' }))
  h.channelFindFirst.mockResolvedValue({ guildId: 'G', channelId: CHANNEL, league: { name: 'Iron Horse' } })
  h.messageFindUnique.mockResolvedValue(publicMessage)
  h.linkCreate.mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('what may leave AllFantasy', () => {
  it('copies a public main-chat message and records the link', async () => {
    const result = await syncOutboundLeagueChat(input)
    expect(result).toEqual({ synced: true, discordMessageId: 'discord-msg-1' })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0]
    expect(String(url)).toContain(`/channels/${CHANNEL}/messages`)
    expect(JSON.parse(init.body).embeds[0].description).toBe(input.text)
    expect(h.linkCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ direction: 'to_discord', leagueMessageId: 'msg1' }) })
  })

  it('only reads the league_chat row, and only when copying is switched on', async () => {
    await syncOutboundLeagueChat(input)
    expect(h.channelFindFirst.mock.calls[0][0].where).toEqual({
      leagueId: 'L1',
      surface: 'league_chat',
      syncEnabled: true,
      syncOutbound: true,
    })
  })

  it('does nothing when copying is off (no row matches)', async () => {
    h.channelFindFirst.mockResolvedValue(null)
    expect(await syncOutboundLeagueChat(input)).toEqual({ synced: false })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a private Chimmy line', { isPrivate: true }],
    ['a line visible to one person (secret ballot)', { visibleToUserId: 'u1' }],
    ['draft-only chat', { source: 'draft' }],
    ['a Survivor tribe chat', { source: 'tribe:abc' }],
    ['Big Brother’s HOH room', { metadata: { bbChannel: 'hoh_room' } }],
    ['Big Brother’s jury room', { metadata: { bbChannel: 'jury' } }],
    ['a line flagged private in metadata', { metadata: { private: true } }],
    ['a line that came FROM Discord (loop)', { sourceDiscord: true }],
    ['a message from another league', { leagueId: 'OTHER' }],
  ])('never copies %s', async (_label, patch) => {
    h.messageFindUnique.mockResolvedValue({ ...publicMessage, ...patch })
    expect(await syncOutboundLeagueChat(input)).toEqual({ synced: false })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('never copies a message id that does not exist', async () => {
    h.messageFindUnique.mockResolvedValue(null)
    expect(await syncOutboundLeagueChat(input)).toEqual({ synced: false })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('does copy Big Brother’s main room', async () => {
    h.messageFindUnique.mockResolvedValue({ ...publicMessage, metadata: { bbChannel: 'main' } })
    expect((await syncOutboundLeagueChat(input)).synced).toBe(true)
  })
})

describe('one bounded retry', () => {
  it('retries once after a short rate limit and then succeeds', async () => {
    h.fetch
      .mockResolvedValueOnce(json({ message: 'You are being rate limited.', retry_after: 0.01 }, 429))
      .mockResolvedValueOnce(json({ id: 'discord-msg-2' }))
    const result = await syncOutboundLeagueChat(input)
    expect(result.synced).toBe(true)
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries once after a Discord server error', async () => {
    vi.useFakeTimers()
    try {
      h.fetch.mockResolvedValueOnce(json({ message: 'oops' }, 502)).mockResolvedValueOnce(json({ id: 'discord-msg-3' }))
      const pending = syncOutboundLeagueChat(input)
      await vi.advanceTimersByTimeAsync(1_000)
      expect((await pending).synced).toBe(true)
      expect(h.fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not hold the send open for a long cooldown — gives up and says so', async () => {
    h.fetch.mockResolvedValue(json({ message: 'slow down', retry_after: 60 }, 429))
    const err = await syncOutboundLeagueChat(input).catch((e) => e)
    expect(err).toBeInstanceOf(DiscordApiError)
    expect(err.status).toBe(429)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.linkCreate).not.toHaveBeenCalled()
  })

  it('never retries a refusal', async () => {
    h.fetch.mockResolvedValue(json({ message: 'Missing Access' }, 403))
    const err = await syncOutboundLeagueChat(input).catch((e) => e)
    expect(err.status).toBe(403)
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the bot token out of the error it throws', async () => {
    h.fetch.mockResolvedValue(json({ message: 'Missing Access' }, 403))
    const err = await syncOutboundLeagueChat(input).catch((e) => e)
    expect(String(err.message)).not.toContain('test-bot-token')
  })
})
