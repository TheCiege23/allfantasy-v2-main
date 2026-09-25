/**
 * Discord → AllFantasy ("two-way") pass. Built to ride an existing cron, so it must
 * never throw, must stop starting new channels at its budget, and must never import
 * AllFantasy's own copies back into AllFantasy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  linkFindFirst: vi.fn(),
  linkCreate: vi.fn(),
  createMessage: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    discordLeagueChannel: { findMany: h.findMany, update: h.update },
    discordMessageLink: { findFirst: h.linkFindFirst, create: h.linkCreate },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: h.createMessage }))

import { runDiscordInboundPass } from '@/lib/discord/inboundPass'
import { DISCORD_INBOUND_SCHEDULED } from '@/lib/discord/inboundStatus'

const BOT = '1499502145039499344'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const row = (id: string, cursor: string | null) => ({
  id,
  leagueId: `league-${id}`,
  guildId: 'G',
  channelId: `chan-${id}`,
  lastSyncedMessageId: cursor,
  guild: { linkedByUserId: 'commish' },
})

let messagesByChannel: Record<string, unknown[]>

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_BOT_TOKEN', 'test-bot-token')
  vi.stubGlobal('fetch', h.fetch)
  messagesByChannel = {}
  h.fetch.mockImplementation((input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/users/@me')) return Promise.resolve(json({ id: BOT }))
    const m = url.pathname.match(/\/channels\/([^/]+)\/messages$/)
    if (m) return Promise.resolve(json(messagesByChannel[m[1]] ?? []))
    return Promise.resolve(json({}, 404))
  })
  h.linkFindFirst.mockResolvedValue(null)
  h.linkCreate.mockResolvedValue({})
  h.update.mockResolvedValue({})
  h.createMessage.mockImplementation(async () => ({ id: `created-${h.createMessage.mock.calls.length}` }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('two-way is honest about not being scheduled', () => {
  it('is not marked as scheduled until a host cron runs it', () => {
    expect(DISCORD_INBOUND_SCHEDULED).toBe(false)
  })
})

describe('what it imports', () => {
  it('imports people’s lines, skips its own relayed posts and empty lines, and moves the cursor', async () => {
    h.findMany.mockResolvedValue([row('a', '100')])
    messagesByChannel['chan-a'] = [
      { id: '103', content: 'I’ll listen on Achane.', author: { id: '555', username: 'priya' } },
      { id: '102', content: '', author: { id: '556', username: 'emptyline' } },
      { id: '101', content: 'Marcus: anyone moving a RB?', author: { id: BOT, username: 'AllFantasy' } },
    ]
    const report = await runDiscordInboundPass({ budgetMs: 10_000 })
    expect(report).toMatchObject({ channels: 1, imported: 1, errors: 0, deferred: 0 })
    expect(h.createMessage).toHaveBeenCalledTimes(1)
    expect(h.createMessage.mock.calls[0][2]).toBe('I’ll listen on Achane.')
    expect(h.createMessage.mock.calls[0][3]).toMatchObject({ sourceDiscord: true, discordMessageId: '103' })
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { lastSyncedMessageId: '103' } })
  })

  it('starts from "now" on first sight — never imports a channel’s history', async () => {
    h.findMany.mockResolvedValue([row('a', null)])
    messagesByChannel['chan-a'] = [{ id: '999', content: 'old history', author: { id: '555' } }]
    const report = await runDiscordInboundPass({ budgetMs: 10_000 })
    expect(report.imported).toBe(0)
    expect(h.createMessage).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { lastSyncedMessageId: '999' } })
  })

  it('does not import a line it already imported', async () => {
    h.findMany.mockResolvedValue([row('a', '100')])
    messagesByChannel['chan-a'] = [{ id: '101', content: 'dup', author: { id: '555' } }]
    h.linkFindFirst.mockResolvedValue({ id: 'already' })
    await runDiscordInboundPass({ budgetMs: 10_000 })
    expect(h.createMessage).not.toHaveBeenCalled()
  })

  it('only reads channels with two-way switched on', async () => {
    h.findMany.mockResolvedValue([])
    await runDiscordInboundPass({ budgetMs: 10_000 })
    expect(h.findMany.mock.calls[0][0].where).toEqual({ syncEnabled: true, syncInbound: true, surface: 'league_chat' })
  })
})

describe('safe to host inside another cron', () => {
  it('never throws when the database does', async () => {
    h.findMany.mockRejectedValue(new Error('db down'))
    await expect(runDiscordInboundPass({ budgetMs: 10_000 })).resolves.toMatchObject({ errors: 1, imported: 0 })
  })

  it('keeps going past one channel that fails', async () => {
    h.findMany.mockResolvedValue([row('a', '100'), row('b', '100')])
    messagesByChannel['chan-b'] = [{ id: '101', content: 'hello', author: { id: '555' } }]
    h.fetch.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/users/@me')) return Promise.resolve(json({ id: BOT }))
      if (url.pathname.includes('chan-a')) return Promise.resolve(json({ message: 'Missing Access' }, 403))
      return Promise.resolve(json(messagesByChannel['chan-b']))
    })
    const report = await runDiscordInboundPass({ budgetMs: 10_000 })
    expect(report).toMatchObject({ imported: 1, errors: 1 })
  })

  it('stops starting channels once its budget is spent, and says how many it left', async () => {
    h.findMany.mockResolvedValue([row('a', '100'), row('b', '200'), row('c', '300')])
    let t = 0
    const now = () => {
      t += 600
      return t
    }
    const report = await runDiscordInboundPass({ budgetMs: 1_000, now })
    expect(report.deferred).toBeGreaterThan(0)
    expect(report.deferred).toBeLessThan(3)
  })

  it('refuses to run blind: without its own bot id it reads no channel at all', async () => {
    // Fresh modules: `getBotUserId` caches the id once it has seen it, and an earlier
    // test in this file already has. Without the reset this test would pass on the
    // cached id and prove nothing about the guard.
    vi.resetModules()
    const { runDiscordInboundPass: freshPass } = await import('@/lib/discord/inboundPass')
    h.findMany.mockResolvedValue([row('a', '100')])
    messagesByChannel['chan-a'] = [{ id: '101', content: 'hello', author: { id: BOT } }]
    h.fetch.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/users/@me')) return Promise.resolve(json({ message: 'Unauthorized' }, 401))
      return Promise.resolve(json(messagesByChannel['chan-a']))
    })
    const report = await freshPass({ budgetMs: 10_000 })
    expect(report).toMatchObject({ imported: 0, errors: 1 })
    const messageReads = h.fetch.mock.calls.filter(([u]) => String(u).includes('/messages'))
    expect(messageReads).toHaveLength(0)
    expect(h.createMessage).not.toHaveBeenCalled()
  })
})
