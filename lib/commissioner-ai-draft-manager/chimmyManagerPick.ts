/**
 * Chimmy AI manager slots — when a Chimmy-managed team may pick on its own.
 *
 * A commissioner hands an orphan (unclaimed) team to Chimmy in the Commissioner AI managers panel
 * (`commissionerAiManagers.assignments`). Before this, such a team only picked when the commissioner
 * pressed "Run AI pick" or when its pick timer ran out, so every one of its turns cost the room the
 * full clock. Now the room asks for its pick a few seconds after the team comes on the clock.
 *
 * Opt-in per team: an orphan with no active assignment keeps the old behaviour (timer expiry or the
 * commissioner's button), so leagues that never assigned Chimmy see no change.
 *
 * Pure, so the rules are testable without a database.
 */

import type { CommissionerAiManagersBlob } from './types'
import { isRosterAiControlled } from './CommissionerAiDraftManagerService'

export { CHIMMY_PICK_DELAY_MS, chimmyThinkingTimeElapsed } from './chimmyPickTiming'

export type ChimmyPickEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'ai_manager_disabled' | 'not_orphan' | 'not_assigned' }

/** Whether the roster on the clock is one Chimmy manages. */
export function chimmyManagesRoster(input: {
  blob: CommissionerAiManagersBlob | null | undefined
  rosterId: string
  orphanRosterIds: readonly string[]
  orphanAiManagerEnabled: boolean
}): ChimmyPickEligibility {
  if (!input.orphanAiManagerEnabled) return { eligible: false, reason: 'ai_manager_disabled' }
  // Assignments are only honoured for orphan teams: a team a person has claimed is theirs to draft.
  if (!input.orphanRosterIds.includes(input.rosterId)) return { eligible: false, reason: 'not_orphan' }
  if (!isRosterAiControlled(input.blob, input.rosterId)) return { eligible: false, reason: 'not_assigned' }
  return { eligible: true }
}
