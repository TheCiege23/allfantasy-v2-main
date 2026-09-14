import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), cookie: vi.fn(), remove: vi.fn(), fetch: vi.fn(), upsert: vi.fn(), encrypt: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: h.cookie, delete: h.remove }) }))
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { upsert: h.upsert } } }))
vi.mock('@/lib/league-auth-crypto', () => ({ encrypt: h.encrypt }))
vi.mock('@/lib/discord/constants', () => ({ DISCORD_CLIENT_ID: '1499502145039499344', DISCORD_OAUTH_REDIRECT_URI: 'https://www.allfantasy.ai/api/auth/discord/callback' }))
import { GET } from '@/app/api/auth/discord/callback/route'

const req = (query = 'code=test-code&state=test-state') => ({ nextUrl: new URL(`https://www.allfantasy.ai/api/auth/discord/callback?${query}`) }) as never
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const reason = (response: Response) => new URL(response.headers.get('location')!).searchParams.get('discord')

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DISCORD_CLIENT_SECRET', 'test-secret')
  vi.stubGlobal('fetch', h.fetch)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.cookie.mockImplementation((name: string) => ({ value: name === 'discord_oauth_state' ? 'test-state' : 'me' }))
  h.encrypt.mockReturnValue('encrypted-value')
  h.upsert.mockResolvedValue({})
  h.fetch.mockResolvedValueOnce(json({ access_token: 'private-access-token', refresh_token: 'private-refresh-token' }))
    .mockResolvedValueOnce(json({ id: '1085033561016516730', username: 'test-user' }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Discord account callback', () => {
  it('saves encrypted tokens only after successful authorization', async () => {
    expect(reason(await GET(req()))).toBe('connected')
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'me' }, update: expect.objectContaining({ discordAccessToken: 'encrypted-value', discordRefreshToken: 'encrypted-value' }),
    }))
    expect(h.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
  it('requires an authenticated session', async () => {
    h.session.mockResolvedValue(null)
    expect(new URL((await GET(req())).headers.get('location')!).pathname).toBe('/login')
    expect(h.fetch).not.toHaveBeenCalled()
  })
  it.each(['wrong-state', 'missing', 'other-user'])('rejects %s without contacting Discord', async mode => {
    h.cookie.mockImplementation((name: string) => mode === 'missing' ? undefined : ({ value: name === 'discord_oauth_state' ? (mode === 'wrong-state' ? 'other' : 'test-state') : 'other-user' }))
    expect(reason(await GET(req()))).toBe('session-expired')
    expect(h.fetch).not.toHaveBeenCalled()
  })
  it('reports cancellation without changing the account', async () => {
    expect(reason(await GET(req('error=access_denied')))).toBe('cancelled')
    expect(h.upsert).not.toHaveBeenCalled()
  })
  it('rejects missing credentials', async () => {
    vi.stubEnv('DISCORD_CLIENT_SECRET', '')
    expect(reason(await GET(req()))).toBe('config-error')
    expect(h.fetch).not.toHaveBeenCalled()
  })
  it.each([['invalid_client', 'config-error'], ['invalid_grant', 'authorization-expired'], ['server_error', 'provider-error']])('classifies %s without logging provider secrets', async (error, expected) => {
    h.fetch.mockReset().mockResolvedValue(json({ error, error_description: 'private-provider-detail' }, 400))
    expect(reason(await GET(req()))).toBe(expected)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-provider-detail')
    expect(h.upsert).not.toHaveBeenCalled()
  })
  it('handles network failures', async () => {
    h.fetch.mockReset().mockRejectedValue(new Error('private-network-detail'))
    expect(reason(await GET(req()))).toBe('provider-error')
  })
  it('handles encryption failures without exposing tokens', async () => {
    h.encrypt.mockImplementation(() => { throw new Error('private-access-token') })
    expect(reason(await GET(req()))).toBe('config-error')
    expect(h.upsert).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-access-token')
  })
  it('distinguishes a database failure from a Discord rejection', async () => {
    h.upsert.mockRejectedValue(new Error('private-profile-detail'))
    expect(reason(await GET(req()))).toBe('save-error')
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-profile-detail')
  })
})
