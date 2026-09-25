import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { fetchChannelMessages, getBotUserId } from '@/lib/discord/bot'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { discordAvatarUrl } from '@/lib/discord/avatar'
import { retryDiscordOutboundJobs } from '@/lib/discord/sync-outbound'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const botId = await getBotUserId()
  if (!botId) {
    return NextResponse.json({ error: 'Discord identity unavailable; synchronization paused' }, { status: 503 })
  }
  const outboundDelivered = await retryDiscordOutboundJobs()
  const rows = await prisma.discordLeagueChannel.findMany({
    where: { syncEnabled: true, syncInbound: true, surface: 'league_chat' },
    include: {
      guild: { select: { linkedByUserId: true } },
    },
  })

  let processed = 0

  for (const row of rows) {
    if (!row.lastSyncedMessageId) {
      try {
        const initial = await fetchChannelMessages(row.channelId, { limit: 1 })
        if (initial[0]?.id) {
          await prisma.discordLeagueChannel.update({
            where: { id: row.id },
            data: { lastSyncedMessageId: initial[0].id },
          })
        }
      } catch {
        /* ignore */
      }
      continue
    }

    const after = row.lastSyncedMessageId
    let messages: Awaited<ReturnType<typeof fetchChannelMessages>>
    try {
      messages = await fetchChannelMessages(row.channelId, { after, limit: 100 })
    } catch {
      continue
    }

    if (!messages.length) continue

    // Discord returns newest first; sort ascending by snowflake id
    const sorted = [...messages].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))

    let maxId = row.lastSyncedMessageId

    for (const m of sorted) {
      if (botId && m.author?.id === botId) {
        maxId = m.id
        continue
      }

      const existing = await prisma.discordMessageLink.findFirst({
        where: { discordMessageId: m.id, direction: 'from_discord' },
        select: { id: true },
      })
      if (existing) {
        maxId = m.id
        continue
      }

      if (!m.author?.id) {
        maxId = m.id
        continue
      }

      const text = (m.content ?? '').trim()
      const attachments = (m.attachments ?? []).filter(a => /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(a.url)).map(a => ({
        url: a.url, type: a.content_type?.startsWith('image/') ? 'image' : a.content_type?.startsWith('video/') ? 'video' : 'file', mimeType: a.content_type,
      }))
      if (!text && !attachments.length) {
        maxId = m.id
        continue
      }

      const authorName = m.author.global_name ?? m.author.username ?? 'Discord user'
      const avatarHash = m.author.avatar ?? null
      const avatarUrl = discordAvatarUrl(m.author.id, avatarHash)

      const posterId = row.guild.linkedByUserId

      const created = await createLeagueChatMessage(row.leagueId, posterId, text || 'Discord attachment', {
        sourceDiscord: true,
        discordMessageId: m.id,
        metadata: {
          discordAuthorName: authorName,
          discordAuthorAvatarUrl: avatarUrl,
          discordInbound: true,
          attachments,
        },
      })

      if (created) {
        await prisma.discordMessageLink.create({
          data: {
            leagueMessageId: created.id,
            discordMessageId: m.id,
            direction: 'from_discord',
            guildId: row.guildId,
            channelId: row.channelId,
          },
        })
        processed += 1
      } else break // Retain the cursor before a failed write so the next poll retries it.

      maxId = m.id
    }

    if (maxId && maxId !== row.lastSyncedMessageId) {
      await prisma.discordLeagueChannel.update({
        where: { id: row.id },
        data: { lastSyncedMessageId: maxId },
      })
    }
  }

  return NextResponse.json({ ok: true, processed, outboundDelivered })
}
