import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { resolveLeagueAccess } from '@/lib/league-access'
import { prisma } from '@/lib/prisma'
import { advanceSGHostedCeremony, advanceSGPeriod, auditSGHistoricalCorrections, awardSGHistoricalCompensation, chooseSGStartingTribe, finalizeSGCaptains, pickSGCaptainDraft, restartSGHostedCeremony, reviewSGHistoricalCorrection, saveSGCalendar, saveSGCommissionerTie, saveSGDailyLineup, startSGCaptainDraft,
  setSGTribes, settleSGGauntletAuction, submitSGGauntletBid, submitSGPeriodChoice, submitSGTribeChoice,
  voteSGCaptain } from '@/lib/survivor-guillotine/operations'
import type { SGCalendarEntry } from '@/lib/survivor-guillotine/operations'
import type { SGTribeMember } from '@/lib/survivor-guillotine/live'
import { FAAB_ON_CHOP_KEY, readFaabOnChop } from '@/lib/guillotine/faabOnChop'
import { viewerCanEditPaidGuillotineRules } from '@/lib/guillotine/guillotineRulesSave'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ leagueId: string }> }

export async function GET(_req: NextRequest, context: Context) {
  const userId = (await getServerSession(authOptions as never) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  const access = await assertLeagueCommissioner(leagueId, userId)
  if (!access.ok) return NextResponse.json({ error: 'Commissioner access required' }, { status: access.status })
  const [season, league, canEditPaid] = await Promise.all([
    prisma.survivorGuillotineLeague.findUnique({ where: { leagueId },
      select: { periodCalendar: true, currentPeriod: true, captainElectionDeadlineAt: true } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    viewerCanEditPaidGuillotineRules(userId),
  ])
  if (!season) return NextResponse.json({ error: 'Season not configured' }, { status: 404 })
  return NextResponse.json({ calendar: season.periodCalendar, currentPeriod: season.currentPeriod,
    captainElectionDeadlineAt: season.captainElectionDeadlineAt,
    // What happens to a chopped team's unspent FAAB (lib/survivor-guillotine/faabSplit.ts).
    faabOnChop: readFaabOnChop(league?.settings), canEditPaid })
}

export async function POST(req: NextRequest, context: Context) {
  const userId = (await getServerSession(authOptions as never) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  if (!await resolveLeagueAccess(leagueId, userId)) return NextResponse.json({ error: 'League access required' }, { status: 403 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'Action required' }, { status: 400 })
  const commissionerActions = new Set(['set_tribes', 'finalize_captains', 'save_calendar', 'advance', 'advance_hosted_ceremony', 'restart_hosted_ceremony', 'settle_auction', 'commissioner_choice', 'resolve_tie', 'audit_corrections', 'review_correction', 'award_correction_compensation', 'start_captain_draft', 'commissioner_draft_pick', 'set_faab_on_chop'])
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
    } else if (body.action === 'advance_hosted_ceremony') {
      if (!Number.isInteger(body.period)) throw new Error('Scoring period required.')
      result = await advanceSGHostedCeremony(leagueId, userId, Number(body.period))
    } else if (body.action === 'restart_hosted_ceremony') {
      if (!Number.isInteger(body.period)) throw new Error('Scoring period required.')
      result = await restartSGHostedCeremony(leagueId, userId, Number(body.period))
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
    } else if (body.action === 'set_faab_on_chop') {
      // The Guilly rule (lib/guillotine/faabOnChop.ts): "split" is AF Commissioner, "keep" is always allowed.
      if (body.value !== 'keep' && body.value !== 'split') throw new Error("Pick what happens to a chopped team's FAAB.")
      if (body.value === 'split' && !(await viewerCanEditPaidGuillotineRules(userId))) {
        return NextResponse.json({ error: "Splitting a chopped team's FAAB is part of AF Commissioner." }, { status: 402 })
      }
      const value = body.value
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
        const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
        const current = (row?.settings as Record<string, unknown> | null) ?? {}
        await tx.league.update({ where: { id: leagueId }, data: { settings: { ...current, [FAAB_ON_CHOP_KEY]: value } } })
      })
      result = { faabOnChop: value }
    } else if (body.action === 'award_correction_compensation') {
      if (!Number.isInteger(body.period) || typeof body.recipientRosterId !== 'string' ||
          !Number.isInteger(body.amount) || typeof body.reason !== 'string') {
        throw new Error('Period, recipient, whole-number FAAB amount, and reason required.')
      }
      result = await awardSGHistoricalCompensation(leagueId, userId, Number(body.period),
        body.recipientRosterId, Number(body.amount), body.reason)
    } else return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Action failed' }, { status: 409 })
  }
}
