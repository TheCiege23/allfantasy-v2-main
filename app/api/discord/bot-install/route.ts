import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { DISCORD_BOT_CALLBACK_URI, DISCORD_BOT_PERMISSIONS, DISCORD_CLIENT_ID } from '@/lib/discord/constants'
import { isBotConfigured } from '@/lib/discord/bot'
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { discordOAuthConfigValid } from '@/lib/discord/oauth-config'
import { BOT_LEAGUE_COOKIE, installReturnPath, safeLeagueId } from '@/lib/discord/installReturn'
import { canManageDiscordBridge } from '@/lib/discord/bridgeAccess'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'

/**
 * Start "Add AllFantasy to your Discord server".
 *
 * `?leagueId=<id>` (optional) — started from that league's `/core/discord` setup
 * screen. When the signed-in user commissions it — head commissioner or co-commissioner,
 * `canManageDiscordBridge`, the same rule as the screen — the league is remembered in an
 * HttpOnly cookie and every outcome — success, refusal, cancel — returns there
 * instead of Settings. A league id they do not commission is ignored (Settings
 * behaviour), never trusted.
 */
export async function GET(req?: NextRequest) {
  const requested = safeLeagueId(req?.nextUrl?.searchParams?.get('leagueId'))

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    const back = requested ? `/core/discord?league=${encodeURIComponent(requested)}` : '/settings'
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(back)}`, BASE))
  }

  const leagueId = requested && (await canManageDiscordBridge(requested, session.user.id)) ? requested : null
  const back = (status: string) => NextResponse.redirect(new URL(installReturnPath(leagueId, status), BASE))

  if (!discordOAuthConfigValid(DISCORD_CLIENT_ID, DISCORD_BOT_CALLBACK_URI)) {
    return back('config-error')
  }

  if (!isBotConfigured()) {
    return back('bot-not-ready')
  }

  const profile = await prisma.userProfile.findUnique({ where: { userId: session.user.id }, select: { discordUserId: true, discordConnectedAt: true } })
  if (!profile?.discordUserId || !profile.discordConnectedAt) {
    return back('account-required')
  }

  const url = new URL('https://discord.com/oauth2/authorize')
  const state = randomUUID()
  const cookieStore = await cookies()
  const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 600 }
  cookieStore.set('discord_bot_state', state, options)
  cookieStore.set('discord_bot_user', session.user.id, options)
  // Always written, so an abandoned install from ANOTHER league cannot steer this
  // one's return: an empty value with maxAge 0 clears it.
  cookieStore.set(BOT_LEAGUE_COOKIE, leagueId ?? '', leagueId ? options : { ...options, maxAge: 0 })
  url.searchParams.set('state', state)
  url.searchParams.set('client_id', DISCORD_CLIENT_ID)
  url.searchParams.set('scope', 'bot')
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', DISCORD_BOT_CALLBACK_URI)

  return NextResponse.redirect(url)
}
