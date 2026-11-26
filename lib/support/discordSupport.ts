import { prisma } from '@/lib/prisma'
import { fetchChannelMessages, getBotUserId, isBotConfigured, postReplyMentioning } from '@/lib/discord/bot'
import { recordDiscordSupportMessage } from '@/lib/support/supportInbox'
import {
  discordDisplayName,
  discordSupportChannelId,
  discordSupportText,
  isMemberSupportMessage,
  supportAckText,
} from '@/lib/support/discordSupportCore'

/**
 * Reads new messages in the AllFantasy Discord server's support channel into the support inbox
 * (rules: ./discordSupportCore.ts). Runs from the authenticated notification-outbox-relay cron, every
 * minute, beside the league two-way pass, with its own short budget.
 *
 * Setup, once: set `DISCORD_SUPPORT_CHANNEL_ID` on BOTH Railway services (the web service answers the
 * replies, the worker runs the cron) to the channel's id, and give the bot View Channel, Send Messages
 * and Read Message History in it. Like the league pass this needs the bot's Message Content intent, or
 * Discord sends every message empty and the channel looks quiet.
 *
 * Where it stands is a cursor (the newest message id read) kept in `SportsDataCache`, the app's durable
 * key-value table. The first run only records where the channel is: old messages are never imported.
 */

export const DISCORD_SUPPORT_CURSOR_KEY = 'discord:support:cursor'
const CURSOR_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000
const PAGE = 10

export type DiscordSupportPassReport = {
  configured: boolean
  read: number
  recorded: number
  opened: number
  skipped: number
  errors: number
}

type Options = { budgetMs: number; now?: () => number }

/** Never throws: a host cron must not fail because Discord is down. */
export async function runDiscordSupportPass(opts: Options): Promise<DiscordSupportPassReport> {
  const now = opts.now ?? Date.now
  const started = now()
  const report: DiscordSupportPassReport = { configured: false, read: 0, recorded: 0, opened: 0, skipped: 0, errors: 0 }
  const channelId = discordSupportChannelId()
  if (!channelId || !isBotConfigured()) return report
  report.configured = true

  try {
    const botId = await getBotUserId().catch(() => null)
    // Without our own id we cannot tell our replies from people's and would read them back in.
    if (!botId) {
      report.errors += 1
      return report
    }
    let cursor = await readCursor()
    if (!cursor) {
      const latest = await fetchChannelMessages(channelId, { limit: 1 })
      await writeCursor(latest[0]?.id ?? '0')
      return report
    }

    while (now() - started < opts.budgetMs) {
      const page = await fetchChannelMessages(channelId, { after: cursor, limit: PAGE })
      if (page.length === 0) break
      // Discord answers newest first; read oldest first so a conversation keeps its order.
      const oldestFirst = [...page].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      for (const message of oldestFirst) {
        report.read += 1
        try {
          await readOne(channelId, botId, message, report)
        } catch (e) {
          report.errors += 1
          console.error('[discord-support] message failed', { messageId: message.id, error: e instanceof Error ? e.message : String(e) })
        }
        // Advance past every message read, recorded or not, so one bad message cannot stall the channel.
        cursor = message.id
        await writeCursor(cursor)
      }
      if (page.length < PAGE) break
    }
  } catch (e) {
    report.errors += 1
    console.error('[discord-support] pass failed', { error: e instanceof Error ? e.message : String(e) })
  }
  return report
}

async function readOne(
  channelId: string,
  botId: string,
  message: Parameters<typeof isMemberSupportMessage>[0] & { id: string },
  report: DiscordSupportPassReport,
): Promise<void> {
  if (!isMemberSupportMessage(message, botId)) {
    report.skipped += 1
    return
  }
  const author = message.author!
  const linked = await prisma.authAccount
    .findUnique({ where: { provider_providerAccountId: { provider: 'discord', providerAccountId: author.id! } }, select: { userId: true } })
    .catch(() => null)
  const result = await recordDiscordSupportMessage({
    discord: { userId: author.id!, username: author.username || author.id!, messageId: message.id, channelId },
    displayName: discordDisplayName(author),
    linkedUserId: linked?.userId ?? null,
    text: discordSupportText(message)!,
  })
  if (!result.ok) {
    report.skipped += 1
    return
  }
  report.recorded += 1
  if (result.opened) {
    report.opened += 1
    await postReplyMentioning(channelId, supportAckText(author.id!), { replyToMessageId: message.id, mentionUserId: author.id! }).catch(() => null)
  }
}

async function readCursor(): Promise<string | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: DISCORD_SUPPORT_CURSOR_KEY }, select: { data: true } })
  const id = row?.data && typeof row.data === 'object' ? (row.data as { messageId?: unknown }).messageId : null
  return typeof id === 'string' && /^\d+$/.test(id) ? id : null
}

async function writeCursor(messageId: string): Promise<void> {
  const data = { messageId }
  const expiresAt = new Date(Date.now() + CURSOR_TTL_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: DISCORD_SUPPORT_CURSOR_KEY },
    create: { cacheKey: DISCORD_SUPPORT_CURSOR_KEY, data, expiresAt },
    update: { data, expiresAt },
  })
}
