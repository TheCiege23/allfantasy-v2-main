import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { linkVerifiedGuild, verifyGuildManager } from '@/lib/discord/guild-access'
import { BOT_LEAGUE_COOKIE, installReturnPath, safeLeagueId } from '@/lib/discord/installReturn'

export const dynamic = 'force-dynamic'
const BASE = process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'

/**
 * Discord sends the commissioner back here after "Add to server".
 *
 * Every outcome returns to where the install started: the league's `/core/discord`
 * setup screen when it began there (league remembered by `/api/discord/bot-install`),
 * otherwise Settings, exactly as before.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login?callbackUrl=/settings', BASE))
  const cookieStore = await cookies()
  const state = cookieStore.get('discord_bot_state')?.value
  const initiatingUser = cookieStore.get('discord_bot_user')?.value
  const leagueId = safeLeagueId(cookieStore.get(BOT_LEAGUE_COOKIE)?.value)
  cookieStore.delete('discord_bot_state')
  cookieStore.delete('discord_bot_user')
  cookieStore.delete(BOT_LEAGUE_COOKIE)
  const back = (status: string) => NextResponse.redirect(new URL(installReturnPath(leagueId, status), BASE))

  const params = req.nextUrl.searchParams
  const guildId = params.get('guild_id')?.trim()
  const stateOk = Boolean(state) && state === params.get('state') && initiatingUser === session.user.id

  // "Cancel" on Discord's screen comes back with `error=access_denied` and no guild.
  // Only the setup screen knows the gentler wording; Settings keeps its old flag.
  if (stateOk && !guildId && params.get('error')) {
    return back(leagueId ? 'bot-cancelled' : 'bot-error')
  }
  if (!guildId || !stateOk) {
    return back('bot-error')
  }
  const manager = await verifyGuildManager(session.user.id, guildId)
  if (!manager) return back('bot-unverified')
  if (!(await linkVerifiedGuild(session.user.id, guildId, manager.guildName))) {
    // Another AllFantasy account linked this server first; links are never transferred.
    return back(leagueId ? 'bot-taken' : 'bot-error')
  }
  await prisma.userProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, discordGuildId: guildId },
    update: { discordGuildId: guildId },
  })
  return back('bot-linked')
}
