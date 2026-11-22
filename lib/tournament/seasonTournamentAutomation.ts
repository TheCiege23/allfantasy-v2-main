import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { completeSeasonDraft } from './seasonDraftCompletion'
import { refreshSeasonDraftPool } from './seasonDraftRefresh'
import { handoffCompletedSeasonDraft, seasonScoringId } from './seasonDraftHandoff'
import { hasSeasonDraftRelease } from './seasonDraftReleaseGate'
import { startSeasonDraft } from './seasonDraftStart'
import { activateSeasonStage, advanceSeasonStage, provisionSeasonStage } from './seasonRounds'
import { scoreSeasonLeaguePeriod } from './seasonScoring'
import { resolveSeasonDraftWindow } from './seasonRules'
import { deliverPendingSeasonReports } from './seasonReportChat'
import { remindSeasonDraft } from './seasonDraftReminder'
import { claimNextSeasonTournament, rotateSeasonRooms } from './seasonTournamentRotation'
import { lockAndCheckSeasonRecovery, SCORE_DELAYED, seasonRecoveryHeld } from './seasonRecoveryState'

async function progressDraft(leagueId: string, kind: string, now: Date) {
  if (kind === 'auction') {
    const { runAuctionAutomationTick } = await import('@/lib/live-draft-engine/auction')
    await runAuctionAutomationTick(leagueId)
  } else {
    const { processExpiredDraftPickForLeague } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const result = await processExpiredDraftPickForLeague(leagueId, now)
    if (result.outcome === 'error') throw new Error(result.message)
  }
}

type SeasonTournamentDeps = Parameters<typeof scoreSeasonLeaguePeriod>[3] & {
  refreshDraft?: typeof refreshSeasonDraftPool
  progressDraft?: typeof progressDraft
  dispatchDraftReminder?: Parameters<typeof remindSeasonDraft>[1]
}

/** A sweep lease prevents concurrent jobs from consuming the same room and database capacity.
 * Stage, draft and result writes also have their own database fences.
 */
export async function runSeasonTournament(tournamentId: string, now = new Date(), deps: SeasonTournamentDeps = {}) {
  const key = 'season-tournament:' + tournamentId, owner = randomUUID()
  const lock = await acquireAutomationLock(key, { owner, ttlMs: 90_000 })
  if (!lock.ok) return { processed: 0, advanced: false, errors: lock.reason.startsWith('Lock held') ? [] : ['Could not claim tournament sweep.'] }
  try {
    return await sweepSeasonTournament(tournamentId, now, deps)
  } finally {
    await releaseAutomationLock(key, owner).catch(() => {})
  }
}

