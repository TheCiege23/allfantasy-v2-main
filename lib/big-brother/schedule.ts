import type { BigBrotherWeekPhase } from './types'

export const BB_DEADLINES = [
  { key: 'hoh', label: 'HOH challenge', phase: 'HOH_OPEN', prefix: 'hohChallenge', action: 'auto_hoh' },
  { key: 'nomination', label: 'Nominations due', phase: 'NOMINATION_OPEN', prefix: 'nominationDeadline', action: 'auto_nominate' },
  { key: 'veto_draw', label: 'Veto draw', phase: 'VETO_DRAW', prefix: 'vetoDraw', action: 'veto_draw' },
  { key: 'veto_decision', label: 'Veto decision due', phase: 'VETO_DECISION_OPEN', prefix: 'vetoDecisionDeadline', action: 'veto_decision_timeout' },
  { key: 'replacement', label: 'Replacement due if veto is used', phase: 'REPLACEMENT_NOMINATION_OPEN', prefix: 'replacementNomineeDeadline', action: 'auto_replacement' },
  { key: 'voting_open', label: 'Voting opens', phase: 'VOTING_OPEN', prefix: 'evictionVoteOpen', action: null },
  { key: 'eviction', label: 'Voting closes / eviction', phase: 'VOTING_OPEN', prefix: 'evictionVoteClose', action: 'close_eviction' },
] as const
export type DeadlineKey = typeof BB_DEADLINES[number]['key']
export type DeadlineConfig = Partial<Record<`${typeof BB_DEADLINES[number]['prefix']}DayOfWeek`, number | null> & Record<`${typeof BB_DEADLINES[number]['prefix']}TimeUtc`, string | null>>
export type ScheduleCycle = { createdAt: Date | string; voteDeadlineAt?: Date | string | null; voteOpenedAt?: Date | string | null }

/** Resolve an occurrence from the cycle's fixed anchor, never from the sweep time.
 * Later milestones wrap forward across Sunday. Missing fields stay unscheduled.
 */
export function resolveBigBrotherDeadlines(config: DeadlineConfig, cycle: ScheduleCycle): Record<DeadlineKey, Date | null> {
  let cursor = new Date(cycle.createdAt)
  const result = {} as Record<DeadlineKey, Date | null>
  for (const event of BB_DEADLINES) {
    const day = config[`${event.prefix}DayOfWeek`]
    const time = config[`${event.prefix}TimeUtc`]
    let deadline: Date | null = null
    if (Number.isFinite(cursor.getTime()) && Number.isInteger(day) && day! >= 1 && day! <= 7 && typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      const [hour, minute] = time.split(':').map(Number)
      deadline = new Date(cursor)
      deadline.setUTCHours(hour, minute, 0, 0)
      deadline.setUTCDate(deadline.getUTCDate() + (day! % 7 - deadline.getUTCDay() + 7) % 7)
      if (deadline < cursor) deadline.setUTCDate(deadline.getUTCDate() + 7)
    }
    if (deadline && deadline > cursor) cursor = deadline
    const override = event.key === 'eviction' ? cycle.voteDeadlineAt : event.key === 'voting_open' ? cycle.voteOpenedAt : null
    if (override && Number.isFinite(new Date(override).getTime())) deadline = new Date(override)
    result[event.key] = deadline
  }
  return result
}

export function deadlineForPhase(config: DeadlineConfig, cycle: ScheduleCycle, phase: BigBrotherWeekPhase): Date | null {
  const event = BB_DEADLINES.find(e => e.phase === phase && e.action)
  return event ? resolveBigBrotherDeadlines(config, cycle)[event.key] : null
}
