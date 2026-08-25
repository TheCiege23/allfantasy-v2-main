import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  profileUpsert: vi.fn(),
  guildLinkUpsert: vi.fn(),
  getGuildBotPermissions: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/discord/bot', () => ({ getGuildBotPermissions: mocks.getGuildBotPermissions }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { upsert: mocks.profileUpsert },
    discordGuildLink: { upsert: mocks.guildLinkUpsert },
  },
}))

function req(guildId?: string) {
  const url = new URL(
    `https://www.allfantasy.ai/api/discord/bot-callback${guildId ? `?guild_id=${guildId}` : ''}`,
  )
  return { nextUrl: url } as never
}

describe('GET /api/discord/bot-callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: 'me' } })
    mocks.profileUpsert.mockResolvedValue({})
    mocks.guildLinkUpsert.mockResolvedValue({})
    mocks.getGuildBotPermissions.mockResolvedValue(8n)
  })

  /*
   * The bug this covers: the callback reported success while creating no
   * DiscordGuildLink row, so channels/create answered 403 "Guild not linked by
   * you" on the very next step.
   */
  it('creates the guild link the rest of the system keys off', async () => {
    const { GET } = await import('@/app/api/discord/bot-callback/route')
    const res = await GET(req('123'))

    expect(mocks.guildLinkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { guildId: '123' } }),
    )
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
    mocks.getGuildBotPermissions.mockRejectedValue(new Error('discord down'))
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
})
