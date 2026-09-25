import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ mapping: vi.fn(), message: vi.fn(), link: vi.fn(), createLink: vi.fn(), post: vi.fn(), upsert: vi.fn(), job: vi.fn(), update: vi.fn(), jobs: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  discordLeagueChannel: { findFirst: h.mapping },
  leagueChatMessage: { findUnique: h.message },
  discordMessageLink: { findFirst: h.link, create: h.createLink },
  automationJob: { upsert: h.upsert, findUnique: h.job, updateMany: h.update, findMany: h.jobs },
} }))
vi.mock('@/lib/discord/bot', () => ({ isBotConfigured: () => true, postLeagueChatEmbed: h.post }))
import { runDiscordOutboundJob, syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'

const job = { id: 'job', jobType: 'discord.outbound', leagueId: 'league', status: 'pending', attemptCount: 0, maxAttempts: 6, updatedAt: new Date(0), metadata: { messageId: 'message', channelId: 'channel' } }
beforeEach(() => {
  vi.resetAllMocks()
  h.job.mockResolvedValue(job)
  h.upsert.mockResolvedValue(job)
  h.update.mockResolvedValue({ count: 1 })
  h.mapping.mockResolvedValue({ channelId: 'channel', guildId: 'guild', league: { name: 'League' } })
  h.message.mockResolvedValue({ id: 'message', leagueId: 'league', message: 'Stored text', metadata: {}, user: { displayName: 'Manager' } })
  h.link.mockResolvedValue(null)
  h.post.mockResolvedValue('discord-message')
})

describe('durable Discord outbound delivery', () => {
  it('persists an idempotent job before posting', async () => {
    expect(await syncOutboundLeagueChat({ leagueId: 'league', messageId: 'message', authorName: 'Forged', authorAvatarUrl: null, text: 'Forged' })).toEqual({ synced: true, discordMessageId: 'discord-message' })
    expect(h.upsert.mock.calls[0][0].where.idempotencyKey).toBe('discord.outbound:channel:message')
    expect(h.upsert.mock.invocationCallOrder[0]).toBeLessThan(h.post.mock.invocationCallOrder[0])
    expect(h.post).toHaveBeenCalledWith('channel', expect.objectContaining({ text: 'Stored text', nonce: expect.any(String) }))
  })
  it('does not send when another worker wins the claim', async () => {
    h.update.mockResolvedValueOnce({ count: 0 })
    expect(await runDiscordOutboundJob('job')).toEqual({ synced: false })
    expect(h.post).not.toHaveBeenCalled()
  })
  it('schedules a failed delivery for retry without exposing provider details', async () => {
    h.post.mockRejectedValue(new Error('provider secret details'))
    expect(await runDiscordOutboundJob('job')).toEqual({ synced: false })
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', scheduledFor: expect.any(Date), lastError: 'Discord delivery failed; retry scheduled.' }) }))
  })
  it('does not redirect a queued message to a replacement channel', async () => {
    h.mapping.mockResolvedValue({ channelId: 'replacement', league: { name: 'League' } })
    await runDiscordOutboundJob('job')
    expect(h.post).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }))
  })
  it('rechecks privacy at delivery time', async () => {
    h.message.mockResolvedValue({ leagueId: 'league', isPrivate: true })
    await runDiscordOutboundJob('job')
    expect(h.post).not.toHaveBeenCalled()
  })
  it('does not resend a completed job', async () => {
    h.job.mockResolvedValue({ ...job, status: 'completed' })
    expect(await runDiscordOutboundJob('job')).toEqual({ synced: true })
    expect(h.update).not.toHaveBeenCalled()
    expect(h.post).not.toHaveBeenCalled()
  })
  it('stops after the configured attempt limit', async () => {
    h.job.mockResolvedValue({ ...job, attemptCount: 6 })
    await runDiscordOutboundJob('job')
    expect(h.update).not.toHaveBeenCalled()
  })
})
