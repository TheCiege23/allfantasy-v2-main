import type { AutopilotStyle } from '@/lib/inactive-manager/inactiveManagerMode'
import type { CommissionerAiAssignment } from './types'

/**
 * The season style for a team Chimmy drafted, from the draft-room style. A youth-first draft keeps
 * building (`rebuild`); every other style runs the team as a steady owner would.
 */
export function seasonStyleForDraftStyle(style: CommissionerAiAssignment['aiStyle']): AutopilotStyle {
  // 'dynasty_owner' is DEFAULT_AUTOPILOT_STYLE; a literal so the draft room (client) loads no lineup code.
  return style === 'YOUTH' ? 'rebuild' : 'dynasty_owner'
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

export type ChimmySeasonResult = { rosterId: string; ok: boolean; error?: string }

/**
 * What the draft room says after saving its AI managers: whether Chimmy will also run the teams all
 * season, and — when one could not be handed over (the 4-team limit, the plan) — exactly why. The
 * draft assignment itself is saved either way; a team Chimmy could not take still drafts.
 */
export function draftAiSaveMessage(results: ReadonlyArray<ChimmySeasonResult> | null | undefined): string {
  const all = results ?? []
  const failed = all.filter((r) => !r.ok)
  const handed = all.filter((r) => r.ok).length
  if (failed.length === 0) return handed > 0 ? 'Saved. Chimmy drafts these teams and runs them all season.' : 'Saved.'
  const reasons = [...new Set(failed.map((r) => r.error).filter((e): e is string => Boolean(e)))].join(' ')
  const lead = handed > 0 ? `Saved. Chimmy will run ${handed} of them all season.` : 'Saved. Chimmy will draft these teams.'
  return `${lead} ${failed.length === 1 ? '1 team' : `${failed.length} teams`} could not be handed to Chimmy for the season: ${reasons || 'try again from the commissioner hub.'}`
}
