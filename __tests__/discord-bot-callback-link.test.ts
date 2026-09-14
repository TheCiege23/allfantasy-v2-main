import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  profileUpsert: vi.fn(),
  guildLinkUpsert: vi.fn(),
  getGuildBotPermissions: vi.fn(),
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookieGet, delete: mocks.cookieDelete }) }))
vi.mock('@/lib/discord/guild-access', () => ({ verifyGuildManager: mocks.getGuildBotPermissions, linkVerifiedGuild: mocks.guildLinkUpsert }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { upsert: mocks.profileUpsert },
    discordGuildLink: { upsert: mocks.guildLinkUpsert },
  },
}))

function req(guildId?: string) {
  const url = new URL(
    `https://www.allfantasy.ai/api/discord/bot-callback${guildId ? `?guild_id=${guildId}&state=state` : ''}`,
  )
  return { nextUrl: url } as never
}

describe('GET /api/discord/bot-callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: 'me' } })
    mocks.profileUpsert.mockResolvedValue({})
    mocks.guildLinkUpsert.mockResolvedValue(true)
    mocks.getGuildBotPermissions.mockResolvedValue({ discordUserId: 'discord-me', guildName: 'Server' })
    mocks.cookieGet.mockImplementation((key: string) => ({ value: key === 'discord_bot_state' ? 'state' : 'me' }))
  })

  /*
   * The bug this covers: the callback reported success while creating no
   * DiscordGuildLink row, so channels/create answered 403 "Guild not linked by
   * you" on the very next step.
   */
  it('creates the guild link the rest of the system keys off', async () => {
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    const res = await GET(req('123'))

    expect(mocks.guildLinkUpsert).toHaveBeenCalledWith('me', '123', 'Server')
    expect(res.headers.get('location')).toContain('discord=bot-linked')
  })

  it('still writes the profile field the status panels read', async () => {
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    await GET(req('123'))

    expect(mocks.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'me' } }),
    )
  })

  /*
   * `guild_id` is caller-supplied. Without a membership check anyone could claim
   * a link to any guild id they typed into the URL.
   */
  it('refuses to link a guild the bot is not verifiably in', async () => {
    mocks.getGuildBotPermissions.mockResolvedValue(null)
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    const res = await GET(req('999'))

    expect(mocks.guildLinkUpsert).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toContain('discord=bot-unverified')
  })

  it('treats a Discord failure as unverified rather than linking anyway', async () => {
    mocks.getGuildBotPermissions.mockResolvedValue(null)
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    const res = await GET(req('123'))

    expect(mocks.guildLinkUpsert).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toContain('discord=bot-unverified')
  })

  it('reports an error when Discord sends no guild', async () => {
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    const res = await GET(req())

    expect(res.headers.get('location')).toContain('discord=bot-error')
    expect(mocks.profileUpsert).not.toHaveBeenCalled()
  })

  it('sends an anonymous caller to log in', async () => {
    mocks.getServerSession.mockResolvedValue(null)
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    const res = await GET(req('123'))

    expect(res.headers.get('location')).toContain('/login')
    expect(mocks.guildLinkUpsert).not.toHaveBeenCalled()
  })
  it('rejects missing OAuth state before making any writes', async () => {
    mocks.cookieGet.mockReturnValue(undefined)
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    await GET(req('123'))
    expect(mocks.guildLinkUpsert).not.toHaveBeenCalled()
    expect(mocks.profileUpsert).not.toHaveBeenCalled()
  })
  it('rejects an installation started by another account', async () => {
    mocks.cookieGet.mockImplementation((key: string) => ({ value: key === 'discord_bot_state' ? 'state' : 'other' }))
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    await GET(req('123'))
    expect(mocks.getGuildBotPermissions).not.toHaveBeenCalled()
  })
  it('does not overwrite the profile when another account owns the server link', async () => {
    mocks.guildLinkUpsert.mockResolvedValue(false)
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    await GET(req('123'))
    expect(mocks.profileUpsert).not.toHaveBeenCalled()
  })
})
