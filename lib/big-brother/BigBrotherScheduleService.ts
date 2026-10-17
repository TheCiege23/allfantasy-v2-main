import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { BB_DEADLINES, resolveBigBrotherDeadlines } from './schedule'
import { isFinaleReached } from './BigBrotherFinaleService'

export type BigBrotherScheduleData = {
  paused: boolean; finaleReady: boolean; winnerPublished: boolean; currentWeek: number | null
  weeks: { week: number; phase: string; closed: boolean; events: { key: string; label: string; deadlineAt: string | null; state: 'complete' | 'current' | 'upcoming' | 'conditional' | 'skipped' }[] }[]
}

export async function getBigBrotherSchedule(leagueId: string): Promise<BigBrotherScheduleData | null> {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return null
  const [cycles, finaleReady, winner] = await Promise.all([
    prisma.bigBrotherCycle.findMany({ where: { leagueId, configId: config.configId }, orderBy: { week: 'desc' } }),
    isFinaleReached(leagueId),
    prisma.bigBrotherAuditLog.findFirst({ where: { leagueId, configId: config.configId, eventType: 'finale_vote' }, select: { id: true } }),
  ])
  return { paused: config.weekProgressionPaused, finaleReady, winnerPublished: !!winner, currentWeek: cycles[0]?.week ?? null,
    weeks: cycles.map(cycle => {
      const dates = resolveBigBrotherDeadlines(config, cycle)
      const complete: Record<string, boolean> = {
        hoh: !!cycle.hohRosterId, nomination: !!cycle.nominee1RosterId && !!cycle.nominee2RosterId,
        veto_draw: Array.isArray(cycle.vetoParticipantRosterIds) && cycle.vetoParticipantRosterIds.length > 0,
        veto_decision: ['REPLACEMENT_NOMINATION_OPEN', 'VOTING_OPEN', 'VOTING_LOCKED', 'EVICTION_RESOLVED', 'JURY_UPDATE', 'RESET_NEXT_WEEK'].includes(cycle.phase),
        replacement: !!cycle.replacementNomineeRosterId, voting_open: !!cycle.voteOpenedAt && cycle.voteOpenedAt <= new Date(), eviction: !!cycle.closedAt,
      }
      return { week: cycle.week, phase: cycle.phase, closed: !!cycle.closedAt, events: BB_DEADLINES.map(event => ({
        key: event.key, label: event.label, deadlineAt: dates[event.key]?.toISOString() ?? null,
        state: complete[event.key] ? 'complete' : event.key === 'replacement' && !cycle.vetoUsed ? complete.veto_decision ? 'skipped' : 'conditional'
          : cycle.phase === event.phase && event.action ? 'current' : 'upcoming',
      })) }
    }) }
}
