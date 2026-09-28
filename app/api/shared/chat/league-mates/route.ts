import { NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { listLeagueMates } from '@/lib/chat-core/leagueMates'
import { BlockListUnavailableError } from '@/lib/moderation/BlockUserService'

/**
 * GET /api/shared/chat/league-mates?q=
 *
 * The DM / huddle picker's people list: everyone who shares at least one league with you, minus you
 * and minus anyone with a block in either direction, searchable by name or handle, at most 20.
 * Database only — see lib/chat-core/leagueMates.ts for the membership paths and the query shape.
 *
 * ⚠ A NEW ROUTE, WHICH THE THREAD PANEL'S HEADER ONCE RULED OUT. That rule dates from the Vercel
 * 2048-route ceiling; `node scripts/route-budget-count.mjs` measured 1741 deployed route signals on
 * 2026-09-25, so one more is inside the budget. The existing single-league `@` autocomplete could
 * not be reused: it needs a league id, reads claimed teams only, and does not check blocks.
 *
 * Fails CLOSED on the block list: if it cannot be read, nobody is suggested (503), rather than
 * suggesting someone who blocked you.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const UNAVAILABLE = "Couldn't load your league-mates right now. Try again in a moment."

export async function GET(req: Request) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const q = new URL(req.url).searchParams.get('q')

  try {
    const mates = await listLeagueMates(user.appUserId, q)
    return NextResponse.json({ status: 'ok', mates }, { headers: NO_STORE })
  } catch (err) {
    /*
     * The error's NAME only: a Prisma message can carry the query's parameters, and nothing about a
     * person belongs in a log line.
     */
    const kind = err instanceof BlockListUnavailableError ? 'block list unavailable' : err instanceof Error ? err.name : 'unknown'
    console.warn('[league-mates] read failed:', kind)
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503, headers: NO_STORE })
  }
}
