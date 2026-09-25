/**
 * "Add AllFantasy to your server" started from a league's /core/discord screen comes
 * back to THAT screen — and the league it returns to can never be steered by a caller.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  profile: vi.fn(),
  leagueFindFirst: vi.fn(),
  profileUpsert: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  verify: vi.fn(),
  link: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: h.set, get: h.get, delete: h.del }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/discord/bot', () => ({ isBotConfigured: () => true }))
vi.mock('@/lib/discord/constants', () => ({
  DISCORD_CLIENT_ID: '1499502145039499344',
  DISCORD_BOT_PERMISSIONS: '536988689',
  DISCORD_BOT_CALLBACK_URI: 'https://example.test/api/discord/bot-callback',
}))
vi.mock('@/lib/discord/guild-access', () => ({ verifyGuildManager: h.verify, linkVerifiedGuild: h.link }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { findUnique: h.profile, upsert: h.profileUpsert },
    league: { findFirst: h.leagueFindFirst },
  },
}))

import { GET as install } from '@/app/api/discord/bot-install/route'
import { GET as callback } from '@/app/api/discord/bot-callback/route'

const installReq = (query = '') => ({ nextUrl: new URL(`https://allfantasy.ai/api/discord/bot-install${query}`) }) as never
const callbackReq = (query: string) => ({ nextUrl: new URL(`https://allfantasy.ai/api/discord/bot-callback?${query}`) }) as never
const location = (res: Response) => new URL(res.headers.get('location')!)

function cookies(values: Record<string, string | undefined>) {
  h.get.mockImplementation((name: string) => (values[name] === undefined ? undefined : { value: values[name] }))
}

beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.profile.mockResolvedValue({ discordUserId: '1085033561016516730', discordConnectedAt: new Date() })
  h.leagueFindFirst.mockResolvedValue({ id: 'league_1' })
  h.verify.mockResolvedValue({ discordUserId: '1085033561016516730', guildName: 'Iron Horse' })
  h.link.mockResolvedValue(true)
  h.profileUpsert.mockResolvedValue({})
})

describe('bot-install remembers the league it was started from', () => {
  it('stores a league the caller commissions in a short-lived HttpOnly cookie', async () => {
    const res = await install(installReq('?leagueId=league_1'))
    expect(location(res).host).toBe('discord.com')
    expect(h.leagueFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'league_1', userId: 'me' } }))
    expect(h.set).toHaveBeenCalledWith('discord_bot_league', 'league_1', expect.objectContaining({ httpOnly: true, maxAge: 600 }))
  })

  it('ignores a league the caller does not commission, and clears any stale one', async () => {
    h.leagueFindFirst.mockResolvedValue(null)
    await install(installReq('?leagueId=someone_elses'))
    expect(h.set).toHaveBeenCalledWith('discord_bot_league', '', expect.objectContaining({ maxAge: 0 }))
    expect(h.set).not.toHaveBeenCalledWith('discord_bot_league', 'someone_elses', expect.anything())
  })

  it('never looks up, or stores, a league id that is not an id', async () => {
    await install(installReq(`?leagueId=${encodeURIComponent('https://evil.example/x')}`))
    expect(h.leagueFindFirst).not.toHaveBeenCalled()
    expect(h.set).toHaveBeenCalledWith('discord_bot_league', '', expect.objectContaining({ maxAge: 0 }))
  })

  it('sends a refusal back to the setup screen, not Settings', async () => {
    h.profile.mockResolvedValue(null)
    const url = location(await install(installReq('?leagueId=league_1')))
    expect(url.pathname).toBe('/core/discord')
    expect(url.searchParams.get('league')).toBe('league_1')
    expect(url.searchParams.get('discord')).toBe('account-required')
  })

  it('sends a signed-out commissioner to log in and then back to the setup screen', async () => {
    h.session.mockResolvedValue(null)
    const url = location(await install(installReq('?leagueId=league_1')))
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('callbackUrl')).toBe('/core/discord?league=league_1')
    expect(h.set).not.toHaveBeenCalled()
  })

  it('keeps the Settings flow unchanged when no league is given', async () => {
    h.profile.mockResolvedValue(null)
    const url = location(await install(installReq()))
    expect(url.pathname).toBe('/settings')
    expect(url.searchParams.get('discord')).toBe('account-required')
  })
})

describe('bot-callback returns to the setup screen', () => {
  it('lands on /core/discord with a success flag after linking the server', async () => {
    cookies({ discord_bot_state: 's1', discord_bot_user: 'me', discord_bot_league: 'league_1' })
    const url = location(await callback(callbackReq('guild_id=1180313285313167390&state=s1')))
    expect(url.pathname).toBe('/core/discord')
    expect(url.searchParams.get('league')).toBe('league_1')
    expect(url.searchParams.get('discord')).toBe('bot-linked')
    expect(h.link).toHaveBeenCalledWith('me', '1180313285313167390', 'Iron Horse')
    expect(h.del).toHaveBeenCalledWith('discord_bot_league')
  })

  it('cannot be steered off-site by whatever sits in the cookie', async () => {
    cookies({ discord_bot_state: 's1', discord_bot_user: 'me', discord_bot_league: '//evil.example/phish' })
    const url = location(await callback(callbackReq('guild_id=1180313285313167390&state=s1')))
    expect(url.host).not.toBe('evil.example')
    expect(url.pathname).toBe('/settings')
  })

  it('says "cancelled" (not "error") when the commissioner backs out on Discord', async () => {
    cookies({ discord_bot_state: 's1', discord_bot_user: 'me', discord_bot_league: 'league_1' })
    const url = location(await callback(callbackReq('error=access_denied&state=s1')))
    expect(url.searchParams.get('discord')).toBe('bot-cancelled')
    expect(h.verify).not.toHaveBeenCalled()
  })

  it('does not accept a cancel whose state does not match', async () => {
    cookies({ discord_bot_state: 's1', discord_bot_user: 'me', discord_bot_league: 'league_1' })
    const url = location(await callback(callbackReq('error=access_denied&state=forged')))
    expect(url.searchParams.get('discord')).toBe('bot-error')
  })

  it('names a server already linked by another account', async () => {
    h.link.mockResolvedValue(false)
    cookies({ discord_bot_state: 's1', discord_bot_user: 'me', discord_bot_league: 'league_1' })
    const url = location(await callback(callbackReq('guild_id=1180313285313167390&state=s1')))
    expect(url.searchParams.get('discord')).toBe('bot-taken')
    expect(h.profileUpsert).not.toHaveBeenCalled()
  })

  it('still refuses a server the commissioner does not manage', async () => {
    h.verify.mockResolvedValue(null)
    cookies({ discord_bot_state: 's1', discord_bot_user: 'me', discord_bot_league: 'league_1' })
    const url = location(await callback(callbackReq('guild_id=1180313285313167390&state=s1')))
    expect(url.searchParams.get('discord')).toBe('bot-unverified')
    expect(h.link).not.toHaveBeenCalled()
  })
})
