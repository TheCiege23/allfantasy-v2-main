import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getCurrentCycleForLeague } from '../BigBrotherPhaseStateMachine'
import { BB_DEADLINES, deadlineForPhase } from '../schedule'
import type { BigBrotherWeekPhase } from '../types'
import type { BbReminderSweepInput, BbReminderSweepResult } from './types'

export async function runBbReminderSweep(input: BbReminderSweepInput = {}): Promise<BbReminderSweepResult> {
  const dryRun = input.dryRun === true
  const now = input.now ?? new Date()
  const errors: string[] = []
  let remindersScheduled = 0
  const configs = await prisma.bigBrotherLeagueConfig.findMany({ where: { weekProgressionPaused: false } })
  for (const config of configs) {
    try {
      const cycle = await getCurrentCycleForLeague(config.leagueId)
      if (!cycle || config.weekProgressionPaused) continue
      const event = BB_DEADLINES.find(e => e.phase === cycle.phase && e.action)
      const deadline = deadlineForPhase(config, cycle, cycle.phase as BigBrotherWeekPhase)
      if (!event || !deadline) continue
      const hours = (deadline.getTime() - now.getTime()) / 3_600_000
      if (hours <= 0 || hours > 24) continue
      const threshold = hours <= 1 ? '1h' : '24h'
      const key = 'bb-reminder-' + createHash('sha256').update(`${cycle.id}:${cycle.phase}:${deadline.toISOString()}:${threshold}`).digest('hex')
      if (await prisma.leagueChatMessage.findUnique({ where: { id: key }, select: { id: true } })) continue
      if (dryRun) { remindersScheduled++; continue }
      const league = await prisma.league.findUnique({ where: { id: config.leagueId }, select: { userId: true } })
      if (!league?.userId) throw new Error('League announcer unavailable')
      const sent = await createLeagueChatMessage(config.leagueId, league.userId,
        `Week ${cycle.week}: ${event.label} ${threshold === '1h' ? 'in less than 1 hour' : 'within 24 hours'}. Due ${deadline.toISOString()}. Open the league schedule to review your next action.`, {
          idempotencyKey: key, source: 'bb_automation', messageSubtype: 'bb_deadline_reminder',
          metadata: { chimmy: true, bigBrother: true, phase: cycle.phase, deadlineAt: deadline.toISOString(), threshold, week: cycle.week },
        })
      if (sent) remindersScheduled++
    } catch (error) { errors.push(`${config.leagueId}: ${error instanceof Error ? error.message : 'Reminder failed'}`) }
  }
  return { ok: errors.length === 0, remindersScheduled, errors, dryRun,
    message: `${dryRun ? '[dryRun] ' : ''}BB reminders: ${remindersScheduled} ${dryRun ? 'would send' : 'sent'}, ${errors.length} errors.` }
}
