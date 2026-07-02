import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveNflRedraftRosterRuntime } from '@/lib/roster-runtime'
import { canViewLeague, isElevatedCommissioner } from '@/server/services/permissionService'

function positiveWeek(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(1, parsed) : null
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  const { searchParams } = new URL(req.url)
  const requestedRosterId = searchParams.get('rosterId')?.trim() || null

  const [viewer, commissioner] = await Promise.all([
    canViewLeague(leagueId, userId),
    isElevatedCommissioner(leagueId, userId),
  ])

  if (!viewer && !commissioner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let rosterId = requestedRosterId

  if (!commissioner) {
    const ownRoster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    })
    if (!ownRoster) {
      return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
    }
    if (requestedRosterId && requestedRosterId !== ownRoster.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    rosterId = ownRoster.id
  }

  const resolved = await resolveNflRedraftRosterRuntime({
    leagueId,
    rosterId,
    scoringWeek: positiveWeek(searchParams.get('week')),
  })

  if (!resolved.ok) {
    const status = resolved.reason === 'league_not_found' ? 404 : resolved.reason === 'not_nfl_redraft' ? 400 : 404
    return NextResponse.json({ error: resolved.reason }, { status })
  }

  return NextResponse.json({
    ok: true,
    visibility: commissioner ? 'commissioner' : 'manager',
    rulesVersion: resolved.rules.version,
    generatedAtIso: resolved.state.generatedAtIso,
    season: resolved.state.season,
    scoringWeek: resolved.state.scoringWeek,
    starterSlots: resolved.state.starterSlots,
    teams: resolved.state.teams,
    runtimeInvariants: resolved.state.runtimeInvariants,
    coverage: resolved.coverage,
  })
}
