import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { evaluateLegalityForPersistedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'

export const dynamic = 'force-dynamic'

const MAX_LEAGUES = 40

/**
 * GET: `{ counts: Record<leagueId, number> }` — illegal roster issue counts for My Leagues rail badges.
 */
export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rosters = await prisma.roster.findMany({
    where: { OR: [{ platformUserId: userId }, { managerUserId: userId }] },
    select: { id: true, leagueId: true, playerData: true },
    take: MAX_LEAGUES,
    orderBy: { updatedAt: 'desc' },
  })

  const counts: Record<string, number> = {}

  await Promise.all(
    rosters.map(async (r) => {
      try {
        const out = await evaluateLegalityForPersistedRoster({
          id: r.id,
          leagueId: r.leagueId,
          playerData: r.playerData,
        })
        if (!out || out.result.isLegal) {
          counts[r.leagueId] = 0
          return
        }
        const n = Math.max(
          out.result.requiredMovesCount,
          out.result.blockingReasons.length,
          out.result.highlightedPlayerIds.length,
          1,
        )
        counts[r.leagueId] = Math.min(99, n)
      } catch {
        counts[r.leagueId] = 0
      }
    }),
  )

  return NextResponse.json({ ok: true, counts })
}
