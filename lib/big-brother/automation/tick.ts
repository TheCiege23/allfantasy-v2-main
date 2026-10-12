import { prisma } from '@/lib/prisma'
import { runAutomation, type AutomationRunInput } from '../BigBrotherAutomationService'
import { getCurrentCycleForLeague } from '../BigBrotherPhaseStateMachine'
import { BB_DEADLINES, deadlineForPhase } from '../schedule'
import type { BigBrotherWeekPhase } from '../types'
import type { BbAutomationTickInput, BbAutomationTickResult } from './types'

export async function runBigBrotherAutomationTick(input: BbAutomationTickInput = {}): Promise<BbAutomationTickResult> {
  const dryRun = input.dryRun === true
  const now = input.now ?? new Date()
  const errors: string[] = []
  let processed = 0, skipped = 0
  const configs = await prisma.bigBrotherLeagueConfig.findMany({
    where: { weekProgressionPaused: false, ...(input.forceLeagueId ? { leagueId: input.forceLeagueId } : {}) },
  })
  for (const config of configs) {
    try {
      const cycle = await getCurrentCycleForLeague(config.leagueId)
      if (!cycle || config.weekProgressionPaused) { skipped++; continue }
      const phase = cycle.phase as BigBrotherWeekPhase
      const event = BB_DEADLINES.find(e => e.phase === phase && e.action)
      const deadline = deadlineForPhase(config, cycle, phase)
      const intermediate = ['HOH_LOCKED', 'NOMINATION_LOCKED', 'VETO_CHALLENGE_OPEN', 'VOTING_LOCKED', 'EVICTION_RESOLVED', 'JURY_UPDATE', 'RESET_NEXT_WEEK'].includes(phase)
      if (!intermediate && (!deadline || deadline > now)) { skipped++; continue }
      // One transition per sweep prevents an overdue league losing every decision window at once.
      const action: AutomationRunInput['action'] = intermediate ? 'tick' : event?.action ?? 'tick'
      if (dryRun) { processed++; continue }
      const result = await runAutomation({ leagueId: config.leagueId, action, now })
      if (!result.ok) errors.push(`${config.leagueId}: ${result.error ?? 'Automation failed'}`)
      else if (result.actionTaken?.startsWith('skipped') || !result.actionTaken) skipped++
      else processed++
    } catch (error) { errors.push(`${config.leagueId}: ${error instanceof Error ? error.message : 'Automation failed'}`) }
  }
  return { ok: errors.length === 0, processed, skipped, errors, dryRun,
    message: `${dryRun ? '[dryRun] ' : ''}BB automation: ${processed} ${dryRun ? 'would process' : 'processed'}, ${skipped} skipped, ${errors.length} errors.` }
}
