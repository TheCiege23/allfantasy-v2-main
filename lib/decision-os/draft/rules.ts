/**
 * Decision OS — Rule Modules for `manager.draft.pick`.
 *
 * Validity before optimality: a recommended player is only worth showing as "draft this player" if the
 * pick would actually be accepted. These rules WRAP the live pick gates rather than restating them:
 *   - `validatePickSubmission` (lib/live-draft-engine/PickValidation) — draft live, on the clock,
 *     player not already taken. Pure, so it is called directly.
 *   - `validateRosterFitForDraftPick` (lib/live-draft-engine/RosterFitValidation) — position allowed
 *     and roster not full. Reads the league template, so it is INJECTED and caught.
 * `submitPick` runs both on every real pick, so a verdict here is the answer the room would give.
 */
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import { validatePickSubmission } from '@/lib/live-draft-engine/PickValidation'
import { DRAFT_PICK_DUPLICATE_PLAYER, DRAFT_PICK_NOT_ON_CLOCK } from '@/lib/live-draft-engine/pickAuthorityCodes'
import type { DraftWorld } from './world'

export interface DraftCandidatePick {
  playerName: string
  position: string
}

export interface DraftRuleDeps {
  /** Production wires `validateRosterFitForDraftPick`, closed over league + board; tests fake it. */
  validateRosterFit: (candidate: DraftCandidatePick) => Promise<{ valid: boolean; error?: string }>
}

const LEGAL_RULE = 'draft.legality.pick'

/**
 * Every verdict for one candidate. The live gate stops at its FIRST failure, so availability is
 * checked separately: a player who is already gone is worth saying even while you wait your turn.
 */
export async function evaluateDraftPickRules(
  input: { candidate: DraftCandidatePick; world: DraftWorld },
  deps: DraftRuleDeps,
): Promise<RuleVerdict[]> {
  const { candidate, world } = input
  const verdicts: RuleVerdict[] = []

  // 1) Session + clock, exactly as the live gate sees them.
  const live = validatePickSubmission({
    playerName: candidate.playerName,
    position: candidate.position,
    rosterId: world.rosterId,
    currentOnClockRosterId: world.onClockRosterId ?? '',
    existingPicks: [],
    sessionStatus: world.status,
  })
  if (!live.valid) {
    if (live.code === DRAFT_PICK_NOT_ON_CLOCK) {
      verdicts.push({
        rule: 'draft.legality.not_on_clock',
        verdict: 'temporarily_illegal',
        message:
          world.picksUntilTurn != null && world.picksUntilTurn > 0
            ? `You are not on the clock yet — ${world.picksUntilTurn} pick${world.picksUntilTurn === 1 ? '' : 's'} until your turn.`
            : 'You are not on the clock yet.',
        severity: 'info',
      })
    } else if (world.status === 'paused') {
      verdicts.push({
        rule: 'draft.legality.paused',
        verdict: 'temporarily_illegal',
        message: 'The draft is paused; picks open again when the commissioner resumes it.',
        severity: 'warning',
      })
    } else if (world.status === 'pre_draft') {
      verdicts.push({
        rule: 'draft.legality.not_started',
        verdict: 'temporarily_illegal',
        message: 'The draft has not started yet.',
        severity: 'info',
      })
    } else {
      verdicts.push({
        rule: 'draft.legality.complete',
        verdict: 'illegal',
        message: 'The draft is over; no more picks can be made.',
        severity: 'critical',
      })
    }
  }

  // 2) Availability, isolated from the clock so it is reported either way.
  const available = validatePickSubmission({
    playerName: candidate.playerName,
    position: candidate.position,
    rosterId: world.rosterId,
    currentOnClockRosterId: world.rosterId,
    existingPicks: world.existingPicks,
    sessionStatus: 'in_progress',
  })
  if (!available.valid && available.code === DRAFT_PICK_DUPLICATE_PLAYER) {
    verdicts.push({
      rule: 'draft.legality.player_taken',
      verdict: 'illegal',
      message: `${candidate.playerName} has already been drafted.`,
      severity: 'critical',
    })
  }

  // 3) Roster fit. A template that cannot be read is not a refusal; the live gate passes it too.
  try {
    const fit = await deps.validateRosterFit(candidate)
    if (!fit.valid) {
      verdicts.push({
        rule: 'draft.legality.roster_fit',
        verdict: 'illegal',
        message: fit.error ?? `${candidate.position} does not fit this roster.`,
        severity: 'critical',
      })
    }
  } catch {
    // Same as the live gate when the template is unavailable: no verdict, not a refusal.
  }

  if (verdicts.length === 0) {
    verdicts.push({ rule: LEGAL_RULE, verdict: 'legal', message: 'This pick would be accepted.', severity: 'info' })
  }
  return verdicts
}
