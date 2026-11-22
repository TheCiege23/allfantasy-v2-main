import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'

/**
 * Whether this league's draft is OFFLINE: drafted in person, with the commissioner entering every
 * pick. Nothing picks automatically in one — no expired clock, orphan or Chimmy-run team,
 * "Auto-pick me", or AI opponent. Every automatic picker asks this before doing any work (an AI pick
 * costs a model call), and PickSubmissionService refuses an automatic pick for the same reason.
 *
 * Fails open to `false` only when the league's settings cannot be read, which leaves the existing
 * behaviour in place rather than stalling a live draft.
 */
export async function isOfflineDraft(leagueId: string): Promise<boolean> {
  try {
    return (await getDraftUISettingsForLeague(leagueId)).executionMode === 'offline'
  } catch {
    return false
  }
}
