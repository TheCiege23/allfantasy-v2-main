import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ profile: vi.fn(), upsert: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findUnique: h.profile }, discordGuildLink: { upsert: h.upsert } } }))
import { verifyGuildManager, linkVerifiedGuild } from '@/lib/discord/guild-access'
import { privateChannelOverwrites } from '@/lib/discord/bot'
const guild = '1180313285313167390'
const human = '1085033561016516730'
const bot = '1499502145039499344'
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_BOT_TOKEN', 'test')
  vi.stubGlobal('fetch', h.fetch)
  h.profile.mockResolvedValue({ discordUserId: human, discordConnectedAt: new Date() })
  h.fetch.mockResolvedValue(response({ owner_id: human, name: 'Server' }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('Discord human authority', () => {
  it('accepts the OAuth-connected server owner', async () => {
    expect(await verifyGuildManager('me', guild)).toEqual({ discordUserId: human, guildName: 'Server' })
  })
  it('rejects a profile without a verified Discord connection', async () => {
    h.profile.mockResolvedValue({ discordUserId: human, discordConnectedAt: null })
    expect(await verifyGuildManager('me', guild)).toBeNull()
    expect(h.fetch).not.toHaveBeenCalled()
  })
  it.each(['8', '32'])('accepts a server manager with permission %s', async permission => {
    h.fetch.mockResolvedValueOnce(response({ owner_id: 'other', name: 'Server' }))
      .mockResolvedValueOnce(response({ roles: ['manager'] }))
      .mockResolvedValueOnce(response([{ id: 'manager', permissions: permission }]))
    expect(await verifyGuildManager('me', guild)).not.toBeNull()
  })
  it('rejects an ordinary member even when the bot is installed', async () => {
    h.fetch.mockResolvedValueOnce(response({ owner_id: 'other' }))
      .mockResolvedValueOnce(response({ roles: [] }))
      .mockResolvedValueOnce(response([{ id: guild, permissions: '1024' }]))
    expect(await verifyGuildManager('me', guild)).toBeNull()
  })
  it('fails closed when Discord cannot verify authority', async () => {
    h.fetch.mockRejectedValue(new Error('offline'))
    expect(await verifyGuildManager('me', guild)).toBeNull()
  })
  it('does not transfer an existing link', async () => {
    h.upsert.mockResolvedValue({ linkedByUserId: 'other' })
    expect(await linkVerifiedGuild('me', guild, 'Server')).toBe(false)
    expect(h.upsert.mock.calls[0][0].update).toEqual({})
  })
})
describe('private channel permissions', () => {
  it('denies everyone and permits only explicit members and the bot', () => {
    expect(privateChannelOverwrites(guild, bot, [human, human])).toEqual([
      { id: guild, type: 0, deny: '1024', allow: '0' },
      { id: bot, type: 1, deny: '0', allow: '117760' },
      { id: human, type: 1, deny: '0', allow: '117760' },
    ])
  })
  it('rejects malformed permission identities', () => {
    expect(() => privateChannelOverwrites(guild, bot, ['not-an-id'])).toThrow()
  })
})
