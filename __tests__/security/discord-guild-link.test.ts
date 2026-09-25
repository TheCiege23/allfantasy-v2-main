import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A league owner could claim ANY Discord server (owner's call 2026-09-25, "fix both security holes
 * now"): the route upserted the link with the caller as owner, overwriting whoever held it, and
 * channels/create trusts that record — so our bot would create channels and webhooks in a server the
 * caller has no rights in. Now Discord must confirm the caller manages the server, and an existing
 * link is never handed over.
 */

const h = vi.hoisted(() => ({
  session: { user: { id: 'owner-1' } } as { user?: { id?: string } } | null,
  leagueOwner: 'owner-1',
  verify: vi.fn(),
  link: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/discord/guild-access', () => ({ verifyGuildManager: h.verify, linkVerifiedGuild: h.link }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: async () => ({ userId: h.leagueOwner }) },
    discordGuildLink: { upsert: h.upsert },
  },
}))

import { POST } from '@/app/api/discord/guilds/link/route'

const post = (body: unknown) => POST(new Request('https://x.test/api/discord/guilds/link', { method: 'POST', body: JSON.stringify(body) }))
const GUILD = '123456789012345678'

beforeEach(() => {
  h.session = { user: { id: 'owner-1' } }
  h.leagueOwner = 'owner-1'
  h.verify.mockReset().mockResolvedValue({ discordUserId: 'd1', guildName: 'Real Server Name' })
  h.link.mockReset().mockResolvedValue(true)
  h.upsert.mockReset()
})

describe('linking a Discord server to a league', () => {
  it('refuses a server Discord does not say the caller manages — and writes nothing', async () => {
    h.verify.mockResolvedValue(null)
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('discord_server_not_managed')
    expect(h.link).not.toHaveBeenCalled()
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('never takes over a server someone else already linked', async () => {
    h.link.mockResolvedValue(false)
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(409)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('links a server the caller manages, named by Discord rather than by the request', async () => {
    const res = await post({ leagueId: 'L1', guildId: GUILD, guildName: 'Spoofed' })
    expect(res.status).toBe(200)
    expect(h.verify).toHaveBeenCalledWith('owner-1', GUILD)
    expect(h.link).toHaveBeenCalledWith('owner-1', GUILD, 'Real Server Name')
    expect((await res.json()).guildName).toBe('Real Server Name')
  })

  it('still requires sign-in and league ownership first', async () => {
    h.leagueOwner = 'someone-else'
    expect((await post({ leagueId: 'L1', guildId: GUILD })).status).toBe(403)
    h.session = null
    expect((await post({ leagueId: 'L1', guildId: GUILD })).status).toBe(401)
    expect(h.verify).not.toHaveBeenCalled()
  })
})
