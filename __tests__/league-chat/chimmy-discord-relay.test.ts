// @vitest-environment node
/**
 * A Chimmy post relayed to a league's Discord reads as Chimmy — decided by the ROW's server-owned
 * marker, not by whatever author the caller passed. The real `lib/discord/bot.ts` runs against a
 * stubbed fetch, so the embed asserted on is the one Discord would receive.
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

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const row = (metadata: unknown) => ({
  leagueId: 'L1',
  sourceDiscord: false,
  isPrivate: false,
  visibleToUserId: null,
  source: null,
  metadata,
})

/** What a caller that read the row's own sender would pass: the commissioner, face and all. */
const input = {
  leagueId: 'L1',
  messageId: 'msg1',
  authorName: 'Pat Commissioner',
  authorAvatarUrl: 'https://cdn.example/pat.png',
  text: 'On paper, Casey wins this one: 8,800 in, 3,560 out (+5,240).',
}

function embed() {
  const [, init] = h.fetch.mock.calls[0]
  return JSON.parse(init.body).embeds[0] as { author: { name: string; icon_url?: string }; description: string }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_BOT_TOKEN', 'test-bot-token')
  vi.stubGlobal('fetch', h.fetch)
  h.fetch.mockResolvedValue(json({ id: 'discord-msg-1' }))
  h.channelFindFirst.mockResolvedValue({ guildId: 'G', channelId: '1200000000000000002', league: { name: 'Iron Horse' } })
  h.linkCreate.mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Chimmy in the Discord relay', () => {
  it('relays a Chimmy post as "Chimmy", never under the commissioner it is stored under', async () => {
    h.messageFindUnique.mockResolvedValue(row({ chimmy: true, chimmyMoment: { v: 1, kind: 'trade' } }))
    await expect(syncOutboundLeagueChat(input)).resolves.toMatchObject({ synced: true })
    expect(embed().author.name).toBe('Chimmy')
    expect(embed().author).not.toHaveProperty('icon_url')
    expect(embed().description).toBe(input.text)
  })

  it('an ordinary message keeps its real author', async () => {
    h.messageFindUnique.mockResolvedValue(row(null))
    await syncOutboundLeagueChat(input)
    expect(embed().author).toEqual({ name: 'Pat Commissioner', icon_url: 'https://cdn.example/pat.png' })
  })

  it('a row that only CALLS itself Chimmy is relayed under the name the caller gave', async () => {
    h.messageFindUnique.mockResolvedValue(row({ discordAuthorName: 'Chimmy' }))
    await syncOutboundLeagueChat({ ...input, authorName: 'Casey' })
    expect(embed().author.name).toBe('Casey')
  })
})
