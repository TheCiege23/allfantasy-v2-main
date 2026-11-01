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
import { answerJuryQuestion, askJuryQuestion, getJuryQaView, markJuryAnswerSeen, postClosingSpeech } from '@/lib/survivor/survivorJuryQaService'
import { loadEndOfSeasonBallotReveal } from '@/lib/survivor/survivorBallotRevealService'

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
  const part = req.nextUrl.searchParams?.get('part')?.trim()
  // Jury Q&A + closing speeches: read only by the jury, finalists and a non-playing host until the
  // champion is crowned (survivorJuryQa.canReadJuryQa).
  if (part === 'qa') return NextResponse.json({ qa: await getJuryQaView(leagueId, userId) })
  // Who voted for whom: null until the season is complete, and only when the commissioner opted in.
  if (part === 'ballots') return NextResponse.json({ ballots: await loadEndOfSeasonBallotReveal(leagueId) })
  return NextResponse.json({ view: await getFinaleRevealView(leagueId, userId) })
}

const PARTICIPANT_INTENTS = new Set(['jury_vote', 'jury_question', 'finalist_answer', 'juror_seen', 'closing_speech'])

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
    jurorRosterId?: string
    text?: unknown
    week?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  if (!PARTICIPANT_INTENTS.has(String(body.intent ?? ''))) {
    const hostDenied = await survivorHostGuard(body.leagueId, userId)
    if (hostDenied) return hostDenied
  }

  // Jury Q&A and closing speeches: the acting manager's own roster, never a roster from the body.
  if (body.intent === 'jury_question' || body.intent === 'finalist_answer' || body.intent === 'juror_seen' || body.intent === 'closing_speech') {
    const gate = await assertLeagueMember(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const own = await prisma.roster.findFirst({ where: { leagueId: body.leagueId, platformUserId: userId }, select: { id: true } })
    if (!own) return NextResponse.json({ error: 'You have no roster in this league', code: 'no_roster' }, { status: 403 })
    const text = typeof body.text === 'string' ? body.text : ''
    const other = typeof body.finalistRosterId === 'string' ? body.finalistRosterId.trim() : typeof body.jurorRosterId === 'string' ? body.jurorRosterId.trim() : ''
    if (body.intent !== 'closing_speech' && !other) return NextResponse.json({ error: 'finalistRosterId or jurorRosterId required', code: 'missing_target' }, { status: 400 })
    if ((body.intent === 'jury_question' || body.intent === 'finalist_answer' || body.intent === 'closing_speech') && typeof body.text !== 'string') {
      return NextResponse.json({ error: 'text required', code: 'empty' }, { status: 400 })
    }
    const result =
      body.intent === 'jury_question' ? await askJuryQuestion(body.leagueId, { jurorRosterId: own.id, finalistRosterId: other, text, source: 'api.survivor.jury.route' })
        : body.intent === 'finalist_answer' ? await answerJuryQuestion(body.leagueId, { finalistRosterId: own.id, jurorRosterId: typeof body.jurorRosterId === 'string' ? body.jurorRosterId.trim() : other, text, source: 'api.survivor.jury.route' })
          : body.intent === 'juror_seen' ? await markJuryAnswerSeen(body.leagueId, { jurorRosterId: own.id, finalistRosterId: other })
            : await postClosingSpeech(body.leagueId, { finalistRosterId: own.id, text, source: 'api.survivor.jury.route' })
    if (!result.ok) return NextResponse.json({ error: result.code, code: result.code }, { status: result.status })
    return NextResponse.json({ ok: true })
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
      return NextResponse.json({ error: result.error ?? 'Final jury vote failed', ...(result.code ? { code: result.code } : {}) }, { status: result.code === 'held_for_speeches' ? 409 : 400 })
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
