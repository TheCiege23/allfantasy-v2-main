/**
 * Discord integration — copy content and webhook posting (PROMPT 298).
 */

import type { DiscordShareContent, DiscordWebhookPayload, DiscordEmbedPayload, CommunityShareInput } from './types'

const DEFAULT_USERNAME = 'AllFantasy'
const EMBED_COLOR = 0xf59e0b // amber

export function buildDiscordShareContent(input: CommunityShareInput): DiscordShareContent {
  const lines: string[] = [input.title]
  if (input.description) lines.push(input.description)
  if (input.extraLines?.length) lines.push(...input.extraLines)
  if (input.url) lines.push(input.url)

  const copyText = lines.join('\n\n')

  const embed: DiscordEmbedPayload | undefined =
    input.title || input.description || input.url
      ? {
          title: input.title.slice(0, 256),
          description: [input.description, ...(input.extraLines ?? [])].filter(Boolean).join('\n\n').slice(0, 4096),
          url: input.url,
          color: EMBED_COLOR,
          timestamp: new Date().toISOString(),
          footer: { text: 'allfantasy.ai' },
          ...(input.imageUrl && { image: { url: input.imageUrl } }),
        }
      : undefined

  return {
    copyText,
    embed,
  }
}

/**
 * Build webhook payload for Discord API (POST to webhook URL).
 */
function buildDiscordWebhookPayload(
  input: CommunityShareInput,
  options?: { username?: string; avatarUrl?: string }
): DiscordWebhookPayload {
  const { copyText, embed } = buildDiscordShareContent(input)
  const payload: DiscordWebhookPayload = {
    username: options?.username ?? DEFAULT_USERNAME,
    avatar_url: options?.avatarUrl,
    content: copyText.slice(0, 2000),
  }
  if (embed) {
    payload.embeds = [embed]
  }
  return payload
}

/**
 * Post content to a Discord webhook URL. Call from server only (do not expose webhook URL to client).
 */
export async function postToDiscordWebhook(
  webhookUrl: string,
  input: CommunityShareInput,
  options?: { username?: string }
): Promise<{ ok: boolean; error?: string }> {
  const payload = buildDiscordWebhookPayload(input, options)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `Discord webhook ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Request failed' }
  }
}
