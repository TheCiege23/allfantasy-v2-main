/**
 * [NEW] GET: Big Brother audit log. Commissioner or league member. PROMPT 4.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getBigBrotherConfig, isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { redactBigBrotherAuditForViewer } from '@/lib/big-brother/auditVisibility'
import { prisma } from '@/lib/prisma'
import { getBigBrotherAuditLog } from '@/lib/big-brother/BigBrotherAuditLog'

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
  const [rows, league, config] = await Promise.all([
    getBigBrotherAuditLog(leagueId, { limit }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
    getBigBrotherConfig(leagueId),
  ])
  // Vote totals follow the league's own visibility setting; see lib/big-brother/auditVisibility.ts.
  const visible = redactBigBrotherAuditForViewer(rows, {
    isCommissioner: league?.userId === userId,
    showExactTotals: config?.publicVoteTotalsVisibility === 'exact',
  })

  const log = visible.map((r) => ({
    eventType: r.eventType,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }))

  return NextResponse.json({ log })
}
