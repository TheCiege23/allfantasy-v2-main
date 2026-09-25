/**
 * The league's Discord: who may set it up, and who gets the invite (owner's decisions, 2026-09-25).
 *
 *   1. Every league MEMBER gets "Join the league Discord" once the commissioner has set it up — from
 *      an invite link stored on the league, never one minted from Discord on a member's page load.
 *      Someone who is NOT in the league never gets the link.
 *   2. The head commissioner AND co-commissioners can set it up. Plain members stay refused (403).
 *
 * Behavioural, against the real route handlers and the real role/membership predicates
 * (`getLeagueRole`, `resolveLeagueMembership`), with prisma replaced by a small in-memory league.
 * Discord itself is a set of spies — a test that sees one called on a member's read has found a bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAGUE = '11111111-2222-4333-8444-555555555555'
const GUILD = '1180313285313167390'
const CHANNEL = '1200000000000000002'

type Team = { claimedByUserId: string; isCommissioner: boolean; isCoCommissioner: boolean; role: string | null }

const h = vi.hoisted(() => ({
  session: null as { user?: { id?: string } } | null,
  league: null as null | { id: string; name: string; userId: string; sport: string; platform: string; settings: unknown },
  teams: [] as Team[],
  channel: null as null | Record<string, unknown>,
  guildLink: null as null | { guildId: string; guildName: string; linkedByUserId: string },
  leagueUpdate: vi.fn(),
  channelUpdateMany: vi.fn(),
  channelCreate: vi.fn(),
  channelUpdate: vi.fn(),
  cookieSet: vi.fn(),
  mint: vi.fn(),
  missingPerms: vi.fn(),
  getChannel: vi.fn(),
  createLeagueChannel: vi.fn(),
  verify: vi.fn(),
  link: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: h.cookieSet, get: () => undefined, delete: vi.fn() }) }))
vi.mock('@/lib/discord/constants', () => ({
  DISCORD_CLIENT_ID: '1499502145039499344',
  DISCORD_BOT_PERMISSIONS: '536988689',
  DISCORD_BOT_CALLBACK_URI: 'https://example.test/api/discord/bot-callback',
}))
vi.mock('@/lib/discord/guild-access', () => ({ verifyGuildManager: h.verify, linkVerifiedGuild: h.link }))
vi.mock('@/lib/discord/leagueChannelAccess', () => ({
  planPrivateChannelAccess: vi.fn(async () => ({ discordUserIds: [], included: [], notLinked: [], notInServer: [], unknown: [] })),
}))
vi.mock('@/lib/discord/bot', () => ({
  isBotConfigured: () => true,
  missingBotPermissions: h.missingPerms,
  createOrReuseChannelInvite: h.mint,
  getChannel: h.getChannel,
  channelVisibility: () => 'server',
  createLeagueChannel: h.createLeagueChannel,
  createWebhook: vi.fn(async () => ({ id: 'wh', token: 'webhook-token-never-returned' })),
  getBotUserId: vi.fn(async () => '1499502145039499344'),
  postMessage: vi.fn(async () => 'm1'),
  privateChannelOverwrites: vi.fn(() => []),
  DiscordApiError: class DiscordApiError extends Error {
    status = 0
  },
}))

/*
 * One league, read the way the real predicates read it. `select` is ignored — every read gets the
 * whole row, which only ever gives a predicate MORE to go on, never less.
 */
