/** Public Discord application id (OAuth + bot install). */
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim() || '1499502145039499344'

/** Must match Discord Developer Portal redirect and the authorize request. */
export const DISCORD_OAUTH_REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI ?? 'https://www.allfantasy.ai/api/auth/discord/callback'

export const DISCORD_BOT_CALLBACK_URI =
  process.env.DISCORD_BOT_REDIRECT_URI ?? 'https://www.allfantasy.ai/api/discord/bot-callback'

/** Bot permissions: VIEW_CHANNEL + MANAGE_CHANNELS + SEND_MESSAGES + READ_MESSAGE_HISTORY + EMBED_LINKS + ATTACH_FILES + MANAGE_WEBHOOKS */
export const DISCORD_BOT_PERMISSIONS = '536988688'
