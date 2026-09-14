import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { linkVerifiedGuild, verifyGuildManager } from '@/lib/discord/guild-access'

export const dynamic = 'force-dynamic'
const BASE = process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login?callbackUrl=/settings', BASE))
  const cookieStore = await cookies()
  const state = cookieStore.get('discord_bot_state')?.value
  const initiatingUser = cookieStore.get('discord_bot_user')?.value
  cookieStore.delete('discord_bot_state')
  cookieStore.delete('discord_bot_user')
  const guildId = req.nextUrl.searchParams.get('guild_id')?.trim()
  if (!guildId || !state || state !== req.nextUrl.searchParams.get('state') || initiatingUser !== session.user.id) {
    return NextResponse.redirect(new URL('/settings?tab=connected&discord=bot-error', BASE))
  }
  const manager = await verifyGuildManager(session.user.id, guildId)
  if (!manager) return NextResponse.redirect(new URL('/settings?tab=connected&discord=bot-unverified', BASE))
  if (!(await linkVerifiedGuild(session.user.id, guildId, manager.guildName))) {
    return NextResponse.redirect(new URL('/settings?tab=connected&discord=bot-error', BASE))
  }
  await prisma.userProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, discordGuildId: guildId },
    update: { discordGuildId: guildId },
  })
  return NextResponse.redirect(new URL('/settings?tab=connected&discord=bot-linked', BASE))
}
