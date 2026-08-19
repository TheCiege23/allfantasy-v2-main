import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeDevyProjection } from '@/lib/devy-intel'
import { computeClassDepthByPosition } from '@/lib/pick-valuation'

function riskBand(player: any): 'LOW' | 'MEDIUM' | 'HIGH' {
  const risk =
    (player.injurySeverityScore ?? 0) * 0.4 +
    (player.transferStatus ? 10 : 0) +
    (player.redshirtStatus ? 5 : 0)

  if (risk < 20) return 'LOW'
  if (risk < 50) return 'MEDIUM'
  return 'HIGH'
}

export async function POST(req: Request) {
  const { leagueId } = await req.json()

  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const players = await (prisma as any).player.findMany({
    where: {
      league: 'NCAA',
      devyEligible: true,
      graduatedToNFL: false,
      active: true,
    },
  })

  const enriched = players.map((p: any) => {
    // devy-intel rather than devy-model: eight signals (recruiting, production,
    // breakout, athletic, draft capital, PPA, wEPA, team context) against
    // devy-model's four, and it is the model wired to the CFBD advanced feeds.
    // Same honesty contract — null when nothing backed a projection.
    const projection = computeDevyProjection(p)
    return {
      ...p,
      draftProjectionScore: projection.score,
      draftProjectionConfidence: projection.confidence,
      draftProjectionCoverage: projection.coverage,
      draftProjectionMissing: projection.missing,
      riskBand: riskBand(p),
    }
  })

  // Unscored players sort last rather than producing NaN comparisons, which
  // would leave the board in arbitrary order.
  enriched.sort((a: any, b: any) => {
    if (a.draftProjectionScore == null && b.draftProjectionScore == null) return 0
    if (a.draftProjectionScore == null) return 1
    if (b.draftProjectionScore == null) return -1
    return b.draftProjectionScore - a.draftProjectionScore
  })

  const currentYear = new Date().getFullYear()
  const classYears = [currentYear + 1, currentYear + 2, currentYear + 3]
  const classDepth = classYears.map(year => {
    const yearPlayers = enriched.filter((p: any) => {
      const eligYear = p.draftEligibleYear ?? p.classYear
      return eligYear === year || (!eligYear && year === currentYear + 1)
    })
    const depth = computeClassDepthByPosition(yearPlayers)
    return { year, ...depth }
  })

  return NextResponse.json({
    success: true,
    players: enriched,
    classDepth,
  })
}
