import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createPlatformThreadTypedMessage } from '@/lib/platform/chat-service'
import { getCreatePollPayload } from '@/lib/social-chat'
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from '@/lib/chat-core'
import { resolveLeagueAccess } from '@/lib/league-access'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { awardBallotInput } from '@/lib/league-chat/awardBallot'
import { exportLeagueAwards, publishAwardBallot, updateAwardBallot } from '@/lib/league-chat/awardBallotService'
import { createAwardSheetToken, readAwardSheetToken } from '@/lib/league-chat/awardSheetToken'
import { afcSnapshot, isAfcPilotLeague, loadAfcPilot } from '@/lib/afc-championships/staging'
import { afcStatus, afcTeams } from '@/lib/afc-championships/bracket'

type Context = { params: Promise<{ threadId: string }> }

export async function GET(req: NextRequest, props: Context) {
  const { threadId } = await props.params
  const leagueId = getLeagueIdFromVirtualRoom(decodeURIComponent(threadId))
  const view = req.nextUrl.searchParams.get('view')
  if (!leagueId || (view !== 'award-sheet' && !(view === 'afc-sheet' && isAfcPilotLeague(leagueId)))) {
    return NextResponse.json({ error: 'Unknown export' }, { status: 404 })
  }
  const auth = req.headers.get('authorization') ?? ''
  const userId = auth.startsWith('Bearer ') ? readAwardSheetToken(auth.slice(7), leagueId) : null
  if (view === 'afc-sheet') {
    const pilot = userId ? await loadAfcPilot(leagueId, userId) : null
    if (!pilot) return NextResponse.json({ error: 'AFC sheet access denied' }, { status: 403 })
    const snapshot = await afcSnapshot(pilot)
    const games = snapshot?.rounds.flatMap(round => round.games.flatMap(game => {
      if (game.away == null || game.home == null) return []
      return [{
        id: game.id, round: round.number, week: round.week,
        away: afcTeams[game.away], home: afcTeams[game.home],
        awayScore: game.awayPoints, homeScore: game.homePoints,
        status: afcStatus[game.status], winner: game.winner == null ? '' : afcTeams[game.winner],
      }]
    })) ?? []
    return NextResponse.json({ leagueId, season: pilot.season, games }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  if (!userId || !await canCommissionerAct(leagueId, userId, 'league')) {
    return NextResponse.json({ error: 'Award sheet access denied' }, { status: 403 })
  }
  return NextResponse.json(await exportLeagueAwards(leagueId), { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, props: Context) {
  const params = await props.params
  const user = await resolvePlatformUser()
  const userId = user.appUserId
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const threadId = decodeURIComponent(params.threadId)

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: 'Invalid league room' }, { status: 400 })
    if (body?.kind === 'award-vote') {
      if (!await resolveLeagueAccess(leagueId, userId)) return NextResponse.json({ error: 'Join this league to vote.' }, { status: 403 })
      if (typeof body.ballotId !== 'string' || typeof body.optionId !== 'string') {
        return NextResponse.json({ error: 'Ballot and choice are required.' }, { status: 400 })
      }
      const outcome = await updateAwardBallot(leagueId, body.ballotId, { userId, optionId: body.optionId })
      return outcome.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }

    if (!await canCommissionerAct(leagueId, userId, 'league')) {
      return NextResponse.json({ error: 'Commissioner permission is required.' }, { status: 403 })
    }
    if (body?.kind === 'award-sheet-key') {
      const token = createAwardSheetToken(leagueId, userId)
      if (!token) return NextResponse.json({ error: 'Award sheet integration is unavailable.' }, { status: 503 })
      const path = `/api/shared/chat/threads/${encodeURIComponent(threadId)}/polls?view=award-sheet`
      return NextResponse.json({ leagueId, path, token }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    if (body?.kind === 'award-close' && typeof body.ballotId === 'string') {
      const outcome = await updateAwardBallot(leagueId, body.ballotId, 'close')
      return outcome.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }
    if (body?.kind !== 'award-publish') return NextResponse.json({ error: 'Unknown league poll action.' }, { status: 400 })
    const parsed = awardBallotInput.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter an award name, 2–12 distinct choices, and a closing date.' }, { status: 400 })
    }
    if (Date.parse(parsed.data.closeAt) <= Date.now()) {
      return NextResponse.json({ error: 'Choose a future closing date.' }, { status: 400 })
    }
    const ballot = await publishAwardBallot({ ...parsed.data, leagueId, userId })
    return ballot ? NextResponse.json(ballot, { status: 201 }) : NextResponse.json({ error: 'League not found.' }, { status: 404 })
  }

  const normalized = getCreatePollPayload(
    String(body?.question || ''),
    Array.isArray(body?.options) ? body.options.map((v: unknown) => String(v)) : [],
  )
  const { question, options } = normalized
  if (!question || options.length < 2) {
    return NextResponse.json({ error: 'question and at least two options are required' }, { status: 400 })
  }
  const created = await createPlatformThreadTypedMessage(
    userId, threadId, 'poll', { question, options, expiresAt: body?.expiresAt || null },
  )
  if (!created) return NextResponse.json({ error: 'Unable to create poll' }, { status: 400 })
  return NextResponse.json({ status: 'ok', message: created })
}