vi.mock('@/lib/prisma', () => {
  const byId = (where: { id?: string } | undefined) => (h.league && where?.id === h.league.id ? h.league : null)
  const team = (where: { leagueId?: string; claimedByUserId?: string }) =>
    h.league && where.leagueId === h.league.id
      ? h.teams.find((t) => t.claimedByUserId === where.claimedByUserId) ?? null
      : null
  return {
    prisma: {
      league: {
        findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => byId(where)),
        findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => byId(where)),
        update: vi.fn(async (args: { where: { id: string }; data: { settings?: unknown } }) => {
          h.leagueUpdate(args)
          if (h.league && args.data.settings !== undefined) h.league.settings = args.data.settings
          return h.league
        }),
      },
      leagueTeam: {
        findFirst: vi.fn(async ({ where }: { where: { leagueId?: string; claimedByUserId?: string } }) => team(where)),
        findMany: vi.fn(async () => []),
      },
      roster: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
      redraftLeagueMember: { findUnique: vi.fn(async () => null) },
      userProfile: {
        findUnique: vi.fn(async () => ({
          discordUserId: '1085033561016516730',
          discordConnectedAt: new Date(),
          discordGuildId: GUILD,
        })),
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async () => ({})),
      },
      discordLeagueChannel: {
        findFirst: vi.fn(async () => h.channel),
        updateMany: vi.fn(async (args: unknown) => {
          h.channelUpdateMany(args)
          return { count: h.channel ? 1 : 0 }
        }),
        create: h.channelCreate,
        update: h.channelUpdate,
      },
      discordGuildLink: { findUnique: vi.fn(async () => h.guildLink) },
    },
  }
})

import { GET as getLeagueDiscord, PATCH as patchLeagueDiscord } from '@/app/api/discord/league/route'
import { POST as createChannel } from '@/app/api/discord/channels/create/route'
import { POST as linkGuild } from '@/app/api/discord/guilds/link/route'
import { GET as botInstall } from '@/app/api/discord/bot-install/route'

const OWNER = 'user-owner'
const CO = 'user-co-commish'
const MEMBER = 'user-member'
const OUTSIDER = 'user-outsider'
const STORED_INVITE = 'https://discord.gg/sundaysquad'

function as(userId: string | null) {
  h.session = userId ? { user: { id: userId } } : null
}

