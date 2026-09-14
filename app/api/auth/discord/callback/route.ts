import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DISCORD_CLIENT_ID, DISCORD_OAUTH_REDIRECT_URI } from '@/lib/discord/constants'
import { encrypt } from '@/lib/league-auth-crypto'
import { discordOAuthConfigValid } from '@/lib/discord/oauth-config'

export const dynamic = 'force-dynamic'

const SETTINGS_BASE = process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'
const CONNECTED_SETTINGS_PATH = '/settings?tab=connected'

function failed(reason: string, stage: string, status?: number) {
  // Never log provider bodies, authorization codes, tokens, or profile data.
  console.warn('[discord-account-connect]', { stage, reason, status })
  return NextResponse.redirect(new URL(`${CONNECTED_SETTINGS_PATH}&discord=${reason}`, SETTINGS_BASE))
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(CONNECTED_SETTINGS_PATH)}`, SETTINGS_BASE))
  }

  const searchParams = req.nextUrl.searchParams
  const code = searchParams?.get('code')
  const state = searchParams?.get('state')
  const err = searchParams?.get('error')

  const cookieStore = await cookies()
  const stored = cookieStore.get('discord_oauth_state')?.value
  const initiatingUserId = cookieStore.get('discord_oauth_user_id')?.value

  if (err) {
    cookieStore.delete('discord_oauth_state')
    cookieStore.delete('discord_oauth_user_id')
    return failed(err === 'access_denied' ? 'cancelled' : 'provider-error', 'authorize')
  }

  if (!code || !state || !stored || stored !== state || !initiatingUserId || initiatingUserId !== session.user.id) {
    cookieStore.delete('discord_oauth_state')
    cookieStore.delete('discord_oauth_user_id')
    return failed('session-expired', 'state')
  }

  cookieStore.delete('discord_oauth_state')
  cookieStore.delete('discord_oauth_user_id')

  const secret = process.env.DISCORD_CLIENT_SECRET?.trim()
  if (!secret || /sensitive|redacted/i.test(secret) || !discordOAuthConfigValid(DISCORD_CLIENT_ID, DISCORD_OAUTH_REDIRECT_URI)) {
    return failed('config-error', 'config')
  }

  let stage = 'token'
  try {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_OAUTH_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })

  if (!tokenRes.ok) {
    const failure = await tokenRes.json().catch(() => ({}))
    const reason = failure.error === 'invalid_client' ? 'config-error'
      : failure.error === 'invalid_grant' ? 'authorization-expired' : 'provider-error'
    return failed(reason, stage, tokenRes.status)
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    token_type?: string
  }
  const access_token = tokens.access_token
  if (!access_token) {
    return failed('provider-error', stage, tokenRes.status)
  }

  stage = 'identity'
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })

  if (!userRes.ok) {
    return failed('provider-error', stage, userRes.status)
  }

  const data = (await userRes.json()) as {
    id: string
    username: string
    global_name?: string | null
    avatar?: string | null
    email?: string | null
  }

  if (!/^\d{17,20}$/.test(data.id) || typeof data.username !== 'string') {
    return failed('provider-error', stage)
  }
  stage = 'encryption'
  const username = data.global_name ?? data.username
  const encryptedAccessToken = encrypt(access_token)
  const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null

  stage = 'profile'
    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        discordUserId: data.id,
        discordUsername: username,
        discordEmail: data.email ?? null,
        discordAvatar: data.avatar ?? null,
        discordAccessToken: encryptedAccessToken,
        discordRefreshToken: encryptedRefreshToken,
        discordConnectedAt: new Date(),
      },
      update: {
        discordUserId: data.id,
        discordUsername: username,
        discordEmail: data.email ?? null,
        discordAvatar: data.avatar ?? null,
        discordAccessToken: encryptedAccessToken,
        discordRefreshToken: encryptedRefreshToken,
        discordConnectedAt: new Date(),
      },
    })
  return NextResponse.redirect(new URL(`${CONNECTED_SETTINGS_PATH}&discord=connected`, SETTINGS_BASE))
  } catch {
    return failed(stage === 'profile' ? 'save-error' : stage === 'encryption' ? 'config-error' : 'provider-error', stage)
  }
}

