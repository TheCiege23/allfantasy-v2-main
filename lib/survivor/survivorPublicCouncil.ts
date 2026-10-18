import { gateRevealPayload, type PublicRevealStep } from './survivorRevealGate'

/** Fields the gate adds or replaces on every public council projection. */
export interface SurvivorPublicRevealFields {
  revealSequence: PublicRevealStep[] | null
  revealMode: 'one_at_a_time' | 'all_at_once'
  revealTotalSteps: number | null
  revealComplete: boolean
  revealNextStepAt: string | null
}

export type SurvivorPublicCouncil<T> = Omit<T, keyof SurvivorPublicRevealFields> & SurvivorPublicRevealFields

export interface SurvivorPublicCouncilOptions {
  /** League.survivorRevealMode. */
  revealMode?: string | null
  now?: Date
}

/**
 * Council output is an allowlist: closed/tallied never means publicly revealed, and a published read
 * is released step by step through `gateRevealPayload` — a client never receives a ballot before its
 * step, or the verdict before the last step.
 */
export function survivorPublicCouncil<T extends object>(council: T | null, _canSeePrivate: boolean, opts: SurvivorPublicCouncilOptions = {}): SurvivorPublicCouncil<T> | null {
  if (!council) return null
  const row = council as Record<string, unknown>
  const publicRow: Record<string, unknown> = {}
  for (const key of ['id', 'leagueId', 'week', 'phase', 'attendingTribeId', 'voteDeadlineAt', 'votingDeadline', 'votingOpensAt', 'closedAt']) {
    if (key in row) publicRow[key] = row[key]
  }
  const gate = gateRevealPayload({
    isRevealed: row.isRevealed === true,
    revealStartsAt: row.revealStartsAt as Date | string | null | undefined,
    revealStep: typeof row.revealStep === 'number' ? row.revealStep : 0,
    revealSequence: row.revealSequence,
    revealMode: opts.revealMode,
    eliminatedName: typeof row.eliminatedName === 'string' ? row.eliminatedName : null,
    isTie: row.isTie === true,
    tiePhase: typeof row.tiePhase === 'string' ? row.tiePhase : null,
    now: opts.now,
  })
  const started = gate.started
  const complete = started && gate.complete
  if ('isRevealed' in row) publicRow.isRevealed = started
  publicRow.status = !complete && (row.status === 'tie_pending' || row.status === 'revealed')
    ? started ? 'revealing' : 'closed'
    : row.status
  publicRow.votes = []
  publicRow.revealSequence = started ? gate.steps : null
  publicRow.revealMode = gate.mode
  publicRow.revealTotalSteps = gate.totalSteps
  publicRow.revealComplete = complete
  publicRow.revealNextStepAt = gate.nextStepAt
  publicRow.eliminatedRosterId = complete ? row.eliminatedRosterId ?? null : null
  publicRow.eliminatedUserId = complete ? row.eliminatedUserId ?? null : null
  publicRow.eliminatedName = complete ? row.eliminatedName ?? null : null
  publicRow.isTie = complete ? row.isTie === true : false
  return publicRow as SurvivorPublicCouncil<T>
}
