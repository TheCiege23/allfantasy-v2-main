/**
 * POST: Commissioner @everyone broadcast to selected league chats.
 * Body: { leagueIds: string[], message: string }.
 * Permission, per league: head commissioner or co-commissioner, in a league AllFantasy runs
 * (`broadcastRefusal` in lib/commissioner/broadcastAccess.ts — the rule every surface that offers a
 * send also uses, `GET /api/commissioner/leagues` included; that file says why imported leagues are
 * refused).
 * Also sends in-app + email/SMS notification to all league members (commissioner_alerts). The send
 * itself is lib/commissioner/postLeagueAnnouncement.ts, shared with scheduled announcements.
 *
 * ⚠ RATE-LIMITED PER USER. One call can fan out email and text to every member of several leagues,
 * and more than one person per league may now send. Five sends in ten minutes is well past any real
 * announcement cadence; a refused send is 429 and reaches nobody.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { broadcastRefusal } from '@/lib/commissioner/broadcastAccess'
import { postLeagueAnnouncement } from '@/lib/commissioner/postLeagueAnnouncement'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Not exported: a route module may only export handlers and route config.
const BROADCASTS_PER_WINDOW = 5
const BROADCAST_WINDOW_MS = 10 * 60 * 1000

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leagueIds = Array.isArray(body.leagueIds) ? body.leagueIds.map((id: unknown) => String(id)).filter(Boolean) : []
  const message = String(body?.message ?? body?.text ?? '').trim()
  if (leagueIds.length === 0) return NextResponse.json({ error: 'leagueIds required' }, { status: 400 })
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })
  if (message.length > 500) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

  // Counted after validation, so a malformed request does not use up a send.
  const limit = rateLimit(`commissioner-broadcast:${userId}`, BROADCASTS_PER_WINDOW, BROADCAST_WINDOW_MS)
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many announcements in a short time. Try again in a few minutes.' },
      { status: 429 },
    )
  }

  const results: { leagueId: string; sent: boolean; error?: string }[] = []
  for (const leagueId of leagueIds) {
    const refusal = await broadcastRefusal(leagueId, userId).catch((): 'forbidden' => 'forbidden')
    if (refusal) {
      results.push({
        leagueId,
        sent: false,
        error: refusal === 'imported' ? 'Announcements go only to leagues AllFantasy runs' : 'Forbidden',
      })
      continue
    }
    results.push({ leagueId, sent: await postLeagueAnnouncement(leagueId, userId, message) })
  }
  return NextResponse.json({ ok: true, results })
}
