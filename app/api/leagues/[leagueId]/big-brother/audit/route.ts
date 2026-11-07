/**
 * GET: Big Brother house log.
 *
 * Members get `entries` — the PUBLIC log from `publicHouseLog` (readable events, vote counts only when the league
 * shows exact totals). Only the commissioner also gets `log`, the raw audit rows, for the admin panel. Until
 * 2026-11-07 every member got the raw rows, eviction tallies and roster snapshots included.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getBigBrotherConfig, isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getBigBrotherAuditLog } from '@/lib/big-brother/BigBrotherAuditLog'
import { publicHouseLog } from '@/lib/big-brother/publicHouseLog'
import { isCommissioner } from '@/lib/commissioner/permissions'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams?.get('limit') ?? '50', 10) || 50, 100)
  const [rows, config, commissioner] = await Promise.all([
    getBigBrotherAuditLog(leagueId, { limit }),
    getBigBrotherConfig(leagueId),
    isCommissioner(leagueId, userId),
  ])

  const entries = publicHouseLog(rows, config?.publicVoteTotalsVisibility)
  const headers = { 'cache-control': 'private, no-store' }
  if (!commissioner) return NextResponse.json({ entries }, { headers })

  const log = rows.map((r) => ({
    eventType: r.eventType,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }))
  return NextResponse.json({ entries, log }, { headers })
}
