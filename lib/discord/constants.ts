import { getPublicSiteOrigin } from '@/lib/site-public-origin'

/** Public Discord application id (OAuth + bot install). */
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim() || '1499502145039499344'

/**
 * Must match Discord Developer Portal redirect and the authorize request.
 *
 * ⚠ THESE USED TO BE HARDCODED TO `www.allfantasy.ai`, independent of the app's
 * actual canonical host. NEXTAUTH_URL resolves to bare `allfantasy.ai` in
 * production, and `middleware.ts` 308s `www` -> apex for every page route — but
 * `/api/auth/*` and `/api/discord/*` are never subject to that redirect, so a
 * session cookie set while browsing on apex was never sent back to Discord's
 * hardcoded `www` callback. That produced a real, live bug: connecting Discord
 * always ended in `getServerSession` returning null on the callback and bouncing
 * the user to `/login`, even though they had just signed in.
 *
 * getPublicSiteOrigin() is the single source of truth this repo already built for
 * exactly this class of problem (canonical-host redirects, email links); using it
 * here means these two URLs can never drift from the host the rest of the app
 * treats as canonical again.
 */
export const DISCORD_OAUTH_REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI ?? `${getPublicSiteOrigin()}/api/auth/discord/callback`

export const DISCORD_BOT_CALLBACK_URI =
  process.env.DISCORD_BOT_REDIRECT_URI ?? `${getPublicSiteOrigin()}/api/discord/bot-callback`

/** Bot permissions: VIEW_CHANNEL + MANAGE_CHANNELS + SEND_MESSAGES + READ_MESSAGE_HISTORY + EMBED_LINKS + ATTACH_FILES + MANAGE_WEBHOOKS */
export const DISCORD_BOT_PERMISSIONS = '536988688'
