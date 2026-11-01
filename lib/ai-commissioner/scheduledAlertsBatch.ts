/**
 * "Commissioner AI alerts", on a schedule. The League setting `leagueAiCommissionerAlerts` was a
 * switch nothing read: the AI commissioner cycle (`runAICommissionerCycle`: lineup reminders,
 * inactive managers, trade review flags, collusion signals, disputes …) only ran when a commissioner
 * pressed "Run" on the AI Commissioner panel. This runs it once a day for every league that turned
 * the switch on and whose owner holds AF Commissioner — the plan the switch is sold under.
 *
 * The cycle de-duplicates against open alerts and notifies the commissioner only of NEW ones, so a
 * daily run never repeats yesterday's alerts.
 *
 * Rides the daily commissioner cron (app/api/cron/commissioner-workspace-refresh) because the cron
 * registry is at its budget; like the batches already there, a failure never takes that cron down.
 */
import { prisma } from '@/lib/prisma'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { runAICommissionerCycle } from './AICommissionerService'

/** Phases where there is a league to govern. Setup, the offseason and archived leagues are skipped. */
const ACTIVE_STATES = ['pre_draft', 'drafting', 'post_draft', 'in_season', 'playoffs'] as const

export type ScheduledAiAlertsResult = { discovered: number; ran: number; skippedNoPlan: number; failed: number; created: number }

export async function runScheduledAiCommissionerAlerts(opts: { leagueId?: string; limit?: number; run?: typeof runAICommissionerCycle } = {}): Promise<ScheduledAiAlertsResult> {
  const run = opts.run ?? runAICommissionerCycle
  const leagues = await prisma.league.findMany({
    where: {
      leagueAiCommissionerAlerts: true,
      lifecycleState: { in: [...ACTIVE_STATES] },
      ...(opts.leagueId ? { id: opts.leagueId } : {}),
    },
    select: { id: true, sport: true, userId: true },
    orderBy: { id: 'asc' },
    take: opts.limit ?? 200,
  })
  const result: ScheduledAiAlertsResult = { discovered: leagues.length, ran: 0, skippedNoPlan: 0, failed: 0, created: 0 }
  const ownerPlan = new Map<string, boolean>()
  for (const league of leagues) {
    if (!league.userId) {
      result.skippedNoPlan += 1
      continue
    }
    if (!ownerPlan.has(league.userId)) {
      const owner = await prisma.appUser.findUnique({ where: { id: league.userId }, select: { email: true, username: true } }).catch(() => null)
      ownerPlan.set(league.userId, await hasAfCommissionerPlan({ id: league.userId, email: owner?.email ?? null, username: owner?.username ?? null }))
    }
    if (!ownerPlan.get(league.userId)) {
      result.skippedNoPlan += 1
      continue
    }
    try {
      const cycle = await run({ leagueId: league.id, sport: league.sport, source: 'scheduled' })
      result.ran += 1
      result.created += cycle.createdAlerts.length
    } catch (e) {
      result.failed += 1
      console.error('[ai-commissioner scheduled]', league.id, e instanceof Error ? e.message : 'unknown error')
    }
  }
  return result
}
