import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // Relay calls are server-only. A signed-in account is not authority to post to a guild.
  const supplied = req.headers.get('x-discord-sync-secret') ?? ''
  const secret = process.env.DISCORD_SYNC_INTERNAL_SECRET ?? process.env.CRON_SECRET
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as {
    leagueId?: string
    messageId?: string
    authorName?: string
    authorAvatarUrl?: string | null
    text?: string
    gifUrl?: string | null
  } | null

  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : ''
  if (!leagueId || !messageId) {
    return NextResponse.json({ error: 'leagueId and messageId required' }, { status: 400 })
  }

  const result = await syncOutboundLeagueChat({
    leagueId,
    messageId,
    authorName: typeof body?.authorName === 'string' ? body.authorName : 'Manager',
    authorAvatarUrl: body?.authorAvatarUrl ?? null,
    text: typeof body?.text === 'string' ? body.text : '',
    gifUrl: body?.gifUrl ?? null,
  })

  return NextResponse.json(result)
}
