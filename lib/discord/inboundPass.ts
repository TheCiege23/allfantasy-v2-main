import { prisma } from '@/lib/prisma'
import { fetchChannelMessages, getBotUserId, isBotConfigured } from '@/lib/discord/bot'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { discordAvatarUrl } from '@/lib/discord/avatar'

export { DISCORD_INBOUND_SCHEDULED } from '@/lib/discord/inboundStatus'

/**
 * Discord → AllFantasy ("two-way"): read new lines from a league's Discord channel
 * into its AllFantasy chat. Opt-in per league, and OFF by default
 * (`DiscordLeagueChannel.syncInbound` defaults false).
 *
 * Not scheduled yet — see `DISCORD_INBOUND_SCHEDULED` in ./inboundStatus. To wire it,
 * call `runDiscordInboundPass({ budgetMs })` from an existing frequent cron with its
 * own small budget, inside a try/catch that can never fail the host, and flip that
 * constant in the same commit.
 *
 * ⚠ IT ALSO NEEDS DISCORD'S MESSAGE CONTENT INTENT. Without it Discord returns every
 * message with an empty `content`, and this pass (correctly) skips empty lines — so a
 * missing intent looks exactly like a quiet channel. Developer Portal → Bot →
 * Privileged Gateway Intents → Message Content.
 */

export type InboundPassReport = {
  channels: number
  /** Channels not reached because the time budget ran out; they go first next run. */
  deferred: number
  imported: number
  errors: number
}

type PassOptions = {
  /** Stop starting new channels after this long. A channel in flight finishes. */
  budgetMs: number
  now?: () => number
}

/**
 * One pass over every league with two-way on. NEVER THROWS: a host cron must not fail
 * because Discord is down, and a failure on one league must not stop the others.
 */
export async function runDiscordInboundPass(opts: PassOptions): Promise<InboundPassReport> {
  const now = opts.now ?? Date.now
  const started = now()
  const report: InboundPassReport = { channels: 0, deferred: 0, imported: 0, errors: 0 }
  if (!isBotConfigured()) return report

  let rows: Awaited<ReturnType<typeof loadRows>>
  try {
    rows = await loadRows()
  } catch {
    report.errors += 1
    return report
  }
  report.channels = rows.length

  let botId: string | null = null
  try {
    botId = await getBotUserId()
  } catch {
    botId = null
  }
  // Without our own id we cannot tell our relayed posts from people's, and would
  // import AllFantasy's own copies back into AllFantasy. Stop rather than loop.
  if (!botId) {
    report.errors += 1
    return report
  }

  for (let i = 0; i < rows.length; i++) {
    if (now() - started >= opts.budgetMs) {
      report.deferred = rows.length - i
      break
    }
    try {
      report.imported += await importChannel(rows[i], botId)
    } catch {
      report.errors += 1
    }
  }
  return report
}

async function loadRows() {
  const rows = await prisma.discordLeagueChannel.findMany({
    where: { syncEnabled: true, syncInbound: true, surface: 'league_chat' },
    include: { guild: { select: { linkedByUserId: true } } },
  })
  // Oldest cursor first (never-seen channels before all), so a channel deferred by the
  // budget is near the front next run. Compared as snowflakes: as strings, an 18-digit
  // id would sort after a 19-digit one.
  return rows.sort((a, b) => cursorOf(a) < cursorOf(b) ? -1 : cursorOf(a) > cursorOf(b) ? 1 : 0)
}

function cursorOf(row: { lastSyncedMessageId: string | null }): bigint {
  try {
    return row.lastSyncedMessageId ? BigInt(row.lastSyncedMessageId) : -1n
  } catch {
    return -1n
  }
}

type Row = Awaited<ReturnType<typeof loadRows>>[number]

async function importChannel(row: Row, botId: string): Promise<number> {
  // First sight of a channel: remember where it is NOW and import nothing. Two-way
  // starts from the moment it is switched on, never with the channel's history.
  if (!row.lastSyncedMessageId) {
    const latest = await fetchChannelMessages(row.channelId, { limit: 1 })
    if (latest[0]?.id) {
      await prisma.discordLeagueChannel.update({
        where: { id: row.id },
        data: { lastSyncedMessageId: latest[0].id },
      })
    }
    return 0
  }

  const messages = await fetchChannelMessages(row.channelId, { after: row.lastSyncedMessageId, limit: 10 })
  if (!messages.length) return 0

  // Discord returns newest first; walk oldest → newest by snowflake.
  const sorted = [...messages].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  let maxId = row.lastSyncedMessageId
  let imported = 0

  for (const m of sorted) {
    maxId = m.id
    if (!m.author?.id || m.author.id === botId) continue
    const text = (m.content ?? '').trim()
    if (!text) continue

    const existing = await prisma.discordMessageLink.findFirst({
      where: { discordMessageId: m.id, direction: 'from_discord' },
      select: { id: true },
    })
    if (existing) continue

    const authorName = m.author.global_name ?? m.author.username ?? 'Discord user'
    const created = await createLeagueChatMessage(row.leagueId, row.guild.linkedByUserId, text, {
      sourceDiscord: true,
      discordMessageId: m.id,
      metadata: {
        discordAuthorName: authorName,
        discordAuthorAvatarUrl: discordAvatarUrl(m.author.id, m.author.avatar ?? null),
        discordInbound: true,
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
      imported += 1
    }
  }

  if (maxId && maxId !== row.lastSyncedMessageId) {
    await prisma.discordLeagueChannel.update({
      where: { id: row.id },
      data: { lastSyncedMessageId: maxId },
    })
  }
  return imported
}
