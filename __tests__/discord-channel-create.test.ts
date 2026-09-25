import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session: vi.fn(), league: vi.fn(), guild: vi.fn(), manager: vi.fn(), mapping: vi.fn(), members: vi.fn(), profiles: vi.fn(), create: vi.fn(), save: vi.fn(), cleanup: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/discord/guild-access', () => ({ verifyGuildManager: h.manager }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: h.members }))
vi.mock('@/lib/discord/bot', () => ({ isBotConfigured: () => true, createLeagueChannel: h.create, deleteUnmappedChannel: h.cleanup }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findFirst: h.league }, discordGuildLink: { findUnique: h.guild },
  discordLeagueChannel: { findFirst: h.mapping, upsert: h.save }, userProfile: { findMany: h.profiles },
} }))
import { POST } from '@/app/api/discord/channels/create/route'
const request = () => new Request('https://example.test/api/discord/channels/create', { method: 'POST', body: JSON.stringify({ leagueId: 'league', guildId: 'guild' }) })
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.league.mockResolvedValue({ userId: 'me', name: 'League' })
  h.guild.mockResolvedValue({ linkedByUserId: 'me' })
  h.manager.mockResolvedValue({ discordUserId: 'owner' })
  h.mapping.mockResolvedValue(null)
  h.members.mockResolvedValue(['me', 'member'])
  h.profiles.mockResolvedValue([{ discordUserId: 'member-discord' }])
  h.create.mockResolvedValue({ channelId: 'new', channelName: 'league' })
  h.save.mockResolvedValue({ channelId: 'new', surface: 'league_chat' })
  h.cleanup.mockResolvedValue(undefined)
})
describe('private Discord channel creation', () => {
  it('requires authentication', async () => {
    h.session.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
  })
  it('requires current Discord management rights', async () => {
    h.manager.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })
  it('reuses an existing mapping without creating a new channel', async () => {
    h.mapping.mockResolvedValue({ channelId: 'existing', channelName: 'league', guildId: 'guild' })
    expect((await POST(request())).status).toBe(200)
    expect(h.create).not.toHaveBeenCalled()
  })
  it('passes only connected league identities to the permission builder', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(h.create).toHaveBeenCalledWith('guild', 'League', ['owner', 'member-discord'])
    expect(h.profiles.mock.calls[0][0].where).toEqual({ userId: { in: ['me', 'member'] }, discordConnectedAt: { not: null }, discordUserId: { not: null } })
  })
  it('cleans up its newly created channel when persistence fails', async () => {
    h.save.mockRejectedValue(new Error('database offline'))
    expect((await POST(request())).status).toBe(503)
    expect(h.cleanup).toHaveBeenCalledWith('new')
  })
  it('returns the winning mapping and removes only its own duplicate channel', async () => {
    h.save.mockResolvedValue({ channelId: 'winner', channelName: 'league', guildId: 'guild', surface: 'league_chat' })
    const response = await POST(request())
    expect((await response.json()).channelId).toBe('winner')
    expect(h.cleanup).toHaveBeenCalledWith('new')
    expect(h.save.mock.calls[0][0].update).toEqual({})
  })
  it('does not claim a different surface as league chat', async () => {
    h.save.mockResolvedValue({ channelId: 'other-surface', guildId: 'guild', surface: 'commissioner' })
    expect((await POST(request())).status).toBe(409)
    expect(h.cleanup).toHaveBeenCalledWith('new')
  })
})
