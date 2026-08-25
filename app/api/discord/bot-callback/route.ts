import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGuildBotPermissions } from '@/lib/discord/bot'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'

/**
 * Discord bot install callback.
 *
 * ⚠ IT USED TO REPORT SUCCESS AND LEAVE THE INSTALL HALF-DONE. This wrote the
 * guild id to `UserProfile.discordGuildId` and redirected to
 * `?discord=bot-linked` — but every downstream step keys off a
 * `DiscordGuildLink` ROW, which nothing here created. So `channels/create`
 * answered `403 "Guild not linked by you"` immediately after a screen that said
 * the bot was linked, and the only way to get the row was to find the league
 * sync panel and link the same guild a second time. Production carries 0
 * `discord_guild_links` and 0 `discord_league_channels`; this is at least part of
 * why.
 *
 * ⚠ THE LINK IS ONLY WRITTEN FOR A GUILD THE BOT IS VERIFIABLY IN. `guild_id`
 * arrives as a query parameter, so it is caller-supplied. `guilds/link` gated its
 * write on league ownership; the equivalent guard here is asking Discord whether
 * the bot actually holds membership in that guild. Without that check this route
 * would let anyone claim a link to any guild id they typed.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login?callbackUrl=/settings', BASE))
  }

  const guildId = req.nextUrl.searchParams?.get('guild_id')?.trim()
  if (!guildId) {
    return NextResponse.redirect(new URL('/settings?discord=bot-error', BASE))
  }

  // Unchanged: the drawer's Discord panel and the league sync panel both read this.
  await prisma.userProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, discordGuildId: guildId },
    update: { discordGuildId: guildId },
  })

  /*
   * Membership proves the install really happened and that this guild is not
   * simply a number somebody put in the URL. Null means the bot is not in it, the
   * token is unset, or Discord did not answer — none of which should produce a
   * link row.
   */
  let verified = false
  try {
    verified = (await getGuildBotPermissions(guildId)) != null
  } catch {
    verified = false
  }

  if (!verified) {
    /*
     * Distinct from `bot-error`: the profile write DID land, so the user is not
     * back at square one — the bot just is not visible in that guild yet.
     */
    return NextResponse.redirect(new URL('/settings?discord=bot-unverified', BASE))
  }

  await prisma.discordGuildLink.upsert({
    where: { guildId },
    create: {
      guildId,
      // Discord's install redirect carries no guild name; `guilds/link` fills it later.
      guildName: null,
      linkedByUserId: session.user.id,
    },
    // Re-installing into the same guild moves ownership to whoever just installed,
    // matching what `guilds/link` already does on conflict.
    update: { linkedByUserId: session.user.id },
  })

  return NextResponse.redirect(new URL('/settings?discord=bot-linked', BASE))
}
