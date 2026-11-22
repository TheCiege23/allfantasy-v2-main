import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { keeperValueReport } from '@/lib/keeper/keeperValueReport'
import { computeKeeperEligibility } from '@/lib/keeper/eligibilityEngine'
import { resolveKeeperSourceRoster } from '@/lib/keeper/keeperSourceRoster'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  if (!leagueId || !seasonId) {
    return NextResponse.json({ error: 'leagueId and seasonId required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  // The Keepers tab asks with the window's (next season's) ids; eligibility is priced on the season just
  // played (lib/keeper/keeperSourceRoster.ts). A manager with no roster last season has nothing to keep.
  const source = await resolveKeeperSourceRoster({ leagueId, seasonId, rosterId })
  if (rosterId && !source.rosterId) {
    return NextResponse.json({ eligible: [], ineligible: [], raw: [], valueReport: { available: false, reason: 'no_market_values' } })
  }
  const where = { leagueId, seasonId: source.seasonId, ...(source.rosterId ? { rosterId: source.rosterId } : {}) }

  let rows = await prisma.keeperEligibility.findMany({ where })

  if (rows.length === 0) {
    await computeKeeperEligibility(leagueId, source.seasonId)
    rows = await prisma.keeperEligibility.findMany({ where })
  }

  const eligible = rows
    .filter((r) => r.isEligible)
    .map((r) => ({
      playerId: r.playerId,
      costLabel: r.projectedCost,
      yearsKept: r.yearsKept,
      costRound: r.projectedCostRound,
    }))
  const ineligible = rows
    .filter((r) => !r.isEligible)
    .map((r) => ({ playerId: r.playerId, reason: r.ineligibleReason }))

  // Keeper value report (AF Commissioner): each candidate's market value against his cost.
  // Best-effort — a report that cannot be built never hides the eligibility it sits beside.
  const valueReport = await keeperValueReport(leagueId, rows.filter((r) => r.isEligible)).catch(
    () => ({ available: false as const, reason: 'no_market_values' as const }),
  )

  return NextResponse.json({ eligible, ineligible, raw: rows, valueReport })
}

