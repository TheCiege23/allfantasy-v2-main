/**
 * POST /api/discord/channels/create — the league's own channel.
 *
 * Runs the REAL `lib/discord/bot.ts` against a stubbed `fetch`, so what is asserted
 * is what would actually be sent to Discord — in particular the permission
 * overwrites that make a members-only channel private from its first moment.
 * No request leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  leagueFindFirst: vi.fn(),
  guildLinkFindUnique: vi.fn(),
  channelFindFirst: vi.fn(),
  channelCreate: vi.fn(),
  channelUpdate: vi.fn(),
  teamsFindMany: vi.fn(),
  profilesFindMany: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: h.leagueFindFirst },
    discordGuildLink: { findUnique: h.guildLinkFindUnique },
    discordLeagueChannel: { findFirst: h.channelFindFirst, create: h.channelCreate, update: h.channelUpdate },
    // `findFirst` (and `roster`) are read by the role check — `canManageDiscordBridge` → `getLeagueRole` —
    // once the caller is not the owner. Nobody in this file is a co-commissioner.
    leagueTeam: { findMany: h.teamsFindMany, findFirst: async () => null },
    roster: { findFirst: async () => null },
    userProfile: { findMany: h.profilesFindMany },
  },
}))

import { POST } from '@/app/api/discord/channels/create/route'

const GUILD = '1180313285313167390'
const BOT = '1499502145039499344'
const ME_DISCORD = '1085033561016516730'
const PRIYA_DISCORD = '1085033561016516731'
const MARCUS_DISCORD = '1085033561016516732'
const CATEGORY = '1200000000000000001'
const CHANNEL = '1200000000000000002'
const OLD_CHANNEL = '1200000000000000009'

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

type Call = { method: string; path: string; body: any }
let calls: Call[] = []
let routes: Record<string, (body: any) => Response>

function discordRouter(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname.replace('/api/v10', '')
  const body = init?.body ? JSON.parse(String(init.body)) : null
  calls.push({ method, path, body })
  const key = `${method} ${path}`
  const handler = routes[key]
  if (handler) return Promise.resolve(handler(body))
  // A second POST to the channels path is the text channel (the first is the category).
  return Promise.resolve(json({ message: 'unexpected ' + key }, 500))
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/discord/channels/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const channelPosts = () => calls.filter((c) => c.method === 'POST' && c.path === `/guilds/${GUILD}/channels`)
const textChannelPost = () => channelPosts().find((c) => c.body?.type === 0)

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_BOT_TOKEN', 'test-bot-token')
  vi.stubGlobal('fetch', h.fetch)
  h.fetch.mockImplementation(discordRouter)
  calls = []
  routes = {
    'GET /users/@me': () => json({ id: BOT }),
    [`GET /guilds/${GUILD}/channels`]: () => json([]),
    [`POST /guilds/${GUILD}/channels`]: (b) =>
      b.type === 4 ? json({ id: CATEGORY }) : json({ id: CHANNEL, name: 'iron-horse-dynasty' }),
    [`POST /channels/${CHANNEL}/webhooks`]: () => json({ id: 'wh1', token: 'secret-webhook-token' }),
    [`POST /channels/${CHANNEL}/messages`]: () => json({ id: 'm1' }),
    [`GET /channels/${CHANNEL}/invites`]: () => json([]),
    [`POST /channels/${CHANNEL}/invites`]: () => json({ code: 'abc123', max_age: 0, max_uses: 0, temporary: false }),
    [`GET /guilds/${GUILD}/members/${ME_DISCORD}`]: () => json({ roles: [] }),
    [`GET /guilds/${GUILD}/members/${PRIYA_DISCORD}`]: () => json({ roles: [] }),
    [`GET /guilds/${GUILD}/members/${MARCUS_DISCORD}`]: () => json({ message: 'Unknown Member' }, 404),
  }
  h.session.mockResolvedValue({ user: { id: 'commish' } })
  h.leagueFindFirst.mockResolvedValue({ userId: 'commish', name: 'Iron Horse Dynasty' })
  h.guildLinkFindUnique.mockResolvedValue({ guildId: GUILD, linkedByUserId: 'commish' })
  h.channelFindFirst.mockResolvedValue(null)
  h.channelCreate.mockResolvedValue({})
  h.channelUpdate.mockResolvedValue({})
  h.teamsFindMany.mockResolvedValue([
    { teamName: 'Gridiron Giants', ownerName: 'Commish', claimedByUserId: 'commish' },
    { teamName: 'Priya FC', ownerName: 'Priya', claimedByUserId: 'priya' },
    { teamName: 'Marcus Mob', ownerName: 'Marcus', claimedByUserId: 'marcus' },
    { teamName: 'Dana Dynasty', ownerName: 'Dana', claimedByUserId: 'dana' },
  ])
  h.profilesFindMany.mockResolvedValue([
    { userId: 'commish', discordUserId: ME_DISCORD, discordConnectedAt: new Date() },
    { userId: 'priya', discordUserId: PRIYA_DISCORD, discordConnectedAt: new Date() },
    { userId: 'marcus', discordUserId: MARCUS_DISCORD, discordConnectedAt: new Date() },
    { userId: 'dana', discordUserId: null, discordConnectedAt: null },
  ])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('copying starts off', () => {
  it('writes a new channel row with every sync flag false', async () => {
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(200)
    expect(h.channelCreate).toHaveBeenCalledTimes(1)
    const data = h.channelCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      leagueId: 'L1',
      surface: 'league_chat',
      guildId: GUILD,
      channelId: CHANNEL,
      syncEnabled: false,
      syncOutbound: false,
      syncInbound: false,
    })
  })

  it('tells the channel that copying is up to the commissioner', async () => {
    await post({ leagueId: 'L1', guildId: GUILD })
    const welcome = calls.find((c) => c.path === `/channels/${CHANNEL}/messages`)
    expect(welcome?.body.content).toMatch(/only shows up here if your commissioner switches copying on/)
  })
})

describe('who can see the channel', () => {
  it('defaults to the whole server and sends no overwrites', async () => {
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    const body = await res.json()
    expect(body.visibility).toBe('server')
    expect(textChannelPost()?.body).not.toHaveProperty('permission_overwrites')
    expect(body).not.toHaveProperty('access')
  })

  it('members-only: denies @everyone and lets in only linked members already in the server', async () => {
    const res = await post({ leagueId: 'L1', guildId: GUILD, visibility: 'private' })
    expect(res.status).toBe(200)
    const overwrites = textChannelPost()?.body.permission_overwrites
    expect(overwrites).toBeDefined()
    // @everyone (role id == guild id) cannot view.
    expect(overwrites[0]).toEqual({ id: GUILD, type: 0, deny: '1024', allow: '0' })
    const members = overwrites.filter((o: { type: number }) => o.type === 1).map((o: { id: string }) => o.id)
    expect(members.sort()).toEqual([BOT, ME_DISCORD, PRIYA_DISCORD].sort())
    // Marcus is linked but not in the server; Dana never linked.
    expect(members).not.toContain(MARCUS_DISCORD)

    const body = await res.json()
    expect(body.visibility).toBe('private')
    expect(body.access).toEqual({
      included: expect.arrayContaining(['You', 'Priya']),
      notLinked: ['Dana'],
      notInServer: ['Marcus'],
      unknown: [],
    })
  })

  it('treats a member Discord could not confirm as unknown, never as let in', async () => {
    routes[`GET /guilds/${GUILD}/members/${PRIYA_DISCORD}`] = () => json({ message: 'boom' }, 500)
    const res = await post({ leagueId: 'L1', guildId: GUILD, visibility: 'private' })
    const members = textChannelPost()!.body.permission_overwrites.map((o: { id: string }) => o.id)
    expect(members).not.toContain(PRIYA_DISCORD)
    expect((await res.json()).access.unknown).toEqual(['Priya'])
  })

  it('rejects a visibility it does not know', async () => {
    const res = await post({ leagueId: 'L1', guildId: GUILD, visibility: 'public-to-the-world' })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('one channel per league', () => {
  it('returns the live channel it already has instead of making a second', async () => {
    h.channelFindFirst.mockResolvedValue({ id: 'row1', leagueId: 'L1', guildId: GUILD, channelId: CHANNEL, channelName: 'iron-horse' })
    routes[`GET /channels/${CHANNEL}`] = () =>
      json({ id: CHANNEL, name: 'iron-horse', guild_id: GUILD, permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: '1024' }] })
    const res = await post({ leagueId: 'L1', guildId: GUILD, visibility: 'server' })
    const body = await res.json()
    expect(body.alreadyExisted).toBe(true)
    expect(body.visibility).toBe('private')
    expect(channelPosts()).toHaveLength(0)
    expect(h.channelCreate).not.toHaveBeenCalled()
    expect(h.channelUpdate).not.toHaveBeenCalled()
  })

  it('re-points the existing row when the old channel was deleted in Discord, copying reset to off', async () => {
    h.channelFindFirst.mockResolvedValue({ id: 'row1', leagueId: 'L1', guildId: GUILD, channelId: OLD_CHANNEL, syncEnabled: true, syncOutbound: true })
    routes[`GET /channels/${OLD_CHANNEL}`] = () => json({ message: 'Unknown Channel' }, 404)
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(200)
    expect(h.channelCreate).not.toHaveBeenCalled()
    expect(h.channelUpdate).toHaveBeenCalledWith({
      where: { id: 'row1' },
      data: expect.objectContaining({ channelId: CHANNEL, syncEnabled: false, syncOutbound: false, syncInbound: false }),
    })
  })

  it('does not make a new channel when Discord merely cannot show the old one', async () => {
    h.channelFindFirst.mockResolvedValue({ id: 'row1', leagueId: 'L1', guildId: GUILD, channelId: OLD_CHANNEL })
    routes[`GET /channels/${OLD_CHANNEL}`] = () => json({ message: 'Missing Access' }, 403)
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(502)
    expect(channelPosts()).toHaveLength(0)
  })
})

describe('refusals', () => {
  it('403s a league the caller does not commission, before touching Discord', async () => {
    h.leagueFindFirst.mockResolvedValue({ userId: 'someone-else', name: 'X' })
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('403s a server this commissioner did not add AllFantasy to', async () => {
    h.guildLinkFindUnique.mockResolvedValue({ guildId: GUILD, linkedByUserId: 'someone-else' })
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guild-not-linked')
    expect(calls).toHaveLength(0)
  })

  it('turns a Discord permission refusal into plain words and writes no row', async () => {
    routes[`POST /guilds/${GUILD}/channels`] = () => json({ message: 'Missing Permissions', code: 50013 }, 403)
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('missing-permissions')
    expect(JSON.stringify(body)).not.toMatch(/Missing Permissions|50013/)
    expect(h.channelCreate).not.toHaveBeenCalled()
    expect(h.channelUpdate).not.toHaveBeenCalled()
  })

  it('keeps the channel when only the webhook fails (the relay does not use it)', async () => {
    routes[`POST /channels/${CHANNEL}/webhooks`] = () => json({ message: 'Missing Permissions' }, 403)
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    expect(res.status).toBe(200)
    expect(h.channelCreate.mock.calls[0][0].data).toMatchObject({ webhookId: null, webhookToken: null })
  })

  it('never returns the webhook token or the bot token', async () => {
    const res = await post({ leagueId: 'L1', guildId: GUILD })
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('secret-webhook-token')
    expect(text).not.toContain('test-bot-token')
    expect(text).toContain('https://discord.gg/abc123')
  })
})