async function sweepSeasonTournament(tournamentId: string, now: Date, deps: SeasonTournamentDeps) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell || shell.status !== 'rules_published' || !['NFL', 'NBA'].includes(shell.sport)) return { processed: 0, advanced: false, errors: [] }
  if (await seasonRecoveryHeld(prisma, tournamentId)) return { processed: 0, advanced: false, errors: [] }
  const stage = Math.max(1, shell.currentRoundNumber)
  const field = await provisionSeasonStage(tournamentId, stage, now)
  if (!field) return { processed: 0, advanced: false, errors: [] }
  const round = await prisma.tournamentRound.findUnique({
    where: { tournamentId_roundNumber: { tournamentId, roundNumber: stage } },
  })
  const { manifest, id: freezeId } = field
  const rules = manifest.config.rules!
  const strictDeadline = !!rules.calendar.draftOverrides
  if (round ? !['drafting', 'active'].includes(round.status) : !strictDeadline) return { processed: 0, advanced: false, errors: [] }
  const startsAt = round ? new Date(rules.calendar.periods.find(period => period.number === round.weekStart)!.startsAt) : null
  const ids = manifest.leagues.map(pool => seasonResourceId(freezeId, pool.key))
  const escalationAt = stage < 3
    ? (rules.calendar.draftOverrides ?? []).filter(row => row.stage === stage + 1).map(row => row.startsAt)
      .concat(rules.calendar.drafts.filter(row => row.stage === stage + 1).map(row => row.startsAt))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0]!
    : undefined
  const errors: string[] = []

  let processed = 0
  const work = async (leagueId: string) => {
    if (round?.status === 'active') {
      const season = await prisma.redraftSeason.findUnique({ where: { id: seasonScoringId(leagueId) } })
      if (season?.status === 'active' && season.currentWeek <= round.weekEnd) {
        const period = rules.calendar.periods.find(row => row.number === season.currentWeek)!
        let finalized = false
        try {
          finalized = await scoreSeasonLeaguePeriod(leagueId, period.number, now, deps)
        } finally {
          if (!finalized && now.getTime() >= Date.parse(period.finalizesAt)) {
            await trackSeasonScoringDelay(tournamentId, leagueId, stage, period.number, now, escalationAt, shell.commissionerId)
          }
        }
      }
      return
    }
    const pool = manifest.leagues[ids.indexOf(leagueId)]!
    const window = resolveSeasonDraftWindow(rules.calendar, stage, pool)!
    const sessionId = seasonResourceId(freezeId, pool.key + ':draft')
    const session = await prisma.draftSession.findUnique({
      where: { id: sessionId }, include: { _count: { select: { picks: true } } },
    })
    if (session?.status === 'completed' && await prisma.redraftSeason.count({ where: { id: seasonScoringId(leagueId) } })) return
    const draftDeadline = new Date(window.completeBy)
    if (session && session.status !== 'tournament_setup_blocked' && session._count.picks === session.rounds * session.teamCount) {
      if (await completeSeasonDraft(leagueId, now) && await handoffCompletedSeasonDraft(leagueId, now)) return
    }
    if (strictDeadline && now >= draftDeadline) {
      // The buffer lets an in-flight pick settle before the worker records the missed deadline.
      if (startsAt && now < startsAt) return
      if (session?.startedAt) {
        const onTime = await prisma.draftPick.count({ where: {
          sessionId, playerId: { not: null }, playerName: { not: '' }, position: { not: '' },
          OR: [{ pickedAt: { lte: draftDeadline } }, { pickedAt: null, createdAt: { lte: draftDeadline } }],
        } })
        if (onTime === session.rounds * session.teamCount) return // The draft finished on time and the roster handoff can retry.
      }
      const id = seasonResourceId(sessionId, 'deadline-missed')
      await prisma.tournamentAuditLog.upsert({
        where: { id }, update: {},
        create: { id, tournamentId, actorType: 'system', action: 'season_draft_deadline_missed', targetType: 'league', targetId: leagueId,
          createdAt: now, data: { stage, key: pool.key, completeBy: window.completeBy, manifestHash: manifest.manifestHash } },
      })
      return
    }
    if ((stage === 1 && session?.status === 'pre_draft') || (stage > 1 && session?.status === 'tournament_setup_blocked')) {
      if (stage === 1) {
        const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
        if (!league || !await hasSeasonDraftRelease(leagueId, league.settings)) return
      }
      try {
        await remindSeasonDraft({ tournamentId, leagueId, sessionId, pool, startsAt: window.startsAt, now }, deps.dispatchDraftReminder)
      } catch {
        errors.push(leagueId + ': Draft reminder will retry before the scheduled start.')
      }
      await startSeasonDraft(leagueId, now, deps.refreshDraft)
    } else if (session?.status === 'in_progress' && session.timerEndAt && session.timerEndAt <= now && startsAt && now < startsAt) {
      await (deps.progressDraft ?? progressDraft)(leagueId, session.draftType, now)
    }
  }
  // Rotate the starting room if a provider outage consumes the per-tick budget.
  const rotated = await rotateSeasonRooms(tournamentId, ids)
  const deadline = Date.now() + 38_000
  const batchSize = 2
  for (let i = 0; i < rotated.length && Date.now() < deadline; i += batchSize) {
    const batch = rotated.slice(i, i + batchSize)
    const results = await Promise.allSettled(batch.map(work))
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') processed++
      else errors.push(batch[index] + ': ' + (result.reason instanceof Error ? result.reason.message : 'Tournament operation failed.'))
    })
  }
  const advanced = !startsAt ? false
    : round?.status === 'drafting' ? await activateSeasonStage(tournamentId, stage, startsAt, now)
    : await advanceSeasonStage(tournamentId, stage, now)
  return { processed, advanced, errors }
}

async function trackSeasonScoringDelay(tournamentId: string, leagueId: string, stage: number, period: number, now: Date, escalationAt: string | undefined, ownerId: string) {
  const id = seasonResourceId(leagueId, 'score-delay:' + period)
  const seasonId = seasonScoringId(leagueId)
  await prisma.$transaction(async tx => {
    if (await lockAndCheckSeasonRecovery(tx, tournamentId)) return
    await tx.$queryRaw`SELECT id FROM redraft_seasons WHERE id = ${seasonId} FOR UPDATE`
    const current = await tx.redraftSeason.findUnique({ where: { id: seasonId }, select: { currentWeek: true, status: true } })
    if (current?.status !== 'active' || current.currentWeek !== period) return
    await tx.tournamentAuditLog.upsert({
      where: { id }, update: {},
      create: { id, tournamentId, roundNumber: stage, actorType: 'system', action: SCORE_DELAYED, targetType: 'league', targetId: leagueId, createdAt: now,
        data: { period, stage, ownerId, escalationAt: escalationAt ?? now.toISOString() } },
    })
  })
}

export async function runDueSeasonTournaments(now = new Date()) {
  const next = await claimNextSeasonTournament()
  const due = next ? [next] : []
  const [runs, chat] = await Promise.all([
    Promise.allSettled(due.map(shell => runSeasonTournament(shell.id, now))),
    deliverPendingSeasonReports(now).catch(() => ({ posted: 0, errors: ['Standings chat delivery will retry.'] })),
  ])
  return runs.reduce((summary, run, index) => {
    if (run.status === 'fulfilled') {
      summary.processed += run.value.processed
      summary.advanced += Number(run.value.advanced)
      summary.errors.push(...run.value.errors)
    } else summary.errors.push(due[index]!.id + ': ' + (run.reason instanceof Error ? run.reason.message : 'Tournament run failed.'))
    return summary
  }, { scanned: due.length, processed: 0, advanced: 0, chatPosts: chat.posted, errors: chat.errors })
}
