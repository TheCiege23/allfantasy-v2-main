import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { timingSafeEqual } from 'node:crypto'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'

export const dynamic = 'force-dynamic'

function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Re-send one AllFantasy league chat message to the league's Discord channel.
 *
 * 🛑 THE BODY NAMES A MESSAGE; IT NEVER SUPPLIES WHAT TO POST. This route used to
 * take `text`, `authorName` and `authorAvatarUrl` from the request and post them as
 * given — so any signed-in account could put any words, under any name, into any
 * league's Discord channel just by naming that league. Now the words, the name and
 * the avatar are read from the stored message, and everything else the body carries
 * is ignored.
 *
 * Who may call it:
 *   - the message's own author (re-sending their own line), or
 *   - a server-to-server caller holding `DISCORD_SYNC_INTERNAL_SECRET` (or
 *     `CRON_SECRET`), compared in constant time.
 *
 * `syncOutboundLeagueChat` then applies the league-wide rules — copying switched on,
 * public message, main league chat only — so nothing private can leave through here.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; messageId?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : ''
  if (!leagueId || !messageId) {
    return NextResponse.json({ error: 'leagueId and messageId required' }, { status: 400 })
  }

  const internal = secretMatches(
    req.headers.get('x-discord-sync-secret'),
    process.env.DISCORD_SYNC_INTERNAL_SECRET ?? process.env.CRON_SECRET,
  )
  let sessionUserId: string | null = null
  if (!internal) {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    sessionUserId = session?.user?.id ?? null
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const message = await prisma.leagueChatMessage.findUnique({
    where: { id: messageId },
    select: {
      leagueId: true,
      userId: true,
      message: true,
      metadata: true,
      user: { select: { displayName: true, username: true, avatarUrl: true } },
    },
  })
  // Same answer for "no such message" and "not in this league", so the route cannot
  // be used to learn which message ids exist in other leagues.
  if (!message || message.leagueId !== leagueId) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
  if (!internal && message.userId !== sessionUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const meta = (message.metadata && typeof message.metadata === 'object' ? message.metadata : {}) as Record<string, unknown>
  const gifUrl = typeof meta.gifUrl === 'string' ? meta.gifUrl : null

  try {
    const result = await syncOutboundLeagueChat({
      leagueId,
      messageId,
      authorName: message.user?.displayName || message.user?.username || 'Manager',
      authorAvatarUrl: message.user?.avatarUrl ?? null,
      text: message.message,
      gifUrl,
    })
    return NextResponse.json(result)
  } catch {
    // Discord refused even after one retry. The message is safe in AllFantasy.
    return NextResponse.json({ synced: false, error: 'Discord did not take the message' }, { status: 502 })
  }
}
