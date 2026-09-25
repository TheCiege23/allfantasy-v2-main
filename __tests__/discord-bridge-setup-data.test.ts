/**
 * `getDiscordBridge` + the template link — the data behind /core/discord's steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
  profilesFindMany: vi.fn(),
  channelFindFirst: vi.fn(),
  teamsFindMany: vi.fn(),
  guildLinkFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: h.leagueFindFirst },
    userProfile: { findUnique: h.profileFindUnique, findMany: h.profilesFindMany },
    discordLeagueChannel: { findFirst: h.channelFindFirst },
    // `findFirst` (and `roster`) are read by the role check — `canManageDiscordBridge` → `getLeagueRole` —
    // once the caller is not the owner. Co-commissioners are covered in discord-join-screens.
    leagueTeam: { findMany: h.teamsFindMany, findFirst: async () => null },
    roster: { findFirst: async () => null },
    discordGuildLink: { findUnique: h.guildLinkFindUnique },
  },
}))

import { BRIDGE_SCOPES_REFUSED, BRIDGE_SURFACES, getDiscordBridge } from '@/lib/core-app/discordBridge'
import { leagueTemplateUrl } from '@/lib/discord/template'

const GUILD = '1180313285313167390'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_BOT_TOKEN', 'x')
  h.leagueFindFirst.mockResolvedValue({ id: 'league_1', name: 'Iron Horse', userId: 'commish' })
  h.profileFindUnique.mockResolvedValue({ discordUserId: '1085033561016516730', discordUsername: 'guap', discordGuildId: GUILD })
  h.profilesFindMany.mockResolvedValue([])
  h.channelFindFirst.mockResolvedValue(null)
  h.teamsFindMany.mockResolvedValue([])
  h.guildLinkFindUnique.mockResolvedValue({ guildName: 'Iron Horse', linkedByUserId: 'commish' })
})
afterEach(() => vi.unstubAllEnvs())

describe('the template link', () => {
  it.each([
    ['a bare code', 'hK8bYk3XwZ9m', 'https://discord.new/hK8bYk3XwZ9m'],
    ['a pasted discord.new link', 'https://discord.new/hK8bYk3XwZ9m', 'https://discord.new/hK8bYk3XwZ9m'],
    ['a pasted template link', 'https://discord.com/template/hK8bYk3XwZ9m', 'https://discord.new/hK8bYk3XwZ9m'],
    ['surrounding spaces', '  hK8bYk3XwZ9m  ', 'https://discord.new/hK8bYk3XwZ9m'],
  ])('accepts %s', (_label, raw, expected) => {
    expect(leagueTemplateUrl(raw)).toBe(expected)
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['a script URL', 'javascript:alert(1)'],
    ['another site', 'https://evil.example/hK8bYk3XwZ9m'],
    ['a path', 'abc/../def'],
  ])('refuses %s', (_label, raw) => {
    expect(leagueTemplateUrl(raw)).toBeNull()
  })
})

describe('getDiscordBridge', () => {
  it('is commissioner-only', async () => {
    expect(await getDiscordBridge('someone-else', 'league_1')).toBeNull()
  })

  it('points "Add AllFantasy" at the real install round trip for THIS league', async () => {
    const data = await getDiscordBridge('commish', 'league_1')
    expect(data?.installUrl).toBe('/api/discord/bot-install?leagueId=league_1')
    expect(data?.installUrl).not.toContain('discord.com')
  })

  it('calls the server ready only when this commissioner added AllFantasy to it', async () => {
    expect((await getDiscordBridge('commish', 'league_1'))?.serverReady).toBe(true)
    h.guildLinkFindUnique.mockResolvedValue({ guildName: 'Iron Horse', linkedByUserId: 'other-account' })
    expect((await getDiscordBridge('commish', 'league_1'))?.serverReady).toBe(false)
    h.guildLinkFindUnique.mockResolvedValue(null)
    expect((await getDiscordBridge('commish', 'league_1'))?.serverReady).toBe(false)
  })

  it('reads the template code from the environment', async () => {
    vi.stubEnv('DISCORD_LEAGUE_TEMPLATE_CODE', 'hK8bYk3XwZ9m')
    expect((await getDiscordBridge('commish', 'league_1'))?.templateUrl).toBe('https://discord.new/hK8bYk3XwZ9m')
    vi.stubEnv('DISCORD_LEAGUE_TEMPLATE_CODE', '')
    expect((await getDiscordBridge('commish', 'league_1'))?.templateUrl).toBeNull()
  })

  it('does not offer two-way while nothing schedules it', async () => {
    expect((await getDiscordBridge('commish', 'league_1'))?.inboundAvailable).toBe(false)
  })

  it('shows league chat copying OFF when there is no channel yet', async () => {
    const data = await getDiscordBridge('commish', 'league_1')
    expect(data?.mappings.find((m) => m.surface.id === 'league_chat')?.direction).toBe('off')
  })

  it('reads only the league_chat channel row', async () => {
    await getDiscordBridge('commish', 'league_1')
    expect(h.channelFindFirst.mock.calls[0][0].where).toEqual({ leagueId: 'league_1', surface: 'league_chat' })
  })
})

describe('defaults and promises', () => {
  it('defaults league chat and commissioner-only surfaces to OFF', () => {
    for (const s of BRIDGE_SURFACES.filter((x) => x.id === 'league_chat' || x.commissionerOnly)) {
      expect(s.defaultDirection, s.id).toBe('off')
    }
  })

  it('no longer promises the bot cannot see the rest of the server', () => {
    expect(BRIDGE_SCOPES_REFUSED.join(' ')).not.toMatch(/cannot see the rest of the server/i)
  })
})
