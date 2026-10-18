import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import {
  openFinale,
  openJuryPhase,
  openJuryVoting,
} from '@/lib/survivor/juryEngine'
import { recordCrownedWinner, settleFinaleIfDue, submitJuryVote } from '@/lib/survivor/SurvivorFinaleEngine'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { getFinaleRevealView } from '@/lib/survivor/finaleView'

export const dynamic = 'force-dynamic'

/**
 * GET: Final Tribal Council view (jury bench, finalist records, sealed/revealed jury vote).
 * The jury tally and reveal sequence are withheld until every juror has voted or the deadline passes.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  return NextResponse.json({ view: await getFinaleRevealView(leagueId, userId) })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    intent?: string
    leagueId?: string
    finalistUserIds?: string[]
    finalistRosterId?: string
    deadline?: string
    finalistUserId?: string
    week?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  if (body.intent !== 'jury_vote') {
  const hostDenied = await survivorHostGuard(body.leagueId, userId)
  if (hostDenied) return hostDenied

  }

  if (body.intent === 'open_jury') {
    const gate = await assertLeagueCommissioner(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await openJuryPhase(body.leagueId)
    return NextResponse.json({ ok: true })
  }

  if (body.intent === 'open_finale' && body.finalistUserIds?.length) {
    const gate = await assertLeagueCommissioner(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await openFinale(body.leagueId, body.finalistUserIds)
    return NextResponse.json({ ok: true })
  }

  if (body.intent === 'open_voting' && body.deadline) {
    const gate = await assertLeagueCommissioner(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await openJuryVoting(body.leagueId, new Date(body.deadline))
    return NextResponse.json({ ok: true })
  }

  if (body.intent === 'jury_vote' && (body.finalistUserId || body.finalistRosterId)) {
    const gate = await assertLeagueMember(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const jurorRoster = await prisma.roster.findFirst({
      where: { leagueId: body.leagueId, platformUserId: userId },
      select: { id: true },
    })
    if (!jurorRoster) return NextResponse.json({ error: 'You have no roster in this league' }, { status: 403 })

    let finalistRosterId = typeof body.finalistRosterId === 'string' ? body.finalistRosterId.trim() : ''
    if (!finalistRosterId && body.finalistUserId) {
      const finalistRoster = await prisma.roster.findFirst({
        where: { leagueId: body.leagueId, platformUserId: body.finalistUserId },
        select: { id: true },
      })
      finalistRosterId = finalistRoster?.id ?? ''
    }
    if (!finalistRosterId) {
      return NextResponse.json({ error: 'finalistUserId/finalistRosterId is required' }, { status: 400 })
    }

    const week =
      typeof body.week === 'number' && Number.isFinite(body.week)
        ? Math.max(1, Math.floor(body.week))
        : await resolveSurvivorCurrentWeek(body.leagueId)

    const result = await submitJuryVote({
      leagueId: body.leagueId,
      jurorRosterId: jurorRoster.id,
      finalistRosterId,
      week,
      source: 'api.survivor.jury.route',
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Final jury vote failed' }, { status: 400 })
    }
    // Never echo the finale state: it carries every juror's ballot. The client re-reads the sealed view.
    return NextResponse.json({ ok: true, closed: Boolean(result.state?.closed) })
  }

  if (body.intent === 'reveal') {
    const gate = await assertLeagueCommissioner(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    // The winner is decided only by the jury votes the finale engine counted.
    // Settles first when the jury deadline has passed with ballots missing.
    const state = await settleFinaleIfDue(body.leagueId, await resolveSurvivorCurrentWeek(body.leagueId))
    if (!state.closed || !state.winnerRosterId) {
      return NextResponse.json({ error: 'The jury vote is still sealed: not every juror has voted and the deadline has not passed.' }, { status: 409 })
    }
    const { winnerUserId } = await recordCrownedWinner(body.leagueId, state)
    return NextResponse.json({ winnerId: winnerUserId })
  }

  return NextResponse.json({ error: 'Invalid intent' }, { status: 400 })
}
