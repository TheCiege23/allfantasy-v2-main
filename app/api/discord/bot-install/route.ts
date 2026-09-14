import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { DISCORD_BOT_CALLBACK_URI, DISCORD_BOT_PERMISSIONS, DISCORD_CLIENT_ID } from '@/lib/discord/constants'
import { isBotConfigured } from '@/lib/discord/bot'
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { discordOAuthConfigValid } from '@/lib/discord/oauth-config'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login?callbackUrl=/settings', BASE))
  }

  if (!discordOAuthConfigValid(DISCORD_CLIENT_ID, DISCORD_BOT_CALLBACK_URI)) {
    return NextResponse.redirect(new URL('/settings?tab=connected&discord=config-error', BASE))
  }

  if (!isBotConfigured()) {
    return NextResponse.redirect(new URL('/settings?tab=connected&discord=bot-not-ready', BASE))
  }

  const profile = await prisma.userProfile.findUnique({ where: { userId: session.user.id }, select: { discordUserId: true, discordConnectedAt: true } })
  if (!profile?.discordUserId || !profile.discordConnectedAt) {
    return NextResponse.redirect(new URL('/settings?tab=connected&discord=account-required', BASE))
  }

  const url = new URL('https://discord.com/oauth2/authorize')
  const state = randomUUID()
  const cookieStore = await cookies()
  const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 600 }
  cookieStore.set('discord_bot_state', state, options)
  cookieStore.set('discord_bot_user', session.user.id, options)
  url.searchParams.set('state', state)
  url.searchParams.set('client_id', DISCORD_CLIENT_ID)
  url.searchParams.set('scope', 'bot')
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', DISCORD_BOT_CALLBACK_URI)

  return NextResponse.redirect(url)
}
