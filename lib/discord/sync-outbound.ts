import { prisma } from '@/lib/prisma'
import { postLeagueChatEmbed, isBotConfigured } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'
import { createHash } from 'node:crypto'

export type OutboundSyncInput = {
  leagueId: string
  messageId: string
  authorName: string
  authorAvatarUrl: string | null
  text: string
  gifUrl?: string | null
}

/**
 * Sync a league chat line to Discord when a row exists in `DiscordLeagueChannel`.
 * No-op if bot token missing or no mapping / sync disabled.
 */
export async function deliverOutboundLeagueChat(input: OutboundSyncInput, expectedChannelId?: string): Promise<{ synced: boolean; discordMessageId?: string }> {
  if (!isBotConfigured()) {
    return { synced: false }
  }

  const row = await prisma.discordLeagueChannel.findFirst({
    where: {
      leagueId: input.leagueId,
      syncEnabled: true,
      syncOutbound: true,
      surface: 'league_chat',
    },
    include: {
      league: { select: { name: true } },
    },
  })

  if (!row || (expectedChannelId && row.channelId !== expectedChannelId)) {
    return { synced: false }
  }

  const msg = await prisma.leagueChatMessage.findUnique({
    where: { id: input.messageId },
    include: { user: { select: { displayName: true, username: true, avatarUrl: true } } },
  })
  if (!msg || msg.leagueId !== input.leagueId || msg.sourceDiscord || msg.isPrivate || msg.visibleToUserId) {
    return { synced: false }
  }
  // A league-wide bridge must never export a restricted tribe conversation.
  if (msg.source === 'draft' || msg.source?.startsWith('tribe_')) return { synced: false }

  const delivered = await prisma.discordMessageLink.findFirst({
    where: { leagueMessageId: msg.id, channelId: row.channelId, direction: 'to_discord' },
  })
  if (delivered) return { synced: true, discordMessageId: delivered.discordMessageId ?? undefined }
  const metadata = msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata)
    ? msg.metadata as Record<string, unknown> : {}

  const leagueName = row.league.name ?? 'League'

  const discordMessageId = await postLeagueChatEmbed(row.channelId, {
    authorName: msg.user.displayName || msg.user.username || 'Manager',
    authorAvatar: msg.user.avatarUrl ?? undefined,
    text: msg.message,
    gifUrl: typeof metadata.gifUrl === 'string' ? metadata.gifUrl : undefined,
    leagueName,
    leagueId: input.leagueId,
    nonce: createHash('sha256').update(`${row.channelId}:${msg.id}`).digest('hex').slice(0, 24),
  })

  await prisma.discordMessageLink.create({
    data: {
      leagueMessageId: input.messageId,
      discordMessageId,
      direction: 'to_discord',
      guildId: row.guildId,
      channelId: row.channelId,
    },
  })

  return { synced: true, discordMessageId }
}

const OUTBOUND_JOB = 'discord.outbound'
const LEASE_MS = 60_000

/** Persist first so a terminated request can be retried by the existing Discord cron. */
export async function syncOutboundLeagueChat(input: OutboundSyncInput) {
  if (!isBotConfigured()) return { synced: false }
  const mapping = await prisma.discordLeagueChannel.findFirst({ where: { leagueId: input.leagueId, surface: 'league_chat', syncEnabled: true, syncOutbound: true }, select: { channelId: true } })
  if (!mapping) return { synced: false }
  const job = await prisma.automationJob.upsert({
    where: { idempotencyKey: `${OUTBOUND_JOB}:${mapping.channelId}:${input.messageId}` },
    create: { jobType: OUTBOUND_JOB, leagueId: input.leagueId, idempotencyKey: `${OUTBOUND_JOB}:${mapping.channelId}:${input.messageId}`, maxAttempts: 6, metadata: { messageId: input.messageId, channelId: mapping.channelId } },
    update: {},
  })
  return runDiscordOutboundJob(job.id)
}

export async function runDiscordOutboundJob(jobId: string): Promise<{ synced: boolean; discordMessageId?: string }> {
  const job = await prisma.automationJob.findUnique({ where: { id: jobId } })
  if (!job || job.jobType !== OUTBOUND_JOB || !job.leagueId) return { synced: false }
  if (job.status === 'completed') return { synced: true }
  if (job.attemptCount >= job.maxAttempts) return { synced: false }
  const now = new Date()
  const claim = await prisma.automationJob.updateMany({
    where: { id: job.id, updatedAt: job.updatedAt, OR: [
      { status: { in: ['pending', 'failed'] }, OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
      { status: 'running', startedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
    ] },
    data: { status: 'running', startedAt: now, attemptCount: { increment: 1 }, updatedAt: now },
  })
  if (claim.count !== 1) return { synced: false }
  const metadata = job.metadata as { messageId?: string; channelId?: string } | null
  try {
    if (!metadata?.messageId || !metadata.channelId) throw new Error('Invalid Discord delivery metadata')
    const result = await deliverOutboundLeagueChat({ leagueId: job.leagueId, messageId: metadata.messageId, authorName: '', authorAvatarUrl: null, text: '' }, metadata.channelId)
    await prisma.automationJob.updateMany({ where: { id: job.id, status: 'running', startedAt: now }, data: { status: result.synced ? 'completed' : 'cancelled', finishedAt: new Date(), lastError: null } })
    return result
  } catch {
    await prisma.automationJob.updateMany({ where: { id: job.id, status: 'running', startedAt: now }, data: {
      status: 'failed', lastError: 'Discord delivery failed; retry scheduled.',
      scheduledFor: new Date(Date.now() + Math.min(300_000, 15_000 * 2 ** job.attemptCount)),
    } })
    return { synced: false }
  }
}

export async function retryDiscordOutboundJobs(limit = 25) {
  const jobs = await prisma.automationJob.findMany({
    where: { jobType: OUTBOUND_JOB, attemptCount: { lt: 6 }, OR: [
      { status: { in: ['pending', 'failed'] }, OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }] },
      { status: 'running', startedAt: { lt: new Date(Date.now() - LEASE_MS) } },
    ] }, orderBy: { createdAt: 'asc' }, take: limit,
  })
  const deadline = Date.now() + 20_000
  let delivered = 0
  for (const job of jobs) {
    if (Date.now() >= deadline) break
    if ((await runDiscordOutboundJob(job.id)).synced) delivered++
  }
  return delivered
}

/** Fire-and-forget friendly URL for logs / admin (not stored on message by default). */
export function discordChannelUrl(guildId: string, channelId: string): string {
  return channelLink(guildId, channelId)
}
