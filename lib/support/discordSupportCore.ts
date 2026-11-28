/**
 * Discord as a support channel: the rules, with no I/O (the pass is lib/support/discordSupport.ts).
 *
 * Members post in the AllFantasy Discord server's support channel. Each person's messages become one
 * conversation in the existing support inbox (/admin/support), which already emails the owner and
 * pushes to every admin's phone. A staff reply from the inbox goes back into the channel as a reply to
 * that person's latest message, with an @mention so Discord notifies them.
 *
 * Owner's call, 2026-11-25: Discord is the support channel so members do not have to email, and the
 * inbox is how the owner never misses a message there (Discord's own notifications were unreliable).
 */

export const DISCORD_SUPPORT_CHANNEL_ENV = 'DISCORD_SUPPORT_CHANNEL_ID'

/**
 * The public, never-expiring invite into the AllFantasy Support server's #support channel (created
 * 2026-11-26). Public by design: it is shown to every member on /help and in the support form.
 * If it is ever revoked, make a new never-expiring invite to #support and replace it here.
 */
export const DISCORD_SUPPORT_INVITE_URL = 'https://discord.gg/rkxqXNCKkE'

/** The support channel's id, or null when support-by-Discord is switched off. */
export function discordSupportChannelId(env: Record<string, string | undefined> = process.env): string | null {
  const id = env[DISCORD_SUPPORT_CHANNEL_ENV]?.trim()
  return id && /^\d{15,25}$/.test(id) ? id : null
}

export type DiscordSupportMessage = {
  id: string
  content?: string | null
  author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean } | null
  attachments?: Array<{ url?: string; filename?: string }> | null
  /** Discord message types: 0 default, 19 reply. Joins, pins and boosts are system types and skipped. */
  type?: number
}

/** The text one Discord message adds to a conversation, or null when it adds nothing. */
export function discordSupportText(message: DiscordSupportMessage): string | null {
  const text = String(message.content ?? '').trim()
  const files = (message.attachments ?? [])
    .map((a) => String(a.url ?? '').trim())
    .filter((url) => url.startsWith('https://'))
  const parts = [text, ...files.map((url) => `Attachment: ${url}`)].filter(Boolean)
  if (parts.length === 0) return null
  return parts.join('\n').slice(0, 4000)
}

/**
 * Whether a channel message is a member asking for help: a person (not a bot, not us), an ordinary or
 * reply message, with something in it.
 */
export function isMemberSupportMessage(message: DiscordSupportMessage, botUserId: string): boolean {
  const author = message.author
  if (!author?.id || author.bot || author.id === botUserId) return false
  if (message.type != null && message.type !== 0 && message.type !== 19) return false
  return discordSupportText(message) != null
}

export function discordDisplayName(author: DiscordSupportMessage['author']): string {
  return (author?.global_name?.trim() || author?.username?.trim() || 'Discord member').slice(0, 60)
}

/** Posted once when a new conversation opens, so nobody wonders whether anyone saw it. */
export function supportAckText(discordUserId: string): string {
  return `<@${discordUserId}> Got it. We'll answer right here. For account or billing questions, use Help in the AllFantasy app so your details stay private.`
}

/** A staff reply as it appears in the channel. */
export function supportReplyText(discordUserId: string, reply: string): string {
  const body = reply.trim()
  const room = 2000 - `<@${discordUserId}> `.length
  return `<@${discordUserId}> ${body.length > room ? `${body.slice(0, room - 1)}…` : body}`
}
