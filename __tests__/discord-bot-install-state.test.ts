import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session: vi.fn(), profile: vi.fn(), set: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: h.set }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/discord/bot', () => ({ isBotConfigured: () => true }))
vi.mock('@/lib/discord/constants', () => ({ DISCORD_CLIENT_ID: '1499502145039499344', DISCORD_BOT_PERMISSIONS: '1024', DISCORD_BOT_CALLBACK_URI: 'https://example.test/api/discord/bot-callback' }))
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findUnique: h.profile } } }))
import { GET } from '@/app/api/discord/bot-install/route'
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.profile.mockResolvedValue({ discordUserId: 'connected', discordConnectedAt: new Date() })
})
describe('Discord installation state', () => {
  it('requires sign-in', async () => {
    h.session.mockResolvedValue(null)
    expect((await GET()).headers.get('location')).toContain('/login')
    expect(h.set).not.toHaveBeenCalled()
  })
  it('requires a connected human identity before installation', async () => {
    h.profile.mockResolvedValue(null)
    expect((await GET()).headers.get('location')).toContain('tab=connected&discord=account-required')
    expect(h.set).not.toHaveBeenCalled()
  })
  it('binds the OAuth nonce to the initiating account with short-lived HttpOnly cookies', async () => {
    const response = await GET()
    const url = new URL(response.headers.get('location')!)
    const state = url.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(h.set).toHaveBeenCalledWith('discord_bot_state', state, expect.objectContaining({ httpOnly: true, maxAge: 600, sameSite: 'lax', path: '/' }))
    expect(h.set).toHaveBeenCalledWith('discord_bot_user', 'me', expect.objectContaining({ httpOnly: true }))
  })
})
