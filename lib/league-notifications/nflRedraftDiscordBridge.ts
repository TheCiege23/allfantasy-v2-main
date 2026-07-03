import 'server-only'

import { syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'

export type NflRedraftDiscordAnnouncementStatus =
  | 'sent'
  | 'not_configured'
  | 'failed'

export type NflRedraftDiscordAnnouncementResult = {
  status: NflRedraftDiscordAnnouncementStatus
  discordMessageId?: string
  error?: string
}

/**
 * Optional G42 Discord bridge.
 *
 * The repo already owns Discord guild/channel mapping and outbound league-chat sync.
 * G42 intentionally reuses that path and treats Discord as best-effort: a Discord
 * failure must never block notifications, chat, or league feed persistence.
 */
export async function syncNflRedraftCommunicationToDiscord(input: {
  leagueId: string
  messageId: string
  title: string
  body: string
}): Promise<NflRedraftDiscordAnnouncementResult> {
  try {
    const result = await syncOutboundLeagueChat({
      leagueId: input.leagueId,
      messageId: input.messageId,
      authorName: 'AllFantasy',
      authorAvatarUrl: null,
      text: `${input.title}\n${input.body}`.trim(),
    })
    if (!result.synced) return { status: 'not_configured' }
    return { status: 'sent', discordMessageId: result.discordMessageId }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Discord sync failed',
    }
  }
}
