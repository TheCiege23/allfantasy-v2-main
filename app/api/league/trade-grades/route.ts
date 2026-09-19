import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getImportedTradeLedger } from '@/lib/trade-intel/importedTradeLedgerService'
import { getReconciledTradeGrades } from '@/lib/core-app/sleeperTradeHistory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // first build walks every season's transactions

/**
 * Graded trade ledger for the Legacy tab: every completed trade since the
 * league was created, graded on realized outcomes and re-graded each season.
 * Access rules mirror /api/league/history; Sleeper-only for now.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    // Imported leagues (Yahoo/ESPN/…): serve the honest UNGRADED ledger from
    // the persisted transaction facts. Grades need per-player historical
    // scoring, which imported provider data doesn't include — the payload
    // says so explicitly instead of guessing letters.
    const ledger = await getImportedTradeLedger(league.id, league.platform ?? 'imported')
    if (ledger) {
      return NextResponse.json({
        supported: true as const,
        graded: false as const,
        viewerSleeperUserId: null,
        ledger,
      })
    }
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }

  const [claimed, profile] = await Promise.all([
    prisma.leagueTeam
      .findFirst({ where: { leagueId: league.id, claimedByUserId: userId }, select: { platformUserId: true } })
      .catch(() => null),
    prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null),
  ])

  const reconciled = await getReconciledTradeGrades(league.platformLeagueId)
  const grades = reconciled.grades
  if (!grades) {
    return NextResponse.json(
      { supported: true as const, grades: null, error: 'Trade grading temporarily unavailable' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    supported: true as const,
    viewerSleeperUserId: claimed?.platformUserId ?? profile?.sleeperUserId ?? null,
    grades,
    sync: {
      liveFeedAvailable: reconciled.feedAvailable,
      incomplete: reconciled.incomplete,
      refreshed: reconciled.refreshed,
    },
  })
}
