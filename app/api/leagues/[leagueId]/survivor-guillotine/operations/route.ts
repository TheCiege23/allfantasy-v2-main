import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { resolveLeagueAccess } from '@/lib/league-access'
import { prisma } from '@/lib/prisma'
import { advanceSGPeriod, auditSGHistoricalCorrections, chooseSGStartingTribe, finalizeSGCaptains, pickSGCaptainDraft, reviewSGHistoricalCorrection, saveSGCalendar, saveSGCommissionerTie, saveSGDailyLineup, startSGCaptainDraft,
  setSGTribes, settleSGGauntletAuction, submitSGGauntletBid, submitSGPeriodChoice, submitSGTribeChoice,
  voteSGCaptain } from '@/lib/survivor-guillotine/operations'
import type { SGCalendarEntry } from '@/lib/survivor-guillotine/operations'
import type { SGTribeMember } from '@/lib/survivor-guillotine/live'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ leagueId: string }> }

export async function GET(_req: NextRequest, context: Context) {
  const userId = (await getServerSession(authOptions as never) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  const access = await assertLeagueCommissioner(leagueId, userId)
  if (!access.ok) return NextResponse.json({ error: 'Commissioner access required' }, { status: access.status })
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId },
    select: { periodCalendar: true, currentPeriod: true, captainElectionDeadlineAt: true } })
  if (!season) return NextResponse.json({ error: 'Season not configured' }, { status: 404 })
  return NextResponse.json({ calendar: season.periodCalendar, currentPeriod: season.currentPeriod,
    captainElectionDeadlineAt: season.captainElectionDeadlineAt })
}

export async function POST(req: NextRequest, context: Context) {
  const userId = (await getServerSession(authOptions as never) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  if (!await resolveLeagueAccess(leagueId, userId)) return NextResponse.json({ error: 'League access required' }, { status: 403 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'Action required' }, { status: 400 })
  const commissionerActions = new Set(['set_tribes', 'finalize_captains', 'save_calendar', 'advance', 'settle_auction', 'commissioner_choice', 'resolve_tie', 'audit_corrections', 'review_correction', 'start_captain_draft', 'commissioner_draft_pick'])
  if (commissionerActions.has(body.action)) {
    const access = await assertLeagueCommissioner(leagueId, userId)
    if (!access.ok) return NextResponse.json({ error: 'Commissioner access required' }, { status: access.status })
  }
  try {
    let result: unknown
    if (body.action === 'set_tribes') {
      if (!Array.isArray(body.members) || body.members.some(m => !m || typeof m.rosterId !== 'string' || typeof m.tribeId !== 'string')) throw new Error('Valid tribe assignments required.')
      result = await setSGTribes(leagueId, body.members as SGTribeMember[], typeof body.deadlineAt === 'string' ? body.deadlineAt : null)
    } else if (body.action === 'choose_tribe') {
      if (typeof body.tribeId !== 'string') throw new Error('Starting tribe required.')
      result = await chooseSGStartingTribe(leagueId, userId, body.tribeId)
    } else if (body.action === 'start_captain_draft') {
      if (!Array.isArray(body.captainRosterIds) || body.captainRosterIds.some(id => typeof id !== 'string')) throw new Error('Choose draft leaders.')
      result = await startSGCaptainDraft(leagueId, body.captainRosterIds as string[],
        typeof body.deadlineAt === 'string' ? body.deadlineAt : null)
    } else if (body.action === 'captain_draft_pick' || body.action === 'commissioner_draft_pick') {
      if (typeof body.rosterId !== 'string') throw new Error('Choose an undrafted manager.')
      result = await pickSGCaptainDraft(leagueId, userId, body.rosterId, body.action === 'commissioner_draft_pick')
    } else if (body.action === 'vote_captain') {
      if (typeof body.candidateRosterId !== 'string') throw new Error('Candidate required.')
      result = await voteSGCaptain(leagueId, userId, body.candidateRosterId)
    } else if (body.action === 'finalize_captains') {
      result = await finalizeSGCaptains(leagueId, body.choices && typeof body.choices === 'object' && !Array.isArray(body.choices)
        ? body.choices as Record<string, string> : {})
    } else if (body.action === 'save_calendar') {
      if (!body.calendar || typeof body.calendar !== 'object' || Array.isArray(body.calendar) || !Array.isArray(body.rewardPeriods)) throw new Error('Calendar and concealed reward weeks required.')
      result = await saveSGCalendar(leagueId, body.calendar as Record<number, SGCalendarEntry>, body.rewardPeriods as number[])
    } else if (body.action === 'advance') {
      result = await advanceSGPeriod(leagueId)
    } else if (body.action === 'daily_lineup') {
      if (!Number.isInteger(body.period) || typeof body.gameDay !== 'string' || !Array.isArray(body.playerIds) ||
          body.playerIds.some(id => typeof id !== 'string')) throw new Error('Scoring period, game day, and players required.')
      result = await saveSGDailyLineup(leagueId, userId, Number(body.period), body.gameDay, body.playerIds as string[])
    } else if (body.action === 'auction_bid') {
      result = await submitSGGauntletBid(leagueId, userId, Number(body.amount))
    } else if (body.action === 'settle_auction') {
      result = await settleSGGauntletAuction(leagueId)
    } else if (body.action === 'tribe_choice' || body.action === 'commissioner_choice') {
      const choice = body.choice as Record<string, unknown> | undefined
      if (!choice || !['matchup', 'champion', 'sit_out'].includes(String(choice.kind))) throw new Error('Choose a matchup, champion, or sit-out.')
      if (choice.kind === 'matchup' && (typeof choice.team1 !== 'string' || typeof choice.team2 !== 'string')) throw new Error('Both matchup teams are required.')
      if (choice.kind !== 'matchup' && typeof choice.rosterId !== 'string') throw new Error('Choose a manager.')
      result = body.action === 'commissioner_choice'
        ? await submitSGPeriodChoice(leagueId, userId, choice as Parameters<typeof submitSGPeriodChoice>[2], true)
        : await submitSGTribeChoice(leagueId, userId, choice as Parameters<typeof submitSGPeriodChoice>[2])
    } else if (body.action === 'resolve_tie') {
      result = await saveSGCommissionerTie(leagueId, body.decision as Parameters<typeof saveSGCommissionerTie>[1])
    } else if (body.action === 'audit_corrections') {
      result = await auditSGHistoricalCorrections(leagueId)
    } else if (body.action === 'review_correction') {
      if (!Number.isInteger(body.period) ||
          (body.decision !== 'keep_played_result' && body.decision !== 'manual_followup') ||
          typeof body.reason !== 'string') throw new Error('Period, review decision, and reason required.')
      result = await reviewSGHistoricalCorrection(leagueId, userId, Number(body.period), body.decision, body.reason)
    } else return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Action failed' }, { status: 409 })
  }
}