function patch(body: unknown) {
  return patchLeagueDiscord(
    new Request('http://localhost/api/discord/league', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function get(query: string) {
  const url = new URL(`http://localhost/api/discord/league?${query}`)
  return getLeagueDiscord({ nextUrl: url } as never)
}

function post(handler: (req: Request) => Promise<Response>, path: string, body: unknown) {
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const storedInvite = () => (h.league?.settings as Record<string, unknown> | null)?.discordInviteUrl

beforeEach(() => {
  vi.clearAllMocks()
  as(OWNER)
  h.league = {
    id: LEAGUE,
    name: 'Sunday Squad',
    userId: OWNER,
    sport: 'NFL',
    platform: 'native',
    settings: { description: 'Winner buys wings', leagueChatThreadId: 'thread-1' },
  }
  h.teams = [
    { claimedByUserId: CO, isCommissioner: false, isCoCommissioner: true, role: null },
    { claimedByUserId: MEMBER, isCommissioner: false, isCoCommissioner: false, role: null },
  ]
  h.channel = {
    id: 'row-1',
    leagueId: LEAGUE,
    guildId: GUILD,
    channelId: CHANNEL,
    channelName: 'sunday-squad',
    surface: 'league_chat',
    syncEnabled: false,
    syncOutbound: false,
    syncInbound: false,
    guild: { guildName: 'Sunday Squad HQ', linkedByUserId: OWNER },
  }
  h.guildLink = { guildId: GUILD, guildName: 'Sunday Squad HQ', linkedByUserId: OWNER }
  h.mint.mockResolvedValue('https://discord.gg/MINTED1')
  h.missingPerms.mockResolvedValue([])
  h.getChannel.mockResolvedValue({ id: CHANNEL, name: 'sunday-squad', guildId: GUILD, overwrites: [] })
  h.createLeagueChannel.mockResolvedValue({ channelId: CHANNEL, channelName: 'sunday-squad' })
  h.verify.mockResolvedValue({ discordUserId: 'd1', guildName: 'Co Commish Server' })
  h.link.mockResolvedValue(true)
})

describe('PATCH /api/discord/league — who may change the bridge', () => {
  it('the owner (head commissioner) still can', async () => {
    const res = await patch({ leagueId: LEAGUE, surface: 'league_chat', syncEnabled: true, syncOutbound: true })
    expect(res.status).toBe(200)
    expect(h.channelUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('a co-commissioner can', async () => {
    as(CO)
    const res = await patch({ leagueId: LEAGUE, surface: 'league_chat', syncEnabled: true, syncOutbound: true })
    expect(res.status).toBe(200)
    expect(h.channelUpdateMany).toHaveBeenCalledWith({
      where: { leagueId: LEAGUE, surface: 'league_chat' },
      data: { syncEnabled: true, syncOutbound: true },
    })
  })

  it('a regular member cannot — 403, and nothing is written', async () => {
    as(MEMBER)
    const res = await patch({ leagueId: LEAGUE, syncEnabled: true })
    expect(res.status).toBe(403)
    expect(h.channelUpdateMany).not.toHaveBeenCalled()
    expect(h.leagueUpdate).not.toHaveBeenCalled()
  })

  it('a member flagged viewer, or someone outside the league, cannot either', async () => {
    h.teams.push({ claimedByUserId: 'user-viewer', isCommissioner: false, isCoCommissioner: true, role: 'viewer' })
    for (const who of ['user-viewer', OUTSIDER]) {
      as(who)
      const res = await patch({ leagueId: LEAGUE, syncEnabled: true })
      expect(res.status, who).toBe(403)
    }
    expect(h.channelUpdateMany).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/discord/league — the invite link', () => {
  it('the owner saves a discord.gg invite onto the league, keeping every other setting', async () => {
    const res = await patch({ leagueId: LEAGUE, inviteUrl: '  https://discord.gg/sundaysquad  ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, inviteUrl: STORED_INVITE })
    expect(storedInvite()).toBe(STORED_INVITE)
    expect(h.league?.settings).toMatchObject({ description: 'Winner buys wings', leagueChatThreadId: 'thread-1' })
    // The invite is a league setting, not a channel toggle — no channel row is touched.
    expect(h.channelUpdateMany).not.toHaveBeenCalled()
  })

  it('a co-commissioner saves a discord.com/invite link', async () => {
    as(CO)
    const res = await patch({ leagueId: LEAGUE, inviteUrl: 'https://discord.com/invite/Sunday-Squad' })
    expect(res.status).toBe(200)
    expect(storedInvite()).toBe('https://discord.com/invite/Sunday-Squad')
  })

  it('works before any channel exists — pasting a link needs no bot', async () => {
    h.channel = null
    const res = await patch({ leagueId: LEAGUE, inviteUrl: STORED_INVITE })
    expect(res.status).toBe(200)
    expect(storedInvite()).toBe(STORED_INVITE)
  })

  it('a regular member cannot set it', async () => {
    as(MEMBER)
    const res = await patch({ leagueId: LEAGUE, inviteUrl: STORED_INVITE })
    expect(res.status).toBe(403)
    expect(h.leagueUpdate).not.toHaveBeenCalled()
  })

  it('null removes it', async () => {
    h.league!.settings = { description: 'Winner buys wings', discordInviteUrl: STORED_INVITE }
    const res = await patch({ leagueId: LEAGUE, inviteUrl: null })
    expect(res.status).toBe(200)
    expect(storedInvite()).toBeUndefined()
    expect(h.league?.settings).toMatchObject({ description: 'Winner buys wings' })
  })

  it.each([
    ['plain http', 'http://discord.gg/sundaysquad'],
    ['another site', 'https://evil.example/sundaysquad'],
    ['a look-alike host', 'https://discord.gg.evil.example/sundaysquad'],
    ['credentials smuggled before the host', 'https://discord.gg@evil.example/sundaysquad'],
    ['a script URL', 'javascript:alert(1)'],
    ['a channel link, not an invite', `https://discord.com/channels/${GUILD}/${CHANNEL}`],
    ['discord.com without /invite/', 'https://discord.com/sundaysquad'],
    ['no code at all', 'https://discord.gg/'],
    ['a path trick', 'https://discord.gg/abc/../../evil'],
    ['an encoded path', 'https://discord.gg/%2e%2e%2fevil'],
    ['a port', 'https://discord.gg:8443/sundaysquad'],
    ['not a string', 12345],
    ['an absurdly long link', `https://discord.gg/${'a'.repeat(300)}`],
  ])('refuses %s with a 400 and writes nothing', async (_label, inviteUrl) => {
    // A toggle rides along, so a route that simply ignored `inviteUrl` would answer 200.
    const res = await patch({ leagueId: LEAGUE, surface: 'league_chat', syncEnabled: true, inviteUrl })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('invalid-invite')
    expect(body.error).toMatch(/discord\.gg/)
    expect(h.leagueUpdate).not.toHaveBeenCalled()
    expect(h.channelUpdateMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/discord/league — the Join link', () => {
  it('a member gets the stored invite, read from the league — Discord is not asked to make one', async () => {
    h.league!.settings = { discordInviteUrl: STORED_INVITE }
    as(MEMBER)
    const res = await get(`leagueId=${LEAGUE}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inviteUrl).toBe(STORED_INVITE)
    expect(body.isCommissioner).toBe(false)
    expect(h.mint).not.toHaveBeenCalled()
  })

  it('a member sees the invite even when no channel was ever made (pasted link, no bot)', async () => {
    h.league!.settings = { discordInviteUrl: STORED_INVITE }
    h.channel = null
    as(MEMBER)
    const body = await (await get(`leagueId=${LEAGUE}`)).json()
    expect(body.inviteUrl).toBe(STORED_INVITE)
    expect(body.channel).toBeNull()
  })

  it('no stored invite means no invite — never a freshly minted one', async () => {
    as(MEMBER)
    const body = await (await get(`leagueId=${LEAGUE}`)).json()
    expect(body.inviteUrl).toBeNull()
    expect(h.mint).not.toHaveBeenCalled()
  })

  it('someone outside the league never gets the invite', async () => {
    h.league!.settings = { discordInviteUrl: STORED_INVITE }
    as(OUTSIDER)
    const res = await get(`leagueId=${LEAGUE}`)
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain('discord.gg')
  })

  it('a stored value that is not a valid invite is never handed out', async () => {
    h.league!.settings = { discordInviteUrl: 'javascript:alert(1)' }
    as(MEMBER)
    const body = await (await get(`leagueId=${LEAGUE}`)).json()
    expect(body.inviteUrl).toBeNull()
  })

  it('a co-commissioner is told they can manage it', async () => {
    as(CO)
    const body = await (await get(`leagueId=${LEAGUE}`)).json()
    expect(body.isCommissioner).toBe(true)
  })
})

describe('the other bridge writes agree with PATCH', () => {
  it('channels/create: a co-commissioner can make the channel in a server they added AllFantasy to', async () => {
    as(CO)
    h.channel = null
    h.guildLink = { guildId: GUILD, guildName: 'Co Commish Server', linkedByUserId: CO }
    const res = await post(createChannel, '/api/discord/channels/create', { leagueId: LEAGUE, guildId: GUILD })
    expect(res.status).toBe(200)
    expect(h.channelCreate).toHaveBeenCalledTimes(1)
  })

  it('channels/create: a regular member is refused before Discord is touched', async () => {
    as(MEMBER)
    h.channel = null
    h.guildLink = { guildId: GUILD, guildName: 'Member Server', linkedByUserId: MEMBER }
    const res = await post(createChannel, '/api/discord/channels/create', { leagueId: LEAGUE, guildId: GUILD })
    expect(res.status).toBe(403)
    expect(h.createLeagueChannel).not.toHaveBeenCalled()
    expect(h.channelCreate).not.toHaveBeenCalled()
  })

  it('channels/create: keeps the invite Discord gave it, so members get a Join button with no extra step', async () => {
    h.channel = null
    const res = await post(createChannel, '/api/discord/channels/create', { leagueId: LEAGUE, guildId: GUILD })
    expect(res.status).toBe(200)
    expect((await res.json()).inviteUrl).toBe('https://discord.gg/MINTED1')
    expect(storedInvite()).toBe('https://discord.gg/MINTED1')
  })

  it('channels/create: never replaces a link the commissioner pasted', async () => {
    h.channel = null
    h.league!.settings = { discordInviteUrl: STORED_INVITE }
    const res = await post(createChannel, '/api/discord/channels/create', { leagueId: LEAGUE, guildId: GUILD })
    expect((await res.json()).inviteUrl).toBe(STORED_INVITE)
    expect(storedInvite()).toBe(STORED_INVITE)
  })

  it('channels/create: replaces an invite it kept from an OLDER channel — that link died with it', async () => {
    h.channel = null
    h.league!.settings = { discordInviteUrl: 'https://discord.gg/OLDCHAN', discordInviteChannelId: '1200000000000000009' }
    const res = await post(createChannel, '/api/discord/channels/create', { leagueId: LEAGUE, guildId: GUILD })
    expect((await res.json()).inviteUrl).toBe('https://discord.gg/MINTED1')
    expect(h.league?.settings).toMatchObject({ discordInviteUrl: 'https://discord.gg/MINTED1', discordInviteChannelId: CHANNEL })
  })

  it('channels/create: with no fresh invite from Discord, drops the dead one rather than keep it', async () => {
    h.channel = null
    h.mint.mockResolvedValue(null)
    h.league!.settings = { discordInviteUrl: 'https://discord.gg/OLDCHAN', discordInviteChannelId: '1200000000000000009' }
    const res = await post(createChannel, '/api/discord/channels/create', { leagueId: LEAGUE, guildId: GUILD })
    expect((await res.json()).inviteUrl).toBeNull()
    expect(storedInvite()).toBeUndefined()
  })

  it('a pasted link is the commissioner’s: saving one drops the kept-from-channel marker', async () => {
    h.league!.settings = { discordInviteUrl: 'https://discord.gg/MINTED1', discordInviteChannelId: CHANNEL }
    await patch({ leagueId: LEAGUE, inviteUrl: STORED_INVITE })
    expect(h.league?.settings).toEqual({ discordInviteUrl: STORED_INVITE })
  })

  it('guilds/link: a co-commissioner can link a server they manage; a member cannot', async () => {
    as(CO)
    expect((await post(linkGuild, '/api/discord/guilds/link', { leagueId: LEAGUE, guildId: GUILD })).status).toBe(200)
    as(MEMBER)
    const res = await post(linkGuild, '/api/discord/guilds/link', { leagueId: LEAGUE, guildId: GUILD })
    expect(res.status).toBe(403)
    expect(h.verify).toHaveBeenCalledTimes(1)
  })

  it('bot-install: a co-commissioner comes back to the league setup screen; a member does not', async () => {
    as(CO)
    await botInstall({ nextUrl: new URL(`https://allfantasy.ai/api/discord/bot-install?leagueId=${LEAGUE}`) } as never)
    expect(h.cookieSet).toHaveBeenCalledWith('discord_bot_league', LEAGUE, expect.objectContaining({ httpOnly: true }))
    h.cookieSet.mockClear()
    as(MEMBER)
    await botInstall({ nextUrl: new URL(`https://allfantasy.ai/api/discord/bot-install?leagueId=${LEAGUE}`) } as never)
    expect(h.cookieSet).not.toHaveBeenCalledWith('discord_bot_league', LEAGUE, expect.anything())
  })
})
