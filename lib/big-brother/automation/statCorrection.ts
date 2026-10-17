import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import type { BbStatCorrectionInput, BbStatCorrectionResult } from './types'

/** Snapshot finalized totals; only changed revisions produce a notice. Published game outcomes stay final. */
export async function handleBbStatCorrectionSignal(input: BbStatCorrectionInput = {}): Promise<BbStatCorrectionResult> {
  const errors: string[] = []
  let leaguesNoted = 0
  let scopedLeagueId = input.leagueId
  if (input.redraftSeasonId) {
    const season = await prisma.redraftSeason.findUnique({ where: { id: input.redraftSeasonId }, select: { leagueId: true } })
    if (!season || (scopedLeagueId && scopedLeagueId !== season.leagueId)) return { ok: false, leaguesNoted: 0, errors: ['Season/league mismatch'], message: 'No leagues processed.' }
    scopedLeagueId = season.leagueId
  }
  const configs = await prisma.bigBrotherLeagueConfig.findMany({ where: scopedLeagueId ? { leagueId: scopedLeagueId } : {}, select: { leagueId: true, id: true } })
  for (const config of configs) {
    try {
      const league = await prisma.league.findUnique({ where: { id: config.leagueId }, select: { season: true, userId: true } })
      if (!league) continue
      const cycles = await prisma.bigBrotherCycle.findMany({ where: { leagueId: config.leagueId, configId: config.id, closedAt: { not: null }, ...(input.week ? { week: input.week } : {}) }, select: { id: true, week: true }, orderBy: { week: 'desc' } })
      let noted = false
      for (const cycle of cycles) {
        const scores = await prisma.teamWeekResult.findMany({ where: { leagueId: config.leagueId, season: league.season, week: cycle.week, status: 'final' }, select: { rosterId: true, totalPoints: true }, orderBy: { rosterId: 'asc' } })
        if (!scores.length) continue
        const fingerprint = createHash('sha256').update(JSON.stringify(scores)).digest('hex')
        const prior = await prisma.bigBrotherAuditLog.findFirst({ where: { leagueId: config.leagueId, configId: config.id, eventType: 'phase_transition', metadata: { path: ['scoreSnapshotCycleId'], equals: cycle.id } }, orderBy: { createdAt: 'desc' }, select: { id: true, metadata: true } })
        const priorMeta = prior?.metadata as { fingerprint?: string } | null
        if (priorMeta?.fingerprint === fingerprint) continue
        const changed = priorMeta?.fingerprint != null || (input.previousScores && scores.some(row => Object.hasOwn(input.previousScores!, row.rosterId) && input.previousScores![row.rosterId] !== row.totalPoints))
        if (input.dryRun) { if (changed) noted = true; continue }
        const revision = createHash('sha256').update(`${cycle.id}:${prior?.id ?? 'baseline'}:${fingerprint}`).digest('hex')
        if (changed) {
          if (!league.userId) throw new Error('League announcer unavailable')
          await createLeagueChatMessage(config.leagueId, league.userId,
            `Week ${cycle.week} finalized fantasy totals changed. Standings now use the updated totals. Published HOH, Veto, and eviction outcomes remain final; the commissioner can review the scoring audit.`, {
              idempotencyKey: `bb-correction-${revision}`, source: 'bb_automation', messageSubtype: 'bb_stat_correction',
              metadata: { chimmy: true, bigBrother: true, week: cycle.week, cycleId: cycle.id, fingerprint },
            })
          noted = true
        }
        await prisma.bigBrotherAuditLog.create({ data: { id: `bb-score-${revision}`, leagueId: config.leagueId, configId: config.id, eventType: 'phase_transition', metadata: { event: changed ? 'stat_correction_noted' : 'score_snapshot_baseline', scoreSnapshotCycleId: cycle.id, week: cycle.week, fingerprint } } }).catch((error: unknown) => {
          if ((error as { code?: string })?.code !== 'P2002') throw error
        })
      }
      if (noted) leaguesNoted++
    } catch (error) { errors.push(`${config.leagueId}: ${error instanceof Error ? error.message : 'Correction check failed'}`) }
  }
  return { ok: errors.length === 0, leaguesNoted, errors, message: `${input.dryRun ? '[dryRun] ' : ''}BB stat corrections: ${leaguesNoted} league(s) ${input.dryRun ? 'would be notified' : 'notified'}.` }
}
