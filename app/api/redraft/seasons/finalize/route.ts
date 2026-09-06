import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { finalizeNflRedraftPlayoffRuntimeSeason } from '@/lib/playoff-runtime'
import { triggerKeeperOffseason } from '@/lib/keeper/offseasonEngine'
import { supportsKeeperDeclarations } from '@/lib/league/keeper-policy'
import { enterRedraftOffseason } from '@/lib/redraft/offseason/RedraftOffseasonService'

export const dynamic = 'force-dynamic'

async function canManageLeague(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { isCommissioner: true, isCoCommissioner: true },
      },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return (league.teams as { isCommissioner: boolean; isCoCommissioner: boolean }[]).some(
    (t) => t.isCommissioner || t.isCoCommissioner,
  )
}

function statusFromCode(code: string): 'no_bracket' | 'no_final_round' | 'final_round_incomplete' | 'no_winner' {
  if (code === 'NO_BRACKET') return 'no_bracket'
  if (code === 'NO_WINNER') return 'no_winner'
  if (code === 'NO_FINAL_ROUND') return 'no_final_round'
  return 'final_round_incomplete'
}

/**
 * POST /api/redraft/seasons/finalize
 * Body: { seasonId: string }
 *
 * Crowns the champion from the completed final playoff round and marks the
 * season complete. Commissioner-only. Idempotent - safe to call twice.
 * Legacy route contract used finalizeRedraftSeasonChampion and returned
 * NextResponse.json(result); G40 delegates to the canonical NFL redraft
 * playoff runtime while preserving the client response shape.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { seasonId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const seasonId = body.seasonId?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: { leagueId: true },
  })
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })

  const allowed = await canManageLeague(season.leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden - commissioner only' }, { status: 403 })

  try {
    const result = await finalizeNflRedraftPlayoffRuntimeSeason({ seasonId, actorUserId: userId })
    if (!result.ok) {
      const status = statusFromCode(result.code)
      if (status === 'final_round_incomplete') {
        return NextResponse.json({ error: 'Final playoff round is not yet complete', result, status }, { status: 422 })
      }
      if (status === 'no_winner') {
        return NextResponse.json({ error: 'Final matchup has no winner - run advance first', result, status }, { status: 422 })
      }
      if (status === 'no_bracket') {
        return NextResponse.json({ error: 'No playoff bracket exists for this season', result, status }, { status: 422 })
      }
      return NextResponse.json({ error: 'No playoff rounds found', result, status }, { status: 422 })
    }

    const champion = result.state.teams.find((team) => team.rosterId === result.championRosterId)
    const alreadyFinalized = 'alreadyFinalized' in result && result.alreadyFinalized === true

    // First-time finalize only: archive the season and enter offseason.
    // Previously nothing called `enterRedraftOffseason` either, so a
    // finalized league's lifecycleState just sat at 'completed' forever —
    // no LeagueSeason/FranchiseSeason archive snapshot, no offseason
    // transition, and downstream renewal/keeper flows had nothing to key off.
    let offseasonEntered = false
    let offseasonSnapshotId: string | null = null
    if (!alreadyFinalized) {
      try {
        const offseasonResult = await enterRedraftOffseason(seasonId, userId)
        if (offseasonResult.ok) {
          offseasonEntered = true
          offseasonSnapshotId = offseasonResult.snapshotId
        } else {
          console.error('[redraft/seasons/finalize] enterRedraftOffseason declined', {
            leagueId: season.leagueId,
            seasonId,
            code: offseasonResult.code,
          })
        }
      } catch (error) {
        console.error('[redraft/seasons/finalize] enterRedraftOffseason failed', {
          leagueId: season.leagueId,
          seasonId,
          error,
        })
      }

      // Open the keeper offseason (creates next season's roster shells if
      // needed, opens the declaration window) for leagues that actually use
      // keepers. Previously nothing called this at all, so a finalized
      // keeper/dynasty league just sat there.
      const leagueMeta = await prisma.league.findUnique({
        where: { id: season.leagueId },
        select: { leagueType: true, isDynasty: true },
      })
      const keeperEligible =
        !!leagueMeta && (supportsKeeperDeclarations(leagueMeta.leagueType) || leagueMeta.isDynasty === true)
      if (keeperEligible) {
        triggerKeeperOffseason(season.leagueId, seasonId).catch((error) => {
          console.error('[redraft/seasons/finalize] triggerKeeperOffseason failed', {
            leagueId: season.leagueId,
            seasonId,
            error,
          })
        })
      }
    }

    return NextResponse.json({
      status: alreadyFinalized ? 'already_finalized' : 'ok',
      alreadyFinalized,
      offseasonEntered,
      offseasonSnapshotId,
      championRosterId: result.championRosterId,
      championUserId: champion?.ownerId ?? null,
      championTeamName: champion?.displayName ?? null,
      runnerUpRosterId: result.runnerUpRosterId,
      finalStandings: result.finalStandings,
      playoffs: result.state,
      events: result.events,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize redraft season'
    const status = message.includes('not_found') ? 404 : message.includes('not_nfl_redraft') ? 400 : 409
    return NextResponse.json({ error: message }, { status })
  }
}
