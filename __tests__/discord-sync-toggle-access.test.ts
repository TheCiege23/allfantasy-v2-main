import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session: vi.fn(), league: vi.fn(), mapping: vi.fn(), update: vi.fn(), manager: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/api/require-league-access', () => ({ requireLeagueApiAccess: vi.fn() }))
vi.mock('@/lib/discord/guild-access', () => ({ verifyGuildManager: h.manager }))
vi.mock('@/lib/discord/bot', () => ({ isBotConfigured: () => true, missingBotPermissions: vi.fn(), createOrReuseChannelInvite: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: h.league }, discordLeagueChannel: { findFirst: h.mapping, updateMany: h.update } } }))
import { PATCH } from '@/app/api/discord/league/route'
const request = (data: Record<string, unknown>) => new Request('https://example.test/api/discord/league', { method: 'PATCH', body: JSON.stringify({ leagueId: 'league', ...data }) })
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.league.mockResolvedValue({ userId: 'me' })
  h.mapping.mockResolvedValue({ id: 'mapping', guildId: 'guild' })
  h.manager.mockResolvedValue({ discordUserId: 'connected' })
  h.update.mockResolvedValue({ count: 1 })
})
describe('Discord sync toggle authorization', () => {
  it('rejects noncommissioners before changing sync', async () => {
    h.league.mockResolvedValue({ userId: 'other' })
    expect((await PATCH(request({ syncEnabled: true }))).status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })
  it('does not report success for a nonexistent mapping', async () => {
    h.mapping.mockResolvedValue(null)
    expect((await PATCH(request({ syncEnabled: true }))).status).toBe(404)
  })
  it('requires current server authority to enable sync', async () => {
    h.manager.mockResolvedValue(null)
    expect((await PATCH(request({ syncInbound: true }))).status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })
  it('lets the commissioner disable sync without an external permission lookup', async () => {
    expect((await PATCH(request({ syncEnabled: false }))).status).toBe(200)
    expect(h.manager).not.toHaveBeenCalled()
  })
  it('updates only the selected league-chat bridge', async () => {
    expect((await PATCH(request({ syncEnabled: true }))).status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'mapping', leagueId: 'league', surface: 'league_chat' }, data: { syncEnabled: true } })
  })
})
