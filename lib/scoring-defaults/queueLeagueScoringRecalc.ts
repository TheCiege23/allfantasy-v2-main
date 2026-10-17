import { prisma } from '@/lib/prisma'
import { processLeagueWeek } from '@/server/services/weeklyProcessor'

/**
 * After commissioner scoring overrides change, re-run weekly processing for the
 * league's current `settings.leg` (Sleeper-style week index) when present; otherwise week 1.
 * Fire-and-forget — does not block API responses.
 */
export function queueLeagueScoringRecalcAfterRulesChange(leagueId: string): void {
  void (async () => {
    let period = 'unknown'
    try {
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { season: true, settings: true },
      })
      if (!league) return
      const raw = league.settings as Record<string, unknown> | null | undefined
      const legRaw = raw?.leg
      const leg = typeof legRaw === 'number' ? legRaw : Number(legRaw)
      const week =
        Number.isFinite(leg) && leg >= 1 && leg <= 40 ? Math.floor(leg) : 1
      period = `${league.season}:${week}`
      await processLeagueWeek({ leagueId, season: league.season, week })
      await prisma.automationAuditLog.create({ data: { leagueId, action: 'scoring.recalc.resolved', entityType: 'scoring_period', entityId: period, message: 'Scoring recalculation completed.' } }).catch(err => console.warn('[commissioner-scoring] completed processing but audit could not be saved', { leagueId, err }))
    } catch (err) {
      if(period !== 'unknown') await prisma.automationAuditLog.create({ data: { leagueId, action: 'scoring.recalc.failed', entityType: 'scoring_period', entityId: period, message: 'Scoring recalculation failed; review rules and retry.' } }).catch(() => {})
      console.warn('[commissioner-scoring] background week processing after rules change failed', {
        leagueId,
        err,
      })
    }
  })()
}
