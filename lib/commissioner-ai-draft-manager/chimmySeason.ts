import { DEFAULT_AUTOPILOT_STYLE, type AutopilotStyle } from '@/lib/inactive-manager/inactiveManagerMode'
import type { CommissionerAiAssignment } from './types'

/**
 * The season style for a team Chimmy drafted, from the draft-room style. A youth-first draft keeps
 * building (`rebuild`); every other style runs the team as a steady owner would.
 */
export function seasonStyleForDraftStyle(style: CommissionerAiAssignment['aiStyle']): AutopilotStyle {
  return style === 'YOUTH' ? 'rebuild' : DEFAULT_AUTOPILOT_STYLE
}

/**
 * Pure: which teams to hand to Chimmy for the season (`style`) or take back (`null`) after the draft
 * room's AI managers change. Every active assignment is handed over; a team that WAS active and is now
 * off or gone is taken back. A team that was never assigned here is left alone, so a Chimmy team the
 * commissioner set up elsewhere is not switched off by the draft room.
 */
export function draftAssignmentChimmyChanges(
  before: ReadonlyArray<Pick<CommissionerAiAssignment, 'rosterId' | 'active' | 'aiStyle'>>,
  after: ReadonlyArray<Pick<CommissionerAiAssignment, 'rosterId' | 'active' | 'aiStyle'>>,
): Array<{ rosterId: string; style: AutopilotStyle | null }> {
  const nowActive = new Map(after.filter((a) => a.active).map((a) => [a.rosterId, a]))
  const out: Array<{ rosterId: string; style: AutopilotStyle | null }> = []
  for (const a of nowActive.values()) out.push({ rosterId: a.rosterId, style: seasonStyleForDraftStyle(a.aiStyle) })
  for (const b of before) {
    if (b.active && !nowActive.has(b.rosterId)) out.push({ rosterId: b.rosterId, style: null })
  }
  return out
}
