/**
 * The AF Commissioner gate on an odd redraft playoff field, for routes that take a `playoffTeams`
 * override and build the bracket directly (POST /api/redraft/playoff-runtime, POST
 * /api/redraft/playoffs/generate).
 *
 * The settings save already refuses choosing a new odd field without the plan
 * (lib/league/execute-league-settings-patch.ts, ODD_PLAYOFF_TEAMS_REQUIRES_AF_COMMISSIONER), but the
 * bracket routes passed the override straight to the bracket builder with a commissioner check only,
 * so an odd bracket could be generated around it. Same rule here: only CHOOSING a new odd field is
 * gated, so a league keeps a size it already has, and no override at all is never refused.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { oddPlayoffFieldNeedsAfCommissioner } from '@/lib/league/oddTeamLeagues'

export async function refuseOddPlayoffFieldWithoutPlan(input: {
  leagueId: string
  userId: string
  playoffTeams: number | null | undefined
}): Promise<NextResponse | null> {
  const requested = input.playoffTeams == null ? null : Number(input.playoffTeams)
  if (requested == null || !Number.isFinite(requested)) return null
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { leagueType: true, playoffTeams: true },
  })
  if (!league) return null // the route's own lookup reports a missing league
  if (requested === league.playoffTeams) return null
  if (!oddPlayoffFieldNeedsAfCommissioner(league.leagueType, requested)) return null

  let planUser: { email: string | null; username: string | null } | null = null
  try {
    planUser = await prisma.appUser.findUnique({ where: { id: input.userId }, select: { email: true, username: true } })
  } catch {
    planUser = null
  }
  const hasSub = await hasAfCommissionerPlan({ id: input.userId, email: planUser?.email ?? null, username: planUser?.username ?? null })
  if (hasSub) return null
  return NextResponse.json(
    {
      error: `A ${requested}-team playoff field is part of AF Commissioner. Choose an even number or upgrade.`,
      code: 'ODD_PLAYOFF_TEAMS_REQUIRES_AF_COMMISSIONER',
    },
    { status: 403 },
  )
}
